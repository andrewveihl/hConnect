<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { user } from '$lib/stores/user';
	import {
		subscribeUserBoards,
		subscribeItems,
		type AgileBoard,
		type BacklogItem
	} from '$lib/firestore/agile';
	import type { Unsubscribe } from 'firebase/firestore';

	// State
	let loading = $state(true);
	let boards = $state<AgileBoard[]>([]);
	let allItems = $state<BacklogItem[]>([]);
	let filterStatus = $state<'all' | 'active' | 'done'>('active');

	// Subscriptions
	let unsubBoards: Unsubscribe | null = null;
	let itemUnsubscribers: Unsubscribe[] = [];

	// Derived
	const myItems = $derived(
		allItems.filter(item => item.assigneeId === $user?.uid)
	);

	const filteredItems = $derived.by(() => {
		if (filterStatus === 'all') return myItems;
		if (filterStatus === 'active') return myItems.filter(i => i.status !== 'done');
		return myItems.filter(i => i.status === 'done');
	});

	const groupedByStatus = $derived.by(() => {
		const groups: Record<string, BacklogItem[]> = {
			'in_progress': [],
			'review': [],
			'todo': [],
			'backlog': [],
			'done': []
		};
		filteredItems.forEach(item => {
			if (groups[item.status]) {
				groups[item.status].push(item);
			}
		});
		return groups;
	});

	const statusLabels: Record<string, { label: string; icon: string; color: string }> = {
		in_progress: { label: 'In Progress', icon: 'bx-play-circle', color: '#3b82f6' },
		review: { label: 'In Review', icon: 'bx-search', color: '#8b5cf6' },
		todo: { label: 'To Do', icon: 'bx-circle', color: '#6b7280' },
		backlog: { label: 'Backlog', icon: 'bx-layer', color: '#64748b' },
		done: { label: 'Completed', icon: 'bx-check-circle', color: '#10b981' }
	};

	const typeIcons: Record<string, string> = {
		story: 'bx-bookmark',
		bug: 'bx-bug',
		task: 'bx-task',
		epic: 'bx-layer',
		subtask: 'bxs-square'
	};

	const priorityColors: Record<string, string> = {
		critical: '#dc2626',
		high: '#f59e0b',
		medium: '#3b82f6',
		low: '#10b981'
	};

	onMount(() => {
		const uid = $user?.uid;
		if (!uid) {
			loading = false;
			return;
		}

		// Subscribe to user's boards
		unsubBoards = subscribeUserBoards(uid, (b) => {
			boards = b;
			
			// Clear existing item subscriptions
			itemUnsubscribers.forEach(unsub => unsub());
			itemUnsubscribers = [];
			
			// Subscribe to items from each board
			b.forEach(board => {
				const unsub = subscribeItems(board.id, (items) => {
					// Update items for this board
					allItems = [
						...allItems.filter(i => i.boardId !== board.id),
						...items
					];
				});
				itemUnsubscribers.push(unsub);
			});
			
			loading = false;
		});
	});

	onDestroy(() => {
		unsubBoards?.();
		itemUnsubscribers.forEach(unsub => unsub());
	});

	function getBoardName(boardId: string): string {
		const board = boards.find(b => b.id === boardId);
		return board?.name || 'Unknown Board';
	}

	function getBoardIcon(boardId: string): string {
		const board = boards.find(b => b.id === boardId);
		return board?.iconEmoji || '📋';
	}

	function formatDate(timestamp: { toDate: () => Date } | undefined): string {
		if (!timestamp) return '';
		const date = timestamp.toDate();
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	function handleItemClick(item: BacklogItem) {
		goto(`/agile/board/${item.boardId}?item=${item.id}`);
	}
</script>

<div class="my-work-page">
	<header class="page-header">
		<div class="header-content">
			<h1>My Work</h1>
			<p>All items assigned to you across your boards</p>
		</div>
		<div class="header-stats">
			<div class="stat">
				<span class="stat-value">{myItems.filter(i => i.status !== 'done').length}</span>
				<span class="stat-label">Active</span>
			</div>
			<div class="stat">
				<span class="stat-value">{myItems.filter(i => i.status === 'done').length}</span>
				<span class="stat-label">Completed</span>
			</div>
		</div>
	</header>

	<!-- Filter Tabs -->
	<div class="filter-tabs">
		<button 
			type="button" 
			class="filter-tab"
			class:active={filterStatus === 'active'}
			onclick={() => filterStatus = 'active'}
		>
			Active
		</button>
		<button 
			type="button" 
			class="filter-tab"
			class:active={filterStatus === 'all'}
			onclick={() => filterStatus = 'all'}
		>
			All
		</button>
		<button 
			type="button" 
			class="filter-tab"
			class:active={filterStatus === 'done'}
			onclick={() => filterStatus = 'done'}
		>
			Completed
		</button>
	</div>

	<main class="content">
		{#if loading}
			<div class="loading">
				<i class="bx bx-loader-alt bx-spin"></i>
				<p>Loading your items...</p>
			</div>
		{:else if filteredItems.length === 0}
			<div class="empty-state">
				<div class="empty-icon">
					<i class="bx bx-check-double"></i>
				</div>
				<h2>
					{#if filterStatus === 'active'}
						All caught up!
					{:else if filterStatus === 'done'}
						No completed items yet
					{:else}
						No items assigned to you
					{/if}
				</h2>
				<p>
					{#if filterStatus === 'active'}
						You have no active items assigned to you. Great work!
					{:else}
						Items assigned to you will appear here.
					{/if}
				</p>
			</div>
		{:else}
			<!-- Items grouped by status -->
			{#each Object.entries(groupedByStatus) as [status, items]}
				{#if items.length > 0}
					{@const statusInfo = statusLabels[status]}
					<section class="status-section">
						<h2 class="status-heading">
							<i class="bx {statusInfo.icon}" style="color: {statusInfo.color}"></i>
							{statusInfo.label}
							<span class="count">{items.length}</span>
						</h2>
						<div class="items-list">
							{#each items as item (item.id)}
								<button 
									type="button" 
									class="item-card"
									onclick={() => handleItemClick(item)}
								>
									<div class="item-type" style="color: {priorityColors[item.priority]}">
										<i class="bx {typeIcons[item.type]}"></i>
									</div>
									<div class="item-content">
										<span class="item-key">{item.key}</span>
										<h3 class="item-title">{item.title}</h3>
										<div class="item-meta">
											<span class="board-name">
												{getBoardIcon(item.boardId)} {getBoardName(item.boardId)}
											</span>
											{#if item.storyPoints}
												<span class="story-points">{item.storyPoints} pts</span>
											{/if}
											{#if item.dueDate}
												<span class="due-date">
													<i class="bx bx-calendar"></i>
													{formatDate(item.dueDate)}
												</span>
											{/if}
										</div>
									</div>
									<i class="bx bx-chevron-right item-arrow"></i>
								</button>
							{/each}
						</div>
					</section>
				{/if}
			{/each}
		{/if}
	</main>
</div>

<style>
	.my-work-page {
		height: 100%;
		overflow-y: auto;
		background: var(--color-panel-muted);
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.5rem;
		background: var(--color-panel);
		border-bottom: 1px solid var(--text-08);
	}

	.header-content h1 {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.header-content p {
		font-size: 0.875rem;
		color: var(--text-50);
		margin: 0.25rem 0 0;
	}

	.header-stats {
		display: flex;
		gap: 1.5rem;
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--text-50);
	}

	/* Filter Tabs */
	.filter-tabs {
		display: flex;
		gap: 0.25rem;
		padding: 0.75rem 1rem;
		background: var(--color-panel);
		border-bottom: 1px solid var(--text-08);
	}

	.filter-tab {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: var(--text-60);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.filter-tab:hover {
		background: var(--text-06);
		color: var(--color-text-primary);
	}

	.filter-tab.active {
		background: var(--color-accent-muted);
		color: var(--color-accent);
	}

	.content {
		padding: 1rem;
		max-width: 800px;
	}

	/* Loading / Empty States */
	.loading,
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem;
		text-align: center;
	}

	.loading i {
		font-size: 2rem;
		color: var(--color-accent);
		margin-bottom: 0.75rem;
	}

	.loading p {
		color: var(--text-50);
		margin: 0;
	}

	.empty-icon {
		width: 4rem;
		height: 4rem;
		border-radius: 1rem;
		background: var(--color-accent-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 1rem;
	}

	.empty-icon i {
		font-size: 2rem;
		color: var(--color-accent);
	}

	.empty-state h2 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.5rem;
	}

	.empty-state p {
		font-size: 0.875rem;
		color: var(--text-50);
		margin: 0;
	}

	/* Status Sections */
	.status-section {
		margin-bottom: 1.5rem;
	}

	.status-heading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.75rem;
		padding: 0 0.25rem;
	}

	.status-heading i {
		font-size: 1.125rem;
	}

	.status-heading .count {
		font-size: 0.75rem;
		font-weight: 500;
		padding: 0.125rem 0.5rem;
		background: var(--text-08);
		border-radius: 1rem;
		color: var(--text-60);
	}

	.items-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.item-card {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.875rem 1rem;
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.5rem;
		cursor: pointer;
		text-align: left;
		transition: all 0.15s ease;
	}

	.item-card:hover {
		border-color: var(--color-accent);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.item-type {
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	.item-content {
		flex: 1;
		min-width: 0;
	}

	.item-key {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--text-50);
	}

	.item-title {
		font-size: 0.9375rem;
		font-weight: 500;
		color: var(--color-text-primary);
		margin: 0.125rem 0 0.375rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.item-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: var(--text-50);
	}

	.board-name {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.story-points {
		padding: 0.125rem 0.375rem;
		background: var(--color-accent-muted);
		border-radius: 0.25rem;
		color: var(--color-accent);
		font-weight: 500;
	}

	.due-date {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.item-arrow {
		color: var(--text-30);
		font-size: 1.125rem;
		flex-shrink: 0;
	}

	/* Mobile */
	@media (max-width: 640px) {
		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 1rem;
		}

		.header-stats {
			width: 100%;
			justify-content: flex-start;
		}

		.item-meta {
			flex-wrap: wrap;
		}
	}
</style>
