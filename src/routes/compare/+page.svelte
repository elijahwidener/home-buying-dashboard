<script lang="ts">
	import { enhance } from '$app/forms';
	import { planningPrice, type Config, type HomeType } from '#lib/config.js';
	import { analyze, homeFromArea, rentCost, type Analysis, type HomeInput } from '#lib/finance.js';
	import { k, money, pct } from '#lib/format.js';
import { breakdownSections, show, thirtyYear, THIRTY_ROWS } from '#lib/breakdown.js';
	import Tip from '#lib/components/Tip.svelte';
	import { saveCompare } from '#lib/actions.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Local what-if copies; nothing is saved unless you press Save.
	// svelte-ignore state_referenced_locally
	let rate = $state(data.rates.yours);
	// svelte-ignore state_referenced_locally
	let downPct = $state(data.cfg.loan.downPct);
	// svelte-ignore state_referenced_locally
	let family = $state({ ...data.cfg.family });
	// svelte-ignore state_referenced_locally
	let prices = $state(Object.fromEntries(data.cfg.areas.map((a) => [a.id, planningPrice(a, data.cfg.loan.priceLeanPct)])));
	let custom = $state({ on: false, name: 'Listing', price: 450000, jurisdiction: 'dc', homeType: 'house' as HomeType, hoa: 0, tax: null as number | null, zip: '' });

	const cfg = $derived<Config>({ ...data.cfg, loan: { ...data.cfg.loan, downPct }, family });

	// Which areas are columns: toggled here instantly and saved in the background (same list as the Areas page).
	// svelte-ignore state_referenced_locally
	let shown = $state(new Set(data.cfg.areas.filter((a) => a.enabled).map((a) => a.id)));
	let shownSaved = $state(true);
	async function setShown(next: Set<string>) {
		shown = next;
		shownSaved = await saveCompare(next);
	}
	function toggleShown(id: string) {
		const next = new Set(shown);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		void setShown(next);
	}
	const groups = $derived([
		{ label: 'Finalists', areas: data.cfg.areas.filter((a) => a.status === 'finalist') },
		{ label: 'Close calls', areas: data.cfg.areas.filter((a) => a.status !== 'finalist') }
	]);

	type Col = { id: string; name: string; sub: string; home: HomeInput; zip: string; a: Analysis };
	const cols = $derived.by<Col[]>(() => {
		const out: Col[] = data.cfg.areas
			.filter((x) => shown.has(x.id))
			.map((x) => {
				const home = { ...homeFromArea(x, data.cfg), price: prices[x.id] ?? planningPrice(x, data.cfg.loan.priceLeanPct) };
				return { id: x.id, name: x.name, sub: `${x.beds}bd ${x.homeType} · ${data.cfg.jurisdictions[x.jurisdiction]?.state.toUpperCase()}`, home, zip: x.zip, a: analyze(home, cfg, rate) };
			});
		if (custom.on) {
			const byType = { house: [1800, 1, 2.5], townhouse: [1200, 0.75, 2], condo: [500, 0.5, 1] }[custom.homeType];
			const home: HomeInput = {
				price: custom.price, jurisdiction: custom.jurisdiction, homeType: custom.homeType, hoaMonthly: custom.hoa, extraPropRatePct: 0,
				extraAnnualFees: 0, insuranceAnnual: byType[0], maintenancePct: byType[1], appreciationPct: byType[2], taxAnnualOverride: custom.tax
			};
			out.push({ id: 'custom', name: custom.name || 'Listing', sub: `${custom.homeType} · ${data.cfg.jurisdictions[custom.jurisdiction]?.state.toUpperCase()}`, home, zip: custom.zip, a: analyze(home, cfg, rate) });
		}
		return out;
	});
	const best = $derived(Math.min(...cols.map((c) => c.a.fiveYear.total)));

	const sections = $derived(breakdownSections(data.cfg, best));

	// Which sections show their breakdown rows; remembered in this browser only.
	let open = $state<Record<string, boolean>>({});
	$effect(() => {
		try {
			open = JSON.parse(localStorage.getItem('compare-open') ?? '{}');
		} catch {
			/* storage unavailable */
		}
	});
	function toggle(title: string) {
		open[title] = !open[title];
		try {
			localStorage.setItem('compare-open', JSON.stringify(open));
		} catch {
			/* storage unavailable */
		}
	}

	// Keeping the home for the whole loan (see thirtyYear).
	let open30 = $state(false);
	const thirty = $derived(cols.map((c) => ({ c, ...thirtyYear(c.home, cfg, rate) })));
	const thirtyRows = THIRTY_ROWS;

	const rentRows = $derived(
		cols.map((c) => {
			const rent = c.zip ? data.markets[c.zip]?.rent?.value : undefined;
			if (!rent) return { c, rent: null, r: null };
			return { c, rent, r: rentCost(cfg, c.home.jurisdiction, rent) };
		})
	);

	// Rate sensitivity for the first area.
	const steps = [-1.5, -1, -0.5, 0, 0.5, 1];
	const first = $derived(cols[0]);

	// Gift vs loan vs none for the first area.
	const helpCompare = $derived(
		first
			? (['none', 'gift', 'loan'] as const).map((mode) => ({
					mode,
					a: analyze(first.home, { ...cfg, family: { ...family, mode } }, rate)
				}))
			: []
	);

	const payload = $derived(JSON.stringify({ downPct, family }));

	let picker: HTMLDialogElement;
