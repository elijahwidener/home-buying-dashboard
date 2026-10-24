// Local trip planner (OpenTripPlanner 2). Built once from public transit schedules and OpenStreetMap,
// then started only while commute times are being computed (it needs ~3 GB of memory while running).
// Everything runs inside this container; the only outside requests are the downloads during a build.
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Mode } from '#lib/mapdata.js';
import { getSetting, setSetting } from '#lib/server/db.js';

const DATA_DIR = process.env.DATA_DIR ?? './data';
const DIR = join(DATA_DIR, 'otp');
const RAW = join(DIR, 'raw');
const GRAPH = join(DIR, 'graph');
const JAVA = process.env.JAVA ?? 'java';
const JAR = process.env.OTP_JAR ?? join(DIR, 'otp.jar');
const JAR_URL = 'https://repo1.maven.org/maven2/org/opentripplanner/otp-shaded/2.10.0/otp-shaded-2.10.0.jar';
const PORT = Number(process.env.OTP_PORT ?? 8090);
const BUILD_HEAP = process.env.OTP_BUILD_HEAP ?? '5g';
const SERVE_HEAP = process.env.OTP_SERVE_HEAP ?? '3g';

/** Streets: west, south, east, north. Covers DC, inner Maryland suburbs out to Germantown/Laurel, and Arlington/Fairfax. */
const BBOX = '-77.50,38.70,-76.70,39.30';
const OSM_STATES = ['district-of-columbia', 'maryland', 'virginia'];
/** Schedules, from the Mobility Database's mirror (no API keys). */
const FEEDS = [
	{ id: 'mdb-1847', name: 'Metrorail' },
	{ id: 'mdb-1846', name: 'Metrobus' },
	{ id: 'mdb-488', name: 'Ride On (Montgomery)' },
	{ id: 'mdb-477', name: "TheBus (Prince George's)" },
	{ id: 'mdb-468', name: 'MARC' },
	{ id: 'mdb-467', name: 'MTA commuter bus' },
	{ id: 'mdb-483', name: 'Fairfax Connector' },
	{ id: 'mdb-485', name: 'ART (Arlington)' },
	{ id: 'mdb-482', name: 'DASH (Alexandria)' }
];

export interface PlannerInfo {
	builtAt: string | null;
	/** Weekday whose timetable every query uses (inside every feed's dates). */
	serviceDate: string | null;
	feeds: { name: string; from: string; to: string }[];
}

let building = false;
let proc: ChildProcess | undefined;
let ready: Promise<void> | undefined;
const log: string[] = [];
function note(line: string) {
	const s = `${new Date().toLocaleTimeString('en-US', { hour12: false })} ${line}`;
	log.push(s);
	if (log.length > 200) log.shift();
	console.log(`[otp] ${line}`);
}

export function plannerInfo(): PlannerInfo {
	try {
		return JSON.parse(getSetting('otp') ?? 'null') ?? { builtAt: null, serviceDate: null, feeds: [] };
	} catch {
		return { builtAt: null, serviceDate: null, feeds: [] };
	}
}

export function plannerState() {
	const info = plannerInfo();
	return { ...info, built: !!info.builtAt && existsSync(join(GRAPH, 'graph.obj')), building, running: !!proc, log: log.slice(-40) };
}

function run(cmd: string, args: string[], quiet = false): Promise<void> {
	return new Promise((resolve, reject) => {
		const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		const onData = (b: Buffer) => {
			for (const line of b.toString().split('\n'))
				// InterlineProcessor complaints are about bus block data in WMATA's feed: harmless and very noisy.
				if (line.trim() && !line.includes('InterlineProcessor') && (!quiet || /ERROR|Exception/.test(line))) note(line.trim().slice(0, 240));
		};
		p.stdout.on('data', onData);
		p.stderr.on('data', onData);
		p.on('error', reject);
		p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
	});
}

function capture(cmd: string, args: string[]): Promise<string> {
	return new Promise((resolve) => {
		const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
		let out = '';
		p.stdout.on('data', (b: Buffer) => (out += b.toString()));
		p.on('error', () => resolve(''));
		p.on('close', () => resolve(out));
	});
}

