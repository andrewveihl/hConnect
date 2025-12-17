<script lang="ts">
	import { run } from 'svelte/legacy';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import {
		doc,
		onSnapshot,
		setDoc,
		deleteField,
		Timestamp,
		type Unsubscribe
	} from 'firebase/firestore';

	import { LAST_LOCATION_STORAGE_KEY } from '$lib/constants/navigation';
	import logoMarkUrl from '$lib/assets/Logo_transparent.png';
	import { db } from '$lib/firestore/client';
	import { streamMyDMs } from '$lib/firestore/dms';
	import { saveServerOrder, subscribeUserServers } from '$lib/firestore/servers';
	import NewServerModal from '$lib/components/servers/NewServerModal.svelte';
	import { superAdminEmailsStore } from '$lib/admin/superAdmin';
	import { featureFlags } from '$lib/stores/featureFlags';
	import { dmUnreadCount, notifications, serverUnreadIndicators } from '$lib/stores/notifications';
	import type { NotificationItem } from '$lib/stores/notifications';
	import { openSettings, setSettingsSection, settingsUI } from '$lib/stores/settingsUI';
	import { defaultSettingsSection } from '$lib/settings/sections';
	import {
		presenceFromSources,
		presenceLabels,
		resolveManualPresenceFromSources,
		type PresenceState
	} from '$lib/presence/state';
	import { user, userProfile } from '$lib/stores/user';
	import { resolveProfilePhotoURL } from '$lib/utils/profile';
	import Avatar from '$lib/components/app/Avatar.svelte';
	import { fabSnapStore, isFabSnappingDisabled } from '$lib/stores/fabSnap';

	interface Props {
		activeServerId?: string | null;
		onCreateServer?: (() => void) | null;
		padForDock?: boolean;
		showBottomActions?: boolean;
	}

	type StatusSelection = 'auto' | PresenceState;
	type DmAlert = {
		id: string;
		threadId: string;
		title: string;
		photoURL: string | null;
		unread: number;
		href: string;
		lastActivity: number;
		isGroup?: boolean;
	};

	let {
		activeServerId = null,
		onCreateServer = null,
		padForDock = true,
		showBottomActions = true
	}: Props = $props();

	type ServerRailEntry = {
		id: string;
		name: string;
		icon?: string | null;
		position?: number | null;
		joinedAt?: number | null;
	};

	let servers: ServerRailEntry[] = $state([]);
	let unsub: (() => void) | undefined = $state();
	let localCreateOpen = $state(false);
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
	let dmRailUnsub: Unsubscribe | null = null;
	let dmMetadata: Record<string, { title: string; photoURL: string | null; isGroup?: boolean; groupName?: string | null }> = $state({});
	let serverList: ServerRailEntry[] = $state([]);
	let stopUserWatch: (() => void) | null = null;
	let dragPreview: ServerRailEntry[] = $state([]);
	let draggingServerId: string | null = $state(null);
	let reorderSaving = $state(false);
	let reorderError: string | null = $state(null);
	let suppressNextServerClick = $state(false);
	const serverButtonRefs = new Map<string, HTMLButtonElement>();
	let dragPointerId: number | null = null;
	let dragCandidateId: string | null = null;
	let dragStartY = 0;
	let dragMoved = false;
	const DRAG_THRESHOLD_PX = 6;
	let pendingOrderIds: string[] | null = null;
	let serverScrollEl: HTMLDivElement | null = $state(null);
	let lastPointerY = 0;
	let autoScrollFrame: number | null = null;
	const AUTO_SCROLL_EDGE_PX = 56;
	const AUTO_SCROLL_MAX_STEP = 18;
	let fabSnapZoneEl: HTMLDivElement | null = $state(null);
	const FAB_SNAP_ZONE_ID = 'left-rail-fab-snap';
	let snapZones = $state<import('$lib/stores/fabSnap').SnapZone[]>([]);
	const currentStatusSelection = $derived(
		myOverrideActive && myOverrideState ? myOverrideState : 'auto'
	);
	const featureFlagStore = featureFlags;
	const enableVoice = $derived(Boolean($featureFlagStore.enableVoice));
	const enableDMs = $derived(Boolean($featureFlagStore.enableDMs));
	const enableServerCreation = $derived(Boolean($featureFlagStore.enableServerCreation));
	const superAdminEmails = superAdminEmailsStore();
	const isSuperAdmin = $derived(
		(() => {
			const email = $user?.email ? $user.email.toLowerCase() : null;
			if (!email) return false;
			return Array.isArray($superAdminEmails) ? $superAdminEmails.includes(email) : false;
		})()
	);

	function handleServerRows(rows: ServerRailEntry[] = []) {
		servers = rows ?? [];
		const incomingIds = servers.map((entry) => entry.id);
		if (pendingOrderIds) {
			serverList = mergeServerData(serverList.length ? serverList : servers, servers);
			if (arraysEqual(incomingIds, pendingOrderIds)) {
				pendingOrderIds = null;
				if (!draggingServerId && !dragCandidateId) {
					serverList = servers;
				}
			}
		} else if (!draggingServerId && !dragCandidateId) {
			serverList = servers;
		} else {
			serverList = mergeServerData(serverList.length ? serverList : servers, servers);
		}
	}

	function restartServerSubscription(uid: string | null) {
		unsub?.();
		unsub = undefined;
		servers = [];
		serverList = [];
		if (!uid) {
			pendingOrderIds = null;
			return;
		}
		unsub = subscribeUserServers(uid, (rows) => handleServerRows(rows ?? []));
	}

	function updateFabSnapZone() {
		if (!browser || !fabSnapZoneEl) return;
		const rect = fabSnapZoneEl.getBoundingClientRect();
		fabSnapStore.updateZone(FAB_SNAP_ZONE_ID, {
			x: rect.left,
			y: rect.top,
			width: rect.width,
			height: rect.height
		});
	}

	function registerFabSnapZone() {
		if (!browser || !fabSnapZoneEl) return;
		const rect = fabSnapZoneEl.getBoundingClientRect();
		fabSnapStore.registerZone({
			id: FAB_SNAP_ZONE_ID,
			x: rect.left,
			y: rect.top,
			width: rect.width,
			height: rect.height
		});
	}

	// Snap zone highlight state - can be any zone ID now
	let activeSnapZoneId = $state<string | null>(null);

	function handleFabNearSnapZone(event: CustomEvent<{ zoneId: string | null }>) {
		activeSnapZoneId = event.detail.zoneId;
	}

	// Subscribe to snap zones updates
	let snapZonesUnsub: (() => void) | null = null;
	let snapZoneRegistered = false;

	// Watch for snap zone element to be bound and register
	$effect(() => {
		if (browser && fabSnapZoneEl && !snapZoneRegistered) {
			snapZoneRegistered = true;
			requestAnimationFrame(() => {
				registerFabSnapZone();
			});
		}
	});

	onMount(() => {
		restartServerSubscription($user?.uid ?? null);
		stopUserWatch = user.subscribe((next) => {
			restartServerSubscription(next?.uid ?? null);
		});

		// Set up event listeners
		if (browser) {
			window.addEventListener('resize', updateFabSnapZone);
			window.addEventListener('fabNearSnapZone', handleFabNearSnapZone as EventListener);
			
			// Subscribe to snap zones
			snapZonesUnsub = fabSnapStore.subscribe((state) => {
				snapZones = state.zones.filter(
					(z) => z.id === FAB_SNAP_ZONE_ID || z.id.startsWith(`${FAB_SNAP_ZONE_ID}-stack-`)
				);
			});
		}
	});

	onDestroy(() => stopUserWatch?.());
	onDestroy(() => unsub?.());
	onDestroy(() => dmRailUnsub?.());
	onDestroy(() => stopAutoScroll());
	onDestroy(() => {
		if (browser) {
			fabSnapStore.unregisterZone(FAB_SNAP_ZONE_ID);
			window.removeEventListener('resize', updateFabSnapZone);
			window.removeEventListener('fabNearSnapZone', handleFabNearSnapZone as EventListener);
			snapZonesUnsub?.();
		}
	});

	const handleCreateClick = () => {
		if (onCreateServer) onCreateServer();
		else localCreateOpen = true;
	};
	const handleLogoClick = (event: MouseEvent) => {
		if (!currentPath.startsWith('/admin')) return;
		event.preventDefault();
		if (browser) {
			try {
				localStorage.removeItem(LAST_LOCATION_STORAGE_KEY);
			} catch {
				// ignore storage errors
			}
		}
		goto('/', { keepFocus: true, noScroll: true, replaceState: true });
	};
	function openUserSettings(event: MouseEvent) {
		event.preventDefault();
		setSettingsSection(defaultSettingsSection);
		openSettings({ source: 'trigger' });
	}

	const formatBadge = (value: number): string => {
		if (!Number.isFinite(value)) return '';
		if (value > 99) return '99+';
		return value.toString();
	};

	let currentPath = $derived($page?.url?.pathname ?? '/');
	const isSettingsOpen = $derived($settingsUI.open);
	let dmsActive = $derived(currentPath === '/dms' || currentPath.startsWith('/dms/'));
	let activeDmThreadId = $derived(
		currentPath.startsWith('/dms/') && currentPath.length > 5
			? currentPath.slice(5).split('/')[0] || null
			: null
	);

	const statusOptions: Array<{
		id: StatusSelection;
		label: string;
		description: string;
		state: PresenceState | null;
	}> = [
		{ id: 'auto', label: 'Auto', description: 'Follow activity', state: null },
		{
			id: 'online',
			label: presenceLabels.online,
			description: 'Available to chat',
			state: 'online'
		},
		{ id: 'busy', label: presenceLabels.busy, description: 'Do not disturb', state: 'busy' },
		{ id: 'idle', label: presenceLabels.idle, description: 'Away for a bit', state: 'idle' },
		{ id: 'offline', label: 'Invisible', description: 'Appear offline', state: 'offline' }
	];

	const DEFAULT_OVERRIDE_MS = 24 * 60 * 60 * 1000;

	const dmAlerts = $derived.by(() => {
		const list = ($notifications ?? [])
			.filter((item: NotificationItem) => item?.kind === 'dm' && (item.unread ?? 0) > 0)
			.map((item) => {
				const threadId = item.threadId ?? item.id.replace(/^dm:/, '');
				const meta = dmMetadata[threadId];
				const title = meta?.title ?? item.title ?? item.preview ?? item.context ?? 'Direct message';
				const photoURL = meta?.photoURL ?? item.photoURL ?? null;
				const unread = item.unread ?? item.highCount ?? 0;
				const lastActivity = item.lastActivity ?? Date.now();
				const isGroup = meta?.isGroup ?? false;
				return {
					id: item.id,
					threadId,
					title,
					photoURL,
					unread,
					href: item.href,
					lastActivity,
					isGroup
				} satisfies DmAlert;
			});
		list.sort((a, b) => b.lastActivity - a.lastActivity);
		return list;
	});

	// When DM alerts change, update snap zone positions so snapped FABs move up/down
	let prevDmAlertCount = 0;
	run(() => {
		const currentCount = dmAlerts.length;
		if (currentCount !== prevDmAlertCount) {
			prevDmAlertCount = currentCount;
			// Use requestAnimationFrame to wait for DOM update
			if (browser) {
				requestAnimationFrame(() => {
					updateFabSnapZone();
				});
			}
		}
	});

	run(() => {
		const prev = untrack(() => dmRailUnsub);
		prev?.();
		dmMetadata = {};
		const uid = $user?.uid;
		if (!uid) return;
		dmRailUnsub = streamMyDMs(uid, (rows) => {
			const next: Record<string, { title: string; photoURL: string | null; isGroup?: boolean; groupName?: string | null }> = {};
			rows.forEach((row) => {
				const data = row as Record<string, any>;
				const isGroup = data.isGroup ?? false;
				const groupName = data.groupName ?? null;
				const rawName =
					typeof data.otherDisplayName === 'string' ? data.otherDisplayName.trim() : '';
				const rawEmail = typeof data.otherEmail === 'string' ? data.otherEmail.trim() : '';
				// For groups, prefer groupName; for 1:1, use other person's name/email
				const title = isGroup 
					? (groupName || 'Group chat') 
					: (rawName || rawEmail || 'Direct message');
				next[row.id] = {
					title,
					photoURL:
						typeof data.otherPhotoURL === 'string' && data.otherPhotoURL.length
							? data.otherPhotoURL
							: null,
					isGroup,
					groupName
				};
			});
			dmMetadata = next;
		});
	});

	run(() => {
		const prev = untrack(() => presenceUnsub);
		prev?.();
		myPresenceState = 'offline';
		myOverrideActive = false;
		myOverrideState = null;
		myOverrideExpiresAt = null;
		const uid = $user?.uid;
		if (!uid) return;
		const database = db();
		const ref = doc(database, 'profiles', uid, 'presence', 'status');
		presenceUnsub = onSnapshot(
			ref,
			(snap) => {
				const data = snap.data() ?? {};
				const manual = resolveManualPresenceFromSources(data);
				myOverrideActive = !!manual;
				myOverrideState = manual?.state ?? null;
				myOverrideExpiresAt = manual?.expiresAt ?? null;
				myPresenceState = presenceFromSources([data]);
			},
			() => {
				myPresenceState = 'offline';
				myOverrideActive = false;
				myOverrideState = null;
				myOverrideExpiresAt = null;
			}
		);
	});

	onDestroy(() => presenceUnsub?.());

	const statusDotClass = (state: PresenceState) => {
		switch (state) {
			case 'online':
				return 'status-dot--online';
			case 'busy':
				return 'status-dot--busy';
			case 'idle':
				return 'status-dot--idle';
			default:
				return 'status-dot--offline';
		}
	};

	const formatOverrideExpiry = (expiresAt: number | null) => {
		if (!expiresAt) return 'in 24 hours';
		const diff = expiresAt - Date.now();
		if (diff <= 0) return 'any moment';
		const minutes = Math.round(diff / 60000);
		if (minutes < 60) {
			return `in ${minutes} min`;
		}
		const hours = Math.round(minutes / 60);
		if (hours < 24) {
			return `in ${hours} hr${hours === 1 ? '' : 's'}`;
		}
		const days = Math.round(hours / 24);
		return `in ${days} day${days === 1 ? '' : 's'}`;
	};

	const statusDotLabel = () => presenceLabels[myPresenceState] ?? 'Offline';

	const displayedServers = $derived(draggingServerId ? dragPreview : serverList);

	function serverRefAction(node: HTMLButtonElement, serverId: string) {
		let id = serverId;
		serverButtonRefs.set(id, node);
		return {
			update(nextId: string) {
				if (nextId === id) return;
				serverButtonRefs.delete(id);
				id = nextId;
				serverButtonRefs.set(id, node);
			},
			destroy() {
				serverButtonRefs.delete(id);
			}
		};
	}

	function stopAutoScroll() {
		if (autoScrollFrame !== null && typeof cancelAnimationFrame === 'function') {
			cancelAnimationFrame(autoScrollFrame);
		}
		autoScrollFrame = null;
	}

	function runAutoScroll() {
		if (!draggingServerId || !serverScrollEl) {
			stopAutoScroll();
			return;
		}
		const rect = serverScrollEl.getBoundingClientRect();
		const upperEdge = rect.top + AUTO_SCROLL_EDGE_PX;
		const lowerEdge = rect.bottom - AUTO_SCROLL_EDGE_PX;
		let delta = 0;
		if (lastPointerY < upperEdge) {
			const intensity = 1 - (lastPointerY - rect.top) / AUTO_SCROLL_EDGE_PX;
			delta = -Math.max(4, Math.min(AUTO_SCROLL_MAX_STEP, intensity * AUTO_SCROLL_MAX_STEP));
		} else if (lastPointerY > lowerEdge) {
			const intensity = 1 - (rect.bottom - lastPointerY) / AUTO_SCROLL_EDGE_PX;
			delta = Math.max(4, Math.min(AUTO_SCROLL_MAX_STEP, intensity * AUTO_SCROLL_MAX_STEP));
		}
		if (delta !== 0) {
			serverScrollEl.scrollBy({ top: delta });
		} else {
			stopAutoScroll();
			return;
		}
		autoScrollFrame = requestAnimationFrame(runAutoScroll);
	}

	function ensureAutoScroll(clientY: number) {
		lastPointerY = clientY;
		if (!draggingServerId || autoScrollFrame !== null) return;
		autoScrollFrame = requestAnimationFrame(runAutoScroll);
	}

	function activateDrag() {
		if (!dragCandidateId) return;
		draggingServerId = dragCandidateId;
		dragPreview = [...serverList];
	}

	function updatePreviewOrder(clientY: number) {
		if (!draggingServerId) return;
		const ordered = dragPreview.length ? dragPreview : serverList;
		let targetId = ordered[ordered.length - 1]?.id ?? draggingServerId;
		let placeAtEnd = true;
		for (const entry of ordered) {
			const el = serverButtonRefs.get(entry.id);
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			const mid = rect.top + rect.height / 2;
			if (clientY < mid) {
				targetId = entry.id;
				placeAtEnd = false;
				break;
			}
		}
		const next = reorderList(ordered, draggingServerId, targetId, placeAtEnd);
		if (next !== ordered) {
			dragMoved = true;
			dragPreview = next;
		}
	}

	async function finalizeDrag() {
		const finalList = dragPreview.length ? dragPreview : serverList;
		const finalIds = finalList.map((entry) => entry.id);
		const originalIds = servers.map((entry) => entry.id);
		resetDragState();
		serverList = finalList;
		const changed = !arraysEqual(finalIds, originalIds);
		if (changed) {
			pendingOrderIds = finalIds;
			await persistServerOrder(finalList);
		} else {
			pendingOrderIds = null;
		}
		suppressNextServerClick = changed || dragMoved;
	}

	function resetDragState() {
		draggingServerId = null;
		dragCandidateId = null;
		dragPointerId = null;
		dragStartY = 0;
		dragPreview = [];
		dragMoved = false;
		stopAutoScroll();
		setTimeout(() => {
			suppressNextServerClick = false;
		}, 0);
	}

	function handleServerPointerDown(event: PointerEvent, serverId: string) {
		if (event.button !== 0) return;
		event.stopPropagation();
		suppressNextServerClick = false;
		dragMoved = false;
		(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
		dragCandidateId = serverId;
		dragPointerId = event.pointerId;
		dragStartY = event.clientY;
		draggingServerId = null;
	}

	function handleWindowPointerMove(event: PointerEvent) {
		if ((!dragCandidateId && !draggingServerId) || dragPointerId !== event.pointerId) return;
		const delta = Math.abs(event.clientY - dragStartY);
		if (!draggingServerId && delta >= DRAG_THRESHOLD_PX) {
			activateDrag();
		}
		if (!draggingServerId) return;
		event.preventDefault();
		if (delta > 0.5) dragMoved = true;
		ensureAutoScroll(event.clientY);
		updatePreviewOrder(event.clientY);
	}

	async function handleWindowPointerUp(event: PointerEvent) {
		if (dragPointerId !== event.pointerId) return;
		if (draggingServerId) {
			event.preventDefault();
			await finalizeDrag();
		} else {
			resetDragState();
		}
	}

	async function applyStatusOverride(selection: StatusSelection) {
		if (!$user?.uid) return;
		statusSaving = true;
		statusError = null;
		try {
			const database = db();
			const ref = doc(database, 'profiles', $user.uid, 'presence', 'status');
			if (selection === 'auto') {
				await setDoc(
					ref,
					{
						manualState: deleteField(),
						manualExpiresAt: deleteField()
					},
					{ merge: true }
				);
			} else {
				const expiresAt = Timestamp.fromMillis(Date.now() + DEFAULT_OVERRIDE_MS);
				await setDoc(
					ref,
					{
						manualState: selection,
						manualExpiresAt: expiresAt
					},
					{ merge: true }
				);
			}
			statusMenuOpen = false;
		} catch (error) {
			statusError = error instanceof Error ? error.message : 'Failed to update status.';
		} finally {
			statusSaving = false;
		}
	}

	const clearStatusOverride = () => applyStatusOverride('auto');

	const toggleStatusMenu = () => {
		statusMenuOpen = !statusMenuOpen;
		if (!statusMenuOpen) {
			statusError = null;
		}
	};

	function handleStatusOutside(event: MouseEvent | PointerEvent) {
		if (!statusMenuOpen) return;
		const target = event.target as Node | null;
		if (statusButtonEl?.contains(target) || statusMenuEl?.contains(target)) return;
		statusMenuOpen = false;
	}

	function handleStatusKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && statusMenuOpen) {
			statusMenuOpen = false;
		}
	}

	const navigateToServer = (serverId: string) => {
		goto(`/servers/${serverId}`, { keepFocus: true });
	};

	function handleServerClick(event: MouseEvent, serverId: string) {
		if (draggingServerId || dragCandidateId || suppressNextServerClick) {
			event.preventDefault();
			return;
		}
		if (event.metaKey || event.ctrlKey) {
			const url = `/servers/${serverId}`;
			if (browser) window.open(url, '_blank');
			return;
		}
		navigateToServer(serverId);
	}

	function reorderList(
		list: ServerRailEntry[],
		sourceId: string,
		targetId: string,
		placeAtEnd = false
	) {
		if (sourceId === targetId && !placeAtEnd) return list;
		const next = [...list];
		const fromIndex = next.findIndex((entry) => entry.id === sourceId);
		if (fromIndex === -1) return list;
		const [moved] = next.splice(fromIndex, 1);
		if (placeAtEnd) {
			next.push(moved);
			return next;
		}
		const toIndex = next.findIndex((entry) => entry.id === targetId);
		if (toIndex === -1) {
			next.push(moved);
			return next;
		}
		const insertAt = fromIndex < toIndex ? toIndex : toIndex;
		next.splice(insertAt < 0 ? 0 : insertAt, 0, moved);
		return next;
	}

	function mergeServerData(base: ServerRailEntry[], updates: ServerRailEntry[]): ServerRailEntry[] {
		if (!base.length) return updates;
		const map = new Map(updates.map((entry) => [entry.id, entry]));
		return base.map((entry) => ({ ...entry, ...(map.get(entry.id) ?? {}) }));
	}

	async function persistServerOrder(list: ServerRailEntry[]) {
		if (!$user?.uid) return;
		reorderSaving = true;
		reorderError = null;
		try {
			await saveServerOrder(
				$user.uid,
				list.map((entry) => entry.id)
			);
		} catch (err) {
			console.error('[LeftPane] saveServerOrder error', err);
			reorderError = 'Could not save order';
			pendingOrderIds = null;
		} finally {
			reorderSaving = false;
		}
	}

	function arraysEqual(a: string[], b: string[]) {
		if (a.length !== b.length) return false;
		return a.every((value, index) => value === b[index]);
	}
