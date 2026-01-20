<script lang="ts">
	import { goto } from '$app/navigation';

	// Agile glossary terms - based on company training
	const glossary = [
		{
			term: 'Acceptance Criteria',
			definition: 'The specific conditions that must be met for a User Story to be considered complete. Written before development starts and used to validate work is done correctly.'
		},
		{
			term: 'Agile Coach',
			definition: 'Also called Scrum Master. A servant leader who facilitates ceremonies, removes blockers, shields the team from interference, and coaches on agile practices. NOT a project manager.'
		},
		{
			term: 'Backlog',
			definition: 'A force-ranked list of User Stories representing value to the customer. The Product Owner owns this list and keeps it "sharpened" so the team always knows what\'s most valuable.'
		},
		{
			term: 'Backlog Refinement',
			definition: 'Also called Grooming. The ongoing process of reviewing, clarifying, and preparing backlog items. Goal: have enough "ready" items for the next 1-2 sprints.'
		},
		{
			term: 'Blocked',
			definition: 'When work cannot progress due to an impediment. Blockers should be made visible immediately and are the Agile Coach\'s top priority to resolve.'
		},
		{
			term: 'Blurred Roles',
			definition: 'In agile, team members contribute beyond their job title. Developers might test, testers might document. The rigid "developers only develop" mindset is not agile.'
		},
		{
			term: 'Burndown Chart',
			definition: 'A chart showing remaining work vs. time during a sprint. The line should trend downward toward zero. Line above ideal = behind schedule.'
		},
		{
			term: 'Commitment',
			definition: 'The team\'s agreement to complete a Sprint Goal and set of work. A team commitment, not individual. Missing is a learning opportunity, not punishment.'
		},
		{
			term: 'Daily Stand-up',
			definition: 'A brief daily meeting (15 min max) where team members share: What I did yesterday, What I\'m doing today, What\'s blocking me. Stand up to keep it short!'
		},
		{
			term: 'Definition of Done (DoD)',
			definition: 'A shared checklist defining when work is truly "done." Examples: Code reviewed, tests passing, acceptance criteria met, documentation updated, deployed to staging.'
		},
		{
			term: 'Epic',
			definition: 'A large body of work that can be broken down into smaller User Stories. Epics often span multiple sprints.'
		},
		{
			term: 'Fibonacci Scale',
			definition: 'The sequence 1, 2, 3, 5, 8, 13, 21... used for story points. Gaps grow larger because uncertainty increases with size. If 13+, consider breaking it down.'
		},
		{
			term: 'Flex on Scope',
			definition: 'When something must give, adjust Scope - not Budget or Time. This is a core agile principle for handling changing requirements.'
		},
		{
			term: 'Iteration',
			definition: 'Another word for Sprint. A fixed time period during which work is completed and potentially shippable product is delivered.'
		},
		{
			term: 'Just-In-Time Analysis',
			definition: 'Don\'t analyze everything upfront. Prepare stories just before needed (1-2 sprints ahead). Reduces waste from analyzing things that change or never get built.'
		},
		{
			term: 'Kanban',
			definition: 'A "pull system" created by Taiichi Ohno at Toyota. Work is visualized on a board, WIP is limited, and flow is measured. Helps mitigate context switching.'
		},
		{
			term: 'One Team',
			definition: 'Business and developers work together daily. No "us vs them." Everyone contributes beyond their title toward the shared goal.'
		},
		{
			term: 'Planning Poker',
			definition: 'Estimation technique where everyone votes simultaneously using cards (1,2,3,5,8,13,21). Prevents anchoring bias. Discuss outliers, then revote until consensus.'
		},
		{
			term: 'Potentially Shippable Product',
			definition: 'Every sprint should produce work that COULD be shipped. It may not get released, but it\'s tested, documented, and meets the Definition of Done.'
		},
		{
			term: 'Product Backlog',
			definition: 'The master list of all features, requirements, and fixes that could be included in the product. Owned and prioritized by the Product Owner.'
		},
		{
			term: 'Product Owner',
			definition: 'Represents the customer\'s voice. Owns the Product Backlog, ensures it\'s prioritized by value, works daily with the team. Accepts/rejects work based on Acceptance Criteria.'
		},
		{
			term: 'Pull System',
			definition: 'Work is pulled when there\'s capacity, not pushed regardless of capacity. Kanban is a pull system. Prevents overloading the team.'
		},
		{
			term: 'Reference Stories',
			definition: 'Well-understood stories used as comparison points for estimation. "That login feature was a 3 - is this bigger or smaller?"'
		},
		{
			term: 'Retrospective',
			definition: 'Meeting at sprint end where the team reflects on the PROCESS. Two goals: INSPECT (what happened) and ADAPT (what to change). Not the same as Sprint Review.'
		},
		{
			term: 'Scrum',
			definition: 'An agile framework with defined roles (PO, Scrum Master, Team), events (Planning, Standup, Review, Retro), and artifacts (Backlogs, Increment).'
		},
		{
			term: 'Scrum Master',
			definition: 'See Agile Coach. A servant leader who facilitates and removes blockers. The term comes from the Scrum framework specifically.'
		},
		{
			term: 'Self-Organizing Team',
			definition: 'Teams that decide HOW to do the work, not just execute assigned tasks. They determine how long things take and what fits in a sprint.'
		},
		{
			term: 'Servant Leader',
			definition: 'A leader who leads by serving the team, not commanding them. Removes obstacles, provides resources, protects from interference.'
		},
		{
			term: 'Slicing the Cake',
			definition: 'Building features as thin vertical slices through all layers (UI, API, DB) rather than horizontal technical layers. Each slice is demonstrable.'
		},
		{
			term: 'Sprint',
			definition: 'A fixed time-box (usually 1-2 weeks) where the team commits to completing work and delivering a potentially shippable product increment.'
		},
		{
			term: 'Sprint Backlog',
			definition: 'The subset of Product Backlog items selected for a sprint, plus the plan for delivering them. Owned by the team.'
		},
		{
			term: 'Sprint Goal',
			definition: 'A short statement describing what the team wants to achieve during the sprint. Provides focus and allows flexibility in how work is done.'
		},
		{
			term: 'Sprint Planning',
			definition: 'Meeting at sprint start where the team reviews the backlog, discusses with PO, estimates if needed, and pulls items they commit to completing.'
		},
		{
			term: 'Sprint Review',
			definition: 'Meeting at sprint end where the team demos completed work to stakeholders and gathers feedback on the PRODUCT. Not the same as Retrospective.'
		},
		{
			term: 'Story Points',
			definition: 'A unitless, relative measure of effort/complexity. Humans estimate relatively better than absolutely. Captures complexity without false precision of hours.'
		},
		{
			term: 'Sustainable Pace',
			definition: 'Agile promotes a pace that sponsors, developers, and users can maintain indefinitely. Crunch time destroys quality and burns out teams.'
		},
		{
			term: 'Swimlane',
			definition: 'Horizontal rows on a board that categorize items, often by assignee, epic, or priority. Helps organize visual workflow.'
		},
		{
			term: 'Task',
			definition: 'A small unit of work that contributes to completing a story. Usually measured in hours and assigned to individuals.'
		},
		{
			term: 'Team Health Check',
			definition: 'Assessment beyond velocity measuring dimensions like: Teamwork, Mission Clarity, Codebase Health, Speed, Delivering Value, Fun.'
		},
		{
			term: 'The 3 Simple Truths',
			definition: '1) Can\'t gather all requirements upfront 2) Requirements will change 3) There\'s always more to do than time allows. Accepting these enables agility.'
		},
		{
			term: 'User Story',
			definition: 'A feature description from the user perspective: "As a [user], I want [feature], so that [benefit]." Written in customer language, not technical geek speak.'
		},
		{
			term: 'Velocity',
			definition: 'Story points completed per sprint. Used for planning capacity. NOT for measuring individual performance or comparing teams.'
		},
		{
			term: 'WIP (Work in Progress)',
			definition: 'Items currently being worked on. Limiting WIP prevents context switching (3-task WIP = 40% time lost to switching) and improves flow.'
		},
		{
			term: 'Yesterday\'s Weather',
			definition: 'The best predictor of next sprint\'s velocity is last sprint\'s velocity. Trust data over optimism. If you did 20 points, plan for 20.'
		}
	];

	// Search functionality
	let searchQuery = $state('');
	
	const filteredGlossary = $derived(
		searchQuery
			? glossary.filter(item => 
				item.term.toLowerCase().includes(searchQuery.toLowerCase()) ||
				item.definition.toLowerCase().includes(searchQuery.toLowerCase())
			)
			: glossary
	);

	// Group by letter
	const groupedGlossary = $derived.by(() => {
		const groups: Record<string, typeof glossary> = {};
		filteredGlossary.forEach(item => {
			const letter = item.term[0].toUpperCase();
			if (!groups[letter]) groups[letter] = [];
			groups[letter].push(item);
		});
		return groups;
	});
