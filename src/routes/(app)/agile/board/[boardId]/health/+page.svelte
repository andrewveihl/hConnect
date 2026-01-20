<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { user } from '$lib/stores/user';
	import {
		subscribeBoard,
		TEAM_HEALTH_DIMENSIONS,
		type AgileBoard
	} from '$lib/firestore/agile';
	import type { Unsubscribe } from 'firebase/firestore';

	const boardId = $derived($page.params.boardId);

	// State
	let board = $state<AgileBoard | null>(null);
	let loading = $state(true);

	// Health check state
	let mode = $state<'overview' | 'check'>('overview');
	let currentDimension = $state(0);
	let responses = $state<Record<string, 'green' | 'yellow' | 'red' | null>>({});
	let trend = $state<Record<string, 'up' | 'down' | 'same' | null>>({});

	// Subscriptions
	let unsubBoard: Unsubscribe | null = null;

	const dimensions = Object.entries(TEAM_HEALTH_DIMENSIONS);
	const currentDim = $derived(dimensions[currentDimension]);
	const allResponded = $derived(Object.values(responses).filter(Boolean).length === dimensions.length);

	// Summary stats
	const greenCount = $derived(Object.values(responses).filter(r => r === 'green').length);
	const yellowCount = $derived(Object.values(responses).filter(r => r === 'yellow').length);
	const redCount = $derived(Object.values(responses).filter(r => r === 'red').length);

	onMount(() => {
		if (!boardId) return;

		unsubBoard = subscribeBoard(boardId, (b) => {
			board = b;
			loading = false;
		});

		// Initialize responses
		const initialResponses: typeof responses = {};
		const initialTrend: typeof trend = {};
		dimensions.forEach(([key]) => {
			initialResponses[key] = null;
			initialTrend[key] = null;
		});
		responses = initialResponses;
		trend = initialTrend;
	});

	onDestroy(() => {
		unsubBoard?.();
	});

	function startCheck() {
		mode = 'check';
		currentDimension = 0;
	}

	function setResponse(color: 'green' | 'yellow' | 'red') {
		if (!currentDim) return;
		responses = { ...responses, [currentDim[0]]: color };
	}

	function setTrend(direction: 'up' | 'down' | 'same') {
		if (!currentDim) return;
		trend = { ...trend, [currentDim[0]]: direction };
	}

	function nextDimension() {
		if (currentDimension < dimensions.length - 1) {
			currentDimension++;
		}
	}

	function prevDimension() {
		if (currentDimension > 0) {
			currentDimension--;
		}
	}

	function getColorClass(response: 'green' | 'yellow' | 'red' | null): string {
		if (!response) return '';
		return response;
	}

	function getIcon(key: string): string {
		const icons: Record<string, string> = {
			teamwork: '🤝',
			pawnsOrPlayers: '♟️',
			mission: '🎯',
			codebaseHealth: '💻',
			speed: '⚡',
			deliveringValue: '📦',
			suitableProcess: '🔄',
			fun: '🎉'
		};
		return icons[key] || '📊';
	}
</script>

