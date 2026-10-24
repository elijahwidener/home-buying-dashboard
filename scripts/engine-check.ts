// Sanity check for the cost engine: prints the default areas at a given rate.
// Usage: npm test [rate]
import { DEFAULT_CONFIG as cfg } from '../src/lib/config.ts';
import { analyze, homeFromArea, bracketTax } from '../src/lib/finance.ts';

const rate = Number(process.argv[2] ?? 7.4);
const k = (n: number) => `$${(n / 1000).toFixed(1)}k`;

// Known values: $100k at the 2026 MFJ federal brackets.
const fed = bracketTax(100000, cfg.federal.brackets.mfj);
if (Math.abs(fed - (24800 * 0.1 + 75200 * 0.12)) > 0.01) throw new Error(`bracketTax wrong: ${fed}`);

console.log(`rate ${rate}%`);
for (const a of cfg.areas) {
	const r = analyze(homeFromArea(a, cfg), cfg, rate);
	const t = r.year1.taxes;
	console.log(
		a.name.slice(0, 26).padEnd(27),
		`pmt ${k(r.monthly.total)}/mo`,
		`cash ${k(r.cash.total)}`,
		`fed ${k(t.federal)} st ${k(t.state)} loc ${k(t.local)} car ${k(t.car)} prop ${k(r.year1.propertyTax)}`,
		`itemized=${t.itemizedFederal}`,
		`allIn ${k(r.year1.allIn)}`,
		`5yr ${k(r.fiveYear.total)}`
	);
}

