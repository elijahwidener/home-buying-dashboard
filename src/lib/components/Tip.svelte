<script lang="ts">
	// An ⓘ that explains itself on hover, tap or keyboard focus.
	// Positioned with `fixed` so scrolling table wrappers don't clip it.
	let { text }: { text: string } = $props();

	let icon: HTMLSpanElement;
	let open = $state(false);
	let pos = $state({ left: 0, top: 0, above: false });

	function show() {
		const r = icon.getBoundingClientRect();
		const width = Math.min(260, window.innerWidth - 24);
		const left = Math.max(12, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 12));
		const above = r.bottom + 90 > window.innerHeight;
		pos = { left, top: above ? r.top - 6 : r.bottom + 6, above };
		open = true;
	}
</script>

<svelte:window onscroll={() => (open = false)} />

<span
	class="tip"
	bind:this={icon}
	tabindex="0"
	role="button"
	aria-label={text}
	onmouseenter={show}
	onmouseleave={() => (open = false)}
	onfocus={show}
	onblur={() => (open = false)}
	onclick={(e) => {
		e.stopPropagation();
		if (open) open = false;
		else show();
	}}
	onkeydown={(e) => e.key === 'Escape' && (open = false)}
>ⓘ</span>
{#if open}
	<span class="tip-text" class:above={pos.above} role="tooltip" style:left="{pos.left}px" style:top="{pos.top}px">{text}</span>
{/if}

<style>
	.tip {
		display: inline-block;
		margin-left: 0.3rem;
		color: var(--accent);
		cursor: help;
		border-radius: 50%;
		line-height: 1;
	}
	.tip:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.tip-text {
		position: fixed;
		z-index: 50;
		width: max-content;
		max-width: min(260px, calc(100vw - 24px));
		padding: 0.5rem 0.65rem;
		font-size: 0.82rem;
		line-height: 1.35;
		font-weight: 400;
		white-space: normal;
		color: var(--text);
		background: var(--panel-2);
		border: 1px solid var(--line);
		border-radius: 8px;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
		pointer-events: none;
	}
	.tip-text.above {
		transform: translateY(-100%);
	}
</style>
