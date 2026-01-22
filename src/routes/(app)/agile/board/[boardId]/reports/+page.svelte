<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		subscribeBoard,
		subscribeItems,
		subscribeActiveSprints,
		subscribeSprints,
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

	// Report type
	let selectedReport = $state<'burndown' | 'velocity' | 'cumulative'>('burndown');

	// Subscriptions
	let unsubBoard: Unsubscribe | null = null;
	let unsubSprint: Unsubscribe | null = null;
	let unsubSprints: Unsubscribe | null = null;
	let unsubItems: Unsubscribe | null = null;

	// Derived
	const sprintItems = $derived(items.filter(i => i.sprintId === activeSprint?.id));
	const completedSprints = $derived(allSprints.filter(s => s.status === 'completed').slice(-6));

	// Burndown data (simulated for now)
	const burndownData = $derived.by(() => {
		if (!activeSprint) return [];
		const totalPoints = sprintItems.reduce((sum, i) => sum + (i.storyPoints || 0), 0);
		const donePoints = sprintItems.filter(i => i.status === 'done').reduce((sum, i) => sum + (i.storyPoints || 0), 0);
		
		// Generate sample data points
		const days = [];
		const startDate = activeSprint.startDate?.toDate?.() || new Date();
		const endDate = activeSprint.endDate?.toDate?.() || new Date();
		const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) || 14;
		const today = new Date();
		const daysPassed = Math.min(
			Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
			totalDays
		);
		
		for (let i = 0; i <= totalDays; i++) {
			const date = new Date(startDate);
			date.setDate(date.getDate() + i);
			days.push({
				day: i + 1,
				date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
				ideal: totalPoints - (totalPoints / totalDays) * i,
				actual: i <= daysPassed ? totalPoints - (donePoints / daysPassed) * i : null
			});
		}
		return days;
	});

	// Velocity data
	const velocityData = $derived.by(() => {
		return completedSprints.map(sprint => ({
			name: sprint.name,
			committed: sprint.plannedVelocity || 0,
			completed: sprint.actualVelocity || 0
		}));
	});

	const averageVelocity = $derived.by(() => {
		if (velocityData.length === 0) return 0;
		const total = velocityData.reduce((sum, s) => sum + s.completed, 0);
		return Math.round(total / velocityData.length);
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

	function getMaxPoints(): number {
		if (burndownData.length === 0) return 100;
		return Math.max(...burndownData.map(d => d.ideal));
	}

	function getBarHeight(value: number, maxValue: number): number {
		return (value / maxValue) * 100;
	}
</script>

<div class="reports-page">
	<header class="page-header">
		<button type="button" class="back-btn" onclick={() => goto(`/agile/board/${boardId}`)}>
			<i class="bx bx-arrow-back"></i>
		</button>
		<div class="header-content">
			<h1>Reports</h1>
			<p>{board?.name}</p>
		</div>
	</header>

	{#if loading}
		<div class="loading">
			<i class="bx bx-loader-alt bx-spin"></i>
		</div>
	{:else}
		<main class="reports-main">
			<!-- Report Tabs -->
			<div class="report-tabs">
				<button
					type="button"
					class="tab"
					class:active={selectedReport === 'burndown'}
					onclick={() => selectedReport = 'burndown'}
				>
					<i class="bx bx-line-chart"></i>
					Burndown
				</button>
				<button
					type="button"
					class="tab"
					class:active={selectedReport === 'velocity'}
					onclick={() => selectedReport = 'velocity'}
				>
					<i class="bx bx-bar-chart-alt-2"></i>
					Velocity
				</button>
				<button
					type="button"
					class="tab"
					class:active={selectedReport === 'cumulative'}
					onclick={() => selectedReport = 'cumulative'}
				>
					<i class="bx bx-area"></i>
					Cumulative Flow
				</button>
			</div>

			{#if selectedReport === 'burndown'}
				<!-- Burndown Chart -->
				<section class="chart-section">
					<div class="chart-header">
						<h2>Sprint Burndown</h2>
						{#if activeSprint}
							<span class="sprint-label">{activeSprint.name}</span>
						{/if}
					</div>

					{#if !activeSprint}
						<div class="no-data">
							<i class="bx bx-line-chart"></i>
							<p>No active sprint</p>
							<button type="button" onclick={() => goto(`/agile/board/${boardId}/planning`)}>
								Start Planning
							</button>
						</div>
					{:else if burndownData.length > 0}
						<div class="burndown-chart">
							<div class="chart-y-axis">
								{@const max = getMaxPoints()}
								<span>{max}</span>
								<span>{Math.round(max * 0.75)}</span>
								<span>{Math.round(max * 0.5)}</span>
								<span>{Math.round(max * 0.25)}</span>
								<span>0</span>
							</div>
							<div class="chart-area">
								<svg viewBox="0 0 {burndownData.length * 60} 200" preserveAspectRatio="none">
									<!-- Ideal line -->
									<polyline
										class="ideal-line"
										fill="none"
										stroke="#94a3b8"
										stroke-width="2"
										stroke-dasharray="5,5"
										points={burndownData.map((d, i) => 
											`${i * 60 + 30},${200 - (d.ideal / getMaxPoints()) * 180}`
										).join(' ')}
									/>
									<!-- Actual line -->
									<polyline
										class="actual-line"
										fill="none"
										stroke="#3b82f6"
										stroke-width="3"
										points={burndownData
											.filter(d => d.actual !== null)
											.map((d, i) => 
												`${i * 60 + 30},${200 - ((d.actual ?? 0) / getMaxPoints()) * 180}`
											).join(' ')}
									/>
									<!-- Data points -->
									{#each burndownData.filter(d => d.actual !== null) as d, i}
										<circle
											cx={i * 60 + 30}
											cy={200 - ((d.actual ?? 0) / getMaxPoints()) * 180}
											r="4"
											fill="#3b82f6"
										/>
									{/each}
								</svg>
								<div class="chart-x-axis">
									{#each burndownData as d, i}
										{#if i % 2 === 0 || burndownData.length < 10}
											<span style="left: {(i / (burndownData.length - 1)) * 100}%">{d.date}</span>
										{/if}
									{/each}
								</div>
							</div>
						</div>
						<div class="chart-legend">
							<span class="legend-item">
								<span class="line dashed"></span>
								Ideal
							</span>
							<span class="legend-item">
								<span class="line solid"></span>
								Actual
							</span>
						</div>
					{/if}

					<!-- Burndown Info -->
					<div class="info-box">
						<i class="bx bx-info-circle"></i>
						<div>
							<strong>Reading the Burndown</strong>
							<p>The ideal line shows perfect progress. If your actual line is above it, you're behind. Below it means you're ahead. A flat line means no progress.</p>
						</div>
					</div>
				</section>

			{:else if selectedReport === 'velocity'}
				<!-- Velocity Chart -->
				<section class="chart-section">
					<div class="chart-header">
						<h2>Team Velocity</h2>
						{#if averageVelocity > 0}
							<span class="avg-velocity">Avg: {averageVelocity} pts</span>
						{/if}
					</div>

					{#if velocityData.length === 0}
						<div class="no-data">
							<i class="bx bx-bar-chart-alt-2"></i>
							<p>No completed sprints yet</p>
							<span class="hint">Complete sprints to see velocity trends</span>
						</div>
					{:else}
						{@const maxVelocity = Math.max(...velocityData.flatMap(v => [v.committed, v.completed])) || 50}
						<div class="velocity-chart">
							<div class="chart-y-axis">
								<span>{maxVelocity}</span>
								<span>{Math.round(maxVelocity * 0.75)}</span>
								<span>{Math.round(maxVelocity * 0.5)}</span>
								<span>{Math.round(maxVelocity * 0.25)}</span>
								<span>0</span>
							</div>
							<div class="bars-area">
								{#each velocityData as sprint}
									<div class="bar-group">
										<div class="bars">
											<div 
												class="bar committed" 
												style="height: {getBarHeight(sprint.committed, maxVelocity)}%"
												title="Committed: {sprint.committed}"
											></div>
											<div 
												class="bar completed" 
												style="height: {getBarHeight(sprint.completed, maxVelocity)}%"
												title="Completed: {sprint.completed}"
											></div>
										</div>
										<span class="bar-label">{sprint.name}</span>
									</div>
								{/each}
							</div>
						</div>
						<div class="chart-legend">
							<span class="legend-item">
								<span class="box committed"></span>
								Committed
							</span>
							<span class="legend-item">
								<span class="box completed"></span>
								Completed
							</span>
						</div>
					{/if}

					<!-- Velocity Info -->
					<div class="info-box">
						<i class="bx bx-info-circle"></i>
						<div>
							<strong>Yesterday's Weather</strong>
							<p>Use your average velocity to plan future sprints. If you consistently complete less than committed, reduce your commitment. Sustainable pace is key!</p>
						</div>
					</div>
				</section>

			{:else}
				<!-- Cumulative Flow -->
				<section class="chart-section">
					<div class="chart-header">
						<h2>Cumulative Flow Diagram</h2>
					</div>
					<div class="no-data">
						<i class="bx bx-area"></i>
						<p>Cumulative Flow Diagram coming soon</p>
						<span class="hint">Track work item flow over time</span>
					</div>
				</section>
			{/if}

			<!-- Quick Stats -->
			<section class="quick-stats">
				<h3>Current Sprint Stats</h3>
				{#if activeSprint}
					{@const total = sprintItems.length}
					{@const done = sprintItems.filter(i => i.status === 'done').length}
					{@const inProgress = sprintItems.filter(i => i.status === 'in_progress').length}
					{@const blocked = sprintItems.filter(i => i.status === 'blocked').length}
					{@const totalPoints = sprintItems.reduce((s, i) => s + (i.storyPoints || 0), 0)}
					{@const donePoints = sprintItems.filter(i => i.status === 'done').reduce((s, i) => s + (i.storyPoints || 0), 0)}

					<div class="stats-grid">
						<div class="stat">
							<span class="stat-value">{total}</span>
							<span class="stat-label">Total Items</span>
						</div>
						<div class="stat">
							<span class="stat-value">{done}</span>
							<span class="stat-label">Done</span>
						</div>
						<div class="stat">
							<span class="stat-value">{inProgress}</span>
							<span class="stat-label">In Progress</span>
						</div>
						<div class="stat">
							<span class="stat-value" class:warning={blocked > 0}>{blocked}</span>
							<span class="stat-label">Blocked</span>
						</div>
						<div class="stat">
							<span class="stat-value">{donePoints}/{totalPoints}</span>
							<span class="stat-label">Points</span>
						</div>
						<div class="stat">
							<span class="stat-value">{total > 0 ? Math.round((done / total) * 100) : 0}%</span>
							<span class="stat-label">Complete</span>
						</div>
					</div>
				{:else}
					<p class="no-sprint-stats">No active sprint</p>
				{/if}
			</section>
		</main>
	{/if}
</div>

<style>
	.reports-page {
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

	.reports-main {
		padding: 1.5rem;
		max-width: 900px;
		margin: 0 auto;
	}

	.report-tabs {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
		background: var(--color-panel);
		padding: 0.375rem;
		border-radius: 0.5rem;
		border: 1px solid var(--text-08);
	}

	.tab {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.625rem;
		background: none;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		color: var(--text-60);
		cursor: pointer;
	}

	.tab:hover {
		background: var(--text-06);
	}

	.tab.active {
		background: var(--color-accent);
		color: white;
	}

	.chart-section {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.chart-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.chart-header h2 {
		margin: 0;
		font-size: 1rem;
	}

	.sprint-label,
	.avg-velocity {
		font-size: 0.75rem;
		padding: 0.25rem 0.625rem;
		background: var(--text-08);
		border-radius: 1rem;
		color: var(--text-60);
	}

	.no-data {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 3rem 2rem;
		color: var(--text-50);
	}

	.no-data i {
		font-size: 2.5rem;
		margin-bottom: 0.75rem;
	}

	.no-data p {
		margin: 0;
		font-size: 0.9375rem;
	}

	.no-data .hint {
		font-size: 0.8125rem;
		margin-top: 0.25rem;
	}

	.no-data button {
		margin-top: 1rem;
		padding: 0.5rem 1rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
	}

	/* Burndown Chart */
	.burndown-chart {
		display: flex;
		gap: 0.5rem;
		height: 250px;
	}

	.chart-y-axis {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		padding: 0.5rem 0;
		font-size: 0.6875rem;
		color: var(--text-50);
		text-align: right;
		width: 2.5rem;
	}

	.chart-area {
		flex: 1;
		position: relative;
		background: 
			repeating-linear-gradient(
				to bottom,
				transparent,
				transparent calc(25% - 1px),
				var(--text-06) calc(25% - 1px),
				var(--text-06) 25%
			);
		border-left: 1px solid var(--text-12);
		border-bottom: 1px solid var(--text-12);
	}

	.chart-area svg {
		width: 100%;
		height: calc(100% - 1.5rem);
	}

	.chart-x-axis {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 1.5rem;
		font-size: 0.6875rem;
		color: var(--text-50);
	}

	.chart-x-axis span {
		position: absolute;
		transform: translateX(-50%);
	}

	.chart-legend {
		display: flex;
		justify-content: center;
		gap: 1.5rem;
		margin-top: 1rem;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--text-60);
	}

	.legend-item .line {
		width: 1.5rem;
		height: 2px;
	}

	.legend-item .line.dashed {
		background: repeating-linear-gradient(
			to right,
			#94a3b8,
			#94a3b8 4px,
			transparent 4px,
			transparent 8px
		);
	}

	.legend-item .line.solid {
		background: #3b82f6;
	}

	.legend-item .box {
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 0.125rem;
	}

	.legend-item .box.committed {
		background: #94a3b8;
	}

	.legend-item .box.completed {
		background: #3b82f6;
	}

	/* Velocity Chart */
	.velocity-chart {
		display: flex;
		gap: 0.5rem;
		height: 250px;
	}

	.bars-area {
		flex: 1;
		display: flex;
		justify-content: space-around;
		align-items: flex-end;
		padding-bottom: 1.5rem;
		border-left: 1px solid var(--text-12);
		border-bottom: 1px solid var(--text-12);
		background: 
			repeating-linear-gradient(
				to bottom,
				transparent,
				transparent calc(25% - 1px),
				var(--text-06) calc(25% - 1px),
				var(--text-06) 25%
			);
	}

	.bar-group {
		display: flex;
		flex-direction: column;
		align-items: center;
		height: 100%;
	}

	.bars {
		flex: 1;
		display: flex;
		gap: 0.25rem;
		align-items: flex-end;
		padding-bottom: 0.25rem;
	}

	.bar {
		width: 1.5rem;
		border-radius: 0.25rem 0.25rem 0 0;
		transition: height 0.3s ease;
	}

	.bar.committed {
		background: #94a3b8;
	}

	.bar.completed {
		background: #3b82f6;
	}

	.bar-label {
		font-size: 0.6875rem;
		color: var(--text-50);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 4rem;
	}

	.info-box {
		display: flex;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--color-accent-muted);
		border-radius: 0.5rem;
		margin-top: 1rem;
	}

	.info-box i {
		font-size: 1.25rem;
		color: var(--color-accent);
	}

	.info-box strong {
		display: block;
		font-size: 0.8125rem;
		margin-bottom: 0.125rem;
	}

	.info-box p {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-60);
	}

	/* Quick Stats */
	.quick-stats {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		padding: 1.25rem;
	}

	.quick-stats h3 {
		margin: 0 0 1rem;
		font-size: 0.9375rem;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 1rem;
	}

	.stat {
		text-align: center;
	}

	.stat-value {
		display: block;
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.stat-value.warning {
		color: #dc2626;
	}

	.stat-label {
		font-size: 0.6875rem;
		color: var(--text-50);
		text-transform: uppercase;
	}

	.no-sprint-stats {
		text-align: center;
		color: var(--text-50);
		padding: 1rem;
	}

	@media (max-width: 768px) {
		.stats-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
</style>
