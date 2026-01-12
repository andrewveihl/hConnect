<script lang="ts">
	import { resolveProfilePhotoURL } from '$lib/utils/profile';
	import { run, stopPropagation } from 'svelte/legacy';

	import { createEventDispatcher, onDestroy, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
	import { db } from '$lib/firestore/client';
	import { user } from '$lib/stores/user';
	import {
		searchUsersByName,
		getOrCreateDMThread,
		createGroupDM,
		streamMyDMs,
		streamMyThreadsLoose,
		streamUnreadCount,
		streamProfiles,
		getProfile,
		deleteThreadForUser,
		streamThreadMeta,
		triggerDMRailBackfill
	} from '$lib/firestore/dms';
	import { dmRailCache } from '$lib/stores/dmRailCache';
	import { presenceFromSources, presenceLabels, type PresenceState } from '$lib/presence/state';
	import Avatar from '$lib/components/app/Avatar.svelte';

	const dispatch = createEventDispatcher();
	let me: any = $state(null);
	let isRefreshing = $state(false);

	interface Props {
		activeThreadId?: string | null;
		showPersonalSection?: boolean;
		navigateOnSelect?: boolean;
	}

	type PresenceDoc = {
		state?: string | null;
		status?: string | null;
		online?: boolean | null;
		isOnline?: boolean | null;
		active?: boolean | null;
		lastActive?: any;
		lastSeen?: any;
		updatedAt?: any;
		timestamp?: any;
	};

	const presenceClassMap: Record<PresenceState, string> = {
		online: 'presence-dot--online',
		busy: 'presence-dot--busy',
		idle: 'presence-dot--idle',
		offline: 'presence-dot--offline'
	};

	const THREAD_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
	const THREAD_DATE_WITH_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});

	let {
		activeThreadId = $bindable(null),
		showPersonalSection = true,
		navigateOnSelect = true
	}: Props = $props();

	export function updatePartnerMeta(meta: {
		uid: string;
		displayName?: string | null;
		name?: string | null;
		email?: string | null;
	}) {
		const partner = meta?.uid?.trim?.();
		if (!partner) return;
		const resolved = meta.displayName ?? meta.name ?? meta.email ?? partner;
		nameCache = { ...nameCache, [partner]: resolved };
		const nextThreads = threads.map((thread) => {
			const other =
				thread.otherUid || (thread.participants || []).find((p: string) => p !== me?.uid);
			if (other !== partner) return thread;
			return {
				...thread,
				otherDisplayName:
					meta.displayName ?? meta.name ?? thread.otherDisplayName ?? thread.otherName ?? null,
				otherEmail: meta.email ?? thread.otherEmail ?? null
			};
		});
		syncThreadState(nextThreads);
	}

	/* ---------------- Search ---------------- */
	const SEARCH_PAGE_SIZE = 20;
	const PEOPLE_PAGE_SIZE = 40;
	const THREAD_PLACEHOLDERS = Array.from({ length: 4 }, (_, i) => i);
	const PEOPLE_PLACEHOLDERS = Array.from({ length: 5 }, (_, i) => i);

	let term = $state('');
	let searching = $state(false);
	let results: any[] = $state([]);
	let error: string | null = $state(null);
	let searchTimer: any;
	let showPeoplePicker = $state(false);
	let threadSearch = $state('');
	let searchVisibleCount = $state(SEARCH_PAGE_SIZE);
	let peopleVisibleCount = $state(PEOPLE_PAGE_SIZE);
	let visibleSearchResults: any[] = $state([]);
	let visiblePeopleList: any[] = $state([]);
	let filteredThreads: any[] = $state([]);

	// Group DM creation state
	let isGroupMode = $state(false);
	let selectedForGroup: any[] = $state([]);
	let groupName = $state('');
	let isCreatingGroup = $state(false);

	function resetSearchState() {
		clearTimeout(searchTimer);
		searchTimer = null;
		term = '';
		results = [];
		error = null;
		searching = false;
		searchVisibleCount = SEARCH_PAGE_SIZE;
	}

	function resetGroupState() {
		isGroupMode = false;
		selectedForGroup = [];
		groupName = '';
		isCreatingGroup = false;
	}

	function openPeoplePicker() {
		resetSearchState();
		resetGroupState();
		peopleVisibleCount = Math.min(PEOPLE_PAGE_SIZE, people.length || PEOPLE_PAGE_SIZE);
		showPeoplePicker = true;
	}

	function closePeoplePicker() {
		resetSearchState();
		resetGroupState();
		showPeoplePicker = false;
		peopleVisibleCount = PEOPLE_PAGE_SIZE;
	}

	function toggleGroupMode() {
		isGroupMode = !isGroupMode;
		if (!isGroupMode) {
			selectedForGroup = [];
			groupName = '';
		}
	}

	function togglePersonForGroup(person: any) {
		const idx = selectedForGroup.findIndex(p => p.uid === person.uid);
		if (idx >= 0) {
			selectedForGroup = selectedForGroup.filter(p => p.uid !== person.uid);
		} else {
			selectedForGroup = [...selectedForGroup, person];
		}
	}

	function isSelectedForGroup(uid: string): boolean {
		return selectedForGroup.some(p => p.uid === uid);
	}

	async function createGroup() {
		if (!me?.uid || selectedForGroup.length < 2 || isCreatingGroup) return;
		
		isCreatingGroup = true;
		try {
			const participantUids = [me.uid, ...selectedForGroup.map(p => p.uid)];
			const thread = await createGroupDM(participantUids, me.uid, groupName.trim() || undefined);
			
			// Add to local threads list
			if (!threads.find((x) => x.id === thread.id)) {
				const nextThreads = [
					{
						id: thread.id,
						participants: thread.participants,
						lastMessage: null,
						updatedAt: new Date(),
						isGroup: true,
						name: thread.name
					},
					...threads
				];
				syncThreadState(nextThreads);
				if (me?.uid) {
					dmRailCache.set(me.uid, nextThreads);
					persistStoredRail(me.uid, nextThreads);
				}
			}

			activeThreadId = thread.id;
			dispatch('select', thread.id);
			closePeoplePicker();
			await goto(`/dms/${thread.id}`);
		} catch (err: any) {
			console.error('Failed to create group DM', err);
			alert(err?.message ?? 'Failed to create group. Please try again.');
		} finally {
			isCreatingGroup = false;
		}
	}

	async function runSearch(q: string) {
		error = null;
		const s = q.trim();
		if (s.length < 2) {
			results = [];
			searchVisibleCount = SEARCH_PAGE_SIZE;
			return;
		}
		searching = true;
		try {
			const found = await searchUsersByName(s, { limitTo: 25 });
			results = me?.uid ? found.filter((u) => u.uid !== me.uid) : found;
			searchVisibleCount = SEARCH_PAGE_SIZE;
		} catch (e: any) {
			error = e?.message ?? 'Search failed';
		} finally {
			searching = false;
		}
	}

	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => runSearch(term), 200);
	}

	/* ---------------- Threads ---------------- */
	let threads: any[] = $state([]);
	let threadOrder: string[] = $state([]);
	let latestThreadsSnapshot: any[] = $state([]);
	let orderLocked = $state(true);
	let threadsLoading = $state(true);
	let unsubThreads: (() => void) | null = null;
	let fallbackUnsub: (() => void) | null = null;
	let railHasThreads = false;
	let lastUid: string | null = null;
	let threadMeta: Record<
		string,
		{ lastMessage: string | null; lastSender: string | null; updatedAt: any | null }
	> = $state({});
	let metaUnsubs: Record<string, () => void> = {};
	let decoratedThreads: any[] = $state([]);
	let sortedThreads: any[] = $state([]);

	onDestroy(() => unsubThreads?.());
	onDestroy(() => fallbackUnsub?.());
	onDestroy(() => {
		Object.values(metaUnsubs).forEach((stop) => stop());
		metaUnsubs = {};
	});
	onDestroy(() => cleanupPresence());

	// Resolve names for "other" participant so the list shows names, not UIDs.
	let nameCache: Record<string, string> = $state({});

	const DM_RAIL_STORAGE_PREFIX = 'dm-rail:';
	const DM_RAIL_STORAGE_LIMIT = 120;

	function loadStoredRail(uid: string): any[] | null {
		if (typeof window === 'undefined') return null;
		try {
			const raw = sessionStorage.getItem(`${DM_RAIL_STORAGE_PREFIX}${uid}`);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}

	function persistStoredRail(uid: string, rows: any[]) {
		if (typeof window === 'undefined') return;
		try {
			const trimmed = Array.isArray(rows) ? rows.slice(0, DM_RAIL_STORAGE_LIMIT) : [];
			sessionStorage.setItem(`${DM_RAIL_STORAGE_PREFIX}${uid}`, JSON.stringify(trimmed));
		} catch {
			// ignore storage errors
		}
	}

	function lockOrder() {
		orderLocked = true;
	}

	function unlockOrder() {
		orderLocked = false;
		if (latestThreadsSnapshot.length) {
			applyThreads(latestThreadsSnapshot, threadOrder.length > 0);
		}
	}

	function applyThreads(next: any[], preserveOrder: boolean) {
		const rows = Array.isArray(next) ? next.filter((t) => t && typeof t.id === 'string') : [];
		latestThreadsSnapshot = rows;
		const nextMap = new Map(rows.map((t) => [t.id, t]));
		const nextIds = rows.map((t) => t.id as string);
		let order: string[] = [];
		if (preserveOrder && threadOrder.length > 0) {
			const seen = new Set<string>();
			for (const id of threadOrder) {
				if (nextMap.has(id)) {
					order.push(id);
					seen.add(id);
				}
			}
			for (const id of nextIds) {
				if (!seen.has(id)) {
					order.push(id);
					seen.add(id);
				}
			}
		} else {
			order = nextIds;
		}
		threadOrder = order;
		threads = order.map((id) => nextMap.get(id)).filter(Boolean);
	}

	function syncThreadState(next: any[]) {
		const rows = Array.isArray(next) ? next.filter((t) => t && typeof t.id === 'string') : [];
		latestThreadsSnapshot = rows;
		threadOrder = rows.map((t) => t.id as string);
		threads = rows;
	}

	function pickDisplayCandidate(source: any): string | null {
		if (!source) return null;
		const candidates = Array.isArray(source)
			? source
			: [
					source.otherDisplayName,
					source.otherName,
					source.otherEmail,
					source.displayName,
					source.name,
					source.profile?.name,
					source.profile?.displayName,
					source.profile?.email
				];
		for (const candidate of candidates) {
			if (typeof candidate === 'string' && candidate.trim().length > 0) {
				return candidate.trim();
			}
		}
		return null;
	}

	function resolveOtherUid(t: any) {
		return t.otherUid || (t.participants || []).find((p: string) => p !== me?.uid) || null;
	}

	function isGroupThread(t: any): boolean {
		return t.isGroup === true || (t.participants?.length ?? 0) > 2;
	}

	function getGroupParticipantNames(t: any): string {
		const participants = t.participants || [];
		const otherParticipants = participants.filter((uid: string) => uid !== me?.uid);
		const names = otherParticipants.slice(0, 3).map((uid: string) => {
			if (nameCache[uid]) return nameCache[uid];
			const fromPeople = peopleMap[uid];
			if (fromPeople) {
				return fromPeople.displayName || fromPeople.name || fromPeople.email || uid.slice(0, 8);
			}
			return uid.slice(0, 8);
		});
		const remaining = otherParticipants.length - 3;
		if (remaining > 0) {
			return `${names.join(', ')} +${remaining}`;
		}
		return names.join(', ');
	}

	function threadDisplayName(t: any): string {
		// For group chats, use the group name if set, otherwise list participant names
		if (isGroupThread(t)) {
			// Check both 'name' (from DM thread doc) and 'groupName' (from rail doc)
			if (t.name) return t.name;
			if (t.groupName) return t.groupName;
			return getGroupParticipantNames(t);
		}
		// For 1:1 chats, use the other person's name
		return otherOf(t);
	}

	function otherOf(t: any) {
		const o = resolveOtherUid(t);
		if (!o) return 'Unknown';
		if (nameCache[o]) return nameCache[o];
		const fromPeople = peopleMap[o];
		if (fromPeople) {
			return fromPeople.displayName || fromPeople.name || fromPeople.email || o;
		}
		const fallback =
			t.otherName ??
			t.otherDisplayName ??
			t.otherEmail ??
			t.displayName ??
			t.name ??
			(t.profile && (t.profile.name ?? t.profile.displayName ?? t.profile.email)) ??
			null;
		return fallback ?? o;
	}

	function timestampValue(value: any): number {
		if (!value) return 0;
		if (typeof value === 'number') return value;
		if (typeof value?.toMillis === 'function') {
			try {
				return value.toMillis();
			} catch {
				return 0;
			}
		}
		if (typeof value === 'string') {
			const parsed = Date.parse(value);
			return Number.isNaN(parsed) ? 0 : parsed;
		}
		if (typeof value?.seconds === 'number') {
			const base = value.seconds * 1000;
			const extra = typeof value.nanoseconds === 'number' ? value.nanoseconds / 1e6 : 0;
			return base + extra;
		}
		if (value instanceof Date) return value.getTime();
		return 0;
	}

	function formatThreadTimestamp(value: any): string | null {
		const ts = timestampValue(value);
		if (!ts) return null;
		const now = Date.now();
		const diff = now - ts;
		if (diff < 60 * 1000) return 'Now';
		if (diff < 60 * 60 * 1000) {
			const mins = Math.max(1, Math.round(diff / 60000));
			return `${mins}m`;
		}
		if (diff < 24 * 60 * 60 * 1000) {
			const hours = Math.max(1, Math.round(diff / 3600000));
			return `${hours}h`;
		}
		const date = new Date(ts);
		const nowDate = new Date();
		if (date.getFullYear() === nowDate.getFullYear()) {
			return THREAD_DATE_FORMAT.format(date);
		}
		return THREAD_DATE_WITH_YEAR_FORMAT.format(date);
	}

	function previewTextFor(thread: any) {
		const summary = thread?.lastMessage;
		if (!summary) return 'No messages yet';
		if (thread?.lastSender && me?.uid && thread.lastSender === me.uid) {
			return `You: ${summary}`;
		}
		return summary;
	}

	function manageThreadMetaSubscriptions(currentThreads: any[]) {
		if (!Array.isArray(currentThreads)) return;
		const ids = new Set(
			currentThreads
				.map((t) => t?.id)
				.filter((id): id is string => typeof id === 'string' && id.length > 0)
		);
		ids.forEach((id) => {
			if (!metaUnsubs[id]) {
				metaUnsubs[id] = streamThreadMeta(id, (meta) => {
					threadMeta = { ...threadMeta, [id]: meta };
				});
			}
		});
		for (const id of Object.keys(metaUnsubs)) {
			if (!ids.has(id)) {
				metaUnsubs[id]?.();
				delete metaUnsubs[id];
				if (threadMeta[id]) {
					const next = { ...threadMeta };
					delete next[id];
					threadMeta = next;
				}
			}
		}
	}

	/* ---------------- Presence tracking ---------------- */
	let presenceDocs: Record<string, PresenceDoc> = $state({});
	const presenceUnsubs: Record<string, Unsubscribe> = {};
	let presenceDb: ReturnType<typeof db> | null = null;

	function ensurePresenceDb() {
		if (typeof window === 'undefined') return null;
		if (!presenceDb) {
			try {
				presenceDb = db();
			} catch (err) {
				console.warn('Failed to init Firestore for presence', err);
				return null;
			}
		}
		return presenceDb;
	}

	function unsubscribePresence(uid: string) {
		if (!uid || !presenceUnsubs[uid]) return;
		presenceUnsubs[uid]!();
		delete presenceUnsubs[uid];
		if (presenceDocs[uid]) {
			const next = { ...presenceDocs };
			delete next[uid];
			presenceDocs = next;
		}
	}

	function subscribePresence(uid: string) {
		if (!uid || presenceUnsubs[uid]) return;
		const database = ensurePresenceDb();
		if (!database) return;
		try {
			const ref = doc(database, 'profiles', uid, 'presence', 'status');
			presenceUnsubs[uid] = onSnapshot(
				ref,
				(snap) => {
					presenceDocs = { ...presenceDocs, [uid]: (snap.data() as PresenceDoc) ?? {} };
				},
				() => {
					unsubscribePresence(uid);
				}
			);
		} catch (err) {
			console.warn('Failed to subscribe to presence', err);
		}
	}

	function cleanupPresence() {
		for (const uid in presenceUnsubs) {
			presenceUnsubs[uid]!();
			delete presenceUnsubs[uid];
		}
		presenceDocs = {};
		presenceDb = null;
	}

	function syncPresenceSubscriptions() {
		if (typeof window === 'undefined') return;
		const partnerUids = new Set(
			threads
				.map((t) => resolveOtherUid(t))
				.filter((uid): uid is string => typeof uid === 'string' && uid.length > 0)
		);
		partnerUids.forEach((uid) => subscribePresence(uid));
		Object.keys(presenceUnsubs).forEach((uid) => {
			if (!partnerUids.has(uid)) {
				unsubscribePresence(uid);
			}
		});
	}

	function presenceStateFor(uid: string | null, thread?: any): PresenceState {
		if (!uid) return 'offline';
		return presenceFromSources([
			thread?.presence ?? null,
			thread?.profile ?? null,
			thread ?? null,
			peopleMap[uid] ?? null,
			presenceDocs[uid] ?? null
		]);
	}

	const presenceClassFromState = (state: PresenceState) =>
		presenceClassMap[state] ?? presenceClassMap.offline;

	/* ---------------- Unread badges ---------------- */
	let unreadMap: Record<string, number> = $state({});
	let unsubsUnread: Array<() => void> = [];

	onDestroy(() => unsubsUnread.forEach((u) => u()));

	/* ---------------- Everyone (profiles) ---------------- */
	let people: any[] = $state([]);
	let peopleLoading = $state(true);
	let peopleMap: Record<string, any> = $state({});
	let unsubPeople: (() => void) | null = null;

	onDestroy(() => unsubPeople?.());

	function loadMoreSearchResults() {
		if (!showPeoplePicker) return;
		if (results.length > searchVisibleCount) {
			searchVisibleCount = Math.min(results.length, searchVisibleCount + SEARCH_PAGE_SIZE);
		}
	}

	function loadMorePeople() {
		if (!showPeoplePicker) return;
		if (people.length > peopleVisibleCount) {
			peopleVisibleCount = Math.min(people.length, peopleVisibleCount + PEOPLE_PAGE_SIZE);
		}
	}

	function createLazyObserver(callback: () => void) {
		return (node: HTMLElement) => {
			if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined' || !node) {
				return { destroy() {} };
			}
			const observer = new IntersectionObserver(
				(entries) => {
					entries.forEach((entry) => {
						if (entry.isIntersecting) callback();
					});
				},
				{ rootMargin: '160px 0px 0px', threshold: 0 }
			);
			observer.observe(node);
			return {
				destroy() {
					observer.disconnect();
				}
			};
		};
	}

	const searchSentinelAction = createLazyObserver(loadMoreSearchResults);
	const peopleSentinelAction = createLazyObserver(loadMorePeople);

	/* ---------------- Long-press delete (mobile) ---------------- */
	const DM_LONG_PRESS_MS = 600;
	const SWIPE_DELETE_THRESHOLD = 80;
	const SWIPE_INTENT_THRESHOLD = 10;
	const SWIPE_INTENT_RATIO = 1.35;

	let dmLongPressTimer: ReturnType<typeof setTimeout> | null = null;
	let dmLongPressThreadId: string | null = null;
	let dmLongPressFiredFor: string | null = null;

	// Swipe-to-delete state
	let swipeThreadId: string | null = $state(null);
	let swipeStartX = 0;
	let swipeStartY = 0;
	let swipeDelta = $state(0);
	let swipeTracking = $state(false);
	let swipeIntent: 'horizontal' | 'vertical' | null = $state(null);

	function clearDmLongPressTimer() {
		if (dmLongPressTimer) {
			clearTimeout(dmLongPressTimer);
			dmLongPressTimer = null;
		}
	}

	function handleThreadPointerDown(event: PointerEvent, threadId: string) {
		// Only treat touch as long-press; don't interfere with desktop mouse
		if (event.pointerType !== 'touch') return;

		clearDmLongPressTimer();
		dmLongPressThreadId = threadId;
		dmLongPressFiredFor = null;

		dmLongPressTimer = setTimeout(() => {
			dmLongPressFiredFor = threadId;
			clearDmLongPressTimer();
			// reuse existing delete logic (includes confirm dialog)
			deleteThread(threadId);
		}, DM_LONG_PRESS_MS);
	}

	function handleThreadPointerUp(event: PointerEvent) {
		if (event.pointerType !== 'touch') return;
		clearDmLongPressTimer();
	}

	function handleThreadPointerCancel(event: PointerEvent) {
		if (event.pointerType !== 'touch') return;
		clearDmLongPressTimer();
	}

	// Swipe-to-delete handlers
	function handleSwipeStart(event: TouchEvent, threadId: string) {
		if (event.touches.length !== 1) return;
		swipeThreadId = threadId;
		swipeStartX = event.touches[0].clientX;
		swipeStartY = event.touches[0].clientY;
		swipeDelta = 0;
		swipeTracking = false;
		swipeIntent = null;
	}

	function handleSwipeMove(event: TouchEvent) {
		if (!swipeThreadId || event.touches.length !== 1) return;
		const dx = swipeStartX - event.touches[0].clientX;
		const dy = swipeStartY - event.touches[0].clientY;
		const absDx = Math.abs(dx);
		const absDy = Math.abs(dy);
		if (!swipeIntent) {
			if (absDx < SWIPE_INTENT_THRESHOLD && absDy < SWIPE_INTENT_THRESHOLD) return;
			if (absDy > absDx * SWIPE_INTENT_RATIO) {
				swipeIntent = 'vertical';
				return;
			}
			swipeIntent = 'horizontal';
			swipeTracking = true;
		}
		if (swipeIntent !== 'horizontal') return;
		// Only allow swiping left (positive delta)
		swipeDelta = Math.max(0, Math.min(dx, SWIPE_DELETE_THRESHOLD + 40));
	}

	function handleSwipeEnd() {
		if (!swipeThreadId) return;
		if (swipeIntent !== 'horizontal') {
			resetSwipeState();
			return;
		}
		swipeTracking = false;

		if (swipeDelta >= SWIPE_DELETE_THRESHOLD && swipeThreadId) {
			// Keep revealed until user taps delete or elsewhere
			swipeDelta = SWIPE_DELETE_THRESHOLD;
		} else {
			// Snap back
			swipeDelta = 0;
			swipeThreadId = null;
		}
	}

	function handleSwipeDeleteConfirm(threadId: string) {
		swipeDelta = 0;
		swipeThreadId = null;
		deleteThread(threadId);
	}

	function resetSwipeState() {
		swipeDelta = 0;
		swipeThreadId = null;
		swipeTracking = false;
		swipeIntent = null;
	}

	function handleThreadClick(event: MouseEvent | PointerEvent, threadId: string) {
		// prevent the click from bubbling to the row / delete button wrappers
		event.stopPropagation();

		// If swiped open, close it instead of navigating
		if (swipeThreadId && swipeDelta > 0) {
			resetSwipeState();
			return;
		}

		// If a long-press just fired, don't also open the DM
		if (dmLongPressFiredFor === threadId) {
			dmLongPressFiredFor = null;
			return;
		}
		openExisting(threadId);
	}

	onDestroy(() => {
		clearDmLongPressTimer();
	});

	/* ---------------- Actions ---------------- */
	function openExisting(threadId: string) {
		activeThreadId = threadId;
		dispatch('select', threadId);
		// Optimistically clear unread
		if (unreadMap[threadId] && unreadMap[threadId] > 0) {
			unreadMap = { ...unreadMap, [threadId]: 0 };
		}
		if (navigateOnSelect) {
			void goto(`/dms/${threadId}`);
		}
	}

	async function openOrStartDM(targetUid: string) {
		if (!me?.uid) return;
		try {
			const t = await getOrCreateDMThread([me.uid, targetUid], me.uid);

			if (!threads.find((x) => x.id === t.id)) {
				const nextThreads = [
					{
						id: t.id,
						participants: [me.uid, targetUid].sort(),
						lastMessage: t.lastMessage ?? null,
						updatedAt: new Date()
					},
					...threads
				];
				syncThreadState(nextThreads);
				if (me?.uid) {
					dmRailCache.set(me.uid, nextThreads);
					persistStoredRail(me.uid, nextThreads);
				}
			}

			activeThreadId = t.id;
			dispatch('select', t.id);
			// Optimistically clear unread
			if (unreadMap[t.id] && unreadMap[t.id] > 0) {
				unreadMap = { ...unreadMap, [t.id]: 0 };
			}
			closePeoplePicker();
			await goto(`/dms/${t.id}`);
		} catch (err: any) {
			console.error('Failed to open/start DM', err);
			alert(err?.message ?? 'Failed to open DM. Check Firestore rules/permissions.');
		}
	}

	async function deleteThread(threadId: string) {
		if (!me?.uid) return;
		const confirmDelete = window.confirm(
			'Remove this conversation for you? It will only be hidden from your list.'
		);
		if (!confirmDelete) return;

		try {
			await deleteThreadForUser(threadId, me.uid);
			const nextThreads = threads.filter((t) => t.id !== threadId);
			syncThreadState(nextThreads);
			if (me?.uid) {
				dmRailCache.set(me.uid, nextThreads);
				persistStoredRail(me.uid, nextThreads);
			}
			const nextMap = { ...unreadMap };
			delete nextMap[threadId];
			unreadMap = nextMap;
			if (activeThreadId === threadId) {
				activeThreadId = null;
			}
			dispatch('delete', threadId);
		} catch (err) {
			console.error('Failed to delete DM thread', err);
		}
	}

	async function refreshConversations() {
		if (isRefreshing) return;
		lockOrder();
		isRefreshing = true;
		try {
			const result = await triggerDMRailBackfill();
			console.log('[DMs] Backfill complete:', result);
			// The streamMyDMs subscription will automatically pick up new entries
		} catch (err) {
			console.error('[DMs] Failed to refresh conversations:', err);
		} finally {
			isRefreshing = false;
			unlockOrder();
		}
	}

	// Auto-backfill once when component mounts and user is logged in
	// This ensures any DMs that exist in the main collection but not in the user's rail are synced
	let hasAutoBackfilled = $state(false);
	
	async function autoBackfillOnMount() {
		if (hasAutoBackfilled || isRefreshing || !me?.uid) return;
		hasAutoBackfilled = true;
		
		// Wait a short delay to avoid race conditions
		await new Promise(resolve => setTimeout(resolve, 500));

		if (threads.length > 0) {
			return;
		}

		lockOrder();
		isRefreshing = true;
		
		try {
			console.log('[DMs] Running auto-backfill on mount...');
			const result = await triggerDMRailBackfill();
			console.log('[DMs] Auto-backfill complete:', result);
		} catch (err) {
			console.warn('[DMs] Auto-backfill failed (non-critical):', err);
		} finally {
			isRefreshing = false;
			unlockOrder();
		}
	}

	function stopFallbackStream() {
		fallbackUnsub?.();
		fallbackUnsub = null;
	}

	function startFallbackStream(uid: string) {
		if (fallbackUnsub) return;
		fallbackUnsub = streamMyThreadsLoose(uid, (rows) => {
			if (railHasThreads) return;
			const preserve = orderLocked || isRefreshing || threadOrder.length > 0 || !railHasThreads;
			applyThreads(rows, preserve);
			threadsLoading = false;
			dmRailCache.set(uid, rows);
			persistStoredRail(uid, rows);
		});
	}

	run(() => {
		me = $user;
	});
	run(() => {
		const uid = me?.uid ?? null;
		if (uid === lastUid) {
			return;
		}
		lastUid = uid;
		hasAutoBackfilled = false;
		const prevUnsub = untrack(() => unsubThreads);
		prevUnsub?.();
		stopFallbackStream();
		railHasThreads = false;
		threadOrder = [];
		latestThreadsSnapshot = [];
		orderLocked = false;
		if (uid) {
			const cachedThreads = dmRailCache.get(uid) ?? loadStoredRail(uid);
			if (cachedThreads?.length) {
				applyThreads(cachedThreads, true);
				railHasThreads = true;
				threadsLoading = false;
			}
			// Only show loading state if we don't have any threads yet
			// This prevents the loading flash when navigating back to DMs
			const currentThreads = untrack(() => threads);
			if (!currentThreads || currentThreads.length === 0) {
				threadsLoading = true;
			}
			unsubThreads = streamMyDMs(uid, (t, meta) => {
				const fromCache = meta?.fromCache ?? false;
				if (fromCache && threads.length > 0) {
					latestThreadsSnapshot = t;
					railHasThreads = true;
					return;
				}
				railHasThreads = t.length > 0;
				if (railHasThreads) {
					stopFallbackStream();
					const preserve = orderLocked || isRefreshing || threadOrder.length > 0;
					applyThreads(t, preserve);
					threadsLoading = false;
					dmRailCache.set(uid, t);
					persistStoredRail(uid, t);
					return;
				}
				threadsLoading = false;
				const preserve = orderLocked || isRefreshing || threadOrder.length > 0 || !railHasThreads;
				applyThreads(t, preserve);
				startFallbackStream(uid);
			});
			// Trigger auto-backfill when user is set
			if (!untrack(() => hasAutoBackfilled)) {
				autoBackfillOnMount();
			}
		} else {
			syncThreadState([]);
			threadsLoading = false;
		}
	});
	run(() => {
		if (threads?.length) {
			const cache = untrack(() => nameCache);
			let updated = false;
			const nextCache = { ...cache };
			for (const t of threads) {
				const other = resolveOtherUid(t);
				if (!other) continue;
				const seeded = pickDisplayCandidate(t);
				if (seeded && nextCache[other] !== seeded) {
					nextCache[other] = seeded;
					updated = true;
				}
			}
			if (updated) {
				nameCache = nextCache;
			}
		}
	});
	run(() => {
		(async () => {
			if (!threads?.length) return;
			const cache = untrack(() => nameCache);
			for (const t of threads) {
				const other = resolveOtherUid(t);
				if (other && !cache[other]) {
					try {
						const prof = await getProfile(other);
						const resolved = prof?.displayName ?? prof?.name ?? prof?.email ?? null;
						if (resolved) {
							nameCache = { ...cache, [other]: resolved };
							cache[other] = resolved;
						}
					} catch {}
				}
			}
		})();
	});
	run(() => {
		manageThreadMetaSubscriptions(threads);
	});
	run(() => {
		syncPresenceSubscriptions();
	});
	run(() => {
		decoratedThreads = threads.map((thread) => {
			const meta = threadMeta[thread.id] ?? null;
			const lastMessage = meta?.lastMessage ?? thread.lastMessage ?? null;
			const lastSender = meta?.lastSender ?? thread.lastSender ?? null;
			const updatedAt = meta?.updatedAt ?? thread.updatedAt ?? null;
			return {
				...thread,
				lastMessage,
				lastSender,
				updatedAt
			};
		});
	});
	run(() => {
		sortedThreads = decoratedThreads.slice();
	});
	run(() => {
		const prevStops = untrack(() => unsubsUnread);
		prevStops.forEach((u) => u());
		unsubsUnread = [];
		if (me?.uid) {
			for (const t of threads) {
				const stop = streamUnreadCount(t.id, me.uid, (n) => {
					const prev = untrack(() => unreadMap);
					unreadMap = { ...prev, [t.id]: n };
				});
				unsubsUnread.push(stop);
			}
		}
	});
	run(() => {
		peopleLoading = true;
		const prevUnsub = untrack(() => unsubPeople);
		prevUnsub?.();
		unsubPeople = streamProfiles(
			(list) => {
				const filtered = me?.uid ? list.filter((p) => p.uid !== me.uid) : list;
				people = filtered;
				const map: Record<string, any> = {};
				for (const p of list) map[p.uid] = p;
				peopleMap = map;

				if (filtered.length) {
					const baseCache = untrack(() => nameCache);
					const next = { ...baseCache };
					let updated = false;
					for (const person of filtered) {
						const uid = person?.uid;
						if (!uid) continue;
						const resolved = person?.displayName ?? person?.name ?? person?.email ?? null;
						if (resolved && next[uid] !== resolved) {
							next[uid] = resolved;
							updated = true;
						}
					}
					if (updated) {
						nameCache = next;
					}
				}

				peopleLoading = false;
			},
			{ limitTo: 500 }
		);
	});
	run(() => {
		visibleSearchResults = results.slice(0, Math.min(searchVisibleCount, results.length));
	});
	run(() => {
		visiblePeopleList = people.slice(0, Math.min(peopleVisibleCount, people.length));
	});
	run(() => {
		const query = threadSearch.trim().toLowerCase();
		if (!query) {
			filteredThreads = sortedThreads;
			return;
		}
		filteredThreads = sortedThreads.filter((t) => {
			const name = threadDisplayName(t)?.toLowerCase?.() ?? '';
			const preview = previewTextFor(t)?.toLowerCase?.() ?? '';
			return name.includes(query) || preview.includes(query);
		});
	});
