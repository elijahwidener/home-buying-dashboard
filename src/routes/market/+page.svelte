<script lang="ts">
	import Chart from '#lib/components/Chart.svelte';
	import Tip from '#lib/components/Tip.svelte';
	import { k, money, monthLabel, pct, prettyDate, tone } from '#lib/format.js';
	import type { Point } from '#lib/server/db.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Line several monthly series up on the union of their dates. */
	function align(list: Point[][]) {
		const dates = [...new Set(list.flatMap((s) => s.map((p) => p.date)))].sort();
		const maps = list.map((s) => new Map(s.map((p) => [p.date, p.value])));
		return { labels: dates.map(monthLabel), data: maps.map((m) => dates.map((d) => m.get(d) ?? null)) };
	}

	const values = $derived(align([data.values.all, data.values.bd2, data.values.sfr, data.values.condo]));
	const metro = $derived(align([data.metro.inventory, data.metro.days]));
	const cuts = $derived(align([data.metro.cuts]));
	const rates = $derived(align([data.rates.m30, data.rates.m15]));
	const rent = $derived(align([data.values.rent]));
	const m = $derived(data.metro.now);
</script>

<h1>Market</h1>

<h2>Your zips (Zillow, latest month)</h2>
<div class="table-wrap">
	<table>
		<thead>
			<tr>
				<th>Zip</th>
				<th class="num">Typical home<Tip text="Zillow Home Value Index: the typical value of homes in the zip (the middle third by price), all types and sizes. Not a sale price." /></th>
				<th class="num">y/y<Tip text="Change in typical value from the same month last year. Green = rising." /></th>
				<th class="num">2-bed</th>
				<th class="num">y/y<Tip text="Change in the typical 2-bedroom value from the same month last year." /></th>
				<th class="num">House</th>
				<th class="num">Condo</th>
				<th class="num">Rent<Tip text="Zillow Observed Rent Index: typical asking rent in the zip, all home sizes." /></th>
				<th class="num">Rent y/y<Tip text="Change in typical rent from the same month last year. Rising rents make buying look better." /></th>
				<th class="num">Forecast<Tip text="Zillow's forecast of the change in typical home value over the next 12 months. A rough guide: forecasts often miss by several points." /></th>
			</tr>
		</thead>
		<tbody>
			{#each data.summary as s (s.zip)}
				<tr class:best={s.zip === data.zip}>
					<td><a href="?zip={s.zip}">{data.names[s.zip]}</a> <span class="muted small-text">{s.zip}</span></td>
					<td class="num">{k(s.value?.value)}</td>
					<td class="num {tone(s.valueYoY)}">{pct(s.valueYoY, 1, true)}</td>
					<td class="num">{k(s.value2bd?.value)}</td>
					<td class="num {tone(s.value2bdYoY)}">{pct(s.value2bdYoY, 1, true)}</td>
					<td class="num">{k(s.sfr?.value)}</td>
					<td class="num">{k(s.condo?.value)}</td>
					<td class="num">{money(s.rent?.value)}</td>
					<td class="num">{pct(s.rentYoY, 1, true)}</td>
					<td class="num {tone(s.forecast12)}" title={s.forecastDate ? `through ${prettyDate(s.forecastDate)}` : ''}>{pct(s.forecast12, 1, true)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
<p class="muted small-text">
	Zillow Home Value Index (typical value, middle third of homes) and Observed Rent Index; data month {prettyDate(data.summary[0]?.value?.date)}.
	Forecast is Zillow's 1-year outlook. Add more zips in Settings.
</p>

<div class="two">
	<div>
		<h2>{data.names[data.zip]} ({data.zip}): values</h2>
		<Chart
			labels={values.labels}
			series={[
				{ label: 'All homes', data: values.data[0], color: '#6cb2ff' },
				{ label: '2-bed', data: values.data[1], color: '#4fd18b' },
				{ label: 'Single-family', data: values.data[2], color: '#f5c04a' },
				{ label: 'Condo', data: values.data[3], color: '#c084fc' }
			]}
			format="usd"
		/>
	</div>
	<div>
		<h2>{data.names[data.zip]}: typical rent</h2>
		<Chart labels={rent.labels} series={[{ label: 'Rent', data: rent.data[0], color: '#6cb2ff' }]} format="usd" />
		{#if data.values.forecast.length}
			<p class="small-text">
				Zillow forecast:
				{#each data.values.forecast as f, i (f.date)}{i ? ' · ' : ''}{pct(f.value, 1, true)} by {monthLabel(f.date)}{/each}
			</p>
		{/if}
	</div>
</div>

<h2>DC metro</h2>
<div class="grid">
	<div class="stat">
		<div class="label">For-sale inventory</div>
		<div class="value">{m.inventory ? Math.round(m.inventory.value).toLocaleString() : '—'}</div>
		<div class="sub"><span class={tone(m.inventoryYoY)}>{pct(m.inventoryYoY, 0, true)}</span> y/y</div>
	</div>
	<div class="stat">
		<div class="label">Median days to pending</div>
		<div class="value">{m.daysToPending?.value ?? '—'}</div>
		<div class="sub"><span class={tone(m.daysYoY)}>{pct(m.daysYoY, 0, true)}</span> y/y</div>
	</div>
	<div class="stat">
		<div class="label">Listings with a price cut</div>
		<div class="value">{m.priceCuts ? pct(m.priceCuts.value * 100, 0) : '—'}</div>
		<div class="sub">year ago {m.priceCutsYearAgo != null ? pct(m.priceCutsYearAgo * 100, 0) : '—'}</div>
	</div>
	<div class="stat">
		<div class="label">Median list price</div>
		<div class="value">{k(m.listPrice?.value)}</div>
		<div class="sub">{pct(m.listPriceYoY, 1, true)} y/y</div>
	</div>
</div>
<div class="two" style="margin-top:0.75rem">
	<Chart labels={metro.labels} series={[{ label: 'Inventory', data: metro.data[0], color: '#6cb2ff' }]} />
	<Chart
		labels={cuts.labels}
		series={[{ label: 'Share with price cut (%)', data: cuts.data[0].map((v) => (v == null ? null : v * 100)), color: '#f5c04a' }]}
		format="pct"
	/>
</div>
<Chart labels={metro.labels} series={[{ label: 'Median days to pending', data: metro.data[1], color: '#4fd18b' }]} height={200} />

<h2>Mortgage rates since 2014 (Freddie Mac)</h2>
<Chart
	labels={rates.labels}
	series={[
		{ label: '30-yr fixed', data: rates.data[0], color: '#6cb2ff' },
		{ label: '15-yr fixed', data: rates.data[1], color: '#4fd18b' }
	]}
	format="pct"
	height={280}
/>
