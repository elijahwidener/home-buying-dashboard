import { fail } from '@sveltejs/kit';
import { AREA_TEMPLATE, type Area, type AreaStatus, type HomeType } from '#lib/config.js';
import { analyze, homeFromArea } from '#lib/finance.js';
import { addPlace, commuteProgress, grids, kickCommutes, places, removePlace } from '#lib/server/commute.js';
import { loadConfig, run, saveConfig } from '#lib/server/db.js';
import { mapAreas, mapListings, rates, setCompare } from '#lib/server/live.js';
import { plannerState } from '#lib/server/otp.js';
import { num, str } from '#lib/server/params.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const cfg = loadConfig();
	const r = rates(cfg);
	const map = mapAreas(cfg, r.yours);
	const rows = cfg.areas.map((x, i) => {
		const a = analyze(homeFromArea(x, cfg), cfg, r.yours);
		const at = (price: number) => analyze({ ...homeFromArea(x, cfg), price }, cfg, r.yours).monthly.total;
		return {
			...map[i],
			area: x,
			zip: x.zip,
			jurisdiction: cfg.jurisdictions[x.jurisdiction]?.name ?? x.jurisdiction,
			monthlyLow: at(x.priceLow),
			monthlyHigh: at(x.priceHigh),
			payShare: a.dti.loanIncome,
			cash: a.cash.total,
			effTaxPct: (a.year1.propertyTax / a.price) * 100,
			planPrice: a.price
		};
	});
	const ps = places();
	const planner = plannerState();
	return {
		rows,
		primaryId: cfg.areas.find((a) => a.enabled)?.id ?? null,
		listings: mapListings(cfg, r.yours),
		rate: r.yours,
		loanPay: cfg.profile.people.filter((p) => p.countForLoan).reduce((s, p) => s + p.salary, 0),
		places: ps,
		place: ps.find((p) => p.id === cfg.commute.placeId) ?? ps[0] ?? null,
		grids: grids(cfg.commute.placeId),
		commute: cfg.commute,
		progress: commuteProgress(),
		planner: { built: planner.built, building: planner.building, serviceDate: planner.serviceDate },
		jurisdictions: Object.entries(cfg.jurisdictions).map(([id, j]) => ({ id, name: j.name }))
	};
};

const STATUSES: AreaStatus[] = ['finalist', 'close'];
const TYPES: HomeType[] = ['house', 'townhouse', 'condo'];

function slug(s: string) {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'area';
}

export const actions: Actions = {
	/** Set which areas are Compare columns (comma list of ids). Also posted from the Compare page. */
	compare: async ({ request }) => {
		const f = await request.formData();
		const cfg = loadConfig();
		setCompare(cfg, str(f.get('ids')).split(',').filter(Boolean));
		saveConfig(cfg);
		return { saved: true };
	},

	/** Pick which saved place the commute columns and bands use. */
	place: async ({ request }) => {
		const f = await request.formData();
		const id = num(f.get('id'));
		if (id == null || !places().some((p) => p.id === id)) return fail(400, { error: 'Unknown place.' });
		const cfg = loadConfig();
		cfg.commute.placeId = id;
		saveConfig(cfg);
		kickCommutes();
		return { saved: true };
	},

	addPlace: async ({ request }) => {
		const f = await request.formData();
		const name = str(f.get('name'));
		const lat = num(f.get('lat'));
		const lng = num(f.get('lng'));
		if (!name || lat == null || lng == null) return fail(400, { error: 'Give the place a name and a spot on the map.' });
		const cfg = loadConfig();
		cfg.commute.placeId = addPlace(name, lat, lng);
		saveConfig(cfg);
		kickCommutes();
		return { saved: true };
	},

	removePlace: async ({ request }) => {
		const f = await request.formData();
		const id = num(f.get('id'));
		const ps = places();
		if (id == null || ps.length <= 1) return fail(400, { error: 'Keep at least one place.' });
		removePlace(id);
		const cfg = loadConfig();
		if (cfg.commute.placeId === id) {
			cfg.commute.placeId = ps.find((p) => p.id !== id)!.id;
			saveConfig(cfg);
		}
		return { saved: true };
	},

	/** Create or update an area from the details panel (JSON of Area fields). */
	saveArea: async ({ request }) => {
		const f = await request.formData();
		let body: Partial<Area>;
		try {
			body = JSON.parse(str(f.get('json')));
		} catch {
			return fail(400, { error: 'Bad data.' });
		}
		const cfg = loadConfig();
		const existing = body.id ? cfg.areas.find((a) => a.id === body.id) : undefined;
		const a: Area = { ...AREA_TEMPLATE, ...existing };
		// Only known fields, with their types.
		for (const [k, v] of Object.entries(body)) {
			if (k === 'id' || !(k in AREA_TEMPLATE)) continue;
			const cur = (AREA_TEMPLATE as unknown as Record<string, unknown>)[k];
			if (typeof cur === 'string' && typeof v === 'string') (a as unknown as Record<string, unknown>)[k] = v.trim();
			else if ((typeof cur === 'number' || cur === null) && (v === null || (typeof v === 'number' && Number.isFinite(v))))
				(a as unknown as Record<string, unknown>)[k] = v;
			else if (typeof cur === 'boolean' && typeof v === 'boolean') (a as unknown as Record<string, unknown>)[k] = v;
		}
		if (!a.name) return fail(400, { error: 'Name is required.' });
		if (!STATUSES.includes(a.status) || !TYPES.includes(a.homeType)) return fail(400, { error: 'Bad status or home type.' });
		if (!cfg.jurisdictions[a.jurisdiction]) return fail(400, { error: `Unknown tax area "${a.jurisdiction}".` });
		if (!(a.price > 0)) return fail(400, { error: 'Typical price is required.' });
		if (!a.priceLow) a.priceLow = a.price;
		if (!a.priceHigh) a.priceHigh = a.price;
		if (existing) Object.assign(existing, a);
		else {
			let id = slug(a.name);
			while (cfg.areas.some((x) => x.id === id)) id = `${slug(a.name).slice(0, 20)}-${Math.floor(Math.random() * 1000)}`;
			cfg.areas.push({ ...a, id });
		}
		saveConfig(cfg);
		kickCommutes();
		return { saved: true };
	},

	saveNotes: async ({ request }) => {
		const f = await request.formData();
		const cfg = loadConfig();
		const a = cfg.areas.find((x) => x.id === str(f.get('id')));
		if (!a) return fail(404, { error: 'Unknown area.' });
		a.notes = String(f.get('notes') ?? '');
		saveConfig(cfg);
		return { saved: true };
	},

	removeArea: async ({ request }) => {
		const f = await request.formData();
		const cfg = loadConfig();
		const id = str(f.get('id'));
		cfg.areas = cfg.areas.filter((a) => a.id !== id);
		saveConfig(cfg);
		run('DELETE FROM commute_times WHERE area_id = ?', id);
		return { removed: id };
	},

	/** First area on Compare sets the savings goal. */
	primary: async ({ request }) => {
		const f = await request.formData();
		const cfg = loadConfig();
		const i = cfg.areas.findIndex((a) => a.id === str(f.get('id')));
		if (i < 0) return fail(404, { error: 'Unknown area.' });
		const [a] = cfg.areas.splice(i, 1);
		a.enabled = true;
		cfg.areas.unshift(a);
		saveConfig(cfg);
		return { saved: true };
	}
};
