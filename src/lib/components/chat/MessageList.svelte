<script lang="ts">
  import { afterUpdate, createEventDispatcher, onMount, tick } from 'svelte';

  const dispatch = createEventDispatcher();

  type MentionView = {
    uid: string;
    handle?: string | null;
    label?: string | null;
    color?: string | null;
    kind?: 'member' | 'role';
  };

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
    | (BaseChatMessage & { form: { title: string; questions: string[] }; type: 'form' });

  export let messages: ChatMessage[] = [];
  export let users: Record<string, any> = {};
  export let currentUserId: string | null = null;
  export let scrollToBottomSignal = 0;

  let scroller: HTMLDivElement;
  let isRequestingMore = false;
  let lastScrollSignal = 0;

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
  };

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

  function mentionSegments(text: string, mentions?: MentionView[]) {
    const value = typeof text === 'string' ? text : '';
    if (!value) return [{ type: 'text', value: '' }];
    if (!mentions?.length) return [{ type: 'text', value }];
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

    mentions.forEach((mention) => {
      register(mention.handle ?? null, mention);
      if (mention.label) {
        register(mention.label, mention);
        register(mention.label.replace(/\s+/g, ''), mention);
        const first = mention.label.split(/\s+/).filter(Boolean)[0];
        if (first) register(first, mention);
      }
    });

    const segments: Array<{ type: 'text' | 'mention'; value: string; data?: MentionView }> = [];
    const regex = /@[\p{L}\p{N}._-]+/gu;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(value))) {
      const start = match.index;
      if (start > lastIndex) {
        segments.push({ type: 'text', value: value.slice(lastIndex, start) });
      }
      const token = match[0];
      const canonicalKey = `@${canonicalMentionToken(token)}`;
      const mention =
        lookup.get(token.toLowerCase()) ?? lookup.get(token) ?? lookup.get(canonicalKey);
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

  const PREVIEW_LIMIT = 140;

  function clipPreview(value: string | null | undefined, limit = PREVIEW_LIMIT) {
    if (!value) return '';
    return value.length > limit ? `${value.slice(0, limit - 1)}â€¦` : value;
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

  function handleReplyClick(event: MouseEvent, message: ChatMessage) {
    if (shouldIgnoreReplyIntent(event.target)) return;
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
  afterUpdate(() => {
    if (messages.length !== lastLen) {
      lastLen = messages.length;
      scrollToBottom('smooth');
    }
    if (reactionMenuFor && !messages.some((msg) => msg?.id === reactionMenuFor)) {
      reactionMenuFor = null;
    }
  });

  $: if (scrollToBottomSignal && scrollToBottomSignal !== lastScrollSignal) {
    lastScrollSignal = scrollToBottomSignal;
    tick().then(() => scrollToBottom('auto'));
  }

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

  let hasHoverSupport = true;
  let hoveredMessageId: string | null = null;
  let hoveredMinuteKey: string | null = null;
  let reactionMenuFor: string | null = null;
  let reactionMenuAnchor: HTMLElement | null = null;
  let reactionMenuEl: HTMLDivElement | null = null;
  let reactionMenuPosition = { top: 0, left: 0 };
  let longPressTimer: number | null = null;
  let longPressStart: { x: number; y: number } | null = null;
  let longPressTarget: HTMLElement | null = null;

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
    longPressTarget = null;
  }

  function handlePointerDown(event: PointerEvent, messageId: string) {
    if (event.pointerType !== 'touch') return;
    clearLongPressTimer();
    longPressStart = { x: event.clientX, y: event.clientY };
    longPressTarget = event.currentTarget as HTMLElement;
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null;
      openReactionMenu(messageId, longPressTarget);
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
    if (scroller.scrollTop <= 64 && !isRequestingMore) {
      isRequestingMore = true;
      dispatch('loadMore');
      setTimeout(() => (isRequestingMore = false), 500);
    }
  }

  let formDrafts: Record<string, string[]> = {};

  $: {
    for (const m of messages) {
      if (m && (m as any).type === 'form' && (m as any).form?.questions) {
        const len = (m as any).form.questions.length;
        if (!formDrafts[m.id] || formDrafts[m.id].length !== len) {
          formDrafts[m.id] = Array(len).fill('');
        }
      }
    }
  }

  function submitForm(m: any) {
    const answers = (formDrafts[m.id] ?? []).map((a: string) => a.trim());
    dispatch('submitForm', { messageId: m.id, form: m.form, answers });
    formDrafts[m.id] = Array(m.form.questions.length).fill('');
  }

  const formInputId = (mId: string, idx: number) => `form-${mId}-${idx}`;
</script>

<style>
  .chat-scroll {
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
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .message-content--mine {
    align-items: flex-end;
    text-align: right;
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
    font-size: 0.75rem;
    color: var(--text-55);
    padding: 0 0.35rem;
    margin-top: 0.15rem;
    line-height: 1.1;
    min-height: 1rem;
    display: flex;
    align-items: center;
    transition: opacity 150ms ease, transform 150ms ease;
  }

  .message-inline-timestamp--mine {
    text-align: right;
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
    position: relative;
    align-items: flex-start;
  }

  .message-body--continued {
    margin-top: 0.04rem;
    gap: 0.12rem;
  }

  .message-content--mine .message-body {
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
    box-shadow: 0 8px 18px rgba(9, 12, 16, 0.22);
    transition: background 120ms ease, border 120ms ease, color 120ms ease, box-shadow 120ms ease;
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
    color: var(--color-accent);
    font-weight: 600;
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
    border-radius: 999px;
    padding: 0.05rem 0.4rem;
    line-height: 1.2;
  }

  .chat-mention--role {
    font-weight: 700;
    border-color: currentColor;
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

  .reaction-button.Custom…{
    font-size: 0.85rem;
    font-weight: 600;
  }

  .reaction-button:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.4);
    outline-offset: 2px;
  }

  .reaction-button:hover {
    background: rgba(255, 255, 255, 0.16);
    transform: translateY(-1px);
  }

  .reaction-menu__actions {
    margin-top: 0.75rem;
    display: flex;
    justify-content: flex-end;
  }

  .reaction-menu__action {
    border-radius: 999px;
    border: 0;
    padding: 0.35rem 1rem;
    font-weight: 600;
    background: var(--color-accent);
    color: var(--color-text-inverse);
    font-size: 0.85rem;
    transition: background 120ms ease, transform 120ms ease;
  }

  .reaction-menu__action:hover,
  .reaction-menu__action:focus-visible {
    background: var(--color-accent-strong);
    transform: translateY(-1px);
    outline: none;
  }
</style>

<div
  bind:this={scroller}
  class="h-full overflow-auto px-3 sm:px-4 py-4 space-y-2 chat-scroll"
  style:padding-bottom="var(--chat-scroll-padding, calc(env(safe-area-inset-bottom, 0px) + 1rem))"
  on:scroll={handleScroll}
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
      {@const mine = isMine(m)}
      {@const continued = i > 0 && sameBlock(messages[i - 1], m)}
      {@const firstInBlock = !continued}
      {@const reactions = reactionsFor(m)}
      {@const hasReactions = reactions.length > 0}
      {@const sameMinuteAsPrev = i > 0 && sameMinute(messages[i - 1], m)}
      {@const sameMinuteAsNext = i < messages.length - 1 && sameMinute(m, messages[i + 1])}
      {@const minuteKey = minuteKeyFor(m)}
      {@const minuteHovered = minuteKey && hoveredMinuteKey === minuteKey}
      {@const showAdd = Boolean(
        currentUserId &&
        (
          (hasHoverSupport && hoveredMessageId === m.id) ||
          reactionMenuFor === m.id
        )
      )}
      {@const showTimestampMobile = !hasHoverSupport && reactionMenuFor === m.id}
      {@const replyRef = (m as any).replyTo ?? null}
      <div
        class={`flex w-full ${mine ? 'justify-end' : 'justify-start'}`}
        data-message-id={m.id}
        on:pointerenter={() => onMessagePointerEnter(m.id, minuteKey)}
        on:pointerleave={() => { onMessagePointerLeave(m.id, minuteKey); handlePointerUp(); }}
        on:focusin={() => onMessageFocusIn(m.id, minuteKey)}
        on:focusout={(event) => onMessageFocusOut(m.id, minuteKey, event)}
        on:pointerdown={(event) => handlePointerDown(event, m.id)}
        on:pointermove={handlePointerMove}
        on:pointerup={handlePointerUp}
        on:pointercancel={handlePointerUp}
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
              <div
                class={`message-body ${continued ? 'message-body--continued' : ''}`}
                on:click={(event) => handleReplyClick(event, m)}
              >
                {#if currentUserId}
                  <button
                    type="button"
                    class={`reaction-add reaction-add-floating ${mine ? 'reaction-add-floating--mine' : 'reaction-add-floating--other'} ${showAdd ? 'is-visible' : ''}`}
                    disabled={!showAdd}
                    aria-hidden={!showAdd}
                    on:click={(event) => onAddReactionClick(event, m.id)}
                    on:pointerdown={(event) => { event.stopPropagation(); clearLongPressTimer(); }}
                    aria-label="Add reaction"
                  >
                    +
                  </button>
                {/if}
                {#if replyRef}
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
                {#if !m.type || m.type === 'text'}
                  <div class={`message-bubble ${mine ? 'message-bubble--mine' : 'message-bubble--other'} ${firstInBlock ? (mine ? 'message-bubble--first-mine' : 'message-bubble--first-other') : ''}`}>
                    {#each mentionSegments((m as any).text ?? (m as any).content ?? '', (m as any).mentions) as segment, segIdx (segIdx)}
                      {#if segment.type === 'mention'}
                        {@const label = segment.data?.label ?? segment.value.replace(/^@/, '')}
                        <span
                          class={`chat-mention ${segment.data?.kind === 'role' ? 'chat-mention--role' : ''}`}
                          style={segment.data?.kind === 'role' && segment.data?.color
                            ? `color:${segment.data.color};background:color-mix(in srgb, ${segment.data.color} 20%, transparent);border-color:color-mix(in srgb, ${segment.data.color} 35%, transparent);`
                            : undefined}
                        >
                          {label}
                        </span>
                      {:else}
                        {segment.value}
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
                {:else if m.type === 'file' && (m as any).file}
                  <a
                    class={`inline-flex items-center gap-2 underline hover:no-underline text-sm ${mine ? 'justify-end ml-auto' : ''}`}
                    href={(m as any).file.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>[file]</span>
                    <span>{(m as any).file.name}</span>
                    {#if (m as any).file.size}
                      <span class="text-soft">({Math.round(((m as any).file.size || 0) / 1024)} KB)</span>
                    {/if}
                  </a>
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
                            <button class="rounded-full px-3 py-1 hover:bg-white/10" on:click={() => dispatch('vote', { messageId: m.id, optionIndex: idx })}>Vote</button>
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
                        on:click={() => submitForm(m)}
                      >
                        Submit
                      </button>
                    </div>
                  </div>
                {/if}
              </div>
              {#if (m as any).createdAt && !sameMinuteAsNext}
                <div
                  class={`message-inline-timestamp ${mine ? 'message-inline-timestamp--mine' : ''} ${showTimestampMobile ? 'is-mobile-visible' : ''}`}
                  aria-hidden={!hasHoverSupport && !showTimestampMobile}
                >
                  {formatTime((m as any).createdAt)}
                </div>
              {/if}

              {#if reactions.length || currentUserId}
                <div
                  class="reaction-row"
                  style={`margin-top: ${hasReactions ? (continued ? 0.15 : 0.4) : 0}rem;`}
                >
                  <div class="reaction-list">
                    {#each reactions as reaction (reaction.key)}
                      <button
                        type="button"
                        class={`reaction-chip ${reaction.mine ? 'active' : ''}`}
                        on:click={() => toggleReaction(m.id, reaction.emoji)}
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
    {/each}
  {/if}
</div>

{#if reactionMenuFor && currentUserId}
  <button type="button" class="reaction-menu-backdrop" aria-label="Close reactions" on:click={closeReactionMenu}></button>
  <div
    class="reaction-menu"
    bind:this={reactionMenuEl}
    style={`top: ${reactionMenuPosition.top}px; left: ${reactionMenuPosition.left}px`}
  >
    <div class="reaction-grid">
      {#each QUICK_REACTIONS as emoji}
        <button type="button" class="reaction-button" on:click={() => chooseReaction(reactionMenuFor!, emoji)}>{emoji}</button>
      {/each}
      <button type="button" class="reaction-button custom" on:click={() => promptReaction(reactionMenuFor!)}>Custom…</button>
    </div>
    <div class="reaction-menu__actions">
      <button type="button" class="reaction-menu__action" on:click={() => chooseReply(reactionMenuFor!)}>Reply</button>
    </div>
  </div>
{/if}








