// Types and default assumptions. Everything here is editable on the Settings page;
// saved values are merged over these defaults, so new defaults appear automatically.

export type Filing = 'single' | 'mfj';
/** [upper bound of the bracket (null = no limit), marginal rate as a decimal] */
export type Bracket = [number | null, number];
export type HomeType = 'house' | 'townhouse' | 'condo';
export type StateId = 'md' | 'dc' | 'va';
/** Finalist or close call from the area research (areas ruled out aren't kept). */
export type AreaStatus = 'finalist' | 'close';

export interface Person {
	name: string;
	salary: number;
	/** Traditional (pre-tax) TSP/401k contribution, % of salary. */
	pretaxPct: number;
	/** Count this income when qualifying for the mortgage. */
	countForLoan: boolean;
}

export interface Area {
	id: string;
	name: string;
	zip: string;
	jurisdiction: string;
	homeType: HomeType;
	beds: number;
	status: AreaStatus;
	/** Typical price for this home type: what every cost is computed on. */
	price: number;
	/** Range for a 3-bed of this type, from recent sales. */
	priceLow: number;
	priceHigh: number;
	hoaMonthly: number;
	/** Extra property-tax rate on top of the jurisdiction's, % of value (e.g. Reston Small District 5). */
	extraPropRatePct: number;
	/** Fees billed yearly that aren't in the HOA (e.g. Reston Association dues). */
	extraAnnualFees: number;
	insuranceAnnual: number;
	/** Upkeep per year, % of price. */
	maintenancePct: number;
	/** Assumed yearly appreciation for the 5-year view, %. */
	appreciationPct: number;
	station: string;
	/** Metro line(s) and how you'd reach them. */
	metroLine: string;
	/** Scheduled rush-hour ride from the nearest station to Metro Center, minutes. */
	rideMin: number | null;
	/** Door-to-door to work at rush hour, minutes (your own estimate). */
	commuteMin: number;
	/** Violent crimes per 1,000 residents per year, 2024–25. */
	crime: number | null;
	/** Same, Jan–Sep 2026 scaled to a full year. */
	crime2026: number | null;
	/** Rough center of the area, for the map. */
	lat: number;
	lng: number;
	notes: string;
	/** Shown as a column on Compare and in the Overview ranking. */
	enabled: boolean;
}

export interface Jurisdiction {
	name: string;
	state: StateId;
	/** All-in property-tax rate, % of assessed value. */
	propertyRatePct: number;
	/** Amount subtracted from the assessment for owner-occupants (DC homestead deduction). */
	homesteadDeduction: number;
	/** Flat yearly charges on the tax bill (solid waste, stormwater...). */
	propertyFixedAnnual: number;
	/** County income tax, applied to state taxable income (Maryland counties). */
	localIncome: Bracket[] | null;
	/** Yearly personal-property tax on cars (Virginia). */
	carTax: { ratePer100: number; reliefPct: number; reliefCap: number } | null;
	/** Buyer's share of transfer/recordation taxes, % of price. */
	buyerTransferPct: number;
	/** Zip prefixes that map imported listings to this jurisdiction. */
	zipPrefixes: string[];
	/** Violent crimes per 1,000 residents per year, county/city-wide, 2024–25 and 2026 (null = no comparable figure). */
	crimeAvg: number | null;
	crimeAvg2026: number | null;
	note: string;
}

export interface StateTax {
	name: string;
	brackets: Record<Filing, Bracket[]>;
	/** 'federal' = same as the federal standard deduction (DC). */
	stdDeduction: Record<Filing, number> | 'federal';
	/** Personal exemption per person; optional phase-out table of [AGI up to, amount]. */
	exemption: { perPerson: number; phaseout: Record<Filing, Bracket[]> | null };
	itemize: {
		/** Itemizing on the state return is only allowed when itemizing federally (MD, VA). */
		requiresFederal: boolean;
		/** Itemized deductions shrink by this share of AGI above the start. */
		phaseoutRate: number;
		phaseoutStart: Record<Filing, number>;
	};
	note: string;
}

export interface FederalTax {
	brackets: Record<Filing, Bracket[]>;
	stdDeduction: Record<Filing, number>;
	saltCap: number;
	saltPhaseStart: number;
	saltFloor: number;
	mortgageDebtLimit: number;
}

