<script lang="ts">
	// Interactive map: area pins colored by a metric, Metro lines and stations, saved listings, and commute bands
	// to the selected place (computed by the local trip planner). Leaflet loads in the browser only; OpenStreetMap
	// tiles are the only outside request.
	import 'leaflet/dist/leaflet.css';
	import { onMount, untrack } from 'svelte';
	import type * as Leaflet from 'leaflet';
	import { METRO } from '#lib/metro.js';
	import { bestCommute, MODE_LABEL, MODES, type BandGrid, type MapArea, type MapListing, type MapPlace, type Mode } from '#lib/mapdata.js';

	interface Props {
		areas: MapArea[];
		listings?: MapListing[];
		/** The commute endpoint (work). */
		place?: MapPlace | null;
		grids?: BandGrid[];
		/** CSS height of the map itself. */
		height?: string;
		/** Area id highlighted in step with a table. */
		selected?: string | null;
		/** "Details & notes" in a pin's popup. */
		onopen?: (id: string) => void;
		/** When given, popups get an add/remove-from-Compare button. */
		ontoggle?: (id: string, on: boolean) => void;
		/** While true, a click on the map calls onpick instead of anything else. */
		picking?: boolean;
		onpick?: (lat: number, lng: number) => void;
		/** A temporary pin (e.g. the spot being picked). */
		draft?: { lat: number; lng: number } | null;
	}

	let {
		areas, listings = [], place = null, grids = [], height = '420px', selected = $bindable(null),
		onopen, ontoggle, picking = false, onpick, draft = null
	}: Props = $props();

	// Layer switches, metric and band mode, remembered in this browser.
	type BandMode = Mode | 'best';
	type Prefs = { areas: boolean; metro: boolean; listings: boolean; bands: boolean; bandMode: BandMode };
	let prefs = $state<Prefs>({ areas: true, metro: true, listings: true, bands: false, bandMode: 'best' });
	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem('map-prefs') ?? '{}');
			delete saved.metric;
			prefs = { ...untrack(() => prefs), ...saved };
		} catch {
			/* storage unavailable */
		}
	});
	function save() {
		try {
			localStorage.setItem('map-prefs', JSON.stringify(prefs));
		} catch {
			/* storage unavailable */
		}
	}

	// Area pins by status: finalists in blue, close calls in gray (with a dashed ring).
	const STATUS_COLORS = { finalist: '#3987e5', close: '#a9b3c0' };
	// Listing stages, fixed order (categorical slots chosen to stay clear of the blue pins and orange bands).
	const STAGE_COLORS: Record<string, string> = { watching: '#199e70', toured: '#d55181', offer: '#9085e9' };
	// Commute bands: one orange hue, stronger = shorter.
	const BANDS = [
		{ max: 30, alpha: 0.6, label: '≤ 30 min' },
		{ max: 45, alpha: 0.4, label: '30–45' },
		{ max: 60, alpha: 0.22, label: '45–60' }
	];
	const BAND_RGB = [235, 104, 52];

	const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
	const kf = (n: number) => `$${Math.round(n / 1000)}k`;
	const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
	const mm = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} min`);

	function areaPopup(a: MapArea) {
		const crime = a.crime == null ? '—' : `${a.crime.toFixed(2)} <span class="m">(${a.crimeYear}${a.countyCrime != null ? `, county ${a.countyCrime.toFixed(2)}` : ''})</span>`;
		const best = bestCommute(a.commute);
		const commute = MODES.map((m) => `<b class="${best?.mode === m ? 'best' : ''}">${MODE_LABEL[m]} ${mm(a.commute[m])}</b>`).join('<br>');
		return `<div class="pop">
			<strong>${esc(a.name)}</strong>
			<div class="m">${a.status === 'finalist' ? 'Finalist' : 'Close call'} · ${a.state} · ${esc(a.homeType)}</div>
			<table>
				<tr><td>Price</td><td>${kf(a.price)} <span class="m">(${kf(a.priceLow)}–${kf(a.priceHigh)})</span></td></tr>
				<tr><td>Monthly</td><td>${usd(a.monthly)}</td></tr>
				<tr><td>5-yr cost</td><td>${kf(a.five)}</td></tr>
				<tr><td>Crime</td><td>${crime}</td></tr>
				<tr><td>Metro</td><td>${esc(a.metroLine)}</td></tr>
				<tr><td>To ${place ? esc(place.name.split(',')[0]) : 'work'}</td><td>${commute}</td></tr>
			</table>
			${ontoggle ? `<button type="button" class="small" data-toggle="${esc(a.id)}">${a.enabled ? '✓ In Compare (remove)' : '+ Add to Compare'}</button>` : ''}
			${onopen ? `<button type="button" class="small" data-open="${esc(a.id)}">Details & notes</button>` : ''}
		</div>`;
	}

	/** Grid of minutes for the chosen band mode ('best' = fastest of the three per cell). */
	function bandValues(mode: BandMode): BandGrid | null {
		if (mode !== 'best') return grids.find((g) => g.mode === mode) ?? null;
		if (!grids.length) return null;
		const g0 = grids[0];
		const data = g0.data.map((_, i) => {
			let best: number | null = null;
			for (const g of grids) {
				const v = g.data[i];
				if (v != null && (best == null || v < best)) best = v;
			}
			return best;
		});
		return { ...g0, data };
	}

	/** Smooth bands: interpolate the ~1 km grid at 6× resolution, then threshold, so edges are contours, not squares. */
	function bandImage(g: BandGrid): string {
		const S = 6;
		const W = g.cols * S;
		const H = g.rows * S;
		const canvas = document.createElement('canvas');
		canvas.width = W;
		canvas.height = H;
		const ctx = canvas.getContext('2d')!;
		const img = ctx.createImageData(W, H);
		const at = (r: number, c: number) => g.data[Math.min(g.rows - 1, Math.max(0, r)) * g.cols + Math.min(g.cols - 1, Math.max(0, c))] ?? Infinity;
		for (let y = 0; y < H; y++) {
			const fr = (y + 0.5) / S - 0.5;
			const r0 = Math.floor(fr);
			const ty = fr - r0;
			for (let x = 0; x < W; x++) {
				const fc = (x + 0.5) / S - 0.5;
				const c0 = Math.floor(fc);
				const tx = fc - c0;
				const q = [at(r0, c0), at(r0, c0 + 1), at(r0 + 1, c0), at(r0 + 1, c0 + 1)];
				// Where a neighbor has no route, use the nearest cell instead of blending with infinity.
				const t = q.some((v) => v === Infinity)
					? at(Math.round(fr), Math.round(fc))
					: (q[0] * (1 - tx) + q[1] * tx) * (1 - ty) + (q[2] * (1 - tx) + q[3] * tx) * ty;
				const band = BANDS.find((b) => t <= b.max);
				if (!band) continue;
				// Fade out over the outer two cells so the end of the computed area isn't a hard line.
				const edge = Math.min(1, Math.min(x, W - 1 - x, y, H - 1 - y) / (2 * S));
				const i = (y * W + x) * 4;
				[img.data[i], img.data[i + 1], img.data[i + 2]] = BAND_RGB;
				img.data[i + 3] = Math.round(band.alpha * edge * 255);
			}
		}
		ctx.putImageData(img, 0, 0);
		return canvas.toDataURL();
	}

	let el: HTMLDivElement;
	let L = $state.raw<typeof Leaflet>();
	let map = $state.raw<Leaflet.Map>();
	let groups = $state.raw<Record<'areas' | 'metro' | 'listings' | 'bands' | 'marks', Leaflet.LayerGroup>>();
	const pins = new Map<string, Leaflet.CircleMarker>();

	// Built once; the effects below keep the layers in step with the data.
	onMount(() => {
		let m: Leaflet.Map | undefined;
		let cancelled = false;
		import('leaflet').then((mod) => {
			if (cancelled) return;
			const lib = (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as unknown as typeof Leaflet);
			m = lib.map(el, { zoomControl: true, attributionControl: true });
			lib.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 18,
				attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
			}).addTo(m);
			m.createPane('bands').style.zIndex = '350';
			m.createPane('listings').style.zIndex = '620';
			m.createPane('pins').style.zIndex = '640';
			const g = { bands: lib.layerGroup(), metro: lib.layerGroup(), listings: lib.layerGroup(), areas: lib.layerGroup(), marks: lib.layerGroup().addTo(m) };

			for (const line of METRO.lines) lib.polyline(line.coords, { color: line.color, weight: 3.5, opacity: 0.9, interactive: false }).addTo(g.metro);
			for (const s of METRO.stations)
				lib.circleMarker([s.lat, s.lng], { radius: 3.5, color: '#12151a', weight: 1.5, fillColor: '#ffffff', fillOpacity: 1 })
					.bindTooltip(esc(s.name), { direction: 'top' })
					.addTo(g.metro);

			m.on('popupopen', (ev) => {
				const root = ev.popup.getElement();
				const btn = root?.querySelector<HTMLButtonElement>('[data-toggle]');
				btn?.addEventListener('click', () => {
					const id = btn.dataset.toggle!;
					const a = areas.find((x) => x.id === id);
					if (a) ontoggle?.(id, !a.enabled);
					m?.closePopup();
				});
				const open = root?.querySelector<HTMLButtonElement>('[data-open]');
				open?.addEventListener('click', () => {
					m?.closePopup();
					onopen?.(open.dataset.open!);
				});
			});
			m.on('click', (ev) => {
				if (picking) onpick?.(ev.latlng.lat, ev.latlng.lng);
			});

			const pts = areas.map((a) => [a.lat, a.lng] as [number, number]);
			if (place) pts.push([place.lat, place.lng]);
			m.fitBounds(pts.length ? lib.latLngBounds(pts).pad(0.08) : lib.latLngBounds([[38.85, -77.15], [39.1, -76.9]]));
			groups = g;
			map = m;
			L = lib;
		});
		return () => {
			cancelled = true;
			m?.remove();
		};
	});

	// Layer visibility.
	$effect(() => {
		if (!map || !groups) return;
		for (const k of ['bands', 'metro', 'listings', 'areas'] as const) {
			const on = prefs[k];
			if (on && !map.hasLayer(groups[k])) groups[k].addTo(map);
			if (!on && map.hasLayer(groups[k])) groups[k].remove();
		}
	});

	// Crosshair while picking a spot.
	$effect(() => {
		el?.classList.toggle('picking', picking);
	});

	// Commute bands.
	const bandGrid = $derived(bandValues(prefs.bandMode));
	$effect(() => {
		if (!L || !groups) return;
		groups.bands.clearLayers();
		const g = bandGrid;
		if (!g || !prefs.bands) return;
		L.imageOverlay(bandImage(g), [[g.south, g.west], [g.north, g.east]], { pane: 'bands', interactive: false }).addTo(groups.bands);
	});

	// Work place and draft pin.
	$effect(() => {
		if (!L || !groups) return;
		groups.marks.clearLayers();
		if (place)
			L.marker([place.lat, place.lng], { icon: L.divIcon({ className: 'workpin', html: '★', iconSize: [20, 20] }), zIndexOffset: 1000 })
				.bindTooltip(esc(place.name), { direction: 'top' })
				.addTo(groups.marks);
		if (draft)
			L.marker([draft.lat, draft.lng], { icon: L.divIcon({ className: 'draftpin', html: '<span></span>', iconSize: [18, 18] }), zIndexOffset: 1100 }).addTo(groups.marks);
	});

	// Area pins.
	$effect(() => {
		if (!L || !groups) return;
		const lib = L;
		const g = groups.areas;
		g.clearLayers();
		pins.clear();
		for (const a of areas) {
			const pin = lib.circleMarker([a.lat, a.lng], {
				pane: 'pins',
				radius: 9,
				color: '#ffffff',
				weight: 2,
				dashArray: a.status === 'close' ? '3 3' : undefined,
				fillColor: STATUS_COLORS[a.status],
				fillOpacity: 1
			});
			pin.bindTooltip(`${esc(a.name)} · ${kf(a.price)}`, { direction: 'top', offset: [0, -6] });
			pin.bindPopup(() => areaPopup(a), { maxWidth: 340 });
			pin.on('click', () => {
				if (!picking) selected = a.id;
			});
			pin.addTo(g);
			pins.set(a.id, pin);
		}
	});

	// Highlight the selected area (e.g. from a table row click).
	let lastSelected: string | null = null;
	$effect(() => {
		if (!map || !groups) return;
		void areas;
		for (const [id, p] of pins) p.setRadius(id === selected ? 13 : 9);
		if (selected === lastSelected) return;
		lastSelected = selected;
		const p = selected ? pins.get(selected) : undefined;
		if (p) map.panTo(p.getLatLng());
	});

	// Listings.
	$effect(() => {
		if (!L || !groups) return;
		const g = groups.listings;
		g.clearLayers();
		for (const l of listings) {
			const color = STAGE_COLORS[l.stage] ?? '#a9b3c0';
			L.marker([l.lat, l.lng], {
				pane: 'listings',
				icon: L.divIcon({ className: 'listing-pin', html: `<span style="background:${color}"></span>`, iconSize: [14, 14] })
			})
				.bindTooltip(`${esc(l.address)} · ${kf(l.price)}`, { direction: 'top' })
				.bindPopup(
					`<div class="pop"><strong>${esc(l.address)}</strong><div class="m">${esc(l.stage)}</div><div>${kf(l.price)} · ${usd(l.monthly)}/mo</div><a href="/listings/${l.id}">Open listing →</a></div>`
				)
				.addTo(g);
		}
	});

	/** Zoom to a spot (used after a search). */
	export function flyTo(lat: number, lng: number, zoom = 14) {
		map?.flyTo([lat, lng], zoom, { duration: 0.6 });
	}

	function toggle(k: 'areas' | 'metro' | 'listings' | 'bands') {
		prefs[k] = !prefs[k];
		save();
	}
</script>

<div class="map-wrap">
	<div class="controls">
		<button type="button" class="chip" class:on={prefs.areas} onclick={() => toggle('areas')}>Areas</button>
		<button type="button" class="chip" class:on={prefs.metro} onclick={() => toggle('metro')}>Metro</button>
		<button type="button" class="chip" class:on={prefs.listings} onclick={() => toggle('listings')}>Listings ({listings.length})</button>
		<button type="button" class="chip" class:on={prefs.bands} onclick={() => toggle('bands')}>Commute bands</button>
		{#if prefs.bands}
			<select bind:value={prefs.bandMode} onchange={save} aria-label="Commute mode">
				<option value="best">fastest way</option>
				{#each MODES as m (m)}<option value={m}>{MODE_LABEL[m].toLowerCase()}</option>{/each}
			</select>
		{/if}
	</div>

	<div class="map" bind:this={el} style:height></div>

	<div class="legend small-text">
		{#if prefs.areas}
			<span class="lg">
				<u style:background={STATUS_COLORS.finalist}></u>finalist
				<u class="dashed" style:background={STATUS_COLORS.close}></u>close call
			</span>
		{/if}
		{#if prefs.listings && listings.length}
			<span class="lg">
				{#each Object.entries(STAGE_COLORS) as [stage, c] (stage)}<b style:background={c}></b>{stage}{/each}
			</span>
		{/if}
		{#if prefs.bands}
			<span class="lg">
				{#if bandGrid}
					{#each BANDS as b (b.max)}<i style:background="rgba({BAND_RGB.join(',')},{b.alpha + 0.15})"></i>{b.label}{/each}
					<span class="muted">door-to-door, {prefs.bandMode === 'best' ? 'fastest way' : MODE_LABEL[prefs.bandMode].toLowerCase()}</span>
				{:else}
					<span class="muted">Bands for this place aren't computed yet.</span>
				{/if}
			</span>
		{/if}
		{#if place}<span class="lg"><span class="star">★</span> {place.name.split(',')[0]}</span>{/if}
	</div>
</div>

<style>
	.map-wrap {
		margin-bottom: 0.75rem;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
		margin-bottom: 0.45rem;
	}
	.controls select {
		width: auto;
		margin: 0;
		padding: 0.25rem 0.4rem;
		font-size: 0.8rem;
	}
	.chip {
		border: 1px solid var(--line);
		background: var(--panel);
		color: var(--muted);
		border-radius: 999px;
		padding: 0.25rem 0.65rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.chip.on {
		background: var(--panel-2);
		color: var(--text);
		border-color: var(--accent);
	}
	.map {
		width: 100%;
		border-radius: var(--radius);
		border: 1px solid var(--line);
		background: #1d2229;
		z-index: 0;
	}
	.map:global(.picking),
	.map:global(.picking) :global(.leaflet-interactive) {
		cursor: crosshair;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1rem;
		margin-top: 0.4rem;
		color: var(--text);
	}
	.lg {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		flex-wrap: wrap;
	}
	.lg i {
		display: inline-block;
		width: 14px;
		height: 10px;
		border-radius: 2px;
	}
	.lg u {
		display: inline-block;
		width: 11px;
		height: 11px;
		border-radius: 50%;
		border: 2px solid #fff;
		margin-left: 0.3rem;
	}
	.lg u.dashed {
		border-style: dashed;
	}
	.lg b {
		display: inline-block;
		width: 10px;
		height: 10px;
		transform: rotate(45deg);
		margin-left: 0.3rem;
		border: 1px solid #fff;
	}
	.star {
		color: var(--warn);
	}
	/* Dark streets: invert the OSM tiles only, not the overlays. */
	.map :global(.leaflet-tile-pane) {
		filter: invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.9) saturate(0.6);
	}
	.map :global(.leaflet-container),
	.map :global(.leaflet-popup-content-wrapper),
	.map :global(.leaflet-popup-tip) {
		font: inherit;
	}
	.map :global(.leaflet-popup-content-wrapper),
	.map :global(.leaflet-popup-tip),
	.map :global(.leaflet-tooltip) {
		background: var(--panel-2);
		color: var(--text);
		border-color: var(--line);
	}
	.map :global(.leaflet-tooltip-top::before) {
		border-top-color: var(--panel-2);
	}
	.map :global(.leaflet-popup-content) {
		margin: 0.6rem 0.75rem;
		font-size: 0.85rem;
	}
	.map :global(.pop table) {
		border-collapse: collapse;
		margin: 0.3rem 0;
	}
	.map :global(.pop td) {
		padding: 0.1rem 0.5rem 0.1rem 0;
		border: 0;
		vertical-align: top;
	}
	.map :global(.pop td:first-child) {
		color: var(--muted);
		white-space: nowrap;
	}
	.map :global(.pop b) {
		font-weight: 400;
		white-space: nowrap;
	}
	.map :global(.pop b.best) {
		font-weight: 700;
	}
	.map :global(.pop .m) {
		color: var(--muted);
		font-size: 0.78rem;
	}
	.map :global(.pop button) {
		margin: 0.2rem 0.4rem 0 0;
	}
	.map :global(.workpin) {
		color: var(--warn);
		font-size: 20px;
		line-height: 20px;
		text-align: center;
		text-shadow: 0 0 3px #000, 0 0 3px #000;
	}
	.map :global(.draftpin span) {
		display: block;
		width: 14px;
		height: 14px;
		margin: 2px;
		border-radius: 50%;
		background: var(--warn);
		border: 2px solid #fff;
		box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.5);
	}
	.map :global(.listing-pin span) {
		display: block;
		width: 11px;
		height: 11px;
		margin: 1.5px;
		transform: rotate(45deg);
		border: 2px solid #fff;
		border-radius: 2px;
	}
	.map :global(.leaflet-control-attribution) {
		background: rgba(26, 31, 38, 0.8);
		color: var(--muted);
	}
	.map :global(.leaflet-control-attribution a) {
		color: var(--accent);
	}
</style>