</script>

<div class="glossary-page">
	<header class="page-header">
		<button type="button" class="back-btn" onclick={() => goto('/agile/learn')}>
			<i class="bx bx-arrow-back"></i>
		</button>
		<div class="header-content">
			<h1>Agile Glossary</h1>
			<p>Terms and definitions from the company agile training</p>
		</div>
	</header>

	<div class="search-bar">
		<i class="bx bx-search"></i>
		<input 
			type="text" 
			placeholder="Search terms..." 
			bind:value={searchQuery}
		/>
		{#if searchQuery}
			<button type="button" class="clear-btn" onclick={() => searchQuery = ''}>
				<i class="bx bx-x"></i>
			</button>
		{/if}
	</div>

	<main class="content">
		{#if filteredGlossary.length === 0}
			<div class="no-results">
				<i class="bx bx-search-alt-2"></i>
				<p>No terms found matching "{searchQuery}"</p>
			</div>
		{:else}
			{#each Object.entries(groupedGlossary).sort(([a], [b]) => a.localeCompare(b)) as [letter, items]}
				<section class="letter-section">
					<h2 class="letter-heading">{letter}</h2>
					<div class="terms-list">
						{#each items as item}
							<div class="term-card">
								<h3>{item.term}</h3>
								<p>{item.definition}</p>
							</div>
						{/each}
					</div>
				</section>
			{/each}
		{/if}
	</main>
</div>

<style>
	.glossary-page {
		height: 100%;
		overflow-y: auto;
		background: var(--color-panel-muted);
	}

	.page-header {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 1.5rem;
		background: var(--color-panel);
		border-bottom: 1px solid var(--text-08);
	}

	.back-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border: none;
		border-radius: 0.5rem;
		background: var(--button-ghost-bg);
		color: var(--color-text-primary);
		font-size: 1.25rem;
		cursor: pointer;
		flex-shrink: 0;
	}

	.back-btn:hover {
		background: var(--text-10);
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

	.search-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 1rem 1.5rem;
		padding: 0.625rem 1rem;
		background: var(--color-panel);
		border: 1px solid var(--text-10);
		border-radius: 0.5rem;
		max-width: 400px;
	}

	.search-bar i {
		font-size: 1.125rem;
		color: var(--text-40);
	}

	.search-bar input {
		flex: 1;
		border: none;
		background: transparent;
		font-size: 0.9375rem;
		color: var(--color-text-primary);
		outline: none;
	}

	.search-bar input::placeholder {
		color: var(--text-40);
	}

	.clear-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border: none;
		border-radius: 0.25rem;
		background: var(--text-10);
		color: var(--text-60);
		cursor: pointer;
	}

	.clear-btn:hover {
		background: var(--text-20);
		color: var(--color-text-primary);
	}

	.content {
		padding: 0 1.5rem 1.5rem;
		max-width: 800px;
	}

	.no-results {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 3rem;
		text-align: center;
	}

	.no-results i {
		font-size: 2.5rem;
		color: var(--text-30);
		margin-bottom: 0.75rem;
	}

	.no-results p {
		color: var(--text-50);
		margin: 0;
	}

	.letter-section {
		margin-bottom: 1.5rem;
	}

	.letter-heading {
		position: sticky;
		top: 0;
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--color-accent);
		margin: 0 0 0.75rem;
		padding: 0.5rem 0;
		background: var(--color-panel-muted);
		z-index: 1;
	}

	.terms-list {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.term-card {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.5rem;
		padding: 1rem;
	}

	.term-card h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.375rem;
	}

	.term-card p {
		font-size: 0.8125rem;
		color: var(--text-60);
		margin: 0;
		line-height: 1.5;
	}

	/* Mobile */
	@media (max-width: 640px) {
		.page-header {
			padding: 1rem;
		}

		.search-bar {
			margin: 1rem;
		}

		.content {
			padding: 0 1rem 1rem;
		}
	}
</style>
