<script lang="ts">
	import { run } from 'svelte/legacy';

	import { createEventDispatcher, onMount, tick, untrack } from 'svelte';
	import type { PendingUploadPreview } from './types';
	import EmojiPicker from './EmojiPicker.svelte';
	import Avatar from '$lib/components/app/Avatar.svelte';
	import { formatBytes, looksLikeImage } from '$lib/utils/fileType';
	import { SPECIAL_MENTIONS } from '$lib/data/specialMentions';
	import { SPECIAL_MENTION_IDS } from '$lib/data/specialMentions';
	import { createTicketFromMessage } from '$lib/firestore/ticketAi';

	const dispatch = createEventDispatcher();

	type MentionView = {
		uid: string;
		handle?: string | null;
		label?: string | null;
		color?: string | null;
		kind?: 'member' | 'role' | 'special';
	};

	type MentionSegment = { type: 'mention'; value: string; data?: MentionView };
	type TextSegment = { type: 'text'; value: string };
	type LinkChunk = { type: 'text'; value: string } | { type: 'link'; value: string; href: string };
	type ReplyPreview = {
		messageId: string;
		authorId?: string | null;
		authorName?: string | null;
		preview?: string | null;
		text?: string | null;
		type?: string | null;
		parent?: ReplyPreview | null;
	};

	type BaseChatMessage = {
		id: string;
		uid?: string;
		createdAt?: any;
		displayName?: string;
		mentions?: MentionView[];
		replyTo?: ReplyPreview | null;
	};

	type ChatMessage =
		| (BaseChatMessage & { text: string; type?: 'text' })
		| (BaseChatMessage & { url: string; type: 'gif' })
		| (BaseChatMessage & {
				file: { name: string; size?: number; url: string; contentType?: string };
				type: 'file';
		  })
		| (BaseChatMessage & {
				poll: { question: string; options: string[]; votes?: Record<number, number> };
				type: 'poll';
		  })
		| (BaseChatMessage & { form: { title: string; questions: string[] }; type: 'form' })
		| (BaseChatMessage & { text?: string; type: 'system' });

	type ImagePreviewDetails = {
		url: string;
		name?: string | null;
		contentType?: string | null;
		sizeLabel?: string | null;
		author?: string | null;
		timestamp?: string | null;
		downloadUrl?: string | null;
	};

	interface Props {
		messages?: ChatMessage[];
		users?: Record<string, any>;
		currentUserId?: string | null;
		scrollToBottomSignal?: number;
		pendingUploads?: PendingUploadPreview[];
		threadStats?: Record<
			string,
			{
				count?: number;
				lastAt?: number;
				threadId?: string;
				status?: string;
				archived?: boolean;
				name?: string | null;
				preview?: string | null;
				unread?: boolean;
			}
		>;
		hideReplyPreview?: boolean;
		replyTargetId?: string | null;
		scrollToMessageId?: string | null;
		/** Whether the current user is a Ticket AI staff member */
		isTicketAiStaff?: boolean;
		/** Server ID for ticket creation */
		serverId?: string | null;
		/** Channel ID for ticket creation */
		channelId?: string | null;
		/** Thread ID for ticket creation (if in a thread) */
		threadId?: string | null;
		/** Set of message IDs that already have tickets */
		ticketedMessageIds?: Set<string>;
	}

	let {
		messages = [],
		users = {},
		currentUserId = null,
		scrollToBottomSignal = 0,
		pendingUploads = [],
		threadStats = {},
		hideReplyPreview = false,
		replyTargetId = null,
		scrollToMessageId = null,
		isTicketAiStaff = false,
		serverId = null,
		channelId = null,
		threadId = null,
		ticketedMessageIds = new Set<string>()
	}: Props = $props();

	let scroller = $state<HTMLDivElement | null>(null);
	let previewAttachment = $state<ImagePreviewDetails | null>(null);
	let previewOverlayEl = $state<HTMLDivElement | null>(null);
	let isRequestingMore = false;
	let lastScrollSignal = $state(0);
	let shouldStickToBottom = true;
	let pendingPrependAdjustment: { height: number; top: number } | null = null;
	let lastFirstMessageId: string | null = null;
	let highlightedMessageId = $state<string | null>(null);
	let lastScrollToMessageId: string | null = null;
	let creatingTicketForMessageId = $state<string | null>(null);

	// Handle creating a ticket from a message
	async function handleCreateTicket(messageId: string) {
		if (!serverId || !channelId || creatingTicketForMessageId) return;
		
		creatingTicketForMessageId = messageId;
		try {
			const result = await createTicketFromMessage({
				serverId,
				channelId,
				messageId,
				threadId
			});
			
			if (result.ok) {
				dispatch('ticketCreated', { messageId, ticketId: result.ticketId });
			} else {
				console.error('[MessageList] Failed to create ticket:', result.error);
				dispatch('ticketError', { messageId, error: result.error });
			}
		} catch (err) {
			console.error('[MessageList] Error creating ticket:', err);
			dispatch('ticketError', { messageId, error: 'Failed to create ticket' });
		} finally {
			creatingTicketForMessageId = null;
		}
	}

	const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
		scroller?.scrollTo({ top: scroller.scrollHeight, behavior });
	};

	const scrollToMessage = (messageId: string) => {
		if (!scroller) return;
		const messageEl = scroller.querySelector(`[data-message-id="${messageId}"]`);
		if (messageEl) {
			messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
			highlightedMessageId = messageId;
			// Clear highlight after animation
			setTimeout(() => {
				highlightedMessageId = null;
			}, 2000);
		}
	};

	// Re-scroll when images load to ensure full content is visible
	const handleImageLoad = () => {
		if (shouldStickToBottom && scroller) {
			tick().then(() => scrollToBottom('auto'));
		}
	};

	onMount(() => {
		tick().then(() => scrollToBottom('auto'));
	});

	run(() => {
		if (previewAttachment && previewOverlayEl) {
			tick().then(() => previewOverlayEl?.focus());
		}
	});

	const SPECIAL_MENTION_LOOKUP = new Map(
		SPECIAL_MENTIONS.map((entry) => [`@${entry.handle.toLowerCase()}`, entry])
	);

	function formatTime(ts: any) {
		try {
			const value =
				typeof ts === 'number'
					? new Date(ts)
					: ts?.toDate
						? ts.toDate()
						: ts instanceof Date
							? ts
							: null;
			return value ? value.toLocaleString() : '';
		} catch {
			return '';
		}
	}

	function displayNameForUid(uid: string | null | undefined) {
		if (!uid) return '';
		const fromMap = users[uid] ?? {};
		const resolved = fromMap.displayName || fromMap.name || fromMap.email;
		if (resolved) return resolved;
		if (uid === currentUserId) return 'You';
		return fromMap.username || fromMap.handle || uid || '';
	}

	function nameFor(m: any) {
		const uid = m.uid ?? 'unknown';
		const fromMap = users[uid] ?? {};
		const resolved = m.displayName || fromMap.displayName || fromMap.name || fromMap.email;
		if (resolved) return resolved;
		if (uid === currentUserId) return 'You';
		return fromMap.username || fromMap.handle || uid || 'Unknown';
	}
	
	function avatarUrlFor(m: any) {
		const uid = m.uid ?? 'unknown';
		const user = users[uid];
		const author = m.author ?? {};

		// Try all possible photo fields in priority order
		// Check message fields, nested author object, and user profile
		const candidates = [
			m.photoURL,
			m.avatarUrl,
			m.avatar,
			author?.photoURL,
			author?.avatarUrl,
			author?.avatar,
			user?.avatar,
			user?.avatarUrl,
			user?.avatarURL,
			user?.customPhotoURL,
			user?.authPhotoURL, // Live auth photo from Google
			user?.photoURL,
			user?.photoUrl,
			user?.photo,
			user?.picture,
			user?.cachedPhotoURL // Cached as last resort
		];

		for (const url of candidates) {
			if (
				url &&
				typeof url === 'string' &&
				url.trim() &&
				!['undefined', 'null', 'none', '/default-avatar.svg'].includes(url.toLowerCase())
			) {
				// Skip unauthenticated Firebase Storage URLs
				if (url.includes('storage.googleapis.com/') && !url.includes('token=')) {
					continue;
				}
				return url;
			}
		}

		// Return null - Avatar component will handle fallback
		return null;
	}

	function isMine(m: any) {
		if (!currentUserId) return false;
		const uid = m?.uid ?? m?.authorId ?? m?.userId ?? null;
		return uid === currentUserId;
	}

	function initialsFor(name: string) {
		if (!name) return '?';
		const parts = name.trim().split(/\s+/).slice(0, 2);
		return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || name[0]?.toUpperCase() || '?';
	}

	const canonicalMentionToken = (value: string) =>
		(value ?? '')
			.replace(/^@/, '')
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '');

	function mentionSegments(
		text: string,
		mentions?: MentionView[]
	): Array<MentionSegment | TextSegment> {
		const value = typeof text === 'string' ? text : '';
		if (!value) return [{ type: 'text', value: '' }];
		const mentionList = buildMentionList(value, mentions);
		if (!mentionList.length) return [{ type: 'text', value }];

		// Build patterns to search for, sorted by length (longest first to avoid partial matches)
		const patterns: Array<{ pattern: string; mention: MentionView }> = [];
		
		mentionList.forEach((mention) => {
			if (mention.label) {
				// Full name with @
				patterns.push({ pattern: `@${mention.label}`, mention });
				// Without spaces
				patterns.push({ pattern: `@${mention.label.replace(/\s+/g, '')}`, mention });
				// First name only
				const firstName = mention.label.split(/\s+/).filter(Boolean)[0];
				if (firstName && firstName !== mention.label) {
					patterns.push({ pattern: `@${firstName}`, mention });
				}
			}
			if (mention.handle) {
				const handle = mention.handle.startsWith('@') ? mention.handle : `@${mention.handle}`;
				patterns.push({ pattern: handle, mention });
			}
		});

		// Add special mentions
		SPECIAL_MENTIONS.forEach((entry) => {
			patterns.push({
				pattern: `@${entry.handle}`,
				mention: {
					uid: entry.uid,
					handle: `@${entry.handle}`,
					label: entry.label,
					color: entry.color ?? null,
					kind: 'special'
				}
			});
		});

		// Sort by pattern length descending (match longer patterns first)
		patterns.sort((a, b) => b.pattern.length - a.pattern.length);

		// Find all mention occurrences in the text
		const occurrences: Array<{ start: number; end: number; mention: MentionView; pattern: string }> = [];
		const valueLower = value.toLowerCase();
		
		for (const { pattern, mention } of patterns) {
			const patternLower = pattern.toLowerCase();
			let searchStart = 0;
			while (true) {
				const idx = valueLower.indexOf(patternLower, searchStart);
				if (idx === -1) break;
				
				// Check if this position is already covered by a longer match
				const alreadyCovered = occurrences.some(
					(o) => idx >= o.start && idx < o.end
				);
				
				if (!alreadyCovered) {
					occurrences.push({
						start: idx,
						end: idx + pattern.length,
						mention,
						pattern: value.slice(idx, idx + pattern.length) // preserve original case
					});
				}
				searchStart = idx + 1;
			}
		}

		// Sort occurrences by position
		occurrences.sort((a, b) => a.start - b.start);

		// Build segments
		const segments: Array<MentionSegment | TextSegment> = [];
		let lastIndex = 0;

		for (const occ of occurrences) {
			if (occ.start > lastIndex) {
				segments.push({ type: 'text', value: value.slice(lastIndex, occ.start) });
			}
			const display = occ.mention.label ? `@${occ.mention.label}` : occ.pattern;
			segments.push({ type: 'mention', value: display, data: occ.mention });
			lastIndex = occ.end;
		}

		if (lastIndex < value.length) {
			segments.push({ type: 'text', value: value.slice(lastIndex) });
		}

		return segments.length ? segments : [{ type: 'text', value }];
	}

	function buildMentionList(value: string, mentions?: MentionView[]) {
		const list = Array.isArray(mentions) ? [...mentions] : [];
		const existingIds = new Set(list.map((entry) => entry.uid));
		const normalized = value.toLowerCase();
		SPECIAL_MENTIONS.forEach((entry) => {
			if (existingIds.has(entry.uid)) return;
			const token = `@${entry.handle.toLowerCase()}`;
			if (!normalized.includes(token)) return;
			list.push({
				uid: entry.uid,
				handle: `@${entry.handle}`,
				label: entry.label,
				color: entry.color ?? null,
				kind: 'special'
			});
		});
		return list;
	}

	const mentionHighlightClass = (mention?: MentionView) => {
		if (!mention?.uid) return '';
		if (mention.uid === SPECIAL_MENTION_IDS.EVERYONE) {
			return 'chat-mention--special chat-mention--special-everyone';
		}
		if (mention.uid === SPECIAL_MENTION_IDS.HERE) {
			return 'chat-mention--special chat-mention--special-here';
		}
		if (mention.kind === 'special') {
			return 'chat-mention--special';
		}
		return '';
	};

	const resolveDate = (value: any): Date | null => {
		if (!value) return null;
		if (value instanceof Date) return value;
		if (typeof value === 'number') return new Date(value);
		if (typeof value?.toDate === 'function') {
			try {
				return value.toDate();
			} catch {
				return null;
			}
		}
		return null;
	};

	function formatThreadTimestamp(value: any): string {
		try {
			const date = resolveDate(value);
			if (!date) return '';
			return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
		} catch {
			return '';
		}
	}

	function openImagePreview(
		file: { url: string; name?: string | null; contentType?: string | null; size?: number },
		message: ChatMessage
	) {
		if (!file?.url) return;
		const sizeLabel = typeof file.size === 'number' ? formatBytes(file.size) : null;
		previewAttachment = {
			url: file.url,
			name: file.name ?? 'Image attachment',
			contentType: file.contentType ?? null,
			sizeLabel,
			author: nameFor(message),
			timestamp: message?.createdAt ? formatTime(message.createdAt) : null,
			downloadUrl: file.url
		};
	}

	function closePreview() {
		previewAttachment = null;
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && previewAttachment) {
			event.preventDefault();
			closePreview();
		}
	}

	function isMentionSegment(segment: MentionSegment | TextSegment): segment is MentionSegment {
		return segment.type === 'mention';
	}

	function linkifyText(value: string): LinkChunk[] {
		if (!value) return [{ type: 'text', value: '' }];
		const chunks: LinkChunk[] = [];
		let lastIndex = 0;
		URL_REGEX.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = URL_REGEX.exec(value))) {
			const start = match.index;
			if (start > lastIndex) {
				chunks.push({ type: 'text', value: value.slice(lastIndex, start) });
			}
			let raw = match[0];
			let trailing = '';
			while (raw.length && /[)\],.!?:;]+$/.test(raw)) {
				trailing = raw.slice(-1) + trailing;
				raw = raw.slice(0, -1);
			}
			if (raw) {
				const href = raw.startsWith('http') ? raw : `https://${raw}`;
				chunks.push({ type: 'link', value: raw, href });
			}
			if (trailing) {
				chunks.push({ type: 'text', value: trailing });
			}
			lastIndex = URL_REGEX.lastIndex;
		}
		if (lastIndex < value.length) {
			chunks.push({ type: 'text', value: value.slice(lastIndex) });
		}
		return chunks;
	}

	const URL_REGEX = /((https?:\/\/|www\.)[^\s<]+)/gi;

	const PREVIEW_LIMIT = 140;

	function clipPreview(value: string | null | undefined, limit = PREVIEW_LIMIT) {
		if (!value) return '';
		return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
	}

	function flattenReplyChain(reply: ReplyPreview | null | undefined) {
		// Only show the immediate parent reply, not the entire chain
		if (!reply) return [];
		return [reply];
	}

	function replyAuthorLabel(reply: ReplyPreview | null | undefined) {
		if (!reply) return '';
		if (reply.authorId && reply.authorId === currentUserId) return 'You';
		return reply.authorName || reply.authorId || 'Someone';
	}

	function replyPreviewText(reply: ReplyPreview | null | undefined) {
		if (!reply) return '';
		const raw = clipPreview(reply.preview ?? (reply as any).text ?? '');
		if (raw) return raw;
		switch (reply.type) {
			case 'gif':
				return 'GIF';
			case 'file':
				return 'File';
			case 'poll':
				return 'Poll';
			case 'form':
				return 'Form';
			default:
				return 'Message';
		}
	}

	function replyAvatar(entry: ReplyPreview | null | undefined) {
		if (!entry?.authorId) return null;
		return avatarUrlFor({ uid: entry.authorId });
	}

	function shouldIgnoreReplyIntent(target: EventTarget | null) {
		if (!(target instanceof Element)) return false;
		return Boolean(
			target.closest('button, a, input, textarea, select, label, [data-reply-ignore]')
		);
	}

	function handleReplyClick(
		event: MouseEvent | KeyboardEvent,
		message: ChatMessage,
		force = false
	) {
		if (!force && shouldIgnoreReplyIntent(event.target as EventTarget | null)) return;
		dispatch('reply', { message });
	}

	const SAME_BLOCK_MINUTES = 5;
	function sameBlock(prev: any, curr: any) {
		if (!prev || !curr) return false;
		if (prev.uid !== curr.uid) return false;
		try {
			const p = prev.createdAt?.toDate ? prev.createdAt.toDate() : new Date(prev.createdAt);
			const c = curr.createdAt?.toDate ? curr.createdAt.toDate() : new Date(curr.createdAt);
			return Math.abs(+c - +p) <= SAME_BLOCK_MINUTES * 60 * 1000;
		} catch {
			return false;
		}
	}

	function normalizeDate(value: any) {
		if (!value) return null;
		if (typeof value.toDate === 'function') return value.toDate();
		if (value instanceof Date) return value;
		const date = new Date(value);
		return Number.isNaN(+date) ? null : date;
	}

	function sameMinute(prev: any, curr: any) {
		if (!prev || !curr) return false;
		const p = normalizeDate(prev?.createdAt);
		const c = normalizeDate(curr?.createdAt);
		if (!p || !c) return false;
		return Math.floor(+p / 60000) === Math.floor(+c / 60000);
	}

	function minuteKeyFor(msg: any): string | null {
		const date = normalizeDate(msg?.createdAt);
		if (!date) return null;
		const minute = Math.floor(+date / 60000);
		return Number.isFinite(minute) ? `${minute}` : null;
	}

	let lastLen = 0;
	let lastPendingLen = 0;

	function totalVotes(votes?: Record<number, number>) {
		if (!votes) return 0;
		return Object.values(votes).reduce((a, b) => a + (b ?? 0), 0);
	}

	function pct(votes: Record<number, number> | undefined, idx: number) {
		const total = totalVotes(votes);
		if (!total) return 0;
		const n = votes?.[idx] ?? 0;
		return Math.round((n / total) * 100);
	}

	const QUICK_REACTIONS = [
		'\u{1F44D}',
		'\u{1F389}',
		'\u2764\uFE0F',
		'\u{1F602}',
		'\u{1F525}',
		'\u{1F44F}',
		'\u{1F410}'
	];
	const LONG_PRESS_MS = 450;
	const LONG_PRESS_MOVE_THRESHOLD = 10;
	const SWIPE_INPUT_BLUR_THRESHOLD = 18;

	let hasHoverSupport = $state(true);
	let isMobileViewport = $state(false);
	let hoveredMessageId: string | null = $state(null);
	let touchActionMessageId: string | null = $state(null);
	let hoveredMinuteKey: string | null = $state(null);
	let hoverLeaveTimeout: ReturnType<typeof setTimeout> | null = null;
	let reactionMenuFor: string | null = $state(null);
	let reactionMenuAnchor: HTMLElement | null = null;
	let reactionMenuEl: HTMLDivElement | null = $state(null);
	let reactionMenuPosition = $state({ top: 0, left: 0 });
	let showReactionPicker = $state(false);
	let reactionPickerPosition = $state({ top: 0, left: 0 });
	let reactionPickerEl: HTMLDivElement | null = $state(null);
	let longPressTimer: number | null = null;
	let longPressStart: { x: number; y: number } | null = null;
	type SwipeState = { pointerId: number | null; startX: number; startY: number; blurred: boolean };
	let swipeState: SwipeState = $state({ pointerId: null, startX: 0, startY: 0, blurred: false });

	run(() => {
		const currentFirstId = messages[0]?.id ?? null;
		const prevLen = lastLen;
		const nextLen = messages.length;
		if (nextLen !== prevLen) {
			const wasEmpty = prevLen === 0;
			const lengthIncreased = nextLen > prevLen;
			lastLen = nextLen;

			if (
				pendingPrependAdjustment &&
				lengthIncreased &&
				currentFirstId !== lastFirstMessageId &&
				scroller
			) {
				const snapshot = pendingPrependAdjustment;
				pendingPrependAdjustment = null;
				tick().then(() => {
					if (!scroller) return;
					const diff = scroller.scrollHeight - snapshot.height;
					const nextTop = snapshot.top + diff;
					scroller.scrollTop = Math.max(nextTop, 0);
				});
			} else {
				pendingPrependAdjustment = null;
				if (shouldStickToBottom || wasEmpty) {
					scrollToBottom(wasEmpty ? 'auto' : 'smooth');
				}
			}
		}
		lastFirstMessageId = currentFirstId;
		if (reactionMenuFor && !messages.some((msg) => msg?.id === reactionMenuFor)) {
			reactionMenuFor = null;
			showReactionPicker = false;
		}
	});

	run(() => {
		const prev = untrack(() => lastScrollSignal);
		if (scrollToBottomSignal && scrollToBottomSignal !== prev) {
			lastScrollSignal = scrollToBottomSignal;
			tick().then(() => scrollToBottom('auto'));
		}
	});

	run(() => {
		// Scroll to specific message when scrollToMessageId changes
		if (scrollToMessageId && scrollToMessageId !== lastScrollToMessageId) {
			lastScrollToMessageId = scrollToMessageId;
			// Wait for messages to render then scroll
			tick().then(() => scrollToMessage(scrollToMessageId));
		}
	});

	run(() => {
		const prev = lastPendingLen;
		const next = pendingUploads.length;
		if (next !== prev) {
			lastPendingLen = next;
			tick().then(() => scrollToBottom('auto'));
		}
	});

	onMount(() => {
		if (typeof window !== 'undefined') {
			const updateViewportFlags = () => {
				hasHoverSupport = window.matchMedia('(hover: hover)').matches;
				isMobileViewport = window.matchMedia('(max-width: 640px)').matches;
			};
			updateViewportFlags();
			const handleResize = () => {};
			const handleGlobalPointerDown = (event: PointerEvent) => {
				if (!reactionMenuFor) return;
				const target = event.target as HTMLElement | null;
				if (
					target?.closest('.reaction-menu') ||
					target?.closest('.reaction-picker') ||
					target?.closest('.reaction-add')
				)
					return;
				closeReactionMenu();
			};

			// Handle mobile keyboard opening - scroll to bottom when viewport shrinks
			let lastViewportHeight = window.visualViewport?.height ?? window.innerHeight;
			const handleViewportResize = () => {
				const currentHeight = window.visualViewport?.height ?? window.innerHeight;
				// Keyboard likely opened if viewport shrunk significantly (more than 100px)
				if (lastViewportHeight - currentHeight > 100 && shouldStickToBottom) {
					tick().then(() => scrollToBottom('auto'));
				}
				lastViewportHeight = currentHeight;
			};

			window.addEventListener('resize', handleResize);
			window.addEventListener('pointerdown', handleGlobalPointerDown, true);
			window.visualViewport?.addEventListener('resize', handleViewportResize);

			return () => {
				window.removeEventListener('resize', handleResize);
				window.removeEventListener('pointerdown', handleGlobalPointerDown, true);
				window.visualViewport?.removeEventListener('resize', handleViewportResize);
			};
		}
		return () => {};
	});

	function resetSwipeState() {
		swipeState = { pointerId: null, startX: 0, startY: 0, blurred: false };
	}

	function maybeBlurActiveComposer() {
		if (typeof document === 'undefined') return;
		const active = document.activeElement as HTMLElement | null;
		if (!active) return;
		const isInput =
			active.tagName === 'TEXTAREA' ||
			active.tagName === 'INPUT' ||
			active.isContentEditable ||
			active.getAttribute('role') === 'textbox';
		if (isInput) active.blur();
	}

	function handleSwipePointerDown(event: PointerEvent) {
		if (event.pointerType !== 'touch') return;
		swipeState = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			blurred: false
		};
	}

	function handleSwipePointerMove(event: PointerEvent) {
		if (event.pointerType !== 'touch') return;
		if (swipeState.pointerId !== event.pointerId || swipeState.blurred) return;
		const deltaY = Math.abs(event.clientY - swipeState.startY);
		if (deltaY >= SWIPE_INPUT_BLUR_THRESHOLD) {
			maybeBlurActiveComposer();
			swipeState = { ...swipeState, blurred: true };
		}
	}

	function handleSwipePointerEnd(event: PointerEvent) {
		if (event.pointerType !== 'touch') return;
		if (swipeState.pointerId === event.pointerId) {
			resetSwipeState();
		}
	}

	function sanitizeEmoji(value: unknown): string | undefined {
		if (typeof value !== 'string') return undefined;
		const trimmed = value.trim();
		return trimmed ? trimmed : undefined;
	}

	function extractReactionUsers(entry: any): string[] {
		if (!entry) return [];
		if (Array.isArray(entry)) {
			return entry
				.map((user) => (typeof user === 'string' ? user.trim() : ''))
				.filter((user): user is string => Boolean(user));
		}
		if (typeof entry === 'object') {
			return Object.keys(entry)
				.map((user) => user.trim())
				.filter(Boolean);
		}
		return [];
	}

	function reactionsFor(message: any) {
		const raw = message?.reactions;
		if (!raw || typeof raw !== 'object') return [];

		const list: Array<{
			key: string;
			emoji: string;
			users: string[];
			count: number;
			mine: boolean;
		}> = [];

		for (const key in raw) {
			const entry = raw[key];
			const emoji =
				sanitizeEmoji(entry?.emoji) ??
				sanitizeEmoji(entry?.symbol) ??
				sanitizeEmoji(entry?.value) ??
				sanitizeEmoji(key);
			if (!emoji) continue;
			const users = extractReactionUsers(entry?.users ?? entry);
			if (!users.length) continue;
			const mine = currentUserId ? users.includes(currentUserId) : false;
			list.push({ key, emoji, users, count: users.length, mine });
		}

		list.sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
		return list;
	}

	function reactionUsersTooltip(userIds: string[]): string {
		if (!userIds.length) return '';
		return userIds
			.map((uid) => {
				if (uid === currentUserId) return 'You';
				return displayNameForUid(uid) || uid;
			})
			.join(', ');
	}

	function toggleReaction(messageId: string, emoji: string) {
		if (!currentUserId) return;
		dispatch('react', { messageId, emoji });
		closeReactionMenu();
	}

	function closeReactionMenu() {
		reactionMenuFor = null;
		reactionMenuAnchor = null;
		showReactionPicker = false;
		clearLongPressTimer();
	}

	function openThread(message: ChatMessage) {
		dispatch('thread', { message });
	}

	async function openReactionMenu(messageId: string, anchor?: HTMLElement | null) {
		if (!currentUserId) return;
		if (reactionMenuFor === messageId) {
			closeReactionMenu();
			return;
		}
		reactionMenuFor = messageId;
		reactionMenuAnchor = anchor ?? null;
		hoveredMessageId = messageId;
		await positionReactionMenu();
		showReactionPicker = false;
	}

	async function positionReactionMenu() {
		if (typeof window === 'undefined' || !reactionMenuFor) return;
		await tick();
		const anchor = reactionMenuAnchor ?? null;
		if (!anchor) return;

		const anchorRect = anchor.getBoundingClientRect();
		await tick();
		const menuRect = reactionMenuEl?.getBoundingClientRect();
		if (!menuRect) return;

		const menuWidth = menuRect.width;
		const menuHeight = menuRect.height;
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const safeGap = 8;
		const verticalOffset = 6;

		const anchorMidX = anchorRect.left + anchorRect.width / 2;
		const maxLeft = Math.max(safeGap, viewportWidth - menuWidth - safeGap);
		let left = anchorMidX - menuWidth / 2;
		left = Math.min(Math.max(safeGap, left), maxLeft);

		let top = anchorRect.bottom + verticalOffset;
		if (top + menuHeight > viewportHeight - safeGap) {
			top = anchorRect.top - menuHeight - verticalOffset;
		}
		if (top < safeGap) {
			top = Math.max(
				safeGap,
				Math.min(anchorRect.bottom + verticalOffset, viewportHeight - menuHeight - safeGap)
			);
		}

		reactionMenuPosition = { top, left };
		if (showReactionPicker) {
			await positionReactionPicker();
		}
	}

	async function positionReactionPicker() {
		if (typeof window === 'undefined' || !showReactionPicker) return;
		await tick();
		const anchorRect = reactionMenuAnchor?.getBoundingClientRect();
		const pickerRect = reactionPickerEl?.getBoundingClientRect();
		if (!pickerRect) return;
		const safeGap = 12;
		let top = anchorRect ? anchorRect.bottom + safeGap : reactionMenuPosition.top;
		let left = anchorRect
			? anchorRect.left + anchorRect.width / 2 - pickerRect.width / 2
			: reactionMenuPosition.left;
		const viewportWidth = window.innerWidth;
		if (left < safeGap) left = safeGap;
		if (left + pickerRect.width > viewportWidth - safeGap) {
			left = viewportWidth - pickerRect.width - safeGap;
		}
		const viewportHeight = window.innerHeight;
		if (top + pickerRect.height > viewportHeight - safeGap) {
			top = anchorRect
				? Math.max(safeGap, anchorRect.top - pickerRect.height - safeGap)
				: Math.max(safeGap, viewportHeight - pickerRect.height - safeGap);
		}
		reactionPickerPosition = { top, left };
	}

	async function openReactionPicker() {
		if (!reactionMenuFor) return;
		if (showReactionPicker) {
			showReactionPicker = false;
			return;
		}
		showReactionPicker = true;
		await positionReactionPicker();
	}

	function closeReactionPicker() {
		showReactionPicker = false;
	}

	function onReactionPickerPick(symbol: string) {
		if (!reactionMenuFor) return;
		showReactionPicker = false;
		chooseReaction(reactionMenuFor, symbol);
	}

	function chooseReaction(messageId: string, emoji: string) {
		closeReactionMenu();
		toggleReaction(messageId, emoji);
	}

	function chooseReply(messageId: string) {
		const target = messages.find((msg) => msg?.id === messageId);
		if (!target) return;
		dispatch('reply', { message: target });
		closeReactionMenu();
	}

	function promptReaction(messageId: string) {
		if (typeof window === 'undefined') return;
		const input = window.prompt('React with an emoji (e.g., ??)');
		const emoji = sanitizeEmoji(input);
		if (!emoji) return;
		chooseReaction(messageId, emoji);
	}

	function onMessagePointerEnter(messageId: string, minuteKey: string | null) {
		if (!hasHoverSupport) return;
		// Clear any pending timeout when re-entering
		if (hoverLeaveTimeout) {
			clearTimeout(hoverLeaveTimeout);
			hoverLeaveTimeout = null;
		}
		hoveredMessageId = messageId;
		hoveredMinuteKey = minuteKey;
	}

	function onMessagePointerLeave(messageId: string, minuteKey: string | null) {
		if (!hasHoverSupport) return;
		if (reactionMenuFor === messageId) return;

		// Add a small delay before hiding the action bar
		// This prevents it from disappearing when moving slowly from message to action bar
		if (hoverLeaveTimeout) {
			clearTimeout(hoverLeaveTimeout);
		}

		hoverLeaveTimeout = setTimeout(() => {
			hoveredMessageId = null;
			if (hoveredMinuteKey === minuteKey) {
				hoveredMinuteKey = null;
			}
			hoverLeaveTimeout = null;
		}, 150);
	}

	function onMessageFocusIn(messageId: string, minuteKey: string | null) {
		// Clear any pending timeout when focusing
		if (hoverLeaveTimeout) {
			clearTimeout(hoverLeaveTimeout);
			hoverLeaveTimeout = null;
		}
		hoveredMessageId = messageId;
		hoveredMinuteKey = minuteKey;
	}

	function onMessageFocusOut(messageId: string, minuteKey: string | null, event: FocusEvent) {
		const next = event.relatedTarget as HTMLElement | null;
		if (next && next.closest?.(`[data-message-id="${messageId}"]`)) return;
		if (reactionMenuFor === messageId) return;

		// Add a small delay for focus out as well
		if (hoverLeaveTimeout) {
			clearTimeout(hoverLeaveTimeout);
		}

		hoverLeaveTimeout = setTimeout(() => {
			hoveredMessageId = null;
			if (hoveredMinuteKey === minuteKey) {
				hoveredMinuteKey = null;
			}
			hoverLeaveTimeout = null;
		}, 150);
	}

	function clearLongPressTimer() {
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
		longPressStart = null;
	}

	function handlePointerDown(event: PointerEvent, messageId: string) {
		touchActionMessageId = null;
		if (event.pointerType !== 'touch') return;
		clearLongPressTimer();
		longPressStart = { x: event.clientX, y: event.clientY };
		longPressTimer = window.setTimeout(() => {
			longPressTimer = null;
			touchActionMessageId = messageId;
		}, LONG_PRESS_MS);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!longPressStart || event.pointerType !== 'touch') return;
		const dx = Math.abs(event.clientX - longPressStart.x);
		const dy = Math.abs(event.clientY - longPressStart.y);
		if (dx > LONG_PRESS_MOVE_THRESHOLD || dy > LONG_PRESS_MOVE_THRESHOLD) {
			clearLongPressTimer();
		}
	}

	function handlePointerUp() {
		clearLongPressTimer();
	}

	function onAddReactionClick(event: PointerEvent | MouseEvent, messageId: string) {
		event.stopPropagation();
		clearLongPressTimer();
		const anchor = (event.currentTarget as HTMLElement) ?? null;
		void openReactionMenu(messageId, anchor);
	}

	function handleScroll() {
		if (reactionMenuFor) closeReactionMenu();
		if (!scroller) return;
		const distanceFromBottom = scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight);
		shouldStickToBottom = distanceFromBottom < 120;

		if (scroller.scrollTop <= 24 && !isRequestingMore) {
			pendingPrependAdjustment = {
				height: scroller.scrollHeight,
				top: scroller.scrollTop
			};
			isRequestingMore = true;
			dispatch('loadMore');
			setTimeout(() => {
				isRequestingMore = false;
			}, 500);
		}
	}

	let formDrafts: Record<string, string[]> = $state({});

	run(() => {
		const drafts = untrack(() => formDrafts);
		let nextDrafts = drafts;
		for (const m of messages) {
			if (m && (m as any).type === 'form' && (m as any).form?.questions) {
				const len = (m as any).form.questions.length;
				const existing = drafts[m.id];
				if (!existing || existing.length !== len) {
					if (nextDrafts === drafts) nextDrafts = { ...drafts };
					nextDrafts[m.id] = Array(len).fill('');
				}
			}
		}
		if (nextDrafts !== drafts) {
			formDrafts = nextDrafts;
		}
	});

	function submitForm(m: any) {
		const answers = (formDrafts[m.id] ?? []).map((a: string) => a.trim());
		dispatch('submitForm', { messageId: m.id, form: m.form, answers });
		formDrafts[m.id] = Array(m.form.questions.length).fill('');
	}

	function bubblePlainText(message: any): string {
		if (!message) return '';
		const text = (message as any).text ?? (message as any).content ?? '';
		return typeof text === 'string' ? text : '';
	}

	const emojiOnlyRegex =
		/^[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAD6}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F004}\u{1F0CF}\u{FE0F}\u{200D}\s]+$/u;

	function shouldCenterBubble(message: any) {
		const text = bubblePlainText(message).trim();
		if (!text) return false;
		if (emojiOnlyRegex.test(text)) return true;
		const words = text.split(/\s+/).filter(Boolean);
		const charCount = text.replace(/\s+/g, '').length;
		return words.length <= 2 && charCount <= 14;
	}

	const formInputId = (mId: string, idx: number) => `form-${mId}-${idx}`;
