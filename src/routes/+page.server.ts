import { monthsBetween, projectSavings } from '#lib/finance.js';
import { analyze, taxBenefit } from '#lib/finance.js';
import { all, currentSavings, loadConfig, series } from '#lib/server/db.js';
import { areaAnalyses, homeFromListing, listings, metroMarket, rates, recentNews } from '#lib/server/live.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const cfg = loadConfig();
	const r = rates(cfg);
	const areas = areaAnalyses(cfg, r.yours);
	const ranked = [...areas].sort((x, y) => x.a.fiveYear.total - y.a.fiveYear.total);
	const primary = areas[0];

	const savings = currentSavings(cfg);
	const today = new Date().toLocaleDateString('en-CA');
	const projected = projectSavings(savings.balance, today, cfg.profile.monthlySavings, cfg.profile.targetClose);
	const needed = primary?.a.cash.total ?? 0;
	const monthsLeft = monthsBetween(today.slice(0, 7), cfg.profile.targetClose);
	const monthsToGoal = cfg.profile.monthlySavings > 0 ? Math.max(0, Math.ceil((needed - savings.balance) / cfg.profile.monthlySavings)) : null;

	const watch = listings("l.stage != 'passed' AND l.status NOT LIKE 'Sold%'").slice(0, 8).map((l) => ({
		...l,
		a: analyze(homeFromListing(cfg, l), cfg, r.yours)
	}));
	const priceCuts = all<{ id: number; address: string; date: string; price: number; prev: number }>(
		`SELECT l.id, l.address, p.date, p.price,
			(SELECT price FROM listing_prices q WHERE q.listing_id = p.listing_id AND q.date < p.date ORDER BY q.date DESC LIMIT 1) AS prev
		 FROM listing_prices p JOIN listings l ON l.id = p.listing_id
		 WHERE p.date >= date('now', '-14 days') AND l.stage != 'passed'`
	).filter((c) => c.prev != null && c.price < c.prev);

	const twoYearsAgo = new Date(Date.now() - 2 * 365 * 86_400_000).toLocaleDateString('en-CA');
	// Weekly mortgage averages, with the 10-yr Treasury on (or just before) each date.
	const t10 = series('fred:DGS10', twoYearsAgo);
	let j = 0;
	const rateHistory = series('fred:MORTGAGE30US', twoYearsAgo).map((p) => {
		while (j + 1 < t10.length && t10[j + 1].date <= p.date) j++;
		return { date: p.date, m30: p.value, t10: t10[j] && t10[j].date <= p.date ? t10[j].value : null };
	});

	return {
		cfg,
		rates: r,
		areas,
		ranked: ranked.map((x) => x.area.id),
		savings: { ...savings, projected, needed, monthsLeft, monthsToGoal, primaryName: primary?.area.name ?? '' },
		watch,
		priceCuts,
		metro: metroMarket(),
		rateHistory,
		news: recentNews(10),
		taxes: areas.map((x) => ({ id: x.area.id, name: x.area.name, monthly: x.a.monthly.total, ...taxBenefit(cfg, x.area.jurisdiction, x.a) }))
	};
};
