<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy, tick } from 'svelte';
	import { user } from '$lib/stores/user';
	import { superAdminEmailsStore } from '$lib/admin/superAdmin';
	import { fabSnapStore, isFabSnappingDisabled, type SnapZone } from '$lib/stores/fabSnap';

	// Page awareness - derived values defined after state declarations below
	const isAdminPage = $derived($page?.url?.pathname?.startsWith('/admin') ?? false);

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
	
	// Page awareness - hide on admin pages unless snapped to tray
	const isSnappedToTray = $derived(isSnapped && (snappedZoneId ?? '').startsWith('fab-tray-slot-'));
	// Only hide on admin page if NOT snapped to the tray dock
	const hideOnAdminPage = $derived(isAdminPage && !isSnappedToTray);
	
	// Tray awareness - for hiding when snapped to tray and tray is closed
	let trayOpen = $state(false);
	let userClosedTray = $state(true); // Start true so FABs snapped to tray are hidden until tray opens
	let positionReady = $state(false); // Track if position has been calculated for tray-snapped FABs
	let trayUnmounted = $state(false); // Track if tray component unmounted (vs user closing)
	
	// Combined hidden state - either hidden in closed tray OR hidden on admin page (when not in tray)
	const hiddenInClosedTray = $derived(
		isSnapped && 
		(snappedZoneId ?? '').startsWith('fab-tray-slot-') && 
		(!trayOpen || !positionReady) &&
		!trayUnmounted
	);
	const shouldHide = $derived(hiddenInClosedTray || hideOnAdminPage);

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
			// If snapped to a tray slot, stay snapped even if tray isn't in DOM
			// This keeps the FAB hidden when navigating to pages without the tray
			if (savedZoneId.startsWith('fab-tray-slot-')) {
				isSnapped = true;
				snappedZoneId = savedZoneId;
				userClosedTray = true; // Ensure FAB stays hidden until tray opens
				positionReady = false; // Position not calculated yet - will be set when tray opens
				
				// Try to occupy the zone if it exists (tray might already be rendered)
				const slotIndex = parseInt(savedZoneId.replace('fab-tray-slot-', ''), 10);
				const slot = document.querySelector(`.fab-tray__slot[data-slot="${slotIndex}"]`) as HTMLElement;
				if (slot && slot.getBoundingClientRect().width > 0) {
					const rect = slot.getBoundingClientRect();
					// Center the FAB in the slot - use same formula as other FABs
					position = { 
						x: rect.left + (rect.width - FAB_SIZE) / 2, 
						y: rect.top + (rect.height - FAB_SIZE) / 2 
					};
					fabSnapStore.registerZone({
						id: savedZoneId,
						x: rect.left,
						y: rect.top,
						width: rect.width,
						height: rect.height
					});
					fabSnapStore.occupyZone(savedZoneId, FAB_ID);
					positionReady = true; // Position is valid now
				}
				
				ready = true;
				return;
			}
			
			await new Promise((resolve) => setTimeout(resolve, 100));
			fabSnapStore.ensureZone(savedZoneId);
			const zones = fabSnapStore.getZones();
			const zone =
				zones.find((z) => z.id === savedZoneId) ||
				(!savedZoneId.includes('-stack-') ? zones[0] : null);
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

	const SNAP_THRESHOLD_PX = 150; // Distance in pixels to trigger snap (increased for easier snapping)

	function checkNearSnapZone(): SnapZone | null {
		if (!browser) return null;
		
		const fabCenterX = position.x + FAB_SIZE / 2;
		const fabCenterY = position.y + FAB_SIZE / 2;
		
		// Directly query tray slots in DOM - more reliable than store-based zones
		const traySlots = document.querySelectorAll('.fab-tray__slot');
		
		if (traySlots.length > 0) {
			let bestSlot: { index: number; rect: DOMRect; distance: number } | null = null;
			
			for (let i = 0; i < traySlots.length; i++) {
				const slot = traySlots[i] as HTMLElement;
				const rect = slot.getBoundingClientRect();
				
				// Skip if slot is not visible (hidden tray)
				if (rect.width === 0 || rect.height === 0) continue;
				
				const slotCenterX = rect.left + rect.width / 2;
				const slotCenterY = rect.top + rect.height / 2;
				const distance = Math.sqrt((fabCenterX - slotCenterX) ** 2 + (fabCenterY - slotCenterY) ** 2);
				
				if (distance < SNAP_THRESHOLD_PX && (!bestSlot || distance < bestSlot.distance)) {
					bestSlot = { index: i, rect, distance };
				}
			}
			
			if (bestSlot) {
				// Check if slot is already occupied by another FAB
				const zoneId = `fab-tray-slot-${bestSlot.index}`;
				const snappedFabs = fabSnapStore.getSnappedFabs();
				const slotOccupied = snappedFabs.some(f => 
					f.zoneId === zoneId && f.fabId !== FAB_ID
				);
				
				// Don't snap to occupied slots
				if (slotOccupied) {
					return null;
				}
				
				return {
					id: zoneId,
					x: bestSlot.rect.left,
					y: bestSlot.rect.top,
					width: bestSlot.rect.width,
					height: bestSlot.rect.height
				} as SnapZone;
			}
		}
		
		// Fallback to store-based zones if DOM query found nothing
		if (!$isFabSnappingDisabled) {
			return fabSnapStore.findSnapZone(fabCenterX, fabCenterY, FAB_ID);
		}
		
		return null;
	}

	function snapToZone(zone: SnapZone) {
		// Calculate snap position: center the FAB on the zone (same formula as other FABs)
		const snapX = zone.x + (zone.width - FAB_SIZE) / 2;
		const snapY = zone.y + (zone.height - FAB_SIZE) / 2;
		
		position = clampToViewport({ x: snapX, y: snapY });
		isSnapped = true;
		snappedZoneId = zone.id;
		positionReady = true; // Position is valid since we just calculated it
		
		// Register zone with store for persistence
		if (zone.id.startsWith('fab-tray-slot-')) {
			fabSnapStore.registerZone({
				id: zone.id,
				x: zone.x,
				y: zone.y,
				width: zone.width,
				height: zone.height
			});
		}
		fabSnapStore.occupyZone(zone.id, FAB_ID);
		persistPosition(position, true, zone.id);
	}

	let hasMoved = false; // Track if actual drag movement occurred
	let dragStartPos = { x: 0, y: 0 }; // Track initial position
	const DRAG_THRESHOLD = 5; // Minimum pixels to consider it a drag

	function handlePointerDown(event: PointerEvent) {
		if (!fabEl) return;
		event.preventDefault();
		event.stopPropagation();
		dragStartTime = Date.now();
		hasMoved = false;
		dragStartPos = { x: event.clientX, y: event.clientY };
		dragOffset = {
			x: event.clientX - position.x,
			y: event.clientY - position.y
		};
		fabEl.setPointerCapture(event.pointerId);
		dragging = true;
		
		// Don't dispatch fabDragStart here - wait until actual movement is detected
	}

	function handlePointerMove(event: PointerEvent) {
		if (!dragging) return;
		event.stopPropagation();
		event.preventDefault();
		
		// Check if movement exceeds threshold (actual drag vs tap)
		const dx = Math.abs(event.clientX - dragStartPos.x);
		const dy = Math.abs(event.clientY - dragStartPos.y);
		
		if (!hasMoved && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
			hasMoved = true;
			
			// NOW dispatch fabDragStart - only when actual dragging starts
			if (browser) {
				window.dispatchEvent(new CustomEvent('fabDragStart', { detail: { fabId: FAB_ID } }));
			}
			
			// Release snap state on first actual movement
			if (isSnapped) {
				fabSnapStore.releaseZone(FAB_ID);
				isSnapped = false;
				snappedZoneId = null;
				positionReady = false;
			}
		}
		
		if (!hasMoved) return; // Don't update position until threshold is exceeded
		
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

		nearSnapZone = null;
		
		// Only dispatch drag end if we actually started a drag
		if (hasMoved && browser) {
			window.dispatchEvent(new CustomEvent('fabNearSnapZone', { detail: { zoneId: null } }));
			window.dispatchEvent(new CustomEvent('fabDragEnd', { detail: { fabId: FAB_ID } }));
		}

		if (hasMoved) {
			// Was an actual drag - check for snap zone
			const snapZone = checkNearSnapZone();
			if (snapZone) {
				snapToZone(snapZone);
			} else {
				persistPosition(position, false);
			}
		} else {
			// Was a tap (no movement) - navigate to admin
			goto('/admin');
		}
		
		dragging = false;
		hasMoved = false;
	}

	function stopTouchPropagation(event: TouchEvent) {
		event.stopPropagation();
	}

	function handleSnapZoneUpdated() {
		if (!isSnapped || !snappedZoneId?.startsWith('fab-tray-slot-')) return;
		const slotIndex = parseInt(snappedZoneId.replace('fab-tray-slot-', ''), 10);
		const slot = document.querySelector(`.fab-tray__slot[data-slot="${slotIndex}"]`) as HTMLElement;
		if (slot) {
			const rect = slot.getBoundingClientRect();
			const snapX = rect.left + (rect.width - FAB_SIZE) / 2;
			const snapY = rect.top + (rect.height - FAB_SIZE) / 2;
			position = clampToViewport({ x: snapX, y: snapY });
			// Re-occupy the zone to ensure it's marked as occupied
			fabSnapStore.occupyZone(snappedZoneId, FAB_ID);
		}
	}

	// Track whether we've registered the FAB
	let isRegistered = $state(false);

	// Effect to register/unregister based on isSuperAdmin
	$effect(() => {
		if (!browser) return;
		
		if (isSuperAdmin && !isRegistered) {
			// Register this FAB with the snap store
			fabSnapStore.registerFab({
				id: FAB_ID,
				label: 'Super Admin',
				icon: 'bx-shield-quarter'
			});
			isRegistered = true;
		} else if (!isSuperAdmin && isRegistered) {
			// Unregister when no longer a super admin
			fabSnapStore.unregisterFab(FAB_ID);
			isRegistered = false;
		}
	});

	// Handle tray state changes
	function handleTrayStateChange(e: CustomEvent<{ open: boolean; unmounting?: boolean; mounting?: boolean }>) {
		const wasOpen = trayOpen;
		trayOpen = e.detail.open;
		
		// Track if tray is unmounting (vs user closing)
		if (e.detail.unmounting) {
			trayUnmounted = true;
			// Don't change positionReady - FAB should show in default position when tray is gone
			return;
		}
		
		// Tray is mounting (back in DOM) - reset unmounted flag
		if (e.detail.mounting) {
			trayUnmounted = false;
			// Don't change other state - let FAB stay hidden until user opens tray
			return;
		}
		
		// Tray is back (mounting) - reset unmounted flag (legacy check)
		if (trayOpen && trayUnmounted) {
			trayUnmounted = false;
		}
		
		if (wasOpen && !trayOpen) {
			userClosedTray = true;
			positionReady = false; // Reset when tray closes
		} else if (!wasOpen && trayOpen) {
			userClosedTray = false;
		}
		
		// Update position when tray opens and FAB is snapped to tray
		if (trayOpen && isSnapped && snappedZoneId?.startsWith('fab-tray-slot-')) {
			// Use longer delay (250ms) to ensure tray animation is complete before reading positions
			setTimeout(() => {
				const slotIndex = parseInt(snappedZoneId?.replace('fab-tray-slot-', '') ?? '0', 10);
				const slot = document.querySelector(`.fab-tray__slot[data-slot="${slotIndex}"]`) as HTMLElement;
				if (slot) {
					const rect = slot.getBoundingClientRect();
					// Only update if slot has valid dimensions (tray is visible)
					if (rect.width > 0 && rect.height > 0) {
						const snapX = rect.left + (rect.width - FAB_SIZE) / 2;
						const snapY = rect.top + (rect.height - FAB_SIZE) / 2;
						position = clampToViewport({ x: snapX, y: snapY });
						positionReady = true; // Position is now valid, FAB can show
						
						// Re-register the zone occupation now that the zone exists
						fabSnapStore.registerZone({
							id: snappedZoneId!,
							x: rect.left,
							y: rect.top,
							width: rect.width,
							height: rect.height
						});
						fabSnapStore.occupyZone(snappedZoneId!, FAB_ID);
					}
				}
			}, 250);
		}
	}

	function handleFabSnapSynced(event: CustomEvent<{ fabIds: string[] }>) {
		if (!event?.detail?.fabIds?.includes(FAB_ID)) return;
		if (dragging) return;
		void initPosition();
	}

	onMount(() => {
		if (browser) {
			initPosition();
			window.addEventListener('fabSnapZoneUpdated', handleSnapZoneUpdated);
			window.addEventListener('fabSnapStateSynced', handleFabSnapSynced as EventListener);
			window.addEventListener('fabTrayStateChange', handleTrayStateChange as EventListener);
		}
	});

	onDestroy(() => {
		if (browser) {
			window.removeEventListener('fabSnapZoneUpdated', handleSnapZoneUpdated);
			window.removeEventListener('fabSnapStateSynced', handleFabSnapSynced as EventListener);
			window.removeEventListener('fabTrayStateChange', handleTrayStateChange as EventListener);
			// Unregister FAB from snap store if it was registered
			if (isRegistered) {
				fabSnapStore.unregisterFab(FAB_ID);
			}
		}
	});

	// Resize handler with viewport change detection
	$effect(() => {
		if (!browser || !ready) return;
		
		let lastWasMobile = window.matchMedia('(max-width: 767px)').matches;
		
		const handleResize = () => {
			const isMobile = window.matchMedia('(max-width: 767px)').matches;
			const viewportChanged = isMobile !== lastWasMobile;
			lastWasMobile = isMobile;
			
			// If viewport changed and we're snapped to a tray slot, handle re-positioning
			if (viewportChanged && isSnapped && snappedZoneId?.startsWith('fab-tray-slot-')) {
				// Viewport changed - need to wait for layout to stabilize
				setTimeout(() => {
					const slotIndex = parseInt(snappedZoneId?.replace('fab-tray-slot-', '') ?? '0', 10);
					const slot = document.querySelector(`.fab-tray__slot[data-slot="${slotIndex}"]`) as HTMLElement;
					if (slot) {
						const rect = slot.getBoundingClientRect();
						const snapX = rect.left + (rect.width - FAB_SIZE) / 2;
						const snapY = rect.top + (rect.height - FAB_SIZE) / 2;
						position = clampToViewport({ x: snapX, y: snapY });
						positionReady = true;
						
						// Re-register the zone with updated position
						fabSnapStore.registerZone({
							id: snappedZoneId!,
							x: rect.left,
							y: rect.top,
							width: rect.width,
							height: rect.height
						});
						fabSnapStore.occupyZone(snappedZoneId!, FAB_ID);
					}
				}, 300);
			} else {
				// Just clamp to viewport
				position = clampToViewport(position);
			}
		};
		
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	});
</script>

{#if isSuperAdmin}
	<div
		class="super-admin-fab-wrapper"
		class:super-admin-fab-wrapper--ready={ready}
		class:super-admin-fab-wrapper--snapped={isSnapped}
		class:super-admin-fab-wrapper--near-snap={nearSnapZone !== null}
		class:super-admin-fab-wrapper--hidden={hiddenInClosedTray}
		class:super-admin-fab-wrapper--admin-hidden={hideOnAdminPage}
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
			ontouchstart={stopTouchPropagation}
			ontouchmove={stopTouchPropagation}
			ontouchend={stopTouchPropagation}
			ontouchcancel={stopTouchPropagation}
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

	.super-admin-fab-wrapper--hidden {
		opacity: 0 !important;
		pointer-events: none !important;
		visibility: hidden;
	}

	/* Hide instantly on admin pages (no transition) */
	.super-admin-fab-wrapper--admin-hidden {
		opacity: 0 !important;
		pointer-events: none !important;
		visibility: hidden;
		transition: none !important;
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

	@media (max-width: 767px) {
		.super-admin-fab {
			width: 3rem;
			height: 3rem;
		}
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
