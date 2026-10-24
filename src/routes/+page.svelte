<script lang="ts">
	import Chart from '#lib/components/Chart.svelte';
	import { daysUntil, k, money, monthLabel, pct, prettyDate, tone } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const r = $derived(data.rates);
	const primary = $derived(data.areas[0]);
	const bestId = $derived(data.ranked[0]);
	const bestTotal = $derived(data.areas.find((x) => x.area.id === bestId)?.a.fiveYear.total ?? 0);
	const weekMove = $derived(r.avg30 && r.prev30 ? r.avg30.value - r.prev30.value : null);

	type Alert = { tone: 'good' | 'bad' | ''; text: string };
	const alerts = $derived.by(() => {
		const out: Alert[] = [];
		const cfg = data.cfg;
		if (r.avg30 && r.avg30.value <= cfg.loan.alertRate)
			out.push({ tone: 'good', text: `30-yr average is ${pct(r.avg30.value)}, at or below your ${pct(cfg.loan.alertRate)} alert. Time to get quotes.` });
		if (weekMove != null && Math.abs(weekMove) >= 0.15)
			out.push({ tone: weekMove < 0 ? 'good' : 'bad', text: `Rates moved ${weekMove > 0 ? 'up' : 'down'} ${Math.abs(weekMove).toFixed(2)} pts this week.` });
		for (const c of data.priceCuts)
			out.push({ tone: 'good', text: `Price cut: ${c.address} ${k(c.prev)} → ${k(c.price)} (${prettyDate(c.date)}).` });
		const s = data.savings;
		if (s.needed > 0) {
			if (s.projected < s.needed)
				out.push({ tone: 'bad', text: `At ${money(cfg.profile.monthlySavings)}/mo you'll have ${k(s.projected)} by ${monthLabel(cfg.profile.targetClose)}: ${k(s.needed - s.projected)} short of the ${k(s.needed)} needed for ${s.primaryName}.` });
			else out.push({ tone: 'good', text: `On track: ${k(s.projected)} projected by ${monthLabel(cfg.profile.targetClose)} vs ${k(s.needed)} needed for ${s.primaryName}.` });
		}
		for (const d of cfg.keyDates) {
			const n = daysUntil(d.date);
			if (n >= 0 && n <= 60) out.push({ tone: '', text: `${d.label}: ${prettyDate(d.date)} (${n} days).` });
		}
		if (primary && primary.a.dti.loanIncome > 0.36)
			out.push({ tone: 'bad', text: `${primary.area.name}: payment is ${Math.round(primary.a.dti.loanIncome * 100)}% of the income counted for the loan (lenders like ≤ 28–36%).` });
		return out;
	});

	const chartLabels = $derived(data.rateHistory.map((p) => monthLabel(p.date)));
	const chartSeries = $derived([
		{ label: '30-yr mortgage', data: data.rateHistory.map((p) => p.m30), color: '#6cb2ff' },
		{ label: '10-yr Treasury', data: data.rateHistory.map((p) => p.t10), color: '#a9b3c0', dashed: true },
		{ label: 'Your alert', data: data.rateHistory.map(() => data.cfg.loan.alertRate), color: '#4fd18b', dashed: true }
	]);
	const m = $derived(data.metro);
	const tx = $derived(data.taxes[0]);
	const progress = $derived(data.savings.needed ? Math.min(1, data.savings.balance / data.savings.needed) : 0);
</script>

<h1>Overview</h1>

