// Fills in missing commute times with the local trip planner, then shuts it down.
// Work is whatever is missing in the tables, so it's safe to kick any time (new place, moved area, new settings).
import type { Config } from '#lib/config.js';
import { all, get, loadConfig, run } from '#lib/server/db.js';
import { MODES, type BandGrid, type Mode } from '#lib/mapdata.js';
import { METRO } from '#lib/metro.js';
import { commuteMinutes, plannerState, snap, startPlanner, stopPlanner } from '#lib/server/otp.js';

export interface Place {
	id: number;
	name: string;
	lat: number;
	lng: number;
}

/** ~1 km grid cells for the map's commute bands. */
const CELL = { lat: 0.009, lng: 0.0116 };
/** How far around a place to compute (~22 km), so the cut-off lands where commutes are already long. */
const REACH = { lat: 0.2, lng: 0.26 };
/** The planner's street data (see BBOX in otp.ts); nothing outside it can be routed. */
const LIMITS = { south: 38.7, north: 39.3, west: -77.5, east: -76.7 };

type Box = { south: number; north: number; west: number; east: number };

/** Grid for one place: centered on it, stretched to include every area with a margin, snapped to whole cells. */
export function gridFor(p: { lat: number; lng: number }, areas: { lat: number; lng: number }[]) {
	const box: Box = { south: p.lat - REACH.lat, north: p.lat + REACH.lat, west: p.lng - REACH.lng, east: p.lng + REACH.lng };
	for (const a of areas) {
		box.south = Math.min(box.south, a.lat - 0.05);
		box.north = Math.max(box.north, a.lat + 0.05);
		box.west = Math.min(box.west, a.lng - 0.06);
		box.east = Math.max(box.east, a.lng + 0.06);
	}
	const south = Math.max(LIMITS.south, Math.floor(box.south / CELL.lat) * CELL.lat);
	const west = Math.max(LIMITS.west, Math.floor(box.west / CELL.lng) * CELL.lng);
	const rows = Math.ceil((Math.min(LIMITS.north, box.north) - south) / CELL.lat);
	const cols = Math.ceil((Math.min(LIMITS.east, box.east) - west) / CELL.lng);
	const r = (n: number) => Math.round(n * 1e5) / 1e5;
	return { south: r(south), west: r(west), north: r(south + rows * CELL.lat), east: r(west + cols * CELL.lng), rows, cols };
}

/** A stored grid is good enough if it already covers what's needed now (a new far-off area makes it grow). */
function covers(stored: Box | undefined, need: Box) {
	return !!stored && stored.south <= need.south + 1e-6 && stored.west <= need.west + 1e-6 && stored.north >= need.north - 1e-6 && stored.east >= need.east - 1e-6;
}

const CONCURRENCY = 4;
const IDLE_STOP_MS = 60_000;

export interface Progress {
	running: boolean;
	placeId: number | null;
	placeName: string;
	stage: string;
	done: number;
	total: number;
	error: string;
}

const progress: Progress = { running: false, placeId: null, placeName: '', stage: '', done: 0, total: 0, error: '' };
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let again = false;

export function commuteProgress(): Progress {
	return { ...progress };
}

export function places(): Place[] {
	return all<Place>('SELECT id, name, lat, lng FROM commute_places ORDER BY id');
}

export function addPlace(name: string, lat: number, lng: number): number {
	return Number(run('INSERT INTO commute_places (name, lat, lng) VALUES (?, ?, ?)', name, lat, lng).lastInsertRowid);
}

export function removePlace(id: number) {
	run('DELETE FROM commute_places WHERE id = ?', id);
}

/** Forget every computed time (e.g. after the arrival time, rush-hour factor or planner data changed). */
export function clearCommutes() {
	run('DELETE FROM commute_times');
	run('DELETE FROM commute_grids');
	run('UPDATE commute_places SET rlat = NULL, rlng = NULL');
	snapped.clear();
}

/** Minutes by area and mode for one place. */
export function areaTimes(placeId: number): Record<string, Partial<Record<Mode, number | null>>> {
	const out: Record<string, Partial<Record<Mode, number | null>>> = {};
	for (const r of all<{ area_id: string; mode: Mode; minutes: number | null }>('SELECT area_id, mode, minutes FROM commute_times WHERE place_id = ?', placeId))
		(out[r.area_id] ??= {})[r.mode] = r.minutes;
	return out;
}

export function grids(placeId: number): BandGrid[] {
	return all<Omit<BandGrid, 'data'> & { data: string }>('SELECT mode, south, west, north, east, rows, cols, data FROM commute_grids WHERE place_id = ?', placeId).map(
		(g) => ({ ...g, data: JSON.parse(g.data) })
	);
}

type Task = { place: Place; kind: 'areas' } | { place: Place; kind: 'grid'; mode: Mode };

function missingAreas(cfg: Config, place: Place) {
	const have = new Set(
		all<{ area_id: string; mode: string; lat: number; lng: number }>('SELECT area_id, mode, lat, lng FROM commute_times WHERE place_id = ?', place.id).map(
			(r) => `${r.area_id}|${r.mode}|${r.lat}|${r.lng}`
		)
	);
	return cfg.areas.flatMap((a) => MODES.filter((m) => !have.has(`${a.id}|${m}|${a.lat}|${a.lng}`)).map((mode) => ({ area: a, mode })));
}

