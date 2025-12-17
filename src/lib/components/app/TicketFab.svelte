<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { tick, onDestroy } from 'svelte';
	import { getDb } from '$lib/firebase';
	import { user } from '$lib/stores/user';
	import { servers, serverMemberships } from '$lib/stores';
	import {
		doc,
		onSnapshot,
		collection,
		query,
		where,
		updateDoc,
		serverTimestamp,
		getDoc,
		type Unsubscribe,
		type Timestamp
	} from 'firebase/firestore';
	import { toggleChannelReaction } from '$lib/firestore/messages';
import { createChannelThread } from '$lib/firestore/threads';

	// Types
	type IssueStatus = 'opened' | 'in_progress' | 'closed';
	type TicketIssue = {
		id: string;
		serverId: string;
		channelId: string;
		threadId: string;
		parentMessageId?: string | null;
		authorId?: string | null;
		authorName?: string | null;
		summary: string;
		status: IssueStatus;
		typeTag?: string | null;
		staffMemberIds?: string[];
		createdAt?: Timestamp;
	};

	// State
	let isStaff = $state(false);
	let enabled = $state(false);
	let issues = $state<TicketIssue[]>([]);
	let loading = $state(true);
	let expanded = $state(false);
	let filter = $state<'unassigned' | 'all' | 'assigned' | 'mine'>('unassigned');
	let completingId = $state<string | null>(null);
	let claimingId = $state<string | null>(null);
	let channelNames = $state<Record<string, string>>({});

	let settingsUnsub: Unsubscribe | null = null;
	let issuesUnsub: Unsubscribe | null = null;
	let currentServerId: string | null = null;

	// Dragging state
	type Position = { x: number; y: number };
	const STORAGE_KEY = 'hconnect:ticketFab:position';
	const MIN_MARGIN = 8;
	const HOLD_DELAY_MS = 150;

	let fabEl = $state<HTMLButtonElement | null>(null);
	let position = $state<Position>({ x: 0, y: 0 });
	let ready = $state(false);
	let dragging = $state(false);
	let pointerId: number | null = null;
	let dragOffset: Position = { x: 0, y: 0 };
	let holdTimer: number | null = null;
	let hasCustomPosition = $state(false);
	let wasDragging = false;
	let skipNextClick = false;

	const DONE_EMOJI = '✅';
	const PANEL_WIDTH = 340;
	const PANEL_HEIGHT = 420;
	const FAB_SIZE = 50;

	// Derived
	let openCount = $derived(issues.length);
	let myIssues = $derived(issues.filter((i) => i.staffMemberIds?.includes($user?.uid ?? '')));
	let assignedIssues = $derived(issues.filter((i) => (i.staffMemberIds?.length ?? 0) > 0));
	let unassignedIssues = $derived(issues.filter((i) => (i.staffMemberIds?.length ?? 0) === 0));

	let filteredIssues = $derived.by(() => {
		if (filter === 'unassigned') return unassignedIssues;
		if (filter === 'mine') return myIssues;
		if (filter === 'assigned') return assignedIssues;
		return issues;
	});

	// Helper to get channel name from channelId (from local cache)
	function getChannelName(channelId: string): string {
		return channelNames[channelId] ?? 'loading...';
	}

	// Fetch channel name from Firestore and cache it
	async function fetchChannelName(serverId: string, channelId: string): Promise<void> {
		if (channelNames[channelId]) return; // Already cached
		try {
			const db = getDb();
			const channelDoc = await getDoc(doc(db, 'servers', serverId, 'channels', channelId));
			if (channelDoc.exists()) {
				channelNames = { ...channelNames, [channelId]: channelDoc.data()?.name ?? 'unknown' };
			} else {
				channelNames = { ...channelNames, [channelId]: 'deleted' };
			}
		} catch (err) {
			console.warn('[TicketFab] Failed to fetch channel name:', err);
			channelNames = { ...channelNames, [channelId]: 'unknown' };
		}
	}

	// Compute panel position to keep it on screen
	let panelStyle = $derived.by(() => {
		if (!browser) return '';

		const vw = window.innerWidth;
		const vh = window.innerHeight;

		// FAB center position
		const fabCenterX = position.x + FAB_SIZE / 2;
		const fabCenterY = position.y + FAB_SIZE / 2;

		// Determine horizontal position
		let horizontal = '';
		if (fabCenterX > vw / 2) {
			// FAB is on right side - panel opens to the left
			horizontal = 'right: 0;';
		} else {
			// FAB is on left side - panel opens to the right
			horizontal = 'left: 0;';
		}

		// Determine vertical position
		let vertical = '';
		if (fabCenterY > vh / 2) {
			// FAB is on bottom half - panel opens above
			vertical = 'bottom: calc(100% + 12px);';
		} else {
			// FAB is on top half - panel opens below
			vertical = 'top: calc(100% + 12px);';
		}

		return `${horizontal} ${vertical}`;
	});

	// Get serverId from URL params
	function getServerIdFromUrl(): string | null {
		const params = $page.params as Record<string, string | undefined>;
		return params?.serverID ?? params?.serverId ?? null;
	}

	// Check if user is server admin/owner
	function isServerAdminOrOwner(serverId: string, uid: string): boolean {
		const serverList = $servers as Server[];
		const server = serverList.find((s) => s.id === serverId);
		if (!server) return false;
		if (server.ownerId === uid) return true;
		const memberships = $serverMemberships as Membership[];
		const membership = memberships.find((m) => m.serverId === serverId && m.userId === uid);
		if (membership?.role === 'admin' || membership?.role === 'owner') return true;
		return false;
	}

	// Position management
	function loadSavedPosition(): Position | null {
		if (!browser) return null;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as Position;
			if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
				hasCustomPosition = true;
				return parsed;
			}
		} catch {}
		return null;
	}

	function persistPosition(value: Position) {
		if (!browser) return;
		hasCustomPosition = true;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	}

	function clampToViewport(value: Position): Position {
		if (!browser) return value;
		const size = 50;
		const maxX = Math.max(MIN_MARGIN, window.innerWidth - size - MIN_MARGIN);
		const maxY = Math.max(MIN_MARGIN, window.innerHeight - size - MIN_MARGIN);
		return {
			x: Math.min(Math.max(value.x, MIN_MARGIN), maxX),
			y: Math.min(Math.max(value.y, MIN_MARGIN), maxY)
		};
	}

	async function initPosition() {
		if (!browser) return;
		await tick();

		const saved = loadSavedPosition();
		if (saved) {
			position = clampToViewport(saved);
		} else {
			const viewportWidth = window.innerWidth;
			const viewportHeight = window.innerHeight;
			position = clampToViewport({
				x: Math.round((viewportWidth - 50) / 2),
				y: Math.round((viewportHeight - 50) / 2)
			});
		}
		ready = true;
	}

	// Drag handlers
	function clearHoldTimer() {
		if (holdTimer) {
			clearTimeout(holdTimer);
			holdTimer = null;
		}
	}

	function handleFabClick() {
		// Skip if pointer events just handled this interaction
		if (skipNextClick) {
			skipNextClick = false;
			return;
		}
		// Toggle expanded state
		expanded = !expanded;
	}

	function handlePointerDown(event: PointerEvent) {
		if (!fabEl || expanded) return;
		event.preventDefault();
		event.stopPropagation();

		wasDragging = false;
		pointerId = event.pointerId;
		dragOffset = {
			x: event.clientX - position.x,
			y: event.clientY - position.y
		};

		clearHoldTimer();
		holdTimer = window.setTimeout(() => {
			if (pointerId === null) return;
			dragging = true;
			wasDragging = true;
			fabEl?.setPointerCapture(pointerId);
		}, HOLD_DELAY_MS);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!dragging || event.pointerId !== pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		position = clampToViewport({
			x: event.clientX - dragOffset.x,
			y: event.clientY - dragOffset.y
		});
	}

	function handlePointerUp(event: PointerEvent) {
		if (pointerId !== event.pointerId) return;
		event.stopPropagation();

		if (dragging && pointerId != null) {
			event.preventDefault();
			fabEl?.releasePointerCapture(pointerId);
			persistPosition(position);
			// Skip the click event since we were dragging
			skipNextClick = true;
		}

		dragging = false;
		pointerId = null;
		clearHoldTimer();
		wasDragging = false;
	}

	// Ticket actions
	async function markComplete(issue: TicketIssue) {
		if (!currentServerId || !$user?.uid || completingId) return;
		completingId = issue.id;

		try {
			const db = getDb();
			const issueRef = doc(db, 'servers', currentServerId, 'ticketAiIssues', issue.id);

			await updateDoc(issueRef, {
				status: 'closed',
				closedAt: serverTimestamp()
			});

			// Add green checkmark reaction to the original message
			if (issue.parentMessageId && issue.channelId && $user?.uid) {
				try {
					await toggleChannelReaction(
						currentServerId,
						issue.channelId,
						issue.parentMessageId,
						$user.uid,
						DONE_EMOJI
					);
				} catch (e) {
					console.warn('[TicketFab] Could not add reaction:', e);
				}
			}
		} catch (err) {
			console.error('[TicketFab] Failed to complete issue:', err);
		} finally {
			completingId = null;
		}
	}

	let deletingId = $state<string | null>(null);

	// Claim ticket and create thread, then open as popup
	async function createAndOpenThread(issue: TicketIssue) {
		if (!currentServerId || !$user?.uid || claimingId) return;
		claimingId = issue.id;

		try {
			const db = getDb();
			const uid = $user.uid;
			const displayName = $user.displayName ?? 'Staff';

			// First, claim the ticket
			const issueRef = doc(db, 'servers', currentServerId, 'ticketAiIssues', issue.id);
			await updateDoc(issueRef, {
				staffMemberIds: [uid],
				status: 'in_progress'
			});

			// Create a thread from the message (if there's a parentMessageId)
			let threadId = issue.threadId;
			if (!threadId && issue.parentMessageId) {
				threadId = await createChannelThread({
					serverId: currentServerId,
					channelId: issue.channelId,
					sourceMessageId: issue.parentMessageId,
					sourceMessageText: issue.summary?.slice(0, 100),
					creator: { uid, displayName },
					initialMentions: issue.authorId ? [issue.authorId] : []
				});

				// Update the issue with the new threadId
				await updateDoc(issueRef, { threadId });
			}

			// Close the panel
			expanded = false;

			// Dispatch event to open floating thread popup
			if (threadId) {
				window.dispatchEvent(new CustomEvent('openFloatingThread', {
					detail: {
						serverId: currentServerId,
						channelId: issue.channelId,
						threadId: threadId
					}
				}));
			}
		} catch (err) {
			console.error('[TicketFab] Failed to create thread:', err);
		} finally {
			claimingId = null;
		}
	}

	async function deleteIssue(issue: TicketIssue) {
		if (!currentServerId || deletingId) return;
		deletingId = issue.id;

		try {
			const db = getDb();
			const { deleteDoc } = await import('firebase/firestore');
			const issueRef = doc(db, 'servers', currentServerId, 'ticketAiIssues', issue.id);
			await deleteDoc(issueRef);
		} catch (err) {
			console.error('[TicketFab] Failed to delete issue:', err);
		} finally {
			deletingId = null;
		}
	}

	// Open an existing thread as a popup (for assigned tickets)
	function openThreadPopup(issue: TicketIssue) {
		if (!currentServerId || !issue.channelId) return;
		
		const threadId = issue.threadId || issue.parentMessageId;
		if (!threadId) {
			console.warn('[TicketFab] No thread ID available for issue:', issue.id);
			return;
		}
		
		expanded = false;
		
		// Dispatch event to open floating thread popup
		window.dispatchEvent(new CustomEvent('openFloatingThread', {
			detail: {
				serverId: currentServerId,
				channelId: issue.channelId,
				threadId: threadId
			}
		}));
	}

	function navigateToIssue(issue: TicketIssue) {
		if (!currentServerId || !issue.channelId) {
			console.warn('[TicketFab] Missing serverId or channelId', { currentServerId, issue });
			return;
		}
		expanded = false;

		// Build URL - channel is a query param, not a path segment
		// If there's a thread (staff responded), navigate to thread
		// Otherwise navigate to the original message
		let path = `/servers/${currentServerId}?channel=${issue.channelId}`;
		if (issue.threadId) {
			path += `&thread=${issue.threadId}`;
		} else if (issue.parentMessageId) {
			// For channel messages, the parentMessageId can also be used as thread opener
			// Check if assigned (staff responded) - if so, thread should exist with same ID as message
			const isAssigned = (issue.staffMemberIds?.length ?? 0) > 0;
			if (isAssigned) {
				path += `&thread=${issue.parentMessageId}`;
			} else {
				path += `&msg=${issue.parentMessageId}`;
			}
		}
		goto(path);
	}

	function formatTime(timestamp: Timestamp | undefined): string {
		if (!timestamp) return '';
		const date = timestamp.toDate?.() ?? new Date();
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function truncate(text: string, len = 80): string {
		if (!text) return '';
		return text.length > len ? text.slice(0, len) + '…' : text;
	}

	// Data subscription
	$effect(() => {
		if (!browser) return;

		const serverId = getServerIdFromUrl();
		currentServerId = serverId;

		if (!serverId || !$user?.uid) {
			cleanup();
			return;
		}

		const uid = $user.uid;
		const email = $user.email ?? '';
		const adminOrOwner = isServerAdminOrOwner(serverId, uid);

		settingsUnsub?.();
		loading = true;

		const db = getDb();
		const settingsRef = doc(db, 'servers', serverId, 'ticketAiSettings', 'current');

		settingsUnsub = onSnapshot(
			settingsRef,
			(snap) => {
				const data = snap.data();
				const staffMemberIds = Array.isArray(data?.staffMemberIds) ? data.staffMemberIds : [];
				const staffDomains = Array.isArray(data?.staffDomains) ? data.staffDomains : [];
				enabled = data?.enabled ?? false;

				let userIsStaff = false;
				if (adminOrOwner) {
					userIsStaff = true;
				} else if (staffMemberIds.includes(uid)) {
					userIsStaff = true;
				} else if (staffDomains.length && email) {
					const domain = email.split('@')[1]?.toLowerCase();
					if (
						domain &&
						staffDomains.some((d: string) => d.toLowerCase().replace('@', '') === domain)
					) {
						userIsStaff = true;
					}
				}

				isStaff = userIsStaff;
				loading = false;

				if (userIsStaff && enabled) {
					subscribeToIssues(serverId);
				} else {
					issuesUnsub?.();
					issuesUnsub = null;
					issues = [];
				}

				if (userIsStaff && !ready) {
					initPosition();
				}
			},
			(error) => {
				console.warn('[TicketFab] Settings error:', error.code);
				loading = false;
				if (adminOrOwner) {
					isStaff = true;
					enabled = false;
					if (!ready) initPosition();
				}
			}
		);
	});

	function subscribeToIssues(serverId: string) {
		issuesUnsub?.();
		const db = getDb();
		const issuesRef = collection(db, 'servers', serverId, 'ticketAiIssues');
		const q = query(issuesRef, where('status', 'in', ['opened', 'in_progress']));

		issuesUnsub = onSnapshot(
			q,
			(snap) => {
				const loadedIssues = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TicketIssue);
				issues = loadedIssues;

				// Fetch channel names for all issues
				const uniqueChannelIds = [...new Set(loadedIssues.map((i) => i.channelId))];
				for (const channelId of uniqueChannelIds) {
					if (!channelNames[channelId]) {
						fetchChannelName(serverId, channelId);
					}
				}
			},
			(error) => {
				console.warn('[TicketFab] Issues error:', error.code);
				issues = [];
			}
		);
	}

	function cleanup() {
		settingsUnsub?.();
		issuesUnsub?.();
		settingsUnsub = null;
		issuesUnsub = null;
		isStaff = false;
		enabled = false;
		issues = [];
		loading = true;
		ready = false;
		expanded = false;
	}

	onDestroy(cleanup);

	// Close panel when clicking outside
	function handleBackdropClick() {
		expanded = false;
	}

	// Resize handler
	$effect(() => {
		if (!browser || !ready) return;
		const handleResize = () => {
			position = clampToViewport(position);
		};
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	});
</script>

