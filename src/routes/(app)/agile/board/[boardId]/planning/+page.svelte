<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { user } from '$lib/stores/user';
	import {
		subscribeItems,
		subscribeBoard,
		subscribeActiveSprints,
		subscribeSprints,
		createSprint,
		updateSprint,
		updateItem,
		type AgileBoard,
		type Sprint,
		type BacklogItem
	} from '$lib/firestore/agile';
	import type { Unsubscribe } from 'firebase/firestore';

	const boardId = $derived($page.params.boardId);

	// State
	let board = $state<AgileBoard | null>(null);
	let activeSprint = $state<Sprint | null>(null);
	let allSprints = $state<Sprint[]>([]);
	let items = $state<BacklogItem[]>([]);
	let loading = $state(true);

	// Planning state
	let mode = $state<'overview' | 'create' | 'capacity' | 'select'>('overview');
	let newSprintName = $state('');
	let newSprintGoal = $state('');
	let sprintDuration = $state(14); // days
	let selectedItems = $state<Set<string>>(new Set());

	// Subscriptions
	let unsubBoard: Unsubscribe | null = null;
	let unsubSprint: Unsubscribe | null = null;
	let unsubSprints: Unsubscribe | null = null;
	let unsubItems: Unsubscribe | null = null;

	// Derived
	const backlogItems = $derived(items.filter(i => !i.sprintId && i.status !== 'done'));
	const plannedItems = $derived(items.filter(i => selectedItems.has(i.id)));
	const totalPoints = $derived(plannedItems.reduce((sum, i) => sum + (i.storyPoints || 0), 0));

	// Yesterday's Weather - average velocity from last 3 sprints
	const velocityHistory = $derived.by(() => {
		const completedSprints = allSprints
			.filter(s => s.status === 'completed' && s.actualVelocity)
			.slice(-3);
		return completedSprints.map(s => s.actualVelocity || 0);
	});

	const averageVelocity = $derived.by(() => {
		if (velocityHistory.length === 0) return null;
		return Math.round(velocityHistory.reduce((a, b) => a + b, 0) / velocityHistory.length);
	});

	onMount(() => {
		if (!boardId) return;

		unsubBoard = subscribeBoard(boardId, (b) => {
			board = b;
			loading = false;
		});

		unsubSprint = subscribeActiveSprints([boardId], (sprints) => {
			activeSprint = sprints[0] || null;
		});

		unsubSprints = subscribeSprints(boardId, (s) => {
			allSprints = s;
		});

		unsubItems = subscribeItems(boardId, (i) => {
			items = i;
		});
	});

	onDestroy(() => {
		unsubBoard?.();
		unsubSprint?.();
		unsubSprints?.();
		unsubItems?.();
	});

	function toggleItem(itemId: string) {
		const newSelected = new Set(selectedItems);
		if (newSelected.has(itemId)) {
			newSelected.delete(itemId);
		} else {
			newSelected.add(itemId);
		}
		selectedItems = newSelected;
	}

	async function handleCreateSprint() {
		if (!board || !$user) return;

		const startDate = new Date();
		const endDate = new Date();
		endDate.setDate(endDate.getDate() + sprintDuration);

		try {
			const sprintId = await createSprint({
				boardId,
				name: newSprintName || `Sprint ${allSprints.length + 1}`,
				goal: newSprintGoal,
				startDate,
				endDate,
				status: 'planning',
				createdBy: $user.uid
			});

			// Assign selected items to sprint
			for (const itemId of selectedItems) {
				await updateItem(boardId, itemId, {
					sprintId,
					status: 'todo'
				});
			}

			mode = 'overview';
			selectedItems = new Set();
			newSprintName = '';
			newSprintGoal = '';
		} catch (err) {
			console.error('Failed to create sprint:', err);
		}
	}

	async function startSprint() {
		if (!activeSprint) return;
		try {
			await updateSprint(boardId, activeSprint.id, {
				status: 'active'
			});
		} catch (err) {
			console.error('Failed to start sprint:', err);
		}
	}

	function getPriorityColor(priority: string): string {
		const colors: Record<string, string> = {
			critical: '#dc2626',
			high: '#f97316',
			medium: '#eab308',
			low: '#22c55e'
		};
		return colors[priority] || '#6b7280';
	}
</script>

