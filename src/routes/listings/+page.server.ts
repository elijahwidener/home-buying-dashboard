import { fail } from '@sveltejs/kit';
import { jurisdictionForZip, type HomeType } from '#lib/config.js';
import { analyze } from '#lib/finance.js';
import { thirtyYear } from '#lib/breakdown.js';
import { loadConfig } from '#lib/server/db.js';
import { importCsv, upsertListing } from '#lib/server/listings.js';
import { refresh } from '#lib/server/refresh.js';
import { homeFromListing, listings, rates } from '#lib/server/live.js';
import { num, str } from '#lib/server/params.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const cfg = loadConfig();
	const r = rates(cfg);
	const view = url.searchParams.get('view') ?? 'active';
	const where =
		view === 'passed' ? "l.stage = 'passed' OR l.status LIKE 'Sold%'" : view === 'all' ? '1=1' : "l.stage != 'passed' AND l.status NOT LIKE 'Sold%'";
	const areaName = (zip: string) => cfg.areas.find((a) => a.zip === zip)?.name ?? '';
	const rows = listings(where).map((l) => {
		const home = homeFromListing(cfg, l);
		const a = analyze(home, cfg, r.yours);
		return { ...l, area: areaName(l.zip), monthly: a.monthly.total, allIn: a.year1.allIn, five: a.fiveYear.total, thirty: thirtyYear(home, cfg, r.yours).total, cash: a.cash.total };
	});
	return { rows, view, rate: r.yours, jurisdictions: cfg.jurisdictions };
};

export const actions: Actions = {
	add: async ({ request }) => {
		const f = await request.formData();
		const address = str(f.get('address'));
		const price = num(f.get('price'));
		if (!address || price == null) return fail(400, { error: 'Address and price are required.' });
		const cfg = loadConfig();
		const zip = str(f.get('zip')).slice(0, 5);
		const state = str(f.get('state')).toUpperCase();
		const { id } = upsertListing({
			address, city: str(f.get('city')), state, zip, url: str(f.get('url')), mls: '', price,
			beds: num(f.get('beds')), baths: num(f.get('baths')), sqft: num(f.get('sqft')), hoa: num(f.get('hoa')) ?? 0,
			tax_annual: num(f.get('tax_annual')), property_type: '', home_type: (str(f.get('home_type')) || 'house') as HomeType,
			year_built: num(f.get('year_built')), dom: null, status: 'Active',
			jurisdiction: str(f.get('jurisdiction')) || jurisdictionForZip(cfg, zip, state), source: 'manual'
		});
		void refresh('geocode');
		return { added: id };
	},
	import: async ({ request }) => {
		const f = await request.formData();
		const file = f.get('file');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Choose a CSV file.' });
		try {
			const imported = importCsv(loadConfig(), await file.text());
			void refresh('geocode');
			return { imported };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Import failed.' });
		}
	}
};
