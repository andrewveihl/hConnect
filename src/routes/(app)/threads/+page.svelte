<!-- Mobile Threads Page - Full-screen thread list and viewer -->
<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy, tick } from 'svelte';
	import { user } from '$lib/stores/user';
	import { getDb } from '$lib/firebase';
	import {
		collection,
		query,
		onSnapshot,
		Timestamp,
		doc,
		getDoc,
		type Unsubscribe
	} from 'firebase/firestore';
	import type { ChannelThread } from '$lib/firestore/threads';
	import { leaveThread, getThread, streamThreadMessages, type ThreadMessage } from '$lib/firestore/threads';
	import { markThreadRead as markThreadReadThread } from '$lib/firestore/threads';
	import { threadUnreadCount, threadUnreadById } from '$lib/stores/notifications';
	import { sendThreadMessage } from '$lib/firestore/threads';
	import MessageList from '$lib/components/chat/MessageList.svelte';
	import ChatInput from '$lib/components/chat/ChatInput.svelte';
	import type { ReplyReferenceInput } from '$lib/firestore/messages';

	type ThreadWithMeta = ChannelThread & {
		serverName?: string;
		channelName?: string;
		unreadCount?: number;
		lastReadMessageId?: string;
	};

	// Thread list state
	let recentThreads = $state<ThreadWithMeta[]>([]);
	let threadsUnsub: Unsubscribe | null = null;
	let searchQuery = $state('');
	let loading = $state(true);

	// Thread view state
	type OpenThread = {
		thread: ChannelThread;
		root: any;
		messages: ThreadMessage[];
		replyTarget: ReplyReferenceInput | null;
		stream: Unsubscribe | null;
	};
	let openThread = $state<OpenThread | null>(null);
	let threadProfiles = $state<Record<string, any>>({});

	// Unread tracking
	const threadUnreads = $derived($threadUnreadById ?? {});
	const totalUnread = $derived(Object.values(threadUnreads).reduce((sum, count) => sum + (count || 0), 0));

	// Filter threads by search
	let filteredThreads = $derived.by(() => {
		if (!searchQuery.trim()) return recentThreads;
		const q = searchQuery.toLowerCase();
		return recentThreads.filter((t) => 
			(t.name || '').toLowerCase().includes(q) ||
			(t.lastMessagePreview || '').toLowerCase().includes(q)
		);
	});

	// Calculate time remaining until thread expires (24h from last message)
	const EXPIRATION_HOURS = 24;
	
	function getExpirationTime(thread: ThreadWithMeta): number {
		const lastMessage = thread.lastMessageAt?.toMillis?.() ?? thread.createdAt?.toMillis?.() ?? 0;
		const expiresAt = lastMessage + (EXPIRATION_HOURS * 60 * 60 * 1000);
		return expiresAt;
	}
	
	function formatTimeRemaining(thread: ThreadWithMeta): string {
		const expiresAt = getExpirationTime(thread);
		const remaining = expiresAt - Date.now();
		
		if (remaining <= 0) return 'expired';
		
		const hours = Math.floor(remaining / (60 * 60 * 1000));
		const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
		
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	}

	function formatTimeAgo(timestamp: Timestamp | undefined): string {
		if (!timestamp) return '';
		const now = Date.now();
		const then = timestamp.toMillis?.() ?? 0;
		const diff = now - then;

		const minutes = Math.floor(diff / 60000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;

		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;

		return 'yesterday';
	}

	// Subscribe to user's threads
	function subscribeToThreads() {
		if (!browser || !$user?.uid) return;

		const db = getDb();
		const uid = $user.uid;

		const threadsQuery = query(
			collection(db, 'profiles', uid, 'threadMembership')
		);

		threadsUnsub = onSnapshot(
			threadsQuery,
			async (snap) => {
				type MembershipData = {
					threadId: string;
					serverId?: string;
					channelId?: string;
					[key: string]: unknown;
				};
				
				const memberships: MembershipData[] = snap.docs.map((d) => {
					const data = d.data();
					return {
						threadId: d.id,
						serverId: data.serverId as string | undefined,
						channelId: data.channelId as string | undefined,
						...data
					};
				});

				const threads: ThreadWithMeta[] = [];

				for (const membership of memberships) {
					const serverId = membership.serverId;
					const channelId = membership.channelId;
					
					if (!serverId || !channelId) continue;

					try {
						const threadRef = doc(
							db,
							'servers',
							serverId,
							'channels',
							channelId,
							'threads',
							membership.threadId
						);
						const threadDoc = await getDoc(threadRef);

						if (threadDoc.exists()) {
							const data = threadDoc.data();
							
							if (data.status !== 'archived') {
								threads.push({
									id: threadDoc.id,
									serverId: data.serverId || serverId,
									channelId: data.channelId || channelId,
									parentChannelId: data.parentChannelId || data.channelId || channelId,
									createdFromMessageId: data.createdFromMessageId,
									createdBy: data.createdBy,
									name: data.name || 'Thread',
									preview: data.preview,
									lastMessagePreview: data.lastMessagePreview,
									createdAt: data.createdAt,
									lastMessageAt: data.lastMessageAt,
									archivedAt: data.archivedAt,
									autoArchiveAt: data.autoArchiveAt,
									memberUids: data.memberUids || [],
									memberCount: data.memberCount || 0,
									maxMembers: data.maxMembers || 20,
									ttlHours: data.ttlHours || 24,
									status: data.status || 'active',
									visibility: data.visibility,
									messageCount: data.messageCount || 0
								});
							}
						}
					} catch (err) {
						console.warn('[ThreadsPage] Error fetching thread:', membership.threadId, err);
					}
				}

				// Sort by lastMessageAt descending
				threads.sort((a, b) => {
					const aTime = a.lastMessageAt?.toMillis?.() ?? 0;
					const bTime = b.lastMessageAt?.toMillis?.() ?? 0;
					return bTime - aTime;
				});

				recentThreads = threads;
				loading = false;
			},
			(err) => {
				console.error('[ThreadsPage] Error subscribing to threads:', err);
				loading = false;
			}
		);
	}

	// Open a thread for viewing
	async function selectThread(thread: ThreadWithMeta) {
		try {
			// Close any existing thread
			closeThread();
			
			const db = getDb();
			
			// Fetch the full thread data
			const fullThread = await getThread(thread.serverId, thread.parentChannelId, thread.id);
			if (!fullThread) {
				console.warn('[ThreadsPage] Thread not found:', thread.id);
				return;
			}
			
			// Fetch the root message
			let root = null;
			if (fullThread.createdFromMessageId) {
				try {
					const snap = await getDoc(
						doc(db, 'servers', thread.serverId, 'channels', thread.parentChannelId, 'messages', fullThread.createdFromMessageId)
					);
					if (snap.exists()) {
						const data = snap.data();
						root = {
							id: snap.id,
							uid: data.authorId,
							text: data.text || data.content,
							displayName: data.displayName,
							createdAt: data.createdAt,
							...data
						};
					}
				} catch (err) {
					console.warn('[ThreadsPage] Failed to load root message:', err);
				}
			}
			
			openThread = {
				thread: fullThread,
				root,
				messages: [],
				replyTarget: null,
				stream: null
			};
			
			// Start streaming messages
			const unsubscribe = streamThreadMessages(
				thread.serverId,
				thread.parentChannelId,
				thread.id,
				(list) => {
					if (openThread) {
						openThread = { ...openThread, messages: list };
						
						// Mark as read
						if ($user?.uid && list.length > 0) {
							const last = list[list.length - 1];
							const at = last?.createdAt ?? null;
							const lastId = last?.id ?? null;
							void markThreadReadThread($user.uid, thread.serverId, thread.parentChannelId, thread.id, {
								at,
								lastMessageId: lastId
							});
						}
					}
				},
				{
					onError: (err) => {
						console.error('[ThreadsPage] Failed to load thread messages:', err);
					}
				}
			);
			
			openThread = { ...openThread, stream: unsubscribe };
		} catch (err) {
			console.error('[ThreadsPage] Failed to open thread:', err);
		}
	}
	
	function closeThread() {
		if (openThread?.stream) {
			openThread.stream();
		}
		openThread = null;
		threadProfiles = {};
	}

	// Handle sending messages
	async function handleSendMessage(event: CustomEvent<{ text: string; mentions?: any[] }>) {
		if (!openThread || !$user?.uid) return;
		
		const { text, mentions } = event.detail;
		const thread = openThread.thread;
		
		try {
			await sendThreadMessage({
				serverId: thread.serverId,
				channelId: thread.parentChannelId || thread.channelId,
				threadId: thread.id,
				message: {
					text,
					uid: $user.uid,
					mentions: mentions || []
				}
			});
			
			// Clear reply target after sending
			if (openThread?.replyTarget) {
				openThread = { ...openThread, replyTarget: null };
			}
		} catch (err) {
			console.error('[ThreadsPage] Failed to send message:', err);
		}
	}
	
	function handleReply(event: CustomEvent<{ message: any }>) {
		if (!openThread) return;
		const msg = event.detail?.message;
		if (!msg) return;
		openThread = {
			...openThread,
			replyTarget: {
				messageId: msg.id,
				authorId: msg.uid || msg.authorId,
				authorName: msg.displayName,
				preview: msg.text?.slice(0, 100) || null
			}
		};
	}
	
	function clearReplyTarget() {
		if (!openThread) return;
		openThread = { ...openThread, replyTarget: null };
	}

	async function dismissThread(thread: ThreadWithMeta, event: MouseEvent) {
		event.stopPropagation();
		recentThreads = recentThreads.filter(t => t.id !== thread.id);
	}

	async function leaveAndDismissThread(thread: ThreadWithMeta, event: MouseEvent) {
		event.stopPropagation();
		if (!$user?.uid) return;
		try {
			await leaveThread($user.uid, thread.serverId, thread.parentChannelId, thread.id);
			recentThreads = recentThreads.filter(t => t.id !== thread.id);
		} catch (err) {
			console.error('[ThreadsPage] Error leaving thread:', err);
		}
	}

	async function markAllRead() {
		if (!$user?.uid || !recentThreads.length) return;
		const tasks = recentThreads.map((thread) =>
			markThreadReadThread(
				$user.uid,
				thread.serverId,
				thread.parentChannelId || thread.channelId,
				thread.id,
				{ at: thread.lastMessageAt ?? Timestamp.now() }
			)
		);
		await Promise.allSettled(tasks);
	}

	function goBack() {
		if (openThread) {
			closeThread();
		} else {
			history.back();
		}
	}

	onMount(() => {
		if (!browser) return;
		subscribeToThreads();
	});

	onDestroy(() => {
		threadsUnsub?.();
		closeThread();
	});
</script>

<svelte:head>
	<title>Threads | hConnect</title>
</svelte:head>

<div class="threads-page">
	<!-- Header -->
	<header class="threads-page__header">
		<button type="button" class="threads-page__back-btn" onclick={goBack} title="Go back">
			<i class="bx bx-arrow-back"></i>
		</button>
		<h1 class="threads-page__title">
			{#if openThread}
				{openThread.thread.name || 'Thread'}
			{:else}
				Threads
			{/if}
		</h1>
		{#if !openThread && totalUnread > 0}
			<button type="button" class="threads-page__mark-read-btn" onclick={markAllRead} title="Mark all as read">
				<i class="bx bx-check-double"></i>
			</button>
		{/if}
	</header>

	{#if openThread}
		<!-- Thread View -->
		<div class="threads-page__thread-view">
			{#if openThread.root}
				<div class="threads-page__root-message">
					<div class="threads-page__root-author">
						{openThread.root.displayName || 'Unknown'}
					</div>
					<div class="threads-page__root-text">
						{openThread.root.text || ''}
					</div>
				</div>
			{/if}
			
			<div class="threads-page__messages">
				<MessageList
					messages={openThread.messages as any}
					currentUserId={$user?.uid ?? ''}
					users={threadProfiles}
					on:reply={handleReply}
				/>
			</div>
			
			{#if openThread.replyTarget}
				<div class="threads-page__reply-bar">
					<span class="threads-page__reply-label">
						Replying to <strong>{openThread.replyTarget.authorName}</strong>
					</span>
					<button
						type="button"
						class="threads-page__reply-cancel"
						onclick={clearReplyTarget}
						title="Cancel reply"
					>
						<i class="bx bx-x"></i>
					</button>
				</div>
			{/if}
			
			<div class="threads-page__input">
				<ChatInput
					placeholder="Reply in thread..."
					on:send={handleSendMessage}
					replyTarget={openThread.replyTarget}
				/>
			</div>
		</div>
	{:else}
		<!-- Thread List -->
		<div class="threads-page__search">
			<i class="bx bx-search"></i>
			<input
				type="search"
				placeholder="Search threads..."
				bind:value={searchQuery}
			/>
			{#if searchQuery}
				<button
					type="button"
					class="threads-page__clear-btn"
					onclick={() => (searchQuery = '')}
					aria-label="Clear search"
				>
					<i class="bx bx-x"></i>
				</button>
			{/if}
		</div>

		<div class="threads-page__list">
			{#if loading}
				<div class="threads-page__loading">
					<i class="bx bx-loader-alt bx-spin"></i>
					<span>Loading threads...</span>
				</div>
			{:else if filteredThreads.length === 0}
				<div class="threads-page__empty">
					<i class="bx bx-message-square-x"></i>
					{#if searchQuery}
						<span>No threads match your search</span>
					{:else}
						<span>No active threads</span>
						<p>Threads you participate in will appear here</p>
					{/if}
				</div>
			{:else}
				{#each filteredThreads as thread (thread.id)}
					{@const unreadCount = threadUnreads[thread.id] || 0}
					<div class="thread-item" class:thread-item--unread={unreadCount > 0}>
						<button
							type="button"
							class="thread-item__main"
							onclick={() => selectThread(thread)}
						>
							<div class="thread-item__icon">
								<i class="bx bx-message-square-dots"></i>
								{#if unreadCount > 0}
									<span class="thread-item__badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
								{/if}
							</div>
							<div class="thread-item__content">
								<span class="thread-item__name">{thread.name || 'Thread'}</span>
								{#if thread.lastMessagePreview}
									<span class="thread-item__preview">{thread.lastMessagePreview}</span>
								{/if}
								<div class="thread-item__meta">
									<span>{thread.memberCount} members · {formatTimeAgo(thread.lastMessageAt)}</span>
									<span class="thread-item__expires">
										<i class="bx bx-time"></i>
										{formatTimeRemaining(thread)}
									</span>
								</div>
							</div>
						</button>
						<div class="thread-item__actions">
							<button
								type="button"
								class="thread-item__action"
								onclick={(e) => dismissThread(thread, e)}
								title="Dismiss"
							>
								<i class="bx bx-x"></i>
							</button>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	.threads-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		max-height: 100dvh;
		background: var(--color-bg-primary);
		overflow: hidden;
	}

	.threads-page__header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.threads-page__back-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 50%;
		background: transparent;
		border: none;
		color: var(--color-text-primary);
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.threads-page__back-btn:hover {
		background: var(--color-bg-hover);
	}

	.threads-page__back-btn i {
		font-size: 1.5rem;
	}

	.threads-page__title {
		flex: 1;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.threads-page__mark-read-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 50%;
		background: transparent;
		border: none;
		color: var(--color-accent);
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.threads-page__mark-read-btn:hover {
		background: var(--color-bg-hover);
	}

	.threads-page__mark-read-btn i {
		font-size: 1.5rem;
	}

	/* Search */
	.threads-page__search {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.threads-page__search i {
		color: var(--color-text-tertiary);
		font-size: 1.25rem;
	}

	.threads-page__search input {
		flex: 1;
		background: transparent;
		border: none;
		color: var(--color-text-primary);
		font-size: 1rem;
		outline: none;
	}

	.threads-page__search input::placeholder {
		color: var(--color-text-tertiary);
	}

	.threads-page__clear-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		background: var(--color-bg-hover);
		border: none;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	/* Thread List */
	.threads-page__list {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}

	.threads-page__loading,
	.threads-page__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3rem 1rem;
		color: var(--color-text-tertiary);
		text-align: center;
	}

	.threads-page__loading i,
	.threads-page__empty i {
		font-size: 3rem;
		opacity: 0.5;
	}

	.threads-page__empty p {
		font-size: 0.875rem;
		margin: 0;
	}

	/* Thread Item */
	.thread-item {
		display: flex;
		align-items: center;
		border-bottom: 1px solid var(--color-border);
	}

	.thread-item--unread {
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
	}

	.thread-item__main {
		flex: 1;
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		background: transparent;
		border: none;
		text-align: left;
		cursor: pointer;
		min-width: 0;
	}

	.thread-item__icon {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 50%;
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
		flex-shrink: 0;
	}

	.thread-item--unread .thread-item__icon {
		background: var(--color-accent);
		color: white;
	}

	.thread-item__icon i {
		font-size: 1.25rem;
	}

	.thread-item__badge {
		position: absolute;
		top: -4px;
		right: -4px;
		min-width: 18px;
		height: 18px;
		padding: 0 4px;
		border-radius: 9px;
		background: var(--color-danger);
		color: white;
		font-size: 0.75rem;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.thread-item__content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.thread-item__name {
		font-weight: 500;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.thread-item--unread .thread-item__name {
		font-weight: 600;
	}

	.thread-item__preview {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.thread-item__meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
	}

	.thread-item__expires {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.thread-item__actions {
		padding: 0 0.5rem;
	}

	.thread-item__action {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: transparent;
		border: none;
		color: var(--color-text-tertiary);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.thread-item__action:hover {
		background: var(--color-bg-hover);
		color: var(--color-text-secondary);
	}

	/* Thread View */
	.threads-page__thread-view {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.threads-page__root-message {
		padding: 0.75rem 1rem;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.threads-page__root-author {
		font-weight: 600;
		color: var(--color-text-primary);
		margin-bottom: 0.25rem;
	}

	.threads-page__root-text {
		font-size: 0.9375rem;
		color: var(--color-text-secondary);
	}

	.threads-page__messages {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}

	.threads-page__reply-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 1rem;
		background: var(--color-bg-secondary);
		border-top: 1px solid var(--color-border);
	}

	.threads-page__reply-label {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.threads-page__reply-cancel {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		background: transparent;
		border: none;
		color: var(--color-text-tertiary);
		cursor: pointer;
	}

	.threads-page__reply-cancel:hover {
		background: var(--color-bg-hover);
	}

	.threads-page__input {
		border-top: 1px solid var(--color-border);
		padding-bottom: env(safe-area-inset-bottom, 0);
	}
</style>
