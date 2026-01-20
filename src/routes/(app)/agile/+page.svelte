<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { user } from '$lib/stores/user';
	import {
		subscribeUserBoards,
		subscribeActiveSprints,
		subscribeItems,
		type AgileBoard,
		type Sprint,
		type BacklogItem,
		AGILE_TIPS
	} from '$lib/firestore/agile';
	import type { Unsubscribe } from 'firebase/firestore';

	// State
	let loading = $state(true);
	let boards = $state<AgileBoard[]>([]);
	let activeSprints = $state<Sprint[]>([]);
	let myItems = $state<BacklogItem[]>([]);
	let allItems = $state<BacklogItem[]>([]);

	// Subscriptions
	let unsubBoards: Unsubscribe | null = null;
	let unsubSprints: Unsubscribe | null = null;
	let itemUnsubscribers: Unsubscribe[] = [];

	// Derived
	const hasBoards = $derived(boards.length > 0);
	const primaryBoard = $derived(boards[0]);
	const primarySprint = $derived(activeSprints.find(s => s.boardId === primaryBoard?.id));

	// My work items (assigned to me, not done)
	const myActiveItems = $derived(
		myItems.filter(i => i.assigneeId === $user?.uid && i.status !== 'done')
	);

	// Sprint stats
	const sprintStats = $derived.by(() => {
		if (!primarySprint) return null;
		const sprintItems = allItems.filter(i => i.sprintId === primarySprint.id);
		const total = sprintItems.length;
		const done = sprintItems.filter(i => i.status === 'done').length;
		const inProgress = sprintItems.filter(i => i.status === 'in_progress').length;
		const blocked = sprintItems.filter(i => i.status === 'blocked').length;
		const totalPoints = sprintItems.reduce((sum, i) => sum + (i.storyPoints || 0), 0);
		const donePoints = sprintItems.filter(i => i.status === 'done').reduce((sum, i) => sum + (i.storyPoints || 0), 0);
		return { total, done, inProgress, blocked, totalPoints, donePoints };
	});

	// Days remaining in sprint
	const daysRemaining = $derived.by(() => {
		if (!primarySprint?.endDate) return null;
		const end = primarySprint.endDate.toDate();
		const now = new Date();
		return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000));
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
			
			if (b.length > 0) {
				const boardIds = b.map(board => board.id);
				unsubSprints?.();
				unsubSprints = subscribeActiveSprints(boardIds, (sprints) => {
					activeSprints = sprints;
				});

				// Subscribe to items from primary board
				itemUnsubscribers.forEach(u => u());
				itemUnsubscribers = [];
				
				const unsub = subscribeItems(b[0].id, (items) => {
					allItems = items;
					myItems = items.filter(i => i.assigneeId === uid);
				});
				itemUnsubscribers.push(unsub);
			}
		});
	});

	onDestroy(() => {
		unsubBoards?.();
		unsubSprints?.();
		itemUnsubscribers.forEach(u => u());
	});

	function getProgressPercent(): number {
		if (!sprintStats) return 0;
		return sprintStats.total > 0 ? Math.round((sprintStats.done / sprintStats.total) * 100) : 0;
	}
</script>

