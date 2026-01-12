<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { tick, onDestroy, onMount } from 'svelte';
	import { getDb } from '$lib/firebase';
	import { user } from '$lib/stores/user';
	import { serverMemberships } from '$lib/stores';
	import type { Membership } from '$lib/types';
	import { fabSnapStore, isFabSnappingDisabled, type SnapZone } from '$lib/stores/fabSnap';
	import { subscribeUserServers } from '$lib/firestore/servers';
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
	let loading = $state(true);
	let expanded = $state(false);
	let filter = $state<'unassigned' | 'all' | 'assigned' | 'mine'>('unassigned');
	let completingId = $state<string | null>(null);
	let claimingId = $state<string | null>(null);
	let channelNames = $state<Record<string, string>>({});

	// Local servers list - subscribed directly to Firestore
	type LocalServer = {
		id: string;
		name: string;
		icon?: string | null;
		position?: number | null;
		joinedAt?: number | null;
	};
	let localServers = $state<LocalServer[]>([]);
	let serversUnsub: Unsubscribe | null = null;

	// Multi-server support
	type ServerStaffInfo = {
		serverId: string;
		serverName: string;
		enabled: boolean;
	};
	let staffServers = $state<ServerStaffInfo[]>([]);
	let serverIssuesMap = $state<Record<string, TicketIssue[]>>({});
	let serverUnsubs: Record<string, { settings: Unsubscribe | null; issues: Unsubscribe | null }> = {};

	// enabled is derived - true if ANY server the user is staff on has Ticket AI enabled
	let enabled = $derived(staffServers.some(s => s.enabled));

	let currentServerId: string | null = null;

	// Dragging state
	type Position = { x: number; y: number };
	const STORAGE_KEY = 'hconnect:ticketFab:position';
	const FAB_ID = 'ticket-fab';
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
	let isSnapped = $state(false);
	let nearSnapZone: SnapZone | null = $state(null);

	const DONE_EMOJI = '✅';
	const PANEL_WIDTH = 340;
	const PANEL_HEIGHT = 420;
	const FAB_SIZE = 48; // 3rem - matches rail-button size when snapped

	// Derived - aggregate all issues across servers
	let allIssues = $derived.by(() => {
		const all: TicketIssue[] = [];
		for (const serverId of Object.keys(serverIssuesMap)) {
			all.push(...serverIssuesMap[serverId]);
		}
		return all;
	});
	let openCount = $derived(allIssues.length);
	let myIssues = $derived(allIssues.filter((i) => i.staffMemberIds?.includes($user?.uid ?? '')));
	let assignedIssues = $derived(allIssues.filter((i) => (i.staffMemberIds?.length ?? 0) > 0));
	let unassignedIssues = $derived(allIssues.filter((i) => (i.staffMemberIds?.length ?? 0) === 0));

	// Check if user has staff access to any server
	let hasAnyStaffAccess = $derived(staffServers.length > 0);

	let filteredIssues = $derived.by(() => {
		if (filter === 'unassigned') return unassignedIssues;
		if (filter === 'mine') return myIssues;
		if (filter === 'assigned') return assignedIssues;
		return allIssues;
	});

	// Helper to get server name from serverId
	function getServerName(serverId: string): string {
		const serverInfo = staffServers.find((s) => s.serverId === serverId);
		if (serverInfo) return serverInfo.serverName;
		const server = localServers.find((s) => s.id === serverId);
		return server?.name ?? 'Unknown Server';
	}

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

	// Check if user is server admin/owner (based on membership role)
	function isServerAdminOrOwner(serverId: string, uid: string): boolean {
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

	function persistPosition(value: Position, snapped: boolean = false, zoneId?: string) {
		if (!browser) return;
		hasCustomPosition = true;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
		fabSnapStore.setSnapped(FAB_ID, snapped, zoneId);
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

	let snappedZoneId: string | null = $state(null);

	async function initPosition() {
		if (!browser) return;
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
		// Only allow expanding for staff members
		if (!hasAnyStaffAccess) return;
		// Toggle expanded state
		expanded = !expanded;
	}

	function stopTouchPropagation(event: TouchEvent) {
		event.stopPropagation();
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
			// Release zone when starting to drag
			if (isSnapped) {
				fabSnapStore.releaseZone(FAB_ID);
				snappedZoneId = null;
			}
			isSnapped = false;
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
		// Check if we're near a snap zone
		nearSnapZone = checkNearSnapZone();
		
		// Dispatch event to highlight snap zone in LeftPane
		if (browser) {
			window.dispatchEvent(new CustomEvent('fabNearSnapZone', {
				detail: { zoneId: nearSnapZone?.id ?? null }
			}));
		}
	}

	function handlePointerUp(event: PointerEvent) {
		if (pointerId !== event.pointerId) return;
		event.stopPropagation();

		if (dragging && pointerId != null) {
			event.preventDefault();
			fabEl?.releasePointerCapture(pointerId);
			
			// Check if we should snap
			const snapZone = checkNearSnapZone();
			if (snapZone) {
				snapToZone(snapZone);
			} else {
				persistPosition(position, false);
			}
			
			// Clear snap zone highlight
			if (browser) {
				window.dispatchEvent(new CustomEvent('fabNearSnapZone', {
					detail: { zoneId: null }
				}));
			}
			nearSnapZone = null;
			
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
		const serverId = issue.serverId;
		if (!serverId || !$user?.uid || completingId) return;
		completingId = issue.id;

		try {
			const db = getDb();
			const issueRef = doc(db, 'servers', serverId, 'ticketAiIssues', issue.id);

			await updateDoc(issueRef, {
				status: 'closed',
				closedAt: serverTimestamp()
			});

			// Add green checkmark reaction to the original message
			if (issue.parentMessageId && issue.channelId && $user?.uid) {
				try {
					await toggleChannelReaction(
						serverId,
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
		const serverId = issue.serverId;
		if (!serverId || !$user?.uid || claimingId) return;
		claimingId = issue.id;

		try {
			const db = getDb();
			const uid = $user.uid;
			const displayName = $user.displayName ?? 'Staff';

			// First, claim the ticket
			const issueRef = doc(db, 'servers', serverId, 'ticketAiIssues', issue.id);
			await updateDoc(issueRef, {
				staffMemberIds: [uid],
				status: 'in_progress'
			});

			// Create a thread from the message (if there's a parentMessageId)
			let threadId = issue.threadId;
			if (!threadId && issue.parentMessageId) {
				threadId = await createChannelThread({
					serverId: serverId,
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
						serverId: serverId,
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
		const serverId = issue.serverId;
		if (!serverId || deletingId) return;
		deletingId = issue.id;

		try {
			const db = getDb();
			const { deleteDoc } = await import('firebase/firestore');
			const issueRef = doc(db, 'servers', serverId, 'ticketAiIssues', issue.id);
			await deleteDoc(issueRef);
		} catch (err) {
			console.error('[TicketFab] Failed to delete issue:', err);
		} finally {
			deletingId = null;
		}
	}

	// Open an existing thread as a popup (for assigned tickets)
	function openThreadPopup(issue: TicketIssue) {
		const serverId = issue.serverId;
		if (!serverId || !issue.channelId) return;
		
		const threadId = issue.threadId || issue.parentMessageId;
		if (!threadId) {
			console.warn('[TicketFab] No thread ID available for issue:', issue.id);
			return;
		}
		
		expanded = false;
		
		// Dispatch event to open floating thread popup
		window.dispatchEvent(new CustomEvent('openFloatingThread', {
			detail: {
				serverId: serverId,
				channelId: issue.channelId,
				threadId: threadId
			}
		}));
	}

	function navigateToIssue(issue: TicketIssue) {
		const serverId = issue.serverId;
		if (!serverId || !issue.channelId) {
			console.warn('[TicketFab] Missing serverId or channelId', { serverId, issue });
			return;
		}
		expanded = false;

		// Build URL - channel is a query param, not a path segment
		// If there's a thread (staff responded), navigate to thread
		// Otherwise navigate to the original message
		let path = `/servers/${serverId}?channel=${issue.channelId}`;
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

	// Subscribe to a single server's ticketAi settings
	function subscribeToServerSettings(server: LocalServer, uid: string, email: string) {
		if (serverUnsubs[server.id]?.settings) return; // Already subscribed

		const adminOrOwner = isServerAdminOrOwner(server.id, uid);
		const db = getDb();
		const settingsRef = doc(db, 'servers', server.id, 'ticketAiSettings', 'current');

		const settingsUnsubFn = onSnapshot(
			settingsRef,
			(snap) => {
				const data = snap.data();
				const staffMemberIds = Array.isArray(data?.staffMemberIds) ? data.staffMemberIds : [];
				const staffDomains = Array.isArray(data?.staffDomains) ? data.staffDomains : [];
				const serverEnabled = data?.enabled ?? false;

				let userIsStaff = false;
				if (adminOrOwner) {
					userIsStaff = true;
				} else if (staffMemberIds.includes(uid)) {
					userIsStaff = true;
				} else if (staffDomains.length && email) {
					const domain = email.split('@')[1]?.toLowerCase();
					if (domain && staffDomains.some((d: string) => d.toLowerCase().replace('@', '') === domain)) {
						userIsStaff = true;
					}
				}

				// Update staffServers list
				if (userIsStaff) {
					const existing = staffServers.find(s => s.serverId === server.id);
					if (existing) {
						existing.enabled = serverEnabled;
						existing.serverName = server.name ?? 'Unknown';
						staffServers = [...staffServers];
					} else {
						staffServers = [...staffServers, {
							serverId: server.id,
							serverName: server.name ?? 'Unknown',
							enabled: serverEnabled
						}];
					}

					// Subscribe to issues if enabled
					if (serverEnabled && !serverUnsubs[server.id]?.issues) {
						subscribeToServerIssues(server.id);
					} else if (!serverEnabled && serverUnsubs[server.id]?.issues) {
						serverUnsubs[server.id].issues?.();
						serverUnsubs[server.id].issues = null;
						serverIssuesMap = { ...serverIssuesMap, [server.id]: [] };
					}
				} else {
					// Remove from staffServers if no longer staff
					staffServers = staffServers.filter(s => s.serverId !== server.id);
					serverUnsubs[server.id]?.issues?.();
					if (serverUnsubs[server.id]) {
						serverUnsubs[server.id].issues = null;
					}
					const { [server.id]: _, ...rest } = serverIssuesMap;
					serverIssuesMap = rest;
				}

				loading = false;

				// Initialize position if not ready
				if (!ready && staffServers.length > 0) {
					initPosition();
				}
			},
			(error) => {
				console.warn('[TicketFab] Settings error for server', server.id, ':', error.code);
				loading = false;
				// If admin/owner, still show as staff
				if (adminOrOwner) {
					const existing = staffServers.find(s => s.serverId === server.id);
					if (!existing) {
						staffServers = [...staffServers, {
							serverId: server.id,
							serverName: server.name ?? 'Unknown',
							enabled: false
						}];
					}
				}
				if (!ready && staffServers.length > 0) initPosition();
			}
		);

		serverUnsubs[server.id] = { settings: settingsUnsubFn, issues: null };
	}

	// Handle servers and user changes
	function handleStoreChanges(serverList: LocalServer[], currentUser: { uid: string; email?: string | null } | null) {
		if (!browser) return;
		if (!currentUser?.uid) {
			cleanup();
			return;
		}

		const uid = currentUser.uid;
		const email = currentUser.email ?? '';

		if (serverList.length === 0) {
			loading = true;
			return;
		}

		loading = true;

		// Clean up old subscriptions for servers no longer in list
		const currentServerIds = new Set(serverList.map(s => s.id));
		for (const sid of Object.keys(serverUnsubs)) {
			if (!currentServerIds.has(sid)) {
				serverUnsubs[sid]?.settings?.();
				serverUnsubs[sid]?.issues?.();
				delete serverUnsubs[sid];
				delete serverIssuesMap[sid];
				staffServers = staffServers.filter(s => s.serverId !== sid);
			}
		}

		// Subscribe to each server's ticketAi settings
		for (const server of serverList) {
			subscribeToServerSettings(server, uid, email);
		}

		// Note: enabled is now derived from staffServers automatically
	}

	// Initialize with onMount - subscribe to stores
	onMount(() => {
		if (!browser) return;

		// Subscribe to user store first
		const userUnsub = user.subscribe((currentUser) => {
			// Only set up servers subscription once we have a user
			if (currentUser?.uid && !serversUnsub) {
				serversUnsub = subscribeUserServers(currentUser.uid, (serverList) => {
					localServers = serverList ?? [];
					handleStoreChanges(localServers, currentUser);
				});
			} else if (!currentUser?.uid) {
				// User logged out - clean up
				cleanup();
			}
		});

		// Listen for snap zone updates
		window.addEventListener('fabSnapZoneUpdated', handleSnapZoneUpdated);

		return () => {
			userUnsub();
			serversUnsub?.();
			cleanup();
			window.removeEventListener('fabSnapZoneUpdated', handleSnapZoneUpdated);
		};
	});

	function handleSnapZoneUpdated() {
		if (!isSnapped || !snappedZoneId) return;
		const zones = fabSnapStore.getZones();
		const zone = zones.find((z) => z.id === snappedZoneId);
		if (zone) {
			const snapPos = fabSnapStore.getSnapPosition(zone, FAB_SIZE);
			position = clampToViewport(snapPos);
		}
	}

	function subscribeToServerIssues(serverId: string) {
		const db = getDb();
		const issuesRef = collection(db, 'servers', serverId, 'ticketAiIssues');
		const q = query(issuesRef, where('status', 'in', ['opened', 'in_progress']));

		const issuesUnsubFn = onSnapshot(
			q,
			(snap) => {
				const loadedIssues = snap.docs.map((d) => ({ 
					id: d.id, 
					serverId, // Add serverId to each issue
					...d.data() 
				}) as TicketIssue);
				serverIssuesMap = { ...serverIssuesMap, [serverId]: loadedIssues };

				// Fetch channel names for all issues
				const uniqueChannelIds = [...new Set(loadedIssues.map((i) => i.channelId))];
				for (const channelId of uniqueChannelIds) {
					if (!channelNames[channelId]) {
						fetchChannelName(serverId, channelId);
					}
				}
			},
			(error) => {
				console.warn('[TicketFab] Issues error for server', serverId, ':', error.code);
				serverIssuesMap = { ...serverIssuesMap, [serverId]: [] };
			}
		);

		if (serverUnsubs[serverId]) {
			serverUnsubs[serverId].issues = issuesUnsubFn;
		}
	}

	function cleanup() {
		// Clean up all server subscriptions
		for (const sid of Object.keys(serverUnsubs)) {
			serverUnsubs[sid]?.settings?.();
			serverUnsubs[sid]?.issues?.();
		}
		serverUnsubs = {};
		serverIssuesMap = {};
		staffServers = [];
		loading = true;
		ready = false;
		expanded = false;
	}

	onDestroy(() => {
		cleanup();
		serversUnsub?.();
		if (browser) {
			window.removeEventListener('fabSnapZoneUpdated', handleSnapZoneUpdated);
		}
	});

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

<!-- Only show FAB for staff members who have access to at least one server with Ticket AI -->
{#if hasAnyStaffAccess}
	<!-- Backdrop when expanded -->
	{#if expanded}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="ticket-backdrop" onclick={handleBackdropClick} role="presentation"></div>
	{/if}

	<div
		class="ticket-container"
		class:ticket-container--ready={ready}
		class:ticket-container--snapped={isSnapped}
		class:ticket-container--near-snap={nearSnapZone !== null}
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
			class:ticket-fab--snapped={isSnapped}
			aria-label="Support Issues"
			title={enabled ? `Support Issues (${openCount} open)` : 'Issue Tracker (Disabled)'}
			onclick={handleFabClick}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
			ontouchstart={stopTouchPropagation}
			ontouchmove={stopTouchPropagation}
			ontouchend={stopTouchPropagation}
			ontouchcancel={stopTouchPropagation}
		>
			<i class="bx {expanded ? 'bx-x' : 'bx-support'}" aria-hidden="true"></i>
			{#if openCount > 0 && !expanded}
				<span class="ticket-fab__badge">{openCount > 99 ? '99+' : openCount}</span>
			{/if}
		</button>

		<!-- Expanded Panel -->
		{#if expanded}
			<div class="ticket-panel" style={panelStyle}>
				<div class="ticket-panel__header">
					<h3><i class="bx bx-support"></i> Support Issues</h3>
					<span class="ticket-panel__count">{openCount} active</span>
				</div>

				{#if staffServers.length === 0}
					<div class="ticket-panel__empty">
						<i class="bx bx-info-circle"></i>
						<span>No servers with Issue Tracker access</span>
					</div>
				{:else if loading}
					<div class="ticket-panel__empty">
						<i class="bx bx-loader-alt bx-spin"></i>
						<span>Loading issues…</span>
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
							All ({allIssues.length})
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
										{#if staffServers.length > 1}
											<span class="ticket-card__server" title={getServerName(issue.serverId)}>
												<i class="bx bx-server"></i>
												{getServerName(issue.serverId)}
											</span>
										{/if}
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
												title="Claim issue and open thread"
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
											title="Delete issue"
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
			transform 180ms ease,
			width 200ms ease,
			height 200ms ease;
		touch-action: none;
		user-select: none;
		position: relative;
	}

	.ticket-fab--snapped {
		/* Match rail-button size when docked */
		width: 3rem;
		height: 3rem;
		box-shadow: 0 8px 18px rgba(249, 115, 22, 0.25);
	}

	.ticket-fab--dragging {
		cursor: grabbing;
		box-shadow: 0 20px 40px rgba(249, 115, 22, 0.45);
	}

	.ticket-container--near-snap .ticket-fab {
		/* Glow effect when near snap zone */
		box-shadow:
			0 14px 26px rgba(249, 115, 22, 0.32),
			0 0 20px var(--color-accent, #14b8a6);
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

	.ticket-card__server {
		display: flex;
		align-items: center;
		gap: 2px;
		font-size: 10px;
		color: var(--color-accent, #5865f2);
		background: rgba(88, 101, 242, 0.15);
		padding: 2px 6px;
		border-radius: 4px;
		max-width: 80px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ticket-card__server i {
		font-size: 10px;
		opacity: 0.8;
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
