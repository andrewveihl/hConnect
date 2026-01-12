<script lang="ts">
	import { run } from 'svelte/legacy';

	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { openServerSettings } from '$lib/stores/serverSettingsUI';
	import { createEventDispatcher, onDestroy, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { getDb } from '$lib/firebase';
	import { user } from '$lib/stores/user';
	import ChannelCreateModal from '$lib/components/servers/ChannelCreateModal.svelte';
	import { reorderCategories } from '$lib/firestore/channels';
	import {
		appendVoiceDebugEvent,
		removeVoiceDebugSection,
		setVoiceDebugSection
	} from '$lib/utils/voiceDebugContext';
	import { resolveProfilePhotoURL, isDefaultAvatarUrl } from '$lib/utils/profile';
	import { voiceSession } from '$lib/stores/voice';
	import type { VoiceSession } from '$lib/stores/voice';
	import { notifications, channelIndicators } from '$lib/stores/notifications';
	import { markChannelActivityRead, markMultipleChannelsActivityRead, markServerActivityRead } from '$lib/stores/activityFeed';
	import { getCachedServerChannels, updateServerChannelCache } from '$lib/stores/messageCache';
	import { onChannelHover } from '$lib/stores/preloadService';
	import { markMultipleChannelsRead } from '$lib/firebase/unread';
	import Avatar from '$lib/components/app/Avatar.svelte';
	import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
	import {
		collection,
		doc,
		getDoc,
		onSnapshot,
		orderBy,
		query,
		where,
		limit,
		type Unsubscribe,
		setDoc,
		writeBatch
	} from 'firebase/firestore';

	import type { ChannelThread } from '$lib/firestore/threads';

	interface Props {
		serverId: string | undefined;
		activeChannelId?: string | null;
		onPickChannel?: (id: string) => void;
		threads?: Array<ChannelThread & { unread?: boolean }>;
		availableThreads?: Array<ChannelThread>;
		activeThreadId?: string | null;
		onPickThread?: (thread: { id: string; parentChannelId: string }) => void;
		onJoinThread?: (thread: { id: string; channelId: string }) => void;
		threadUnreadByChannel?: Record<string, boolean>;
		currentUserId?: string | null;
	}

	let {
		serverId,
		activeChannelId = null,
		onPickChannel = () => {},
		threads = [],
		availableThreads = [],
		activeThreadId = null,
		onPickThread = () => {},
		onJoinThread = () => {},
		threadUnreadByChannel = {},
		currentUserId = null
	}: Props = $props();

	// Debug logging for threads
	$effect(() => {
		if (threads.length > 0 || availableThreads.length > 0) {
			console.log('[ServerSidebar] Received threads:', threads.length);
			console.log('[ServerSidebar] Thread parentChannelIds:', threads.map(t => ({id: t.id, name: t.name, parentChannelId: t.parentChannelId})));
			console.log('[ServerSidebar] Available channels:', channels.map(c => ({id: c.id, name: c.name})));
		}
	});

	type ChannelEventDetail = { serverId: string | null; channels: Chan[] };
	const dispatch = createEventDispatcher<{ pick: string; channels: ChannelEventDetail }>();

	type Chan = {
		id: string;
		name: string;
		type: 'text' | 'voice';
		position?: number;
		isPrivate?: boolean;
		allowedRoleIds?: string[];
		categoryId?: string | null;
	};

	const CHANNEL_CACHE_STORAGE_PREFIX = 'server-channels:';
	const CHANNEL_CACHE_STORAGE_LIMIT = 200;

	function sortChannelsByPosition(list: Chan[]) {
		return list.slice().sort((a, b) => {
			const ap = typeof a.position === 'number' ? a.position : Number.MAX_SAFE_INTEGER;
			const bp = typeof b.position === 'number' ? b.position : Number.MAX_SAFE_INTEGER;
			return ap - bp || a.id.localeCompare(b.id);
		});
	}

	function normalizeChannelForStorage(chan: Chan): Chan {
		return {
			id: chan.id,
			name: chan.name,
			type: chan.type,
			position: typeof chan.position === 'number' ? chan.position : undefined,
			isPrivate: chan.isPrivate === true,
			allowedRoleIds: Array.isArray(chan.allowedRoleIds) ? chan.allowedRoleIds : undefined,
			categoryId: chan.categoryId ?? null
		};
	}

	function loadStoredChannels(server: string): Chan[] {
		if (typeof window === 'undefined') return [];
		try {
			const raw = sessionStorage.getItem(`${CHANNEL_CACHE_STORAGE_PREFIX}${server}`);
			if (!raw) return [];
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed)
				? parsed.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
				: [];
		} catch {
			return [];
		}
	}

	function persistStoredChannels(server: string, list: Chan[]) {
		if (typeof window === 'undefined') return;
		try {
			const trimmed = list.slice(0, CHANNEL_CACHE_STORAGE_LIMIT).map(normalizeChannelForStorage);
			sessionStorage.setItem(`${CHANNEL_CACHE_STORAGE_PREFIX}${server}`, JSON.stringify(trimmed));
		} catch {
			// ignore storage errors
		}
	}

	function readCachedChannels(server: string, allowPrivate: boolean): Chan[] {
		let cached = (getCachedServerChannels(server) as Chan[]) ?? [];
		if (!cached.length) {
			const stored = loadStoredChannels(server);
			if (stored.length) {
				cached = stored;
				updateServerChannelCache(server, stored);
			}
		}
		if (!allowPrivate) {
			cached = cached.filter((chan) => chan?.isPrivate !== true);
		}
		return sortChannelsByPosition(cached);
	}

	function applyChannelList(server: string, list: Chan[]) {
		const sorted = sortChannelsByPosition(list);
		channels = sorted;
		updateServerChannelCache(server, sorted);
		persistStoredChannels(server, sorted);
		syncVoicePresenceWatchers(channels);
	}

	type Category = {
		id: string;
		name: string;
		position: number;
		collapsed?: boolean;
	};

	const CALL_DOC_ID = 'live';

	type VoiceParticipant = {
		uid: string;
		displayName?: string;
		photoURL?: string | null;
		hasAudio?: boolean;
		hasVideo?: boolean;
		status?: 'active' | 'left';
	};

	type PermissionFlags = {
		manageServer?: boolean;
		manageRoles?: boolean;
		manageChannels?: boolean;
		reorderChannels?: boolean;
	};

	let channels: Chan[] = $state([]);
	let serverName = $state('Server');
	let showCreate = $state(false);
	let myChannelOrder: string[] = [];
	let reorderMode: 'none' | 'default' | 'personal' = $state('none');
	let workingOrder: string[] = $state([]);
	// Snapshot of the current working order to use in effects without creating self-dependencies.
	let workingOrderSnapshot: string[] = $state([]);
	let savingOrder = $state(false);
	let orderError: string | null = $state(null);
	let draggingChannelId: string | null = $state(null);
	let draggingChannelType: Chan['type'] | null = $state(null);
	let dragOverChannelId: string | null = $state(null);
	let dragOverAfter = $state(false);
	let channelDragCandidateId: string | null = null;
	let channelDragCandidateType: Chan['type'] | null = null;
	let channelDragPointerId: number | null = null;
	let channelDragStartY = 0;
	let channelDragStartX = 0;
	let channelDragCurrentY = 0; // Tracks current position during long-press
	let channelDragCurrentX = 0; // Tracks current position during long-press
	let channelDragMoved = false;
	let channelLongPressTimer: number | null = null;
	let channelDragArmed = false; // NOT reactive - updated via draggingChannelId instead
	const CHANNEL_DRAG_THRESHOLD_PX = 6;
	const CHANNEL_LONG_PRESS_MS = 500; // Long-press duration for mobile
	const CHANNEL_LONG_PRESS_MOVE_THRESHOLD_PX = 10; // Max movement during long-press
	const channelRowRefs = new Map<string, HTMLElement>();
	let suppressChannelClick = false;
	let serverIcon: string | null = $state(null);
	let defaultRoleId: string | null = $state(null);
	let everyoneRoleId: string | null = $state(null);
	let serverIsPublic = $state(false);
	let channelFetchDenied = $state(false);
	let channelVisibilityHint: string | null = $state(null);
	let currentChannelServer: string | null = null;
	let lastChannelRoleKey: string | null = null;

	// Categories (folders) for channel grouping
	let categories: Category[] = $state([]);
	let collapsedCategories: Set<string> = $state(new Set());
	let unsubCategories: Unsubscribe | null = null;

	// Category drag-and-drop state
	let draggingCategoryId: string | null = $state(null);
	let categoryDropTarget: { type: 'before-item' | 'end'; itemIndex?: number } | null = $state(null);
	let categoryDragStartY = 0;
	let categoryDragMoved = false;

	// Context menu state for "Mark All as Read"
	let contextMenuRef: ContextMenu | null = $state(null);
	let contextMenuTarget: { type: 'all' | 'category'; categoryId?: string } | null = $state(null);
	let markingAsRead = $state(false);

	// Long-press tracking for context menu on mobile
	let contextMenuLongPressTimer: number | null = null;
	let contextMenuLongPressStart: { x: number; y: number } | null = null;
	const CONTEXT_MENU_LONG_PRESS_MS = 500;
	const CONTEXT_MENU_LONG_PRESS_THRESHOLD = 10;

	let voicePresence: Record<string, VoiceParticipant[]> = $state({});
	const voiceUnsubs = new Map<string, Unsubscribe>();
	let activeVoice: VoiceSession | null = $state(null);
	const voiceProfileCache = new Map<
		string,
		{ displayName?: string | null; photoURL?: string | null }
	>();
	const pendingVoiceProfiles = new Set<string>();
	const unsubscribeVoiceSession = voiceSession.subscribe((value) => {
		activeVoice = value;
	});

	let unsubChannels: Unsubscribe | null = null;
	let unsubPublicChannels: Unsubscribe | null = null;
	let unsubAllowedChannels: Unsubscribe | null = null;
	let unsubServerMeta: Unsubscribe | null = null;
	let unsubMyMember: Unsubscribe | null = null;
	let unsubProfileMembership: Unsubscribe | null = null;
	let unsubPersonalOrder: Unsubscribe | null = null;
	const blockedChannelServers = new Map<string, string>(); // serverId -> roleKey when permission denied

	let ownerId: string | null = null;
	let myRole: 'owner' | 'admin' | 'member' | null = $state(null);
	let myPerms = $state<PermissionFlags | null>(null);
	let isMemberDoc = $state(false);
	let profileMembership = $state(false);
	let myRoleIds: string[] = [];
	let lastServerId: string | null = null;
	let mentionHighlights: Set<string> = $state(new Set());

	// Basic notification prefs (subset of full settings)
	let notifDesktopEnabled = $state(false);
	let notifAllMessages = $state(false);
	function subscribeNotifPrefs() {
		if (!$user?.uid) return;
		const db = getDb();
		const ref = doc(db, 'profiles', $user.uid);
		return onSnapshot(ref, (snap) => {
			const s: any = snap.data()?.settings ?? {};
			const p: any = s.notificationPrefs ?? {};
			notifDesktopEnabled = !!p.desktopEnabled;
			notifAllMessages = !!p.allMessages;
		});
	}
	const stopNotif = subscribeNotifPrefs();

	function deriveOwnerId(data: any): string | null {
		return data?.ownerId ?? data?.owner ?? data?.createdBy ?? null;
	}

	function computeIsOwner(): boolean {
		return !!(ownerId && $user?.uid && $user.uid === ownerId);
	}

	function voiceInitial(name?: string): string {
		if (!name) return '?';
		return name.trim().charAt(0).toUpperCase() || '?';
	}

	function voiceAvatarURL(participant: VoiceParticipant): string | null {
		const cached = voiceProfileCache.get(participant.uid);
		const current = get(user);
		const merged = {
			...participant,
			...(cached ?? {}),
			photoURL: cached?.photoURL ?? participant.photoURL ?? null
		};
		if (current?.uid && current.uid === participant.uid) {
			merged.photoURL = merged.photoURL ?? current.photoURL ?? null;
			(merged as any).authPhotoURL = (merged as any).authPhotoURL ?? current.photoURL ?? null;
		}
		return resolveProfilePhotoURL(merged, merged.photoURL ?? null);
	}

	function resolveVoiceAvatar(member: VoiceParticipant): string | null {
		return voiceAvatarURL(member);
	}

	function isVoiceChannelActive(id: string): boolean {
		return !!(
			activeVoice &&
			activeVoice.serverId === computedServerId &&
			activeVoice.channelId === id
		);
	}

	function resetVoiceWatchers() {
		if (voiceUnsubs.size) {
			appendVoiceDebugEvent('sidebar', 'resetVoiceWatchers', {
				serverId: computedServerId ?? null,
				watcherCount: voiceUnsubs.size
			});
		}
		voiceUnsubs.forEach((unsub) => unsub());
		voiceUnsubs.clear();
		voicePresence = {};
	}

	function summarizeVoicePresence(
		state: Record<string, VoiceParticipant[]>
	): Record<string, unknown> {
		const summary: Record<string, unknown> = {};
		Object.entries(state).forEach(([channel, list]) => {
			summary[channel] = {
				count: list.length,
				participants: list.slice(0, 8).map((member) => ({
					uid: member.uid,
					hasAudio: member.hasAudio ?? true,
					hasVideo: member.hasVideo ?? false
				}))
			};
		});
		return summary;
	}

	function applyVoiceProfile(participant: VoiceParticipant): VoiceParticipant {
		const cached = voiceProfileCache.get(participant.uid);
		if (!cached) return participant;
		const cachedPhoto =
			typeof cached.photoURL === 'string' && cached.photoURL.trim().length ? cached.photoURL : null;
		const cachedName =
			typeof cached.displayName === 'string' && cached.displayName.trim().length
				? cached.displayName
				: null;
		return {
			...participant,
			displayName: cachedName ?? participant.displayName,
			photoURL: cachedPhoto ?? participant.photoURL ?? null
		};
	}

	function refreshVoicePresenceChannel(channelId: string) {
		const list = voicePresence[channelId];
		if (!Array.isArray(list) || !list.length) return;
		voicePresence = {
			...voicePresence,
			[channelId]: list.map((entry) => applyVoiceProfile(entry))
		};
	}

	async function hydrateVoiceProfiles(list: VoiceParticipant[], channelId: string) {
		const db = getDb();
		for (const participant of list) {
			const cached = voiceProfileCache.get(participant.uid);
			const missingDisplay =
				!participant.displayName ||
				participant.displayName === 'Member' ||
				participant.displayName === '?';
			const photo = typeof participant.photoURL === 'string' ? participant.photoURL.trim() : '';
			const missingPhoto = !photo || photo === '?' || isDefaultAvatarUrl(photo);
			// Fetch if we don't have a cache yet or if the participant looks incomplete.
			if (cached && cached.photoURL && !missingDisplay && !missingPhoto) continue;
			if (pendingVoiceProfiles.has(participant.uid)) continue;
			pendingVoiceProfiles.add(participant.uid);
			try {
				const snap = await getDoc(doc(db, 'profiles', participant.uid));
				pendingVoiceProfiles.delete(participant.uid);
				if (!snap.exists()) continue;
				const data = (snap.data() as any) ?? {};
				const displayNameCandidate =
					(typeof data.displayName === 'string' && data.displayName.trim()) ||
					(typeof data.name === 'string' && data.name.trim()) ||
					null;
				const photoURL = resolveProfilePhotoURL(data, participant.photoURL);
				voiceProfileCache.set(participant.uid, {
					displayName: displayNameCandidate,
					photoURL
				});
				refreshVoicePresenceChannel(channelId);
			} catch {
				pendingVoiceProfiles.delete(participant.uid);
			}
		}
	}

	function syncVoicePresenceWatchers(list: Chan[]) {
		if (!computedServerId) {
			resetVoiceWatchers();
			return;
		}

		const voiceChannels = list.filter((c) => c.type === 'voice');
		const voiceIds = new Set(voiceChannels.map((c) => c.id));

		if (browser) {
			appendVoiceDebugEvent('sidebar', 'syncVoicePresenceWatchers', {
				serverId: computedServerId ?? null,
				voiceChannelCount: voiceChannels.length
			});
		}

		voiceUnsubs.forEach((unsub, channelId) => {
			if (!voiceIds.has(channelId)) {
				if (browser) {
					appendVoiceDebugEvent('sidebar', 'voicePresenceWatcherRemoved', {
						serverId: computedServerId ?? null,
						channelId
					});
				}
				unsub();
				voiceUnsubs.delete(channelId);
				voicePresence = { ...voicePresence, [channelId]: [] };
			}
		});

		list.forEach((chan) => {
			if (chan.type !== 'voice' || voiceUnsubs.has(chan.id)) return;

			if (browser) {
				appendVoiceDebugEvent('sidebar', 'voicePresenceWatcherAdded', {
					serverId: computedServerId ?? null,
					channelId: chan.id,
					channelName: chan.name ?? null
				});
			}

			const db = getDb();
			const callDoc = doc(
				db,
				'servers',
				computedServerId,
				'channels',
				chan.id,
				'calls',
				CALL_DOC_ID
			);
			const participantsRef = collection(callDoc, 'participants');
			const unsub = onSnapshot(
				participantsRef,
				(snap) => {
					const participants = snap.docs
						.map((d) => {
							const data = d.data() as any;
							const status = (data.status ?? 'active') as 'active' | 'left';
							const normalize = (val: unknown) => (typeof val === 'string' ? val.trim() : '');
							const providedName =
								normalize(data.displayName) ||
								normalize((data.profile as any)?.displayName) ||
								normalize((data.profile as any)?.name) ||
								null;
							const providedPhoto =
								normalize(data.photoURL) ||
								normalize(data.photoUrl) ||
								normalize((data.profile as any)?.photoURL) ||
								normalize((data.profile as any)?.photoUrl) ||
								normalize(data.customPhotoURL) ||
								normalize(data.authPhotoURL) ||
								normalize(data.avatar) ||
								normalize(data.avatarUrl) ||
								normalize(data.avatarURL) ||
								normalize(data.photo) ||
								null;
							// Resolve avatar using participant photo first, then profile fields, then default, and apply any cached profile overrides.
							const basePhoto = resolveProfilePhotoURL(
								{ ...data, photoURL: providedPhoto },
								providedPhoto
							);
							const participant: VoiceParticipant = {
								uid: data.uid ?? d.id,
								displayName: providedName ?? 'Member',
								photoURL: basePhoto,
								hasAudio: data.hasAudio ?? false,
								hasVideo: data.hasVideo ?? false,
								status
							};
							const withProfile = applyVoiceProfile(participant);
							const finalPhoto = resolveProfilePhotoURL(withProfile, withProfile.photoURL ?? null);
							return { ...withProfile, photoURL: finalPhoto };
						})
						.filter((p) => p.status !== 'left');

					const enriched = participants.map((entry) => applyVoiceProfile(entry));
					voicePresence = { ...voicePresence, [chan.id]: enriched };
					hydrateVoiceProfiles(participants, chan.id);
					if (browser) {
						appendVoiceDebugEvent('sidebar', 'voicePresenceUpdate', {
							serverId: computedServerId ?? null,
							channelId: chan.id,
							count: participants.length
						});
					}
				},
				() => {
					voicePresence = { ...voicePresence, [chan.id]: [] };
					if (browser) {
						appendVoiceDebugEvent('sidebar', 'voicePresenceWatcherError', {
							serverId: computedServerId ?? null,
							channelId: chan.id
						});
					}
				}
			);

			voiceUnsubs.set(chan.id, unsub);
		});
	}

	function channelById(id: string): Chan | undefined {
		return channels.find((c) => c.id === id);
	}

	function channelTypeById(id: string): Chan['type'] | null {
		const chan = channelById(id);
		return chan?.type ?? null;
	}

	function defaultOrderIds(list: Chan[] = channels): string[] {
		return [...list]
			.sort((a, b) => {
				const pa = typeof a.position === 'number' ? a.position : 0;
				const pb = typeof b.position === 'number' ? b.position : 0;
				if (pa === pb) return (a.name ?? '').localeCompare(b.name ?? '');
				return pa - pb;
			})
			.map((c) => c.id);
	}

	function personalOrderIds(list: Chan[] = channels): string[] {
		if (!Array.isArray(myChannelOrder) || myChannelOrder.length === 0) return defaultOrderIds(list);
		const ids = list.map((c) => c.id);
		const seen = new Set<string>();
		const ordered: string[] = [];
		for (const id of myChannelOrder) {
			if (ids.includes(id) && !seen.has(id)) {
				ordered.push(id);
				seen.add(id);
			}
		}
		for (const id of ids) {
			if (!seen.has(id)) {
				ordered.push(id);
				seen.add(id);
			}
		}
		return ordered;
	}

	function mergeOrder(base: string[], target: string[]): string[] {
		const next: string[] = [];
		const seen = new Set<string>();
		for (const id of base) {
			if (target.includes(id) && !seen.has(id)) {
				next.push(id);
				seen.add(id);
			}
		}
		for (const id of target) {
			if (!seen.has(id)) {
				next.push(id);
				seen.add(id);
			}
		}
		return next;
	}

	function arraysEqual(a: string[], b: string[]): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i += 1) {
			if (a[i] !== b[i]) return false;
		}
		return true;
	}

	function applyOrder(ids: string[], list: Chan[]): Chan[] {
		const map = new Map(list.map((c) => [c.id, c]));
		const ordered: Chan[] = [];
		for (const id of ids) {
			const chan = map.get(id);
			if (chan) {
				ordered.push(chan);
				map.delete(id);
			}
		}
		map.forEach((chan) => ordered.push(chan));
		return ordered;
	}

	function getDisplayOrderIds(): string[] {
		if (reorderMode === 'default' || reorderMode === 'personal') {
			return workingOrder;
		}
		return canManageChannels ? defaultOrderIds() : personalOrderIds();
	}

	function reorderChannelsByDrag(
		sourceId: string,
		targetId: string,
		type: Chan['type'],
		placeAfter: boolean
	) {
		if (reorderMode === 'none' || !workingOrder.length) return;
		if (sourceId === targetId) return;
		const scoped = workingOrder
			.map((cid, index) => ({ cid, index }))
			.filter(({ cid }) => {
				const chan = channelById(cid);
				if (!chan) return false;
				if (reorderMode === 'default') return true;
				return canSeeChannel(chan);
			});

		const sourceEntry = scoped.find((entry) => entry.cid === sourceId);
		const targetEntry = scoped.find((entry) => entry.cid === targetId);
		if (!sourceEntry || !targetEntry) return;

		const result = [...workingOrder];
		result.splice(sourceEntry.index, 1);

		let targetIndex = targetEntry.index;
		if (sourceEntry.index < targetEntry.index) {
			targetIndex -= 1;
		}
		let insertIndex = placeAfter ? targetIndex + 1 : targetIndex;
		insertIndex = Math.max(0, Math.min(result.length, insertIndex));
		result.splice(insertIndex, 0, sourceEntry.cid);
		workingOrder = result;
	}

	function channelRowRefAction(node: HTMLElement, id: string) {
		channelRowRefs.set(id, node);
		return {
			update(nextId: string) {
				if (nextId === id) return;
				channelRowRefs.delete(id);
				id = nextId;
				channelRowRefs.set(id, node);
			},
			destroy() {
				channelRowRefs.delete(id);
			}
		};
	}

	function resetDragState() {
		if (channelLongPressTimer !== null) {
			clearTimeout(channelLongPressTimer);
			channelLongPressTimer = null;
		}
		draggingChannelId = null;
		draggingChannelType = null;
		dragOverChannelId = null;
		dragOverAfter = false;
		channelDragCandidateId = null;
		channelDragCandidateType = null;
		channelDragPointerId = null;
		channelDragStartY = 0;
		channelDragStartX = 0;
		channelDragCurrentY = 0;
		channelDragCurrentX = 0;
		channelDragMoved = false;
		channelDragArmed = false;
		suppressChannelClick = false;
	}

	function resetReorderState() {
		reorderMode = 'none';
		workingOrder = [];
	}

	function ensureWorkingOrder(type: Chan['type']): boolean {
		if (reorderMode !== 'none' && workingOrder.length) return true;
		if (canManageChannels) {
			reorderMode = 'default';
			workingOrder = defaultOrderIds();
			return true;
		}
		if (canReorderPersonal) {
			reorderMode = 'personal';
			workingOrder = personalOrderIds();
			return true;
		}
		return false;
	}

	function startChannelPointerDrag(event: PointerEvent, id: string, type: Chan['type']) {
		if (savingOrder) return;
		if (!canManageChannels && !canReorderPersonal) return;
		orderError = null;
		suppressChannelClick = false;
		channelDragPointerId = event.pointerId;
		channelDragStartY = event.clientY;
		channelDragStartX = event.clientX;
		channelDragMoved = false;

		// Clear any existing timer
		if (channelLongPressTimer !== null) {
			clearTimeout(channelLongPressTimer);
		}

		const isTouchEvent = event.pointerType === 'touch';

		if (isTouchEvent) {
			// Mobile: Require long-press before allowing drag
			channelDragArmed = false;

			// Store the initial position for long-press cancellation check
			const startY = event.clientY;
			const startX = event.clientX;

			// Start long-press timer
			channelLongPressTimer = window.setTimeout(() => {
				channelLongPressTimer = null;

				// Long-press completed - arm the drag and trigger haptic feedback
				channelDragArmed = true;
				channelDragCandidateId = id;
				channelDragCandidateType = type;

				// Set up reorder mode immediately so drag can start
				if (!ensureWorkingOrder(type)) {
					// Permission check failed
					resetDragState();
					resetReorderState();
					return;
				}

				// Haptic feedback (vibration)
				if ('vibrate' in navigator) {
					navigator.vibrate(50); // 50ms vibration
				}

				// Immediately start dragging mode - no need to wait for more movement
				draggingChannelId = id;
				draggingChannelType = type;

				// Set drag start position to CURRENT position (where finger is now)
				// Any further movement will reorder channels
				channelDragStartY = channelDragCurrentY || startY;
				channelDragStartX = channelDragCurrentX || startX;
			}, CHANNEL_LONG_PRESS_MS);
		} else {
			// Desktop: Immediate drag activation (old behavior)
			channelDragArmed = true;
			channelDragCandidateId = id;
			channelDragCandidateType = type;
		}
	}

	function updateChannelOrderFromPointer(clientY: number, sourceId: string, type: Chan['type']) {
		if (!ensureWorkingOrder(type)) return;
		const scopedIds = workingOrder.filter((cid) => {
			const chan = channelById(cid);
			if (!chan) return false;
			if (reorderMode === 'default') return true;
			return canSeeChannel(chan);
		});
		if (!scopedIds.length) return;
		let targetId = scopedIds[scopedIds.length - 1];
		let placeAfter =
			clientY >
			(channelRowRefs.get(targetId)?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY);
		for (const id of scopedIds) {
			const el = channelRowRefs.get(id);
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			const mid = rect.top + rect.height / 2;
			if (clientY < mid) {
				targetId = id;
				placeAfter = false;
				break;
			}
		}
		if (sourceId === targetId && !placeAfter) return;
		dragOverChannelId = targetId;
		dragOverAfter = placeAfter;
		reorderChannelsByDrag(sourceId, targetId, type, placeAfter);
	}

	function handleChannelPointerMove(event: PointerEvent) {
		if (channelDragPointerId !== event.pointerId) return;
		if (savingOrder) return;

		const deltaY = Math.abs(event.clientY - channelDragStartY);
		const deltaX = Math.abs(event.clientX - channelDragStartX);
		const totalDelta = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

		// If long-press timer is still running, track current position and check if user moved too far
		if (channelLongPressTimer !== null) {
			// Track current position for use when long-press completes
			channelDragCurrentY = event.clientY;
			channelDragCurrentX = event.clientX;

			if (totalDelta > CHANNEL_LONG_PRESS_MOVE_THRESHOLD_PX) {
				// User moved too much during long-press - cancel it (likely scrolling)
				resetDragState();
				resetReorderState();
			}
			// Don't start drag yet - wait for long-press to complete
			return;
		}

		// If drag not armed (long-press didn't complete on mobile), don't allow drag
		if (!channelDragArmed) return;

		// For desktop, check if we need to start dragging after threshold is crossed
		if (!draggingChannelId && channelDragCandidateId && deltaY >= CHANNEL_DRAG_THRESHOLD_PX) {
			if (
				!ensureWorkingOrder(
					channelDragCandidateType ?? channelTypeById(channelDragCandidateId) ?? 'text'
				)
			) {
				resetDragState();
				resetReorderState(); // Reset reorder state when permission check fails
				return;
			}
			draggingChannelId = channelDragCandidateId;
			draggingChannelType = channelDragCandidateType ?? channelTypeById(channelDragCandidateId);
			(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
		}

		if (!draggingChannelId || !draggingChannelType || reorderMode === 'none') return;
		event.preventDefault();
		channelDragMoved = true;
		suppressChannelClick = true;
		updateChannelOrderFromPointer(event.clientY, draggingChannelId, draggingChannelType);
	}

	async function handleChannelPointerUp(event: PointerEvent) {
		// Check if this was our pointer
		const wasOurPointer = channelDragPointerId === event.pointerId;
		const hadDraggingChannel = draggingChannelId;
		const hadDragMoved = channelDragMoved;

		// Reset pointer tracking state immediately (but not reorder state yet)
		channelDragPointerId = null;
		channelDragCandidateId = null;
		channelDragCandidateType = null;
		dragOverChannelId = null;
		dragOverAfter = false;

		// If not our pointer or not dragging, clean up completely and exit
		if (!wasOurPointer || !hadDraggingChannel || !hadDragMoved) {
			resetDragState();
			resetReorderState();
			return;
		}

		// Save the reorder (saveReorder() will reset state in its finally block)
		event.preventDefault();
		await saveReorder();
	}

	// ==================== Context Menu Functions for Mark as Read ====================

	function getChannelIdsForCategory(categoryId: string): string[] {
		return visibleChannels
			.filter((c) => c.categoryId === categoryId && c.type === 'text')
			.map((c) => c.id);
	}

	function getAllTextChannelIds(): string[] {
		return visibleChannels
			.filter((c) => c.type === 'text')
			.map((c) => c.id);
	}

	function getUnreadChannelIds(channelIds: string[]): string[] {
		return channelIds.filter((id) => hasUnread(id));
	}

	async function markAllAsRead(target: 'all' | 'category', categoryId?: string) {
		if (!$user?.uid || !computedServerId || markingAsRead) return;
		
		markingAsRead = true;
		try {
			let channelIds: string[];
			if (target === 'all') {
				channelIds = getAllTextChannelIds();
			} else if (categoryId) {
				channelIds = getChannelIdsForCategory(categoryId);
			} else {
				// Uncategorized channels
				channelIds = visibleChannels
					.filter((c) => !c.categoryId && c.type === 'text')
					.map((c) => c.id);
			}

			const unreadIds = getUnreadChannelIds(channelIds);
			if (!unreadIds.length) return;

			// Mark channels as read in Firestore
			await markMultipleChannelsRead($user.uid, computedServerId, unreadIds);

			// Also mark activity feed entries as read
			await markMultipleChannelsActivityRead(computedServerId, unreadIds);

			// Clear local unread state immediately for responsive UI
			const newLocalUnread = { ...localUnread };
			for (const id of unreadIds) {
				newLocalUnread[id] = false;
			}
			localUnread = newLocalUnread;

			// Haptic feedback on mobile
			if (browser && 'vibrate' in navigator) {
				navigator.vibrate(30);
			}
		} catch (err) {
			console.error('[ServerSidebar] Failed to mark channels as read:', err);
		} finally {
			markingAsRead = false;
		}
	}

	function openContextMenu(
		event: MouseEvent | PointerEvent,
		target: 'all' | 'category',
		categoryId?: string
	) {
		event.preventDefault();
		event.stopPropagation();
		contextMenuTarget = { type: target, categoryId };
		contextMenuRef?.show(event.clientX, event.clientY);
	}

	function startContextMenuLongPress(
		event: PointerEvent | TouchEvent,
		target: 'all' | 'category',
		categoryId?: string
	) {
		if (contextMenuLongPressTimer !== null) {
			clearTimeout(contextMenuLongPressTimer);
		}
		
		const touch = 'touches' in event ? event.touches[0] : event;
		contextMenuLongPressStart = { x: touch.clientX, y: touch.clientY };
		
		contextMenuLongPressTimer = window.setTimeout(() => {
			contextMenuLongPressTimer = null;
			if (contextMenuLongPressStart) {
				// Trigger haptic feedback
				if (browser && 'vibrate' in navigator) {
					navigator.vibrate(50);
				}
				contextMenuTarget = { type: target, categoryId };
				contextMenuRef?.show(contextMenuLongPressStart.x, contextMenuLongPressStart.y);
			}
		}, CONTEXT_MENU_LONG_PRESS_MS);
	}

	function handleContextMenuPointerMove(event: PointerEvent | TouchEvent) {
		if (!contextMenuLongPressStart) return;
		
		const touch = 'touches' in event ? event.touches[0] : event;
		const dx = Math.abs(touch.clientX - contextMenuLongPressStart.x);
		const dy = Math.abs(touch.clientY - contextMenuLongPressStart.y);
		
		if (dx > CONTEXT_MENU_LONG_PRESS_THRESHOLD || dy > CONTEXT_MENU_LONG_PRESS_THRESHOLD) {
			cancelContextMenuLongPress();
		}
	}

	function cancelContextMenuLongPress() {
		if (contextMenuLongPressTimer !== null) {
			clearTimeout(contextMenuLongPressTimer);
			contextMenuLongPressTimer = null;
		}
		contextMenuLongPressStart = null;
	}

	function getContextMenuItems() {
		if (!contextMenuTarget) return [];

		const target = contextMenuTarget.type;
		const categoryId = contextMenuTarget.categoryId;
		
		let channelIds: string[];
		let label: string;
		
		if (target === 'all') {
			channelIds = getAllTextChannelIds();
			label = 'Mark All Channels as Read';
		} else if (categoryId) {
			const cat = categories.find((c) => c.id === categoryId);
			channelIds = getChannelIdsForCategory(categoryId);
			label = `Mark "${cat?.name ?? 'Folder'}" as Read`;
		} else {
			channelIds = visibleChannels
				.filter((c) => !c.categoryId && c.type === 'text')
				.map((c) => c.id);
			label = 'Mark Uncategorized as Read';
		}

		const unreadCount = getUnreadChannelIds(channelIds).length;
		const hasUnreadChannels = unreadCount > 0;

		return [
			{
				label: hasUnreadChannels ? `${label} (${unreadCount})` : label,
				icon: 'bx-check-double',
				disabled: !hasUnreadChannels || markingAsRead,
				action: () => markAllAsRead(target, categoryId)
			}
		];
	}

	// ==================== End Context Menu Functions ====================

	function watchServerMeta(server: string) {
		unsubServerMeta?.();
		const db = getDb();
		const ref = doc(db, 'servers', server);
		unsubServerMeta = onSnapshot(
			ref,
			(snap) => {
				if (!snap.exists()) {
					serverName = 'Server';
					ownerId = null;
					serverIcon = null;
					return;
				}
				const data = snap.data() as any;
				serverName = data?.name ?? 'Server';
				serverIcon = typeof data?.icon === 'string' && data.icon.length ? data.icon : null;
				defaultRoleId = typeof data?.defaultRoleId === 'string' ? data.defaultRoleId : null;
				everyoneRoleId = typeof data?.everyoneRoleId === 'string' ? data.everyoneRoleId : null;
				serverIsPublic = data?.isPublic === true;
				ownerId = deriveOwnerId(data);
				if (computeIsOwner()) {
					myRole = 'owner';
				}
				
				maybeRefreshChannels(server);
			},
			(error) => {
				if ((error as any)?.code === 'permission-denied') {
					console.warn('[ServerSidebar] server meta permission denied', error);
				}
				serverName = 'Server';
				serverIcon = null;
				ownerId = null;
				defaultRoleId = null;
				everyoneRoleId = null;
				serverIsPublic = false;
				unsubServerMeta?.();
				unsubServerMeta = null;
			}
		);
	}

	function watchMyMember(server: string) {
		unsubMyMember?.();
		myRole = computeIsOwner() ? 'owner' : null;
		myPerms = null;
		isMemberDoc = false;
		myRoleIds = [];
		channelFetchDenied = false;
		channelVisibilityHint = null;

		if (!$user?.uid) return;

		const db = getDb();
		const ref = doc(db, 'servers', server, 'members', $user.uid);
		unsubMyMember = onSnapshot(
			ref,
			(snap) => {
				const data = snap.exists() ? (snap.data() as any) : null;
				isMemberDoc = snap.exists();
				const maybeRole = data?.role ?? null;
				myRole = computeIsOwner() ? 'owner' : (maybeRole as any);
				myPerms = data?.perms ?? null;
				myRoleIds = Array.isArray(data?.roleIds) ? data.roleIds : [];
				blockedChannelServers.delete(server);
				maybeRefreshChannels(server);
			},
			() => {
				myRole = computeIsOwner() ? 'owner' : null;
				myPerms = null;
				isMemberDoc = false;
				myRoleIds = [];
			}
		);
	}

	function watchProfileMembership(server: string) {
		profileMembership = false;
		if (!$user?.uid) return;
		const db = getDb();
		const ref = doc(db, 'profiles', $user.uid, 'servers', server);
		// Firestore rules also treat this profile doc as membership for isMember; we only use its existence.
		unsubProfileMembership = onSnapshot(
			ref,
			(snap) => {
				profileMembership = snap.exists();
				maybeRefreshChannels(server);
			},
			() => {
				profileMembership = false;
			}
		);
	}

	function channelRoleSet(): string[] {
		const roles: string[] = [];
		if (Array.isArray(myRoleIds)) roles.push(...myRoleIds);
		if (typeof defaultRoleId === 'string' && defaultRoleId.length) roles.push(defaultRoleId);
		if (typeof everyoneRoleId === 'string' && everyoneRoleId.length) roles.push(everyoneRoleId);
		return Array.from(new Set(roles.filter((id) => id && typeof id === 'string')));
	}

	function roleKeyFromSet(set: string[]): string {
		return set.slice().sort().join('|');
	}

	function maybeRefreshChannels(server: string) {
		if (!server) return;
		const key = roleKeyFromSet(channelRoleSet());
		if (server === currentChannelServer && key !== lastChannelRoleKey) {
			watchChannels(server);
		}
	}

	function watchChannelOrder(server: string) {
		unsubPersonalOrder?.();
		myChannelOrder = [];
		collapsedCategories = new Set();
		if (!$user?.uid) return;

		const db = getDb();
		const ref = doc(db, 'profiles', $user.uid, 'servers', server);
		unsubPersonalOrder = onSnapshot(
			ref,
			(snap) => {
				const data = snap.data() as any;
				if (Array.isArray(data?.channelOrder)) {
					myChannelOrder = data.channelOrder.filter((id: unknown) => typeof id === 'string');
				} else {
					myChannelOrder = [];
				}
				if (Array.isArray(data?.collapsedCategoryIds)) {
					collapsedCategories = new Set(
						data.collapsedCategoryIds.filter((id: unknown) => typeof id === 'string')
					);
				} else {
					collapsedCategories = new Set();
				}
			},
			() => {
				myChannelOrder = [];
				collapsedCategories = new Set();
			}
		);
	}

	function watchCategories(server: string) {
		unsubCategories?.();
		categories = [];
		const db = getDb();
		const catCol = collection(db, 'servers', server, 'categories');
		const qRef = query(catCol, orderBy('position'));
		unsubCategories = onSnapshot(qRef, (snap) => {
			categories = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Category[];
		});
	}

	async function saveCollapsedCategories(next: Set<string>) {
		const targetServerId = computedServerId;
		const uid = $user?.uid;
		if (!targetServerId || !uid) return;
		const db = getDb();
		const ids = Array.from(next).filter((id) => typeof id === 'string' && id.trim().length > 0);
		try {
			await setDoc(
				doc(db, 'profiles', uid, 'servers', targetServerId),
				{ collapsedCategoryIds: ids },
				{ merge: true }
			);
		} catch (error) {
			console.error('Failed to save folder collapse state', error);
		}
	}

	function toggleCategoryCollapse(categoryId: string) {
		const next = new Set(collapsedCategories);
		if (next.has(categoryId)) {
			next.delete(categoryId);
		} else {
			next.add(categoryId);
		}
		collapsedCategories = next; // trigger reactivity
		void saveCollapsedCategories(next);
	}

	// Category drag-and-drop handlers
	function startCategoryDrag(event: DragEvent, categoryId: string) {
		if (!canManageChannels) {
			console.log('[CategoryDrag] Cannot manage channels - aborting drag');
			return;
		}
		if (!event.dataTransfer) {
			console.log('[CategoryDrag] No dataTransfer - aborting drag');
			return;
		}
		console.log('[CategoryDrag] Starting drag for category:', categoryId);
		event.dataTransfer.setData('text/plain', categoryId);
		event.dataTransfer.effectAllowed = 'move';
		draggingCategoryId = categoryId;
		categoryDragStartY = event.clientY;
		categoryDragMoved = false;
	}

	function handleCategoryDragLeave(event: DragEvent) {
		// Only clear if we're leaving to something outside the channel list
		const relatedTarget = event.relatedTarget as HTMLElement | null;
		if (!relatedTarget?.closest('.channel-list')) {
			categoryDropTarget = null;
		}
	}

	async function handleCategoryDrop(event: DragEvent) {
		event.preventDefault();
		console.log('[CategoryDrop] Drop event, draggingCategoryId:', draggingCategoryId, 'target:', categoryDropTarget);
		if (!canManageChannels || !draggingCategoryId || !categoryDropTarget || !computedServerId) {
			console.log('[CategoryDrop] Aborting - missing data:', { canManageChannels, draggingCategoryId, categoryDropTarget, computedServerId });
			resetCategoryDragState();
			return;
		}

		const draggedId = draggingCategoryId;
		const target = categoryDropTarget;
		resetCategoryDragState();

		// Calculate new position for the dragged category based on where it's dropped
		let newPosition = 0;

		if (target.type === 'before-item' && typeof target.itemIndex === 'number') {
			const itemIndex = target.itemIndex;
			
			if (itemIndex === 0) {
				// Dropping at the very beginning
				const firstItem = unifiedDisplayList[0];
				if (firstItem) {
					if (firstItem.type === 'channel') {
						const pos = firstItem.channel.position;
						newPosition = typeof pos === 'number' ? pos - 1 : -1;
					} else {
						newPosition = firstItem.category.position - 1;
					}
				} else {
					newPosition = 0;
				}
			} else {
				// Dropping between two items - get position between prev and current
				const prevItem = unifiedDisplayList[itemIndex - 1];
				const currentItem = unifiedDisplayList[itemIndex];
				
				let prevPos = 0;
				if (prevItem) {
					if (prevItem.type === 'channel') {
						prevPos = typeof prevItem.channel.position === 'number' ? prevItem.channel.position : 0;
					} else {
						prevPos = prevItem.category.position;
					}
				}
				
				let currentPos = prevPos + 2;
				if (currentItem) {
					if (currentItem.type === 'channel') {
						currentPos = typeof currentItem.channel.position === 'number' ? currentItem.channel.position : prevPos + 2;
					} else {
						currentPos = currentItem.category.position;
					}
				}
				
				newPosition = (prevPos + currentPos) / 2;
			}
		} else if (target.type === 'end') {
			// Dropping at the end of the list
			const lastItem = unifiedDisplayList[unifiedDisplayList.length - 1];
			if (lastItem) {
				if (lastItem.type === 'channel') {
					const pos = lastItem.channel.position;
					newPosition = typeof pos === 'number' ? pos + 1 : 1;
				} else {
					newPosition = lastItem.category.position + 1;
				}
			} else {
				newPosition = 0;
			}
		}

		// Update the category position in Firestore
		try {
			const db = getDb();
			const { doc, updateDoc } = await import('firebase/firestore');
			await updateDoc(doc(db, 'servers', computedServerId, 'categories', draggedId), {
				position: newPosition
			});
		} catch (err) {
			console.error('Failed to reorder category:', err);
		}
	}

	function handleCategoryDragEnd() {
		resetCategoryDragState();
	}

	function resetCategoryDragState() {
		draggingCategoryId = null;
		categoryDropTarget = null;
		categoryDragMoved = false;
	}

	function mergeChannelSnapshots(list: Chan[]) {
		const map = new Map<string, Chan>();
		channels.forEach((c) => map.set(c.id, c));
		list.forEach((c) => map.set(c.id, c));
		const merged = Array.from(map.values());
		if (currentChannelServer) {
			applyChannelList(currentChannelServer, merged);
		} else {
			channels = sortChannelsByPosition(merged);
			syncVoicePresenceWatchers(channels);
		}
	}

	function watchChannels(server: string) {
		const roleKey = roleKeyFromSet(channelRoleSet());
		const roleSet = channelRoleSet();
		const blockedKey = blockedChannelServers.get(server);
		// Admins and members can read the full collection (rules allow member channel metadata); guests use filtered queries.
		const allowFullChannelQuery = isAdminLike || isMember;
		const switchingServer = currentChannelServer !== server;

		const stopChannelUnsubs = () => {
			unsubChannels?.();
			unsubChannels = null;
			unsubPublicChannels?.();
			unsubPublicChannels = null;
			unsubAllowedChannels?.();
			unsubAllowedChannels = null;
		};

		if (allowFullChannelQuery && blockedKey && blockedKey === roleKey) {
			channelFetchDenied = true;
			channelVisibilityHint =
				'You do not have permission to view channels. Ask an admin to allow @everyone/default role to view channels or add you to the server.';
			channels = [];
			syncVoicePresenceWatchers(channels);
			return;
		}

		stopChannelUnsubs();
		channelFetchDenied = false;
		let channelWatchBlocked = false;
		channelVisibilityHint = null;
		currentChannelServer = server;
		if (switchingServer || channels.length === 0) {
			const cached = readCachedChannels(server, allowFullChannelQuery);
			if (cached.length) {
				channels = cached;
				syncVoicePresenceWatchers(channels);
			} else if (switchingServer) {
				channels = [];
				syncVoicePresenceWatchers(channels);
			}
		}

		const db = getDb();
		const baseCol = collection(db, 'servers', server, 'channels');

		const mergeAndSortChannels = (lists: Chan[][]) => {
			const map = new Map<string, Chan>();
			lists.forEach((list) => list.forEach((c) => map.set(c.id, c)));
			applyChannelList(server, Array.from(map.values()));
			channelFetchDenied = false;
			channelVisibilityHint = null;
			lastChannelRoleKey = roleKeyFromSet(channelRoleSet());
		};

		const handleChannelError = (error: unknown, blockOnDeny = true) => {
			console.warn('[ServerSidebar] channel list error', error);
			const denied = (error as any)?.code === 'permission-denied';
			if (denied && !blockOnDeny) {
				channelVisibilityHint =
					channelVisibilityHint ??
					'Some channels may be hidden due to your current role permissions.';
				return;
			}
			channelFetchDenied = denied && blockOnDeny;
			channelVisibilityHint = channelFetchDenied
				? 'You do not have permission to view channels. Ask an admin to grant view access to the default role (@everyone) or add you to the server.'
				: 'Channel list is unavailable. Try reloading.';
			if (denied && blockOnDeny) {
				blockedChannelServers.set(server, roleKey);
				channelWatchBlocked = true;
				stopChannelUnsubs();
				channels = [];
				syncVoicePresenceWatchers(channels);
			}
		};

		// Filtered mode: public channels + private channels the member can see (role overlap)
		const startFilteredChannelQueries = () => {
			let publicChannels: Chan[] = [];
			const refresh = () => mergeAndSortChannels([publicChannels]);

			// Avoid composite index requirement by sorting client-side instead of ordering in Firestore.
			const qPublic = query(baseCol, where('isPrivate', '==', false));
			unsubPublicChannels = onSnapshot(
				qPublic,
				(snap) => {
					if (channelWatchBlocked) return;
					publicChannels = snap.docs.map((d: any) => ({
						id: d.id,
						...(d.data() as any)
					})) as Chan[];
					refresh();
				},
				(err) => handleChannelError(err, false)
			);
		};

		if (!allowFullChannelQuery) {
			startFilteredChannelQueries();
			return;
		}

		const qRef = query(baseCol, orderBy('position'));
		unsubChannels = onSnapshot(
			qRef,
			(snap) => {
				if (channelWatchBlocked) return;
				applyChannelList(
					server,
					snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })) as Chan[]
				);
				channelFetchDenied = false;
				channelVisibilityHint = null;
				lastChannelRoleKey = roleKeyFromSet(channelRoleSet());
			},
			(err) => {
				const denied = (err as any)?.code === 'permission-denied';
				handleChannelError(err, !denied);
				if (denied) {
					// Fall back to filtered queries instead of blanking the channel list.
					channelWatchBlocked = false;
					channelFetchDenied = false;
					channelVisibilityHint = null;
					startFilteredChannelQueries();
				}
			}
		);
	}

	function canSeeChannel(chan: Chan): boolean {
		if (isAdminLike) return true;

		const isPrivate = chan?.isPrivate === true;
		const isPublic = !isPrivate;

		// Public channels: mirror canViewChannel rule for public access (signed-in).
		if (isPublic) return !!$user?.uid;

		// Private channels: require membership and role overlap.
		if (!isMember) return false;

		const allowed = Array.isArray((chan as any)?.allowedRoleIds)
			? (chan as any).allowedRoleIds
			: [];
		if (!allowed.length) return false;

		const roles = channelRoleSet();
		if (!roles.length) return false;

		return allowed.some((roleId: string) => roles.includes(roleId));
	}

	let displayOrderIds: string[] = $state([]);
	let orderedChannels: Chan[] = $state([]);
	let visibleChannels: Chan[] = $state([]);

	// Create a unified display list that interleaves categories with channels by position
	// Categories can be positioned anywhere in the channel list
	type DisplayItem = 
		| { type: 'channel'; channel: Chan }
		| { type: 'category'; category: Category; channels: Chan[] };

	let unifiedDisplayList: DisplayItem[] = $derived.by(() => {
		// Group channels by category
		const uncategorized: Chan[] = [];
		const byCategory = new Map<string, Chan[]>();

		for (const ch of visibleChannels) {
			if (ch.categoryId) {
				const arr = byCategory.get(ch.categoryId) || [];
				arr.push(ch);
				byCategory.set(ch.categoryId, arr);
			} else {
				uncategorized.push(ch);
			}
		}

		// Create display items for categories with their position
		const categoryItems: { position: number; item: DisplayItem }[] = categories.map(cat => ({
			position: cat.position,
			item: { type: 'category', category: cat, channels: byCategory.get(cat.id) || [] }
		}));

		// Create display items for uncategorized channels with their position
		const channelItems: { position: number; item: DisplayItem }[] = uncategorized.map(ch => ({
			position: typeof ch.position === 'number' ? ch.position : Number.MAX_SAFE_INTEGER,
			item: { type: 'channel', channel: ch }
		}));

		// Combine and sort by position
		const allItems = [...categoryItems, ...channelItems].sort((a, b) => a.position - b.position);

		return allItems.map(i => i.item);
	});

	// Keep groupedChannels for backwards compatibility (used elsewhere)
	let groupedChannels: { category: Category | null; channels: Chan[] }[] = $derived.by(() => {
		const uncategorized: Chan[] = [];
		const byCategory = new Map<string, Chan[]>();

		for (const ch of visibleChannels) {
			if (ch.categoryId) {
				const arr = byCategory.get(ch.categoryId) || [];
				arr.push(ch);
				byCategory.set(ch.categoryId, arr);
			} else {
				uncategorized.push(ch);
			}
		}

		const groups: { category: Category | null; channels: Chan[] }[] = [];

		if (uncategorized.length > 0) {
			groups.push({ category: null, channels: uncategorized });
		}

		for (const cat of categories) {
			const chans = byCategory.get(cat.id) || [];
			groups.push({ category: cat, channels: chans });
		}

		return groups;
	});

	function subscribeAll(server: string) {
		const currentUser = get(user);
		if (!currentUser?.uid) return;
		
		resetVoiceWatchers();
		watchServerMeta(server);
		watchMyMember(server);
		watchProfileMembership(server);
		watchChannels(server);
		watchChannelOrder(server);
		watchCategories(server);
		reorderMode = 'none';
		workingOrder = [];
		orderError = null;
		savingOrder = false;
	}

	onDestroy(() => {
		unsubChannels?.();
		unsubPublicChannels?.();
		unsubAllowedChannels?.();
		unsubServerMeta?.();
		unsubMyMember?.();
		unsubProfileMembership?.();
		unsubPersonalOrder?.();
		unsubCategories?.();
		resetVoiceWatchers();
		unsubscribeVoiceSession();
		stopNotif?.();
		cancelContextMenuLongPress();
		removeVoiceDebugSection('serverSidebar.channels');
		removeVoiceDebugSection('serverSidebar.voicePresence');
		removeVoiceDebugSection('serverSidebar.voiceSession');
	});

	function pick(id: string) {
		if (reorderMode !== 'none') return;
		if (!id) return;
		const chan = channelById(id);
		if (chan?.type === 'voice') {
			if (browser) {
				appendVoiceDebugEvent('sidebar', 'pick voice channel', {
					serverId: computedServerId ?? null,
					channelId: id,
					channelName: chan.name ?? null
				});
			}
		}
		onPickChannel(id);
		dispatch('pick', id);
		// Optimistically clear unread badge for picked channel
		const entry = unreadByChannel[id];
		if (entry && (entry.high > 0 || entry.low > 0)) {
			unreadByChannel = { ...unreadByChannel, [id]: { high: 0, low: 0 } };
		}
	}

	function beginReorder() {
		orderError = null;
		resetDragState();
		if (canManageChannels) {
			reorderMode = 'default';
			workingOrder = defaultOrderIds();
		} else if (canReorderPersonal) {
			reorderMode = 'personal';
			workingOrder = personalOrderIds();
		}
	}

	function cancelReorder() {
		reorderMode = 'none';
		workingOrder = [];
		orderError = null;
		resetDragState();
	}

	async function saveReorder() {
		if (reorderMode === 'none' || savingOrder) return;
		if (!computedServerId) return;

		const ids = workingOrder.filter((id) => !!channelById(id));
		if (!ids.length) {
			reorderMode = 'none';
			workingOrder = [];
			return;
		}

		const database = getDb();
		orderError = null;
		savingOrder = true;

		try {
			if (reorderMode === 'default') {
				const batch = writeBatch(database);
				ids.forEach((id, index) => {
					batch.update(doc(database, 'servers', computedServerId, 'channels', id), {
						position: index
					});
				});
				await batch.commit();
			} else if (reorderMode === 'personal' && $user?.uid) {
				await setDoc(
					doc(database, 'profiles', $user.uid, 'servers', computedServerId),
					{ channelOrder: ids },
					{ merge: true }
				);
				myChannelOrder = ids;
			}
			reorderMode = 'none';
			workingOrder = [];
		} catch (error) {
			console.error('Failed to save channel order', error);
			orderError = 'Could not save channel order. Try again.';
		} finally {
			resetDragState();
			savingOrder = false;
		}
	}

	function openServerSettingsOverlay() {
		if (!computedServerId || !isAdminLike) return;
		openServerSettings({
			serverId: computedServerId,
			source: 'trigger'
		});
	}

	// Unread state map
	type ChannelIndicator = { high: number; low: number };
	let prevUnread: Record<string, number> = {};

	let computedServerId = $derived(
		serverId ?? $page.params.serverID ?? ($page.params as any).serverId ?? null
	);

	// Use $derived for reactive unread tracking from global store
	let unreadByChannel: Record<string, ChannelIndicator> = $derived.by(() => {
		const indicators = $channelIndicators ?? {};
		const serverKey = computedServerId ?? null;
		return serverKey ? (indicators[serverKey] ?? {}) : {};
	});

	// Simple local unread tracking - watches latest message per channel
	let localUnread: Record<string, boolean> = $state({});
	let channelWatchers = new Map<string, Unsubscribe>();
	let channelReadWatchers = new Map<string, Unsubscribe>();
	let lastReadTimestamps: Record<string, number | null> = {};
	let initialLoadComplete: Set<string> = new Set();
	let lastViewedChannel: string | null = null;

	// Track when user views a channel - mark it as read