/** Next piece of work: the selected place first, areas before grids. */
function nextTask(cfg: Config): Task | null {
	const ps = places().sort((a, b) => (a.id === cfg.commute.placeId ? -1 : b.id === cfg.commute.placeId ? 1 : a.id - b.id));
	for (const place of ps) if (missingAreas(cfg, place).length) return { place, kind: 'areas' };
	for (const place of ps) {
		const need = gridFor(place, cfg.areas);
		for (const mode of MODES)
			if (!covers(get<Box>('SELECT south, west, north, east FROM commute_grids WHERE place_id = ? AND mode = ?', place.id, mode), need))
				return { place, kind: 'grid', mode };
	}
	return null;
}

async function pool<T>(items: T[], fn: (item: T) => Promise<void>) {
	let i = 0;
	await Promise.all(
		Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
			while (i < items.length) await fn(items[i++]);
		})
	);
}

type LatLng = { lat: number; lng: number };

/** Nearest Metro station at least 1 km away: a well-connected point to test reachability against. */
function reference(p: LatLng): LatLng {
	const d = (s: LatLng) => Math.hypot((s.lat - p.lat) * 111, (s.lng - p.lng) * 86);
	return METRO.stations.filter((s) => d(s) > 1).sort((a, b) => d(a) - d(b))[0];
}

/** The place's routable point, found once and stored. */
async function routePoint(p: Place): Promise<LatLng> {
	const row = get<{ rlat: number | null; rlng: number | null }>('SELECT rlat, rlng FROM commute_places WHERE id = ?', p.id);
	if (row?.rlat != null && row.rlng != null) return { lat: row.rlat, lng: row.rlng };
	const r = await snap(p, reference(p));
	run('UPDATE commute_places SET rlat = ?, rlng = ? WHERE id = ?', r.lat, r.lng, p.id);
	return r;
}

// Area centers get the same treatment, remembered while the app runs.
const snapped = new Map<string, LatLng>();
async function areaPoint(a: LatLng): Promise<LatLng> {
	const key = `${a.lat},${a.lng}`;
	if (!snapped.has(key)) snapped.set(key, await snap(a, reference(a)));
	return snapped.get(key)!;
}

async function safeMinutes(from: LatLng, to: LatLng, mode: Mode, cfg: Config) {
	try {
		return await commuteMinutes(from, to, mode, cfg.commute.arriveBy, cfg.commute.rushFactor);
	} catch (e) {
		// One bad point (in a river, say) shouldn't stop the rest; a dead planner should.
		if (e instanceof TypeError || /ECONNREFUSED|fetch failed/.test(String(e))) throw e;
		return null;
	}
}

async function runTask(cfg: Config, t: Task) {
	const p = t.place;
	progress.placeId = p.id;
	progress.placeName = p.name;
	Object.assign(progress, { stage: 'finding the nearest street', done: 0, total: 0 });
	const to = await routePoint(p);
	if (t.kind === 'areas') {
		const todo = missingAreas(cfg, p);
		Object.assign(progress, { stage: 'areas', done: 0, total: todo.length });
		await pool(todo, async ({ area, mode }) => {
			const minutes = await safeMinutes(await areaPoint(area), to, mode, cfg);
			// The place may have been deleted meanwhile.
			if (get('SELECT 1 FROM commute_places WHERE id = ?', p.id))
				run(
					`INSERT INTO commute_times (place_id, area_id, lat, lng, mode, minutes) VALUES (?, ?, ?, ?, ?, ?)
					 ON CONFLICT(place_id, area_id, mode) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, minutes = excluded.minutes`,
					p.id, area.id, area.lat, area.lng, mode, minutes
				);
			progress.done++;
		});
		return;
	}
	const { rows, cols, south, west, north, east } = gridFor(p, cfg.areas);
	const dLat = (north - south) / rows;
	const dLng = (east - west) / cols;
	const cells = Array.from({ length: rows * cols }, (_, i) => i);
	const data: (number | null)[] = new Array(cells.length).fill(null);
	Object.assign(progress, { stage: `map (${t.mode === 'parkride' ? 'park & ride' : t.mode})`, done: 0, total: cells.length });
	await pool(cells, async (i) => {
		const r = Math.floor(i / cols);
		const c = i % cols;
		data[i] = await safeMinutes({ lat: north - (r + 0.5) * dLat, lng: west + (c + 0.5) * dLng }, to, t.mode, cfg);
		progress.done++;
	});
	if (get('SELECT 1 FROM commute_places WHERE id = ?', p.id))
		run(
			`INSERT INTO commute_grids (place_id, mode, south, west, north, east, rows, cols, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(place_id, mode) DO UPDATE SET south = excluded.south, west = excluded.west, north = excluded.north, east = excluded.east,
				rows = excluded.rows, cols = excluded.cols, data = excluded.data, computed_at = datetime('now')`,
			p.id, t.mode, south, west, north, east, rows, cols, JSON.stringify(data)
		);
}

/** Start working through missing commutes in the background (no-op if already running). */
export function kickCommutes() {
	if (progress.running) {
		again = true;
		return;
	}
	if (!plannerState().built) return;
	void (async () => {
		Object.assign(progress, { running: true, error: '' });
		clearTimeout(idleTimer);
		try {
			do {
				again = false;
				let t: Task | null;
				while ((t = nextTask(loadConfig()))) {
					await startPlanner();
					await runTask(loadConfig(), t);
				}
			} while (again);
		} catch (e) {
			progress.error = e instanceof Error ? e.message : String(e);
			console.error('[commute]', progress.error);
		} finally {
			Object.assign(progress, { running: false, stage: '', done: 0, total: 0 });
			idleTimer = setTimeout(() => void stopPlanner(), IDLE_STOP_MS);
		}
	})();
}
