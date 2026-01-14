<script lang="ts">
	import { run } from 'svelte/legacy';

	import { onMount, onDestroy, untrack } from 'svelte';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { afterNavigate, goto } from '$app/navigation';
	import { user, userProfile } from '$lib/stores/user';
	import { matchKeybind, mergeKeybinds } from '$lib/settings/keybinds';

	import LeftPane from '$lib/components/app/LeftPane.svelte';
	import ServerSidebar from '$lib/components/servers/ServerSidebar.svelte';
	import ChannelHeader from '$lib/components/servers/ChannelHeader.svelte';
	import MembersPane from '$lib/components/servers/MembersPane.svelte';
	import ThreadMembersPane from '$lib/components/servers/ThreadMembersPane.svelte';
	import ChannelMessagePane from '$lib/components/servers/ChannelMessagePane.svelte';
	import ChannelPinnedBar from '$lib/components/servers/ChannelPinnedBar.svelte';
	import ChannelSettingsSheet from '$lib/components/servers/ChannelSettingsSheet.svelte';
	import ThreadPane from '$lib/components/chat/ThreadPane.svelte';
	import VideoChat from '$lib/components/voice/VideoChat.svelte';
	import CallPreview from '$lib/components/voice/CallPreview.svelte';
	import VoiceParticipantsPanel from '$lib/components/voice/VoiceParticipantsPanel.svelte';
	import { voiceSession } from '$lib/stores/voice';
	import type { VoiceSession } from '$lib/stores/voice';

	import { db } from '$lib/firestore/client';
	import {
		collection,
		collectionGroup,
		doc,
		onSnapshot,
		orderBy,
		query,
		getDocs,
		getDoc,
		endBefore,
		limitToLast,
		where,
		limit,
		setDoc,
		type Unsubscribe
	} from 'firebase/firestore';
	import {
		sendChannelMessage,
		submitChannelForm,
		toggleChannelReaction,
		voteOnChannelPoll,
		subscribePinnedMessages,
		unpinChannelMessage,
		pinChannelLink,
		type PinnedMessage
	} from '$lib/firestore/messages';
	import type { ReplyReferenceInput } from '$lib/firestore/messages';
	import {
		subscribeServerDirectory,
		type MentionDirectoryEntry
	} from '$lib/firestore/membersDirectory';
	import { SPECIAL_MENTIONS } from '$lib/data/specialMentions';
	import {
		createChannelThread,
		getThread,
		sendThreadMessage,
		streamChannelThreads,
		streamThreadMessages,
		markThreadRead as markThreadReadThread,
		THREAD_DEFAULT_TTL_HOURS,
		THREAD_MAX_MEMBER_LIMIT,
		type ChannelThread,
		type ThreadMessage
	} from '$lib/firestore/threads';
	import { subscribeTicketAiSettings, subscribeToTicketedMessageIds, type TicketAiSettings } from '$lib/firestore/ticketAi';
	import { markChannelRead } from '$lib/firebase/unread';
	import { markChannelActivityRead } from '$lib/stores/activityFeed';
	import { uploadChannelFile } from '$lib/firebase/storage';
	import { looksLikeImage } from '$lib/utils/fileType';
	import type { PendingUploadPreview } from '$lib/components/chat/types';
	import { resolveProfilePhotoURL } from '$lib/utils/profile';
	import { openOverlay, closeOverlay, mobileSwipeProgress } from '$lib/stores/mobileNav';
	import { mobileDockSuppressed } from '$lib/stores/ui';
	import { SERVER_CHANNEL_MEMORY_KEY } from '$lib/constants/navigation';
	import {
		timeServerSwitch,
		timeChannelSwitch,
		timeMessageSend,
		sendChannelMessageOptimized,
		getPendingMessages,
		mergeWithPending,
		cleanupChannelListeners,
		initializeOutbox,
		getThreadViewMemory,
		threadKey,
		setThreadViewMemory
	} from '$lib/perf';
	import {
		getCachedChannelMessages,
		updateChannelCache,
		hasChannelCache,
		type CachedMessage
	} from '$lib/stores/messageCache';

	interface Props {
		data: { serverId: string | null };
	}

	let { data }: Props = $props();

	const resolveServerId = (
		params: Record<string, string | undefined>,
		fallback: string | null | undefined
	) => params.serverID ?? params.serversID ?? params.serverId ?? fallback ?? null;

	let serverId = $state<string | null>(null);
	let activeKeybinds = $state(mergeKeybinds(null));
	run(() => {
		serverId = resolveServerId(
			$page.params as Record<string, string | undefined>,
			data?.serverId ?? null
		);
	});
	run(() => {
		activeKeybinds = mergeKeybinds($userProfile?.settings?.keybinds ?? null);
	});

	type Channel = {
		id: string;
		name: string;
		type: 'text' | 'voice';
		position?: number;
		isPrivate?: boolean;
		allowedRoleIds?: string[];
	};
	type ChannelEventDetail = { serverId: string | null; channels: Channel[] };
	type MentionSendRecord = {
		uid: string;
		handle: string | null;
		label: string | null;
		color?: string | null;
		kind?: 'member' | 'role' | 'special';
	};
	type ThreadPreviewMeta = {
		threadId: string;
		count: number;
		lastAt?: number;
		status: ChannelThread['status'];
		name?: string;
		unread?: boolean;
		archived?: boolean;
		preview?: string | null;
	};

	let channels: Channel[] = $state([]);
	let activeChannel: Channel | null = $state(null);
	let requestedChannelId: string | null = $state(null);
	let requestedMessageId: string | null = $state(null);
	let requestedThreadId: string | null = $state(null);
	let isPopupMode: boolean = $state(false);
	let popupThreadHandled = false;
	let handledRequestedChannelId: string | null = null;
	let channelListServerId: string | null = null;
	let routerReady = false;
	let messages: any[] = $state([]);
	let messagesLoading = $state(false);
	
	// Merge pending (local echo) messages with confirmed messages
	const mergedMessages = $derived.by(() => {
		if (!serverId || !activeChannel?.id) return messages;
		const channelKey = `${serverId}:${activeChannel.id}`;
		return mergeWithPending(messages, channelKey);
	});
	
	let lastReadMessageIds: Record<string, string | null> = {};
	let messagesLoadError: string | null = $state(null);
	let lastSidebarChannels: ChannelEventDetail | null = $state(null);
	let channelThreads: ChannelThread[] = $state([]);
	let threadsByChannel: Record<string, ChannelThread[]> = $state({});
	let serverThreadsUnsub: Unsubscribe | null = null;
	let serverThreadsScope: string | null = null;
	let threadServerScope: string | null = null;
	let threadStats: Record<string, ThreadPreviewMeta> = $state({});
	let activeThreadRoot: any = $state(null);
	let activeThread: ChannelThread | null = $state(null);
	let threadMessages: ThreadMessage[] = $state([]);
	let threadReplyTarget: ReplyReferenceInput | null = $state(null);
	let threadConversationContext: any[] = $state([]);
	let threadDefaultSuggestionSource: any = $state(null);
	let threadUnreadMap: Record<string, boolean> = $state({});
	let channelThreadUnread: Record<string, boolean> = $state({});
	let latestInboundMessage: any = $state(null);
	let aiConversationContext: any[] = $state([]);
	let aiAssistEnabled = $state(true);
	let replyTarget: ReplyReferenceInput | null = $state(null);
	let lastReplyChannelId: string | null = null;
	let profiles: Record<string, any> = $state({});
	let pendingUploads: PendingUploadPreview[] = $state([]);
	let threadPendingUploads: PendingUploadPreview[] = $state([]);
	let scrollToBottomSignal = $state(0);
	let lastPendingChannelId: string | null = null;
	let lastThreadUploadThreadId: string | null = null;
	let lastFloatingUploadThreadId: string | null = null;
	let pendingThreadId: string | null = null;
	let pendingThreadRoot: any = null;
	const threadReadStops = new Map<string, Unsubscribe>();
	let threadReadCursors: Record<string, number | null> = {};
	let threadsUnsub: Unsubscribe | null = null;
	let threadMessagesUnsub: Unsubscribe | null = null;
	let lastThreadStreamChannel: string | null = null;
	let lastThreadStreamId: string | null = null;
	let threadReadTimer: number | null = null;
	// Ticket AI staff detection
	let ticketAiSettings: TicketAiSettings | null = $state(null);
	let ticketAiSettingsUnsub: Unsubscribe | null = null;
	let ticketAiSettingsServerId: string | null = null;
	// Track message IDs that already have tickets
	let ticketedMessageIds = $state<Set<string>>(new Set());
	let ticketedMsgUnsub: Unsubscribe | null = null;
	let ticketedMsgChannelId: string | null = null;
	const isTicketAiStaff = $derived.by(() => {
		if (!ticketAiSettings?.enabled) return false;
		const uid = $user?.uid;
		const email = $user?.email;
		if (!uid && !email) return false;
		// Check if user is in staffMemberIds
		if (uid && ticketAiSettings.staffMemberIds?.includes(uid)) return true;
		// Check if user email matches staffDomains
		if (email && ticketAiSettings.staffDomains?.length) {
			const lowerEmail = email.toLowerCase();
			for (const domain of ticketAiSettings.staffDomains) {
				if (lowerEmail.endsWith(domain.toLowerCase())) return true;
			}
		}
		return false;
	});
	const THREAD_PANE_MIN = 320;
	const THREAD_PANE_MAX = 1600;
	let threadPaneWidth = $state(360);
	let threadResizeActive = $state(false);
	let threadResizeStartX = 0;
	let threadResizeStartWidth = 360;
	let threadMembersContext = $state<'active' | 'floating'>('active');
	let floatingThreadMembersId: string | null = $state(null);
	
	// Multi-popup floating threads
	type FloatingThreadInstance = {
		id: string;
		thread: ChannelThread;
		root: any;
		messages: ThreadMessage[];
		replyTarget: ReplyReferenceInput | null;
		conversationContext: any[];
		defaultSuggestionSource: any;
		pendingUploads: PendingUploadPreview[];
		position: { x: number; y: number };
		stream: Unsubscribe | null;
	};
	let floatingThreads = $state<FloatingThreadInstance[]>([]);
	let activeFloatingDragId: string | null = null;
	let floatingDragStart = { x: 0, y: 0 };
	let floatingWindowStart = { x: 0, y: 0 };
	let floatingDragPointerId: number | null = null;
	
	// Legacy single-thread state (for backward compatibility during transition)
	let floatingThreadVisible = $derived(floatingThreads.length > 0);
	let floatingThread = $derived(floatingThreads[0] ?? null);
	let floatingThreadMessages = $derived(floatingThreads[0]?.messages ?? []);
	let floatingThreadReplyTarget = $derived(floatingThreads[0]?.replyTarget ?? null);
	let floatingThreadConversationContext = $derived(floatingThreads[0]?.conversationContext ?? []);
	let floatingThreadDefaultSuggestionSource = $derived(floatingThreads[0]?.defaultSuggestionSource ?? null);
	let floatingThreadPendingUploads = $derived(floatingThreads[0]?.pendingUploads ?? []);
	let floatingThreadPosition = $derived(floatingThreads[0]?.position ?? { x: 0, y: 0 });
	
	let channelMessagesPopout = $state(false);
	let channelMessagesPopoutChannelId: string | null = $state(null);
	let channelMessagesPopoutChannelName = $state('');
	let channelMessagesPopoutPosition = $state({ x: 0, y: 0 });
	let channelMessagesDragActive = $state(false);
	let channelMessagesDragStart = { x: 0, y: 0 };
	let channelMessagesWindowStart = { x: 0, y: 0 };
	let channelMessagesPointerId: number | null = null;
	const CHANNEL_POP_MIN_WIDTH = 360;
	const CHANNEL_POP_MAX_WIDTH = 1200;
	const CHANNEL_POP_MIN_HEIGHT = 320;
	const CHANNEL_POP_MAX_HEIGHT = 1000;
	let channelMessagesWidth = $state(520);
	let channelMessagesHeight = $state(520);
	let channelMessagesResizeActive = $state(false);
	let channelMessagesResizeEdge = $state<
		| 'left'
		| 'right'
		| 'top'
		| 'bottom'
		| 'bottom-right'
		| 'bottom-left'
		| 'top-right'
		| 'top-left'
		| null
	>(null);
	let channelMessagesResizeStartX = 0;
	let channelMessagesResizeStartY = 0;
	let channelMessagesResizeStartWidth = 520;
	let channelMessagesResizeStartHeight = 520;
	let channelMessagesResizeStartPos = { x: 0, y: 0 };
	let channelMessagesResizePointerId: number | null = null;
	const CHANNEL_POP_MIN_VISIBLE = 180;
	const CHANNEL_POP_RESIZE_DEADBAND = 3;
	let popoutMessages: any[] = $state([]);
	let popoutProfiles: Record<string, any> = $state({});
	let popoutMessagesUnsub: (() => void) | null = null;
	const popoutProfileUnsubs: Record<string, Unsubscribe> = {};
	let popoutEarliestLoaded: any = null;
	let popoutReplyTarget = $state<ReplyReferenceInput | null>(null);
	let lastPopoutReplyChannelId: string | null = null;
	let popoutPendingUploads: PendingUploadPreview[] = $state([]);
	let lastPopoutPendingChannelId: string | null = null;
	let popoutScrollToBottomSignal = $state(0);
	const CALL_PANEL_MIN = 320;
	const CALL_PANEL_MAX = 1600;
	const FLOATING_CHAT_DEFAULT_WIDTH = 480;
	const FLOATING_CHAT_DEFAULT_HEIGHT = 520;
	const FLOATING_CHAT_MARGIN = 24;
	let callPanelWidth = $state(420);
	let callPanelResizeActive = $state(false);
	let callPanelResizeStartX = 0;
	let callPanelResizeStartWidth = 360;
	let callPanelTab = $state<'chat' | 'members'>('chat');
	let callPanelOpen = $state(false);
	let floatingCallChatVisible = $state(false);
	let floatingCallChatPosition = $state({ x: 0, y: 0 });
	let floatingCallChatDragActive = $state(false);
	let floatingCallChatDragStart = { x: 0, y: 0 };
	let floatingCallChatWindowStart = { x: 0, y: 0 };
	let floatingCallChatWidth = $state(FLOATING_CHAT_DEFAULT_WIDTH);
	let floatingCallChatResizeActive = $state(false);
	let floatingCallChatResizeStartX = 0;
	let floatingCallChatResizeStartWidth = 480;
	let floatingCallChatHeight = $state(FLOATING_CHAT_DEFAULT_HEIGHT);
	let floatingCallChatResizeStartY = 0;
	let floatingCallChatResizeStartHeight = 520;
	let floatingCallChatResizeStartPos = { x: 0, y: 0 };
	let floatingCallChatResizeEdge:
		| 'left'
		| 'right'
		| 'top'
		| 'bottom'
		| 'bottom-right'
		| 'bottom-left'
		| 'top-right'
		| 'top-left'
		| null = null;
	let callChatHeaderPointerId: number | null = null;
	let lastVoiceVisible = false;
	const profileUnsubs: Record<string, Unsubscribe> = {};
	let serverDisplayName = $state('Server');
	let serverMetaUnsub: Unsubscribe | null = null;
	let serverOwnerId: string | null = $state(null);
	let myRole: string | null = $state(null);
	let myPerms: { manageServer?: boolean; manageRoles?: boolean } | null = $state(null);
	let memberPermsUnsub: Unsubscribe | null = null;
	let memberPermsServer: string | null = null;
	let pinnedMessages = $state<PinnedMessage[]>([]);
	let pinnedMessageIds = $state<Set<string>>(new Set());
	let pinnedUnsub: Unsubscribe | null = null;
	let pinnedServerId: string | null = null;
	let pinnedChannelId: string | null = null;
	let popoutPinnedMessageIds = $state<Set<string>>(new Set());
	let popoutPinnedUnsub: Unsubscribe | null = null;
	let popoutPinnedChannelId: string | null = null;
	let channelSettingsOpen = $state(false);
	let mentionOptions: MentionDirectoryEntry[] = $state([]);
	let memberMentionOptions: MentionDirectoryEntry[] = $state([]);
	let roleMentionOptions: MentionDirectoryEntry[] = $state([]);
	let mentionDirectoryStop: Unsubscribe | null = null;
	let mentionRolesStop: Unsubscribe | null = null;
	let lastMentionServer: string | null = null;
	let isCurrentServerMember = false;
	let memberEnsurePromise: Promise<void> | null = null;
	const canPinMessages = $derived.by(() => {
		const isOwner = Boolean(serverOwnerId && $user?.uid && serverOwnerId === $user.uid);
		const admin = myPerms?.manageServer === true || myPerms?.manageRoles === true;
		const adminRole = myRole === 'owner' || myRole === 'admin';
		return isOwner || admin || adminRole;
	});

	const canonicalHandle = (value: string) =>
		(value ?? '')
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '');

	const findChannelName = (channelId: string | null | undefined) => {
		if (!channelId) return null;
		const channel = channels.find((c) => c.id === channelId);
		return channel?.name ?? null;
	};

	const deriveOwnerId = (data: any) => data?.ownerId ?? data?.owner ?? data?.createdBy ?? null;

	const parentChannelNameForThread = (
		thread: ChannelThread | null,
		fallbackChannel: Channel | null = activeChannel
	) => {
		const channelId = thread?.parentChannelId ?? thread?.channelId ?? fallbackChannel?.id ?? null;
		return findChannelName(channelId) ?? fallbackChannel?.name ?? null;
	};

	function updateMentionOptionList() {
		mentionOptions = [...SPECIAL_MENTIONS, ...memberMentionOptions, ...roleMentionOptions];
	}

	function buildRoleMentionEntry(roleId: string, data: any): MentionDirectoryEntry {
		const label = pickString(data?.name) ?? 'Role';
		const color = pickString(data?.color) ?? null;
		const base = canonicalHandle(label) || 'role';
		const suffix = roleId.slice(-4).toLowerCase();
		const handle = `${base}${suffix}`;
		const aliases = new Set<string>();
		aliases.add(base);
		label
			.split(/\s+/)
			.filter(Boolean)
			.forEach((part) => aliases.add(canonicalHandle(part)));
		aliases.add((label ?? '').replace(/\s+/g, '').toLowerCase());
		return {
			uid: `role:${roleId}`,
			label,
			handle,
			avatar: null,
			search: `${label}`.toLowerCase(),
			aliases: Array.from(aliases).filter(Boolean),
			kind: 'role',
			color,
			roleId
		};
	}

	function startRoleMentionWatch(serverId: string) {
		mentionRolesStop?.();
		roleMentionOptions = [];
		const database = db();
		const roleQuery = query(
			collection(database, 'servers', serverId, 'roles'),
			orderBy('position')
		);
		mentionRolesStop = onSnapshot(
			roleQuery,
			(snap) => {
				roleMentionOptions = snap.docs
					.filter((docSnap) => (docSnap.data() as any)?.mentionable !== false)
					.map((docSnap) => buildRoleMentionEntry(docSnap.id, docSnap.data()));
				updateMentionOptionList();
			},
			() => {
				roleMentionOptions = [];
				updateMentionOptionList();
			}
		);
	}

	/* ===========================
     Channel Memory (per server)
     =========================== */
	type ChannelMemory = Record<string, string>;
	let serverChannelMemory: ChannelMemory = {};

	function loadServerChannelMemory() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(SERVER_CHANNEL_MEMORY_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') {
				serverChannelMemory = parsed;
			}
		} catch {
			// ignore storage errors
		}
	}

	function persistServerChannelMemory(map: ChannelMemory) {
		if (!browser) return;
		try {
			const keys = Object.keys(map);
			if (!keys.length) {
				localStorage.removeItem(SERVER_CHANNEL_MEMORY_KEY);
			} else {
				localStorage.setItem(SERVER_CHANNEL_MEMORY_KEY, JSON.stringify(map));
			}
		} catch {
			// ignore storage errors
		}
	}

	function rememberServerChannel(sId: string, channelId: string | null | undefined) {
		if (!sId || !channelId) return;
		const existing = serverChannelMemory[sId];
		if (existing === channelId) return;
		serverChannelMemory = { ...serverChannelMemory, [sId]: channelId };
		persistServerChannelMemory(serverChannelMemory);
	}

	function getRememberedChannel(sId: string): string | null {
		return serverChannelMemory[sId] ?? null;
	}

	function pickString(value: unknown): string | undefined {
		if (typeof value !== 'string') return undefined;
		const trimmed = value.trim();
		return trimmed.length ? trimmed : undefined;
	}

	function normalizeProfile(uid: string, data: any, previous: any = profiles[uid] ?? {}) {
		const merged = { ...previous, ...data };
		const displayName =
			pickString(merged?.name) ??
			pickString(merged?.displayName) ??
			pickString(previous.displayName) ??
			pickString(previous.name) ??
			pickString(merged?.email) ??
			'Member';

		const name =
			pickString(merged?.name) ??
			pickString(previous.name) ??
			pickString(merged?.displayName) ??
			displayName;

		const photoURL = resolveProfilePhotoURL(merged);

		return {
			...merged,
			uid,
			displayName,
			name,
			photoURL
		};
	}

	function updateProfileCache(uid: string, patch: any) {
		if (!uid) return;
		const next = normalizeProfile(uid, patch ?? {}, profiles[uid]);
		const prev = profiles[uid];
		if (!prev) {
			profiles = { ...profiles, [uid]: next };
			return;
		}
		if (
			prev.displayName === next.displayName &&
			prev.photoURL === next.photoURL &&
			prev.name === next.name
		) {
			// merge any extra fields without triggering unnecessary reactivity
			const merged = { ...prev, ...next };
			if (merged !== prev) {
				profiles = { ...profiles, [uid]: merged };
			}
			return;
		}
		profiles = { ...profiles, [uid]: next };
	}

	function ensureProfileSubscription(database: ReturnType<typeof db>, uid: string) {
		if (!uid || profileUnsubs[uid]) return;
		profileUnsubs[uid] = onSnapshot(
			doc(database, 'profiles', uid),
			(snap) => {
				updateProfileCache(uid, snap.data() ?? {});
			},
			() => {
				profileUnsubs[uid]?.();
				delete profileUnsubs[uid];
			}
		);
	}

	function cleanupProfileSubscriptions() {
		for (const uid in profileUnsubs) {
			profileUnsubs[uid]?.();
			delete profileUnsubs[uid];
		}
	}

	function normalizePopoutProfile(
		uid: string,
		data: any,
		previous: any = popoutProfiles[uid] ?? {}
	) {
		const merged = { ...previous, ...data };
		const displayName =
			pickString(merged?.name) ??
			pickString(merged?.displayName) ??
			pickString(previous.displayName) ??
			pickString(previous.name) ??
			pickString(merged?.email) ??
			'Member';

		const name =
			pickString(merged?.name) ??
			pickString(previous.name) ??
			pickString(merged?.displayName) ??
			displayName;

		const photoURL = resolveProfilePhotoURL(merged);

		return {
			...merged,
			uid,
			displayName,
			name,
			photoURL
		};
	}

	function updatePopoutProfileCache(uid: string, patch: any) {
		if (!uid) return;
		const next = normalizePopoutProfile(uid, patch ?? {}, popoutProfiles[uid]);
		const prev = popoutProfiles[uid];
		if (!prev) {
			popoutProfiles = { ...popoutProfiles, [uid]: next };
			return;
		}
		if (
			prev.displayName === next.displayName &&
			prev.photoURL === next.photoURL &&
			prev.name === next.name
		) {
			const merged = { ...prev, ...next };
			if (merged !== prev) {
				popoutProfiles = { ...popoutProfiles, [uid]: merged };
			}
			return;
		}
		popoutProfiles = { ...popoutProfiles, [uid]: next };
	}

	function ensurePopoutProfileSubscription(database: ReturnType<typeof db>, uid: string) {
		if (!uid || popoutProfileUnsubs[uid]) return;
		popoutProfileUnsubs[uid] = onSnapshot(
			doc(database, 'profiles', uid),
			(snap) => {
				updatePopoutProfileCache(uid, snap.data() ?? {});
			},
			() => {
				popoutProfileUnsubs[uid]?.();
				delete popoutProfileUnsubs[uid];
			}
		);
	}

	function cleanupPopoutProfileSubscriptions() {
		for (const uid in popoutProfileUnsubs) {
			popoutProfileUnsubs[uid]?.();
			delete popoutProfileUnsubs[uid];
		}
	}

	function normalizePoll(raw: any) {
		const question = pickString(raw?.question) ?? '';
		const options = Array.isArray(raw?.options) ? raw.options : [];
		const votesByUser =
			raw?.votesByUser && typeof raw.votesByUser === 'object'
				? raw.votesByUser
				: raw?.votes && typeof raw.votes === 'object'
					? raw.votes
					: {};
		const voteCounts: Record<number, number> = {};
		for (const voter in votesByUser) {
			const idx = votesByUser[voter];
			if (typeof idx === 'number' && Number.isFinite(idx)) {
				voteCounts[idx] = (voteCounts[idx] ?? 0) + 1;
			}
		}
		return { question, options, votesByUser, votes: voteCounts };
	}

	function normalizeForm(raw: any) {
		const title = pickString(raw?.title) ?? '';
		const questions = Array.isArray(raw?.questions) ? raw.questions : [];
		const responses = raw?.responses && typeof raw.responses === 'object' ? raw.responses : {};
		return { title, questions, responses };
	}

	function inferMessageType(raw: any) {
		return (
			raw?.type ??
			(raw?.file ? 'file' : raw?.poll ? 'poll' : raw?.form ? 'form' : raw?.url ? 'gif' : 'text')
		);
	}

	const REPLY_SNIPPET_LIMIT = 140;

	function clipReply(value: string | null | undefined, limit = REPLY_SNIPPET_LIMIT) {
		if (!value) return '';
		return value.length > limit ? `${value.slice(0, limit - 1)}Ã¢â‚¬Â¦` : value;
	}

	function describeReplyPreview(raw: any, type: string) {
		switch (type) {
			case 'gif':
				return 'GIF';
			case 'file': {
				const name = pickString(raw?.file?.name);
				return name ? `File: ${name}` : 'File';
			}
			case 'poll': {
				const question = pickString(raw?.poll?.question);
				return question ? `Poll: ${question}` : 'Poll';
			}
			case 'form': {
				const title = pickString(raw?.form?.title);
				return title ? `Form: ${title}` : 'Form';
			}
			default: {
				const body = pickString(raw?.text) ?? pickString(raw?.content) ?? '';
				const clipped = clipReply(body);
				return clipped || 'Message';
			}
		}
	}

	function buildReplyReference(message: any): ReplyReferenceInput | null {
		const messageId = pickString(message?.id);
		if (!messageId) return null;
		const type = inferMessageType(message);
		const authorId = pickString(message?.uid) ?? pickString(message?.authorId) ?? null;
		const authorRecord = authorId ? profiles[authorId] : null;
		const authorName =
			pickString(message?.displayName) ??
			pickString(authorRecord?.displayName) ??
			(authorId === $user?.uid ? 'You' : authorId);
		const preview = describeReplyPreview(message, type);
		const parent = cloneReplyChain(message?.replyTo ?? null);
		const replyRef: ReplyReferenceInput = {
			messageId,
			authorId,
			authorName: authorName ?? null,
			preview: preview || null,
			text: preview || null,
			type
		};
		if (parent) replyRef.parent = parent;
		return replyRef;
	}

	function cloneReplyChain(raw: any): ReplyReferenceInput | null {
		const messageId = pickString(raw?.messageId);
		if (!messageId) return null;
		const preview = clipReply(pickString(raw?.preview) ?? pickString(raw?.text) ?? '') || null;
		const node: ReplyReferenceInput = {
			messageId,
			authorId: pickString(raw?.authorId) ?? null,
			authorName: pickString(raw?.authorName) ?? null,
			preview,
			text: pickString(raw?.text) ?? preview,
			type: pickString(raw?.type) ?? null
		};
		const parent = cloneReplyChain(raw?.parent ?? null);
		if (parent) node.parent = parent;
		return node;
	}

	function resolveThreadRootId(reply: ReplyReferenceInput | null | undefined) {
		if (!reply) return null;
		let current: ReplyReferenceInput | null | undefined = reply;
		let candidate: string | null = null;
		while (current) {
			candidate = pickString(current.messageId) || candidate;
			current = current.parent;
		}
		return candidate;
	}

	function messageBelongsToThread(message: any, rootId: string | null) {
		if (!rootId) return false;
		const replyRef = message?.replyTo ?? null;
		if (!replyRef) return false;
		const resolved = resolveThreadRootId(replyRef) ?? pickString(replyRef.messageId);
		return resolved === rootId;
	}

	function toMillis(value: any) {
		if (!value) return null;
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (value instanceof Date) return value.getTime();
		if (typeof value?.toMillis === 'function') {
			try {
				return value.toMillis();
			} catch {
				// ignore
			}
		}
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : null;
	}

	function consumeReply(explicit?: ReplyReferenceInput | null) {
		const candidate =
			explicit && explicit.messageId
				? explicit
				: replyTarget && replyTarget.messageId
					? replyTarget
					: null;
		replyTarget = null;
		return candidate && candidate.messageId ? candidate : null;
	}

	function restoreReply(ref: ReplyReferenceInput | null) {
		if (ref?.messageId) {
			replyTarget = ref;
		}
	}

	function consumePopoutReply(explicit?: ReplyReferenceInput | null) {
		const candidate =
			explicit && explicit.messageId
				? explicit
				: popoutReplyTarget && popoutReplyTarget.messageId
					? popoutReplyTarget
					: null;
		popoutReplyTarget = null;
		return candidate && candidate.messageId ? candidate : null;
	}

	function restorePopoutReply(ref: ReplyReferenceInput | null) {
		if (ref?.messageId) {
			popoutReplyTarget = ref;
		}
	}

	function consumeThreadReply(explicit?: ReplyReferenceInput | null) {
		const candidate =
			explicit && explicit.messageId
				? explicit
				: threadReplyTarget && threadReplyTarget.messageId
					? threadReplyTarget
					: null;
		threadReplyTarget = null;
		return candidate && candidate.messageId ? candidate : null;
	}

	function restoreThreadReply(ref: ReplyReferenceInput | null) {
		if (ref?.messageId) {
			threadReplyTarget = ref;
		}
	}

	function consumeFloatingThreadReply(explicit?: ReplyReferenceInput | null) {
		const candidate =
			explicit && explicit.messageId
				? explicit
				: floatingThreadReplyTarget && floatingThreadReplyTarget.messageId
					? floatingThreadReplyTarget
					: null;
		floatingThreadReplyTarget = null;
		return candidate && candidate.messageId ? candidate : null;
	}

	function restoreFloatingThreadReply(ref: ReplyReferenceInput | null) {
		if (ref?.messageId) {
			floatingThreadReplyTarget = ref;
		}
	}

	function toChatMessage(id: string, raw: any) {
		const uid = pickString(raw?.uid) ?? pickString(raw?.authorId) ?? 'unknown';
		const displayName = pickString(raw?.displayName) ?? pickString(raw?.author?.displayName);
		const photoURL = pickString(raw?.photoURL) ?? pickString(raw?.author?.photoURL);
		const createdAt = raw?.createdAt ?? null;
		const inferredType = inferMessageType(raw);

		const message: any = {
			id,
			uid,
			type: inferredType,
			createdAt,
			displayName: displayName ?? undefined,
			photoURL: photoURL ?? undefined,
			reactions: raw?.reactions ?? {}
		};

		if (raw?.text !== undefined || raw?.content !== undefined) {
			message.text = raw?.text ?? raw?.content ?? '';
		}

		if (raw?.url) {
			message.url = raw.url;
		}

		if (raw?.file) {
			message.file = raw.file;
		}

		if (inferredType === 'poll') {
			message.poll = normalizePoll(raw?.poll ?? {});
		}

		if (inferredType === 'form') {
			message.form = normalizeForm(raw?.form ?? {});
		}

		const mentionArray: MentionSendRecord[] = Array.isArray(raw?.mentions)
			? raw.mentions
			: raw?.mentionsMap && typeof raw.mentionsMap === 'object'
				? Object.entries(raw.mentionsMap).map(([key, value]) => {
						const rawKind = (value as any)?.kind;
						const kind =
							rawKind === 'role'
								? 'role'
								: rawKind === 'member'
									? 'member'
									: rawKind === 'special'
										? 'special'
										: undefined;
						return {
							uid: pickString(key) ?? '',
							handle: pickString((value as any)?.handle) ?? null,
							label: pickString((value as any)?.label) ?? null,
							color: pickString((value as any)?.color) ?? null,
							kind
						};
					})
				: [];
		const mentions = mentionArray
			.map((entry) => {
				const rawKind = (entry as any)?.kind;
				const kind =
					rawKind === 'role'
						? 'role'
						: rawKind === 'member'
							? 'member'
							: rawKind === 'special'
								? 'special'
								: undefined;
				return {
					uid: pickString(entry?.uid) ?? '',
					handle: pickString((entry as any)?.handle) ?? null,
					label: pickString((entry as any)?.label) ?? null,
					color: pickString((entry as any)?.color) ?? null,
					kind
				};
			})
			.filter((entry) => entry.uid);
		if (mentions.length) {
			message.mentions = mentions;
		}

		const replyTree = cloneReplyChain(raw?.replyTo ?? null);
		if (replyTree) {
			message.replyTo = replyTree;
		}

		return message;
	}

	function deriveCurrentDisplayName() {
		const uid = $user?.uid ?? '';
		const profile = uid ? profiles[uid] : null;
		return (
			pickString(profile?.displayName) ??
			pickString(profile?.name) ??
			pickString($user?.displayName) ??
			pickString($user?.email) ??
			'You'
		);
	}

	function deriveCurrentPhotoURL() {
		const uid = $user?.uid ?? '';
		const profile = uid ? profiles[uid] : null;
		const authPhoto = pickString($user?.photoURL) ?? null;
		if (profile) {
			return resolveProfilePhotoURL(profile, authPhoto);
		}
		return authPhoto ?? null;
	}

	const makeUploadId = () => {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return Math.random().toString(36).slice(2);
	};

	type PendingUploadScope = 'channel' | 'thread' | 'floatingThread' | 'popout';

	function getPendingUploadList(scope: PendingUploadScope) {
		switch (scope) {
			case 'thread':
				return threadPendingUploads;
			case 'floatingThread':
				return floatingThreadPendingUploads;
			case 'popout':
				return popoutPendingUploads;
			case 'channel':
			default:
				return pendingUploads;
		}
	}

	function setPendingUploadList(scope: PendingUploadScope, next: PendingUploadPreview[]) {
		switch (scope) {
			case 'thread':
				threadPendingUploads = next;
				break;
			case 'floatingThread':
				floatingThreadPendingUploads = next;
				break;
			case 'popout':
				popoutPendingUploads = next;
				break;
			case 'channel':
			default:
				pendingUploads = next;
				break;
		}
	}

	function updatePendingUploadList(
		scope: PendingUploadScope,
		updater: (list: PendingUploadPreview[]) => PendingUploadPreview[]
	) {
		const current = getPendingUploadList(scope);
		setPendingUploadList(scope, updater(current));
	}

	function registerPendingUpload(
		file: File,
		scope: PendingUploadScope = 'channel'
	): {
		id: string;
		update(progress: number): void;
		finish(success: boolean): void;
	} {
		const id = makeUploadId();
		const isImage = looksLikeImage({ name: file?.name, type: file?.type });
		const previewUrl =
			isImage && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
				? URL.createObjectURL(file)
				: null;
		let currentProgress = 0;
		let fallbackTimer: ReturnType<typeof setInterval> | null = null;

		const entry: PendingUploadPreview = {
			id,
			uid: $user?.uid ?? null,
			name: file?.name || 'Upload',
			size: file?.size,
			contentType: file?.type ?? null,
			isImage,
			progress: currentProgress,
			previewUrl
		};
		updatePendingUploadList(scope, (list) => [...list, entry]);

		const commitProgress = (value: number) => {
			if (!Number.isFinite(value)) return;
			currentProgress = Math.min(1, Math.max(currentProgress, value));
			updatePendingUploadList(scope, (list) =>
				list.map((item) => (item.id === id ? { ...item, progress: currentProgress } : item))
			);
			if (currentProgress >= 0.99 && fallbackTimer) {
				clearInterval(fallbackTimer);
				fallbackTimer = null;
			}
		};

		const ensureFallback = () => {
			if (fallbackTimer) return;
			fallbackTimer = setInterval(() => {
				if (currentProgress >= 0.95) return;
				commitProgress(currentProgress + 0.01);
			}, 1200);
		};

		ensureFallback();

		return {
			id,
			update(progress: number) {
				ensureFallback();
				commitProgress(progress);
			},
			finish(success: boolean) {
				if (fallbackTimer) {
					clearInterval(fallbackTimer);
					fallbackTimer = null;
				}
				if (success) {
					commitProgress(1);
				}
				updatePendingUploadList(scope, (list) => list.filter((item) => item.id !== id));
				if (previewUrl) {
					try {
						URL.revokeObjectURL(previewUrl);
					} catch {
						// ignore
					}
				}
			}
		};
	}
	let voiceState: VoiceSession | null = $state(null);
	let isVoiceChannelView = $state(false);
	let isViewingActiveVoiceChannel = $state(false);
	let showVoiceLobby = $state(false);
	let voiceInviteUrl: string | null = $state(null);
	// Initialize isMobile immediately on browser to ensure nav bar visibility before onMount
	let isMobile = $state(browser && typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches);
	let currentUserDisplayName = $state('');
	let currentUserPhotoURL: string | null = $state(null);
	const unsubscribeVoice = voiceSession.subscribe((value) => {
		voiceState = value;
	});
	const blockedChannels = new Set<string>();

	function clearRequestedChannel(targetId?: string) {
		if (!requestedChannelId) return;
		if (targetId && requestedChannelId !== targetId) return;
		requestedChannelId = null;
	}

	run(() => {
		const visible = !!voiceState?.visible;
		const inLobby = showVoiceLobby;
		const hasVoiceSession = !!voiceState;

		if (!hasVoiceSession && !inLobby) {
			callPanelOpen = false;
			closeFloatingCallChat();
		} else if (isMobile) {
			callPanelOpen = false;
			closeFloatingCallChat();
		} else if (!visible && !inLobby) {
			// Keep open when minimized/hidden on desktop, just record last visibility.
		}

		lastVoiceVisible = visible;
	});

	// listeners
	let messagesUnsub: (() => void) | null = null;
	let messagesSubscriptionVersion = 0; // Track subscription version to prevent stale updates
	function clearMessagesUnsub() {
		messagesUnsub?.();
		messagesUnsub = null;
	}
	function clearThreadsUnsub() {
		threadsUnsub?.();
		threadsUnsub = null;
	}
	function clearThreadMessagesUnsub() {
		threadMessagesUnsub?.();
		threadMessagesUnsub = null;
	}
	function clearThreadReadSubs() {
		threadReadStops.forEach((stop) => stop());
		threadReadStops.clear();
		threadReadCursors = {};
	}
	function resetThreadState(options: { resetCache?: boolean } = {}) {
		clearThreadMessagesUnsub();
		clearThreadsUnsub();
		clearThreadReadSubs();
		clearThreadReadTimer();
		channelThreads = [];
		threadStats = {};
		threadUnreadMap = {};
		activeThread = null;
		activeThreadRoot = null;
		threadMessages = [];
		threadConversationContext = [];
		threadDefaultSuggestionSource = null;
		threadReplyTarget = null;
		pendingThreadId = null;
		pendingThreadRoot = null;
		if (options.resetCache) {
			threadsByChannel = {};
		}
	}

	function clearServerThreads() {
		serverThreadsUnsub?.();
		serverThreadsUnsub = null;
		threadsByChannel = {};
		serverThreadsScope = null;
	}

	function clearPinnedState() {
		pinnedUnsub?.();
		pinnedUnsub = null;
		pinnedServerId = null;
		pinnedChannelId = null;
		pinnedMessages = [];
		pinnedMessageIds = new Set();
	}

	function clearPopoutPinnedState() {
		popoutPinnedUnsub?.();
		popoutPinnedUnsub = null;
		popoutPinnedChannelId = null;
		popoutPinnedMessageIds = new Set();
	}

	function resetChannelState() {
		// Increment subscription version to invalidate any pending subscriptions
		messagesSubscriptionVersion++;
		clearMessagesUnsub();
		clearPopoutMessagesUnsub();
		cleanupPopoutProfileSubscriptions();
		resetThreadState({ resetCache: true });
		messagesLoadError = null;
		channels = [];
		activeChannel = null;
		messages = [];
		profiles = {};
		channelMessagesPopout = false;
		channelMessagesPopoutChannelId = null;
		channelMessagesPopoutChannelName = '';
		popoutMessages = [];
		popoutProfiles = {};
		popoutReplyTarget = null;
		popoutPendingUploads = [];
		popoutEarliestLoaded = null;
		clearPinnedState();
		clearPopoutPinnedState();
	}

	function normalizeThreadSnapshot(data: any, id: string): ChannelThread {
		const derivedParent = data?.parentChannelId ?? data?.channelId ?? '';
		return {
			id,
			serverId: data?.serverId ?? serverId ?? '',
			channelId: data?.channelId ?? derivedParent,
			parentChannelId: derivedParent,
			createdBy: data?.createdBy ?? '',
			createdFromMessageId: data?.createdFromMessageId ?? '',
			name: typeof data?.name === 'string' && data.name.trim() ? data.name : 'Thread',
			preview: data?.preview ?? data?.rootPreview ?? null,
			createdAt: data?.createdAt,
			lastMessageAt: data?.lastMessageAt,
			archivedAt: data?.archivedAt ?? null,
			autoArchiveAt: data?.autoArchiveAt ?? null,
			memberUids: Array.isArray(data?.memberUids) ? data.memberUids : [],
			memberCount: Number(data?.memberCount) || 0,
			maxMembers: Number(data?.maxMembers) || THREAD_MAX_MEMBER_LIMIT,
			ttlHours: Number(data?.ttlHours) || THREAD_DEFAULT_TTL_HOURS,
			status: data?.status ?? 'active',
			visibility: data?.visibility ?? 'inherit_parent_with_exceptions',
			messageCount: Number(data?.messageCount) || 0
		};
	}

	function subscribeServerThreads(currServerId: string, uid: string) {
		const database = db();
		const q = query(
			collectionGroup(database, 'threads'),
			where('serverId', '==', currServerId),
			where('memberUids', 'array-contains', uid)
		);
		clearServerThreads();
		serverThreadsScope = `${currServerId}:${uid}`;
		serverThreadsUnsub = onSnapshot(
			q,
			(snap) => {
				const nextMap: Record<string, ChannelThread[]> = {};
				for (const docSnap of snap.docs) {
					try {
						const thread = normalizeThreadSnapshot(docSnap.data(), docSnap.id);
						if (!thread.parentChannelId || thread.status === 'archived') continue;
						if (!nextMap[thread.parentChannelId]) nextMap[thread.parentChannelId] = [];
						nextMap[thread.parentChannelId].push(thread);
					} catch (err) {
						console.error('[threads] failed to normalize thread snapshot', err);
					}
				}
				threadsByChannel = nextMap;
			},
			(err) => {
				if ((err as any)?.code === 'permission-denied') {
					console.warn('[threads] permission denied for server threads', err);
				} else {
					console.error('[threads] failed to subscribe to server threads', err);
				}
				clearServerThreads();
			}
		);
	}

	function selectChannelObject(id: string): Channel {
		const found = channels.find((c) => c.id === id);
		return found ?? { id, name: id, type: 'text' };
	}

	const triggerScrollToBottom = () => {
		scrollToBottomSignal = Date.now();
	};

	// Progressive loading: quick initial render, then backfill
	const INITIAL_PAGE_SIZE = 5;   // First quick load for instant feel
	const BACKFILL_PAGE_SIZE = 20; // Second load after initial render
	const PAGE_SIZE = 50;          // Pagination on scroll
	let earliestLoaded: any = null; // Firestore Timestamp or Date
	let backfillPending = $state(false); // Track if backfill is in progress

	async function loadOlderMessages(currServerId: string, channelId: string) {
		try {
			const database = db();
			if (!earliestLoaded) return; // nothing to load yet
			const q = query(
				collection(database, 'servers', currServerId, 'channels', channelId, 'messages'),
				orderBy('createdAt', 'asc'),
				endBefore(earliestLoaded),
				limitToLast(PAGE_SIZE)
			);
			const snap = await getDocs(q);
			const older: any[] = [];
			snap.forEach((d) => older.push(toChatMessage(d.id, d.data())));
			messages = [...older, ...messages];
			if (older.length) {
				earliestLoaded = older[0]?.createdAt ?? earliestLoaded;
				// Update cache with older messages
				updateChannelCache(currServerId, channelId, older as CachedMessage[], {
					earliestLoaded,
					hasOlderMessages: older.length >= PAGE_SIZE,
					prepend: true
				});
			}
		} catch (err) {
			console.error('Failed to load older messages', err);
		}
	}

	async function loadOlderPopoutMessages(currServerId: string, channelId: string) {
		try {
			const database = db();
			if (!popoutEarliestLoaded) return;
			const q = query(
				collection(database, 'servers', currServerId, 'channels', channelId, 'messages'),
				orderBy('createdAt', 'asc'),
				endBefore(popoutEarliestLoaded),
				limitToLast(PAGE_SIZE)
			);
			const snap = await getDocs(q);
			const older: any[] = [];
			snap.forEach((d) => older.push(toChatMessage(d.id, d.data())));
			popoutMessages = [...older, ...popoutMessages];
			if (older.length) {
				popoutEarliestLoaded = older[0]?.createdAt ?? popoutEarliestLoaded;
			}
		} catch (err) {
			console.error('Failed to load older popout messages', err);
		}
	}

	// Backfill older messages after initial quick load
	async function backfillMessages(currServerId: string, channelId: string, beforeTimestamp: any) {
		if (!beforeTimestamp || backfillPending) return;
		backfillPending = true;
		try {
			const database = db();
			const q = query(
				collection(database, 'servers', currServerId, 'channels', channelId, 'messages'),
				orderBy('createdAt', 'asc'),
				endBefore(beforeTimestamp),
				limitToLast(BACKFILL_PAGE_SIZE)
			);
			const snap = await getDocs(q);
			const older: any[] = [];
			snap.forEach((d) => older.push(toChatMessage(d.id, d.data())));
			if (older.length > 0) {
				// Prepend older messages without scroll jump
				messages = [...older, ...messages];
				earliestLoaded = older[0]?.createdAt ?? earliestLoaded;
				// Update cache with backfilled messages
				updateChannelCache(currServerId, channelId, older as CachedMessage[], {
					earliestLoaded,
					hasOlderMessages: older.length >= BACKFILL_PAGE_SIZE,
					prepend: true
				});
			}
		} catch (err) {
			console.error('Failed to backfill messages', err);
		} finally {
			backfillPending = false;
		}
	}

	async function subscribeMessages(currServerId: string, channelId: string) {
		if (blockedChannels.has(channelId)) {
			messagesLoadError = 'You do not have permission to view messages in this channel.';
			return;
		}
		
		// Increment subscription version to track this subscription
		const subscriptionVersion = ++messagesSubscriptionVersion;
		
		// Note: Cache-first rendering is handled in pickChannel() for instant paint
		// This function focuses on setting up the live Firestore subscription
		
		// Don't block on membership - let it run in parallel
		// Firestore will surface permission errors if unauthorized
		if (memberEnsurePromise) {
			memberEnsurePromise.catch(() => {});
		}
		
		// Set loading state if no cached messages shown yet
		// Use a very short timeout so empty channels don't hang on the loading spinner
		let loadingTimeout: ReturnType<typeof setTimeout> | null = null;
		if (messages.length === 0) {
			messagesLoading = true;
			// Auto-clear loading after 0.2s - empty channels will just show the empty state
			// Real messages will clear this earlier when they arrive
			loadingTimeout = setTimeout(() => {
				if (subscriptionVersion === messagesSubscriptionVersion) {
					messagesLoading = false;
				}
			}, 200);
		}
		
		const database = db();
		
		// Progressive loading: start with small initial query for fast first paint
		// Then backfill more messages after render
		const initialLoad = messages.length === 0;
		const queryLimit = initialLoad ? INITIAL_PAGE_SIZE : PAGE_SIZE;
		
		const q = query(
			collection(database, 'servers', currServerId, 'channels', channelId, 'messages'),
			orderBy('createdAt', 'asc'),
			// Show last page live; older are fetched on-demand
			limitToLast(queryLimit)
		);
		clearMessagesUnsub();
		messagesLoadError = null;
		cleanupProfileSubscriptions();
		profiles = {};
		if ($user?.uid) {
			updateProfileCache($user.uid, {
				displayName: pickString($user.displayName) ?? pickString($user.email) ?? 'You',
				email: pickString($user.email) ?? undefined
			});
		}
		messagesUnsub = onSnapshot(
			q,
			(snap) => {
				// Guard: ignore updates from stale subscriptions
				if (subscriptionVersion !== messagesSubscriptionVersion) {
					return;
				}
				// Clear loading timeout if it was set
				if (loadingTimeout) {
					clearTimeout(loadingTimeout);
					loadingTimeout = null;
				}
				messagesLoading = false;
				const nextMessages: any[] = [];
				const seen = new Set<string>();

				for (const docSnap of snap.docs) {
					const raw: any = docSnap.data();
					const msg = toChatMessage(docSnap.id, raw);
					nextMessages.push(msg);

					if (msg?.uid && msg.uid !== 'unknown') {
						seen.add(msg.uid);
						if (pickString(msg.displayName)) {
							updateProfileCache(msg.uid, {
								displayName: msg.displayName
							});
						}
					}
				}

				const nextLen = nextMessages.length;
				messages = nextMessages;
				
				// Update both caches with new messages
				if (nextLen > 0) {
					// For initial load, we know there are likely more messages
					const hasMoreMessages = initialLoad ? true : nextLen >= PAGE_SIZE;
					
					// Update Svelte store cache
					updateChannelCache(currServerId, channelId, nextMessages as CachedMessage[], {
						earliestLoaded: nextMessages[0]?.createdAt ?? null,
						hasOlderMessages: hasMoreMessages
					});
					
					// Also update IndexedDB-backed perf cache for persistence across refreshes
					const channelCacheKey = threadKey(currServerId, channelId);
					setThreadViewMemory({
						threadKey: channelCacheKey,
						messages: nextMessages.map((m: any) => ({
							id: m.id,
							uid: m.uid,
							text: m.text ?? m.content ?? '',
							type: m.type,
							createdAt: typeof m.createdAt?.toMillis === 'function' ? m.createdAt.toMillis() : m.createdAt,
							displayName: m.displayName,
							photoURL: m.photoURL,
							reactions: m.reactions,
							replyTo: m.replyTo
						})),
						hasOlderMessages: hasMoreMessages,
						updatedAt: Date.now()
					});
				}
				
				triggerScrollToBottom();
				const prevEarliest = earliestLoaded;
				if (nextLen) {
					earliestLoaded = nextMessages[0]?.createdAt ?? null;
				}
				seen.forEach((uid) => ensureProfileSubscription(database, uid));
				messagesLoadError = null;

				// Mark as read when viewing this channel
				try {
					if (activeChannel?.id === channelId) {
						markChannelReadFromMessages(currServerId, channelId, nextMessages);
					}
				} catch {}
				
				// Progressive loading: if this was initial load, backfill more messages
				if (initialLoad && nextLen > 0 && nextLen <= INITIAL_PAGE_SIZE) {
					// Schedule backfill after a short delay to let UI render first
					setTimeout(() => {
						if (subscriptionVersion === messagesSubscriptionVersion) {
							backfillMessages(currServerId, channelId, earliestLoaded);
						}
					}, 50);
				}
			},
			(error) => {
				// Guard: ignore errors from stale subscriptions
				if (subscriptionVersion !== messagesSubscriptionVersion) {
					return;
				}
				// Clear loading timeout if it was set
				if (loadingTimeout) {
					clearTimeout(loadingTimeout);
					loadingTimeout = null;
				}
				messagesLoading = false;
				console.error('Failed to load channel messages', error);
				messagesLoadError =
					(error as any)?.code === 'permission-denied'
						? 'You do not have permission to view messages in this channel.'
						: 'Failed to load messages. Please try again.';
				messages = [];
				// Stop listening after a permission error to avoid retry loops / Firestore internal assertions.
				clearMessagesUnsub();
				if ((error as any)?.code === 'permission-denied') {
					blockedChannels.add(channelId);
					clearRequestedChannel(channelId);
					if (activeChannel?.id === channelId) {
						activeChannel = null;
						showChannels = true;
						showMembers = false;
					}
				}
			}
		);
	}

	function clearPopoutMessagesUnsub() {
		popoutMessagesUnsub?.();
		popoutMessagesUnsub = null;
	}

	function subscribePopoutMessages(currServerId: string, channelId: string) {
		const database = db();
		const q = query(
			collection(database, 'servers', currServerId, 'channels', channelId, 'messages'),
			orderBy('createdAt', 'asc'),
			limitToLast(PAGE_SIZE)
		);
		clearPopoutMessagesUnsub();
		cleanupPopoutProfileSubscriptions();
		popoutProfiles = {};
		if ($user?.uid) {
			updatePopoutProfileCache($user.uid, {
				displayName: pickString($user.displayName) ?? pickString($user.email) ?? 'You',
				email: pickString($user.email) ?? undefined
			});
		}
		popoutMessagesUnsub = onSnapshot(
			q,
			(snap) => {
				const nextMessages: any[] = [];
				const seen = new Set<string>();

				for (const docSnap of snap.docs) {
					const raw: any = docSnap.data();
					const msg = toChatMessage(docSnap.id, raw);
					nextMessages.push(msg);

					if (msg?.uid && msg.uid !== 'unknown') {
						seen.add(msg.uid);
						if (pickString(msg.displayName)) {
							updatePopoutProfileCache(msg.uid, {
								displayName: msg.displayName
							});
						}
					}
				}

				popoutMessages = nextMessages;
				popoutScrollToBottomSignal = Date.now();
				if (popoutMessages.length) {
					popoutEarliestLoaded = popoutMessages[0]?.createdAt ?? null;
				}
				seen.forEach((uid) => ensurePopoutProfileSubscription(database, uid));
			},
			(error) => {
				console.error('Failed to load popout messages', error);
				clearPopoutMessagesUnsub();
				if ((error as any)?.code === 'permission-denied') {
					handleChannelDenied(channelId);
				}
			}
		);
	}

	function watchThreadRead(threadId: string) {
		if (!$user?.uid) return;
		if (threadReadStops.has(threadId)) return;
		const database = db();
		const ref = doc(database, 'profiles', $user.uid, 'threadMembership', threadId);
		const stop = onSnapshot(
			ref,
			(snap) => {
				const data: any = snap.data() ?? {};
				const raw = data?.lastReadAt ?? null;
				threadReadCursors[threadId] = raw?.toMillis?.() ? raw.toMillis() : toMillis(raw);
				recomputeThreadStats();
			},
			() => {
				threadReadCursors[threadId] = null;
			}
		);
		threadReadStops.set(threadId, stop);
	}

	function recomputeThreadStats() {
		const aggregates: Record<string, ThreadPreviewMeta> = {};
		const unreadMap: Record<string, boolean> = {};
		for (const thread of channelThreads) {
			const rootId = pickString(thread.createdFromMessageId ?? null);
			if (!rootId) continue;
			const lastAt = toMillis(thread.lastMessageAt);
			const readAt = threadReadCursors[thread.id] ?? null;
			const unread = Boolean(lastAt && (!readAt || readAt < lastAt));
			aggregates[rootId] = {
				threadId: thread.id,
				count: thread.messageCount ?? 0,
				lastAt: lastAt ?? undefined,
				status: thread.status,
				name: thread.name,
				unread,
				archived: thread.status === 'archived',
				preview: thread.lastMessagePreview ?? thread.preview ?? null
			};
			unreadMap[thread.id] = unread;
		}
		threadStats = aggregates;
		threadUnreadMap = unreadMap;
		if (activeThread) {
			const parentId = activeThread.parentChannelId ?? activeChannel?.id ?? null;
			if (parentId && unreadMap[activeThread.id]) {
				channelThreadUnread = { [parentId]: true };
			} else {
				channelThreadUnread = {};
			}
		} else {
			channelThreadUnread = {};
		}
	}

	function handleChannelDenied(channelId: string) {
		blockedChannels.add(channelId);
		clearRequestedChannel(channelId);
		clearMessagesUnsub();
		clearThreadsUnsub();
		messages = [];
		channelThreads = [];
		if (activeChannel?.id === channelId) {
			activeChannel = null;
			showChannels = true;
			showMembers = false;
		}
	}

	async function subscribeThreads(currServerId: string, channelId: string) {
		clearThreadsUnsub();
		if (blockedChannels.has(channelId)) return;
		if (memberEnsurePromise) {
			try {
				await memberEnsurePromise;
			} catch {
				// Membership bootstrap may fail for guests; Firestore will enforce permissions.
			}
		}
		channelThreads = [];
		const stop = streamChannelThreads(
			currServerId,
			channelId,
			(list) => {
				channelThreads = list;
				const present = new Set(list.map((thread) => thread.id));
				present.forEach((threadId) => watchThreadRead(threadId));
				for (const [threadId, stopRead] of threadReadStops) {
					if (!present.has(threadId)) {
						stopRead();
						threadReadStops.delete(threadId);
						delete threadReadCursors[threadId];
					}
				}
				if (pendingThreadId) {
					const pending = list.find((thread) => thread.id === pendingThreadId);
					if (pending) {
						const root =
							pendingThreadRoot ??
							messages.find((msg) => msg.id === pending.createdFromMessageId) ??
							activeThreadRoot ??
							null;
						if (root) {
							activateThreadView(pending, root);
						} else {
							activeThread = pending;
							prefetchThreadMemberProfiles(pending);
						}
						pendingThreadId = null;
						pendingThreadRoot = null;
					}
				} else if (activeThread) {
					const current = list.find((thread) => thread.id === activeThread?.id);
					if (current) {
						activeThread = current;
						prefetchThreadMemberProfiles(current);
					} else {
						closeThreadView();
					}
				}
				recomputeThreadStats();
			},
			{
				onError: (err) => {
					console.error('Failed to load threads', err);
					// Don't kick user out of channel for thread permission issues - they might still be able to view messages
					// The threads simply won't be displayed if they don't have permission
					if ((err as any)?.code === 'permission-denied') {
						// Just clear threads silently instead of blocking the whole channel
						channelThreads = [];
						clearThreadsUnsub();
					}
				}
			}
		);
		threadsUnsub = stop;
	}

	function sidebarThreadList() {
		if (!activeThread || activeThread.status === 'archived') return [];
		const parentId = activeThread.parentChannelId ?? activeChannel?.id ?? null;
		if (!parentId) return [];
		return [
			{
				...activeThread,
				parentChannelId: parentId,
				unread: threadUnreadMap[activeThread.id] ?? false
			}
		];
	}

	function resolveThreadMembers(target: ChannelThread | null = activeThread) {
		const sourceThread = target ?? floatingThread?.thread ?? null;
		if (!sourceThread) return [];
		return (sourceThread.memberUids ?? []).map((uid) => {
			const profile = profiles[uid] ?? {};
			return {
				uid,
				displayName:
					pickString(profile.displayName) ??
					pickString(profile.name) ??
					pickString(profile.email) ??
					uid,
				photoURL: resolveProfilePhotoURL(profile)
			};
		});
	}

	function resolveThreadTitle(
		targetThread: ChannelThread | null = activeThread,
		rootMessage: any = activeThreadRoot
	) {
		return (
			pickString(rootMessage?.text) ??
			pickString(rootMessage?.content) ??
			pickString(rootMessage?.preview) ??
			pickString(targetThread?.name) ??
			pickString(activeChannel?.name) ??
			''
		);
	}

	async function attachThreadStream(thread: ChannelThread | null) {
		if (!thread || !serverId || !activeChannel?.id) {
			clearThreadMessagesUnsub();
			threadMessages = [];
			lastThreadStreamChannel = null;
			lastThreadStreamId = null;
			return;
		}
		if (lastThreadStreamChannel === activeChannel.id && lastThreadStreamId === thread.id) {
			return;
		}
		clearThreadMessagesUnsub();
		lastThreadStreamChannel = activeChannel.id;
		lastThreadStreamId = thread.id;
		if (memberEnsurePromise) {
			try {
				await memberEnsurePromise;
			} catch {
				// proceed; Firestore will enforce permissions
			}
		}
		threadMessagesUnsub = streamThreadMessages(
			serverId,
			activeChannel.id,
			thread.id,
			(list) => {
				threadMessages = list;
				scheduleThreadRead();
			},
			{
				onError: (err) => {
					console.error('Failed to load thread messages', err);
					if ((err as any)?.code === 'permission-denied') {
						const deniedChannelId =
							activeChannel?.id ?? thread.channelId ?? thread.parentChannelId ?? null;
						if (deniedChannelId) {
							handleChannelDenied(deniedChannelId);
						}
					}
				}
			}
		);
	}

	function clearThreadReadTimer() {
		if (threadReadTimer) {
			clearTimeout(threadReadTimer);
			threadReadTimer = null;
		}
	}

	function scheduleThreadRead() {
		if (typeof window === 'undefined') return;
		if (!activeThread || !serverId || !activeChannel?.id || !$user?.uid) return;
		if (isMobile && !showThreadPanel) return;
		const threadId = activeThread.id;
		const latest = threadMessages[threadMessages.length - 1] ?? null;
		const fallbackAt = latest?.createdAt ?? activeThread.lastMessageAt ?? null;
		const fallbackId = (latest as any)?.id ?? (latest as any)?.messageId ?? null;
		clearThreadReadTimer();
		threadReadTimer = window.setTimeout(() => {
			threadReadTimer = null;
			if (
				!$user?.uid ||
				!activeThread ||
				activeThread.id !== threadId ||
				!serverId ||
				!activeChannel?.id
			) {
				return;
			}
			const current = threadMessages[threadMessages.length - 1] ?? null;
			const markAt = current?.createdAt ?? activeThread.lastMessageAt ?? fallbackAt ?? null;
			const markId = (current as any)?.id ?? (current as any)?.messageId ?? fallbackId ?? null;
			void markThreadReadThread($user.uid, serverId, activeChannel.id, threadId, {
				at: markAt ?? undefined,
				lastMessageId: markId ?? undefined
			});
		}, 650);
	}

	function pickChannel(id: string, options?: { closeMobileChannels?: boolean }) {
		const closeMobileChannels = options?.closeMobileChannels ?? true;
		if (!serverId) return;
		
		// Start performance timing
		const endChannelTimer = timeChannelSwitch(id);
		
		if (blockedChannels.has(id)) {
			messagesLoadError = 'You do not have permission to view messages in this channel.';
			activeChannel = null;
			showChannels = true;
			showMembers = false;
			clearRequestedChannel(id);
			endChannelTimer(); // End timing even on error
			return;
		}
		// First check current channels array
		let allowedChannel = channels.find((c) => c.id === id);
		// Also check lastSidebarChannels which might be more up-to-date when called from sidebar
		if (!allowedChannel && lastSidebarChannels?.channels) {
			allowedChannel = lastSidebarChannels.channels.find((c) => c.id === id);
			// Sync channels array if we found it in the sidebar's list
			if (allowedChannel) {
				channels = lastSidebarChannels.channels;
			}
		}
		if (!allowedChannel) {
			messagesLoadError = 'You do not have permission to view messages in this channel.';
			activeChannel = null;
			showChannels = true;
			showMembers = false;
			clearRequestedChannel(id);
			endChannelTimer();
			return;
		}
		const next = selectChannelObject(id);
		activeChannel = next;
		
		// Clean up old channel listeners before subscribing to new ones
		cleanupChannelListeners();
		
		// CACHE-FIRST: Check both in-memory cache AND IndexedDB cache
		let hasCachedMessages = false;
		
		// First check in-memory Svelte store cache
		if (next.type !== 'voice' && hasChannelCache(serverId, id)) {
			const cached = getCachedChannelMessages(serverId, id);
			if (cached.length > 0) {
				messages = cached.map((row: any) => toChatMessage(row.id, row));
				earliestLoaded = messages[0]?.createdAt ?? null;
				hasCachedMessages = true;
				endChannelTimer();
			}
		}
		
		// If no Svelte store cache, check IndexedDB-backed perf cache
		if (!hasCachedMessages && next.type !== 'voice') {
			const channelCacheKey = threadKey(serverId, id);
			const idbCached = getThreadViewMemory(channelCacheKey);
			if (idbCached && idbCached.messages?.length > 0) {
				messages = idbCached.messages.map((row: any) => toChatMessage(row.id, row));
				earliestLoaded = messages[0]?.createdAt ?? null;
				hasCachedMessages = true;
				endChannelTimer();
			}
		}
		
		// Only clear messages if no cache at all
		if (!hasCachedMessages) {
			messages = [];
		}
		
		messagesLoadError = null;
		clearMessagesUnsub();
		resetThreadState();

		if (next.type === 'voice') {
			// Voice channels do not stream messages; just toggle voice UI visibility.
			showMembers = false;
			desktopMembersVisible = false;
			desktopMembersPreferred = false;
			if (voiceState && voiceState.serverId === serverId && voiceState.channelId === next.id) {
				voiceSession.setVisible(true);
			} else if (voiceState) {
				voiceSession.setVisible(false);
			}
		} else {
			subscribeMessages(serverId, id);
			subscribeThreads(serverId, id);
			voiceSession.setVisible(false);
			// Optimistically mark as read on navigation to the channel
			markChannelReadFromMessages(serverId, id, messages);
		}

		// close channels panel on mobile (unless explicitly kept open)
		if (closeMobileChannels) {
			showChannels = false;
		}

		// Remember this channel for this server
		if (serverId) {
			rememberServerChannel(serverId, id);
		}

		// Scroll to the most recent message when switching channels
		scrollToBottomSignal++;

		if (browser) {
			try {
				const current = $page?.url?.searchParams?.get('channel') ?? null;
				if (current !== id) {
					const nextUrl = new URL($page.url.href);
					nextUrl.searchParams.set('channel', id);
					goto(`${nextUrl.pathname}${nextUrl.search}`, {
						replaceState: true,
						keepFocus: true,
						noScroll: true
					});
				}
			} catch {}
		}
	}

	function syncVisibleChannels(payload: ChannelEventDetail | null, cachePayload = true) {
		if (payload && cachePayload) {
			lastSidebarChannels = payload;
		}
		if (!serverId || !$user?.uid) {
			return;
		}
		const source = payload ?? lastSidebarChannels;
		if (!source) return;
		const payloadServer = source.serverId ?? serverId;
		if (!payloadServer || payloadServer !== serverId) return;

		channelListServerId = payloadServer;
		const nextChannels = Array.isArray(source.channels) ? source.channels : [];
		const currentActive = untrack(() => activeChannel);
		const currentShowMembers = untrack(() => showMembers);
		const currentShowChannels = untrack(() => showChannels);
		const requestedId = requestedChannelId;
		const isDesktop =
			typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

		channels = nextChannels;
		const popoutId = channelMessagesPopoutChannelId;
		if (popoutId && !nextChannels.some((c) => c.id === popoutId)) {
			closeChannelMessagesPopout();
		}

		if (!nextChannels.length) {
			resetChannelState();
			showChannels = currentShowChannels && false;
			showMembers = currentShowMembers && false;
			return;
		}

		if (!currentActive) {
			if (requestedId) {
				const target = nextChannels.find((c) => c.id === requestedId);
				if (target) {
					// On mobile, keep channel list visible during server switch
					pickChannel(target.id, { closeMobileChannels: isDesktop });
					return;
				}
			}
			// Try to restore remembered channel for this server
			const rememberedId = getRememberedChannel(payloadServer);
			if (rememberedId) {
				const remembered = nextChannels.find((c) => c.id === rememberedId);
				if (remembered) {
					// On mobile, keep channel list visible during server switch
					pickChannel(remembered.id, { closeMobileChannels: isDesktop });
					return;
				}
			}
			if (isDesktop) {
				pickChannel(nextChannels[0].id);
			} else {
				activeChannel = null;
				showMembers = false;
				showChannels = true;
			}
			return;
		}

		const updated = nextChannels.find((c) => c.id === currentActive.id);
		if (updated) {
			activeChannel = updated;
			return;
		}

		if (requestedId) {
			const target = nextChannels.find((c) => c.id === requestedId);
			if (target) {
				// On mobile, keep channel list visible during server switch
				pickChannel(target.id, { closeMobileChannels: isDesktop });
				return;
			}
		}

		if (isDesktop) {
			pickChannel(nextChannels[0].id);
		} else {
			clearMessagesUnsub();
			resetThreadState({ resetCache: true });
			activeChannel = null;
			showMembers = false;
			showChannels = true;
			messages = [];
		}
	}

	function handleSidebarChannels(event: CustomEvent<ChannelEventDetail>) {
		syncVisibleChannels(event?.detail ?? null);
	}

	async function ensureServerMembership(currServerId: string, uid: string) {
		if (!currServerId || !uid || memberEnsurePromise)
			return memberEnsurePromise ?? Promise.resolve();
		memberEnsurePromise = (async () => {
			try {
				const database = db();
				const memberRef = doc(database, 'servers', currServerId, 'members', uid);
				const snap = await getDoc(memberRef);
				if (!snap.exists()) {
					let defaultRole: string | null = null;
					try {
						const serverSnap = await getDoc(doc(database, 'servers', currServerId));
						if (serverSnap.exists()) {
							const data: any = serverSnap.data();
							defaultRole =
								pickString(data?.defaultRoleId) ?? pickString(data?.everyoneRoleId) ?? null;
						}
					} catch {
						defaultRole = null;
					}
					const payload: Record<string, unknown> = {
						role: 'member',
						roleIds: Array.isArray(defaultRole) ? defaultRole : defaultRole ? [defaultRole] : [],
						joinedAt: new Date()
					};
					await setDoc(memberRef, payload, { merge: true });
				}
			} catch (err) {
				console.error('ensureServerMembership failed', err);
			} finally {
				memberEnsurePromise = null;
			}
		})();
		return memberEnsurePromise;
	}

	function joinSelectedVoiceChannel(options: { muted?: boolean; videoOff?: boolean } = {}) {
		if (!serverId || !activeChannel || activeChannel.type !== 'voice') return;
		if (
			voiceState &&
			voiceState.serverId === serverId &&
			voiceState.channelId === activeChannel.id
		) {
			voiceSession.setVisible(true);
			return;
		}
		voiceSession.join(
			serverId,
			activeChannel.id,
			activeChannel.name ?? 'Voice channel',
			serverDisplayName,
			{ muted: options.muted ?? false, videoOff: options.videoOff ?? false }
		);
		voiceSession.setVisible(true);
	}

	/* ===========================
     Mobile panels + gestures
     =========================== */
	// Initialize showChannels to true on mobile to ensure nav bar is visible immediately
	const initialIsMobile = browser && typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches;
	let showChannels = $state(initialIsMobile);
	let showMembers = $state(false);
	let desktopMembersVisible = $state(true);
	let desktopMembersPreferred = $state(true);
	let desktopMembersWideEnough = $state(true);
	let showThreadPanel = $state(false);
	let showThreadMembersSheet = $state(false);
	let mobileVoicePane: 'call' | 'chat' = $state('chat');
	let mobilePaneTracking = false;
	let mobilePaneStartX = 0;
	let mobilePaneStartY = 0;
	let lastIsMobile = false;
	let lastShowThreadPanel = false;
	let channelHeaderEl: { focusHeader?: () => void } | null = null;
	const pendingChannelRedirect = $derived.by(() => {
		const requested = requestedChannelId;
		if (!requested || activeChannel) return false;
		return !blockedChannels.has(requested);
	});
	const channelPanelInteractive = $derived.by(() => showChannels);
	const activeServerCall = $derived.by(() =>
		Boolean(
			voiceState &&
			voiceState.visible &&
			serverId &&
			activeChannel?.id &&
			voiceState.serverId === serverId &&
			voiceState.channelId === activeChannel.id
		)
	);
	const voiceDesktopLayout = $derived.by(() => !isMobile && isVoiceChannelView && activeServerCall);
	const channelPanelShowing = $derived.by(
		() =>
			showChannels || (channelSwipeActive && channelSwipeMode === 'open' && channelSwipeDelta > 0)
	);

	let dockClaimedForChannel = false;
	const releaseChannelDockSuppression = () => {
		if (!dockClaimedForChannel) return;
		dockClaimedForChannel = false;
		mobileDockSuppressed.release();
	};

	afterNavigate(() => {
		routerReady = true;
	});

	// Reset mobile dock suppression when entering server page
	// This ensures the dock is visible even if a previous page (like DMs) left it suppressed
	onMount(() => {
		mobileDockSuppressed.reset();
	});

	// Sync showChannels/showMembers with global overlay stack so mobile nav can hide/show properly
	$effect(() => {
		if (!isMobile) return;
		if (showChannels) {
			openOverlay('channel-list');
		} else {
			closeOverlay('channel-list');
		}
	});
	$effect(() => {
		if (!isMobile) return;
		if (showMembers) {
			openOverlay('members-pane');
		} else {
			closeOverlay('members-pane');
		}
	});

	const LEFT_RAIL = 72;
	const EDGE_ZONE = 120;
	const SWIPE = 48;
	const SWIPE_RATIO = 0.25;
	const DESKTOP_MEMBERS_AUTO_COLLAPSE = 1280;

	let tracking = false;
	let startX = 0;
	let startY = 0;
	let swipeTarget: 'channels' | 'members' | 'thread' | null = null;
	let channelSwipeMode: 'open' | 'close' | null = null;
	let memberSwipeMode: 'open' | 'close' | null = null;
	let threadSwipeMode: 'open' | 'close' | null = null;
	let channelSwipeWidth = $state(1);
	let memberSwipeWidth = $state(1);
	let threadSwipeWidth = $state(1);
	let channelSwipeDelta = $state(0);
	let memberSwipeDelta = $state(0);
	let threadSwipeDelta = $state(0);
	let channelSwipeActive = $state(false);
	let memberSwipeActive = $state(false);
	let threadSwipeActive = $state(false);

	const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
	const clampThreadWidth = (value: number) => clamp(value, THREAD_PANE_MIN, THREAD_PANE_MAX);

	function handleThreadResizeStart(event: PointerEvent) {
		if (!activeThread) return;
		threadResizeActive = true;
		threadResizeStartX = event.clientX;
		threadResizeStartWidth = threadPaneWidth;
		window.addEventListener('pointermove', handleThreadResizeMove);
		window.addEventListener('pointerup', stopThreadResize);
		event.preventDefault();
	}

	function handleThreadResizeMove(event: PointerEvent) {
		if (!threadResizeActive) return;
		const delta = threadResizeStartX - event.clientX;
		threadPaneWidth = clampThreadWidth(threadResizeStartWidth + delta);
	}

	function stopThreadResize() {
		if (!threadResizeActive) return;
		threadResizeActive = false;
		window.removeEventListener('pointermove', handleThreadResizeMove);
		window.removeEventListener('pointerup', stopThreadResize);
	}

	function handleThreadResizeKeydown(event: KeyboardEvent) {
		if (!activeThread) return;
		const step = event.shiftKey ? 40 : 20;
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			threadPaneWidth = clampThreadWidth(threadPaneWidth - step);
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			threadPaneWidth = clampThreadWidth(threadPaneWidth + step);
		}
	}

	const clampCallPanelWidth = (value: number) =>
		clamp(
			value,
			CALL_PANEL_MIN,
			Math.min(
				CALL_PANEL_MAX,
				Math.floor((typeof window !== 'undefined' ? window.innerWidth : 1600) * 0.65)
			)
		);
	const clampFloatingCallChatWidth = (value: number) =>
		clamp(
			value,
			320,
			Math.min(1200, Math.floor((typeof window !== 'undefined' ? window.innerWidth : 1600) * 0.7))
		);
	const clampFloatingCallChatHeight = (value: number) =>
		clamp(
			value,
			280,
			Math.min(1100, Math.floor((typeof window !== 'undefined' ? window.innerHeight : 1000) * 0.9))
		);

	const defaultFloatingChatPosition = (width: number, height: number) => {
		if (typeof window === 'undefined') return { x: 0, y: 0 };
		const x = Math.max(FLOATING_CHAT_MARGIN, window.innerWidth - width - FLOATING_CHAT_MARGIN * 2);
		const y = Math.max(
			FLOATING_CHAT_MARGIN,
			window.innerHeight - height - FLOATING_CHAT_MARGIN * 2
		);
		return { x, y };
	};

	const defaultChannelPopoutPosition = (width: number, height: number) => {
		if (typeof window === 'undefined') return { x: 0, y: 0 };
		const x = Math.max(FLOATING_CHAT_MARGIN, window.innerWidth - width - FLOATING_CHAT_MARGIN * 2);
		const y = Math.max(
			FLOATING_CHAT_MARGIN,
			window.innerHeight - height - FLOATING_CHAT_MARGIN * 2
		);
		return { x, y };
	};

	const clampChannelPopoutPosition = (
		pos: { x: number; y: number },
		width: number,
		height: number
	) => {
		if (typeof window === 'undefined') return pos;
		const minVisible = CHANNEL_POP_MIN_VISIBLE;
		const margin = FLOATING_CHAT_MARGIN;
		const minX = margin - Math.max(width - minVisible, 0);
		const maxX = Math.max(margin, window.innerWidth - margin - Math.min(width - minVisible, width));
		const minY = margin - Math.max(height - minVisible, 0);
		const maxY = Math.max(
			margin,
			window.innerHeight - margin - Math.min(height - minVisible, height)
		);
		return {
			x: Math.min(Math.max(pos.x, minX), maxX),
			y: Math.min(Math.max(pos.y, minY), maxY)
		};
	};

	function toggleCallPanel(tab: 'chat' | 'members') {
		if (!isMobile && tab === 'chat') {
			if (floatingCallChatVisible) {
				closeFloatingCallChat();
				return;
			}
			callPanelOpen = false;
			openCallChatPopout();
			return;
		}
		if (callPanelOpen && callPanelTab === tab) {
			callPanelOpen = false;
			return;
		}
		closeFloatingCallChat();
		callPanelTab = tab;
		callPanelOpen = true;
	}

	function openCallPanel(tab: 'chat' | 'members') {
		if (!isMobile && tab === 'chat') {
			openCallChatPopout();
			return;
		}
		closeFloatingCallChat();
		callPanelTab = tab;
		callPanelOpen = true;
	}

	function openChannelMessages() {
		if (isMobile) {
			mobileVoicePane = 'chat';
			return;
		}
		closeFloatingCallChat();
		callPanelOpen = false;
		const width = clamp(channelMessagesWidth, CHANNEL_POP_MIN_WIDTH, CHANNEL_POP_MAX_WIDTH);
		const height = clamp(channelMessagesHeight, CHANNEL_POP_MIN_HEIGHT, CHANNEL_POP_MAX_HEIGHT);
		channelMessagesWidth = width;
		channelMessagesHeight = height;
		if (channelMessagesPopoutPosition.x === 0 && channelMessagesPopoutPosition.y === 0) {
			channelMessagesPopoutPosition = defaultChannelPopoutPosition(width, height);
		}
		const targetChannelId = activeChannel?.id ?? null;
		channelMessagesPopoutChannelId = targetChannelId;
		channelMessagesPopoutChannelName = activeChannel?.name ?? '';
		popoutReplyTarget = null;
		popoutPendingUploads = [];
		popoutMessages = [];
		popoutEarliestLoaded = null;
		clearPopoutMessagesUnsub();
		cleanupPopoutProfileSubscriptions();
		if (serverId && targetChannelId) {
			subscribePopoutMessages(serverId, targetChannelId);
		}
		channelMessagesPopout = true;
	}

	function closeChannelMessagesPopout() {
		stopChannelMessagesDrag();
		stopChannelMessagesResize();
		channelMessagesPopout = false;
		channelMessagesPopoutChannelId = null;
		channelMessagesPopoutChannelName = '';
		popoutMessages = [];
		popoutProfiles = {};
		popoutReplyTarget = null;
		popoutPendingUploads = [];
		popoutEarliestLoaded = null;
		clearPopoutMessagesUnsub();
		cleanupPopoutProfileSubscriptions();
	}

	function handleCallPanelResizeStart(event: PointerEvent) {
		if (isMobile || !callPanelOpen) return;
		callPanelResizeActive = true;
		callPanelResizeStartX = event.clientX;
		callPanelResizeStartWidth = callPanelWidth;
		window.addEventListener('pointermove', handleCallPanelResizeMove);
		window.addEventListener('pointerup', stopCallPanelResize);
		event.preventDefault();
	}

	function handleCallPanelResizeMove(event: PointerEvent) {
		if (!callPanelResizeActive) return;
		const delta = callPanelResizeStartX - event.clientX;
		callPanelWidth = clampCallPanelWidth(callPanelResizeStartWidth + delta);
	}

	function stopCallPanelResize() {
		if (!callPanelResizeActive) return;
		callPanelResizeActive = false;
		window.removeEventListener('pointermove', handleCallPanelResizeMove);
		window.removeEventListener('pointerup', stopCallPanelResize);
	}

	function handleCallPanelResizeKeydown(event: KeyboardEvent) {
		if (!callPanelOpen) return;
		const step = event.shiftKey ? 36 : 18;
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			callPanelWidth = clampCallPanelWidth(callPanelWidth - step);
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			callPanelWidth = clampCallPanelWidth(callPanelWidth + step);
		}
	}

	function openCallChatPopout() {
		if (isMobile) return;
		callPanelTab = 'chat';
		callPanelOpen = false;
		const nextWidth = clampFloatingCallChatWidth(floatingCallChatWidth);
		const nextHeight = clampFloatingCallChatHeight(floatingCallChatHeight);
		floatingCallChatWidth = nextWidth;
		floatingCallChatHeight = nextHeight;
		floatingCallChatVisible = true;
		floatingCallChatPosition = defaultFloatingChatPosition(nextWidth, nextHeight);
		floatingCallChatDragActive = false;
		floatingCallChatResizeActive = false;
		callChatHeaderPointerId = null;
		callPanelOpen = false;
	}

	function closeFloatingCallChat() {
		if (!floatingCallChatVisible) return;
		floatingCallChatVisible = false;
		floatingCallChatDragActive = false;
		floatingCallChatResizeActive = false;
		callPanelOpen = false;
		callChatHeaderPointerId = null;
		floatingCallChatPosition = { x: 0, y: 0 };
		floatingCallChatResizeEdge = null;
		resetFloatingCallChatListeners();
	}

	function dockFloatingCallChat() {
		floatingCallChatVisible = false;
		floatingCallChatDragActive = false;
		floatingCallChatResizeActive = false;
		callChatHeaderPointerId = null;
		floatingCallChatResizeEdge = null;
		resetFloatingCallChatListeners();
		callPanelTab = 'chat';
		callPanelOpen = true;
	}

	function resetFloatingCallChatSize() {
		const nextWidth = clampFloatingCallChatWidth(FLOATING_CHAT_DEFAULT_WIDTH);
		const nextHeight = clampFloatingCallChatHeight(FLOATING_CHAT_DEFAULT_HEIGHT);
		floatingCallChatWidth = nextWidth;
		floatingCallChatHeight = nextHeight;
		floatingCallChatPosition = defaultFloatingChatPosition(nextWidth, nextHeight);
	}

	function resetFloatingCallChatListeners() {
		window.removeEventListener('pointermove', handleFloatingCallChatPointerMove);
		window.removeEventListener('pointerup', stopFloatingCallChatDrag);
		window.removeEventListener('pointercancel', stopFloatingCallChatDrag);
		window.removeEventListener('pointermove', handleFloatingCallChatResizeMove);
		window.removeEventListener('pointerup', stopFloatingCallChatResize);
		window.removeEventListener('pointercancel', stopFloatingCallChatResize);
	}

	// Channel popout drag/resize
	function handleChannelMessagesPointerDown(event: PointerEvent) {
		if (event.button !== 0) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest?.('.channel-popout-close')) return;
		channelMessagesDragActive = true;
		channelMessagesPointerId = event.pointerId;
		channelMessagesDragStart = { x: event.clientX, y: event.clientY };
		channelMessagesWindowStart = { ...channelMessagesPopoutPosition };
		window.addEventListener('pointermove', handleChannelMessagesPointerMove, { passive: false });
		window.addEventListener('pointerup', stopChannelMessagesDrag);
		window.addEventListener('pointercancel', stopChannelMessagesDrag);
		event.preventDefault();
	}

	function handleChannelMessagesPointerMove(event: PointerEvent) {
		if (!channelMessagesDragActive || event.pointerId !== channelMessagesPointerId) return;
		const dx = event.clientX - channelMessagesDragStart.x;
		const dy = event.clientY - channelMessagesDragStart.y;
		const nextPos = clampChannelPopoutPosition(
			{
				x: channelMessagesWindowStart.x + dx,
				y: channelMessagesWindowStart.y + dy
			},
			channelMessagesWidth,
			channelMessagesHeight
		);
		channelMessagesPopoutPosition = nextPos;
		event.preventDefault();
	}

	function stopChannelMessagesDrag(event?: PointerEvent) {
		if (!channelMessagesDragActive) return;
		if (event && event.pointerId !== channelMessagesPointerId) return;
		channelMessagesDragActive = false;
		channelMessagesPointerId = null;
		window.removeEventListener('pointermove', handleChannelMessagesPointerMove);
		window.removeEventListener('pointerup', stopChannelMessagesDrag);
		window.removeEventListener('pointercancel', stopChannelMessagesDrag);
	}

	function handleChannelMessagesResizeStart(
		edge: typeof channelMessagesResizeEdge,
		event: PointerEvent
	) {
		if (!channelMessagesPopout || !edge) return;
		if (event.button !== 0) return;
		(event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
		channelMessagesResizePointerId = event.pointerId;
		channelMessagesResizeActive = true;
		channelMessagesResizeEdge = edge;
		channelMessagesResizeStartX = event.clientX;
		channelMessagesResizeStartY = event.clientY;
		channelMessagesResizeStartWidth = channelMessagesWidth;
		channelMessagesResizeStartHeight = channelMessagesHeight;
		channelMessagesResizeStartPos = { ...channelMessagesPopoutPosition };
		window.addEventListener('pointermove', handleChannelMessagesResizeMove);
		window.addEventListener('pointerup', stopChannelMessagesResize);
		window.addEventListener('pointercancel', stopChannelMessagesResize);
		event.preventDefault();
	}

	function handleChannelMessagesResizeMove(event: PointerEvent) {
		if (!channelMessagesResizeActive || !channelMessagesResizeEdge) return;
		if (
			channelMessagesResizePointerId !== null &&
			event.pointerId !== channelMessagesResizePointerId
		)
			return;
		const deltaX = channelMessagesResizeStartX - event.clientX;
		const deltaY = channelMessagesResizeStartY - event.clientY;
		const edge = channelMessagesResizeEdge;
		const beyondDeadband =
			Math.abs(deltaX) > CHANNEL_POP_RESIZE_DEADBAND ||
			Math.abs(deltaY) > CHANNEL_POP_RESIZE_DEADBAND;
		let nextWidth = channelMessagesWidth;
		let nextHeight = channelMessagesHeight;
		let nextPos = { ...channelMessagesPopoutPosition };

		if (beyondDeadband) {
			if (edge.includes('left')) {
				nextWidth = clamp(
					channelMessagesResizeStartWidth + deltaX,
					CHANNEL_POP_MIN_WIDTH,
					CHANNEL_POP_MAX_WIDTH
				);
				const appliedDelta = nextWidth - channelMessagesResizeStartWidth;
				nextPos.x = channelMessagesResizeStartPos.x - appliedDelta;
			}
			if (edge.includes('right')) {
				nextWidth = clamp(
					channelMessagesResizeStartWidth - deltaX,
					CHANNEL_POP_MIN_WIDTH,
					CHANNEL_POP_MAX_WIDTH
				);
			}
			if (edge.includes('top')) {
				nextHeight = clamp(
					channelMessagesResizeStartHeight + deltaY,
					CHANNEL_POP_MIN_HEIGHT,
					CHANNEL_POP_MAX_HEIGHT
				);
				const appliedDelta = nextHeight - channelMessagesResizeStartHeight;
				nextPos.y = channelMessagesResizeStartPos.y - appliedDelta;
			}
			if (edge.includes('bottom')) {
				nextHeight = clamp(
					channelMessagesResizeStartHeight - deltaY,
					CHANNEL_POP_MIN_HEIGHT,
					CHANNEL_POP_MAX_HEIGHT
				);
			}
		}

		channelMessagesWidth = nextWidth;
		channelMessagesHeight = nextHeight;
		channelMessagesPopoutPosition = clampChannelPopoutPosition(nextPos, nextWidth, nextHeight);
	}

	function stopChannelMessagesResize(event?: PointerEvent) {
		if (!channelMessagesResizeActive) return;
		if (
			event &&
			event.pointerId &&
			channelMessagesResizePointerId !== null &&
			event.pointerId !== channelMessagesResizePointerId
		)
			return;
		channelMessagesResizeActive = false;
		channelMessagesResizeEdge = null;
		channelMessagesResizePointerId = null;
		window.removeEventListener('pointermove', handleChannelMessagesResizeMove);
		window.removeEventListener('pointerup', stopChannelMessagesResize);
		window.removeEventListener('pointercancel', stopChannelMessagesResize);
	}

	function handleFloatingCallChatPointerDown(event: PointerEvent) {
		if (!floatingCallChatVisible) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest?.('.call-chat-popout__action')) return;
		if (event.button !== 0) return;
		floatingCallChatDragActive = true;
		callChatHeaderPointerId = event.pointerId;
		floatingCallChatDragStart = { x: event.clientX, y: event.clientY };
		floatingCallChatWindowStart = { ...floatingCallChatPosition };
		window.addEventListener('pointermove', handleFloatingCallChatPointerMove, { passive: false });
		window.addEventListener('pointerup', stopFloatingCallChatDrag);
		window.addEventListener('pointercancel', stopFloatingCallChatDrag);
		event.preventDefault();
	}

	function handleFloatingCallChatPointerMove(event: PointerEvent) {
		if (!floatingCallChatDragActive || event.pointerId !== callChatHeaderPointerId) return;
		const dx = event.clientX - floatingCallChatDragStart.x;
		const dy = event.clientY - floatingCallChatDragStart.y;
		floatingCallChatPosition = {
			x: floatingCallChatWindowStart.x + dx,
			y: floatingCallChatWindowStart.y + dy
		};
		event.preventDefault();
	}

	function stopFloatingCallChatDrag(event?: PointerEvent) {
		if (!floatingCallChatDragActive) return;
		if (event && event.pointerId !== callChatHeaderPointerId) return;
		floatingCallChatDragActive = false;
		callChatHeaderPointerId = null;
		resetFloatingCallChatListeners();
	}

	function handleFloatingCallChatResizeStart(
		edge: typeof floatingCallChatResizeEdge,
		event: PointerEvent
	) {
		if (!floatingCallChatVisible || !edge) return;
		floatingCallChatResizeActive = true;
		floatingCallChatResizeEdge = edge;
		floatingCallChatResizeStartX = event.clientX;
		floatingCallChatResizeStartY = event.clientY;
		floatingCallChatResizeStartWidth = floatingCallChatWidth;
		floatingCallChatResizeStartHeight = floatingCallChatHeight;
		floatingCallChatResizeStartPos = { ...floatingCallChatPosition };
		window.addEventListener('pointermove', handleFloatingCallChatResizeMove);
		window.addEventListener('pointerup', stopFloatingCallChatResize);
		window.addEventListener('pointercancel', stopFloatingCallChatResize);
		event.preventDefault();
	}

	function handleFloatingCallChatResizeMove(event: PointerEvent) {
		if (!floatingCallChatResizeActive || !floatingCallChatResizeEdge) return;
		const deltaX = floatingCallChatResizeStartX - event.clientX;
		const deltaY = floatingCallChatResizeStartY - event.clientY;
		const edge = floatingCallChatResizeEdge;
		let nextWidth = floatingCallChatWidth;
		let nextHeight = floatingCallChatHeight;
		let nextPos = { ...floatingCallChatPosition };

		if (edge.includes('left')) {
			nextWidth = clampFloatingCallChatWidth(floatingCallChatResizeStartWidth + deltaX);
			const appliedDelta = nextWidth - floatingCallChatResizeStartWidth;
			nextPos.x = floatingCallChatResizeStartPos.x - appliedDelta;
		}
		if (edge.includes('right')) {
			nextWidth = clampFloatingCallChatWidth(floatingCallChatResizeStartWidth - deltaX);
		}
		if (edge.includes('top')) {
			nextHeight = clampFloatingCallChatHeight(floatingCallChatResizeStartHeight + deltaY);
			const appliedDelta = nextHeight - floatingCallChatResizeStartHeight;
			nextPos.y = floatingCallChatResizeStartPos.y - appliedDelta;
		}
		if (edge.includes('bottom')) {
			nextHeight = clampFloatingCallChatHeight(floatingCallChatResizeStartHeight - deltaY);
		}

		floatingCallChatWidth = nextWidth;
		floatingCallChatHeight = nextHeight;
		floatingCallChatPosition = nextPos;
	}

	function stopFloatingCallChatResize() {
		if (!floatingCallChatResizeActive) return;
		floatingCallChatResizeActive = false;
		floatingCallChatResizeEdge = null;
		window.removeEventListener('pointermove', handleFloatingCallChatResizeMove);
		window.removeEventListener('pointerup', stopFloatingCallChatResize);
		window.removeEventListener('pointercancel', stopFloatingCallChatResize);
	}

	// Multi-popup drag handling
	function resetFloatingThreadDragListeners() {
		window.removeEventListener('pointermove', handleFloatingHeaderPointerMove);
		window.removeEventListener('pointerup', stopFloatingHeaderDrag);
		window.removeEventListener('pointercancel', stopFloatingHeaderDrag);
		floatingDragPointerId = null;
		activeFloatingDragId = null;
	}

	function handleFloatingHeaderPointerDown(threadId: string, event: PointerEvent) {
		const target = event.target as HTMLElement | null;
		if (target?.closest?.('.thread-popout-close') || target?.closest?.('.thread-popout-action')) return;
		if (event.button !== 0) return;
		
		const instance = floatingThreads.find(f => f.id === threadId);
		if (!instance) return;
		
		activeFloatingDragId = threadId;
		floatingDragPointerId = event.pointerId;
		floatingDragStart = { x: event.clientX, y: event.clientY };
		floatingWindowStart = { ...instance.position };
		window.addEventListener('pointermove', handleFloatingHeaderPointerMove, { passive: false });
		window.addEventListener('pointerup', stopFloatingHeaderDrag);
		window.addEventListener('pointercancel', stopFloatingHeaderDrag);
		event.preventDefault();
	}

	function handleFloatingHeaderPointerMove(event: PointerEvent) {
		if (!activeFloatingDragId || floatingDragPointerId === null || event.pointerId !== floatingDragPointerId) {
			return;
		}
		event.preventDefault();
		const dx = event.clientX - floatingDragStart.x;
		const dy = event.clientY - floatingDragStart.y;
		
		// Fixed popup size: 400x520, centered on screen
		const popupWidth = 400;
		const popupHeight = 520;
		const minVisible = 60;
		
		const minX = minVisible - window.innerWidth / 2 + popupWidth / 2;
		const maxX = window.innerWidth / 2 - minVisible - popupWidth / 2;
		const minY = minVisible - window.innerHeight / 2 + popupHeight / 2;
		const maxY = window.innerHeight / 2 - minVisible - popupHeight / 2;
		
		const newX = Math.max(minX, Math.min(maxX, floatingWindowStart.x + dx));
		const newY = Math.max(minY, Math.min(maxY, floatingWindowStart.y + dy));
		
		floatingThreads = floatingThreads.map(f => 
			f.id === activeFloatingDragId 
				? { ...f, position: { x: newX, y: newY } }
				: f
		);
	}

	function stopFloatingHeaderDrag(event?: PointerEvent) {
		if (!activeFloatingDragId) return;
		if (event && floatingDragPointerId !== null && event.pointerId !== floatingDragPointerId) return;
		resetFloatingThreadDragListeners();
	}
	const channelsTransform = $derived.by(() => {
		if (pendingChannelRedirect) {
			return 'translate3d(-100%, 0, 0)';
		}
		if (channelSwipeActive && channelSwipeMode && channelSwipeWidth > 0) {
			const progress = clamp(channelSwipeDelta / channelSwipeWidth, -1, 1);
			if (channelSwipeMode === 'open') {
				const offset = clamp(-100 + Math.max(progress, 0) * 100, -100, 0);
				return `translate3d(${offset}%, 0, 0)`;
			}
			const offset = clamp(progress * 100, -100, 0);
			return `translate3d(${offset}%, 0, 0)`;
		}
		return showChannels ? 'translate3d(0, 0, 0)' : 'translate3d(-100%, 0, 0)';
	});
	const membersTransform = $derived.by(() => {
		if (memberSwipeActive && memberSwipeMode && memberSwipeWidth > 0) {
			const progress = clamp(memberSwipeDelta / memberSwipeWidth, -1, 1);
			if (memberSwipeMode === 'open') {
				const offset = clamp(100 + progress * 100, 0, 100);
				return `translate3d(${offset}%, 0, 0)`;
			}
			const offset = clamp(progress * 100, 0, 100);
			return `translate3d(${offset}%, 0, 0)`;
		}
		return showMembers ? 'translate3d(0, 0, 0)' : 'translate3d(100%, 0, 0)';
	});
	const threadTransform = $derived.by(() => {
		if (threadSwipeActive && threadSwipeMode && threadSwipeWidth > 0) {
			const progress = clamp(threadSwipeDelta / threadSwipeWidth, -1, 1);
			if (threadSwipeMode === 'open') {
				const offset = clamp(100 + progress * 100, 0, 100);
				return `translate3d(${offset}%, 0, 0)`;
			}
			const offset = progress >= 0 ? clamp(progress * 100, 0, 100) : clamp(progress * 100, -100, 0);
			return `translate3d(${offset}%, 0, 0)`;
		}
		return showThreadPanel ? 'translate3d(0, 0, 0)' : 'translate3d(100%, 0, 0)';
	});

	const inLeftEdgeZone = (value: number) => {
		if (isMobile) return true;
		return value >= LEFT_RAIL && value <= LEFT_RAIL + EDGE_ZONE;
	};

	function setupGestures() {
		if (typeof window === 'undefined') return () => {};

		const mdQuery = window.matchMedia('(min-width: 768px)');
		const lgQuery = window.matchMedia('(min-width: 1024px)');

		const isTypingTarget = (target: EventTarget | null) => {
			const node = (target as HTMLElement | null) ?? null;
			if (!node) return false;
			const tag = node.tagName?.toLowerCase?.() ?? '';
			if (tag === 'input' || tag === 'textarea') return true;
			if (node.isContentEditable) return true;
			return Boolean(node.closest?.('input, textarea, [contenteditable="true"]'));
		};

		const onMedia = () => {
			const nextIsMobile = !mdQuery.matches;
			isMobile = nextIsMobile;
			if (!nextIsMobile) {
				mobileVoicePane = 'chat';
			} else if (voiceState?.visible) {
				mobileVoicePane = 'call';
			}
			if (mdQuery.matches) showChannels = false;
			if (lgQuery.matches) {
				showMembers = false;
				showThreadPanel = false;
			}
		};

		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				showChannels = false;
				showMembers = false;
				if (activeThread) {
					closeThreadView();
				} else {
					showThreadPanel = false;
				}
			}
			const openThreadBinding = activeKeybinds.openLatestThread;
			if (
				openThreadBinding &&
				matchKeybind(e, openThreadBinding) &&
				!e.repeat &&
				!isMobile &&
				!isTypingTarget(e.target)
			) {
				if (openLatestThreadShortcut()) {
					e.preventDefault();
				}
			}
		};

		const resetChannelSwipe = () => {
			channelSwipeMode = null;
			channelSwipeActive = false;
			channelSwipeDelta = 0;
		};

		const resetMemberSwipe = () => {
			memberSwipeMode = null;
			memberSwipeActive = false;
			memberSwipeDelta = 0;
		};

		const resetThreadSwipe = () => {
			threadSwipeMode = null;
			threadSwipeActive = false;
			threadSwipeDelta = 0;
		};

		const cancelSwipe = () => {
			tracking = false;
			swipeTarget = null;
			resetChannelSwipe();
			resetMemberSwipe();
			resetThreadSwipe();
		};

		const onTouchStart = (e: TouchEvent) => {
			if (e.touches.length !== 1) return;
			const touch = e.touches[0];
			startX = touch.clientX;
			startY = touch.clientY;
			channelSwipeWidth = Math.max(window.innerWidth, 1);
			memberSwipeWidth = channelSwipeWidth;
			threadSwipeWidth = channelSwipeWidth;
			resetChannelSwipe();
			resetMemberSwipe();
			resetThreadSwipe();
			swipeTarget = null;

			const nearLeft = isMobile || inLeftEdgeZone(startX);
			const nearRight = isMobile || window.innerWidth - startX <= EDGE_ZONE;
			tracking = showChannels || showMembers || showThreadPanel || nearLeft || nearRight;
			if (!tracking) return;

			if (showChannels) {
				swipeTarget = 'channels';
				channelSwipeMode = 'close';
			} else if (showMembers) {
				swipeTarget = 'members';
				memberSwipeMode = 'close';
			} else if (showThreadPanel) {
				swipeTarget = 'thread';
				threadSwipeMode = 'close';
			}
		};

		const onTouchMove = (e: TouchEvent) => {
			if (!tracking || e.touches.length !== 1) return;
			const touch = e.touches[0];
			const dx = touch.clientX - startX;
			const dy = touch.clientY - startY;

			if (Math.abs(dy) > Math.abs(dx) * 1.35) {
				cancelSwipe();
				return;
			}

			if (!swipeTarget) {
				if (dx > 0) {
					swipeTarget = 'channels';
					channelSwipeMode = 'open';
				} else if (dx < 0) {
					swipeTarget = 'members';
					memberSwipeMode = 'open';
				} else {
					return;
				}
			}

			if (swipeTarget === 'channels') {
				if (!channelSwipeActive) {
					channelSwipeActive = true;
					if (!channelSwipeMode) {
						channelSwipeMode = dx > 0 ? 'open' : 'close';
					}
				}
				channelSwipeDelta = dx;
				// Report swipe progress for smooth dock animation
				if (channelSwipeMode === 'open' && channelSwipeWidth > 0) {
					const progress = clamp(dx / channelSwipeWidth, 0, 1);
					mobileSwipeProgress.set('channels', progress);
				}
			} else if (swipeTarget === 'members') {
				if (!memberSwipeActive) {
					memberSwipeActive = true;
					if (!memberSwipeMode) {
						memberSwipeMode = dx < 0 ? 'open' : 'close';
					}
				}
				memberSwipeDelta = dx;
			} else if (swipeTarget === 'thread') {
				if (!threadSwipeActive) {
					threadSwipeActive = true;
					if (!threadSwipeMode) {
						threadSwipeMode = dx < 0 ? 'open' : 'close';
					}
				}
				threadSwipeDelta = dx;
			}
		};

		const onTouchEnd = () => {
			// Reset swipe progress first
			mobileSwipeProgress.reset();
			
			if (swipeTarget === 'channels' && channelSwipeMode && channelSwipeWidth > 0) {
				const traveled =
					channelSwipeMode === 'close'
						? Math.max(0, -channelSwipeDelta)
						: Math.max(0, channelSwipeDelta);
				const ratio = traveled / channelSwipeWidth;
				if (traveled >= SWIPE || ratio >= SWIPE_RATIO) {
					showChannels = channelSwipeMode === 'open';
				}
			} else if (swipeTarget === 'members' && memberSwipeMode && memberSwipeWidth > 0) {
				const traveled =
					memberSwipeMode === 'close'
						? Math.max(0, memberSwipeDelta)
						: Math.max(0, -memberSwipeDelta);
				const ratio = traveled / memberSwipeWidth;
				if (traveled >= SWIPE || ratio >= SWIPE_RATIO) {
					showMembers = memberSwipeMode === 'open';
				}
			} else if (swipeTarget === 'thread' && threadSwipeMode && threadSwipeWidth > 0) {
				const traveled =
					threadSwipeMode === 'close'
						? Math.max(0, Math.abs(threadSwipeDelta))
						: Math.max(0, -threadSwipeDelta);
				const ratio = traveled / threadSwipeWidth;
				if (traveled >= SWIPE || ratio >= SWIPE_RATIO) {
					if (threadSwipeMode === 'close') {
						closeThreadView();
					} else {
						showThreadPanel = true;
					}
				}
			}
			cancelSwipe();
		};

		window.addEventListener('keydown', onKey);
		window.addEventListener('touchstart', onTouchStart, { passive: true });
		window.addEventListener('touchmove', onTouchMove, { passive: true });
		window.addEventListener('touchend', onTouchEnd, { passive: true });
		mdQuery.addEventListener('change', onMedia);
		lgQuery.addEventListener('change', onMedia);
		onMedia();

		return () => {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('touchstart', onTouchStart);
			window.removeEventListener('touchmove', onTouchMove);
			window.removeEventListener('touchend', onTouchEnd);
			mdQuery.removeEventListener('change', onMedia);
			lgQuery.removeEventListener('change', onMedia);
		};
	}

	function setupDesktopMembersWatcher() {
		if (typeof window === 'undefined') return () => {};
		const query = window.matchMedia(`(min-width: ${DESKTOP_MEMBERS_AUTO_COLLAPSE}px)`);
		const update = () => {
			const wideEnough = query.matches;
			desktopMembersWideEnough = wideEnough;
			desktopMembersVisible = wideEnough ? desktopMembersPreferred : false;
		};
		query.addEventListener('change', update);
		update();
		return () => {
			query.removeEventListener('change', update);
		};
	}

	onMount(() => {
		// Load channel memory on mount
		loadServerChannelMemory();
		const cleanupGestures = setupGestures();
		const cleanupMembersWatcher = setupDesktopMembersWatcher();
		
		// Listen for openFloatingThread custom events from ThreadsFab and TicketFab
		// Can receive either { thread, root } or { serverId, channelId, threadId }
		function handleOpenFloatingThread(event: Event) {
			const detail = (event as CustomEvent<{ thread?: ChannelThread; root?: any; serverId?: string; channelId?: string; threadId?: string }>).detail;
			
			// If we got IDs, fetch the thread first
			if (detail.serverId && detail.channelId && detail.threadId) {
				openFloatingThreadById(detail.serverId, detail.channelId, detail.threadId);
				return;
			}
			
			// Otherwise use the thread object directly - create a new popup
			if (detail.thread) {
				// Check if already open
				const existingIndex = floatingThreads.findIndex(f => f.id === detail.thread!.id);
				if (existingIndex >= 0) return;
				
				const offset = floatingThreads.length * 30;
				const newInstance: FloatingThreadInstance = {
					id: detail.thread.id,
					thread: detail.thread,
					root: detail.root ?? null,
					messages: [],
					replyTarget: null,
					conversationContext: [],
					defaultSuggestionSource: null,
					pendingUploads: [],
					position: { x: offset, y: offset },
					stream: null
				};
				floatingThreads = [...floatingThreads, newInstance];
				attachFloatingThreadStream(detail.thread.id, detail.thread);
			}
		}
		window.addEventListener('openFloatingThread', handleOpenFloatingThread);
		
		return () => {
			cleanupGestures();
			cleanupMembersWatcher();
			window.removeEventListener('openFloatingThread', handleOpenFloatingThread);
		};
	});

	function setMobileVoicePane(pane: 'call' | 'chat') {
		mobileVoicePane = pane;
	}

	function handleMobilePaneTouchStart(event: TouchEvent) {
		if (!isMobile || !(voiceState && voiceState.visible)) return;
		if (event.touches.length !== 1) return;
		mobilePaneTracking = true;
		const touch = event.touches[0];
		mobilePaneStartX = touch.clientX;
		mobilePaneStartY = touch.clientY;
	}

	function handleMobilePaneTouchMove(event: TouchEvent) {
		if (!mobilePaneTracking || event.touches.length !== 1) return;
		const touch = event.touches[0];
		const dx = touch.clientX - mobilePaneStartX;
		const dy = touch.clientY - mobilePaneStartY;
		if (Math.abs(dy) > Math.abs(dx) * 1.25) return;
		if (mobileVoicePane === 'call' && dx <= -SWIPE) {
			mobileVoicePane = 'chat';
			mobilePaneTracking = false;
		} else if (mobileVoicePane === 'chat' && dx >= SWIPE) {
			mobileVoicePane = 'call';
			mobilePaneTracking = false;
		}
	}

	function handleMobilePaneTouchEnd() {
		mobilePaneTracking = false;
	}

	onDestroy(() => {
		clearMessagesUnsub();
		clearPopoutMessagesUnsub();
		resetThreadState();
		clearServerThreads();
		cleanupProfileSubscriptions();
		cleanupPopoutProfileSubscriptions();
		clearPinnedState();
		clearPopoutPinnedState();
		releaseChannelDockSuppression();
		unsubscribeVoice();
		serverMetaUnsub?.();
		serverMetaUnsub = null;
		mentionDirectoryStop?.();
		mentionDirectoryStop = null;
		mentionRolesStop?.();
		mentionRolesStop = null;
		lastMentionServer = null;
		memberMentionOptions = [];
		roleMentionOptions = [];
		mentionOptions = [];
		closeFloatingCallChat();
		closeFloatingThread();
		stopThreadResize();
		stopCallPanelResize();
		stopFloatingCallChatResize();
		ticketAiSettingsUnsub?.();
		ticketAiSettingsUnsub = null;
		ticketAiSettings = null;
		ticketAiSettingsServerId = null;
		ticketedMsgUnsub?.();
		ticketedMsgUnsub = null;
		ticketedMsgChannelId = null;
		ticketedMessageIds = new Set();
		memberPermsUnsub?.();
		memberPermsUnsub = null;
		memberPermsServer = null;
	});

	function markChannelReadFromMessages(
		sId: string | null,
		channelId: string | null,
		list: any[]
	) {
		if (!sId || !channelId || !$user?.uid) return;
		if (!Array.isArray(list) || list.length === 0) return;
		const last = list[list.length - 1];
		const at = last?.createdAt ?? null;
		const lastId = last?.id ?? null;
		if (!lastId) return;
		if (lastReadMessageIds[channelId] === lastId) return;
		lastReadMessageIds[channelId] = lastId;
		void markChannelRead($user.uid, sId, channelId, { at, lastMessageId: lastId });
		void markChannelActivityRead(sId, channelId);
	}

	// Persist read state when tab is hidden
	if (typeof window !== 'undefined') {
		const onVis = () => {
			if (document.visibilityState === 'hidden' && serverId && activeChannel?.id) {
				markChannelReadFromMessages(serverId, activeChannel.id, messages);
			}
		};
		window.addEventListener('visibilitychange', onVis);
		onDestroy(() => window.removeEventListener('visibilitychange', onVis));
	}

	function normalizeMentionSendList(list: MentionSendRecord[] | undefined) {
		if (!Array.isArray(list) || !list.length) return [];
		const cleaned = list.filter(
			(item): item is MentionSendRecord => !!item?.uid && (!!item?.handle || !!item?.label)
		);
		if (!cleaned.length || !mentionOptions.length) return cleaned;
		const allowed = new Set(mentionOptions.map((entry) => entry.uid));
		return cleaned.filter((item) => allowed.has(item.uid));
	}

	async function handleSend(
		payload:
			| string
			| { text: string; mentions?: MentionSendRecord[]; replyTo?: ReplyReferenceInput | null }
	) {
		const raw = typeof payload === 'string' ? payload : (payload?.text ?? '');
		const trimmed = raw?.trim?.() ?? '';
		if (!trimmed) return;
		if (!serverId) {
			alert('Missing server id.');
			return;
		}
		if (!activeChannel?.id) {
			alert('Pick a channel first.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumeReply(typeof payload === 'object' ? (payload?.replyTo ?? null) : null);
		const mentionList = normalizeMentionSendList(
			typeof payload === 'object' ? (payload?.mentions ?? []) : []
		);
		
		// Use optimistic send with local echo - renders immediately as pending
		const endTimer = timeMessageSend();
		try {
			sendChannelMessageOptimized(serverId, activeChannel.id, {
				type: 'text',
				text: trimmed,
				uid: $user.uid,
				displayName: deriveCurrentDisplayName(),
				photoURL: deriveCurrentPhotoURL(),
				mentions: mentionList,
				replyTo: replyRef ?? undefined
			});
			// Timer ends after pending message is added (nearly instant)
			endTimer();
		} catch (err) {
			endTimer();
			restoreReply(replyRef);
			console.error(err);
			alert(`Failed to send message: ${err}`);
		}
	}

	async function handleSendGif(
		detail: string | { url: string; replyTo?: ReplyReferenceInput | null }
	) {
		const trimmed = pickString(typeof detail === 'string' ? detail : detail?.url);
		if (!trimmed) return;
		if (!serverId) {
			alert('Missing server id.');
			return;
		}
		if (!activeChannel?.id) {
			alert('Pick a channel first.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumeReply(typeof detail === 'object' ? (detail?.replyTo ?? null) : null);
		
		// Use optimized send with local echo - no await needed
		const endTimer = timeMessageSend();
		try {
			sendChannelMessageOptimized(serverId, activeChannel.id, {
				type: 'gif',
				url: trimmed,
				uid: $user.uid,
				displayName: deriveCurrentDisplayName(),
				photoURL: deriveCurrentPhotoURL(),
				replyTo: replyRef ?? undefined
			});
			endTimer();
		} catch (err) {
			endTimer();
			restoreReply(replyRef);
			console.error(err);
			alert(`Failed to share GIF: ${err}`);
		}
	}

	async function handleUploadFiles(request: {
		files: File[];
		replyTo?: ReplyReferenceInput | null;
	}) {
		const selection = Array.from(request?.files ?? []).filter(
			(file): file is File => file instanceof File
		);
		if (!selection.length) return;
		if (!serverId) {
			alert('Missing server id.');
			return;
		}
		if (!activeChannel?.id) {
			alert('Pick a channel first.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumeReply(request?.replyTo ?? null);
		let replyUsed = false;
		const identity = {
			uid: $user.uid,
			displayName: deriveCurrentDisplayName(),
			photoURL: deriveCurrentPhotoURL()
		};
		for (const file of selection) {
			const pending = registerPendingUpload(file);
			try {
				const uploaded = await uploadChannelFile({
					serverId,
					channelId: activeChannel.id,
					uid: $user.uid,
					file,
					onProgress: (progress) => pending.update(progress ?? 0)
				});
				await sendChannelMessage(serverId, activeChannel.id, {
					type: 'file',
					file: {
						name: file.name || uploaded.name,
						url: uploaded.url,
						size: file.size ?? uploaded.size,
						contentType: file.type || uploaded.contentType,
						storagePath: uploaded.storagePath
					},
					...identity,
					replyTo: !replyUsed && replyRef ? replyRef : undefined
				});
				pending.finish(true);
				if (replyRef && !replyUsed) {
					replyUsed = true;
				}
			} catch (err) {
				pending.finish(false);
				if (replyRef && !replyUsed) {
					restoreReply(replyRef);
				}
				console.error(err);
				alert(
					`Failed to upload ${file?.name || 'file'}: ${err instanceof Error ? err.message : err}`
				);
				break;
			}
		}
	}

	async function handleCreatePoll(poll: {
		question: string;
		options: string[];
		replyTo?: ReplyReferenceInput | null;
	}) {
		if (!serverId) {
			alert('Missing server id.');
			return;
		}
		if (!activeChannel?.id) {
			alert('Pick a channel first.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumeReply(poll?.replyTo ?? null);
		try {
			await sendChannelMessage(serverId, activeChannel.id, {
				type: 'poll',
				poll: {
					question: poll.question,
					options: poll.options
				},
				uid: $user.uid,
				displayName: deriveCurrentDisplayName(),
				photoURL: deriveCurrentPhotoURL(),
				replyTo: replyRef ?? undefined
			});
		} catch (err) {
			restoreReply(replyRef);
			console.error(err);
			alert(`Failed to create poll: ${err}`);
		}
	}

	async function handleCreateForm(form: {
		title: string;
		questions: string[];
		replyTo?: ReplyReferenceInput | null;
	}) {
		if (!serverId) {
			alert('Missing server id.');
			return;
		}
		if (!activeChannel?.id) {
			alert('Pick a channel first.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumeReply(form?.replyTo ?? null);
		try {
			await sendChannelMessage(serverId, activeChannel.id, {
				type: 'form',
				form: {
					title: form.title,
					questions: form.questions
				},
				uid: $user.uid,
				displayName: deriveCurrentDisplayName(),
				photoURL: deriveCurrentPhotoURL(),
				replyTo: replyRef ?? undefined
			});
		} catch (err) {
			restoreReply(replyRef);
			console.error(err);
			alert(`Failed to share form: ${err}`);
		}
	}

	async function handlePopoutSend(
		payload:
			| string
			| { text: string; mentions?: MentionSendRecord[]; replyTo?: ReplyReferenceInput | null }
	) {
		const raw = typeof payload === 'string' ? payload : (payload?.text ?? '');
		const trimmed = raw?.trim?.() ?? '';
		if (!trimmed) return;
		if (!serverId) {
			alert('Missing server id.');
			return;
		}
		if (!channelMessagesPopoutChannelId) {
			alert('Pick a channel first.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumePopoutReply(
			typeof payload === 'object' ? (payload?.replyTo ?? null) : null
		);
		const mentionList = normalizeMentionSendList(
			typeof payload === 'object' ? (payload?.mentions ?? []) : []
		);
		try {
			await sendChannelMessage(serverId, channelMessagesPopoutChannelId, {
				type: 'text',
				text: trimmed,
				uid: $user.uid,
				displayName: deriveCurrentDisplayName(),
				photoURL: deriveCurrentPhotoURL(),
				mentions: mentionList,
				replyTo: replyRef ?? undefined
			});
		} catch (err) {
			restorePopoutReply(replyRef);
			console.error(err);
			alert(`Failed to send message: ${err}`);
		}
	}

	async function handlePopoutSendGif(
		detail: string | { url: string; replyTo?: ReplyReferenceInput | null }
	) {
		const trimmed = pickString(typeof detail === 'string' ? detail : detail?.url);
		if (!trimmed) return;
		if (!serverId) {
			alert('Missing server id.');
			return;
		}
		if (!channelMessagesPopoutChannelId) {
			alert('Pick a channel first.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumePopoutReply(
			typeof detail === 'object' ? (detail?.replyTo ?? null) : null
		);
		try {
			await sendChannelMessage(serverId, channelMessagesPopoutChannelId, {
				type: 'gif',
				url: trimmed,
				uid: $user.uid,
				displayName: deriveCurrentDisplayName(),
				photoURL: deriveCurrentPhotoURL(),
				replyTo: replyRef ?? undefined
			});
		} catch (err) {
			restorePopoutReply(replyRef);
			console.error(err);
			alert(`Failed to share GIF: ${err}`);
		}
	}

	async function handlePopoutUploadFiles(request: {
		files: File[];
		replyTo?: ReplyReferenceInput | null;
	}) {
		const selection = Array.from(request?.files ?? []).filter(
			(file): file is File => file instanceof File
		);
		if (!selection.length) return;
		if (!serverId) {
			alert('Missing server id.');
			return;
		}
		if (!channelMessagesPopoutChannelId) {
			alert('Pick a channel first.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumePopoutReply(request?.replyTo ?? null);
		let replyUsed = false;
		const identity = {
			uid: $user.uid,
			displayName: deriveCurrentDisplayName(),
			photoURL: deriveCurrentPhotoURL()
		};
		for (const file of selection) {
			const pending = registerPendingUpload(file, 'popout');
			try {
				const uploaded = await uploadChannelFile({
					serverId,
					channelId: channelMessagesPopoutChannelId,
					uid: $user.uid,
					file,
					onProgress: (progress) => pending.update(progress ?? 0)
				});
				await sendChannelMessage(serverId, channelMessagesPopoutChannelId, {
					type: 'file',
					file: {
						name: file.name || uploaded.name,
						url: uploaded.url,
						size: file.size ?? uploaded.size,
						contentType: file.type || uploaded.contentType,
						storagePath: uploaded.storagePath
					},
					...identity,
					replyTo: !replyUsed && replyRef ? replyRef : undefined
				});
				pending.finish(true);
				if (replyRef && !replyUsed) {
					replyUsed = true;
				}
			} catch (err) {
				pending.finish(false);
				if (replyRef && !replyUsed) {
					restorePopoutReply(replyRef);
				}
				console.error(err);
				alert(
					`Failed to upload ${file?.name || 'file'}: ${err instanceof Error ? err.message : err}`
				);
				break;
			}
		}
	}

	async function handlePopoutCreatePoll(poll: {
		question: string;
		options: string[];
		replyTo?: ReplyReferenceInput | null;
	}) {
		if (!serverId) {
			alert('Missing server id.');
			return;
		}
		if (!channelMessagesPopoutChannelId) {
			alert('Pick a channel first.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumePopoutReply(poll?.replyTo ?? null);
		try {
			await sendChannelMessage(serverId, channelMessagesPopoutChannelId, {
				type: 'poll',
				poll: {
					question: poll.question,
					options: poll.options
				},
				uid: $user.uid,
				displayName: deriveCurrentDisplayName(),
				photoURL: deriveCurrentPhotoURL(),
				replyTo: replyRef ?? undefined
			});
		} catch (err) {
			restorePopoutReply(replyRef);
			console.error(err);
			alert(`Failed to create poll: ${err}`);
		}
	}

	async function handlePopoutCreateForm(form: {
		title: string;
		questions: string[];
		replyTo?: ReplyReferenceInput | null;
	}) {
		if (!serverId) {
			alert('Missing server id.');
			return;
		}
		if (!channelMessagesPopoutChannelId) {
			alert('Pick a channel first.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumePopoutReply(form?.replyTo ?? null);
		try {
			await sendChannelMessage(serverId, channelMessagesPopoutChannelId, {
				type: 'form',
				form: {
					title: form.title,
					questions: form.questions
				},
				uid: $user.uid,
				displayName: deriveCurrentDisplayName(),
				photoURL: deriveCurrentPhotoURL(),
				replyTo: replyRef ?? undefined
			});
		} catch (err) {
			restorePopoutReply(replyRef);
			console.error(err);
			alert(`Failed to share form: ${err}`);
		}
	}

	async function handleThreadSend(
		payload:
			| string
			| { text: string; mentions?: MentionSendRecord[]; replyTo?: ReplyReferenceInput | null }
	) {
		const raw = typeof payload === 'string' ? payload : (payload?.text ?? '');
		const trimmed = raw?.trim?.() ?? '';
		if (!trimmed) return;
		const info = threadChannelInfo(activeThread, activeChannel?.id ?? null);
		if (!info) {
			alert('Open a thread before replying.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumeThreadReply(
			typeof payload === 'object' ? (payload?.replyTo ?? null) : null
		);
		const mentions = normalizeMentionSendList(
			typeof payload === 'object' ? (payload?.mentions ?? []) : []
		);
		try {
			await sendThreadMessage({
				serverId: info.serverId,
				channelId: info.channelId,
				threadId: info.thread.id,
				message: {
					type: 'text',
					text: trimmed,
					uid: $user.uid,
					displayName: deriveCurrentDisplayName(),
					photoURL: deriveCurrentPhotoURL(),
					mentions,
					replyTo: replyRef ?? undefined
				},
				mentionProfiles: profiles
			});
		} catch (err) {
			restoreThreadReply(replyRef);
			console.error(err);
			alert(`Failed to send thread reply: ${err instanceof Error ? err.message : err}`);
		}
	}

	async function handleThreadSendGif(
		detail: string | { url: string; replyTo?: ReplyReferenceInput | null }
	) {
		const trimmed = pickString(typeof detail === 'string' ? detail : detail?.url);
		if (!trimmed) return;
		const info = threadChannelInfo(activeThread, activeChannel?.id ?? null);
		if (!info) {
			alert('Open a thread before replying.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumeThreadReply(
			typeof detail === 'object' ? (detail?.replyTo ?? null) : null
		);
		try {
			await sendThreadMessage({
				serverId: info.serverId,
				channelId: info.channelId,
				threadId: info.thread.id,
				message: {
					type: 'gif',
					url: trimmed,
					uid: $user.uid,
					displayName: deriveCurrentDisplayName(),
					photoURL: deriveCurrentPhotoURL(),
					replyTo: replyRef ?? undefined
				},
				mentionProfiles: profiles
			});
		} catch (err) {
			restoreThreadReply(replyRef);
			console.error(err);
			alert(`Failed to share GIF: ${err instanceof Error ? err.message : err}`);
		}
	}

	async function handleThreadUploadFiles(request: {
		files: File[];
		replyTo?: ReplyReferenceInput | null;
	}) {
		const selection = Array.from(request?.files ?? []).filter(
			(file): file is File => file instanceof File
		);
		if (!selection.length) return;
		const info = threadChannelInfo(activeThread, activeChannel?.id ?? null);
		if (!info) {
			alert('Open a thread before uploading.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumeThreadReply(request?.replyTo ?? null);
		let replyUsed = false;
		const identity = {
			uid: $user.uid,
			displayName: deriveCurrentDisplayName(),
			photoURL: deriveCurrentPhotoURL()
		};
		for (const file of selection) {
			const pending = registerPendingUpload(file, 'thread');
			try {
				const uploaded = await uploadChannelFile({
					serverId: info.serverId,
					channelId: info.channelId,
					uid: $user.uid,
					file,
					onProgress: (progress) => pending.update(progress ?? 0)
				});
				await sendThreadMessage({
					serverId: info.serverId,
					channelId: info.channelId,
					threadId: info.thread.id,
					message: {
						type: 'file',
						file: {
							name: file.name || uploaded.name,
							url: uploaded.url,
							size: file.size ?? uploaded.size,
							contentType: file.type || uploaded.contentType,
							storagePath: uploaded.storagePath
						},
						...identity,
						replyTo: !replyUsed && replyRef ? replyRef : undefined
					},
					mentionProfiles: profiles
				});
				pending.finish(true);
				if (replyRef && !replyUsed) {
					replyUsed = true;
				}
			} catch (err) {
				pending.finish(false);
				if (replyRef && !replyUsed) {
					restoreThreadReply(replyRef);
				}
				console.error(err);
				alert(
					`Failed to upload ${file?.name || 'file'}: ${err instanceof Error ? err.message : err}`
				);
				break;
			}
		}
	}

	async function handleThreadCreatePoll() {
		alert('Polls are not supported inside threads yet.');
	}

	async function handleThreadCreateForm() {
		alert('Forms are not supported inside threads yet.');
	}

	const threadChannelInfo = (
		thread: ChannelThread | null,
		fallbackChannelId: string | null = null
	) => {
		if (!thread) return null;
		const channelId = thread.parentChannelId ?? thread.channelId ?? fallbackChannelId;
		const serverRef = thread.serverId ?? serverId;
		if (!channelId || !serverRef) return null;
		return {
			serverId: serverRef,
			channelId,
			thread
		};
	};

	function attachFloatingThreadStream(threadId: string, thread: ChannelThread | null) {
		const instance = floatingThreads.find(f => f.id === threadId);
		if (!instance) return;
		
		// Clean up existing stream for this instance
		instance.stream?.();
		
		const info = threadChannelInfo(thread);
		if (!info) return;
		
		const unsubscribe = streamThreadMessages(
			info.serverId,
			info.channelId,
			info.thread.id,
			(list) => {
				floatingThreads = floatingThreads.map(f => 
					f.id === threadId ? { ...f, messages: list } : f
				);
				if ($user?.uid) {
					const last = list[list.length - 1];
					const at = last?.createdAt ?? null;
					const lastId = last?.id ?? null;
					void markThreadReadThread($user.uid, info.serverId, info.channelId, info.thread.id, {
						at,
						lastMessageId: lastId
					});
				}
			},
			{
				onError: (err) => {
					console.error('Failed to load floating thread messages', err);
					if ((err as any)?.code === 'permission-denied') {
						handleChannelDenied(info.channelId);
					}
				}
			}
		);
		
		floatingThreads = floatingThreads.map(f => 
			f.id === threadId ? { ...f, stream: unsubscribe } : f
		);
	}

	function openThreadPopout() {
		if (isMobile) return;
		if (!activeThread || !activeThreadRoot) return;
		
		const threadId = activeThread.id;
		
		// Check if this thread is already open
		const existingIndex = floatingThreads.findIndex(f => f.thread.id === threadId);
		if (existingIndex >= 0) {
			// Already open, just bring focus (could add z-index later)
			return;
		}
		
		// Calculate position offset for stacking multiple popups
		const offset = floatingThreads.length * 30;
		
		const newInstance: FloatingThreadInstance = {
			id: threadId,
			thread: activeThread,
			root: activeThreadRoot,
			messages: [],
			replyTarget: null,
			conversationContext: [],
			defaultSuggestionSource: null,
			pendingUploads: [],
			position: { x: offset, y: offset },
			stream: null
		};
		
		floatingThreads = [...floatingThreads, newInstance];
		attachFloatingThreadStream(threadId, activeThread);
		closeThreadView();
	}

	// Open a floating thread by ID (used for popup mode and external events)
	async function openFloatingThreadById(sId: string, chId: string, thId: string) {
		try {
			// Check if this thread is already open
			const existingIndex = floatingThreads.findIndex(f => f.id === thId);
			if (existingIndex >= 0) {
				// Already open
				return;
			}
			
			const thread = await getThread(sId, chId, thId);
			if (!thread) {
				console.warn('Thread not found:', thId);
				return;
			}
			
			// Fetch the root message (original message the thread was created from)
			let root = null;
			if (thread.createdFromMessageId) {
				try {
					const database = db();
					const snap = await getDoc(
						doc(database, 'servers', sId, 'channels', chId, 'messages', thread.createdFromMessageId)
					);
					if (snap.exists()) {
						root = toChatMessage(snap.id, snap.data());
					}
				} catch (err) {
					console.warn('Failed to load root message for floating thread:', err);
				}
			}
			
			// Calculate position offset for stacking multiple popups
			const offset = floatingThreads.length * 30;
			
			const newInstance: FloatingThreadInstance = {
				id: thread.id,
				thread,
				root,
				messages: [],
				replyTarget: null,
				conversationContext: [],
				defaultSuggestionSource: null,
				pendingUploads: [],
				position: { x: offset, y: offset },
				stream: null
			};
			
			floatingThreads = [...floatingThreads, newInstance];
			attachFloatingThreadStream(thread.id, thread);
		} catch (err) {
			console.error('Failed to open floating thread by ID:', err);
		}
	}

	function closeFloatingThread(threadId?: string) {
		if (!threadId) {
			// Close all
			floatingThreads.forEach(f => f.stream?.());
			floatingThreads = [];
			resetFloatingThreadDragListeners();
			return;
		}
		
		const instance = floatingThreads.find(f => f.id === threadId);
		if (instance) {
			instance.stream?.();
			floatingThreads = floatingThreads.filter(f => f.id !== threadId);
		}
		
		if (activeFloatingDragId === threadId) {
			resetFloatingThreadDragListeners();
		}
	}

	// Open thread in a separate mini browser window (like Google Meet PiP)
	function openThreadInWindow(threadId: string) {
		const instance = floatingThreads.find(f => f.id === threadId);
		if (!instance?.thread) return;
		
		const thread = instance.thread;
		const url = `/servers/${thread.serverId}?channel=${thread.parentChannelId}&thread=${thread.id}&popup=1`;
		
		// Calculate window size and position
		const width = 420;
		const height = 600;
		const left = window.screen.width - width - 20;
		const top = window.screen.height - height - 100;
		
		// Open as a popup window
		const popup = window.open(
			url,
			`thread-${thread.id}`,
			`width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no`
		);
		
		if (popup) {
			// Close the in-page floating thread
			closeFloatingThread(threadId);
		}
	}

	// Instance-specific handlers for multi-popup support
	function handleFloatingThreadReplySelectForInstance(threadId: string, event: CustomEvent<{ message: any }>) {
		const ref = buildReplyReference(event.detail?.message);
		if (!ref) return;
		floatingThreads = floatingThreads.map(f => 
			f.id === threadId ? { ...f, replyTarget: ref } : f
		);
	}

	function resetFloatingThreadReplyTargetForInstance(threadId: string) {
		floatingThreads = floatingThreads.map(f => 
			f.id === threadId ? { ...f, replyTarget: null } : f
		);
	}

	function consumeFloatingThreadReplyForInstance(threadId: string, explicit?: ReplyReferenceInput | null): ReplyReferenceInput | null {
		const instance = floatingThreads.find(f => f.id === threadId);
		if (!instance) return null;
		
		const candidate =
			explicit && explicit.messageId
				? explicit
				: instance.replyTarget && instance.replyTarget.messageId
					? instance.replyTarget
					: null;
		
		// Clear the reply target
		floatingThreads = floatingThreads.map(f => 
			f.id === threadId ? { ...f, replyTarget: null } : f
		);
		
		return candidate && candidate.messageId ? candidate : null;
	}

	function restoreFloatingThreadReplyForInstance(threadId: string, ref: ReplyReferenceInput | null) {
		if (ref?.messageId) {
			floatingThreads = floatingThreads.map(f => 
				f.id === threadId ? { ...f, replyTarget: ref } : f
			);
		}
	}

	async function handleFloatingThreadSendForInstance(
		threadId: string,
		payload:
			| string
			| { text: string; mentions?: MentionSendRecord[]; replyTo?: ReplyReferenceInput | null }
	) {
		const instance = floatingThreads.find(f => f.id === threadId);
		if (!instance) return;
		
		const raw = typeof payload === 'string' ? payload : (payload?.text ?? '');
		const trimmed = raw?.trim?.() ?? '';
		if (!trimmed) return;
		const info = threadChannelInfo(instance.thread ?? null);
		if (!info) {
			alert('Open a thread before replying.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumeFloatingThreadReplyForInstance(
			threadId,
			typeof payload === 'object' ? (payload?.replyTo ?? null) : null
		);
		const mentions = normalizeMentionSendList(
			typeof payload === 'object' ? (payload?.mentions ?? []) : []
		);
		try {
			await sendThreadMessage({
				serverId: info.serverId,
				channelId: info.channelId,
				threadId: info.thread.id,
				message: {
					type: 'text',
					text: trimmed,
					uid: $user.uid,
					displayName: deriveCurrentDisplayName(),
					photoURL: deriveCurrentPhotoURL(),
					mentions,
					replyTo: replyRef ?? undefined
				},
				mentionProfiles: profiles
			});
		} catch (err) {
			restoreFloatingThreadReplyForInstance(threadId, replyRef);
			console.error(err);
			alert(`Failed to send thread reply: ${err instanceof Error ? err.message : err}`);
		}
	}

	async function handleFloatingThreadSendGifForInstance(
		threadId: string,
		detail: string | { url: string; replyTo?: ReplyReferenceInput | null }
	) {
		const instance = floatingThreads.find(f => f.id === threadId);
		if (!instance) return;
		
		const trimmed = pickString(typeof detail === 'string' ? detail : detail?.url);
		if (!trimmed) return;
		const info = threadChannelInfo(instance.thread ?? null);
		if (!info) {
			alert('Open a thread before replying.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumeFloatingThreadReplyForInstance(
			threadId,
			typeof detail === 'object' ? (detail?.replyTo ?? null) : null
		);
		try {
			await sendThreadMessage({
				serverId: info.serverId,
				channelId: info.channelId,
				threadId: info.thread.id,
				message: {
					type: 'gif',
					url: trimmed,
					uid: $user.uid,
					displayName: deriveCurrentDisplayName(),
					photoURL: deriveCurrentPhotoURL(),
					replyTo: replyRef ?? undefined
				},
				mentionProfiles: profiles
			});
		} catch (err) {
			restoreFloatingThreadReplyForInstance(threadId, replyRef);
			console.error(err);
			alert(`Failed to share GIF: ${err instanceof Error ? err.message : err}`);
		}
	}

	async function handleFloatingThreadUploadFilesForInstance(
		threadId: string,
		request: {
			files: File[];
			replyTo?: ReplyReferenceInput | null;
		}
	) {
		const instance = floatingThreads.find(f => f.id === threadId);
		if (!instance) return;
		
		const selection = Array.from(request?.files ?? []).filter(
			(file): file is File => file instanceof File
		);
		if (!selection.length) return;
		const info = threadChannelInfo(instance.thread ?? null);
		if (!info) {
			alert('Open a thread before uploading.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumeFloatingThreadReplyForInstance(threadId, request?.replyTo ?? null);
		let replyUsed = false;
		const identity = {
			uid: $user.uid,
			displayName: deriveCurrentDisplayName(),
			photoURL: deriveCurrentPhotoURL()
		};
		
		// Register pending upload for this instance
		const addPendingUpload = (file: File) => {
			const pendingId = `${threadId}-${Date.now()}-${Math.random()}`;
			const isImage = file.type?.startsWith('image/') ?? false;
			const previewUrl = isImage ? URL.createObjectURL(file) : null;
			const preview: PendingUploadPreview = {
				id: pendingId,
				uid: $user?.uid ?? null,
				name: file.name,
				size: file.size,
				contentType: file.type || null,
				isImage,
				previewUrl,
				progress: 0
			};
			floatingThreads = floatingThreads.map(f =>
				f.id === threadId ? { ...f, pendingUploads: [...f.pendingUploads, preview] } : f
			);
			return {
				update: (progress: number) => {
					floatingThreads = floatingThreads.map(f =>
						f.id === threadId
							? {
									...f,
									pendingUploads: f.pendingUploads.map(p =>
										p.id === pendingId ? { ...p, progress } : p
									)
								}
							: f
					);
				},
				finish: (success: boolean) => {
					// Revoke the preview URL if it was created
					if (previewUrl) {
						URL.revokeObjectURL(previewUrl);
					}
					floatingThreads = floatingThreads.map(f =>
						f.id === threadId
							? {
									...f,
									pendingUploads: f.pendingUploads.filter(p => p.id !== pendingId)
								}
							: f
					);
				}
			};
		};
		
		for (const file of selection) {
			const pending = addPendingUpload(file);
			try {
				const uploaded = await uploadChannelFile({
					serverId: info.serverId,
					channelId: info.channelId,
					uid: $user.uid,
					file,
					onProgress: (progress) => pending.update(progress ?? 0)
				});
				await sendThreadMessage({
					serverId: info.serverId,
					channelId: info.channelId,
					threadId: info.thread.id,
					message: {
						type: 'file',
						file: {
							name: file.name || uploaded.name,
							url: uploaded.url,
							size: file.size ?? uploaded.size,
							contentType: file.type || uploaded.contentType,
							storagePath: uploaded.storagePath
						},
						...identity,
						replyTo: !replyUsed && replyRef ? replyRef : undefined
					},
					mentionProfiles: profiles
				});
				pending.finish(true);
				if (replyRef && !replyUsed) {
					replyUsed = true;
				}
			} catch (err) {
				pending.finish(false);
				if (replyRef && !replyUsed) {
					restoreFloatingThreadReplyForInstance(threadId, replyRef);
				}
				console.error(err);
				alert(
					`Failed to upload ${file?.name || 'file'}: ${err instanceof Error ? err.message : err}`
				);
				break;
			}
		}
	}

	async function handleFloatingThreadSend(
		payload:
			| string
			| { text: string; mentions?: MentionSendRecord[]; replyTo?: ReplyReferenceInput | null }
	) {
		const raw = typeof payload === 'string' ? payload : (payload?.text ?? '');
		const trimmed = raw?.trim?.() ?? '';
		if (!trimmed) return;
		const info = threadChannelInfo(floatingThread?.thread ?? null);
		if (!info) {
			alert('Open a thread before replying.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumeFloatingThreadReply(
			typeof payload === 'object' ? (payload?.replyTo ?? null) : null
		);
		const mentions = normalizeMentionSendList(
			typeof payload === 'object' ? (payload?.mentions ?? []) : []
		);
		try {
			await sendThreadMessage({
				serverId: info.serverId,
				channelId: info.channelId,
				threadId: info.thread.id,
				message: {
					type: 'text',
					text: trimmed,
					uid: $user.uid,
					displayName: deriveCurrentDisplayName(),
					photoURL: deriveCurrentPhotoURL(),
					mentions,
					replyTo: replyRef ?? undefined
				},
				mentionProfiles: profiles
			});
		} catch (err) {
			restoreFloatingThreadReply(replyRef);
			console.error(err);
			alert(`Failed to send thread reply: ${err instanceof Error ? err.message : err}`);
		}
	}

	async function handleFloatingThreadSendGif(
		detail: string | { url: string; replyTo?: ReplyReferenceInput | null }
	) {
		const trimmed = pickString(typeof detail === 'string' ? detail : detail?.url);
		if (!trimmed) return;
		const info = threadChannelInfo(floatingThread?.thread ?? null);
		if (!info) {
			alert('Open a thread before replying.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumeFloatingThreadReply(
			typeof detail === 'object' ? (detail?.replyTo ?? null) : null
		);
		try {
			await sendThreadMessage({
				serverId: info.serverId,
				channelId: info.channelId,
				threadId: info.thread.id,
				message: {
					type: 'gif',
					url: trimmed,
					uid: $user.uid,
					displayName: deriveCurrentDisplayName(),
					photoURL: deriveCurrentPhotoURL(),
					replyTo: replyRef ?? undefined
				},
				mentionProfiles: profiles
			});
		} catch (err) {
			restoreFloatingThreadReply(replyRef);
			console.error(err);
			alert(`Failed to share GIF: ${err instanceof Error ? err.message : err}`);
		}
	}

	async function handleFloatingThreadUploadFiles(request: {
		files: File[];
		replyTo?: ReplyReferenceInput | null;
	}) {
		const selection = Array.from(request?.files ?? []).filter(
			(file): file is File => file instanceof File
		);
		if (!selection.length) return;
		const info = threadChannelInfo(floatingThread?.thread ?? null);
		if (!info) {
			alert('Open a thread before uploading.');
			return;
		}
		if (!$user) {
			alert('Sign in to send messages.');
			return;
		}
		const replyRef = consumeFloatingThreadReply(request?.replyTo ?? null);
		let replyUsed = false;
		const identity = {
			uid: $user.uid,
			displayName: deriveCurrentDisplayName(),
			photoURL: deriveCurrentPhotoURL()
		};
		for (const file of selection) {
			const pending = registerPendingUpload(file, 'floatingThread');
			try {
				const uploaded = await uploadChannelFile({
					serverId: info.serverId,
					channelId: info.channelId,
					uid: $user.uid,
					file,
					onProgress: (progress) => pending.update(progress ?? 0)
				});
				await sendThreadMessage({
					serverId: info.serverId,
					channelId: info.channelId,
					threadId: info.thread.id,
					message: {
						type: 'file',
						file: {
							name: file.name || uploaded.name,
							url: uploaded.url,
							size: file.size ?? uploaded.size,
							contentType: file.type || uploaded.contentType,
							storagePath: uploaded.storagePath
						},
						...identity,
						replyTo: !replyUsed && replyRef ? replyRef : undefined
					},
					mentionProfiles: profiles
				});
				pending.finish(true);
				if (replyRef && !replyUsed) {
					replyUsed = true;
				}
			} catch (err) {
				pending.finish(false);
				if (replyRef && !replyUsed) {
					restoreFloatingThreadReply(replyRef);
				}
				console.error(err);
				alert(
					`Failed to upload ${file?.name || 'file'}: ${err instanceof Error ? err.message : err}`
				);
				break;
			}
		}
	}

	async function handleFloatingThreadCreatePoll() {
		alert('Polls are not supported inside threads yet.');
	}

	async function handleFloatingThreadCreateForm() {
		alert('Forms are not supported inside threads yet.');
	}

	async function handleVote(event: CustomEvent<{ messageId: string; optionIndex: number }>) {
		if (!serverId || !activeChannel?.id || !$user) return;
		const { messageId, optionIndex } = event.detail ?? {};
		if (!messageId || optionIndex === undefined) return;
		try {
			await voteOnChannelPoll(serverId, activeChannel.id, messageId, $user.uid, optionIndex);
		} catch (err) {
			console.error(err);
			alert(`Failed to record vote: ${err}`);
		}
	}

	async function handleFormSubmit(event: CustomEvent<{ messageId: string; answers: string[] }>) {
		if (!serverId || !activeChannel?.id || !$user) return;
		const { messageId, answers } = event.detail ?? {};
		if (!messageId || !answers) return;
		try {
			await submitChannelForm(serverId, activeChannel.id, messageId, $user.uid, answers);
		} catch (err) {
			console.error(err);
			alert(`Failed to submit form: ${err}`);
		}
	}

	async function handleReaction(event: CustomEvent<{ messageId: string; emoji: string }>) {
		if (!serverId || !activeChannel?.id || !$user) return;
		const { messageId, emoji } = event.detail ?? {};
		if (!messageId || !emoji) return;
		try {
			await toggleChannelReaction(serverId, activeChannel.id, messageId, $user.uid, emoji);
		} catch (err) {
			console.error(err);
			alert(`Failed to toggle reaction: ${err}`);
		}
	}

	function jumpToPinnedMessage(messageId: string | null | undefined) {
		if (!messageId) return;
		requestedMessageId = messageId;
	}

	function handlePinnedOpen(detail: { messageId?: string | null; linkUrl?: string | null }) {
		if (detail?.linkUrl) {
			try {
				window.open(detail.linkUrl, '_blank', 'noopener,noreferrer');
			} catch {
				// ignore
			}
		}
		if (detail?.messageId) {
			jumpToPinnedMessage(detail.messageId);
		}
	}

	async function handlePinnedUnpin(messageId: string | null | undefined) {
		if (!messageId || !serverId || !activeChannel?.id) return;
		try {
			await unpinChannelMessage(serverId, activeChannel.id, messageId);
		} catch (err) {
			console.error('Failed to unpin message', err);
		}
	}

	async function handlePinCustomLink(payload: { title: string; url: string; description?: string | null }) {
		if (!serverId || !activeChannel?.id || !$user) return;
		try {
			await pinChannelLink(serverId, activeChannel.id, {
				title: payload.title,
				url: payload.url,
				description: payload.description,
				uid: $user.uid,
				authorName: $user.displayName ?? $user.email ?? null
			});
		} catch (err) {
			console.error('Failed to pin link', err);
		}
	}

	async function handlePopoutVote(event: CustomEvent<{ messageId: string; optionIndex: number }>) {
		if (!serverId || !channelMessagesPopoutChannelId || !$user) return;
		const { messageId, optionIndex } = event.detail ?? {};
		if (!messageId || optionIndex === undefined) return;
		try {
			await voteOnChannelPoll(
				serverId,
				channelMessagesPopoutChannelId,
				messageId,
				$user.uid,
				optionIndex
			);
		} catch (err) {
			console.error(err);
			alert(`Failed to record vote: ${err}`);
		}
	}

	async function handlePopoutFormSubmit(
		event: CustomEvent<{ messageId: string; answers: string[] }>
	) {
		if (!serverId || !channelMessagesPopoutChannelId || !$user) return;
		const { messageId, answers } = event.detail ?? {};
		if (!messageId || !answers) return;
		try {
			await submitChannelForm(
				serverId,
				channelMessagesPopoutChannelId,
				messageId,
				$user.uid,
				answers
			);
		} catch (err) {
			console.error(err);
			alert(`Failed to submit form: ${err}`);
		}
	}

	async function handlePopoutReaction(event: CustomEvent<{ messageId: string; emoji: string }>) {
		if (!serverId || !channelMessagesPopoutChannelId || !$user) return;
		const { messageId, emoji } = event.detail ?? {};
		if (!messageId || !emoji) return;
		try {
			await toggleChannelReaction(
				serverId,
				channelMessagesPopoutChannelId,
				messageId,
				$user.uid,
				emoji
			);
		} catch (err) {
			console.error(err);
			alert(`Failed to toggle reaction: ${err}`);
		}
	}

	function handleReplyRequest(event: CustomEvent<{ message: any }>) {
		const ref = buildReplyReference(event.detail?.message);
		if (ref) replyTarget = ref;
	}

	function handlePopoutReplyRequest(event: CustomEvent<{ message: any }>) {
		const ref = buildReplyReference(event.detail?.message);
		if (ref) popoutReplyTarget = ref;
	}

	function activateThreadView(thread: ChannelThread, rootMessage: any) {
		activeThreadRoot = rootMessage;
		threadReplyTarget = null;
		threadPendingUploads = [];
		activeThread = thread;
		pendingThreadId = null;
		pendingThreadRoot = null;
		attachThreadStream(thread);
		prefetchThreadMemberProfiles(thread);
		if (isMobile && mobileVoicePane === 'chat') {
			showThreadPanel = true;
		}
		scheduleThreadRead();
	}

	function prefetchThreadMemberProfiles(thread: ChannelThread | null) {
		if (!thread) return;
		try {
			const database = db();
			for (const uid of thread.memberUids ?? []) {
				ensureProfileSubscription(database, uid);
			}
		} catch (err) {
			console.error('[threads] failed to prefetch member profiles', err);
		}
	}

	async function openThreadFromMessage(message: any, channelIdOverride?: string | null) {
		if (!message) return;
		if (!serverId) {
			alert('Missing server id.');
			return;
		}
		const channelId = channelIdOverride ?? activeChannel?.id ?? null;
		if (!channelId) {
			alert('Pick a channel first.');
			return;
		}
		let existing =
			channelThreads.find((thread) => thread.createdFromMessageId === message.id) ??
			threadsByChannel[channelId]?.find((thread) => thread.createdFromMessageId === message.id) ??
			null;
		if (!existing) {
			try {
				const database = db();
				const threadSnap = await getDocs(
					query(
						collection(database, 'servers', serverId, 'channels', channelId, 'threads'),
						where('createdFromMessageId', '==', message.id),
						limit(1)
					)
				);
				const docSnap = threadSnap.docs[0];
				if (docSnap?.exists()) {
					const hydrated = normalizeThreadSnapshot(docSnap.data(), docSnap.id);
					existing = hydrated;
					upsertThreadCache(channelId, hydrated);
				}
			} catch (err) {
				console.error('[threads] lookup failed', err);
			}
		}
		if (existing) {
			activateThreadView(existing, message);
			return;
		}
		if (!$user) {
			alert('Sign in to start a thread.');
			return;
		}
		try {
			const mentionUids = Array.isArray(message?.mentions)
				? message.mentions
						.map((mention: any) => pickString(mention?.uid))
						.filter((value: string | undefined): value is string => Boolean(value))
				: [];
			pendingThreadId = await createChannelThread({
				serverId,
				channelId,
				sourceMessageId: message.id,
				sourceMessageText:
					pickString(message?.text) ??
					pickString(message?.content) ??
					pickString(message?.preview) ??
					'',
				creator: {
					uid: $user.uid,
					displayName: deriveCurrentDisplayName()
				},
				initialMentions: mentionUids,
				mentionProfiles: profiles
			});
			pendingThreadRoot = message;
			await hydrateThreadAfterCreate(pendingThreadId, message);
		} catch (err) {
			console.error(err);
			alert(`Failed to start thread: ${err instanceof Error ? err.message : err}`);
			pendingThreadId = null;
			pendingThreadRoot = null;
		}
	}

	function upsertThreadCache(channelId: string, thread: ChannelThread) {
		if (!channelId || !thread) return;
		const previous = threadsByChannel[channelId] ?? [];
		const nextList = previous.some((entry) => entry.id === thread.id)
			? previous.map((entry) => (entry.id === thread.id ? thread : entry))
			: [thread, ...previous];
		threadsByChannel = { ...threadsByChannel, [channelId]: nextList };
		if (activeChannel?.id === channelId) {
			const hasThread = channelThreads.some((entry) => entry.id === thread.id);
			channelThreads = hasThread
				? channelThreads.map((entry) => (entry.id === thread.id ? thread : entry))
				: [thread, ...channelThreads];
			recomputeThreadStats();
		}
	}

	async function hydrateThreadAfterCreate(threadId: string | null, rootMessage: any) {
		if (!threadId || !serverId || !activeChannel?.id) return;
		try {
			const database = db();
			const snap = await getDoc(
				doc(database, 'servers', serverId, 'channels', activeChannel.id, 'threads', threadId)
			);
			if (!snap.exists()) return;
			const raw = snap.data() ?? {};
			const hydrated = { ...(raw as ChannelThread), id: snap.id } as ChannelThread;
			activateThreadView(hydrated, rootMessage);
			upsertThreadCache(activeChannel.id, hydrated);
		} catch (err) {
			console.error('[threads] failed to hydrate newly created thread', err);
		}
	}

	function openLatestThreadShortcut(): boolean {
		if (!serverId || !activeChannel?.id || !channelThreads.length) return false;
		const next = channelThreads.find((thread) => thread.status !== 'archived');
		if (!next) return false;
		void openThreadFromSidebar({
			id: next.id,
			parentChannelId: next.parentChannelId ?? activeChannel.id
		});
		return true;
	}

	async function ensureChannelActive(channelId: string) {
		if (!channelId) return false;
		if (activeChannel?.id === channelId) return true;
		pickChannel(channelId);
		const started = Date.now();
		while (Date.now() - started < 2000) {
			if (activeChannel?.id === channelId) return true;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		return activeChannel?.id === channelId;
	}

	async function openThreadFromSidebar(target: { id: string; parentChannelId: string }) {
		if (!serverId) return;
		const { id: threadId, parentChannelId } = target;
		const channelReady = await ensureChannelActive(parentChannelId);
		if (!channelReady || !activeChannel?.id) {
			alert('Unable to open the thread yet. Please try again.');
			return;
		}
		let thread = channelThreads.find((entry) => entry.id === threadId);
		if (!thread) {
			try {
				const database = db();
				const snap = await getDoc(
					doc(database, 'servers', serverId, 'channels', activeChannel.id, 'threads', threadId)
				);
				if (snap.exists()) {
					const raw = snap.data() as ChannelThread;
					thread = {
						...(raw as ChannelThread),
						id: snap.id,
						channelId: raw?.channelId ?? raw?.parentChannelId ?? activeChannel.id,
						parentChannelId: raw?.parentChannelId ?? raw?.channelId ?? activeChannel.id
					};
				}
			} catch (err) {
				console.error('[threads] failed to load thread metadata', err);
			}
		}
		if (!thread) {
			alert('Unable to load that thread right now.');
			return;
		}
		let root = messages.find((msg) => msg.id === thread.createdFromMessageId) ?? null;
		if (!root) {
			try {
				const database = db();
				const snap = await getDoc(
					doc(
						database,
						'servers',
						serverId,
						'channels',
						activeChannel.id,
						'messages',
						thread.createdFromMessageId
					)
				);
				if (snap.exists()) {
					root = toChatMessage(snap.id, snap.data());
				}
			} catch (err) {
				console.error('[threads] failed to load root message', err);
			}
		}
		if (!root) {
			alert('Unable to load the thread source message yet.');
			return;
		}
		activateThreadView(thread as ChannelThread, root);
	}

	function closeThreadView() {
		activeThreadRoot = null;
		activeThread = null;
		threadReplyTarget = null;
		threadMessages = [];
		threadConversationContext = [];
		threadPendingUploads = [];
		threadDefaultSuggestionSource = null;
		pendingThreadId = null;
		pendingThreadRoot = null;
		clearThreadReadTimer();
		showThreadPanel = false;
		showThreadMembersSheet = false;
		attachThreadStream(null);
		stopThreadResize();
		channelHeaderEl?.focusHeader?.();
	}

	let lastScrollChannelId: string | null = null;
	run(() => {
		const currentChannelId = activeChannel?.id ?? null;
		const prev = untrack(() => lastScrollChannelId);
		if (currentChannelId && currentChannelId !== prev) {
			lastScrollChannelId = currentChannelId;
			triggerScrollToBottom();
		} else if (!currentChannelId && prev !== null) {
			lastScrollChannelId = null;
		}
	});

	function handleThreadReplySelect(event: CustomEvent<{ message: any }>) {
		const ref = buildReplyReference(event.detail?.message) ?? buildReplyReference(activeThreadRoot);
		threadReplyTarget = ref;
	}

	function resetThreadReplyTarget() {
		threadReplyTarget = null;
	}

	function handleFloatingThreadReplySelect(event: CustomEvent<{ message: any }>) {
		const ref =
			buildReplyReference(event.detail?.message) ??
			buildReplyReference(floatingThread?.root ?? null);
		floatingThreadReplyTarget = ref;
	}

	function resetFloatingThreadReplyTarget() {
		floatingThreadReplyTarget = null;
	}
	run(() => {
		const scope = serverId ?? null;
		const prev = untrack(() => threadServerScope);
		if (scope !== prev) {
			threadServerScope = scope;
			resetThreadState({ resetCache: true });
		}
	});
	// Note: We no longer auto-close floating threads on mobile
	// Instead, they render fullscreen with the mobile-specific styles
	run(() => {
		const currentFloating = untrack(() => floatingThread);
		if (!currentFloating?.thread) return;
		const parentId =
			currentFloating.thread.parentChannelId ?? currentFloating.thread.channelId ?? null;
		const updated =
			channelThreads.find((thread) => thread.id === currentFloating.thread?.id) ??
			(parentId
				? ((threadsByChannel[parentId] ?? []).find(
						(thread) => thread.id === currentFloating.thread?.id
					) ?? null)
				: null);
		if (updated && currentFloating.thread !== updated) {
			floatingThread = { ...currentFloating, thread: updated };
		}
	});
	run(() => {
		const currentMentionServer = serverId ?? null;
		const currentUid = $user?.uid ?? null;
		const prevMentionServer = untrack(() => lastMentionServer);
		if (currentMentionServer !== prevMentionServer) {
			mentionDirectoryStop?.();
			mentionRolesStop?.();
			memberMentionOptions = [];
			roleMentionOptions = [];
			mentionOptions = [];
			lastMentionServer = currentUid ? currentMentionServer : null;
			isCurrentServerMember = false;
			if (currentMentionServer && currentUid) {
				mentionDirectoryStop = subscribeServerDirectory(currentMentionServer, (entries) => {
					memberMentionOptions = entries;
					isCurrentServerMember = entries.some((entry) => entry.uid === currentUid);
					updateMentionOptionList();
				});
				startRoleMentionWatch(currentMentionServer);
			} else {
				mentionDirectoryStop = null;
				mentionRolesStop = null;
				isCurrentServerMember = false;
			}
		}
	});
	run(() => {
		requestedChannelId = $page?.url?.searchParams?.get('channel') ?? null;
		requestedMessageId = $page?.url?.searchParams?.get('msg') ?? null;
		requestedThreadId = $page?.url?.searchParams?.get('thread') ?? null;
		isPopupMode = $page?.url?.searchParams?.get('popup') === '1';
	});
	// Handle popup mode - open thread directly when loaded via popup=1&thread=xxx
	run(() => {
		if (!isPopupMode || !requestedThreadId || popupThreadHandled) return;
		if (!serverId || !requestedChannelId) return;
		
		// Use openFloatingThreadById which handles all the logic
		popupThreadHandled = true;
		openFloatingThreadById(serverId, requestedChannelId, requestedThreadId);
	});
	// Clear msg param from URL after a delay (gives time for scroll animation)
	run(() => {
		if (requestedMessageId && browser) {
			const timeout = setTimeout(() => {
				const currentUrl = new URL($page.url);
				if (currentUrl.searchParams.has('msg')) {
					currentUrl.searchParams.delete('msg');
					goto(currentUrl.toString(), { replaceState: true, keepFocus: true });
				}
			}, 2500);
			return () => clearTimeout(timeout);
		}
	});
	run(() => {
		const prevServerForChannels = untrack(() => channelListServerId);
		const currentServer = serverId ?? null;
		if (!currentServer || !$user?.uid) {
			channelListServerId = currentServer;
			resetChannelState();
			return;
		}
		if (currentServer !== prevServerForChannels) {
			channelListServerId = currentServer;
			resetChannelState();
		}
	});
	run(() => {
		if (serverId && $user?.uid) {
			void ensureServerMembership(serverId, $user.uid);
		}
	});
	run(() => {
		const currentServer = serverId ?? null;
		const uid = $user?.uid ?? null;
		if (!currentServer || !uid) {
			memberPermsUnsub?.();
			memberPermsUnsub = null;
			memberPermsServer = null;
			myPerms = null;
			myRole = null;
			return;
		}
		if (memberPermsServer === currentServer && memberPermsUnsub) return;
		memberPermsUnsub?.();
		memberPermsServer = currentServer;
		const database = db();
		const ref = doc(database, 'servers', currentServer, 'members', uid);
		memberPermsUnsub = onSnapshot(
			ref,
			(snap) => {
				const data: any = snap.data() ?? {};
				myPerms = (data?.perms as any) ?? (data?.permissions as any) ?? null;
				myRole = typeof data?.role === 'string' ? data.role : null;
			},
			() => {
				myPerms = null;
				myRole = null;
			}
		);
	});
	run(() => {
		const s = serverId ?? null;
		const c = activeChannel?.id ?? null;
		if (s && c) {
			if (s !== pinnedServerId || c !== pinnedChannelId) {
				clearPinnedState();
				const stop = subscribePinnedMessages(s, c, (pins) => {
					const nextIds = new Set(pins.map((pin) => pin.messageId));
					pinnedMessages = pins;
					pinnedMessageIds = nextIds;
					if (channelMessagesPopout && channelMessagesPopoutChannelId === c) {
						popoutPinnedMessageIds = nextIds;
					}
				});
				pinnedUnsub = stop ?? null;
				pinnedServerId = s;
				pinnedChannelId = c;
			}
		} else {
			clearPinnedState();
			channelSettingsOpen = false;
		}
	});
	run(() => {
		const s = serverId ?? null;
		const popChannel = channelMessagesPopoutChannelId ?? null;
		if (channelMessagesPopout && s && popChannel) {
			// Share the active pin cache when the popout is the same channel
			if (popChannel === pinnedChannelId && s === pinnedServerId) {
				clearPopoutPinnedState();
				popoutPinnedMessageIds = pinnedMessageIds;
				popoutPinnedChannelId = popChannel;
				return;
			}
			if (popChannel !== popoutPinnedChannelId) {
				clearPopoutPinnedState();
				const stop = subscribePinnedMessages(s, popChannel, (pins) => {
					popoutPinnedMessageIds = new Set(pins.map((pin) => pin.messageId));
				});
				popoutPinnedUnsub = stop ?? null;
				popoutPinnedChannelId = popChannel;
			}
		} else {
			clearPopoutPinnedState();
		}
	});
	// Sync channels from sidebar cache when dependencies change, using a separate tracking variable
	// to avoid recursion warnings
	let lastSyncedServer: string | null = null;
	let lastSyncedUser: string | null = null;
run(() => {
	const currentServer = serverId ?? null;
	const currentUser = $user?.uid ?? null;
	const cachedChannels = untrack(() => lastSidebarChannels);
	const hasChannels = untrack(() => channels.length > 0);
	// Only sync when the combination of server/user actually changes, not on every reactive run
	if (currentServer && currentUser && cachedChannels) {
		const needsSync = currentServer !== lastSyncedServer || currentUser !== lastSyncedUser;
		if (
			needsSync ||
			(cachedChannels.serverId === currentServer &&
				!hasChannels &&
				cachedChannels.channels?.length)
		) {
			lastSyncedServer = currentServer;
			lastSyncedUser = currentUser;
				syncVisibleChannels(cachedChannels, false);
			}
		}
	});
	run(() => {
		const channelId = activeChannel?.id ?? null;
		const prevReply = untrack(() => lastReplyChannelId);
		const prevPending = untrack(() => lastPendingChannelId);
		if (channelId !== prevReply) {
			lastReplyChannelId = channelId;
			replyTarget = null;
		}
		if (channelId !== prevPending) {
			lastPendingChannelId = channelId;
			pendingUploads = [];
		}
	});
	run(() => {
		const channelId = channelMessagesPopoutChannelId;
		const prevReply = untrack(() => lastPopoutReplyChannelId);
		const prevPending = untrack(() => lastPopoutPendingChannelId);
		if (channelId !== prevReply) {
			lastPopoutReplyChannelId = channelId;
			popoutReplyTarget = null;
		}
		if (channelId !== prevPending) {
			lastPopoutPendingChannelId = channelId;
			popoutPendingUploads = [];
		}
	});
	run(() => {
		const threadId = activeThread?.id ?? null;
		const prev = untrack(() => lastThreadUploadThreadId);
		if (threadId !== prev) {
			lastThreadUploadThreadId = threadId;
			threadPendingUploads = [];
		}
	});
	run(() => {
		const floatingId = floatingThread?.thread?.id ?? null;
		const prev = untrack(() => lastFloatingUploadThreadId);
		if (floatingId !== prev) {
			lastFloatingUploadThreadId = floatingId;
			floatingThreadPendingUploads = [];
		}
	});
	run(() => {
		const visible = !!(voiceState && voiceState.visible);
		const prev = untrack(() => lastVoiceVisible);
		if (visible !== prev) {
			lastVoiceVisible = visible;
			if (isMobile) {
				mobileVoicePane = visible ? 'call' : 'chat';
			}
		}
	});
	run(() => {
		isVoiceChannelView = activeChannel?.type === 'voice';
	});
	run(() => {
		isViewingActiveVoiceChannel = Boolean(
			isVoiceChannelView &&
			voiceState?.visible &&
			serverId &&
			voiceState.serverId === serverId &&
			voiceState.channelId === activeChannel?.id
		);
	});
	run(() => {
		showVoiceLobby = Boolean(isVoiceChannelView && !isViewingActiveVoiceChannel);
	});
	run(() => {
		voiceInviteUrl = (() => {
			if (!serverId || !activeChannel || activeChannel.type !== 'voice') return null;
			try {
				const url = new URL($page.url.href);
				url.searchParams.set('channel', activeChannel.id);
				return url.toString();
			} catch {
				return `${$page.url.pathname}?channel=${encodeURIComponent(activeChannel.id)}`;
			}
		})();
	});
	run(() => {
		if (isViewingActiveVoiceChannel && voiceState && !voiceState.visible) {
			voiceSession.setVisible(true);
		}
	});
	run(() => {
		currentUserDisplayName = deriveCurrentDisplayName();
	});
	run(() => {
		currentUserPhotoURL = deriveCurrentPhotoURL();
	});
	run(() => {
		const prev = untrack(() => lastIsMobile);
		if (isMobile === prev) return;
		lastIsMobile = isMobile;
		if (!isMobile) {
			mobileVoicePane = 'chat';
		} else if (voiceState?.visible) {
			mobileVoicePane = 'call';
		}
	});
	run(() => {
		const shouldShow = isMobile && mobileVoicePane === 'chat' && !!activeThread;
		showThreadPanel = shouldShow;
		const prev = untrack(() => lastShowThreadPanel);
		if (shouldShow && !prev) {
			scheduleThreadRead();
		}
		lastShowThreadPanel = shouldShow;
	});
	run(() => {
		if ($user?.uid) {
			// Prefer userProfile (from Firestore) for cached/custom photos, fall back to auth photoURL
			const profileData = $userProfile;
			const fallbackPhoto =
				profileData?.cachedPhotoURL ??
				profileData?.customPhotoURL ??
				profileData?.photoURL ??
				pickString($user.photoURL) ??
				null;
			updateProfileCache($user.uid, {
				displayName:
					profileData?.displayName ??
					pickString($user.displayName) ??
					pickString($user.email) ??
					'You',
				photoURL: fallbackPhoto,
				authPhotoURL: profileData?.authPhotoURL ?? pickString($user.photoURL) ?? null,
				cachedPhotoURL: profileData?.cachedPhotoURL ?? null,
				customPhotoURL: profileData?.customPhotoURL ?? null,
				email: profileData?.email ?? pickString($user.email) ?? undefined
			});
		}
	});
	// mobile: when switching servers, open channels panel
	// This MUST run immediately to ensure the nav bar is visible
	run(() => {
		if (serverId) {
			const isDesktop =
				typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
			if (!isDesktop) {
				showMembers = false;
				// Always show channel list on mobile when entering a server
				// This ensures the nav bar remains visible and users can navigate
				// Works regardless of whether there's an active channel
				showChannels = true;
			}
		}
	});
	run(() => {
		attachThreadStream(activeThread ?? null);
	});
	run(() => {
		if (!$user?.uid) {
			clearThreadReadSubs();
			return;
		}
		channelThreads.forEach((thread) => watchThreadRead(thread.id));
	});
	run(() => {
		const contextSources = [activeThreadRoot, ...threadMessages].filter(Boolean).slice(-10);
		threadConversationContext = contextSources;
		const latestAuthored =
			[...threadMessages].reverse().find((msg) => (msg as any)?.authorId ?? (msg as any)?.uid) ??
			(activeThreadRoot?.uid ? activeThreadRoot : null);
		if (!latestAuthored) {
			threadDefaultSuggestionSource = null;
			return;
		}
		const latestUid = (latestAuthored as any)?.authorId ?? (latestAuthored as any)?.uid ?? null;
		if ($user?.uid && latestUid === $user.uid) {
			threadDefaultSuggestionSource = null;
			return;
		}
		threadDefaultSuggestionSource = latestAuthored;
	});
	run(() => {
		if (!floatingThreadVisible || !floatingThread) {
			floatingThreadConversationContext = [];
			floatingThreadDefaultSuggestionSource = null;
			return;
		}
		const contextSources = [floatingThread.root, ...floatingThreadMessages]
			.filter(Boolean)
			.slice(-10);
		floatingThreadConversationContext = contextSources;
		const latestAuthored =
			[...floatingThreadMessages]
				.reverse()
				.find((msg) => (msg as any)?.authorId ?? (msg as any)?.uid) ??
			(floatingThread.root?.uid ? floatingThread.root : null);
		if (!latestAuthored) {
			floatingThreadDefaultSuggestionSource = null;
			return;
		}
		const latestUid = (latestAuthored as any)?.authorId ?? (latestAuthored as any)?.uid ?? null;
		if ($user?.uid && latestUid === $user.uid) {
			floatingThreadDefaultSuggestionSource = null;
			return;
		}
		floatingThreadDefaultSuggestionSource = latestAuthored;
	});
	run(() => {
		if (!activeThread) {
			threadReplyTarget = null;
			showThreadMembersSheet = false;
		}
	});
	run(() => {
		if (!activeThread) {
			clearThreadReadTimer();
		}
	});
	const handleThreadMembersKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			showThreadMembersSheet = false;
		}
	};
	run(() => {
		if (!showThreadMembersSheet) return;
		window.addEventListener('keydown', handleThreadMembersKeydown);
		return () => window.removeEventListener('keydown', handleThreadMembersKeydown);
	});
	run(() => {
		const uid = $user?.uid ?? null;
		if (serverId && uid && isCurrentServerMember) {
			const scopeKey = `${serverId}:${uid}`;
			if (serverThreadsScope !== scopeKey) {
				subscribeServerThreads(serverId, uid);
			}
		} else {
			clearServerThreads();
		}
	});
	run(() => {
		aiConversationContext = messages.slice(-10);
	});
	run(() => {
		if (!messages.length) {
			latestInboundMessage = null;
			return;
		}
		const latestAuthored = [...messages].reverse().find((msg) => msg?.uid);
		if (!latestAuthored) {
			latestInboundMessage = null;
			return;
		}
		if ($user?.uid && latestAuthored.uid === $user.uid) {
			latestInboundMessage = null;
			return;
		}
		latestInboundMessage = latestAuthored;
	});
	run(() => {
		if (!$user?.uid) {
			aiAssistEnabled = true;
			return;
		}
		const me = profiles[$user.uid] ?? null;
		const prefs = (me?.settings ?? {}) as any;
		aiAssistEnabled = prefs?.aiAssist?.enabled !== false;
	});
	run(() => {
		if (serverId && isCurrentServerMember) {
			serverMetaUnsub?.();
			const database = db();
			const ref = doc(database, 'servers', serverId);
			serverMetaUnsub = onSnapshot(
				ref,
				(snap) => {
					const data = snap.data() as any;
					const nextName =
						pickString(data?.displayName) ??
						pickString(data?.name) ??
						pickString(data?.title) ??
						'Server';
					serverDisplayName = nextName;
					serverOwnerId = deriveOwnerId(data);
					if (serverId) {
						voiceSession.setServerName(serverId, nextName);
					}
				},
				() => {
					serverDisplayName = 'Server';
					serverOwnerId = null;
					if (serverId) {
						voiceSession.setServerName(serverId, 'Server');
					}
				}
			);
		} else {
			serverMetaUnsub?.();
			serverMetaUnsub = null;
			serverDisplayName = 'Server';
			serverOwnerId = null;
		}
	});
	// Subscribe to Ticket AI settings for staff detection
	run(() => {
		if (serverId && ticketAiSettingsServerId !== serverId) {
			ticketAiSettingsUnsub?.();
			ticketAiSettingsServerId = serverId;
			ticketAiSettingsUnsub = subscribeTicketAiSettings(serverId, (settings) => {
				ticketAiSettings = settings;
			});
		} else if (!serverId && ticketAiSettingsUnsub) {
			ticketAiSettingsUnsub();
			ticketAiSettingsUnsub = null;
			ticketAiSettings = null;
			ticketAiSettingsServerId = null;
		}
	});
	// Subscribe to ticketed message IDs for the active channel
	run(() => {
		const currentChannelId = activeChannel?.id;
		if (serverId && currentChannelId && ticketedMsgChannelId !== currentChannelId) {
			ticketedMsgUnsub?.();
			ticketedMsgChannelId = currentChannelId;
			ticketedMsgUnsub = subscribeToTicketedMessageIds(serverId, currentChannelId, (ids) => {
				ticketedMessageIds = ids;
			});
		} else if ((!serverId || !currentChannelId) && ticketedMsgUnsub) {
			ticketedMsgUnsub();
			ticketedMsgUnsub = null;
			ticketedMsgChannelId = null;
			ticketedMessageIds = new Set();
		}
	});
	run(() => {
		const requested = requestedChannelId;
		const prevHandled = untrack(() => handledRequestedChannelId);
		if (!requested) {
			if (prevHandled !== null) {
				handledRequestedChannelId = null;
			}
			return;
		}
		if (prevHandled === requested) return;
		if (blockedChannels.has(requested)) {
			handledRequestedChannelId = requested;
			return;
		}
		const currentActiveId = untrack(() => activeChannel?.id);
		if (requested !== currentActiveId && channels.some((c) => c.id === requested)) {
			handledRequestedChannelId = requested;
			pickChannel(requested);
		}
	});
	run(() => {
		if (voiceState && serverId && voiceState.serverId !== serverId && voiceState.visible) {
			voiceSession.setVisible(false);
		}
	});
	run(() => {
		if (!channelMessagesPopoutChannelId) {
			channelMessagesPopoutChannelName = '';
			return;
		}
		const name = findChannelName(channelMessagesPopoutChannelId);
		if (name) {
			channelMessagesPopoutChannelName = name;
		}
	});
</script>

<!-- Layout summary:
  - Mobile (<768px): hide the server rail until the nav drawer opens (swipe/right button), with members on the right swipe.
  - Desktop (>=1024px): server rail + channels stay pinned; members pane opens at large breakpoints.
-->
<div class="server-workspace flex h-dvh app-bg text-primary overflow-hidden">
	<div class="server-columns flex flex-1 overflow-hidden">
		<div class="server-columns__sidebar hidden md:flex md:w-80 xl:w-80 shrink-0 flex-col">
			{#if serverId}
				<ServerSidebar
					{serverId}
					activeChannelId={activeChannel?.id ?? null}
					onPickChannel={(id: string) => pickChannel(id)}
					on:channels={handleSidebarChannels}
					threads={sidebarThreadList()}
					activeThreadId={activeThread?.id ?? null}
					onPickThread={(thread) => void openThreadFromSidebar(thread)}
					threadUnreadByChannel={channelThreadUnread}
				/>
			{:else}
				<div class="p-4 text-white/70">Select a server from the left to view channels.</div>
			{/if}
		</div>

		<div
			class="server-columns__main flex flex-1 min-w-0 flex-col panel"
			style="border-radius: var(--radius-sm);"
		>
			<div class="flex flex-1 min-h-0 relative">
				<div class="flex flex-1 min-h-0 flex-col">
					<ChannelHeader
						bind:this={channelHeaderEl}
						channel={activeChannel}
						thread={activeThread}
						channelsVisible={showChannels}
						membersVisible={!voiceState?.visible &&
							(isMobile ? showMembers : desktopMembersVisible)}
						showMessageShortcut={true}
						hideMembersToggle={!isMobile && !desktopMembersWideEnough}
						onToggleChannels={() => {
							showChannels = true;
							showMembers = false;
						}}
						onToggleMembers={() => {
							if (isMobile) {
								showMembers = true;
								showChannels = false;
							} else if (!activeThread) {
								const nextVisible = !desktopMembersVisible;
								desktopMembersPreferred = nextVisible;
								desktopMembersVisible = desktopMembersWideEnough ? nextVisible : false;
							}
						}}
						onOpenMessages={openChannelMessages}
						onOpenSettings={() => {
							if (activeChannel) {
								channelSettingsOpen = true;
							}
						}}
						onExitThread={() => closeThreadView()}
					/>

					<div class="flex-1 panel-muted flex flex-col min-h-0">
						{#if isMobile && voiceState}
							<div
								class="mobile-call-wrapper md:hidden"
								ontouchstart={handleMobilePaneTouchStart}
								ontouchmove={handleMobilePaneTouchMove}
								ontouchend={handleMobilePaneTouchEnd}
							>
								<div class="mobile-call-tabs">
									<button
										type="button"
										class={`mobile-call-tab ${mobileVoicePane === 'call' ? 'is-active' : ''}`}
										onclick={() => setMobileVoicePane('call')}
										aria-pressed={mobileVoicePane === 'call'}
									>
										<i class="bx bx-headphone"></i>
										<span>Call</span>
									</button>
									<button
										type="button"
										class={`mobile-call-tab ${mobileVoicePane === 'chat' ? 'is-active' : ''}`}
										onclick={() => setMobileVoicePane('chat')}
										aria-pressed={mobileVoicePane === 'chat'}
									>
										<i class="bx bx-message-dots"></i>
										<span>Messages</span>
									</button>
								</div>

								<div
									class={`mobile-call-card ${mobileVoicePane === 'call' && voiceState.visible ? '' : 'hidden'}`}
								>
									<VideoChat
										layout="embedded"
										showChatToggle={false}
										on:openMobileChat={() => setMobileVoicePane('chat')}
										on:openChannelChat={openChannelMessages}
									/>
								</div>

								<div class={`mobile-chat-card ${mobileVoicePane === 'chat' ? '' : 'hidden'}`}>
									{#if messagesLoading && !mergedMessages.length}
										<div class="flex-1 grid place-items-center text-soft">
											<div class="flex flex-col items-center gap-3">
												<div
													class="h-10 w-10 rounded-full border-2 border-white/30 border-t-white animate-spin"
													aria-hidden="true"
												></div>
												<div class="text-sm font-medium tracking-wide uppercase">Loading messages</div>
											</div>
										</div>
									{:else if messagesLoadError}
										<div class="flex-1 grid place-items-center text-soft text-center px-4">
											<div>
												<div class="font-semibold mb-1">Messages unavailable</div>
												<div class="text-sm">{messagesLoadError}</div>
											</div>
										</div>
									{:else}
										<ChannelMessagePane
											hasChannel={Boolean(serverId && activeChannel)}
											channelName={activeChannel?.name ?? ''}
											messages={mergedMessages}
											{profiles}
											currentUserId={$user?.uid ?? null}
											{mentionOptions}
											{replyTarget}
											{threadStats}
											defaultSuggestionSource={latestInboundMessage}
											conversationContext={aiConversationContext}
											{aiAssistEnabled}
											threadLabel={activeChannel?.name ?? ''}
											{pendingUploads}
											{scrollToBottomSignal}
											scrollToMessageId={requestedMessageId}
											scrollContextKey={`${serverId ?? 'server'}:${activeChannel?.id ?? 'none'}`}
											listClass="message-scroll-region flex-1 overflow-y-auto p-3"
											inputWrapperClass="chat-input-region border-t border-subtle panel-muted"
											emptyMessage={!serverId
												? 'Pick a server to start chatting.'
												: 'Pick a channel to start chatting.'}
											{isTicketAiStaff}
											{serverId}
											channelId={activeChannel?.id ?? null}
											{ticketedMessageIds}
											pinnedMessageIds={pinnedMessageIds}
											canPinMessages={canPinMessages}
											onVote={handleVote}
											onSubmitForm={handleFormSubmit}
											onReact={handleReaction}
											onLoadMore={() => {
												if (serverId && activeChannel?.id) {
													loadOlderMessages(serverId, activeChannel.id);
												}
											}}
											onSend={handleSend}
											onSendGif={handleSendGif}
											onCreatePoll={handleCreatePoll}
											onCreateForm={handleCreateForm}
											onUploadFiles={handleUploadFiles}
											on:atBottom={(event) => {
												if (event.detail?.atBottom) {
													markChannelReadFromMessages(
														serverId,
														activeChannel?.id ?? null,
														messages
													);
												}
											}}
											on:reply={handleReplyRequest}
											on:thread={(event) => void openThreadFromMessage(event.detail?.message)}
											on:cancelReply={() => (replyTarget = null)}
										/>
									{/if}
								</div>
							</div>
						{:else}
							{#if showVoiceLobby && !(isMobile && showChannels)}
								<div class="px-3 pt-1 md:px-5 md:pt-0 mb-3 flex-1 flex flex-col min-h-0">
									<CallPreview
										{serverId}
										channelId={activeChannel?.id ?? null}
										channelName={activeChannel?.name ?? 'Voice channel'}
										connectedElsewhere={voiceState?.channelId != null &&
											voiceState?.channelId !== activeChannel?.id}
										connectedChannelName={voiceState?.channelName ?? null}
										on:join={() => joinSelectedVoiceChannel({})}
										on:returnToSession={() => voiceSession.setVisible(true)}
									/>
								</div>
							{/if}

							{#if !isMobile && voiceState}
								<!-- Single VideoChat instance to prevent unmount/remount when switching between voice and text channel views.
               The wrapper div handles layout changes via CSS classes while keeping the VideoChat component alive. -->
								<div
									class={voiceDesktopLayout ? 'desktop-call-layout' : 'flex-none mb-3 md:mb-4'}
									class:hidden={!voiceState.visible}
								>
									<div class={voiceDesktopLayout ? 'desktop-call-main' : ''}>
										<VideoChat
											layout={voiceDesktopLayout ? 'standalone' : 'embedded'}
											sidePanelOpen={false}
											sidePanelTab={callPanelTab}
											stageOnly={voiceDesktopLayout}
											showChatToggle={false}
											on:openMobileChat={() => {}}
											on:toggleSideChat={() => {}}
											on:toggleSideMembers={() => {}}
											on:openChannelChat={openChannelMessages}
										/>
									</div>
								</div>
							{/if}

							{#if channelMessagesPopout && !isMobile}
								<div class="channel-popout-overlay">
									<div
										class="channel-popout-window"
										style={`left:${channelMessagesPopoutPosition.x}px; top:${channelMessagesPopoutPosition.y}px; width:${channelMessagesWidth}px; height:${channelMessagesHeight}px`}
									>
										<div
											class="channel-popout-header"
											class:channel-popout-header--dragging={channelMessagesDragActive}
											onpointerdown={handleChannelMessagesPointerDown}
										>
											<div class="channel-popout-title">
												<span>Channel messages</span>
												{#if channelMessagesPopoutChannelName}
													<small>#{channelMessagesPopoutChannelName}</small>
												{/if}
											</div>
											<button
												type="button"
												class="channel-popout-close"
												aria-label="Close channel messages"
												onclick={closeChannelMessagesPopout}
											>
												<i class="bx bx-x"></i>
											</button>
										</div>
										<button
											type="button"
											class={`channel-popout-resize channel-popout-resize--left ${channelMessagesResizeActive && channelMessagesResizeEdge?.includes('left') ? 'is-active' : ''}`}
											aria-label="Resize channel popout (left edge)"
											onpointerdown={(event) => handleChannelMessagesResizeStart('left', event)}
										></button>
										<button
											type="button"
											class={`channel-popout-resize channel-popout-resize--right ${channelMessagesResizeActive && channelMessagesResizeEdge?.includes('right') ? 'is-active' : ''}`}
											aria-label="Resize channel popout (right edge)"
											onpointerdown={(event) => handleChannelMessagesResizeStart('right', event)}
										></button>
										<button
											type="button"
											class={`channel-popout-resize channel-popout-resize--top ${channelMessagesResizeActive && channelMessagesResizeEdge?.includes('top') ? 'is-active' : ''}`}
											aria-label="Resize channel popout (top edge)"
											onpointerdown={(event) => handleChannelMessagesResizeStart('top', event)}
										></button>
										<button
											type="button"
											class={`channel-popout-resize channel-popout-resize--bottom ${channelMessagesResizeActive && channelMessagesResizeEdge?.includes('bottom') ? 'is-active' : ''}`}
											aria-label="Resize channel popout (bottom edge)"
											onpointerdown={(event) => handleChannelMessagesResizeStart('bottom', event)}
										></button>
										<button
											type="button"
											class={`channel-popout-resize channel-popout-resize--bottom-right ${channelMessagesResizeActive && channelMessagesResizeEdge === 'bottom-right' ? 'is-active' : ''}`}
											aria-label="Resize channel popout (bottom right corner)"
											onpointerdown={(event) =>
												handleChannelMessagesResizeStart('bottom-right', event)}
										></button>
										<button
											type="button"
											class={`channel-popout-resize channel-popout-resize--bottom-left ${channelMessagesResizeActive && channelMessagesResizeEdge === 'bottom-left' ? 'is-active' : ''}`}
											aria-label="Resize channel popout (bottom left corner)"
											onpointerdown={(event) =>
												handleChannelMessagesResizeStart('bottom-left', event)}
										></button>
										<button
											type="button"
											class={`channel-popout-resize channel-popout-resize--top-right ${channelMessagesResizeActive && channelMessagesResizeEdge === 'top-right' ? 'is-active' : ''}`}
											aria-label="Resize channel popout (top right corner)"
											onpointerdown={(event) =>
												handleChannelMessagesResizeStart('top-right', event)}
										></button>
										<button
											type="button"
											class={`channel-popout-resize channel-popout-resize--top-left ${channelMessagesResizeActive && channelMessagesResizeEdge === 'top-left' ? 'is-active' : ''}`}
											aria-label="Resize channel popout (top left corner)"
											onpointerdown={(event) => handleChannelMessagesResizeStart('top-left', event)}
										></button>
										<div class="channel-popout-body">
											<ChannelMessagePane
												hasChannel={Boolean(serverId && channelMessagesPopoutChannelId)}
												channelName={channelMessagesPopoutChannelName ?? ''}
												messages={popoutMessages}
												profiles={popoutProfiles}
												currentUserId={$user?.uid ?? null}
												{mentionOptions}
												replyTarget={popoutReplyTarget}
												{threadStats}
												defaultSuggestionSource={latestInboundMessage}
												conversationContext={aiConversationContext}
												{aiAssistEnabled}
												threadLabel={channelMessagesPopoutChannelName ?? ''}
												pendingUploads={popoutPendingUploads}
												scrollToBottomSignal={popoutScrollToBottomSignal}
												scrollContextKey={`popout:${serverId ?? 'server'}:${channelMessagesPopoutChannelId ?? 'none'}`}
												listClass="message-scroll-region flex-1 overflow-y-auto p-3"
												inputWrapperClass="chat-input-region border-t border-subtle panel-muted"
												emptyMessage={!serverId
													? 'Pick a server to start chatting.'
													: 'Pick a channel to start chatting.'}
												{isTicketAiStaff}
												{serverId}
												channelId={channelMessagesPopoutChannelId}
												{ticketedMessageIds}
												pinnedMessageIds={channelMessagesPopoutChannelId === activeChannel?.id
													? pinnedMessageIds
													: popoutPinnedMessageIds}
												canPinMessages={canPinMessages}
												onVote={handlePopoutVote}
												onSubmitForm={handlePopoutFormSubmit}
												onReact={handlePopoutReaction}
												onLoadMore={() => {
													if (serverId && channelMessagesPopoutChannelId) {
														loadOlderPopoutMessages(serverId, channelMessagesPopoutChannelId);
													}
												}}
												onSend={handlePopoutSend}
												onSendGif={handlePopoutSendGif}
												onCreatePoll={handlePopoutCreatePoll}
												onCreateForm={handlePopoutCreateForm}
												onUploadFiles={handlePopoutUploadFiles}
												on:atBottom={(event) => {
													if (event.detail?.atBottom) {
														markChannelReadFromMessages(
															serverId,
															channelMessagesPopoutChannelId,
															popoutMessages
														);
													}
												}}
												on:reply={handlePopoutReplyRequest}
										on:thread={(event) =>
											void openThreadFromMessage(
												event.detail?.message,
												channelMessagesPopoutChannelId
											)}
										on:cancelReply={() => (popoutReplyTarget = null)}
									/>
										</div>
									</div>
								</div>
							{/if}

							{#if !voiceDesktopLayout && !showVoiceLobby}
								{#if messagesLoading && !mergedMessages.length}
									<div class="flex-1 grid place-items-center text-soft">
										<div class="flex flex-col items-center gap-3">
											<div
												class="h-10 w-10 rounded-full border-2 border-white/30 border-t-white animate-spin"
												aria-hidden="true"
											></div>
											<div class="text-sm font-medium tracking-wide uppercase">Loading messages</div>
										</div>
									</div>
								{:else if messagesLoadError}
									<div class="flex-1 grid place-items-center text-soft text-center px-4">
										<div>
											<div class="font-semibold mb-1">Messages unavailable</div>
											<div class="text-sm">{messagesLoadError}</div>
										</div>
									</div>
								{:else}
									<ChannelMessagePane
										hasChannel={Boolean(serverId && activeChannel)}
										channelName={activeChannel?.name ?? ''}
										messages={mergedMessages}
										{profiles}
										currentUserId={$user?.uid ?? null}
										{mentionOptions}
										{replyTarget}
										{threadStats}
										defaultSuggestionSource={latestInboundMessage}
										conversationContext={aiConversationContext}
										{aiAssistEnabled}
										threadLabel={activeChannel?.name ?? ''}
										{pendingUploads}
										{scrollToBottomSignal}
										scrollToMessageId={requestedMessageId}
										scrollContextKey={`${serverId ?? 'server'}:${activeChannel?.id ?? 'none'}`}
										hideInput={isMobile && (showChannels || showMembers)}
										emptyMessage={!serverId
											? 'Pick a server to start chatting.'
											: 'Pick a channel to start chatting.'}
										{isTicketAiStaff}
										{serverId}
										channelId={activeChannel?.id ?? null}
										{ticketedMessageIds}
										{pinnedMessageIds}
										canPinMessages={canPinMessages}
										pinnedMessages={pinnedMessages}
										on:pinnedOpen={(event) => handlePinnedOpen(event.detail ?? {})}
										on:pinnedUnpin={(event) => handlePinnedUnpin(event.detail?.messageId)}
										onVote={handleVote}
										onSubmitForm={handleFormSubmit}
										onReact={handleReaction}
										onLoadMore={() => {
											if (serverId && activeChannel?.id) {
												loadOlderMessages(serverId, activeChannel.id);
											}
										}}
										onSend={handleSend}
										onSendGif={handleSendGif}
										onCreatePoll={handleCreatePoll}
										onCreateForm={handleCreateForm}
										onUploadFiles={handleUploadFiles}
										on:atBottom={(event) => {
											if (event.detail?.atBottom) {
												markChannelReadFromMessages(
													serverId,
													activeChannel?.id ?? null,
													messages
												);
											}
										}}
										on:reply={handleReplyRequest}
										on:thread={(event) => void openThreadFromMessage(event.detail?.message)}
										on:cancelReply={() => (replyTarget = null)}
									/>
								{/if}
							{/if}
						{/if}
					</div>
				</div>

				{#if !voiceState?.visible && ((activeThread && !voiceDesktopLayout) || desktopMembersVisible)}
					<div class="server-columns__members hidden lg:flex items-stretch">
						{#if activeThread && !voiceDesktopLayout}
							<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<div
								class={`thread-resize-handle ${threadResizeActive ? 'is-active' : ''}`}
								role="separator"
								aria-orientation="vertical"
								aria-label="Resize thread pane"
								tabindex="0"
								onpointerdown={handleThreadResizeStart}
								onkeydown={handleThreadResizeKeydown}
							></div>
							<div
								class="thread-pane-desktop panel-muted server-columns__members-pane"
								style={`width:${threadPaneWidth}px`}
							>
								<ThreadPane
									root={activeThreadRoot}
									messages={threadMessages}
									users={profiles}
									currentUserId={$user?.uid ?? null}
									{mentionOptions}
									pendingUploads={threadPendingUploads}
									{aiAssistEnabled}
									threadLabel={resolveThreadTitle()}
									parentChannelName={parentChannelNameForThread(activeThread, activeChannel)}
									isMobileView={false}
									popoutEnabled={!isMobile}
									showCloseButton={true}
									conversationContext={threadConversationContext}
									replyTarget={threadReplyTarget}
									defaultSuggestionSource={threadDefaultSuggestionSource}
									members={resolveThreadMembers()}
									threadStatus={activeThread?.status ?? null}
									on:close={closeThreadView}
									on:popout={openThreadPopout}
									on:send={(event) => handleThreadSend(event.detail)}
									on:sendGif={(event) => handleThreadSendGif(event.detail)}
									on:upload={(event) => handleThreadUploadFiles(event.detail)}
									on:createPoll={handleThreadCreatePoll}
									on:createForm={handleThreadCreateForm}
									on:reply={handleThreadReplySelect}
									on:cancelReply={resetThreadReplyTarget}
									on:openMembers={() => {
										threadMembersContext = 'active';
										showThreadMembersSheet = true;
									}}
								/>
							</div>
						{:else}
							<div
								class="thread-pane-desktop panel-muted server-columns__members-pane"
								style="width:320px"
							>
								{#if serverId}
									<MembersPane
										{serverId}
										channel={activeChannel}
										onHide={() => {
											desktopMembersPreferred = false;
											desktopMembersVisible = false;
										}}
									/>
								{:else}
									<div class="p-4 text-muted">No server selected.</div>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<!-- ======= MOBILE FULL-SCREEN PANELS (leave 72px rail visible) ======= -->

<!-- Navigation panel (servers + channels, slides from left) -->
<div
	class="mobile-panel md:hidden fixed inset-0 z-50 flex flex-col transition-transform duration-300 will-change-transform"
	class:mobile-panel--dragging={channelSwipeActive}
	style:transform={channelsTransform}
	style:pointer-events={channelPanelInteractive ? 'auto' : 'none'}
	aria-label="Servers and channels"
>
	<div class="mobile-panel__body md:hidden">
		<!-- Always mount LeftPane to keep subscriptions alive, use CSS visibility -->
		<div class="mobile-panel__servers" class:invisible={!showChannels} class:hidden={!showChannels && !channelSwipeActive}>
			<LeftPane
				activeServerId={serverId}
				padForDock={false}
				showBottomActions={false}
			/>
		</div>
		<div class="mobile-panel__channels">
			{#if serverId}
				<ServerSidebar
					{serverId}
					activeChannelId={activeChannel?.id ?? null}
					onPickChannel={(id: string) => pickChannel(id)}
					on:channels={handleSidebarChannels}
					threads={sidebarThreadList()}
					activeThreadId={activeThread?.id ?? null}
					onPickThread={(thread) => {
						showChannels = false;
						void openThreadFromSidebar(thread);
					}}
					on:pick={() => (showChannels = false)}
					threadUnreadByChannel={channelThreadUnread}
				/>
			{:else}
				<div class="p-4 text-white/70">Select a server to view channels.</div>
			{/if}
		</div>
	</div>
</div>

<!-- Members panel (slides from right) -->
<div
	class="mobile-panel md:hidden fixed inset-0 z-50 flex flex-col transition-transform duration-300 will-change-transform"
	class:mobile-panel--dragging={memberSwipeActive}
	style:transform={membersTransform}
	style:pointer-events={showMembers ? 'auto' : 'none'}
	aria-label="Members"
>
	<div class="mobile-panel__header md:hidden">
		<button
			class="mobile-panel__close -ml-2"
			aria-label="Back to chat"
			type="button"
			onclick={() => (showMembers = false)}
		>
			<i class="bx bx-chevron-right text-2xl"></i>
		</button>
		<div class="mobile-panel__title">{activeThread ? 'Thread members' : 'Members'}</div>
	</div>

	<div class="flex-1 overflow-y-auto touch-pan-y">
		{#if activeThread}
			{@const threadMembers = resolveThreadMembers()}
			<ThreadMembersPane
				members={threadMembers}
				threadName={activeThread?.name ?? activeChannel?.name ?? 'Thread'}
			/>
		{:else if serverId}
			<MembersPane {serverId} showHeader={false} channel={activeChannel} />
		{:else}
			<div class="p-4 text-white/70">No server selected.</div>
		{/if}
	</div>
</div>

<!-- Thread panel (slides from right) -->
<div
	class="mobile-panel md:hidden fixed inset-0 z-50 flex flex-col transition-transform duration-300 will-change-transform thread-panel"
	class:mobile-panel--dragging={threadSwipeActive}
	style:transform={threadTransform}
	style:pointer-events={activeThread && showThreadPanel ? 'auto' : 'none'}
	aria-label="Thread view"
>
	<div class="flex-1 panel-muted flex flex-col min-h-0">
		{#if activeThread}
			<ThreadPane
				root={activeThreadRoot}
				messages={threadMessages}
				users={profiles}
				currentUserId={$user?.uid ?? null}
				{mentionOptions}
				pendingUploads={threadPendingUploads}
				{aiAssistEnabled}
				threadLabel={resolveThreadTitle()}
				parentChannelName={parentChannelNameForThread(activeThread, activeChannel)}
				isMobileView={true}
				popoutEnabled={false}
				showCloseButton={true}
				conversationContext={threadConversationContext}
				replyTarget={threadReplyTarget}
				defaultSuggestionSource={threadDefaultSuggestionSource}
				members={resolveThreadMembers()}
				threadStatus={activeThread?.status ?? null}
				on:close={closeThreadView}
				on:send={(event) => handleThreadSend(event.detail)}
				on:sendGif={(event) => handleThreadSendGif(event.detail)}
				on:upload={(event) => handleThreadUploadFiles(event.detail)}
				on:createPoll={handleThreadCreatePoll}
				on:createForm={handleThreadCreateForm}
				on:reply={handleThreadReplySelect}
				on:cancelReply={resetThreadReplyTarget}
				on:openMembers={() => {
					threadMembersContext = 'active';
					showThreadMembersSheet = true;
				}}
			/>
		{:else}
			<div class="flex-1 flex items-center justify-center text-soft">No thread selected.</div>
		{/if}
	</div>
</div>

{#if floatingThreads.length > 0}
	{#each floatingThreads as fThread (fThread.id)}
		<div class="thread-popout-overlay" class:thread-popout-overlay--mobile={isMobile} style="pointer-events: none;">
			<div
				class="thread-popout-window"
				class:thread-popout-window--mobile={isMobile}
				style={isMobile ? '' : `--thread-popout-x:${fThread.position.x}px; --thread-popout-y:${fThread.position.y}px; pointer-events: auto;`}
			>
				<div class="thread-popout-header" onpointerdown={(e) => !isMobile && handleFloatingHeaderPointerDown(fThread.id, e)}>
					<div class="thread-popout-title">
						<i class="bx bx-message-square-detail"></i>
						<span
							>{resolveThreadTitle(fThread.thread, fThread.root) ||
								fThread.thread.name ||
								'Thread'}</span
						>
					</div>
					<div class="thread-popout-actions">
						{#if !isMobile}
							<button
								type="button"
								class="thread-popout-action"
								aria-label="Open in new window"
								title="Open in separate window"
								onclick={() => openThreadInWindow(fThread.id)}
							>
								<i class="bx bx-link-external"></i>
							</button>
						{/if}
						<button
							type="button"
							class="thread-popout-close"
							aria-label="Close floating thread"
							onclick={() => closeFloatingThread(fThread.id)}
						>
							<i class="bx bx-x"></i>
						</button>
					</div>
				</div>
				<ThreadPane
					root={fThread.root}
					messages={fThread.messages}
					users={profiles}
					currentUserId={$user?.uid ?? null}
					{mentionOptions}
					pendingUploads={fThread.pendingUploads}
					{aiAssistEnabled}
					threadLabel={resolveThreadTitle(fThread.thread, fThread.root)}
					parentChannelName={parentChannelNameForThread(fThread.thread, activeChannel)}
					isMobileView={false}
					popoutEnabled={false}
					showCloseButton={false}
					conversationContext={fThread.conversationContext}
					replyTarget={fThread.replyTarget}
					defaultSuggestionSource={fThread.defaultSuggestionSource}
					members={resolveThreadMembers(fThread.thread)}
					threadStatus={fThread.thread?.status ?? null}
					on:close={() => closeFloatingThread(fThread.id)}
					on:send={(event) => handleFloatingThreadSendForInstance(fThread.id, event.detail)}
					on:sendGif={(event) => handleFloatingThreadSendGifForInstance(fThread.id, event.detail)}
					on:upload={(event) => handleFloatingThreadUploadFilesForInstance(fThread.id, event.detail)}
					on:createPoll={handleFloatingThreadCreatePoll}
					on:createForm={handleFloatingThreadCreateForm}
					on:reply={(event) => handleFloatingThreadReplySelectForInstance(fThread.id, event)}
					on:cancelReply={() => resetFloatingThreadReplyTargetForInstance(fThread.id)}
					on:openMembers={() => {
						floatingThreadMembersId = fThread.id;
						showThreadMembersSheet = true;
					}}
				/>
			</div>
		</div>
	{/each}
{/if}

{#if showThreadMembersSheet && (activeThread || floatingThreads.length > 0)}
	{@const floatingInstance = floatingThreadMembersId ? floatingThreads.find(f => f.id === floatingThreadMembersId) : null}
	{@const sheetThread = floatingInstance ? floatingInstance.thread : activeThread}
	{@const sheetRoot = floatingInstance ? floatingInstance.root : activeThreadRoot}
	{@const sheetName = resolveThreadTitle(sheetThread, sheetRoot) || sheetThread?.name || 'Thread'}
	<div class="thread-members-sheet md:hidden" role="dialog" aria-modal="true">
		<button
			class="thread-members-sheet__backdrop"
			type="button"
			aria-label="Close members list"
			onclick={() => {
				showThreadMembersSheet = false;
				floatingThreadMembersId = null;
			}}
		></button>
		<div class="thread-members-sheet__body">
			<div class="thread-members-sheet__header">
				<span>Thread members</span>
				<button
					type="button"
					class="thread-members-sheet__close"
					aria-label="Close"
					onclick={() => {
						showThreadMembersSheet = false;
						floatingThreadMembersId = null;
					}}
				>
					<i class="bx bx-x"></i>
				</button>
			</div>
			<ThreadMembersPane members={resolveThreadMembers(sheetThread)} threadName={sheetName} />
		</div>
	</div>
{/if}

<!-- Popup mode: show only the thread in a minimal window -->
{#if isPopupMode && floatingThread && floatingThreadVisible}
	<div class="popup-thread-window">
		<div class="popup-thread-header">
			<div class="popup-thread-title">
				<i class="bx bx-message-square-detail"></i>
				<span
					>{resolveThreadTitle(floatingThread.thread, floatingThread.root) ||
						floatingThread.thread?.name ||
						'Thread'}</span
				>
			</div>
			<button
				type="button"
				class="popup-thread-close"
				aria-label="Close thread"
				onclick={() => window.close()}
			>
				<i class="bx bx-x"></i>
			</button>
		</div>
		<div class="popup-thread-content">
			<ThreadPane
				root={floatingThread.root}
				messages={floatingThreadMessages}
				users={profiles}
				currentUserId={$user?.uid ?? null}
				{mentionOptions}
				pendingUploads={floatingThreadPendingUploads}
				{aiAssistEnabled}
				threadLabel={resolveThreadTitle(floatingThread.thread, floatingThread.root)}
				parentChannelName={parentChannelNameForThread(floatingThread.thread, activeChannel)}
				isMobileView={false}
				popoutEnabled={false}
				showCloseButton={false}
				conversationContext={floatingThreadConversationContext}
				replyTarget={floatingThreadReplyTarget}
				defaultSuggestionSource={floatingThreadDefaultSuggestionSource}
				members={resolveThreadMembers(floatingThread.thread)}
				threadStatus={floatingThread.thread?.status ?? null}
				on:close={() => window.close()}
				on:send={(event) => handleFloatingThreadSend(event.detail)}
				on:sendGif={(event) => handleFloatingThreadSendGif(event.detail)}
				on:upload={(event) => handleFloatingThreadUploadFiles(event.detail)}
				on:createPoll={handleFloatingThreadCreatePoll}
				on:createForm={handleFloatingThreadCreateForm}
				on:reply={handleFloatingThreadReplySelect}
				on:cancelReply={resetFloatingThreadReplyTarget}
				on:openMembers={() => {}}
			/>
		</div>
	</div>
{:else if isPopupMode}
	<div class="popup-thread-loading">
		<div class="popup-loading-icon">
			<i class="bx bx-message-square-detail"></i>
		</div>
		<span>Loading thread...</span>
	</div>
{/if}

<ChannelSettingsSheet
	visible={channelSettingsOpen}
	channelName={activeChannel?.name ?? 'Channel'}
	pinned={pinnedMessages}
	canManagePins={canPinMessages}
	on:close={() => (channelSettingsOpen = false)}
	on:openPinned={(event) => {
		handlePinnedOpen(event.detail ?? {});
		channelSettingsOpen = false;
	}}
	on:unpin={(event) => handlePinnedUnpin(event.detail?.messageId)}
	on:pinLink={(event) => handlePinCustomLink(event.detail)}
/>

<style>
	/* Popup window mode styles (when opened in separate browser window) */
	.popup-thread-window {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: var(--color-bg);
		overflow: hidden;
	}

	.popup-thread-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.875rem 1rem;
		background: linear-gradient(to bottom, var(--color-sidebar), color-mix(in srgb, var(--color-sidebar) 95%, black));
		border-bottom: 1px solid var(--color-border-subtle);
		-webkit-app-region: drag;
		user-select: none;
	}

	.popup-thread-title {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		font-weight: 600;
		font-size: 0.9375rem;
		color: var(--color-text-primary);
	}

	.popup-thread-title i {
		font-size: 1.125rem;
		color: #a855f7;
	}

	.popup-thread-close {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		display: grid;
		place-items: center;
		font-size: 1.375rem;
		cursor: pointer;
		transition: background 150ms ease, color 150ms ease, transform 150ms ease;
		-webkit-app-region: no-drag;
	}

	.popup-thread-close:hover {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
		transform: scale(1.05);
	}

	.popup-thread-close:active {
		transform: scale(0.95);
	}

	.popup-thread-content {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--color-bg);
	}

	.popup-thread-content :global(.thread-pane) {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		border: none;
		border-radius: 0;
	}

	.popup-thread-content :global(.thread-pane__header) {
		display: none;
	}

	.popup-thread-content :global(.thread-pane__messages) {
		padding: 0.75rem;
	}

	.popup-thread-content :global(.thread-pane__composer) {
		border-top: 1px solid var(--color-border-subtle);
		background: var(--color-sidebar);
		padding: 0.75rem;
	}

	.popup-thread-loading {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		background: var(--color-bg);
		color: var(--color-text-secondary);
	}

	.popup-loading-icon {
		width: 56px;
		height: 56px;
		border-radius: 16px;
		background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(168, 85, 247, 0.1));
		display: grid;
		place-items: center;
		animation: pulse-loading 1.5s ease-in-out infinite;
	}

	.popup-loading-icon i {
		font-size: 1.75rem;
		color: #a855f7;
	}

	@keyframes pulse-loading {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.7; transform: scale(0.95); }
	}

	.mobile-panel__body {
		flex: 1;
		display: flex;
		background: var(--color-sidebar);
		border-top: 1px solid var(--color-border-subtle);
		min-height: 0;
		height: 100%;
		overflow: hidden;
	}

	.mobile-panel {
		padding-bottom: 0;
		top: 0;
		bottom: 0 !important;
		background: var(--color-sidebar);
		overscroll-behavior: contain;
	}

	.mobile-panel__servers {
		width: 72px;
		flex: 0 0 72px;
		display: flex;
		justify-content: center;
		background: var(--color-panel-muted);
		border-right: none;
		overflow-y: auto;
		overflow-x: hidden;
		-webkit-overflow-scrolling: touch;
		padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--mobile-dock-height, 0px));
		margin-bottom: calc(-1 * (env(safe-area-inset-bottom, 0px) + var(--mobile-dock-height, 0px)));
	}

	.mobile-panel__servers :global(.app-rail) {
		position: relative;
		inset: auto;
		width: 72px;
		height: 100%;
		min-height: 0;
		border-radius: 0;
		box-shadow: none;
		/* Server icons positioned below safe area with some breathing room */
		padding-top: calc(0.35rem + env(safe-area-inset-top, 0px) * 0.5);
		background: var(--color-panel-muted);
	}

	.mobile-panel__channels {
		flex: 1;
		min-width: 0;
		background: var(--color-sidebar);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.mobile-panel__channels :global(.server-sidebar) {
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: var(--color-sidebar);
	}

	.mobile-panel__channels :global(.server-sidebar > div:last-child) {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		padding-bottom: calc(10rem + env(safe-area-inset-bottom, 0px) + var(--mobile-dock-height, 0px));
		margin-bottom: calc(-1 * (env(safe-area-inset-bottom, 0px) + var(--mobile-dock-height, 0px)));
	}

	/* Mobile: hide scrollbars and contain scroll so the dock stays put */
	:global(.mobile-panel *::-webkit-scrollbar) {
		display: none;
		width: 0;
		height: 0;
	}

	:global(.mobile-panel *::-webkit-scrollbar-thumb) {
		display: none;
	}

	.mobile-panel * {
		scrollbar-width: none;
		-ms-overflow-style: none;
	}

	/* Keep layout stable when the iOS scroll indicator appears */
	.mobile-panel__servers,
	.mobile-panel__channels :global(.server-sidebar > div:last-child) {
		scrollbar-gutter: stable both-edges;
		overscroll-behavior: contain;
	}

	/* Mobile: hide scrollbars and keep scroll from tugging the dock */
	.mobile-panel__servers,
	.mobile-panel__channels :global(.server-sidebar > div:last-child) {
		scrollbar-width: none;
		-ms-overflow-style: none;
		overscroll-behavior: contain;
		touch-action: pan-y;
	}

	.mobile-panel__servers::-webkit-scrollbar,
	:global(.server-sidebar > div:last-child::-webkit-scrollbar) {
		display: none;
	}

	.thread-pane-desktop {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.thread-resize-handle {
		width: 12px;
		cursor: col-resize;
		position: relative;
		background: transparent;
		outline: none;
		border: none;
		padding: 0;
	}

	.thread-resize-handle::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 50%;
		transform: translateX(-50%);
		width: 2px;
		border-radius: 1px;
		background: color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
		opacity: 0.6;
	}

	.thread-resize-handle:hover::after,
	.thread-resize-handle:focus-visible::after,
	.thread-resize-handle.is-active::after {
		background: var(--color-accent);
		opacity: 1;
	}

	.members-pane-handle {
		position: fixed;
		top: calc(64px + env(safe-area-inset-top, 0px));
		right: 1.75rem;
		z-index: 60;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		background: color-mix(in srgb, var(--color-panel) 80%, transparent);
		color: var(--color-text-primary);
		box-shadow: 0 10px 25px rgba(5, 8, 15, 0.35);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.members-pane-handle:hover,
	.members-pane-handle:focus-visible {
		background: color-mix(in srgb, var(--color-panel) 90%, transparent);
		border-color: color-mix(in srgb, var(--color-border-subtle) 85%, transparent);
		outline: none;
	}

	.server-workspace :global(.panel),
	.server-workspace :global(.panel-muted),
	.server-workspace :global(.sidebar-surface),
	.server-workspace :global(.channel-header) {
		border-radius: 0;
	}

	/* Make chat input region darker on desktop to match the dark theme */
	@media (min-width: 768px) {
		.server-workspace :global(.chat-input-region.panel-muted) {
			background: var(--color-panel);
		}
	}

	.server-columns {
		background: var(--color-panel-muted);
	}

	.server-columns__sidebar,
	.server-columns__members,
	.server-columns__main {
		min-height: 0;
	}

	.server-columns__sidebar {
		border-right: 1px solid var(--color-border-subtle);
	}

	.server-columns__sidebar :global(.server-sidebar) {
		border-right: none !important;
	}

	.server-columns__main {
		border-right: 1px solid var(--color-border-subtle);
	}

	.server-columns__members-pane {
		border-left: none;
	}

	.thread-panel {
		background: color-mix(in srgb, var(--color-panel) 95%, transparent);
	}

	.thread-panel :global(.thread-pane) {
		flex: 1;
		min-height: 0;
	}

	.thread-members-sheet {
		position: fixed;
		inset: 0;
		z-index: 70;
		display: flex;
		justify-content: center;
		align-items: flex-end;
	}

	.thread-members-sheet__backdrop {
		position: absolute;
		inset: 0;
		background: rgba(5, 8, 18, 0.45);
	}

	.thread-members-sheet__body {
		position: relative;
		width: 100%;
		max-height: 80vh;
		background: color-mix(in srgb, var(--color-panel), transparent);
		border-top-left-radius: 1.5rem;
		border-top-right-radius: 1.5rem;
		padding: 1rem;
		box-shadow: 0 -16px 36px rgba(5, 8, 20, 0.45);
		overflow-y: auto;
	}

	.thread-members-sheet__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.thread-members-sheet__header span {
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.thread-members-sheet__close {
		width: 32px;
		height: 32px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		background: transparent;
		color: var(--color-text-primary);
	}

	.thread-members-sheet__close:hover,
	.thread-members-sheet__close:focus-visible {
		background: color-mix(in srgb, var(--color-border-subtle) 25%, transparent);
		outline: none;
	}

	.thread-popout-overlay {
		position: fixed;
		inset: 0;
		z-index: 90;
		pointer-events: none;
	}

	.thread-popout-overlay--mobile {
		z-index: 9999;
		pointer-events: auto;
		background: var(--color-bg);
	}

	.thread-popout-window {
		width: 400px;
		height: 520px;
		background: var(--color-bg);
		border: 1px solid var(--color-border-subtle);
		border-radius: 12px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.05);
		pointer-events: auto;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(calc(-50% + var(--thread-popout-x, 0px)), calc(-50% + var(--thread-popout-y, 0px)));
	}

	.thread-popout-window--mobile {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		border: none;
		border-radius: 0;
		box-shadow: none;
		left: 0;
		top: 0;
		transform: none;
	}

	.thread-popout-window--mobile .thread-popout-header {
		cursor: default;
		padding: 0.875rem 1rem;
		padding-top: max(0.875rem, env(safe-area-inset-top));
	}

	.thread-popout-window--mobile .thread-popout-title {
		font-size: 1rem;
	}

	.thread-popout-window--mobile .thread-popout-close {
		width: 36px;
		height: 36px;
		font-size: 1.5rem;
	}

	.thread-popout-window--mobile :global(.thread-pane__composer) {
		padding-bottom: max(0px, env(safe-area-inset-bottom));
	}

	.thread-popout-window :global(.thread-pane) {
		flex: 1;
		border: none;
		border-radius: 0;
		min-height: 0;
	}

	.thread-popout-window :global(.thread-pane__body) {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.thread-popout-window :global(.thread-pane__header) {
		display: none;
	}

	.thread-popout-window :global(.thread-pane__messages-wrap) {
		flex: 1;
		min-height: 0;
	}

	.thread-popout-window :global(.thread-pane__composer) {
		border-top: 1px solid var(--color-border-subtle);
		background: var(--color-sidebar);
		flex-shrink: 0;
	}

	.thread-popout-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 0.875rem;
		background: var(--color-sidebar);
		border-bottom: 1px solid var(--color-border-subtle);
		cursor: grab;
		user-select: none;
		-webkit-user-select: none;
		touch-action: none;
		flex-shrink: 0;
	}

	.thread-popout-header:active {
		cursor: grabbing;
	}

	.thread-popout-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--color-text-primary);
		min-width: 0;
		flex: 1;
	}

	.thread-popout-title i {
		font-size: 1rem;
		color: #a855f7;
		flex-shrink: 0;
	}

	.thread-popout-title span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.thread-popout-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.thread-popout-action {
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		display: grid;
		place-items: center;
		font-size: 1rem;
		transition: background 120ms ease, color 120ms ease;
		cursor: pointer;
	}

	.thread-popout-action:hover,
	.thread-popout-action:focus-visible {
		background: var(--color-border-subtle);
		color: var(--color-text-primary);
		outline: none;
	}

	.thread-popout-close {
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		display: grid;
		place-items: center;
		font-size: 1.125rem;
		transition: background 120ms ease, color 120ms ease;
		cursor: pointer;
	}

	.thread-popout-close:hover,
	.thread-popout-close:focus-visible {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
		outline: none;
	}

	.channel-popout-overlay {
		position: fixed;
		inset: 0;
		z-index: 80;
		pointer-events: none;
	}

	.channel-popout-window {
		position: absolute;
		right: 1.25rem;
		bottom: 1.25rem;
		width: min(520px, 46vw);
		max-height: min(82vh, 760px);
		background: color-mix(in srgb, var(--color-panel) 94%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		border-radius: 1rem;
		box-shadow: 0 22px 58px rgba(5, 8, 20, 0.45);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		pointer-events: auto;
	}

	.channel-popout-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.65rem;
		padding: 0.75rem 0.9rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 40%, transparent);
		cursor: grab;
		user-select: none;
		-webkit-user-select: none;
		touch-action: none;
	}

	.channel-popout-header--dragging {
		cursor: grabbing;
	}

	.channel-popout-title {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.channel-popout-title span {
		font-weight: 700;
		color: var(--color-text-primary);
		line-height: 1.2;
	}

	.channel-popout-title small {
		color: var(--color-text-secondary);
		font-size: 0.85rem;
	}

	.channel-popout-close {
		width: 34px;
		height: 34px;
		border-radius: 0.75rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		background: color-mix(in srgb, var(--color-panel) 70%, transparent);
		color: var(--color-text-primary);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.channel-popout-close:hover,
	.channel-popout-close:focus-visible {
		background: color-mix(in srgb, var(--color-panel) 85%, transparent);
		outline: none;
	}

	.channel-popout-body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		padding: 0.65rem 0.75rem 0.75rem;
		gap: 0.5rem;
	}

	.channel-popout-body :global(.message-scroll-region) {
		background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
		border-radius: 0.9rem;
	}

	.channel-popout-body :global(.chat-input-region) {
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		border-radius: 0.9rem;
	}

	.channel-popout-resize {
		position: absolute;
		padding: 0;
		margin: 0;
		background: transparent;
		border: none;
		pointer-events: auto;
	}

	.channel-popout-resize.is-active {
		border-color: color-mix(in srgb, var(--color-accent) 75%, transparent);
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
	}

	.channel-popout-resize--left,
	.channel-popout-resize--right {
		top: 6px;
		bottom: 6px;
		width: 18px;
		border-radius: 999px;
		border: 1px dashed color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
		cursor: col-resize;
		box-shadow: 0 4px 12px rgba(4, 6, 14, 0.18);
	}

	.channel-popout-resize--left {
		left: -14px;
	}

	.channel-popout-resize--right {
		right: -14px;
	}

	.channel-popout-resize--top,
	.channel-popout-resize--bottom {
		left: 12px;
		right: 12px;
		height: 18px;
		border-radius: 999px;
		border: 1px dashed color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
		cursor: row-resize;
		box-shadow: 0 4px 12px rgba(4, 6, 14, 0.18);
	}

	.channel-popout-resize--top {
		top: -14px;
	}

	.channel-popout-resize--bottom {
		bottom: -14px;
	}

	.channel-popout-resize--bottom-right,
	.channel-popout-resize--bottom-left,
	.channel-popout-resize--top-right,
	.channel-popout-resize--top-left {
		width: 22px;
		height: 22px;
		border-radius: 11px;
		border: 1px dashed color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
		box-shadow: 0 4px 12px rgba(4, 6, 14, 0.18);
	}

	.channel-popout-resize--bottom-right {
		right: -14px;
		bottom: -14px;
		cursor: nwse-resize;
	}

	.channel-popout-resize--bottom-left {
		left: -14px;
		bottom: -14px;
		cursor: nesw-resize;
	}

	.channel-popout-resize--top-right {
		right: -14px;
		top: -14px;
		cursor: nesw-resize;
	}

	.channel-popout-resize--top-left {
		left: -14px;
		top: -14px;
		cursor: nwse-resize;
	}

	.call-chat-popout-overlay {
		position: fixed;
		inset: 0;
		z-index: 85;
		pointer-events: none;
	}

	.call-chat-popout-window {
		width: min(520px, calc(100vw - 2.5rem));
		max-height: min(82vh, 760px);
		background: color-mix(in srgb, var(--color-panel) 94%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		border-radius: 1rem;
		box-shadow: 0 22px 58px rgba(5, 8, 20, 0.45);
		pointer-events: auto;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		position: absolute;
		min-width: 320px;
		min-height: 280px;
		resize: none;
	}

	.call-chat-popout-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.65rem;
		padding: 0.75rem 0.9rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 40%, transparent);
		cursor: grab;
		user-select: none;
		-webkit-user-select: none;
		touch-action: none;
	}

	.call-chat-popout-header--dragging {
		cursor: grabbing;
	}

	.call-chat-popout-title {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.call-chat-popout-title span {
		font-weight: 700;
		color: var(--color-text-primary);
		line-height: 1.2;
	}

	.call-chat-popout-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.call-chat-popout__action {
		width: 34px;
		height: 34px;
		border-radius: 0.75rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
		color: var(--color-text-primary);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.call-chat-popout__action:hover,
	.call-chat-popout__action:focus-visible {
		background: color-mix(in srgb, var(--color-panel) 80%, transparent);
		outline: none;
	}

	.call-chat-popout__action--close {
		background: color-mix(in srgb, var(--color-danger, #ef4444) 18%, transparent);
		border-color: color-mix(in srgb, var(--color-danger, #ef4444) 55%, transparent);
		color: color-mix(in srgb, var(--color-danger, #ef4444) 90%, white);
	}

	.call-chat-popout__resize {
		position: absolute;
		padding: 0;
		margin: 0;
		background: transparent;
		border: none;
		pointer-events: auto;
	}

	.call-chat-popout__resize.is-active {
		border-color: color-mix(in srgb, var(--color-accent) 75%, transparent);
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
	}

	.call-chat-popout__resize--left,
	.call-chat-popout__resize--right {
		top: 6px;
		bottom: 6px;
		width: 18px;
		border-radius: 999px;
		border: 1px dashed color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
		cursor: col-resize;
		box-shadow: 0 4px 16px rgba(4, 6, 14, 0.2);
	}

	.call-chat-popout__resize--left {
		left: -14px;
	}

	.call-chat-popout__resize--right {
		right: -14px;
	}

	.call-chat-popout__resize--top,
	.call-chat-popout__resize--bottom {
		left: 14px;
		right: 14px;
		height: 18px;
		border-radius: 999px;
		border: 1px dashed color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
		cursor: row-resize;
		box-shadow: 0 4px 16px rgba(4, 6, 14, 0.2);
	}

	.call-chat-popout__resize--top {
		top: -14px;
	}

	.call-chat-popout__resize--bottom {
		bottom: -14px;
	}

	.call-chat-popout__resize--bottom-right,
	.call-chat-popout__resize--bottom-left,
	.call-chat-popout__resize--top-right,
	.call-chat-popout__resize--top-left {
		width: 22px;
		height: 22px;
		border-radius: 11px;
		border: 1px dashed color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
		box-shadow: 0 4px 16px rgba(4, 6, 14, 0.2);
		cursor: nwse-resize;
	}

	.call-chat-popout__resize--bottom-right {
		right: -14px;
		bottom: -14px;
		cursor: nwse-resize;
	}

	.call-chat-popout__resize--bottom-left {
		left: -14px;
		bottom: -14px;
		cursor: nesw-resize;
	}

	.call-chat-popout__resize--top-right {
		right: -14px;
		top: -14px;
		cursor: nesw-resize;
	}

	.call-chat-popout__resize--top-left {
		left: -14px;
		top: -14px;
		cursor: nwse-resize;
	}

	.call-chat-popout-body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		padding: 0.75rem 0.9rem 0.9rem;
		gap: 0.6rem;
	}

	.call-chat-popout-body :global(.message-scroll-region) {
		background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
		border-radius: 0.9rem;
	}

	.call-chat-popout-body :global(.chat-input-region) {
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		border-radius: 0.9rem;
	}

	.mobile-panel__channels :global(.sidebar-surface) {
		flex: 1;
		min-height: 0;
		border-right: none !important;
		border-left: none !important;
		border: none !important;
	}

	.desktop-call-layout {
		display: flex;
		min-height: calc(100vh - 120px);
		align-items: center;
		justify-content: center;
		width: 100%;
	}

	.desktop-call-main {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		min-height: calc(100vh - 120px);
		padding: 0;
		align-items: center;
		justify-content: center;
	}

	.call-chat-overlay {
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 70;
	}

	.call-chat-window {
		position: absolute;
		right: clamp(2.5rem, 10vw, 6rem);
		top: calc(76px + env(safe-area-inset-top, 0px));
		bottom: calc(1.25rem + env(safe-area-inset-bottom, 0px));
		width: min(720px, 55vw);
		min-width: 320px;
		max-width: min(1200px, 70vw);
		background: color-mix(in srgb, var(--color-panel) 94%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		border-radius: 1rem;
		box-shadow:
			0 22px 58px rgba(5, 8, 20, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		pointer-events: auto;
		position: absolute;
	}

	.call-chat-window__rail {
		position: absolute;
		top: 0;
		bottom: 0;
		left: -10px;
		width: 14px;
		border-radius: 999px;
		border: 1px dashed color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
		cursor: col-resize;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		pointer-events: auto;
		box-shadow: 0 4px 16px rgba(4, 6, 14, 0.25);
	}

	.call-chat-window__rail.is-active {
		border-color: color-mix(in srgb, var(--color-accent) 75%, transparent);
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
	}

	.call-chat-window__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.65rem;
		padding: 0.75rem 0.9rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 40%, transparent);
	}

	.call-chat-window__title {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.call-chat-window__title span {
		font-weight: 700;
		color: var(--color-text-primary);
		line-height: 1.2;
	}

	.call-chat-window__actions {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.call-chat-window__action {
		width: 34px;
		height: 34px;
		border-radius: 0.75rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		background: color-mix(in srgb, var(--color-panel) 70%, transparent);
		color: var(--color-text-primary);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.call-chat-window__action:hover,
	.call-chat-window__action:focus-visible {
		background: color-mix(in srgb, var(--color-panel) 85%, transparent);
		outline: none;
	}

	.call-chat-window__close {
		width: 34px;
		height: 34px;
		border-radius: 0.75rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		background: color-mix(in srgb, var(--color-panel) 70%, transparent);
		color: var(--color-text-primary);
	}

	.call-chat-window__close:hover,
	.call-chat-window__close:focus-visible {
		background: color-mix(in srgb, var(--color-panel) 85%, transparent);
		outline: none;
	}

	.call-chat-window__content {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		padding: 0.5rem 0.75rem 0.75rem;
		gap: 0.5rem;
	}

	.call-chat-window__content :global(.message-scroll-region) {
		background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
		border-radius: 0.9rem;
	}

	.call-chat-window__content :global(.chat-input-region) {
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		border-radius: 0.9rem;
	}

	.mobile-call-wrapper {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		padding: 0.75rem 0.9rem 0.95rem;
		flex: 1;
		min-height: 0;
	}

	.mobile-call-tabs {
		display: inline-flex;
		align-self: center;
		background: color-mix(in srgb, var(--color-panel) 70%, transparent);
		border-radius: 999px;
		padding: 0.35rem;
		gap: 0.35rem;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.12),
			0 8px 24px rgba(7, 10, 22, 0.4);
	}

	.mobile-call-tab {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.48rem 1.05rem;
		border-radius: 999px;
		border: none;
		background: transparent;
		color: var(--text-55);
		font-size: 0.78rem;
		font-weight: 650;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		transition:
			background 170ms ease,
			color 170ms ease,
			transform 170ms ease,
			box-shadow 170ms ease;
	}

	.mobile-call-tab i {
		font-size: 1.05rem;
	}

	.mobile-call-tab.is-active {
		background: color-mix(in srgb, var(--color-accent) 26%, transparent);
		color: color-mix(in srgb, var(--color-accent) 85%, white);
		box-shadow:
			0 10px 28px rgba(10, 12, 20, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.28);
	}

	.mobile-call-card,
	.mobile-chat-card {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		border-radius: 0.75rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		box-shadow:
			0 24px 45px rgba(10, 15, 30, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
		overflow: hidden;
	}

	.mobile-call-card {
		background: color-mix(in srgb, var(--color-panel) 86%, transparent);
		padding: 0.6rem;
		height: clamp(220px, 52vh, 360px);
	}

	.mobile-call-card :global(.voice-root) {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.mobile-call-card :global(.call-shell) {
		flex: 1;
		min-height: 0;
	}

	.mobile-chat-card {
		background: color-mix(in srgb, var(--color-panel-muted) 94%, transparent);
		padding: 0.65rem;
	}

	.mobile-chat-card :global(.thread-pane) {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.mobile-chat-card :global(.thread-pane__body) {
		flex: 1;
		min-height: 0;
	}

	.mobile-chat-card :global(.thread-pane__composer) {
		margin-top: auto;
	}

	.mobile-chat-card :global(.chat-input-region) {
		position: relative !important;
		bottom: auto !important;
		left: auto !important;
		right: auto !important;
		z-index: auto !important;
		border-radius: 0 0 0.75rem 0.75rem;
		box-shadow: none;
		padding: 0.5rem !important;
	}

	.mobile-chat-card :global(.message-scroll-region) {
		border-radius: 0.75rem 0.75rem 0 0;
	}

	.pinned-banner {
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.pinned-banner :global(.pinned-bar) {
		border-radius: 0 0 var(--radius-sm) var(--radius-sm);
	}

	@media (min-width: 768px) {
		.mobile-call-wrapper {
			display: none;
		}
	}
</style>