run(() => {
	if (activeChannelId && activeChannelId !== lastViewedChannel) {
		lastViewedChannel = activeChannelId;
		// Mark channel as read when user views it
		const currentUnread = untrack(() => localUnread);
		if (currentUnread[activeChannelId] !== false) {
			localUnread = { ...currentUnread, [activeChannelId]: false };
		}
		// Update local timestamp to "now" so we don't show as unread after refresh
		lastReadTimestamps[activeChannelId] = Date.now();
			// Also mark activity entries as read
			if (computedServerId) {
				void markChannelActivityRead(computedServerId, activeChannelId);
			}
		}
	});

	// Helper to convert Firestore timestamp to millis
	function toMillis(value: any): number | null {
		if (!value) return null;
		if (typeof value === 'number') return value;
		if (value instanceof Date) return value.getTime();
		if (typeof value?.toMillis === 'function') return value.toMillis();
		if (typeof value?.seconds === 'number') return value.seconds * 1000;
		return null;
	}

	// Set up watchers for each text channel to detect new messages
	function setupChannelWatchers(chans: Chan[], sId: string | null, uid: string | null) {
		if (!browser || !sId || !uid) return;

		const db = getDb();
		const textChannels = chans.filter((c) => c.type === 'text');

		// Clean up old watchers for channels no longer in list
		for (const [channelId, unsub] of channelWatchers) {
			if (!textChannels.find((c) => c.id === channelId)) {
				unsub();
				channelWatchers.delete(channelId);
				channelReadWatchers.get(channelId)?.();
				channelReadWatchers.delete(channelId);
				initialLoadComplete.delete(channelId);
			}
		}

		// Set up new watchers
		for (const chan of textChannels) {
			if (channelWatchers.has(chan.id)) continue;

			// First, watch the user's read state for this channel
			const readDocRef = doc(db, 'profiles', uid, 'reads', `${sId}__${chan.id}`);
			const readUnsub = onSnapshot(
				readDocRef,
				(snap) => {
					const data = snap.data();
					lastReadTimestamps[chan.id] = toMillis(data?.lastReadAt) ?? null;
				},
				() => {
					// If no read doc exists, that's fine - they haven't read it yet
					lastReadTimestamps[chan.id] = null;
				}
			);
			channelReadWatchers.set(chan.id, readUnsub);

			// Then watch for latest messages
			const messagesRef = collection(db, 'servers', sId, 'channels', chan.id, 'messages');
			const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(1));

			const unsub = onSnapshot(
				q,
				(snap) => {
					if (snap.empty) return;
					const latestMsg = snap.docs[0].data();
					const msgTimestamp = toMillis(latestMsg?.createdAt);
					const lastRead = lastReadTimestamps[chan.id];
					const currentUid = $user?.uid;
					const isFirstLoad = !initialLoadComplete.has(chan.id);

					// Mark initial load complete
					initialLoadComplete.add(chan.id);

					// Skip if this is the active channel
					if (chan.id === activeChannelId) return;

					// Skip if message is from current user
					if (latestMsg?.authorId === currentUid) return;

					// Check if this message is newer than when user last read
					if (msgTimestamp && lastRead && msgTimestamp > lastRead) {
						localUnread = { ...localUnread, [chan.id]: true };
					} else if (!isFirstLoad && msgTimestamp) {
						// New message came in after initial load - mark as unread
						localUnread = { ...localUnread, [chan.id]: true };
					}
				},
				(err) => {
					// Silently ignore permission errors
				}
			);

			channelWatchers.set(chan.id, unsub);
		}
	}

	// Watch for channel list changes
	run(() => {
		if (browser && computedServerId && channels.length > 0) {
			setupChannelWatchers(channels, computedServerId, $user?.uid ?? null);
		}
	});

	// Cleanup on destroy
	onDestroy(() => {
		for (const unsub of channelWatchers.values()) {
			unsub();
		}
		channelWatchers.clear();
		for (const unsub of channelReadWatchers.values()) {
			unsub();
		}
		channelReadWatchers.clear();
		initialLoadComplete.clear();
	});

	// Combined unread check - use local tracking OR global store
	function hasUnread(channelId: string): boolean {
		const global = unreadByChannel[channelId];
		const globalUnread = (global?.high ?? 0) > 0 || (global?.low ?? 0) > 0;
		return globalUnread || localUnread[channelId] === true;
	}

	function hasHighPriority(channelId: string): number {
		return unreadByChannel[channelId]?.high ?? 0;
	}

	let unreadReady = $derived(Object.keys($channelIndicators ?? {}).length > 0 || true);

	run(() => {
		if (browser) {
			setVoiceDebugSection('serverSidebar.channels', {
				serverId: computedServerId ?? null,
				totalChannels: channels.length,
				voiceChannels: channels
					.filter((c) => c.type === 'voice')
					.map((c) => ({
						id: c.id,
						name: c.name,
						position: typeof c.position === 'number' ? c.position : null,
						isPrivate: !!c.isPrivate
					})),
				reorderMode,
				activeChannelId
			});
		}
	});
	run(() => {
		if (browser) {
			setVoiceDebugSection('serverSidebar.voicePresence', {
				serverId: computedServerId ?? null,
				watcherCount: voiceUnsubs.size,
				presence: summarizeVoicePresence(voicePresence)
			});
		}
	});
	run(() => {
		if (browser) {
			setVoiceDebugSection('serverSidebar.voiceSession', {
				activeVoice: activeVoice
					? {
							serverId: activeVoice.serverId,
							channelId: activeVoice.channelId,
							channelName: activeVoice.channelName
						}
					: null,
				computedServerId
			});
		}
	});
	run(() => {
		mentionHighlights = new Set(
			($notifications ?? [])
				.filter(
					(item) =>
						item.kind === 'channel' &&
						item.isMention &&
						item.serverId === computedServerId &&
						typeof item.channelId === 'string'
				)
				.map((item) => item.channelId as string)
		);
	});
	let isOwner = $derived(computeIsOwner());
	let isAdminLike = $derived(
		isOwner || myRole === 'admin' || !!(myPerms?.manageServer || myPerms?.manageRoles)
	);
	let canManageChannels = $derived(isOwner || !!myPerms?.manageChannels || !!myPerms?.manageServer);
	let canReorderPersonal = $derived(!!myPerms?.reorderChannels);
	const isMember = $derived(
		Boolean(
			isMemberDoc ||
			profileMembership ||
			myRole ||
			(Array.isArray(myRoleIds) && myRoleIds.length > 0)
		)
	);
	const noChannelsReason = $derived.by(() => {
		if (!$user?.uid) return 'Sign in to view channels.';
		if (channelFetchDenied) {
			return (
				channelVisibilityHint ??
				'You do not have permission to view channels. Ask an admin to allow @everyone/default role to view channels or add you to the server.'
			);
		}
		if (!channels.length) {
			if (canManageChannels) return 'Create the first channel to get started.';
			if (serverIsPublic && !isMember)
				return 'No public channels yet. Ask an admin to make one visible or add you.';
			if (!serverIsPublic && !isMember) return 'Join this server to view its channels.';
			return 'Channels exist but are not visible to your role. Ask an admin to grant access.';
		}
		if (!serverIsPublic && !isMember) return 'Join this server to view its channels.';
		if (serverIsPublic && !isMember) {
			return (
				channelVisibilityHint ??
				'All channels are private to members or specific roles. Ask an admin to add you or allow @everyone to view channels.'
			);
		}
		return (
			channelVisibilityHint ??
			'You do not have permission to view any channels. Ask an admin to adjust your role or default role permissions.'
		);
	});
	run(() => {
		// Track current working order separately to avoid reading and writing the same state inside this effect.
		workingOrderSnapshot = workingOrder;
	});
	run(() => {
		const currentOrder = workingOrderSnapshot;
		if (reorderMode === 'default') {
			const target = defaultOrderIds();
			const merged = mergeOrder(currentOrder.length ? currentOrder : target, target);
			if (!arraysEqual(currentOrder, merged)) workingOrder = merged;
		} else if (reorderMode === 'personal') {
			const target = personalOrderIds();
			const merged = mergeOrder(currentOrder.length ? currentOrder : target, target);
			if (!arraysEqual(currentOrder, merged)) workingOrder = merged;
		} else if (currentOrder.length) {
			workingOrder = [];
		}
	});
	run(() => {
		displayOrderIds = getDisplayOrderIds();
	});
	run(() => {
		orderedChannels = applyOrder(displayOrderIds, channels);
	});
	run(() => {
		// Explicitly reference reactive dependencies to ensure re-computation when roles change
		const _isMember = isMember;
		const _isAdminLike = isAdminLike;
		const _myRoleIds = myRoleIds;
		const _defaultRoleId = defaultRoleId;
		const _everyoneRoleId = everyoneRoleId;
		const _user = $user;
		// Re-filter channels when any role-related state changes
		visibleChannels = orderedChannels.filter(canSeeChannel);
	});
	run(() => {
		dispatch('channels', {
			serverId: computedServerId ?? null,
			channels: visibleChannels
		});
	});
	run(() => {
		const prevServer = untrack(() => lastServerId);
		const nextServer = computedServerId ?? null;
		if (nextServer && $user?.uid && nextServer !== prevServer) {
			lastServerId = nextServer;
			subscribeAll(nextServer);
		}
	});
	run(() => {
		if (browser && window.matchMedia('(min-width: 768px)').matches && computedServerId) {
			if (activeChannelId && !visibleChannels.some((c) => c.id === activeChannelId)) {
				const fallback = visibleChannels[0];
				if (fallback) pick(fallback.id);
			} else if (!activeChannelId && visibleChannels.length) {
				pick(visibleChannels[0].id);
			}
		}
	});
	run(() => {
		const totals: Record<string, number> = {};
		for (const id in unreadByChannel) {
			const entry = unreadByChannel[id];
			totals[id] = (entry?.high ?? 0) + (entry?.low ?? 0);
		}
		const previousTotals = untrack(() => prevUnread);
		if (
			browser &&
			unreadReady &&
			document.visibilityState === 'hidden' &&
			notifDesktopEnabled &&
			notifAllMessages
		) {
			try {
				for (const id in totals) {
					const curr = totals[id] ?? 0;
					const prev = previousTotals[id] ?? 0;
					if (curr > prev && id !== activeChannelId) {
						const chan = channels.find((c) => c.id === id);
						const title = chan?.name ? `#${chan.name}` : 'New message';
						new Notification(title, { body: `New messages in ${serverName}`, tag: `ch-${id}` });
					}
				}
			} catch {}
		}
		prevUnread = totals;
	});
