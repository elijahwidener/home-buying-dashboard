<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { ago, prettyDate } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const c = $derived(data.cfg);
	const bools = $derived(
		c.profile.people.map((_, i) => `profile.people.${i}.countForLoan`).join(',')
	);
	const json = (v: unknown) => JSON.stringify(v, null, 2);

	// Live build status.
	// svelte-ignore state_referenced_locally
	let live = $state<{ building: boolean; running: boolean; log: string[] } | null>(null);
	const planner = $derived({ ...data.planner, ...(live ?? {}) });
	$effect(() => {
		if (!data.planner.building) return;
		let stop = false;
		const tick = async () => {
			if (stop) return;
			try {
				const s = await (await fetch('/api/commute')).json();
				live = { building: s.planner.building, running: s.planner.running, log: s.planner.log };
				if (!s.planner.building) {
					live = null;
					await invalidateAll();
					return;
				}
			} catch {
				/* try again */
			}
			setTimeout(tick, 4000);
		};
		tick();
		return () => (stop = true);
	});
</script>

<h1>Settings</h1>
{#if form?.error}<div class="error-box">{form.error}</div>{/if}
{#if form?.saved}<div class="alert good">Saved.</div>{/if}

<form method="POST" action="?/save" use:enhance={() => async ({ update }) => update({ reset: false })}>
	<input type="hidden" name="_bools" value={bools} />

	<h2>You</h2>
	<div class="card">
		{#each c.profile.people as p, i (i)}
			<div class="cols-4">
				<label>Name <input name="profile.people.{i}.name" value={p.name} /></label>
				<label>Salary <input name="profile.people.{i}.salary" inputmode="decimal" value={p.salary} /></label>
				<label>Pre-tax TSP/401k % <input name="profile.people.{i}.pretaxPct" inputmode="decimal" value={p.pretaxPct} /></label>
				<label style="align-self:end"><input type="checkbox" name="profile.people.{i}.countForLoan" checked={p.countForLoan} />Count for loan</label>
			</div>
		{/each}
		<div class="cols-4">
			<label>
				Filing status
				<select name="profile.filing" value={c.profile.filing}>
					<option value="mfj">Married filing jointly</option>
					<option value="single">Single</option>
				</select>
			</label>
			<label>Saving per month <input name="profile.monthlySavings" inputmode="decimal" value={c.profile.monthlySavings} /></label>
			<label>Target close <input type="month" name="profile.targetClose" value={c.profile.targetClose} /></label>
			<label>Reserve months <input name="profile.reserveMonths" inputmode="decimal" value={c.profile.reserveMonths} /></label>
			<label>Starting savings <input name="profile.savings" inputmode="decimal" value={c.profile.savings} /></label>
			<label>Car values (comma list) <input name="profile.cars" value={c.profile.cars.join(', ')} /></label>
			<label>
				Live now in
				<select name="profile.currentJurisdiction" value={c.profile.currentJurisdiction}>
					{#each Object.entries(c.jurisdictions) as [id, j] (id)}<option value={id}>{j.name}</option>{/each}
				</select>
			</label>
		</div>
		<p class="muted small-text">Starting savings is used until you log a balance on the Plan page. Car values feed Virginia's car tax.</p>
	</div>

	<h2>Loan & assumptions</h2>
	<div class="card">
		<div class="cols-4">
			<label>
				Rate
				<select name="loan.rateMode" value={c.loan.rateMode}>
					<option value="live">Live (Freddie Mac avg + spread)</option>
					<option value="fixed">Fixed</option>
				</select>
			</label>
			<label>Spread over avg (pts) <input name="loan.spread" inputmode="decimal" value={c.loan.spread} /></label>
			<label>Fixed rate % <input name="loan.fixedRate" inputmode="decimal" value={c.loan.fixedRate} /></label>
			<label>Rate alert at % <input name="loan.alertRate" inputmode="decimal" value={c.loan.alertRate} /></label>
			<label>Down payment % <input name="loan.downPct" inputmode="decimal" value={c.loan.downPct} /></label>
			<label>Term (years) <input name="loan.termYears" inputmode="decimal" value={c.loan.termYears} /></label>
			<label>PMI % / yr <input name="loan.pmiPct" inputmode="decimal" value={c.loan.pmiPct} /></label>
			<label>Lender/title % <input name="loan.otherClosingPct" inputmode="decimal" value={c.loan.otherClosingPct} /></label>
			<label>Selling cost % <input name="loan.sellCostPct" inputmode="decimal" value={c.loan.sellCostPct} /></label>
			<label>Return on cash % <input name="loan.investReturnPct" inputmode="decimal" value={c.loan.investReturnPct} /></label>
			<label>Rent growth % <input name="loan.rentGrowthPct" inputmode="decimal" value={c.loan.rentGrowthPct} /></label>
			<label>Area price lean to low end % <input name="loan.priceLeanPct" inputmode="decimal" value={c.loan.priceLeanPct} /></label>
		</div>
		<p class="muted small-text">
			Area costs use each area's typical price moved the "lean" share of the way toward the low end of its range (25% turns a $600k typical with
			a $360k low into $540k), since typical sale prices mix fixer-uppers with renovated homes. 0 uses the typical price as is.
		</p>
		<p class="muted small-text">
			Once you have a lender quote, set the spread to (your quoted rate − this week's average) so the dashboard tracks your real rate as the
			market moves.
		</p>
	</div>

	<h2>Family help</h2>
	<div class="card">
		<div class="cols-4">
			<label>
				Type
				<select name="family.mode" value={c.family.mode}>
					<option value="none">None</option>
					<option value="gift">Gift</option>
					<option value="loan">Loan</option>
				</select>
			</label>
			<label>Amount <input name="family.amount" inputmode="decimal" value={c.family.amount} /></label>
			<label>Loan rate % (≥ IRS AFR) <input name="family.ratePct" inputmode="decimal" value={c.family.ratePct} /></label>
			<label>Loan term (years) <input name="family.termYears" inputmode="decimal" value={c.family.termYears} /></label>
		</div>
		<p class="muted small-text">
			The IRS publishes AFRs monthly (Rev. Rul., "long-term" for loans over 9 years): <a href="https://www.irs.gov/applicable-federal-rates" target="_blank" rel="noopener noreferrer">irs.gov/applicable-federal-rates</a>.
		</p>
	</div>

	<h2>Areas</h2>
	<div class="card">
		<p class="muted small-text" style="margin-top:0">Add, edit, remove and take notes on areas on the <a href="/areas">Areas</a> page (click a row).</p>
		<label style="margin:0">Extra zips to track on Market (comma list) <input name="extraZips" value={c.extraZips.join(', ')} /></label>
	</div>

	<h2 id="planner">Trip planner (commute times)</h2>
	<div class="card">
		<div class="cols-4">
			<label>Arrive at work by <input type="time" name="commute.arriveBy" value={c.commute.arriveBy} /></label>
			<label>Rush-hour driving factor <input name="commute.rushFactor" inputmode="decimal" value={c.commute.rushFactor} /></label>
		</div>
		<p class="muted small-text">
			The planner uses real weekday schedules (Metro, Metrobus, Ride On, TheBus, MARC, Fairfax Connector, ART, DASH) and OpenStreetMap streets. It only
			knows free-flow driving speeds, so car time is multiplied by the factor (1.5 = half again as long at rush hour), and driving the whole way adds
			5 minutes to park and walk in. Changing either setting recomputes every saved place.
		</p>
	</div>

	<h2>Tax tables (advanced)</h2>
	<div class="card">
		<p class="muted small-text">
			Tax year <input name="taxYear" value={c.taxYear} style="display:inline;width:5rem" /> · last reviewed
			<input name="reviewed" type="date" value={c.reviewed} style="display:inline;width:10rem" />. Rates are from public sources as of
			that date; check them each January. Brackets are [upper limit or null, rate].
		</p>
		<details>
			<summary>Jurisdictions: property, car, county income and transfer taxes</summary>
			<textarea name="json.jurisdictions" rows="24" style="font-family:monospace;font-size:13px">{json(c.jurisdictions)}</textarea>
		</details>
		<details>
			<summary>State income tax (MD, DC, VA)</summary>
			<textarea name="json.states" rows="24" style="font-family:monospace;font-size:13px">{json(c.states)}</textarea>
		</details>
		<details>
			<summary>Federal income tax</summary>
			<textarea name="json.federal" rows="16" style="font-family:monospace;font-size:13px">{json(c.federal)}</textarea>
		</details>
	</div>

	<div style="position:sticky;bottom:calc(4.2rem + env(safe-area-inset-bottom));z-index:1">
		<button class="primary" style="width:100%">Save settings</button>
	</div>
</form>

<h2>Trip planner data</h2>
<div class="card">
	{#if planner.building}
		<p class="small-text"><span class="spin"></span> Building: downloading schedules and street maps, then building (10–30 minutes). You can leave this page.</p>
	{:else if planner.built}
		<p class="small-text" style="margin-top:0">
			Built {prettyDate(planner.builtAt?.slice(0, 10))}; commutes use the timetables for {prettyDate(planner.serviceDate)}.
			{planner.running ? 'Running now (computing).' : 'Not running (starts only when something needs computing).'}
		</p>
		<details>
			<summary class="small-text">Schedules included</summary>
			<ul class="small-text">
				{#each planner.feeds as f (f.name)}<li>{f.name}: {f.from}–{f.to}</li>{/each}
			</ul>
		</details>
	{:else}
		<p class="small-text" style="margin-top:0">
			Not set up yet. Building downloads about 1 GB (schedules and OpenStreetMap for DC, Maryland and Virginia), crops it to the DC region, and builds
			the planner. Takes 10–30 minutes and about 5 GB of memory while it runs; afterward it needs ~400 MB of disk.
		</p>
	{/if}
	<form method="POST" action="?/buildPlanner" use:enhance class="row">
		<button class="small" disabled={planner.building}>{planner.built ? 'Rebuild with the latest schedules' : 'Build the trip planner'}</button>
		{#if planner.built}<span class="muted small-text">Rebuild every few months, or after Metro or bus service changes. Recomputes every saved place.</span>{/if}
	</form>
	{#if planner.log.length}
		<details open={planner.building}>
			<summary class="small-text">Log</summary>
			<pre class="log">{planner.log.join('\n')}</pre>
		</details>
	{/if}
</div>

<h2 id="dates">Key dates</h2>
<div class="card">
	{#each c.keyDates as d, i (i)}
		<form method="POST" action="?/removeDate" use:enhance class="spread small-text" style="padding:0.2rem 0">
			<span>{d.date} · {d.label}</span>
			<input type="hidden" name="i" value={i} /><button class="small">✕</button>
		</form>
	{/each}
	<form method="POST" action="?/addDate" use:enhance class="row" style="margin-top:0.5rem">
		<input type="date" name="date" style="flex:1;margin:0" required />
		<input name="label" placeholder="e.g. Lease ends" style="flex:2;margin:0" required />
		<button class="small">Add</button>
	</form>
</div>

<h2>News feeds</h2>
<div class="card">
	{#each c.feeds as f (f.name)}
		<form method="POST" action="?/removeFeed" use:enhance class="spread small-text" style="padding:0.2rem 0">
			<span>{f.name} <span class="muted">{f.url.includes('news.google.com') ? '(Google News search)' : f.url}</span></span>
			<input type="hidden" name="name" value={f.name} /><button class="small">✕</button>
		</form>
	{/each}
	<form method="POST" action="?/addFeed" use:enhance class="row" style="margin-top:0.5rem">
		<input name="name" placeholder="Name" style="flex:1;margin:0" required />
		<input name="url" placeholder="RSS URL, or search words" style="flex:2;margin:0" required />
		<button class="small">Add</button>
	</form>
</div>

<h2 id="data">Live data</h2>
<div class="table-wrap">
	<table>
		<thead><tr><th>Source</th><th>Status</th><th>Checked</th><th>Data changed</th></tr></thead>
		<tbody>
			{#each data.sources as s (s.key)}
				<tr>
					<td>{s.label}<div class="muted small-text">{s.message}</div></td>
					<td class={s.status === 'ok' ? 'pos' : s.status === 'error' ? 'neg' : 'muted'}>{s.status}</td>
					<td class="small-text">{ago(s.checked_at)}</td>
					<td class="small-text">{ago(s.updated_at)}</td>
				</tr>
			{:else}
				<tr><td colspan="4" class="muted">Nothing fetched yet.</td></tr>
			{/each}
		</tbody>
	</table>
</div>
<form method="POST" action="?/refresh" use:enhance class="row">
	<button class="small" name="which" value="fred">Refresh rates</button>
	<button class="small" name="which" value="news">Refresh news</button>
	<button class="small" name="which" value="zillow">Re-download Zillow</button>
	{#if form?.refreshed}<span class="pos small-text">{form.refreshed === 'zillow' ? 'Zillow download started (a few minutes)' : 'Refreshed'}</span>{/if}
	{#if data.refreshing.length}<span class="muted small-text">Running: {data.refreshing.join(', ')}</span>{/if}
</form>
<p class="muted small-text">
	Rates refresh every 3 hours (Freddie Mac publishes Thursdays), news hourly, Zillow checks twice a day for its monthly update.
</p>

<h2>Backup & reset</h2>
<div class="card row">
	<a class="btn" href="/backup" download>Download backup</a>
	<form method="POST" action="?/reset" use:enhance class="row">
		<select name="section" style="width:auto;margin:0">
			<option value="jurisdictions">Jurisdiction taxes</option>
			<option value="states">State taxes</option>
			<option value="federal">Federal taxes</option>
			<option value="areas">Areas</option>
			<option value="feeds">News feeds</option>
		</select>
		<button class="small danger">Reset to defaults</button>
	</form>
	<form method="POST" action="?/clearDemo" use:enhance>
		<button class="small danger">Remove sample data</button>
	</form>
</div>

<style>
	.log {
		max-height: 16rem;
		overflow: auto;
		font-size: 0.75rem;
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0.5rem;
		white-space: pre-wrap;
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
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
