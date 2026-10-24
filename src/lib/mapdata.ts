// What the map needs about each area and listing; built on the server, drawn in the browser.
import { crimeOf, type AreaStatus, type Config } from './config.ts';
import type { Analysis } from './finance.ts';

/** Ways to get to work: transit (walk + bus/rail), drive to a station and ride, drive the whole way. */
export type Mode = 'transit' | 'parkride' | 'drive';
export const MODES: Mode[] = ['transit', 'parkride', 'drive'];
export const MODE_LABEL: Record<Mode, string> = { transit: 'Transit', parkride: 'Park & ride', drive: 'Drive' };

export type Commute = Partial<Record<Mode, number | null>>;

/** Fastest mode with a route, if any. */
export function bestCommute(c: Commute): { mode: Mode; min: number } | null {
	let best: { mode: Mode; min: number } | null = null;
	for (const m of MODES) {
		const v = c[m];
		if (v != null && (!best || v < best.min)) best = { mode: m, min: v };
	}
	return best;
}

export interface MapArea {
	id: string;
	name: string;
	status: AreaStatus;
	state: string;
	homeType: string;
	lat: number;
	lng: number;
	enabled: boolean;
	/** Planning price (what costs use); typical is the raw typical sale price. */
	price: number;
	typical: number;
	priceLow: number;
	priceHigh: number;
	monthly: number;
	allIn: number;
	five: number;
	crime: number | null;
	/** Which year the crime figure is from. */
	crimeYear: string;
	countyCrime: number | null;
	metroLine: string;
	/** Computed door-to-door minutes to the selected commute place. */
	commute: Commute;
}

export interface MapListing {
	id: number;
	address: string;
	lat: number;
	lng: number;
	stage: string;
	price: number;
	monthly: number;
}

export interface MapPlace {
	id: number;
	name: string;
	lat: number;
	lng: number;
}

export function toMapArea(cfg: Config, x: Config['areas'][number], a: Analysis, commute: Commute = {}): MapArea {
	const j = cfg.jurisdictions[x.jurisdiction];
	const crime = crimeOf(x);
	const in2026 = x.crime2026 != null;
	return {
		id: x.id, name: x.name, status: x.status, state: x.jurisdiction === 'pg' ? 'PG' : (j?.state.toUpperCase() ?? ''), homeType: x.homeType,
		lat: x.lat, lng: x.lng, enabled: x.enabled, price: a.price, typical: x.price, priceLow: x.priceLow, priceHigh: x.priceHigh,
		monthly: a.monthly.total, allIn: a.year1.allIn, five: a.fiveYear.total,
		crime, crimeYear: crime == null ? '' : in2026 ? '2026' : '2024–25', countyCrime: (in2026 ? j?.crimeAvg2026 : j?.crimeAvg) ?? null,
		metroLine: x.metroLine, commute
	};
}

/** Commute grid for the map's bands (see lib/server/commute.ts). */
export interface BandGrid {
	mode: Mode;
	south: number;
	west: number;
	north: number;
	east: number;
	rows: number;
	cols: number;
	data: (number | null)[];
}