{#if !r.avg30}
	<div class="warn-box">No live data yet. The first refresh runs a few seconds after startup; check <a href="/settings#data">Settings → Data</a>.</div>
{/if}

{#each alerts as a, i (i)}
	<div class="alert {a.tone}">{a.text}</div>
{/each}

<h2>Rates</h2>
<div class="grid">
	<div class="stat">
		<div class="label">30-yr average</div>
		<div class="value">{pct(r.avg30?.value)}</div>
		<div class="sub">
			<span class={tone(weekMove, false)}>{weekMove == null ? '' : pct(weekMove, 2, true).replace('%', ' pts')}</span> wk · {prettyDate(r.avg30?.date)}
		</div>
	</div>
	<div class="stat">
		<div class="label">Your rate (est.)</div>
		<div class="value">{pct(r.yours, 3)}</div>
		<div class="sub">{data.cfg.loan.rateMode === 'live' ? `avg ${data.cfg.loan.spread >= 0 ? '+' : ''}${data.cfg.loan.spread}` : 'fixed in settings'}</div>
	</div>
	<div class="stat">
		<div class="label">52-wk range</div>
		<div class="value">{r.low52?.toFixed(2) ?? '—'}–{r.high52?.toFixed(2) ?? '—'}%</div>
		<div class="sub">year ago {pct(r.yearAgo30?.value)}</div>
	</div>
	<div class="stat">
		<div class="label">10-yr Treasury</div>
		<div class="value">{pct(r.t10?.value)}</div>
		<div class="sub">spread {r.avg30 && r.t10 ? (r.avg30.value - r.t10.value).toFixed(2) : '—'} pts</div>
	</div>
	<div class="stat">
		<div class="label">Fed funds (upper)</div>
		<div class="value">{pct(r.fed?.value)}</div>
		<div class="sub">CPI {pct(r.cpiYoY, 1)} y/y</div>
	</div>
</div>

<details class="card ranking">
<summary>Your areas at {pct(r.yours)}, ranked by 5-year cost <span class="muted small-text">({data.areas.length} on Compare · <a href="/areas">all areas →</a>)</span></summary>
<div class="table-wrap">
	<table>
		<thead>
			<tr>
				<th>Area</th>
				<th class="num">Price</th>
				<th class="num">Monthly</th>
				<th class="num">Cash to close</th>
				<th class="num">Yr-1 all-in</th>
				<th class="num">5-yr net</th>
				<th class="num">vs best</th>
				<th class="num">Value y/y</th>
				<th class="num">12-mo fcst</th>
			</tr>
		</thead>
		<tbody>
			{#each data.ranked as id (id)}
				{@const x = data.areas.find((y) => y.area.id === id)!}
				<tr class:best={id === bestId}>
					<td>
						<a href="/areas#{id}">{x.area.name}</a>
						<div class="muted small-text">{x.area.zip} · {x.area.beds}bd {x.area.homeType}</div>
					</td>
					<td class="num">{k(x.a.price)}<div class="muted small-text">{k(x.area.priceLow)}–{k(x.area.priceHigh)}</div></td>
					<td class="num">{money(x.a.monthly.total)}</td>
					<td class="num">{k(x.a.cash.total)}</td>
					<td class="num">{k(x.a.year1.allIn)}</td>
					<td class="num">{k(x.a.fiveYear.total)}</td>
					<td class="num">{id === bestId ? '—' : k(x.a.fiveYear.total - bestTotal, true)}</td>
					<td class="num {tone(x.market.valueYoY)}">{pct(x.market.valueYoY, 1, true)}</td>
					<td class="num {tone(x.market.forecast12)}">{pct(x.market.forecast12, 1, true)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
<p class="muted small-text">
	All-in = interest, PMI, property tax, HOA, insurance, upkeep, plus federal/state/local income and car taxes. 5-yr net adds closing,
	selling and opportunity costs and subtracts sale proceeds. Price is the typical sale leaned {data.cfg.loan.priceLeanPct}% toward the low end of the
	range shown under it. Values and forecasts: Zillow, by zip.
</p>
</details>

<div class="two">
	<div>
		<h2>Cash for {data.savings.primaryName}</h2>
		<div class="card">
			<div class="spread">
				<strong>{k(data.savings.balance)} <span class="muted">of {k(data.savings.needed)}</span></strong>
				<span class="muted small-text">as of {prettyDate(data.savings.date)}</span>
			</div>
			<div class="bar"><div style:width="{progress * 100}%"></div></div>
			<div class="small-text muted">
				{#if data.savings.monthsToGoal === 0}
					Goal reached: down payment, closing and {data.cfg.profile.reserveMonths} months of reserves.
				{:else if data.savings.monthsToGoal != null}
					About {data.savings.monthsToGoal} more months at {money(data.cfg.profile.monthlySavings)}/mo. Target close {monthLabel(data.cfg.profile.targetClose)}
					({data.savings.monthsLeft} months).
				{/if}
			</div>
			<a href="/plan" class="small-text">Log balance →</a>
		</div>

		<h2>DC metro market (Zillow)</h2>
		<div class="grid">
			<div class="stat">
				<div class="label">For-sale inventory</div>
				<div class="value">{m.inventory ? Math.round(m.inventory.value).toLocaleString() : '—'}</div>
				<div class="sub"><span class={tone(m.inventoryYoY)}>{pct(m.inventoryYoY, 0, true)}</span> y/y</div>
			</div>
			<div class="stat">
				<div class="label">Days to pending</div>
				<div class="value">{m.daysToPending?.value ?? '—'}</div>
				<div class="sub"><span class={tone(m.daysYoY)}>{pct(m.daysYoY, 0, true)}</span> y/y</div>
			</div>
			<div class="stat">
				<div class="label">Listings w/ price cut</div>
				<div class="value">{m.priceCuts ? pct(m.priceCuts.value * 100, 0) : '—'}</div>
				<div class="sub">year ago {m.priceCutsYearAgo != null ? pct(m.priceCutsYearAgo * 100, 0) : '—'}</div>
			</div>
			<div class="stat">
				<div class="label">Median list price</div>
				<div class="value">{k(m.listPrice?.value)}</div>
				<div class="sub"><span class={tone(m.listPriceYoY, false)}>{pct(m.listPriceYoY, 1, true)}</span> y/y</div>
			</div>
		</div>
		<p class="muted small-text">Rising inventory, longer days to pending and more price cuts all favor buyers.</p>
	</div>

	<div>
		<h2>Rates, last 2 years</h2>
		<Chart labels={chartLabels} series={chartSeries} format="pct" height={260} />
	</div>
</div>

<div class="two">
	<div>
		<h2>Watchlist</h2>
		{#if data.watch.length === 0}
			<div class="card muted">No listings yet. <a href="/listings">Add one or import a Redfin CSV →</a></div>
		{:else}
			<div class="table-wrap">
				<table>
					<tbody>
						{#each data.watch as l (l.id)}
							<tr>
								<td>
									{l.starred ? '★ ' : ''}<a href="/listings/{l.id}">{l.address}</a>
									<div class="muted small-text">{l.city} {l.zip} · {l.beds ?? '?'}bd · {l.stage}</div>
								</td>
								<td class="num">
									{k(l.price)}
									{#if l.first_price && l.first_price !== l.price}
										<div class="small-text {tone(l.price - l.first_price, false)}">{k(l.price - l.first_price, true)}</div>
									{/if}
								</td>
								<td class="num">{money(l.a.monthly.total)}<div class="muted small-text">/mo</div></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<div class="news">
		<h2>Headlines</h2>
		<div class="card">
			{#if data.news.length === 0}
				<span class="muted">No headlines yet.</span>
			{:else}
				<ul>
					{#each data.news as n (n.link)}
						<li>
							<a href={n.link} target="_blank" rel="noopener noreferrer">{n.title}</a>
							<div class="muted small-text">{n.source} · {n.feed} · {prettyDate(n.published.slice(0, 10))}</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</div>

<details class="card taxes">
	<summary>How owning lowers your taxes</summary>
	{#if tx}
		{@const d = tx.owner.detail}
		{@const s = tx.renter.detail}
		<p class="small-text">
			Owning only saves tax on deductions <em>above</em> the {k(d.fedStandard)} standard deduction you'd get anyway. Mortgage interest and property tax
			(plus state income tax, under the SALT cap) count; principal does not. Here's {tx.name}, first year, at {pct(r.yours)}:
		</p>
		<div class="eq">
			<div class="eq-label">Federal</div>
			{#if tx.owner.itemizedFederal}
				<div>
					( interest {k(d.interest)} + state & local taxes {k(d.salt)} <span class="muted">(cap {k(d.saltCap)})</span> − standard {k(d.fedStandard)} ) × {pct(d.fedMarginal * 100, 0)}
					≈ <strong class="pos">{k(tx.federal)}</strong>
				</div>
			{:else}
				<div>Itemized {k(d.fedDeduction)} is below the {k(d.fedStandard)} standard deduction → <strong>$0</strong></div>
			{/if}
			<div class="eq-label">{tx.owner.local ? 'State + county' : 'State'}</div>
			{#if d.itemizedState}
				<div>
					( itemized {k(d.stateDeduction)} − standard {k(s.stateDeduction)} ) × ({pct(d.stateMarginal * 100, 2)}{d.localRate ? ` + ${pct(d.localRate * 100, 2)}` : ''})
					≈ <strong class="pos">{k(tx.stateLocal)}</strong>
				</div>
			{:else}
				<div>Interest + property tax don't beat the {k(d.stateStandard)} state standard deduction → <strong>$0</strong></div>
			{/if}
			<div class="eq-label">Total</div>
			<div>
				<strong class="pos">{k(tx.total)}/yr</strong> ≈ {money(tx.total / 12)}/mo, so the {money(tx.monthly)} payment really costs about
				<strong>{money(tx.monthly - tx.total / 12)}</strong>
			</div>
		</div>
	{/if}

	<div class="table-wrap" style="margin-top:0.75rem">
		<table>
			<thead>
				<tr>
					<th>Year 1</th>
					{#each data.taxes as t (t.id)}<th class="num">{t.name}</th>{/each}
				</tr>
			</thead>
			<tbody>
				<tr class="detail">
					<td class="label-cell">Mortgage interest</td>
					{#each data.taxes as t (t.id)}<td class="num">{k(t.owner.detail.interest)}</td>{/each}
				</tr>
				<tr class="detail">
					<td class="label-cell">Property tax</td>
					{#each data.taxes as t (t.id)}<td class="num">{k(t.propertyTax)}</td>{/each}
				</tr>
				<tr>
					<td class="label-cell">Federal savings</td>
					{#each data.taxes as t (t.id)}<td class="num">{k(t.federal)}</td>{/each}
				</tr>
				<tr>
					<td class="label-cell">State + county savings</td>
					{#each data.taxes as t (t.id)}<td class="num">{k(t.stateLocal)}</td>{/each}
				</tr>
				<tr class="total">
					<td class="label-cell">Total per year</td>
					{#each data.taxes as t (t.id)}<td class="num pos">{k(t.total)}</td>{/each}
				</tr>
				<tr>
					<td class="label-cell">Payment after savings</td>
					{#each data.taxes as t (t.id)}<td class="num">{money(t.monthly - t.total / 12)}<span class="muted small-text"> of {money(t.monthly)}</span></td>{/each}
				</tr>
			</tbody>
		</table>
	</div>
	<ul class="small-text muted">
		<li>Compared with renting in the same place, so it shows the benefit of owning, not of moving (Compare's "tax change vs. no home" mixes in the move).</li>
		<li>Shrinks every year: interest falls as you pay the loan down, and the standard deduction rises with inflation.</li>
		<li>Assumes {data.cfg.profile.filing === 'mfj' ? 'married filing jointly' : 'filing single'}. Filing single, the standard deduction is half, so more of the interest counts.</li>
		<li>
			DC's standard deduction matches the federal one, so a DC home usually gets no city benefit. Maryland and Virginia have small standard
			deductions, so most of the interest counts there.
		</li>
		<li>Interest is deductible on up to $750k of mortgage. A family loan's interest counts too if it's recorded as a second mortgage; a gift changes nothing.</li>
	</ul>
</details>
