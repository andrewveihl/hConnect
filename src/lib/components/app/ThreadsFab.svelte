<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy, tick } from 'svelte';
	import { user } from '$lib/stores/user';
	import { getDb } from '$lib/firebase';
	import {
		collection,
		query,
		onSnapshot,
		Timestamp,
		type Unsubscribe
	} from 'firebase/firestore';
	import type { ChannelThread } from '$lib/firestore/threads';
	import { leaveThread } from '$lib/firestore/threads';
	import { threadUnreadCount, threadUnreadById } from '$lib/stores/notifications';
	import { fabSnapStore, isFabSnappingDisabled, type SnapZone } from '$lib/stores/fabSnap';

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

	type Position = { x: number; y: number };

	let fabEl = $state<HTMLDivElement | null>(null);
	let fabBtnEl = $state<HTMLButtonElement | null>(null);
	let position = $state<Position>({ x: 0, y: 0 });
	let customPosition = $state(false);
	let ready = $state(false);
	let dragging = $state(false);
	let dragOffset: Position = { x: 0, y: 0 };
	let dragStartTime = 0;
	let isSnapped = $state(false);
	let snappedZoneId: string | null = $state(null);
	let nearSnapZone: SnapZone | null = $state(null);

	let showPopover = $state(false);
	let recentThreads = $state<ThreadWithMeta[]>([]);
	let threadsUnsub: Unsubscribe | null = null;
	let navigationHistory = $state<ThreadWithMeta[]>([]);
	let dismissedThreadIds = $state<Set<string>>(new Set());

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
		if (!browser || !fabEl) {
			ready = true;
			return;
		}
		await tick();

		// Check if we were snapped to a zone (only if snapping is enabled)
		const wasSnapped = !$isFabSnappingDisabled && fabSnapStore.isSnappedToRail(FAB_ID);
		const savedZoneId = fabSnapStore.getSnappedZoneId(FAB_ID);
		if (wasSnapped && savedZoneId) {
			// Wait a bit for zones to be registered
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
		if (!browser || $isFabSnappingDisabled) return null;
		const fabCenterX = position.x + FAB_SIZE / 2;
		const fabCenterY = position.y + FAB_SIZE / 2;
		return fabSnapStore.findSnapZone(fabCenterX, fabCenterY, FAB_ID);
	}

	// Snap to a zone
	function snapToZone(zone: SnapZone) {
		const snapPos = fabSnapStore.getSnapPosition(zone, FAB_SIZE);
		position = clampToViewport(snapPos);
		isSnapped = true;
		snappedZoneId = zone.id;
		fabSnapStore.occupyZone(zone.id, FAB_ID);
		persistPosition(position, true, zone.id);
	}

	// Drag handlers - only for the FAB button itself
	function handlePointerDown(event: PointerEvent) {
		if (!fabBtnEl) return;
		// Only handle if clicking on the FAB button itself
		if (event.target !== fabBtnEl && !fabBtnEl.contains(event.target as Node)) return;
		event.stopPropagation();
		dragStartTime = Date.now();
		dragOffset = {
			x: event.clientX - position.x,
			y: event.clientY - position.y
		};
		fabBtnEl.setPointerCapture(event.pointerId);
		dragging = true;
		
		// Release from snap zone when starting to drag
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
		if (!dragging) return;
		event.stopPropagation();
		fabBtnEl?.releasePointerCapture(event.pointerId);
		
		const dragDuration = Date.now() - dragStartTime;
		const wasDrag = dragDuration > 200;
		
		console.log('[ThreadsFab] handlePointerUp - dragDuration:', dragDuration, 'wasDrag:', wasDrag);
		
		// Clear snap zone highlight
		nearSnapZone = null;
		if (browser) {
			window.dispatchEvent(new CustomEvent('fabNearSnapZone', { detail: { zoneId: null } }));
		}
		
		if (wasDrag) {
			// Check if we should snap to a zone
			const snapZone = checkNearSnapZone();
			if (snapZone) {
				snapToZone(snapZone);
			} else {
				persistPosition(position, false);
			}
		}
		dragging = false;
		
		// If it was a quick tap (not a drag), toggle the popover
		if (!wasDrag) {
			console.log('[ThreadsFab] Toggling popover, current:', showPopover, 'new:', !showPopover);
			showPopover = !showPopover;
		}
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
		console.log('[ThreadsFab] navigateToThread called for:', thread.id, thread.name);
		// Add current thread to history before navigating
		if (navigationHistory.length === 0 || navigationHistory[navigationHistory.length - 1]?.id !== thread.id) {
			navigationHistory = [...navigationHistory.slice(-9), thread]; // Keep last 10
		}
		closePopover();
		
		// Dispatch event to open the floating thread popup
		console.log('[ThreadsFab] Dispatching openFloatingThread event');
		window.dispatchEvent(new CustomEvent('openFloatingThread', {
			detail: {
				serverId: thread.serverId,
				channelId: thread.parentChannelId,
				threadId: thread.id
			}
		}));
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
		
		// Update expiration times every minute
		expirationInterval = setInterval(() => {
			now = Date.now();
		}, 60000);

		return () => {
			document.removeEventListener('click', handleClickOutside);
			window.removeEventListener('resize', handleResize);
			window.removeEventListener('fabSnapZoneUpdated', handleSnapZoneUpdated);
		};
	});

	onDestroy(() => {
		threadsUnsub?.();
		if (expirationInterval) clearInterval(expirationInterval);
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
	const hasThreads = $derived(visibleThreads.length > 0);
	// Use notification store for total unread - this tracks real-time thread message counts
	const totalUnread = $derived($threadUnreadCount);
	// Get per-thread unreads from notification store
	const threadUnreads = $derived($threadUnreadById);
	const canGoBack = $derived(navigationHistory.length > 1);
	
	// Compute popover position based on FAB location
	const popoverPosition = $derived.by(() => {
		if (!browser) return { vertical: 'above', horizontal: 'center' };
		const vh = window.innerHeight;
		const vw = window.innerWidth;
		const fabSize = 50;
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
	class:threads-fab-wrapper--near-snap={nearSnapZone !== null}
	bind:this={fabEl}
	data-ready={ready}
	data-dragging={dragging}
	style="transform: translate3d({position.x}px, {position.y}px, 0);"
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerUp}
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
					<span class="threads-popover__subtitle">{visibleThreads.length} active</span>
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

			<div class="threads-popover__list">
				{#each visibleThreads as thread (thread.id)}
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
						<span>No recent threads</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.threads-fab-wrapper {
		position: fixed;
		left: 0;
		top: 0;
		z-index: 64;
		touch-action: none;
		--floating-fab-size: 3.1rem;
	}

	.threads-fab-wrapper[data-ready='false'] {
		opacity: 0;
		pointer-events: none;
	}

	.threads-fab-wrapper[data-dragging='true'] {
		cursor: grabbing;
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

	.threads-fab:hover,
	.threads-fab:focus-visible,
	.threads-fab--active {
		transform: translateY(-2px);
		box-shadow: 0 18px 32px rgba(139, 92, 246, 0.45);
		outline: none;
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

	.threads-fab-wrapper--near-snap {
		filter: drop-shadow(0 0 8px var(--color-accent, #a855f7));
	}

	.threads-fab--snapped {
		/* Match rail-button size when docked */
		width: 3rem;
		height: 3rem;
		box-shadow: 0 0 0 2px var(--color-accent, #a855f7);
	}
</style>
