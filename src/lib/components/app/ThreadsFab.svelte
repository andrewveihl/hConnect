<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy, tick } from 'svelte';
	import { user } from '$lib/stores/user';
	import { getDb } from '$lib/firebase';
	import {
		collection,
		query,
		onSnapshot,
		Timestamp,
		doc,
		getDoc,
		type Unsubscribe
	} from 'firebase/firestore';
	import type { ChannelThread } from '$lib/firestore/threads';
	import { leaveThread, getThread, streamThreadMessages, type ThreadMessage } from '$lib/firestore/threads';
	import { markThreadRead as markThreadReadThread } from '$lib/firestore/threads';
	import { threadUnreadCount, threadUnreadById } from '$lib/stores/notifications';
	import { fabSnapStore, isFabSnappingDisabled, type SnapZone } from '$lib/stores/fabSnap';
	import MessageList from '$lib/components/chat/MessageList.svelte';
	import ChatInput from '$lib/components/chat/ChatInput.svelte';
	import type { ReplyReferenceInput } from '$lib/firestore/messages';
	import { sendThreadMessage } from '$lib/firestore/threads';
	import type { PendingUploadPreview } from '$lib/components/chat/types';

	type ThreadWithMeta = ChannelThread & {
		serverName?: string;
		channelName?: string;
		unreadCount?: number;
		lastReadMessageId?: string;
	};

	// Position management - independent from FloatingActionDock
	const STORAGE_KEY = 'hconnect:threadsFab:position';
	const FAB_ID = 'threads-fab';
	const FAB_SIZE = 48; // 3rem - matches rail-button size when snapped
	const MIN_MARGIN = 8;
	const SNAP_THRESHOLD_PX = 150; // Distance in pixels to trigger snap (increased for easier snapping)

	type Position = { x: number; y: number };
	type BulkAction = 'idle' | 'clearingNotifications' | 'clearingThreads';

	let fabEl = $state<HTMLDivElement | null>(null);
	let fabBtnEl = $state<HTMLButtonElement | null>(null);
	let position = $state<Position>({ x: 0, y: 0 });
	let customPosition = $state(false);
	let ready = $state(false);
	let dragging = $state(false);
	let dragOffset: Position = { x: 0, y: 0 };
	let dragStartTime = 0;
	let isSnapped = $state(false);
	let snappedZoneId = $state<string | null>(null);
	let nearSnapZone: SnapZone | null = $state(null);
	let trayOpen = $state(false); // Track if FAB tray is open (to hide when snapped and tray closed)
	let userClosedTray = $state(true); // Start true so FABs snapped to tray are hidden until user opens tray or drags them out
	
	
	// Hide FAB when it's snapped to tray, tray is closed, AND user explicitly closed it
	// (Don't hide if tray just auto-closed after drag - wait for user to toggle)
	let hiddenInTray = $derived(isSnapped && (snappedZoneId ?? '').startsWith('fab-tray-slot-') && !trayOpen && userClosedTray);

	let showPopover = $state(false);
	let recentThreads = $state<ThreadWithMeta[]>([]);
	let threadsUnsub: Unsubscribe | null = null;
	let navigationHistory = $state<ThreadWithMeta[]>([]);
	let dismissedThreadIds = $state<Set<string>>(new Set());
	let searchQuery = $state('');
	let bulkAction = $state<BulkAction>('idle');

	// Floating thread popup state (for when not on server page)
	type FloatingThreadState = {
		thread: ChannelThread;
		root: any;
		messages: ThreadMessage[];
		replyTarget: ReplyReferenceInput | null;
		pendingUploads: PendingUploadPreview[];
		position: { x: number; y: number };
		stream: Unsubscribe | null;
	};
	let floatingThread = $state<FloatingThreadState | null>(null);
	let floatingThreadProfiles = $state<Record<string, any>>({});
	let floatingDragging = $state(false);
	let floatingDragOffset = { x: 0, y: 0 };
	let floatingDragPointerId: number | null = null;
	
	// Check if we're on a server page (which handles floating threads itself)
	const isOnServerPage = $derived($page?.url?.pathname?.startsWith('/servers/') ?? false);
	
	// Mobile detection for fullscreen mode - initialize synchronously
	let isMobile = $state(browser ? window.matchMedia('(max-width: 768px)').matches : false);
	$effect(() => {
		if (!browser) return;
		const mq = window.matchMedia('(max-width: 768px)');
		isMobile = mq.matches;
		const handler = (e: MediaQueryListEvent) => { isMobile = e.matches; };
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	});
	
	// Swipe-to-dismiss state for mobile floating thread
	const SWIPE_THRESHOLD = 80;
	const SWIPE_VELOCITY_THRESHOLD = 0.5;
	let swipeTracking = $state(false);
	let swipeStartX = 0;
	let swipeStartY = 0;
	let swipeStartTime = 0;
	let swipeDeltaX = $state(0);
	let swipeActive = $state(false);

	function handleSwipeTouchStart(e: TouchEvent) {
		if (!isMobile || !floatingThread || e.touches.length !== 1) return;
		e.stopPropagation();
		const touch = e.touches[0];
		swipeStartX = touch.clientX;
		swipeStartY = touch.clientY;
		swipeStartTime = Date.now();
		swipeTracking = true;
		swipeActive = false;
		swipeDeltaX = 0;
	}

	function handleSwipeTouchMove(e: TouchEvent) {
		if (!swipeTracking || e.touches.length !== 1) return;
		e.stopPropagation();
		const touch = e.touches[0];
		const dx = touch.clientX - swipeStartX;
		const dy = touch.clientY - swipeStartY;

		// Only activate swipe if horizontal movement is dominant and rightward
		if (!swipeActive) {
			if (Math.abs(dy) > Math.abs(dx) * 1.2) {
				// Vertical scroll - cancel swipe tracking
				swipeTracking = false;
				return;
			}
			if (dx > 10) {
				swipeActive = true;
			}
		}

		if (swipeActive) {
			// Only allow rightward swipe (positive dx)
			swipeDeltaX = Math.max(0, dx);
			// Prevent scrolling while swiping
			e.preventDefault();
		}
	}

	function handleSwipeTouchEnd(e?: TouchEvent) {
		e?.stopPropagation();
		if (!swipeTracking) return;
		
		if (swipeActive && swipeDeltaX > 0) {
			const elapsed = Date.now() - swipeStartTime;
			const velocity = swipeDeltaX / elapsed;
			const shouldDismiss = swipeDeltaX >= SWIPE_THRESHOLD || velocity >= SWIPE_VELOCITY_THRESHOLD;
			
			if (shouldDismiss) {
				closeFloatingThread();
			}
		}
		
		swipeTracking = false;
		swipeActive = false;
		swipeDeltaX = 0;
	}

	// Computed swipe transform for the floating popup
	const swipeTransform = $derived.by(() => {
		if (!isMobile || !swipeActive || swipeDeltaX <= 0) return '';
		// Calculate opacity based on swipe progress
		const progress = Math.min(swipeDeltaX / (window.innerWidth * 0.5), 1);
		return `translate3d(${swipeDeltaX}px, 0, 0)`;
	});

	const swipeOpacity = $derived.by(() => {
		if (!isMobile || !swipeActive || swipeDeltaX <= 0) return 1;
		const progress = Math.min(swipeDeltaX / (window.innerWidth * 0.4), 1);
		return 1 - progress * 0.5;
	});

	// Position persistence functions
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
		customPosition = true;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
		fabSnapStore.setSnapped(FAB_ID, snapped, zoneId);
	}

	function clampToViewport(value: Position): Position {
		if (!browser || !fabEl) return value;
		const rect = fabEl.getBoundingClientRect();
		const maxX = Math.max(MIN_MARGIN, window.innerWidth - rect.width - MIN_MARGIN);
		const maxY = Math.max(MIN_MARGIN, window.innerHeight - rect.height - MIN_MARGIN);
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
		// Do this BEFORE checking fabEl - we need to restore snap state even without element
		const wasSnapped = !$isFabSnappingDisabled && fabSnapStore.isSnappedToRail(FAB_ID);
		const savedZoneId = fabSnapStore.getSnappedZoneId(FAB_ID);
		if (wasSnapped && savedZoneId) {
			// If snapped to a tray slot, stay snapped even if tray isn't in DOM
			// This keeps the FAB hidden when navigating to pages without the tray
			if (savedZoneId.startsWith('fab-tray-slot-')) {
				isSnapped = true;
				snappedZoneId = savedZoneId;
				userClosedTray = true;
				// Don't set position - FAB will be hidden anyway
				ready = true;
				return;
			}
			
			// Wait a bit for zones to be registered
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
				// If restoring snapped state, treat as if user had closed tray (so FAB is hidden until opened)
				userClosedTray = true;
				ready = true;
				return;
			}
		}

		// Need fabEl for position calculations
		if (!fabEl) {
			ready = true;
			return;
		}

		// Load saved position or use default
		const saved = loadSavedPosition();
		if (saved) {
			position = clampToViewport(saved);
			customPosition = true;
		} else {
			const rect = fabEl.getBoundingClientRect();
			// Default: center of screen
			const x = Math.round((window.innerWidth - rect.width) / 2);
			const y = Math.round((window.innerHeight - rect.height) / 2);
			position = clampToViewport({ x, y });
		}
		ready = true;
	}

	// Check if current FAB center is near a snap zone
	function checkNearSnapZone(): SnapZone | null {
		if (!browser) return null;
		
		const fabCenterX = position.x + FAB_SIZE / 2;
		const fabCenterY = position.y + FAB_SIZE / 2;
		
		// Directly query tray slots in DOM - don't check feature flag here
		// The feature flag check happens when the tray opens, not during detection
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

	// Snap to a zone
	function snapToZone(zone: SnapZone) {
		// Calculate snap position: center the FAB on the zone
		const snapX = zone.x + (zone.width - FAB_SIZE) / 2;
		const snapY = zone.y + (zone.height - FAB_SIZE) / 2;
		
		position = clampToViewport({ x: snapX, y: snapY });
		isSnapped = true;
		snappedZoneId = zone.id;
		
		// Also register with the store
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
	
	// Long-press detection for unsnapping
	const HOLD_DURATION_MS = 300; // Hold for 300ms to start unsnap drag
	const DRAG_THRESHOLD = 5; // Minimum pixels to consider it a drag
	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingPointerEvent: PointerEvent | null = null;
	let hasMoved = false; // Track if actual drag movement occurred
	let dragStartPos = { x: 0, y: 0 }; // Track initial position

	// Drag handlers - only for the FAB button itself
	function handlePointerDown(event: PointerEvent) {
		if (!fabBtnEl) return;
		// Only handle if clicking on the FAB button itself
		if (event.target !== fabBtnEl && !fabBtnEl.contains(event.target as Node)) return;
		event.stopPropagation();
		dragStartTime = Date.now();
		hasMoved = false;
		dragStartPos = { x: event.clientX, y: event.clientY };
		dragOffset = {
			x: event.clientX - position.x,
			y: event.clientY - position.y
		};
		fabBtnEl.setPointerCapture(event.pointerId);
		
		// If snapped, require a hold before starting drag (to unsnap)
		if (isSnapped) {
			pendingPointerEvent = event;
			holdTimer = setTimeout(() => {
				// Hold completed - start dragging
				dragging = true;
				
				// Release from snap zone
				fabSnapStore.releaseZone(FAB_ID);
				isSnapped = false;
				snappedZoneId = null;
				
				// Visual feedback - slight scale up
				if (fabBtnEl) {
					fabBtnEl.style.transform = 'scale(1.1)';
					setTimeout(() => {
						if (fabBtnEl) fabBtnEl.style.transform = '';
					}, 150);
				}
			}, HOLD_DURATION_MS);
		} else {
			// Not snapped - mark as dragging but don't dispatch fabDragStart yet
			// Wait for actual movement to exceed threshold
			dragging = true;
		}
	}

	function handlePointerMove(event: PointerEvent) {
		// If holding but not yet dragging, cancel hold if moved too far
		if (holdTimer && !dragging) {
			const dx = event.clientX - (pendingPointerEvent?.clientX ?? 0);
			const dy = event.clientY - (pendingPointerEvent?.clientY ?? 0);
			if (Math.sqrt(dx * dx + dy * dy) > 10) {
				clearTimeout(holdTimer);
				holdTimer = null;
				pendingPointerEvent = null;
			}
			return;
		}
		
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
		}
		
		if (!hasMoved) return; // Don't update position until threshold is exceeded
		
		position = clampToViewport({
			x: event.clientX - dragOffset.x,
			y: event.clientY - dragOffset.y
		});
		
		// Check if near a snap zone and dispatch event for visual feedback
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
		// Track if we had a pending hold (for snapped FAB tap detection)
		const wasHolding = holdTimer !== null;
		
		// Clear hold timer if active
		if (holdTimer) {
			clearTimeout(holdTimer);
			holdTimer = null;
			pendingPointerEvent = null;
		}
		
		// If we weren't dragging (just a tap), handle tap behavior
		if (!dragging) {
			fabBtnEl?.releasePointerCapture(event.pointerId);
			
			// For snapped FAB: tap toggles popover (regardless of tray state - if visible, it's clickable)
			// For un-snapped FAB: tap toggles popover
			if (wasHolding || isSnapped) {
				// This was a tap on a snapped FAB (hold timer didn't complete)
				showPopover = !showPopover;
			} else {
				// Quick tap on un-snapped FAB
				const tapDuration = Date.now() - dragStartTime;
				if (tapDuration < 200) {
					showPopover = !showPopover;
				}
			}
			return;
		}
		
		event.stopPropagation();
		fabBtnEl?.releasePointerCapture(event.pointerId);
		
		// Clear snap zone highlight - only dispatch drag end if we actually moved
		nearSnapZone = null;
		if (hasMoved && browser) {
			window.dispatchEvent(new CustomEvent('fabNearSnapZone', { detail: { zoneId: null } }));
			window.dispatchEvent(new CustomEvent('fabDragEnd', { detail: { fabId: FAB_ID } }));
		}
		
		if (hasMoved) {
			// Check if we should snap to a zone
			let snapZone = checkNearSnapZone();
			if (snapZone) {
				snapToZone(snapZone);
			} else {
				persistPosition(position, false);
			}
		} else {
			// Was a tap (no significant movement) - toggle popover
			showPopover = !showPopover;
		}
		
		dragging = false;
		hasMoved = false;
	}

	function stopTouchPropagation(event: TouchEvent) {
		event.stopPropagation();
	}

	// Handler for snap zone position updates (e.g., when DMs come in)
	function handleSnapZoneUpdated() {
		if (!isSnapped || !snappedZoneId) return;
		const zones = fabSnapStore.getZones();
		const zone = zones.find((z) => z.id === snappedZoneId);
		if (zone) {
			const snapPos = fabSnapStore.getSnapPosition(zone, FAB_SIZE);
			position = clampToViewport(snapPos);
		}
	}

	function handleFabSnapSynced(event: CustomEvent<{ fabIds: string[] }>) {
		if (!event?.detail?.fabIds?.includes(FAB_ID)) return;
		if (dragging) return;
		void initPosition();
	}

	// Calculate unread messages
	function calculateUnread(totalMessages: number, lastReadCount: number | undefined): number {
		if (lastReadCount === undefined) return totalMessages;
		return Math.max(0, totalMessages - lastReadCount);
	}

	// Calculate 24 hours ago
	function get24HoursAgo(): Timestamp {
		const now = new Date();
		now.setHours(now.getHours() - 24);
		return Timestamp.fromDate(now);
	}

	// Subscribe to user's recent threads - simplified query without orderBy
	function subscribeToThreads() {
		if (!browser || !$user?.uid) {
			console.log('[ThreadsFab] Not subscribing - browser:', browser, 'user:', $user?.uid);
			return;
		}

		console.log('[ThreadsFab] Subscribing to threads for user:', $user.uid);
		const db = getDb();
		const uid = $user.uid;

		// Simple query without orderBy to avoid index issues
		const threadsQuery = query(
			collection(db, 'profiles', uid, 'threadMembership')
		);

		threadsUnsub = onSnapshot(
			threadsQuery,
			async (snap) => {
				console.log('[ThreadsFab] Got memberships:', snap.docs.length);
				
				type MembershipData = {
					threadId: string;
					serverId?: string;
					channelId?: string;
					[key: string]: unknown;
				};
				
				const memberships: MembershipData[] = snap.docs.map((d) => {
					const data = d.data();
					console.log('[ThreadsFab] Membership doc:', d.id, data);
					return {
						threadId: d.id,
						serverId: data.serverId as string | undefined,
						channelId: data.channelId as string | undefined,
						...data
					};
				});

				// Fetch full thread data for each membership
				const threads: ThreadWithMeta[] = [];
				const cutoff = get24HoursAgo();

				for (const membership of memberships) {
					const serverId = membership.serverId;
					const channelId = membership.channelId;
					
					if (!serverId || !channelId) {
						console.log('[ThreadsFab] Skipping membership - missing serverId/channelId:', membership);
						continue;
					}

					try {
						const { getDoc, doc } = await import('firebase/firestore');
						const threadRef = doc(
							db,
							'servers',
							serverId,
							'channels',
							channelId,
							'threads',
							membership.threadId
						);
						const threadDoc = await getDoc(threadRef);

						console.log('[ThreadsFab] Thread doc exists:', threadDoc.exists(), 'id:', membership.threadId);

						if (threadDoc.exists()) {
							const data = threadDoc.data();
							console.log('[ThreadsFab] Thread data:', data);
							
							// Include all non-archived threads (relaxed 24h filter for debugging)
							if (data.status !== 'archived') {
								threads.push({
									id: threadDoc.id,
									serverId: data.serverId || serverId,
									channelId: data.channelId || channelId,
									parentChannelId: data.parentChannelId || data.channelId || channelId,
									createdFromMessageId: data.createdFromMessageId,
									createdBy: data.createdBy,
									name: data.name || 'Thread',
									preview: data.preview,
									lastMessagePreview: data.lastMessagePreview,
									createdAt: data.createdAt,
									lastMessageAt: data.lastMessageAt,
									archivedAt: data.archivedAt,
									autoArchiveAt: data.autoArchiveAt,
									memberUids: data.memberUids || [],
									memberCount: data.memberCount || 0,
									maxMembers: data.maxMembers || 20,
									ttlHours: data.ttlHours || 24,
									status: data.status || 'active',
									visibility: data.visibility,
									messageCount: data.messageCount || 0
								});
							}
						}
					} catch (err) {
						console.warn('[ThreadsFab] Error fetching thread:', membership.threadId, err);
					}
				}

				// Sort by lastMessageAt descending
				threads.sort((a, b) => {
					const aTime = a.lastMessageAt?.toMillis?.() ?? 0;
					const bTime = b.lastMessageAt?.toMillis?.() ?? 0;
					return bTime - aTime;
				});

				console.log('[ThreadsFab] Final threads:', threads.length, threads);
				recentThreads = threads;
			},
			(err) => {
				console.error('[ThreadsFab] Error subscribing to threads:', err);
			}
		);
	}

	function closePopover() {
		showPopover = false;
	}

	function handleClickOutside(event: MouseEvent) {
		if (fabEl && !fabEl.contains(event.target as Node)) {
			closePopover();
		}
	}

	function navigateToThread(thread: ThreadWithMeta) {
		console.log('[ThreadsFab] navigateToThread called for:', thread.id, thread.name, 'isOnServerPage:', isOnServerPage);
		// Add current thread to history before navigating
		if (navigationHistory.length === 0 || navigationHistory[navigationHistory.length - 1]?.id !== thread.id) {
			navigationHistory = [...navigationHistory.slice(-9), thread]; // Keep last 10
		}
		closePopover();
		
		// If on server page, dispatch event to let the server page handle it
		// Otherwise, open floating popup directly here
		if (isOnServerPage) {
			console.log('[ThreadsFab] Dispatching openFloatingThread event to server page');
			window.dispatchEvent(new CustomEvent('openFloatingThread', {
				detail: {
					serverId: thread.serverId,
					channelId: thread.parentChannelId,
					threadId: thread.id
				}
			}));
		} else {
			console.log('[ThreadsFab] Opening floating thread popup directly');
			openFloatingThreadPopup(thread);
		}
	}
	
	// Open a floating thread popup (when not on server page)
	async function openFloatingThreadPopup(thread: ThreadWithMeta) {
		try {
			// Close any existing floating thread
			closeFloatingThread();
			
			const db = getDb();
			
			// Fetch the full thread data
			const fullThread = await getThread(thread.serverId, thread.parentChannelId, thread.id);
			if (!fullThread) {
				console.warn('[ThreadsFab] Thread not found:', thread.id);
				return;
			}
			
			// Fetch the root message
			let root = null;
			if (fullThread.createdFromMessageId) {
				try {
					const snap = await getDoc(
						doc(db, 'servers', thread.serverId, 'channels', thread.parentChannelId, 'messages', fullThread.createdFromMessageId)
					);
					if (snap.exists()) {
						const data = snap.data();
						root = {
							id: snap.id,
							uid: data.authorId,
							text: data.text || data.content,
							displayName: data.displayName,
							createdAt: data.createdAt,
							...data
						};
					}
				} catch (err) {
					console.warn('[ThreadsFab] Failed to load root message:', err);
				}
			}
			
			// Calculate initial position (centered)
			const popupWidth = 400;
			const popupHeight = 500;
			const x = Math.max(20, (window.innerWidth - popupWidth) / 2);
			const y = Math.max(20, (window.innerHeight - popupHeight) / 2);
			
			floatingThread = {
				thread: fullThread,
				root,
				messages: [],
				replyTarget: null,
				pendingUploads: [],
				position: { x, y },
				stream: null
			};
			
			// Start streaming messages
			const unsubscribe = streamThreadMessages(
				thread.serverId,
				thread.parentChannelId,
				thread.id,
				(list) => {
					if (floatingThread) {
						floatingThread = { ...floatingThread, messages: list };
						
						// Mark as read
						if ($user?.uid && list.length > 0) {
							const last = list[list.length - 1];
							const at = last?.createdAt ?? null;
							const lastId = last?.id ?? null;
							void markThreadReadThread($user.uid, thread.serverId, thread.parentChannelId, thread.id, {
								at,
								lastMessageId: lastId
							});
						}
					}
				},
				{
					onError: (err) => {
						console.error('[ThreadsFab] Failed to load thread messages:', err);
					}
				}
			);
			
			floatingThread = { ...floatingThread, stream: unsubscribe };
		} catch (err) {
			console.error('[ThreadsFab] Failed to open floating thread:', err);
		}
	}
	
	function closeFloatingThread() {
		if (floatingThread?.stream) {
			floatingThread.stream();
		}
		floatingThread = null;
		floatingThreadProfiles = {};
	}
	
	// Floating thread drag handlers
	function handleFloatingPointerDown(event: PointerEvent) {
		if (!floatingThread) return;
		event.stopPropagation();
		floatingDragOffset = {
			x: event.clientX - floatingThread.position.x,
			y: event.clientY - floatingThread.position.y
		};
		floatingDragPointerId = event.pointerId;
		floatingDragging = true;
		(event.target as HTMLElement).setPointerCapture(event.pointerId);
	}
	
	function handleFloatingPointerMove(event: PointerEvent) {
		if (!floatingDragging || !floatingThread || event.pointerId !== floatingDragPointerId) return;
		event.stopPropagation();
		event.preventDefault();
		const x = Math.max(0, Math.min(window.innerWidth - 400, event.clientX - floatingDragOffset.x));
		const y = Math.max(0, Math.min(window.innerHeight - 100, event.clientY - floatingDragOffset.y));
		floatingThread = { ...floatingThread, position: { x, y } };
	}
	
	function handleFloatingPointerUp(event: PointerEvent) {
		if (!floatingDragging || event.pointerId !== floatingDragPointerId) return;
		event.stopPropagation();
		floatingDragging = false;
		floatingDragPointerId = null;
		(event.target as HTMLElement).releasePointerCapture(event.pointerId);
	}
	
	// Handle sending messages in floating thread
	async function handleFloatingThreadSend(event: CustomEvent<{ text: string; mentions?: any[] }>) {
		if (!floatingThread || !$user?.uid) return;
		
		const { text, mentions } = event.detail;
		const thread = floatingThread.thread;
		
		try {
			await sendThreadMessage({
				serverId: thread.serverId,
				channelId: thread.parentChannelId || thread.channelId,
				threadId: thread.id,
				message: {
					text,
					uid: $user.uid,
					mentions: mentions || []
				}
			});
			
			// Clear reply target after sending
			if (floatingThread?.replyTarget) {
				floatingThread = { ...floatingThread, replyTarget: null };
			}
		} catch (err) {
			console.error('[ThreadsFab] Failed to send message:', err);
		}
	}
	
	function handleFloatingReply(event: CustomEvent<{ message: any }>) {
		if (!floatingThread) return;
		const msg = event.detail?.message;
		if (!msg) return;
		floatingThread = {
			...floatingThread,
			replyTarget: {
				messageId: msg.id,
				authorId: msg.uid || msg.authorId,
				authorName: msg.displayName,
				preview: msg.text?.slice(0, 100) || null
			}
		};
	}
	
	function clearFloatingReplyTarget() {
		if (!floatingThread) return;
		floatingThread = { ...floatingThread, replyTarget: null };
	}

	async function markAllThreadsRead() {
		if (!$user?.uid || !visibleThreads.length) return;
		const tasks = visibleThreads.map((thread) =>
			markThreadReadThread(
				$user.uid,
				thread.serverId,
				thread.parentChannelId || thread.channelId,
				thread.id,
				{ at: thread.lastMessageAt ?? Timestamp.now() }
			)
		);
		await Promise.allSettled(tasks);
	}

	async function clearAllThreadNotifications() {
		if (!visibleThreads.length) return;
		bulkAction = 'clearingNotifications';
		try {
			await markAllThreadsRead();
		} catch (err) {
			console.error('[ThreadsFab] Failed to clear thread notifications:', err);
		} finally {
			bulkAction = 'idle';
		}
	}

	async function clearAllThreads() {
		if (!visibleThreads.length) return;
		bulkAction = 'clearingThreads';
		try {
			await markAllThreadsRead();
			const ids = visibleThreads.map((t) => t.id);
			const nextDismissed = new Set([...dismissedThreadIds, ...ids]);
			dismissedThreadIds = nextDismissed;
			recentThreads = recentThreads.filter((t) => !nextDismissed.has(t.id));
		} catch (err) {
			console.error('[ThreadsFab] Failed to clear threads:', err);
		} finally {
			bulkAction = 'idle';
		}
	}

	function goBackToThread() {
		if (navigationHistory.length > 1) {
			const previous = navigationHistory[navigationHistory.length - 2];
			navigationHistory = navigationHistory.slice(0, -1);
			if (previous) {
				goto(`/servers/${previous.serverId}?channel=${previous.parentChannelId}&thread=${previous.id}`);
			}
		}
	}

	async function dismissThread(thread: ThreadWithMeta, event: MouseEvent) {
		event.stopPropagation();
		dismissedThreadIds = new Set([...dismissedThreadIds, thread.id]);
		recentThreads = recentThreads.filter(t => t.id !== thread.id);
	}

	async function removeFromThread(thread: ThreadWithMeta, event: MouseEvent) {
		event.stopPropagation();
		if (!$user?.uid) return;
		try {
			await leaveThread($user.uid, thread.serverId, thread.parentChannelId, thread.id);
			recentThreads = recentThreads.filter(t => t.id !== thread.id);
		} catch (err) {
			console.error('[ThreadsFab] Error leaving thread:', err);
		}
	}

	function formatTimeAgo(timestamp: Timestamp | undefined): string {
		if (!timestamp) return '';
		const now = Date.now();
		const then = timestamp.toMillis?.() ?? 0;
		const diff = now - then;

		const minutes = Math.floor(diff / 60000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;

		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;

		return 'yesterday';
	}

	// Calculate time remaining until thread expires (24h from last message)
	const EXPIRATION_HOURS = 24;
	
	function getExpirationTime(thread: ThreadWithMeta): number {
		const lastMessage = thread.lastMessageAt?.toMillis?.() ?? thread.createdAt?.toMillis?.() ?? 0;
		const expiresAt = lastMessage + (EXPIRATION_HOURS * 60 * 60 * 1000);
		return expiresAt;
	}
	
	function isThreadExpired(thread: ThreadWithMeta): boolean {
		return Date.now() > getExpirationTime(thread);
	}
	
	function formatTimeRemaining(thread: ThreadWithMeta): string {
		const expiresAt = getExpirationTime(thread);
		const remaining = expiresAt - Date.now();
		
		if (remaining <= 0) return 'expired';
		
		const hours = Math.floor(remaining / (60 * 60 * 1000));
		const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
		
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	}
	
	// Reactive timestamp that updates every minute for expiration display
	let now = $state(Date.now());
	let expirationInterval: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		console.log('[ThreadsFab] onMount called, browser:', browser);
		if (!browser) {
			ready = true;
			return;
		}

		// Register this FAB with the snap store so tray knows how many slots to show
		fabSnapStore.registerFab({
			id: FAB_ID,
			label: 'Threads',
			icon: 'bx-message-square-dots'
		});

		// Initialize position (handles snapped state restoration)
		initPosition();
		console.log('[ThreadsFab] Position initialized');

		// Subscribe to threads
		subscribeToThreads();

		// Handle clicks outside
		document.addEventListener('click', handleClickOutside);

		// Handle resize
		const handleResize = () => {
			position = clampToViewport(position);
		};
		window.addEventListener('resize', handleResize);
		
		// Listen for snap zone position updates
		window.addEventListener('fabSnapZoneUpdated', handleSnapZoneUpdated);
		window.addEventListener('fabSnapStateSynced', handleFabSnapSynced as EventListener);
		
		// Listen for tray state changes (to hide FAB when snapped and tray is closed)
		const handleTrayStateChange = (e: CustomEvent<{ open: boolean; userAction?: boolean }>) => {
			const wasOpen = trayOpen;
			trayOpen = e.detail.open;
			
			// Track if user explicitly closed the tray (for hiding snapped FABs)
			if (wasOpen && !trayOpen) {
				// Tray is closing - if there's a userAction flag or it's from toggle button, mark as user-closed
				userClosedTray = true;
			} else if (!wasOpen && trayOpen) {
				// Tray is opening - reset the user closed flag
				userClosedTray = false;
			}
			
			// When tray opens and FAB is snapped, update position to match current slot position
			if (trayOpen && isSnapped && snappedZoneId?.startsWith('fab-tray-slot-')) {
				// Small delay to let tray animation complete
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
		};
		window.addEventListener('fabTrayStateChange', handleTrayStateChange as EventListener);
		
		// Update expiration times every minute
		expirationInterval = setInterval(() => {
			now = Date.now();
		}, 60000);

		return () => {
			document.removeEventListener('click', handleClickOutside);
			window.removeEventListener('resize', handleResize);
			window.removeEventListener('fabSnapZoneUpdated', handleSnapZoneUpdated);
			window.removeEventListener('fabSnapStateSynced', handleFabSnapSynced as EventListener);
			window.removeEventListener('fabTrayStateChange', handleTrayStateChange as EventListener);
		};
	});

	onDestroy(() => {
		threadsUnsub?.();
		if (expirationInterval) clearInterval(expirationInterval);
		// Unregister FAB from snap store
		fabSnapStore.unregisterFab(FAB_ID);
	});

	// Re-subscribe when user changes
	$effect(() => {
		if ($user?.uid) {
			threadsUnsub?.();
			subscribeToThreads();
		}
	});

	// Auto-dismiss expired threads (removes them from the bubble permanently until new activity)
	$effect(() => {
		const _ = now; // React to time updates
		const expiredIds = recentThreads
			.filter(t => isThreadExpired(t) && !dismissedThreadIds.has(t.id))
			.map(t => t.id);
		
		if (expiredIds.length > 0) {
			dismissedThreadIds = new Set([...dismissedThreadIds, ...expiredIds]);
		}
	});

	const visibleThreads = $derived.by(() => {
		// Trigger reactivity on `now` to refresh expiration checks
		const _ = now;
		return recentThreads.filter(t => !dismissedThreadIds.has(t.id) && !isThreadExpired(t));
	});
	const filteredThreads = $derived.by(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return visibleThreads;
		return visibleThreads.filter((thread) => {
			const haystack = [
				thread.name,
				thread.serverName,
				thread.channelName,
				thread.lastMessagePreview
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();
			return haystack.includes(query);
		});
	});
	const hasThreads = $derived(visibleThreads.length > 0);
	// Use notification store for total unread - this tracks real-time thread message counts
	const totalUnread = $derived($threadUnreadCount);
	// Get per-thread unreads from notification store
	const threadUnreads = $derived($threadUnreadById);
	const canGoBack = $derived(navigationHistory.length > 1);
	const popoverSubtitle = $derived.by(() => {
		const query = searchQuery.trim();
		if (query) {
			return `${filteredThreads.length} match${filteredThreads.length === 1 ? '' : 'es'}`;
		}
		return `${visibleThreads.length} active`;
	});
	const bulkBusy = $derived(bulkAction !== 'idle');
	
	// Compute popover position based on FAB location
	const popoverPosition = $derived.by(() => {
		if (!browser) return { vertical: 'above', horizontal: 'center' };
		const vh = window.innerHeight;
		const vw = window.innerWidth;
		const fabSize = FAB_SIZE;
		const popoverHeight = 400;
		const popoverWidth = 320;
		
		// Determine vertical position
		const spaceAbove = position.y;
		const spaceBelow = vh - position.y - fabSize;
		const vertical = spaceBelow > popoverHeight + 20 ? 'below' : 
		                 spaceAbove > popoverHeight + 20 ? 'above' : 
		                 spaceBelow > spaceAbove ? 'below' : 'above';
		
		// Determine horizontal position
		const fabCenterX = position.x + fabSize / 2;
		const horizontal = fabCenterX < popoverWidth / 2 + 20 ? 'left' :
		                   fabCenterX > vw - popoverWidth / 2 - 20 ? 'right' : 'center';
		
		return { vertical, horizontal };
	});
</script>

<div
	class="threads-fab-wrapper"
	class:threads-fab-wrapper--snapped={isSnapped}
	class:threads-fab-wrapper--hidden={hiddenInTray}
	bind:this={fabEl}
	data-ready={ready}
	data-dragging={dragging}
	style="transform: translate3d({position.x}px, {position.y}px, 0);"
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerUp}
	ontouchstart={stopTouchPropagation}
	ontouchmove={stopTouchPropagation}
	ontouchend={stopTouchPropagation}
	ontouchcancel={stopTouchPropagation}
