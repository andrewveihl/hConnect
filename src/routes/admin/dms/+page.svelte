<script lang="ts">
	import type { PageData } from './$types';
	import { ensureFirebaseReady, getDb } from '$lib/firebase';
	import {
		collection,
		doc,
		getDoc,
		getDocs,
		limit,
		orderBy,
		query,
		startAfter,
		type QueryDocumentSnapshot,
		type QueryConstraint
	} from 'firebase/firestore';
	import { showAdminToast } from '$lib/admin/stores/toast';
	import { isMobileViewport } from '$lib/stores/viewport';

	type DMMessage = {
		id: string;
		text?: string;
		type?: string;
		authorId?: string;
		createdAt?: Date | null;
	};

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	let search = $state('');
	let selectedThreadId: string | null = $state(null);
	let threadMessages: DMMessage[] = $state([]);
	let loading = $state(false);
	const MESSAGE_BATCH = 100;
	let hasMore = $state(false);
	let nextCursor: QueryDocumentSnapshot | null = null;
	let profileLookup = $state<Record<string, string>>({});
	let messageSearch = $state('');
	let messageScroller = $state<HTMLDivElement | null>(null);
	let topSentinel = $state<HTMLDivElement | null>(null);
	let showDetailPanel = $state(false);

	$effect(() => {
		profileLookup = { ...(data.profileLookup ?? {}) };
	});

	const filteredThreads = $derived(
		data.threads.filter((thread) => {
			if (!search) return true;
			const q = search.toLowerCase();
			const base = `${thread.participantLabels.join(',')} ${thread.id}`.toLowerCase();
			return base.includes(q);
		})
	);

	const selectedThread = $derived(
		data.threads.find((thread) => thread.id === selectedThreadId) ?? null
	);
	const selectedThreadLabel = $derived(
		selectedThread ? (selectedThread.participantLabels ?? []).join(', ') : ''
	);

	let lastLoadedThread: string | null = null;
	$effect(() => {
		if (!selectedThreadId || selectedThreadId === lastLoadedThread) return;
		lastLoadedThread = selectedThreadId;
		void loadThread(selectedThreadId);
	});

	function formatRelativeTime(date: Date | null | undefined): string {
		if (!date) return '';
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days < 7) return `${days}d ago`;
		return date.toLocaleDateString();
	}

	function selectThread(threadId: string) {
		selectedThreadId = threadId;
		if ($isMobileViewport) {
			showDetailPanel = true;
		}
	}

	function closeDetail() {
		showDetailPanel = false;
	}

	async function loadThread(threadId: string) {
		loading = true;
		nextCursor = null;
		hasMore = false;
		try {
			await ensureFirebaseReady();
			const { messages, cursor } = await fetchMessagesBatch(threadId);
			nextCursor = cursor;
			hasMore = Boolean(cursor);
			const missing = Array.from(
				new Set(
					messages.map((message) => message.authorId).filter((uid) => uid && !profileLookup[uid!])
				)
			);
			if (missing.length) {
				await ensureAuthorProfiles(missing as string[]);
			}
			threadMessages = messages.sort((a, b) => {
				const aTime = a.createdAt?.getTime?.() ?? 0;
				const bTime = b.createdAt?.getTime?.() ?? 0;
				return aTime - bTime;
			});
			messageSearch = '';
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Unable to load DM.' });
		} finally {
			loading = false;
		}
	}

	const ensureAuthorProfiles = async (uids: string[]) => {
		try {
			await ensureFirebaseReady();
			const db = getDb();
			const lookups = await Promise.all(
				uids.map(async (uid) => {
					const snap = await getDoc(doc(db, 'profiles', uid));
					const payload = snap.exists() ? (snap.data() as Record<string, any>) : null;
					return { uid, displayName: payload?.displayName ?? payload?.name ?? null };
				})
			);
			const next = { ...profileLookup };
			lookups.forEach((entry) => {
				if (entry.displayName) next[entry.uid] = entry.displayName;
			});
			profileLookup = next;
		} catch (err) {
			console.error(err);
		}
	};

	const fetchMessagesBatch = async (
		threadId: string,
		cursor: QueryDocumentSnapshot | null = null
	) => {
		const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc'), limit(MESSAGE_BATCH)];
		if (cursor) constraints.push(startAfter(cursor));
		const db = getDb();
		const snap = await getDocs(query(collection(db, 'dms', threadId, 'messages'), ...constraints));
		return {
			messages: snap.docs.map((docSnap) => {
				const payload = docSnap.data() as Record<string, any>;
				return {
					id: docSnap.id,
					text: payload.text ?? payload.content ?? '',
					type: payload.type ?? 'text',
					authorId: payload.uid ?? payload.author?.uid ?? '',
					createdAt: payload.createdAt?.toDate?.() ?? null
				};
			}),
			cursor: snap.docs.length === MESSAGE_BATCH ? snap.docs[snap.docs.length - 1]! : null
		};
	};

	const loadMoreMessages = async () => {
		if (!selectedThreadId || !nextCursor || loading) return;
		loading = true;
		try {
			const { messages, cursor } = await fetchMessagesBatch(selectedThreadId, nextCursor);
			nextCursor = cursor;
			hasMore = Boolean(cursor);
			const missing = Array.from(
				new Set(
					messages.map((message) => message.authorId).filter((uid) => uid && !profileLookup[uid!])
				)
			);
			if (missing.length) {
				await ensureAuthorProfiles(missing as string[]);
			}
			threadMessages = [...messages, ...threadMessages].sort((a, b) => {
				const aTime = a.createdAt?.getTime?.() ?? 0;
				const bTime = b.createdAt?.getTime?.() ?? 0;
				return aTime - bTime;
			});
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: 'Unable to Load older messages.' });
		} finally {
			loading = false;
		}
	};

	const labelFor = (uid: string | undefined) => {
		if (!uid) return 'Unknown user';
		return profileLookup[uid] ?? uid;
	};

	const visibleMessages = $derived(
		messageSearch
			? threadMessages.filter((message) =>
					(message.text ?? '').toLowerCase().includes(messageSearch.toLowerCase())
				)
			: threadMessages
	);

	$effect(() => {
		if (!topSentinel || !messageScroller) return;
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting && hasMore && !loading) {
						void loadMoreMessages();
					}
				});
			},
			{ root: messageScroller, threshold: 0.1 }
		);
		observer.observe(topSentinel);
		return () => observer.disconnect();
	});
