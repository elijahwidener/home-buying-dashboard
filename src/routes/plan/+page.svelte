<script lang="ts">
	import { enhance } from '$app/forms';
	import Chart from '#lib/components/Chart.svelte';
	import { daysUntil, k, money, monthLabel, prettyDate } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const p = $derived(data.cfg.profile);

	// Monthly path: logged balances so far, then the projection to the target month.
	const chart = $derived.by(() => {
		const start = (data.entries[0]?.date ?? data.today).slice(0, 7);
		const months: string[] = [];
		const [sy, sm] = start.split('-').map(Number);
		for (let i = 0; ; i++) {
			const d = new Date(sy, sm - 1 + i, 15);
			const ym = d.toLocaleDateString('en-CA').slice(0, 7);
			months.push(ym);
			if (ym >= p.targetClose || i > 120) break;
		}
		const logged = months.map((m) => {
			const last = data.entries.filter((e) => e.date.slice(0, 7) <= m).at(-1);
			return last && m <= data.today.slice(0, 7) ? last.balance : null;
		});
		const nowIdx = months.indexOf(data.today.slice(0, 7));
		const projected = months.map((m, i) => (i >= nowIdx && nowIdx >= 0 ? data.current.balance + (i - nowIdx) * p.monthlySavings : null));
		return {
			labels: months.map(monthLabel),
			series: [
				{ label: 'Saved', data: logged, color: '#6cb2ff' },
				{ label: 'Projected', data: projected, color: '#6cb2ff', dashed: true },
				...data.areas.slice(0, 3).map((a, i) => ({ label: `Needed: ${a.name}`, data: months.map(() => a.cash), color: ['#4fd18b', '#f5c04a', '#c084fc'][i], dashed: true }))
			]
		};
	});

	const projectedAtTarget = $derived(data.current.balance + Math.max(0, data.monthsLeft) * p.monthlySavings);
</script>

<h1>Plan</h1>
{#if form?.error}<div class="error-box">{form.error}</div>{/if}

<div class="grid">
	<div class="stat"><div class="label">Saved now</div><div class="value">{k(data.current.balance)}</div><div class="sub">{prettyDate(data.current.date)}</div></div>
	<div class="stat"><div class="label">Saving</div><div class="value">{money(p.monthlySavings)}/mo</div><div class="sub">edit in settings</div></div>
	<div class="stat"><div class="label">Target close</div><div class="value">{monthLabel(p.targetClose)}</div><div class="sub">{data.monthsLeft} months away</div></div>
	<div class="stat"><div class="label">Projected then</div><div class="value">{k(projectedAtTarget)}</div><div class="sub">before family help</div></div>
</div>

<h2>Savings vs. cash needed</h2>
<Chart labels={chart.labels} series={chart.series} format="usd" height={280} />

<div class="two">
	<div>
		<h2>Log your house-fund balance</h2>
		<form method="POST" action="?/log" use:enhance class="card">
			<div class="cols-3">
				<label>Date <input type="date" name="date" value={data.today} required /></label>
				<label>Balance <input name="balance" inputmode="decimal" required /></label>
				<label>Note <input name="note" /></label>
			</div>
			<button class="primary">Log</button>
		</form>
		{#if data.entries.length}
			<div class="table-wrap">
				<table>
					<tbody>
						{#each [...data.entries].reverse() as e (e.id)}
							<tr>
								<td>{prettyDate(e.date)}</td>
								<td class="num">{money(e.balance)}</td>
								<td class="muted">{e.note}</td>
								<td class="num">
									<form method="POST" action="?/unlog" use:enhance>
										<input type="hidden" name="id" value={e.id} /><button class="small">✕</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<h2>Key dates</h2>
		<div class="card">
			{#each [...data.cfg.keyDates, { date: data.cfg.profile.targetClose + '-01', label: 'Target close' }].sort((a, b) => a.date.localeCompare(b.date)) as d (d.label)}
				{@const n = daysUntil(d.date)}
				<div class="spread small-text" style="padding:0.25rem 0">
					<span>{d.label}</span>
					<span class={n < 0 ? 'muted' : n < 60 ? 'warn' : ''}>{prettyDate(d.date)} · {n < 0 ? 'passed' : `${n}d`}</span>
				</div>
			{/each}
			<a href="/settings#dates" class="small-text">Edit dates →</a>
		</div>
	</div>

	<div>
		<h2>Steps</h2>
		<div class="card">
			{#each data.steps as s, i (i)}
				<div class="spread" style="padding:0.3rem 0;border-bottom:1px solid var(--line)">
					<form method="POST" action="?/toggle" use:enhance style="flex:1">
						<input type="hidden" name="i" value={i} />
						<button class="small" style="background:none;border:none;text-align:left;padding:0;min-height:0;font-weight:400;display:flex;gap:0.5rem;align-items:flex-start">
							<span class={s.done ? 'pos' : 'muted'}>{s.done ? '☑' : '☐'}</span>
							<span>
								<span style:text-decoration={s.done ? 'line-through' : null} class:muted={s.done}>{s.text}</span>
								<span class="muted small-text"> · {s.when}</span>
							</span>
						</button>
					</form>
					<form method="POST" action="?/removeStep" use:enhance>
						<input type="hidden" name="i" value={i} /><button class="small" style="min-height:28px;padding:0 0.4rem">✕</button>
					</form>
				</div>
			{/each}
			<form method="POST" action="?/addStep" use:enhance class="row" style="margin-top:0.6rem">
				<input name="text" placeholder="New step" style="flex:2;margin:0" />
				<input name="when" placeholder="When" style="flex:1;margin:0" />
				<button class="small">Add</button>
			</form>
		</div>
	</div>
</div>