>
	<button
		type="button"
		class="threads-fab"
		class:threads-fab--active={showPopover}
		class:threads-fab--empty={!hasThreads}
		class:threads-fab--snapped={isSnapped}
		aria-label="Recent Threads"
		title={hasThreads ? `${totalUnread} unread in ${visibleThreads.length} threads` : 'No recent threads'}
		bind:this={fabBtnEl}
	>
		<i class="bx bx-message-square-dots" aria-hidden="true"></i>
		{#if totalUnread > 0}
			<span class="threads-fab__badge">{totalUnread > 99 ? '99+' : totalUnread}</span>
		{/if}
	</button>

	{#if showPopover}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div 
			class="threads-popover" 
			data-vertical={popoverPosition.vertical}
			data-horizontal={popoverPosition.horizontal}
			onclick={(e) => e.stopPropagation()}
		>
			<div class="threads-popover__header">
				<div class="threads-popover__header-left">
					{#if canGoBack}
						<button
							type="button"
							class="threads-popover__back-btn"
							onclick={goBackToThread}
							title="Go back to previous thread"
						>
							<i class="bx bx-arrow-back" aria-hidden="true"></i>
						</button>
					{/if}
					<h3>Recent Threads</h3>
					<span class="threads-popover__subtitle">{popoverSubtitle}</span>
				</div>
				<button
					type="button"
					class="threads-popover__close-btn"
					onclick={closePopover}
					title="Close"
				>
					<i class="bx bx-x" aria-hidden="true"></i>
				</button>
			</div>

			<div class="threads-popover__actions">
				<button
					type="button"
					class="threads-popover__action-btn threads-popover__action-btn--primary"
					onclick={clearAllThreadNotifications}
					disabled={!hasThreads || bulkBusy}
					title="Mark all thread notifications as read"
				>
					<i class="bx bx-bell-off" aria-hidden="true"></i>
					<span>
						{bulkAction === 'clearingNotifications' ? 'Clearing...' : 'Clear notifications'}
					</span>
				</button>
				<button
					type="button"
					class="threads-popover__action-btn threads-popover__action-btn--danger"
					onclick={clearAllThreads}
					disabled={!hasThreads || bulkBusy}
					title="Dismiss all threads from this list"
				>
					<i class="bx bx-message-square-x" aria-hidden="true"></i>
					<span>{bulkAction === 'clearingThreads' ? 'Clearing...' : 'Clear threads'}</span>
				</button>
			</div>

			<div class="threads-popover__search">
				<i class="bx bx-search" aria-hidden="true"></i>
				<input
					type="search"
					placeholder="Search DMs and threads"
					bind:value={searchQuery}
					aria-label="Search direct messages"
				/>
				{#if searchQuery}
					<button
						type="button"
						class="threads-popover__clear-btn"
						onclick={() => (searchQuery = '')}
						title="Clear search"
					>
						<i class="bx bx-x" aria-hidden="true"></i>
					</button>
				{/if}
			</div>

			<div class="threads-popover__list">
				{#each filteredThreads as thread (thread.id)}
					{@const unreadCount = threadUnreads[thread.id] || 0}
					<div class="thread-item" class:thread-item--unread={unreadCount > 0}>
						<button
							type="button"
							class="thread-item__main"
							onclick={() => navigateToThread(thread)}
							title="Go to thread in channel"
						>
							<div class="thread-item__icon">
								<i class="bx bx-message-square-dots" aria-hidden="true"></i>
								{#if unreadCount > 0}
									<span class="thread-item__unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
								{/if}
							</div>
							<div class="thread-item__content">
								<span class="thread-item__name">{thread.name || 'Thread'}</span>
								{#if thread.lastMessagePreview}
									<span class="thread-item__preview">{thread.lastMessagePreview}</span>
								{/if}
							<div class="thread-item__meta-row">
								<span class="thread-item__meta">
									{thread.memberCount} members · {formatTimeAgo(thread.lastMessageAt)}
								</span>
								<span class="thread-item__expires">
									<i class="bx bx-time" aria-hidden="true"></i>
									{formatTimeRemaining(thread)}
								</span>
							</div>
							</div>
						</button>
						<div class="thread-item__actions">
							<button
								type="button"
								class="thread-item__action-btn thread-item__action-btn--dismiss"
								onclick={(e) => dismissThread(thread, e)}
								title="Dismiss from list"
							>
								<i class="bx bx-x" aria-hidden="true"></i>
							</button>
						</div>
					</div>
				{:else}
					<div class="threads-popover__empty">
						<i class="bx bx-message-square-x" aria-hidden="true"></i>
						{#if searchQuery}
							<span>No conversations match your search</span>
						{:else}
							<span>No recent threads</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<!-- Floating Thread Popup (for when not on server page) -->
{#if floatingThread}
	{@const thread = floatingThread.thread}
	<!-- Backdrop to capture touches and prevent interaction with elements behind -->
	{#if isMobile}
		<div 
			class="floating-thread-backdrop"
			ontouchstart={(e) => { e.stopPropagation(); closeFloatingThread(); }}
			ontouchmove={(e) => e.stopPropagation()}
			ontouchend={(e) => e.stopPropagation()}
			role="button"
			tabindex="-1"
			aria-label="Close thread"
		></div>
	{/if}
	<div
		class="floating-thread-popup"
		class:floating-thread-popup--mobile={isMobile}
		class:floating-thread-popup--swiping={swipeActive}
		style={isMobile 
			? `transform: ${swipeTransform}; opacity: ${swipeOpacity};` 
			: `left: ${floatingThread.position.x}px; top: ${floatingThread.position.y}px;`}
		ontouchstart={isMobile ? handleSwipeTouchStart : undefined}
		ontouchmove={isMobile ? handleSwipeTouchMove : undefined}
		ontouchend={isMobile ? handleSwipeTouchEnd : undefined}
		ontouchcancel={isMobile ? handleSwipeTouchEnd : undefined}
	>
		{#if isMobile}
			<!-- Swipe indicator pill -->
			<div class="floating-thread-popup__swipe-indicator">
				<div class="floating-thread-popup__swipe-pill"></div>
			</div>
		{/if}
		<div
			class="floating-thread-popup__header"
			onpointerdown={isMobile ? undefined : handleFloatingPointerDown}
			onpointermove={isMobile ? undefined : handleFloatingPointerMove}
			onpointerup={isMobile ? undefined : handleFloatingPointerUp}
			role="button"
			tabindex="0"
		>
			<div class="floating-thread-popup__header-left">
				<i class="bx bx-conversation" aria-hidden="true"></i>
				<span class="floating-thread-popup__title">{thread.name || 'Thread'}</span>
			</div>
			<button
				type="button"
				class="floating-thread-popup__close-btn"
				onclick={closeFloatingThread}
				title="Close thread"
			>
				<i class="bx bx-x" aria-hidden="true"></i>
			</button>
		</div>
		
		{#if floatingThread.root}
			<div class="floating-thread-popup__root">
				<div class="floating-thread-popup__root-author">
					{floatingThread.root.displayName || 'Unknown'}
				</div>
				<div class="floating-thread-popup__root-text">
					{floatingThread.root.text || ''}
				</div>
			</div>
		{/if}
		
		<div class="floating-thread-popup__messages">
			<MessageList
				messages={floatingThread.messages as any}
				currentUserId={$user?.uid ?? ''}
				users={floatingThreadProfiles}
				on:reply={handleFloatingReply}
			/>
		</div>
		
		{#if floatingThread.replyTarget}
			<div class="floating-thread-popup__reply-bar">
				<span class="floating-thread-popup__reply-label">
					Replying to <strong>{floatingThread.replyTarget.authorName}</strong>
				</span>
				<button
					type="button"
					class="floating-thread-popup__reply-cancel"
					onclick={clearFloatingReplyTarget}
					title="Cancel reply"
				>
					<i class="bx bx-x" aria-hidden="true"></i>
				</button>
			</div>
		{/if}
		
		<div class="floating-thread-popup__input">
			<ChatInput
				placeholder="Reply in thread..."
				suppressDockOnFocus={false}
				on:send={handleFloatingThreadSend}
			/>
		</div>
	</div>
{/if}

<style>
	.threads-fab-wrapper {
		position: fixed;
		left: 0;
		top: 0;
		z-index: 64;
		touch-action: none;
		--floating-fab-size: 3.1rem;
		--floating-fab-snapped-size: 3rem;
	}
	
	/* When snapped, increase z-index to appear above tray content */
	.threads-fab-wrapper--snapped {
		z-index: 100;
	}

	.threads-fab-wrapper[data-ready='false'] {
		opacity: 0;
		pointer-events: none;
	}

	.threads-fab-wrapper[data-dragging='true'] {
		cursor: grabbing;
		z-index: 110; /* Even higher when dragging */
	}
	
	/* Hide FAB when it's snapped to tray and tray is closed */
	.threads-fab-wrapper--hidden {
		opacity: 0;
		pointer-events: none;
		visibility: hidden;
	}

	.threads-fab {
		width: var(--floating-fab-size);
		height: var(--floating-fab-size);
		border-radius: 999px;
		border: 1px solid rgba(168, 85, 247, 0.65);
		background: linear-gradient(135deg, rgba(168, 85, 247, 0.98), rgba(139, 92, 246, 0.92));
		box-shadow: 0 14px 26px rgba(139, 92, 246, 0.32);
		color: #f8fafc;
		display: grid;
		place-items: center;
		font-size: 1.2rem;
		cursor: grab;
		transition:
			transform 180ms cubic-bezier(0.2, 0.65, 0.25, 1),
			box-shadow 180ms ease;
		position: relative;
	}
	
	/* Snapped FAB styling - smaller to fit in tray slot */
	.threads-fab--snapped {
		width: var(--floating-fab-snapped-size);
		height: var(--floating-fab-snapped-size);
		cursor: pointer;
		box-shadow: 0 0 0 2px var(--color-accent, #a855f7);
	}
	
	/* Hint that hold is needed to drag out */
	.threads-fab--snapped:active {
		cursor: grabbing;
		transform: scale(0.95);
	}

	.threads-fab:hover,
	.threads-fab:focus-visible,
	.threads-fab--active {
		transform: translateY(-2px);
		box-shadow: 0 18px 32px rgba(139, 92, 246, 0.45);
		outline: none;
	}
	
	/* Snapped FAB hover - don't translate, just glow */
	.threads-fab--snapped:hover {
		transform: scale(1.05);
		box-shadow: 0 0 20px rgba(139, 92, 246, 0.6);
	}

	.threads-fab--empty {
		opacity: 0.5;
		background: linear-gradient(135deg, rgba(100, 100, 120, 0.8), rgba(80, 80, 100, 0.75));
		border-color: rgba(100, 100, 120, 0.5);
		box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
	}

	.threads-fab--empty:hover {
		opacity: 0.7;
	}

	.threads-fab__badge {
		position: absolute;
		top: -4px;
		right: -4px;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 999px;
		background: #ef4444;
		color: white;
		font-size: 0.65rem;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--panel-bg, #1e1e2e);
	}

	.threads-popover {
		position: absolute;
		width: 320px;
		max-height: min(400px, 70vh);
		background: var(--panel-bg, #1e1e2e);
		border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
		border-radius: 12px;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		z-index: 100;
	}

	/* Vertical positioning */
	.threads-popover[data-vertical='above'] {
		bottom: calc(100% + 12px);
		top: auto;
	}

	.threads-popover[data-vertical='below'] {
		top: calc(100% + 12px);
		bottom: auto;
	}

	/* Horizontal positioning */
	.threads-popover[data-horizontal='center'] {
		left: 50%;
		right: auto;
		transform: translateX(-50%);
	}

	.threads-popover[data-horizontal='left'] {
		left: 0;
		right: auto;
		transform: none;
	}

	.threads-popover[data-horizontal='right'] {
		right: 0;
		left: auto;
		transform: none;
	}

	.threads-popover__header {
		padding: 10px 12px;
		border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.threads-popover__header-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.threads-popover__header h3 {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary, #f8fafc);
	}

	.threads-popover__subtitle {
		font-size: 0.7rem;
		color: var(--text-muted, rgba(255, 255, 255, 0.5));
		background: rgba(255, 255, 255, 0.1);
		padding: 2px 6px;
		border-radius: 4px;
	}

	.threads-popover__back-btn,
	.threads-popover__close-btn {
		width: 26px;
		height: 26px;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: var(--text-muted, rgba(255, 255, 255, 0.5));
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.1rem;
		transition: all 150ms ease;
	}

	.threads-popover__back-btn:hover {
		background: rgba(168, 85, 247, 0.2);
		color: rgb(168, 85, 247);
	}

	.threads-popover__close-btn:hover {
		background: rgba(239, 68, 68, 0.2);
		color: rgb(239, 68, 68);
	}

	.threads-popover__list {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
	}

	.threads-popover__actions {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 8px;
		padding: 8px 12px 10px;
		border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent);
	}

	.threads-popover__action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border-radius: 6px;
		border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
		background: rgba(255, 255, 255, 0.04);
		color: var(--text-primary, #f8fafc);
		padding: 6px 8px;
		min-height: 32px;
		font-size: 0.78rem;
		line-height: 1.1;
		font-weight: 600;
		cursor: pointer;
		transition:
			transform 120ms ease,
			box-shadow 150ms ease,
			background 150ms ease,
			border-color 150ms ease,
			color 150ms ease;
	}

	.threads-popover__action-btn:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 8px 14px rgba(0, 0, 0, 0.25);
	}

	.threads-popover__action-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.threads-popover__action-btn--primary {
		background: linear-gradient(135deg, rgba(168, 85, 247, 0.35), rgba(139, 92, 246, 0.32));
		border-color: rgba(168, 85, 247, 0.45);
		box-shadow: 0 10px 22px rgba(139, 92, 246, 0.25);
	}

	.threads-popover__action-btn--primary:hover:not(:disabled) {
		background: linear-gradient(135deg, rgba(168, 85, 247, 0.5), rgba(139, 92, 246, 0.48));
	}

	.threads-popover__action-btn--danger {
		background: linear-gradient(135deg, rgba(239, 68, 68, 0.16), rgba(239, 68, 68, 0.14));
		border-color: rgba(239, 68, 68, 0.4);
	}

	.threads-popover__action-btn--danger:hover:not(:disabled) {
		background: linear-gradient(135deg, rgba(239, 68, 68, 0.26), rgba(239, 68, 68, 0.2));
		color: #fecaca;
	}

	.threads-popover__search {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent);
		position: sticky;
		top: 0;
		z-index: 2;
	}

	.threads-popover__search input {
		flex: 1;
		height: 36px;
		border-radius: 8px;
		border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.14));
		background: rgba(255, 255, 255, 0.04);
		color: var(--text-primary, #f8fafc);
		padding: 0 10px;
		font-size: 0.85rem;
		outline: none;
		transition:
			border-color 150ms ease,
			box-shadow 150ms ease,
			background 150ms ease;
	}

	.threads-popover__search input:focus {
		border-color: rgba(168, 85, 247, 0.6);
		box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.16);
		background: rgba(255, 255, 255, 0.06);
	}

	.threads-popover__search i {
		color: var(--text-muted, rgba(255, 255, 255, 0.5));
	}

	.threads-popover__clear-btn {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		border: none;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 6px;
		color: var(--text-muted, rgba(255, 255, 255, 0.5));
		cursor: pointer;
		transition:
			background 150ms ease,
			color 150ms ease;
	}

	.threads-popover__clear-btn:hover {
		background: rgba(239, 68, 68, 0.16);
		color: rgb(239, 68, 68);
	}

	.thread-item {
		display: flex;
		align-items: stretch;
		gap: 4px;
		border-radius: 8px;
		transition: background 150ms ease;
	}

	.thread-item:hover {
		background: var(--hover-bg, rgba(255, 255, 255, 0.05));
	}

	.thread-item--unread {
		background: rgba(168, 85, 247, 0.08);
	}

	.thread-item--unread:hover {
		background: rgba(168, 85, 247, 0.15);
	}

	.thread-item__main {
		flex: 1;
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		color: inherit;
		min-width: 0;
	}

	.thread-item__icon {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		background: rgba(168, 85, 247, 0.2);
		color: rgb(168, 85, 247);
		display: grid;
		place-items: center;
		font-size: 1rem;
		flex-shrink: 0;
		position: relative;
	}

	.thread-item__unread-badge {
		position: absolute;
		top: -4px;
		right: -4px;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		border-radius: 999px;
		background: #ef4444;
		color: white;
		font-size: 0.6rem;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--panel-bg, #1e1e2e);
	}

	.thread-item__content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.thread-item__name {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-primary, #f8fafc);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.thread-item__preview {
		font-size: 0.75rem;
		color: var(--text-muted, rgba(255, 255, 255, 0.5));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.thread-item__meta {
		font-size: 0.7rem;
		color: var(--text-muted, rgba(255, 255, 255, 0.4));
	}

	.thread-item__meta-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.thread-item__expires {
		display: flex;
		align-items: center;
		gap: 3px;
		font-size: 0.65rem;
		color: var(--text-muted, rgba(255, 255, 255, 0.35));
		white-space: nowrap;
	}

	.thread-item__expires i {
		font-size: 0.7rem;
	}

	.thread-item__actions {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 4px 4px 4px 0;
	}

	.thread-item__action-btn {
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		color: var(--text-muted, rgba(255, 255, 255, 0.4));
		cursor: pointer;
		border-radius: 4px;
		font-size: 0.9rem;
		transition:
			background 150ms ease,
			color 150ms ease;
	}

	.thread-item__action-btn:hover {
		background: rgba(168, 85, 247, 0.2);
		color: rgb(168, 85, 247);
	}

	.thread-item__action-btn--dismiss:hover {
		background: rgba(239, 68, 68, 0.2);
		color: rgb(239, 68, 68);
	}

	.threads-popover__empty {
		padding: 32px 16px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		color: var(--text-muted, rgba(255, 255, 255, 0.4));
	}

	.threads-popover__empty i {
		font-size: 2rem;
		opacity: 0.5;
	}

	.threads-popover__empty span {
		font-size: 0.85rem;
	}

	/* Snap states */
	.threads-fab-wrapper--snapped {
		transition: transform 200ms ease-out;
	}

	@media (max-width: 767px) {
		.threads-fab-wrapper {
			--floating-fab-size: 3rem;
			--floating-fab-snapped-size: 3rem;
		}
	}

	@media (max-width: 640px) {
		.threads-popover {
			width: min(360px, calc(100vw - 24px));
			max-height: calc(100vh - 140px);
		}

		.threads-popover__header h3 {
			font-size: 0.95rem;
		}

		.threads-popover__subtitle {
			font-size: 0.72rem;
		}

		.thread-item__main {
			padding: 12px 10px;
		}

		.thread-item__meta-row {
			flex-direction: column;
			align-items: flex-start;
		}
	}

	/* Floating Thread Backdrop - captures touches on mobile */
	.floating-thread-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 99999;
		touch-action: none;
	}

	/* Floating Thread Popup Styles */
	.floating-thread-popup {
		position: fixed;
		width: 400px;
		max-width: calc(100vw - 32px);
		height: 500px;
		max-height: calc(100vh - 100px);
		background: var(--panel-bg, #1e1e2e);
		border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
		border-radius: 12px;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
		display: flex;
		flex-direction: column;
		z-index: 100000;
		overflow: hidden;
		touch-action: pan-y;
	}

	.floating-thread-popup__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
		background: linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(139, 92, 246, 0.1));
		border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
		cursor: grab;
		user-select: none;
		touch-action: none;
	}

	.floating-thread-popup__header:active {
		cursor: grabbing;
	}

	.floating-thread-popup__header-left {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--text-primary, #f8fafc);
	}

	.floating-thread-popup__header-left i {
		font-size: 1.1rem;
		color: rgb(168, 85, 247);
	}

	.floating-thread-popup__title {
		font-size: 0.9rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 280px;
	}

	.floating-thread-popup__close-btn {
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: var(--text-muted, rgba(255, 255, 255, 0.5));
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.3rem;
		transition: background 150ms ease, color 150ms ease;
	}

	.floating-thread-popup__close-btn:hover {
		background: rgba(239, 68, 68, 0.2);
		color: rgb(239, 68, 68);
	}

	.floating-thread-popup__root {
		padding: 10px 12px;
		background: rgba(0, 0, 0, 0.2);
		border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
	}

	.floating-thread-popup__root-author {
		font-size: 0.8rem;
		font-weight: 600;
		color: rgb(168, 85, 247);
		margin-bottom: 4px;
	}

	.floating-thread-popup__root-text {
		font-size: 0.85rem;
		color: var(--text-secondary, rgba(255, 255, 255, 0.7));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.floating-thread-popup__messages {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.floating-thread-popup__reply-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: rgba(168, 85, 247, 0.1);
		border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
		font-size: 0.8rem;
		color: var(--text-muted, rgba(255, 255, 255, 0.6));
	}

	.floating-thread-popup__reply-label strong {
		color: rgb(168, 85, 247);
	}

	.floating-thread-popup__reply-cancel {
		width: 22px;
		height: 22px;
		border-radius: 4px;
		border: none;
		background: transparent;
		color: var(--text-muted, rgba(255, 255, 255, 0.5));
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.1rem;
		transition: background 150ms ease, color 150ms ease;
	}

	.floating-thread-popup__reply-cancel:hover {
		background: rgba(239, 68, 68, 0.2);
		color: rgb(239, 68, 68);
	}

	.floating-thread-popup__input {
		border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
		background: rgba(0, 0, 0, 0.1);
		flex-shrink: 0;
		min-height: 56px;
		display: block !important;
	}

	/* Ensure ChatInput renders inside the container */
	.floating-thread-popup__input :global(.chat-input-root) {
		display: flex !important;
		flex-direction: column;
		position: relative;
	}

	/* Mobile fullscreen mode */
	.floating-thread-popup--mobile {
		position: fixed;
		inset: 0;
		width: 100vw;
		max-width: 100vw;
		height: 100vh;
		max-height: 100vh;
		border-radius: 0;
		z-index: 100000;
		transition: transform 200ms ease-out, opacity 200ms ease-out;
		will-change: transform, opacity;
		touch-action: pan-y;
		/* Prevent any background interaction */
		isolation: isolate;
	}

	.floating-thread-popup--mobile.floating-thread-popup--swiping {
		transition: none;
		touch-action: none;
	}

	/* Swipe indicator pill at top of mobile popup */
	.floating-thread-popup__swipe-indicator {
		display: none;
	}

	.floating-thread-popup--mobile .floating-thread-popup__swipe-indicator {
		display: flex;
		justify-content: center;
		padding: 8px 0 4px;
		background: linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(139, 92, 246, 0.1));
	}

	.floating-thread-popup__swipe-pill {
		width: 36px;
		height: 4px;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.3);
	}

	.floating-thread-popup--mobile .floating-thread-popup__header {
		cursor: default;
		padding: 12px 16px;
		padding-top: max(12px, env(safe-area-inset-top));
	}

	.floating-thread-popup--mobile .floating-thread-popup__title {
		max-width: none;
		font-size: 1rem;
	}

	.floating-thread-popup--mobile .floating-thread-popup__close-btn {
		width: 36px;
		height: 36px;
		font-size: 1.5rem;
	}

	.floating-thread-popup--mobile .floating-thread-popup__input {
		padding-bottom: max(12px, env(safe-area-inset-bottom));
		background: var(--color-panel, rgba(30, 31, 34, 1));
	}

	/* CSS media query fallback for mobile - ensures mobile styles apply even if JS isMobile fails */
	@media (max-width: 768px) {
		.floating-thread-popup {
			position: fixed !important;
			top: 0 !important;
			left: 0 !important;
			right: 0 !important;
			bottom: 0 !important;
			width: 100vw !important;
			max-width: 100vw !important;
			height: 100vh !important;
			max-height: 100vh !important;
			border-radius: 0 !important;
			z-index: 100000 !important;
			display: flex !important;
			flex-direction: column !important;
			transform: none !important;
		}

		.floating-thread-popup .floating-thread-popup__header {
			cursor: default;
			padding: 12px 16px;
			padding-top: max(12px, env(safe-area-inset-top));
			flex-shrink: 0;
		}
		
		.floating-thread-popup .floating-thread-popup__root {
			flex-shrink: 0;
		}

		.floating-thread-popup .floating-thread-popup__title {
			max-width: none;
			font-size: 1rem;
		}

		.floating-thread-popup .floating-thread-popup__close-btn {
			width: 36px;
			height: 36px;
			font-size: 1.5rem;
		}
		
		.floating-thread-popup .floating-thread-popup__messages {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
		}

		.floating-thread-popup .floating-thread-popup__input {
			flex-shrink: 0;
			min-height: 60px;
			padding: 8px 12px;
			padding-bottom: max(12px, env(safe-area-inset-bottom));
			background: var(--color-panel, rgba(30, 31, 34, 1));
			border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
		}
		
		/* Ensure ChatInput inside the floating popup is visible */
		.floating-thread-popup .floating-thread-popup__input :global(.chat-input-root) {
			display: block !important;
		}

		/* Force hide mobile dock when floating popup is visible */
		:global(.mobile-dock) {
			display: none !important;
		}
	}

	/* Also target specific mobile dock component when popup exists */
	.floating-thread-popup ~ :global(.mobile-dock),
	:global(body:has(.floating-thread-popup) .mobile-dock) {
		display: none !important;
	}
</style>