{#if isStaff}
	<!-- Backdrop when expanded -->
	{#if expanded}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="ticket-backdrop" onclick={handleBackdropClick} role="presentation"></div>
	{/if}

	<div
		class="ticket-container"
		class:ticket-container--ready={ready}
		style="transform: translate({position.x}px, {position.y}px)"
	>
		<!-- FAB Button -->
		<button
			bind:this={fabEl}
			type="button"
			class="ticket-fab"
			class:ticket-fab--dragging={dragging}
			class:ticket-fab--disabled={!enabled}
			class:ticket-fab--active={expanded}
			class:ticket-fab--has-issues={openCount > 0 && enabled}
			aria-label="Support Tickets"
			title={enabled ? `Support Tickets (${openCount} open)` : 'Ticket AI (Disabled)'}
			onclick={handleFabClick}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
		>
			<i class="bx {expanded ? 'bx-x' : 'bx-support'}" aria-hidden="true"></i>
			{#if openCount > 0 && enabled && !expanded}
				<span class="ticket-fab__badge">{openCount > 99 ? '99+' : openCount}</span>
			{/if}
		</button>

		<!-- Expanded Panel -->
		{#if expanded}
			<div class="ticket-panel" style={panelStyle}>
				<div class="ticket-panel__header">
					<h3><i class="bx bx-support"></i> Support Tickets</h3>
					{#if enabled}
						<span class="ticket-panel__count">{openCount} active</span>
					{:else}
						<span class="ticket-panel__count ticket-panel__count--disabled">Disabled</span>
					{/if}
				</div>

				{#if !enabled}
					<div class="ticket-panel__empty">
						<i class="bx bx-info-circle"></i>
						<span>Ticket AI is not enabled</span>
						<p class="ticket-panel__hint">Enable it in Server Settings → Integrations</p>
					</div>
				{:else if loading}
					<div class="ticket-panel__empty">
						<i class="bx bx-loader-alt bx-spin"></i>
						<span>Loading tickets…</span>
					</div>
				{:else}
					<!-- Filter Tabs -->
					<div class="ticket-panel__filters">
						<button
							type="button"
							class="filter-tab"
							class:filter-tab--active={filter === 'unassigned'}
							onclick={() => (filter = 'unassigned')}
						>
							Unassigned ({unassignedIssues.length})
						</button>
						<button
							type="button"
							class="filter-tab"
							class:filter-tab--active={filter === 'all'}
							onclick={() => (filter = 'all')}
						>
							All ({issues.length})
						</button>
						<button
							type="button"
							class="filter-tab"
							class:filter-tab--active={filter === 'assigned'}
							onclick={() => (filter = 'assigned')}
						>
							Assigned ({assignedIssues.length})
						</button>
						<button
							type="button"
							class="filter-tab"
							class:filter-tab--active={filter === 'mine'}
							onclick={() => (filter = 'mine')}
						>
							Mine ({myIssues.length})
						</button>
					</div>

					<!-- Issues List -->
					<div class="ticket-panel__list">
						{#if filteredIssues.length === 0}
							<div class="ticket-panel__empty">
								<i class="bx bx-check-circle"></i>
								<span>
									{#if filter === 'all'}
										All tickets answered! 🎉
									{:else if filter === 'unassigned'}
										No unassigned tickets 🎉
									{:else if filter === 'mine'}
										No tickets assigned to you
									{:else}
										No assigned tickets
									{/if}
								</span>
							</div>
						{:else}
							{#each filteredIssues as issue (issue.id)}
								{@const isMine = issue.staffMemberIds?.includes($user?.uid ?? '')}
								{@const isAssigned = (issue.staffMemberIds?.length ?? 0) > 0}
								<div
									class="ticket-card"
									class:ticket-card--mine={isMine}
									class:ticket-card--assigned={isAssigned && !isMine}
								>
									<div class="ticket-card__header">
										<span class="ticket-card__status ticket-card__status--{issue.status}">
											{issue.status === 'opened' ? 'Open' : 'In Progress'}
										</span>
										<span class="ticket-card__channel">
											<i class="bx bx-hash"></i>
											{getChannelName(issue.channelId)}
										</span>
										<span class="ticket-card__time">{formatTime(issue.createdAt)}</span>
									</div>

									{#if issue.authorName}
										<div class="ticket-card__author">
											<i class="bx bx-user"></i>
											{issue.authorName}
										</div>
									{/if}

									<div class="ticket-card__summary">
										{truncate(issue.summary)}
									</div>

									<div class="ticket-card__actions">
										{#if !isAssigned}
											<!-- Unassigned: Primary action is "Create Thread" -->
											<button
												type="button"
												class="ticket-btn ticket-btn--claim"
												onclick={() => createAndOpenThread(issue)}
												disabled={claimingId === issue.id}
												title="Claim ticket and open thread"
											>
												{#if claimingId === issue.id}
													<i class="bx bx-loader-alt bx-spin"></i>
												{:else}
													<i class="bx bx-message-square-add"></i>
												{/if}
												Create Thread
											</button>
											<!-- Small view button for unassigned -->
											<button
												type="button"
												class="ticket-btn ticket-btn--icon"
												onclick={() => navigateToIssue(issue)}
												title="Go to message"
											>
												<i class="bx bx-link-external"></i>
											</button>
										{:else}
											<!-- Assigned: Primary action is "Open" popup -->
											<button
												type="button"
												class="ticket-btn ticket-btn--open"
												onclick={() => openThreadPopup(issue)}
												title="Open thread popup"
											>
												<i class="bx bx-window-open"></i>
												Open
											</button>
											{#if isMine}
												<!-- Assigned to me: Show "Done" button -->
												<button
													type="button"
													class="ticket-btn ticket-btn--complete"
													onclick={() => markComplete(issue)}
													disabled={completingId === issue.id}
													title="Mark as resolved"
												>
													{#if completingId === issue.id}
														<i class="bx bx-loader-alt bx-spin"></i>
													{:else}
														<i class="bx bx-check"></i>
													{/if}
													Done
												</button>
											{/if}
											<!-- Small view button for assigned -->
											<button
												type="button"
												class="ticket-btn ticket-btn--icon"
												onclick={() => navigateToIssue(issue)}
												title="Go to message"
											>
												<i class="bx bx-link-external"></i>
											</button>
										{/if}

										<button
											type="button"
											class="ticket-btn ticket-btn--delete"
											onclick={() => deleteIssue(issue)}
											disabled={deletingId === issue.id}
											title="Delete ticket"
										>
											{#if deletingId === issue.id}
												<i class="bx bx-loader-alt bx-spin"></i>
											{:else}
												<i class="bx bx-trash"></i>
											{/if}
										</button>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.ticket-backdrop {
		position: fixed;
		inset: 0;
		z-index: 64;
		background: rgba(0, 0, 0, 0.3);
	}

	.ticket-container {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 65;
		opacity: 0;
		pointer-events: none;
		transition: opacity 200ms ease;
	}

	.ticket-container--ready {
		opacity: 1;
		pointer-events: auto;
	}

	.ticket-fab {
		width: 3.1rem;
		height: 3.1rem;
		border-radius: 999px;
		border: 1px solid rgba(249, 115, 22, 0.65);
		background: linear-gradient(135deg, rgba(249, 115, 22, 0.98), rgba(234, 88, 12, 0.92));
		box-shadow: 0 14px 26px rgba(249, 115, 22, 0.32);
		color: #f8fafc;
		display: grid;
		place-items: center;
		font-size: 1.2rem;
		cursor: grab;
		transition:
			box-shadow 180ms ease,
			transform 180ms ease;
		touch-action: none;
		user-select: none;
		position: relative;
	}

	.ticket-fab--dragging {
		cursor: grabbing;
		box-shadow: 0 20px 40px rgba(249, 115, 22, 0.45);
	}

	.ticket-fab--active {
		cursor: pointer;
		background: linear-gradient(135deg, rgba(100, 116, 139, 0.95), rgba(71, 85, 105, 0.9));
		border-color: rgba(148, 163, 184, 0.4);
	}

	.ticket-fab--disabled:not(.ticket-fab--active) {
		border-color: rgba(100, 116, 139, 0.5);
		background: linear-gradient(135deg, rgba(100, 116, 139, 0.85), rgba(71, 85, 105, 0.8));
		box-shadow: 0 14px 26px rgba(100, 116, 139, 0.2);
	}

	.ticket-fab--has-issues:not(.ticket-fab--disabled):not(.ticket-fab--active) {
		animation: ticket-pulse 2s ease-in-out infinite;
	}

	@keyframes ticket-pulse {
		0%,
		100% {
			box-shadow: 0 14px 26px rgba(249, 115, 22, 0.32);
		}
		50% {
			box-shadow: 0 14px 32px rgba(249, 115, 22, 0.5);
		}
	}

	.ticket-fab__badge {
		position: absolute;
		top: -4px;
		right: -4px;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: #dc2626;
		color: #fff;
		font-size: 11px;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
	}

	.ticket-panel {
		position: absolute;
		width: 340px;
		max-height: 420px;
		background: var(--color-panel, #0f141c);
		border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
		border-radius: 16px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.ticket-panel__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
		background: var(--color-panel-muted, #131a24);
	}

	.ticket-panel__header h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--color-text-primary, #fff);
	}

	.ticket-panel__header h3 i {
		color: #f97316;
	}

	.ticket-panel__count {
		font-size: 12px;
		color: var(--color-text-secondary, #94a3b8);
		background: rgba(249, 115, 22, 0.15);
		padding: 4px 10px;
		border-radius: 999px;
	}

	.ticket-panel__count--disabled {
		background: rgba(100, 116, 139, 0.2);
		color: #64748b;
	}

	.ticket-panel__filters {
		display: flex;
		gap: 4px;
		padding: 10px 12px;
		border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.05));
	}

	.filter-tab {
		flex: 1;
		padding: 6px 8px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-secondary, #94a3b8);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition:
			background 150ms ease,
			color 150ms ease;
	}

	.filter-tab:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.filter-tab--active {
		background: rgba(249, 115, 22, 0.15);
		color: #f97316;
	}

	.ticket-panel__list {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
	}

	.ticket-panel__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 32px 16px;
		text-align: center;
		color: var(--color-text-secondary, #94a3b8);
	}

	.ticket-panel__empty i {
		font-size: 32px;
		margin-bottom: 8px;
		color: #22c55e;
	}

	.ticket-panel__empty span {
		font-size: 14px;
	}

	.ticket-panel__hint {
		font-size: 12px;
		color: #64748b;
		margin-top: 8px;
	}

	.ticket-card {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 10px;
		padding: 12px;
		margin-bottom: 8px;
		transition: border-color 150ms ease;
	}

	.ticket-card:hover {
		border-color: rgba(255, 255, 255, 0.1);
	}

	.ticket-card--mine {
		border-color: rgba(249, 115, 22, 0.3);
		background: rgba(249, 115, 22, 0.05);
	}

	.ticket-card--assigned {
		opacity: 0.6;
	}

	.ticket-card__header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
		flex-wrap: wrap;
	}

	.ticket-card__status {
		font-size: 11px;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 4px;
		text-transform: uppercase;
	}

	.ticket-card__status--opened {
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
	}

	.ticket-card__status--in_progress {
		background: rgba(249, 115, 22, 0.15);
		color: #f97316;
	}

	.ticket-card__channel {
		display: flex;
		align-items: center;
		gap: 2px;
		font-size: 11px;
		color: var(--color-text-muted, #64748b);
		background: rgba(255, 255, 255, 0.05);
		padding: 2px 6px;
		border-radius: 4px;
		max-width: 100px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ticket-card__channel i {
		font-size: 11px;
		opacity: 0.7;
	}

	.ticket-card__time {
		font-size: 11px;
		color: var(--color-text-muted, #64748b);
		margin-left: auto;
	}

	.ticket-card__author {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		color: var(--color-text-secondary, #94a3b8);
		margin-bottom: 4px;
	}

	.ticket-card__author i {
		font-size: 13px;
		opacity: 0.7;
	}

	.ticket-card__summary {
		font-size: 13px;
		color: var(--color-text-primary, #e2e8f0);
		line-height: 1.4;
		margin-bottom: 10px;
	}

	.ticket-card__actions {
		display: flex;
		gap: 6px;
	}

	.ticket-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 5px 10px;
		border: none;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition:
			background 150ms ease,
			opacity 150ms ease;
	}

	.ticket-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.ticket-btn--link {
		background: rgba(100, 116, 139, 0.2);
		color: #94a3b8;
	}

	.ticket-btn--link:hover:not(:disabled) {
		background: rgba(100, 116, 139, 0.3);
	}

	.ticket-btn--complete {
		background: rgba(34, 197, 94, 0.2);
		color: #22c55e;
	}

	.ticket-btn--complete:hover:not(:disabled) {
		background: rgba(34, 197, 94, 0.3);
	}

	.ticket-btn--claim {
		background: rgba(168, 85, 247, 0.2);
		color: #a855f7;
	}

	.ticket-btn--claim:hover:not(:disabled) {
		background: rgba(168, 85, 247, 0.3);
	}

	.ticket-btn--open {
		background: rgba(59, 130, 246, 0.2);
		color: #3b82f6;
	}

	.ticket-btn--open:hover:not(:disabled) {
		background: rgba(59, 130, 246, 0.3);
	}

	.ticket-btn--icon {
		background: rgba(100, 116, 139, 0.15);
		color: #64748b;
		padding: 4px 6px;
		min-width: unset;
	}

	.ticket-btn--icon:hover:not(:disabled) {
		background: rgba(100, 116, 139, 0.25);
		color: #94a3b8;
	}

	.ticket-btn--delete {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
		padding: 4px 6px;
		min-width: unset;
	}

	.ticket-btn--delete:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.3);
	}

	@media (max-width: 480px) {
		.ticket-panel {
			width: calc(100vw - 32px);
			max-width: 340px;
		}
	}
</style>
