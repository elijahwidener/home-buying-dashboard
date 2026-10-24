// Background refresh: runs inside the app process, so the dashboard stays current
// as long as the container is up. Each source has its own cadence.
import { loadConfig } from '#lib/server/db.js';
import { refreshFred } from './sources/fred.ts';
import { refreshGeocode } from './sources/geocode.ts';
import { refreshNews } from './sources/news.ts';
import { refreshZillow } from './sources/zillow.ts';

const HOUR = 3_600_000;
const running = new Set<string>();
const lastRun: Record<string, number> = {};

const TASKS: Record<string, { every: number; run: (force: boolean) => Promise<void> }> = {
	fred: { every: 3 * HOUR, run: () => refreshFred() },
	news: { every: 1 * HOUR, run: () => refreshNews(loadConfig()) },
	// Zillow publishes monthly; the check is a cheap HEAD unless something changed.
	zillow: { every: 12 * HOUR, run: (force) => refreshZillow(loadConfig(), force) },
	// Also kicked off right after a listing is added.
	geocode: { every: 6 * HOUR, run: () => refreshGeocode() }
};

export async function refresh(name: keyof typeof TASKS | 'all', force = false) {
	const names = name === 'all' ? Object.keys(TASKS) : [name];
	await Promise.all(
		names.map(async (n) => {
			if (running.has(n)) return;
			running.add(n);
			try {
				await TASKS[n].run(force);
			} finally {
				lastRun[n] = Date.now();
				running.delete(n);
			}
		})
	);
}

export function isRefreshing() {
	return [...running];
}

const g = globalThis as { __homebuyScheduler?: boolean };

export function startScheduler() {
	if (g.__homebuyScheduler || process.env.NO_REFRESH) return;
	g.__homebuyScheduler = true;
	const tick = () => {
		for (const [n, t] of Object.entries(TASKS)) {
			if (!running.has(n) && Date.now() - (lastRun[n] ?? 0) >= t.every) void refresh(n);
		}
	};
	setTimeout(tick, 3000);
	setInterval(tick, 5 * 60_000).unref();
}