</script>

<h1>Compare</h1>

<div class="row" style="margin-bottom:0.6rem">
	<button type="button" class="small" onclick={() => picker.showModal()}>Areas shown: {shown.size} ▸</button>
	{#if !shownSaved}<span class="neg small-text">Not saved: is the server up?</span>{/if}
</div>

<dialog bind:this={picker} class="pick">
	<div class="spread" style="margin-bottom:0.5rem">
		<strong>Areas to compare</strong>
		<button type="button" class="small" onclick={() => picker.close()} aria-label="Close">✕</button>
	</div>
	{#each groups as g (g.label)}
		{#if g.areas.length}
			<div class="small-text muted" style="margin:0.4rem 0 0.25rem">{g.label}</div>
			<div class="chips" style="margin:0">
				{#each g.areas as a (a.id)}
					<button type="button" class:on={shown.has(a.id)} onclick={() => toggleShown(a.id)}>{a.name}</button>
				{/each}
			</div>
		{/if}
	{/each}
	<div class="row small-text" style="margin-top:0.75rem">
		<span><strong>{shown.size}</strong> shown</span>
		<button type="button" class="small" onclick={() => setShown(new Set(data.cfg.areas.filter((a) => a.status === 'finalist').map((a) => a.id)))}>All finalists</button>
		<button type="button" class="small" onclick={() => setShown(new Set(data.cfg.areas.map((a) => a.id)))}>Everything</button>
		<button type="button" class="small" onclick={() => setShown(new Set())}>Clear</button>
	</div>
</dialog>

<div class="card">
	<div class="cols-4">
		<label>
			Rate {pct(rate, 3)}
			<input type="range" min="4" max="9" step="0.125" bind:value={rate} />
			<span class="small-text">live est. {pct(data.rates.yours, 3)} · <button class="small" type="button" onclick={() => (rate = data.rates.yours)}>reset</button></span>
		</label>
		<label>Down payment % <input type="number" min="3" max="100" step="1" bind:value={downPct} /></label>
		<label>
			Family help
			<select bind:value={family.mode}>
				<option value="none">None</option>
				<option value="gift">Gift</option>
				<option value="loan">Family loan</option>
			</select>
		</label>
		{#if family.mode !== 'none'}
			<label>Amount <input type="number" step="5000" bind:value={family.amount} /></label>
		{/if}
		{#if family.mode === 'loan'}
			<label>Family rate % <input type="number" step="0.01" bind:value={family.ratePct} /></label>
		{/if}
	</div>
	<form method="POST" action="?/save" use:enhance class="row">
		<input type="hidden" name="json" value={payload} />
		<button class="small">Save down payment & family help</button>
		{#if form?.saved}<span class="pos small-text">Saved</span>{/if}
		<label class="small-text" style="margin:0"><input type="checkbox" bind:checked={custom.on} />Add a listing column</label>
	</form>
	{#if custom.on}
		<div class="cols-4" style="margin-top:0.6rem">
			<label>Name <input bind:value={custom.name} /></label>
			<label>Price <input type="number" step="5000" bind:value={custom.price} /></label>
			<label>
				Where
				<select bind:value={custom.jurisdiction}>
					{#each Object.entries(data.cfg.jurisdictions) as [id, j] (id)}<option value={id}>{j.name}</option>{/each}
				</select>
			</label>
			<label>
				Type
				<select bind:value={custom.homeType}>
					<option value="house">House</option>
					<option value="townhouse">Townhouse</option>
					<option value="condo">Condo</option>
				</select>
			</label>
			<label>HOA / mo <input type="number" step="10" bind:value={custom.hoa} /></label>
			<label>Known yearly tax <input type="number" step="100" bind:value={custom.tax} placeholder="estimate" /></label>
			<label>Zip (for rent) <input bind:value={custom.zip} maxlength="5" /></label>
		</div>
	{/if}
</div>

<div class="table-wrap">
	<table>
		<thead>
			<tr>
				<th></th>
				{#each cols as c (c.id)}
					<th class="num" id={c.id}>
						{c.name}
						<div class="muted small-text">{c.sub}</div>
					</th>
				{/each}
			</tr>
			<tr>
				<td class="label-cell">Price</td>
				{#each cols as c (c.id)}
					<td class="num">
						{#if c.id === 'custom'}
							{k(c.home.price)}
						{:else}
							<input type="number" step="5000" bind:value={prices[c.id]} style="text-align:right;min-width:7rem" />
						{/if}
					</td>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each sections as s (s.title)}
				<tr class="section">
					<th colspan={cols.length + 1}>
						<button type="button" class="disclosure" onclick={() => toggle(s.title)}>
							{open[s.title] ? '▾' : '▸'} {s.title}<span class="muted small-text">{open[s.title] ? 'hide' : 'show'} breakdown</span>
						</button>
					</th>
				</tr>
				{#each s.rows.filter((r) => !r.detail || open[s.title]) as row (row.label)}
					<tr class:detail={row.detail} class:total={row.strong}>
						<td class="label-cell">{row.label}{#if row.hint}<Tip text={row.hint} />{/if}</td>
						{#each cols as c (c.id)}
							{@const v = row.v(c.a)}
							<td class="num" class:pos={row.label === 'vs. cheapest' && v === 0}>
								{row.label === 'vs. cheapest' && v === 0 ? 'cheapest' : show(v, row.f)}
							</td>
						{/each}
					</tr>
				{/each}
			{/each}
			<tr class="section"><th colspan={cols.length + 1}>Buy vs. rent the typical home in the same zip (5 yrs)</th></tr>
			<tr>
				<td class="label-cell">Typical rent (Zillow)</td>
				{#each rentRows as x (x.c.id)}<td class="num">{x.rent ? money(x.rent) + '/mo' : '—'}</td>{/each}
			</tr>
			<tr>
				<td class="label-cell">Renting: rent + taxes</td>
				{#each rentRows as x (x.c.id)}<td class="num">{x.r ? k(x.r.total) : '—'}</td>{/each}
			</tr>
			<tr>
				<td class="label-cell">Buying costs more by</td>
				{#each rentRows as x (x.c.id)}
					{@const d = x.r ? x.c.a.fiveYear.total - x.r.total : null}
					<td class="num" class:pos={d != null && d < 0} class:neg={d != null && d > 0}>{d == null ? '—' : k(d, true)}</td>
				{/each}
			</tr>
			<tr class="section">
				<th colspan={cols.length + 1}>
					<button type="button" class="disclosure" onclick={() => (open30 = !open30)}>
						{open30 ? '▾' : '▸'} Keep it 30 years<span class="muted small-text">{open30 ? 'hide' : 'show'} breakdown</span>
					</button>
				</th>
			</tr>
			{#if open30}
				{#each thirtyRows as r (r.key)}
					{#if thirty.some((t) => t.parts[r.key] > 0)}
						<tr class="detail">
							<td class="label-cell">{r.label}</td>
							{#each thirty as t (t.c.id)}<td class="num">{t.parts[r.key] ? k(t.parts[r.key]) : '—'}</td>{/each}
						</tr>
					{/if}
				{/each}
			{/if}
			<tr class="total">
				<td class="label-cell">
					Total cost, 30 years<Tip text="Everything you'd pay keeping the home until the loan is paid off, with your current down payment and family-help settings. Income taxes and the home's resale value are left out." />
				</td>
				{#each thirty as t (t.c.id)}<td class="num">{k(t.total)}</td>{/each}
			</tr>
			{#if open30}
				<tr class="detail">
					<td class="label-cell">Home value in year 30<Tip text="What the home might be worth then, at your appreciation assumption. Not subtracted from the total." /></td>
					{#each thirty as t (t.c.id)}<td class="num">{k(t.value)}</td>{/each}
				</tr>
			{/if}
		</tbody>
	</table>
</div>
<p class="muted small-text">
	Assumes {data.cfg.profile.filing === 'mfj' ? 'married filing jointly' : 'single'}, {data.cfg.taxYear} tax rules, traditional (pre-tax) 401k/TSP, {data.cfg.loan.sellCostPct}% to sell,
	{data.cfg.loan.investReturnPct}% return on cash otherwise. Edit any of it in <a href="/settings">Settings</a>. Typical rent is for all home sizes in the zip.
</p>

{#if first}
	<div class="two">
		<div>
			<h2>Rate sensitivity: {first.name}</h2>
			<div class="table-wrap">
				<table>
					<thead><tr><th>Rate</th><th class="num">Monthly</th><th class="num">vs now</th><th class="num">5-yr net</th></tr></thead>
					<tbody>
						{#each steps as s (s)}
							{@const a = analyze(first.home, cfg, rate + s)}
							<tr class:best={s === 0}>
								<td>{pct(rate + s, 3)}</td>
								<td class="num">{money(a.monthly.total)}</td>
								<td class="num">{s === 0 ? '—' : money(a.monthly.total - first.a.monthly.total, true)}</td>
								<td class="num">{k(a.fiveYear.total)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="muted small-text">Make sure the payment works at today's rate; treat a later refinance as a bonus.</p>
		</div>
		<div>
			<h2>Family help: {first.name}, {k(family.amount)}</h2>
			<div class="table-wrap">
				<table>
					<thead><tr><th></th><th class="num">Monthly</th><th class="num">Cash needed</th><th class="num">5-yr net</th></tr></thead>
					<tbody>
						{#each helpCompare as h (h.mode)}
							<tr class:best={h.mode === family.mode}>
								<td>{h.mode === 'none' ? 'No help' : h.mode === 'gift' ? 'Gift' : `Loan at ${pct(family.ratePct)}`}</td>
								<td class="num">{money(h.a.monthly.total)}</td>
								<td class="num">{k(h.a.cash.total)}</td>
								<td class="num">{k(h.a.fiveYear.total)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="muted small-text">
				A family loan must charge at least the IRS long-term AFR, be recorded as a second mortgage for the interest to be deductible, and be
				disclosed to your lender. Gifts need a gift letter.
			</p>
		</div>
	</div>
{/if}


<style>
	dialog.pick {
		width: min(640px, calc(100vw - 2rem));
		background: var(--panel);
		color: var(--text);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 1rem;
	}
	dialog.pick::backdrop {
		background: rgba(0, 0, 0, 0.6);
	}
</style>
