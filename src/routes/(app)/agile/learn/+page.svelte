<script lang="ts">
	import { goto } from '$app/navigation';
	import { AGILE_TIPS, ROLE_DESCRIPTIONS, TEAM_HEALTH_DIMENSIONS } from '$lib/firestore/agile';

	// Training content organized by topic - based on company training
	const topics = [
		{
			id: 'agile-overview',
			title: 'Agile Methodology',
			icon: '🎯',
			description: 'The 4 values and 12 principles behind the Agile Manifesto',
			content: [
				{
					title: 'The 4 Agile Values',
					text: '1. Individuals and interactions over processes and tools\n2. Working software over comprehensive documentation\n3. Customer collaboration over contract negotiation\n4. Responding to change over following a plan\n\nWhile there is value in the items on the right, we value the items on the left more.'
				},
				{
					title: 'You Might Not Be Agile If...',
					text: '• Send/Receive and Save As initiate most team communication\n• Your white boards are mostly white\n• "Test-driven" still refers to your car\n• You spend more time managing dependencies than removing them\n• Developers only develop, testers only test, managers just manage\n• A Change Control Board meets...ever'
				},
				{
					title: 'The 3 Simple Truths',
					text: '1. It is impossible to gather all the requirements at the beginning of a project\n2. Whatever requirements you do gather are guaranteed to change\n3. There will always be more to do than time and money will allow\n\nAccepting these truths is the first step toward agility.'
				},
				{
					title: 'One Team',
					text: 'Business people and developers must work together daily throughout the project. Create "blurred roles" - everyone contributes beyond their job title. There is no "us vs them" between technical and business sides.'
				},
				{
					title: 'Flex on Scope',
					text: 'When something has to give, flex on Scope - not Budget or Time. Deliver working product every week because working software is the primary measure of progress.'
				}
			]
		},
		{
			id: 'scrum-overview',
			title: 'Scrum Framework',
			icon: '🏃',
			description: 'Sprints, ceremonies, and delivering potentially shippable product',
			content: [
				{
					title: 'What is Scrum?',
					text: 'Scrum is an agile framework with defined roles (Product Owner, Scrum Master/Agile Coach, Team), events (Sprint Planning, Daily Standup, Review, Retrospective), and artifacts (Product Backlog, Sprint Backlog, Increment).'
				},
				{
					title: 'Scrum vs Waterfall',
					text: 'Waterfall: Gather ALL requirements → Design → Build → Test → Deploy (months/years)\nScrum: Plan a little → Build a little → Test a little → Demo → Repeat (weeks)\n\nScrum delivers working product continuously instead of all at once at the end.'
				},
				{
					title: 'Potentially Shippable Product',
					text: 'Every sprint should produce a "Potentially Shippable Product" - it may not get shipped, but it COULD be. This means it\'s tested, documented, and meets the Definition of Done.'
				},
				{
					title: 'Stories vs Requirements',
					text: 'Requirements: Technical, written by analysts, often verbose and disconnected from value\nStories: Written from user perspective, focused on value, follows "As a [user], I want [feature], so that [benefit]" format. Stories invite conversation.'
				}
			]
		},
		{
			id: 'kanban',
			title: 'Kanban',
			icon: '📋',
			description: 'Visual management, WIP limits, and flow efficiency',
			content: [
				{
					title: 'What is Kanban?',
					text: AGILE_TIPS.kanban.description
				},
				{
					title: 'The History',
					text: 'Kanban was created by Taiichi Ohno at Toyota. The word means "signboard" or "visual card." It\'s a "pull system" - new work is pulled when there\'s capacity, not pushed regardless of capacity.'
				},
				{
					title: 'Why Limit WIP?',
					text: 'Work In Progress limits prevent context switching, which destroys productivity. A 3-task WIP means 40% of your time is lost to switching. Limiting WIP helps SCRUM mitigate WIP bloat and keeps flow smooth.'
				},
				{
					title: 'Sick Board Signs',
					text: 'Sick SCRUM board: No movement, everything "in progress," stale cards, no WIP limits\nSick KANBAN board: WIP limits constantly exceeded, bottlenecks ignored, cards stuck in one column\n\nHealthy boards show flow from left to right with reasonable distribution.'
				}
			]
		},
		{
			id: 'agile-roles',
			title: 'Agile Roles',
			icon: '👥',
			description: 'Product Owner, Agile Coach, and Self-Organizing Teams',
			content: [
				{
					title: 'Who is Most Important?',
					text: 'The TEAM is the most important member. Not the manager, not any individual - the collective team. Self-organizing teams make the best decisions about how to accomplish work.'
				},
				{
					title: 'Product Owner',
					text: 'Represents the customer\'s voice. Owns the Product Backlog and ensures it\'s always prioritized by value. Works with the team daily. Accepts or rejects work based on Acceptance Criteria. NOT a project manager.'
				},
				{
					title: 'Agile Coach / Scrum Master',
					text: 'A "servant leader" - leads by serving the team, not commanding them. Facilitates ceremonies, removes blockers, shields team from interference. Coaches on agile practices but doesn\'t assign work.'
				},
				{
					title: 'Team Characteristics',
					text: '• Self-organizing - team decides HOW to do the work\n• Cross-functional - team has all skills needed\n• Blurred roles - everyone pitches in as needed\n• Team determines how long things take\n• Team decides what tasks fit in a sprint'
				}
			]
		},
		{
			id: 'backlog-refinement',
			title: 'Backlog Refinement',
			icon: '✨',
			description: 'User Stories, slicing, and Just-In-Time preparation',
			content: [
				{
					title: 'What is Backlog Refinement?',
					text: 'Also called "Grooming" - the ongoing process of reviewing, clarifying, and preparing backlog items. The goal is to have enough "ready" items for the next 1-2 sprints.'
				},
				{
					title: 'User Stories',
					text: '"As a [type of user], I want [some feature], so that [some benefit]"\n\nStories should be written avoiding technical geek speak - use the customer\'s language. Stories invite conversation and include Acceptance Criteria.'
				},
				{
					title: 'Slicing the Cake',
					text: 'Instead of building features in technical layers (database → API → UI), slice vertically through all layers. Each slice delivers a thin but complete piece of functionality that can be demonstrated.'
				},
				{
					title: 'Story Gathering Workshop',
					text: 'A collaborative session where the team and stakeholders identify and write user stories together. Focuses on the "what" and "why" - the team figures out the "how" during sprint planning.'
				},
				{
					title: 'Just-In-Time Analysis',
					text: 'Don\'t analyze everything upfront. Prepare stories just before they\'re needed (usually 1-2 sprints ahead). This reduces waste from analyzing things that may change or never get built.'
				}
			]
		},
		{
			id: 'sprint-planning',
			title: 'Sprint Planning',
			icon: '📝',
			description: 'Commitments, Definition of Done, and handling interruptions',
			content: [
				{
					title: 'What Happens in Sprint Planning?',
					text: 'The team reviews the prioritized backlog, discusses items with the Product Owner, estimates if needed, and pulls items into the sprint that they can commit to completing.'
				},
				{
					title: 'Definition of Done',
					text: 'A shared checklist that defines when work is truly "done." Examples:\n• Code reviewed\n• Unit tests passing\n• Acceptance criteria met\n• Documentation updated\n• Deployed to staging\n\nBe brutal - work isn\'t done until DoD is met.'
				},
				{
					title: 'Handling Interruptions',
					text: 'Interruptions happen. Build in capacity for them. If interruptions exceed capacity, something must drop from the sprint - scope flexes. Never just pile more work on without removing something.'
				},
				{
					title: '"Going Slower" vs "Delivering Faster"',
					text: 'Taking time to do things right (testing, documentation, refactoring) feels slower but delivers faster over time. Technical debt makes future work exponentially harder. Continuous attention to technical excellence and good design enhances agility.'
				},
				{
					title: 'Calculating End Dates',
					text: 'End date = (Total story points remaining) ÷ (Velocity) × (Sprint length)\n\nUse "Yesterday\'s Weather" - past velocity predicts future. Deliver by feature is preferred over deliver by date when possible.'
				}
			]
		},
		{
			id: 'estimating',
			title: 'Estimating',
			icon: '🎲',
			description: 'Story Points, Planning Poker, and relative sizing',
			content: [
				{
					title: 'Why Unitless Points?',
					text: 'Humans are better at relative estimation than absolute. We can easily say "this is twice as complex as that" but struggle to say "this will take 3.5 hours." Story points capture complexity, uncertainty, and effort without false precision.'
				},
				{
					title: 'Planning Poker',
					text: 'Everyone votes simultaneously using cards (1,2,3,5,8,13,21). This prevents anchoring - being influenced by the first person to speak. Discuss outliers, then revote until consensus. It\'s fun and engages the whole team.'
				},
				{
					title: 'Fibonacci Scale',
					text: 'The gaps grow larger (1,2,3,5,8,13,21,34...) because uncertainty increases with size. The difference between a 1 and 2 is meaningful. The difference between a 34 and 35? Not so much. If something is 13+, consider breaking it down.'
				},
				{
					title: 'Reference Stories',
					text: 'Establish a few well-understood stories as reference points. "Remember that login feature? That was a 3. Is this bigger or smaller?" Comparing to known work is easier than estimating in a vacuum.'
				}
			]
		},
		{
			id: 'commitments',
			title: 'Commitments',
			icon: '🤝',
			description: 'Yesterday\'s Weather and why teams miss their goals',
			content: [
				{
					title: 'What is a Commitment?',
					text: 'The team commits to a Sprint Goal and a set of work they believe they can complete. This is a team commitment, not an individual one. Missing commitments is a learning opportunity, not a punishment.'
				},
				{
					title: 'Why Teams Miss Commitments',
					text: '• Over-optimism (the biggest reason!)\n• Unplanned work/interruptions\n• Dependencies on other teams\n• Unclear acceptance criteria\n• Technical debt/code quality issues\n• Team member availability\n\nBy far the biggest reason is over-commitment.'
				},
				{
					title: 'Yesterday\'s Weather',
					text: 'The best predictor of how much you\'ll do next sprint is how much you did last sprint. If your velocity is 20, plan for 20 - not 25 because "this time we\'ll try harder." Trust the data over optimism.'
				},
				{
					title: 'Sustainable Pace',
					text: 'Agile promotes sustainable development. Sponsors, developers, and users should be able to maintain a constant pace indefinitely. Crunch time destroys quality and burns out teams.'
				}
			]
		},
		{
			id: 'daily-standup',
			title: 'Daily Stand-up',
			icon: '🧍',
			description: 'The 15-minute daily sync that keeps teams aligned',
			content: [
				{
					title: 'The 3 Questions',
					text: '1. What did I do yesterday?\n2. What will I do today?\n3. What\'s blocking me?\n\nThat\'s it. Keep it to 15 minutes max. Stand up to encourage brevity.'
				},
				{
					title: 'Common Mistakes',
					text: '• Status report to the manager (talk to each other!)\n• Goes over 15 minutes\n• Problem-solving during standup (take it offline)\n• People sit down and get comfortable\n• Only some team members attend'
				},
				{
					title: 'Blocked!',
					text: 'When someone says they\'re blocked, make it visible immediately. Add it to a "Blocked" section of your board. The Agile Coach\'s top priority is removing blockers. Swarm on problems with furious motivation!'
				},
				{
					title: 'A Better Way?',
					text: 'Some teams walk the board instead of going person-by-person. Start from the rightmost column (closest to done) and discuss each item: who\'s working on it, is it progressing, any blockers? This focuses on flow.'
				}
			]
		},
		{
			id: 'retrospective',
			title: 'Retrospective',
			icon: '🔄',
			description: 'Inspect and Adapt - continuous improvement after each sprint',
			content: [
				{
					title: 'Two Main Goals',
					text: '1. INSPECT: How did the sprint go? What happened?\n2. ADAPT: What will we change for next time?\n\nAt regular intervals, the team reflects on how to become more effective, then tunes and adjusts its behavior accordingly.'
				},
				{
					title: 'Format',
					text: '• What went well? (Keep doing)\n• What didn\'t go well? (Stop doing)\n• What will we try next sprint? (Start doing)\n\nSome teams do a "mad/sad/glad" exercise. Others use dot voting on topics. Vary the format to keep it fresh.'
				},
				{
					title: 'How Not to Run a Retro',
					text: '• Manager dominates the conversation\n• Same format every time (gets stale)\n• No action items come out of it\n• Action items have no owners\n• Previous action items aren\'t reviewed\n• People are blamed instead of processes'
				},
				{
					title: 'Sprint Review vs Retrospective',
					text: 'Sprint REVIEW: Demo the work to stakeholders, gather feedback on the PRODUCT\nRETROSPECTIVE: Team-only discussion about the PROCESS\n\nThese are two separate meetings with different purposes.'
				}
			]
		},
		{
			id: 'reporting',
			title: 'Reporting & Metrics',
			icon: '📊',
			description: 'Burndown charts, velocity tracking, and team health',
			content: [
				{
					title: 'Burndown Charts',
					text: AGILE_TIPS.burndown.description + '\n\nEffective because: Visual progress is easy to understand, Shows deviation from plan early, Anyone can read it at a glance.'
				},
				{
					title: 'Velocity',
					text: 'Used for: Planning how much work fits in a sprint, Forecasting project completion, Understanding team capacity\n\nNOT used for: Measuring individual performance, Comparing teams, Incentive/bonus decisions'
				},
				{
					title: 'Team Health Checks',
					text: 'Beyond velocity, measure team health across dimensions like:\n• Teamwork & Communication\n• Mission Clarity\n• Codebase Health\n• Speed & Flow\n• Delivering Value\n• Process Fitness\n• Fun\n\nA fast team that\'s miserable won\'t stay fast for long.'
				}
			]
		}
	];

	// Expandable sections
	let expandedTopic = $state<string | null>('agile-overview');

	function toggleTopic(id: string) {
		expandedTopic = expandedTopic === id ? null : id;
	}
