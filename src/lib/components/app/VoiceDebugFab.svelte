<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount, tick } from 'svelte';
	import { user } from '$lib/stores/user';
	import { voiceSession } from '$lib/stores/voice';
	import { voiceStore } from '$lib/stores/voiceStore';
import { isVoiceDebugAssignee, voiceDebugConfigStore } from '$lib/admin/voiceDebug';
	import {
		copyVoiceDebugAggregate,
		clearVoiceDebugEvents,
		getVoiceDebugContext,
		type VoiceDebugEvent
	} from '$lib/utils/voiceDebugContext';
	import { fabSnapStore, isFabSnappingDisabled, type SnapZone } from '$lib/stores/fabSnap';
	import { copyTextToClipboard } from '$lib/utils/clipboard';

	type Position = { x: number; y: number };

type QuickVoiceStats = {
	rttMs: number | null;
	jitterMs: number | null;
	inboundLossPct: number | null;
	outboundLossPct: number | null;
	inboundAudioBytes: number | null;
	outboundAudioBytes: number | null;
	availableOutKbps: number | null;
	availableInKbps: number | null;
	candidate: {
		id: string | null;
		state: string | null;
		nominated: boolean | null;
		rttMs: number | null;
		protocol: string | null;
	} | null;
};

	const STORAGE_KEY = 'hconnect:voiceDebugFab:position';
	const FAB_ID = 'voice-debug-fab';
	const FAB_SIZE = 48;
	const MIN_MARGIN = 8;

	const voiceDebug = voiceDebugConfigStore();
	const session = voiceSession;
	const participantCount = voiceStore.participantCount;
	const statusMessage = voiceStore.statusMessage;
	const participants = voiceStore.activeParticipants;
	const isConnected = voiceStore.isConnected;
	const isConnecting = voiceStore.isConnecting;

	let fabEl = $state<HTMLButtonElement | null>(null);
	let position = $state<Position>({ x: 0, y: 0 });
	let ready = $state(false);
	let dragging = $state(false);
	let dragOffset: Position = { x: 0, y: 0 };
	let dragStartTime = 0;
	let isSnapped = $state(false);
	let snappedZoneId: string | null = $state(null);
	let nearSnapZone: SnapZone | null = $state(null);
	
	// Tray awareness - for hiding when snapped to tray and tray is closed
	let trayOpen = $state(false);
	let userClosedTray = $state(true); // Start true so FABs snapped to tray are hidden until tray opens
	let trayUnmounted = $state(false); // Track if tray component unmounted (vs user closing)
	const hiddenInTray = $derived(isSnapped && (snappedZoneId ?? '').startsWith('fab-tray-slot-') && !trayOpen && userClosedTray && !trayUnmounted);

	let showPanel = $state(false);
	let refreshTimer: ReturnType<typeof setInterval> | null = null;
	let quickStats = $state<QuickVoiceStats>({
		rttMs: null,
		jitterMs: null,
		inboundLossPct: null,
		outboundLossPct: null,
		inboundAudioBytes: null,
		outboundAudioBytes: null,
		availableOutKbps: null,
		availableInKbps: null,
		candidate: null
	});
	let recentEvents = $state<string[]>([]);
	let snapshotUpdatedAt = $state<string | null>(null);
	let copyState = $state<'idle' | 'copying' | 'copied' | 'error'>('idle');
	let recentPresence = $state<
		Array<{ type: 'join' | 'leave'; uid: string; name: string; ts: number }>
	>([]);
	let prevParticipantIds = new Set<string>();
	let lastParticipantNames = new Map<string, string>();

	const isAllowed = $derived(isVoiceDebugAssignee($voiceDebug, $user?.email ?? null));
	const canShowFab = $derived(Boolean($voiceDebug?.enabled && isAllowed));
	const panelPlacement = $derived.by(() => {
		if (!browser) return { vertical: 'above', horizontal: 'center' as const };
		const vh = window.innerHeight;
		const vw = window.innerWidth;
		const panelHeight = 520;
		const panelWidth = 420;
		const spaceAbove = position.y;
		const spaceBelow = vh - position.y - FAB_SIZE;
		const vertical =
			spaceBelow > panelHeight + 20
				? 'below'
				: spaceAbove > panelHeight + 20
					? 'above'
					: spaceBelow > spaceAbove
						? 'below'
						: 'above';

		const fabCenterX = position.x + FAB_SIZE / 2;
		const horizontal =
			fabCenterX < panelWidth / 2 + 20
				? 'left'
				: fabCenterX > vw - panelWidth / 2 - 20
					? 'right'
					: 'center';

		return { vertical, horizontal };
	});

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

		const wasSnapped = !$isFabSnappingDisabled && fabSnapStore.isSnappedToRail(FAB_ID);
		const savedZoneId = fabSnapStore.getSnappedZoneId(FAB_ID);
		if (wasSnapped && savedZoneId) {
			// If snapped to a tray slot, stay snapped even if tray isn't in DOM
			// This keeps the FAB hidden when navigating to pages without the tray
			if (savedZoneId.startsWith('fab-tray-slot-')) {
				isSnapped = true;
				snappedZoneId = savedZoneId;
				// Don't set position - FAB will be hidden anyway
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
			position = clampToViewport({
				x: window.innerWidth - FAB_SIZE - 16,
				y: window.innerHeight - FAB_SIZE - 160
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
		// Calculate snap position: center the FAB on the zone
		const snapX = zone.x + (zone.width - FAB_SIZE) / 2;
		const snapY = zone.y + (zone.height - FAB_SIZE) / 2;
		
		position = clampToViewport({ x: snapX, y: snapY });
		isSnapped = true;
		snappedZoneId = zone.id;
		
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
			const snapZone = checkNearSnapZone();
			if (snapZone) {
				snapToZone(snapZone);
			} else {
				persistPosition(position, false);
			}
		} else {
			// Was a tap - toggle panel
			showPanel = !showPanel;
			if (showPanel) startDebugPolling();
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

	function formatEventLine(event: VoiceDebugEvent): string {
		const payload = event.details ? ` | ${JSON.stringify(event.details).slice(0, 160)}` : '';
		return `[${event.timestamp}] ${event.source}: ${event.message}${payload}`;
	}

	type CandidatePairSummary = {
		id?: string;
		state?: string;
		nominated?: boolean;
		currentRoundTripTime?: number;
		transport?: string;
		protocol?: string;
		availableOutgoingBitrate?: number;
		availableIncomingBitrate?: number;
	};

	function deriveQuickStats(statsSection: any): QuickVoiceStats {
		const initial: QuickVoiceStats = {
			rttMs: null,
			jitterMs: null,
			inboundLossPct: null,
			outboundLossPct: null,
			inboundAudioBytes: null,
			outboundAudioBytes: null,
			availableOutKbps: null,
			availableInKbps: null,
			candidate: null
		};
		if (!statsSection) return initial;

		const inboundAudio = Array.isArray(statsSection.inboundAudio) ? statsSection.inboundAudio : [];
		const outboundAudio = Array.isArray(statsSection.outboundAudio) ? statsSection.outboundAudio : [];
		const candidatePairs: CandidatePairSummary[] = Array.isArray(statsSection.candidatePairs)
			? statsSection.candidatePairs
			: [];

		const inbound = inboundAudio[0];
		const outbound = outboundAudio[0];
		if (inbound) {
			const packets = Number(inbound.packetsReceived ?? 0);
			const lost = Number(inbound.packetsLost ?? 0);
			if (packets + lost > 0) {
				initial.inboundLossPct = (lost / (packets + lost)) * 100;
			}
			if (typeof inbound.jitter === 'number') {
				initial.jitterMs = inbound.jitter * 1000;
			}
			initial.inboundAudioBytes = Number(inbound.bytesReceived ?? null);
		}
		if (outbound) {
			const sent = Number(outbound.packetsSent ?? 0);
			const lost = Number(outbound.packetsLost ?? 0);
			if (sent + lost > 0) {
				initial.outboundLossPct = (lost / (sent + lost)) * 100;
			}
			if (typeof outbound.roundTripTime === 'number') {
				initial.rttMs = outbound.roundTripTime * 1000;
			}
			initial.outboundAudioBytes = Number(outbound.bytesSent ?? null);
		}

		const selected =
			candidatePairs.find((c: CandidatePairSummary) => c.nominated) ||
			candidatePairs.find((c: CandidatePairSummary) => c.state === 'succeeded') ||
			candidatePairs[0];
		if (selected) {
			initial.candidate = {
				id: selected.id ?? null,
				state: selected.state ?? null,
				nominated: selected.nominated === undefined ? null : Boolean(selected.nominated),
				rttMs:
					typeof selected.currentRoundTripTime === 'number'
						? selected.currentRoundTripTime * 1000
						: null,
				protocol:
					typeof selected.transport === 'string'
						? selected.transport
						: typeof selected.protocol === 'string'
							? selected.protocol
							: null
			};
			if (typeof selected.availableOutgoingBitrate === 'number') {
				initial.availableOutKbps = Math.round(selected.availableOutgoingBitrate / 1000);
			}
			if (typeof selected.availableIncomingBitrate === 'number') {
				initial.availableInKbps = Math.round(selected.availableIncomingBitrate / 1000);
			}
		}

		return initial;
	}

	async function refreshDebugSnapshot() {
		if (!browser || !canShowFab) return;
		try {
			const dumpFn = (window as any)?.hConnectVoiceDump;
			if (typeof dumpFn === 'function') {
				// Refresh the voice debug sections with a lightweight dump.
				await dumpFn({ includeEvents: 60, includeLogs: 20 });
			}
			const snapshot = getVoiceDebugContext(60);
			quickStats = deriveQuickStats((snapshot.sections as any)?.['call.stats']);
			recentEvents = (snapshot.events ?? []).slice(0, 8).map(formatEventLine);
			snapshotUpdatedAt = new Date().toLocaleTimeString();
		} catch (err) {
			console.warn('[VoiceDebugFab] Failed to refresh debug snapshot', err);
		}
	}

	function startDebugPolling() {
		if (refreshTimer) return;
		void refreshDebugSnapshot();
		refreshTimer = setInterval(refreshDebugSnapshot, 5000);
	}

	function stopDebugPolling() {
		if (refreshTimer) {
			clearInterval(refreshTimer);
			refreshTimer = null;
		}
	}

	async function copyQuickSummary() {
		const lines: string[] = [];
		lines.push('hConnect voice quick snapshot');
		lines.push(
			`session: ${$session?.serverName ?? 'n/a'} / ${$session?.channelName ?? 'n/a'} (${($participantCount ?? 0).toString()} participants)`
		);
		lines.push(
			`status: ${$isConnected ? 'connected' : $isConnecting ? 'connecting' : 'idle'}${$statusMessage ? ` - ${$statusMessage}` : ''}`
		);
		if (quickStats.rttMs !== null) lines.push(`rtt_ms: ${quickStats.rttMs.toFixed(0)}`);
		if (quickStats.jitterMs !== null) lines.push(`jitter_ms: ${quickStats.jitterMs.toFixed(1)}`);
		if (quickStats.inboundLossPct !== null)
			lines.push(`loss_in_pct: ${quickStats.inboundLossPct.toFixed(2)}`);
		if (quickStats.outboundLossPct !== null)
			lines.push(`loss_out_pct: ${quickStats.outboundLossPct.toFixed(2)}`);
		if (quickStats.availableOutKbps !== null)
			lines.push(`avail_out_kbps: ${quickStats.availableOutKbps}`);
		if (quickStats.availableInKbps !== null)
			lines.push(`avail_in_kbps: ${quickStats.availableInKbps}`);
		if (quickStats.candidate) {
			lines.push(
				`candidate: state=${quickStats.candidate.state ?? 'n/a'} nominated=${quickStats.candidate.nominated ? 'yes' : 'no'} rtt_ms=${quickStats.candidate.rttMs ? quickStats.candidate.rttMs.toFixed(1) : 'n/a'}`
			);
		}
		if (recentEvents.length) {
			lines.push('', 'recent_events:');
			recentEvents.slice(0, 4).forEach((line) => lines.push(`- ${line}`));
		}
		const result = await copyTextToClipboard(lines.join('\n'));
		copyState = result.success ? 'copied' : 'error';
		if (copyState === 'copied') {
			setTimeout(() => (copyState = 'idle'), 1800);
		}
	}

	async function copyFullBundle() {
		copyState = 'copying';
		const success = await copyVoiceDebugAggregate({ includeEvents: 120, includeLogs: 60 });
		copyState = success ? 'copied' : 'error';
		if (success) {
			setTimeout(() => (copyState = 'idle'), 1800);
		}
	}

	function clearDebugLogs() {
		clearVoiceDebugEvents();
		recentEvents = [];
		snapshotUpdatedAt = new Date().toLocaleTimeString();
	}

	$effect(() => {
		if (showPanel && canShowFab) {
			startDebugPolling();
		} else {
			stopDebugPolling();
		}
	});

	// Track join/leave events for quick presence history
	$effect(() => {
		const list = $participants ?? [];
		const now = Date.now();
		const currentIds = new Set<string>();
		const nextNames = new Map<string, string>();

		for (const p of list) {
			currentIds.add(p.uid);
			const name = p.displayName || p.uid;
			nextNames.set(p.uid, name);
			if (!prevParticipantIds.has(p.uid)) {
				recentPresence = [{ type: 'join' as const, uid: p.uid, name, ts: now }, ...recentPresence].slice(
					0,
					8
				);
			}
		}

		for (const uid of prevParticipantIds) {
			if (!currentIds.has(uid)) {
				const name = lastParticipantNames.get(uid) ?? uid;
				recentPresence = [{ type: 'leave' as const, uid, name, ts: now }, ...recentPresence].slice(
					0,
					8
				);
			}
		}

		prevParticipantIds = currentIds;
		lastParticipantNames = nextNames;
	});

	// Track whether we've registered the FAB
	let isRegistered = $state(false);

	// Effect to register/unregister based on canShowFab
	$effect(() => {
		if (!browser) return;
		
		if (canShowFab && !isRegistered) {
			// Register this FAB with the snap store
			fabSnapStore.registerFab({
				id: FAB_ID,
				label: 'Voice Debug',
				icon: 'bx-headphone'
			});
			isRegistered = true;
		} else if (!canShowFab && isRegistered) {
			// Unregister when no longer allowed
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
			// Don't change userClosedTray - FAB should show in default position when tray is gone
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
		} else if (!wasOpen && trayOpen) {
			userClosedTray = false;
		}
		
		// Update position when tray opens and FAB is snapped to tray
		if (trayOpen && isSnapped && snappedZoneId?.startsWith('fab-tray-slot-')) {
			setTimeout(() => {
				const slotIndex = parseInt(snappedZoneId?.replace('fab-tray-slot-', '') ?? '0', 10);
				const slot = document.querySelector(`.fab-tray__slot[data-slot="${slotIndex}"]`) as HTMLElement;
				if (slot) {
					const rect = slot.getBoundingClientRect();
					const snapX = rect.left + (rect.width - FAB_SIZE) / 2;
					const snapY = rect.top + (rect.height - FAB_SIZE) / 2;
					position = { x: snapX, y: snapY };
					
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
			
			// Listen for mobile FAB clicks from mobile dock
			const handleMobileFabClick = (e: CustomEvent<{ fabId: string }>) => {
				if (e.detail.fabId === FAB_ID) {
					// Navigate to mobile voice debug page
					goto('/voice-debug');
				}
			};
			window.addEventListener('mobileFabClick', handleMobileFabClick as EventListener);
		} else {
			ready = true;
		}
	});

	onDestroy(() => {
		stopDebugPolling();
		if (browser) {
			window.removeEventListener('fabSnapZoneUpdated', handleSnapZoneUpdated);
			window.removeEventListener('fabSnapStateSynced', handleFabSnapSynced as EventListener);
			window.removeEventListener('fabTrayStateChange', handleTrayStateChange as EventListener);
			// Note: mobileFabClick listener is cleaned up automatically
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
						position = { x: snapX, y: snapY };
						
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

{#if canShowFab}
	<div
		class="voice-debug-fab-wrapper"
		class:voice-debug-fab-wrapper--ready={ready}
		class:voice-debug-fab-wrapper--snapped={isSnapped}
		class:voice-debug-fab-wrapper--near-snap={nearSnapZone !== null}
		class:voice-debug-fab-wrapper--hidden={hiddenInTray}
		style="transform: translate3d({position.x}px, {position.y}px, 0);"
	>
		<button
			bind:this={fabEl}
			type="button"
			class="voice-debug-fab"
			class:voice-debug-fab--dragging={dragging}
			class:voice-debug-fab--snapped={isSnapped}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
			ontouchstart={stopTouchPropagation}
			ontouchmove={stopTouchPropagation}
			ontouchend={stopTouchPropagation}
			ontouchcancel={stopTouchPropagation}
			aria-label="Open voice debug bubble"
			title="Voice debug bubble"
		>
			<i class="bx bx-headphone" aria-hidden="true"></i>
		</button>

		{#if showPanel}
			<div
				class="voice-debug-panel"
				data-vertical={panelPlacement.vertical}
				data-horizontal={panelPlacement.horizontal}
				role="dialog"
				aria-label="Voice debug quick stats"
			>
				<div class="voice-debug-panel__header">
					<div>
						<p class="voice-debug-panel__eyebrow">Voice debugging</p>
						<p class="voice-debug-panel__title">
							{$session?.channelName ?? 'No active call'}
						</p>
						<p class="voice-debug-panel__subtitle">
							{$session?.serverName ?? 'Assign user to join a voice call for stats'}
						</p>
					</div>
					<button type="button" class="close-btn" aria-label="Close" onclick={() => (showPanel = false)}>
						<i class="bx bx-x"></i>
					</button>
				</div>

				<div class="voice-debug-panel__stats">
					<div>
						<p class="label">Status</p>
						<p class="value">
							{$isConnected
								? 'Connected'
								: $isConnecting
									? 'Connecting...'
									: 'Idle'}
						</p>
						{#if $statusMessage}
							<p class="hint">{$statusMessage}</p>
						{/if}
					</div>
					<div>
						<p class="label">Channel</p>
						<p class="value">{$session?.channelName ?? '—'}</p>
						<p class="hint">Server: {$session?.serverName ?? '—'}</p>
					</div>
					<div>
						<p class="label">Participants</p>
						<p class="value">{$participantCount ?? 0}</p>
					</div>
					<div>
						<p class="label">RTT</p>
						<p class="value">{quickStats.rttMs !== null ? `${quickStats.rttMs.toFixed(0)} ms` : '—'}</p>
						<p class="hint">Jitter {quickStats.jitterMs !== null ? `${quickStats.jitterMs.toFixed(1)} ms` : 'n/a'}</p>
					</div>
					<div>
						<p class="label">Loss in/out</p>
						<p class="value">
							{quickStats.inboundLossPct !== null ? `${quickStats.inboundLossPct.toFixed(2)}%` : '—'}
							<span class="divider">/</span>
							{quickStats.outboundLossPct !== null ? `${quickStats.outboundLossPct.toFixed(2)}%` : '—'}
						</p>
						<p class="hint">
							Bw {quickStats.availableOutKbps !== null ? `${quickStats.availableOutKbps}kbps` : '—'} out ·
							{quickStats.availableInKbps !== null ? `${quickStats.availableInKbps}kbps` : '—'} in
						</p>
					</div>
				</div>

				<div class="voice-debug-panel__grid">
					<div class="card">
						<div class="card__header">
							<p>ICE candidate</p>
						</div>
						{#if quickStats.candidate}
							<ul class="card__list">
								<li>State: {quickStats.candidate.state ?? 'n/a'}</li>
								<li>Nominated: {quickStats.candidate.nominated ? 'yes' : 'no'}</li>
								<li>RTT: {quickStats.candidate.rttMs !== null ? `${quickStats.candidate.rttMs.toFixed(1)} ms` : 'n/a'}</li>
								<li>Id: {quickStats.candidate.id ?? 'unknown'}</li>
							</ul>
						{:else}
							<p class="hint">No candidate pair yet.</p>
						{/if}
					</div>

					<div class="card">
						<div class="card__header">
							<p>Events (latest)</p>
						</div>
						{#if recentEvents.length}
							<ul class="card__list">
								{#each recentEvents as eventLine, idx (eventLine + idx)}
									<li>{eventLine}</li>
								{/each}
							</ul>
						{:else}
							<p class="hint">Waiting for voice activity.</p>
						{/if}
					</div>

					<div class="card">
						<div class="card__header">
							<p>Presence</p>
						</div>
						{#if recentPresence.length}
							<ul class="card__list presence-list">
								{#each recentPresence as evt, idx (`${evt.uid}-${idx}`)}
									<li>
										<span class={`pill ${evt.type === 'join' ? 'pill--join' : 'pill--leave'}`}>
											{evt.type === 'join' ? 'Join' : 'Leave'}
										</span>
										<div class="presence-meta">
											<p>{evt.name}</p>
											<small>{new Date(evt.ts).toLocaleTimeString()}</small>
										</div>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="hint">No recent joins or leaves yet.</p>
						{/if}
					</div>
				</div>

				<div class="voice-debug-panel__footer">
					<div class="footer-meta">
						<p class="hint">Snapshot {snapshotUpdatedAt ? `updated ${snapshotUpdatedAt}` : 'pending'}</p>
					</div>
					<div class="footer-actions">
						<button type="button" class="btn ghost" onclick={clearDebugLogs}>
							<i class="bx bx-eraser"></i>
							Clear logs
						</button>
						<button type="button" class="btn ghost" onclick={copyQuickSummary} disabled={copyState === 'copying'}>
							{#if copyState === 'copied'}
								<i class="bx bx-check"></i>
								Copied
							{:else}
								<i class="bx bx-copy-alt"></i>
								Copy quick stats
							{/if}
						</button>
						<button type="button" class="btn solid" onclick={copyFullBundle} disabled={copyState === 'copying'}>
							{#if copyState === 'copying'}
								<i class="bx bx-loader-alt bx-spin"></i>
								Collecting...
							{:else}
								<i class="bx bx-export"></i>
								Copy full bundle
							{/if}
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.voice-debug-fab-wrapper {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 66;
		opacity: 0;
		pointer-events: none;
		transition: opacity 200ms ease;
	}
	
	/* Hide floating FAB on mobile - it's shown in the mobile dock instead */
	@media (max-width: 767px) {
		.voice-debug-fab-wrapper {
			display: none !important;
		}
	}

	.voice-debug-fab-wrapper--ready {
		opacity: 1;
		pointer-events: auto;
	}

	.voice-debug-fab-wrapper--hidden {
		opacity: 0 !important;
		pointer-events: none !important;
		visibility: hidden;
	}

	.voice-debug-fab-wrapper--snapped {
		transition: transform 200ms ease-out;
	}

	.voice-debug-fab-wrapper--near-snap {
		filter: drop-shadow(0 0 8px var(--color-accent, #0ea5e9));
	}

	.voice-debug-fab {
		width: 3.2rem;
		height: 3.2rem;
		border-radius: 999px;
		border: 1px solid rgba(14, 165, 233, 0.6);
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.98), rgba(14, 165, 233, 0.92));
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

	.voice-debug-fab--snapped {
		width: 3rem;
		height: 3rem;
		box-shadow: 0 8px 18px rgba(14, 165, 233, 0.25);
	}

	@media (max-width: 767px) {
		.voice-debug-fab {
			width: 3rem;
			height: 3rem;
		}
	}

	.voice-debug-fab--dragging {
		cursor: grabbing;
		box-shadow: 0 20px 40px rgba(14, 165, 233, 0.45);
	}

	.voice-debug-fab:hover:not(.voice-debug-fab--dragging),
	.voice-debug-fab:focus-visible {
		transform: translateY(-2px);
		box-shadow: 0 18px 32px rgba(14, 165, 233, 0.45);
		outline: none;
	}

	.voice-debug-panel {
		position: absolute;
		width: 420px;
		max-width: calc(100vw - 24px);
		height: 520px;
		max-height: calc(100vh - 24px);
		background: var(--panel-bg, #1e1e2e);
		border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
		border-radius: 14px;
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		padding: 0.8rem 0.95rem;
		z-index: 100001;
	}

	.voice-debug-panel[data-vertical='above'] {
		bottom: calc(100% + 12px);
		top: auto;
	}

	.voice-debug-panel[data-vertical='below'] {
		top: calc(100% + 12px);
		bottom: auto;
	}

	.voice-debug-panel[data-horizontal='center'] {
		left: 50%;
		right: auto;
		transform: translateX(-50%);
	}

	.voice-debug-panel[data-horizontal='left'] {
		left: 0;
		right: auto;
		transform: none;
	}

	.voice-debug-panel[data-horizontal='right'] {
		right: 0;
		left: auto;
		transform: none;
	}

	.voice-debug-panel__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.voice-debug-panel__eyebrow {
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-size: 0.72rem;
		color: var(--text-muted, rgba(255, 255, 255, 0.6));
	}

	.voice-debug-panel__title {
		margin: 0.1rem 0 0;
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text-primary, #f8fafc);
	}

	.voice-debug-panel__subtitle {
		margin: 0.1rem 0 0;
		font-size: 0.8rem;
		color: var(--text-muted, rgba(255, 255, 255, 0.65));
	}

	.close-btn {
		border: none;
		background: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		color: var(--text-primary, #f8fafc);
		width: 2.4rem;
		height: 2.4rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 10px;
		cursor: pointer;
		transition: background 150ms ease, color 150ms ease;
	}

	.close-btn:hover {
		background: color-mix(in srgb, var(--color-danger, #ef4444) 20%, transparent);
		color: #fecdd3;
	}

	.voice-debug-panel__stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.6rem;
		padding: 0.45rem 0.55rem;
		border-radius: 12px;
		background: color-mix(in srgb, var(--surface-panel, #0f172a) 85%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
	}

	.voice-debug-panel__stats .label {
		margin: 0;
		font-size: 0.78rem;
		color: var(--text-muted, rgba(255, 255, 255, 0.65));
	}

	.voice-debug-panel__stats .value {
		margin: 0.05rem 0;
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary, #f8fafc);
	}

	.voice-debug-panel__stats .hint {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-muted, rgba(255, 255, 255, 0.6));
	}

	.divider {
		color: var(--text-muted, rgba(255, 255, 255, 0.5));
		padding: 0 0.25rem;
	}

	.voice-debug-panel__grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.6rem;
		flex: 1;
		min-height: 0;
	}

	.card {
		background: color-mix(in srgb, var(--surface-panel, #111827) 82%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		border-radius: 12px;
		padding: 0.65rem 0.75rem;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.card__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.25rem;
	}

	.card__header p {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--text-primary, #f8fafc);
	}

	.card__list {
		margin: 0;
		padding-left: 1rem;
		display: grid;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--text-muted, rgba(255, 255, 255, 0.75));
		overflow-y: auto;
	}

	.presence-list {
		padding-left: 0;
		gap: 0.45rem;
	}

	.presence-list li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.presence-meta p {
		margin: 0;
		font-weight: 700;
		color: var(--text-primary, #f8fafc);
	}

	.presence-meta small {
		color: var(--text-muted, rgba(255, 255, 255, 0.65));
	}

	.pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: color-mix(in srgb, var(--color-text-primary) 12%, transparent);
		color: var(--text-primary, #f8fafc);
	}

	.pill--join {
		background: color-mix(in srgb, #22c55e 20%, transparent);
		color: #bbf7d0;
	}

	.pill--leave {
		background: color-mix(in srgb, #f97316 20%, transparent);
		color: #fed7aa;
	}

	.voice-debug-panel__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		border-top: 1px solid color-mix(in srgb, var(--color-text-primary) 12%, transparent);
		padding-top: 0.5rem;
	}

	.footer-meta .hint {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-muted, rgba(255, 255, 255, 0.6));
	}

	.footer-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.btn {
		border: none;
		border-radius: 10px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		font-weight: 700;
		cursor: pointer;
		font-size: 0.85rem;
		padding: 0.45rem 0.85rem;
		transition: background 140ms ease, color 140ms ease, opacity 120ms ease;
	}

	.btn i {
		font-size: 1rem;
	}

	.btn.ghost {
		background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
		color: var(--text-primary, #f8fafc);
	}

	.btn.ghost:hover {
		background: color-mix(in srgb, var(--color-text-primary) 14%, transparent);
	}

	.btn.solid {
		background: linear-gradient(135deg, #3b82f6, #0ea5e9);
		color: white;
	}

	.btn.solid:hover {
		opacity: 0.9;
	}

	.hint {
		color: var(--text-muted, rgba(255, 255, 255, 0.6));
		font-size: 0.78rem;
		margin: 0;
	}

	@media (max-width: 640px) {
		.voice-debug-panel {
			position: fixed;
			left: 12px !important;
			right: 12px !important;
			top: 12px !important;
			width: auto;
			height: auto;
			max-height: calc(100vh - 24px);
		}

		.voice-debug-panel__stats {
			grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		}
	}
</style>
