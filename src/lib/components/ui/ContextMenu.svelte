<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';

	interface MenuItem {
		label: string;
		icon?: string;
		action: () => void;
		disabled?: boolean;
		danger?: boolean;
	}

	interface Props {
		items: MenuItem[];
		onClose?: () => void;
	}

	let { items, onClose = () => {} }: Props = $props();

	let menuRef: HTMLDivElement | null = $state(null);
	let x = $state(0);
	let y = $state(0);
	let visible = $state(false);

	// Long-press tracking
	let longPressTimer: number | null = null;
	let longPressStart: { x: number; y: number } | null = null;
	const LONG_PRESS_DURATION = 500;
	const LONG_PRESS_MOVE_THRESHOLD = 10;

	export function show(clientX: number, clientY: number) {
		x = clientX;
		y = clientY;
		visible = true;
		// Adjust position to keep menu in viewport
		if (browser) {
			requestAnimationFrame(() => {
				if (menuRef) {
					const rect = menuRef.getBoundingClientRect();
					const viewportWidth = window.innerWidth;
					const viewportHeight = window.innerHeight;

					if (rect.right > viewportWidth) {
						x = viewportWidth - rect.width - 8;
					}
					if (rect.bottom > viewportHeight) {
						y = viewportHeight - rect.height - 8;
					}
					if (x < 8) x = 8;
					if (y < 8) y = 8;
				}
			});
		}
	}

	export function hide() {
		visible = false;
		onClose();
	}

	export function startLongPress(event: PointerEvent | TouchEvent) {
		if (longPressTimer !== null) {
			clearTimeout(longPressTimer);
		}
		
		const touch = 'touches' in event ? event.touches[0] : event;
		longPressStart = { x: touch.clientX, y: touch.clientY };
		
		longPressTimer = window.setTimeout(() => {
			longPressTimer = null;
			if (longPressStart) {
				// Trigger haptic feedback on mobile if supported
				if (browser && 'vibrate' in navigator) {
					navigator.vibrate(50);
				}
				show(longPressStart.x, longPressStart.y);
			}
		}, LONG_PRESS_DURATION);
	}

	export function cancelLongPress() {
		if (longPressTimer !== null) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
		longPressStart = null;
	}

	export function handleLongPressMove(event: PointerEvent | TouchEvent) {
		if (!longPressStart) return;
		
		const touch = 'touches' in event ? event.touches[0] : event;
		const dx = Math.abs(touch.clientX - longPressStart.x);
		const dy = Math.abs(touch.clientY - longPressStart.y);
		
		if (dx > LONG_PRESS_MOVE_THRESHOLD || dy > LONG_PRESS_MOVE_THRESHOLD) {
			cancelLongPress();
		}
	}

	function handleItemClick(item: MenuItem) {
		if (item.disabled) return;
		item.action();
		hide();
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			hide();
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			hide();
		}
	}

	$effect(() => {
		if (visible && browser) {
			document.addEventListener('keydown', handleKeyDown);
			return () => document.removeEventListener('keydown', handleKeyDown);
		}
	});

	onDestroy(() => {
		cancelLongPress();
	});
</script>

{#if visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="context-menu-backdrop"
		onclick={handleBackdropClick}
		ontouchstart={() => hide()}
	>
		<div
			bind:this={menuRef}
			class="context-menu"
			style="left: {x}px; top: {y}px;"
			role="menu"
			tabindex="-1"
		>
			{#each items as item}
				<button
					type="button"
					class="context-menu__item"
					class:context-menu__item--danger={item.danger}
					class:context-menu__item--disabled={item.disabled}
					disabled={item.disabled}
					onclick={() => handleItemClick(item)}
					role="menuitem"
				>
					{#if item.icon}
						<i class="bx {item.icon} context-menu__icon"></i>
					{/if}
					<span>{item.label}</span>
				</button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.context-menu-backdrop {
		position: fixed;
		inset: 0;
		z-index: 9999;
		background: transparent;
	}

	.context-menu {
		position: fixed;
		min-width: 160px;
		max-width: 280px;
		background: var(--color-surface-elevated, #2f3136);
		border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1));
		border-radius: 8px;
		padding: 6px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		z-index: 10000;
		animation: context-menu-fade-in 0.1s ease-out;
	}

	@keyframes context-menu-fade-in {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	.context-menu__item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 10px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--color-text-primary, #dcddde);
		font-size: 0.875rem;
		text-align: left;
		cursor: pointer;
		transition: background-color 0.1s ease;
	}

	.context-menu__item:hover:not(:disabled) {
		background: var(--color-accent, #5865f2);
		color: white;
	}

	.context-menu__item:hover:not(:disabled) .context-menu__icon {
		color: white;
	}

	.context-menu__item--danger {
		color: #ed4245;
	}

	.context-menu__item--danger:hover:not(:disabled) {
		background: #ed4245;
		color: white;
	}

	.context-menu__item--disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.context-menu__icon {
		font-size: 1.125rem;
		color: var(--color-text-secondary, #b9bbbe);
		flex-shrink: 0;
	}
</style>
