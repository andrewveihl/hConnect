<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { user } from '$lib/stores/user';
	import {
		subscribeUserBoards,
		type AgileBoard
	} from '$lib/firestore/agile';
	import CreateBoardModal from '$lib/components/agile/CreateBoardModal.svelte';
	import type { Unsubscribe } from 'firebase/firestore';

	// State
	let loading = $state(true);
	let boards = $state<AgileBoard[]>([]);
	let searchQuery = $state('');
	let sortBy = $state<'recent' | 'name' | 'created'>('recent');
	let showCreateModal = $state(false);

	// Subscription
	let unsubBoards: Unsubscribe | null = null;

	// Derived
	const filteredBoards = $derived.by(() => {
		let result = boards;
		
		// Filter by search
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(b => 
				b.name.toLowerCase().includes(query) ||
				(b.description?.toLowerCase().includes(query))
			);
		}
		
		// Sort
		switch (sortBy) {
			case 'name':
				return result.slice().sort((a, b) => a.name.localeCompare(b.name));
			case 'created':
				return result.slice().sort((a, b) => {
					const aTime = a.createdAt?.toDate?.()?.getTime() ?? 0;
					const bTime = b.createdAt?.toDate?.()?.getTime() ?? 0;
					return bTime - aTime;
				});
			case 'recent':
			default:
				return result.slice().sort((a, b) => {
					const aTime = a.updatedAt?.toDate?.()?.getTime() ?? 0;
					const bTime = b.updatedAt?.toDate?.()?.getTime() ?? 0;
					return bTime - aTime;
				});
		}
	});

	onMount(() => {
		const uid = $user?.uid;
		if (!uid) {
			loading = false;
			return;
		}

		unsubBoards = subscribeUserBoards(uid, (b) => {
			boards = b;
			loading = false;
		});
	});

	onDestroy(() => {
		unsubBoards?.();
	});

	function formatDate(timestamp: { toDate: () => Date } | undefined): string {
		if (!timestamp) return 'Unknown';
		const date = timestamp.toDate();
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function handleBoardClick(board: AgileBoard) {
		goto(`/agile/board/${board.id}`);
	}
</script>

<div class="boards-page">
	<header class="page-header">
		<div class="header-content">
			<h1>All Boards</h1>
			<p>Manage and organize your agile boards</p>
		</div>
		<button type="button" class="btn-create" onclick={() => showCreateModal = true}>
			<i class="bx bx-plus"></i>
			New Board
		</button>
	</header>

	<!-- Toolbar -->
	<div class="toolbar">
		<div class="search-box">
			<i class="bx bx-search"></i>
			<input
				type="text"
				placeholder="Search boards..."
				bind:value={searchQuery}
			/>
		</div>
		<div class="sort-controls">
			<label>Sort by:</label>
			<select bind:value={sortBy}>
				<option value="recent">Recently Updated</option>
				<option value="name">Name</option>
				<option value="created">Date Created</option>
			</select>
		</div>
	</div>

	<main class="content">
		{#if loading}
			<div class="loading">
				<i class="bx bx-loader-alt bx-spin"></i>
				<p>Loading boards...</p>
			</div>
		{:else if filteredBoards.length === 0 && boards.length === 0}
			<div class="empty-state">
				<div class="empty-icon">
					<i class="bx bx-spreadsheet"></i>
				</div>
				<h2>No boards yet</h2>
				<p>Create your first board to start tracking your work.</p>
				<button type="button" class="btn-create-large" onclick={() => showCreateModal = true}>
					<i class="bx bx-plus"></i>
					Create Your First Board
				</button>
			</div>
		{:else if filteredBoards.length === 0}
			<div class="no-results">
				<i class="bx bx-search-alt"></i>
				<p>No boards found matching "{searchQuery}"</p>
			</div>
		{:else}
			<div class="boards-grid">
				{#each filteredBoards as board (board.id)}
					<button type="button" class="board-card" onclick={() => handleBoardClick(board)}>
						<div class="board-icon">
							{board.iconEmoji || '📋'}
						</div>
						<div class="board-info">
							<h3>{board.name}</h3>
							{#if board.description}
								<p class="board-desc">{board.description}</p>
							{/if}
							<div class="board-meta">
								<span class="meta-item">
									<i class="bx bx-key"></i>
									{board.key}
								</span>
								<span class="meta-item">
									<i class="bx bx-calendar"></i>
									Updated {formatDate(board.updatedAt)}
								</span>
							</div>
						</div>
						<i class="bx bx-chevron-right board-arrow"></i>
					</button>
				{/each}
			</div>
		{/if}
	</main>
</div>

<CreateBoardModal 
	open={showCreateModal}
	onClose={() => showCreateModal = false}
/>

<style>
	.boards-page {
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

	.btn-create {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-create:hover {
		background: var(--color-accent-bright);
		transform: translateY(-1px);
	}

	/* Toolbar */
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1.5rem;
		background: var(--color-panel);
		border-bottom: 1px solid var(--text-08);
	}

	.search-box {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		max-width: 300px;
		padding: 0.5rem 0.75rem;
		background: var(--text-06);
		border-radius: 0.375rem;
	}

	.search-box i {
		color: var(--text-40);
		font-size: 1rem;
	}

	.search-box input {
		flex: 1;
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		font-size: 0.875rem;
		outline: none;
	}

	.search-box input::placeholder {
		color: var(--text-40);
	}

	.sort-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.sort-controls label {
		font-size: 0.8125rem;
		color: var(--text-50);
	}

	.sort-controls select {
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--text-12);
		border-radius: 0.25rem;
		background: var(--color-panel);
		color: var(--color-text-primary);
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.content {
		padding: 1.5rem;
	}

	/* Loading / Empty States */
	.loading,
	.empty-state,
	.no-results {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		text-align: center;
	}

	.loading i {
		font-size: 2rem;
		color: var(--color-accent);
		margin-bottom: 0.75rem;
	}

	.loading p,
	.no-results p {
		color: var(--text-50);
		margin: 0;
	}

	.no-results i {
		font-size: 2rem;
		color: var(--text-30);
		margin-bottom: 0.75rem;
	}

	.empty-icon {
		width: 5rem;
		height: 5rem;
		border-radius: 1.25rem;
		background: var(--color-accent-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 1.5rem;
	}

	.empty-icon i {
		font-size: 2.5rem;
		color: var(--color-accent);
	}

	.empty-state h2 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.5rem;
	}

	.empty-state p {
		font-size: 0.9375rem;
		color: var(--text-50);
		margin: 0 0 1.5rem;
	}

	.btn-create-large {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.5rem;
		font-size: 1rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-create-large:hover {
		background: var(--color-accent-bright);
		transform: translateY(-1px);
	}

	/* Boards Grid */
	.boards-grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.board-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.25rem;
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.625rem;
		cursor: pointer;
		text-align: left;
		transition: all 0.15s ease;
	}

	.board-card:hover {
		border-color: var(--color-accent);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		transform: translateY(-1px);
	}

	.board-icon {
		font-size: 2rem;
		flex-shrink: 0;
	}

	.board-info {
		flex: 1;
		min-width: 0;
	}

	.board-info h3 {
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.25rem;
	}

	.board-desc {
		font-size: 0.8125rem;
		color: var(--text-50);
		margin: 0 0 0.5rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.board-meta {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.meta-item {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--text-50);
	}

	.meta-item i {
		font-size: 0.875rem;
	}

	.board-arrow {
		color: var(--text-30);
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	/* Mobile */
	@media (max-width: 640px) {
		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 1rem;
		}

		.btn-create {
			width: 100%;
			justify-content: center;
		}

		.toolbar {
			flex-direction: column;
			align-items: stretch;
		}

		.search-box {
			max-width: none;
		}

		.sort-controls {
			justify-content: space-between;
		}
	}
</style>