export interface Config {
	/** Bump when saved settings need a one-time migration (do it in loadConfig in db.ts). */
	version: number;
	taxYear: number;
	reviewed: string;
	profile: {
		people: Person[];
		filing: Filing;
		/** Starting balance, used until you log one on the Plan page. */
		savings: number;
		monthlySavings: number;
		/** Target closing month, YYYY-MM. */
		targetClose: string;
		reserveMonths: number;
		/** Value of each car (Virginia car tax). */
		cars: number[];
		/** Where you live now (used for the "tax with no home" baseline). */
		currentJurisdiction: string;
	};
	loan: {
		rateMode: 'live' | 'fixed';
		/** Added to the latest Freddie Mac 30-yr average in live mode (your quote minus the average). */
		spread: number;
		fixedRate: number;
		downPct: number;
		termYears: number;
		/** Yearly PMI, % of the loan, when down payment is under 20%. */
		pmiPct: number;
		/** Lender, title, prepaids, % of price (transfer taxes are separate, per jurisdiction). */
		otherClosingPct: number;
		sellCostPct: number;
		/** What the down payment would earn otherwise (5-yr opportunity cost), %. */
		investReturnPct: number;
		/** Rent growth per year for the buy-vs-rent view, %. */
		rentGrowthPct: number;
		/** Highlight when the 30-yr average drops to or below this. */
		alertRate: number;
		/**
		 * Areas: costs use the typical price moved this % of the way toward the low end of the range.
		 * Typical sale prices mix fixer-uppers with renovated homes; a wide range skews them up.
		 */
		priceLeanPct: number;
	};
	family: {
		mode: 'none' | 'gift' | 'loan';
		amount: number;
		/** At least the IRS Applicable Federal Rate (long-term) for the month the loan is made. */
		ratePct: number;
		termYears: number;
	};
	areas: Area[];
	jurisdictions: Record<string, Jurisdiction>;
	states: Record<StateId, StateTax>;
	federal: FederalTax;
	feeds: { name: string; url: string }[];
	/** Zips tracked on the Market page besides the area zips. */
	extraZips: string[];
	commute: {
		/** Saved location (commute_places row) the commute columns and map bands use. */
		placeId: number;
		/** Arrive at work by this time on a weekday, HH:MM. */
		arriveBy: string;
		/** The trip planner drives at free-flow speeds; car time is multiplied by this for rush hour. */
		rushFactor: number;
	};
	keyDates: { date: string; label: string }[];
}

const gnews = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

/** Defaults by home type. */
export const TYPE_DEFAULTS: Record<HomeType, { insuranceAnnual: number; maintenancePct: number; appreciationPct: number; hoaMonthly: number }> = {
	house: { insuranceAnnual: 1800, maintenancePct: 1, appreciationPct: 2.5, hoaMonthly: 0 },
	townhouse: { insuranceAnnual: 1200, maintenancePct: 0.75, appreciationPct: 2, hoaMonthly: 100 },
	condo: { insuranceAnnual: 600, maintenancePct: 0.5, appreciationPct: 2, hoaMonthly: 350 }
};

function area(
	id: string, name: string, zip: string, jurisdiction: string, homeType: HomeType, status: AreaStatus,
	[priceLow, priceHigh, price]: [number, number, number], metroLine: string, station: string, rideMin: number | null, commuteMin: number,
	[crime, crime2026]: [number | null, number | null], [lat, lng]: [number, number], notes: string, extra: Partial<Area> = {}
): Area {
	return {
		id, name, zip, jurisdiction, homeType, beds: 3, status, price, priceLow, priceHigh, extraPropRatePct: 0, extraAnnualFees: 0,
		...TYPE_DEFAULTS[homeType], station, metroLine, rideMin, commuteMin, crime, crime2026, lat, lng, notes,
		enabled: status === 'finalist', ...extra
	};
}

/** Fills in fields an older saved area doesn't have, and seeds new areas from Settings. */
export const AREA_TEMPLATE: Area = area('new', 'New area', '', 'moco', 'house', 'close', [0, 0, 450000], '', '', null, 45, [null, null], [39.0, -77.03], '');

/** The price costs are computed on: typical, leaned toward the low end of the range (see loan.priceLeanPct). */
export function planningPrice(a: Pick<Area, 'price' | 'priceLow'>, leanPct: number): number {
	if (!(a.priceLow > 0) || a.priceLow >= a.price) return a.price;
	return Math.round((a.price - (a.price - a.priceLow) * (leanPct / 100)) / 1000) * 1000;
}

