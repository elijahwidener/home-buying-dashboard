<script lang="ts">
	import { enhance } from '$app/forms';
	import { k, money, pct, tone } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let adding = $state(false);
</script>

<h1>Listings</h1>

{#if form?.error}<div class="error-box">{form.error}</div>{/if}
{#if form?.imported}
	<div class="alert good">
		Imported: {form.imported.new} new, {form.imported.changed} price changes, {form.imported.same} unchanged{form.imported.skipped
			? `, ${form.imported.skipped} skipped`
			: ''}.
	</div>
{/if}

<div class="spread" style="margin-bottom:0.75rem">
	<div class="chips" style="margin:0">
		<a href="?view=active" class:on={data.view === 'active'}>Active</a>
		<a href="?view=passed" class:on={data.view === 'passed'}>Passed / sold</a>
		<a href="?view=all" class:on={data.view === 'all'}>All</a>
	</div>
	<button class="small" onclick={() => (adding = !adding)}>{adding ? 'Close' : '+ Add / import'}</button>
</div>

{#if adding}
	<div class="two">
		<form method="POST" action="?/add" use:enhance class="card">
			<strong>Add a listing</strong>
			<label>Address <input name="address" required /></label>
			<div class="cols-3">
				<label>City <input name="city" /></label>
				<label>State <input name="state" maxlength="2" placeholder="MD" /></label>
				<label>Zip <input name="zip" maxlength="5" inputmode="numeric" /></label>
			</div>
			<label>Link <input name="url" type="url" placeholder="https://www.redfin.com/..." /></label>
			<div class="cols-3">
				<label>Price <input name="price" inputmode="decimal" required /></label>
				<label>Beds <input name="beds" inputmode="decimal" /></label>
				<label>Baths <input name="baths" inputmode="decimal" /></label>
				<label>Sq ft <input name="sqft" inputmode="numeric" /></label>
				<label>HOA / mo <input name="hoa" inputmode="decimal" /></label>
				<label>Yearly tax <input name="tax_annual" inputmode="decimal" placeholder="estimate" /></label>
			</div>
			<div class="cols-3">
				<label>
					Type
					<select name="home_type">
						<option value="house">House</option>
						<option value="townhouse">Townhouse</option>
						<option value="condo">Condo</option>
					</select>
				</label>
				<label>
					Jurisdiction
					<select name="jurisdiction">
						<option value="">From zip</option>
						{#each Object.entries(data.jurisdictions) as [id, j] (id)}<option value={id}>{j.name}</option>{/each}
					</select>
				</label>
				<label>Year built <input name="year_built" inputmode="numeric" /></label>
			</div>
			<button class="primary">Add</button>
		</form>
		<form method="POST" action="?/import" enctype="multipart/form-data" use:enhance class="card">
			<strong>Import from Redfin</strong>
			<p class="muted small-text">
				On Redfin, run a search (for example 2+ beds in your zips under $550k), scroll to the bottom of the results and click
				<em>Download All</em>. Upload that CSV here. Re-import the same search any time: new listings are added, price changes are
				recorded, and your notes and stages are kept.
			</p>
			<input type="file" name="file" accept=".csv,text/csv" required />
			<button class="primary" style="margin-top:0.6rem">Import CSV</button>
		</form>
	</div>
{/if}

{#if data.rows.length === 0}
	<div class="card muted">Nothing here yet.</div>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Home</th>
					<th class="num">Price</th>
					<th class="num">Beds/baths</th>
					<th class="num">HOA</th>
					<th class="num">Monthly</th>
					<th class="num">Cash</th>
					<th class="num">Yr-1 all-in</th>
					<th class="num">5-yr net</th>
					<th class="num">30-yr total</th>
					<th class="num">DOM</th>
					<th>Stage</th>
				</tr>
			</thead>
			<tbody>
				{#each data.rows as l (l.id)}
					<tr>
						<td>
							{l.starred ? '★ ' : ''}<a href="/listings/{l.id}">{l.address}</a>
							<div class="muted small-text">
								{l.city} {l.zip}{l.area ? ` · ${l.area}` : ''} · {l.home_type}{l.status !== 'Active' ? ` · ${l.status}` : ''}
							</div>
						</td>
						<td class="num">
							{k(l.price)}
							{#if l.first_price && l.first_price !== l.price}
								<div class="small-text {tone(l.price - l.first_price, false)}">{pct(((l.price - l.first_price) / l.first_price) * 100, 1, true)}</div>
							{/if}
						</td>
						<td class="num">{l.beds ?? '?'} / {l.baths ?? '?'}</td>
						<td class="num">{l.hoa ? money(l.hoa) : '—'}</td>
						<td class="num">{money(l.monthly)}</td>
						<td class="num">{k(l.cash)}</td>
						<td class="num">{k(l.allIn)}</td>
						<td class="num">{k(l.five)}</td>
						<td class="num">{k(l.thirty)}</td>
						<td class="num">{l.dom ?? '—'}</td>
						<td><span class="pill" class:live={l.stage === 'offer' || l.stage === 'toured'}>{l.stage}</span></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="muted small-text">
		Costs at {pct(data.rate, 3)} with your down payment and family-help settings. Property tax is estimated unless you enter the real bill. 30-yr total is everything you pay keeping the home until the loan is paid off (income taxes and resale value left out).
	</p>
{/if}
