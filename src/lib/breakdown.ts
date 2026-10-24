// Cost breakdown rows shared by Compare (one column per home) and a listing's page (one column).

import { analyze, type Analysis, type HomeInput } from './finance.ts';
import type { Config } from './config.ts';
import { k, money, pct } from './format.ts';

export type Row = { label: string; v: (a: Analysis) => number | null; f?: 'money' | 'k' | 'pct'; strong?: boolean; hint?: string; detail?: boolean };
export type Section = { title: string; rows: Row[] };

/** Monthly, cash, year 1 and 5-year sections. `best` (cheapest 5-yr net) adds a "vs. cheapest" row. */
export function breakdownSections(cfg: Config, best?: number): Section[] {
	const sections: Section[] = [
		{
			title: 'Monthly payment',
			rows: [
				{ label: 'Principal & interest', v: (a) => a.monthly.pi, f: 'money', detail: true },
				{ label: 'Family loan', v: (a) => a.monthly.family || null, f: 'money', detail: true },
				{ label: 'Property tax', v: (a) => a.monthly.propertyTax, f: 'money', detail: true },
				{ label: 'HOA & fees', v: (a) => a.monthly.hoa, f: 'money', detail: true },
				{ label: 'Insurance', v: (a) => a.monthly.insurance, f: 'money', detail: true },
				{ label: 'PMI', v: (a) => a.monthly.pmi || null, f: 'money', detail: true },
				{ label: 'Total', v: (a) => a.monthly.total, f: 'money', strong: true },
				{ label: '% of loan income', v: (a) => a.dti.loanIncome * 100, f: 'pct', hint: 'Lenders like 28% or less for housing' },
				{ label: '% of household income', v: (a) => a.dti.household * 100, f: 'pct', detail: true }
			]
		},
		{
			title: 'Cash to close',
			rows: [
				{ label: 'Your down payment', v: (a) => a.downOwn, f: 'k' },
				{ label: 'Family help', v: (a) => a.help || null, f: 'k', detail: true },
				{ label: 'Transfer/recordation', v: (a) => a.cash.transfer, f: 'k', detail: true },
				{ label: 'Lender, title, prepaids', v: (a) => a.cash.other, f: 'k', detail: true },
				{ label: `Reserves (${cfg.profile.reserveMonths} mo)`, v: (a) => a.cash.reserves, f: 'k', detail: true },
				{ label: 'Total you need', v: (a) => a.cash.total, f: 'k', strong: true }
			]
		},
		{
			title: 'Year 1, every cost',
			rows: [
				{ label: 'Mortgage interest', v: (a) => a.year1.interest + a.year1.familyInterest, f: 'k', detail: true },
				{ label: 'PMI', v: (a) => a.year1.pmi || null, f: 'k', detail: true },
				{ label: 'Property tax', v: (a) => a.year1.propertyTax, f: 'k', detail: true },
				{ label: 'HOA & fees', v: (a) => a.year1.hoaFees || null, f: 'k', detail: true },
				{ label: 'Insurance + upkeep', v: (a) => a.year1.insurance + a.year1.maintenance, f: 'k', detail: true },
				{ label: 'Federal income tax', v: (a) => a.year1.taxes.federal, f: 'k', detail: true },
				{ label: 'State income tax', v: (a) => a.year1.taxes.state, f: 'k', detail: true },
				{ label: 'County income tax', v: (a) => a.year1.taxes.local || null, f: 'k', detail: true },
				{ label: 'Car tax', v: (a) => a.year1.taxes.car || null, f: 'k', detail: true },
				{ label: 'All-in', v: (a) => a.year1.allIn, f: 'k', strong: true },
				{ label: 'Principal paid (equity)', v: (a) => a.year1.principal + a.year1.familyPrincipal, f: 'k', hint: 'Not a cost; builds equity', detail: true },
				{ label: 'Tax change vs. no home', v: (a) => a.year1.taxes.total - a.noHomeTaxes.total, f: 'k', hint: 'Vs. staying where you are now, with no mortgage' }
			]
		},
		{
			title: '5 years, then sell',
			rows: [
				{ label: 'Housing payments & costs', v: (a) => a.fiveYear.housingOutflows, f: 'k', detail: true },
				{ label: 'Income & car taxes', v: (a) => a.fiveYear.incomeTaxes, f: 'k', detail: true },
				{ label: 'Sale price', v: (a) => a.fiveYear.salePrice, f: 'k', detail: true },
				{ label: 'Net proceeds after loans', v: (a) => a.fiveYear.netProceeds, f: 'k', detail: true },
				{ label: 'Opportunity cost of cash', v: (a) => a.fiveYear.oppCost, f: 'k', detail: true },
				{ label: 'Net cost', v: (a) => a.fiveYear.total, f: 'k', strong: true },
				{ label: 'vs. cheapest', v: (a) => a.fiveYear.total - (best ?? 0), f: 'k' },
				{ label: 'Per month', v: (a) => a.fiveYear.perMonth, f: 'money' }
			]
		}
	];
	if (best == null) for (const s of sections) s.rows = s.rows.filter((r) => r.label !== 'vs. cheapest');
	return sections;
}

export const show = (v: number | null, f: Row['f']) => (v == null ? '—' : f === 'pct' ? pct(v, 0) : f === 'money' ? money(v) : k(v));

/** Keeping the home for the whole loan: everything you pay out of pocket over 30 years (a gift isn't your cost; a family loan is). */
export function thirtyYear(home: HomeInput, cfg: Config, ratePct: number) {
	const a = analyze(home, cfg, ratePct, 30);
	const sum = (fn: (y: Analysis['years'][number]) => number) => a.years.reduce((s, y) => s + fn(y), 0);
	const parts = {
		upfront: a.downOwn + a.cash.transfer + a.cash.other,
		interest: sum((y) => y.interest),
		principal: sum((y) => y.principal),
		family: sum((y) => y.familyInterest + y.familyPrincipal),
		pmi: sum((y) => y.pmi),
		propertyTax: sum((y) => y.propertyTax),
		hoa: sum((y) => y.hoaFees),
		upkeep: sum((y) => y.insurance + y.maintenance)
	};
	return { parts, total: Object.values(parts).reduce((s, v) => s + v, 0), value: a.fiveYear.salePrice };
}
export type ThirtyYear = ReturnType<typeof thirtyYear>;

export const THIRTY_ROWS: { label: string; key: keyof ThirtyYear['parts'] }[] = [
	{ label: 'Down payment + closing', key: 'upfront' },
	{ label: 'Mortgage interest', key: 'interest' },
	{ label: 'Mortgage principal', key: 'principal' },
	{ label: 'Family loan repaid', key: 'family' },
	{ label: 'PMI', key: 'pmi' },
	{ label: 'Property tax', key: 'propertyTax' },
	{ label: 'HOA & fees', key: 'hoa' },
	{ label: 'Insurance + upkeep', key: 'upkeep' }
];
