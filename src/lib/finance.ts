// The cost engine: mortgage, every tax, and the 5-year buy-and-sell view.
// Pure functions so the Compare page can recompute instantly in the browser.

import { planningPrice, type Bracket, type Config, type Filing, type HomeType, type Jurisdiction } from './config.ts';

export interface HomeInput {
	price: number;
	jurisdiction: string;
	homeType: HomeType;
	hoaMonthly: number;
	extraPropRatePct: number;
	extraAnnualFees: number;
	insuranceAnnual: number;
	maintenancePct: number;
	appreciationPct: number;
	/** Known yearly property tax (from a listing); replaces the jurisdiction estimate in year 1. */
	taxAnnualOverride?: number | null;
}

export interface TaxResult {
	federal: number;
	state: number;
	local: number;
	car: number;
	total: number;
	itemizedFederal: boolean;
	/** What each return actually deducted, for explaining the result. */
	detail: {
		fedDeduction: number;
		fedStandard: number;
		interest: number;
		salt: number;
		saltCap: number;
		fedMarginal: number;
		stateDeduction: number;
		stateStandard: number;
		itemizedState: boolean;
		stateMarginal: number;
		localRate: number;
	};
}

export interface YearRow {
	year: number;
	interest: number;
	familyInterest: number;
	principal: number;
	familyPrincipal: number;
	pmi: number;
	propertyTax: number;
	hoaFees: number;
	insurance: number;
	maintenance: number;
	payments: number;
	taxes: TaxResult;
}

export interface Analysis {
	price: number;
	ratePct: number;
	downOwn: number;
	help: number;
	loan: number;
	familyLoan: number;
	ltv: number;
	monthly: { pi: number; family: number; propertyTax: number; hoa: number; insurance: number; pmi: number; total: number };
	cash: { down: number; transfer: number; other: number; closing: number; reserves: number; total: number };
	year1: YearRow & { allIn: number; housingNonTax: number };
	noHomeTaxes: TaxResult;
	years: YearRow[];
	fiveYear: {
		housingOutflows: number;
		incomeTaxes: number;
		salePrice: number;
		netProceeds: number;
		oppCost: number;
		housingNet: number;
		total: number;
		perMonth: number;
		equityGain: number;
	};
	dti: { loanIncome: number; household: number };
}

export function bracketTax(income: number, brackets: Bracket[]): number {
	let tax = 0;
	let lower = 0;
	for (const [upper, rate] of brackets) {
		const top = upper ?? Infinity;
		if (income <= lower) break;
		tax += (Math.min(income, top) - lower) * rate;
		lower = top;
	}
	return tax;
}

/** Rate on the next dollar of income. */
export function marginalRate(income: number, brackets: Bracket[]): number {
	for (const [upper, rate] of brackets) if (upper == null || income < upper) return rate;
	return brackets.at(-1)?.[1] ?? 0;
}

/** Look up a step table of [up to, amount]. */
function step(value: number, table: Bracket[]): number {
	for (const [upper, amount] of table) if (value <= (upper ?? Infinity)) return amount;
	return 0;
}

export function monthlyPayment(principal: number, ratePct: number, years: number): number {
	if (principal <= 0) return 0;
	const r = ratePct / 100 / 12;
	const n = years * 12;
	return r === 0 ? principal / n : (principal * r) / (1 - (1 + r) ** -n);
}

export function carTax(cfg: Config, j: Jurisdiction): number {
	if (!j.carTax) return 0;
	const { ratePer100, reliefPct, reliefCap } = j.carTax;
	return cfg.profile.cars.reduce((sum, v) => {
		const gross = (v * ratePer100) / 100;
		const relief = ((Math.min(v, reliefCap) * ratePer100) / 100) * (reliefPct / 100);
		return sum + Math.max(0, gross - relief);
	}, 0);
}

export function agi(cfg: Config): number {
	return cfg.profile.people.reduce((s, p) => s + p.salary * (1 - p.pretaxPct / 100), 0);
}