</script>

<aside
	class="relative w-full md:w-80 shrink-0 sidebar-surface h-full flex flex-col text-primary"
>
	<!-- Minimalistic header -->
	<div class="dms-sidebar-header px-4 py-3 flex items-center justify-between gap-2">
		<div class="text-sm font-semibold tracking-tight text-white/90">Messages</div>
		<div class="flex items-center">
			<button
				class="dms-sidebar-header__new-btn"
				type="button"
				aria-label="New message"
				onclick={openPeoplePicker}
				disabled={showPeoplePicker}
			>
				<i class="bx bx-plus text-xl"></i>
			</button>
		</div>
	</div>

	<div class="dms-sidebar-scroll flex-1 overflow-y-auto px-2 pb-4 space-y-4 touch-pan-y">
		<div class="dm-search">
			<i class="bx bx-search dm-search__icon" aria-hidden="true"></i>
			<input
				type="search"
				placeholder="Search DMs"
				aria-label="Search direct messages"
				bind:value={threadSearch}
				class="dm-search__input"
			/>
			{#if threadSearch}
				<button
					type="button"
					class="dm-search__clear"
					onclick={() => (threadSearch = '')}
					aria-label="Clear search"
					title="Clear search"
				>
					<i class="bx bx-x"></i>
				</button>
			{/if}
		</div>

		{#if showPersonalSection}
			<section>
				<ul class="space-y-0.5">
					<li>
						<a
							href="/dms/notes"
							class={`dm-notes-row ${activeThreadId === '__notes' ? 'dm-notes-row--active' : ''}`}
							onclick={() => dispatch('select', { id: '__notes' })}
						>
							<div class="dm-notes-row__icon">
								<i class="bx bx-notepad"></i>
							</div>
							<span class="dm-notes-row__label">Notes</span>
						</a>
					</li>
				</ul>
			</section>
		{/if}

		<section>
			<ul class="space-y-0.5">
				{#if threadsLoading && filteredThreads.length === 0}
					{#each THREAD_PLACEHOLDERS as idx}
						<li>
							<div class="flex items-center gap-3 px-2 py-2">
								<div class="w-9 h-9 rounded-full bg-white/10"></div>
								<div class="flex-1 min-w-0 space-y-1">
									<div class="h-3 rounded bg-white/15 w-1/2"></div>
									<div class="h-3 rounded bg-white/10 w-1/3"></div>
								</div>
								<div class="w-6 h-6 rounded-full bg-white/10"></div>
							</div>
						</li>
					{/each}
					<li class="sr-only" aria-live="polite">Loading conversations...</li>
				{:else}
					{#each filteredThreads as t}
						{@const isActive = activeThreadId === t.id}
						{@const otherUid = resolveOtherUid(t)}
						{@const isGroup = isGroupThread(t)}
						{@const presenceState = isGroup ? 'offline' : presenceStateFor(otherUid, t)}
						{@const timestampLabel = formatThreadTimestamp(t.updatedAt)}
						{@const isSwipingThis = swipeThreadId === t.id}
						{@const swipeOffset = isSwipingThis ? swipeDelta : 0}
						{@const displayName = threadDisplayName(t)}
						<li class="dm-thread__item">
							<!-- Delete action revealed by swipe -->
							<div
								class="dm-thread__delete-action"
								class:dm-thread__delete-action--visible={swipeOffset > 20}
							>
								<button
									class="dm-thread__delete-action-btn"
									aria-label="Delete conversation"
									onclick={() => handleSwipeDeleteConfirm(t.id)}
								>
									<i class="bx bx-trash"></i>
									<span>Delete</span>
								</button>
							</div>

							<div
								class={`dm-thread__row group ${isActive ? 'dm-thread__row--active' : ''}`}
								style:transform={swipeOffset > 0 ? `translateX(-${swipeOffset}px)` : undefined}
								style:transition={swipeTracking ? 'none' : 'transform 200ms ease-out'}
								ontouchstart={(e) => handleSwipeStart(e, t.id)}
								ontouchmove={handleSwipeMove}
								ontouchend={handleSwipeEnd}
								ontouchcancel={handleSwipeEnd}
							>
								<button
									class="dm-thread__button"
									onclick={(event) => handleThreadClick(event, t.id)}
								>
									<div class="dm-thread__avatar">
										{#if isGroup}
											{#if t.iconURL}
												<img
													src={t.iconURL}
													alt="Group icon"
													class="dm-thread__group-icon-img"
												/>
											{:else}
												<div class="dm-thread__group-icon">
													<i class="bx bx-group"></i>
												</div>
											{/if}
										{:else}
											{@const fallbackData = {
												uid: otherUid,
												photoURL: t.otherPhotoURL,
												cachedPhotoURL: t.profile?.cachedPhotoURL,
												authPhotoURL: t.profile?.authPhotoURL,
												displayName: t.otherDisplayName ?? t.profile?.displayName ?? t.profile?.name ?? null,
												email: t.otherEmail ?? t.profile?.email ?? null
											}}
											{@const avatarUser = peopleMap[otherUid ?? ''] ?? {
												...fallbackData,
												photoURL: resolveProfilePhotoURL(fallbackData)
											}}
											<Avatar
												user={avatarUser}
												name={otherOf(t)}
												size="sm"
												showPresence={Boolean(otherUid)}
												presence={presenceState}
											/>
										{/if}
									</div>
									<div class="dm-thread__content">
										<div class="dm-thread__header-line">
											<span class="dm-thread__name">{displayName}</span>
											{#if timestampLabel}
												<span class="dm-thread__timestamp">{timestampLabel}</span>
											{/if}
										</div>
										<div class="dm-thread__preview">{previewTextFor(t)}</div>
									</div>
									{#if (unreadMap[t.id] ?? 0) > 0}
										<span class="dm-thread__unread">{unreadMap[t.id]}</span>
									{/if}
								</button>
								<!-- Desktop-only delete button -->
								<button
									class="dm-thread__delete-btn"
									aria-label="Delete conversation"
									onclick={stopPropagation(() => deleteThread(t.id))}
								>
									<i class="bx bx-trash"></i>
								</button>
							</div>
						</li>
					{/each}
					{#if filteredThreads.length === 0}
						<li class="px-2 py-2 text-sm text-white/60">
							{#if threadSearch.trim().length > 0}
								No conversations match your search.
							{:else}
								No conversations yet.
							{/if}
						</li>
					{/if}
				{/if}
			</ul>
		</section>
	</div>

	{#if showPeoplePicker}
		<div class="people-picker absolute inset-0 z-20 flex flex-col text-primary">
			<div class="px-4 py-3 border-b border-subtle flex items-center justify-between">
				<div>
					<div class="text-base font-semibold">
						{isGroupMode ? 'Create Group Chat' : 'Start a conversation'}
					</div>
					<div class="people-picker__subtitle">
						{isGroupMode ? 'Select people to add to the group' : 'Search anyone on hConnect'}
					</div>
				</div>
				<div class="flex items-center gap-2">
					<button
						class="btn btn-ghost btn-sm rounded-full people-picker__group-toggle"
						class:people-picker__group-toggle--active={isGroupMode}
						type="button"
						aria-label={isGroupMode ? 'Switch to direct message' : 'Create group chat'}
						title={isGroupMode ? 'Switch to direct message' : 'Create group chat'}
						onclick={toggleGroupMode}
					>
						<i class="bx bx-group text-lg"></i>
					</button>
					<button
						class="btn btn-ghost btn-sm rounded-full people-picker__close"
						type="button"
						aria-label="Close people picker"
						onclick={closePeoplePicker}
					>
						<i class="bx bx-x text-xl"></i>
					</button>
				</div>
			</div>

			{#if isGroupMode && selectedForGroup.length > 0}
				<div class="people-picker__selected-bar">
					<div class="people-picker__selected-list">
						{#each selectedForGroup as person}
							<button
								class="people-picker__selected-chip"
								onclick={() => togglePersonForGroup(person)}
								title="Remove {person.displayName || person.email || 'User'}"
							>
								<Avatar user={person} name={person.displayName || person.email || 'User'} size="xs" />
								<span class="people-picker__selected-name">{person.displayName || person.email || 'User'}</span>
								<i class="bx bx-x"></i>
							</button>
						{/each}
					</div>
					<div class="people-picker__selected-count">
						{selectedForGroup.length} selected
					</div>
				</div>
			{/if}

			{#if isGroupMode}
				<div class="p-4 border-b border-subtle space-y-2">
					<div class="people-picker__input">
						<i class="bx bx-group people-picker__search-icon"></i>
						<input
							class="input input--compact pl-9 pr-3 people-picker__field"
							placeholder="Group name (optional)"
							bind:value={groupName}
						/>
					</div>
				</div>
			{/if}

			<div class="p-4 border-b border-subtle space-y-2">
				<div class="people-picker__input">
					<input
						class="input input--compact px-3 people-picker__field"
						placeholder="Search for people by name"
						bind:value={term}
						oninput={onSearchInput}
					/>
				</div>
				{#if error}
					<p class="people-picker__hint text-red-400">{error}</p>
				{:else if searching}
					<p class="people-picker__hint">Searching...</p>
				{/if}
			</div>

			<div class="people-picker__body flex-1 overflow-y-auto p-4 space-y-6">
				{#if visibleSearchResults.length > 0}
					<section>
						<div class="people-picker__section-label px-2">Search results</div>
						<ul class="space-y-1">
							{#each visibleSearchResults as u}
								{@const isSelected = isSelectedForGroup(u.uid)}
								<li>
									<button 
										class="people-picker__option"
										class:people-picker__option--selected={isGroupMode && isSelected}
										onclick={() => isGroupMode ? togglePersonForGroup(u) : openOrStartDM(u.uid)}
									>
										{#if isGroupMode}
											<div class="people-picker__checkbox" class:people-picker__checkbox--checked={isSelected}>
												{#if isSelected}
													<i class="bx bx-check"></i>
												{/if}
											</div>
										{/if}
										<Avatar user={u} name={u.displayName || u.email || u.uid} size="sm" />
										<div class="text-sm text-left">
											<div class="font-medium leading-5">{u.displayName || u.email || u.uid}</div>
											{#if u.email}<div class="people-picker__muted">{u.email}</div>{/if}
										</div>
									</button>
								</li>
							{/each}
							{#if results.length > visibleSearchResults.length}
								<li>
									<div
										class="people-picker__sentinel"
										use:searchSentinelAction
										aria-hidden="true"
									></div>
								</li>
							{/if}
						</ul>
					</section>
				{:else if term.trim().length >= 2 && !searching && !error}
					<section>
						<div class="people-picker__section-label px-2">Search results</div>
						<p class="people-picker__empty">No people found.</p>
					</section>
				{:else if searching}
					<section>
						<div class="people-picker__section-label px-2">Search results</div>
						<p class="people-picker__empty">Looking up people...</p>
					</section>
				{/if}

				<section>
					<div class="people-picker__section-label px-2">All people</div>
					{#if peopleLoading}
						<ul class="space-y-1 pr-1" aria-hidden="true">
							{#each PEOPLE_PLACEHOLDERS as idx}
								<li>
									<div class="people-picker__option animate-pulse cursor-default select-none">
										<div class="w-8 h-8 rounded-full bg-white/10"></div>
										<div class="flex-1 space-y-1">
											<div class="h-3 w-2/3 rounded bg-white/10"></div>
											<div class="h-3 w-1/2 rounded bg-white/5"></div>
										</div>
									</div>
								</li>
							{/each}
						</ul>
						<p class="sr-only" aria-live="polite">Loading people...</p>
					{:else if visiblePeopleList.length > 0}
						<ul class="space-y-1 pr-1">
							{#each visiblePeopleList as p}
								{@const isSelected = isSelectedForGroup(p.uid)}
								<li>
									<button 
										class="people-picker__option"
										class:people-picker__option--selected={isGroupMode && isSelected}
										onclick={() => isGroupMode ? togglePersonForGroup(p) : openOrStartDM(p.uid)}
									>
										{#if isGroupMode}
											<div class="people-picker__checkbox" class:people-picker__checkbox--checked={isSelected}>
												{#if isSelected}
													<i class="bx bx-check"></i>
												{/if}
											</div>
										{/if}
										<Avatar user={p} name={p.displayName || p.email || 'User'} size="sm" />
										<div class="text-sm text-left">
											<div class="font-medium leading-5">{p.displayName || p.email || 'User'}</div>
											{#if p.email}<div class="people-picker__muted">{p.email}</div>{/if}
										</div>
									</button>
								</li>
							{/each}
							{#if people.length > visiblePeopleList.length}
								<li>
									<div
										class="people-picker__sentinel"
										use:peopleSentinelAction
										aria-hidden="true"
									></div>
								</li>
							{/if}
						</ul>
					{:else}
						<p class="people-picker__empty px-2">No users yet.</p>
					{/if}
				</section>
			</div>

			{#if isGroupMode}
				<div class="people-picker__footer">
					<button
						class="people-picker__create-btn"
						disabled={selectedForGroup.length < 2 || isCreatingGroup}
						onclick={createGroup}
					>
						{#if isCreatingGroup}
							<i class="bx bx-loader-alt animate-spin"></i>
							Creating...
						{:else}
							<i class="bx bx-group"></i>
							Create Group ({selectedForGroup.length + 1} members)
						{/if}
					</button>
				</div>
			{/if}
		</div>
	{/if}
</aside>

<style>
	/* DMs sidebar header - minimalistic */
	.dms-sidebar-header {
		background: var(--color-sidebar);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.dms-sidebar-header__new-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.6rem;
		border-radius: 0.6rem;
		background: rgba(255, 255, 255, 0.08);
		border: none;
		color: var(--color-text-secondary);
		transition:
			background 150ms ease,
			color 150ms ease;
	}

	.dms-sidebar-header__new-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.14);
		color: var(--color-text-primary);
	}

	.dms-sidebar-header__new-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* Notes row - minimalistic */
	.dm-notes-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		color: var(--color-text-secondary);
		text-decoration: none;
		transition:
			background 150ms ease,
			color 150ms ease;
	}

	.dm-notes-row:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text-primary);
	}

	.dm-notes-row--active {
		background: rgba(255, 255, 255, 0.1);
		color: var(--color-text-primary);
	}

	.dm-notes-row__icon {
		width: 1.75rem;
		height: 1.75rem;
		display: grid;
		place-items: center;
		border-radius: 0.375rem;
		background: rgba(255, 255, 255, 0.08);
		font-size: 1rem;
	}

	.dm-notes-row__label {
		font-size: 0.875rem;
		font-weight: 500;
	}

	/* Desktop: add extra padding for the DesktopUserBar */
	@media (min-width: 768px) {
		.dms-sidebar-scroll {
			padding-bottom: calc(var(--desktop-user-bar-height, 52px) + 3rem);
		}
	}

	@media (max-width: 767px) {
		.dms-sidebar-header {
			padding-top: calc(0.75rem + env(safe-area-inset-top, 0px));
			padding-left: calc(1rem + env(safe-area-inset-left, 0px));
			padding-right: calc(1rem + env(safe-area-inset-right, 0px));
		}

		.dms-sidebar-header__new-btn {
			width: 2.25rem;
			height: 2.25rem;
			padding: 0;
			justify-content: center;
		}

		.dms-sidebar-scroll {
			padding-bottom: calc(
				1rem + env(safe-area-inset-bottom, 0px) + var(--mobile-dock-height, 0px)
			);
		}
	}

	/* Thread item container for swipe-to-delete */
	.dm-thread__item {
		position: relative;
		overflow: hidden;
		border-radius: 0.5rem;
	}

	/* Delete action revealed by swipe (mobile) */
	.dm-thread__delete-action {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #dc2626;
		opacity: 0;
		transition: opacity 150ms ease;
	}

	.dm-thread__delete-action--visible {
		opacity: 1;
	}

	.dm-thread__delete-action-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 0.5rem;
		color: white;
		font-size: 0.7rem;
		font-weight: 500;
		background: none;
		border: none;
	}

	.dm-thread__delete-action-btn i {
		font-size: 1.25rem;
	}

	/* Hide swipe delete action on desktop */
	@media (min-width: 641px) {
		.dm-thread__delete-action {
			display: none;
		}
	}

	.dm-thread__header-line {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}

	.dm-thread__name {
		flex: 1;
		font-size: 0.875rem;
		font-weight: 500;
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-primary);
	}

	.dm-thread__timestamp {
		flex-shrink: 0;
		font-size: 0.6875rem;
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.45));
		line-height: 1;
	}

	.dm-thread__preview {
		font-size: 0.8125rem;
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.5));
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		line-height: 1.35;
	}

	.dm-thread__content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.dm-thread__unread {
		flex-shrink: 0;
		min-width: 1.125rem;
		height: 1.125rem;
		padding: 0 0.3rem;
		font-size: 0.65rem;
		font-weight: 600;
		display: grid;
		place-items: center;
		border-radius: 9999px;
		background: var(--color-accent, #5865f2);
		color: white;
	}

	.dm-thread__row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.625rem;
		border-radius: 0.5rem;
		background: transparent;
		will-change: transform;
		--presence-dot-border: var(--color-sidebar);
	}

	.dm-thread__row:active {
		background: rgba(255, 255, 255, 0.06);
	}

	@media (min-width: 641px) {
		.dm-thread__row {
			transition: background 150ms ease;
		}

		.dm-thread__row:hover {
			background: rgba(255, 255, 255, 0.06);
		}
	}

	.dm-thread__row--active {
		background: rgba(255, 255, 255, 0.1);
	}

	.dm-thread__row--active .dm-thread__name {
		color: var(--color-text-primary);
	}

	.dm-thread__button {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0;
		border: none;
		background: transparent;
		color: inherit;
		text-align: left;
		min-width: 0;
	}

	.dm-thread__button:focus-visible {
		outline: 2px solid rgba(255, 255, 255, 0.25);
		outline-offset: 2px;
		border-radius: 0.375rem;
	}

	.dm-thread__group-icon {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--color-accent, #5865f2) 0%, #7c3aed 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		font-size: 1rem;
		flex-shrink: 0;
	}

	.dm-thread__group-icon-img {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	.dm-thread__delete-btn {
		position: absolute;
		top: 50%;
		right: 0.5rem;
		transform: translateY(-50%);
		padding: 0.35rem;
		border-radius: 0.375rem;
		border: none;
		background: transparent;
		color: var(--color-text-tertiary);
		opacity: 0;
		transition:
			opacity 140ms ease,
			background 140ms ease,
			color 140ms ease;
	}

	.dm-thread__row:hover .dm-thread__delete-btn,
	.dm-thread__row:focus-within .dm-thread__delete-btn {
		opacity: 1;
	}

	.dm-thread__delete-btn:hover,
	.dm-thread__delete-btn:focus-visible {
		background: rgba(220, 38, 38, 0.15);
		color: #f87171;
	}

	/* Hide desktop delete button on mobile */
	@media (max-width: 640px) {
		.dm-thread__delete-btn {
			display: none !important;
		}
	}

	.dm-thread__avatar {
		position: relative;
		flex-shrink: 0;
	}

	.people-picker {
		background: var(--color-panel);
		backdrop-filter: blur(16px);
		color: var(--color-text-primary);
		padding-top: env(safe-area-inset-top, 0px);
		padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--mobile-dock-height, 0px));
	}

	.people-picker__subtitle {
		font-size: 0.8rem;
		color: var(--color-text-tertiary);
	}

	.people-picker__close {
		min-width: 2rem;
		height: 2rem;
	}

	.people-picker__input {
		position: relative;
	}

	.people-picker__search-icon {
		position: absolute;
		left: 0.85rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-tertiary);
		pointer-events: none;
		font-size: 1rem;
	}

	.people-picker__field {
		background: var(--input-bg);
		border-color: var(--input-border);
	}

	.people-picker__hint {
		font-size: 0.78rem;
		color: var(--color-text-tertiary);
	}

	.people-picker__body {
		background: color-mix(in srgb, var(--color-panel-muted) 95%, rgba(0, 0, 0, 0.3));
		border-top: 1px solid var(--color-border-subtle);
		padding: 1rem;
	}

	.people-picker__section-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-tertiary);
		margin-bottom: 0.5rem;
	}

	.people-picker__option {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		border-radius: 0.625rem;
		text-align: left;
		background: var(--color-panel);
		border: none;
		transition: background 150ms ease;
	}

	.people-picker__option:hover,
	.people-picker__option:focus-visible {
		background: color-mix(in srgb, var(--color-panel) 90%, rgba(255, 255, 255, 0.06));
	}

	.people-picker__option:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.people-picker__muted,
	.people-picker__empty {
		font-size: 0.82rem;
		color: var(--color-text-secondary);
	}

	.people-picker__empty {
		padding: 0.5rem 0;
	}

	.people-picker__sentinel {
		width: 100%;
		height: 1px;
	}

	/* Group chat creation styles */
	.people-picker__group-toggle {
		min-width: 2rem;
		height: 2rem;
		color: var(--color-text-secondary);
		transition: color 150ms ease, background 150ms ease;
	}

	.people-picker__group-toggle:hover {
		color: var(--color-text-primary);
		background: rgba(255, 255, 255, 0.1);
	}

	.people-picker__group-toggle--active {
		color: var(--color-accent, #5865f2);
		background: rgba(88, 101, 242, 0.15);
	}

	.people-picker__selected-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: rgba(88, 101, 242, 0.1);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.people-picker__selected-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		flex: 1;
	}

	.people-picker__selected-chip {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem 0.25rem 0.25rem;
		background: var(--color-panel);
		border: 1px solid var(--color-border-subtle);
		border-radius: 9999px;
		font-size: 0.75rem;
		color: var(--color-text-primary);
		transition: background 150ms ease;
	}

	.people-picker__selected-chip:hover {
		background: rgba(220, 38, 38, 0.1);
		border-color: rgba(220, 38, 38, 0.3);
	}

	.people-picker__selected-chip:hover i {
		color: #f87171;
	}

	.people-picker__selected-name {
		max-width: 6rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.people-picker__selected-count {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		flex-shrink: 0;
	}

	.people-picker__checkbox {
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 0.25rem;
		border: 2px solid var(--color-border-subtle);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: background 150ms ease, border-color 150ms ease;
	}

	.people-picker__checkbox--checked {
		background: var(--color-accent, #5865f2);
		border-color: var(--color-accent, #5865f2);
		color: white;
	}

	.people-picker__option--selected {
		background: rgba(88, 101, 242, 0.1);
	}

	.people-picker__footer {
		padding: 1rem;
		border-top: 1px solid var(--color-border-subtle);
		background: var(--color-panel);
	}

	.people-picker__create-btn {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: var(--color-accent, #5865f2);
		color: white;
		border: none;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 150ms ease, opacity 150ms ease;
	}

	.people-picker__create-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-accent, #5865f2) 90%, white);
	}

	.people-picker__create-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Thread search */
	.dm-search {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
		padding: 0.35rem 0.75rem;
		background: color-mix(in srgb, var(--color-sidebar) 90%, rgba(255, 255, 255, 0.06));
		border: 1px solid var(--color-border-subtle);
		border-radius: 0.65rem;
		backdrop-filter: blur(8px);
	}

	.dm-search__input {
		width: 100%;
		background: transparent;
		border: none;
		outline: none;
		color: var(--color-text-primary);
		font-size: 0.9rem;
	}

	.dm-search__input::placeholder {
		color: var(--color-text-tertiary);
	}

	.dm-search__icon {
		color: var(--color-text-tertiary);
		font-size: 1.05rem;
	}

	.dm-search__clear {
		width: 1.9rem;
		height: 1.9rem;
		display: grid;
		place-items: center;
		border: none;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text-tertiary);
		cursor: pointer;
		transition: background 140ms ease, color 140ms ease;
	}

	.dm-search__clear:hover,
	.dm-search__clear:focus-visible {
		background: rgba(220, 38, 38, 0.15);
		color: #f87171;
	}

	@media (max-width: 767px) {
		.dm-search {
			padding: 0.45rem 0.85rem;
			border-radius: 0.75rem;
		}

		.dm-search__input {
			font-size: 1rem;
		}
	}
</style>
