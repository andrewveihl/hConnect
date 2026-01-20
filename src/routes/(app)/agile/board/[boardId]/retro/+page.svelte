<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { user } from '$lib/stores/user';
	import {
		subscribeBoard,
		subscribeActiveSprints,
		subscribeSprints,
		type AgileBoard,
		type Sprint
	} from '$lib/firestore/agile';
	import type { Unsubscribe } from 'firebase/firestore';

	const boardId = $derived($page.params.boardId);

	// State
	let board = $state<AgileBoard | null>(null);
	let activeSprint = $state<Sprint | null>(null);
	let allSprints = $state<Sprint[]>([]);
	let loading = $state(true);

	// Retrospective state
	let mode = $state<'overview' | 'session'>('overview');
	let retroFormat = $state<'sailboat' | 'start-stop-continue' | 'mad-sad-glad'>('sailboat');
	
	// Sailboat format
	let wind = $state<string[]>([]);
	let anchors = $state<string[]>([]);
	let rocks = $state<string[]>([]);
	let island = $state<string[]>([]);
	
	// Input states
	let newWind = $state('');
	let newAnchor = $state('');
	let newRock = $state('');
	let newIsland = $state('');

	// Subscriptions
	let unsubBoard: Unsubscribe | null = null;
	let unsubSprint: Unsubscribe | null = null;
	let unsubSprints: Unsubscribe | null = null;

	// Completed sprints for retro
	const completedSprints = $derived(allSprints.filter(s => s.status === 'completed' || s.status === 'active'));

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
	});

	onDestroy(() => {
		unsubBoard?.();
		unsubSprint?.();
		unsubSprints?.();
	});

	function startSession(format: typeof retroFormat) {
		retroFormat = format;
		mode = 'session';
		// Reset items
		wind = [];
		anchors = [];
		rocks = [];
		island = [];
	}

	function addItem(category: 'wind' | 'anchor' | 'rock' | 'island') {
		if (category === 'wind' && newWind.trim()) {
			wind = [...wind, newWind.trim()];
			newWind = '';
		} else if (category === 'anchor' && newAnchor.trim()) {
			anchors = [...anchors, newAnchor.trim()];
			newAnchor = '';
		} else if (category === 'rock' && newRock.trim()) {
			rocks = [...rocks, newRock.trim()];
			newRock = '';
		} else if (category === 'island' && newIsland.trim()) {
			island = [...island, newIsland.trim()];
			newIsland = '';
		}
	}

	function removeItem(category: 'wind' | 'anchor' | 'rock' | 'island', index: number) {
		if (category === 'wind') {
			wind = wind.filter((_, i) => i !== index);
		} else if (category === 'anchor') {
			anchors = anchors.filter((_, i) => i !== index);
		} else if (category === 'rock') {
			rocks = rocks.filter((_, i) => i !== index);
		} else if (category === 'island') {
			island = island.filter((_, i) => i !== index);
		}
	}

	function handleKeydown(e: KeyboardEvent, category: 'wind' | 'anchor' | 'rock' | 'island') {
		if (e.key === 'Enter') {
			e.preventDefault();
			addItem(category);
		}
	}
</script>