interface TaxInput {
	agi: number;
	filing: Filing;
	interest: number;
	acquisitionDebt: number;
	propertyTax: number;
	carTax: number;
}

export function incomeTaxes(cfg: Config, jurisdictionId: string, t: TaxInput): TaxResult {
	const j = cfg.jurisdictions[jurisdictionId];
	const st = cfg.states[j.state];
	const fed = cfg.federal;
	const f = t.filing;
	const people = f === 'mfj' ? 2 : 1;
	const interest = t.acquisitionDebt > fed.mortgageDebtLimit ? (t.interest * fed.mortgageDebtLimit) / t.acquisitionDebt : t.interest;

	const stateCalc = (allowItemize: boolean) => {
		const std = st.stdDeduction === 'federal' ? fed.stdDeduction[f] : st.stdDeduction[f];
		// State itemized deductions exclude state income tax itself.
		const phase = Math.max(0, t.agi - st.itemize.phaseoutStart[f]) * st.itemize.phaseoutRate;
		const itemized = Math.max(0, interest + t.propertyTax + t.carTax - phase);
		const useItemized = allowItemize && itemized > std;
		const exemptions = st.exemption.phaseout ? step(t.agi, st.exemption.phaseout[f]) * people : st.exemption.perPerson * people;
		const taxable = Math.max(0, t.agi - (useItemized ? itemized : std) - exemptions);
		const state = bracketTax(taxable, st.brackets[f]);
		const local = j.localIncome ? bracketTax(taxable, j.localIncome) : 0;
		const stateMarginal = marginalRate(taxable, st.brackets[f]);
		const localRate = j.localIncome ? marginalRate(taxable, j.localIncome) : 0;
		return { state, local, useItemized, deduction: useItemized ? itemized : std, std, stateMarginal, localRate };
	};

	const fedCalc = (stateLocal: number) => {
		const cap = Math.max(fed.saltFloor, fed.saltCap - 0.3 * Math.max(0, t.agi - fed.saltPhaseStart));
		const salt = Math.min(cap, stateLocal + t.propertyTax + t.carTax);
		const itemized = interest + salt;
		const std = fed.stdDeduction[f];
		const useItemized = itemized > std;
		const taxable = Math.max(0, t.agi - (useItemized ? itemized : std));
		return { federal: bracketTax(taxable, fed.brackets[f]), useItemized, deduction: useItemized ? itemized : std, std, salt, cap, marginal: marginalRate(taxable, fed.brackets[f]) };
	};

	let s = stateCalc(true);
	let fr = fedCalc(s.state + s.local);
	if (s.useItemized && st.itemize.requiresFederal && !fr.useItemized) {
		s = stateCalc(false);
		fr = fedCalc(s.state + s.local);
	}
	return {
		federal: fr.federal,
		state: s.state,
		local: s.local,
		car: t.carTax,
		total: fr.federal + s.state + s.local + t.carTax,
		itemizedFederal: fr.useItemized,
		detail: {
			fedDeduction: fr.deduction, fedStandard: fr.std, interest, salt: fr.salt, saltCap: fr.cap, fedMarginal: fr.marginal,
			stateDeduction: s.deduction, stateStandard: s.std, itemizedState: s.useItemized, stateMarginal: s.stateMarginal, localRate: s.localRate
		}
	};
}

export function liveRate(cfg: Config, avg30: number | null): number {
	if (cfg.loan.rateMode === 'fixed' || avg30 == null) return cfg.loan.fixedRate;
	return Math.round((avg30 + cfg.loan.spread) * 1000) / 1000;
}

