<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { ago } from '#lib/format.js';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	const tabs = [
		{ href: '/', label: 'Overview', icon: '⌂' },
		{ href: '/areas', label: 'Areas', icon: '▦' },
		{ href: '/compare', label: 'Compare', icon: '⇄' },
		{ href: '/listings', label: 'Listings', icon: '☰' },
		{ href: '/market', label: 'Market', icon: '↗' },
		{ href: '/plan', label: 'Plan', icon: '✓' }
	];

	function active(href: string) {
		return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	}
</script>

<svelte:head>
	<link rel="icon" href="/icon.svg" />
	<title>Home Buying</title>
</svelte:head>

<header>
	<a href="/" class="brand">⌂ Home Buying</a>
	<div class="row">
		<a href="/settings#data" class="muted small-text" class:warn={data.sourceErrors > 0}>
			{data.sourceErrors > 0 ? `${data.sourceErrors} feed error${data.sourceErrors > 1 ? 's' : ''} · ` : ''}data {ago(data.checked)}
		</a>
		<a href="/settings" class="gear" class:on={active('/settings')} aria-label="Settings">⚙</a>
	</div>
</header>

<main>
	{@render children()}
</main>

<nav>
	{#each tabs as t (t.href)}
		<a href={t.href} class:on={active(t.href)}>
			<span class="icon">{t.icon}</span>
			<span>{t.label}</span>
		</a>
	{/each}
</nav>

<style>
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: calc(0.6rem + env(safe-area-inset-top)) 1rem 0.6rem;
		border-bottom: 1px solid var(--line);
		background: var(--panel);
	}
	.brand {
		color: var(--text);
		font-weight: 700;
	}
	.gear {
		color: var(--muted);
		font-size: 1.25rem;
		line-height: 1;
	}
	.gear.on {
		color: var(--accent);
	}
	nav {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		background: var(--panel);
		border-top: 1px solid var(--line);
		padding-bottom: env(safe-area-inset-bottom);
	}
	nav a {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.5rem 0 0.55rem;
		color: var(--muted);
		font-size: 0.75rem;
		font-weight: 600;
	}
	nav a.on {
		color: var(--accent);
	}
	.icon {
		font-size: 1.2rem;
		line-height: 1.2;
	}
</style>
