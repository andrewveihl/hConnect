<svelte:options runes={false} />

<script lang="ts">
	import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';

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
	import { featureFlags } from '$lib/stores/featureFlags';

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
	export let members: Array<{
		uid: string;
		displayName?: string | null;
		photoURL?: string | null;
	}> = [];
	export let threadStatus: ChannelThread['status'] | null = null;
	export let parentChannelName: string | null = null;
	export let isMobileView = false;
	export let popoutEnabled = true;
	export let showCloseButton = true;

	const dispatch = createEventDispatcher();
	const MAX_VISIBLE_MEMBERS = 4;

	let summaryPanelOpen = false;
	let summaryButtonEl: HTMLButtonElement | null = null;
	let summaryPopoverEl: HTMLElement | null = null;

	$: memberList = Array.isArray(members) ? members : [];
	$: visibleMembers = memberList.slice(0, MAX_VISIBLE_MEMBERS);
	$: extraMemberCount = Math.max(0, memberList.length - visibleMembers.length);

	let scrollSignal = 0;
	let focusScrollSignal = 0;
	let summary: ThreadSummaryItem[] = [];
	let summaryLoading = false;
	let summaryError: string | null = null;
	let summarySuggested = false;
	let lastMessageMillis: number | null = null;
	let idleHours = 0;
	let summaryPayload: ThreadSummaryMessage[] = [];
	let shouldSuggestSummary = false;
	const featureFlagStore = featureFlags;
	let aiSummaryFlag = true;
	let summaryAvailable = true;
	$: aiSummaryFlag = Boolean(
		$featureFlagStore?.enableAIFeatures && $featureFlagStore?.enableAISummaries
	);
	$: summaryAvailable = Boolean(aiAssistEnabled && aiSummaryFlag);

	const pickString = (value: any) => (typeof value === 'string' ? value.trim() : '');

	const rootPreview = () => {
		const activeRoot = root;
		return activeRoot
			? (pickString(activeRoot?.text) ??
					pickString(activeRoot?.content) ??
					pickString(activeRoot?.preview) ??
					pickString(activeRoot?.poll?.question) ??
					pickString(activeRoot?.form?.title) ??
					'')
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

	function closeMenus() {
		summaryPanelOpen = false;
	}

	function handleSummarizeToggle() {
		if (!summaryAvailable) return;
		summaryPanelOpen = !summaryPanelOpen;
		if (summaryPanelOpen && !summary.length && !summaryLoading) {
			void generateSummary();
		}
	}

	const handleComposerFocus = () => {
		// Don't auto-scroll when focusing input - let users stay where they are while composing
		// focusScrollSignal += 1;
	};

	function handleDocumentPointerDown(event: PointerEvent) {
		const target = event.target as Node | null;
		if (
			summaryPanelOpen &&
			target &&
			!summaryPopoverEl?.contains(target) &&
			!summaryButtonEl?.contains(target)
		) {
			summaryPanelOpen = false;
		}
	}

	onMount(() => {
		document.addEventListener('pointerdown', handleDocumentPointerDown);
		return () => {
			document.removeEventListener('pointerdown', handleDocumentPointerDown);
		};
	});

	$: if (isMobileView) {
		summaryPanelOpen = false;
	}
	$: if (!summaryAvailable) {
		summaryPanelOpen = false;
	}

	const initialsFor = (value: string | null | undefined) => {
		const str = pickString(value) ?? '';
		if (!str) return '?';
		const parts = str.split(/\s+/).filter(Boolean);
		if (!parts.length) return str[0]?.toUpperCase() ?? '?';
		return parts
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('');
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
			createdAt: entry?.createdAt?.toMillis?.()
				? entry.createdAt.toMillis()
				: (entry?.createdAt ?? null)
		}));
	}

	$: {
		shouldSuggestSummary =
			summaryAvailable &&
			!summary.length &&
			!summaryLoading &&
			!summaryError &&
			messages.length >= 4 &&
			idleHours >= 1;
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
		closeMenus();
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
			const el = document.querySelector<HTMLElement>(
				`.thread-pane__messages [data-message-id="${messageId}"]`
			);
			if (el) {
				el.scrollIntoView({ behavior: 'smooth', block: 'center' });
				el.classList.add('is-highlighted');
				setTimeout(() => el.classList.remove('is-highlighted'), 1500);
			}
		});
	}

	async function generateSummary() {
		if (!summaryAvailable) return;
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
			<div class="thread-pane__header-left">
				{#if isMobileView}
					<button
						type="button"
						class="thread-pane__back"
						aria-label="Back to channel"
						onclick={handleClose}
					>
						<i class="bx bx-chevron-left"></i>
					</button>
				{/if}
				<div class="thread-pane__title-group">
					<div class="thread-pane__title-row">
						<h2 class="thread-pane__title-text">{threadLabel || rootPreview() || 'Thread'}</h2>
						{#if parentChannelName}
							<button type="button" class="thread-pane__parent-link" onclick={handleClose}>
								<span>in</span>
								<span class="thread-pane__parent-label">#{parentChannelName}</span>
							</button>
						{/if}
					</div>
					<div class="thread-pane__avatar-row" aria-label="Thread members">
						{#each visibleMembers as member (member.uid)}
							<div class="thread-pane__avatar" title={member.displayName ?? member.uid}>
								{#if member.photoURL}
									<img
										src={member.photoURL}
										alt={member.displayName ?? member.uid}
										loading="lazy"
									/>
								{:else}
									<span>{initialsFor(member.displayName ?? member.uid)}</span>
								{/if}
							</div>
						{/each}
						{#if extraMemberCount > 0}
							<div class="thread-pane__avatar thread-pane__avatar--extra">
								+{extraMemberCount}
							</div>
						{/if}
					</div>
				</div>
			</div>
			<div class="thread-pane__header-actions">
				{#if threadStatus === 'archived'}
					<span class="thread-status-badge">Archived</span>
				{/if}
				{#if summaryAvailable}
					<button
						type="button"
						class="thread-pane__action thread-pane__action-icon"
						onclick={handleSummarizeToggle}
						aria-pressed={summaryPanelOpen}
						title="Summarize thread"
						bind:this={summaryButtonEl}
					>
						<i class="bx bx-pen"></i>
						<span class="sr-only">Summarize</span>
					</button>
				{/if}
				{#if popoutEnabled && !isMobileView}
					<button
						type="button"
						class="thread-pane__action thread-pane__action-icon"
						onclick={() => dispatch('popout')}
						title="Pop out thread"
					>
						<i class="bx bx-window-open"></i>
						<span class="sr-only">Pop out</span>
					</button>
				{/if}
				{#if showCloseButton}
					<button
						type="button"
						class="thread-pane__close"
						aria-label="Close thread"
						onclick={handleClose}
					>
						<i class="bx bx-x"></i>
					</button>
				{/if}
			</div>
		</header>

		{#if summaryPanelOpen && summaryAvailable}
			<section class="thread-summary-popover" bind:this={summaryPopoverEl}>
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
						{summaryLoading ? 'Summarizing…' : 'Summarize'}
					</button>
				</div>
				{#if summaryError}
					<div class="thread-summary__error">{summaryError}</div>
				{/if}
				{#if summary.length}
					<ul class="thread-summary__list">
						{#each summary as item, idx (item.messageId ?? `${idx}-${item.title ?? 'summary'}`)}
							<li>
								<button
									type="button"
									class="thread-summary__item"
									onclick={() => scrollToMessage(item.messageId)}
								>
									<div class="thread-summary__item-title">{item.title}</div>
									<div class="thread-summary__item-body">{item.details}</div>
								</button>
							</li>
						{/each}
					</ul>
				{:else if shouldSuggestSummary && !summarySuggested}
					<div class="thread-summary__hint">It’s been quiet for a while—tap summarize.</div>
				{/if}
			</section>
		{/if}

		<div class="thread-pane__messages">
			<MessageList
				messages={[...(root ? [root] : []), ...messages.filter((msg) => msg?.id !== root?.id)]}
				{users}
				{currentUserId}
				replyTargetId={replyTarget?.messageId ?? null}
				hideReplyPreview={true}
				scrollToBottomSignal={scrollSignal + focusScrollSignal}
				{pendingUploads}
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
				{conversationContext}
				{replyTarget}
				{defaultSuggestionSource}
				on:send={handleSend}
				on:sendGif={handleSendGif}
				on:upload={handleUpload}
				on:createPoll={handleCreatePoll}
				on:createForm={handleCreateForm}
				on:cancelReply={handleCancelReply}
				on:focusInput={handleComposerFocus}
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
		position: relative;
	}

	.thread-pane__body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	.thread-pane__header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		align-items: center;
	}

	.thread-pane__header-left {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		min-width: 0;
	}

	.thread-pane__back {
		width: 36px;
		height: 36px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		background: transparent;
		color: var(--color-text-primary);
		display: grid;
		place-items: center;
	}

	.thread-pane__back:hover,
	.thread-pane__back:focus-visible {
		background: color-mix(in srgb, var(--color-border-subtle) 25%, transparent);
		outline: none;
	}

	.thread-pane__title-group {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}

	.thread-pane__title-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		align-items: baseline;
	}

	.thread-pane__title-text {
		font-size: clamp(1rem, 2vw, 1.25rem);
		font-weight: 700;
		color: var(--color-text-primary);
		margin: 0;
	}

	.thread-pane__parent-link {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		border: none;
		background: transparent;
		color: var(--text-65);
		font-size: 0.9rem;
	}

	.thread-pane__parent-link:hover,
	.thread-pane__parent-link:focus-visible {
		color: var(--color-text-primary);
		outline: none;
	}

	.thread-pane__parent-label {
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.thread-pane__avatar-row {
		display: flex;
		gap: 0.35rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.thread-pane__avatar {
		width: 32px;
		height: 32px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 45%, transparent);
		display: grid;
		place-items: center;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-70);
		background: color-mix(in srgb, var(--color-panel-muted) 90%, transparent);
		overflow: hidden;
	}

	.thread-pane__avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thread-pane__avatar--extra {
		background: transparent;
		border-style: dashed;
	}

	.thread-pane__header-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.thread-pane__action {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
		background: transparent;
		color: var(--color-text-primary);
		padding: 0.3rem 0.85rem;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.thread-pane__action:hover,
	.thread-pane__action:focus-visible {
		background: color-mix(in srgb, var(--color-border-subtle) 25%, transparent);
		outline: none;
	}

	.thread-pane__action-icon {
		width: 36px;
		height: 36px;
		justify-content: center;
		padding: 0;
	}

	.thread-pane__close {
		width: 32px;
		height: 32px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
		background: transparent;
		color: var(--color-text-primary);
		display: grid;
		place-items: center;
	}

	.thread-pane__close:hover,
	.thread-pane__close:focus-visible {
		background: color-mix(in srgb, var(--color-border-subtle) 25%, transparent);
		outline: none;
	}

	.thread-summary-popover {
		position: absolute;
		top: 68px;
		right: 1.5rem;
		width: min(320px, calc(100% - 2rem));
		background: color-mix(in srgb, var(--color-panel), transparent);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		border-radius: 1rem;
		box-shadow: 0 22px 60px rgba(6, 10, 25, 0.35);
		padding: 1rem 1.2rem;
		z-index: 20;
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

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
	}

	.thread-compose-surface {
		padding: 0.75rem 1rem 1rem;
	}

	.thread-compose-surface :global(.chat-input-root) {
		width: 100%;
	}
</style>