</script>

{#snippet channelRow(c: Chan)}
	<div
		class={`channel-row ${activeChannelId === c.id || isVoiceChannelActive(c.id) ? 'channel-row--active' : ''} ${mentionHighlights.has(c.id) ? 'channel-row--mention' : ''} ${reorderMode !== 'none' && draggingChannelId === c.id ? 'channel-row--dragging' : ''} ${reorderMode !== 'none' && dragOverChannelId === c.id ? (dragOverAfter ? 'channel-row--drop-after' : 'channel-row--drop-before') : ''}`}
		role="listitem"
		draggable={false}
		use:channelRowRefAction={c.id}
		onpointerdown={(event) => startChannelPointerDrag(event, c.id, c.type)}
		onpointerenter={() => { if (serverId && c.type === 'text') onChannelHover(serverId, c.id); }}
	>
		<button
			type="button"
			class="channel-row__button"
			onclick={() => pick(c.id)}
			aria-label={`Open #${c.name} text channel`}
			aria-current={activeChannelId === c.id || isVoiceChannelActive(c.id) ? 'page' : undefined}
			title={c.name}
		>
			<span class="channel-icon {c.isPrivate ? 'channel-icon--private' : ''}">
				{#if c.type === 'voice'}
					<i class="bx bx-headphone" aria-hidden="true"></i>
				{:else}
					<i class="bx bx-hash" aria-hidden="true"></i>
				{/if}
				{#if c.isPrivate === true}
					<span class="channel-icon__lock" title="Private channel" aria-hidden="true">
						<i class="bx bx-lock text-[0.55rem]" aria-hidden="true"></i>
					</span>
				{/if}
			</span>
			<span class="channel-name truncate">{c.name}</span>
			<span class="channel-row__meta ml-auto">
				{#if mentionHighlights.has(c.id)}
					<span class="channel-mention-pill" title="You were mentioned">@</span>
				{/if}
				{#if c.type === 'voice'}
					{#if (voicePresence[c.id]?.length ?? 0) > 0}
						<span class="channel-voice-count">{voicePresence[c.id].length}</span>
					{/if}
				{:else if hasHighPriority(c.id) > 0}
					<span class="channel-unread" aria-label={`${hasHighPriority(c.id)} unread high priority messages`}>
						{hasHighPriority(c.id) > 99 ? '99+' : hasHighPriority(c.id)}
					</span>
				{:else if hasUnread(c.id)}
					<span class="channel-blue-dot" aria-hidden="true" title="New messages"></span>
				{/if}
			</span>
		</button>

		{#if c.type === 'voice'}
			{#if (voicePresence[c.id]?.length ?? 0) > 0}
				<div class="channel-voice-presence">
					{#each voicePresence[c.id].slice(0, 6) as member (member.uid)}
						{@const avatarUrl = resolveVoiceAvatar(member)}
						{@const cachedProfile = voiceProfileCache.get(member.uid)}
						<div class="channel-voice-avatar">
							<Avatar
								src={avatarUrl}
								user={cachedProfile ? { ...member, ...cachedProfile } : member}
								name={member.displayName}
								size="xs"
								isSelf={member.uid === $user?.uid}
							/>
						</div>
					{/each}
					{#if (voicePresence[c.id]?.length ?? 0) > 6}
						<div class="channel-voice-more">+{voicePresence[c.id].length - 6}</div>
					{/if}
				</div>
			{/if}

			{@const channelThreadList = (threads ?? []).filter(
				(thread) => thread.parentChannelId === c.id && thread.status !== 'archived'
			)}
			{@const joinableThreads = (availableThreads ?? []).filter(
				(at) => at.parentChannelId === c.id && 
					at.status !== 'archived' && 
					!channelThreadList.some((ct) => ct.id === at.id) &&
					currentUserId &&
					!(at.memberUids ?? []).includes(currentUserId)
			)}
			{#if channelThreadList.length || joinableThreads.length}
				<ul class="thread-list">
					{#each channelThreadList as thread (thread.id)}
						<li>
							<button
								type="button"
								class={`thread-row ${thread.id === activeThreadId ? 'is-active' : ''}`}
								onclick={(event) => {
									event.stopPropagation();
									onPickThread({ id: thread.id, parentChannelId: thread.parentChannelId ?? c.id });
								}}
							>
								<div class="thread-row__info">
									<i class="bx bx-message-square-dots" aria-hidden="true"></i>
									<span class="thread-row__name">{thread.name || 'Thread'}</span>
								</div>
								<div class="thread-row__meta">
									{#if thread.unread}
										<span class="thread-row__dot" aria-hidden="true"></span>
									{/if}
									{#if thread.messageCount}
										<span class="thread-row__count">{thread.messageCount}</span>
									{/if}
								</div>
							</button>
						</li>
					{/each}
					{#each joinableThreads as thread (thread.id)}
						<li>
							<button
								type="button"
								class="thread-row thread-row--joinable"
								onclick={(event) => {
									event.stopPropagation();
									onJoinThread({ id: thread.id, channelId: c.id });
								}}
								title="Click to join this thread"
							>
								<div class="thread-row__info">
									<i class="bx bx-message-square-add" aria-hidden="true"></i>
									<span class="thread-row__name">{thread.name || 'Thread'}</span>
								</div>
								<div class="thread-row__meta">
									<span class="thread-row__join">Join</span>
								</div>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
{/snippet}

<aside
	class="server-sidebar h-full w-full shrink-0 sidebar-surface flex flex-col border-r border-subtle text-primary"
	aria-label="Channels"
>
	<div
		class="server-sidebar__header h-11 px-2.5 flex items-center justify-between border-b border-subtle"
	>
		<button
			type="button"
			class="server-header__button"
			onclick={openServerSettingsOverlay}
			aria-label="Open server settings"
		>
			<span class="server-avatar">
				{#if serverIcon}
					<img src={serverIcon} alt={serverName} class="h-full w-full object-cover" />
				{:else}
					<span class="server-avatar__initial">{voiceInitial(serverName)}</span>
				{/if}
				<!-- Teal lock icon - visible on mobile only when admin -->
				{#if isAdminLike}
					<span class="server-avatar__lock md:hidden">
						<i class="bx bxs-lock-alt"></i>
					</span>
				{/if}
			</span>
			<span class="server-header__label hidden md:flex">
				<span class="server-label-row">
					<span class="server-name truncate" title={serverName}>{serverName}</span>
					{#if isOwner}
						<span class="badge-accent text-[10px] px-1.5 py-0.5">owner</span>
					{/if}
				</span>
			</span>
		</button>
	</div>

	{#if orderError}
		<div class="px-3 pt-2 text-xs text-red-300">{orderError}</div>
	{/if}

	<div
		class="channel-scroll-area flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 space-y-3 -webkit-overflow-scrolling-touch"
	>
		<!-- Channels heading - right-click/long-press for mark all as read -->
		{#if isAdminLike}
			<button
				type="button"
				class="channel-heading channel-heading--clickable md:cursor-default"
				onclick={openServerSettingsOverlay}
				oncontextmenu={(e) => openContextMenu(e, 'all')}
				onpointerdown={(e) => { if (e.pointerType === 'touch') startContextMenuLongPress(e, 'all'); }}
				onpointermove={handleContextMenuPointerMove}
				onpointerup={cancelContextMenuLongPress}
				onpointercancel={cancelContextMenuLongPress}
				aria-label="Open server settings">Channels</button
			>
		{:else}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div 
				class="channel-heading"
				oncontextmenu={(e) => openContextMenu(e, 'all')}
				onpointerdown={(e) => { if (e.pointerType === 'touch') startContextMenuLongPress(e, 'all'); }}
				onpointermove={handleContextMenuPointerMove}
				onpointerup={cancelContextMenuLongPress}
				onpointercancel={cancelContextMenuLongPress}
			>Channels</div>
		{/if}
		<div class="channel-list space-y-0.5">
			{#each unifiedDisplayList as item, itemIndex (item.type === 'category' ? `cat-${item.category.id}` : `ch-${item.channel.id}`)}
				<!-- Drop zone BEFORE this item (always rendered for admins, visible only when dragging) -->
				{#if canManageChannels && (item.type === 'channel' || (item.type === 'category' && item.category.id !== draggingCategoryId))}
					<div
						role="listitem"
						class="category-drop-zone {itemIndex === 0 ? '' : 'category-drop-zone--inline'} {draggingCategoryId ? 'category-drop-zone--visible' : ''} {categoryDropTarget?.type === 'before-item' && categoryDropTarget?.itemIndex === itemIndex ? 'category-drop-zone--active' : ''}"
						ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; categoryDropTarget = { type: 'before-item', itemIndex }; }}
						ondragleave={handleCategoryDragLeave}
						ondrop={handleCategoryDrop}
					>
						<div class="category-drop-zone__line"></div>
					</div>
				{/if}

				{#if item.type === 'category'}
					{@const cat = item.category}
					{@const categoryChannels = item.channels}
					<!-- Category Header - Draggable for admins, right-click/long-press for mark as read -->
					<div
						role="listitem"
						class="category-header-wrapper {draggingCategoryId === cat.id ? 'category-header--dragging' : ''}"
						draggable={canManageChannels ? 'true' : 'false'}
						ondragstart={(e) => startCategoryDrag(e, cat.id)}
						ondragend={handleCategoryDragEnd}
					>
						<button
							type="button"
							class="category-header"
							onclick={() => toggleCategoryCollapse(cat.id)}
							oncontextmenu={(e) => openContextMenu(e, 'category', cat.id)}
							onpointerdown={(e) => { if (e.pointerType === 'touch') startContextMenuLongPress(e, 'category', cat.id); }}
							onpointermove={handleContextMenuPointerMove}
							onpointerup={cancelContextMenuLongPress}
							onpointercancel={cancelContextMenuLongPress}
							draggable="false"
						>
							<i
								class="bx {collapsedCategories.has(cat.id) ? 'bx-chevron-right' : 'bx-chevron-down'}"
								aria-hidden="true"
							></i>
							<span class="category-name">{cat.name}</span>
							{#if canManageChannels}
								<i class="bx bx-grid-vertical category-drag-handle" aria-hidden="true" title="Drag to reorder"></i>
							{/if}
						</button>
					</div>
					<!-- Channels inside this category -->
					{#if !collapsedCategories.has(cat.id)}
						{#each categoryChannels as c (c.id)}
							{@render channelRow(c)}
						{/each}
					{/if}
				{:else}
					{@const c = item.channel}
					<!-- Uncategorized channel -->
					{@render channelRow(c)}
				{/if}
			{/each}

			<!-- Drop zone at END of list (always rendered for admins, visible only when dragging) -->
			{#if canManageChannels && unifiedDisplayList.length > 0}
				<div
					role="listitem"
					class="category-drop-zone category-drop-zone--inline {draggingCategoryId ? 'category-drop-zone--visible' : ''} {categoryDropTarget?.type === 'end' ? 'category-drop-zone--active' : ''}"
					ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; categoryDropTarget = { type: 'end' }; }}
					ondragleave={handleCategoryDragLeave}
					ondrop={handleCategoryDrop}
				>
					<div class="category-drop-zone__line"></div>
				</div>
			{/if}

			{#if !visibleChannels.length}
				<div class="text-xs text-soft px-3 py-2">{noChannelsReason}</div>
			{/if}
		</div>

		<ChannelCreateModal
			bind:open={showCreate}
			serverId={computedServerId}
			onClose={() => (showCreate = false)}
			onCreated={(id) => pick(id)}
		/>
	</div>
</aside>

<!-- Context menu for Mark All as Read -->
<ContextMenu
	bind:this={contextMenuRef}
	items={getContextMenuItems()}
	onClose={() => { contextMenuTarget = null; }}
/>

<svelte:window
	onpointermove={handleChannelPointerMove}
	onpointerup={handleChannelPointerUp}
	onpointercancel={handleChannelPointerUp}
	onblur={() => { resetDragState(); resetReorderState(); }}
	onvisibilitychange={() => { resetDragState(); resetReorderState(); }}
/>

<style>
	/* Mobile-first Discord-like styling */
	aside.server-sidebar {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		background: var(--color-sidebar);
		border: none;
	}

	.channel-scroll-area {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior: contain;
		/* Leave room for the mobile dock so the last channel isn't hidden */
		padding-bottom: calc(
			3.5rem + var(--mobile-dock-height, 3rem) + env(safe-area-inset-bottom, 0px)
		);
	}

	/* Desktop: add extra padding for the DesktopUserBar */
	@media (min-width: 768px) {
		.channel-scroll-area {
			padding-bottom: calc(var(--desktop-user-bar-height, 52px) + 3rem);
		}
	}

	@media (max-width: 767px) {
		.channel-scroll-area {
			/* Extra breathing room on mobile for scrolling to the very last channel */
			padding-bottom: calc(
				10rem + var(--mobile-dock-height, 3rem) + env(safe-area-inset-bottom, 0px)
			);
		}

		aside.server-sidebar {
			width: 100% !important;
			max-width: 100%;
			border-right: none !important;
		}
	}

	.server-sidebar__header {
		position: relative;
		min-height: 3rem;
		height: 3rem;
		padding: 0.35rem 0.75rem;
		display: flex;
		align-items: center;
		background: var(--color-sidebar);
		border-bottom: 1px solid var(--color-border-subtle);
		flex-shrink: 0;
	}

	/* On mobile, compact header with logo in safe area */
	@media (max-width: 767px) {
		.server-sidebar__header {
			height: auto;
			min-height: 2.5rem;
			/* Position logo up in the safe area, near the time */
			padding-top: calc(0.25rem + env(safe-area-inset-top, 0px) * 0.15);
			padding-bottom: 0.35rem;
			padding-left: 2.5rem; /* Moved further right */
			border-bottom: none;
			background: transparent;
			overflow: visible;
		}

		/* Bar behind icon - matches panel muted */
		.server-sidebar__header::before {
			content: '';
			position: absolute;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			background: var(--color-panel-muted);
			z-index: 0;
		}

		.server-sidebar__header > * {
			position: relative;
			z-index: 1;
		}
	}

	.server-header__button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.3rem 0.45rem;
		border-radius: 0.75rem;
		border: 1px solid transparent;
		background: transparent;
		text-align: left;
		user-select: none;
	}

	@media (max-width: 767px) {
		.server-header__button {
			width: auto;
			/* Reasonable tap area for the server header only */
			padding: 0.5rem 1rem 0.5rem 0.45rem;
			margin: 0;
			border-radius: 0.5rem;
		}
	}

	.server-header__button:disabled {
		opacity: 1;
		cursor: default;
	}

	.server-avatar {
		width: 2rem;
		height: 2rem;
		border-radius: 999px;
		overflow: visible; /* Allow lock icon to overflow */
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
		display: grid;
		place-items: center;
		flex-shrink: 0;
		position: relative;
	}

	.server-avatar img {
		border-radius: 999px;
	}

	/* Smaller avatar on mobile - compact fit */
	@media (max-width: 767px) {
		.server-avatar {
			width: 1.5rem;
			height: 1.5rem;
		}
	}

	.server-avatar__initial {
		font-weight: 700;
		font-size: 1rem;
	}

	@media (max-width: 767px) {
		.server-avatar__initial {
			font-size: 0.75rem;
		}
	}

	/* Teal lock icon positioned at bottom-right of avatar */
	.server-avatar__lock {
		position: absolute;
		bottom: -1px;
		right: -1px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--color-accent, #33c8bf); /* App teal color */
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		font-size: 6px;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
	}

	.server-header__label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	/* Hide server name/badge on mobile */
	@media (max-width: 767px) {
		.server-header__label {
			display: none !important;
		}
	}

	.server-label-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}

	.server-name {
		font-weight: 700;
		font-size: 1rem;
		color: var(--color-text-primary);
	}

	.channel-heading {
		font-weight: 800;
		font-size: 0.9rem;
		padding-left: 0.15rem;
		color: var(--color-text-primary);
	}

	/* Clickable channel heading for mobile admin access */
	.channel-heading--clickable {
		background: none;
		border: none;
		color: var(--color-text-primary);
		text-align: left;
		cursor: pointer;
		display: inline-block;
		width: auto;
		padding: 0.5rem 1rem 0.5rem 0.15rem;
		margin: -0.5rem 0 -0.5rem 0;
	}

	/* Category/folder header styling */
	.category-header-wrapper {
		position: relative;
		transition: transform 0.15s ease, opacity 0.15s ease;
	}

	.category-header-wrapper[draggable="true"] {
		cursor: grab;
	}

	.category-header-wrapper[draggable="true"]:active {
		cursor: grabbing;
	}

	.category-header--dragging {
		opacity: 0.5;
		transform: scale(0.98);
	}

	.category-header--drop-target::after {
		content: '';
		position: absolute;
		bottom: -2px;
		left: 0;
		right: 0;
		height: 3px;
		background: var(--color-accent);
		border-radius: 2px;
		animation: pulse-glow 1s ease-in-out infinite;
	}

	@keyframes pulse-glow {
		0%, 100% { opacity: 0.7; }
		50% { opacity: 1; }
	}

	.category-drop-zone {
		height: 0;
		position: relative;
		transition: height 0.15s ease, background 0.15s ease;
		overflow: visible;
		border-radius: 4px;
		margin: 0;
		background: transparent;
		pointer-events: none;
	}

	/* When dragging, show and enable drop zones */
	.category-drop-zone--visible {
		height: 20px;
		margin: 4px 0;
		pointer-events: auto;
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
	}

	.category-drop-zone--visible:hover,
	.category-drop-zone--active {
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
	}

	.category-drop-zone__line {
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		height: 3px;
		background: var(--color-accent);
		border-radius: 2px;
		transform: translateY(-50%) scaleX(0);
		opacity: 0;
		transition: all 0.15s ease;
	}

	.category-drop-zone--visible .category-drop-zone__line {
		transform: translateY(-50%) scaleX(0.3);
		opacity: 0.4;
	}

	.category-drop-zone--visible:hover .category-drop-zone__line,
	.category-drop-zone--active .category-drop-zone__line {
		transform: translateY(-50%) scaleX(1);
		opacity: 1;
	}

	.category-drop-zone--inline.category-drop-zone--visible {
		height: 16px;
		margin: 2px 0;
	}

	.channel-with-drop-zone {
		display: contents;
	}

	.category-header {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		width: 100%;
		padding: 0.35rem 0.25rem;
		margin-top: 0.5rem;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.025em;
		transition: color 0.15s ease;
	}

	.category-header:hover {
		color: var(--color-text-primary);
	}

	.category-header-wrapper:first-child .category-header {
		margin-top: 0;
	}

	.category-header i {
		font-size: 1rem;
		transition: transform 0.15s ease;
	}

	.category-drag-handle {
		opacity: 0;
		margin-left: auto;
		color: var(--color-text-muted);
		transition: opacity 0.15s ease;
	}

	.category-header-wrapper:hover .category-drag-handle {
		opacity: 0.6;
	}

	.category-header-wrapper:hover .category-drag-handle:hover {
		opacity: 1;
	}

	.category-name {
		flex: 1;
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.channel-list {
		user-select: none;
	}

	.channel-row {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		padding: 0.08rem 0.3rem;
		border-radius: var(--radius-md);
		background: transparent;
	}

	.channel-row:hover,
	.channel-row--active {
		background: transparent;
	}

	.channel-row--armed {
		transform: scale(1.06) translateY(-2px);
		transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
		z-index: 100;
		position: relative;
	}

	.channel-row--armed .channel-row__button {
		background: color-mix(in srgb, var(--color-accent) 22%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 70%, transparent);
		box-shadow:
			0 6px 16px color-mix(in srgb, var(--color-accent) 40%, transparent),
			0 0 0 3px color-mix(in srgb, var(--color-accent) 15%, transparent);
		cursor: grabbing !important;
	}

	/* Disable pointer events on button when armed for drag */
	.channel-row--armed .channel-row__button,
	.channel-row--armed .channel-row__button * {
		pointer-events: none !important;
	}

	.channel-row--dragging {
		opacity: 0.5;
		transform: scale(1.03);
		transition: opacity 0.2s ease;
	}

	/* Disable pointer events on button during drag so finger can move anywhere */
	.channel-row--dragging .channel-row__button,
	.channel-row--dragging .channel-row__button * {
		pointer-events: none !important;
	}

	.channel-row--drop-before::before,
	.channel-row--drop-after::after {
		content: '';
		position: absolute;
		left: 0.75rem;
		right: 0.75rem;
		height: 2px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 85%, transparent);
		pointer-events: none;
	}

	.channel-row--drop-before::before {
		top: 0;
		transform: translateY(-50%);
	}

	.channel-row--drop-after::after {
		bottom: 0;
		transform: translateY(50%);
	}

	.channel-row--mention .channel-row__button {
		border-left: 3px solid color-mix(in srgb, var(--color-accent) 70%, transparent);
		padding-left: 0.9rem;
	}

	.channel-row__button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.3rem 0.55rem;
		text-align: left;
		user-select: none;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 0.55rem;
		box-shadow: none;
		color: var(--color-text-secondary);
		transition:
			background 120ms ease,
			border-color 120ms ease,
			color 120ms ease;
	}

	.channel-row__button:hover,
	.channel-row__button:focus-visible,
	.channel-row__button:active {
		background: var(--button-ghost-hover);
		border-color: var(--color-border-subtle);
		box-shadow: none;
		outline: none;
		color: var(--color-text-primary);
	}

	.channel-row--active .channel-row__button {
		background: color-mix(in srgb, var(--color-accent) 16%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
		border-radius: 0.55rem;
		box-shadow: none;
		color: var(--color-text-primary);
		font-weight: 600;
	}

	.channel-icon {
		position: relative;
		width: 1.1rem;
		height: 1.1rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--color-text-secondary);
	}

	.channel-icon i {
		font-size: 1.05rem;
	}

	.channel-row--active .channel-icon {
		color: var(--color-text-primary);
	}

	.channel-icon__lock {
		position: absolute;
		right: -0.08rem;
		bottom: -0.1rem;
		display: grid;
		place-items: center;
		color: color-mix(in srgb, var(--color-accent) 78%, var(--color-text-primary) 22%);
		text-shadow: 0 0 6px rgba(0, 0, 0, 0.5);
		pointer-events: none;
	}

	.channel-icon__lock i {
		font-size: 0.6rem;
		line-height: 1;
	}

	.channel-row--active .channel-icon__lock {
		color: var(--color-text-primary);
		text-shadow: 0 0 8px color-mix(in srgb, var(--color-accent) 65%, transparent);
	}

	.channel-row--active .channel-row__button:hover,
	.channel-row--active .channel-row__button:focus-visible,
	.channel-row--active .channel-row__button:active {
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
		box-shadow: none;
		color: var(--color-text-primary);
	}

	.channel-name {
		font-size: 0.98rem;
		color: inherit;
	}

	.channel-voice-count {
		min-width: 1.25rem;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		color: var(--color-accent);
		font-size: 0.7rem;
		font-weight: 700;
		text-align: center;
	}

	.channel-voice-presence {
		display: flex;
		flex-wrap: wrap;
		gap: clamp(0.35rem, 1vw, 0.6rem);
		margin-top: 0.15rem;
		width: 100%;
		padding-left: clamp(2rem, 2vw + 1.3rem, 3rem);
	}

	.channel-voice-avatar {
		position: relative;
		width: clamp(1.8rem, 2vw + 1.1rem, 2.2rem);
		height: clamp(1.8rem, 2vw + 1.1rem, 2.2rem);
		border-radius: 999px;
		overflow: hidden;
		background: color-mix(in srgb, var(--color-accent) 16%, transparent);
	}

	.channel-voice-more {
		width: clamp(1.8rem, 2vw + 1.1rem, 2.2rem);
		height: clamp(1.8rem, 2vw + 1.1rem, 2.2rem);
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 16%, transparent);
		color: var(--color-accent);
		display: grid;
		place-items: center;
		font-size: 0.85rem;
		font-weight: 700;
	}

	.channel-mention-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 22%, transparent);
		color: var(--color-accent);
		font-size: 0.68rem;
		font-weight: 700;
	}

	.channel-thread-unread-dot {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: var(--color-accent);
		display: inline-flex;
	}

	.thread-list {
		list-style: none;
		margin: 0.2rem 0 0.35rem 2rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.thread-row {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		background: var(--button-ghost-bg);
		border-radius: 0.6rem;
		border: 1px solid transparent;
		padding: 0.35rem 0.45rem;
		color: var(--color-text-secondary);
		font-size: 0.8rem;
	}

	.thread-row:hover,
	.thread-row.is-active {
		border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
		color: var(--color-text-primary);
	}

	.thread-row__info {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.thread-row__info i {
		font-size: 1rem;
		opacity: 0.65;
	}

	.thread-row__meta {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.thread-row__dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 999px;
		background: var(--color-accent);
		display: inline-block;
	}

	.thread-row__count {
		font-size: 0.7rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
	}

	.thread-row--joinable {
		opacity: 0.6;
		border-style: dashed;
	}

	.thread-row--joinable:hover {
		opacity: 1;
		border-color: color-mix(in srgb, var(--color-success, #22c55e) 50%, transparent);
	}

	.thread-row--joinable .thread-row__info i {
		color: var(--color-success, #22c55e);
	}

	.thread-row__join {
		font-size: 0.65rem;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-success, #22c55e) 15%, transparent);
		color: var(--color-success, #22c55e);
		font-weight: 500;
	}
</style>
