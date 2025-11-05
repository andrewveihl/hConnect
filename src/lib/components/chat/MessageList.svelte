<script lang="ts">
  import { afterUpdate, createEventDispatcher, onMount, tick } from 'svelte';

  const dispatch = createEventDispatcher();

  type ChatMessage =
    | { id: string; uid?: string; createdAt?: any; displayName?: string; text: string; type?: 'text' }
    | { id: string; uid?: string; createdAt?: any; displayName?: string; url: string; type: 'gif' }
    | { id: string; uid?: string; createdAt?: any; displayName?: string; file: { name: string; size?: number; url: string; contentType?: string }; type: 'file' }
    | { id: string; uid?: string; createdAt?: any; displayName?: string; poll: { question: string; options: string[]; votes?: Record<number, number> }; type: 'poll' }
    | { id: string; uid?: string; createdAt?: any; displayName?: string; form: { title: string; questions: string[] }; type: 'form' };

  export let messages: ChatMessage[] = [];
  export let users: Record<string, any> = {};
  export let currentUserId: string | null = null;

  let scroller: HTMLDivElement;
  let isRequestingMore = false;

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

  let lastLen = 0;
  afterUpdate(() => {
    if (messages.length !== lastLen) {
      lastLen = messages.length;
      scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    }
    if (reactionMenuFor && !messages.some((msg) => msg?.id === reactionMenuFor)) {
      reactionMenuFor = null;
    }
  });

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
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
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
    const menuWidth = menuRect?.width ?? 0;
    const menuHeight = menuRect?.height ?? 0;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = anchorRect.left;
    let top = anchorRect.bottom + 8;

    if (menuWidth) {
      if (left + menuWidth > viewportWidth - 8) {
        left = Math.max(8, viewportWidth - menuWidth - 8);
      }
      if (left < 8) left = 8;
    }

    if (menuHeight) {
      if (top + menuHeight > viewportHeight - 8) {
        top = Math.max(8, anchorRect.top - menuHeight - 8);
      }
      if (top < 8) top = 8;
    }

    reactionMenuPosition = { top, left };
  }

  function chooseReaction(messageId: string, emoji: string) {
    closeReactionMenu();
    toggleReaction(messageId, emoji);
  }

  function promptReaction(messageId: string) {
    if (typeof window === 'undefined') return;
    const input = window.prompt('React with an emoji (e.g., ??)');
    const emoji = sanitizeEmoji(input);
    if (!emoji) return;
    chooseReaction(messageId, emoji);
  }

  function onMessagePointerEnter(messageId: string) {
    if (!hasHoverSupport) return;
    hoveredMessageId = messageId;
  }

  function onMessagePointerLeave(messageId: string) {
    if (!hasHoverSupport) return;
    if (reactionMenuFor === messageId) return;
    hoveredMessageId = null;
  }

  function onMessageFocusIn(messageId: string) {
    hoveredMessageId = messageId;
  }

  function onMessageFocusOut(messageId: string, event: FocusEvent) {
    const next = event.relatedTarget as HTMLElement | null;
    if (next && next.closest?.(`[data-message-id="${messageId}"]`)) return;
    if (reactionMenuFor === messageId) return;
    hoveredMessageId = null;
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

  .reaction-menu {
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
  }

  .reaction-button:hover {
    background: rgba(255, 255, 255, 0.16);
  }
</style>

<div
  bind:this={scroller}
  class="h-full overflow-auto px-3 sm:px-4 py-4 space-y-3 chat-scroll"
  style:padding-bottom="calc(env(safe-area-inset-bottom, 0px) + 1rem)"
  on:scroll={handleScroll}
>
  {#if messages.length === 0}
    <div class="h-full grid place-items-center">
      <div class="text-center text-white/60 space-y-1">
        <div class="text-2xl font-semibold">Nothing yet</div>
        <div class="text-lg font-medium">No messages yet</div>
        <div class="text-sm">Be the first to say something below.</div>
      </div>
    </div>
  {:else}
    {#each messages as m, i (m.id)}
      {@const mine = isMine(m)}
      {@const continued = i > 0 && sameBlock(messages[i - 1], m)}
      {@const reactions = reactionsFor(m)}
      {@const showAdd = Boolean(
        currentUserId &&
        (
          (hasHoverSupport && hoveredMessageId === m.id) ||
          reactionMenuFor === m.id
        )
      )}
      <div
        class={`flex w-full ${mine ? 'justify-end' : 'justify-start'}`}
        data-message-id={m.id}
        on:pointerenter={() => onMessagePointerEnter(m.id)}
        on:pointerleave={() => { onMessagePointerLeave(m.id); handlePointerUp(); }}
        on:focusin={() => onMessageFocusIn(m.id)}
        on:focusout={(event) => onMessageFocusOut(m.id, event)}
        on:pointerdown={(event) => handlePointerDown(event, m.id)}
        on:pointermove={handlePointerMove}
        on:pointerup={handlePointerUp}
        on:pointercancel={handlePointerUp}
      >
        <div class={`flex w-full max-w-3xl items-end gap-3 ${mine ? 'flex-row-reverse text-right' : ''} ${continued ? 'pt-1' : 'pt-2'}`}>
          {#if continued}
            <div class="w-10"></div>
          {:else}
            <div class={`shrink-0 w-10 h-10 rounded-full border border-white/10 bg-white/10 overflow-hidden grid place-items-center ${mine ? 'ml-1' : ''}`}>
              {#if avatarUrlFor(m)}
                <img src={avatarUrlFor(m)} alt={nameFor(m)} class="w-full h-full object-cover" loading="lazy" />
              {:else}
                <span class="text-sm text-white/80">{initialsFor(nameFor(m))}</span>
              {/if}
            </div>
          {/if}

          <div class={`min-w-0 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
            {#if !continued}
              <div class={`flex flex-wrap items-baseline gap-x-2 ${mine ? 'justify-end text-right' : ''}`}>
                <span class={`font-semibold ${mine ? 'text-[#d9ddff]' : 'text-white'}`}>{mine ? 'You' : nameFor(m)}</span>
                <span class="text-xs text-white/50">{formatTime((m as any).createdAt)}</span>
              </div>
            {/if}

            <div class="mt-1 space-y-1 max-w-full">
              {#if !m.type || m.type === 'text'}
                <div class={`inline-block rounded-2xl px-3 py-2 whitespace-pre-wrap leading-relaxed break-words shadow-sm ${mine ? 'bg-[#5865f2] text-white' : 'bg-white/5 text-white/90'}`}>
                  {(m as any).text ?? (m as any).content ?? ''}
                </div>
              {:else if m.type === 'gif' && (m as any).url}
                <img
                  class={`chat-gif rounded-3xl ${mine ? 'mine' : ''}`}
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
                    <span class="text-white/60">({Math.round(((m as any).file.size || 0) / 1024)} KB)</span>
                  {/if}
                </a>
              {:else if m.type === 'poll' && (m as any).poll}
                {#await Promise.resolve((m as any).poll) then poll}
                  <div class={`rounded-2xl border border-white/10 p-3 bg-white/5 max-w-md ${mine ? 'ml-auto text-left' : ''}`}>
                    <div class="font-medium mb-2">Poll: {poll.question}</div>
                    {#each poll.options as opt, idx}
                      <div class="rounded-2xl border border-white/10 p-2 bg-white/5 mb-2">
                        <div class="flex items-center justify-between gap-2">
                          <div>{opt}</div>
                          <div class="text-sm text-white/60">{pct(poll.votes, idx)}%</div>
                        </div>
                        <div class="bar mt-2" style="color:#5865f2"><i style="width: {pct(poll.votes, idx)}%"></i></div>
                        <div class="mt-2 text-right">
                          <button class="rounded-full px-3 py-1 hover:bg-white/10" on:click={() => dispatch('vote', { messageId: m.id, optionIndex: idx })}>Vote</button>
                        </div>
                      </div>
                    {/each}
                    <div class="text-xs text-white/60 mt-1">{totalVotes(poll.votes)} vote{totalVotes(poll.votes) === 1 ? '' : 's'}</div>
                  </div>
                {/await}
              {:else if m.type === 'form' && (m as any).form}
                <div class={`rounded-2xl border border-white/10 p-3 bg-white/5 max-w-md ${mine ? 'ml-auto text-left' : ''}`}>
                  <div class="font-medium mb-2">Form: {(m as any).form.title}</div>
                  {#each (m as any).form.questions as q, qi}
                    {#key `${m.id}-${qi}`}
                      <label class="block text-sm mb-1" for={formInputId(m.id, qi)}>{qi + 1}. {q}</label>
                      <input id={formInputId(m.id, qi)} class="input w-full mb-3" bind:value={formDrafts[m.id][qi]} />
                    {/key}
                  {/each}
                  <div class="flex justify-end">
                    <button class="rounded-full px-4 py-2 bg-[#5865f2] hover:bg-[#4752c4]" on:click={() => submitForm(m)}>Submit</button>
                  </div>
                </div>
              {/if}
            </div>
            {#if reactions.length || currentUserId}
              <div class="mt-1 reaction-row">
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
                {#if showAdd}
                  <button
                    type="button"
                    class="reaction-add reaction-add-inline"
                    on:click={(event) => onAddReactionClick(event, m.id)}
                    on:pointerdown={(event) => { event.stopPropagation(); clearLongPressTimer(); }}
                    aria-label="Add reaction"
                  >
                    +
                  </button>
                {/if}
              </div>
            {/if}
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
    {#each QUICK_REACTIONS as emoji}
      <button type="button" on:click={() => chooseReaction(reactionMenuFor!, emoji)}>{emoji}</button>
    {/each}
    <button type="button" class="custom" on:click={() => promptReaction(reactionMenuFor!)}>Custom…</button>
  </div>
{/if}







