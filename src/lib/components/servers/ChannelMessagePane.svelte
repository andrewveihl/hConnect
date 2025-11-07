<script lang="ts">
  import MessageList from '$lib/components/chat/MessageList.svelte';
  import ChatInput from '$lib/components/chat/ChatInput.svelte';
  import type { MentionDirectoryEntry } from '$lib/firestore/membersDirectory';

  export let hasChannel = false;
  export let channelName = '';
  export let messages: any[] = [];
  export let profiles: Record<string, any> = {};
  export let currentUserId: string | null = null;
  export let mentionOptions: MentionDirectoryEntry[] = [];
  export let listClass =
    'message-scroll-region flex-1 overflow-hidden p-3 sm:p-4';
  export let inputWrapperClass =
    'chat-input-region shrink-0 border-t border-subtle panel-muted p-3';
  export let inputPaddingBottom =
    'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)';
  export let emptyMessage = 'Pick a channel to start chatting.';

  export let onVote: (event: CustomEvent<any>) => void = () => {};
  export let onSubmitForm: (event: CustomEvent<any>) => void = () => {};
  export let onReact: (event: CustomEvent<any>) => void = () => {};
  export let onLoadMore: () => void = () => {};
  export let onSend: (value: string) => void = () => {};
  export let onSendGif: (url: string) => void = () => {};
  export let onCreatePoll: () => void = () => {};
  export let onCreateForm: () => void = () => {};
</script>

{#if hasChannel}
  <div class={listClass}>
    <MessageList
      {messages}
      users={profiles}
      {currentUserId}
      on:vote={onVote}
      on:submitForm={onSubmitForm}
      on:react={onReact}
      on:loadMore={onLoadMore}
    />
  </div>
  <div class={inputWrapperClass} style:padding-bottom={inputPaddingBottom ?? undefined}>
    <ChatInput
      placeholder={`Message #${channelName}`}
      {mentionOptions}
      onSend={onSend}
      onSendGif={onSendGif}
      onCreatePoll={onCreatePoll}
      onCreateForm={onCreateForm}
    />
  </div>
{:else}
  <div class="flex-1 grid place-items-center text-soft">
    <slot name="empty">
      <div>{emptyMessage}</div>
    </slot>
  </div>
{/if}
