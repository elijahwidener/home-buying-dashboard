// Read-side helpers that combine settings with the latest live data.
import type { Config } from '#lib/config.js';
import { analyze, homeFromArea, liveRate, type HomeInput } from '#lib/finance.js';
import { toMapArea, type MapArea, type MapListing } from '#lib/mapdata.js';
import { areaTimes } from '#lib/server/commute.js';
import { all, get, latest, series, valueAt, type Point } from '#lib/server/db.js';
import { zillowId } from '#lib/server/sources/zillow.js';

export interface RateInfo {
	avg30: Point | null;
	prev30: Point | null;
	avg15: Point | null;
	t10: Point | null;
	fed: Point | null;
	cpiYoY: number | null;
	low52: number | null;
	high52: number | null;
	yearAgo30: Point | null;
	yours: number;
}

const daysBack = (date: string, days: number) => {
	const d = new Date(date + 'T12:00:00');
	d.setDate(d.getDate() - days);
	return d.toLocaleDateString('en-CA');
};

export function rates(cfg: Config): RateInfo {
	const avg30 = latest('fred:MORTGAGE30US') ?? null;
	const prev30 = avg30 ? (get<Point>("SELECT date, value FROM series WHERE series_id = 'fred:MORTGAGE30US' AND date < ? ORDER BY date DESC LIMIT 1", avg30.date) ?? null) : null;
	const year = avg30 ? series('fred:MORTGAGE30US', daysBack(avg30.date, 365)).map((p) => p.value) : [];
	const cpi = latest('fred:CPIAUCSL');
	const cpiPrev = cpi ? valueAt('fred:CPIAUCSL', daysBack(cpi.date, 365)) : undefined;
	return {
		avg30,
		prev30,
		avg15: latest('fred:MORTGAGE15US') ?? null,
		t10: latest('fred:DGS10') ?? null,
		fed: latest('fred:DFEDTARU') ?? null,
		cpiYoY: cpi && cpiPrev ? (cpi.value / cpiPrev.value - 1) * 100 : null,
		low52: year.length ? Math.min(...year) : null,
		high52: year.length ? Math.max(...year) : null,
		yearAgo30: avg30 ? (valueAt('fred:MORTGAGE30US', daysBack(avg30.date, 365)) ?? null) : null,
		yours: liveRate(cfg, avg30?.value ?? null)
	};
}

export interface ZipMarket {
	zip: string;
	value: Point | null;
	valueYoY: number | null;
	value2bd: Point | null;
	value2bdYoY: number | null;
	sfr: Point | null;
	condo: Point | null;
	rent: Point | null;
	rentYoY: number | null;
	forecast12: number | null;
	forecastDate: string | null;
}

function withYoY(id: string): [Point | null, number | null] {
	const now = latest(id);
	if (!now) return [null, null];
	const then = valueAt(id, daysBack(now.date, 360));
	return [now, then && then.date < now.date ? (now.value / then.value - 1) * 100 : null];
}

export function zipMarket(zip: string): ZipMarket {
	const [value, valueYoY] = withYoY(zillowId('zhvi_all', zip));
	const [value2bd, value2bdYoY] = withYoY(zillowId('zhvi_2bd', zip));
	const [rent, rentYoY] = withYoY(zillowId('zori', zip));
	const fc = latest(zillowId('zhvf', zip));
	return {
		zip, value, valueYoY, value2bd, value2bdYoY, rent, rentYoY,
		sfr: latest(zillowId('zhvi_sfr', zip)) ?? null,
		condo: latest(zillowId('zhvi_condo', zip)) ?? null,
		forecast12: fc?.value ?? null,
		forecastDate: fc?.date ?? null
	};
}

export function metroMarket() {
	const m = (key: string) => withYoY(zillowId(key, 'metro'));
	const [inventory, inventoryYoY] = m('invt');
	const [daysToPending, daysYoY] = m('doz');
	const [priceCuts] = m('cuts');
	const cutsYearAgo = priceCuts ? valueAt(zillowId('cuts', 'metro'), daysBack(priceCuts.date, 360)) : undefined;
	const [listPrice, listPriceYoY] = m('mlp');
	return {
		inventory, inventoryYoY, daysToPending, daysYoY, priceCuts,
		priceCutsYearAgo: cutsYearAgo?.value ?? null, listPrice, listPriceYoY
	};
}

