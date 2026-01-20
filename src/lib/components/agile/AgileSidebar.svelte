<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { user } from '$lib/stores/user';
	import type { 
		AgileTeam, 
		Sprint, 
		ClientTag,
		AgileRole 
	} from '$lib/firestore/agile';
	import { 
		isProductOwner, 
		isAgileCoach, 
		getUserRole
	} from '$lib/firestore/agile';

	interface Props {
		boards: AgileTeam[];
		activeSprint?: Sprint | null;
		currentBoardId?: string | null;
		onCreateBoard?: () => void;
	}

	let { boards, activeSprint = null, currentBoardId = null, onCreateBoard }: Props = $props();

	const currentPath = $derived($page?.url?.pathname ?? '/agile');
	const currentUserId = $derived($user?.uid ?? '');

	// Determine active team from path or props
	const activeTeamId = $derived(
		currentBoardId || currentPath.match(/\/agile\/board\/([^\/]+)/)?.[1] || boards[0]?.id
	);
	const activeTeam = $derived(boards.find(b => b.id === activeTeamId));
	
	// User's role in the active team
	const userRole = $derived<AgileRole | null>(
		activeTeam && currentUserId ? getUserRole(activeTeam, currentUserId) : null
	);
	const userIsPO = $derived(activeTeam && currentUserId ? isProductOwner(activeTeam, currentUserId) : false);
	const userIsCoach = $derived(activeTeam && currentUserId ? isAgileCoach(activeTeam, currentUserId) : false);
	
	// Get client tags for active team
	const clientTags = $derived<ClientTag[]>(activeTeam?.clientTags ?? []);
	
	// Navigation helpers
	const isActive = (path: string) => {
		if (path === '/agile') return currentPath === '/agile';
		return currentPath.startsWith(path);
	};

	// Role display
	const getRoleDisplay = (role: AgileRole | null): { label: string; color: string; icon: string } => {
		switch (role) {
			case 'product_owner':
				return { label: 'Product Owner', color: '#8b5cf6', icon: 'bx-crown' };
			case 'agile_coach':
				return { label: 'Agile Coach', color: '#0ea5e9', icon: 'bx-shield-quarter' };
			case 'team_member':
				return { label: 'Team Member', color: '#10b981', icon: 'bx-user' };
			case 'viewer':
				return { label: 'Viewer', color: '#6b7280', icon: 'bx-show' };
			default:
				return { label: 'Guest', color: '#6b7280', icon: 'bx-user' };
		}
	};
	
	const userRoleDisplay = $derived(getRoleDisplay(userRole));

	// Sprint time remaining
	const sprintDaysRemaining = $derived.by(() => {
		if (!activeSprint?.endDate) return null;
		const end = activeSprint.endDate.toDate?.() ?? new Date(activeSprint.endDate as any);
		const now = new Date();
		const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
		return Math.max(0, diff);
	});

	// Team selector dropdown
	let showTeamPicker = $state(false);
	let showClientFilter = $state(false);
	let selectedClientTag = $state<string | null>(null);
</script>

