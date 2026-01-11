<script lang="ts">
	import { run } from 'svelte/legacy';

	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { user } from '$lib/stores/user';
	import { getDb } from '$lib/firebase';
	import { doc, getDoc, onSnapshot, collection, query, orderBy, limit, getDocs, type Unsubscribe } from 'firebase/firestore';
	import { mobileDockSuppressed } from '$lib/stores/ui';

	import DMsSidebar from '$lib/components/dms/DMsSidebar.svelte';
	import MessageList from '$lib/components/chat/MessageList.svelte';
	import ChatInput from '$lib/components/chat/ChatInput.svelte';
	import Avatar from '$lib/components/app/Avatar.svelte';
	import GroupChatInfoPanel from '$lib/components/dms/GroupChatInfoPanel.svelte';
	import {
		openOverlay,
		closeOverlay,
		registerOverlayHandler,
		clearAllOverlays,
		type MobileOverlayId
	} from '$lib/stores/mobileNav';

	import {
		sendDMMessage,
		streamDMMessages,
		loadOlderDMMessages,
		markThreadRead,
		voteOnDMPoll,
		submitDMForm,
		toggleDMReaction,
		type DMThread
	} from '$lib/firestore/dms';
	import { markDMActivityRead } from '$lib/stores/activityFeed';
	import type { ReplyReferenceInput } from '$lib/firestore/messages';
	import { resolveProfilePhotoURL } from '$lib/utils/profile';
	import { RESUME_DM_SCROLL_KEY } from '$lib/constants/navigation';
	import { uploadDMFile } from '$lib/firebase/storage';
	import type { PendingUploadPreview } from '$lib/components/chat/types';
	import { looksLikeImage } from '$lib/utils/fileType';
	import { presenceFromSources, type PresenceState } from '$lib/presence/state';
	import {
		getCachedDMMessages,
		updateDMCache,
		hasDMCache,
		type CachedMessage
	} from '$lib/stores/messageCache';

	interface Props {
		data: { threadID: string };
	}

	let { data }: Props = $props();
	let threadID = $derived(data.threadID);
	const messageScrollKey = $derived(`${threadID ?? 'dm'}`);

	let me: any = $state(null);
	run(() => {
		me = $user;
	});

	let messages: any[] = $state([]);
	let messagesLoading = $state(true);
	let messageUsers: Record<string, any> = $state({});
	let pendingUploads: PendingUploadPreview[] = $state([]);
	const profileUnsubs: Record<string, Unsubscribe> = {};
	let sidebarRef: InstanceType<typeof DMsSidebar> | null = $state(null);
	let sidebarRefMobile: InstanceType<typeof DMsSidebar> | null = $state(null);
	type MentionOption = {
		uid: string;
		label: string;
		handle: string;
		avatar: string | null;
		search: string;
		aliases: string[];
		kind?: 'member' | 'role' | 'special';
		color?: string | null;
	};
	type MentionSendRecord = {
		uid: string;
		handle: string | null;
		label: string | null;
		color?: string | null;
		kind?: 'member' | 'role' | 'special';
	};
	let mentionOptions: MentionOption[] = $state([]);
	let resumeDmScroll = false;
	let scrollResumeSignal = $state(0);
	let earliestLoadedDoc: any = $state(null); // Track oldest message doc for pagination
	let composerFocusSignal = $state(0);
	const combinedScrollSignal = $derived(scrollResumeSignal + composerFocusSignal);
	let lastPendingThreadId: string | null = null;

	onMount(() => {
		if (!browser) return;
		try {
			const storedResume = sessionStorage.getItem(RESUME_DM_SCROLL_KEY) === '1';
			resumeDmScroll = storedResume;
			if (storedResume) {
				sessionStorage.removeItem(RESUME_DM_SCROLL_KEY);
			}
		} catch {
			resumeDmScroll = false;
		}
	});

	run(() => {
		if (threadID !== lastPendingThreadId) {
			lastPendingThreadId = threadID;
			pendingUploads = [];
		}
	});

	function updateMessageUserCache(uid: string, patch: any) {
		if (!uid) return;
		const prev = messageUsers[uid] ?? {};
		const next = { ...prev, ...patch };
		messageUsers = { ...messageUsers, [uid]: next };
	}

	function ensureProfileSubscription(database: ReturnType<typeof getDb>, uid: string) {
		if (!uid || profileUnsubs[uid]) return;
		profileUnsubs[uid] = onSnapshot(
			doc(database, 'profiles', uid),
			(snap) => {
				const data: any = snap.data() ?? {};
				const displayName =
					pickString(data?.name) ?? pickString(data?.displayName) ?? pickString(data?.email);
				const photoURL = resolveProfilePhotoURL(data);
				updateMessageUserCache(uid, {
					uid,
					displayName,
					name: displayName,
					photoURL,
					authPhotoURL: data?.authPhotoURL ?? null,
					settings: data?.settings ?? undefined
				});
			},
			() => {
				profileUnsubs[uid]?.();
				delete profileUnsubs[uid];
			}
		);
	}
	let unsub: (() => void) | null = $state(null);
	let mounted = $state(false);

	let otherUid: string | null = $state(null);
	let otherProfile: any = $state(null);
	let otherMessageUser: any = $state(null);
	let metaLoading = $state(true);
	
	// Presence tracking for the other user
	let otherPresence: PresenceState = $state('offline');
	let presenceUnsub: (() => void) | null = null;
	
	// Group chat state
	let isGroupChat = $state(false);
	let groupName = $state<string | null>(null);
	let groupIconURL = $state<string | null>(null);
	let groupDescription = $state<string | null>(null);
	let groupParticipants = $state<string[]>([]);
	let groupParticipantProfiles = $state<Record<string, any>>({});
	let threadData = $state<(DMThread & { id: string }) | null>(null);

	let showThreads = $state(false);
	let showInfo = $state(false);
	let swipeSurface: HTMLDivElement | null = null;
	let lastThreadID: string | null = null;
	let pendingReply: ReplyReferenceInput | null = $state(null);
	let replySourceMessage: any = $state(null);
	let latestInboundMessage: any = $state(null);
	let aiConversationContext: any[] = $state([]);
	let aiAssistEnabled = $state(true);
	let composerEl: HTMLDivElement | null = $state(null);
	let composerHeight = $state(0);
	let composerObserver: ResizeObserver | null = null;
	let lastComposerEl: HTMLDivElement | null = null;
	let dockClaimed = false;

	const useMobileShell = () => typeof window !== 'undefined' && window.innerWidth < 768;

	function observeComposer(target: HTMLDivElement | null) {
		if (!browser || typeof ResizeObserver === 'undefined') {
			composerHeight = target ? composerHeight : 0;
			return;
		}
		composerObserver?.disconnect();
		if (target) {
			composerObserver = new ResizeObserver((entries) => {
				const entry = entries[0];
				composerHeight = entry?.contentRect?.height ?? 0;
			});
			composerObserver.observe(target);
		} else {
			composerObserver = null;
			composerHeight = 0;
		}
	}

	onMount(() => {
		clearAllOverlays();
		observeComposer(composerEl);
		return () => {
			composerObserver?.disconnect();
			composerObserver = null;
		};
	});

	$effect(() => {
		if (!browser) return;
		if (useMobileShell()) {
			if (!dockClaimed) {
				mobileDockSuppressed.claim();
				dockClaimed = true;
			}
		} else if (dockClaimed) {
			mobileDockSuppressed.release();
			dockClaimed = false;
		}
	});

	onDestroy(() => {
		if (dockClaimed) {
			mobileDockSuppressed.release();
			dockClaimed = false;
		}
	});

	$effect(() => {
		if (!browser || composerEl === lastComposerEl) return;
		lastComposerEl = composerEl;
		observeComposer(composerEl);
	});

	const scrollRegionStyle = $derived(`--chat-input-height: ${Math.max(composerHeight, 0)}px`);

	// Keep overlays and browser history synchronized so native edge swipes pop the same stack as our buttons.
	let routeSyncTimer: ReturnType<typeof setTimeout> | null = null;

	const syncThreadsVisibility = (
		next: boolean,
		{ source = 'ui' }: { source?: 'ui' | 'history' } = {}
	) => {
		if (showThreads === next) return;
		showThreads = next;

		if (browser && useMobileShell()) {
			const target = next ? '/dms' : threadID ? `/dms/${threadID}` : '/dms';

			if (routeSyncTimer) {
				clearTimeout(routeSyncTimer);
				routeSyncTimer = null;
			}

			routeSyncTimer = setTimeout(
				() => {
					if (window.location.pathname !== target) {
						void goto(target, { replaceState: true, noScroll: true, keepFocus: true });
					}
					routeSyncTimer = null;
				},
				Math.min(PANEL_DURATION + 50, 320)
			);
		}

		if (!browser || !useMobileShell()) return;
		if (next) {
			openOverlay(THREADS_OVERLAY_ID);
		} else if (source !== 'history') {
			closeOverlay(THREADS_OVERLAY_ID);
		}
	};

	// Mirror the same pop-stack behavior for the info sheet on the right.
	const syncInfoVisibility = (
		next: boolean,
		{ source = 'ui' }: { source?: 'ui' | 'history' } = {}
	) => {
		if (showInfo === next) return;
		showInfo = next;
		if (!browser || !useMobileShell()) return;
		if (next) {
			openOverlay(INFO_OVERLAY_ID);
		} else if (source !== 'history') {
			closeOverlay(INFO_OVERLAY_ID);
		}
	};

	const resolveThreadId = (detail: unknown): string | null => {
		if (typeof detail === 'string') return detail;
		if (detail && typeof detail === 'object' && 'id' in detail) {
			const candidate = (detail as { id?: unknown }).id;
			return typeof candidate === 'string' ? candidate : null;
		}
		return null;
	};

	function handleSidebarSelect(event: CustomEvent<any>) {
		const targetId = resolveThreadId(event?.detail);
		syncThreadsVisibility(false);
		syncInfoVisibility(false);
		if (!targetId || targetId === threadID) return;
		if (targetId === '__notes') return;
	}

	const SWIPE_THRESHOLD = 72; // bump to increase swipe distance required to toggle panels
	const SWIPE_RATIO = 0.24; // proportional fallback ensures smaller phones remain usable
	const EDGE_DEAD_ZONE = 18; // keep our gestures away from OS edge swipes
	const PANEL_DURATION = 260;
	const PANEL_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
	const THREADS_OVERLAY_ID: MobileOverlayId = 'dm-list';
	const INFO_OVERLAY_ID: MobileOverlayId = 'dm-info';

	let tracking = false;
	let startX = 0;
	let startY = 0;
	let swipeTarget: 'threads' | 'info' | null = null;
	let leftSwipeMode: 'open' | 'close' | null = null;
	let rightSwipeMode: 'open' | 'close' | null = null;
	let leftSwipeWidth = $state(1);
	let rightSwipeWidth = $state(1);
	let leftSwipeDelta = $state(0);
	let rightSwipeDelta = $state(0);
	let leftSwipeActive = $state(false);
	let rightSwipeActive = $state(false);

	const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
	const threadsTransform = $derived.by(() => {
		if (leftSwipeActive && leftSwipeMode && leftSwipeWidth > 0) {
			const progress = clamp(leftSwipeDelta / leftSwipeWidth, -1, 1);
			if (leftSwipeMode === 'open') {
				const offset = clamp(-100 + Math.max(progress, 0) * 100, -100, 0);
				return `translate3d(${offset}%, 0, 0)`;
			}
			const offset = clamp(progress * 100, -100, 0);
			return `translate3d(${offset}%, 0, 0)`;
		}
		return showThreads ? 'translate3d(0, 0, 0)' : 'translate3d(-100%, 0, 0)';
	});
	const infoTransform = $derived.by(() => {
		if (rightSwipeActive && rightSwipeMode && rightSwipeWidth > 0) {
			const progress = clamp(rightSwipeDelta / rightSwipeWidth, -1, 1);
			if (rightSwipeMode === 'open') {
				const offset = clamp(100 + progress * 100, 0, 100);
				return `translate3d(${offset}%, 0, 0)`;
			}
			const offset = clamp(progress * 100, 0, 100);
			return `translate3d(${offset}%, 0, 0)`;
		}
		return showInfo ? 'translate3d(0, 0, 0)' : 'translate3d(100%, 0, 0)';
	});

	function pickString(value: unknown): string | undefined {
		if (typeof value !== 'string') return undefined;
		const trimmed = value.trim();
		return trimmed.length ? trimmed : undefined;
	}

	const makeUploadId = () => {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return Math.random().toString(36).slice(2);
	};

	function registerPendingUpload(file: File): {
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
			uid: me?.uid ?? null,
			name: file?.name || 'Upload',
			size: file?.size,
			contentType: file?.type ?? null,
			isImage,
			progress: currentProgress,
			previewUrl
		};
		pendingUploads = [...pendingUploads, entry];

		const commitProgress = (value: number) => {
			if (!Number.isFinite(value)) return;
			currentProgress = Math.min(1, Math.max(currentProgress, value));
			pendingUploads = pendingUploads.map((item) =>
				item.id === id ? { ...item, progress: currentProgress } : item
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
				pendingUploads = pendingUploads.filter((item) => item.id !== id);
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
	function markThreadAsSeen(opts?: { at?: any; lastMessageId?: string | null }) {
		if (!threadID || !me?.uid) return;
		const payload = {
			at: opts?.at ?? new Date(),
			lastMessageId: opts?.lastMessageId ?? null
		};
		markThreadRead(threadID, me.uid, payload).catch(() => {});
		// Also mark activity feed entries for this DM as read
		void markDMActivityRead(threadID);
	}

	function canonical(value: unknown): string {
		if (typeof value !== 'string') return '';
		return value
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '');
	}

	function normalizeUid(value: unknown): string | null {
		if (typeof value !== 'string') return null;
		const trimmed = value.trim();
		return trimmed.length ? trimmed : null;
	}

	function buildMentionOption(uid: string, source: any = {}): MentionOption {
		const label =
			pickString(source?.displayName) ??
			pickString(source?.name) ??
			pickString(source?.email) ??
			'Member';
		const handleBase = canonical(label) || 'member';
		const handle = `${handleBase}${uid.slice(-4).toLowerCase()}`;
		const avatar = resolveProfilePhotoURL(source);
		const aliases = new Set<string>();
		const register = (value: unknown) => {
			const canon = canonical(value);
			if (canon) aliases.add(canon);
		};
		register(handleBase);
		register(label);
		label.split(/\s+/).forEach(register);
		if (source?.email) {
			register(String(source.email).split('@')[0]);
		}
		return {
			uid,
			label,
			handle,
			avatar: avatar ?? pickString(source?.photoURL) ?? null,
			search: [label, source?.email].filter(Boolean).join(' ').toLowerCase(),
			aliases: Array.from(aliases),
			kind: 'member',
			color: null
		};
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
		return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
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
				const text = pickString(raw?.text) ?? pickString(raw?.content) ?? '';
				const clipped = clipReply(text);
				return clipped || 'Message';
			}
		}
	}

	function buildReplyReference(message: any): ReplyReferenceInput | null {
		const messageId = pickString(message?.id);
		if (!messageId) return null;
		const type = inferMessageType(message);
		const authorId = pickString(message?.uid) ?? pickString(message?.authorId) ?? null;
		const authorRecord = authorId ? messageUsers[authorId] : null;
		const authorName =
			pickString(message?.displayName) ??
			pickString(authorRecord?.displayName) ??
			(authorId === me?.uid ? 'You' : authorId);
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

	function consumeReply(explicit?: ReplyReferenceInput | null) {
		const candidate =
			explicit && explicit.messageId
				? explicit
				: pendingReply && pendingReply.messageId
					? pendingReply
					: null;
		pendingReply = null;
		return candidate && candidate.messageId ? candidate : null;
	}

	function restoreReply(ref: ReplyReferenceInput | null) {
		if (ref?.messageId) {
			pendingReply = ref;
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

	function deriveMeDisplayName() {
		return pickString(me?.displayName) ?? pickString(me?.email) ?? 'You';
	}

	function deriveMePhotoURL() {
		if (!me?.uid) {
			return pickString(me?.photoURL) ?? null;
		}
		const cached = messageUsers[me.uid];
		const fallback = pickString(me?.photoURL) ?? null;
		if (cached) {
			return resolveProfilePhotoURL(cached, fallback);
		}
		return fallback;
	}

	function normalizeUserRecord(uid: string, data: any = {}) {
		const fallbackLabel = pickString(data?.email) ?? uid ?? 'Member';
		const displayName = pickString(data?.displayName) ?? pickString(data?.name) ?? fallbackLabel;
		const name = pickString(data?.name) ?? displayName;
		const photoURL = resolveProfilePhotoURL(data);
		return {
			...data,
			uid,
			displayName,
			name,
			photoURL
		};
	}

	async function loadThreadMeta() {
		if (!threadID || typeof window === 'undefined') return;
		metaLoading = true;
		try {
			const database = getDb();
			const snap = await getDoc(doc(database, 'dms', threadID));
			const payload: any = snap.data() ?? {};
			const parts: string[] = payload.participants ?? [];
			
			// Check if this is a group chat
			isGroupChat = payload.isGroup === true || parts.length > 2;
			groupName = payload.name ?? null;
			groupIconURL = payload.iconURL ?? null;
			groupDescription = payload.description ?? null;
			groupParticipants = parts;
			
			// Store full thread data for group info panel
			threadData = {
				id: threadID,
				key: payload.key ?? '',
				participants: parts,
				createdAt: payload.createdAt,
				updatedAt: payload.updatedAt,
				lastMessage: payload.lastMessage ?? null,
				lastSender: payload.lastSender ?? null,
				isGroup: payload.isGroup ?? false,
				name: payload.name ?? null,
				iconURL: payload.iconURL ?? null,
				createdBy: payload.createdBy ?? null,
				description: payload.description ?? null,
				pinnedMessageId: payload.pinnedMessageId ?? null,
				allowMemberInvites: payload.allowMemberInvites ?? true,
				mutedBy: payload.mutedBy ?? {},
				adminUids: payload.adminUids ?? []
			};

			if (isGroupChat) {
				// Load profiles for all other participants
				const otherUids = parts.filter(p => p !== me?.uid);
				const profilePromises = otherUids.map(async (uid) => {
					try {
						const profileDoc = await getDoc(doc(database, 'profiles', uid));
						if (profileDoc.exists()) {
							return { uid, profile: normalizeUserRecord(profileDoc.id, profileDoc.data()) };
						}
						return { uid, profile: normalizeUserRecord(uid, {}) };
					} catch {
						return { uid, profile: normalizeUserRecord(uid, {}) };
					}
				});
				
				const profiles = await Promise.all(profilePromises);
				const profileMap: Record<string, any> = {};
				for (const { uid, profile } of profiles) {
					profileMap[uid] = profile;
				}
				groupParticipantProfiles = profileMap;
				otherUid = null;
				otherProfile = null;
			} else {
				// Regular 1:1 DM
				otherUid = parts.find((p) => p !== me?.uid) ?? null;
				groupParticipantProfiles = {};

				if (otherUid) {
					const profileDoc = await getDoc(doc(database, 'profiles', otherUid));
					if (profileDoc.exists()) {
						otherProfile = normalizeUserRecord(profileDoc.id, profileDoc.data());
					} else {
						otherProfile = normalizeUserRecord(otherUid, {});
					}
				} else {
					otherProfile = null;
				}
			}
		} catch (err) {
			console.error('[DM thread] failed to load meta', err);
			otherProfile = null;
			isGroupChat = false;
			groupParticipantProfiles = {};
			threadData = null;
		} finally {
			metaLoading = false;
		}
	}

	// Handle group settings updates from the info panel
	function handleGroupUpdate(updates: Partial<DMThread>) {
		if (!threadData) return;
		threadData = { ...threadData, ...updates };
		if ('name' in updates) groupName = updates.name ?? null;
		if ('iconURL' in updates) groupIconURL = updates.iconURL ?? null;
		if ('description' in updates) groupDescription = updates.description ?? null;
	}

	// Handle leaving group
	function handleLeaveGroup() {
		syncInfoVisibility(false);
		goto('/dms');
	}

	run(() => {
		if (otherProfile?.uid) {
			const meta = {
				uid: otherProfile.uid,
				displayName:
					pickString(otherProfile?.displayName) ?? pickString(otherProfile?.name) ?? null,
				name: pickString(otherProfile?.name) ?? null,
				email: pickString(otherProfile?.email) ?? null
			};
			sidebarRef?.updatePartnerMeta(meta);
			sidebarRefMobile?.updatePartnerMeta(meta);
		}
	});

	run(() => {
		if (threadID) {
			loadThreadMeta();
		}
	});

	// Subscribe to presence updates for the other user
	$effect(() => {
		// Cleanup previous subscription
		presenceUnsub?.();
		presenceUnsub = null;
		otherPresence = 'offline';
		
		if (!otherUid || !browser) return;
		
		try {
			const database = getDb();
			const presenceRef = doc(database, 'profiles', otherUid, 'presence', 'status');
			presenceUnsub = onSnapshot(
				presenceRef,
				(snap) => {
					const data = snap.data();
					otherPresence = presenceFromSources([data]);
				},
				() => {
					// Error - assume offline
					otherPresence = 'offline';
				}
			);
		} catch (err) {
			console.warn('[DM] Failed to subscribe to presence', err);
			otherPresence = 'offline';
		}
		
		return () => {
			presenceUnsub?.();
			presenceUnsub = null;
		};
	});

	run(() => {
		if (threadID && threadID !== lastThreadID) {
			lastThreadID = threadID;
			syncInfoVisibility(false);
			pendingReply = null;
			messages = [];
			messagesLoading = true;
			scrollResumeSignal = Date.now();
		}
	});

	run(() => {
		if (resumeDmScroll && messages.length > 0) {
			scrollResumeSignal = Date.now();
			resumeDmScroll = false;
		}
	});

	run(() => {
		const next: Record<string, any> = {};
		if (me?.uid) {
			next[me.uid] = normalizeUserRecord(me.uid, {
				displayName: deriveMeDisplayName(),
				name: deriveMeDisplayName(),
				photoURL: deriveMePhotoURL(),
				email: pickString(me?.email) ?? undefined
			});
		}
		if (otherProfile?.uid) {
			next[otherProfile.uid] = normalizeUserRecord(otherProfile.uid, otherProfile);
		}
		for (const m of messages) {
			if (!m?.uid) continue;
			const existing = next[m.uid] ?? { uid: m.uid };
			const displayName = pickString(existing.displayName) ?? pickString(m.displayName);
			const name = pickString(existing.name) ?? pickString(m.displayName);
			const photoURL = pickString(existing.photoURL) ?? pickString(m.photoURL);
			next[m.uid] = {
				...existing,
				displayName: displayName ?? existing.displayName ?? m.uid ?? 'Member',
				name: name ?? existing.name ?? displayName ?? m.uid ?? 'Member',
				photoURL: photoURL ?? existing.photoURL ?? null
			};
		}
		messageUsers = next;
	});

	run(() => {
		const map = new Map<string, MentionOption>();
		const addCandidate = (uid: unknown, data: any) => {
			const clean = normalizeUid(uid);
			if (!clean) return;
			try {
				map.set(clean, buildMentionOption(clean, data ?? {}));
			} catch {
				// ignore malformed entries
			}
		};

		if (me?.uid) {
			addCandidate(me.uid, {
				displayName: deriveMeDisplayName(),
				photoURL: deriveMePhotoURL(),
				email: pickString(me?.email) ?? null
			});
		}
		
		// For group chats, add all participants
		if (isGroupChat && Object.keys(groupParticipantProfiles).length > 0) {
			Object.entries(groupParticipantProfiles).forEach(([uid, profile]) => {
				addCandidate(uid, profile);
			});
		} else if (otherProfile?.uid) {
			// For 1:1 chats, add the other person
			addCandidate(otherProfile.uid, otherProfile);
		}
		
		Object.values(messageUsers).forEach((entry) => addCandidate(entry?.uid, entry));

		mentionOptions = Array.from(map.values()).sort((a, b) =>
			a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
		);
	});

	function setupGestures(target: HTMLDivElement | null) {
		if (typeof window === 'undefined' || !target) return () => {};

		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				syncThreadsVisibility(false);
				syncInfoVisibility(false);
				pendingReply = null;
			}
		};

		const resetThreadsSwipe = () => {
			leftSwipeMode = null;
			leftSwipeActive = false;
			leftSwipeDelta = 0;
		};

		const resetInfoSwipe = () => {
			rightSwipeMode = null;
			rightSwipeActive = false;
			rightSwipeDelta = 0;
		};

		const cancelSwipe = () => {
			tracking = false;
			swipeTarget = null;
			resetThreadsSwipe();
			resetInfoSwipe();
		};

		const canHandle = () => useMobileShell();

		const onTouchStart = (e: TouchEvent) => {
			if (e.touches.length !== 1 || !canHandle()) return;
			const t = e.touches[0];
			const surfaceWidth = target.clientWidth || window.innerWidth;
			const nearEdge = t.clientX <= EDGE_DEAD_ZONE || t.clientX >= surfaceWidth - EDGE_DEAD_ZONE;
			if (nearEdge) {
				tracking = false;
				return;
			}
			startX = t.clientX;
			startY = t.clientY;
			leftSwipeWidth = Math.max(surfaceWidth, 1);
			rightSwipeWidth = leftSwipeWidth;
			swipeTarget = null;
			resetThreadsSwipe();
			resetInfoSwipe();

			if (showThreads) {
				swipeTarget = 'threads';
				leftSwipeMode = 'close';
			} else if (showInfo) {
				swipeTarget = 'info';
				rightSwipeMode = 'close';
			} else {
				swipeTarget = null;
			}
			tracking = canHandle();
		};

		const onTouchMove = (e: TouchEvent) => {
			if (!tracking || e.touches.length !== 1) return;
			if (!canHandle()) {
				cancelSwipe();
				return;
			}
			const t = e.touches[0];
			const dx = t.clientX - startX;
			const dy = t.clientY - startY;

			if (!swipeTarget) {
				if (Math.abs(dy) > Math.abs(dx) * 1.25) {
					cancelSwipe();
					return;
				}
				if (dx > 0) {
					swipeTarget = 'threads';
				} else if (dx < 0) {
					swipeTarget = 'info';
				}
			}

			if (swipeTarget === 'threads') {
				if (!leftSwipeActive) {
					if (Math.abs(dy) > Math.abs(dx) * 1.25) {
						cancelSwipe();
						return;
					}
					if (!leftSwipeMode) {
						if (!showThreads && dx > 0) {
							leftSwipeMode = 'open';
						} else if (showThreads && dx < 0) {
							leftSwipeMode = 'close';
						} else {
							cancelSwipe();
							return;
						}
					}
					leftSwipeActive = true;
				}
				leftSwipeDelta = dx;
			} else if (swipeTarget === 'info') {
				if (!rightSwipeActive) {
					if (Math.abs(dy) > Math.abs(dx) * 1.25) {
						cancelSwipe();
						return;
					}
					if (!rightSwipeMode) {
						if (!showInfo && dx < 0) {
							rightSwipeMode = 'open';
						} else if (showInfo && dx > 0) {
							rightSwipeMode = 'close';
						} else {
							cancelSwipe();
							return;
						}
					}
					rightSwipeActive = true;
				}
				rightSwipeDelta = dx;
			}
		};

		const onTouchEnd = () => {
			if (swipeTarget === 'threads' && leftSwipeMode && leftSwipeWidth > 0) {
				const traveled =
					leftSwipeMode === 'close' ? Math.max(0, -leftSwipeDelta) : Math.max(0, leftSwipeDelta);
				const ratio = traveled / leftSwipeWidth;
				if (traveled >= SWIPE_THRESHOLD || ratio >= SWIPE_RATIO) {
					syncThreadsVisibility(leftSwipeMode === 'open');
				}
			} else if (swipeTarget === 'info' && rightSwipeMode && rightSwipeWidth > 0) {
				const traveled =
					rightSwipeMode === 'close' ? Math.max(0, rightSwipeDelta) : Math.max(0, -rightSwipeDelta);
				const ratio = traveled / rightSwipeWidth;
				if (traveled >= SWIPE_THRESHOLD || ratio >= SWIPE_RATIO) {
					syncInfoVisibility(rightSwipeMode === 'open');
				}
			}
			cancelSwipe();
		};

		const mdMq = window.matchMedia('(min-width: 768px)');
		const lgMq = window.matchMedia('(min-width: 1024px)');

		const onMedia = () => {
			if (mdMq.matches) syncThreadsVisibility(false);
			if (lgMq.matches) syncInfoVisibility(false);
		};

		window.addEventListener('keydown', onKey);
		target.addEventListener('touchstart', onTouchStart, { passive: true });
		target.addEventListener('touchmove', onTouchMove, { passive: true });
		target.addEventListener('touchend', onTouchEnd, { passive: true });
		mdMq.addEventListener('change', onMedia);
		lgMq.addEventListener('change', onMedia);
		onMedia();

		return () => {
			window.removeEventListener('keydown', onKey);
			target.removeEventListener('touchstart', onTouchStart);
			target.removeEventListener('touchmove', onTouchMove);
			target.removeEventListener('touchend', onTouchEnd);
			mdMq.removeEventListener('change', onMedia);
			lgMq.removeEventListener('change', onMedia);
		};
	}

	onMount(() => {
		mounted = true;
		const cleanupGestures = setupGestures(swipeSurface);
		const overlayThreads = registerOverlayHandler(THREADS_OVERLAY_ID, () =>
			syncThreadsVisibility(false, { source: 'history' })
		);
		const overlayInfo = registerOverlayHandler(INFO_OVERLAY_ID, () =>
			syncInfoVisibility(false, { source: 'history' })
		);
		return () => {
			mounted = false;
			unsub?.();
			cleanupGestures?.();
			overlayThreads?.();
			overlayInfo?.();
			for (const uid in profileUnsubs) profileUnsubs[uid]?.();
		};
	});

	// After computing messageUsers map, ensure we subscribe to each author's profile
	run(() => {
		if (Object.keys(messageUsers).length > 0) {
			try {
				const database = getDb();
				for (const uid in messageUsers) ensureProfileSubscription(database, uid);
			} catch {}
		}
	});

	run(() => {
		if (mounted && threadID) {
			// Show cached messages instantly for better UX
			if (hasDMCache(threadID)) {
				const cached = getCachedDMMessages(threadID);
				if (cached.length > 0) {
					messages = cached.map((row: any) => toChatMessage(row.id, row));
					messagesLoading = false;
					scrollResumeSignal = Date.now();
				}
			} else {
				messagesLoading = true;
			}
			
			earliestLoadedDoc = null;
			unsub?.();
			unsub = streamDMMessages(threadID, async (msgs, firstDoc) => {
				messages = msgs.map((row: any) => toChatMessage(row.id, row));
				
				// Update DM cache with new messages
				if (msgs.length > 0) {
					updateDMCache(threadID, msgs as CachedMessage[], {
						hasOlderMessages: msgs.length >= 50
					});
				}
				
				// Only set earliestLoadedDoc on initial load (when it's null)
				if (!earliestLoadedDoc && firstDoc) {
					earliestLoadedDoc = firstDoc;
				}
				messagesLoading = false;
				if (messages.length > 0) {
					scrollResumeSignal = Date.now();
				}
				if (me?.uid) {
					const last = messages[messages.length - 1];
					const at = last?.createdAt ?? null;
					const lastId = last?.id ?? null;
					markThreadAsSeen({ at, lastMessageId: lastId });
				}
			});
		} else if (!threadID) {
			unsub?.();
			unsub = null;
			messages = [];
			earliestLoadedDoc = null;
			messagesLoading = false;
		}
	});

	async function handleLoadOlderMessages() {
		if (!threadID || !earliestLoadedDoc) return;
		try {
			const olderMsgs = await loadOlderDMMessages(threadID, earliestLoadedDoc);
			if (olderMsgs.length > 0) {
				const olderConverted = olderMsgs.map((row: any) => toChatMessage(row.id, row));
				messages = [...olderConverted, ...messages];
				
				// Update DM cache with older messages
				updateDMCache(threadID, olderMsgs as CachedMessage[], {
					hasOlderMessages: olderMsgs.length >= 50,
					prepend: true
				});
				
				// Update earliest doc reference for next pagination
				const db = getDb();
				const firstOlderId = olderMsgs[0]?.id;
				if (firstOlderId) {
					const docRef = doc(db, 'dms', threadID, 'messages', firstOlderId);
					const docSnap = await getDoc(docRef);
					if (docSnap.exists()) {
						earliestLoadedDoc = docSnap;
					}
				}
			}
		} catch (err) {
			console.error('[DM] Failed to load older messages:', err);
		}
	}

	async function handleSend(
		payload:
			| string
			| { text: string; mentions?: MentionSendRecord[]; replyTo?: ReplyReferenceInput | null }
	) {
		const raw = typeof payload === 'string' ? payload : (payload?.text ?? '');
		const trimmed = raw?.trim?.() ?? '';
		if (!trimmed || !me?.uid) return;
		const replyRef = consumeReply(typeof payload === 'object' ? (payload?.replyTo ?? null) : null);
		let mentionList: MentionSendRecord[] =
			typeof payload === 'object' && payload && Array.isArray(payload.mentions)
				? payload.mentions.filter(
						(item): item is MentionSendRecord => !!item?.uid && (!!item?.handle || !!item?.label)
					)
				: [];
		if (mentionList.length && mentionOptions.length) {
			const allowed = new Set(mentionOptions.map((entry) => entry.uid));
			mentionList = mentionList.filter((item) => allowed.has(item.uid));
		}
		try {
			await sendDMMessage(threadID, {
				type: 'text',
				text: trimmed,
				uid: me.uid,
				displayName: deriveMeDisplayName(),
				photoURL: deriveMePhotoURL(),
				mentions: mentionList.length ? mentionList : undefined,
				replyTo: replyRef ?? undefined
			});
			// Sound is played by ChatInput component
			markThreadAsSeen();
		} catch (err) {
			restoreReply(replyRef);
			console.error(err);
			alert(`Failed to send message: ${err}`);
		}
	}

	async function handleSendGif(
		detail: string | { url: string; replyTo?: ReplyReferenceInput | null }
	) {
		const trimmed = pickString(typeof detail === 'string' ? detail : detail?.url);
		if (!trimmed || !me?.uid) return;
		const replyRef = consumeReply(typeof detail === 'object' ? (detail?.replyTo ?? null) : null);
		try {
			await sendDMMessage(threadID, {
				type: 'gif',
				url: trimmed,
				uid: me.uid,
				displayName: deriveMeDisplayName(),
				photoURL: deriveMePhotoURL(),
				replyTo: replyRef ?? undefined
			});
			// Sound is played by ChatInput component
			markThreadAsSeen();
		} catch (err) {
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
		if (!selection.length || !me?.uid) return;
		const replyRef = consumeReply(request?.replyTo ?? null);
		let replyUsed = false;
		for (const file of selection) {
			const pending = registerPendingUpload(file);
			try {
				const uploaded = await uploadDMFile({
					threadId: threadID,
					uid: me.uid,
					file,
					onProgress: (progress) => pending.update(progress ?? 0)
				});
				await sendDMMessage(threadID, {
					type: 'file',
					file: {
						name: file.name || uploaded.name,
						url: uploaded.url,
						size: file.size ?? uploaded.size,
						contentType: file.type || uploaded.contentType,
						storagePath: uploaded.storagePath
					},
					uid: me.uid,
					displayName: deriveMeDisplayName(),
					photoURL: deriveMePhotoURL(),
					replyTo: !replyUsed && replyRef ? replyRef : undefined
				});
				pending.finish(true);
				if (replyRef && !replyUsed) {
					replyUsed = true;
				}
				markThreadAsSeen();
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
		if (!me?.uid) return;
		const replyRef = consumeReply(poll?.replyTo ?? null);
		try {
			await sendDMMessage(threadID, {
				type: 'poll',
				poll: {
					question: poll.question,
					options: poll.options
				},
				uid: me.uid,
				displayName: deriveMeDisplayName(),
				photoURL: deriveMePhotoURL(),
				replyTo: replyRef ?? undefined
			});
			markThreadAsSeen();
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
		if (!me?.uid) return;
		const replyRef = consumeReply(form?.replyTo ?? null);
		try {
			await sendDMMessage(threadID, {
				type: 'form',
				form: {
					title: form.title,
					questions: form.questions
				},
				uid: me.uid,
				displayName: deriveMeDisplayName(),
				photoURL: deriveMePhotoURL(),
				replyTo: replyRef ?? undefined
			});
			markThreadAsSeen();
		} catch (err) {
			restoreReply(replyRef);
			console.error(err);
			alert(`Failed to share form: ${err}`);
		}
	}

	async function handleVote(event: CustomEvent<{ messageId: string; optionIndex: number }>) {
		if (!me?.uid) return;
		const { messageId, optionIndex } = event.detail ?? {};
		if (!messageId || optionIndex === undefined) return;
		try {
			await voteOnDMPoll(threadID, messageId, me.uid, optionIndex);
		} catch (err) {
			console.error(err);
			alert(`Failed to record vote: ${err}`);
		}
	}

	async function handleFormSubmit(event: CustomEvent<{ messageId: string; answers: string[] }>) {
		if (!me?.uid) return;
		const { messageId, answers } = event.detail ?? {};
		if (!messageId || !answers) return;
		try {
			await submitDMForm(threadID, messageId, me.uid, answers);
		} catch (err) {
			console.error(err);
			alert(`Failed to submit form: ${err}`);
		}
	}

	async function handleReaction(event: CustomEvent<{ messageId: string; emoji: string }>) {
		if (!me?.uid) return;
		const { messageId, emoji } = event.detail ?? {};
		if (!messageId || !emoji) return;
		try {
			await toggleDMReaction(threadID, messageId, me.uid, emoji);
		} catch (err) {
			console.error(err);
			alert(`Failed to toggle reaction: ${err}`);
		}
	}

	function handleReplyRequest(event: CustomEvent<{ message: any }>) {
		const target = event.detail?.message;
		const ref = buildReplyReference(target);
		if (ref) pendingReply = ref;
	}

	function onSend(e: CustomEvent<any>) {
		handleSend(e.detail ?? '');
	}

	function handleComposerFocus() {
		composerFocusSignal += 1;
	}

	run(() => {
		otherMessageUser = otherUid ? (messageUsers[otherUid] ?? null) : null;
	});

	run(() => {
		if (!me?.uid) {
			aiAssistEnabled = true;
			return;
		}
		const profile = messageUsers[me.uid] ?? null;
		const prefs = (profile?.settings ?? {}) as any;
		aiAssistEnabled = prefs.aiAssist?.enabled !== false;
	});

	run(() => {
		const targetId = pendingReply?.messageId ?? null;
		if (targetId) {
			const source = messages.find((row) => row?.id === targetId);
			replySourceMessage = source ?? null;
		} else {
			replySourceMessage = null;
		}
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
		if (me?.uid && latestAuthored.uid === me.uid) {
			latestInboundMessage = null;
			return;
		}
		latestInboundMessage = latestAuthored;
	});

	run(() => {
		aiConversationContext = messages.slice(-10);
	});

	// Compute group participant names
	let groupParticipantNames = $derived.by(() => {
		if (!isGroupChat) return '';
		const otherUids = groupParticipants.filter(uid => uid !== me?.uid);
		const names = otherUids.slice(0, 3).map(uid => {
			const profile = groupParticipantProfiles[uid];
			return profile?.displayName || profile?.name || profile?.email || uid.slice(0, 8);
		});
		const remaining = otherUids.length - 3;
		if (remaining > 0) {
			return `${names.join(', ')} +${remaining}`;
		}
		return names.join(', ');
	});

	let displayName = $derived.by(() => {
		if (isGroupChat) {
			return groupName || groupParticipantNames || 'Group Chat';
		}
		return (
			pickString(otherProfile?.displayName) ??
			pickString(otherProfile?.name) ??
			pickString(otherMessageUser?.displayName) ??
			pickString(otherMessageUser?.name) ??
			pickString(otherProfile?.email) ??
			pickString(otherMessageUser?.email) ??
			(otherProfile || otherMessageUser ? (otherUid ?? 'Member') : 'Direct Message')
		);
	});
</script>

<div class="flex flex-1 h-full overflow-hidden panel-muted gesture-pad-x dm-page" bind:this={swipeSurface}>
	<div class="hidden md:flex md:w-80 h-full flex-col border-r border-subtle panel-muted">
		<DMsSidebar
			bind:this={sidebarRef}
			activeThreadId={threadID}
			on:select={handleSidebarSelect}
			on:delete={(e) => {
				if (e.detail === threadID) {
					syncInfoVisibility(false);
					void goto('/dms');
				}
			}}
		/>
	</div>

	<div class="flex flex-1 flex-col panel overflow-hidden">
		<header
			class="dm-header px-3 sm:px-4 flex items-center justify-between border-b border-subtle/50 panel"
		>
			<div class="flex items-center gap-2.5 min-w-0">
				<button
					class="dm-header__menu-btn md:hidden"
					aria-label="Open conversations"
					onclick={() => syncThreadsVisibility(true)}
				>
					<i class="bx bx-chevron-left text-xl"></i>
				</button>
				<button
					class="dm-header__profile-btn"
					type="button"
					aria-label={isGroupChat ? 'View group info' : 'View participant profile'}
					onclick={() => syncInfoVisibility(true)}
				>
					<div class="dm-header__avatar">
						{#if isGroupChat}
							{#if groupIconURL}
								<img
									src={groupIconURL}
									alt="Group icon"
									class="dm-header__group-icon-img"
								/>
							{:else}
								<div class="dm-header__group-icon">
									<i class="bx bx-group"></i>
								</div>
							{/if}
						{:else}
							<Avatar
								user={otherProfile}
								name={displayName}
								size="sm"
								showPresence={true}
								presence={otherPresence}
							/>
						{/if}
					</div>
					<div class="dm-header__info">
						<span class="dm-header__name">{displayName}</span>
						{#if isGroupChat}
							<span class="dm-header__member-count">{groupParticipants.length} members</span>
						{/if}
					</div>
					<i class="bx bx-chevron-right dm-header__chevron"></i>
				</button>
			</div>
		</header>

		<main class="flex-1 overflow-hidden panel-muted">
			<div class="h-full flex flex-col">
				<div
					class="message-scroll-region relative flex-1 overflow-hidden p-3 sm:p-4 touch-pan-y"
					style={scrollRegionStyle}
				>
					{#if messagesLoading}
						<div
							class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/40 backdrop-blur-sm text-soft"
						>
							<div
								class="h-10 w-10 rounded-full border-2 border-white/30 border-t-white animate-spin"
								aria-hidden="true"
							></div>
							<div class="text-sm font-medium tracking-wide uppercase">Loading messages</div>
							<span class="sr-only" aria-live="polite">Loading messages...</span>
						</div>
					{/if}
					{#key messageScrollKey}
						<MessageList
							{messages}
							users={messageUsers}
							currentUserId={me?.uid ?? null}
							replyTargetId={pendingReply?.messageId ?? null}
							{pendingUploads}
							scrollToBottomSignal={combinedScrollSignal}
							dmThreadId={threadID}
							on:vote={handleVote}
							on:submitForm={handleFormSubmit}
							on:react={handleReaction}
							on:reply={handleReplyRequest}
							on:loadMore={handleLoadOlderMessages}
						/>
					{/key}
				</div>
			</div>
		</main>

		<div class="chat-input-region shrink-0 border-t border-subtle panel" bind:this={composerEl}>
			<ChatInput
				placeholder={`Message`}
				{mentionOptions}
				replyTarget={pendingReply}
				replySource={replySourceMessage}
				defaultSuggestionSource={latestInboundMessage}
				conversationContext={aiConversationContext}
				{aiAssistEnabled}
				threadLabel={displayName}
				on:send={onSend}
				on:submit={onSend}
				on:sendGif={(e: CustomEvent<any>) => handleSendGif(e.detail)}
				on:upload={(e: CustomEvent<any>) => handleUploadFiles(e.detail)}
				on:createPoll={(e: CustomEvent<any>) => handleCreatePoll(e.detail)}
				on:createForm={(e: CustomEvent<any>) => handleCreateForm(e.detail)}
				on:cancelReply={() => (pendingReply = null)}
				on:focusInput={handleComposerFocus}
			/>
		</div>
	</div>

	{#if showInfo}
		<aside class="hidden lg:flex lg:w-72 panel border-l border-subtle/50 overflow-y-auto">
			{#if metaLoading}
				<div class="p-5 w-full">
					<div class="animate-pulse text-white/50 text-sm">Loading...</div>
				</div>
			{:else if isGroupChat && threadData}
				<GroupChatInfoPanel
					thread={threadData}
					currentUid={me?.uid ?? ''}
					participantProfiles={groupParticipantProfiles}
					onClose={() => syncInfoVisibility(false)}
					on:update={(e) => handleGroupUpdate(e.detail)}
					on:leave={handleLeaveGroup}
				/>
			{:else if otherProfile}
				<div class="p-5 w-full">
					<div class="flex items-center justify-between mb-5">
						<div class="text-xs font-medium uppercase tracking-wider text-white/50">Profile</div>
						<button
							class="w-7 h-7 grid place-items-center rounded-md text-white/60 hover:text-white hover:bg-white/10 transition"
							type="button"
							aria-label="Close profile panel"
							onclick={() => syncInfoVisibility(false)}
						>
							<i class="bx bx-x text-lg"></i>
						</button>
					</div>
					<div class="flex flex-col items-center gap-3 text-center py-4">
						<Avatar
							user={otherProfile}
							name={displayName}
							size="xl"
							showPresence={true}
							presence={otherPresence}
						/>
						<div class="mt-1">
							<div class="text-base font-semibold">{displayName}</div>
							{#if otherProfile.email}<div class="text-xs text-white/50 mt-0.5">
									{otherProfile.email}
								</div>{/if}
						</div>
					</div>

					<div class="mt-4 pt-4 border-t border-white/10 space-y-3 text-sm text-white/60">
						{#if otherProfile.bio}
							<p>{otherProfile.bio}</p>
						{/if}
						{#if otherProfile.email}
							<a
								class="inline-flex items-center gap-2 text-white/70 hover:text-white transition text-sm"
								href={`mailto:${otherProfile.email}`}
							>
								<i class="bx bx-envelope"></i>
								<span>Send email</span>
							</a>
						{/if}
					</div>
				</div>
			{:else}
				<div class="p-5 w-full">
					<div class="text-white/50">Profile unavailable.</div>
				</div>
			{/if}
		</aside>
	{/if}
</div>

<!-- Mobile overlays -->
{#if showThreads || leftSwipeActive}
	<div
		class="mobile-panel md:hidden fixed inset-0 z-40 flex flex-col transition-transform will-change-transform touch-pan-y"
		class:mobile-panel--dragging={leftSwipeActive}
		style:transform={threadsTransform}
		style:transition-duration={`${PANEL_DURATION}ms`}
		style:transitionTimingFunction={PANEL_EASING}
		style:pointer-events={showThreads ? 'auto' : 'none'}
		aria-label="Conversations"
	>
		<div class="mobile-panel__body">
			<div class="mobile-panel__list">
				<div class="mobile-panel__header md:hidden">
					<div class="mobile-panel__title">Conversations</div>
				</div>
				<div class="flex-1 overflow-y-auto touch-pan-y">
					<DMsSidebar
						bind:this={sidebarRefMobile}
						activeThreadId={threadID}
						showPersonalSection={false}
						on:select={handleSidebarSelect}
						on:delete={(e) => {
							syncThreadsVisibility(false);
							syncInfoVisibility(false);
							if (e.detail === threadID) void goto('/dms');
						}}
					/>
				</div>
			</div>
		</div>
	</div>
{/if}

{#if showInfo || rightSwipeActive}
	<div
		class="mobile-panel md:hidden fixed inset-0 z-40 flex flex-col transition-transform will-change-transform touch-pan-y"
		class:mobile-panel--dragging={rightSwipeActive}
		style:transform={infoTransform}
		style:transition-duration={`${PANEL_DURATION}ms`}
		style:transitionTimingFunction={PANEL_EASING}
		style:pointer-events={showInfo ? 'auto' : 'none'}
		aria-label={isGroupChat ? 'Group Info' : 'Profile'}
	>
		{#if !isGroupChat}
			<div class="mobile-panel__header md:hidden">
				<button
					class="mobile-panel__close -ml-2"
					aria-label="Close"
					type="button"
					onclick={() => syncInfoVisibility(false)}
				>
					<i class="bx bx-chevron-left text-xl"></i>
				</button>
				<div class="mobile-panel__title">Profile</div>
			</div>
		{/if}

		<div class="flex-1 overflow-y-auto touch-pan-y" class:p-5={!isGroupChat}>
			{#if metaLoading}
				<div class="animate-pulse text-soft text-sm p-5">Loading...</div>
			{:else if isGroupChat && threadData}
				<GroupChatInfoPanel
					thread={threadData}
					currentUid={me?.uid ?? ''}
					participantProfiles={groupParticipantProfiles}
					onClose={() => syncInfoVisibility(false)}
					on:update={(e) => handleGroupUpdate(e.detail)}
					on:leave={handleLeaveGroup}
				/>
			{:else if otherProfile}
				<div class="flex flex-col items-center gap-3 text-center py-4">
					<Avatar
						user={otherProfile}
						name={displayName}
						size="2xl"
						showPresence={true}
						presence={otherPresence}
					/>
					<div class="mt-1">
						<div class="text-lg font-semibold">{displayName}</div>
						{#if otherProfile.email}<div class="text-sm text-white/50 mt-0.5">
								{otherProfile.email}
							</div>{/if}
					</div>
				</div>

				<div class="mt-4 pt-4 border-t border-white/10 space-y-3 text-sm text-white/60">
					{#if otherProfile.bio}
						<p>{otherProfile.bio}</p>
					{/if}
					{#if otherProfile.email}
						<a
							class="inline-flex items-center gap-2 text-white/70 hover:text-white transition text-sm"
							href={`mailto:${otherProfile.email}`}
						>
							<i class="bx bx-envelope"></i>
							<span>Send email</span>
						</a>
					{/if}
				</div>
			{:else}
				<div class="text-white/50 text-sm p-5">Profile unavailable.</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* DM header - minimalistic design */
	.dm-header {
		height: 3.25rem;
		background: var(--color-panel);
	}

	.dm-header__menu-btn {
		width: 2rem;
		height: 2rem;
		display: grid;
		place-items: center;
		border-radius: 0.5rem;
		color: var(--color-text-secondary);
		transition:
			background 150ms ease,
			color 150ms ease;
	}

	.dm-header__menu-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--color-text-primary);
	}

	.dm-header__profile-btn {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.375rem 0.5rem 0.375rem 0.25rem;
		border-radius: 0.375rem;
		background: transparent;
		border: none;
		color: inherit;
		text-align: left;
		transition: background 150ms ease;
	}

	.dm-header__profile-btn:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	/* More rounded on mobile for touch targets */
	@media (max-width: 767px) {
		.dm-header__profile-btn {
			border-radius: 0.625rem;
		}
	}

	.dm-header__profile-btn:focus-visible {
		outline: 2px solid rgba(255, 255, 255, 0.3);
		outline-offset: 2px;
	}

	.dm-header__avatar {
		position: relative;
		flex-shrink: 0;
		--presence-dot-border: var(--color-panel);
	}

	.dm-header__info {
		min-width: 0;
		flex: 1;
	}

	.dm-header__name {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text-primary);
		line-height: 1.3;
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dm-header__member-count {
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
		display: block;
		line-height: 1.2;
	}

	.dm-header__group-icon {
		width: 2rem;
		height: 2rem;
		border-radius: 0.5rem;
		background: linear-gradient(135deg, var(--color-accent, #5865f2) 0%, #7c3aed 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		font-size: 1rem;
		flex-shrink: 0;
	}

	.dm-header__group-icon-img {
		width: 2rem;
		height: 2rem;
		border-radius: 0.5rem;
		object-fit: cover;
		flex-shrink: 0;
	}

	.dm-header__chevron {
		color: var(--color-text-tertiary);
		font-size: 1.125rem;
		flex-shrink: 0;
	}

	@media (max-width: 767px) {
		.dm-header {
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			z-index: 10;
			height: calc(3.25rem + env(safe-area-inset-top, 0px));
			padding-top: env(safe-area-inset-top, 0px);
			padding-left: calc(0.75rem + env(safe-area-inset-left, 0px));
			padding-right: calc(0.75rem + env(safe-area-inset-right, 0px));
			background: var(--color-panel);
		}

		.dm-header + main {
			margin-top: calc(3.25rem + env(safe-area-inset-top, 0px));
		}
	}

	:global(.mobile-panel__body) {
		flex: 1;
		display: flex;
		min-height: 0;
		background: var(--color-panel);
		border-top: 1px solid var(--color-border-subtle);
	}

	:global(.mobile-panel__list) {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	/* Desktop: ensure chat input is below image preview overlay (z-index 9999) */
	@media (min-width: 768px) {
		.dm-page .chat-input-region {
			position: relative;
			z-index: 10;
		}

		/* Add extra bottom padding for DesktopUserBar on DM pages */
		.dm-page .message-scroll-region {
			padding-bottom: calc(var(--desktop-user-bar-height, 52px) + 2.5rem);
		}
	}

	@media (max-width: 767px) {
		.dm-page .chat-input-region {
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			z-index: 10;
			padding: 0.375rem 0.5rem env(safe-area-inset-bottom, 0px) 0.5rem;
		}

		.dm-page .message-scroll-region {
			padding-bottom: calc(
				var(--chat-input-height, 4.5rem) + env(safe-area-inset-bottom, 0px) +
					var(--chat-keyboard-offset, 0px) + 0.5rem
			);
		}
	}
</style>