<div class="retro-page">
	<header class="page-header">
		<button type="button" class="back-btn" onclick={() => mode === 'session' ? mode = 'overview' : goto(`/agile/board/${boardId}`)}>
			<i class="bx bx-arrow-back"></i>
		</button>
		<div class="header-content">
			<h1>Retrospective</h1>
			<p>{board?.name} • {activeSprint?.name || 'No active sprint'}</p>
		</div>
	</header>

	{#if loading}
		<div class="loading">
			<i class="bx bx-loader-alt bx-spin"></i>
		</div>
	{:else if mode === 'overview'}
		<main class="retro-overview">
			<!-- Purpose Section -->
			<section class="purpose-section">
				<div class="purpose-icon">🔄</div>
				<h2>Sprint Retrospective</h2>
				<p>A dedicated time for the team to reflect on the past sprint and identify ways to improve. Focus on process, teamwork, and continuous improvement.</p>
			</section>

			<!-- Quick Stats -->
			{#if activeSprint}
				<section class="sprint-context">
					<h3>Current Sprint: {activeSprint.name}</h3>
					{#if activeSprint.goal}
						<p class="sprint-goal">Goal: {activeSprint.goal}</p>
					{/if}
				</section>
			{/if}

			<!-- Format Selection -->
			<section class="format-section">
				<h3>Choose a Format</h3>
				<div class="format-grid">
					<button type="button" class="format-card" onclick={() => startSession('sailboat')}>
						<span class="format-icon">⛵</span>
						<span class="format-name">Sailboat</span>
						<span class="format-desc">Wind, Anchors, Rocks, Island</span>
					</button>
					<button type="button" class="format-card" onclick={() => startSession('start-stop-continue')}>
						<span class="format-icon">🚦</span>
						<span class="format-name">Start-Stop-Continue</span>
						<span class="format-desc">What to start, stop, continue</span>
					</button>
					<button type="button" class="format-card" onclick={() => startSession('mad-sad-glad')}>
						<span class="format-icon">😊</span>
						<span class="format-name">Mad-Sad-Glad</span>
						<span class="format-desc">Emotional reflection</span>
					</button>
				</div>
			</section>

			<!-- Retro Guidelines -->
			<section class="guidelines-section">
				<h3>Retrospective Guidelines</h3>
				<div class="guideline-list">
					<div class="guideline">
						<i class="bx bx-shield-quarter"></i>
						<div>
							<strong>Prime Directive</strong>
							<span>"Regardless of what we discover, we understand and believe that everyone did the best job they could."</span>
						</div>
					</div>
					<div class="guideline">
						<i class="bx bx-lock"></i>
						<div>
							<strong>Safe Space</strong>
							<span>What's said in retro stays in retro. Honesty leads to improvement.</span>
						</div>
					</div>
					<div class="guideline">
						<i class="bx bx-target-lock"></i>
						<div>
							<strong>Action Items</strong>
							<span>End with 1-3 actionable improvements for next sprint.</span>
						</div>
					</div>
					<div class="guideline">
						<i class="bx bx-time-five"></i>
						<div>
							<strong>Timeboxed</strong>
							<span>Keep it focused: 45-90 minutes maximum.</span>
						</div>
					</div>
				</div>
			</section>

			<!-- Past Retros -->
			{#if completedSprints.length > 0}
				<section class="history-section">
					<h3>Sprint History</h3>
					<div class="history-list">
						{#each completedSprints.slice(0, 5) as sprint (sprint.id)}
							<div class="history-item">
								<span class="sprint-name">{sprint.name}</span>
								<span class="sprint-status" class:completed={sprint.status === 'completed'}>
									{sprint.status === 'completed' ? 'Completed' : 'Active'}
								</span>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		</main>
	{:else if mode === 'session'}
		<!-- Retro Session -->
		<main class="retro-session">
			{#if retroFormat === 'sailboat'}
				<div class="sailboat-retro">
					<div class="sailboat-header">
						<h2>⛵ Sailboat Retrospective</h2>
						<p>What's helping us move forward? What's holding us back?</p>
					</div>

					<div class="sailboat-grid">
						<!-- Wind (What's pushing us forward) -->
						<div class="retro-column wind">
							<div class="column-header">
								<span class="column-icon">💨</span>
								<span class="column-title">Wind</span>
								<span class="column-subtitle">What's pushing us forward?</span>
							</div>
							<div class="column-items">
								{#each wind as item, i}
									<div class="retro-item">
										<span>{item}</span>
										<button type="button" onclick={() => removeItem('wind', i)}>
											<i class="bx bx-x"></i>
										</button>
									</div>
								{/each}
							</div>
							<div class="column-input">
								<input
									type="text"
									bind:value={newWind}
									placeholder="Add something positive..."
									onkeydown={(e) => handleKeydown(e, 'wind')}
								/>
								<button type="button" onclick={() => addItem('wind')}>
									<i class="bx bx-plus"></i>
								</button>
							</div>
						</div>

						<!-- Anchors (What's holding us back) -->
						<div class="retro-column anchors">
							<div class="column-header">
								<span class="column-icon">⚓</span>
								<span class="column-title">Anchors</span>
								<span class="column-subtitle">What's slowing us down?</span>
							</div>
							<div class="column-items">
								{#each anchors as item, i}
									<div class="retro-item">
										<span>{item}</span>
										<button type="button" onclick={() => removeItem('anchor', i)}>
											<i class="bx bx-x"></i>
										</button>
									</div>
								{/each}
							</div>
							<div class="column-input">
								<input
									type="text"
									bind:value={newAnchor}
									placeholder="Add a blocker..."
									onkeydown={(e) => handleKeydown(e, 'anchor')}
								/>
								<button type="button" onclick={() => addItem('anchor')}>
									<i class="bx bx-plus"></i>
								</button>
							</div>
						</div>

						<!-- Rocks (Risks) -->
						<div class="retro-column rocks">
							<div class="column-header">
								<span class="column-icon">🪨</span>
								<span class="column-title">Rocks</span>
								<span class="column-subtitle">Potential risks ahead?</span>
							</div>
							<div class="column-items">
								{#each rocks as item, i}
									<div class="retro-item">
										<span>{item}</span>
										<button type="button" onclick={() => removeItem('rock', i)}>
											<i class="bx bx-x"></i>
										</button>
									</div>
								{/each}
							</div>
							<div class="column-input">
								<input
									type="text"
									bind:value={newRock}
									placeholder="Add a risk..."
									onkeydown={(e) => handleKeydown(e, 'rock')}
								/>
								<button type="button" onclick={() => addItem('rock')}>
									<i class="bx bx-plus"></i>
								</button>
							</div>
						</div>

						<!-- Island (Goals) -->
						<div class="retro-column island">
							<div class="column-header">
								<span class="column-icon">🏝️</span>
								<span class="column-title">Island</span>
								<span class="column-subtitle">Our goals & destination</span>
							</div>
							<div class="column-items">
								{#each island as item, i}
									<div class="retro-item">
										<span>{item}</span>
										<button type="button" onclick={() => removeItem('island', i)}>
											<i class="bx bx-x"></i>
										</button>
									</div>
								{/each}
							</div>
							<div class="column-input">
								<input
									type="text"
									bind:value={newIsland}
									placeholder="Add a goal..."
									onkeydown={(e) => handleKeydown(e, 'island')}
								/>
								<button type="button" onclick={() => addItem('island')}>
									<i class="bx bx-plus"></i>
								</button>
							</div>
						</div>
					</div>

					<div class="session-actions">
						<button type="button" class="action-btn secondary" onclick={() => mode = 'overview'}>
							End Session
						</button>
					</div>
				</div>
			{:else if retroFormat === 'start-stop-continue'}
				<div class="ssc-retro">
					<div class="ssc-header">
						<h2>🚦 Start-Stop-Continue</h2>
						<p>What should we start doing, stop doing, or continue doing?</p>
					</div>
					<div class="ssc-placeholder">
						<p>Start-Stop-Continue format coming soon...</p>
						<button type="button" onclick={() => mode = 'overview'}>Go Back</button>
					</div>
				</div>
			{:else}
				<div class="msg-retro">
					<div class="msg-header">
						<h2>😊 Mad-Sad-Glad</h2>
						<p>How do we feel about the sprint?</p>
					</div>
					<div class="msg-placeholder">
						<p>Mad-Sad-Glad format coming soon...</p>
						<button type="button" onclick={() => mode = 'overview'}>Go Back</button>
					</div>
				</div>
			{/if}
		</main>
	{/if}
</div>

<style>
	.retro-page {
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
	.retro-overview {
		padding: 1.5rem;
		max-width: 700px;
		margin: 0 auto;
	}

	.purpose-section {
		text-align: center;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.purpose-icon {
		font-size: 2.5rem;
		margin-bottom: 0.5rem;
	}

	.purpose-section h2 {
		font-size: 1.125rem;
		margin: 0 0 0.5rem;
	}

	.purpose-section p {
		color: var(--text-60);
		font-size: 0.9375rem;
		margin: 0;
	}

	.sprint-context {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		padding: 1rem 1.25rem;
		margin-bottom: 1.5rem;
	}

	.sprint-context h3 {
		margin: 0;
		font-size: 0.9375rem;
	}

	.sprint-goal {
		margin: 0.25rem 0 0;
		font-size: 0.8125rem;
		color: var(--text-60);
		font-style: italic;
	}

	.format-section {
		margin-bottom: 1.5rem;
	}

	.format-section h3 {
		margin: 0 0 0.75rem;
		font-size: 0.9375rem;
	}

	.format-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.75rem;
	}

	.format-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 1.25rem 1rem;
		background: var(--color-panel);
		border: 2px solid var(--text-08);
		border-radius: 0.75rem;
		cursor: pointer;
		text-align: center;
	}

	.format-card:hover {
		border-color: var(--color-accent);
		background: var(--color-accent-muted);
	}

	.format-icon {
		font-size: 1.5rem;
		margin-bottom: 0.5rem;
	}

	.format-name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.format-desc {
		font-size: 0.6875rem;
		color: var(--text-50);
		margin-top: 0.125rem;
	}

	.guidelines-section {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.guidelines-section h3 {
		margin: 0 0 1rem;
		font-size: 0.9375rem;
	}

	.guideline-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.guideline {
		display: flex;
		gap: 0.75rem;
	}

	.guideline i {
		font-size: 1.25rem;
		color: var(--color-accent);
		flex-shrink: 0;
	}

	.guideline strong {
		display: block;
		font-size: 0.8125rem;
	}

	.guideline span {
		font-size: 0.75rem;
		color: var(--text-50);
	}

	.history-section h3 {
		margin: 0 0 0.75rem;
		font-size: 0.9375rem;
	}

	.history-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.history-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.625rem 0.875rem;
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.5rem;
	}

	.sprint-name {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.sprint-status {
		font-size: 0.6875rem;
		padding: 0.125rem 0.5rem;
		background: var(--text-08);
		border-radius: 1rem;
		color: var(--text-60);
	}

	.sprint-status.completed {
		background: #dcfce7;
		color: #16a34a;
	}

	/* Session */
	.retro-session {
		height: calc(100% - 80px);
		padding: 1rem;
	}

	.sailboat-retro {
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.sailboat-header {
		text-align: center;
		margin-bottom: 1rem;
	}

	.sailboat-header h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	.sailboat-header p {
		margin: 0.25rem 0 0;
		color: var(--text-60);
		font-size: 0.875rem;
	}

	.sailboat-grid {
		flex: 1;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
		min-height: 0;
	}

	.retro-column {
		display: flex;
		flex-direction: column;
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		overflow: hidden;
	}

	.retro-column.wind {
		border-top: 3px solid #22c55e;
	}

	.retro-column.anchors {
		border-top: 3px solid #ef4444;
	}

	.retro-column.rocks {
		border-top: 3px solid #f59e0b;
	}

	.retro-column.island {
		border-top: 3px solid #3b82f6;
	}

	.column-header {
		padding: 0.75rem;
		background: var(--text-04);
		text-align: center;
		border-bottom: 1px solid var(--text-08);
	}

	.column-icon {
		display: block;
		font-size: 1.25rem;
		margin-bottom: 0.25rem;
	}

	.column-title {
		display: block;
		font-weight: 600;
		font-size: 0.875rem;
	}

	.column-subtitle {
		display: block;
		font-size: 0.6875rem;
		color: var(--text-50);
	}

	.column-items {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.retro-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		background: var(--text-04);
		border-radius: 0.375rem;
		font-size: 0.8125rem;
	}

	.retro-item span {
		flex: 1;
	}

	.retro-item button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		background: none;
		border: none;
		color: var(--text-40);
		cursor: pointer;
	}

	.retro-item button:hover {
		color: #ef4444;
	}

	.column-input {
		display: flex;
		gap: 0.375rem;
		padding: 0.5rem;
		border-top: 1px solid var(--text-08);
	}

	.column-input input {
		flex: 1;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--text-12);
		border-radius: 0.25rem;
		font-size: 0.8125rem;
		background: var(--color-panel);
	}

	.column-input button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.25rem;
		cursor: pointer;
	}

	.session-actions {
		display: flex;
		justify-content: flex-end;
		padding-top: 1rem;
	}

	.action-btn {
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.action-btn.secondary {
		background: var(--text-08);
		border: 1px solid var(--text-12);
		color: var(--color-text-primary);
	}

	.ssc-placeholder,
	.msg-placeholder {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 300px;
		color: var(--text-50);
	}

	.ssc-placeholder button,
	.msg-placeholder button {
		margin-top: 1rem;
		padding: 0.5rem 1rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.ssc-header,
	.msg-header {
		text-align: center;
		padding: 1.5rem;
	}

	.ssc-header h2,
	.msg-header h2 {
		margin: 0;
	}

	.ssc-header p,
	.msg-header p {
		margin: 0.25rem 0 0;
		color: var(--text-60);
	}
</style>
