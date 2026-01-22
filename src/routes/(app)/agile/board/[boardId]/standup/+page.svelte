<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { user } from '$lib/stores/user';
	import {
		subscribeItems,
		subscribeBoard,
		subscribeActiveSprints,
		type AgileBoard,
		type Sprint,
		type BacklogItem
	} from '$lib/firestore/agile';
	import type { Unsubscribe } from 'firebase/firestore';

	const boardId = $derived($page.params.boardId);

	// State
	let board = $state<AgileBoard | null>(null);
	let activeSprint = $state<Sprint | null>(null);
	let items = $state<BacklogItem[]>([]);
	let loading = $state(true);

	// Subscriptions
	let unsubBoard: Unsubscribe | null = null;
	let unsubSprint: Unsubscribe | null = null;
	let unsubItems: Unsubscribe | null = null;

	// Derived - group items by status for the board walk
	const sprintItems = $derived(items.filter(i => i.sprintId === activeSprint?.id));
	
	const itemsByStatus = $derived.by(() => {
		const groups: Record<string, BacklogItem[]> = {
			blocked: [],
			in_progress: [],
			review: [],
			todo: [],
			done: []
		};
		sprintItems.forEach(item => {
			if (groups[item.status]) {
				groups[item.status].push(item);
			}
		});
		return groups;
	});

	const blockedCount = $derived(itemsByStatus.blocked.length);
	const inProgressCount = $derived(itemsByStatus.in_progress.length);

	onMount(() => {
		if (!boardId) return;

		unsubBoard = subscribeBoard(boardId, (b) => {
			board = b;
			loading = false;
		});

		unsubSprint = subscribeActiveSprints([boardId], (sprints) => {
			activeSprint = sprints[0] || null;
		});

		unsubItems = subscribeItems(boardId, (i) => {
			items = i;
		});
	});

	onDestroy(() => {
		unsubBoard?.();
		unsubSprint?.();
		unsubItems?.();
	});

	// Standup state
	let standupStarted = $state(false);
	let currentColumn = $state(0);
	const columns = ['blocked', 'in_progress', 'review', 'todo'];
	const columnLabels: Record<string, { label: string; icon: string; color: string }> = {
		blocked: { label: 'Blocked', icon: 'bx-error-circle', color: '#dc2626' },
		in_progress: { label: 'In Progress', icon: 'bx-play-circle', color: '#2563eb' },
		review: { label: 'In Review', icon: 'bx-search', color: '#9333ea' },
		todo: { label: 'To Do', icon: 'bx-circle', color: '#6b7280' }
	};

	function startStandup() {
		standupStarted = true;
		currentColumn = 0;
	}

	function nextColumn() {
		if (currentColumn < columns.length - 1) {
			currentColumn++;
		}
	}

	function prevColumn() {
		if (currentColumn > 0) {
			currentColumn--;
		}
	}

	function getAssigneeName(item: BacklogItem): string {
		// In real app, look up from members
		return item.assigneeId ? 'Assigned' : 'Unassigned';
	}
</script>

