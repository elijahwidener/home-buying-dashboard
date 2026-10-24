import { fail } from '@sveltejs/kit';
import { allZips, DEFAULT_CONFIG, type Config } from '#lib/config.js';
import { db, loadConfig, run, saveConfig } from '#lib/server/db.js';
import { clearDemo } from '#lib/server/demo.js';
import { isRefreshing, refresh } from '#lib/server/refresh.js';
import { clearCommutes, kickCommutes } from '#lib/server/commute.js';
import { buildPlanner, plannerState } from '#lib/server/otp.js';
import { sourceHealth } from '#lib/server/live.js';
import { str } from '#lib/server/params.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const p = plannerState();
	return {
		cfg: loadConfig(),
		sources: sourceHealth(),
		refreshing: isRefreshing(),
		planner: { built: p.built, building: p.building, running: p.running, builtAt: p.builtAt, serviceDate: p.serviceDate, feeds: p.feeds, log: p.log }
	};
};

/** Number fields that may be left blank (unknown). */
const NULLABLE = new Set(['rideMin', 'crime', 'crime2026']);

/** Write a form value into the config at a dotted path, coercing to the type already there. */
function setPath(root: unknown, path: string, raw: string) {
	const keys = path.split('.');
	let obj = root as Record<string, unknown>;
	for (const key of keys.slice(0, -1)) {
		obj = obj?.[key] as Record<string, unknown>;
		if (obj == null || typeof obj !== 'object') return;
	}
	const last = keys[keys.length - 1];
	if (!(last in obj)) return;
	const cur = obj[last];
	if (typeof cur === 'number' || (cur === null && NULLABLE.has(last))) {
		const t = raw.replace(/[$,\s%]/g, '');
		const n = Number(t);
		if (t === '' && NULLABLE.has(last)) obj[last] = null;
		else if (t !== '' && Number.isFinite(n)) obj[last] = n;
	} else if (typeof cur === 'boolean') {
		obj[last] = raw === 'on' || raw === 'true';
	} else if (Array.isArray(cur) && cur.every((v) => typeof v !== 'object')) {
		const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
		obj[last] = typeof cur[0] === 'number' || last === 'cars' ? parts.map(Number).filter(Number.isFinite) : parts;
	} else if (typeof cur === 'string') {
		obj[last] = raw.trim();
	}
}


export const actions: Actions = {
	save: async ({ request }) => {
		const f = await request.formData();
		const cfg = loadConfig();
		const zipsBefore = allZips(cfg).join(',');
		const commuteBefore = JSON.stringify(cfg.commute);
		// Unchecked checkboxes aren't sent; the form lists every boolean it shows.
		for (const path of str(f.get('_bools')).split(',').filter(Boolean)) setPath(cfg, path, f.has(path) ? 'on' : 'false');
		for (const [key, value] of f.entries()) {
			if (key.startsWith('_') || typeof value !== 'string' || key.startsWith('json.')) continue;
			setPath(cfg, key, value);
		}
		for (const key of ['jurisdictions', 'states', 'federal'] as const) {
			const raw = f.get(`json.${key}`);
			if (typeof raw !== 'string') continue;
			try {
				(cfg as unknown as Record<string, unknown>)[key] = JSON.parse(raw);
			} catch (e) {
				return fail(400, { error: `${key}: invalid JSON (${e instanceof Error ? e.message : e})` });
			}
		}
		for (const a of cfg.areas) {
			if (!cfg.jurisdictions[a.jurisdiction]) return fail(400, { error: `${a.name}: unknown jurisdiction "${a.jurisdiction}"` });
		}
		if (!/^\d\d:\d\d$/.test(cfg.commute.arriveBy)) return fail(400, { error: 'Arrival time should look like 09:00.' });
		if (!(cfg.commute.rushFactor >= 1 && cfg.commute.rushFactor <= 4)) return fail(400, { error: 'Rush-hour factor should be between 1 and 4.' });
		saveConfig(cfg);
		if (allZips(cfg).join(',') !== zipsBefore) void refresh('zillow');
		if (JSON.stringify(cfg.commute) !== commuteBefore) {
			clearCommutes();
			kickCommutes();
		}
		return { saved: true };
	},
	addDate: async ({ request }) => {
		const f = await request.formData();
		const date = str(f.get('date'));
		const label = str(f.get('label'));
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !label) return fail(400, { error: 'Date and label are required.' });
		const cfg = loadConfig();
		cfg.keyDates.push({ date, label });
		cfg.keyDates.sort((a, b) => a.date.localeCompare(b.date));
		saveConfig(cfg);
		return { saved: true };
	},
	removeDate: async ({ request }) => {
		const f = await request.formData();
		const cfg = loadConfig();
		const i = Number(f.get('i'));
		cfg.keyDates = cfg.keyDates.filter((_, j) => j !== i);
		saveConfig(cfg);
		return { saved: true };
	},
	addFeed: async ({ request }) => {
		const f = await request.formData();
		const name = str(f.get('name'));
		let url = str(f.get('url'));
		if (!name || !url) return fail(400, { error: 'Name and URL (or search words) are required.' });
		// Plain words become a Google News search feed.
		if (!/^https?:\/\//.test(url)) url = `https://news.google.com/rss/search?q=${encodeURIComponent(url)}&hl=en-US&gl=US&ceid=US:en`;
		const cfg = loadConfig();
		cfg.feeds.push({ name, url });
		saveConfig(cfg);
		void refresh('news');
		return { saved: true };
	},
	removeFeed: async ({ request }) => {
		const f = await request.formData();
		const cfg = loadConfig();
		const name = str(f.get('name'));
		cfg.feeds = cfg.feeds.filter((x) => x.name !== name);
		saveConfig(cfg);
		run('DELETE FROM news WHERE feed = ?', name);
		run('DELETE FROM sources WHERE key = ?', `news:${name}`);
		return { saved: true };
	},
	/** Download schedules and streets and build the trip planner (runs in the background). */
	buildPlanner: async () => {
		void buildPlanner()
			.then(() => {
				clearCommutes();
				kickCommutes();
			})
			.catch(() => {
				/* reported in the planner log */
			});
		return { building: true };
	},
	refresh: async ({ request }) => {
		const f = await request.formData();
		const which = str(f.get('which'));
		// Wait for quick sources; Zillow downloads run in the background.
		if (which === 'zillow') void refresh('zillow', true);
		else await refresh(which === 'fred' || which === 'news' ? which : 'all');
		return { refreshed: which || 'all' };
	},
	reset: async ({ request }) => {
		const f = await request.formData();
		const section = str(f.get('section')) as keyof Config;
		const cfg = loadConfig();
		if (section && section in DEFAULT_CONFIG) {
			(cfg as unknown as Record<string, unknown>)[section] = structuredClone(DEFAULT_CONFIG[section]);
			saveConfig(cfg);
		}
		return { saved: true };
	},
	clearDemo: async () => {
		clearDemo(db());
		return { saved: true };
	}
};
