<svelte:options runes={false} />

<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';

  import MessageList from './MessageList.svelte';
  import ChatInput from './ChatInput.svelte';
  import type { PendingUploadPreview } from './types';
  import type { MentionDirectoryEntry } from '$lib/firestore/membersDirectory';
  import type { ReplyReferenceInput } from '$lib/firestore/messages';
  import {
    requestThreadSummary,
    type ThreadSummaryItem,
    type ThreadSummaryMessage
  } from '$lib/api/ai';
  import type { ChannelThread } from '$lib/firestore/threads';

  interface Props {
    root?: any | null;
    messages?: any[];
    users?: Record<string, any>;
    currentUserId?: string | null;
    mentionOptions?: MentionDirectoryEntry[];
    pendingUploads?: PendingUploadPreview[];
    aiAssistEnabled?: boolean;
    threadLabel?: string | null;
    conversationContext?: any[] | null;
    replyTarget?: ReplyReferenceInput | null;
    defaultSuggestionSource?: any | null;
    members?: Array<{ uid: string; displayName?: string | null; photoURL?: string | null }>;
    threadStatus?: ChannelThread['status'] | null;
  }
  export let root: any | null = null;
  export let messages: any[] = [];
  export let users: Record<string, any> = {};
  export let currentUserId: string | null = null;
  export let mentionOptions: MentionDirectoryEntry[] = [];
  export let pendingUploads: PendingUploadPreview[] = [];
  export let aiAssistEnabled = false;
  export let threadLabel = '';
  export let conversationContext: any[] = [];
  export let replyTarget: ReplyReferenceInput | null = null;
  export let defaultSuggestionSource: any = null;
  export let members: Array<{ uid: string; displayName?: string | null; photoURL?: string | null }> =
    [];
  export let threadStatus: ChannelThread['status'] | null = null;

  const dispatch = createEventDispatcher();

  let scrollSignal = 0;
  let summary: ThreadSummaryItem[] = [];
  let summaryLoading = false;
  let summaryError: string | null = null;
  let summarySuggested = false;
  let lastMessageMillis: number | null = null;
  let idleHours = 0;
  let summaryPayload: ThreadSummaryMessage[] = [];
  let shouldSuggestSummary = false;

  const pickString = (value: any) => (typeof value === 'string' ? value.trim() : '');

  const rootPreview = () => {
    const activeRoot = root;
    return activeRoot
      ? pickString(activeRoot?.text) ??
          pickString(activeRoot?.content) ??
          pickString(activeRoot?.preview) ??
          pickString(activeRoot?.poll?.question) ??
          pickString(activeRoot?.form?.title) ??
          ''
      : '';
  };

  const rootAuthor = () => {
    const activeRoot = root;
    return activeRoot
      ? pickString(activeRoot?.displayName) ||
          pickString(activeRoot?.authorName) ||
          pickString(activeRoot?.author?.displayName) ||
          'Someone'
      : '';
  };

  const initialsFor = (value: string | null | undefined) => {
    const str = pickString(value) ?? '';
    if (!str) return '?';
    const parts = str.split(/\s+/).filter(Boolean);
    if (!parts.length) return str[0]?.toUpperCase() ?? '?';
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  };

  $: {
    if (!messages.length) {
      lastMessageMillis = null;
    } else {
      const last = messages[messages.length - 1];
      const raw = last?.createdAt;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        lastMessageMillis = raw;
      } else if (raw?.toMillis) {
        lastMessageMillis = raw.toMillis();
      } else {
        try {
          const date = new Date(raw);
          const time = date.getTime();
          lastMessageMillis = Number.isFinite(time) ? time : null;
        } catch {
          lastMessageMillis = null;
        }
      }
    }
  }

  $: {
    idleHours = lastMessageMillis
      ? Math.max(0, (Date.now() - lastMessageMillis) / (1000 * 60 * 60))
      : 0;
  }

  $: {
    const combined = [...(root ? [root] : []), ...messages];
    summaryPayload = combined.slice(-20).map((entry) => ({
      id: entry?.id ?? entry?.messageId ?? null,
      messageId: entry?.messageId ?? entry?.id ?? null,
      author:
        pickString(entry?.displayName) ||
        pickString(entry?.author?.displayName) ||
        pickString(entry?.authorName) ||
        pickString(entry?.uid),
      text: pickString(entry?.text) || pickString(entry?.content) || pickString(entry?.preview),
      createdAt: entry?.createdAt?.toMillis?.() ? entry.createdAt.toMillis() : entry?.createdAt ?? null
    }));
  }

  $: {
    shouldSuggestSummary =
      !summary.length && !summaryLoading && !summaryError && messages.length >= 4 && idleHours >= 1;
  }

  $: {
    const count = messages.length;
    if (count >= 0) {
      scrollSignal = Date.now();
    }
  }

  onDestroy(() => {
    summary = [];
    summaryError = null;
    summaryLoading = false;
  });

  function handleClose() {
    dispatch('close');
  }

  function handleSend(event: CustomEvent<any>) {
    dispatch('send', event.detail);
  }

  function handleSendGif(event: CustomEvent<any>) {
    dispatch('sendGif', event.detail);
  }

  function handleUpload(event: CustomEvent<any>) {
    dispatch('upload', event.detail);
  }

  function handleCreatePoll(event: CustomEvent<any>) {
    dispatch('createPoll', event.detail);
  }

  function handleCreateForm(event: CustomEvent<any>) {
    dispatch('createForm', event.detail);
  }

  function handleCancelReply() {
    dispatch('cancelReply');
  }

  function handleReply(event: CustomEvent<any>) {
    dispatch('reply', event.detail);
  }

  function scrollToMessage(messageId: string | null | undefined) {
    if (!messageId) return;
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`.thread-pane__messages [data-message-id="${messageId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('is-highlighted');
        setTimeout(() => el.classList.remove('is-highlighted'), 1500);
      }
    });
  }

  async function generateSummary() {
    if (!summaryPayload.length) {
      summaryError = 'No messages to summarize.';
      return;
    }
    summaryLoading = true;
    summaryError = null;
    try {
      const response = await requestThreadSummary(
        {
          threadId: pickString(root?.id) || undefined,
          idleHours,
          messages: summaryPayload
        },
        undefined
      );
      summary = response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summaryError = message;
    } finally {
      summaryLoading = false;
      summarySuggested = true;
    }
  }
</script>

<section class="thread-pane" aria-label="Thread conversation">
  <div class="thread-pane__body">
    <header class="thread-pane__header">
      <div>
        <div class="thread-pane__eyebrow">Thread</div>
        <div class="thread-pane__title">{rootPreview() || 'Conversation'}</div>
        <div class="thread-pane__subtitle">Started by {rootAuthor() || 'someone'}</div>
      </div>
      <div class="thread-pane__actions">
        {#if threadStatus === 'archived'}
          <span class="thread-status-badge">Archived</span>
        {/if}
        <button type="button" class="thread-pane__close" aria-label="Back to channel" onclick={handleClose}>
          <i class="bx bx-arrow-back"></i>
          <span>Back</span>
        </button>
      </div>
    </header>

    {#if members.length}
      <div class="thread-pane__members" aria-label="Thread members">
        {#each members as member (member.uid)}
          <div class="thread-pane__member" title={member.displayName ?? member.uid}>
            {#if member.photoURL}
              <img src={member.photoURL} alt={member.displayName ?? member.uid} loading="lazy" />
            {:else}
              <span>{initialsFor(member.displayName ?? member.uid)}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <section class="thread-summary">
      <div class="thread-summary__header">
        <div>
          <div class="thread-summary__label">Smart summary</div>
          <p>Catch up on the highlights after quiet hours.</p>
        </div>
        <button
          type="button"
          class="thread-summary__action"
          onclick={generateSummary}
          disabled={summaryLoading}
        >
          {summaryLoading ? 'Summarizing…' : 'Generate'}
        </button>
      </div>
      {#if summaryError}
        <div class="thread-summary__error">{summaryError}</div>
      {/if}
      {#if summary.length}
        <ul class="thread-summary__list">
          {#each summary as item, idx (item.messageId ?? `${idx}-${item.title ?? 'summary'}`)}
            <li>
              <button type="button" class="thread-summary__item" onclick={() => scrollToMessage(item.messageId)}>
                <div class="thread-summary__item-title">{item.title}</div>
                <div class="thread-summary__item-body">{item.details}</div>
              </button>
            </li>
          {/each}
        </ul>
      {:else if shouldSuggestSummary && !summarySuggested}
        <div class="thread-summary__hint">It’s been quiet for a while—tap generate to get a recap.</div>
      {/if}
    </section>

    <div class="thread-pane__messages">
      <MessageList
        messages={[...(root ? [root] : []), ...messages.filter((msg) => msg?.id !== root?.id)]}
        {users}
        {currentUserId}
        hideReplyPreview={true}
        scrollToBottomSignal={scrollSignal}
        pendingUploads={pendingUploads}
        threadStats={{}}
        on:reply={handleReply}
      />
    </div>
  </div>

  <div class="thread-pane__composer">
    <div class="thread-compose-surface">
      <ChatInput
        placeholder="Reply in thread"
        {mentionOptions}
        {aiAssistEnabled}
        {threadLabel}
        conversationContext={conversationContext}
        replyTarget={replyTarget}
        defaultSuggestionSource={defaultSuggestionSource}
        on:send={handleSend}
        on:sendGif={handleSendGif}
        on:upload={handleUpload}
        on:createPoll={handleCreatePoll}
        on:createForm={handleCreateForm}
        on:cancelReply={handleCancelReply}
      />
    </div>
  </div>
</section>

<style>
  .thread-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: color-mix(in srgb, var(--color-panel) 98%, transparent);
    border-left: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
  }

  .thread-pane__body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .thread-pane__header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.25rem 1.5rem 0.75rem;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
  }

  .thread-pane__eyebrow {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.25em;
    color: var(--text-60);
    margin-bottom: 0.2rem;
  }

  .thread-pane__title {
    font-size: clamp(1rem, 2vw, 1.25rem);
    font-weight: 700;
    color: var(--color-text-primary);
    margin-bottom: 0.2rem;
  }

  .thread-pane__subtitle {
    font-size: 0.85rem;
    color: var(--text-60);
  }

  .thread-pane__actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .thread-pane__close {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    background: transparent;
    color: var(--color-text-primary);
    padding: 0.35rem 0.85rem;
    font-weight: 600;
  }

  .thread-pane__close:hover,
  .thread-pane__close:focus-visible {
    background: color-mix(in srgb, var(--color-border-subtle) 25%, transparent);
    outline: none;
  }

  .thread-pane__members {
    display: flex;
    gap: 0.35rem;
    padding: 0.9rem 1.5rem 0;
    flex-wrap: wrap;
  }

  .thread-pane__member {
    width: 36px;
    height: 36px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
    display: grid;
    place-items: center;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-70);
    background: color-mix(in srgb, var(--color-panel-muted) 90%, transparent);
    overflow: hidden;
  }

  .thread-pane__member img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thread-summary {
    padding: 1rem 1.5rem;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .thread-summary__header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
  }

  .thread-summary__label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .thread-summary__header p {
    margin: 0.15rem 0 0;
    font-size: 0.85rem;
    color: var(--text-60);
  }

  .thread-summary__action {
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    background: transparent;
    color: var(--color-text-primary);
    padding: 0.35rem 1rem;
    font-weight: 600;
  }

  .thread-summary__action:disabled {
    opacity: 0.6;
  }

  .thread-summary__action:not(:disabled):hover,
  .thread-summary__action:not(:disabled):focus-visible {
    background: color-mix(in srgb, var(--color-border-subtle) 35%, transparent);
    outline: none;
  }

  .thread-summary__error {
    font-size: 0.85rem;
    color: var(--color-danger, #ff9a9a);
  }

  .thread-summary__hint {
    font-size: 0.85rem;
    color: var(--text-65);
  }

  .thread-summary__list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .thread-summary__item {
    width: 100%;
    text-align: left;
    border-radius: 0.85rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    background: color-mix(in srgb, var(--color-panel-muted) 90%, transparent);
    padding: 0.65rem 0.8rem;
  }

  .thread-summary__item-title {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--color-text-primary);
    margin-bottom: 0.15rem;
  }

  .thread-summary__item-body {
    font-size: 0.85rem;
    color: var(--text-65);
  }

  .thread-pane__messages {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
  }

  .thread-pane__messages :global(.chat-scroll) {
    padding: 1rem;
  }

  .thread-pane__messages :global(.thread-chip) {
    display: none;
  }

  .thread-pane__messages :global(.message-block.is-highlighted) {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 40%, transparent);
  }

  .thread-pane__composer {
    border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    background: color-mix(in srgb, var(--color-panel) 96%, transparent);
  }

  .thread-compose-surface {
    padding: 0.75rem 1rem 1rem;
  }

  .thread-compose-surface :global(.chat-input-root) {
    width: 100%;
  }
</style>