async function download(url: string, file: string) {
	const res = await fetch(url, { headers: { 'user-agent': 'home-dashboard/1.0 (personal use)' }, signal: AbortSignal.timeout(30 * 60_000) });
	if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
	await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(file));
}

/** [first, last] service day of a GTFS zip, as YYYYMMDD (feed_info first, else calendar). */
async function feedDates(zip: string): Promise<[string, string] | null> {
	const parse = (csv: string, a: string, b: string): [string, string] | null => {
		const rows = csv.trim().split(/\r?\n/).map((l) => l.split(',').map((c) => c.replace(/^"|"$/g, '').trim()));
		const h = rows[0] ?? [];
		const [i, j] = [h.indexOf(a), h.indexOf(b)];
		if (i < 0 || j < 0 || rows.length < 2) return null;
		const starts = rows.slice(1).map((r) => r[i]).filter(Boolean).sort();
		const ends = rows.slice(1).map((r) => r[j]).filter(Boolean).sort();
		return starts.length && ends.length ? [starts[0], ends.at(-1)!] : null;
	};
	return parse(await capture('unzip', ['-p', zip, 'feed_info.txt']), 'feed_start_date', 'feed_end_date') ??
		parse(await capture('unzip', ['-p', zip, 'calendar.txt']), 'start_date', 'end_date');
}

/** A Tuesday inside every feed's dates: the next one if possible, else the latest one available. */
function pickServiceDate(ranges: [string, string][]): string {
	const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
	const from = ranges.map((r) => iso(r[0])).sort().at(-1)!;
	const to = ranges.map((r) => iso(r[1])).sort()[0];
	const today = new Date().toLocaleDateString('en-CA');
	const d = new Date(`${from > today ? from : today}T12:00:00`);
	while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
	let pick = d.toLocaleDateString('en-CA');
	if (pick > to) {
		// No Tuesday left in the overlap: take the last weekday that is.
		const e = new Date(`${to}T12:00:00`);
		while (e.getDay() === 0 || e.getDay() === 6) e.setDate(e.getDate() - 1);
		pick = e.toLocaleDateString('en-CA');
	}
	return pick;
}

/** Download everything and build the planner's graph (10–30 minutes). */
export async function buildPlanner(): Promise<void> {
	if (building) return;
	building = true;
	log.length = 0;
	try {
		await stopPlanner();
		mkdirSync(RAW, { recursive: true });
		mkdirSync(GRAPH, { recursive: true });
		if (!existsSync(JAR)) {
			note('Downloading OpenTripPlanner (190 MB)…');
			await download(JAR_URL, JAR);
		}
		for (const f of readdirSync(GRAPH)) rmSync(join(GRAPH, f), { force: true });

		for (const s of OSM_STATES) {
			note(`Downloading OpenStreetMap: ${s}…`);
			await download(`https://download.geofabrik.de/north-america/us/${s}-latest.osm.pbf`, join(RAW, `${s}.osm.pbf`));
			note(`Cropping ${s} to the DC region…`);
			await run('osmium', ['extract', '-b', BBOX, '-s', 'smart', '--overwrite', '-o', join(RAW, `${s}-cut.osm.pbf`), join(RAW, `${s}.osm.pbf`)], true);
			rmSync(join(RAW, `${s}.osm.pbf`), { force: true });
		}
		await run('osmium', ['merge', '--overwrite', '-o', join(GRAPH, 'region.osm.pbf'), ...OSM_STATES.map((s) => join(RAW, `${s}-cut.osm.pbf`))], true);

		const feeds: PlannerInfo['feeds'] = [];
		const ranges: [string, string][] = [];
		for (const f of FEEDS) {
			note(`Downloading schedules: ${f.name}…`);
			const file = join(GRAPH, `${f.id}.gtfs.zip`);
			try {
				await download(`https://files.mobilitydatabase.org/${f.id}/latest.zip`, file);
			} catch (e) {
				note(`Skipping ${f.name}: ${e instanceof Error ? e.message : e}`);
				continue;
			}
			const r = await feedDates(file);
			if (r) {
				feeds.push({ name: f.name, from: r[0], to: r[1] });
				// Metro and the county buses decide the date; a stale minor feed shouldn't.
				if (['mdb-1847', 'mdb-1846', 'mdb-488'].includes(f.id)) ranges.push(r);
			}
		}
		if (!ranges.length) throw new Error('No Metro schedules downloaded.');

		// Feeds name the zone differently (America/New_York vs US/Eastern); OTP needs one.
		writeFileSync(join(GRAPH, 'build-config.json'), JSON.stringify({ transitModelTimeZone: 'America/New_York', osmDefaults: { timeZone: 'America/New_York' } }));
		note(`Building the graph (this is the long part; ${BUILD_HEAP} memory)…`);
		await run(JAVA, [`-Xmx${BUILD_HEAP}`, '-jar', JAR, '--build', '--save', GRAPH], true);
		if (!existsSync(join(GRAPH, 'graph.obj'))) throw new Error('Build finished without a graph.');
		for (const s of OSM_STATES) rmSync(join(RAW, `${s}-cut.osm.pbf`), { force: true });

		const info: PlannerInfo = { builtAt: new Date().toISOString(), serviceDate: pickServiceDate(ranges), feeds };
		setSetting('otp', JSON.stringify(info));
		note(`Done. Graph ${Math.round(statSync(join(GRAPH, 'graph.obj')).size / 1e6)} MB; timetables for ${info.serviceDate}.`);
	} catch (e) {
		note(`Build failed: ${e instanceof Error ? e.message : e}`);
		throw e;
	} finally {
		building = false;
	}
}

