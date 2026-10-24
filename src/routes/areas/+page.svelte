<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import AreaMap from '#lib/components/AreaMap.svelte';
	import AreaPanel from '#lib/components/AreaPanel.svelte';
	import PlaceSearch from '#lib/components/PlaceSearch.svelte';
	import Tip from '#lib/components/Tip.svelte';
	import { postAction, saveCompare } from '#lib/actions.js';
	import { bestCommute, MODES, type Mode } from '#lib/mapdata.js';
	import { k, money, pct } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Compare columns: changed here instantly, saved in the background.
	// svelte-ignore state_referenced_locally
	let compare = $state(new Set(data.rows.filter((r) => r.enabled).map((r) => r.id)));
	let saveState = $state<'' | 'saving' | 'saved' | 'error'>('');
	async function setCompare(next: Set<string>) {
		compare = next;
		saveState = 'saving';
		saveState = (await saveCompare(next)) ? 'saved' : 'error';
	}
	function toggleCompare(id: string, on = !compare.has(id)) {
		const next = new Set(compare);
		if (on) next.add(id);
		else next.delete(id);
		void setCompare(next);
	}
	// After a reload (area added, removed or made primary), take the server's list.
	$effect(() => {
		compare = new Set(data.rows.filter((r) => r.enabled).map((r) => r.id));
	});

	// Filters.
	let status = $state({ finalist: true, close: true });
	// One chip per state among your areas (PG split out from MD); false = hidden.
	let states = $state<Record<string, boolean>>({});
	const stateList = $derived([...new Set(data.rows.map((r) => r.state))]);
	let types = $state<Record<string, boolean>>({ house: true, townhouse: true, condo: true });

	type Row = (typeof data.rows)[number];
	type SortKey = 'name' | 'price' | 'monthly' | 'payShare' | 'allIn' | 'five' | 'crime' | Mode | 'effTaxPct';
	let sortKey = $state<SortKey>('five');
	let sortAsc = $state(true);
	function sortBy(key: SortKey) {
		if (sortKey === key) sortAsc = !sortAsc;
		else [sortKey, sortAsc] = [key, true];
	}
	const sortVal = (r: Row, key: SortKey) => ((MODES as string[]).includes(key) ? (r.commute[key as Mode] ?? null) : r[key as keyof Row]);

	const rows = $derived(
		data.rows
			.filter((r) => status[r.status] && states[r.state] !== false && types[r.homeType] !== false)
			.map((r) => ({ ...r, enabled: compare.has(r.id) }))
			.sort((a, b) => {
				const av = sortVal(a, sortKey), bv = sortVal(b, sortKey);
				if (av == null) return 1;
				if (bv == null) return -1;
				const d = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
				return sortAsc ? d : -d;
			})
	);
	const shownIds = $derived(rows.map((r) => r.id));

	// Details panel (and picking a spot on the map for it).
	let panel: AreaPanel;
	let selected = $state<string | null>(null);
	let picking = $state<'' | 'area' | 'place'>('');
	let draft = $state<{ lat: number; lng: number } | null>(null);
	function openArea(id: string) {
		selected = id;
		const r = data.rows.find((x) => x.id === id);
		if (r) panel.open(r);
	}
	$effect(() => {
		const id = page.url.hash.slice(1);
		if (id) untrack(() => data.rows.some((r) => r.id === id) && openArea(id));
	});
	$effect(() => {
		const rs = data.rows;
		untrack(() => {
			for (const r of rs) panel?.refresh(r);
		});
	});
	function onpick(lat: number, lng: number) {
		if (picking === 'area') {
			picking = '';
			panel.setLocation(lat, lng);
		} else if (picking === 'place') {
			draft = { lat, lng };
			picking = '';
		}
	}

	// Commute place: pick, add, remove.
	let placeMsg = $state('');
	let adding = $state(false);
	let newName = $state('');
	let mapRef: AreaMap;
	async function choosePlace(id: number) {
		placeMsg = (await postAction('?/place', { id })) ?? '';
		await invalidateAll();
	}
	async function savePlace() {
		if (!draft) return (placeMsg = 'Search for the place or drop a pin first.');
		placeMsg = (await postAction('?/addPlace', { name: newName.trim() || 'New place', lat: draft.lat, lng: draft.lng })) ?? '';
		if (!placeMsg) {
			adding = false;
			draft = null;
			newName = '';
		}
		await invalidateAll();
	}
	let confirmPlaceRemove = $state(false);
	async function removePlace() {
		if (!data.place) return;
		placeMsg = (await postAction('?/removePlace', { id: data.place.id })) ?? '';
		confirmPlaceRemove = false;
		await invalidateAll();
	}

	// Live progress while the trip planner works.
	// svelte-ignore state_referenced_locally
	let progress = $state(data.progress);
	let plannerRunning = $state(false);
	$effect(() => {
		progress = data.progress;
	});
	const active = $derived(progress.running || data.planner.building);
	$effect(() => {
		if (!active) return;
		let stop = false;
		let lastDone = 0;
		const tick = async () => {
			if (stop) return;
			try {
				const s = await (await fetch('/api/commute')).json();
				const wasRunning = progress.running;
				progress = s.progress;
				plannerRunning = s.planner.running;
				// Refresh the table as times come in, and once at the end.
				if ((wasRunning && !s.progress.running) || (s.progress.stage === 'areas' && s.progress.done - lastDone >= 15)) {
					lastDone = s.progress.done;
					await invalidateAll();
				}
			} catch {
				/* try again */
			}
			if (!stop) setTimeout(tick, 3000);
		};
		const t = setTimeout(tick, 1500);
		return () => {
			stop = true;
			clearTimeout(t);
		};
	});

	const crimeTone = (r: Row) => (r.crime == null || r.countyCrime == null ? '' : r.crime > r.countyCrime ? 'neg' : 'pos');
	const cols: { key: SortKey; label: string; tip?: string }[] = [
		{ key: 'price', label: 'Price', tip: 'The price every cost uses: the typical 3-bed sale price, leaned toward the low end of the range (Settings), because typical prices mix fixer-uppers with renovated homes. Small print: the range from recent sales.' },
		{ key: 'monthly', label: 'Monthly', tip: 'Mortgage, property tax, HOA, insurance (and PMI if under 20% down) at the typical price. Small print: at the low and high prices.' },
		{ key: 'payShare', label: '% of pay', tip: 'Monthly payment as a share of the gross pay counted for the loan. Lenders like 28% or less.' },
		{ key: 'allIn', label: 'Yr-1 all-in', tip: 'Interest, PMI, property tax, HOA, insurance, upkeep, plus every income and car tax for both of you, first year.' },
		{ key: 'five', label: '5-yr cost', tip: 'Buying, owning 5 years and selling: closing, selling and opportunity costs, minus sale proceeds, plus income taxes.' },
		{ key: 'crime', label: 'Crime', tip: 'Violent crimes per 1,000 residents per year: 2026 (Jan–Sep, scaled) where available, else 2024–25. Green = below the county average, red = above.' },
		{ key: 'transit', label: 'Transit', tip: 'Minutes door to door by walking, bus and rail, arriving by your set time on a weekday. From the local trip planner, using real schedules.' },
		{ key: 'parkride', label: 'Park & ride', tip: 'Drive to a station with parking, then transit. Driving time is scaled up for rush hour (Settings).' },
		{ key: 'drive', label: 'Drive', tip: 'Driving the whole way, scaled up for rush hour, plus a few minutes to park and walk in. No live traffic data.' },
		{ key: 'effTaxPct', label: 'Prop. tax', tip: "Effective property-tax rate: first-year tax ÷ price. DC's homestead deduction makes its 0.85% rate lower in practice." }
	];
	const arrow = (key: SortKey) => (sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '');
	const mins = (v: number | null | undefined) => (v === undefined ? '…' : v === null ? 'none' : `${Math.round(v)}`);
