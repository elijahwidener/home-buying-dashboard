<script lang="ts">
	import type { Chart as ChartType } from 'chart.js';

	export interface Series {
		label: string;
		data: (number | null)[];
		color: string;
		dashed?: boolean;
	}

	interface Props {
		labels: string[];
		series: Series[];
		/** How to print values: pct (7.4%), usd ($412k), num */
		format?: 'pct' | 'usd' | 'num';
		height?: number;
		kind?: 'line' | 'bar';
	}

	let { labels, series, format = 'num', height = 240, kind = 'line' }: Props = $props();

	let canvas: HTMLCanvasElement;
	let chart: ChartType | undefined;

	const fmt = (v: number, f: string) =>
		f === 'pct'
			? `${v.toFixed(2)}%`
			: f === 'usd'
				? Math.abs(v) >= 1e6
					? `$${(v / 1e6).toFixed(2)}M`
					: Math.abs(v) >= 1e4
						? `$${Math.round(v / 1000)}k`
						: `$${Math.round(v).toLocaleString('en-US')}`
				: Math.round(v * 10) / 10 + '';

	$effect(() => {
		const data = { labels: [...labels], series: series.map((s) => ({ ...s, data: [...s.data] })), format, kind };
		let cancelled = false;

		import('chart.js/auto').then(({ default: Chart }) => {
			if (cancelled) return;
			chart?.destroy();
			chart = new Chart(canvas, {
				type: data.kind,
				data: {
					labels: data.labels,
					datasets: data.series.map((s) => ({
						label: s.label,
						data: s.data,
						borderColor: s.color,
						backgroundColor: data.kind === 'bar' ? s.color : s.color + '22',
						borderDash: s.dashed ? [5, 4] : undefined,
						fill: false,
						tension: 0.2,
						spanGaps: true,
						pointRadius: s.data.length > 40 ? 0 : 2.5,
						borderWidth: 2
					}))
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					animation: false,
					interaction: { mode: 'index', intersect: false },
					plugins: {
						legend: { display: data.series.length > 1, labels: { color: '#a9b3c0', boxWidth: 12, boxHeight: 2 } },
						tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(Number(ctx.raw), data.format)}` } }
					},
					scales: {
						x: { ticks: { color: '#a9b3c0', maxTicksLimit: 7, maxRotation: 0 }, grid: { display: false } },
						y: { ticks: { color: '#a9b3c0', callback: (v) => fmt(Number(v), data.format) }, grid: { color: '#2a313b' } }
					}
				}
			});
		});

		return () => {
			cancelled = true;
		};
	});

	$effect(() => () => chart?.destroy());
</script>

<div class="chart" style:height="{height}px">
	<canvas bind:this={canvas}></canvas>
</div>

<style>
	.chart {
		position: relative;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.6rem;
		margin-bottom: 0.75rem;
	}
</style>
