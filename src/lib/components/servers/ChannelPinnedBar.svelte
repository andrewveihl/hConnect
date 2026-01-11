<script lang="ts">
	import { createEventDispatcher, onDestroy, onMount } from 'svelte';
	import type { PinnedMessage } from '$lib/firestore/messages';

	interface Props {
		items?: PinnedMessage[];
		canManagePins?: boolean;
	}

	let { items = [], canManagePins = false }: Props = $props();
	let open = $state(false);
	let root = $state<HTMLDivElement | null>(null);

	const dispatch = createEventDispatcher<{
		open: { messageId: string; linkUrl?: string | null };
		unpin: { messageId: string };
	}>();

	type PinIcon = { icon: string; label: string; color: string; bg: string; customSvg?: 'meet' };

	function iconFor(pin: PinnedMessage): PinIcon {
		const kind = (pin.linkKind ?? pin.messageType ?? '').toLowerCase();
		if (kind.includes('meet'))
			return {
				icon: 'bx-video',
				customSvg: 'meet',
				label: 'Google Meet',
				color: '#0f9d58',
				bg: 'rgba(15,157,88,0.14)'
			};
		if (kind.includes('doc')) return { icon: 'bx-file', label: 'Doc', color: '#4285f4', bg: 'rgba(66,133,244,0.16)' };
		if (kind.includes('sheet')) return { icon: 'bx-table', label: 'Sheet', color: '#0f9d58', bg: 'rgba(15,157,88,0.16)' };
		if (kind.includes('slide')) return { icon: 'bx-slideshow', label: 'Slides', color: '#fbbc04', bg: 'rgba(251,188,4,0.16)' };
		if (kind.includes('form')) return { icon: 'bx-list-check', label: 'Form', color: '#673ab7', bg: 'rgba(103,58,183,0.16)' };
		if (kind.includes('drive')) return { icon: 'bxl-google', label: 'Drive', color: '#34a853', bg: 'rgba(52,168,83,0.16)' };
		if (kind.includes('office') || kind.includes('word')) return { icon: 'bxl-microsoft', label: 'Office', color: '#185abd', bg: 'rgba(24,90,189,0.16)' };
		if (kind.includes('pdf')) return { icon: 'bx-file-find', label: 'PDF', color: '#c5221f', bg: 'rgba(197,34,31,0.16)' };
		if (kind.includes('gif')) return { icon: 'bx-image', label: 'Media', color: '#d14eff', bg: 'rgba(209,78,255,0.16)' };
		if (kind.includes('file')) return { icon: 'bx-paperclip', label: 'File', color: '#5f6368', bg: 'rgba(95,99,104,0.14)' };
		if (kind.includes('link')) return { icon: 'bx-link-external', label: 'Link', color: '#5f6368', bg: 'rgba(95,99,104,0.14)' };
		return { icon: 'bx-pin', label: 'Pinned', color: '#5f6368', bg: 'rgba(95,99,104,0.14)' };
	}

	function formatHost(url: string | null | undefined) {
		if (!url) return '';
		try {
			const host = new URL(url).hostname.replace(/^www\./, '');
			return host;
		} catch {
			return '';
		}
	}

	function formatPinnedAt(ms: number | null | undefined) {
		if (!ms || Number.isNaN(ms)) return '';
		const date = new Date(ms);
		return date.toLocaleString(undefined, { month: 'short', day: 'numeric' });
	}

	function isMeet(pin: PinnedMessage) {
		const kind = (pin.linkKind ?? pin.messageType ?? '').toLowerCase();
		const url = (pin.linkUrl ?? '').toLowerCase();
		return kind.includes('meet') || url.includes('meet.google.com');
	}

	function toggle() {
		open = !open;
	}

	onMount(() => {
		const handlePointer = (event: PointerEvent) => {
			if (!root) return;
			if (!open) return;
			if (!(event.target instanceof Node)) return;
			if (!root.contains(event.target)) open = false;
		};
		document.addEventListener('pointerdown', handlePointer);
		return () => document.removeEventListener('pointerdown', handlePointer);
	});
</script>

