<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import MessageList from '$lib/components/chat/MessageList.svelte';
  import ChatInput from '$lib/components/chat/ChatInput.svelte';
  import type { MentionDirectoryEntry } from '$lib/firestore/membersDirectory';
  import type { ReplyReferenceInput } from '$lib/firestore/messages';
  import type { PendingUploadPreview } from '$lib/components/chat/types';



  interface Props {
    hasChannel?: boolean;
    channelName?: string;
    messages?: any[];
    profiles?: Record<string, any>;
    currentUserId?: string | null;
    mentionOptions?: MentionDirectoryEntry[];
    listClass?: string;
    inputWrapperClass?: string;
    inputPaddingBottom?: string;
    emptyMessage?: string;
    hideInput?: boolean;
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
    defaultSuggestionSource?: any | null;
    aiAssistEnabled?: boolean;
    threadLabel?: string | null;
    conversationContext?: any[] | null;
    onVote?: (event: CustomEvent<any>) => void;
    onSubmitForm?: (event: CustomEvent<any>) => void;
    onReact?: (event: CustomEvent<any>) => void;
    onLoadMore?: () => void;
    onSend?: (value: string | { text: string; mentions?: any[]; replyTo?: ReplyReferenceInput | null }) => void;
    onSendGif?: (payload: { url: string; replyTo?: ReplyReferenceInput | null }) => void;
    onCreatePoll?: (payload: { question: string; options: string[]; replyTo?: ReplyReferenceInput | null }) => void;
    onCreateForm?: (payload: { title: string; questions: string[]; replyTo?: ReplyReferenceInput | null }) => void;
    onUploadFiles?: (payload: { files: File[]; replyTo?: ReplyReferenceInput | null }) => void;
    pendingUploads?: PendingUploadPreview[];
    scrollToBottomSignal?: number;
    replyTarget?: ReplyReferenceInput | null;
    scrollContextKey?: string | number;
    empty?: import('svelte').Snippet;
  }

  let {
    hasChannel = false,
    channelName = '',
    messages = [],
    profiles = {},
    currentUserId = null,
    mentionOptions = [],
    listClass = 'message-scroll-region flex-1 overflow-hidden p-3 sm:p-4',
    inputWrapperClass = 'chat-input-region shrink-0 border-t border-subtle panel-muted',
    inputPaddingBottom = undefined,
    emptyMessage = 'Pick a channel to start chatting.',
    hideInput = false,
    threadStats = {},
    defaultSuggestionSource = null,
    aiAssistEnabled = false,
    threadLabel = '',
    conversationContext = [],
    onVote = () => {},
    onSubmitForm = () => {},
    onReact = () => {},
    onLoadMore = () => {},
    onSend = () => {},
    onSendGif = () => {},
    onCreatePoll = () => {},
    onCreateForm = () => {},
    onUploadFiles = () => {},
    pendingUploads = [],
    scrollToBottomSignal = 0,
    replyTarget = null,
    scrollContextKey = 'channel-pane',
    empty
  }: Props = $props();

  const dispatch = createEventDispatcher();

  let composerEl: HTMLDivElement | null = $state(null);
  let composerHeight = $state(0);
  let composerObserver: ResizeObserver | null = null;
  let mounted = false;
  let lastComposerEl: HTMLDivElement | null = null;
  let focusScrollSignal = $state(0);
  const combinedScrollSignal = $derived(scrollToBottomSignal + focusScrollSignal);

  function handleComposerFocus() {
    focusScrollSignal += 1;
  }

  function attachComposerObserver() {
    if (!mounted) return;
    composerObserver?.disconnect();
    if (composerEl && typeof ResizeObserver !== 'undefined') {
      composerObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        composerHeight = entry?.contentRect?.height ?? 0;
      });
      composerObserver.observe(composerEl);
    } else {
      composerObserver = null;
      composerHeight = 0;
    }
  }

  onMount(() => {
    mounted = true;
    attachComposerObserver();
    return () => {
      mounted = false;
      composerObserver?.disconnect();
      composerObserver = null;
    };
  });

  $effect(() => {
    if (!mounted || composerEl === lastComposerEl) return;
    lastComposerEl = composerEl;
    attachComposerObserver();
  });

  const scrollRegionStyle = $derived(`--chat-input-height: ${Math.max(composerHeight, 0)}px`);
</script>

{#if hasChannel}
  <div class={listClass} style={scrollRegionStyle}>
    {#key scrollContextKey ?? 'channel-pane'}
      <MessageList
        {messages}
        users={profiles}
        {currentUserId}
        replyTargetId={replyTarget?.messageId ?? null}
        threadStats={threadStats}
        {pendingUploads}
        scrollToBottomSignal={combinedScrollSignal}
        on:vote={onVote}
        on:submitForm={onSubmitForm}
        on:react={onReact}
        on:loadMore={onLoadMore}
        on:reply={(event: CustomEvent<any>) => dispatch('reply', event.detail)}
        on:thread={(event: CustomEvent<any>) => dispatch('thread', event.detail)}
      />
    {/key}
  </div>
  {#if !hideInput}
    <div
      class={inputWrapperClass}
      bind:this={composerEl}
      style:padding-bottom={inputPaddingBottom ?? undefined}
    >
      <ChatInput
        placeholder={`Message #${channelName}`}
        {mentionOptions}
        {replyTarget}
        {defaultSuggestionSource}
        conversationContext={conversationContext}
        aiAssistEnabled={aiAssistEnabled}
        threadLabel={threadLabel || channelName}
        onSend={onSend}
        onSendGif={onSendGif}
        onCreatePoll={onCreatePoll}
        onCreateForm={onCreateForm}
        onUpload={onUploadFiles}
        on:cancelReply={() => dispatch('cancelReply')}
        on:focusInput={handleComposerFocus}
      />
    </div>
  {/if}
{:else}
  <div class="flex-1 grid place-items-center text-soft">
    {#if empty}{@render empty()}{:else}
      <div>{emptyMessage}</div>
    {/if}
  </div>
{/if}
