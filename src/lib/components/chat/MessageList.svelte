<script lang="ts">
  import { run } from 'svelte/legacy';

  import { createEventDispatcher, onMount, tick } from 'svelte';
  import type { PendingUploadPreview } from './types';
  import { formatBytes, looksLikeImage } from '$lib/utils/fileType';
  import { SPECIAL_MENTIONS } from '$lib/data/specialMentions';
  import { SPECIAL_MENTION_IDS } from '$lib/data/specialMentions';

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
  type LinkChunk =
    | { type: 'text'; value: string }
    | { type: 'link'; value: string; href: string };
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
    | (BaseChatMessage & { file: { name: string; size?: number; url: string; contentType?: string }; type: 'file' })
    | (BaseChatMessage & { poll: { question: string; options: string[]; votes?: Record<number, number> }; type: 'poll' })
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
  }

  let {
    messages = [],
    users = {},
    currentUserId = null,
    scrollToBottomSignal = 0,
    pendingUploads = [],
    threadStats = {},
    hideReplyPreview = false
  }: Props = $props();

let scroller = $state<HTMLDivElement | null>(null);
let previewAttachment = $state<ImagePreviewDetails | null>(null);
let previewOverlayEl = $state<HTMLDivElement | null>(null);
let isRequestingMore = false;
let lastScrollSignal = $state(0);
let shouldStickToBottom = true;
let pendingPrependAdjustment: { height: number; top: number } | null = null;
let lastFirstMessageId: string | null = null;