const GQL = `http://127.0.0.1:${PORT}/otp/gtfs/v1`;

async function gql<T>(query: string, variables: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
	const res = await fetch(GQL, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ query, variables }),
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) throw new Error(`planner HTTP ${res.status}`);
	const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
	if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
	return body.data as T;
}

/** Start the planner if it isn't running; resolves once it answers. */
export function startPlanner(): Promise<void> {
	if (ready) return ready;
	if (!plannerState().built) return Promise.reject(new Error('The trip planner has not been built yet (Settings → Trip planner).'));
	note('Starting the trip planner…');
	const p = spawn(JAVA, [`-Xmx${SERVE_HEAP}`, '-jar', JAR, '--load', '--serve', '--port', String(PORT), GRAPH], { stdio: ['ignore', 'pipe', 'pipe'] });
	proc = p;
	const onData = (b: Buffer) => {
		for (const line of b.toString().split('\n')) if (/ERROR|Exception|Grizzly server running/.test(line)) note(line.trim().slice(0, 240));
	};
	p.stdout?.on('data', onData);
	p.stderr?.on('data', onData);
	p.on('close', (code) => {
		note(`Trip planner stopped (${code ?? 'signal'}).`);
		if (proc === p) [proc, ready] = [undefined, undefined];
	});
	ready = (async () => {
		const deadline = Date.now() + 8 * 60_000;
		while (Date.now() < deadline) {
			if (proc !== p) throw new Error('The trip planner exited while starting. See the log in Settings.');
			try {
				await gql('{ feeds { feedId } }', {}, 5000);
				note('Trip planner ready.');
				return;
			} catch {
				await new Promise((r) => setTimeout(r, 2000));
			}
		}
		await stopPlanner();
		throw new Error('The trip planner did not start within 8 minutes.');
	})();
	ready.catch(() => {
		if (proc === p) ready = undefined;
	});
	return ready;
}

export async function stopPlanner() {
	const p = proc;
	if (!p) return;
	[proc, ready] = [undefined, undefined];
	await new Promise<void>((resolve) => {
		p.once('close', () => resolve());
		p.kill('SIGTERM');
		setTimeout(() => {
			p.kill('SIGKILL');
			resolve();
		}, 15_000).unref();
	});
}

const PLAN = `query Plan($origin: PlanLabeledLocationInput!, $destination: PlanLabeledLocationInput!, $dateTime: PlanDateTimeInput, $modes: PlanModesInput) {
	planConnection(origin: $origin, destination: $destination, dateTime: $dateTime, modes: $modes, first: 5) {
		edges { node { duration legs { mode duration } } }
	}
}`;

