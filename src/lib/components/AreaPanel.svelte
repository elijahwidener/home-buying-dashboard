<script lang="ts">
	// Details for one area: notes, the numbers, research, and an editor. Also used to add a new area.
	import { AREA_TEMPLATE, type Area } from '#lib/config.js';
	import { postAction } from '#lib/actions.js';
	import { bestCommute, MODE_LABEL, MODES, type Commute } from '#lib/mapdata.js';
	import { k, money, pct } from '#lib/format.js';
	import PlaceSearch from './PlaceSearch.svelte';

	export interface PanelRow {
		area: Area;
		/** Planning price: what the costs use. */
		price: number;
		monthly: number;
		monthlyLow: number;
		monthlyHigh: number;
		five: number;
		allIn: number;
		payShare: number;
		effTaxPct: number;
		crime: number | null;
		crimeYear: string;
		countyCrime: number | null;
		commute: Commute;
		jurisdiction: string;
	}

	interface Props {
		jurisdictions: { id: string; name: string }[];
		placeName: string;
		primaryId: string | null;
		/** After anything is saved or removed (parent reloads data). */
		onchange: () => void;
		/** The editor wants a spot picked on the map: the panel hides itself until setLocation is called. */
		onpickrequest: () => void;
	}
	let { jurisdictions, placeName, primaryId, onchange, onpickrequest }: Props = $props();

	let dlg: HTMLDialogElement;
	let row = $state<PanelRow | null>(null);
	let form = $state<Area>({ ...AREA_TEMPLATE });
	let notes = $state('');
	let savedNotes = $state('');
	let editing = $state(false);
	let confirmRemove = $state(false);
	let msg = $state('');
	let busy = $state(false);
	const isNew = $derived(!row);

	/** Open for an existing area, or for a new one (row = null). */
	export function open(r: PanelRow | null) {
		row = r;
		form = structuredClone($state.snapshot(r?.area) ?? { ...AREA_TEMPLATE, name: '', price: 0, notes: '' });
		notes = savedNotes = r?.area.notes ?? '';
		editing = !r;
		confirmRemove = false;
		msg = '';
		dlg.showModal();
	}
	/** Called by the parent after a map pick; reopens the panel. */
	export function setLocation(lat: number, lng: number) {
		form.lat = Math.round(lat * 1e5) / 1e5;
		form.lng = Math.round(lng * 1e5) / 1e5;
		editing = true;
		dlg.showModal();
	}
	/** Back to the editor without changing the location (picking was cancelled). */
	export function reopen() {
		editing = true;
		dlg.showModal();
	}
	export function close() {
		dlg.close();
	}
	/** Refresh the numbers after a reload, keeping any unsaved edits. */
	export function refresh(r: PanelRow | undefined) {
		if (row && r && r.area.id === row.area.id) row = r;
	}

	async function saveNotes() {
		if (!row || notes === savedNotes) return;
		const err = await postAction('/areas?/saveNotes', { id: row.area.id, notes });
		if (err) msg = err;
		else {
			savedNotes = notes;
			onchange();
		}
	}

	async function save() {
		busy = true;
		msg = '';
		const body = { ...$state.snapshot(form), notes: isNew ? notes : savedNotes };
		const err = await postAction('/areas?/saveArea', { json: JSON.stringify(body) });
		busy = false;
		if (err) {
			msg = err;
			return;
		}
		onchange();
		if (isNew) dlg.close();
		else editing = false;
	}

	async function remove() {
		if (!row) return;
		const err = await postAction('/areas?/removeArea', { id: row.area.id });
		if (err) msg = err;
		else {
			dlg.close();
			onchange();
		}
	}

	async function makePrimary() {
		if (!row) return;
		const err = await postAction('/areas?/primary', { id: row.area.id });
		if (err) msg = err;
		else onchange();
	}

	function pickOnMap() {
		dlg.close();
		onpickrequest();
	}

	const best = $derived(row ? bestCommute(row.commute) : null);
	const numIn = (v: number | null) => (v == null ? '' : String(v));
	const numOut = (s: string, nullable = false): number | null => {
		const t = s.replace(/[$,\s]/g, '');
		if (t === '') return nullable ? null : 0;
		const n = Number(t);
		return Number.isFinite(n) ? n : nullable ? null : 0;
	};
</script>