const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
  scroller?.scrollTo({ top: scroller.scrollHeight, behavior });
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
        typeof ts === 'number' ? new Date(ts) :
        ts?.toDate ? ts.toDate() :
        ts instanceof Date ? ts : null;
      return value ? value.toLocaleString() : '';
    } catch {
      return '';
    }
  }

  function nameFor(m: any) {
    const uid = m.uid ?? 'unknown';
    const fromMap = users[uid] ?? {};
    const resolved =
      m.displayName ||
      fromMap.displayName ||
      fromMap.name ||
      fromMap.email;
    if (resolved) return resolved;
    if (uid === currentUserId) return 'You';
    return fromMap.username || fromMap.handle || uid || 'Unknown';
  }

  function avatarUrlFor(m: any) {
    const uid = m.uid ?? 'unknown';
    return (
      m.photoURL ||
      users[uid]?.photoURL ||
      users[uid]?.authPhotoURL ||
      users[uid]?.avatarUrl ||
      null
    );
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

  function mentionSegments(text: string, mentions?: MentionView[]): Array<MentionSegment | TextSegment> {
    const value = typeof text === 'string' ? text : '';
    if (!value) return [{ type: 'text', value: '' }];
    const mentionList = buildMentionList(value, mentions);
    if (!mentionList.length) return [{ type: 'text', value }];
    const lookup = new Map<string, MentionView>();

    const register = (raw: string | null | undefined, mention: MentionView) => {
      if (!raw) return;
      const trimmed = raw.trim();
      if (!trimmed) return;
      const base = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
      const compact = base.replace(/\s+/g, '');
      const canonical = `@${canonicalMentionToken(base)}`;
      lookup.set(base.toLowerCase(), mention);
      lookup.set(compact.toLowerCase(), mention);
      lookup.set(canonical, mention);
    };

    mentionList.forEach((mention) => {
      register(mention.handle ?? null, mention);
      if (mention.label) {
        register(mention.label, mention);
        register(mention.label.replace(/\s+/g, ''), mention);
        const first = mention.label.split(/\s+/).filter(Boolean)[0];
        if (first) register(first, mention);
      }
    });

    const segments: Array<MentionSegment | TextSegment> = [];
    const regex = /@[\p{L}\p{N}._-]+(?:[ \t]+[\p{L}\p{N}._-]+)*/gu;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(value))) {
      const start = match.index;
      if (start > lastIndex) {
        segments.push({ type: 'text', value: value.slice(lastIndex, start) });
      }
      const token = match[0];
      const canonicalKey = `@${canonicalMentionToken(token)}`;
      const lowered = token.toLowerCase();
      let mention =
        lookup.get(lowered) ?? lookup.get(token) ?? lookup.get(canonicalKey);
      if (!mention) {
        const special = SPECIAL_MENTION_LOOKUP.get(lowered);
        if (special) {
          mention = {
            uid: special.uid,
            handle: `@${special.handle}`,
            label: special.label,
            color: special.color ?? null,
            kind: 'special'
          };
        }
      }
      if (mention) {
        const display = mention.label ? `@${mention.label}` : mention.handle ?? token;
        segments.push({ type: 'mention', value: display, data: mention });
      } else {
        segments.push({ type: 'text', value: token });
      }
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < value.length) {
      segments.push({ type: 'text', value: value.slice(lastIndex) });
    }
    return segments;
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

  function openImagePreview(file: { url: string; name?: string | null; contentType?: string | null; size?: number }, message: ChatMessage) {
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

  function isMentionSegment(
    segment: MentionSegment | TextSegment
  ): segment is MentionSegment {
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
    const chain: ReplyPreview[] = [];
    let current: ReplyPreview | null | undefined = reply;
    while (current) {
      chain.unshift(current);
      current = current.parent ?? null;
    }
    return chain;
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

  function shouldIgnoreReplyIntent(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('button, a, input, textarea, select, label, [data-reply-ignore]'));
  }

  function handleReplyClick(event: MouseEvent | KeyboardEvent, message: ChatMessage) {
    if (shouldIgnoreReplyIntent(event.target as EventTarget | null)) return;
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

  const QUICK_REACTIONS = ['\u{1F44D}', '\u{1F389}', '\u2764\uFE0F', '\u{1F602}', '\u{1F525}', '\u{1F44F}'];
  const LONG_PRESS_MS = 450;
  const LONG_PRESS_MOVE_THRESHOLD = 10;
  const SWIPE_INPUT_BLUR_THRESHOLD = 18;

  let hasHoverSupport = $state(true);
  let hoveredMessageId: string | null = $state(null);
  let touchActionMessageId: string | null = $state(null);
  let hoveredMinuteKey: string | null = $state(null);
  let reactionMenuFor: string | null = $state(null);
  let reactionMenuAnchor: HTMLElement | null = null;
  let reactionMenuEl: HTMLDivElement | null = $state(null);
  let reactionMenuPosition = $state({ top: 0, left: 0 });
  let longPressTimer: number | null = null;
  let longPressStart: { x: number; y: number } | null = null;
  type SwipeState = { pointerId: number | null; startX: number; startY: number; blurred: boolean };
  let swipeState: SwipeState = $state({ pointerId: null, startX: 0, startY: 0, blurred: false });

  run(() => {
    const currentFirstId = messages[0]?.id ?? null;
    if (messages.length !== lastLen) {
      const wasEmpty = lastLen === 0;
      const lengthIncreased = messages.length > lastLen;
      lastLen = messages.length;

      if (pendingPrependAdjustment && lengthIncreased && currentFirstId !== lastFirstMessageId && scroller) {
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
    }
  });

  run(() => {
    if (scrollToBottomSignal && scrollToBottomSignal !== lastScrollSignal) {
      lastScrollSignal = scrollToBottomSignal;
      tick().then(() => scrollToBottom('auto'));
    }
  });

  run(() => {
    if (pendingUploads.length !== lastPendingLen) {
      lastPendingLen = pendingUploads.length;
      tick().then(() => scrollToBottom('auto'));
    }
  });

  onMount(() => {
    if (typeof window !== 'undefined') {
      hasHoverSupport = window.matchMedia('(hover: hover)').matches;
      const handleResize = () => {
        if (reactionMenuFor) void positionReactionMenu();
      };
      const handleGlobalPointerDown = (event: PointerEvent) => {
        if (!reactionMenuFor) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest('.reaction-menu') || target?.closest('.reaction-add')) return;
        closeReactionMenu();
      };
      window.addEventListener('resize', handleResize);
      window.addEventListener('pointerdown', handleGlobalPointerDown, true);
      return () => {
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('pointerdown', handleGlobalPointerDown, true);
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

    const list: Array<{ key: string; emoji: string; users: string[]; count: number; mine: boolean }> = [];

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

  function toggleReaction(messageId: string, emoji: string) {
    if (!currentUserId) return;
    dispatch('react', { messageId, emoji });
    closeReactionMenu();
  }

  function closeReactionMenu() {
    reactionMenuFor = null;
    reactionMenuAnchor = null;
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
      top = Math.max(safeGap, Math.min(anchorRect.bottom + verticalOffset, viewportHeight - menuHeight - safeGap));
    }

    reactionMenuPosition = { top, left };
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
    hoveredMessageId = messageId;
    hoveredMinuteKey = minuteKey;
  }

  function onMessagePointerLeave(messageId: string, minuteKey: string | null) {
    if (!hasHoverSupport) return;
    if (reactionMenuFor === messageId) return;
    hoveredMessageId = null;
    if (hoveredMinuteKey === minuteKey) {
      hoveredMinuteKey = null;
    }
  }

  function onMessageFocusIn(messageId: string, minuteKey: string | null) {
    hoveredMessageId = messageId;
    hoveredMinuteKey = minuteKey;
  }

  function onMessageFocusOut(messageId: string, minuteKey: string | null, event: FocusEvent) {
    const next = event.relatedTarget as HTMLElement | null;
    if (next && next.closest?.(`[data-message-id="${messageId}"]`)) return;
    if (reactionMenuFor === messageId) return;
    hoveredMessageId = null;
    if (hoveredMinuteKey === minuteKey) {
      hoveredMinuteKey = null;
    }
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
    for (const m of messages) {
      if (m && (m as any).type === 'form' && (m as any).form?.questions) {
        const len = (m as any).form.questions.length;
        if (!formDrafts[m.id] || formDrafts[m.id].length !== len) {
          formDrafts[m.id] = Array(len).fill('');
        }
      }
    }
  });

  function submitForm(m: any) {
    const answers = (formDrafts[m.id] ?? []).map((a: string) => a.trim());
    dispatch('submitForm', { messageId: m.id, form: m.form, answers });
    formDrafts[m.id] = Array(m.form.questions.length).fill('');
  }

  const formInputId = (mId: string, idx: number) => `form-${mId}-${idx}`;
</script>

<svelte:window on:keydown={handleWindowKeydown} />

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
    transition: opacity 150ms ease, transform 150ms ease;
    opacity: 1;
    transform: translateY(0);
  }

  .message-author {
    font-weight: 600;
    color: var(--color-text-primary);
    font-size: 0.92rem;
  }

  .message-author--mine {
    color: color-mix(in srgb, var(--chat-bubble-self-bg) 65%, var(--chat-bubble-self-text));
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
    align-items: flex-end;
    text-align: right;
  }

  .message-block--other {
    align-items: flex-start;
    text-align: left;
  }

  .message-layout {
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
  }

  .message-layout--mine {
    flex-direction: row-reverse;
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
    padding-bottom: 1rem;
    flex: 0 1 auto;
    align-self: flex-start;
    width: fit-content;
    max-width: min(48rem, 100%);
  }

  .message-content--mine {
    align-items: flex-end;
    text-align: right;
    align-self: flex-end;
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
    transition: opacity 150ms ease, transform 150ms ease;
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
    width: 2.5rem;
    height: 2.5rem;
    min-width: 2.5rem;
    border-radius: 9999px;
    border: 1px solid var(--chat-bubble-other-border);
    background: color-mix(in srgb, var(--chat-bubble-other-bg) 35%, transparent);
    display: grid;
    place-items: center;
    overflow: hidden;
    box-shadow: 0 8px 20px rgba(6, 9, 12, 0.25);
    flex: 0 0 auto;
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
    margin-top: 0.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.24rem;
    max-width: 100%;
    align-items: flex-start;
    align-self: flex-start;
    width: fit-content;
  }

  .message-action-bar {
    position: absolute;
    top: 0;
    display: inline-flex;
    gap: 0.3rem;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease, transform 120ms ease;
    direction: ltr;
    transform: translateY(calc(-100% - 0.35rem));
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
    width: 32px;
    height: 32px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    background: color-mix(in srgb, var(--color-panel-muted) 80%, transparent);
    color: var(--text-65);
    display: grid;
    place-items: center;
    font-size: 1rem;
    transition: border 120ms ease, color 120ms ease, background 120ms ease;
  }

  .message-action:not(:disabled):hover,
  .message-action:not(:disabled):focus-visible {
    border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    outline: none;
  }

  .message-action:disabled {
    opacity: 0.2;
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
    gap: 0.24rem;
    align-items: flex-start;
    width: fit-content;
    max-width: 100%;
  }

  .message-payload--mine {
    align-items: flex-end;
  }

  .reply-preview {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    gap: 0.18rem;
    padding: 0.55rem 0.95rem 0.55rem 1.25rem;
    border-radius: 1.15rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 10px 20px rgba(6, 9, 12, 0.25);
    max-width: min(520px, 100%);
    align-self: flex-start;
  }

  .reply-preview--mine {
    background: color-mix(in srgb, var(--chat-bubble-self-bg) 60%, transparent);
    border-color: color-mix(in srgb, var(--chat-bubble-self-border) 85%, transparent);
    color: var(--chat-bubble-self-text);
    align-self: flex-end;
  }

  .reply-preview--other {
    background: color-mix(in srgb, var(--chat-bubble-other-bg) 65%, transparent);
    border-color: color-mix(in srgb, var(--chat-bubble-other-border) 80%, transparent);
    color: var(--chat-bubble-other-text);
  }

  .reply-preview__indicator {
    position: absolute;
    left: 0.65rem;
    top: 0.45rem;
    bottom: 0.45rem;
    width: 2px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent) 55%, transparent);
    pointer-events: none;
  }

  .reply-preview--mine .reply-preview__indicator {
    background: color-mix(in srgb, var(--chat-bubble-self-border) 80%, var(--color-accent) 35%);
  }

  .reply-preview--other .reply-preview__indicator {
    background: color-mix(in srgb, var(--chat-bubble-other-border) 80%, var(--color-accent) 30%);
  }

  .reply-preview__content {
    display: flex;
    flex-direction: column;
    gap: 0.12rem;
    min-width: 0;
  }

  .reply-preview__author {
    font-weight: 600;
    font-size: 0.78rem;
    color: inherit;
  }

  .reply-preview__text {
    font-size: 0.78rem;
    color: color-mix(in srgb, currentColor 80%, transparent);
    word-break: break-word;
    font-style: italic;
  }

  .reply-thread {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
  }

  .reply-thread--mine {
    align-items: flex-end;
  }

  .reply-thread__line {
    width: 2px;
    height: 0.65rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent) 55%, transparent);
    display: inline-block;
  }

  .reply-thread__line--mine {
    background: color-mix(in srgb, var(--chat-bubble-self-border) 80%, var(--color-accent) 30%);
  }

  .reply-thread__line--other {
    background: color-mix(in srgb, var(--chat-bubble-other-border) 75%, var(--color-accent) 30%);
  }

  .reply-thread {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
  }

  .reply-thread--mine {
    align-items: flex-end;
  }

  .reply-thread__line {
    width: 2px;
    height: 0.65rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent) 55%, transparent);
    display: inline-block;
  }

  .reply-thread__line--mine {
    background: color-mix(in srgb, var(--chat-bubble-self-border) 80%, var(--color-accent) 30%);
  }

  .reply-thread__line--other {
    background: color-mix(in srgb, var(--chat-bubble-other-border) 75%, var(--color-accent) 30%);
  }

  .message-bubble {
    position: relative;
    display: inline-block;
    max-width: min(640px, 100%);
    padding: 0.65rem 1rem;
    border-radius: 1.15rem;
    border: 1px solid transparent;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    text-align: left;
    box-shadow: 0 8px 18px rgba(9, 12, 16, 0.22);
    transition: background 120ms ease, border 120ms ease, color 120ms ease, box-shadow 120ms ease;
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
  }

  .message-bubble--other {
    background: var(--chat-bubble-other-bg);
    color: var(--chat-bubble-other-text);
    border-color: var(--chat-bubble-other-border);
  }

  .message-bubble--first-other::before,
  .message-bubble--first-other::after {
    content: '';
    position: absolute;
    width: 0.9rem;
    height: 0.9rem;
    bottom: 0.2rem;
    left: -0.45rem;
    border-bottom-right-radius: 1.2rem;
    transform: rotate(45deg);
  }

  .message-bubble--first-other::before {
    background: var(--chat-bubble-other-border);
    left: -0.52rem;
    bottom: 0.16rem;
  }

  .message-bubble--first-other::after {
    background: var(--chat-bubble-other-bg);
  }

  .message-bubble--first-mine::before,
  .message-bubble--first-mine::after {
    content: '';
    position: absolute;
    width: 0.9rem;
    height: 0.9rem;
    bottom: 0.2rem;
    right: -0.45rem;
    border-bottom-left-radius: 1.2rem;
    transform: rotate(-45deg);
  }

  .message-bubble--first-mine::before {
    background: var(--chat-bubble-self-border);
    right: -0.52rem;
    bottom: 0.16rem;
  }

  .message-bubble--first-mine::after {
    background: var(--chat-bubble-self-bg);
  }

  .chat-mention {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    font-weight: 600;
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
    line-height: 1.2;
    border: 1px solid transparent;
    transition: color 150ms ease, background 150ms ease, text-shadow 150ms ease,
      border-color 150ms ease;
  }

  .chat-mention--mine {
    color: #fff;
    background: color-mix(in srgb, var(--color-accent) 35%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 65%, transparent);
    text-shadow: 0 0 6px rgba(45, 212, 191, 0.9);
  }

  .chat-mention--other {
    color: #2fd8c8;
    background: transparent;
    border: 0;
    box-shadow: none;
    text-shadow: 0 0 9px rgba(47, 216, 200, 0.7);
    padding: 0.1rem 0.3rem;
  }

  .chat-mention--role {
    font-weight: 700;
    text-shadow: none;
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
    max-width: min(440px, 100%);
    border-radius: calc(var(--radius-sm) + 0.2rem);
    border: 1px solid var(--chat-bubble-other-border);
    overflow: hidden;
  }

  .chat-gif.mine {
    border-color: var(--chat-bubble-self-border);
  }

  .chat-file {
    max-width: min(520px, 100%);
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
    transition: transform 120ms ease, border 140ms ease, background 140ms ease;
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
    background: linear-gradient(90deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 70%, #fff));
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
    0% { opacity: 0.65; }
    50% { opacity: 1; }
    100% { opacity: 0.65; }
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .reaction-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 0;
    padding-right: 0;
  }

  .reaction-list {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.2rem;
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
    transition: transform 120ms ease, background 120ms ease, border 120ms ease;
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
    transition: opacity 120ms ease, transform 120ms ease, border-color 120ms ease, color 120ms ease;
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
    transition: background 120ms ease, transform 120ms ease;
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
    transition: background 120ms ease, transform 120ms ease;
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
}

.message-thread-stack--mine {
  align-items: flex-end;
}

.message-thread-stack--indented {
  margin-left: clamp(1.5rem, 4vw, 2.8rem);
}

.message-thread-stack--mine.message-thread-stack--indented {
  margin-left: 0;
  margin-right: clamp(1.5rem, 4vw, 2.8rem);
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
  margin-top: 0.2rem;
  border-radius: 1rem;
  background: color-mix(in srgb, var(--color-panel-muted) 96%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
  cursor: pointer;
  transition: border-color 160ms ease, transform 160ms ease, background 160ms ease;
  padding: 0.95rem 1.1rem 1rem calc(1.1rem + 16px);
  max-width: min(520px, 100%);
}

.thread-preview--mine {
  align-self: flex-end;
  padding-left: 1.1rem;
  padding-right: calc(1.1rem + 16px);
}

.thread-preview::after {
  content: '';
  position: absolute;
  top: 0.9rem;
  bottom: 0.9rem;
  left: 1.1rem;
  width: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-border-subtle) 90%, transparent);
}