</script>

<section class="dms-page" class:show-detail={showDetailPanel && $isMobileViewport}>
	<!-- Stats header -->
	<div class="stats-bar">
		<div class="stat">
			<i class="bx bx-conversation"></i>
			<span class="value">{data.threads.length}</span>
			<span class="label">Threads</span>
		</div>
		<div class="stat">
			<i class="bx bx-user"></i>
			<span class="value">{Object.keys(profileLookup).length}</span>
			<span class="label">Users</span>
		</div>
		<div class="stat">
			<i class="bx bx-message-detail"></i>
			<span class="value">{threadMessages.length}</span>
			<span class="label">Messages</span>
		</div>
	</div>

	<div class="content-grid">
		<!-- Threads list panel -->
		<div class="list-panel">
			<div class="search-bar">
				<i class="bx bx-search"></i>
				<input type="search" placeholder="Search threads..." bind:value={search} />
				{#if search}
					<button class="clear-btn" onclick={() => (search = '')} aria-label="Clear search">
						<i class="bx bx-x"></i>
					</button>
				{/if}
			</div>

			<div class="results-info">
				<span>{filteredThreads.length} thread{filteredThreads.length === 1 ? '' : 's'}</span>
			</div>

			<div class="threads-list">
				{#if filteredThreads.length === 0}
					<div class="empty-state">
						<i class="bx bx-conversation"></i>
						<p>No threads match your search</p>
					</div>
				{:else}
					{#each filteredThreads as thread (thread.id)}
						<button
							class="thread-card"
							class:selected={selectedThreadId === thread.id}
							onclick={() => selectThread(thread.id)}
						>
							<div class="thread-avatar">
								<i class="bx bx-group"></i>
							</div>
							<div class="thread-info">
								<span class="thread-participants">
									{(thread.participantLabels ?? thread.participants ?? []).join(', ')}
								</span>
								{#if thread.lastMessage}
									<span class="thread-preview">{thread.lastMessage}</span>
								{/if}
								<span class="thread-time">{formatRelativeTime(thread.updatedAt)}</span>
							</div>
							<i class="bx bx-chevron-right chevron"></i>
						</button>
					{/each}
				{/if}
			</div>
		</div>

		<!-- Conversation panel -->
		<div class="detail-panel" class:visible={showDetailPanel || !$isMobileViewport}>
			{#if $isMobileViewport && showDetailPanel}
				<button class="back-btn" onclick={closeDetail}>
					<i class="bx bx-arrow-left"></i>
					Back to threads
				</button>
			{/if}

			{#if !selectedThreadId}
				<div class="empty-state">
					<i class="bx bx-message-square-detail"></i>
					<p>Select a thread to view messages</p>
				</div>
			{:else if loading && threadMessages.length === 0}
				<div class="loading-state">
					<i class="bx bx-loader-alt bx-spin"></i>
					<p>Loading messages...</p>
				</div>
			{:else}
				<div class="conversation-container">
					<!-- Conversation header -->
					<div class="conversation-header">
						<div class="header-info">
							<span class="header-label">Participants</span>
							<h2>{selectedThreadLabel || 'Unknown participants'}</h2>
						</div>
						<div class="message-search">
							<i class="bx bx-search"></i>
							<input type="search" placeholder="Search messages..." bind:value={messageSearch} />
						</div>
					</div>

					<!-- Messages -->
					<div class="messages-scroller" bind:this={messageScroller}>
						<div class="top-sentinel" bind:this={topSentinel}></div>

						{#if hasMore}
							<button class="load-more-btn" onclick={loadMoreMessages} disabled={loading}>
								{#if loading}
									<i class="bx bx-loader-alt bx-spin"></i> Loading...
								{:else}
									<i class="bx bx-history"></i> Load older messages
								{/if}
							</button>
						{/if}

						{#if visibleMessages.length === 0}
							<div class="empty-messages">
								<i class="bx bx-message-x"></i>
								<p>
									{messageSearch ? 'No messages match your search' : 'No messages in this thread'}
								</p>
							</div>
						{:else}
							<div class="messages-list">
								{#each visibleMessages as message (message.id)}
									<div class="message-bubble">
										<div class="message-header">
											<span class="message-author">{labelFor(message.authorId)}</span>
											<span class="message-time">
												{message.createdAt ? message.createdAt.toLocaleString() : ''}
											</span>
										</div>
										<div class="message-content">
											{#if message.text}
												{message.text}
											{:else}
												<span class="message-type">[{message.type}]</span>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Read-only notice -->
					<div class="readonly-notice">
						<i class="bx bx-lock-alt"></i>
						<span>Read-only mode</span>
					</div>
				</div>
			{/if}
		</div>
	</div>
</section>

<style>
	.dms-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		height: 100%;
		padding: 1rem;
		overflow: hidden;
	}

	/* Stats bar */
	.stats-bar {
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem;
		background: var(--surface-panel);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		flex-shrink: 0;
	}

	.stat {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.125rem;
		padding: 0.5rem;
	}

	.stat i {
		font-size: 1.25rem;
		color: var(--accent-primary);
	}

	.stat .value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.stat .label {
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
	}

	/* Content grid */
	.content-grid {
		display: grid;
		grid-template-columns: 1fr 1.5fr;
		gap: 1rem;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	/* List panel */
	.list-panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background: var(--surface-panel);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		padding: 1rem;
		overflow: hidden;
	}

	.search-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
		border-radius: 8px;
	}

	.search-bar i {
		color: var(--color-text-secondary);
	}

	.search-bar input {
		flex: 1;
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		font-size: 0.875rem;
	}

	.search-bar input::placeholder {
		color: var(--color-text-secondary);
	}

	.clear-btn {
		width: 1.5rem;
		height: 1.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.results-info {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.threads-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		overflow-y: auto;
		flex: 1;
	}

	.thread-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		border-radius: 10px;
		cursor: pointer;
		text-align: left;
		transition: all 0.2s;
	}

	.thread-card:hover {
		border-color: color-mix(in srgb, var(--accent-primary) 30%, transparent);
	}

	.thread-card.selected {
		background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
		border-color: var(--accent-primary);
	}

	.thread-avatar {
		width: 2.5rem;
		height: 2.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: linear-gradient(
			135deg,
			var(--accent-primary),
			color-mix(in srgb, var(--accent-primary) 70%, #8b5cf6)
		);
		flex-shrink: 0;
	}

	.thread-avatar i {
		font-size: 1.125rem;
		color: white;
	}

	.thread-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.thread-participants {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.thread-preview {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.thread-time {
		font-size: 0.625rem;
		color: var(--color-text-secondary);
	}

	.chevron {
		color: var(--color-text-secondary);
	}

	/* Detail panel */
	.detail-panel {
		display: flex;
		flex-direction: column;
		background: var(--surface-panel);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		overflow: hidden;
	}

	.back-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border: none;
		border-bottom: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		background: transparent;
		color: var(--accent-primary);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
	}

	.conversation-container {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.conversation-header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
	}

	.header-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.header-label {
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
	}

	.conversation-header h2 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.message-search {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
		border-radius: 8px;
	}

	.message-search i {
		color: var(--color-text-secondary);
		font-size: 0.875rem;
	}

	.message-search input {
		flex: 1;
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		font-size: 0.8125rem;
	}

	.message-search input::placeholder {
		color: var(--color-text-secondary);
	}

	.messages-scroller {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.top-sentinel {
		height: 0;
	}

	.load-more-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		margin: 0 auto 1rem;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.load-more-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
		color: var(--color-text-primary);
	}

	.load-more-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.messages-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.message-bubble {
		max-width: 85%;
		padding: 0.75rem;
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
		border-radius: 12px;
		border-top-left-radius: 4px;
	}

	.message-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.375rem;
	}

	.message-author {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--accent-primary);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.message-time {
		font-size: 0.625rem;
		color: var(--color-text-secondary);
	}

	.message-content {
		font-size: 0.8125rem;
		color: var(--color-text-primary);
		line-height: 1.5;
		word-break: break-word;
	}

	.message-type {
		color: var(--color-text-secondary);
		font-style: italic;
	}

	.readonly-notice {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		border-top: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		background: color-mix(in srgb, var(--color-text-primary) 3%, transparent);
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.readonly-notice i {
		font-size: 0.875rem;
	}

	/* Empty and loading states */
	.empty-state,
	.loading-state,
	.empty-messages {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 2rem;
		color: var(--color-text-secondary);
		flex: 1;
	}

	.empty-state i,
	.loading-state i,
	.empty-messages i {
		font-size: 2rem;
		opacity: 0.5;
	}

	.empty-state p,
	.loading-state p,
	.empty-messages p {
		margin: 0;
		font-size: 0.8125rem;
	}

	/* Mobile responsiveness */
	@media (max-width: 768px) {
		.content-grid {
			grid-template-columns: 1fr;
		}

		.detail-panel {
			position: fixed;
			inset: 0;
			z-index: 40;
			border-radius: 0;
			transform: translateX(100%);
			transition: transform 0.3s ease;
		}

		.detail-panel.visible {
			transform: translateX(0);
		}

		.dms-page.show-detail .list-panel {
			display: none;
		}

		.message-bubble {
			max-width: 95%;
		}
	}

	@media (min-width: 768px) {
		.dms-page {
			padding: 1.5rem;
		}

		.back-btn {
			display: none;
		}
	}
</style>