<div class="standup-page">
	<header class="page-header">
		<button type="button" class="back-btn" onclick={() => goto(`/agile/board/${boardId}`)}>
			<i class="bx bx-arrow-back"></i>
		</button>
		<div class="header-content">
			<h1>Daily Standup</h1>
			<p>{board?.name} • {activeSprint?.name || 'No active sprint'}</p>
		</div>
	</header>

	{#if loading}
		<div class="loading">
			<i class="bx bx-loader-alt bx-spin"></i>
		</div>
	{:else if !activeSprint}
		<div class="no-sprint">
			<i class="bx bx-calendar-x"></i>
			<h2>No Active Sprint</h2>
			<p>Start a sprint to run daily standups</p>
			<button type="button" onclick={() => goto(`/agile/board/${boardId}/planning`)}>
				Go to Sprint Planning
			</button>
		</div>
	{:else if !standupStarted}
		<!-- Standup Overview -->
		<main class="standup-overview">
			<section class="standup-intro">
				<div class="intro-icon">🧍</div>
				<h2>Ready for Standup?</h2>
				<p>Walk the board from right to left. Focus on blocked items first, then work flowing toward done.</p>
			</section>

			<section class="standup-tips">
				<h3>The 3 Questions</h3>
				<div class="tip-list">
					<div class="tip">
						<span class="tip-num">1</span>
						<span>What did I do yesterday?</span>
					</div>
					<div class="tip">
						<span class="tip-num">2</span>
						<span>What will I do today?</span>
					</div>
					<div class="tip">
						<span class="tip-num">3</span>
						<span>What's blocking me?</span>
					</div>
				</div>
			</section>

			<section class="standup-summary">
				<h3>Sprint Status</h3>
				<div class="status-cards">
					{#if blockedCount > 0}
						<div class="status-card blocked">
							<span class="count">{blockedCount}</span>
							<span class="label">Blocked</span>
						</div>
					{/if}
					<div class="status-card in-progress">
						<span class="count">{inProgressCount}</span>
						<span class="label">In Progress</span>
					</div>
					<div class="status-card">
						<span class="count">{sprintItems.length}</span>
						<span class="label">Total Items</span>
					</div>
				</div>
			</section>

			<button type="button" class="start-btn" onclick={startStandup}>
				<i class="bx bx-play"></i>
				Start Board Walk
			</button>

			<p class="timer-note">
				<i class="bx bx-time-five"></i>
				Keep it under 15 minutes. Stand up!
			</p>
		</main>
	{:else}
		<!-- Board Walk Mode -->
		<main class="board-walk">
			{@const currentStatus = columns[currentColumn]}
			{@const currentItems = itemsByStatus[currentStatus] || []}
			{@const colInfo = columnLabels[currentStatus]}

			<div class="walk-header">
				<div class="walk-progress">
					{#each columns as col, i}
						<div 
							class="progress-dot" 
							class:active={i === currentColumn}
							class:done={i < currentColumn}
						></div>
					{/each}
				</div>
				<button type="button" class="end-btn" onclick={() => standupStarted = false}>
					End Standup
				</button>
			</div>

			<section class="current-column">
				<div class="column-header" style="--col-color: {colInfo.color}">
					<i class="bx {colInfo.icon}"></i>
					<h2>{colInfo.label}</h2>
					<span class="count">{currentItems.length}</span>
				</div>

				{#if currentItems.length === 0}
					<div class="empty-column">
						<i class="bx bx-check"></i>
						<p>No items in {colInfo.label.toLowerCase()}</p>
					</div>
				{:else}
					<div class="items-list">
						{#each currentItems as item (item.id)}
							<div class="walk-item" class:blocked={item.status === 'blocked'}>
								<div class="item-header">
									<span class="item-key">{item.key}</span>
									<span class="item-assignee">{getAssigneeName(item)}</span>
								</div>
								<h4 class="item-title">{item.title}</h4>
								{#if item.storyPoints}
									<span class="item-points">{item.storyPoints} pts</span>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</section>

			<div class="walk-nav">
				<button 
					type="button" 
					class="nav-btn" 
					onclick={prevColumn}
					disabled={currentColumn === 0}
				>
					<i class="bx bx-chevron-left"></i>
					Previous
				</button>
				
				{#if currentColumn < columns.length - 1}
					<button type="button" class="nav-btn primary" onclick={nextColumn}>
						Next
						<i class="bx bx-chevron-right"></i>
					</button>
				{:else}
					<button type="button" class="nav-btn done" onclick={() => standupStarted = false}>
						<i class="bx bx-check"></i>
						Finish
					</button>
				{/if}
			</div>
		</main>
	{/if}
</div>

<style>
	.standup-page {
		height: 100%;
		overflow-y: auto;
		background: var(--color-panel-muted);
	}

	.page-header {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 1.25rem 1.5rem;
		background: var(--color-panel);
		border-bottom: 1px solid var(--text-08);
	}

	.back-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border: none;
		border-radius: 0.5rem;
		background: var(--text-06);
		color: var(--color-text-primary);
		cursor: pointer;
	}

	.back-btn:hover {
		background: var(--text-10);
	}

	.header-content h1 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.header-content p {
		font-size: 0.8125rem;
		color: var(--text-50);
		margin: 0.125rem 0 0;
	}

	.loading {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4rem;
		font-size: 2rem;
		color: var(--color-accent);
	}

	/* No Sprint */
	.no-sprint {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		text-align: center;
	}

	.no-sprint i {
		font-size: 3rem;
		color: var(--text-30);
		margin-bottom: 1rem;
	}

	.no-sprint h2 {
		font-size: 1.125rem;
		margin: 0 0 0.25rem;
	}

	.no-sprint p {
		color: var(--text-50);
		margin: 0 0 1rem;
	}

	.no-sprint button {
		padding: 0.5rem 1rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
	}

	/* Standup Overview */
	.standup-overview {
		padding: 2rem;
		max-width: 500px;
		margin: 0 auto;
		text-align: center;
	}

	.standup-intro {
		margin-bottom: 2rem;
	}

	.intro-icon {
		font-size: 3rem;
		margin-bottom: 0.75rem;
	}

	.standup-intro h2 {
		font-size: 1.25rem;
		margin: 0 0 0.5rem;
	}

	.standup-intro p {
		color: var(--text-60);
		font-size: 0.9375rem;
		margin: 0;
	}

	.standup-tips {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
		text-align: left;
	}

	.standup-tips h3 {
		font-size: 0.9375rem;
		margin: 0 0 0.75rem;
	}

	.tip-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.tip {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.875rem;
		color: var(--text-70);
	}

	.tip-num {
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		background: var(--color-accent-muted);
		color: var(--color-accent);
		font-size: 0.75rem;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.standup-summary h3 {
		font-size: 0.9375rem;
		margin: 0 0 0.75rem;
	}

	.status-cards {
		display: flex;
		justify-content: center;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.status-card {
		padding: 0.75rem 1.25rem;
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.5rem;
	}

	.status-card.blocked {
		border-color: #fca5a5;
		background: #fef2f2;
	}

	.status-card.in-progress {
		border-color: #93c5fd;
		background: #eff6ff;
	}

	.status-card .count {
		display: block;
		font-size: 1.5rem;
		font-weight: 700;
	}

	.status-card.blocked .count {
		color: #dc2626;
	}

	.status-card.in-progress .count {
		color: #2563eb;
	}

	.status-card .label {
		font-size: 0.6875rem;
		color: var(--text-50);
		text-transform: uppercase;
	}

	.start-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.875rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.5rem;
		font-size: 1rem;
		font-weight: 500;
		cursor: pointer;
	}

	.start-btn:hover {
		background: var(--color-accent-bright);
	}

	.timer-note {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		margin-top: 1rem;
		font-size: 0.8125rem;
		color: var(--text-50);
	}

	/* Board Walk Mode */
	.board-walk {
		padding: 1.5rem;
		max-width: 600px;
		margin: 0 auto;
	}

	.walk-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.5rem;
	}

	.walk-progress {
		display: flex;
		gap: 0.5rem;
	}

	.progress-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--text-20);
	}

	.progress-dot.active {
		background: var(--color-accent);
		transform: scale(1.25);
	}

	.progress-dot.done {
		background: #10b981;
	}

	.end-btn {
		font-size: 0.8125rem;
		color: var(--text-50);
		background: none;
		border: none;
		cursor: pointer;
	}

	.end-btn:hover {
		color: var(--color-text-primary);
	}

	.current-column {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		overflow: hidden;
	}

	.column-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem;
		background: var(--text-04);
		border-bottom: 1px solid var(--text-08);
	}

	.column-header i {
		font-size: 1.25rem;
		color: var(--col-color);
	}

	.column-header h2 {
		flex: 1;
		font-size: 1rem;
		margin: 0;
	}

	.column-header .count {
		font-size: 0.75rem;
		padding: 0.125rem 0.5rem;
		background: var(--text-10);
		border-radius: 1rem;
		color: var(--text-60);
	}

	.empty-column {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2rem;
		color: var(--text-50);
	}

	.empty-column i {
		font-size: 1.5rem;
		color: #10b981;
		margin-bottom: 0.5rem;
	}

	.items-list {
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.walk-item {
		padding: 0.875rem;
		background: var(--text-04);
		border-radius: 0.5rem;
		border-left: 3px solid transparent;
	}

	.walk-item.blocked {
		border-left-color: #dc2626;
		background: #fef2f2;
	}

	.item-header {
		display: flex;
		justify-content: space-between;
		margin-bottom: 0.25rem;
	}

	.item-key {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--text-50);
	}

	.item-assignee {
		font-size: 0.6875rem;
		color: var(--text-50);
	}

	.item-title {
		font-size: 0.9375rem;
		font-weight: 500;
		margin: 0 0 0.25rem;
	}

	.item-points {
		font-size: 0.6875rem;
		padding: 0.125rem 0.375rem;
		background: var(--color-accent-muted);
		color: var(--color-accent);
		border-radius: 0.25rem;
	}

	.walk-nav {
		display: flex;
		justify-content: space-between;
		margin-top: 1.5rem;
	}

	.nav-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.625rem 1rem;
		background: var(--color-panel);
		border: 1px solid var(--text-12);
		border-radius: 0.375rem;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.nav-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.nav-btn.primary {
		background: var(--color-accent);
		color: white;
		border-color: transparent;
	}

	.nav-btn.done {
		background: #10b981;
		color: white;
		border-color: transparent;
	}
</style>
