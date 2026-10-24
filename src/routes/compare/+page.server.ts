import { fail } from '@sveltejs/kit';
import { loadConfig, saveConfig } from '#lib/server/db.js';
import { rates, zipMarket } from '#lib/server/live.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const cfg = loadConfig();
	const r = rates(cfg);
	const markets = Object.fromEntries(cfg.areas.map((a) => [a.zip, zipMarket(a.zip)]));
	return { cfg, rates: r, markets };
};

export const actions: Actions = {
	/** Keep the down payment and family help tried on this page (prices here are what-ifs; edit areas on the Areas page). */
	save: async ({ request }) => {
		const f = await request.formData();
		let body: { downPct: number; family: ReturnType<typeof loadConfig>['family'] };
		try {
			body = JSON.parse(String(f.get('json')));
		} catch {
			return fail(400, { error: 'Bad data' });
		}
		const cfg = loadConfig();
		if (Number.isFinite(body.downPct)) cfg.loan.downPct = body.downPct;
		if (body.family && ['none', 'gift', 'loan'].includes(body.family.mode)) cfg.family = { ...cfg.family, ...body.family };
		saveConfig(cfg);
		return { saved: true };
	}
};