<aside class="agile-sidebar">
	<!-- Team Selector Header -->
	<div class="sidebar-header">
		{#if boards.length > 0}
			<button 
				type="button" 
				class="team-selector"
				onclick={() => showTeamPicker = !showTeamPicker}
			>
				<span class="team-icon">{activeTeam?.iconEmoji || '👥'}</span>
				<div class="team-info">
					<span class="team-name">{activeTeam?.name || 'Select Team'}</span>
					<span class="team-key">{activeTeam?.key || ''}</span>
				</div>
				<i class="bx bx-chevron-down"></i>
			</button>
			
			{#if showTeamPicker}
				<div class="team-dropdown">
					<div class="dropdown-header">Your Teams</div>
					{#each boards as team (team.id)}
						<button
							type="button"
							class="dropdown-item"
							class:active={team.id === activeTeamId}
							onclick={() => { goto(`/agile/board/${team.id}`); showTeamPicker = false; }}
						>
							<span class="team-icon">{team.iconEmoji || '👥'}</span>
							<div class="team-item-info">
								<span class="team-name">{team.name}</span>
								{#if team.productOwnerIds?.includes(currentUserId)}
									<span class="role-badge po">PO</span>
								{:else if team.agileCoachId === currentUserId}
									<span class="role-badge coach">Coach</span>
								{/if}
							</div>
						</button>
					{/each}
					<div class="dropdown-divider"></div>
					{#if onCreateBoard}
						<button type="button" class="dropdown-item create-item" onclick={() => { onCreateBoard?.(); showTeamPicker = false; }}>
							<i class="bx bx-plus"></i>
							<span>New Team</span>
						</button>
					{/if}
				</div>
			{/if}
		{:else}
			<div class="no-team-header">
				<i class="bx bx-layout"></i>
				<span>Agile Teams</span>
			</div>
		{/if}
	</div>

	<!-- User Role Badge -->
	{#if activeTeam && userRole}
		<div class="user-role-section">
			<div class="role-indicator" style="--role-color: {userRoleDisplay.color}">
				<i class="bx {userRoleDisplay.icon}"></i>
				<span>{userRoleDisplay.label}</span>
			</div>
		</div>
	{/if}

	<!-- Main Navigation -->
	<nav class="sidebar-nav">
		<!-- Overview Section -->
		<div class="nav-section">
			<button
				type="button"
				class="nav-item"
				class:active={isActive('/agile') && currentPath === '/agile'}
				onclick={() => goto('/agile')}
			>
				<i class="bx bx-home-circle"></i>
				<span>Overview</span>
			</button>
			<button
				type="button"
				class="nav-item"
				class:active={isActive('/agile/my-work')}
				onclick={() => goto('/agile/my-work')}
			>
				<i class="bx bx-task"></i>
				<span>My Work</span>
			</button>
		</div>

		{#if activeTeam}
			<!-- Sprint Section -->
			<div class="nav-section">
				<div class="nav-section-label">Current Sprint</div>
				{#if activeSprint}
					<button
						type="button"
						class="nav-item sprint-active"
						onclick={() => goto(`/agile/board/${activeTeamId}`)}
					>
						<i class="bx bx-run"></i>
						<div class="sprint-info">
							<span class="sprint-name">{activeSprint.name}</span>
							{#if sprintDaysRemaining !== null}
								<span class="sprint-days" class:warning={sprintDaysRemaining <= 2}>
									{sprintDaysRemaining}d left
								</span>
							{/if}
						</div>
					</button>
				{:else}
					<div class="no-sprint">
						<p>No active sprint</p>
						{#if userIsPO || userIsCoach}
							<button type="button" onclick={() => goto(`/agile/board/${activeTeamId}/planning`)}>
								Start Planning
							</button>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Workflow Section -->
			<div class="nav-section">
				<div class="nav-section-label">Workflow</div>
				<button
					type="button"
					class="nav-item"
					class:active={currentPath === `/agile/board/${activeTeamId}` || (currentPath.includes('/board/') && !currentPath.includes('/backlog') && !currentPath.includes('/planning') && !currentPath.includes('/standup') && !currentPath.includes('/retro') && !currentPath.includes('/reports') && !currentPath.includes('/health') && !currentPath.includes('/settings'))}
					onclick={() => goto(`/agile/board/${activeTeamId}`)}
				>
					<i class="bx bx-columns"></i>
					<span>Sprint Board</span>
				</button>
				<button
					type="button"
					class="nav-item"
					class:active={currentPath.includes('/backlog')}
					onclick={() => goto(`/agile/board/${activeTeamId}/backlog`)}
				>
					<i class="bx bx-list-ol"></i>
					<span>Backlog</span>
					{#if userIsPO}
						<span class="nav-badge po">PO</span>
					{/if}
				</button>
			</div>

			<!-- Ceremonies Section -->
			<div class="nav-section">
				<div class="nav-section-label">Ceremonies</div>
				<button
					type="button"
					class="nav-item"
					class:active={currentPath.includes('/planning')}
					onclick={() => goto(`/agile/board/${activeTeamId}/planning`)}
				>
					<i class="bx bx-calendar-plus"></i>
					<span>Sprint Planning</span>
				</button>
				<button
					type="button"
					class="nav-item"
					class:active={currentPath.includes('/standup')}
					onclick={() => goto(`/agile/board/${activeTeamId}/standup`)}
				>
					<i class="bx bx-group"></i>
					<span>Daily Standup</span>
				</button>
				<button
					type="button"
					class="nav-item"
					class:active={currentPath.includes('/retro')}
					onclick={() => goto(`/agile/board/${activeTeamId}/retro`)}
				>
					<i class="bx bx-refresh"></i>
					<span>Retrospective</span>
				</button>
			</div>

			<!-- Insights Section -->
			<div class="nav-section">
				<div class="nav-section-label">Insights</div>
				<button
					type="button"
					class="nav-item"
					class:active={currentPath.includes('/reports')}
					onclick={() => goto(`/agile/board/${activeTeamId}/reports`)}
				>
					<i class="bx bx-line-chart"></i>
					<span>Reports</span>
				</button>
				<button
					type="button"
					class="nav-item"
					class:active={currentPath.includes('/health')}
					onclick={() => goto(`/agile/board/${activeTeamId}/health`)}
				>
					<i class="bx bx-heart"></i>
					<span>Team Health</span>
				</button>
			</div>

			<!-- Client Tags Filter -->
			{#if clientTags.length > 0}
				<div class="nav-section">
					<button 
						type="button" 
						class="nav-section-label clickable"
						onclick={() => showClientFilter = !showClientFilter}
					>
						<span>Client Tags</span>
						<i class="bx bx-chevron-{showClientFilter ? 'up' : 'down'}"></i>
					</button>
					{#if showClientFilter}
						<div class="client-tags">
							<button
								type="button"
								class="client-tag-btn"
								class:active={!selectedClientTag}
								onclick={() => selectedClientTag = null}
							>
								All Clients
							</button>
							{#each clientTags as tag (tag.id)}
								<button
									type="button"
									class="client-tag-btn"
									class:active={selectedClientTag === tag.id}
									style="--tag-color: {tag.color}"
									onclick={() => selectedClientTag = tag.id}
								>
									<span class="tag-dot"></span>
									{tag.name}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Team Settings (PO/Coach only) -->
			{#if userIsPO || userIsCoach || activeTeam.ownerId === currentUserId}
				<div class="nav-section">
					<div class="nav-section-label">Team Admin</div>
					<button
						type="button"
						class="nav-item"
						class:active={currentPath.includes('/settings')}
						onclick={() => goto(`/agile/board/${activeTeamId}/settings`)}
					>
						<i class="bx bx-cog"></i>
						<span>Team Settings</span>
					</button>
				</div>
			{/if}
		{/if}

		<!-- Help Section -->
		<div class="nav-section help-section">
			<div class="nav-section-label">Resources</div>
			<button
				type="button"
				class="nav-item"
				class:active={isActive('/agile/learn')}
				onclick={() => goto('/agile/learn')}
			>
				<i class="bx bx-book-open"></i>
				<span>Training Guide</span>
			</button>
			<button
				type="button"
				class="nav-item"
				class:active={isActive('/agile/glossary')}
				onclick={() => goto('/agile/glossary')}
			>
				<i class="bx bx-help-circle"></i>
				<span>Glossary</span>
			</button>
		</div>
	</nav>

	<!-- Create Team CTA if none exist -->
	{#if boards.length === 0 && onCreateBoard}
		<div class="sidebar-cta">
			<p>Get started with your first agile team</p>
			<button type="button" onclick={onCreateBoard}>
				<i class="bx bx-plus"></i>
				Create Team
			</button>
		</div>
	{/if}
</aside>

<!-- Click outside to close dropdown -->
{#if showTeamPicker}
	<button 
		type="button" 
		class="dropdown-overlay" 
		onclick={() => showTeamPicker = false}
		aria-label="Close dropdown"
	></button>
{/if}

<style>
	.agile-sidebar {
		display: flex;
		flex-direction: column;
		width: 260px;
		height: 100%;
		background: var(--color-panel);
		border-right: 1px solid var(--text-08);
		overflow: hidden;
	}

	.sidebar-header {
		position: relative;
		padding: 0.75rem;
		border-bottom: 1px solid var(--text-08);
	}

	.team-selector {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		background: var(--text-06);
		border: 1px solid transparent;
		border-radius: 0.5rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.team-selector:hover {
		background: var(--text-10);
		border-color: var(--text-12);
	}

	.team-selector .team-icon {
		font-size: 1.25rem;
	}

	.team-selector .team-info {
		flex: 1;
		text-align: left;
		min-width: 0;
	}

	.team-selector .team-name {
		display: block;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.team-selector .team-key {
		display: block;
		font-size: 0.6875rem;
		color: var(--text-50);
	}

	.team-selector i {
		color: var(--text-40);
		font-size: 1.125rem;
	}

	.no-team-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.no-team-header i {
		font-size: 1.25rem;
		color: var(--color-accent);
	}

	.user-role-section {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--text-06);
	}

	.role-indicator {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		background: color-mix(in srgb, var(--role-color) 15%, transparent);
		border-radius: 0.375rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--role-color);
	}

	.role-indicator i {
		font-size: 0.875rem;
	}

	.team-dropdown {
		position: absolute;
		top: calc(100% + 0.25rem);
		left: 0.75rem;
		right: 0.75rem;
		background: var(--color-panel);
		border: 1px solid var(--text-12);
		border-radius: 0.5rem;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		z-index: 100;
		max-height: 350px;
		overflow-y: auto;
	}

	.dropdown-header {
		padding: 0.5rem 0.75rem;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-40);
		border-bottom: 1px solid var(--text-06);
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.625rem 0.75rem;
		background: transparent;
		border: none;
		text-align: left;
		cursor: pointer;
		transition: background 0.1s ease;
	}

	.dropdown-item:hover {
		background: var(--text-06);
	}

	.dropdown-item.active {
		background: var(--color-accent-muted);
	}

	.dropdown-item .team-icon {
		font-size: 1.125rem;
	}

	.team-item-info {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.team-item-info .team-name {
		font-size: 0.875rem;
		color: var(--color-text-primary);
	}

	.role-badge {
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	.role-badge.po {
		background: color-mix(in srgb, #8b5cf6 20%, transparent);
		color: #8b5cf6;
	}

	.role-badge.coach {
		background: color-mix(in srgb, #0ea5e9 20%, transparent);
		color: #0ea5e9;
	}

	.dropdown-divider {
		height: 1px;
		background: var(--text-08);
		margin: 0.25rem 0;
	}

	.dropdown-item.create-item {
		color: var(--color-accent);
	}

	.dropdown-item.create-item i {
		font-size: 1rem;
	}

	.dropdown-overlay {
		position: fixed;
		inset: 0;
		background: transparent;
		border: none;
		cursor: default;
		z-index: 99;
	}

	.sidebar-nav {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem 0;
	}

	.nav-section {
		padding: 0.5rem 0.75rem;
	}

	.nav-section-label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-40);
		padding: 0.25rem 0.5rem;
		margin-bottom: 0.25rem;
		background: none;
		border: none;
		width: 100%;
		text-align: left;
	}

	.nav-section-label.clickable {
		cursor: pointer;
		border-radius: 0.25rem;
	}

	.nav-section-label.clickable:hover {
		background: var(--text-04);
	}

	.nav-section-label i {
		font-size: 0.875rem;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		background: transparent;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		color: var(--text-70);
		cursor: pointer;
		transition: all 0.1s ease;
	}

	.nav-item:hover {
		background: var(--text-06);
		color: var(--color-text-primary);
	}

	.nav-item.active {
		background: var(--color-accent-muted);
		color: var(--color-accent);
	}

	.nav-item i {
		font-size: 1.125rem;
	}

	.nav-badge {
		margin-left: auto;
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.5625rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	.nav-badge.po {
		background: color-mix(in srgb, #8b5cf6 20%, transparent);
		color: #8b5cf6;
	}

	.sprint-active {
		background: linear-gradient(135deg, var(--color-accent-muted) 0%, transparent 100%);
		border: 1px solid var(--color-accent-subtle);
	}

	.sprint-active .sprint-info {
		flex: 1;
		display: flex;
		flex-direction: column;
	}

	.sprint-active .sprint-name {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.sprint-active .sprint-days {
		font-size: 0.6875rem;
		color: var(--color-accent);
	}

	.sprint-active .sprint-days.warning {
		color: #f59e0b;
	}

	.no-sprint {
		padding: 0.5rem;
		text-align: center;
	}

	.no-sprint p {
		font-size: 0.75rem;
		color: var(--text-50);
		margin: 0 0 0.5rem;
	}

	.no-sprint button {
		font-size: 0.75rem;
		color: var(--color-accent);
		background: none;
		border: none;
		cursor: pointer;
	}

	.no-sprint button:hover {
		text-decoration: underline;
	}

	.client-tags {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding-top: 0.25rem;
	}

	.client-tag-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.375rem 0.5rem;
		background: transparent;
		border: none;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		color: var(--text-60);
		cursor: pointer;
		text-align: left;
	}

	.client-tag-btn:hover {
		background: var(--text-04);
		color: var(--color-text-primary);
	}

	.client-tag-btn.active {
		background: var(--text-08);
		color: var(--color-text-primary);
	}

	.tag-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--tag-color);
	}

	.help-section {
		margin-top: auto;
		border-top: 1px solid var(--text-06);
		padding-top: 0.75rem;
	}

	.sidebar-cta {
		padding: 1rem;
		margin: 0.75rem;
		background: var(--color-accent-muted);
		border-radius: 0.5rem;
		text-align: center;
	}

	.sidebar-cta p {
		font-size: 0.75rem;
		color: var(--text-60);
		margin: 0 0 0.75rem;
	}

	.sidebar-cta button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		width: 100%;
		padding: 0.5rem;
		background: var(--color-accent);
		border: none;
		border-radius: 0.375rem;
		color: white;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
	}

	.sidebar-cta button:hover {
		background: var(--color-accent-bright);
	}
</style>