</script>

<div class="spread">
	<h1>Areas</h1>
	<button type="button" class="small" onclick={() => panel.open(null)}>+ Add area</button>
</div>

<div class="card placebar">
	<div class="row">
		<label class="inline">
			<span class="muted small-text">Commute to</span>
			<select value={data.place?.id} onchange={(e) => choosePlace(Number(e.currentTarget.value))}>
				{#each data.places as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
		</label>
		<button type="button" class="small" onclick={() => ((adding = !adding), (draft = null), (picking = ''))}>{adding ? 'Cancel' : '+ New place'}</button>
		{#if data.places.length > 1}
			{#if confirmPlaceRemove}
				<button type="button" class="small danger" onclick={removePlace}>Delete "{data.place?.name.split(',')[0]}"?</button>
				<button type="button" class="small" onclick={() => (confirmPlaceRemove = false)}>Keep</button>
			{:else}
				<button type="button" class="small" onclick={() => (confirmPlaceRemove = true)}>Delete place</button>
			{/if}
		{/if}
		<span class="muted small-text">arrive by {data.commute.arriveBy} on a weekday · <a href="/settings#planner">settings</a></span>
	</div>

	{#if adding}
		<div class="newplace">
			<div class="cols-2">
				<label>Name <input bind:value={newName} placeholder="e.g. Pentagon, Spouse's office" /></label>
				<div>
					<div class="small-text muted" style="margin-bottom:0.25rem">Where</div>
					<PlaceSearch
						onpick={(name, lat, lng) => {
							draft = { lat, lng };
							if (!newName) newName = name.split(',')[0];
							mapRef?.flyTo(lat, lng);
						}}
					/>
				</div>
			</div>
			<div class="row">
				<button type="button" class="small" class:on={picking === 'place'} onclick={() => (picking = picking === 'place' ? '' : 'place')}>
					{picking === 'place' ? 'Click the map…' : 'Drop a pin instead'}
				</button>
				<span class="small-text muted">{draft ? `Spot: ${draft.lat.toFixed(4)}, ${draft.lng.toFixed(4)}` : 'No spot yet'}</span>
				<button type="button" class="primary small" onclick={savePlace} disabled={!draft}>Save & compute</button>
			</div>
			<p class="muted small-text" style="margin:0.3rem 0 0">
				Saving starts the trip planner: area times take a few minutes, the map bands 10–20 more. It shuts down when done, and the place stays in the list.
			</p>
		</div>
	{/if}

	{#if !data.planner.built}
		<div class="warn-box small-text" style="margin:0.5rem 0 0">
			{data.planner.building ? 'The trip planner is being built (Settings shows progress). Commute times fill in after.' : 'Commute times need the trip planner, which is not set up yet.'}
			<a href="/settings#planner">Settings → Trip planner</a>
		</div>
	{:else if progress.running}
		<div class="small-text progress">
			<span class="spin"></span>
			{#if progress.total}
				Computing {progress.stage} for {progress.placeName.split(',')[0]}: {progress.done} / {progress.total}
			{:else}
				{plannerRunning ? 'Working…' : 'Starting the trip planner (a minute or two)…'}
			{/if}
			<div class="bar"><div style:width="{progress.total ? (progress.done / progress.total) * 100 : 3}%"></div></div>
		</div>
	{:else if progress.error}
		<div class="error-box small-text" style="margin:0.5rem 0 0">Commute computing stopped: {progress.error}</div>
	{/if}
	{#if placeMsg}<div class="neg small-text">{placeMsg}</div>{/if}
</div>

{#if picking === 'area'}
	<div class="alert">
		Click the map where the area is.
		<button type="button" class="small" onclick={() => ((picking = ''), panel.reopen())}>Cancel</button>
	</div>
{/if}

<AreaMap
	bind:this={mapRef}
	areas={rows}
	listings={data.listings}
	place={data.place}
	grids={data.grids}
	height="min(58vh, 520px)"
	bind:selected
	onopen={openArea}
	ontoggle={toggleCompare}
	picking={!!picking}
	{onpick}
	{draft}
/>

<div class="chips" style="margin-bottom:0.5rem">
	<button type="button" class:on={status.finalist} onclick={() => (status.finalist = !status.finalist)}>Finalists</button>
	<button type="button" class:on={status.close} onclick={() => (status.close = !status.close)}>Close calls</button>
	<span class="muted">·</span>
	{#each stateList as s (s)}
		<button type="button" class:on={states[s] !== false} onclick={() => (states[s] = states[s] === false)}>{s}</button>
	{/each}
	<span class="muted">·</span>
	{#each Object.keys(types) as t (t)}
		<button type="button" class:on={types[t]} onclick={() => (types[t] = !types[t])}>{t}</button>
	{/each}
</div>

<div class="spread small-text" style="margin-bottom:0.4rem">
	<span>
		<strong>{compare.size}</strong> of {data.rows.length} on Compare ·
		<button type="button" class="small" onclick={() => setCompare(new Set(data.rows.filter((r) => r.status === 'finalist').map((r) => r.id)))}>Finalists</button>
		<button type="button" class="small" onclick={() => setCompare(new Set([...compare, ...shownIds]))}>+ All shown</button>
		<button type="button" class="small" onclick={() => setCompare(new Set())}>None</button>
	</span>
	<span class={saveState === 'error' ? 'neg' : 'muted'}>
		{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved: is the server up?' : 'Click a row for details and notes'}
	</span>
</div>

<div class="table-wrap">
	<table>
		<thead>
			<tr>
				<th title="Show as a column on Compare">Cmp</th>
				<th><button type="button" class="sort" onclick={() => sortBy('name')}>Area{arrow('name')}</button></th>
				{#each cols as c (c.key)}
					<th class="num">
						<button type="button" class="sort" onclick={() => sortBy(c.key)}>{c.label}{arrow(c.key)}</button>{#if c.tip}<Tip text={c.tip} />{/if}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as r (r.id)}
				{@const best = bestCommute(r.commute)}
				<tr id="row-{r.id}" class:sel={selected === r.id} onclick={() => openArea(r.id)}>
					<td><input type="checkbox" checked={r.enabled} onclick={(e) => e.stopPropagation()} onchange={(e) => toggleCompare(r.id, e.currentTarget.checked)} aria-label="Compare {r.name}" /></td>
					<td>
						<strong>{r.name}</strong>{#if r.area.notes.trim()}<span class="note" title="Has notes">✎</span>{/if}
						<div class="muted small-text">
							<span class="pill" class:live={r.status === 'finalist'}>{r.status === 'finalist' ? 'Finalist' : 'Close call'}</span>
							{r.state} · {r.homeType} · {r.zip}{#if data.primaryId === r.id} · <span class="pos">primary</span>{/if}
						</div>
					</td>
					<td class="num" title="Typical sale {k(r.typical)}; costs use {k(r.price)}">{k(r.price)}<div class="muted small-text">{k(r.priceLow)}–{k(r.priceHigh)}</div></td>
					<td class="num">{money(r.monthly)}<div class="muted small-text">{k(r.monthlyLow)}–{k(r.monthlyHigh)}</div></td>
					<td class="num" class:neg={r.payShare > 0.28}>{pct(r.payShare * 100, 0)}</td>
					<td class="num">{k(r.allIn)}</td>
					<td class="num">{k(r.five)}</td>
					<td class="num">
						<span class={crimeTone(r)}>{r.crime?.toFixed(2) ?? '—'}</span>
						<div class="muted small-text">{r.crimeYear}{r.countyCrime != null ? ` · avg ${r.countyCrime.toFixed(2)}` : ''}</div>
					</td>
					{#each MODES as m (m)}
						<td class="num" class:fast={best?.mode === m}>{mins(r.commute[m])}{#if r.commute[m] != null}<span class="muted small-text">&nbsp;min</span>{/if}</td>
					{/each}
					<td class="num">{pct(r.effTaxPct, 2)}</td>
				</tr>
			{:else}
				<tr><td colspan={cols.length + 2} class="muted">No areas match these filters.</td></tr>
			{/each}
		</tbody>
	</table>
</div>
<p class="muted small-text">
	At {pct(data.rate, 3)} with your down payment and family-help settings. % of pay is against {money(data.loanPay)}/yr (25% = {money((data.loanPay * 0.25) / 12)}/mo, 28% =
	{money((data.loanPay * 0.28) / 12)}/mo). Commutes go to {data.place?.name ?? 'your place'}, arriving by {data.commute.arriveBy}{data.planner.serviceDate
		? ` (timetables for ${data.planner.serviceDate})`
		: ''}; bold = fastest. Crime is compared with each jurisdiction's average from Settings → Tax tables.
</p>

<AreaPanel
	bind:this={panel}
	jurisdictions={data.jurisdictions}
	placeName={data.place?.name ?? 'work'}
	primaryId={data.primaryId}
	onchange={() => invalidateAll()}
	onpickrequest={() => (picking = 'area')}
/>

<style>
	.sort {
		background: none;
		border: 0;
		padding: 0;
		color: inherit;
		font: inherit;
		cursor: pointer;
		white-space: nowrap;
	}
	td:nth-child(2) {
		min-width: 14rem;
	}
	tr.sel td {
		background: var(--panel-2);
	}
	tbody tr {
		cursor: pointer;
	}
	td.fast {
		font-weight: 700;
	}
	.note {
		color: var(--muted);
		margin-left: 0.35rem;
		font-size: 0.85rem;
	}
	.placebar .inline {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
	}
	.placebar select {
		width: auto;
		max-width: 22rem;
		margin: 0;
	}
	.newplace {
		margin-top: 0.6rem;
		border-top: 1px solid var(--line);
		padding-top: 0.6rem;
	}
	button.on {
		border-color: var(--accent);
		color: var(--accent);
	}
	.progress {
		margin-top: 0.5rem;
	}
	.spin {
		display: inline-block;
		width: 0.7rem;
		height: 0.7rem;
		border: 2px solid var(--line);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
		vertical-align: -1px;
		margin-right: 0.3rem;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
