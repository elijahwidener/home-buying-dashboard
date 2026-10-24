<script lang="ts">
	// Search a landmark, address or neighborhood (OpenStreetMap Nominatim, via /api/search) and pick a result.
	interface Props {
		onpick: (name: string, lat: number, lng: number) => void;
		placeholder?: string;
	}
	let { onpick, placeholder = 'Search: "Pentagon", an address, a neighborhood…' }: Props = $props();

	let q = $state('');
	let results = $state<{ name: string; lat: number; lng: number }[]>([]);
	let msg = $state('');
	let busy = $state(false);

	async function search() {
		if (q.trim().length < 3) return;
		busy = true;
		msg = '';
		try {
			const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
			results = res.ok ? await res.json() : [];
			if (!res.ok) msg = 'Search is unavailable right now. Drop a pin instead.';
			else if (!results.length) msg = 'No matches. Try other words or drop a pin.';
		} catch {
			msg = 'Search failed. Drop a pin instead.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="ps">
	<div class="row">
		<input bind:value={q} {placeholder} onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), search())} style="flex:1;margin:0" />
		<button type="button" class="small" onclick={search} disabled={busy}>{busy ? '…' : 'Search'}</button>
	</div>
	{#if msg}<div class="muted small-text">{msg}</div>{/if}
	{#if results.length}
		<ul>
			{#each results as r, i (i)}
				<li>
					<button
						type="button"
						onclick={() => {
							onpick(r.name, r.lat, r.lng);
							results = [];
						}}>{r.name}</button
					>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	ul {
		list-style: none;
		margin: 0.35rem 0 0;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 8px;
		overflow: hidden;
	}
	li + li {
		border-top: 1px solid var(--line);
	}
	li button {
		display: block;
		width: 100%;
		text-align: left;
		background: var(--panel-2);
		color: var(--text);
		border: 0;
		padding: 0.45rem 0.6rem;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}
	li button:hover {
		background: var(--line);
	}
</style>
