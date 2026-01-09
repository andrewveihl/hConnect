<script lang="ts">
import { createEventDispatcher, onMount } from 'svelte';
import MessageList from '$lib/components/chat/MessageList.svelte';
import ChatInput from '$lib/components/chat/ChatInput.svelte';
import type { MentionDirectoryEntry } from '$lib/firestore/membersDirectory';
import type { PinnedMessage, ReplyReferenceInput } from '$lib/firestore/messages';
import type { PendingUploadPreview } from '$lib/components/chat/types';
import ChannelPinnedBar from '$lib/components/servers/ChannelPinnedBar.svelte';

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
		onSend?: (
			value: string | { text: string; mentions?: any[]; replyTo?: ReplyReferenceInput | null }
		) => void;
		onSendGif?: (payload: { url: string; replyTo?: ReplyReferenceInput | null }) => void;
		onCreatePoll?: (payload: {
			question: string;
			options: string[];
			replyTo?: ReplyReferenceInput | null;
		}) => void;
		onCreateForm?: (payload: {
			title: string;
			questions: string[];
			replyTo?: ReplyReferenceInput | null;
		}) => void;
		onUploadFiles?: (payload: { files: File[]; replyTo?: ReplyReferenceInput | null }) => void;
		pendingUploads?: PendingUploadPreview[];
		scrollToBottomSignal?: number;
		scrollToMessageId?: string | null;
		replyTarget?: ReplyReferenceInput | null;
		scrollContextKey?: string | number;
		empty?: import('svelte').Snippet;
		/** Whether the current user is a Ticket AI staff member */
		isTicketAiStaff?: boolean;
		/** Server ID for ticket creation */
		serverId?: string | null;
		/** Channel ID for ticket creation */
		channelId?: string | null;
		/** Thread ID for ticket creation */
		threadId?: string | null;
		/** Set of message IDs that already have tickets */
		ticketedMessageIds?: Set<string>;
		/** Callback when a ticket is created */
		onTicketCreated?: (event: CustomEvent<{ messageId: string; ticketId?: string }>) => void;
		/** Callback when a ticket creation fails */
		onTicketError?: (event: CustomEvent<{ messageId: string; error?: string }>) => void;
		pinnedMessageIds?: Set<string>;
		canPinMessages?: boolean;
		pinnedMessages?: PinnedMessage[];
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
		scrollToMessageId = null,
		replyTarget = null,
		scrollContextKey = 'channel-pane',
		empty,
		isTicketAiStaff = false,
		serverId = null,
		channelId = null,
		threadId = null,
		ticketedMessageIds = new Set<string>(),
		onTicketCreated = () => {},
		onTicketError = () => {},
		pinnedMessageIds = new Set<string>(),
		canPinMessages = false,
		pinnedMessages = []
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

<div class="channel-message-pane">
	{#if hasChannel}
		<div class="message-pane-shell">
			{#if pinnedMessages?.length}
				<div class="pinned-fab">
					<ChannelPinnedBar
						items={pinnedMessages}
						canManagePins={canPinMessages}
						on:open={(event) => dispatch('pinnedOpen', event.detail)}
						on:unpin={(event) => dispatch('pinnedUnpin', event.detail)}
					/>
				</div>
			{/if}
			<div class={listClass} style={scrollRegionStyle}>
				{#key scrollContextKey ?? 'channel-pane'}
					<MessageList
						{messages}
						users={profiles}
						{currentUserId}
						replyTargetId={replyTarget?.messageId ?? null}
						{threadStats}
						{pendingUploads}
						scrollToBottomSignal={combinedScrollSignal}
						{scrollToMessageId}
						{isTicketAiStaff}
						{serverId}
						{channelId}
						{threadId}
						{ticketedMessageIds}
						on:vote={onVote}
						on:submitForm={onSubmitForm}
						on:react={onReact}
						on:loadMore={onLoadMore}
						on:atBottom={(event) => dispatch('atBottom', event.detail)}
						on:reply={(event: CustomEvent<any>) => dispatch('reply', event.detail)}
						on:thread={(event: CustomEvent<any>) => dispatch('thread', event.detail)}
						on:ticketCreated={onTicketCreated}
						on:ticketError={onTicketError}
						{pinnedMessageIds}
						canPinMessages={canPinMessages}
					/>
				{/key}
			</div>
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
					{conversationContext}
					{aiAssistEnabled}
					threadLabel={threadLabel || channelName}
					{onSend}
					{onSendGif}
					{onCreatePoll}
					{onCreateForm}
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
</div>

<style>
	.channel-message-pane {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		width: 100%;
	}

	.message-pane-shell {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		width: 100%;
	}

	.pinned-fab {
		position: absolute;
		left: 0.5rem;
		top: 0.35rem;
		z-index: 5;
	}

	.pinned-fab :global(.pinned-bar) {
		padding: 0;
		border: none;
		background: transparent;
	}

	.pinned-fab :global(.pinned-pill) {
		background: color-mix(in srgb, var(--color-panel) 70%, transparent);
	}

	.pinned-fab :global(.pinned-menu) {
		left: 0;
		right: auto;
	}
</style>