{#if items.length}
	<div class="pinned-bar" bind:this={root}>
		<button class="pinned-pill" type="button" onclick={toggle} aria-expanded={open} aria-label="Pinned messages">
			<i class="bx bx-pin"></i>
			<span class="pinned-pill__count">{items.length}</span>
		</button>
		{#if open}
			<div class="pinned-menu" role="menu">
				{#each items as pin (pin.id)}
					{@const icon = iconFor(pin)}
					{@const meet = isMeet(pin)}
					<div
						class="pinned-card"
						role="menuitem"
						tabindex="0"
						onclick={() => dispatch('open', { messageId: pin.messageId, linkUrl: pin.linkUrl })}
						onkeydown={(event) => {
							if (event.key === 'Enter' || event.key === ' ') {
								event.preventDefault();
								dispatch('open', { messageId: pin.messageId, linkUrl: pin.linkUrl });
							}
						}}
					>
						<div class="pinned-card__icon" style={`color:${icon.color}; background:${icon.bg};`}>
							{#if icon.customSvg === 'meet'}
								<svg
									class="pinned-card__svg"
									viewBox="0 0 48 48"
									role="img"
									aria-hidden="true"
								>
									<!-- Google Meet multi-color mark -->
									<path fill="#ea4335" d="M6 6h14v14H6z" />
									<path fill="#4285f4" d="M6 28h14v14H6z" />
									<path fill="#fbbc04" d="M20 6h12v14H20z" />
									<path fill="#34a853" d="M20 28h12v14H20z" />
									<path fill="#ffffff" d="M14 18h12v12H14z" />
									<path fill="#0f9d58" d="M32 12l10-6v36l-10-6z" />
									<path fill="#34a853" d="M32 18H20v12h12l10 6V12z" />
								</svg>
							{:else}
								<i class={`bx ${icon.icon}`} aria-hidden="true"></i>
							{/if}
						</div>
						<div class="pinned-card__body">
							<div class="pinned-card__title-row">
								<div class="pinned-card__title">{pin.title}</div>
								{#if pin.linkUrl && !meet}
									<div class="pinned-card__chip">{formatHost(pin.linkUrl)}</div>
								{/if}
							</div>
							{#if !meet}
								{#if pin.preview}
									<div class="pinned-card__preview">{pin.preview}</div>
								{/if}
								<div class="pinned-card__meta">
									<span>{icon.label}</span>
									{#if pin.pinnedAt}
										<span aria-hidden="true">•</span>
										<span>{formatPinnedAt(pin.pinnedAt)}</span>
									{/if}
								</div>
							{/if}
						</div>
						{#if canManagePins}
							<button
								type="button"
								class="pinned-card__unpin"
								title="Unpin"
								aria-label="Unpin message"
								onclick={(event) => {
									event.stopPropagation();
									dispatch('unpin', { messageId: pin.messageId });
								}}
							>
								<i class="bx bx-x" aria-hidden="true"></i>
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.pinned-bar {
		padding: 0.5rem 0.65rem 0.55rem;
		border-bottom: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-panel-muted) 75%, transparent);
		overflow: visible;
		display: flex;
		justify-content: flex-start;
		position: relative;
	}

	.pinned-bar__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.2rem;
	}

	.pinned-pill {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-panel) 60%, transparent);
	}

	.pinned-pill i {
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 0.5rem;
		background: linear-gradient(135deg, var(--color-accent) 10%, color-mix(in srgb, var(--color-accent) 20%, transparent));
		color: var(--color-contrast-on-accent, #0b1224);
		display: grid;
		place-items: center;
		font-size: 0.85rem;
	}

	.pinned-pill__count {
		font-weight: 700;
		color: var(--text-80);
	}

	.pinned-card {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.5rem;
		align-items: center;
		padding: 0.38rem 0.55rem 0.42rem;
		min-width: 200px;
		border-radius: 0.65rem;
		background: color-mix(in srgb, var(--color-panel) 55%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
		box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
		transition: border-color 120ms ease, box-shadow 120ms ease;
	}

	.pinned-card:hover,
	.pinned-card:focus-visible {
		border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border-subtle));
		box-shadow: 0 10px 20px rgba(0, 0, 0, 0.12);
		outline: none;
	}

	.pinned-menu {
		position: absolute;
		top: calc(100% + 0.3rem);
		right: 0;
		min-width: 240px;
		max-width: min(420px, 90vw);
		background: var(--color-panel);
		border: 1px solid var(--color-border-subtle);
		border-radius: 0.8rem;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
		padding: 0.35rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		z-index: 10;
	}

	.pinned-card__icon {
		width: 1.8rem;
		height: 1.8rem;
		border-radius: 0.6rem;
		display: grid;
		place-items: center;
	}

	.pinned-card__icon i {
		font-size: 1.05rem;
	}

	.pinned-card__svg {
		width: 1.05rem;
		height: 1.05rem;
	}

	.pinned-card__body {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
	}

	.pinned-card__title-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.pinned-card__title {
		font-weight: 700;
		line-height: 1.2;
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pinned-card__chip {
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-panel-muted) 70%, transparent);
		border: 1px solid var(--color-border-subtle);
		font-size: 0.75rem;
		color: var(--text-70);
	}

	.pinned-card__preview {
		font-size: 0.86rem;
		color: var(--text-80);
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.pinned-card__meta {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.8rem;
		color: var(--text-70);
	}

	.pinned-card__unpin {
		align-self: center;
		padding: 0.25rem;
		border-radius: 0.75rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
		background: transparent;
		color: var(--text-70);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.1rem;
		height: 2.1rem;
		transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.pinned-card__unpin:hover,
	.pinned-card__unpin:focus-visible {
		color: var(--color-accent);
		border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		outline: none;
	}

	@media (max-width: 767px) {
		.pinned-bar {
			padding: 0.45rem 0.6rem 0.2rem;
		}
	}
</style>
