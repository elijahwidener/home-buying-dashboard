import { error, fail, redirect } from '@sveltejs/kit';
import type { HomeType } from '#lib/config.js';
import { analyze, rentCost } from '#lib/finance.js';
import { thirtyYear } from '#lib/breakdown.js';
import { all, get, loadConfig, run } from '#lib/server/db.js';
import { homeFromListing, listings, rates, zipMarket } from '#lib/server/live.js';
import { int, num, str } from '#lib/server/params.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const id = int(params.id);
	const l = Number.isInteger(id) ? listings(`l.id = ${id}`)[0] : undefined;
	if (!l) error(404, 'Listing not found');
	const cfg = loadConfig();
	const r = rates(cfg);
	const home = homeFromListing(cfg, l);
	const a = analyze(home, cfg, r.yours);
	const market = l.zip ? zipMarket(l.zip) : null;
	const rentMonthly = market?.rent?.value ?? null;
	const rent = rentMonthly ? { monthly: rentMonthly, ...rentCost(cfg, home.jurisdiction, rentMonthly) } : null;
	const prices = all<{ date: string; price: number }>('SELECT date, price FROM listing_prices WHERE listing_id = ? ORDER BY date', l.id);
	return { l, a, prices, rate: r.yours, market, jurisdictions: cfg.jurisdictions, cfg, thirty: thirtyYear(home, cfg, r.yours), rent };
};

export const actions: Actions = {
	save: async ({ request, params }) => {
		const f = await request.formData();
		const id = int(params.id);
		const price = num(f.get('price'));
		if (price == null) return fail(400, { error: 'Price is required.' });
		const old = get<{ price: number }>('SELECT price FROM listings WHERE id = ?', id);
		run(
			`UPDATE listings SET price = ?, hoa = ?, tax_annual = ?, beds = ?, baths = ?, home_type = ?, jurisdiction = ?, stage = ?,
				starred = ?, notes = ?, url = ?, updated_at = datetime('now') WHERE id = ?`,
			price, num(f.get('hoa')) ?? 0, num(f.get('tax_annual')), num(f.get('beds')), num(f.get('baths')),
			(str(f.get('home_type')) || 'house') as HomeType, str(f.get('jurisdiction')), str(f.get('stage')) || 'watching',
			f.get('starred') ? 1 : 0, str(f.get('notes')), str(f.get('url')), id
		);
		if (old && old.price !== price) {
			run('INSERT OR REPLACE INTO listing_prices (listing_id, date, price) VALUES (?, ?, ?)', id, new Date().toLocaleDateString('en-CA'), price);
		}
		return { saved: true };
	},
	delete: async ({ params }) => {
		run('DELETE FROM listings WHERE id = ?', int(params.id));
		redirect(303, '/listings');
	}
};