<dialog bind:this={dlg} onclose={() => void saveNotes()}>
	<div class="head">
		<div>
			<strong class="title">{isNew ? 'Add an area' : row?.area.name}</strong>
			{#if row}
				<div class="muted small-text">
					<span class="pill" class:live={row.area.status === 'finalist'}>{row.area.status === 'finalist' ? 'Finalist' : 'Close call'}</span>
					{row.jurisdiction} · {row.area.homeType} · {row.area.zip}
					{#if primaryId === row.area.id}· <span class="pos">primary pick</span>{/if}
				</div>
			{/if}
		</div>
		<button type="button" class="small" onclick={() => dlg.close()} aria-label="Close">✕</button>
	</div>

	{#if msg}<div class="error-box">{msg}</div>{/if}

	<label>
		Notes
		<textarea rows="6" bind:value={notes} onblur={saveNotes} placeholder="Anything: what you liked, streets to avoid, open-house dates, questions for the agent…"></textarea>
	</label>
	{#if row}
		<div class="small-text muted" style="margin:-0.3rem 0 0.6rem">{notes === savedNotes ? 'Saved' : 'Saves when you click away'}</div>
	{/if}

	{#if row}
		<div class="facts">
			<div>
				<span class="muted">Price</span>{k(row.price)}
				<span class="muted small-text">typical {k(row.area.price)} · {k(row.area.priceLow)}–{k(row.area.priceHigh)}</span>
			</div>
			<div><span class="muted">Monthly</span>{money(row.monthly)} <span class="muted small-text">({k(row.monthlyLow)}–{k(row.monthlyHigh)})</span></div>
			<div><span class="muted">% of pay</span>{pct(row.payShare * 100, 0)}</div>
			<div><span class="muted">Yr-1 all-in</span>{k(row.allIn)}</div>
			<div><span class="muted">5-yr cost</span>{k(row.five)}</div>
			<div><span class="muted">Property tax</span>{pct(row.effTaxPct, 2)} effective</div>
			<div>
				<span class="muted">Crime</span>{row.crime?.toFixed(2) ?? '—'}
				<span class="muted small-text">{row.crimeYear}{row.countyCrime != null ? ` · county ${row.countyCrime.toFixed(2)}` : ''}</span>
			</div>
			<div><span class="muted">Metro</span>{row.area.metroLine || '—'}</div>
		</div>
		<div class="commute">
			<span class="muted small-text">To {placeName.split(',')[0]}, door to door:</span>
			{#each MODES as m (m)}
				<span class:best={best?.mode === m}>{MODE_LABEL[m]} {row.commute[m] != null ? `${Math.round(row.commute[m]!)} min` : row.commute[m] === null ? 'no route' : '…'}</span>
			{/each}
		</div>
		{#if row.area.rideMin != null || row.area.commuteMin}
			<div class="small-text muted">
				Your research: {row.area.station ? `${row.area.station} station, ` : ''}{row.area.rideMin != null ? `${row.area.rideMin} min ride to Metro Center, ` : ''}~{row.area.commuteMin} min door to door.
			</div>
		{/if}
	{/if}

	{#if !isNew}
		<button type="button" class="disclosure" onclick={() => (editing = !editing)}>{editing ? '▾' : '▸'} Edit details</button>
	{/if}

	{#if editing}
		<div class="cols-4 edit">
			<label class="wide">Name <input bind:value={form.name} /></label>
			<label>
				Status
				<select bind:value={form.status}>
					<option value="finalist">Finalist</option>
					<option value="close">Close call</option>
				</select>
			</label>
			<label>
				Home type
				<select bind:value={form.homeType}>
					<option value="house">House</option>
					<option value="townhouse">Townhouse / rowhouse</option>
					<option value="condo">Condo</option>
				</select>
			</label>
			<label>
				Tax area
				<select bind:value={form.jurisdiction}>
					{#each jurisdictions as j (j.id)}<option value={j.id}>{j.name}</option>{/each}
				</select>
			</label>
			<label>Zip <input bind:value={form.zip} maxlength="5" inputmode="numeric" /></label>
			<label>Typical price <input inputmode="decimal" value={numIn(form.price)} onchange={(e) => (form.price = numOut(e.currentTarget.value)!)} /></label>
			<label>Price low <input inputmode="decimal" value={numIn(form.priceLow)} onchange={(e) => (form.priceLow = numOut(e.currentTarget.value)!)} /></label>
			<label>Price high <input inputmode="decimal" value={numIn(form.priceHigh)} onchange={(e) => (form.priceHigh = numOut(e.currentTarget.value)!)} /></label>
			<label>HOA / mo <input inputmode="decimal" value={numIn(form.hoaMonthly)} onchange={(e) => (form.hoaMonthly = numOut(e.currentTarget.value)!)} /></label>
			<label>Crime 2024–25 <input inputmode="decimal" placeholder="unknown" value={numIn(form.crime)} onchange={(e) => (form.crime = numOut(e.currentTarget.value, true))} /></label>
			<label>Crime 2026 <input inputmode="decimal" placeholder="unknown" value={numIn(form.crime2026)} onchange={(e) => (form.crime2026 = numOut(e.currentTarget.value, true))} /></label>
			<label>Metro line <input bind:value={form.metroLine} /></label>
			<label>Nearest station <input bind:value={form.station} /></label>
		</div>

		<div class="loc">
			<div class="small-text"><strong>Location</strong> <span class="muted">(center of the area; commute times are measured from here)</span></div>
			<div class="row">
				<span class="small-text">{form.lat?.toFixed(4)}, {form.lng?.toFixed(4)}</span>
				<button type="button" class="small" onclick={pickOnMap}>Pick on map</button>
			</div>
			<PlaceSearch
				placeholder="Or search the neighborhood or an address in it"
				onpick={(_, lat, lng) => {
					form.lat = Math.round(lat * 1e5) / 1e5;
					form.lng = Math.round(lng * 1e5) / 1e5;
				}}
			/>
		</div>

		<details>
			<summary class="small-text">More: beds, insurance, upkeep, appreciation, extra fees, your commute research</summary>
			<div class="cols-4">
				<label>Beds <input inputmode="decimal" value={numIn(form.beds)} onchange={(e) => (form.beds = numOut(e.currentTarget.value)!)} /></label>
				<label>Insurance / yr <input inputmode="decimal" value={numIn(form.insuranceAnnual)} onchange={(e) => (form.insuranceAnnual = numOut(e.currentTarget.value)!)} /></label>
				<label>Upkeep % / yr <input inputmode="decimal" value={numIn(form.maintenancePct)} onchange={(e) => (form.maintenancePct = numOut(e.currentTarget.value)!)} /></label>
				<label>Appreciation % / yr <input inputmode="decimal" value={numIn(form.appreciationPct)} onchange={(e) => (form.appreciationPct = numOut(e.currentTarget.value)!)} /></label>
				<label>Extra yearly fees <input inputmode="decimal" value={numIn(form.extraAnnualFees)} onchange={(e) => (form.extraAnnualFees = numOut(e.currentTarget.value)!)} /></label>
				<label>Extra prop. tax % <input inputmode="decimal" value={numIn(form.extraPropRatePct)} onchange={(e) => (form.extraPropRatePct = numOut(e.currentTarget.value)!)} /></label>
				<label>Ride to Metro Center (min) <input inputmode="decimal" placeholder="none" value={numIn(form.rideMin)} onchange={(e) => (form.rideMin = numOut(e.currentTarget.value, true))} /></label>
				<label>Door-to-door to work (min) <input inputmode="decimal" value={numIn(form.commuteMin)} onchange={(e) => (form.commuteMin = numOut(e.currentTarget.value)!)} /></label>
			</div>
		</details>

		<div class="row" style="margin-top:0.6rem">
			<button type="button" class="primary" onclick={save} disabled={busy}>{busy ? 'Saving…' : isNew ? 'Add area' : 'Save changes'}</button>
			{#if !isNew}<button type="button" class="small" onclick={() => (editing = false)}>Cancel</button>{/if}
		</div>
	{/if}

	{#if row}
		<div class="foot">
			{#if primaryId !== row.area.id}
				<button type="button" class="small" onclick={makePrimary} title="The primary pick sets the savings goal on Overview">Make primary pick</button>
			{/if}
			{#if confirmRemove}
				<span class="small-text">Remove {row.area.name} from the list?</span>
				<button type="button" class="small danger" onclick={remove}>Yes, remove</button>
				<button type="button" class="small" onclick={() => (confirmRemove = false)}>Keep</button>
			{:else}
				<button type="button" class="small danger" onclick={() => (confirmRemove = true)}>Remove area</button>
			{/if}
		</div>
	{/if}
</dialog>

<style>
	dialog {
		width: min(760px, calc(100vw - 2rem));
		max-height: calc(100dvh - 2rem);
		overflow: auto;
		background: var(--panel);
		color: var(--text);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 1rem;
	}
	dialog::backdrop {
		background: rgba(0, 0, 0, 0.6);
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 0.6rem;
	}
	.title {
		font-size: 1.1rem;
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.35rem 1rem;
		margin-bottom: 0.6rem;
		font-size: 0.9rem;
	}
	.facts > div {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.facts .muted:first-child {
		min-width: 5.5rem;
	}
	.commute {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1rem;
		align-items: baseline;
		margin-bottom: 0.4rem;
	}
	.commute .best {
		font-weight: 700;
	}
	.edit .wide {
		grid-column: span 2;
	}
	.loc {
		margin: 0.4rem 0 0.6rem;
	}
	.foot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		border-top: 1px solid var(--line);
		margin-top: 0.8rem;
		padding-top: 0.6rem;
	}
</style>