.thread-preview--mine::after {
  left: auto;
  right: 1.1rem;
}

.thread-preview::before {
  content: '';
  position: absolute;
  width: 26px;
  height: 18px;
  top: -16px;
  left: 1.1rem;
  border-left: 2px solid color-mix(in srgb, var(--color-border-subtle) 85%, transparent);
  border-bottom: 2px solid color-mix(in srgb, var(--color-border-subtle) 85%, transparent);
  border-bottom-left-radius: 14px;
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
  gap: 0.4rem;
  padding-left: 0.5rem;
}

.thread-preview--mine .thread-preview__content {
  padding-left: 0;
  padding-right: 0.5rem;
}

.thread-preview__header {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  font-size: 0.85rem;
}

.thread-preview__author {
  font-weight: 600;
  color: var(--color-text-primary);
}

.thread-preview__time {
  font-size: 0.78rem;
  color: var(--text-60);
}

.thread-preview__snippet {
  color: var(--color-text-primary);
  font-size: 0.95rem;
  line-height: 1.4;
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
  gap: 0.75rem;
  font-size: 0.8rem;
  color: var(--text-65);
}

.thread-preview__avatars {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.thread-preview__avatar {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.08);
  display: grid;
  place-items: center;
  font-size: 0.78rem;
  font-weight: 600;
  overflow: hidden;
}