<div class="health-page">
	<header class="page-header">
		<button type="button" class="back-btn" onclick={() => mode === 'check' ? mode = 'overview' : goto(`/agile/board/${boardId}`)}>
			<i class="bx bx-arrow-back"></i>
		</button>
		<div class="header-content">
			<h1>Team Health Check</h1>
			<p>{board?.name}</p>
		</div>
	</header>

	{#if loading}
		<div class="loading">
			<i class="bx bx-loader-alt bx-spin"></i>
		</div>
	{:else if mode === 'overview'}
		<main class="health-overview">
			<!-- Introduction -->
			<section class="intro-section">
				<div class="intro-icon">💚</div>
				<h2>Team Health Check</h2>
				<p>A structured way for teams to visualize what's working and what needs improvement. Based on Spotify's Squad Health Check model.</p>
			</section>

			<!-- Start Check CTA -->
			<section class="start-section">
				<button type="button" class="start-btn" onclick={startCheck}>
					<i class="bx bx-play"></i>
					Start Health Check
				</button>
				<p class="duration">About 15-30 minutes with your team</p>
			</section>

			<!-- Dimensions Overview -->
			<section class="dimensions-section">
				<h3>The {dimensions.length} Dimensions</h3>
				<div class="dimensions-grid">
					{#each dimensions as [key, dim]}
						<div class="dimension-card">
							<span class="dim-icon">{getIcon(key)}</span>
							<span class="dim-name">{dim.name}</span>
							<span class="dim-desc">{dim.description}</span>
						</div>
					{/each}
				</div>
			</section>

			<!-- How It Works -->
			<section class="how-section">
				<h3>How It Works</h3>
				<div class="steps">
					<div class="step">
						<span class="step-num">1</span>
						<div>
							<strong>Rate each dimension</strong>
							<span>🟢 Good, 🟡 Some Issues, 🔴 Needs Work</span>
						</div>
					</div>
					<div class="step">
						<span class="step-num">2</span>
						<div>
							<strong>Indicate the trend</strong>
							<span>↗️ Improving, ↘️ Getting Worse, ➡️ Same</span>
						</div>
					</div>
					<div class="step">
						<span class="step-num">3</span>
						<div>
							<strong>Discuss as a team</strong>
							<span>Focus on red areas and downward trends</span>
						</div>
					</div>
					<div class="step">
						<span class="step-num">4</span>
						<div>
							<strong>Create action items</strong>
							<span>Pick 1-2 areas to improve next sprint</span>
						</div>
					</div>
				</div>
			</section>

			<!-- Tips -->
			<section class="tips-section">
				<h3>Tips for Success</h3>
				<ul>
					<li>Run health checks regularly (every sprint or monthly)</li>
					<li>Everyone participates - no spectators</li>
					<li>Compare with previous checks to see trends over time</li>
					<li>Don't try to fix everything at once</li>
					<li>Celebrate improvements, not just identify problems</li>
				</ul>
			</section>
		</main>
	{:else}
		<!-- Health Check Mode -->
		<main class="health-check">
			{#if !allResponded}
				<!-- Rating Phase -->
				<div class="check-progress">
					<div class="progress-bar">
						<div class="progress-fill" style="width: {((currentDimension + 1) / dimensions.length) * 100}%"></div>
					</div>
					<span class="progress-text">{currentDimension + 1} of {dimensions.length}</span>
				</div>

				{#if currentDim}
					{@const [key, dim] = currentDim}
					<div class="dimension-question">
						<span class="q-icon">{getIcon(key)}</span>
						<h2>{dim.name}</h2>
						<p class="q-description">{dim.description}</p>

						<div class="healthy-unhealthy">
							<div class="healthy">
								<span class="label">Healthy</span>
								<span class="desc">{dim.healthy}</span>
							</div>
							<div class="unhealthy">
								<span class="label">Unhealthy</span>
								<span class="desc">{dim.unhealthy}</span>
							</div>
						</div>

						<!-- Color Response -->
						<div class="response-section">
							<h3>How are we doing?</h3>
							<div class="color-buttons">
								<button
									type="button"
									class="color-btn green"
									class:selected={responses[key] === 'green'}
									onclick={() => setResponse('green')}
								>
									<span class="emoji">😊</span>
									<span>Good</span>
								</button>
								<button
									type="button"
									class="color-btn yellow"
									class:selected={responses[key] === 'yellow'}
									onclick={() => setResponse('yellow')}
								>
									<span class="emoji">😐</span>
									<span>Some Issues</span>
								</button>
								<button
									type="button"
									class="color-btn red"
									class:selected={responses[key] === 'red'}
									onclick={() => setResponse('red')}
								>
									<span class="emoji">😟</span>
									<span>Needs Work</span>
								</button>
							</div>
						</div>

						<!-- Trend -->
						{#if responses[key]}
							<div class="trend-section">
								<h3>What's the trend?</h3>
								<div class="trend-buttons">
									<button
										type="button"
										class="trend-btn"
										class:selected={trend[key] === 'up'}
										onclick={() => setTrend('up')}
									>
										<i class="bx bx-trending-up"></i>
										<span>Improving</span>
									</button>
									<button
										type="button"
										class="trend-btn"
										class:selected={trend[key] === 'same'}
										onclick={() => setTrend('same')}
									>
										<i class="bx bx-minus"></i>
										<span>Same</span>
									</button>
									<button
										type="button"
										class="trend-btn"
										class:selected={trend[key] === 'down'}
										onclick={() => setTrend('down')}
									>
										<i class="bx bx-trending-down"></i>
										<span>Getting Worse</span>
									</button>
								</div>
							</div>
						{/if}
					</div>

					<!-- Navigation -->
					<div class="check-nav">
						<button
							type="button"
							class="nav-btn"
							onclick={prevDimension}
							disabled={currentDimension === 0}
						>
							<i class="bx bx-chevron-left"></i>
							Previous
						</button>

						{#if currentDimension < dimensions.length - 1}
							<button
								type="button"
								class="nav-btn primary"
								onclick={nextDimension}
								disabled={!responses[key]}
							>
								Next
								<i class="bx bx-chevron-right"></i>
							</button>
						{:else}
							<button
								type="button"
								class="nav-btn done"
								onclick={() => {}}
								disabled={!responses[key]}
							>
								View Results
								<i class="bx bx-check"></i>
							</button>
						{/if}
					</div>
				{/if}
			{:else}
				<!-- Results Phase -->
				<div class="results">
					<h2>Health Check Results</h2>

					<div class="results-summary">
						<div class="summary-item green">
							<span class="count">{greenCount}</span>
							<span class="label">Good</span>
						</div>
						<div class="summary-item yellow">
							<span class="count">{yellowCount}</span>
							<span class="label">Some Issues</span>
						</div>
						<div class="summary-item red">
							<span class="count">{redCount}</span>
							<span class="label">Needs Work</span>
						</div>
					</div>

					<div class="results-grid">
						{#each dimensions as [key, dim]}
							{@const response = responses[key]}
							{@const trendDir = trend[key]}
							<div class="result-card {response}">
								<span class="r-icon">{getIcon(key)}</span>
								<span class="r-name">{dim.name}</span>
								<div class="r-indicators">
									<span class="r-color {response}">
										{#if response === 'green'}😊{:else if response === 'yellow'}😐{:else}😟{/if}
									</span>
									{#if trendDir}
										<span class="r-trend">
											{#if trendDir === 'up'}↗️{:else if trendDir === 'down'}↘️{:else}➡️{/if}
										</span>
									{/if}
								</div>
							</div>
						{/each}
					</div>

					<div class="results-actions">
						<button type="button" class="action-btn" onclick={() => mode = 'overview'}>
							Done
						</button>
					</div>
				</div>
			{/if}
		</main>
	{/if}
</div>

<style>
	.health-page {
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
	.health-overview {
		padding: 1.5rem;
		max-width: 700px;
		margin: 0 auto;
	}

	.intro-section {
		text-align: center;
		padding: 1.5rem;
		margin-bottom: 1rem;
	}

	.intro-icon {
		font-size: 2.5rem;
		margin-bottom: 0.5rem;
	}

	.intro-section h2 {
		font-size: 1.125rem;
		margin: 0 0 0.5rem;
	}

	.intro-section p {
		color: var(--text-60);
		font-size: 0.9375rem;
		margin: 0;
	}

	.start-section {
		text-align: center;
		margin-bottom: 2rem;
	}

	.start-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		margin: 0 auto;
		padding: 0.875rem 2rem;
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

	.duration {
		font-size: 0.8125rem;
		color: var(--text-50);
		margin: 0.5rem 0 0;
	}

	.dimensions-section h3 {
		margin: 0 0 0.75rem;
		font-size: 0.9375rem;
	}

	.dimensions-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.dimension-card {
		display: flex;
		flex-direction: column;
		padding: 1rem;
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
	}

	.dim-icon {
		font-size: 1.25rem;
		margin-bottom: 0.375rem;
	}

	.dim-name {
		font-size: 0.875rem;
		font-weight: 600;
	}

	.dim-desc {
		font-size: 0.75rem;
		color: var(--text-50);
		margin-top: 0.125rem;
	}

	.how-section {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.how-section h3 {
		margin: 0 0 1rem;
		font-size: 0.9375rem;
	}

	.steps {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.step {
		display: flex;
		gap: 0.75rem;
	}

	.step-num {
		width: 1.5rem;
		height: 1.5rem;
		background: var(--color-accent);
		color: white;
		border-radius: 50%;
		font-size: 0.75rem;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.step strong {
		display: block;
		font-size: 0.875rem;
	}

	.step span {
		font-size: 0.75rem;
		color: var(--text-50);
	}

	.tips-section {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		padding: 1.25rem;
	}

	.tips-section h3 {
		margin: 0 0 0.75rem;
		font-size: 0.9375rem;
	}

	.tips-section ul {
		margin: 0;
		padding-left: 1.25rem;
	}

	.tips-section li {
		font-size: 0.8125rem;
		color: var(--text-70);
		margin-bottom: 0.375rem;
	}

	/* Health Check Mode */
	.health-check {
		padding: 1.5rem;
		max-width: 600px;
		margin: 0 auto;
	}

	.check-progress {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.progress-bar {
		flex: 1;
		height: 0.375rem;
		background: var(--text-12);
		border-radius: 1rem;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-accent);
		transition: width 0.3s ease;
	}

	.progress-text {
		font-size: 0.8125rem;
		color: var(--text-50);
	}

	.dimension-question {
		text-align: center;
	}

	.q-icon {
		font-size: 3rem;
		display: block;
		margin-bottom: 0.5rem;
	}

	.dimension-question h2 {
		margin: 0 0 0.5rem;
		font-size: 1.25rem;
	}

	.q-description {
		color: var(--text-60);
		margin: 0 0 1.5rem;
	}

	.healthy-unhealthy {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.healthy,
	.unhealthy {
		padding: 1rem;
		border-radius: 0.5rem;
	}

	.healthy {
		background: #dcfce7;
	}

	.unhealthy {
		background: #fef2f2;
	}

	.healthy .label,
	.unhealthy .label {
		display: block;
		font-size: 0.6875rem;
		text-transform: uppercase;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.healthy .label {
		color: #16a34a;
	}

	.unhealthy .label {
		color: #dc2626;
	}

	.healthy .desc,
	.unhealthy .desc {
		font-size: 0.8125rem;
	}

	.response-section,
	.trend-section {
		margin-bottom: 1.5rem;
	}

	.response-section h3,
	.trend-section h3 {
		font-size: 0.9375rem;
		margin: 0 0 0.75rem;
	}

	.color-buttons {
		display: flex;
		justify-content: center;
		gap: 0.75rem;
	}

	.color-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 1rem 1.5rem;
		border: 2px solid var(--text-12);
		border-radius: 0.75rem;
		background: var(--color-panel);
		cursor: pointer;
	}

	.color-btn:hover {
		background: var(--text-04);
	}

	.color-btn.green.selected {
		border-color: #22c55e;
		background: #dcfce7;
	}

	.color-btn.yellow.selected {
		border-color: #eab308;
		background: #fef9c3;
	}

	.color-btn.red.selected {
		border-color: #ef4444;
		background: #fef2f2;
	}

	.color-btn .emoji {
		font-size: 1.5rem;
		margin-bottom: 0.25rem;
	}

	.color-btn span:not(.emoji) {
		font-size: 0.75rem;
		color: var(--text-60);
	}

	.trend-buttons {
		display: flex;
		justify-content: center;
		gap: 0.75rem;
	}

	.trend-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.625rem 1rem;
		border: 1px solid var(--text-12);
		border-radius: 0.375rem;
		background: var(--color-panel);
		cursor: pointer;
	}

	.trend-btn.selected {
		border-color: var(--color-accent);
		background: var(--color-accent-muted);
	}

	.trend-btn i {
		font-size: 1rem;
	}

	.trend-btn span {
		font-size: 0.8125rem;
	}

	.check-nav {
		display: flex;
		justify-content: space-between;
		margin-top: 2rem;
	}

	.nav-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.625rem 1rem;
		background: var(--color-panel);
		border: 1px solid var(--text-12);
		border-radius: 0.375rem;
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

	/* Results */
	.results {
		text-align: center;
	}

	.results h2 {
		margin: 0 0 1.5rem;
	}

	.results-summary {
		display: flex;
		justify-content: center;
		gap: 1.5rem;
		margin-bottom: 2rem;
	}

	.summary-item {
		padding: 1rem 1.5rem;
		border-radius: 0.75rem;
	}

	.summary-item.green {
		background: #dcfce7;
	}

	.summary-item.yellow {
		background: #fef9c3;
	}

	.summary-item.red {
		background: #fef2f2;
	}

	.summary-item .count {
		display: block;
		font-size: 2rem;
		font-weight: 700;
	}

	.summary-item.green .count {
		color: #16a34a;
	}

	.summary-item.yellow .count {
		color: #ca8a04;
	}

	.summary-item.red .count {
		color: #dc2626;
	}

	.summary-item .label {
		font-size: 0.75rem;
		color: var(--text-50);
	}

	.results-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
		margin-bottom: 2rem;
		text-align: left;
	}

	.result-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.5rem;
		border-left: 4px solid transparent;
	}

	.result-card.green {
		border-left-color: #22c55e;
	}

	.result-card.yellow {
		border-left-color: #eab308;
	}

	.result-card.red {
		border-left-color: #ef4444;
	}

	.r-icon {
		font-size: 1.25rem;
	}

	.r-name {
		flex: 1;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.r-indicators {
		display: flex;
		gap: 0.25rem;
	}

	.results-actions {
		margin-top: 1rem;
	}

	.action-btn {
		padding: 0.75rem 2rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.5rem;
		font-size: 0.9375rem;
		cursor: pointer;
	}
</style>
