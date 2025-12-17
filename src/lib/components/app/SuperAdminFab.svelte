<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy, tick } from 'svelte';
	import { user } from '$lib/stores/user';
	import { superAdminEmailsStore } from '$lib/admin/superAdmin';
	import { fabSnapStore, isFabSnappingDisabled, type SnapZone } from '$lib/stores/fabSnap';

	const superAdminEmails = superAdminEmailsStore();
	const isSuperAdmin = $derived(
		(() => {
			const email = $user?.email ? $user.email.toLowerCase() : null;
			if (!email) return false;
			const allowList = Array.isArray($superAdminEmails) ? $superAdminEmails : [];
			return allowList.includes(email);
		})()
	);

	// Position management
	const STORAGE_KEY = 'hconnect:superAdminFab:position';
	const FAB_ID = 'super-admin-fab';
	const FAB_SIZE = 48; // 3rem - matches rail-button size when snapped
	const MIN_MARGIN = 8;

	type Position = { x: number; y: number };

	let fabEl = $state<HTMLButtonElement | null>(null);
	let position = $state<Position>({ x: 0, y: 0 });
	let ready = $state(false);
	let dragging = $state(false);
	let dragOffset: Position = { x: 0, y: 0 };
	let dragStartTime = 0;
	let isSnapped = $state(false);
	let snappedZoneId: string | null = $state(null);
	let nearSnapZone: SnapZone | null = $state(null);

	function loadSavedPosition(): Position | null {
		if (!browser) return null;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as Position;
			if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
				return parsed;
			}
		} catch {
			// ignore
		}
		return null;
	}

	function persistPosition(value: Position, snapped: boolean = false, zoneId?: string) {
		if (!browser) return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
		fabSnapStore.setSnapped(FAB_ID, snapped, zoneId);
	}

	function clampToViewport(value: Position): Position {
		if (!browser) return value;
		const maxX = Math.max(MIN_MARGIN, window.innerWidth - FAB_SIZE - MIN_MARGIN);
		const maxY = Math.max(MIN_MARGIN, window.innerHeight - FAB_SIZE - MIN_MARGIN);
		return {
			x: Math.min(Math.max(value.x, MIN_MARGIN), maxX),
			y: Math.min(Math.max(value.y, MIN_MARGIN), maxY)
		};
	}

	async function initPosition() {
		if (!browser) {
			ready = true;
			return;
		}
		await tick();

		// Check if we were snapped to a zone (only if snapping is enabled)
		const wasSnapped = !$isFabSnappingDisabled && fabSnapStore.isSnappedToRail(FAB_ID);
		const savedZoneId = fabSnapStore.getSnappedZoneId(FAB_ID);
		if (wasSnapped && savedZoneId) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			const zones = fabSnapStore.getZones();
			const zone = zones.find((z) => z.id === savedZoneId) || zones[0];
			if (zone) {
				const snapPos = fabSnapStore.getSnapPosition(zone, FAB_SIZE);
				position = clampToViewport(snapPos);
				isSnapped = true;
				snappedZoneId = zone.id;
				fabSnapStore.occupyZone(zone.id, FAB_ID);
				ready = true;
				return;
			}
		}

		const saved = loadSavedPosition();
		if (saved) {
			position = clampToViewport(saved);
		} else {
			// Default: bottom-right area
			position = clampToViewport({
				x: window.innerWidth - FAB_SIZE - 20,
				y: window.innerHeight - FAB_SIZE - 100
			});
		}
		ready = true;
	}

	function checkNearSnapZone(): SnapZone | null {
		if (!browser || $isFabSnappingDisabled) return null;
		const fabCenterX = position.x + FAB_SIZE / 2;
		const fabCenterY = position.y + FAB_SIZE / 2;
		return fabSnapStore.findSnapZone(fabCenterX, fabCenterY, FAB_ID);
	}

	function snapToZone(zone: SnapZone) {
		const snapPos = fabSnapStore.getSnapPosition(zone, FAB_SIZE);
		position = clampToViewport(snapPos);
		isSnapped = true;
		snappedZoneId = zone.id;
		fabSnapStore.occupyZone(zone.id, FAB_ID);
		persistPosition(position, true, zone.id);
	}

	function handlePointerDown(event: PointerEvent) {
		if (!fabEl) return;
		event.preventDefault();
		event.stopPropagation();
		dragStartTime = Date.now();
		dragOffset = {
			x: event.clientX - position.x,
			y: event.clientY - position.y
		};
		fabEl.setPointerCapture(event.pointerId);
		dragging = true;

		if (isSnapped) {
			fabSnapStore.releaseZone(FAB_ID);
			isSnapped = false;
			snappedZoneId = null;
		}
	}

	function handlePointerMove(event: PointerEvent) {
		if (!dragging) return;
		event.stopPropagation();
		event.preventDefault();
		position = clampToViewport({
			x: event.clientX - dragOffset.x,
			y: event.clientY - dragOffset.y
		});

		nearSnapZone = checkNearSnapZone();
		if (browser) {
			window.dispatchEvent(
				new CustomEvent('fabNearSnapZone', {
					detail: { zoneId: nearSnapZone?.id ?? null }
				})
			);
		}
	}

	function handlePointerUp(event: PointerEvent) {
		if (!dragging) return;
		event.stopPropagation();
		fabEl?.releasePointerCapture(event.pointerId);

		const dragDuration = Date.now() - dragStartTime;
		const wasDrag = dragDuration > 200;

		nearSnapZone = null;
		if (browser) {
			window.dispatchEvent(new CustomEvent('fabNearSnapZone', { detail: { zoneId: null } }));
		}

		if (wasDrag) {
			const snapZone = checkNearSnapZone();
			if (snapZone) {
				snapToZone(snapZone);
			} else {
				persistPosition(position, false);
			}
		}
		dragging = false;

		// If it was a quick tap (not a drag), open admin
		if (!wasDrag) {
			goto('/admin');
		}
	}

	function handleSnapZoneUpdated() {
		if (!isSnapped || !snappedZoneId) return;
		const zones = fabSnapStore.getZones();
		const zone = zones.find((z) => z.id === snappedZoneId);
		if (zone) {
			const snapPos = fabSnapStore.getSnapPosition(zone, FAB_SIZE);
			position = clampToViewport(snapPos);
		}
	}

	onMount(() => {
		if (browser) {
			initPosition();
			window.addEventListener('fabSnapZoneUpdated', handleSnapZoneUpdated);
		}
	});

	onDestroy(() => {
		if (browser) {
			window.removeEventListener('fabSnapZoneUpdated', handleSnapZoneUpdated);
		}
	});