</script>

<svelte:window
	onpointerdown={handleStatusOutside}
	onpointermove={handleWindowPointerMove}
	onpointerup={handleWindowPointerUp}
	onpointercancel={handleWindowPointerUp}
	on:keydown={handleStatusKeydown}
/>

<aside
	class="app-rail h-dvh w-[72px] sticky top-0 left-0 z-30 flex flex-col items-center select-none"
	style:padding-bottom={padForDock
		? 'calc(env(safe-area-inset-bottom, 0px) + var(--mobile-dock-height, 0px) + 12px)'
		: '0.85rem'}
	aria-label="Server list"
>
	<div class="h-4 shrink-0"></div>

	<a href="/" class="rail-logo" aria-label="Activity" onclick={handleLogoClick}>
		<img src={logoMarkUrl} alt="hConnect" class="rail-logo__image" />
	</a>

	<div class="rail-divider"></div>

	<div
		class="flex-1 w-full overflow-y-auto touch-pan-y"
		bind:this={serverScrollEl}
		style:touch-action={draggingServerId ? 'none' : undefined}
	>
		<div class="rail-server-stack pb-4">
			{#each displayedServers as s (s.id)}
				<button
					type="button"
					class={`rail-button ${activeServerId === s.id ? 'rail-button--active' : ''} ${draggingServerId === s.id ? 'rail-button--dragging' : ''}`}
					aria-label={s.name}
					title={s.name}
					aria-current={activeServerId === s.id ? 'page' : undefined}
					onclick={(event) => handleServerClick(event, s.id)}
					use:serverRefAction={s.id}
					onpointerdown={(event) => handleServerPointerDown(event, s.id)}
					animate:flip={{ duration: 180 }}
				>
					{#if s.icon}
						<span class="rail-button__avatar">
							<img src={s.icon} alt={s.name} class="rail-button__image" draggable="false" />
						</span>
					{:else}
						<span class="rail-button__fallback">{s.name.slice(0, 2).toUpperCase()}</span>
					{/if}
					<!-- Server activity dot -->
					{#if $serverUnreadIndicators[s.id] && activeServerId !== s.id}
						<span
							class="server-activity-dot"
							class:server-activity-dot--high={$serverUnreadIndicators[s.id].hasHighPriority}
						></span>
					{/if}
				</button>
			{/each}

			<button
				type="button"
				class="rail-button rail-button--create"
				onclick={handleCreateClick}
				aria-label="Create server"
				title={enableServerCreation ? 'Create server' : 'Server creation disabled'}
				disabled={!enableServerCreation}
				aria-disabled={!enableServerCreation}
			>
				<i class="bx bx-plus text-2xl leading-none"></i>
			</button>
			{#if reorderError}
				<p class="rail-reorder-error">{reorderError}</p>
			{/if}
		</div>
	</div>

	<!-- FAB Snap Zones - floating icons can snap here, stacks dynamically -->
	{#if !$isFabSnappingDisabled}
	<div class="fab-snap-zones">
		<!-- Base snap zone (always visible when not occupied) -->
		<div
			class="fab-snap-zone"
			class:fab-snap-zone--active={activeSnapZoneId === FAB_SNAP_ZONE_ID}
			class:fab-snap-zone--occupied={snapZones.find(z => z.id === FAB_SNAP_ZONE_ID)?.occupiedBy != null}
			bind:this={fabSnapZoneEl}
			aria-label="Snap zone for floating buttons"
			role="region"
		>
			<div class="fab-snap-zone__indicator">
				<i class="bx bx-target-lock"></i>
			</div>
		</div>
		<!-- Stacked snap zones (appear above occupied zones for next FAB to snap) -->
		{#each snapZones.filter(z => z.id !== FAB_SNAP_ZONE_ID && !z.occupiedBy).sort((a, b) => (a.stackOrder ?? 0) - (b.stackOrder ?? 0)) as zone (zone.id)}
			<div
				class="fab-snap-zone fab-snap-zone--stacked"
				class:fab-snap-zone--active={activeSnapZoneId === zone.id}
				aria-label="Additional snap zone for stacking"
				role="region"
			>
				<div class="fab-snap-zone__indicator">
					<i class="bx bx-target-lock"></i>
				</div>
			</div>
		{/each}
	</div>
	{/if}

	{#if showBottomActions}
		<div
			class="rail-bottom w-full flex flex-col items-center gap-3 p-3 mt-auto"
			style:padding-bottom={padForDock
				? '1rem'
				: 'calc(env(safe-area-inset-bottom, 0px) + var(--mobile-dock-height, 0px) + 0.25rem)'}
		>
			{#if dmAlerts.length}
				<div class="flex flex-col items-center gap-2 w-full" aria-label="Unread direct messages">
					{#each dmAlerts as dm (dm.id)}
						<a
							href={dm.href}
							class={`rail-button relative ${activeDmThreadId === dm.threadId ? 'rail-button--active' : ''}`}
							class:rail-button--alert={activeDmThreadId !== dm.threadId}
							aria-label={dm.title}
							title={dm.title}
							aria-current={activeDmThreadId === dm.threadId ? 'page' : undefined}
						>
							{#if dm.isGroup}
								<div class="rail-button__avatar-wrap w-8 h-8 rounded-full bg-muted flex items-center justify-center">
									<i class="bx bx-group text-lg text-muted-foreground"></i>
								</div>
							{:else}
								<Avatar user={dm} name={dm.title} size="sm" class="rail-button__avatar-wrap" />
							{/if}
							<span class="rail-badge">{formatBadge(dm.unread)}</span>
						</a>
					{/each}
				</div>
			{/if}

			<div class="w-full flex flex-col items-center gap-2 pt-1">
				{#if enableDMs}
					<a
						href="/dms"
						onclick={(event) => {
							event.preventDefault();
							goto('/dms');
						}}
						class="rail-button rail-button--primary relative"
						class:rail-button--active={dmsActive}
						class:rail-button--alert={$dmUnreadCount > 0 && !dmsActive}
						aria-label="Home / DMs"
						title="Home / DMs"
					>
						<i class="bx bx-message-dots text-xl leading-none"></i>
						{#if $dmUnreadCount}
							<span class="rail-badge">{formatBadge($dmUnreadCount)}</span>
						{/if}
					</a>
				{:else}
					<button
						type="button"
						class="rail-button rail-button--disabled"
						disabled
						aria-label="Direct messages disabled"
						title="Direct messages disabled"
					>
						<i class="bx bx-message-square-x text-xl leading-none"></i>
					</button>
				{/if}
			</div>

			<div class="rail-profile-wrapper">
				<div class="rail-profile-anchor">
					<a
						href="/settings"
						class="rail-button rail-button--profile overflow-hidden mt-1"
						aria-label="Profile"
						title="Profile"
						class:rail-button--active={isSettingsOpen || currentPath.startsWith('/settings')}
						aria-current={isSettingsOpen || currentPath.startsWith('/settings')
							? 'page'
							: undefined}
						onclick={openUserSettings}
					>
						<Avatar
							user={$userProfile ?? $user}
							size="sm"
							isSelf={true}
							class="rail-button__avatar-wrap"
						/>
					</a>
					<div class="status-menu-container">
						<button
							type="button"
							class="status-button"
							bind:this={statusButtonEl}
							onclick={toggleStatusMenu}
							aria-label={`Set status (currently ${statusDotLabel()})`}
							title="Set status"
						>
							<span class={`status-dot ${statusDotClass(myPresenceState)}`} aria-hidden="true"
							></span>
						</button>
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
				</div>
			</div>
		</div>
	{/if}
</aside>

<NewServerModal bind:open={localCreateOpen} onClose={() => (localCreateOpen = false)} />

<style>
	:global(.rail-button) {
		transition:
			transform 160ms cubic-bezier(0.2, 0.65, 0.25, 1),
			background 150ms ease,
			border 150ms ease;
		will-change: transform;
	}

	:global(.rail-button:active) {
		transform: scale(0.94);
	}

	:global(.rail-button--disabled) {
		background: color-mix(in srgb, var(--color-panel-muted) 80%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-panel-muted) 45%, transparent);
		color: var(--text-40);
		cursor: not-allowed;
	}

	:global(.rail-button--dragging) {
		opacity: 0.65;
		cursor: grabbing;
	}

	.server-activity-dot {
		position: absolute;
		bottom: -2px;
		right: -2px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--color-accent);
		border: 2.5px solid var(--color-panel);
		pointer-events: none;
		z-index: 2;
	}

	.server-activity-dot--high {
		background: var(--color-accent);
	}

	@media (max-width: 767px) {
		:global(.app-rail .rail-bottom) {
			display: none;
		}
	}

	.rail-bottom {
		position: relative;
	}

	.rail-profile-wrapper {
		width: 100%;
		display: flex;
		justify-content: center;
	}

	.rail-profile-anchor {
		position: relative;
		display: inline-flex;
	}

	.status-menu-container {
		position: absolute;
		right: 0;
		bottom: 0;
		transform: translate(35%, 35%);
		display: flex;
		justify-content: flex-end;
	}

	.status-button {
		width: 1.45rem;
		height: 1.45rem;
		border-radius: 999px;
		border: 2px solid color-mix(in srgb, var(--color-panel) 90%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 85%, transparent);
		display: grid;
		place-items: center;
		padding: 0;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
		transition:
			border 150ms ease,
			background 150ms ease;
	}

	.status-button:hover,
	.status-button:focus-visible {
		border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
		background: color-mix(in srgb, var(--color-accent) 25%, transparent);
		outline: none;
	}

	.status-dot {
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 999px;
		border: 2px solid color-mix(in srgb, var(--color-panel) 85%, transparent);
	}

	.status-dot--online {
		background: #22c55e;
	}

	.status-dot--busy {
		background: #ef4444;
	}

	.status-dot--idle {
		background: #facc15;
	}

	.status-dot--offline {
		background: #6b7280;
	}

	.status-menu {
		position: absolute;
		left: calc(100% + 0.5rem);
		bottom: 0;
		width: 240px;
		padding: 0.85rem;
		border-radius: 1rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		background: color-mix(in srgb, var(--color-panel) 94%, transparent);
		box-shadow: 0 18px 40px rgba(5, 8, 18, 0.45);
		z-index: 50;
	}

	.status-menu__section {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.status-menu__title {
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-55);
	}

	.status-menu__list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.status-option {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		padding: 0.35rem 0.4rem;
		border-radius: 0.75rem;
		border: 1px solid transparent;
		background: transparent;
		color: inherit;
		text-align: left;
		transition:
			border 140ms ease,
			background 140ms ease;
	}

	.status-option.is-active {
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	.status-option__dot {
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 999px;
		border: 2px solid color-mix(in srgb, var(--color-panel) 85%, transparent);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.65rem;
	}

	.status-option__dot--auto {
		border-color: color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		color: var(--text-60);
	}

	.status-option__meta {
		flex: 1;
		min-width: 0;
	}

	.status-option__label {
		font-weight: 600;
		font-size: 0.9rem;
	}

	.status-option__description {
		font-size: 0.75rem;
		color: var(--text-60);
	}

	.status-option__check {
		font-size: 1.1rem;
		color: var(--color-accent);
	}

	.status-menu__error {
		margin-top: 0.5rem;
		font-size: 0.78rem;
		color: var(--color-danger, #ff9393);
	}

	.status-menu__override {
		margin-top: 0.75rem;
		padding-top: 0.6rem;
		border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 40%, transparent);
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.82rem;
	}

	.status-menu__clear {
		align-self: flex-start;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
		border-radius: 999px;
		padding: 0.25rem 0.8rem;
		font-size: 0.78rem;
		background: transparent;
		color: var(--text-70);
	}

	.status-menu__hint {
		margin-top: 0.6rem;
		font-size: 0.75rem;
		color: var(--text-60);
	}

	.rail-reorder-error {
		color: color-mix(in srgb, var(--color-danger, #f87171) 85%, white);
		font-size: 0.72rem;
		text-align: center;
		margin-top: 0.4rem;
	}

	/* FAB Snap Zones Container */
	.fab-snap-zones {
		display: flex;
		flex-direction: column-reverse;
		align-items: center;
		gap: 0.5rem; /* 8px - matches gap-2 used by DM buttons */
		margin: 0.5rem auto;
		flex-shrink: 0;
	}

	/* FAB Snap Zone */
	.fab-snap-zone {
		width: 3rem; /* 48px - matches rail-button size */
		height: 3rem;
		border-radius: 50%;
		border: 2px dashed color-mix(in srgb, var(--color-accent) 40%, transparent);
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 200ms ease;
		opacity: 0.6;
		flex-shrink: 0;
	}

	.fab-snap-zone--stacked {
		opacity: 0.5;
		transform: scale(0.95);
		animation: fabZoneAppear 200ms ease-out;
	}

	@keyframes fabZoneAppear {
		from {
			opacity: 0;
			transform: scale(0.8) translateY(10px);
		}
		to {
			opacity: 0.5;
			transform: scale(0.95) translateY(0);
		}
	}

	.fab-snap-zone--occupied {
		opacity: 0;
		pointer-events: none;
		height: 0;
		width: 0;
		margin: 0;
		padding: 0;
		border: none;
		overflow: hidden;
	}

	.fab-snap-zone:hover {
		opacity: 1;
		border-color: color-mix(in srgb, var(--color-accent) 70%, transparent);
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	.fab-snap-zone__indicator {
		color: var(--color-accent);
		font-size: 1.25rem;
		opacity: 0.7;
	}

	/* When a FAB is nearby/hovering */
	.fab-snap-zone--active {
		opacity: 1;
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 25%, transparent);
		transform: scale(1.08);
		box-shadow: 0 0 16px color-mix(in srgb, var(--color-accent) 40%, transparent);
	}

	.fab-snap-zone--active .fab-snap-zone__indicator {
		opacity: 1;
	}

	/* Hide on mobile (snap zone not needed) */
	@media (max-width: 767px) {
		.fab-snap-zones {
			display: none;
		}
	}
</style>
