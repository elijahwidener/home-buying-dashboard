<script lang="ts">
	import { enhance } from '$app/forms';
	import { k, money, pct, prettyDate } from '#lib/format.js';
	import { breakdownSections, show, THIRTY_ROWS } from '#lib/breakdown.js';
	import Tip from '#lib/components/Tip.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const l = $derived(data.l);
	const a = $derived(data.a);
	const m = $derived(data.market);
	const sections = $derived(breakdownSections(data.cfg));
	let open = $state<Record<string, boolean>>({});

	function confirmDelete(e: MouseEvent) {
		if (!confirm('Delete this listing?')) e.preventDefault();
	}
</script>

<a href="/listings" class="small-text">← Listings</a>
<h1>{l.address}</h1>
<p class="muted" style="margin-top:-0.5rem">
	{l.city}
	{l.state}
	{l.zip} · {l.beds ?? '?'}bd/{l.baths ?? '?'}ba{l.sqft ? ` · ${l.sqft.toLocaleString()} sq ft` : ''}{l.year_built ? ` · built ${l.year_built}` : ''}
	{#if l.url}· <a href={l.url} target="_blank" rel="noopener noreferrer">listing ↗</a>{/if}
</p>

{#if form?.error}<div class="error-box">{form.error}</div>{/if}

<div class="grid">
	<div class="stat">
		<div class="label">Price</div>
		<div class="value">{k(l.price)}</div>
		<div class="sub">{l.sqft ? money(l.price / l.sqft) + '/sq ft' : ''}</div>
	</div>
	<div class="stat">
		<div class="label">Monthly at {pct(data.rate)}</div>
		<div class="value">{money(a.monthly.total)}</div>
		<div class="sub">{Math.round(a.dti.loanIncome * 100)}% of loan income</div>
	</div>
	<div class="stat">
		<div class="label">Cash to close</div>
		<div class="value">{k(a.cash.total)}</div>
		<div class="sub">incl. {k(a.cash.reserves)} reserves</div>
	</div>
	<div class="stat">
		<div class="label">Year-1 all-in</div>
		<div class="value">{k(a.year1.allIn)}</div>
		<div class="sub">5-yr net {k(a.fiveYear.total)}</div>
	</div>
	{#if m?.value}
		<div class="stat">
			<div class="label">Zip typical value</div>
			<div class="value">{k(m.value.value)}</div>
			<div class="sub">2-bed {k(m.value2bd?.value)} · {pct(m.valueYoY, 1, true)} y/y</div>
		</div>
	{/if}
</div>

<div class="two">
	<div>
		<h2>Monthly breakdown</h2>
		<div class="table-wrap">
			<table>
				<tbody>
					<tr><td>Principal & interest</td><td class="num">{money(a.monthly.pi)}</td></tr>
					{#if a.monthly.family}<tr><td>Family loan</td><td class="num">{money(a.monthly.family)}</td></tr>{/if}
					<tr><td>Property tax {l.tax_annual ? '' : '(est.)'}</td><td class="num">{money(a.monthly.propertyTax)}</td></tr>
					<tr><td>HOA & fees</td><td class="num">{money(a.monthly.hoa)}</td></tr>
					<tr><td>Insurance (est.)</td><td class="num">{money(a.monthly.insurance)}</td></tr>
					{#if a.monthly.pmi}<tr><td>PMI</td><td class="num">{money(a.monthly.pmi)}</td></tr>{/if}
					<tr><td><strong>Total</strong></td><td class="num"><strong>{money(a.monthly.total)}</strong></td></tr>
				</tbody>
			</table>
		</div>
		<p class="muted small-text">
			Year-1 income taxes here: federal {k(a.year1.taxes.federal)}, state {k(a.year1.taxes.state)}{a.year1.taxes.local
				? `, county ${k(a.year1.taxes.local)}`
				: ''}{a.year1.taxes.car ? `, car ${k(a.year1.taxes.car)}` : ''}.
		</p>

		<h2>Price history</h2>
		<div class="table-wrap">
			<table>
				<tbody>
					{#each data.prices as p, i (p.date)}
						<tr>
							<td>{prettyDate(p.date)}</td>
							<td class="num">{money(p.price)}</td>
							<td class="num {i === 0 ? 'muted' : p.price < data.prices[i - 1].price ? 'pos' : 'neg'}">
								{i === 0 ? 'first seen' : k(p.price - data.prices[i - 1].price, true)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="muted small-text">
			Days on market at last import: {l.dom ?? '—'}. Homes that have sat are where to ask for seller credits toward a rate buydown.
		</p>
	</div>

	<form method="POST" action="?/save" use:enhance class="card" style="margin-top:2.2rem">
		{#if form?.saved}<div class="alert good">Saved.</div>{/if}
		<div class="cols-3">
			<label>Price <input name="price" inputmode="decimal" value={l.price} /></label>
			<label>HOA / mo <input name="hoa" inputmode="decimal" value={l.hoa} /></label>
			<label>Yearly tax <input name="tax_annual" inputmode="decimal" value={l.tax_annual ?? ''} placeholder="estimate" /></label>
			<label>Beds <input name="beds" inputmode="decimal" value={l.beds ?? ''} /></label>
			<label>Baths <input name="baths" inputmode="decimal" value={l.baths ?? ''} /></label>
			<label>
				Type
				<select name="home_type" value={l.home_type}>
					<option value="house">House</option>
					<option value="townhouse">Townhouse</option>
					<option value="condo">Condo</option>
				</select>
			</label>
		</div>
		<div class="cols-2">
			<label>
				Jurisdiction
				<select name="jurisdiction" value={l.jurisdiction}>
					{#each Object.entries(data.jurisdictions) as [id, j] (id)}<option value={id}>{j.name}</option>{/each}
				</select>
			</label>
			<label>
				Stage
				<select name="stage" value={l.stage}>
					<option value="watching">Watching</option>
					<option value="toured">Toured</option>
					<option value="offer">Offer</option>
					<option value="passed">Passed</option>
				</select>
			</label>
		</div>
		<label>Link <input name="url" value={l.url} /></label>
		<label>Notes <textarea name="notes" placeholder="Roof and HVAC age, walk to Metro, inspection notes">{l.notes}</textarea></label>
		<label><input type="checkbox" name="starred" checked={!!l.starred} />Star</label>
		<div class="spread">
			<button class="primary">Save</button>
			<button class="danger small" formaction="?/delete" onclick={confirmDelete}>Delete</button>
		</div>
	</form>
</div>

<details class="card breakdown">
	<summary>Full cost breakdown</summary>
	<div class="table-wrap" style="margin-top:0.6rem">
		<table>
			<tbody>
				{#each sections as s (s.title)}
					<tr class="section">
						<th colspan="2">
							<button type="button" class="disclosure" onclick={() => (open[s.title] = !open[s.title])}>
								{open[s.title] ? '▾' : '▸'} {s.title}<span class="muted small-text">{open[s.title] ? 'hide' : 'show'} breakdown</span>
							</button>
						</th>
					</tr>
					{#each s.rows.filter((r) => !r.detail || open[s.title]) as row (row.label)}
						{@const v = row.v(a)}
						{#if !(row.detail && v == null)}
							<tr class:detail={row.detail} class:total={row.strong}>
								<td class="label-cell">{row.label}{#if row.hint}<Tip text={row.hint} />{/if}</td>
								<td class="num">{show(v, row.f)}</td>
							</tr>
						{/if}
					{/each}
				{/each}

				<tr class="section">
					<th colspan="2">
						<button type="button" class="disclosure" onclick={() => (open.thirty = !open.thirty)}>
							{open.thirty ? '▾' : '▸'} 30 years, keeping it<span class="muted small-text">{open.thirty ? 'hide' : 'show'} breakdown</span>
						</button>
					</th>
				</tr>
				{#if open.thirty}
					{#each THIRTY_ROWS.filter((r) => data.thirty.parts[r.key] > 0) as r (r.key)}
						<tr class="detail"><td class="label-cell">{r.label}</td><td class="num">{k(data.thirty.parts[r.key])}</td></tr>
					{/each}
				{/if}
				<tr class="total"><td class="label-cell">Total cost, 30 years</td><td class="num">{k(data.thirty.total)}</td></tr>
				<tr class="detail">
					<td class="label-cell">Home value in year 30<Tip text="What the home might be worth then, at your appreciation assumption. Not subtracted from the total." /></td>
					<td class="num">{k(data.thirty.value)}</td>
				</tr>

				{#if data.rent}
					<tr class="section"><th colspan="2">Buy vs. rent the typical home in {l.zip} (5 yrs)</th></tr>
					<tr><td class="label-cell">Typical rent (Zillow)</td><td class="num">{money(data.rent.monthly)}/mo</td></tr>
					<tr><td class="label-cell">Renting: rent + taxes</td><td class="num">{k(data.rent.total)}</td></tr>
					{@const d = a.fiveYear.total - data.rent.total}
					<tr class="total">
						<td class="label-cell">Buying costs more by</td>
						<td class="num" class:pos={d < 0} class:neg={d > 0}>{k(d, true)}</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>
	<p class="muted small-text">
		Same math as <a href="/compare">Compare</a>, at {pct(data.rate, 3)} with your saved down payment and family-help settings.
		{l.tax_annual ? 'Uses the listed property tax bill for year 1.' : 'Property tax is estimated; enter the real bill above for a better number.'}
	</p>
</details>
