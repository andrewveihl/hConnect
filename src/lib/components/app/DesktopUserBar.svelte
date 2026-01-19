<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy, tick } from 'svelte';
	
	const PANEL_COLLAPSED_KEY = 'hconnect:desktop-user-panel-collapsed';
	import { get } from 'svelte/store';
	import { doc, onSnapshot, setDoc, deleteField, Timestamp } from 'firebase/firestore';
	
	import { db } from '$lib/firestore/client';
	import Avatar from '$lib/components/app/Avatar.svelte';
	import { user, userProfile } from '$lib/stores/user';
	import { openSettings, setSettingsSection, settingsUI } from '$lib/stores/settingsUI';
	import { defaultSettingsSection } from '$lib/settings/sections';
	import { fabSnapStore, isFabSnappingDisabled, type SnapZone } from '$lib/stores/fabSnap';
	import { voicePreferences } from '$lib/stores/voicePreferences';
	import {
		presenceFromSources,
		presenceLabels,
		resolveManualPresenceFromSources,
		type PresenceState
	} from '$lib/presence/state';
	import { voiceStore } from '$lib/stores/voiceStore';
	import { getMediaDevices, type MediaDeviceInfo } from '$lib/webrtc/rtcClient';

	type StatusSelection = 'auto' | PresenceState;

	let myPresenceState: PresenceState = $state('offline');
	let myOverrideActive = $state(false);
	let myOverrideState: PresenceState | null = $state(null);
	let myOverrideExpiresAt: number | null = $state(null);
	let statusMenuOpen = $state(false);
	let statusSaving = $state(false);
	let statusError: string | null = $state(null);
	let statusButtonEl: HTMLButtonElement | null = $state(null);
	let statusMenuEl: HTMLDivElement | null = $state(null);
	let presenceUnsub: (() => void) | null = null;

	// Voice state - access individual stores
	const voiceLocal = $derived.by(() => {
		const local = get(voiceStore.local);
		return local;
	});
	const isInVoice = $derived.by(() => {
		const conn = get(voiceStore.connection);
		return conn.status === 'connected' || conn.status === 'connecting';
	});
	const voicePrefs = $derived.by(() => get(voicePreferences));

	// Quick device picker state
	let deviceMenuOpen = $state(false);
	let deviceMenuMode: 'input' | 'output' | null = $state(null);
	let deviceMenuEl: HTMLDivElement | null = $state(null);
	let deviceMenuAnchor: HTMLButtonElement | null = $state(null);
	let audioInputs: MediaDeviceInfo[] = $state([]);
	let audioOutputs: MediaDeviceInfo[] = $state([]);
	let deviceMenuLoading = $state(false);
	let deviceMenuError: string | null = $state(null);
	let selectedInputId = $state('');
	let selectedOutputId = $state('');

	// Robust display name fallback: profile.displayName → auth.displayName → profile.email → auth.email → 'You'
	const displayNameText = $derived.by(() => {
		const profile = $userProfile;
		const authUser = $user;
		const candidates: (string | null | undefined)[] = [
			profile?.displayName,
			authUser?.displayName,
			profile?.email,
			authUser?.email
		];
		const picked = candidates.find((v) => typeof v === 'string' && v.trim().length > 0);
		return picked ?? 'You';
	});

	// Panel collapsed state
	let panelCollapsed = $state(false);
	let panelDragging = $state(false);
	let panelDragStartX = $state(0);
	let panelDragCurrentX = $state(0);
	const DRAG_THRESHOLD = 60; // pixels to drag before snapping
	const CLICK_THRESHOLD = 5; // pixels - if moved less than this, treat as click
	
	function setPanelCollapsed(collapsed: boolean) {
		panelCollapsed = collapsed;
		if (browser) {
			localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? '1' : '0');
		}
	}
	
	function handlePanelDragStart(event: MouseEvent | TouchEvent) {
		// Only allow drag from avatar area
		panelDragging = true;
		const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
		panelDragStartX = clientX;
		panelDragCurrentX = clientX;
		
		if (browser) {
			document.addEventListener('mousemove', handlePanelDragMove);
			document.addEventListener('mouseup', handlePanelDragEnd);
			document.addEventListener('touchmove', handlePanelDragMove);
			document.addEventListener('touchend', handlePanelDragEnd);
		}
	}
	
	function handlePanelDragMove(event: MouseEvent | TouchEvent) {
		if (!panelDragging) return;
		const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
		panelDragCurrentX = clientX;
	}
	
	function handlePanelDragEnd(event: MouseEvent | TouchEvent) {
		if (!panelDragging) return;
		
		const deltaX = panelDragCurrentX - panelDragStartX;
		const absDeltaX = Math.abs(deltaX);
		
		// If barely moved, treat as a click - open settings
		if (absDeltaX < CLICK_THRESHOLD) {
			openUserSettings(event as MouseEvent);
		}
		// If expanded and dragged left enough, collapse
		else if (!panelCollapsed && deltaX < -DRAG_THRESHOLD) {
			setPanelCollapsed(true);
		}
		// If collapsed and dragged right enough, expand
		else if (panelCollapsed && deltaX > DRAG_THRESHOLD) {
			setPanelCollapsed(false);
		}
		
		panelDragging = false;
		panelDragStartX = 0;
		panelDragCurrentX = 0;
		
		if (browser) {
			document.removeEventListener('mousemove', handlePanelDragMove);
			document.removeEventListener('mouseup', handlePanelDragEnd);
			document.removeEventListener('touchmove', handlePanelDragMove);
			document.removeEventListener('touchend', handlePanelDragEnd);
		}
	}

	// FAB tray state - dynamic based on registered FABs
	let fabTrayOpen = $state(false);
	let fabTrayEl: HTMLDivElement | null = $state(null);
	let registeredFabCount = $state(0); // Number of FABs currently registered
	
	// Dynamic slot refs array - grows/shrinks based on FAB count
	let slotRefs = $state<(HTMLDivElement | null)[]>([]);
	
	// Track drag-over state for visual feedback
	let dragOverSlot = $state<number | null>(null);
	
	// Track if user manually opened/closed tray (vs auto-opened for drag)
	let trayAutoOpenedForDrag = $state(false);
	
	// Zone IDs for the tray slots
	const TRAY_ZONE_PREFIX = 'fab-tray-slot-';
	
	// Generate slot indices array based on registered FAB count
	const slotIndices = $derived(Array.from({ length: registeredFabCount }, (_, i) => i));

	const currentPath = $derived($page?.url?.pathname ?? '');
	const isSettingsOpen = $derived($settingsUI.open);

	const currentStatusSelection = $derived<StatusSelection>(
		myOverrideActive && myOverrideState ? myOverrideState : 'auto'
	);

	const statusOptions: { id: StatusSelection; state: PresenceState | null; label: string; description: string }[] = [
		{ id: 'auto', state: null, label: 'Automatic', description: 'Sync with device activity' },
		{ id: 'online', state: 'online', label: 'Online', description: 'Appear online' },
		{ id: 'idle', state: 'idle', label: 'Away', description: 'Appear away' },
		{ id: 'busy', state: 'busy', label: 'Do Not Disturb', description: 'Mute notifications' },
		{ id: 'offline', state: 'offline', label: 'Invisible', description: 'Appear offline' }
	];

	function openUserSettings(event: MouseEvent) {
		event.preventDefault();
		setSettingsSection(defaultSettingsSection);
		openSettings();
	}

	function toggleStatusMenu() {
		statusMenuOpen = !statusMenuOpen;
	}

	function statusDotClass(state: PresenceState): string {
		switch (state) {
			case 'online': return 'status-dot--online';
			case 'idle': return 'status-dot--idle';
			case 'busy': return 'status-dot--busy';
			case 'offline': return 'status-dot--offline';
			default: return 'status-dot--offline';
		}
	}

	function statusDotLabel(): string {
		return presenceLabels[myPresenceState] ?? 'Offline';
	}

	async function applyStatusOverride(selection: StatusSelection) {
		const uid = get(user)?.uid;
		if (!uid) return;
		statusSaving = true;
		statusError = null;
		try {
			const firestore = db();
			const overrideRef = doc(firestore, 'profiles', uid, 'presence', 'override');
			const statusRef = doc(firestore, 'profiles', uid, 'presence', 'status');
			
			if (selection === 'auto') {
				// Clear the override - remove manualState from both documents
				await setDoc(overrideRef, { manualState: deleteField(), expiresAt: deleteField() }, { merge: true });
				await setDoc(statusRef, { manualState: deleteField(), manualExpiresAt: deleteField() }, { merge: true });
			} else {
				const expiresAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);
				// Set the override in both documents so all components see it
				await setDoc(overrideRef, { manualState: selection, expiresAt }, { merge: true });
				await setDoc(statusRef, { manualState: selection, manualExpiresAt: expiresAt }, { merge: true });
			}
			statusMenuOpen = false;
		} catch (err: any) {
			statusError = err?.message ?? 'Failed to update status';
		} finally {
			statusSaving = false;
		}
	}

	function toggleMute() {
		voiceStore.toggleMute();
	}

	function toggleDeafen() {
		voiceStore.toggleDeafen();
	}

	async function loadDeviceMenu() {
		if (!browser) return;
		deviceMenuLoading = true;
		deviceMenuError = null;
		try {
			const devices = await getMediaDevices();
			audioInputs = devices.audioInputs;
			audioOutputs = devices.audioOutputs;

			const inputPref = voicePrefs?.inputDeviceId ?? '';
			const outputPref = voicePrefs?.outputDeviceId ?? '';

			selectedInputId = inputPref && audioInputs.some((d) => d.deviceId === inputPref)
				? inputPref
				: audioInputs[0]?.deviceId ?? '';
			selectedOutputId = outputPref && audioOutputs.some((d) => d.deviceId === outputPref)
				? outputPref
				: audioOutputs[0]?.deviceId ?? '';
		} catch (err: any) {
			deviceMenuError = err?.message ?? 'Unable to load devices';
		} finally {
			deviceMenuLoading = false;
		}
	}

	function closeDeviceMenu() {
		deviceMenuOpen = false;
		deviceMenuMode = null;
	}

	async function openDeviceMenu(anchorEl: HTMLButtonElement | null, mode: 'input' | 'output') {
		deviceMenuAnchor = anchorEl;
		deviceMenuMode = mode;
		deviceMenuOpen = true;
		await loadDeviceMenu();
	}

	function toggleDeviceMenu(anchorEl: HTMLButtonElement | null, mode: 'input' | 'output') {
		if (deviceMenuOpen && anchorEl === deviceMenuAnchor && deviceMenuMode === mode) {
			closeDeviceMenu();
			return;
		}
		void openDeviceMenu(anchorEl, mode);
	}

	function selectInputDevice(deviceId: string) {
		selectedInputId = deviceId;
		voicePreferences.update((prefs) => ({ ...prefs, inputDeviceId: deviceId || null }));
	}

	function selectOutputDevice(deviceId: string) {
		selectedOutputId = deviceId;
		voicePreferences.update((prefs) => ({ ...prefs, outputDeviceId: deviceId || null }));
	}

	async function clearStatusOverride() {
		await applyStatusOverride('auto');
	}

	function formatOverrideExpiry(ms: number | null): string {
		if (!ms) return '';
		const diff = ms - Date.now();
		if (diff <= 0) return 'soon';
		const hours = Math.floor(diff / (1000 * 60 * 60));
		const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
		if (hours > 0) return `in ${hours}h ${minutes}m`;
		return `in ${minutes}m`;
	}

	function handleStatusOutside(event: PointerEvent) {
		const target = event.target as Node | null;
		const clickedElement = target as HTMLElement | null;
		
		// Close status menu if clicking outside
		if (statusMenuOpen) {
			if (!statusButtonEl?.contains(target) && !statusMenuEl?.contains(target)) {
				statusMenuOpen = false;
			}
		}

		// Close quick device picker if clicking outside
		if (deviceMenuOpen) {
			if (!deviceMenuAnchor?.contains(target) && !deviceMenuEl?.contains(target)) {
				closeDeviceMenu();
			}
		}
		
		// Close FAB tray if clicking outside (but not if it was auto-opened for drag)
		if (fabTrayOpen && !trayAutoOpenedForDrag) {
			// Check if click is on a snapped FAB (which is visually in the tray but not a DOM child)
			const isSnappedFab = clickedElement?.closest('.threads-fab-wrapper--snapped') !== null;
			
			// Check if click is on the toggle button - let toggle button handle its own click
			const isToggleButton = clickedElement?.closest('.fab-tray__toggle') !== null;
			
			// Check if click is on the popover from a snapped FAB
			const isPopover = clickedElement?.closest('.threads-popover') !== null;
			
			// Check if click is on the ticket panel from a snapped TicketFab
			const isTicketPanel = clickedElement?.closest('.ticket-panel') !== null;
			const isSnappedTicketFab = clickedElement?.closest('.ticket-container--snapped') !== null;
			
			// Close if clicking outside tray, FAB, toggle button, popover, and ticket panel
			// Let toggle button handle its own click for toggling
			if (!fabTrayEl?.contains(target) && !isSnappedFab && !isToggleButton && !isPopover && !isTicketPanel && !isSnappedTicketFab) {
				fabTrayOpen = false;
				unregisterTraySnapZones();
				clearTrayInlineStyles();
				// Dispatch tray closed event
				if (browser) {
					window.dispatchEvent(new CustomEvent('fabTrayStateChange', { detail: { open: false } }));
				}
			}
		}
	}

	function handleStatusKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (statusMenuOpen) statusMenuOpen = false;
			if (deviceMenuOpen) closeDeviceMenu();
			if (fabTrayOpen) {
				fabTrayOpen = false;
				unregisterTraySnapZones();
				clearTrayInlineStyles();
				if (browser) {
					window.dispatchEvent(new CustomEvent('fabTrayStateChange', { detail: { open: false } }));
				}
			}
		}
	}

	async function setFabTrayOpen(next: boolean) {
		if (fabTrayOpen === next) {
			if (!next) {
				unregisterTraySnapZones();
				clearTrayInlineStyles();
				if (browser) {
					window.dispatchEvent(new CustomEvent('fabTrayStateChange', { detail: { open: false } }));
				}
			}
			return;
		}
		fabTrayOpen = next;
		trayAutoOpenedForDrag = false; // User manually toggled

		// Force a tick to ensure the DOM updates
		await tick();

		// Dispatch event for snapped FABs to know tray state
		if (browser) {
			window.dispatchEvent(new CustomEvent('fabTrayStateChange', { detail: { open: fabTrayOpen } }));
		}

		if (fabTrayOpen) {
			// Refresh zone coordinates when opening
			await tick();
			await registerTraySnapZones();
		} else {
			// When closing, unregister zones AND clear inline styles so CSS can hide it
			unregisterTraySnapZones();
			clearTrayInlineStyles();
		}
	}

	async function toggleFabTray(event?: MouseEvent) {
		// Prevent any propagation issues
		event?.stopPropagation();
		await setFabTrayOpen(!fabTrayOpen);
	}

	function handleFabTrayToggleRequest(event: CustomEvent<{ open?: boolean }>) {
		const requested = event.detail?.open;
		if (typeof requested === 'boolean') {
			void setFabTrayOpen(requested);
			return;
		}
		void setFabTrayOpen(!fabTrayOpen);
	}
	
	// Register tray slots as snap zones
	async function registerTraySnapZones() {
		if (!browser) return;
		
		const tray = fabTrayEl;
		if (!tray) return;
		
		// ALWAYS force final position styles to ensure accurate bounding rects
		// This bypasses CSS transition animation states
		const originalVisibility = tray.style.visibility;
		const originalOpacity = tray.style.opacity;
		const originalTransform = tray.style.transform;
		const originalPointerEvents = tray.style.pointerEvents;
		
		tray.style.visibility = 'visible';
		tray.style.opacity = '1';
		tray.style.transform = 'translateY(0)';
		tray.style.pointerEvents = 'auto';
		
		// Wait for browser to apply styles and layout
		await tick();
		await new Promise(r => setTimeout(r, 100));
		
		slotRefs.forEach((slot, index) => {
			if (!slot) return;
			const rect = slot.getBoundingClientRect();
			const zoneId = `${TRAY_ZONE_PREFIX}${index}`;
			
			// Only register if we have valid coordinates
			if (rect.width > 0 && rect.height > 0) {
				fabSnapStore.registerZone({
					id: zoneId,
					x: rect.left,
					y: rect.top,
					width: rect.width,
					height: rect.height
				});
			}
		});
	}
	
	// Unregister tray snap zones
	function unregisterTraySnapZones() {
		if (!browser) return;
		// Unregister all potential slots (use a high max in case count changed)
		for (let i = 0; i < Math.max(registeredFabCount, 10); i++) {
			fabSnapStore.unregisterZone(`${TRAY_ZONE_PREFIX}${i}`);
		}
	}
	
	// Clear inline styles from tray so CSS classes take effect
	function clearTrayInlineStyles() {
		if (!fabTrayEl) return;
		fabTrayEl.style.visibility = '';
		fabTrayEl.style.opacity = '';
		fabTrayEl.style.transform = '';
		fabTrayEl.style.pointerEvents = '';
	}
	
	// Handle FAB drag start - auto-open tray and refresh zone coordinates
	async function handleFabDragStart() {
		// Always open tray when dragging starts (don't check feature flag - let it work)
		if (!fabTrayOpen) {
			fabTrayOpen = true;
			trayAutoOpenedForDrag = true;
			// Dispatch tray opened event
			if (browser) {
				window.dispatchEvent(new CustomEvent('fabTrayStateChange', { detail: { open: true } }));
			}
		}
		// Wait for tray to fully open with transitions
		await tick();
		await new Promise(r => setTimeout(r, 250)); // Longer delay to ensure CSS transition completes
		
		// Now register zones with tray fully visible
		await registerTraySnapZones();
	}
	
	// Handle FAB near snap zone event (visual feedback)
	function handleFabNearSnapZone(event: CustomEvent<{ zoneId: string | null }>) {
		// Disable visual feedback for snap zones - user doesn't want to see highlighting
		// const { zoneId } = event.detail;
		// 
		// if (zoneId?.startsWith(TRAY_ZONE_PREFIX)) {
		// 	const slotIndex = parseInt(zoneId.replace(TRAY_ZONE_PREFIX, ''), 10);
		// 	dragOverSlot = slotIndex;
		// } else {
		// 	dragOverSlot = null;
		// }
	}
	
	// Handle FAB drag end - close tray if it was auto-opened AND no FAB was snapped
	function handleFabDragEnd(event?: CustomEvent<{ fabId: string; snapped?: boolean }>) {
		dragOverSlot = null;
		
		// Check if any slot is now occupied (FAB was snapped) - use dynamic count
		const hasSnappedFab = slotIndices.some(i => isSlotOccupied(i));
		
		// If tray was auto-opened for drag and a FAB is now snapped, keep tray open
		// Otherwise close it after a delay
		if (trayAutoOpenedForDrag) {
			if (hasSnappedFab) {
				// FAB was snapped - keep tray open so user sees it, but reset auto-open flag
				trayAutoOpenedForDrag = false;
			} else {
				// No FAB snapped - close tray after delay
				setTimeout(() => {
					if (trayAutoOpenedForDrag) {
						fabTrayOpen = false;
						trayAutoOpenedForDrag = false;
						unregisterTraySnapZones();
						clearTrayInlineStyles();
						// Dispatch tray closed event
						if (browser) {
							window.dispatchEvent(new CustomEvent('fabTrayStateChange', { detail: { open: false } }));
						}
					}
				}, 1500);
			}
		}
	}
	
	// Check if a slot is occupied
	function isSlotOccupied(index: number): boolean {
		const zoneId = `${TRAY_ZONE_PREFIX}${index}`;
		const state = get(fabSnapStore);
		const zone = state.zones.find(z => z.id === zoneId);
		return !!zone?.occupiedBy;
	}
	
	// Get occupied FAB icon for a slot
	function getSlotFabId(index: number): string | null {
		const zoneId = `${TRAY_ZONE_PREFIX}${index}`;
		const state = get(fabSnapStore);
		const zone = state.zones.find(z => z.id === zoneId);
		return zone?.occupiedBy ?? null;
	}
	
	// Handle FAB registry changes - update slot count
	function handleFabRegistryChanged(event: CustomEvent<{ count: number }>) {
		const newCount = event.detail.count;
		registeredFabCount = newCount;
		
		// Update slotRefs array size
		while (slotRefs.length < newCount) {
			slotRefs.push(null);
		}
		while (slotRefs.length > newCount) {
			slotRefs.pop();
		}
		
		// Re-register zones if tray is open
		if (fabTrayOpen) {
			tick().then(() => registerTraySnapZones());
		}
	}

	onMount(() => {
		// Load panel collapsed state from localStorage
		if (browser) {
			const stored = localStorage.getItem(PANEL_COLLAPSED_KEY);
			panelCollapsed = stored === '1';
		}
		
		const uid = get(user)?.uid;
		if (uid && browser) {
			const firestore = db();
			const overrideRef = doc(firestore, 'profiles', uid, 'presence', 'override');
			const statusRef = doc(firestore, 'profiles', uid, 'presence', 'status');
			
			let overrideData: any = null;
			let statusData: any = null;
			
			const updatePresence = () => {
				const resolved = resolveManualPresenceFromSources(overrideData);
				if (resolved) {
					myOverrideActive = true;
					myOverrideState = resolved.state;
					myOverrideExpiresAt = resolved.expiresAt;
					myPresenceState = resolved.state;
				} else {
					myOverrideActive = false;
					myOverrideState = null;
					myOverrideExpiresAt = null;
					myPresenceState = statusData ? presenceFromSources([statusData]) : 'offline';
				}
			};
			
			const overrideUnsub = onSnapshot(overrideRef, (snap) => {
				overrideData = snap.data() || null;
				updatePresence();
			});
			
			const statusUnsub = onSnapshot(statusRef, (snap) => {
				statusData = snap.data() || null;
				updatePresence();
			});
			
			presenceUnsub = () => {
				overrideUnsub();
				statusUnsub();
			};
		}
		
		// Listen for FAB events for auto-opening tray and visual feedback
		if (browser) {
			window.addEventListener('fabDragStart', handleFabDragStart as EventListener);
			window.addEventListener('fabNearSnapZone', handleFabNearSnapZone as EventListener);
			window.addEventListener('fabDragEnd', handleFabDragEnd as EventListener);
			window.addEventListener('fabRegistryChanged', handleFabRegistryChanged as EventListener);
			window.addEventListener('fabTrayToggleRequest', handleFabTrayToggleRequest as EventListener);
			
			// Get initial FAB count from store
			registeredFabCount = fabSnapStore.getRegisteredFabs().length;
			slotRefs = Array.from({ length: registeredFabCount }, () => null);
			
			// Register tray zones after DOM is ready (tray is always in DOM now)
			setTimeout(async () => {
				await registerTraySnapZones();
				// Clear inline styles so tray returns to CSS-controlled hidden state
				clearTrayInlineStyles();
				// Dispatch tray mounting event so FABs know tray is available again
				// This tells FABs to reset trayUnmounted flag even though tray is closed
				window.dispatchEvent(new CustomEvent('fabTrayStateChange', { detail: { open: fabTrayOpen, mounting: true } }));
			}, 200);
		}
	});

	onDestroy(() => {
		presenceUnsub?.();
		unregisterTraySnapZones();
		if (browser) {
			// Dispatch tray unmounting event - FABs should NOT hide, just know tray is gone temporarily
			// This distinguishes unmount from user closing the tray
			window.dispatchEvent(new CustomEvent('fabTrayStateChange', { detail: { open: false, unmounting: true } }));
			window.removeEventListener('fabDragStart', handleFabDragStart as EventListener);
			window.removeEventListener('fabNearSnapZone', handleFabNearSnapZone as EventListener);
			window.removeEventListener('fabDragEnd', handleFabDragEnd as EventListener);
			window.removeEventListener('fabRegistryChanged', handleFabRegistryChanged as EventListener);
			window.removeEventListener('fabTrayToggleRequest', handleFabTrayToggleRequest as EventListener);
		}
	});