.thread-preview__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thread-preview__avatar--ghost {
  background: rgba(255, 255, 255, 0.05);
  border-style: dashed;
  color: var(--text-60);
}

.thread-preview__count {
  text-transform: lowercase;
}

.thread-preview:hover,
.thread-preview:focus-visible {
  border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
  background: color-mix(in srgb, var(--color-panel) 94%, transparent);
  transform: translateY(-1px);
  outline: none;
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
  z-index: 80;
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
  align-self: flex-end;
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
    max-height: calc(100vh - 1rem);
  }

  .image-preview-actions {
    flex-direction: column;
  }

  .image-preview-button {
    width: 100%;
    flex: none;
  }
}

</style>

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
      {@const firstInBlock = !continued}
      {@const reactions = isSystem ? [] : reactionsFor(m)}
      {@const hasReactions = reactions.length > 0}
      {@const sameMinuteAsPrev = !isSystem && i > 0 && sameMinute(messages[i - 1], m)}
      {@const sameMinuteAsNext = !isSystem && i < messages.length - 1 && sameMinute(m, messages[i + 1])}
      {@const minuteKey = isSystem ? null : minuteKeyFor(m)}
      {@const minuteHovered = minuteKey && hoveredMinuteKey === minuteKey}
      {@const showAdd = !isSystem && Boolean(
        currentUserId &&
        (
          (hasHoverSupport && hoveredMessageId === m.id) ||
          touchActionMessageId === m.id
        )
      )}
      {@const showTimestampMobile = !hasHoverSupport && !isSystem && reactionMenuFor === m.id}
      {@const replyRef = (m as any).replyTo ?? null}
      {@const threadMeta = threadStats?.[m.id]}
      {#if isSystem}
        <div class="flex w-full justify-center" data-message-id={m.id}>
          <div
            class={`message-block w-full max-w-3xl message-block--system ${minuteHovered ? 'is-minute-hovered' : ''}`}
            style={`margin-top: ${(continued ? 0.1 : 0.6)}rem;`}
          >
            <div class="system-message">
              <span>{(m as any).text ?? ''}</span>
            </div>
          </div>
        </div>
      {:else}
      <div
        class={`flex w-full ${mine ? 'justify-end' : 'justify-start'}`}
        data-message-id={m.id}
        onpointerenter={() => onMessagePointerEnter(m.id, minuteKey)}
        onpointerleave={() => { onMessagePointerLeave(m.id, minuteKey); handlePointerUp(); }}
        onfocusin={() => onMessageFocusIn(m.id, minuteKey)}
        onfocusout={(event) => onMessageFocusOut(m.id, minuteKey, event)}
        onpointerdown={(event) => handlePointerDown(event, m.id)}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onpointercancel={handlePointerUp}
      >
        <div
          class={`message-block w-full max-w-3xl ${mine ? 'message-block--mine' : 'message-block--other'} ${minuteHovered ? 'is-minute-hovered' : ''}`}
          style={`margin-top: ${(continued ? 0.1 : 0.6)}rem;`}
        >
          {#if firstInBlock}
            <div class={`message-heading-row ${mine ? 'message-heading-row--mine' : ''}`}>
              <span class={`message-author ${mine ? 'message-author--mine' : ''}`}>{mine ? 'You' : nameFor(m)}</span>
            </div>
          {/if}

          <div
            class={`message-layout ${mine ? 'message-layout--mine' : ''} ${continued ? 'message-layout--continued' : ''}`}
          >
            {#if firstInBlock}
              <div class="message-avatar">
                {#if avatarUrlFor(m)}
                  <img src={avatarUrlFor(m)} alt={nameFor(m)} loading="lazy" />
                {:else}
                  <span>{initialsFor(nameFor(m))}</span>
                {/if}
              </div>
            {/if}

            <div class={`message-content ${mine ? 'message-content--mine' : ''}`}>
              <div class={`message-body ${continued ? 'message-body--continued' : ''}`}>
                {#if replyRef && !hideReplyPreview}
                  {@const replyChain = flattenReplyChain(replyRef)}
                  <div class={`reply-thread ${mine ? 'reply-thread--mine' : ''}`}>
                    {#each replyChain as entry, chainIndex (entry.messageId ?? `chain-${chainIndex}`)}
                      {@const entryMine = currentUserId && entry.authorId === currentUserId}
                      <div class={`reply-preview ${entryMine ? 'reply-preview--mine' : 'reply-preview--other'}`}>
                        <div class="reply-preview__indicator" aria-hidden="true"></div>
                        <div class="reply-preview__content">
                          <div class="reply-preview__author">{replyAuthorLabel(entry)}</div>
                          <div class="reply-preview__text">{replyPreviewText(entry)}</div>
                        </div>
                      </div>
                      <span class={`reply-thread__line ${entryMine ? 'reply-thread__line--mine' : 'reply-thread__line--other'}`} aria-hidden="true"></span>
                    {/each}
                  </div>
                {/if}
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
                  {#if currentUserId}
                    <div class={`message-action-bar ${mine ? 'message-action-bar--mine' : 'message-action-bar--other'} ${showAdd ? 'is-visible' : ''}`}>
                      <button
                        type="button"
                        class="message-action"
                        aria-label="Reply"
                        title="Reply"
                        onclick={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          handleReplyClick(event, m);
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
                    </div>
                  {/if}
                <div
                  class={`message-thread-stack ${mine ? 'message-thread-stack--mine' : ''} ${
                    replyRef ? 'message-thread-stack--indented' : ''
                  }`}
                >
                  {#if !m.type || m.type === 'text' || String(m.type) === 'normal'}
                    <div class={`message-bubble ${mine ? 'message-bubble--mine' : 'message-bubble--other'} ${firstInBlock ? (mine ? 'message-bubble--first-mine' : 'message-bubble--first-other') : ''}`}>
                      {#each mentionSegments((m as any).text ?? (m as any).content ?? '', (m as any).mentions) as segment, segIdx (segIdx)}
                        {#if isMentionSegment(segment)}
                          {@const baseLabel = segment.data?.label ?? segment.value.replace(/^@/, '')}
                          {@const label =
                            segment.data?.kind === 'special' ? `@${baseLabel}` : baseLabel}
                          <span
                            class={`chat-mention ${mine ? 'chat-mention--mine' : 'chat-mention--other'} ${segment.data?.kind === 'role' ? 'chat-mention--role' : ''} ${mentionHighlightClass(segment.data)}`}
                            style={segment.data?.kind === 'role' && segment.data?.color
                              ? `color:${segment.data.color};background:color-mix(in srgb, ${segment.data.color} 20%, transparent);border-color:color-mix(in srgb, ${segment.data.color} 35%, transparent);`
                              : undefined}
                          >
                            {label}
                          </span>
                        {:else}
                          {#each linkifyText(segment.value) as chunk, chunkIdx (chunkIdx)}
                            {#if chunk.type === 'link'}
                              <a
                                class="chat-link"
                                href={chunk.href}
                                target="_blank"
                                rel="noreferrer noopener nofollow"
                              >
                                {chunk.value}
                              </a>
                            {:else}
                              {chunk.value}
                            {/if}
                          {/each}
                        {/if}
                      {/each}
                    </div>
                  {:else if m.type === 'gif' && (m as any).url}
                    <img
                      class={`chat-gif ${mine ? 'mine' : ''}`}
                      src={(m as any).url}
                      alt="GIF"
                      loading="lazy"
                    />
                  {:else if m.type === 'file' && (m as any).file?.url}
                    {@const file = (m as any).file}
                    {@const isImageFile = looksLikeImage({ name: file.name, type: file.contentType })}
                    <div class={`chat-file ${mine ? 'chat-file--mine' : ''} ${isImageFile ? 'chat-file--image' : 'chat-file--document'}`}>
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
                            <img src={file.url} alt={file.name ?? 'Image attachment'} loading="lazy" />
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
                        <span class="chat-file__cta">{isImageFile ? 'Preview' : 'Download'}</span>
                      </a>
                    </div>
                  {:else if m.type === 'poll' && (m as any).poll}
                    {#await Promise.resolve((m as any).poll) then poll}
                      <div class={`rounded-xl border border-white/10 p-3 bg-white/5 max-w-md ${mine ? 'ml-auto text-left' : ''}`}>
                        <div class="font-medium mb-2">Poll: {poll.question}</div>
                        {#each poll.options as opt, idx}
                          <div class="rounded-lg border border-white/10 p-2 bg-white/5 mb-2">
                            <div class="flex items-center justify-between gap-2">
                              <div>{opt}</div>
                              <div class="text-sm text-soft">{pct(poll.votes, idx)}%</div>
                            </div>
                            <div class="bar mt-2" style="color: var(--color-accent)"><i style="width: {pct(poll.votes, idx)}%"></i></div>
                            <div class="mt-2 text-right">
                              <button class="rounded-full px-3 py-1 hover:bg-white/10" onclick={() => dispatch('vote', { messageId: m.id, optionIndex: idx })}>Vote</button>
                            </div>
                          </div>
                        {/each}
                        <div class="text-xs text-soft mt-1">{totalVotes(poll.votes)} vote{totalVotes(poll.votes) === 1 ? '' : 's'}</div>
                      </div>
                    {/await}
                  {:else if m.type === 'form' && (m as any).form}
                    <div class={`rounded-xl border border-white/10 p-3 bg-white/5 max-w-md ${mine ? 'ml-auto text-left' : ''}`}>
                      <div class="font-medium mb-2">Form: {(m as any).form.title}</div>
                      {#each (m as any).form.questions as q, qi}
                        {#key `${m.id}-${qi}`}
                          <label class="block text-sm mb-1" for={formInputId(m.id, qi)}>{qi + 1}. {q}</label>
                          <input id={formInputId(m.id, qi)} class="input w-full mb-3" bind:value={formDrafts[m.id][qi]} />
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
                    {@const previewTime = formatThreadTimestamp(threadMeta.lastAt ?? (m as any).createdAt ?? null)}
                    {@const previewAvatar = avatarUrlFor(m)}
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
                              {#if previewAvatar}
                                <img src={previewAvatar} alt={previewAuthor} loading="lazy" />
                              {:else}
                                <span>{initialsFor(previewAuthor)}</span>
                              {/if}
                            </div>
                            <div class="thread-preview__avatar thread-preview__avatar--ghost">
                              <i class="bx bx-message-detail" aria-hidden="true"></i>
                            </div>
                          </div>
                          <div class="thread-preview__count">
                            {threadMeta.count ?? 0} {threadMeta.count === 1 ? 'message' : 'messages'}
                          </div>
                        </div>
                      </div>
                    </div>
                  {/if}
                </div>
                {#if !isSystem && (m as any).createdAt && !sameMinuteAsNext}
                  <div
                    class={`message-inline-timestamp ${mine ? 'message-inline-timestamp--mine' : ''} ${showTimestampMobile ? 'is-mobile-visible' : ''}`}
                    aria-hidden={!hasHoverSupport && !showTimestampMobile}
                  >
                    {formatTime((m as any).createdAt)}
                  </div>
                {/if}
              </div>

                {#if !isSystem && (reactions.length || currentUserId)}
                  <div
                    class="reaction-row"
                    style={`margin-top: ${hasReactions ? (continued ? 0.15 : 0.4) : 0}rem;`}
                  >
                    <div class="reaction-list">
                      {#each reactions as reaction (reaction.key)}
                        <button
                          type="button"
                          class={`reaction-chip ${reaction.mine ? 'active' : ''}`}
                          onclick={() => toggleReaction(m.id, reaction.emoji)}
                          disabled={!currentUserId}
                          title={reaction.users.join(', ')}
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
      {/if}
    {/each}
  {/if}
  {#if pendingUploads.length}
    {#each pendingUploads as upload (upload.id)}
      {@const uploadMessage = { uid: upload.uid ?? currentUserId ?? 'upload' }}
      {@const uploadAvatar = avatarUrlFor(uploadMessage)}
      {@const uploadName = nameFor(uploadMessage)}
      {@const uploadPercent = Math.round((upload.progress ?? 0) * 100)}
      <div class="flex w-full justify-end" data-message-id={`pending-${upload.id}`}>
        <div class="message-block w-full max-w-3xl message-block--mine message-block--pending">
          <div class="message-heading-row message-heading-row--mine">
            <span class="message-author message-author--mine">{uploadName}</span>
          </div>
          <div class="message-layout message-layout--mine">
            <div class="message-avatar">
              {#if uploadAvatar}
                <img src={uploadAvatar} alt={uploadName} loading="lazy" />
              {:else}
                <span>{initialsFor(uploadName)}</span>
              {/if}
            </div>
            <div class="message-content message-content--mine">
              <div class="message-body">
                <div class={`chat-file chat-file--mine chat-file--upload ${upload.isImage ? 'chat-file--image' : 'chat-file--document'}`}>
                  <div class={`chat-file__card chat-file__card--upload ${upload.isImage ? 'chat-file__card--image' : 'chat-file__card--generic'}`}>
                    {#if upload.isImage && upload.previewUrl}
                      <div class="chat-file__preview">
                        <img src={upload.previewUrl} alt={upload.name} loading="lazy" />
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
                    <div class="chat-upload-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={uploadPercent}>
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
  <button type="button" class="reaction-menu-backdrop" aria-label="Close reactions" onclick={closeReactionMenu}></button>
  <div
    class="reaction-menu"
    bind:this={reactionMenuEl}
    style={`top: ${reactionMenuPosition.top}px; left: ${reactionMenuPosition.left}px`}
  >
    <div class="reaction-grid">
      {#each QUICK_REACTIONS as emoji}
        <button type="button" class="reaction-button" onclick={() => chooseReaction(reactionMenuFor!, emoji)}>{emoji}</button>
      {/each}
    </div>
  </div>
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
    <button type="button" class="image-preview-dismiss" aria-label="Close preview" onclick={closePreview}></button>
    <div class="image-preview-panel">
      <button type="button" class="image-preview-close" aria-label="Close preview" onclick={closePreview}>
        <i class="bx bx-x" aria-hidden="true"></i>
      </button>
      <div class="image-preview-media">
        <img src={previewAttachment.url} alt={previewAttachment.name ?? 'Image preview'} loading="eager" />
      </div>
      <div class="image-preview-meta">
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
      </div>
    </div>
  </div>
{/if}