<div class="agile-overview">
	{#if loading}
		<div class="loading-state">
			<i class="bx bx-loader-alt bx-spin"></i>
			<p>Loading...</p>
		</div>
	{:else if !hasBoards}
		<!-- Empty State - First Time User -->
		<div class="empty-state">
			<div class="empty-icon">
				<i class="bx bx-layout"></i>
			</div>
			<h1>Welcome to Agile Boards</h1>
			<p class="empty-subtitle">Manage your sprints, track work, and run ceremonies</p>
			
			<div class="agile-principles">
				<h3>Core Principles</h3>
				<ul>
					<li><strong>Deliver working software</strong> every sprint</li>
					<li><strong>Welcome change</strong> - flex on scope, not time</li>
					<li><strong>Self-organizing teams</strong> make the best decisions</li>
					<li><strong>Continuous improvement</strong> through retrospectives</li>
				</ul>
			</div>

			<button type="button" class="btn-primary" onclick={() => goto('/agile/boards')}>
				<i class="bx bx-plus"></i>
				Create Your First Board
			</button>

			<a href="/agile/learn" class="learn-link">
				<i class="bx bx-book-open"></i>
				Read the Training Guide First
			</a>
		</div>
	{:else}
		<!-- Sprint Overview Dashboard -->
		<header class="page-header">
			<div class="header-content">
				<h1>{primaryBoard?.name || 'Agile Overview'}</h1>
				{#if primarySprint}
					<span class="sprint-badge">
						<i class="bx bx-run"></i>
						{primarySprint.name}
					</span>
				{/if}
			</div>
			{#if primaryBoard}
				<button type="button" class="btn-board" onclick={() => goto(`/agile/board/${primaryBoard.id}`)}>
					Open Board
					<i class="bx bx-right-arrow-alt"></i>
				</button>
			{/if}
		</header>

		<main class="dashboard-content">
			<!-- Sprint Progress Card -->
			{#if primarySprint && sprintStats}
				<section class="sprint-card">
					<div class="sprint-header">
						<h2>{primarySprint.name}</h2>
						{#if daysRemaining !== null}
							<span class="days-badge" class:warning={daysRemaining <= 2} class:danger={daysRemaining === 0}>
								{daysRemaining === 0 ? 'Ends today' : `${daysRemaining} days left`}
							</span>
						{/if}
					</div>
					
					{#if primarySprint.goal}
						<p class="sprint-goal">
							<i class="bx bx-target-lock"></i>
							{primarySprint.goal}
						</p>
					{/if}

					<div class="progress-section">
						<div class="progress-bar">
							<div class="progress-fill" style="width: {getProgressPercent()}%"></div>
						</div>
						<div class="progress-stats">
							<span>{sprintStats.done} / {sprintStats.total} items</span>
							<span>{sprintStats.donePoints} / {sprintStats.totalPoints} pts</span>
						</div>
					</div>

					<div class="sprint-metrics">
						<div class="metric">
							<span class="metric-value">{sprintStats.inProgress}</span>
							<span class="metric-label">In Progress</span>
						</div>
						<div class="metric">
							<span class="metric-value done">{sprintStats.done}</span>
							<span class="metric-label">Done</span>
						</div>
						{#if sprintStats.blocked > 0}
							<div class="metric blocked">
								<span class="metric-value">{sprintStats.blocked}</span>
								<span class="metric-label">Blocked!</span>
							</div>
						{/if}
					</div>
				</section>
			{:else}
				<section class="no-sprint-card">
					<i class="bx bx-calendar-plus"></i>
					<h2>No Active Sprint</h2>
					<p>Plan your next sprint to get started</p>
					<button type="button" onclick={() => goto(`/agile/board/${primaryBoard?.id}/planning`)}>
						Start Sprint Planning
					</button>
				</section>
			{/if}

			<!-- Quick Actions - Ceremonies -->
			<section class="ceremonies-section">
				<h3>Ceremonies</h3>
				<div class="ceremony-cards">
					<button type="button" class="ceremony-card" onclick={() => goto(`/agile/board/${primaryBoard?.id}/standup`)}>
						<div class="ceremony-icon standup">
							<i class="bx bx-group"></i>
						</div>
						<div class="ceremony-info">
							<span class="ceremony-name">Daily Standup</span>
							<span class="ceremony-desc">What did you do? What's next? Blockers?</span>
						</div>
					</button>
					
					<button type="button" class="ceremony-card" onclick={() => goto(`/agile/board/${primaryBoard?.id}/planning`)}>
						<div class="ceremony-icon planning">
							<i class="bx bx-calendar-plus"></i>
						</div>
						<div class="ceremony-info">
							<span class="ceremony-name">Sprint Planning</span>
							<span class="ceremony-desc">Pull stories, commit as a team</span>
						</div>
					</button>
					
					<button type="button" class="ceremony-card" onclick={() => goto(`/agile/board/${primaryBoard?.id}/retro`)}>
						<div class="ceremony-icon retro">
							<i class="bx bx-refresh"></i>
						</div>
						<div class="ceremony-info">
							<span class="ceremony-name">Retrospective</span>
							<span class="ceremony-desc">Inspect and adapt the process</span>
						</div>
					</button>
				</div>
			</section>

			<!-- My Work Section -->
			<section class="my-work-section">
				<div class="section-header">
					<h3>My Work</h3>
					<button type="button" class="view-all" onclick={() => goto('/agile/my-work')}>
						View All <i class="bx bx-right-arrow-alt"></i>
					</button>
				</div>
				
				{#if myActiveItems.length === 0}
					<div class="empty-work">
						<i class="bx bx-check-circle"></i>
						<p>No items assigned to you</p>
					</div>
				{:else}
					<div class="work-list">
						{#each myActiveItems.slice(0, 5) as item (item.id)}
							<button 
								type="button" 
								class="work-item"
								onclick={() => goto(`/agile/board/${item.boardId}?item=${item.id}`)}
							>
								<span class="item-key">{item.key}</span>
								<span class="item-title">{item.title}</span>
								<span class="item-status" class:in-progress={item.status === 'in_progress'}>
									{item.status.replace('_', ' ')}
								</span>
							</button>
						{/each}
					</div>
				{/if}
			</section>

			<!-- Quick Tip -->
			<section class="tip-section">
				<div class="tip-icon">💡</div>
				<div class="tip-content">
					<h4>{AGILE_TIPS.oneTeam.title}</h4>
					<p>{AGILE_TIPS.oneTeam.description}</p>
				</div>
			</section>
		</main>
	{/if}
</div>

<style>
	.agile-overview {
		height: 100%;
		overflow-y: auto;
		background: var(--color-panel-muted);
	}

	/* Loading */
	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--text-50);
	}

	.loading-state i {
		font-size: 2rem;
		color: var(--color-accent);
		margin-bottom: 0.5rem;
	}

	/* Empty State */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem;
		text-align: center;
		min-height: 100%;
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

	.empty-state h1 {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.5rem;
	}

	.empty-subtitle {
		font-size: 1rem;
		color: var(--text-50);
		margin: 0 0 2rem;
	}

	.agile-principles {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		padding: 1.25rem;
		margin-bottom: 2rem;
		text-align: left;
		max-width: 400px;
	}

	.agile-principles h3 {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.75rem;
	}

	.agile-principles ul {
		margin: 0;
		padding-left: 1.25rem;
		font-size: 0.875rem;
		color: var(--text-70);
		line-height: 1.7;
	}

	.agile-principles strong {
		color: var(--color-text-primary);
	}

	.btn-primary {
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
		margin-bottom: 1rem;
	}

	.btn-primary:hover {
		background: var(--color-accent-bright);
	}

	.learn-link {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.875rem;
		color: var(--color-accent);
		text-decoration: none;
	}

	.learn-link:hover {
		text-decoration: underline;
	}

	/* Page Header */
	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 1.5rem;
		background: var(--color-panel);
		border-bottom: 1px solid var(--text-08);
	}

	.header-content {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.header-content h1 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.sprint-badge {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.625rem;
		background: var(--color-accent-muted);
		border-radius: 1rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-accent);
	}

	.btn-board {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		background: transparent;
		border: 1px solid var(--text-12);
		border-radius: 0.375rem;
		font-size: 0.875rem;
		color: var(--color-text-primary);
		cursor: pointer;
	}

	.btn-board:hover {
		background: var(--text-06);
		border-color: var(--color-accent);
	}

	/* Dashboard Content */
	.dashboard-content {
		padding: 1.5rem;
		display: grid;
		gap: 1.25rem;
		max-width: 900px;
	}

	/* Sprint Card */
	.sprint-card {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		padding: 1.25rem;
	}

	.sprint-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}

	.sprint-header h2 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.days-badge {
		font-size: 0.75rem;
		font-weight: 500;
		padding: 0.25rem 0.5rem;
		background: var(--text-08);
		border-radius: 0.25rem;
		color: var(--text-60);
	}

	.days-badge.warning {
		background: #fef3c7;
		color: #d97706;
	}

	.days-badge.danger {
		background: #fee2e2;
		color: #dc2626;
	}

	.sprint-goal {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--text-60);
		margin: 0 0 1rem;
	}

	.sprint-goal i {
		color: var(--color-accent);
		margin-top: 0.125rem;
	}

	.progress-section {
		margin-bottom: 1rem;
	}

	.progress-bar {
		height: 8px;
		background: var(--text-10);
		border-radius: 4px;
		overflow: hidden;
		margin-bottom: 0.5rem;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-accent);
		border-radius: 4px;
		transition: width 0.3s ease;
	}

	.progress-stats {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--text-50);
	}

	.sprint-metrics {
		display: flex;
		gap: 1.5rem;
	}

	.metric {
		text-align: center;
	}

	.metric-value {
		display: block;
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.metric-value.done {
		color: #10b981;
	}

	.metric.blocked .metric-value {
		color: #dc2626;
	}

	.metric-label {
		font-size: 0.6875rem;
		color: var(--text-50);
		text-transform: uppercase;
	}

	/* No Sprint Card */
	.no-sprint-card {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		padding: 2rem;
		text-align: center;
	}

	.no-sprint-card i {
		font-size: 2.5rem;
		color: var(--text-30);
		margin-bottom: 0.75rem;
	}

	.no-sprint-card h2 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.25rem;
	}

	.no-sprint-card p {
		font-size: 0.875rem;
		color: var(--text-50);
		margin: 0 0 1rem;
	}

	.no-sprint-card button {
		padding: 0.5rem 1rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		cursor: pointer;
	}

	/* Ceremonies Section */
	.ceremonies-section h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.75rem;
	}

	.ceremony-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.75rem;
	}

	.ceremony-card {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 1rem;
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.625rem;
		cursor: pointer;
		text-align: left;
		transition: all 0.15s ease;
	}

	.ceremony-card:hover {
		border-color: var(--color-accent);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	}

	.ceremony-icon {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	.ceremony-icon.standup {
		background: #dbeafe;
		color: #2563eb;
	}

	.ceremony-icon.planning {
		background: #dcfce7;
		color: #16a34a;
	}

	.ceremony-icon.retro {
		background: #f3e8ff;
		color: #9333ea;
	}

	.ceremony-info {
		flex: 1;
		min-width: 0;
	}

	.ceremony-name {
		display: block;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.ceremony-desc {
		font-size: 0.6875rem;
		color: var(--text-50);
	}

	/* My Work Section */
	.my-work-section {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		padding: 1rem;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}

	.section-header h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.view-all {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-accent);
		background: none;
		border: none;
		cursor: pointer;
	}

	.empty-work {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 1rem;
		color: var(--text-50);
		font-size: 0.875rem;
	}

	.empty-work i {
		color: #10b981;
	}

	.work-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.work-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem;
		background: var(--text-04);
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		text-align: left;
	}

	.work-item:hover {
		background: var(--text-08);
	}

	.item-key {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--text-50);
	}

	.item-title {
		flex: 1;
		font-size: 0.8125rem;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.item-status {
		font-size: 0.6875rem;
		padding: 0.125rem 0.375rem;
		background: var(--text-10);
		border-radius: 0.25rem;
		color: var(--text-60);
		text-transform: capitalize;
	}

	.item-status.in-progress {
		background: #dbeafe;
		color: #2563eb;
	}

	/* Tip Section */
	.tip-section {
		display: flex;
		gap: 0.875rem;
		padding: 1rem;
		background: linear-gradient(135deg, var(--color-accent-muted) 0%, var(--color-panel) 100%);
		border: 1px solid var(--color-accent-subtle);
		border-radius: 0.75rem;
	}

	.tip-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.tip-content h4 {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.25rem;
	}

	.tip-content p {
		font-size: 0.8125rem;
		color: var(--text-60);
		margin: 0;
		line-height: 1.5;
	}

	/* Mobile */
	@media (max-width: 640px) {
		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.75rem;
		}

		.ceremony-cards {
			grid-template-columns: 1fr;
		}
	}
</style>