export function analyze(home: HomeInput, cfg: Config, ratePct: number, years = 5): Analysis {
	const j = cfg.jurisdictions[home.jurisdiction] ?? Object.values(cfg.jurisdictions)[0];
	const L = cfg.loan;
	const price = home.price;
	const downOwn = (price * L.downPct) / 100;
	const help = cfg.family.mode === 'none' ? 0 : Math.min(cfg.family.amount, Math.max(0, price - downOwn));
	const loan = Math.max(0, price - downOwn - help);
	const familyLoan = cfg.family.mode === 'loan' ? help : 0;
	const pi = monthlyPayment(loan, ratePct, L.termYears);
	const famPmt = monthlyPayment(familyLoan, cfg.family.ratePct, cfg.family.termYears);
	const ltv = loan / price;
	const filing = cfg.profile.filing;
	const income = agi(cfg);
	const car = carTax(cfg, j);

	const propTaxFor = (value: number) =>
		(Math.max(0, value - j.homesteadDeduction) * j.propertyRatePct) / 100 + (value * home.extraPropRatePct) / 100 + j.propertyFixedAnnual;

	// Month-by-month amortization, rolled up by year.
	let bal = loan;
	let famBal = familyLoan;
	const r = ratePct / 100 / 12;
	const fr = cfg.family.ratePct / 100 / 12;
	const rows: YearRow[] = [];
	for (let y = 1; y <= years; y++) {
		let interest = 0, principal = 0, famInt = 0, famPrin = 0, pmi = 0;
		for (let m = 0; m < 12; m++) {
			if (bal > 0) {
				const i = bal * r;
				const p = Math.min(bal, pi - i);
				if (bal > 0.78 * price) pmi += (loan * L.pmiPct) / 100 / 12;
				interest += i;
				principal += p;
				bal -= p;
			}
			if (famBal > 0) {
				const i = famBal * fr;
				const p = Math.min(famBal, famPmt - i);
				famInt += i;
				famPrin += p;
				famBal -= p;
			}
		}
		const value = price * (1 + home.appreciationPct / 100) ** (y - 1);
		const propertyTax = y === 1 && home.taxAnnualOverride ? home.taxAnnualOverride : propTaxFor(value);
		const hoaFees = home.hoaMonthly * 12 + home.extraAnnualFees;
		const insurance = home.insuranceAnnual;
		const maintenance = (value * home.maintenancePct) / 100;
		const taxes = incomeTaxes(cfg, home.jurisdiction, {
			agi: income, filing, interest: interest + famInt, acquisitionDebt: loan + familyLoan, propertyTax, carTax: car
		});
		rows.push({
			year: y, interest, familyInterest: famInt, principal, familyPrincipal: famPrin, pmi, propertyTax, hoaFees, insurance, maintenance,
			payments: interest + principal + famInt + famPrin, taxes
		});
	}

	const y1 = rows[0];
	const transfer = (price * j.buyerTransferPct) / 100;
	const other = (price * L.otherClosingPct) / 100;
	const monthlyPropTax = y1.propertyTax / 12;
	const monthlyHoa = y1.hoaFees / 12;
	const monthlyIns = home.insuranceAnnual / 12;
	const monthlyPmi = ltv > 0.8 ? (loan * L.pmiPct) / 100 / 12 : 0;
	const monthlyTotal = pi + famPmt + monthlyPropTax + monthlyHoa + monthlyIns + monthlyPmi;
	const reserves = monthlyTotal * cfg.profile.reserveMonths;

	const housingNonTax = (row: YearRow) => row.interest + row.familyInterest + row.pmi + row.propertyTax + row.hoaFees + row.insurance + row.maintenance;
	const housingOutflows = rows.reduce((s, row) => s + row.payments + row.pmi + row.propertyTax + row.hoaFees + row.insurance + row.maintenance, 0);
	const incomeTaxTotal = rows.reduce((s, row) => s + row.taxes.total, 0);
	const salePrice = price * (1 + home.appreciationPct / 100) ** years;
	const netProceeds = salePrice * (1 - L.sellCostPct / 100) - Math.max(0, bal) - Math.max(0, famBal);
	const upfront = downOwn + help + transfer + other;
	const oppCost = upfront * ((1 + L.investReturnPct / 100) ** years - 1);
	const housingNet = upfront + housingOutflows - netProceeds + oppCost;

	const noHomeTaxes = incomeTaxes(cfg, cfg.profile.currentJurisdiction in cfg.jurisdictions ? cfg.profile.currentJurisdiction : home.jurisdiction, {
		agi: income, filing, interest: 0, acquisitionDebt: 0, propertyTax: 0, carTax: carTax(cfg, cfg.jurisdictions[cfg.profile.currentJurisdiction] ?? j)
	});

	const grossMonthly = (people: Config['profile']['people']) => people.reduce((s, p) => s + p.salary, 0) / 12;

	return {
		price, ratePct, downOwn, help, loan, familyLoan, ltv,
		monthly: { pi, family: famPmt, propertyTax: monthlyPropTax, hoa: monthlyHoa, insurance: monthlyIns, pmi: monthlyPmi, total: monthlyTotal },
		cash: { down: downOwn, transfer, other, closing: transfer + other, reserves, total: downOwn + transfer + other + reserves },
		year1: { ...y1, housingNonTax: housingNonTax(y1), allIn: housingNonTax(y1) + y1.taxes.total },
		noHomeTaxes,
		years: rows,
		fiveYear: {
			housingOutflows, incomeTaxes: incomeTaxTotal, salePrice, netProceeds, oppCost, housingNet,
			total: housingNet + incomeTaxTotal, perMonth: (housingNet + incomeTaxTotal) / (years * 12),
			equityGain: netProceeds - (downOwn + help)
		},
		dti: {
			loanIncome: monthlyTotal / Math.max(1, grossMonthly(cfg.profile.people.filter((p) => p.countForLoan))),
			household: monthlyTotal / Math.max(1, grossMonthly(cfg.profile.people))
		}
	};
}