/** Crime figure to rank by: 2026 when there is one, else 2024–25. */
export const crimeOf = (a: Pick<Area, 'crime' | 'crime2026'>) => a.crime2026 ?? a.crime;

export const DEFAULT_CONFIG: Config = {
	version: 1,
	taxYear: 2026,
	reviewed: '2026-10-18',
	profile: {
		people: [
			{ name: 'Buyer 1', salary: 110000, pretaxPct: 6, countForLoan: true },
			{ name: 'Buyer 2', salary: 75000, pretaxPct: 5, countForLoan: true }
		],
		filing: 'mfj',
		savings: 60000,
		monthlySavings: 3000,
		targetClose: '2027-09',
		reserveMonths: 6,
		cars: [15000],
		currentJurisdiction: 'dc'
	},
	loan: {
		rateMode: 'live',
		spread: 0,
		fixedRate: 7.3,
		downPct: 20,
		termYears: 30,
		pmiPct: 0.5,
		otherClosingPct: 2,
		sellCostPct: 6,
		investReturnPct: 4,
		rentGrowthPct: 3,
		alertRate: 6.75,
		priceLeanPct: 25
	},
	family: { mode: 'none', amount: 100000, ratePct: 5.22, termYears: 30 },
	areas: [
		// Sample areas so the app has something to show. Prices, crime and commute figures are made up for the demo:
		// replace them with your own research (Areas page → click a row → Edit details, or Settings → Areas).
		// 3-bed sale prices are [low, high, typical]; crime is violent crimes per 1,000 residents [last year, this year].
		area('petworth', 'Petworth', '20011', 'dc', 'townhouse', 'finalist', [600000, 900000, 760000], 'Green / Yellow', 'Georgia Ave-Petworth', 16, 35, [4.1, 3.6], [38.9437, -77.0247], 'Sample: rowhouses close to the Metro.', { hoaMonthly: 0 }),
		area('brookland', 'Brookland', '20017', 'dc', 'house', 'finalist', [550000, 850000, 690000], 'Red', 'Brookland-CUA', 12, 35, [3.2, 2.8], [38.9333, -76.9945], 'Sample: detached houses with yards.'),
		area('silver-spring', 'Downtown Silver Spring', '20910', 'moco', 'condo', 'finalist', [280000, 420000, 350000], 'Red', 'Silver Spring', 19, 35, [2.4, 2.1], [38.994, -77.031], 'Sample: condos near the Metro.', { hoaMonthly: 420 }),
		area('rockville', 'Rockville (town center)', '20850', 'rockville', 'townhouse', 'finalist', [480000, 650000, 560000], 'Red', 'Rockville', 33, 55, [1.5, 1.4], [39.084, -77.146], 'Sample: the City of Rockville adds its own property tax.'),
		area('hyattsville', 'Hyattsville', '20782', 'pg', 'house', 'finalist', [400000, 600000, 480000], 'Green', 'Prince George\'s Plaza', 20, 40, [2.9, 2.6], [38.9559, -76.9455], 'Sample: the City of Hyattsville has a higher rate than unincorporated PG.'),
		area('ballston', 'Ballston', '22203', 'arlington', 'condo', 'finalist', [380000, 560000, 450000], 'Orange / Silver', 'Ballston-MU', 15, 35, [1.2, 1.1], [38.8821, -77.111], 'Sample: high-rise condos.', { hoaMonthly: 550 }),
		area('springfield', 'Springfield', '22150', 'fairfax', 'house', 'finalist', [550000, 780000, 650000], 'Blue', 'Franconia-Springfield', 35, 55, [1.0, 0.9], [38.7893, -77.1872], 'Sample: split-levels and ramblers.'),
		area('college-park', 'College Park', '20740', 'pg', 'house', 'close', [420000, 620000, 500000], 'Green', 'College Park-U of Md', 24, 45, [3.1, null], [38.9807, -76.9369], 'Sample: near the university.'),
		area('greenbelt', 'Greenbelt', '20770', 'pg', 'townhouse', 'close', [250000, 420000, 330000], 'Green', 'Greenbelt', 27, 50, [2.5, 2.3], [39.0046, -76.8755], 'Sample: co-op townhouses.'),
		area('reston', 'Reston', '20190', 'fairfax', 'townhouse', 'close', [520000, 720000, 600000], 'Silver', 'Reston Town Center', 45, 65, [0.8, 0.7], [38.9586, -77.357], 'Sample: Reston adds a small-district tax and association dues.', { extraPropRatePct: 0.021, extraAnnualFees: 800 })
	],
	jurisdictions: {
		dc: {
			name: 'Washington, DC', state: 'dc', propertyRatePct: 0.85, homesteadDeduction: 91950, propertyFixedAnnual: 0,
			localIncome: null, carTax: null, buyerTransferPct: 0.725, zipPrefixes: ['200', '203', '204', '205'], crimeAvg: 4.34, crimeAvg2026: 4.1,
			note: 'Recordation 0.725% is the first-time-buyer rate (homes up to ~$777k, income limits apply); otherwise 1.1–1.45%.'
		},
		moco: {
			name: 'Montgomery County, MD', state: 'md', propertyRatePct: 1.152, homesteadDeduction: 0, propertyFixedAnnual: 0,
			localIncome: [[null, 0.033]], carTax: null, buyerTransferPct: 0.5, zipPrefixes: ['208', '209'], crimeAvg: 1.67, crimeAvg2026: 1.31,
			note: 'County ~$1.04/$100 + state $0.112/$100. Add solid-waste/water-quality charges from a real tax bill to fixed charges. County income tax 3.3% from 2027 for higher earners. Towns like Rockville add their own property tax. Transfer/recordation split is negotiable; first-time buyers get a reduced state transfer tax.'
		},
		rockville: {
			name: 'Rockville (city), MD', state: 'md', propertyRatePct: 1.33, homesteadDeduction: 0, propertyFixedAnnual: 0,
			localIncome: [[null, 0.033]], carTax: null, buyerTransferPct: 0.5, zipPrefixes: ['20850', '20851', '20852'], crimeAvg: 1.67, crimeAvg2026: 1.31,
			note: 'Montgomery County rate plus the City of Rockville tax, about 1.33% together. Crime average is Montgomery County\'s.'
		},
		pg: {
			name: "Prince George's County, MD", state: 'md', propertyRatePct: 1.49, homesteadDeduction: 0, propertyFixedAnnual: 0,
			localIncome: [[null, 0.032]], carTax: null, buyerTransferPct: 0.75, zipPrefixes: ['207'], crimeAvg: null, crimeAvg2026: null,
			note: "Unincorporated rate; towns like Hyattsville, College Park, Greenbelt and Bowie are higher. County income tax 3.2%. Buyer's transfer/recordation share is a rough estimate (PG's county transfer tax is 1.4%)."
		},
		fairfax: {
			name: 'Fairfax County, VA', state: 'va', propertyRatePct: 1.12, homesteadDeduction: 0, propertyFixedAnnual: 0,
			localIncome: null, carTax: { ratePer100: 4.57, reliefPct: 49, reliefCap: 20000 }, buyerTransferPct: 0.333,
			zipPrefixes: ['220', '221', '201'], crimeAvg: null, crimeAvg2026: null,
			note: 'Car tax $4.57/$100 with state relief on the first $20k. Buyer pays VA recordation (~$0.25/$100 state + 1/3 local).'
		},
		arlington: {
			name: 'Arlington County, VA', state: 'va', propertyRatePct: 1.053, homesteadDeduction: 0, propertyFixedAnnual: 0,
			localIncome: null, carTax: { ratePer100: 5.0, reliefPct: 50, reliefCap: 20000 }, buyerTransferPct: 0.333,
			zipPrefixes: ['2220', '2221'], crimeAvg: null, crimeAvg2026: null,
			note: 'Car-tax relief share is an estimate; verify on Arlington\'s site.'
		}
	},
	states: {
		md: {
			name: 'Maryland',
			brackets: {
				single: [[1000, 0.02], [2000, 0.03], [3000, 0.04], [100000, 0.0475], [125000, 0.05], [150000, 0.0525], [250000, 0.055], [500000, 0.0575], [1000000, 0.0625], [null, 0.065]],
				mfj: [[1000, 0.02], [2000, 0.03], [3000, 0.04], [150000, 0.0475], [175000, 0.05], [225000, 0.0525], [300000, 0.055], [600000, 0.0575], [1200000, 0.0625], [null, 0.065]]
			},
			stdDeduction: { single: 3350, mfj: 6700 },
			exemption: {
				perPerson: 3200,
				phaseout: {
					single: [[100000, 3200], [125000, 1600], [150000, 800], [null, 0]],
					mfj: [[150000, 3200], [175000, 1600], [200000, 800], [null, 0]]
				}
			},
			itemize: { requiresFederal: true, phaseoutRate: 0.075, phaseoutStart: { single: 200000, mfj: 200000 } },
			note: '2025 law: flat standard deduction, new top brackets, itemized deductions reduced by 7.5% of AGI over $200k.'
		},
		dc: {
			name: 'District of Columbia',
			brackets: {
				single: [[10000, 0.04], [40000, 0.06], [60000, 0.065], [250000, 0.085], [500000, 0.0925], [1000000, 0.0975], [null, 0.1075]],
				mfj: [[10000, 0.04], [40000, 0.06], [60000, 0.065], [250000, 0.085], [500000, 0.0925], [1000000, 0.0975], [null, 0.1075]]
			},
			stdDeduction: 'federal',
			exemption: { perPerson: 0, phaseout: null },
			itemize: { requiresFederal: false, phaseoutRate: 0.05, phaseoutStart: { single: 200000, mfj: 200000 } },
			note: 'Same brackets for every filing status. Standard deduction follows federal.'
		},
		va: {
			name: 'Virginia',
			brackets: {
				single: [[3000, 0.02], [5000, 0.03], [17000, 0.05], [null, 0.0575]],
				mfj: [[3000, 0.02], [5000, 0.03], [17000, 0.05], [null, 0.0575]]
			},
			stdDeduction: { single: 8750, mfj: 17500 },
			exemption: { perPerson: 930, phaseout: null },
			itemize: { requiresFederal: true, phaseoutRate: 0, phaseoutStart: { single: 0, mfj: 0 } },
			note: 'Standard deduction raised for 2025–26; check whether it carries into 2027.'
		}
	},
	federal: {
		brackets: {
			single: [[12400, 0.1], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [null, 0.37]],
			mfj: [[24800, 0.1], [100800, 0.12], [211400, 0.22], [403550, 0.24], [512450, 0.32], [768700, 0.35], [null, 0.37]]
		},
		stdDeduction: { single: 16100, mfj: 32200 },
		saltCap: 40400,
		saltPhaseStart: 505000,
		saltFloor: 10000,
		mortgageDebtLimit: 750000
	},
	feeds: [
		{ name: 'Regional economy', url: gnews('Washington DC region economy jobs') },
		{ name: 'DC-area housing', url: gnews('DC area housing market (Montgomery OR Fairfax OR "District") home prices') },
		{ name: 'Mortgage rates', url: gnews('mortgage rates Freddie Mac this week') }
	],
	extraZips: [],
	commute: { placeId: 1, arriveBy: '09:00', rushFactor: 1.5 },
	keyDates: [
		{ date: '2027-06-30', label: 'Lease ends (sample)' },
		{ date: '2027-09-01', label: 'Target move-in (sample)' }
	]
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Saved values win; objects merge key by key, arrays are replaced whole. */
export function mergeConfig<T>(base: T, saved: unknown): T {
	if (!isObj(base) || !isObj(saved)) return (saved === undefined ? base : (saved as T));
	const out: Record<string, unknown> = { ...base };
	for (const [k, v] of Object.entries(saved)) {
		const b = (base as Record<string, unknown>)[k];
		out[k] = isObj(b) && isObj(v) && !isRecordOfJurisdictions(k) ? mergeConfig(b, v) : v;
	}
	return out as T;
}

// Jurisdictions are a keyed list: a saved set replaces the defaults so deleted ones stay deleted.
const isRecordOfJurisdictions = (k: string) => k === 'jurisdictions';

export function allZips(cfg: Config): string[] {
	return [...new Set([...cfg.areas.map((a) => a.zip), ...cfg.extraZips].filter((z) => /^\d{5}$/.test(z)))];
}

/** Which jurisdiction an imported listing falls in: area zip first, then longest zip prefix. */
export function jurisdictionForZip(cfg: Config, zip: string, state?: string): string {
	const area = cfg.areas.find((a) => a.zip === zip);
	if (area) return area.jurisdiction;
	let best = '';
	let bestLen = 0;
	for (const [id, j] of Object.entries(cfg.jurisdictions)) {
		for (const p of j.zipPrefixes) {
			if (zip.startsWith(p) && p.length > bestLen) {
				best = id;
				bestLen = p.length;
			}
		}
	}
	if (best) return best;
	const st = (state ?? '').toLowerCase();
	return Object.entries(cfg.jurisdictions).find(([, j]) => j.state === st)?.[0] ?? Object.keys(cfg.jurisdictions)[0];
}