const MODE_INPUT: Record<Mode, unknown> = {
	transit: { transit: { access: ['WALK'], egress: ['WALK'], transfer: ['WALK'] }, direct: ['WALK'] },
	parkride: { transitOnly: true, transit: { access: ['CAR_PARKING'], egress: ['WALK'], transfer: ['WALK'] } },
	drive: { directOnly: true, direct: ['CAR'] }
};

/** Minutes after parking downtown or near work: find a spot and walk in. */
export const PARK_AND_WALK_MIN = 5;

/**
 * Door-to-door minutes from one point to another, arriving by `arriveBy` (HH:MM) on the planner's service date.
 * Car time is multiplied by `rushFactor` (the planner only knows free-flow speeds). Null = no route.
 */
export async function commuteMinutes(
	from: { lat: number; lng: number },
	to: { lat: number; lng: number },
	mode: Mode,
	arriveBy: string,
	rushFactor: number
): Promise<number | null> {
	const date = plannerInfo().serviceDate;
	if (!date) throw new Error('Planner has no service date; rebuild it.');
	// Eastern time on that date (DST-aware).
	const offset = new Date(`${date}T12:00:00Z`).toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' }).match(/GMT([+-]\d\d:\d\d)/)?.[1] ?? '-05:00';
	const data = await gql<{ planConnection: { edges: { node: { duration: number; legs: { mode: string; duration: number }[] } }[] } }>(PLAN, {
		origin: { location: { coordinate: { latitude: from.lat, longitude: from.lng } } },
		destination: { location: { coordinate: { latitude: to.lat, longitude: to.lng } } },
		dateTime: { latestArrival: `${date}T${arriveBy}:00${offset}` },
		modes: MODE_INPUT[mode]
	});
	let best: number | null = null;
	for (const { node } of data.planConnection.edges) {
		const car = node.legs.filter((l) => l.mode === 'CAR').reduce((s, l) => s + l.duration, 0);
		if (mode === 'parkride' && car === 0) continue;
		let sec = node.duration + car * (rushFactor - 1);
		if (mode === 'drive') sec += PARK_AND_WALK_MIN * 60;
		if (best == null || sec < best) best = sec;
	}
	return best == null ? null : Math.round(best / 6) / 10;
}

/** Nearby spots to try, closest first: the point itself, then rings out to ~500 m. */
function candidates(lat: number, lng: number) {
	const out = [{ lat, lng }];
	const kx = Math.cos((lat * Math.PI) / 180);
	for (const m of [60, 120, 200, 300, 450])
		for (let i = 0; i < 8; i++) {
			const a = (i * Math.PI) / 4;
			out.push({ lat: lat + (m * Math.sin(a)) / 111_000, lng: lng + (m * Math.cos(a)) / (111_000 * kx) });
		}
	return out;
}

/**
 * A spot the planner can route from/to. Points inside closed grounds (the Treasury and White House, a base,
 * a campus with private paths) aren't connected to public streets; this finds the nearest one that is,
 * by checking that you can both walk and drive from it to a reference point (the nearest Metro station).
 */
export async function snap(p: { lat: number; lng: number }, ref: { lat: number; lng: number }): Promise<{ lat: number; lng: number }> {
	const date = plannerInfo().serviceDate ?? new Date().toLocaleDateString('en-CA');
	const ok = async (c: { lat: number; lng: number }, mode: 'WALK' | 'CAR') => {
		const d = await gql<{ planConnection: { edges: unknown[] } }>(PLAN, {
			origin: { location: { coordinate: { latitude: c.lat, longitude: c.lng } } },
			destination: { location: { coordinate: { latitude: ref.lat, longitude: ref.lng } } },
			dateTime: { earliestDeparture: `${date}T08:00:00-04:00` },
			modes: { directOnly: true, direct: [mode] }
		});
		return d.planConnection.edges.length > 0;
	};
	for (const c of candidates(p.lat, p.lng)) if ((await ok(c, 'WALK')) && (await ok(c, 'CAR'))) return c;
	return p;
}