/** Year-1 income taxes owning this home vs. renting in the same place: the tax benefit of owning on its own. */
export function taxBenefit(cfg: Config, jurisdictionId: string, a: Analysis) {
	const j = cfg.jurisdictions[jurisdictionId];
	const renter = incomeTaxes(cfg, jurisdictionId, { agi: agi(cfg), filing: cfg.profile.filing, interest: 0, acquisitionDebt: 0, propertyTax: 0, carTax: carTax(cfg, j) });
	const owner = a.year1.taxes;
	const federal = renter.federal - owner.federal;
	const stateLocal = renter.state + renter.local - owner.state - owner.local;
	return { renter, owner, federal, stateLocal, total: federal + stateLocal, propertyTax: a.year1.propertyTax };
}

/** Renting the typical home in the same zip for the same horizon, with taxes as a renter there. */
export function rentCost(cfg: Config, jurisdictionId: string, monthlyRent: number, years = 5) {
	const j = cfg.jurisdictions[jurisdictionId];
	let rent = 0;
	for (let y = 0; y < years; y++) rent += monthlyRent * 12 * (1 + cfg.loan.rentGrowthPct / 100) ** y;
	const taxes = incomeTaxes(cfg, jurisdictionId, { agi: agi(cfg), filing: cfg.profile.filing, interest: 0, acquisitionDebt: 0, propertyTax: 0, carTax: carTax(cfg, j) });
	return { rent, taxes: taxes.total * years, total: rent + taxes.total * years };
}

export function homeFromArea(a: Config['areas'][number], cfg: Config): HomeInput {
	return {
		price: planningPrice(a, cfg.loan.priceLeanPct), jurisdiction: a.jurisdiction, homeType: a.homeType, hoaMonthly: a.hoaMonthly, extraPropRatePct: a.extraPropRatePct,
		extraAnnualFees: a.extraAnnualFees, insuranceAnnual: a.insuranceAnnual, maintenancePct: a.maintenancePct, appreciationPct: a.appreciationPct
	};
}

/** Cash available at a future month given today's balance and the monthly savings rate. */
export function projectSavings(balance: number, asOf: string, monthly: number, target: string): number {
	const months = monthsBetween(asOf.slice(0, 7), target);
	return balance + Math.max(0, months) * monthly;
}

export function monthsBetween(from: string, to: string): number {
	const [fy, fm] = from.split('-').map(Number);
	const [ty, tm] = to.split('-').map(Number);
	return (ty - fy) * 12 + (tm - fm);
}