export function areaAnalyses(cfg: Config, rate: number) {
	return cfg.areas
		.filter((a) => a.enabled)
		.map((a) => ({ area: a, a: analyze(homeFromArea(a, cfg), cfg, rate), market: zipMarket(a.zip) }));
}

export interface ListingRow {
	id: number;
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
	home_type: 'house' | 'townhouse' | 'condo';
	year_built: number | null;
	dom: number | null;
	status: string;
	jurisdiction: string;
	stage: string;
	starred: number;
	notes: string;
	source: string;
	first_seen: string;
	updated_at: string;
	lat: number | null;
	lng: number | null;
	geo_status: string;
	first_price: number | null;
	last_change: string | null;
}

export function listings(where = '1=1'): ListingRow[] {
	return all<ListingRow>(
		`SELECT l.*,
			(SELECT price FROM listing_prices p WHERE p.listing_id = l.id ORDER BY date LIMIT 1) AS first_price,
			(SELECT MAX(date) FROM listing_prices p WHERE p.listing_id = l.id) AS last_change
		 FROM listings l WHERE ${where}
		 ORDER BY l.starred DESC, CASE l.stage WHEN 'offer' THEN 0 WHEN 'toured' THEN 1 WHEN 'watching' THEN 2 ELSE 3 END, l.updated_at DESC`
	);
}

/** Defaults for things a listing doesn't say (insurance, upkeep, growth), by home type. */
export function homeFromListing(cfg: Config, l: ListingRow): HomeInput {
	const area = cfg.areas.find((a) => a.zip === l.zip && a.homeType === l.home_type) ?? cfg.areas.find((a) => a.homeType === l.home_type);
	const byType = { house: [1800, 1, 2.5], townhouse: [1200, 0.75, 2], condo: [500, 0.5, 1] }[l.home_type] ?? [1500, 1, 2];
	return {
		price: l.price,
		jurisdiction: l.jurisdiction,
		homeType: l.home_type,
		hoaMonthly: l.hoa,
		extraPropRatePct: area?.zip === l.zip ? area.extraPropRatePct : 0,
		extraAnnualFees: area?.zip === l.zip ? area.extraAnnualFees : 0,
		insuranceAnnual: area?.insuranceAnnual ?? byType[0],
		maintenancePct: area?.maintenancePct ?? byType[1],
		appreciationPct: area?.appreciationPct ?? byType[2],
		taxAnnualOverride: l.tax_annual
	};
}

/** Every area (shown on Compare or not), with its costs and commute to the selected place, for the map and the Areas table. */
export function mapAreas(cfg: Config, rate: number): MapArea[] {
	const times = areaTimes(cfg.commute.placeId);
	return cfg.areas.map((x) => toMapArea(cfg, x, analyze(homeFromArea(x, cfg), cfg, rate), times[x.id] ?? {}));
}

/** Active listings that have a map point. */
export function mapListings(cfg: Config, rate: number): MapListing[] {
	return listings("l.stage != 'passed' AND l.status NOT LIKE 'Sold%' AND l.lat IS NOT NULL").map((l) => ({
		id: l.id, address: l.address, lat: l.lat!, lng: l.lng!, stage: l.stage, price: l.price,
		monthly: analyze(homeFromListing(cfg, l), cfg, rate).monthly.total
	}));
}

/** Which areas are Compare columns. */
export function setCompare(cfg: Config, ids: string[]) {
	const on = new Set(ids);
	for (const a of cfg.areas) a.enabled = on.has(a.id);
}

export function recentNews(limit = 12, feed?: string) {
	return all<{ link: string; feed: string; title: string; source: string; published: string }>(
		`SELECT link, feed, title, source, published FROM news ${feed ? 'WHERE feed = ?' : ''} ORDER BY published DESC LIMIT ?`,
		...(feed ? [feed, limit] : [limit])
	);
}

export function sourceHealth() {
	return all<{ key: string; label: string; status: string; message: string; checked_at: string | null; updated_at: string | null }>(
		'SELECT key, label, status, message, checked_at, updated_at FROM sources ORDER BY key'
	);
}