<div class="planning-page">
	<header class="page-header">
		<button type="button" class="back-btn" onclick={() => goto(`/agile/board/${boardId}`)}>
			<i class="bx bx-arrow-back"></i>
		</button>
		<div class="header-content">
			<h1>Sprint Planning</h1>
			<p>{board?.name}</p>
		</div>
	</header>

	{#if loading}
		<div class="loading">
			<i class="bx bx-loader-alt bx-spin"></i>
		</div>
	{:else if mode === 'overview'}
		<main class="planning-overview">
			<!-- Planning Guidance -->
			<section class="guidance-card">
				<div class="guidance-icon">📋</div>
				<h2>Sprint Planning</h2>
				<p>Collaborative session where the team determines what can be delivered in the upcoming sprint and how that work will be achieved.</p>
			</section>

			{#if activeSprint && activeSprint.status === 'planning'}
				<!-- Sprint Ready to Start -->
				<section class="sprint-ready">
					<h3>{activeSprint.name} is Ready</h3>
					{#if activeSprint.goal}
						<p class="sprint-goal">Goal: {activeSprint.goal}</p>
					{/if}
					<div class="sprint-stats">
						<div class="stat">
							<span class="value">{items.filter(i => i.sprintId === activeSprint!.id).length}</span>
							<span class="label">Items</span>
						</div>
						<div class="stat">
							<span class="value">{items.filter(i => i.sprintId === activeSprint!.id).reduce((s, i) => s + (i.storyPoints || 0), 0)}</span>
							<span class="label">Points</span>
						</div>
					</div>
					<button type="button" class="start-sprint-btn" onclick={startSprint}>
						<i class="bx bx-play"></i>
						Start Sprint
					</button>
				</section>
			{:else if activeSprint}
				<!-- Active Sprint Exists -->
				<section class="active-sprint-notice">
					<i class="bx bx-info-circle"></i>
					<div>
						<h3>{activeSprint.name} is Active</h3>
						<p>Complete or end the current sprint before planning a new one.</p>
					</div>
					<button type="button" onclick={() => goto(`/agile/board/${boardId}`)}>
						View Board
					</button>
				</section>
			{:else}
				<!-- No Active Sprint - Can Plan -->
				<section class="planning-actions">
					<button type="button" class="action-card" onclick={() => mode = 'select'}>
						<i class="bx bx-list-check"></i>
						<span class="action-title">Plan New Sprint</span>
						<span class="action-desc">Select stories from backlog and set sprint goal</span>
					</button>
				</section>
			{/if}

			<!-- Yesterday's Weather -->
			{#if averageVelocity}
				<section class="velocity-section">
					<h3>Yesterday's Weather</h3>
					<p class="velocity-desc">Based on your last {velocityHistory.length} sprint{velocityHistory.length !== 1 ? 's' : ''}, your team completes an average of:</p>
					<div class="velocity-display">
						<span class="velocity-value">{averageVelocity}</span>
						<span class="velocity-label">story points per sprint</span>
					</div>
					<p class="velocity-hint">Use this as a guide, but remember: commit to what the team believes they can complete.</p>
				</section>
			{/if}

			<!-- Planning Tips -->
			<section class="tips-section">
				<h3>Planning Best Practices</h3>
				<div class="tips-grid">
					<div class="tip">
						<i class="bx bx-target-lock"></i>
						<div>
							<strong>Sprint Goal</strong>
							<span>Every sprint needs a clear, achievable goal</span>
						</div>
					</div>
					<div class="tip">
						<i class="bx bx-calendar"></i>
						<div>
							<strong>Velocity</strong>
							<span>Use yesterday's weather for commitments</span>
						</div>
					</div>
					<div class="tip">
						<i class="bx bx-check-double"></i>
						<div>
							<strong>Ready Stories</strong>
							<span>Only pull stories that meet Definition of Ready</span>
						</div>
					</div>
					<div class="tip">
						<i class="bx bx-group"></i>
						<div>
							<strong>Team Commitment</strong>
							<span>The team decides what they can deliver</span>
						</div>
					</div>
				</div>
			</section>
		</main>
	{:else if mode === 'select'}
		<!-- Select Items Mode -->
		<main class="select-mode">
			<div class="select-header">
				<div class="header-info">
					<h2>Select Sprint Items</h2>
					<p>Choose items from the backlog for the sprint</p>
				</div>
				<button type="button" class="cancel-btn" onclick={() => { mode = 'overview'; selectedItems = new Set(); }}>
					Cancel
				</button>
			</div>

			<div class="select-content">
				<div class="backlog-column">
					<h3>Product Backlog</h3>
					{#if backlogItems.length === 0}
						<div class="empty-backlog">
							<i class="bx bx-package"></i>
							<p>Backlog is empty</p>
							<button type="button" onclick={() => goto(`/agile/board/${boardId}/backlog`)}>
								Go to Backlog
							</button>
						</div>
					{:else}
						<div class="items-list">
							{#each backlogItems as item (item.id)}
								<button
									type="button"
									class="backlog-item"
									class:selected={selectedItems.has(item.id)}
									onclick={() => toggleItem(item.id)}
								>
									<div class="item-check">
										{#if selectedItems.has(item.id)}
											<i class="bx bx-check"></i>
										{/if}
									</div>
									<div class="item-content">
										<span class="item-key">{item.key}</span>
										<span class="item-title">{item.title}</span>
									</div>
									<div class="item-meta">
										<span class="priority-dot" style="background: {getPriorityColor(item.priority)}"></span>
										{#if item.storyPoints}
											<span class="points">{item.storyPoints}</span>
										{/if}
									</div>
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<div class="sprint-column">
					<h3>Sprint Commitment</h3>
					
					<div class="sprint-form">
						<div class="form-group">
							<label for="sprint-name">Sprint Name</label>
							<input
								type="text"
								id="sprint-name"
								bind:value={newSprintName}
								placeholder={`Sprint ${allSprints.length + 1}`}
							/>
						</div>

						<div class="form-group">
							<label for="sprint-goal">Sprint Goal</label>
							<textarea
								id="sprint-goal"
								bind:value={newSprintGoal}
								placeholder="What is the objective of this sprint?"
								rows="2"
							></textarea>
						</div>

						<div class="form-group">
							<label for="duration">Duration (days)</label>
							<select id="duration" bind:value={sprintDuration}>
								<option value={7}>1 week</option>
								<option value={14}>2 weeks</option>
								<option value={21}>3 weeks</option>
							</select>
						</div>
					</div>

					<div class="commitment-summary">
						<div class="summary-row">
							<span>Selected Items</span>
							<strong>{selectedItems.size}</strong>
						</div>
						<div class="summary-row">
							<span>Total Points</span>
							<strong>{totalPoints}</strong>
						</div>
						{#if averageVelocity}
							<div class="summary-row velocity-compare" class:over={totalPoints > averageVelocity}>
								<span>vs. Yesterday's Weather</span>
								<strong>{totalPoints - averageVelocity > 0 ? '+' : ''}{totalPoints - averageVelocity}</strong>
							</div>
						{/if}
					</div>

					<button
						type="button"
						class="create-btn"
						onclick={handleCreateSprint}
						disabled={selectedItems.size === 0}
					>
						<i class="bx bx-check"></i>
						Create Sprint
					</button>
				</div>
			</div>
		</main>
	{/if}
</div>

<style>
	.planning-page {
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

	/* Overview */
	.planning-overview {
		padding: 1.5rem;
		max-width: 700px;
		margin: 0 auto;
	}

	.guidance-card {
		text-align: center;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.guidance-icon {
		font-size: 2.5rem;
		margin-bottom: 0.5rem;
	}

	.guidance-card h2 {
		font-size: 1.125rem;
		margin: 0 0 0.5rem;
	}

	.guidance-card p {
		color: var(--text-60);
		font-size: 0.9375rem;
		margin: 0;
	}

	.sprint-ready {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		padding: 1.5rem;
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.sprint-ready h3 {
		margin: 0 0 0.5rem;
	}

	.sprint-goal {
		color: var(--text-60);
		font-style: italic;
		margin: 0 0 1rem;
	}

	.sprint-stats {
		display: flex;
		justify-content: center;
		gap: 2rem;
		margin-bottom: 1rem;
	}

	.sprint-stats .stat {
		text-align: center;
	}

	.sprint-stats .value {
		display: block;
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-accent);
	}

	.sprint-stats .label {
		font-size: 0.75rem;
		color: var(--text-50);
		text-transform: uppercase;
	}

	.start-sprint-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.75rem;
		background: #10b981;
		color: white;
		border: none;
		border-radius: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 500;
		cursor: pointer;
	}

	.active-sprint-notice {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.25rem;
		background: #fef3c7;
		border: 1px solid #fcd34d;
		border-radius: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.active-sprint-notice i {
		font-size: 1.5rem;
		color: #d97706;
	}

	.active-sprint-notice div {
		flex: 1;
	}

	.active-sprint-notice h3 {
		margin: 0;
		font-size: 0.9375rem;
	}

	.active-sprint-notice p {
		margin: 0.125rem 0 0;
		font-size: 0.8125rem;
		color: #92400e;
	}

	.active-sprint-notice button {
		padding: 0.5rem 0.875rem;
		background: white;
		border: 1px solid #d97706;
		color: #d97706;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.planning-actions {
		margin-bottom: 1.5rem;
	}

	.action-card {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2rem;
		background: var(--color-panel);
		border: 2px dashed var(--text-12);
		border-radius: 0.75rem;
		cursor: pointer;
		text-align: center;
	}

	.action-card:hover {
		border-color: var(--color-accent);
		background: var(--color-accent-muted);
	}

	.action-card i {
		font-size: 2rem;
		color: var(--color-accent);
		margin-bottom: 0.5rem;
	}

	.action-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.action-desc {
		font-size: 0.8125rem;
		color: var(--text-50);
	}

	.velocity-section {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
		text-align: center;
	}

	.velocity-section h3 {
		margin: 0 0 0.5rem;
		font-size: 0.9375rem;
	}

	.velocity-desc {
		font-size: 0.8125rem;
		color: var(--text-60);
		margin: 0 0 1rem;
	}

	.velocity-display {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.velocity-value {
		font-size: 2.5rem;
		font-weight: 700;
		color: var(--color-accent);
	}

	.velocity-label {
		font-size: 0.75rem;
		color: var(--text-50);
		text-transform: uppercase;
	}

	.velocity-hint {
		font-size: 0.75rem;
		color: var(--text-50);
		margin: 0;
		font-style: italic;
	}

	.tips-section {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		padding: 1.25rem;
	}

	.tips-section h3 {
		margin: 0 0 1rem;
		font-size: 0.9375rem;
	}

	.tips-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	.tip {
		display: flex;
		gap: 0.75rem;
	}

	.tip i {
		font-size: 1.25rem;
		color: var(--color-accent);
	}

	.tip strong {
		display: block;
		font-size: 0.8125rem;
	}

	.tip span {
		font-size: 0.75rem;
		color: var(--text-50);
	}

	/* Select Mode */
	.select-mode {
		height: calc(100% - 80px);
		display: flex;
		flex-direction: column;
	}

	.select-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.5rem;
		background: var(--color-panel);
		border-bottom: 1px solid var(--text-08);
	}

	.header-info h2 {
		margin: 0;
		font-size: 1rem;
	}

	.header-info p {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--text-50);
	}

	.cancel-btn {
		padding: 0.5rem 0.875rem;
		background: var(--text-06);
		border: none;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.select-content {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr 350px;
		overflow: hidden;
	}

	.backlog-column {
		border-right: 1px solid var(--text-08);
		overflow-y: auto;
		padding: 1rem;
	}

	.backlog-column h3 {
		margin: 0 0 0.75rem;
		font-size: 0.9375rem;
	}

	.empty-backlog {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2rem;
		color: var(--text-50);
	}

	.empty-backlog i {
		font-size: 2rem;
		margin-bottom: 0.5rem;
	}

	.empty-backlog button {
		margin-top: 0.75rem;
		padding: 0.5rem 0.875rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.items-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.backlog-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.5rem;
		cursor: pointer;
		text-align: left;
		width: 100%;
	}

	.backlog-item:hover {
		background: var(--text-04);
	}

	.backlog-item.selected {
		border-color: var(--color-accent);
		background: var(--color-accent-muted);
	}

	.item-check {
		width: 1.25rem;
		height: 1.25rem;
		border: 2px solid var(--text-20);
		border-radius: 0.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.backlog-item.selected .item-check {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: white;
	}

	.item-content {
		flex: 1;
		min-width: 0;
	}

	.item-key {
		display: block;
		font-size: 0.6875rem;
		color: var(--text-50);
		font-weight: 600;
	}

	.item-title {
		display: block;
		font-size: 0.875rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.item-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.priority-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
	}

	.points {
		font-size: 0.75rem;
		padding: 0.125rem 0.375rem;
		background: var(--text-08);
		border-radius: 0.25rem;
	}

	.sprint-column {
		padding: 1rem;
		background: var(--color-panel);
		display: flex;
		flex-direction: column;
	}

	.sprint-column h3 {
		margin: 0 0 1rem;
		font-size: 0.9375rem;
	}

	.sprint-form {
		margin-bottom: 1rem;
	}

	.form-group {
		margin-bottom: 0.75rem;
	}

	.form-group label {
		display: block;
		font-size: 0.75rem;
		font-weight: 500;
		margin-bottom: 0.25rem;
		color: var(--text-60);
	}

	.form-group input,
	.form-group textarea,
	.form-group select {
		width: 100%;
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--text-12);
		border-radius: 0.375rem;
		font-size: 0.875rem;
		background: var(--color-panel);
	}

	.commitment-summary {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1rem;
		background: var(--text-04);
		border-radius: 0.5rem;
		margin-bottom: 1rem;
	}

	.summary-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.875rem;
	}

	.summary-row span {
		color: var(--text-60);
	}

	.velocity-compare {
		padding-top: 0.5rem;
		border-top: 1px solid var(--text-10);
	}

	.velocity-compare strong {
		color: #10b981;
	}

	.velocity-compare.over strong {
		color: #f97316;
	}

	.create-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.5rem;
		font-size: 0.9375rem;
		cursor: pointer;
	}

	.create-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