</script>

<svelte:window on:keydown={handleWindowKeydown} />

<div
	bind:this={scroller}
	class="h-full overflow-auto px-3 sm:px-4 py-4 space-y-2 chat-scroll"
	style:padding-bottom="var(--chat-scroll-padding, calc(env(safe-area-inset-bottom, 0px) + 1rem))"
	onscroll={handleScroll}
	onpointerdown={handleSwipePointerDown}
	onpointermove={handleSwipePointerMove}
	onpointerup={handleSwipePointerEnd}
	onpointercancel={handleSwipePointerEnd}
>
	{#if messages.length === 0}
		<div class="h-full grid place-items-center">
			<div class="text-center text-soft space-y-1">
				<div class="text-2xl font-semibold">Nothing yet</div>
				<div class="text-lg font-medium">No messages yet</div>
				<div class="text-sm">Be the first to say something below.</div>
			</div>
		</div>
	{:else}
		{#each messages as m, i (m.id)}
			{@const isSystem = (m as any)?.type === 'system'}
			{@const mine = !isSystem && isMine(m)}
			{@const continued = !isSystem && i > 0 && sameBlock(messages[i - 1], m)}
			{@const reactions = isSystem ? [] : reactionsFor(m)}
			{@const hasReactions = reactions.length > 0}
			{@const minuteKey = isSystem ? null : minuteKeyFor(m)}
			{@const minuteHovered = minuteKey && hoveredMinuteKey === minuteKey}
			{@const isHighlighted = highlightedMessageId === m.id}
			{@const showAdd =
				!isSystem &&
				Boolean(
					currentUserId &&
					((hasHoverSupport && hoveredMessageId === m.id) || touchActionMessageId === m.id)
				)}
			{@const showTimestampMobile = !hasHoverSupport && !isSystem && reactionMenuFor === m.id}
			{@const replyRef = (m as any).replyTo ?? null}
			{@const threadMeta = threadStats?.[m.id]}
			{#if isSystem}
				<div
					class="message-row message-row--system flex w-full justify-center {isHighlighted
						? 'message-row--highlighted'
						: ''}"
					data-message-id={m.id}
				>
					<div
						class={`message-block w-full max-w-3xl message-block--system ${minuteHovered ? 'is-minute-hovered' : ''}`}
						style={`margin-top: ${continued ? 0 : 0.15}rem;`}
					>
						<div class="system-message">
							<span>{(m as any).text ?? ''}</span>
						</div>
					</div>
				</div>
			{:else}
				<div
					class={`message-row flex w-full ${mine ? 'message-row--mine' : 'message-row--other'} ${continued ? 'message-row--continued' : ''} ${isHighlighted ? 'message-row--highlighted' : ''}`}
					data-message-id={m.id}
					onpointerenter={() => onMessagePointerEnter(m.id, minuteKey)}
					onpointerleave={() => {
						onMessagePointerLeave(m.id, minuteKey);
						handlePointerUp();
					}}
					onfocusin={() => onMessageFocusIn(m.id, minuteKey)}
					onfocusout={(event) => onMessageFocusOut(m.id, minuteKey, event)}
					onpointerdown={(event) => handlePointerDown(event, m.id)}
					onpointermove={handlePointerMove}
					onpointerup={handlePointerUp}
					onpointercancel={handlePointerUp}
				>
					<div
						class={`message-block w-full max-w-3xl ${mine ? 'message-block--mine' : 'message-block--other'} ${minuteHovered ? 'is-minute-hovered' : ''}`}
						style={`margin-top: ${continued ? 0 : 0.15}rem;`}
					>
						<div
							class={`message-layout ${mine ? 'message-layout--mine' : ''} ${continued ? 'message-layout--continued' : ''} ${replyRef ? 'message-layout--has-reply' : ''}`}
						>
							<div class="message-avatar">
								<Avatar 
									user={users[m.uid ?? (m as any).authorId ?? 'unknown']} 
									src={avatarUrlFor(m)}
									name={nameFor(m)} 
									size="md"
									class="w-full h-full"
								/>
							</div>

							<div class={`message-content ${mine ? 'message-content--mine' : ''}`}>
								<div class={`message-body ${continued ? 'message-body--continued' : ''}`}>
									<div
										class={`message-payload ${mine ? 'message-payload--mine' : ''}`}
										role="button"
										tabindex="0"
										onclick={(event) => handleReplyClick(event, m)}
										onkeydown={(event) => {
											if (event.key === 'Enter' || event.key === ' ') {
												event.preventDefault();
												handleReplyClick(event, m);
											}
										}}
									>
										<div class="message-header">
											<span class={`message-author ${mine ? 'message-author--mine' : ''}`}
												>{mine ? 'You' : nameFor(m)}</span
											>
											{#if (m as any).createdAt}
												<span class="message-timestamp-inline"
													>{formatTime((m as any).createdAt)}</span
												>
											{/if}
										</div>
										{#if replyRef && !hideReplyPreview}
											{@const replyChain = flattenReplyChain(replyRef)}
											{#if replyChain.length}
												<div class={`reply-thread ${mine ? 'reply-thread--mine' : ''}`}>
													{#each replyChain as entry, chainIndex (entry.messageId ?? `chain-${chainIndex}`)}
														{@const entryAvatar = replyAvatar(entry)}
														{@const entryAuthor = replyAuthorLabel(entry)}
														{@const entryUid = entry.authorId ?? `reply-${chainIndex}`}
														<div class="reply-inline" title="Jump to message">
															<i class="bx bx-reply reply-inline__icon" aria-hidden="true"></i>
															<div class="reply-inline__avatar">
																<Avatar 
																	user={users[entryUid]} 
																	src={entryAvatar}
																	name={entryAuthor} 
																	size="xs"
																	class="w-full h-full"
																/>
															</div>
															<div class="reply-inline__text">
																<span class="reply-inline__author">{entryAuthor}</span>
																<span class="reply-inline__snippet">{replyPreviewText(entry)}</span>
															</div>
														</div>
													{/each}
												</div>
											{/if}
										{/if}
										{#if currentUserId}
											<div
												class={`message-action-bar ${mine ? 'message-action-bar--mine' : 'message-action-bar--other'} ${showAdd ? 'is-visible' : ''}`}
												onpointerenter={() => onMessagePointerEnter(m.id, minuteKey)}
												onpointerleave={() => onMessagePointerLeave(m.id, minuteKey)}
											>
												<button
													type="button"
													class="message-action"
													aria-label="Reply"
													title="Reply"
													onclick={(event) => {
														event.stopPropagation();
														event.preventDefault();
														handleReplyClick(event, m, true);
													}}
													onpointerdown={(event) => event.stopPropagation()}
												>
													<i class="bx bx-reply" aria-hidden="true"></i>
												</button>
												<button
													type="button"
													class="message-action"
													aria-label="Start thread"
													title="Start thread"
													onclick={(event) => {
														event.stopPropagation();
														event.preventDefault();
														openThread(m);
													}}
													onpointerdown={(event) => event.stopPropagation()}
												>
													<i class="bx bx-message-square-add" aria-hidden="true"></i>
												</button>
												<button
													type="button"
													class="message-action"
													aria-label="Add reaction"
													title="Add reaction"
													disabled={!showAdd}
													aria-hidden={!showAdd}
													onclick={(event) => onAddReactionClick(event, m.id)}
													onpointerdown={(event) => {
														event.stopPropagation();
														clearLongPressTimer();
													}}
												>
													<i class="bx bx-smile" aria-hidden="true"></i>
												</button>
												{#if isTicketAiStaff && serverId && channelId && !mine}
													{@const hasTicket = ticketedMessageIds.has(m.id)}
													<button
														type="button"
														class="message-action {hasTicket ? 'message-action--ticket-exists' : 'message-action--ticket'}"
														aria-label={hasTicket ? 'Ticket exists' : 'Create ticket'}
														title={hasTicket ? 'Ticket already exists' : 'Create ticket'}
														disabled={hasTicket || creatingTicketForMessageId === m.id}
														onclick={(event) => {
															event.stopPropagation();
															event.preventDefault();
															if (!hasTicket) handleCreateTicket(m.id);
														}}
														onpointerdown={(event) => event.stopPropagation()}
													>
														{#if creatingTicketForMessageId === m.id}
															<i class="bx bx-loader-alt bx-spin" aria-hidden="true"></i>
														{:else if hasTicket}
															<i class="bx bx-check-circle" aria-hidden="true"></i>
														{:else}
															<i class="bx bx-support" aria-hidden="true"></i>
														{/if}
													</button>
												{/if}
											</div>
										{/if}
										<div
											class={`message-thread-stack ${mine ? 'message-thread-stack--mine' : ''} ${
												replyRef ? 'message-thread-stack--indented' : ''
											} ${hasReactions ? 'message-thread-stack--has-reactions' : ''}`}
										>
											{#if !m.type || m.type === 'text' || String(m.type) === 'normal'}
												{@const compactBubble = shouldCenterBubble(m)}
												<div
													class={`message-bubble ${mine ? 'message-bubble--mine' : 'message-bubble--other'} ${compactBubble ? 'message-bubble--compact' : ''}`}
												>{#each mentionSegments((m as any).text ?? (m as any).content ?? '', (m as any).mentions) as segment, segIdx (segIdx)}{#if isMentionSegment(segment)}<span class={`chat-mention ${mine ? 'chat-mention--mine' : 'chat-mention--other'} ${segment.data?.kind === 'role' ? 'chat-mention--role' : ''}`}>@{segment.data?.label ?? segment.value.replace(/^@/, '')}</span>{:else}{#each linkifyText(segment.value) as chunk}{#if chunk.type === 'link'}<a class="chat-link" href={chunk.href} target="_blank" rel="noreferrer noopener nofollow">{chunk.value}</a>{:else}{chunk.value}{/if}{/each}{/if}{/each}</div>
											{:else if m.type === 'gif' && (m as any).url}
												<img
													class={`chat-gif ${mine ? 'mine' : ''}`}
													src={(m as any).url}
													alt="GIF"
													loading="lazy"
													onload={handleImageLoad}
												/>
											{:else if m.type === 'file' && (m as any).file?.url}
												{@const file = (m as any).file}
												{@const isImageFile = looksLikeImage({
													name: file.name,
													type: file.contentType
												})}
												<div
													class={`chat-file ${mine ? 'chat-file--mine' : ''} ${isImageFile ? 'chat-file--image' : 'chat-file--document'}`}
												>
													<a
														class={`chat-file__card ${isImageFile ? 'chat-file__card--image' : 'chat-file__card--generic'}`}
														href={file.url}
														target="_blank"
														rel="noreferrer"
														download={file.name ?? undefined}
														onclick={(event) => {
															if (isImageFile) {
																event.preventDefault();
																openImagePreview(file, m);
															}
														}}
													>
														{#if isImageFile}
															<div class="chat-file__preview">
																<img
																	src={file.url}
																	alt={file.name ?? 'Image attachment'}
																	loading="lazy"
																	onload={handleImageLoad}
																/>
															</div>
														{:else}
															<div class="chat-file__icon" aria-hidden="true">
																<i class="bx bx-paperclip"></i>
															</div>
														{/if}
														<div class="chat-file__details">
															<div class="chat-file__name">{file.name ?? 'Download file'}</div>
															<div class="chat-file__subtext">
																{#if file.contentType}<span>{file.contentType}</span>{/if}
																{#if file.contentType && file.size}
																	<span aria-hidden="true">&bull;</span>
																{/if}
																{#if file.size}
																	{@const label = formatBytes(file.size)}
																	{#if label}<span>{label}</span>{/if}
																{/if}
															</div>
														</div>
														<span class="chat-file__cta"
															>{isImageFile ? 'Preview' : 'Download'}</span
														>
													</a>
												</div>
											{:else if m.type === 'poll' && (m as any).poll}
												{#await Promise.resolve((m as any).poll) then poll}
													<div
														class={`rounded-xl border border-white/10 p-3 bg-white/5 max-w-md ${mine ? 'ml-auto text-left' : ''}`}
													>
														<div class="font-medium mb-2">Poll: {poll.question}</div>
														{#each poll.options as opt, idx}
															<div class="rounded-lg border border-white/10 p-2 bg-white/5 mb-2">
																<div class="flex items-center justify-between gap-2">
																	<div>{opt}</div>
																	<div class="text-sm text-soft">{pct(poll.votes, idx)}%</div>
																</div>
																<div class="bar mt-2" style="color: var(--color-accent)">
																	<i style="width: {pct(poll.votes, idx)}%"></i>
																</div>
																<div class="mt-2 text-right">
																	<button
																		class="rounded-full px-3 py-1 hover:bg-white/10"
																		onclick={() =>
																			dispatch('vote', { messageId: m.id, optionIndex: idx })}
																		>Vote</button
																	>
																</div>
															</div>
														{/each}
														<div class="text-xs text-soft mt-1">
															{totalVotes(poll.votes)} vote{totalVotes(poll.votes) === 1 ? '' : 's'}
														</div>
													</div>
												{/await}
											{:else if m.type === 'form' && (m as any).form}
												<div
													class={`rounded-xl border border-white/10 p-3 bg-white/5 max-w-md ${mine ? 'ml-auto text-left' : ''}`}
												>
													<div class="font-medium mb-2">Form: {(m as any).form.title}</div>
													{#each (m as any).form.questions as q, qi}
														{#key `${m.id}-${qi}`}
															<label class="block text-sm mb-1" for={formInputId(m.id, qi)}
																>{qi + 1}. {q}</label
															>
															<input
																id={formInputId(m.id, qi)}
																class="input w-full mb-3"
																bind:value={formDrafts[m.id][qi]}
															/>
														{/key}
													{/each}
													<div class="flex justify-end">
														<button
															class="rounded-full px-4 py-2 accent-button"
															onclick={() => submitForm(m)}
														>
															Submit
														</button>
													</div>
												</div>
											{/if}

											{#if threadMeta}
												{@const previewText = threadMeta.preview ?? 'Open thread'}
												{@const previewAuthor = nameFor(m)}
												{@const previewTime = formatThreadTimestamp(
													threadMeta.lastAt ?? (m as any).createdAt ?? null
												)}
												{@const previewAvatar = avatarUrlFor(m)}
												{@const previewUid = m.uid ?? (m as any).authorId ?? 'thread-preview'}
												<div
													class={`thread-preview ${threadMeta.unread ? 'thread-preview--unread' : ''} ${mine ? 'thread-preview--mine' : ''} thread-preview--indented`}
													role="button"
													tabindex="0"
													aria-label={`Open thread (${threadMeta.count ?? 0} messages)`}
													onclick={(event) => {
														event.stopPropagation();
														event.preventDefault();
														openThread(m);
													}}
													onkeydown={(event) => {
														if (event.key === 'Enter' || event.key === ' ') {
															event.preventDefault();
															openThread(m);
														}
													}}
												>
													<div class="thread-preview__content">
														<div class="thread-preview__header">
															<span class="thread-preview__author">{previewAuthor}</span>
															{#if previewTime}
																<span class="thread-preview__time">{previewTime}</span>
															{/if}
														</div>
														<div class="thread-preview__snippet">{previewText}</div>
														<div class="thread-preview__footer">
															<div class="thread-preview__avatars" aria-hidden="true">
																<div class="thread-preview__avatar">
																	<Avatar 
																		user={users[previewUid]} 
																		src={previewAvatar}
																		name={previewAuthor} 
																		size="xs"
																		class="w-full h-full"
																	/>
																</div>
																<div class="thread-preview__avatar thread-preview__avatar--ghost">
																	<i class="bx bx-message-detail" aria-hidden="true"></i>
																</div>
															</div>
															<div class="thread-preview__count">
																{threadMeta.count ?? 0}
																{threadMeta.count === 1 ? 'message' : 'messages'}
															</div>
														</div>
													</div>
												</div>
											{/if}

											{#if hasReactions}
												<div
													class={`reaction-row ${mine ? 'reaction-row--mine' : 'reaction-row--other'}`}
												>
													<div class="reaction-list">
														{#each reactions as reaction (reaction.key)}
															<button
																type="button"
																class={`reaction-chip ${reaction.mine ? 'active' : ''}`}
																onclick={() => toggleReaction(m.id, reaction.emoji)}
																disabled={!currentUserId}
																title={reactionUsersTooltip(reaction.users)}
															>
																<span>{reaction.emoji}</span>
																<span class="count">{reaction.count}</span>
															</button>
														{/each}
													</div>
												</div>
											{/if}
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			{/if}
		{/each}
	{/if}
	{#if pendingUploads.length}
		{#each pendingUploads as upload (upload.id)}
			{@const uploadMessage = { uid: upload.uid ?? currentUserId ?? 'upload' }}
			{@const uploadAvatar = avatarUrlFor(uploadMessage)}
			{@const uploadName = nameFor(uploadMessage)}
			{@const uploadPercent = Math.round((upload.progress ?? 0) * 100)}
			{@const uploadUid = upload.uid ?? currentUserId ?? 'upload'}
			<div class="flex w-full justify-end" data-message-id={`pending-${upload.id}`}>
				<div class="message-block w-full max-w-3xl message-block--mine message-block--pending">
					<div class="message-heading-row message-heading-row--mine">
						<span class="message-author message-author--mine">{uploadName}</span>
					</div>
					<div class="message-layout message-layout--mine">
						<div class="message-avatar">
							<Avatar 
								user={users[uploadUid]} 
								src={uploadAvatar}
								name={uploadName} 
								size="md"
								class="w-full h-full"
							/>
						</div>
						<div class="message-content message-content--mine">
							<div class="message-body">
								<div
									class={`chat-file chat-file--mine chat-file--upload ${upload.isImage ? 'chat-file--image' : 'chat-file--document'}`}
								>
									<div
										class={`chat-file__card chat-file__card--upload ${upload.isImage ? 'chat-file__card--image' : 'chat-file__card--generic'}`}
									>
										{#if upload.isImage && upload.previewUrl}
											<div class="chat-file__preview">
												<img
													src={upload.previewUrl}
													alt={upload.name}
													loading="lazy"
													onload={handleImageLoad}
												/>
												<div class="chat-file__preview-overlay">
													<div class="chat-upload-spinner" aria-hidden="true"></div>
													<div class="chat-upload-percent">{uploadPercent}%</div>
												</div>
											</div>
										{:else}
											<div class="chat-file__icon" aria-hidden="true">
												<i class="bx bx-paperclip"></i>
											</div>
										{/if}
										<div class="chat-file__details">
											<div class="chat-file__name">{upload.name}</div>
											<div class="chat-file__subtext">
												{#if upload.contentType}<span>{upload.contentType}</span>{/if}
												{#if upload.contentType && upload.size}
													<span aria-hidden="true">&bull;</span>
												{/if}
												{#if upload.size}
													{@const uploadSize = formatBytes(upload.size)}
													{#if uploadSize}<span>{uploadSize}</span>{/if}
												{/if}
											</div>
										</div>
										<div class="chat-upload-status">
											Uploading� {uploadPercent}%
										</div>
										<div
											class="chat-upload-bar"
											role="progressbar"
											aria-valuemin="0"
											aria-valuemax="100"
											aria-valuenow={uploadPercent}
										>
											<span style={`width: ${Math.max(8, uploadPercent)}%`}></span>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		{/each}
	{/if}
</div>

{#if reactionMenuFor && currentUserId}
	<button
		type="button"
		class="reaction-menu-backdrop"
		aria-label="Close reactions"
		onclick={closeReactionMenu}
	></button>
	{#if showReactionPicker}
		<div
			class="reaction-picker"
			bind:this={reactionPickerEl}
			style={`top: ${reactionPickerPosition.top}px; left: ${reactionPickerPosition.left}px`}
		>
			<EmojiPicker
				on:close={closeReactionPicker}
				on:pick={(event) => onReactionPickerPick(event.detail)}
			/>
		</div>
	{:else}
		<div
			class="reaction-menu"
			bind:this={reactionMenuEl}
			style={`top: ${reactionMenuPosition.top}px; left: ${reactionMenuPosition.left}px`}
		>
			<div class="reaction-grid">
				{#each QUICK_REACTIONS as emoji}
					<button
						type="button"
						class="reaction-button"
						onclick={() => chooseReaction(reactionMenuFor!, emoji)}>{emoji}</button
					>
				{/each}
			</div>
			<div class="reaction-menu__actions">
				<button type="button" class="reaction-menu__action" onclick={openReactionPicker}>
					<i class="bx bx-smile" aria-hidden="true"></i>
					<span>More emojis</span>
				</button>
			</div>
		</div>
	{/if}
{/if}

{#if previewAttachment}
	<div
		class="image-preview-overlay"
		role="dialog"
		aria-modal="true"
		aria-label="Image preview"
		tabindex="-1"
		bind:this={previewOverlayEl}
	>
		<button
			type="button"
			class="image-preview-dismiss"
			aria-label="Close preview"
			onclick={closePreview}
		></button>
		<div class="image-preview-panel">
			<div class="image-preview-header">
				<button
					type="button"
					class="image-preview-close"
					aria-label="Close preview"
					onclick={closePreview}
				>
					<i class="bx bx-x" aria-hidden="true"></i>
				</button>
				<a
					class="image-preview-download"
					href={previewAttachment.downloadUrl ?? previewAttachment.url}
					download={previewAttachment.name ?? undefined}
					aria-label="Download image"
				>
					<i class="bx bx-download" aria-hidden="true"></i>
				</a>
			</div>
			<div class="image-preview-media">
				<img
					src={previewAttachment.url}
					alt={previewAttachment.name ?? 'Image preview'}
					loading="eager"
				/>
			</div>
			<div class="image-preview-meta">
				{#if !isMobileViewport}
					<div class="image-preview-name">{previewAttachment.name ?? 'Image attachment'}</div>
					<div class="image-preview-subtext">
						{#if previewAttachment.contentType}<span>{previewAttachment.contentType}</span>{/if}
						{#if previewAttachment.contentType && previewAttachment.sizeLabel}
							<span aria-hidden="true">&bull;</span>
						{/if}
						{#if previewAttachment.sizeLabel}<span>{previewAttachment.sizeLabel}</span>{/if}
					</div>
					{#if previewAttachment.author || previewAttachment.timestamp}
						<div class="image-preview-subtext image-preview-subtext--secondary">
							{#if previewAttachment.author}<span>Shared by {previewAttachment.author}</span>{/if}
							{#if previewAttachment.author && previewAttachment.timestamp}
								<span aria-hidden="true">&bull;</span>
							{/if}
							{#if previewAttachment.timestamp}<span>{previewAttachment.timestamp}</span>{/if}
						</div>
					{/if}
				{/if}
				{#if !isMobileViewport}
					<div class="image-preview-actions">
						<a
							class="image-preview-button accent"
							href={previewAttachment.downloadUrl ?? previewAttachment.url}
							download={previewAttachment.name ?? undefined}
						>
							Download
						</a>
						<a
							class="image-preview-button subtle"
							href={previewAttachment.downloadUrl ?? previewAttachment.url}
							target="_blank"
							rel="noreferrer"
						>
							Open original
						</a>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.chat-scroll {
		overflow-x: hidden;
		overflow-y: auto;
		touch-action: pan-y;
		overscroll-behavior-inline: contain;
		overscroll-behavior-x: contain;
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	.chat-scroll::-webkit-scrollbar {
		display: none;
	}

	.bar {
		height: 6px;
		border-radius: 9999px;
		background: rgba(255, 255, 255, 0.1);
		overflow: hidden;
	}

	.bar > i {
		display: block;
		height: 100%;
		background: currentColor;
	}

	.message-enter {
		opacity: 0;
		transform: translateY(12px);
	}

	.message-enter-active {
		transition:
			opacity 150ms ease,
			transform 150ms ease;
		opacity: 1;
		transform: translateY(0);
	}

	.message-author {
		font-weight: 600;
		color: var(--color-text-primary);
		font-size: 0.92rem;
	}

	.message-author--mine {
		color: var(--color-accent);
	}

	.message-timestamp {
		font-size: 0.75rem;
		color: var(--text-55);
	}

	.message-block {
		width: 100%;
		max-width: min(48rem, 100%);
		display: flex;
		flex-direction: column;
		gap: 0.18rem;
	}

	.message-block--system {
		align-items: center;
		text-align: center;
	}

	.message-row {
		width: 100%;
		transition: background-color 0.3s ease;
	}

	.message-row--highlighted {
		background-color: rgba(var(--color-accent-rgb, 59, 130, 246), 0.25);
		animation: highlight-pulse 2s ease-out;
	}

	@keyframes highlight-pulse {
		0% {
			background-color: rgba(var(--color-accent-rgb, 59, 130, 246), 0.4);
		}
		100% {
			background-color: rgba(var(--color-accent-rgb, 59, 130, 246), 0.1);
		}
	}

	.message-row--mine {
		justify-content: flex-start;
	}

	.message-row--other {
		justify-content: flex-start;
	}

	.chat-scroll,
	.message-block,
	.message-layout,
	.message-content,
	.message-body {
		-webkit-user-select: none;
		user-select: none;
		-webkit-touch-callout: none;
	}

	.message-block--mine {
		align-items: flex-start;
		text-align: left;
	}

	.message-block--other {
		align-items: flex-start;
		text-align: left;
	}

	.message-layout {
		width: 100%;
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
		position: relative;
		box-sizing: border-box;
	}

	.message-layout--mine {
		flex-direction: row;
	}

	.message-layout--continued {
		padding-left: calc(2.5rem + 0.6rem);
	}

	.message-layout--mine.message-layout--continued {
		padding-left: 0;
		padding-right: calc(2.5rem + 0.6rem);
	}

	.message-content {
		position: relative;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding-bottom: 0.6rem;
		flex: 0 1 auto;
		align-self: flex-start;
		width: fit-content;
		max-width: min(48rem, 100%);
		overflow: visible;
		box-sizing: border-box;
	}

	/* Mobile: Ensure message content doesn't overflow */
	@media (max-width: 767px) {
		.message-content {
			max-width: calc(100% - 0.5rem);
		}
	}

	.message-content--mine {
		align-items: flex-start;
		text-align: left;
		align-self: flex-start;
	}

	.message-heading-row {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0 0.35rem;
		margin-bottom: 0.35rem;
	}

	.message-block--other .message-heading-row {
		margin-left: calc(2.5rem + 0.6rem);
		margin-right: 0;
	}

	.message-block--mine .message-heading-row {
		margin-left: 0;
		margin-right: calc(2.5rem + 0.6rem);
	}

	.message-heading-row--mine {
		justify-content: flex-end;
		text-align: right;
	}

	.message-inline-timestamp {
		position: absolute;
		right: 0.35rem;
		bottom: -0.9rem;
		font-size: 0.72rem;
		color: var(--text-55);
		line-height: 1;
		white-space: nowrap;
		display: flex;
		align-items: center;
		transition:
			opacity 150ms ease,
			transform 150ms ease;
		pointer-events: none;
		background: color-mix(in srgb, var(--color-panel) 75%, transparent);
		border-radius: 999px;
		padding: 0.1rem 0.4rem;
	}

	.message-inline-timestamp--mine {
		left: 0.35rem;
		right: auto;
		bottom: -0.9rem;
	}

	.message-content:not(.message-content--mine) .message-inline-timestamp {
		right: 0.35rem;
		left: auto;
	}

	@media (hover: hover) and (pointer: fine) {
		.message-inline-timestamp {
			opacity: 0;
			transform: translateY(2px);
		}

		.message-block.is-minute-hovered .message-inline-timestamp,
		.message-block:hover .message-inline-timestamp {
			opacity: 0.8;
			transform: translateY(0);
		}
	}

	@media (hover: none), (pointer: coarse) {
		.message-inline-timestamp {
			opacity: 0;
			transform: translateY(2px);
			pointer-events: none;
		}

		.message-inline-timestamp.is-mobile-visible {
			opacity: 0.8;
			transform: translateY(0);
		}
	}

	.message-avatar {
		width: 2.2rem;
		height: 2.2rem;
		min-width: 2.2rem;
		border-radius: 9999px;
		border: 1px solid var(--chat-bubble-other-border);
		background: color-mix(in srgb, var(--chat-bubble-other-bg) 35%, transparent);
		display: grid;
		place-items: center;
		overflow: hidden;
		box-shadow: 0 8px 20px rgba(6, 9, 12, 0.25);
		flex: 0 0 auto;
		margin-top: 1.35rem;
		transform: translateY(2px);
	}

	.message-layout--mine .message-avatar {
		border-color: var(--chat-bubble-self-border);
		background: color-mix(in srgb, var(--chat-bubble-self-bg) 20%, transparent);
	}

	.message-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.message-avatar span {
		font-size: 0.85rem;
		color: var(--text-70);
	}

	.message-body {
		position: relative;
		margin-top: 0.1rem;
		display: flex;
		flex-direction: column;
		gap: 0;
		max-width: 100%;
		align-items: flex-start;
		align-self: stretch;
	}

	.message-action-bar {
		position: absolute;
		top: 0;
		display: inline-flex;
		gap: 0.2rem;
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 100ms ease,
			transform 100ms ease;
		direction: ltr;
		transform: translateY(calc(-100% - 0.25rem));
		padding-bottom: 0.25rem;
		background: color-mix(in srgb, var(--color-panel) 90%, transparent);
		border-radius: 0.5rem;
		padding: 0.2rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 40%, transparent);
		backdrop-filter: blur(8px);
	}

	.message-action-bar--other {
		right: 0;
		left: auto;
		justify-content: flex-end;
	}

	.message-action-bar--mine {
		right: auto;
		left: 0;
		justify-content: flex-start;
	}

	.message-action-bar.is-visible {
		opacity: 1;
		pointer-events: auto;
	}

	.message-action {
		width: 28px;
		height: 28px;
		border-radius: 0.4rem;
		border: none;
		background: transparent;
		color: var(--text-60);
		display: grid;
		place-items: center;
		font-size: 0.95rem;
		transition:
			color 100ms ease,
			background 100ms ease;
	}

	.message-action:not(:disabled):hover,
	.message-action:not(:disabled):focus-visible {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		outline: none;
	}

	.message-action--ticket:not(:disabled):hover,
	.message-action--ticket:not(:disabled):focus-visible {
		color: #4ade80;
		background: color-mix(in srgb, #4ade80 15%, transparent);
	}

	.message-action--ticket-exists {
		color: #4ade80;
		opacity: 0.7;
	}

	.message-action:disabled {
		opacity: 0.25;
		pointer-events: none;
	}

	.message-action--ticket-exists:disabled {
		opacity: 0.7;
		pointer-events: none;
	}

	.message-body--continued {
		margin-top: 0.04rem;
		gap: 0.12rem;
	}

	.message-content--mine .message-body {
		align-items: flex-end;
		align-self: flex-end;
	}

	.message-payload {
		position: relative;
		display: inline-flex;
		flex-direction: column;
		gap: 0.2rem;
		align-items: flex-start;
		width: fit-content;
		max-width: 100%;
		margin-left: 0;
		margin-top: 0;
	}

	.message-body:has(.reply-thread) .message-payload {
		margin-top: 0.24rem;
	}

	.message-payload--mine {
		align-items: flex-end;
		margin-left: 0;
	}

	.message-header {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		font-size: 0.94rem;
		line-height: 1.2;
		padding-left: 0;
		margin-bottom: 0.15rem;
	}

	.message-layout--has-reply .message-header {
		flex-direction: row;
		align-items: baseline;
		gap: 0.4rem;
	}

	.message-layout--mine.message-layout--has-reply .message-header {
		align-items: baseline;
	}

	.message-header__dot {
		display: none;
	}

	.message-layout--has-reply .message-header__dot {
		display: none;
	}

	.message-timestamp-inline {
		font-size: 0.8rem;
		color: var(--text-55);
	}

	.message-layout--has-reply .message-timestamp-inline {
		position: static;
		padding: 0;
		background: transparent;
	}

	.reply-thread {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		position: relative;
		padding: 0;
		margin: 0.1rem 0 0.2rem 0;
		width: 100%;
	}

	.reply-thread--mine {
		align-items: flex-start;
	}

	.reply-elbow {
		display: none;
	}

	.reply-elbow__horizontal {
		display: none;
	}

	.reply-elbow__vertical {
		display: none;
	}

	.reply-inline {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
		color: var(--text-90);
		font-size: 0.8rem;
		padding: 0.25rem 0.5rem;
		margin: 0;
		position: relative;
		background: color-mix(in srgb, var(--color-panel-muted) 80%, var(--color-accent) 10%);
		border-radius: 0.5rem;
		border: 1px solid color-mix(in srgb, var(--color-accent) 25%, var(--color-border-subtle) 40%);
		box-shadow: none;
		max-width: min(32rem, 100%);
		cursor: pointer;
		transition:
			background 120ms ease,
			border-color 120ms ease;
	}

	.reply-inline:hover {
		background: color-mix(in srgb, var(--color-panel-muted) 70%, var(--color-accent) 20%);
		border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border-subtle) 40%);
	}

	.reply-thread--mine .reply-inline {
		background: color-mix(in srgb, var(--color-panel-muted) 80%, var(--color-accent) 10%);
		border-color: color-mix(in srgb, var(--color-accent) 25%, var(--color-border-subtle) 40%);
		color: var(--text-90);
	}

	.reply-thread--mine .reply-inline:hover {
		background: color-mix(in srgb, var(--color-panel-muted) 70%, var(--color-accent) 20%);
	}

	.reply-inline__icon {
		font-size: 0.85rem;
		color: var(--text-45);
		transform: scaleX(-1);
		flex-shrink: 0;
	}

	.reply-thread--mine .reply-inline__icon {
		color: color-mix(in srgb, var(--chat-bubble-self-text) 50%, var(--text-45) 50%);
	}

	.reply-inline__avatar {
		width: 1.15rem;
		height: 1.15rem;
		border-radius: 999px;
		overflow: hidden;
		display: grid;
		place-items: center;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
		flex-shrink: 0;
	}

	.reply-inline__avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.reply-inline__avatar span {
		font-weight: 600;
		font-size: 0.55rem;
		color: var(--text-60);
	}

	.reply-inline__text {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
		flex-wrap: nowrap;
	}

	.reply-inline__author {
		font-weight: 600;
		font-size: 0.75rem;
		color: var(--text-100);
		white-space: nowrap;
	}

	.reply-inline__snippet {
		color: var(--text-80);
		font-size: 0.75rem;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 22ch;
	}

	.reply-thread--mine .reply-inline__author {
		color: var(--text-100);
	}

	.reply-thread--mine .reply-inline__snippet {
		color: var(--text-80);
	}

	@media (max-width: 640px) {
		.reply-thread {
			padding: 0;
			margin: 0.1rem 0 0.15rem 0;
			gap: 0.15rem;
			position: relative;
		}

		.reply-thread--mine {
			align-items: flex-start;
			padding: 0;
		}

		.reply-inline {
			padding: 0.2rem 0.45rem;
			margin: 0;
			font-size: 0.75rem;
			background: color-mix(in srgb, var(--color-panel-muted) 80%, var(--color-accent) 10%);
			border-radius: 0.45rem;
			border: 1px solid color-mix(in srgb, var(--color-accent) 25%, var(--color-border-subtle) 40%);
			box-shadow: none;
			max-width: calc(100% - 0.5rem);
			color: var(--text-100);
		}

		.reply-inline:active {
			background: color-mix(in srgb, var(--color-panel-muted) 70%, var(--color-accent) 20%);
		}

		.reply-thread:not(.reply-thread--mine) .reply-inline {
			color: var(--text-100);
		}

		.reply-thread--mine .reply-inline {
			background: color-mix(in srgb, var(--color-panel-muted) 80%, var(--color-accent) 10%);
			border-color: color-mix(in srgb, var(--color-accent) 25%, var(--color-border-subtle) 40%);
			color: var(--text-100);
		}

		.reply-thread--mine .reply-inline:active {
			background: color-mix(in srgb, var(--color-panel-muted) 70%, var(--color-accent) 20%);
		}

		.reply-elbow {
			display: none;
		}

		.reply-elbow__horizontal {
			display: none;
		}

		.reply-elbow__vertical {
			display: none;
		}

		.reply-inline__icon {
			font-size: 0.75rem;
		}

		.reply-thread--mine .reply-inline__icon {
			color: color-mix(in srgb, var(--chat-bubble-self-text) 60%, var(--text-50) 40%);
		}

		.reply-thread:not(.reply-thread--mine) .reply-inline__icon {
			color: var(--text-50);
		}

		.reply-thread--mine .reply-inline__author {
			color: var(--text-100);
			font-size: 0.7rem;
		}

		.reply-thread--mine .reply-inline__snippet {
			color: var(--text-80);
			max-width: 16ch;
		}

		.reply-thread:not(.reply-thread--mine) .reply-inline__author {
			color: var(--text-100);
			font-size: 0.7rem;
		}

		.reply-thread:not(.reply-thread--mine) .reply-inline__snippet {
			color: var(--text-80);
			max-width: 16ch;
		}

		.reply-inline__avatar {
			width: 1rem;
			height: 1rem;
		}

		.reply-inline__avatar span {
			font-size: 0.5rem;
		}

		.reply-inline__text {
			flex-wrap: nowrap;
			gap: 0.2rem;
		}
	}

	.message-bubble {
		position: relative;
		display: inline-block;
		width: auto;
		max-width: min(46rem, 100%);
		padding: 0.9rem 1.05rem;
		margin: 0.12rem 0;
		border-radius: 1rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 75%, transparent);
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.5;
		text-align: left;
		font-size: 1rem;
		box-shadow: 0 10px 26px rgba(0, 0, 0, 0.2);
		background-clip: padding-box;
		isolation: isolate;
		transition:
			background 140ms ease,
			border 140ms ease,
			color 140ms ease,
			box-shadow 140ms ease;
		color: var(--chat-bubble-other-text);
		background: color-mix(in srgb, var(--chat-bubble-other-bg) 70%, transparent);
	}

	.system-message {
		padding: 0.35rem 0.8rem;
		border-radius: 0.85rem;
		background: color-mix(in srgb, var(--color-panel-muted) 70%, transparent);
		color: var(--text-65);
		font-size: 0.84rem;
		display: inline-block;
		margin-bottom: 0.3rem;
		text-align: center;
	}

	.message-bubble--mine {
		background: var(--chat-bubble-self-bg);
		color: var(--chat-bubble-self-text);
		border-color: var(--chat-bubble-self-border);
		box-shadow: 0 12px 26px rgba(0, 0, 0, 0.24);
	}

	.message-bubble--other {
		background: var(--chat-bubble-other-bg);
		color: var(--chat-bubble-other-text);
		border-color: var(--chat-bubble-other-border);
	}

	.message-bubble--first-other::before,
	.message-bubble--first-mine::before {
		content: none;
	}

	.message-bubble--first-other::before {
		content: none;
	}

	.message-bubble--first-mine::before {
		content: none;
	}

	.message-bubble--first-other::after,
	.message-bubble--first-mine::after {
		content: none;
	}

	.message-bubble--compact {
		text-align: left;
		padding-left: 0.05rem;
		padding-right: 0.05rem;
		font-size: clamp(1rem, 1.15vw, 1.12rem);
	}

	@media (hover: hover) {
		.message-bubble:hover {
			box-shadow: 0 14px 32px rgba(0, 0, 0, 0.24);
			border-color: color-mix(in srgb, var(--color-border-subtle) 40%, var(--color-accent) 15%);
		}
	}

	@media (max-width: 800px) {
		.message-bubble {
			max-width: 100%;
			padding: 0.8rem 0.95rem;
			font-size: 1.02rem;
			line-height: 1.4;
		}

		.message-bubble--compact {
			font-size: 1.05rem;
		}
	}

	@media (max-width: 640px) {
		.message-payload {
			max-width: calc(100vw - 3.4rem);
		}

		.message-layout {
			gap: 0.45rem;
			align-items: flex-end;
			width: 100%;
			box-sizing: border-box;
		}

		.message-layout--continued {
			padding-left: 1.9rem;
		}

		.message-layout--mine.message-layout--continued {
			padding-right: 1.1rem;
			padding-left: 0;
		}

		.message-layout--mine .message-avatar {
			display: none;
		}

		.message-layout:not(.message-layout--mine) .message-avatar {
			width: 2.05rem;
			height: 2.05rem;
			min-width: 2.05rem;
			border-radius: 50%;
			overflow: hidden;
			border: 1px solid rgba(0, 0, 0, 0.06);
			background: #fff;
			box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
			margin-top: 0.15rem;
		}

		.message-layout--mine .message-content {
			width: 100%;
			max-width: 100%;
			margin-left: 0;
			align-items: flex-start;
		}

		.message-layout:not(.message-layout--mine) .message-content {
			max-width: calc(100% - 2.35rem);
			align-items: flex-start;
		}

		.message-body {
			gap: 0.25rem;
		}

		.message-body--continued {
			margin-top: 0.08rem;
		}

		.message-content {
			padding-bottom: 0.35rem;
			max-width: calc(100vw - 1.25rem);
		}

		.message-bubble {
			max-width: calc(100vw - 3.4rem);
			padding: 0.8rem 1rem !important;
			border-radius: 1.2rem;
			box-shadow: 0 10px 20px rgba(0, 0, 0, 0.12);
			background: color-mix(in srgb, var(--color-panel) 70%, var(--chat-bubble-other-bg) 30%);
			color: color-mix(in srgb, var(--text-100) 90%, var(--chat-bubble-other-text) 10%);
			border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		}

		.message-bubble--mine {
			background: color-mix(
				in srgb,
				var(--chat-bubble-self-bg) 70%,
				var(--color-panel) 30%
			) !important;
			color: color-mix(in srgb, var(--chat-bubble-self-text) 90%, var(--text-100) 10%) !important;
			border-color: color-mix(in srgb, var(--chat-bubble-self-border) 70%, transparent);
			border-radius: 1.2rem 1.2rem 0.5rem 1.2rem;
			box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
		}

		.message-bubble--mine .chat-mention {
			color: #fff !important;
			background: rgba(255, 255, 255, 0.25) !important;
		}

		.message-bubble--other {
			background: color-mix(
				in srgb,
				var(--color-panel) 70%,
				var(--chat-bubble-other-bg) 30%
			) !important;
			color: color-mix(in srgb, var(--text-100) 90%, var(--chat-bubble-other-text) 10%) !important;
			border-radius: 1.2rem 1.2rem 1.2rem 0.5rem;
			padding: 0.8rem 1rem !important;
			border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
			box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
		}

		.message-bubble--other .chat-link {
			color: color-mix(in srgb, var(--text-100) 85%, var(--chat-bubble-other-text) 15%);
		}

		.message-bubble--mine .chat-link {
			color: color-mix(in srgb, var(--chat-bubble-self-text) 90%, var(--text-100) 10%);
		}

		.message-header {
			display: flex;
			align-items: center;
			gap: 0.3rem;
			margin-bottom: 0.08rem;
			font-size: 0.78rem;
			color: color-mix(in srgb, var(--text-100) 90%, var(--text-80) 10%);
		}

		.message-author {
			font-size: 0.82rem;
			font-weight: 600;
			color: color-mix(in srgb, var(--text-100) 92%, var(--text-80) 8%);
		}

		.message-author--mine {
			color: color-mix(in srgb, var(--color-accent) 80%, var(--text-100) 20%) !important;
			font-weight: 600;
		}

		.message-timestamp-inline {
			font-size: 0.72rem;
			color: color-mix(in srgb, var(--text-70) 85%, transparent);
		}

		.message-bubble--mine .message-timestamp-inline {
			color: color-mix(in srgb, var(--chat-bubble-self-text) 85%, transparent) !important;
		}

		.message-bubble--mine .message-header__dot {
			color: color-mix(in srgb, var(--chat-bubble-self-text) 70%, transparent) !important;
		}

		.message-header__dot {
			color: rgba(0, 0, 0, 0.3);
		}

		.message-action-bar--mine {
			right: auto;
			left: -2rem;
		}

		.message-action-bar--other {
			left: auto;
			right: -2rem;
		}

		.message-thread-stack--indented {
			margin-left: clamp(0.6rem, 3vw, 1.4rem);
		}

		.message-thread-stack--mine.message-thread-stack--indented {
			margin-right: clamp(0.6rem, 3vw, 1.4rem);
		}

		.chat-gif {
			max-width: calc(100vw - 3.4rem);
			border-radius: 1.1rem;
			border-color: rgba(15, 23, 42, 0.08);
		}

		.chat-file {
			max-width: calc(100vw - 3.4rem);
		}

		.chat-file__card {
			background: color-mix(in srgb, var(--chat-bubble-other-bg) 94%, #fff 10%);
			border-color: rgba(15, 23, 42, 0.08);
			box-shadow: 0 10px 26px rgba(15, 23, 42, 0.16);
			color: var(--chat-bubble-other-text);
		}

		.chat-file--mine .chat-file__card {
			background: var(--chat-bubble-self-bg);
			border-color: var(--chat-bubble-self-border);
			color: var(--chat-bubble-self-text);
		}

		.chat-file__subtext {
			color: color-mix(in srgb, var(--chat-bubble-other-text) 82%, transparent);
		}

		.chat-file--mine .chat-file__subtext {
			color: color-mix(in srgb, var(--chat-bubble-self-text) 88%, transparent);
		}

		.reply-thread {
			width: 100%;
		}

		.reply-inline {
			max-width: calc(100vw - 3.4rem);
		}

		.reply-inline__snippet {
			white-space: normal;
		}
	}

	@media (min-width: 768px) {
		.message-row--mine,
		.message-row--other {
			justify-content: flex-start;
		}

		.message-block {
			max-width: 100%;
		}

		.message-layout {
			gap: 0.8rem;
		}

		.message-layout--continued {
			padding-left: 0;
		}

		.message-layout--mine.message-layout--continued {
			padding-right: 0;
		}

		.message-layout--continued .message-avatar {
			visibility: hidden;
		}

		.message-layout--continued .message-header {
			display: none;
		}

		.message-avatar {
			margin-top: 0.2rem;
			box-shadow: none;
			border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
			background: color-mix(in srgb, var(--color-panel-muted) 70%, transparent);
		}

		.message-content,
		.message-content--mine {
			align-items: flex-start;
			align-self: stretch;
			width: 100%;
			text-align: left;
			margin-left: 0;
			margin-right: 0;
		}

		.message-content--mine .message-body {
			align-items: flex-start;
			align-self: flex-start;
		}

		.message-body,
		.message-body--continued {
			align-items: flex-start;
		}

		.message-payload,
		.message-payload--mine {
			align-items: flex-start;
			width: 100%;
			text-align: left;
			margin-left: 0;
			margin-right: 0;
			max-width: 100%;
		}

		.message-bubble {
			background: color-mix(in srgb, var(--chat-bubble-other-bg) 75%, var(--color-panel) 25%);
			border: 1px solid color-mix(in srgb, var(--chat-bubble-other-border) 75%, transparent);
			color: color-mix(in srgb, var(--chat-bubble-other-text) 90%, var(--text-90) 10%);
			box-shadow: none;
		}

		.message-bubble--mine {
			background: color-mix(in srgb, var(--chat-bubble-self-bg) 80%, var(--color-panel) 20%);
			border-color: color-mix(in srgb, var(--chat-bubble-self-border) 80%, transparent);
			color: color-mix(in srgb, var(--chat-bubble-self-text) 92%, var(--text-90) 8%);
		}

		.message-bubble--mine .chat-link {
			color: var(--chat-bubble-self-text);
		}

		.message-bubble--other .chat-link {
			color: var(--chat-bubble-other-text);
		}

		.message-header {
			margin-bottom: 0.08rem;
			font-size: 0.95rem;
			gap: 0.45rem;
		}

		.message-block--mine .message-heading-row,
		.message-block--other .message-heading-row {
			margin-left: calc(2.5rem + 0.6rem);
			margin-right: 0;
			justify-content: flex-start;
			text-align: left;
		}

		.message-heading-row--mine {
			justify-content: flex-start;
			text-align: left;
		}

		.message-bubble {
			background: transparent;
			border: none;
			box-shadow: none;
			padding: 0.1rem 0;
			margin: 0.05rem 0;
			max-width: 100%;
			color: var(--color-text-primary);
		}

		.message-bubble--mine,
		.message-bubble--other {
			background: transparent;
			color: var(--color-text-primary);
		}

		.message-bubble--compact {
			padding-left: 0;
			padding-right: 0;
		}

		.message-thread-stack {
			gap: 0.35rem;
			align-items: flex-start;
		}

		.message-thread-stack--indented {
			margin-left: calc(2.5rem + 0.6rem);
		}

		.message-thread-stack--mine.message-thread-stack--indented {
			margin-left: calc(2.5rem + 0.6rem);
			margin-right: 0;
		}

		.message-action-bar {
			background: color-mix(in srgb, var(--color-panel) 95%, transparent);
			border-color: color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		}

		.message-action {
			background: transparent;
			border: none;
		}

		.message-action:not(:disabled):hover,
		.message-action:not(:disabled):focus-visible {
			background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		}
	}

	.chat-mention {
		display: inline;
		font-weight: 600;
		border-radius: 3px;
		padding: 1px 4px;
		background: rgba(47, 216, 200, 0.25);
		color: #2fd8c8;
	}

	.chat-mention--mine {
		color: #fff;
		background: rgba(255, 255, 255, 0.3);
	}

	.chat-mention--other {
		color: #2fd8c8;
		background: rgba(47, 216, 200, 0.25);
	}

	.chat-mention--role {
		font-weight: 700;
	}

	.chat-link {
		color: var(--text-70);
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 2px;
		word-break: break-word;
	}

	.chat-link:hover,
	.chat-link:focus-visible {
		color: var(--color-text-primary);
		outline: none;
	}

	.chat-gif {
		display: block;
		width: 100%;
		max-width: min(400px, 100%);
		border-radius: calc(var(--radius-lg) + 0.2rem);
		border: 1px solid var(--chat-bubble-other-border);
		overflow: hidden;
		object-fit: contain;
	}

	/* Mobile: Constrain GIF and image sizes */
	@media (max-width: 767px) {
		.chat-gif {
			max-width: calc(100vw - 3.4rem);
			border-radius: 1.1rem;
		}
	}

	.chat-gif.mine {
		border-color: var(--chat-bubble-self-border);
	}

	.chat-file {
		max-width: min(400px, 100%);
	}

	/* Mobile: Constrain file cards */
	@media (max-width: 767px) {
		.chat-file {
			max-width: calc(100vw - 3.4rem);
		}
	}

	.chat-file__card {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		border-radius: 1rem;
		border: 1px solid color-mix(in srgb, var(--chat-bubble-other-border) 70%, transparent);
		background: color-mix(in srgb, var(--chat-bubble-other-bg) 85%, transparent);
		padding: 0.95rem;
		text-decoration: none;
		color: inherit;
		transition:
			transform 120ms ease,
			border 140ms ease,
			background 140ms ease;
	}

	.chat-file__card:hover {
		transform: translateY(-1px);
		border-color: color-mix(in srgb, var(--chat-bubble-other-border) 35%, transparent);
	}

	.chat-file__card--image {
		padding: 0.5rem;
		background: color-mix(in srgb, var(--chat-bubble-other-bg) 65%, transparent);
	}

	.chat-file__card--generic {
		flex-direction: row;
		align-items: center;
		gap: 0.85rem;
	}

	.chat-file__preview {
		position: relative;
		border-radius: 0.9rem;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--chat-bubble-other-border) 70%, transparent);
		background: color-mix(in srgb, var(--chat-bubble-other-bg) 60%, transparent);
	}

	.chat-file__preview img {
		width: 100%;
		height: 100%;
		display: block;
		object-fit: cover;
	}

	.chat-file__preview-overlay {
		position: absolute;
		inset: 0;
		background: color-mix(in srgb, #000 35%, transparent);
		display: grid;
		place-items: center;
		gap: 0.35rem;
		color: #fff;
		font-weight: 600;
		text-shadow: 0 2px 6px #0009;
	}

	.chat-file__icon {
		width: 3rem;
		height: 3rem;
		border-radius: 0.85rem;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
		color: var(--color-accent);
		font-size: 1.35rem;
	}

	.chat-file__details {
		flex: 1;
		min-width: 0;
	}

	.chat-file__name {
		font-weight: 600;
		font-size: 0.95rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chat-file__subtext {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
		color: var(--color-text-muted, color-mix(in srgb, #ffffff 65%, transparent));
		font-size: 0.8rem;
	}

	.chat-file__cta {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-accent);
		margin-left: auto;
	}

	.chat-file--mine .chat-file__card {
		border-color: var(--chat-bubble-self-border);
		background: var(--chat-bubble-self-bg);
	}

	.chat-file--mine .chat-file__preview {
		border-color: var(--chat-bubble-self-border);
	}

	.chat-file--upload .chat-file__card {
		border-style: dashed;
		border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
		background: color-mix(in srgb, var(--chat-bubble-self-bg) 45%, transparent);
	}
	.message-block--pending {
		opacity: 0.9;
	}

	.chat-upload-status {
		font-size: 0.8rem;
		color: var(--color-text-muted, color-mix(in srgb, #ffffff 60%, transparent));
	}

	.chat-upload-bar {
		width: 100%;
		height: 0.35rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-panel-muted) 45%, transparent);
		overflow: hidden;
	}

	.chat-upload-bar span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(
			90deg,
			var(--color-accent),
			color-mix(in srgb, var(--color-accent) 70%, #fff)
		);
		animation: chat-upload-glow 1.2s linear infinite;
	}

	.chat-upload-spinner {
		width: 2.4rem;
		height: 2.4rem;
		border-radius: 999px;
		border: 3px solid rgba(255, 255, 255, 0.35);
		border-top-color: #fff;
		animation: spin 1s linear infinite;
	}

	.chat-upload-percent {
		font-size: 0.9rem;
	}

	@keyframes chat-upload-glow {
		0% {
			opacity: 0.65;
		}
		50% {
			opacity: 1;
		}
		100% {
			opacity: 0.65;
		}
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.reaction-row {
		position: absolute;
		top: calc(100% - 0.55rem);
		display: flex;
		align-items: center;
		gap: 0.35rem;
		pointer-events: none;
	}

	.reaction-row--other {
		right: 0;
		justify-content: flex-end;
	}

	.reaction-row--mine {
		left: 0;
		justify-content: flex-start;
	}

	.reaction-list {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.2rem;
		pointer-events: auto;
	}

	.reaction-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.15rem 0.6rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--chat-bubble-other-border);
		background: color-mix(in srgb, var(--chat-bubble-other-bg) 55%, transparent);
		color: var(--chat-bubble-other-text);
		font-size: 0.85rem;
		line-height: 1.1;
		transition:
			transform 120ms ease,
			background 120ms ease,
			border 120ms ease;
	}

	.reaction-chip:hover {
		transform: translateY(-1px);
		background: color-mix(in srgb, var(--chat-bubble-other-bg) 70%, transparent);
	}

	.reaction-chip.active {
		border-color: color-mix(in srgb, var(--chat-bubble-self-bg) 55%, transparent);
		background: color-mix(in srgb, var(--chat-bubble-self-bg) 35%, transparent);
		color: var(--chat-bubble-self-text);
	}

	.reaction-chip .count {
		font-size: 0.75rem;
		opacity: 0.8;
	}

	.reaction-add {
		width: 1.75rem;
		height: 1.75rem;
		border-radius: var(--radius-pill);
		border: 1px dashed var(--chat-bubble-other-border);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 1rem;
		color: var(--chat-bubble-other-text);
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transform: translateY(4px);
		transition:
			opacity 120ms ease,
			transform 120ms ease,
			border-color 120ms ease,
			color 120ms ease;
		background: rgba(5, 6, 8, 0.35);
		box-shadow: 0 12px 24px rgba(0, 0, 0, 0.35);
	}

	.reaction-add.is-visible {
		opacity: 1;
		visibility: visible;
		pointer-events: auto;
		transform: translateY(0);
	}

	.reaction-add-floating {
		position: absolute;
		top: -0.6rem;
		z-index: 10;
	}

	.reaction-add-floating--other {
		right: -0.55rem;
	}

	.reaction-add-floating--mine {
		left: -0.55rem;
	}

	.reaction-add:hover {
		border-color: color-mix(in srgb, var(--chat-bubble-self-bg) 55%, transparent);
		color: var(--chat-bubble-self-text);
	}

	.reaction-add:disabled {
		cursor: default;
	}

	.accent-button {
		background: var(--color-accent);
		color: var(--color-text-inverse);
		font-weight: 600;
		transition:
			background 120ms ease,
			transform 120ms ease;
	}

	.accent-button:hover {
		background: var(--color-accent-strong);
	}

	.reaction-menu {
		position: fixed;
		min-width: 180px;
		max-width: min(90vw, 320px);
		background: rgba(18, 22, 28, 0.95);
		border-radius: 16px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
		padding: 0.75rem;
		backdrop-filter: blur(16px);
		z-index: 500;
	}

	.reaction-menu-backdrop {
		position: fixed;
		inset: 0;
		background: transparent;
		cursor: pointer;
		z-index: 400;
	}

	.reaction-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(40px, 1fr));
		gap: 0.4rem;
	}

	.reaction-menu__actions {
		margin-top: 0.65rem;
		display: flex;
		justify-content: center;
	}

	.reaction-menu__action {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.9rem;
		border-radius: var(--radius-pill);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 75%, transparent);
		background: color-mix(in srgb, rgba(255, 255, 255, 0.04) 85%, transparent);
		color: var(--text-80);
		font-size: 0.85rem;
		cursor: pointer;
		transition:
			background 120ms ease,
			color 120ms ease,
			border 120ms ease;
	}

	.reaction-menu__action:hover,
	.reaction-menu__action:focus-visible {
		background: color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		color: var(--text-100);
		border-color: color-mix(in srgb, var(--color-border-strong) 75%, transparent);
		outline: none;
	}

	.reaction-menu__action i {
		font-size: 1.1rem;
	}

	.reaction-picker {
		position: fixed;
		z-index: 600;
	}

	.reaction-picker :global(.emoji-panel) {
		pointer-events: auto;
	}

	.reaction-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		font-size: 1.25rem;
		background: rgba(255, 255, 255, 0.08);
		color: inherit;
		border: 0;
		padding: 0.35rem;
		transition:
			background 120ms ease,
			transform 120ms ease;
	}

	.reaction-button:focus-visible {
		outline: 2px solid rgba(255, 255, 255, 0.4);
		outline-offset: 2px;
	}

	.reaction-button:hover {
		background: rgba(255, 255, 255, 0.16);
		transform: translateY(-1px);
	}

	@media (max-width: 640px) {
		.reaction-menu {
			min-width: 140px;
			max-width: min(220px, 85vw);
			padding: 0.5rem 0.6rem;
			border-radius: 0.9rem;
		}

		.reaction-grid {
			grid-template-columns: repeat(auto-fit, minmax(32px, 1fr));
			gap: 0.25rem;
		}

		.reaction-button {
			font-size: 1rem;
			padding: 0.25rem;
		}

		.reaction-menu__actions {
			margin-top: 0.5rem;
		}

		.reaction-menu__action {
			font-size: 0.78rem;
			padding: 0.3rem 0.85rem;
		}
	}

	.message-thread-stack {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		position: relative;
	}

	.message-thread-stack--mine {
		align-items: flex-end;
	}

	.message-thread-stack--indented {
		margin-left: 0;
	}

	.message-thread-stack--mine.message-thread-stack--indented {
		margin-left: 0;
		margin-right: 0;
	}

	.message-thread-stack--has-reactions {
		padding-bottom: 0.85rem;
	}

	.thread-preview--indented {
		margin-left: clamp(1.5rem, 4vw, 3rem);
	}

	.thread-preview--mine.thread-preview--indented {
		margin-left: 0;
		margin-right: clamp(1.5rem, 4vw, 3rem);
	}

	.thread-preview {
		position: relative;
		margin-top: 0.3rem;
		border-radius: 0.85rem;
		background: color-mix(in srgb, var(--color-panel-muted) 70%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
		cursor: pointer;
		transition:
			border-color 150ms ease,
			transform 150ms ease,
			background 150ms ease,
			box-shadow 150ms ease;
		padding: 0.65rem 0.9rem 0.7rem calc(0.9rem + 14px);
		max-width: min(420px, 100%);
	}

	.thread-preview--mine {
		align-self: flex-end;
		padding-left: 0.9rem;
		padding-right: calc(0.9rem + 14px);
	}

	.thread-preview::after {
		content: '';
		position: absolute;
		top: 0.65rem;
		bottom: 0.65rem;
		left: 0.9rem;
		width: 2.5px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 40%, var(--color-border-subtle) 60%);
	}

	.thread-preview::before {
		content: '';
		position: absolute;
		width: 20px;
		height: 14px;
		top: -12px;
		left: 0.9rem;
		border-left: 2px solid
			color-mix(in srgb, var(--color-accent) 30%, var(--color-border-subtle) 70%);
		border-bottom: 2px solid
			color-mix(in srgb, var(--color-accent) 30%, var(--color-border-subtle) 70%);
		border-bottom-left-radius: 10px;
	}

	.thread-preview--mine::after,
	.thread-preview--mine::before {
		display: none;
	}

	.thread-preview--unread::after {
		background: var(--color-accent);
	}

	.thread-preview--unread::before {
		border-color: var(--color-accent);
	}

	@media (min-width: 768px) {
		.message-thread-stack--mine {
			align-items: flex-start;
		}

		.message-thread-stack--mine.message-thread-stack--indented {
			margin-left: clamp(1.5rem, 4vw, 2.8rem);
			margin-right: 0;
		}

		.thread-preview--mine {
			align-self: flex-start;
		}

		.thread-preview::after,
		.thread-preview::before {
			display: none;
		}
	}

	.thread-preview--mine::before {
		left: auto;
		right: 1.1rem;
		border-left: 0;
		border-bottom-left-radius: 0;
		border-right: 2px solid color-mix(in srgb, var(--color-border-subtle) 85%, transparent);
		border-bottom-right-radius: 14px;
	}

	.thread-preview--unread::after,
	.thread-preview--unread::before {
		border-color: var(--color-accent);
		background: var(--color-accent);
	}

	.thread-preview__content {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding-left: 0.4rem;
	}

	.thread-preview--mine .thread-preview__content {
		padding-left: 0;
		padding-right: 0.4rem;
	}

	.thread-preview__header {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
		font-size: 0.78rem;
	}

	.thread-preview__author {
		font-weight: 600;
		color: var(--text-85);
	}

	.thread-preview__time {
		font-size: 0.72rem;
		color: var(--text-50);
	}

	.thread-preview__snippet {
		color: var(--text-70);
		font-size: 0.85rem;
		line-height: 1.35;
		line-clamp: 2;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.thread-preview__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		font-size: 0.72rem;
		color: var(--text-55);
		margin-top: 0.15rem;
	}

	.thread-preview__avatars {
		display: flex;
		align-items: center;
		gap: -0.25rem;
	}

	.thread-preview__avatar {
		width: 22px;
		height: 22px;
		border-radius: 999px;
		border: 1.5px solid var(--color-panel);
		background: color-mix(in srgb, var(--color-panel-muted) 80%, transparent);
		display: grid;
		place-items: center;
		font-size: 0.68rem;
		font-weight: 600;
		overflow: hidden;
		margin-left: -0.35rem;
	}

	.thread-preview__avatar:first-child {
		margin-left: 0;
	}

	.thread-preview__avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thread-preview__avatar--ghost {
		background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
		border-style: dashed;
		border-color: color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
		color: var(--text-50);
		font-size: 0.65rem;
	}

	.thread-preview__count {
		text-transform: lowercase;
		font-weight: 500;
		color: color-mix(in srgb, var(--color-accent) 70%, var(--text-60) 30%);
	}

	.thread-preview:hover,
	.thread-preview:focus-visible {
		border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 85%, transparent);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		outline: none;
	}

	.thread-preview:active {
		transform: scale(0.99);
	}

	.image-preview-overlay {
		position: fixed;
		inset: 0;
		background: rgba(5, 5, 5, 0.75);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 9999;
		overflow: hidden;
	}

	.image-preview-dismiss {
		position: absolute;
		inset: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		z-index: 0;
	}

	.image-preview-panel {
		position: relative;
		z-index: 1;
		width: min(960px, 100%);
		max-height: calc(100vh - 2rem);
		border-radius: 1rem;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(15, 15, 18, 0.98);
		color: #fff;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
		padding: clamp(1rem, 3vw, 1.5rem);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.image-preview-close {
		background: transparent;
		border: none;
		color: inherit;
		font-size: 1.5rem;
		padding: 0.25rem;
		border-radius: 999px;
		cursor: pointer;
	}

	.image-preview-close:hover,
	.image-preview-close:focus-visible {
		background: rgba(255, 255, 255, 0.1);
		outline: none;
	}

	.image-preview-media {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 0.75rem;
		overflow: hidden;
		min-height: 220px;
	}

	.image-preview-media img {
		max-width: 100%;
		max-height: 70vh;
		width: auto;
		height: auto;
		object-fit: contain;
		border-radius: 0.5rem;
	}

	.image-preview-meta {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.image-preview-header {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.image-preview-download {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.25);
		color: inherit;
		transition:
			background 150ms ease,
			border 150ms ease;
	}

	.image-preview-download:hover,
	.image-preview-download:focus-visible {
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.6);
		outline: none;
	}

	.image-preview-name {
		font-weight: 600;
		font-size: 1.1rem;
		word-break: break-word;
	}

	.image-preview-subtext {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		font-size: 0.875rem;
		color: rgba(255, 255, 255, 0.7);
	}

	.image-preview-subtext--secondary {
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.6);
	}

	.image-preview-actions {
		margin-top: 0.5rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.image-preview-button {
		border-radius: 999px;
		padding: 0.55rem 1.5rem;
		text-decoration: none;
		font-weight: 500;
		text-align: center;
		flex: 1;
		min-width: 140px;
	}

	.image-preview-button.accent {
		background: var(--color-accent, #6366f1);
		color: #fff;
	}

	.image-preview-button.subtle {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
		border: 1px solid rgba(255, 255, 255, 0.1);
	}

	@media (max-width: 640px) {
		.image-preview-panel {
			height: auto;
			max-height: calc(100vh - 0.75rem);
			padding: 0.55rem 0.75rem 0.85rem;
			gap: 0.6rem;
		}

		.image-preview-close {
			position: relative;
			top: 0;
			right: 0;
			align-self: flex-end;
			padding: 0.15rem;
		}

		.image-preview-actions {
			flex-direction: column;
			gap: 0.5rem;
		}

		.image-preview-button {
			width: 100%;
			flex: none;
		}
	}
</style>