</script>

<div class="learn-page">
	<header class="page-header">
		<button type="button" class="back-btn" onclick={() => goto('/agile')}>
			<i class="bx bx-arrow-back"></i>
		</button>
		<div class="header-content">
			<h1>Agile Training</h1>
			<p>Company agile methodology guide - from the training presentation</p>
		</div>
	</header>

	<main class="content">
		<!-- Quick Start Card -->
		<section class="quick-start">
			<div class="quick-start-icon">💡</div>
			<div class="quick-start-content">
				<h2>Core Agile Principles</h2>
				<ul class="principles-list">
					<li><strong>Deliver working software</strong> - it's the primary measure of progress</li>
					<li><strong>Welcome change</strong> - even late in development</li>
					<li><strong>Business + Developers</strong> - must work together daily</li>
					<li><strong>Face-to-face conversation</strong> - most effective communication</li>
					<li><strong>Sustainable pace</strong> - maintain it indefinitely</li>
					<li><strong>Self-organizing teams</strong> - make the best decisions</li>
				</ul>
			</div>
		</section>

		<!-- Topics -->
		<section class="topics">
			{#each topics as topic (topic.id)}
				<div class="topic-card" class:expanded={expandedTopic === topic.id}>
					<button 
						type="button" 
						class="topic-header"
						onclick={() => toggleTopic(topic.id)}
						aria-expanded={expandedTopic === topic.id}
					>
						<span class="topic-icon">{topic.icon}</span>
						<div class="topic-title">
							<h3>{topic.title}</h3>
							<p>{topic.description}</p>
						</div>
						<i class="bx {expandedTopic === topic.id ? 'bx-chevron-up' : 'bx-chevron-down'}"></i>
					</button>
					
					{#if expandedTopic === topic.id}
						<div class="topic-content">
							{#each topic.content as section}
								<div class="content-section">
									<h4>{section.title}</h4>
									<p>{@html section.text.replace(/\n/g, '<br>')}</p>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</section>

		<!-- Role Descriptions -->
		<section class="roles-section">
			<h2>
				<i class="bx bx-group"></i>
				Agile Roles
			</h2>
			<p class="roles-intro">In agile, the team is the most important. These roles serve the team:</p>
			<div class="roles-grid">
				{#each Object.entries(ROLE_DESCRIPTIONS).filter(([role]) => ['product_owner', 'scrum_master', 'developer'].includes(role)) as [role, info]}
					<div class="role-card">
						<h4>{info.title}</h4>
						<p>{info.description}</p>
					</div>
				{/each}
			</div>
		</section>

		<!-- Team Health -->
		<section class="health-section">
			<h2>
				<i class="bx bx-heart"></i>
				Team Health Dimensions
			</h2>
			<p class="health-intro">Beyond velocity, assess how your team is really doing:</p>
			<div class="health-grid">
				{#each Object.entries(TEAM_HEALTH_DIMENSIONS) as [key, dimension]}
					<div class="health-card">
						<h4>{dimension.title}</h4>
						<p class="health-desc">{dimension.description}</p>
						<div class="health-states">
							<span class="healthy">✓ {dimension.healthy}</span>
						</div>
					</div>
				{/each}
			</div>
		</section>

		<!-- More Resources -->
		<section class="resources-section">
			<h2>
				<i class="bx bx-link-external"></i>
				More Resources
			</h2>
			<div class="resources-grid">
				<a href="https://agilemanifesto.org/" target="_blank" rel="noopener noreferrer" class="resource-link">
					<i class="bx bx-file"></i>
					<span>Agile Manifesto</span>
				</a>
				<a href="https://agilemanifesto.org/principles.html" target="_blank" rel="noopener noreferrer" class="resource-link">
					<i class="bx bx-list-check"></i>
					<span>12 Principles</span>
				</a>
				<a href="https://www.scrum.org/resources/what-is-scrum" target="_blank" rel="noopener noreferrer" class="resource-link">
					<i class="bx bx-book"></i>
					<span>Scrum Guide</span>
				</a>
				<button type="button" class="resource-link" onclick={() => goto('/agile/glossary')}>
					<i class="bx bx-list-ul"></i>
					<span>Glossary of Terms</span>
				</button>
			</div>
		</section>
	</main>
</div>

<style>
	.learn-page {
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

	.content {
		padding: 1.5rem;
		max-width: 900px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* Quick Start */
	.quick-start {
		display: flex;
		gap: 1rem;
		padding: 1.25rem;
		background: linear-gradient(135deg, var(--color-accent-muted) 0%, var(--color-panel) 100%);
		border: 1px solid var(--color-accent-subtle);
		border-radius: 0.75rem;
	}

	.quick-start-icon {
		font-size: 2rem;
		flex-shrink: 0;
	}

	.quick-start-content h2 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.75rem;
	}

	.principles-list {
		margin: 0;
		padding-left: 1.25rem;
		color: var(--text-70);
		font-size: 0.875rem;
		line-height: 1.7;
	}

	.principles-list li {
		margin-bottom: 0.375rem;
	}

	.principles-list strong {
		color: var(--color-text-primary);
	}

	/* Topics */
	.topics {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.topic-card {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.75rem;
		overflow: hidden;
	}

	.topic-card.expanded {
		border-color: var(--color-accent-subtle);
	}

	.topic-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		width: 100%;
		padding: 1rem;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	.topic-header:hover {
		background: var(--text-04);
	}

	.topic-icon {
		font-size: 1.75rem;
		flex-shrink: 0;
	}

	.topic-title {
		flex: 1;
	}

	.topic-title h3 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.topic-title p {
		font-size: 0.8125rem;
		color: var(--text-50);
		margin: 0.25rem 0 0;
	}

	.topic-header i {
		font-size: 1.25rem;
		color: var(--text-40);
	}

	.topic-content {
		padding: 0 1rem 1rem;
		border-top: 1px solid var(--text-08);
		margin-top: 0;
	}

	.content-section {
		padding: 1rem 0;
		border-bottom: 1px solid var(--text-06);
	}

	.content-section:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.content-section h4 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.5rem;
	}

	.content-section p {
		font-size: 0.875rem;
		color: var(--text-70);
		margin: 0;
		line-height: 1.6;
	}

	/* Roles Section */
	.roles-section h2,
	.health-section h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.5rem;
	}

	.roles-section h2 i,
	.health-section h2 i {
		color: var(--color-accent);
	}

	.roles-intro,
	.health-intro {
		font-size: 0.875rem;
		color: var(--text-60);
		margin: 0 0 1rem;
	}

	.roles-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		gap: 0.75rem;
	}

	.role-card {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.5rem;
		padding: 1rem;
	}

	.role-card h4 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-accent);
		margin: 0 0 0.5rem;
	}

	.role-card p {
		font-size: 0.8125rem;
		color: var(--text-60);
		margin: 0;
		line-height: 1.5;
	}

	/* Health Section */
	.health-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 0.75rem;
	}

	.health-card {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.5rem;
		padding: 1rem;
	}

	.health-card h4 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.5rem;
	}

	.health-desc {
		font-size: 0.8125rem;
		color: var(--text-60);
		margin: 0 0 0.75rem;
		line-height: 1.5;
	}

	.health-states {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.healthy {
		font-size: 0.75rem;
		color: #10b981;
		line-height: 1.4;
	}

	/* Resources Section */
	.resources-section h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 1rem;
	}

	.resources-section h2 i {
		color: var(--color-accent);
	}

	.resources-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.resource-link {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: var(--color-panel);
		border: 1px solid var(--text-10);
		border-radius: 0.5rem;
		color: var(--color-text-primary);
		font-size: 0.875rem;
		text-decoration: none;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.resource-link:hover {
		border-color: var(--color-accent);
		background: var(--color-accent-muted);
		color: var(--color-accent);
	}

	.resource-link i {
		font-size: 1.125rem;
	}

	/* Mobile */
	@media (max-width: 640px) {
		.page-header {
			padding: 1rem;
		}

		.content {
			padding: 1rem;
		}

		.quick-start {
			flex-direction: column;
		}

		.roles-grid,
		.health-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
