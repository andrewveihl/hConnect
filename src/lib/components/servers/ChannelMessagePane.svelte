<script lang="ts">
import { createEventDispatcher, onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';
import MessageList from '$lib/components/chat/MessageList.svelte';
import ChatInput from '$lib/components/chat/ChatInput.svelte';
import TypingIndicator from '$lib/components/chat/TypingIndicator.svelte';
import type { MentionDirectoryEntry } from '$lib/firestore/membersDirectory';
import type { PinnedMessage, ReplyReferenceInput } from '$lib/firestore/messages';
import type { PendingUploadPreview } from '$lib/components/chat/types';
import ChannelPinnedBar from '$lib/components/servers/ChannelPinnedBar.svelte';
import { featureFlags } from '$lib/stores/featureFlags';
import {
	subscribeToTyping,
	unsubscribeFromTyping,
	type TypingLocation,
	type TypingUser
} from '$lib/stores/typing';

	interface Props {
		hasChannel?: boolean;
		channelName?: string;
		messages?: any[];
		profiles?: Record<string, any>;
		currentUserId?: string | null;
		currentUserDisplayName?: string | null;
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
		replySource?: any | null;
		inputPlaceholder?: string;
		scrollContextKey?: string | number;
		empty?: import('svelte').Snippet;
		listOverlay?: import('svelte').Snippet;
		/** Whether the current user is a Ticket AI staff member */
		isTicketAiStaff?: boolean;
		/** Server ID for ticket creation */
		serverId?: string | null;
		/** Channel ID for ticket creation */
		channelId?: string | null;
		/** Thread ID for ticket creation */
		threadId?: string | null;
		/** DM thread ID (when rendering DMs) */
		dmThreadId?: string | null;
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
		currentUserDisplayName = null,
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
		replySource = null,
		inputPlaceholder = undefined,
		scrollContextKey = 'channel-pane',
		empty,
		listOverlay,
		isTicketAiStaff = false,
		serverId = null,
		channelId = null,
		threadId = null,
		dmThreadId = null,
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

	// Typing indicator logic
	const typingLocation = $derived.by((): TypingLocation | null => {
		if (dmThreadId) {
			return { type: 'dm', threadId: dmThreadId };
		}
		if (serverId && channelId) {
			return { type: 'channel', serverId, channelId, threadId };
		}
		return null;
	});

	const typingEnabled = $derived(
		Boolean($featureFlags.enableTypingIndicators && typingLocation && currentUserId)
	);

	let typingUsers = $state<TypingUser[]>([]);
	let typingUnsub: (() => void) | null = null;

	$effect(() => {
		const loc = typingLocation;
		const enabled = typingEnabled;
		const uid = currentUserId;

		console.log('[ChannelMessagePane] Typing effect running:', { 
			loc, 
			enabled, 
			uid, 
			dmThreadId,
			featureFlag: $featureFlags.enableTypingIndicators 
		});

		// Cleanup previous subscription
		if (typingUnsub) {
			typingUnsub();
			typingUnsub = null;
		}
		typingUsers = [];

		if (!enabled || !loc || !uid || !browser) {
			console.log('[ChannelMessagePane] Typing subscription skipped:', { enabled, loc: !!loc, uid: !!uid });
			return;
		}

		console.log('[ChannelMessagePane] Subscribing to typing at:', loc);
		// Subscribe to typing updates
		const store = subscribeToTyping(loc, uid);
		typingUnsub = store.subscribe((state) => {
			console.log('[ChannelMessagePane] Typing state update:', state.users);
			typingUsers = state.users;
		});

		return () => {
			if (typingUnsub) {
				typingUnsub();
				typingUnsub = null;
			}
			if (loc) unsubscribeFromTyping(loc);
		};
	});

	onDestroy(() => {
		if (typingUnsub) {
			typingUnsub();
			typingUnsub = null;
		}
		if (typingLocation) unsubscribeFromTyping(typingLocation);
	});

	const scrollRegionStyle = $derived(`--chat-input-height: ${Math.max(composerHeight, 0)}px`);
	
	// Detect if we're on desktop for DM chat input fix
	let isDesktop = $state(false);
	$effect(() => {
		if (browser) {
			const checkDesktop = () => {
				isDesktop = window.innerWidth >= 768;
			};
			checkDesktop();
			window.addEventListener('resize', checkDesktop);
			return () => window.removeEventListener('resize', checkDesktop);
		}
	});
	
	// Check if this is a DM context (has dmThreadId prop)
	const isDmChat = $derived(Boolean(dmThreadId));
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
					{dmThreadId}
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
				{#if listOverlay}{@render listOverlay()}{/if}
			</div>
		</div>
		{#if !hideInput}
			{#if isDmChat && isDesktop}
				<!-- Desktop DM: Render ChatInput as fixed element via portal to body -->
				{#await import('$lib/components/util/Portal.svelte') then Portal}
					<!-- Typing indicator positioned above the fixed chat input -->
					{#if typingUsers.length > 0}
						<Portal.default>
							<div class="dm-typing-indicator-floating">
								<TypingIndicator users={typingUsers} />
							</div>
						</Portal.default>
					{/if}
					<Portal.default>
						<div
							class="dm-desktop-chat-input"
							bind:this={composerEl}
						>
							<ChatInput
								placeholder={inputPlaceholder ?? `Message #${channelName}`}
								{mentionOptions}
								{replyTarget}
								{replySource}
								{defaultSuggestionSource}
								{conversationContext}
								{aiAssistEnabled}
								threadLabel={threadLabel || channelName}
								{typingLocation}
								{currentUserId}
								{currentUserDisplayName}
								{onSend}
								{onSendGif}
								{onCreatePoll}
								{onCreateForm}
								onUpload={onUploadFiles}
								on:cancelReply={() => dispatch('cancelReply')}
								on:focusInput={handleComposerFocus}
							/>
						</div>
					</Portal.default>
				{/await}
			{:else}
				<!-- Typing indicator above input for mobile/server channels -->
				{#if typingUsers.length > 0}
					<div class="typing-indicator-above-input">
						<TypingIndicator users={typingUsers} />
					</div>
				{/if}
				<!-- Normal rendering for mobile and server channels -->
				<div
					class={inputWrapperClass}
					bind:this={composerEl}
					style:padding-bottom={inputPaddingBottom ?? undefined}
				>
					<ChatInput
						placeholder={inputPlaceholder ?? `Message #${channelName}`}
						{mentionOptions}
						{replyTarget}
						{replySource}
						{defaultSuggestionSource}
						{conversationContext}
						{aiAssistEnabled}
						threadLabel={threadLabel || channelName}
						{typingLocation}
						{currentUserId}
						{currentUserDisplayName}
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
		min-width: 0;
		width: 100%;
	}

	.message-pane-shell {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		min-width: 0;
		width: 100%;
	}

	.typing-indicator-wrapper {
		flex-shrink: 0;
		pointer-events: none;
	}

	.typing-indicator-wrapper :global(.typing-indicator) {
		background: color-mix(in srgb, var(--color-panel) 90%, transparent);
		backdrop-filter: blur(4px);
		border-radius: 0.5rem 0.5rem 0 0;
		margin: 0 0.5rem;
		padding: 0.375rem 0.75rem;
	}

	.typing-indicator-above-input {
		flex-shrink: 0;
		padding: 0.25rem 0.75rem;
		pointer-events: none;
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

<!-- Global styles for portaled DM chat input -->
<svelte:head>
	<style>
		.dm-desktop-chat-input {
			position: fixed !important;
			bottom: 0 !important;
			left: 392px !important;
			right: 0 !important;
			z-index: 9999 !important;
			background: var(--color-panel-muted, #3a3f45) !important;
			border-top: 1px solid var(--color-border-subtle, rgba(18, 22, 28, 0.45)) !important;
			padding: 0.5rem 1rem !important;
		}

		/* Teal border line between DMs sidebar and chat area - extends full height */
		.dm-desktop-chat-input::before {
			content: '';
			position: fixed;
			top: 0;
			bottom: 0;
			left: 392px;
			width: 1px;
			background: var(--color-border-subtle);
			pointer-events: none;
			z-index: 10001;
		}
		
		/* DM typing indicator floating above the fixed chat input */
		.dm-typing-indicator-floating {
			position: fixed !important;
			bottom: 70px !important; /* Position above the chat input */
			left: 392px !important;
			right: 0 !important;
			z-index: 9998 !important;
			padding: 0.25rem 1rem 0.25rem 3.5rem !important; /* Extra left padding to align with input text */
			pointer-events: none;
		}
		
		/* Add bottom padding to DM message list so content isn't hidden behind fixed input */
		@media (min-width: 768px) {
			.dm-message-list {
				--chat-scroll-padding: 350px !important;
				padding-bottom: 350px !important;
			}
			
			/* Target the actual scrolling container inside */
			.dm-message-list .chat-scroll {
				padding-bottom: 350px !important;
			}
		}
	</style>
</svelte:head>
