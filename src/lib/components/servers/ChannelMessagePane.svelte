<script lang="ts">
  import { createEventDispatcher } from 'svelte';
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
    inputWrapperClass = 'chat-input-region shrink-0 border-t border-subtle panel-muted p-3',
    inputPaddingBottom = 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)',
    emptyMessage = 'Pick a channel to start chatting.',
    hideInput = false,
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
    empty
  }: Props = $props();

  const dispatch = createEventDispatcher();
</script>

{#if hasChannel}
  <div class={listClass}>
    <MessageList
      {messages}
      users={profiles}
      {currentUserId}
      {pendingUploads}
      {scrollToBottomSignal}
      on:vote={onVote}
      on:submitForm={onSubmitForm}
      on:react={onReact}
      on:loadMore={onLoadMore}
      on:reply={(event) => dispatch('reply', event.detail)}
    />
  </div>
  {#if !hideInput}
    <div class={inputWrapperClass} style:padding-bottom={inputPaddingBottom ?? undefined}>
      <ChatInput
        placeholder={`Message #${channelName}`}
        {mentionOptions}
        {replyTarget}
        onSend={onSend}
        onSendGif={onSendGif}
        onCreatePoll={onCreatePoll}
        onCreateForm={onCreateForm}
        onUpload={onUploadFiles}
        on:cancelReply={() => dispatch('cancelReply')}
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