</script>

{#if isSuperAdmin}
	<div
		class="super-admin-fab-wrapper"
		class:super-admin-fab-wrapper--ready={ready}
		class:super-admin-fab-wrapper--snapped={isSnapped}
		class:super-admin-fab-wrapper--near-snap={nearSnapZone !== null}
		style="transform: translate3d({position.x}px, {position.y}px, 0);"
	>
		<button
			bind:this={fabEl}
			type="button"
			class="super-admin-fab"
			class:super-admin-fab--dragging={dragging}
			class:super-admin-fab--snapped={isSnapped}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
			aria-label="Open Super Admin Center"
			title="Super Admin Center"
		>
			<i class="bx bx-shield-quarter" aria-hidden="true"></i>
		</button>
	</div>
{/if}

<style>
	.super-admin-fab-wrapper {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 65;
		opacity: 0;
		pointer-events: none;
		transition: opacity 200ms ease;
	}

	.super-admin-fab-wrapper--ready {
		opacity: 1;
		pointer-events: auto;
	}

	.super-admin-fab-wrapper--snapped {
		transition: transform 200ms ease-out;
	}

	.super-admin-fab-wrapper--near-snap {
		filter: drop-shadow(0 0 8px var(--color-accent, #14b8a6));
	}

	.super-admin-fab {
		width: 3.1rem;
		height: 3.1rem;
		border-radius: 999px;
		border: 1px solid rgba(125, 211, 252, 0.65);
		background: linear-gradient(135deg, rgba(46, 196, 182, 0.98), rgba(14, 165, 233, 0.92));
		box-shadow: 0 14px 26px rgba(14, 165, 233, 0.32);
		color: #f8fafc;
		display: grid;
		place-items: center;
		font-size: 1.2rem;
		cursor: grab;
		transition:
			transform 180ms cubic-bezier(0.2, 0.65, 0.25, 1),
			box-shadow 180ms ease,
			width 200ms ease,
			height 200ms ease;
		touch-action: none;
		user-select: none;
	}

	.super-admin-fab--snapped {
		width: 3rem;
		height: 3rem;
		box-shadow: 0 8px 18px rgba(14, 165, 233, 0.25);
	}

	.super-admin-fab--dragging {
		cursor: grabbing;
		box-shadow: 0 20px 40px rgba(14, 165, 233, 0.45);
	}

	.super-admin-fab:hover:not(.super-admin-fab--dragging),
	.super-admin-fab:focus-visible {
		transform: translateY(-2px);
		box-shadow: 0 18px 32px rgba(14, 165, 233, 0.45);
		outline: none;
	}
</style>
