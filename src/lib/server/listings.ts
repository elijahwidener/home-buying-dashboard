import { jurisdictionForZip, type Config, type HomeType } from '#lib/config.js';
import { get, run, tx } from '#lib/server/db.js';
import { csvParse } from '#lib/server/sources/common.js';

export interface ListingInput {
	address: string;
	city: string;
	state: string;
	zip: string;
	url: string;
	mls: string;
	price: number;
	beds: number | null;
	baths: number | null;
	sqft: number | null;
	hoa: number;
	tax_annual: number | null;
	property_type: string;
	home_type: HomeType;
	year_built: number | null;
	dom: number | null;
	status: string;
	jurisdiction: string;
	source: string;
	lat?: number | null;
	lng?: number | null;
}

export function homeTypeFrom(propertyType: string): HomeType {
	const t = propertyType.toLowerCase();
	if (t.includes('condo') || t.includes('co-op')) return 'condo';
	if (t.includes('town')) return 'townhouse';
	return 'house';
}

const today = () => new Date().toLocaleDateString('en-CA');

/** Insert or update by URL (or address + zip), recording price changes. Returns 'new' | 'changed' | 'same'. */
export function upsertListing(l: ListingInput): { id: number; result: 'new' | 'changed' | 'same' } {
	const existing =
		(l.url ? get<{ id: number; price: number }>('SELECT id, price FROM listings WHERE url = ?', l.url) : undefined) ??
		get<{ id: number; price: number }>('SELECT id, price FROM listings WHERE lower(address) = lower(?) AND zip = ?', l.address, l.zip);

	if (!existing) {
		const id = Number(
			run(
				`INSERT INTO listings (address, city, state, zip, url, mls, price, beds, baths, sqft, hoa, tax_annual, property_type, home_type,
					year_built, dom, status, jurisdiction, source, lat, lng, geo_status)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				l.address, l.city, l.state, l.zip, l.url, l.mls, l.price, l.beds, l.baths, l.sqft, l.hoa, l.tax_annual, l.property_type,
				l.home_type, l.year_built, l.dom, l.status, l.jurisdiction, l.source, l.lat ?? null, l.lng ?? null, l.lat != null ? 'ok' : ''
			).lastInsertRowid
		);
		run('INSERT OR REPLACE INTO listing_prices (listing_id, date, price) VALUES (?, ?, ?)', id, today(), l.price);
		return { id, result: 'new' };
	}

	// Imports refresh market facts but never overwrite your stage, notes, star or jurisdiction choice.
	run(
		`UPDATE listings SET price = ?, beds = COALESCE(?, beds), baths = COALESCE(?, baths), sqft = COALESCE(?, sqft), hoa = ?,
			dom = COALESCE(?, dom), status = ?, url = CASE WHEN url = '' THEN ? ELSE url END, mls = CASE WHEN mls = '' THEN ? ELSE mls END,
			year_built = COALESCE(?, year_built), lat = COALESCE(?, lat), lng = COALESCE(?, lng),
			geo_status = CASE WHEN ? IS NOT NULL THEN 'ok' ELSE geo_status END, updated_at = datetime('now')
		 WHERE id = ?`,
		l.price, l.beds, l.baths, l.sqft, l.hoa, l.dom, l.status, l.url, l.mls, l.year_built, l.lat ?? null, l.lng ?? null, l.lat ?? null, existing.id
	);
	if (existing.price !== l.price) {
		run('INSERT OR REPLACE INTO listing_prices (listing_id, date, price) VALUES (?, ?, ?)', existing.id, today(), l.price);
		return { id: existing.id, result: 'changed' };
	}
	return { id: existing.id, result: 'same' };
}

const numOrNull = (v: string | undefined) => {
	if (v == null || v.trim() === '') return null;
	const n = Number(v.replace(/[$,\s]/g, ''));
	return Number.isFinite(n) ? n : null;
};

/** Import Redfin's "Download All" CSV (other sites work if their headers are similar). */
export function importCsv(cfg: Config, text: string) {
	const rows = csvParse(text.replace(/^﻿/, ''));
	if (rows.length < 2) throw new Error('The file has no rows.');
	const header = rows[0].map((h) => h.trim().toUpperCase());
	const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
	const c = {
		address: col('ADDRESS'), city: col('CITY'), state: col('STATE OR PROVINCE', 'STATE'), zip: col('ZIP OR POSTAL CODE', 'ZIP'),
		price: col('PRICE'), beds: col('BEDS'), baths: col('BATHS'), sqft: col('SQUARE FEET'), hoa: col('HOA/MONTH', 'HOA'),
		type: col('PROPERTY TYPE'), year: col('YEAR BUILT'), dom: col('DAYS ON MARKET'), status: col('STATUS'), url: col('URL'),
		mls: col('MLS#', 'MLS'), saleType: col('SALE TYPE'), lat: col('LATITUDE'), lng: col('LONGITUDE')
	};
	if (c.address < 0 || c.price < 0) throw new Error('Could not find ADDRESS and PRICE columns. Is this a Redfin export?');

	const counts = { new: 0, changed: 0, same: 0, skipped: 0 };
	tx(() => {
		for (const r of rows.slice(1)) {
			const at = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
			const price = numOrNull(at(c.price));
			const address = at(c.address);
			// Redfin puts a disclaimer row at the end and includes past sales when asked; keep only listings for sale.
			if (!address || price == null || /^past sale/i.test(at(c.saleType))) {
				counts.skipped++;
				continue;
			}
			const zip = at(c.zip).slice(0, 5);
			const state = at(c.state);
			const propertyType = at(c.type);
			const { result } = upsertListing({
				address, city: at(c.city), state, zip, url: at(c.url), mls: at(c.mls), price,
				beds: numOrNull(at(c.beds)), baths: numOrNull(at(c.baths)), sqft: numOrNull(at(c.sqft)), hoa: numOrNull(at(c.hoa)) ?? 0,
				tax_annual: null, property_type: propertyType, home_type: homeTypeFrom(propertyType),
				year_built: numOrNull(at(c.year)), dom: numOrNull(at(c.dom)), status: at(c.status) || 'Active',
				jurisdiction: jurisdictionForZip(cfg, zip, state), source: 'csv', lat: numOrNull(at(c.lat)), lng: numOrNull(at(c.lng))
			});
			counts[result]++;
		}
	});
	return counts;
}