</script>

<svelte:window
	onpointerdown={handleStatusOutside}
	on:keydown={handleStatusKeydown}
/>

<!-- FAB Tray content - always in DOM, visibility controlled by CSS -->
<!-- Only show tray if there are FABs available -->
{#if registeredFabCount > 0}
<div 
	class="fab-tray" 
	class:fab-tray--open={fabTrayOpen}
	bind:this={fabTrayEl}
	data-open={fabTrayOpen}
	data-fab-count={registeredFabCount}
>
	<div class="fab-tray__content">
		<div class="fab-tray__slots">
			{#each slotIndices as index (index)}
				<div 
					class="fab-tray__slot"
					class:is-drag-over={dragOverSlot === index}
					class:is-occupied={isSlotOccupied(index)}
					data-slot={index}
					bind:this={slotRefs[index]}
					title={isSlotOccupied(index) ? 'Hold to drag widget out' : 'Drop a widget here'}
				>
					{#if !isSlotOccupied(index)}
						<i class="bx bx-plus"></i>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>
{/if}

<!-- Modern user panel at the bottom of the sidebar -->
<div class="desktop-user-panel" class:desktop-user-panel--collapsed={panelCollapsed} class:desktop-user-panel--dragging={panelDragging}>
	<!-- Avatar section - always visible, changes behavior based on collapsed state -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="desktop-user-panel__avatar-section"
		class:desktop-user-panel__avatar-section--collapsed={panelCollapsed}
		role={panelCollapsed ? 'button' : undefined}
		tabindex={panelCollapsed ? 0 : undefined}
		onmousedown={panelCollapsed ? handlePanelDragStart : undefined}
		ontouchstart={panelCollapsed ? handlePanelDragStart : undefined}
		aria-label={panelCollapsed ? 'Drag right to expand, or click to open settings' : undefined}
		title={panelCollapsed ? 'Drag right to expand' : undefined}
	>
		<div class="desktop-user-panel__avatar-wrapper">
			<button
				type="button"
				class="desktop-user-panel__avatar-btn-wrapper"
				onclick={openUserSettings}
				aria-label="Open user settings"
				title="Open settings"
			>
				<div class="desktop-user-panel__avatar-ring" class:desktop-user-panel__avatar-ring--active={isSettingsOpen || currentPath.startsWith('/settings')}>
					<Avatar
						user={$userProfile ?? $user}
						size="sm"
						isSelf={true}
						class="desktop-user-panel__avatar"
					/>
				</div>
			</button>
			<button
				type="button"
				class="status-indicator"
				bind:this={statusButtonEl}
				onmousedown={panelCollapsed ? (e) => e.stopPropagation() : undefined}
				ontouchstart={panelCollapsed ? (e) => e.stopPropagation() : undefined}
				onclick={panelCollapsed ? (e) => { e.stopPropagation(); toggleStatusMenu(); } : toggleStatusMenu}
				aria-label={`Set status (currently ${statusDotLabel()})`}
				title="Set status"
			>
				<span class={`status-dot ${statusDotClass(myPresenceState)}`} aria-hidden="true"></span>
			</button>
		</div>
	</div>
	
	<!-- Expanded content - user info and controls -->
	<div class="desktop-user-panel__expanded-content" class:desktop-user-panel__expanded-content--hidden={panelCollapsed}>
		<button 
			type="button"
			class="desktop-user-panel__user" 
			onclick={openUserSettings}
		>
			<div class="desktop-user-panel__name">{displayNameText}</div>
			<div class="desktop-user-panel__status">{statusDotLabel()}</div>
		</button>
	</div>
	<!-- Controls section - hidden when collapsed -->
	<div class="desktop-user-panel__controls" class:desktop-user-panel__controls--hidden={panelCollapsed}>
		<div class="desktop-user-panel__control">
			<button
				type="button"
				class="desktop-user-panel__btn-arrow"
				onclick={(event) => toggleDeviceMenu(event.currentTarget as HTMLButtonElement, 'input')}
				title="Select input device (microphone)"
				aria-label="Select input device"
				aria-expanded={deviceMenuOpen && deviceMenuMode === 'input'}
			>
				<i class="bx bx-chevron-up"></i>
			</button>
			<button 
				type="button" 
				class="desktop-user-panel__btn" 
				class:is-active={voiceLocal.isMuted}
				class:is-disabled={!isInVoice}
				onclick={toggleMute}
				disabled={!isInVoice}
				aria-label={voiceLocal.isMuted ? 'Unmute' : 'Mute'} 
				title={voiceLocal.isMuted ? 'Unmute' : 'Mute'}
			>
				<i class={voiceLocal.isMuted ? 'bx bx-microphone-off' : 'bx bx-microphone'}></i>
			</button>
		</div>
		<div class="desktop-user-panel__control">
			<button
				type="button"
				class="desktop-user-panel__btn-arrow"
				onclick={(event) => toggleDeviceMenu(event.currentTarget as HTMLButtonElement, 'output')}
				title="Select output device (speakers)"
				aria-label="Select output device"
				aria-expanded={deviceMenuOpen && deviceMenuMode === 'output'}
			>
				<i class="bx bx-chevron-up"></i>
			</button>
			<button 
				type="button" 
				class="desktop-user-panel__btn" 
				class:is-active={voiceLocal.isDeafened}
				class:is-disabled={!isInVoice}
				onclick={toggleDeafen}
				disabled={!isInVoice}
				aria-label={voiceLocal.isDeafened ? 'Undeafen' : 'Deafen'} 
				title={voiceLocal.isDeafened ? 'Undeafen' : 'Deafen'}
			>
				<i class={voiceLocal.isDeafened ? 'bx bx-volume-mute' : 'bx bx-headphone'}></i>
			</button>
		</div>
		<!-- FAB Tray toggle - only show if there are FABs available -->
		{#if registeredFabCount > 0}
		<button 
			type="button" 
			class="desktop-user-panel__btn fab-tray__toggle"
			class:fab-tray__toggle--open={fabTrayOpen}
			onclick={(e) => { e.stopPropagation(); e.preventDefault(); toggleFabTray(e); }}
			aria-label={fabTrayOpen ? 'Hide widget dock' : 'Show widget dock'}
			title={fabTrayOpen ? 'Hide widget dock' : 'Show widget dock'}
		>
			<i class={fabTrayOpen ? 'bx bx-chevron-down' : 'bx bx-chevron-up'}></i>
		</button>
		{/if}
		{#if deviceMenuOpen}
			<div class="device-quick-picker" bind:this={deviceMenuEl} role="dialog" aria-label="Quick audio device selection">
				<div class="device-quick-picker__header">
					<span>{deviceMenuMode === 'input' ? 'Input Device' : 'Output Device'}</span>
					<button type="button" class="device-quick-picker__close" onclick={closeDeviceMenu} aria-label="Close device picker">
						<i class="bx bx-x"></i>
					</button>
				</div>
				{#if deviceMenuLoading}
					<div class="device-quick-picker__loading">Loading devices…</div>
				{:else if deviceMenuError}
					<div class="device-quick-picker__error">{deviceMenuError}</div>
				{:else if deviceMenuMode === 'input'}
					<div class="device-quick-picker__row device-quick-picker__row--single">
						<select
							id="quick-input-select"
							bind:value={selectedInputId}
							onchange={(event) => selectInputDevice((event.target as HTMLSelectElement).value)}
						>
							{#if audioInputs.length === 0}
								<option value="" disabled>No inputs found</option>
							{:else}
								{#each audioInputs as device}
									<option value={device.deviceId}>{device.label || 'Microphone'}</option>
								{/each}
							{/if}
						</select>
					</div>
				{:else if deviceMenuMode === 'output'}
					<div class="device-quick-picker__row device-quick-picker__row--single">
						<select
							id="quick-output-select"
							bind:value={selectedOutputId}
							onchange={(event) => selectOutputDevice((event.target as HTMLSelectElement).value)}
						>
							{#if audioOutputs.length === 0}
								<option value="" disabled>No outputs found</option>
							{:else}
								{#each audioOutputs as device}
									<option value={device.deviceId}>{device.label || 'Speaker'}</option>
								{/each}
							{/if}
						</select>
					</div>
				{/if}
			</div>
		{/if}
	</div>
	<!-- Drag handle on the right edge - only when expanded -->
	{#if !panelCollapsed}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="desktop-user-panel__drag-handle"
		role="separator"
		aria-orientation="vertical"
		aria-label="Drag left to collapse panel"
		onmousedown={handlePanelDragStart}
		ontouchstart={handlePanelDragStart}
	>
		<div class="desktop-user-panel__drag-handle-bar"></div>
	</div>
	{/if}
	
	<!-- Status menu popup -->
	{#if statusMenuOpen}
		<div
			class="status-menu"
			bind:this={statusMenuEl}
			role="dialog"
			aria-label="Set custom status"
		>
			<div class="status-menu__section">
				<div class="status-menu__title">Status</div>
				<div class="status-menu__list">
					{#each statusOptions as option (option.id)}
						<button
							type="button"
							class={`status-option ${option.id === currentStatusSelection ? 'is-active' : ''}`}
							onclick={() => applyStatusOverride(option.id)}
							disabled={statusSaving}
						>
							{#if option.state}
								<span
									class={`status-option__dot ${statusDotClass(option.state)}`}
									aria-hidden="true"
								></span>
							{:else}
								<span
									class="status-option__dot status-option__dot--auto"
									aria-hidden="true"
								>
									<i class="bx bx-refresh"></i>
								</span>
							{/if}
							<div class="status-option__meta">
								<span class="status-option__label">{option.label}</span>
								<span class="status-option__description">{option.description}</span>
							</div>
							{#if option.id === currentStatusSelection}
								<i class="bx bx-check status-option__check" aria-hidden="true"></i>
							{/if}
						</button>
					{/each}
				</div>
			</div>
			{#if statusError}
				<div class="status-menu__error">{statusError}</div>
			{/if}
			{#if myOverrideActive && myOverrideState}
				<div class="status-menu__override">
					<div class="status-menu__override-label">
						Override set to <strong>{presenceLabels[myOverrideState]}</strong>
					</div>
					<div class="status-menu__override-expiry">
						Expires {formatOverrideExpiry(myOverrideExpiresAt)}
					</div>
					<button
						type="button"
						class="status-menu__clear"
						onclick={clearStatusOverride}
						disabled={statusSaving}
					>
						Clear override
					</button>
				</div>
			{:else}
				<div class="status-menu__hint">Manual statuses expire after 24 hours.</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* ===== FAB TRAY TOGGLE - In controls section ===== */
	.fab-tray__toggle {
		/* Inherits from desktop-user-panel__btn */
		transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.fab-tray__toggle--open {
		color: var(--color-accent) !important;
		background: color-mix(in srgb, var(--color-accent) 15%, transparent) !important;
	}

	.fab-tray__toggle--open:hover {
		color: var(--color-accent) !important;
		background: color-mix(in srgb, var(--color-accent) 25%, transparent) !important;
	}

	/* ===== FAB TRAY CONTENT ===== */
	.fab-tray {
		display: none;
		position: fixed;
		bottom: calc(72px + 20px + 8px);
		left: 100px;
		width: 240px;
		z-index: 46;
		justify-content: center;
		opacity: 0;
		visibility: hidden;
		transform: translateY(10px);
		transition: opacity 200ms ease, transform 200ms ease, visibility 0ms 200ms;
		pointer-events: none;
	}

	@media (min-width: 768px) {
		.fab-tray {
			display: flex;
		}
	}

	@media (max-width: 767px) {
		.fab-tray {
			display: flex;
			left: env(safe-area-inset-left, 0px);
			bottom: calc(var(--mobile-dock-height, 0px) + env(safe-area-inset-bottom, 0px) + 64px);
			width: 72px;
		}

		.fab-tray__content {
			flex-direction: column;
			padding: 10px 8px;
			border-radius: 20px;
		}

		.fab-tray__slots {
			flex-direction: column;
			gap: 8px;
		}

		.fab-tray__slot {
			width: 48px;
			height: 48px;
			border-width: 2px;
			opacity: 0.75;
		}

		.fab-tray__slot i {
			font-size: 1.1rem;
		}

		.fab-tray__slot.is-drag-over {
			transform: scale(1.12);
		}
	}

	.fab-tray--open {
		opacity: 1;
		visibility: visible;
		transform: translateY(0);
		transition: opacity 200ms ease, transform 200ms ease, visibility 0ms 0ms;
		pointer-events: auto;
	}

	.fab-tray__content {
		display: flex;
		align-items: center;
		background: var(--color-panel);
		border: 1px solid var(--color-border-subtle);
		border-radius: 28px;
		padding: 8px 12px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.03) inset;
		animation: fabTraySlideIn 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	@keyframes fabTraySlideIn {
		from {
			opacity: 0;
			transform: translateY(12px) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.fab-tray__slots {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.fab-tray__slot {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--color-panel-muted) 40%, transparent);
		border: 2px dashed color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-tertiary);
		font-size: 1rem;
		transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
		cursor: pointer;
		opacity: 0.6;
	}

	.fab-tray__slot:hover {
		border-color: var(--color-accent);
		border-style: solid;
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		opacity: 1;
		transform: scale(1.08);
	}
	
	/* Slot is occupied by a snapped FAB - make it invisible so FAB shows */
	.fab-tray__slot.is-occupied {
		border-color: transparent;
		background: transparent;
		opacity: 0;
		pointer-events: none; /* Let clicks through to the FAB */
	}

	.fab-tray__slot.is-filled {
		border-style: solid;
		border-color: transparent;
		background: var(--color-panel-muted);
		opacity: 1;
	}

	.fab-tray__slot.is-drag-over {
		border-color: var(--color-accent);
		border-style: solid;
		background: color-mix(in srgb, var(--color-accent) 25%, transparent);
		opacity: 1;
		transform: scale(1.15);
		box-shadow: 0 0 20px color-mix(in srgb, var(--color-accent) 50%, transparent);
		animation: fabSlotPulse 600ms ease-in-out infinite;
	}

	@keyframes fabSlotPulse {
		0%, 100% {
			box-shadow: 0 0 20px color-mix(in srgb, var(--color-accent) 50%, transparent);
		}
		50% {
			box-shadow: 0 0 30px color-mix(in srgb, var(--color-accent) 70%, transparent);
		}
	}

	/* ===== MODERN USER PANEL ===== */
	.desktop-user-panel {
		display: none;
		position: fixed;
		bottom: 20px;
		left: 20px;
		width: 320px;
		height: 72px;
		background: linear-gradient(135deg,
			var(--color-panel) 0%,
			color-mix(in srgb, var(--color-panel) 95%, var(--color-panel-muted) 5%) 100%
		);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
		border-radius: 16px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2),
			0 2px 8px rgba(0, 0, 0, 0.1);
		z-index: 45;
		padding: 10px 16px;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	/* Collapsed state - compact pill with just avatar */
	.desktop-user-panel--collapsed {
		width: 72px;
		min-width: 72px;
		padding: 10px 14px;
		gap: 8px;
		height: 72px;
	}

	/* Dragging state - disable transition for immediate feedback */
	.desktop-user-panel--dragging {
		user-select: none;
		transition: none;
	}

	/* Avatar section - always visible */
	.desktop-user-panel__avatar-section {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.desktop-user-panel__avatar-section--collapsed {
		cursor: grab;
	}

	.desktop-user-panel__avatar-section--collapsed:active {
		cursor: grabbing;
	}

	/* Expanded content - user info that fades/slides */
	.desktop-user-panel__expanded-content {
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
		opacity: 1;
		transform: translateX(0);
		transition: opacity 200ms ease-out, transform 200ms ease-out;
	}

	.desktop-user-panel__expanded-content--hidden {
		opacity: 0;
		transform: translateX(-10px);
		width: 0;
		overflow: hidden;
		pointer-events: none;
	}

	/* Controls - also fade/slide */
	.desktop-user-panel__controls--hidden {
		opacity: 0;
		transform: translateX(-10px);
		width: 0;
		overflow: hidden;
		pointer-events: none;
	}

	/* Collapsed wrapper - holds the avatar for drag-to-expand */
	.desktop-user-panel__collapsed-wrapper {
		display: flex;
		align-items: center;
		cursor: grab;
	}

	.desktop-user-panel__collapsed-wrapper:active {
		cursor: grabbing;
	}

	/* Right-side drag handle for collapsing - invisible overlay */
	.desktop-user-panel__drag-handle {
		position: absolute;
		right: 0;
		top: 0;
		bottom: 0;
		width: 20px;
		cursor: grab;
		z-index: 10;
		border-radius: 0 16px 16px 0;
	}

	.desktop-user-panel__drag-handle:active {
		cursor: grabbing;
	}

	.desktop-user-panel__drag-handle-bar {
		display: none;
	}

	@media (min-width: 768px) {
		.desktop-user-panel {
			display: flex;
		}
	}

	.desktop-user-panel__user-wrapper {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: 1;
		min-width: 0;
	}

	.desktop-user-panel__user {
		display: flex;
		flex-direction: column;
		padding: 4px 2px;
		border-radius: 10px;
		cursor: pointer;
		transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
		background: transparent;
		border: none;
		text-align: left;
		font-family: inherit;
		gap: 2px;
	}

	.desktop-user-panel__user:hover {
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		transform: translateY(-1px);
	}

	.desktop-user-panel__avatar-wrapper {
		position: relative;
		flex-shrink: 0;
	}

	/* Clickable avatar button wrapper for settings */
	.desktop-user-panel__avatar-btn-wrapper {
		position: relative;
		flex-shrink: 0;
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		border-radius: 9999px;
		transition: all 200ms ease;
	}

	.desktop-user-panel__avatar-btn-wrapper:hover {
		transform: scale(1.05);
	}

	.desktop-user-panel__avatar-ring {
		width: 48px;
		height: 48px;
		border-radius: 9999px;
		padding: 3px;
		background: transparent;
		transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.desktop-user-panel__avatar-ring--active {
		background: linear-gradient(135deg, var(--color-accent) 0%, color-mix(in srgb, var(--color-accent) 70%, purple) 100%);
		box-shadow: 0 0 20px color-mix(in srgb, var(--color-accent) 60%, transparent);
	}

	.desktop-user-panel__avatar-btn {
		width: 42px;
		height: 42px;
		border-radius: 9999px;
		overflow: hidden;
		display: block;
		background: transparent;
		border: none;
		cursor: pointer;
	}

	:global(.desktop-user-panel__avatar) {
		width: 42px !important;
		height: 42px !important;
		border-radius: 9999px;
	}

	.status-indicator {
		position: absolute;
		right: -8px;
		bottom: -8px;
		width: 24px;
		height: 24px;
		border-radius: 9999px;
		background: var(--color-panel-muted);
		border: 4px solid var(--color-panel);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		z-index: 10;
	}

	.status-indicator:hover {
		transform: scale(1.2);
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
	}

	.status-dot {
		width: 14px;
		height: 14px;
		border-radius: 9999px;
		display: block;
		transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.status-dot--online {
		background: linear-gradient(135deg, #10b981 0%, #059669 100%);
		box-shadow: 0 0 12px rgba(16, 185, 129, 0.7),
			0 0 4px rgba(16, 185, 129, 0.5) inset;
	}

	.status-dot--idle {
		background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
		box-shadow: 0 0 12px rgba(245, 158, 11, 0.7),
			0 0 4px rgba(245, 158, 11, 0.5) inset;
	}

	.status-dot--busy {
		background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
		box-shadow: 0 0 12px rgba(239, 68, 68, 0.7),
			0 0 4px rgba(239, 68, 68, 0.5) inset;
	}

	.status-dot--offline {
		background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);
		box-shadow: 0 0 8px rgba(107, 114, 128, 0.4);
	}

	.desktop-user-panel__name {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text-primary);
		white-space: nowrap;
		line-height: 1.3;
		letter-spacing: -0.015em;
	}

	.desktop-user-panel__status {
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.2;
		text-transform: capitalize;
		font-weight: 500;
	}

	.desktop-user-panel__controls {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		position: relative;
		opacity: 1;
		transform: translateX(0);
		transition: opacity 200ms ease-out, transform 200ms ease-out;
	}

	.desktop-user-panel__control {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		position: relative;
	}

	.desktop-user-panel__btn-arrow {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
		padding: 0;
		line-height: 1;
		outline: none;
		font-size: 0.95rem;
	}

	.desktop-user-panel__btn-arrow:hover {
		color: var(--color-text-primary);
		transform: translateY(-1px);
	}

	.desktop-user-panel__btn-arrow:focus-visible {
		color: var(--color-accent);
		transform: translateY(-1px);
	}

	.desktop-user-panel__btn-arrow i {
		line-height: 1;
		position: relative;
		top: -1px;
	}

	.device-quick-picker {
		position: absolute;
		bottom: 52px;
		right: 0;
		width: 230px;
		padding: 10px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--color-panel) 95%, transparent);
		border: 1px solid var(--color-border-subtle);
		box-shadow: 0 14px 30px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255, 255, 255, 0.04) inset;
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		z-index: 12;
		animation: statusMenuIn 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.device-quick-picker__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
		font-weight: 600;
		color: var(--color-text-primary);
		font-size: 0.85rem;
	}

	.device-quick-picker__close {
		background: none;
		border: none;
		color: var(--color-text-tertiary);
		padding: 4px;
		border-radius: 6px;
		cursor: pointer;
		line-height: 1;
	}

	.device-quick-picker__close:hover {
		background: color-mix(in srgb, var(--color-panel) 80%, var(--color-accent) 10%);
		color: var(--color-text-primary);
	}

	.device-quick-picker__row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}

	.device-quick-picker__row:last-child {
		margin-bottom: 0;
	}

	.device-quick-picker__row--single {
		margin-bottom: 0;
	}

	.device-quick-picker label {
		width: 56px;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.device-quick-picker select {
		flex: 1;
		height: 38px;
		border-radius: 10px;
		border: 1.5px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
		background: linear-gradient(135deg, 
			color-mix(in srgb, var(--color-panel) 95%, transparent) 0%, 
			color-mix(in srgb, var(--color-panel) 90%, var(--color-panel-muted) 5%) 100%);
		color: var(--color-text-primary);
		padding: 0 12px;
		font-size: 0.875rem;
		font-weight: 500;
		outline: none;
		transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
		max-width: 100%;
		text-overflow: ellipsis;
		white-space: nowrap;
		overflow: hidden;
		cursor: pointer;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1), 
		            0 0 0 1px rgba(255, 255, 255, 0.03) inset;
		appearance: none;
		-webkit-appearance: none;
		-moz-appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 9L1 4h10z'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 10px center;
		padding-right: 32px;
	}

	.device-quick-picker select:hover {
		border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
		background: linear-gradient(135deg, 
			color-mix(in srgb, var(--color-panel) 98%, var(--color-accent) 2%) 0%, 
			color-mix(in srgb, var(--color-panel) 92%, var(--color-accent) 3%) 100%);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15), 
		            0 0 0 1px rgba(255, 255, 255, 0.05) inset;
		transform: translateY(-1px);
	}

	.device-quick-picker select option {
		background: var(--color-panel);
		color: var(--color-text-primary);
		padding: 10px 12px;
		font-weight: 500;
		text-overflow: ellipsis;
		white-space: nowrap;
		overflow: hidden;
	}

	.device-quick-picker select:focus-visible {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 20%, transparent),
		            0 4px 16px rgba(0, 0, 0, 0.2),
		            0 0 0 1px rgba(255, 255, 255, 0.08) inset;
		transform: translateY(-1px);
	}

	.device-quick-picker__loading,
	.device-quick-picker__error {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
	}

	.desktop-user-panel__btn {
		width: 36px;
		height: 36px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--color-text-tertiary);
		cursor: pointer;
		transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
		font-size: 1.25rem;
		text-decoration: none;
	}

	.desktop-user-panel__btn:hover {
		background: color-mix(in srgb, var(--color-panel) 80%, transparent);
		color: var(--color-text-primary);
		transform: translateY(-1px);
	}

	.desktop-user-panel__btn:active {
		transform: translateY(0);
	}

	.desktop-user-panel__btn.is-active {
		background: color-mix(in srgb, #ef4444 20%, transparent);
		color: #ef4444;
	}

	.desktop-user-panel__btn.is-active:hover {
		background: color-mix(in srgb, #ef4444 30%, transparent);
		color: #f87171;
	}

	.desktop-user-panel__btn.is-disabled {
		opacity: 0.4;
		cursor: not-allowed;
		pointer-events: none;
	}

	/* Status menu - modern popup */
	.status-menu {
		position: absolute;
		bottom: calc(100% + 10px);
		left: 8px;
		width: 240px;
		background: var(--color-panel);
		border: 1px solid var(--color-border-subtle);
		border-radius: 12px;
		padding: 0.75rem;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
		z-index: 100;
		animation: statusMenuIn 200ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	@keyframes statusMenuIn {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.status-menu__section {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.status-menu__title {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-tertiary);
		padding: 0.25rem 0.5rem;
	}

	.status-menu__list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.status-option {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.625rem 0.5rem;
		border-radius: 8px;
		background: transparent;
		border: none;
		cursor: pointer;
		width: 100%;
		text-align: left;
		color: var(--color-text-primary);
		transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.status-option:hover {
		background: color-mix(in srgb, var(--color-panel-muted) 60%, transparent);
		transform: translateX(4px);
	}

	.status-option.is-active {
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		border-left: 2px solid var(--color-accent);
		margin-left: -2px;
	}

	.status-option__dot {
		width: 14px;
		height: 14px;
		border-radius: 9999px;
		flex-shrink: 0;
		transition: transform 200ms ease;
	}

	.status-option:hover .status-option__dot {
		transform: scale(1.2);
	}

	.status-option__dot--auto {
		background: var(--color-panel-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.6rem;
		color: var(--color-text-tertiary);
	}

	.status-option__meta {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.status-option__label {
		font-size: 0.8rem;
		font-weight: 500;
	}

	.status-option__description {
		font-size: 0.7rem;
		color: var(--color-text-tertiary);
	}

	.status-option__check {
		color: var(--color-accent);
		font-size: 1rem;
	}

	.status-menu__error {
		padding: 0.5rem;
		color: #ef4444;
		font-size: 0.75rem;
	}

	.status-menu__override {
		padding: 0.5rem;
		border-top: 1px solid var(--color-border-subtle);
		margin-top: 0.25rem;
	}

	.status-menu__override-label {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.status-menu__override-expiry {
		font-size: 0.7rem;
		color: var(--color-text-tertiary);
		margin-top: 0.125rem;
	}

	.status-menu__clear {
		margin-top: 0.5rem;
		padding: 0.5rem 0.875rem;
		font-size: 0.75rem;
		font-weight: 500;
		border-radius: 8px;
		background: linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 20%, transparent) 0%, color-mix(in srgb, var(--color-accent) 10%, transparent) 100%);
		border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
		color: var(--color-accent);
		cursor: pointer;
		transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.status-menu__clear:hover {
		background: linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 30%, transparent) 0%, color-mix(in srgb, var(--color-accent) 20%, transparent) 100%);
		transform: translateY(-1px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--color-accent) 20%, transparent);
	}

	.status-menu__hint {
		padding: 0.625rem 0.5rem;
		font-size: 0.65rem;
		color: var(--color-text-tertiary);
		border-top: 1px solid var(--color-border-subtle);
		margin-top: 0.5rem;
		opacity: 0.8;
	}
</style>
