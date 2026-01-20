<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { user } from '$lib/stores/user';
	import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
	import type { 
		AgileTeam, 
		TeamSettings, 
		AgileRole, 
		BoardColumn, 
		TShirtMapping,
		ReadyChecklistItem,
		DoDChecklistItem,
		StoryTemplate,
		ClientTag
	} from '$lib/firestore/agile';
	import { 
		isProductOwner, 
		isAgileCoach, 
		getUserRole,
		addTeamMember,
		removeTeamMember,
		updateTeamMemberRole,
		addClientTag,
		removeClientTag,
		updateClientTag,
		DEFAULT_COLUMNS,
		DEFAULT_TSHIRT_MAPPING,
		AGILE_ROLE_DESCRIPTIONS
	} from '$lib/firestore/agile';
	import { getContext } from 'svelte';

	// Get board from layout context
	const boardData = getContext<{ board: AgileTeam | null }>('agile-board');
	
	const board = $derived(boardData?.board);
	const boardId = $derived($page.params.boardId);
	const currentUserId = $derived($user?.uid ?? '');
	
	// Check permissions
	const userRole = $derived(board ? getUserRole(board, currentUserId) : null);
	const canEdit = $derived(
		board && (
			isProductOwner(board, currentUserId) || 
			isAgileCoach(board, currentUserId) ||
			board.ownerId === currentUserId
		)
	);

	// Settings state
	let activeTab = $state<'general' | 'workflow' | 'estimation' | 'checklists' | 'members' | 'clients'>('general');
	let isSaving = $state(false);
	let saveMessage = $state('');

	// Editable settings (initialize from board)
	let teamName = $state('');
	let teamKey = $state('');
	let teamIcon = $state('');
	let sprintLengthDays = $state(7);
	let workingDaysPerSprint = $state(5);
	let boardStyle = $state<'kanban' | 'scrum'>('scrum');
	
	// Columns (workflow)
	let columns = $state<BoardColumn[]>([]);
	
	// T-shirt mapping
	let tshirtMapping = $state<TShirtMapping>(DEFAULT_TSHIRT_MAPPING);
	
	// Checklists
	let readyChecklist = $state<ReadyChecklistItem[]>([]);
	let dodChecklist = $state<DoDChecklistItem[]>([]);
	let storyTemplates = $state<StoryTemplate[]>([]);
	
	// Client tags
	let clientTags = $state<ClientTag[]>([]);
	let newClientName = $state('');
	let newClientColor = $state('#3b82f6');
	
	// Member management
	let newMemberEmail = $state('');
	let newMemberRole = $state<AgileRole>('team_member');

	// Initialize state from board when it loads
	$effect(() => {
		if (board) {
			teamName = board.name;
			teamKey = board.key;
			teamIcon = board.iconEmoji ?? '👥';
			sprintLengthDays = board.settings?.sprintLengthDays ?? 7;
			workingDaysPerSprint = board.settings?.workingDaysPerSprint ?? 5;
			boardStyle = board.settings?.boardStyle ?? 'scrum';
			columns = board.columns?.length ? [...board.columns] : [...DEFAULT_COLUMNS];
			tshirtMapping = board.settings?.tshirtMapping ?? { ...DEFAULT_TSHIRT_MAPPING };
			readyChecklist = board.settings?.readyChecklist ?? [];
			dodChecklist = board.settings?.dodChecklist ?? [];
			storyTemplates = board.settings?.storyTemplates ?? [];
			clientTags = board.clientTags ?? [];
		}
	});

	// Save handlers
	async function saveGeneralSettings() {
		if (!canEdit || !board) return;
		isSaving = true;
		try {
			await updateDoc(doc(db, 'agileBoards', boardId), {
				name: teamName,
				key: teamKey,
				iconEmoji: teamIcon,
				'settings.sprintLengthDays': sprintLengthDays,
				'settings.workingDaysPerSprint': workingDaysPerSprint,
				'settings.boardStyle': boardStyle
			});
			saveMessage = 'Settings saved!';
			setTimeout(() => saveMessage = '', 2000);
		} catch (e) {
			console.error('Failed to save settings:', e);
			saveMessage = 'Failed to save';
		}
		isSaving = false;
	}

	async function saveWorkflowSettings() {
		if (!canEdit || !board) return;
		isSaving = true;
		try {
			await updateDoc(doc(db, 'agileBoards', boardId), {
				columns
			});
			saveMessage = 'Workflow saved!';
			setTimeout(() => saveMessage = '', 2000);
		} catch (e) {
			console.error('Failed to save workflow:', e);
			saveMessage = 'Failed to save';
		}
		isSaving = false;
	}

	async function saveEstimationSettings() {
		if (!canEdit || !board) return;
		isSaving = true;
		try {
			await updateDoc(doc(db, 'agileBoards', boardId), {
				'settings.tshirtMapping': tshirtMapping
			});
			saveMessage = 'Estimation settings saved!';
			setTimeout(() => saveMessage = '', 2000);
		} catch (e) {
			console.error('Failed to save estimation:', e);
			saveMessage = 'Failed to save';
		}
		isSaving = false;
	}

	async function saveChecklists() {
		if (!canEdit || !board) return;
		isSaving = true;
		try {
			await updateDoc(doc(db, 'agileBoards', boardId), {
				'settings.readyChecklist': readyChecklist,
				'settings.dodChecklist': dodChecklist,
				'settings.storyTemplates': storyTemplates
			});
			saveMessage = 'Checklists saved!';
			setTimeout(() => saveMessage = '', 2000);
		} catch (e) {
			console.error('Failed to save checklists:', e);
			saveMessage = 'Failed to save';
		}
		isSaving = false;
	}

	// Column management
	function addColumn() {
		const newId = `col_${Date.now()}`;
		columns = [...columns, {
			id: newId,
			name: 'New Column',
			order: columns.length,
			isComplete: false,
			wipLimit: 0,
			color: '#6b7280'
		}];
	}

	function removeColumn(id: string) {
		columns = columns.filter(c => c.id !== id);
	}

	function moveColumn(index: number, direction: 'up' | 'down') {
		const newIndex = direction === 'up' ? index - 1 : index + 1;
		if (newIndex < 0 || newIndex >= columns.length) return;
		const newColumns = [...columns];
		[newColumns[index], newColumns[newIndex]] = [newColumns[newIndex], newColumns[index]];
		newColumns.forEach((c, i) => c.order = i);
		columns = newColumns;
	}

	// Ready checklist management
	function addReadyItem() {
		readyChecklist = [...readyChecklist, {
			id: `ready_${Date.now()}`,
			label: 'New requirement',
			required: false,
			description: ''
		}];
	}

	function removeReadyItem(id: string) {
		readyChecklist = readyChecklist.filter(r => r.id !== id);
	}

	// DoD checklist management
	function addDoDItem() {
		dodChecklist = [...dodChecklist, {
			id: `dod_${Date.now()}`,
			label: 'New requirement',
			required: false,
			category: 'development'
		}];
	}

	function removeDoDItem(id: string) {
		dodChecklist = dodChecklist.filter(d => d.id !== id);
	}

	// Client tag management
	async function handleAddClientTag() {
		if (!newClientName.trim() || !boardId) return;
		try {
			await addClientTag(boardId, newClientName.trim(), newClientColor, currentUserId);
			newClientName = '';
			newClientColor = '#3b82f6';
		} catch (e) {
			console.error('Failed to add client tag:', e);
		}
	}

	async function handleRemoveClientTag(tagId: string) {
		if (!boardId) return;
		try {
			await removeClientTag(boardId, tagId);
		} catch (e) {
			console.error('Failed to remove client tag:', e);
		}
	}

	// Member management
	async function handleAddMember() {
		if (!newMemberEmail.trim() || !boardId) return;
		try {
			// In a real app, you'd look up the user by email
			// For now, we'll show a placeholder
			alert('Member invitation would be sent to: ' + newMemberEmail);
			newMemberEmail = '';
		} catch (e) {
			console.error('Failed to add member:', e);
		}
	}

	async function handleUpdateMemberRole(userId: string, role: AgileRole) {
		if (!boardId) return;
		try {
			await updateTeamMemberRole(boardId, userId, role);
		} catch (e) {
			console.error('Failed to update member role:', e);
		}
	}

	async function handleRemoveMember(userId: string) {
		if (!boardId || userId === currentUserId) return;
		try {
			await removeTeamMember(boardId, userId);
		} catch (e) {
			console.error('Failed to remove member:', e);
		}
	}

	// Reset to defaults
	function resetColumnsToDefault() {
		columns = [...DEFAULT_COLUMNS];
	}

	function resetTShirtMapping() {
		tshirtMapping = { ...DEFAULT_TSHIRT_MAPPING };
	}

	// Predefined colors for client tags
	const tagColors = [
		'#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', 
		'#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899'
	];

	// Common emoji options for team icon
	const emojiOptions = ['👥', '🚀', '⚡', '🎯', '🔥', '💡', '🌟', '🦾', '🏆', '🎨', '🛠️', '📊'];
</script>

<div class="settings-page">
	{#if !canEdit}
		<div class="access-denied">
			<i class="bx bx-lock-alt"></i>
			<h2>Access Restricted</h2>
			<p>Only Product Owners, Agile Coaches, and Team Owners can modify team settings.</p>
			<button type="button" onclick={() => goto(`/agile/board/${boardId}`)}>
				Back to Board
			</button>
		</div>
	{:else if board}
		<header class="settings-header">
			<div class="header-content">
				<h1>Team Settings</h1>
				<p>Configure your team's agile workflow, estimation, and processes</p>
			</div>
			{#if saveMessage}
				<div class="save-message" class:success={saveMessage.includes('saved')}>
					{saveMessage}
				</div>
			{/if}
		</header>

		<div class="settings-layout">
			<!-- Settings Tabs -->
			<nav class="settings-tabs">
				<button 
					type="button"
					class:active={activeTab === 'general'}
					onclick={() => activeTab = 'general'}
				>
					<i class="bx bx-info-circle"></i>
					General
				</button>
				<button 
					type="button"
					class:active={activeTab === 'workflow'}
					onclick={() => activeTab = 'workflow'}
				>
					<i class="bx bx-columns"></i>
					Workflow
				</button>
				<button 
					type="button"
					class:active={activeTab === 'estimation'}
					onclick={() => activeTab = 'estimation'}
				>
					<i class="bx bx-ruler"></i>
					Estimation
				</button>
				<button 
					type="button"
					class:active={activeTab === 'checklists'}
					onclick={() => activeTab = 'checklists'}
				>
					<i class="bx bx-check-square"></i>
					Checklists
				</button>
				<button 
					type="button"
					class:active={activeTab === 'clients'}
					onclick={() => activeTab = 'clients'}
				>
					<i class="bx bx-building"></i>
					Clients
				</button>
				<button 
					type="button"
					class:active={activeTab === 'members'}
					onclick={() => activeTab = 'members'}
				>
					<i class="bx bx-group"></i>
					Members
				</button>
			</nav>

			<!-- Settings Content -->
			<div class="settings-content">
				{#if activeTab === 'general'}
					<section class="settings-section">
						<h2>Team Information</h2>
						<div class="form-group">
							<label for="team-name">Team Name</label>
							<input 
								type="text" 
								id="team-name" 
								bind:value={teamName}
								placeholder="e.g., Platform Team"
							/>
						</div>
						<div class="form-row">
							<div class="form-group">
								<label for="team-key">Team Key</label>
								<input 
									type="text" 
									id="team-key" 
									bind:value={teamKey}
									placeholder="e.g., PLAT"
									maxlength="6"
								/>
								<span class="form-hint">Used as prefix for items (e.g., PLAT-123)</span>
							</div>
							<div class="form-group">
								<label>Team Icon</label>
								<div class="emoji-picker">
									{#each emojiOptions as emoji}
										<button 
											type="button"
											class:selected={teamIcon === emoji}
											onclick={() => teamIcon = emoji}
										>
											{emoji}
										</button>
									{/each}
								</div>
							</div>
						</div>

						<h3>Sprint Configuration</h3>
						<div class="form-row">
							<div class="form-group">
								<label for="sprint-length">Sprint Length (days)</label>
								<input 
									type="number" 
									id="sprint-length" 
									bind:value={sprintLengthDays}
									min="1"
									max="28"
								/>
								<span class="form-hint">Recommended: 7 days (1 week)</span>
							</div>
							<div class="form-group">
								<label for="working-days">Working Days per Sprint</label>
								<input 
									type="number" 
									id="working-days" 
									bind:value={workingDaysPerSprint}
									min="1"
									max={sprintLengthDays}
								/>
								<span class="form-hint">Days team actually works</span>
							</div>
						</div>

						<div class="form-group">
							<label>Board Style</label>
							<div class="toggle-group">
								<button 
									type="button"
									class:active={boardStyle === 'scrum'}
									onclick={() => boardStyle = 'scrum'}
								>
									<i class="bx bx-run"></i>
									Scrum
								</button>
								<button 
									type="button"
									class:active={boardStyle === 'kanban'}
									onclick={() => boardStyle = 'kanban'}
								>
									<i class="bx bx-infinite"></i>
									Kanban
								</button>
							</div>
							<span class="form-hint">
								{boardStyle === 'scrum' 
									? 'Time-boxed sprints with planning and retrospectives' 
									: 'Continuous flow with WIP limits'
								}
							</span>
						</div>

						<div class="form-actions">
							<button type="button" class="btn-primary" onclick={saveGeneralSettings} disabled={isSaving}>
								{isSaving ? 'Saving...' : 'Save Changes'}
							</button>
						</div>
					</section>

				{:else if activeTab === 'workflow'}
					<section class="settings-section">
						<div class="section-header">
							<div>
								<h2>Board Columns</h2>
								<p>Define the workflow stages for your team. Items flow left to right.</p>
							</div>
							<button type="button" class="btn-secondary" onclick={resetColumnsToDefault}>
								<i class="bx bx-reset"></i>
								Reset to Default
							</button>
						</div>

						<div class="columns-list">
							{#each columns as column, index (column.id)}
								<div class="column-item">
									<div class="column-order">
										<button 
											type="button" 
											onclick={() => moveColumn(index, 'up')}
											disabled={index === 0}
										>
											<i class="bx bx-chevron-up"></i>
										</button>
										<span>{index + 1}</span>
										<button 
											type="button" 
											onclick={() => moveColumn(index, 'down')}
											disabled={index === columns.length - 1}
										>
											<i class="bx bx-chevron-down"></i>
										</button>
									</div>
									<div class="column-details">
										<input 
											type="text" 
											bind:value={column.name}
											placeholder="Column name"
										/>
										<div class="column-options">
											<label class="wip-limit">
												<span>WIP Limit</span>
												<input 
													type="number" 
													bind:value={column.wipLimit}
													min="0"
													max="50"
												/>
											</label>
											<label class="checkbox-label">
												<input type="checkbox" bind:checked={column.isComplete} />
												<span>Marks Complete</span>
											</label>
											<input 
												type="color" 
												bind:value={column.color}
												title="Column color"
											/>
										</div>
									</div>
									<button 
										type="button" 
										class="btn-icon danger"
										onclick={() => removeColumn(column.id)}
										title="Remove column"
									>
										<i class="bx bx-trash"></i>
									</button>
								</div>
							{/each}
						</div>

						<button type="button" class="btn-add" onclick={addColumn}>
							<i class="bx bx-plus"></i>
							Add Column
						</button>

						<div class="form-actions">
							<button type="button" class="btn-primary" onclick={saveWorkflowSettings} disabled={isSaving}>
								{isSaving ? 'Saving...' : 'Save Workflow'}
							</button>
						</div>
					</section>

				{:else if activeTab === 'estimation'}
					<section class="settings-section">
						<div class="section-header">
							<div>
								<h2>T-Shirt Sizing</h2>
								<p>Map T-shirt sizes to ideal hours for capacity planning.</p>
							</div>
							<button type="button" class="btn-secondary" onclick={resetTShirtMapping}>
								<i class="bx bx-reset"></i>
								Reset to Default
							</button>
						</div>

						<div class="tshirt-grid">
							<div class="tshirt-item">
								<span class="tshirt-label">XS</span>
								<span class="tshirt-desc">Extra Small</span>
								<input type="number" bind:value={tshirtMapping.xs} min="0" step="0.5" />
								<span class="tshirt-unit">hours</span>
							</div>
							<div class="tshirt-item">
								<span class="tshirt-label">S</span>
								<span class="tshirt-desc">Small</span>
								<input type="number" bind:value={tshirtMapping.s} min="0" step="0.5" />
								<span class="tshirt-unit">hours</span>
							</div>
							<div class="tshirt-item">
								<span class="tshirt-label">M</span>
								<span class="tshirt-desc">Medium</span>
								<input type="number" bind:value={tshirtMapping.m} min="0" step="0.5" />
								<span class="tshirt-unit">hours</span>
							</div>
							<div class="tshirt-item">
								<span class="tshirt-label">L</span>
								<span class="tshirt-desc">Large</span>
								<input type="number" bind:value={tshirtMapping.l} min="0" step="0.5" />
								<span class="tshirt-unit">hours</span>
							</div>
							<div class="tshirt-item">
								<span class="tshirt-label">XL</span>
								<span class="tshirt-desc">Extra Large</span>
								<input type="number" bind:value={tshirtMapping.xl} min="0" step="0.5" />
								<span class="tshirt-unit">hours</span>
							</div>
						</div>

						<div class="estimation-tips">
							<h4><i class="bx bx-bulb"></i> Estimation Tips</h4>
							<ul>
								<li><strong>XS:</strong> Quick fix, typo, config change (≤1 hour)</li>
								<li><strong>S:</strong> Simple change, well-understood scope (half day)</li>
								<li><strong>M:</strong> Standard feature, some complexity (1 day)</li>
								<li><strong>L:</strong> Complex feature, may need investigation (2-3 days)</li>
								<li><strong>XL:</strong> Large scope, should probably be split (3+ days)</li>
							</ul>
						</div>

						<div class="form-actions">
							<button type="button" class="btn-primary" onclick={saveEstimationSettings} disabled={isSaving}>
								{isSaving ? 'Saving...' : 'Save Estimation'}
							</button>
						</div>
					</section>

				{:else if activeTab === 'checklists'}
					<section class="settings-section">
						<h2>Definition of Ready</h2>
						<p>Items must meet these criteria before being pulled into a sprint.</p>

						<div class="checklist-list">
							{#each readyChecklist as item (item.id)}
								<div class="checklist-item">
									<input 
										type="text" 
										bind:value={item.label}
										placeholder="Requirement..."
									/>
									<label class="checkbox-label">
										<input type="checkbox" bind:checked={item.required} />
										<span>Required</span>
									</label>
									<button 
										type="button" 
										class="btn-icon danger"
										onclick={() => removeReadyItem(item.id)}
									>
										<i class="bx bx-trash"></i>
									</button>
								</div>
							{/each}
						</div>

						{#if readyChecklist.length === 0}
							<div class="empty-checklist">
								<p>No requirements defined yet.</p>
							</div>
						{/if}

						<button type="button" class="btn-add" onclick={addReadyItem}>
							<i class="bx bx-plus"></i>
							Add Ready Requirement
						</button>

						<hr />

						<h2>Definition of Done</h2>
						<p>Items must meet these criteria before being marked as complete.</p>

						<div class="checklist-list">
							{#each dodChecklist as item (item.id)}
								<div class="checklist-item">
									<input 
										type="text" 
										bind:value={item.label}
										placeholder="Requirement..."
									/>
									<select bind:value={item.category}>
										<option value="development">Development</option>
										<option value="testing">Testing</option>
										<option value="documentation">Documentation</option>
										<option value="review">Review</option>
									</select>
									<label class="checkbox-label">
										<input type="checkbox" bind:checked={item.required} />
										<span>Required</span>
									</label>
									<button 
										type="button" 
										class="btn-icon danger"
										onclick={() => removeDoDItem(item.id)}
									>
										<i class="bx bx-trash"></i>
									</button>
								</div>
							{/each}
						</div>

						{#if dodChecklist.length === 0}
							<div class="empty-checklist">
								<p>No requirements defined yet.</p>
							</div>
						{/if}

						<button type="button" class="btn-add" onclick={addDoDItem}>
							<i class="bx bx-plus"></i>
							Add Done Requirement
						</button>

						<div class="form-actions">
							<button type="button" class="btn-primary" onclick={saveChecklists} disabled={isSaving}>
								{isSaving ? 'Saving...' : 'Save Checklists'}
							</button>
						</div>
					</section>

				{:else if activeTab === 'clients'}
					<section class="settings-section">
						<h2>Client Tags</h2>
						<p>Create tags to track which client each backlog item belongs to.</p>

						<div class="client-tags-list">
							{#each clientTags as tag (tag.id)}
								<div class="client-tag-item">
									<span class="tag-preview" style="--tag-color: {tag.color}">
										{tag.name}
									</span>
									<input 
										type="text" 
										value={tag.name}
										onchange={(e) => updateClientTag(boardId, tag.id, { name: e.currentTarget.value })}
									/>
									<input 
										type="color" 
										value={tag.color}
										onchange={(e) => updateClientTag(boardId, tag.id, { color: e.currentTarget.value })}
									/>
									<button 
										type="button" 
										class="btn-icon danger"
										onclick={() => handleRemoveClientTag(tag.id)}
										title="Remove tag"
									>
										<i class="bx bx-trash"></i>
									</button>
								</div>
							{/each}
						</div>

						{#if clientTags.length === 0}
							<div class="empty-checklist">
								<p>No client tags defined yet.</p>
							</div>
						{/if}

						<div class="add-client-form">
							<input 
								type="text" 
								bind:value={newClientName}
								placeholder="Client name..."
							/>
							<div class="color-picker">
								{#each tagColors as color}
									<button 
										type="button"
										class:selected={newClientColor === color}
										style="background-color: {color}"
										onclick={() => newClientColor = color}
									></button>
								{/each}
							</div>
							<button type="button" class="btn-primary" onclick={handleAddClientTag} disabled={!newClientName.trim()}>
								<i class="bx bx-plus"></i>
								Add Client
							</button>
						</div>
					</section>

				{:else if activeTab === 'members'}
					<section class="settings-section">
						<h2>Team Members</h2>
						<p>Manage who has access to this team and their roles.</p>

						<div class="roles-legend">
							{#each Object.entries(AGILE_ROLE_DESCRIPTIONS) as [role, desc]}
								<div class="role-info">
									<strong class="role-name">{role.replace('_', ' ')}</strong>
									<span>{desc}</span>
								</div>
							{/each}
						</div>

						<div class="members-list">
							<!-- Owner -->
							{#if board.ownerId}
								<div class="member-item owner">
									<div class="member-avatar">
										<i class="bx bx-crown"></i>
									</div>
									<div class="member-info">
										<span class="member-name">Team Owner</span>
										<span class="member-role">Full access to all settings</span>
									</div>
								</div>
							{/if}

							<!-- Product Owners -->
							{#if board.productOwnerIds?.length}
								{#each board.productOwnerIds as poId}
									<div class="member-item">
										<div class="member-avatar po">
											<i class="bx bx-user"></i>
										</div>
										<div class="member-info">
											<span class="member-name">Product Owner</span>
											<span class="member-id">{poId}</span>
										</div>
										{#if poId !== currentUserId}
											<select 
												value="product_owner"
												onchange={(e) => handleUpdateMemberRole(poId, e.currentTarget.value as AgileRole)}
											>
												<option value="product_owner">Product Owner</option>
												<option value="agile_coach">Agile Coach</option>
												<option value="team_member">Team Member</option>
												<option value="viewer">Viewer</option>
											</select>
											<button 
												type="button" 
												class="btn-icon danger"
												onclick={() => handleRemoveMember(poId)}
											>
												<i class="bx bx-user-minus"></i>
											</button>
										{/if}
									</div>
								{/each}
							{/if}

							<!-- Agile Coach -->
							{#if board.agileCoachId}
								<div class="member-item">
									<div class="member-avatar coach">
										<i class="bx bx-shield-quarter"></i>
									</div>
									<div class="member-info">
										<span class="member-name">Agile Coach</span>
										<span class="member-id">{board.agileCoachId}</span>
									</div>
									{#if board.agileCoachId !== currentUserId}
										<select 
											value="agile_coach"
											onchange={(e) => handleUpdateMemberRole(board.agileCoachId!, e.currentTarget.value as AgileRole)}
										>
											<option value="product_owner">Product Owner</option>
											<option value="agile_coach">Agile Coach</option>
											<option value="team_member">Team Member</option>
											<option value="viewer">Viewer</option>
										</select>
										<button 
											type="button" 
											class="btn-icon danger"
											onclick={() => handleRemoveMember(board.agileCoachId!)}
										>
											<i class="bx bx-user-minus"></i>
										</button>
									{/if}
								</div>
							{/if}

							<!-- Team Members -->
							{#if board.teamMemberIds?.length}
								{#each board.teamMemberIds as memberId}
									<div class="member-item">
										<div class="member-avatar member">
											<i class="bx bx-user"></i>
										</div>
										<div class="member-info">
											<span class="member-name">Team Member</span>
											<span class="member-id">{memberId}</span>
										</div>
										{#if memberId !== currentUserId}
											<select 
												value="team_member"
												onchange={(e) => handleUpdateMemberRole(memberId, e.currentTarget.value as AgileRole)}
											>
												<option value="product_owner">Product Owner</option>
												<option value="agile_coach">Agile Coach</option>
												<option value="team_member">Team Member</option>
												<option value="viewer">Viewer</option>
											</select>
											<button 
												type="button" 
												class="btn-icon danger"
												onclick={() => handleRemoveMember(memberId)}
											>
												<i class="bx bx-user-minus"></i>
											</button>
										{/if}
									</div>
								{/each}
							{/if}

							<!-- Viewers -->
							{#if board.viewerIds?.length}
								{#each board.viewerIds as viewerId}
									<div class="member-item">
										<div class="member-avatar viewer">
											<i class="bx bx-show"></i>
										</div>
										<div class="member-info">
											<span class="member-name">Viewer</span>
											<span class="member-id">{viewerId}</span>
										</div>
										{#if viewerId !== currentUserId}
											<select 
												value="viewer"
												onchange={(e) => handleUpdateMemberRole(viewerId, e.currentTarget.value as AgileRole)}
											>
												<option value="product_owner">Product Owner</option>
												<option value="agile_coach">Agile Coach</option>
												<option value="team_member">Team Member</option>
												<option value="viewer">Viewer</option>
											</select>
											<button 
												type="button" 
												class="btn-icon danger"
												onclick={() => handleRemoveMember(viewerId)}
											>
												<i class="bx bx-user-minus"></i>
											</button>
										{/if}
									</div>
								{/each}
							{/if}
						</div>

						<div class="add-member-form">
							<input 
								type="email" 
								bind:value={newMemberEmail}
								placeholder="Enter email address..."
							/>
							<select bind:value={newMemberRole}>
								<option value="team_member">Team Member</option>
								<option value="viewer">Viewer</option>
								<option value="product_owner">Product Owner</option>
								<option value="agile_coach">Agile Coach</option>
							</select>
							<button type="button" class="btn-primary" onclick={handleAddMember} disabled={!newMemberEmail.trim()}>
								<i class="bx bx-user-plus"></i>
								Invite
							</button>
						</div>
					</section>
				{/if}
			</div>
		</div>
	{:else}
		<div class="loading">
			<i class="bx bx-loader-alt bx-spin"></i>
			<p>Loading settings...</p>
		</div>
	{/if}
</div>

<style>
	.settings-page {
		height: 100%;
		overflow-y: auto;
		padding: 1.5rem 2rem;
		background: var(--color-bg);
	}

	.access-denied {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 50vh;
		text-align: center;
		color: var(--text-60);
	}

	.access-denied i {
		font-size: 3rem;
		color: var(--text-30);
		margin-bottom: 1rem;
	}

	.access-denied h2 {
		margin: 0 0 0.5rem;
		color: var(--color-text-primary);
	}

	.access-denied p {
		margin: 0 0 1.5rem;
	}

	.access-denied button {
		padding: 0.5rem 1rem;
		background: var(--color-accent);
		border: none;
		border-radius: 0.375rem;
		color: white;
		cursor: pointer;
	}

	.settings-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--text-08);
	}

	.header-content h1 {
		margin: 0;
		font-size: 1.5rem;
		color: var(--color-text-primary);
	}

	.header-content p {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: var(--text-50);
	}

	.save-message {
		padding: 0.5rem 1rem;
		background: var(--text-08);
		border-radius: 0.375rem;
		font-size: 0.875rem;
		color: var(--text-60);
	}

	.save-message.success {
		background: color-mix(in srgb, #22c55e 15%, transparent);
		color: #22c55e;
	}

	.settings-layout {
		display: flex;
		gap: 2rem;
	}

	.settings-tabs {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		width: 180px;
		flex-shrink: 0;
	}

	.settings-tabs button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		background: transparent;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		color: var(--text-60);
		cursor: pointer;
		text-align: left;
		transition: all 0.1s ease;
	}

	.settings-tabs button:hover {
		background: var(--text-06);
		color: var(--color-text-primary);
	}

	.settings-tabs button.active {
		background: var(--color-accent-muted);
		color: var(--color-accent);
	}

	.settings-tabs button i {
		font-size: 1.125rem;
	}

	.settings-content {
		flex: 1;
		min-width: 0;
	}

	.settings-section {
		background: var(--color-panel);
		border: 1px solid var(--text-08);
		border-radius: 0.5rem;
		padding: 1.5rem;
	}

	.settings-section h2 {
		margin: 0 0 0.25rem;
		font-size: 1.125rem;
		color: var(--color-text-primary);
	}

	.settings-section h3 {
		margin: 1.5rem 0 0.75rem;
		font-size: 0.9375rem;
		color: var(--color-text-primary);
	}

	.settings-section > p {
		margin: 0 0 1rem;
		font-size: 0.8125rem;
		color: var(--text-50);
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1rem;
	}

	.form-group {
		margin-bottom: 1rem;
	}

	.form-group label {
		display: block;
		margin-bottom: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.form-group input[type="text"],
	.form-group input[type="number"],
	.form-group input[type="email"],
	.form-group select {
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg);
		border: 1px solid var(--text-12);
		border-radius: 0.375rem;
		font-size: 0.875rem;
		color: var(--color-text-primary);
	}

	.form-group input:focus,
	.form-group select:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.form-hint {
		display: block;
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: var(--text-40);
	}

	.form-row {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1rem;
	}

	.emoji-picker {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.emoji-picker button {
		width: 2.25rem;
		height: 2.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-bg);
		border: 1px solid var(--text-12);
		border-radius: 0.375rem;
		font-size: 1.125rem;
		cursor: pointer;
	}

	.emoji-picker button:hover {
		background: var(--text-06);
	}

	.emoji-picker button.selected {
		border-color: var(--color-accent);
		background: var(--color-accent-muted);
	}

	.toggle-group {
		display: flex;
		gap: 0.5rem;
	}

	.toggle-group button {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.625rem;
		background: var(--color-bg);
		border: 1px solid var(--text-12);
		border-radius: 0.375rem;
		font-size: 0.875rem;
		color: var(--text-60);
		cursor: pointer;
	}

	.toggle-group button:hover {
		background: var(--text-06);
	}

	.toggle-group button.active {
		background: var(--color-accent-muted);
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.form-actions {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--text-08);
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		background: var(--color-accent);
		border: none;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: white;
		cursor: pointer;
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--color-accent-bright);
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		background: transparent;
		border: 1px solid var(--text-20);
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		color: var(--text-60);
		cursor: pointer;
	}

	.btn-secondary:hover {
		background: var(--text-06);
		border-color: var(--text-30);
	}

	.btn-add {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		width: 100%;
		padding: 0.625rem;
		margin-top: 0.75rem;
		background: transparent;
		border: 1px dashed var(--text-20);
		border-radius: 0.375rem;
		font-size: 0.875rem;
		color: var(--text-50);
		cursor: pointer;
	}

	.btn-add:hover {
		background: var(--text-04);
		border-color: var(--text-30);
		color: var(--color-text-primary);
	}

	.btn-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		background: transparent;
		border: none;
		border-radius: 0.25rem;
		color: var(--text-40);
		cursor: pointer;
	}

	.btn-icon:hover {
		background: var(--text-08);
		color: var(--color-text-primary);
	}

	.btn-icon.danger:hover {
		background: color-mix(in srgb, #ef4444 15%, transparent);
		color: #ef4444;
	}

	/* Columns */
	.columns-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.column-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		background: var(--color-bg);
		border: 1px solid var(--text-08);
		border-radius: 0.375rem;
	}

	.column-order {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.125rem;
	}

	.column-order button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.25rem;
		background: transparent;
		border: none;
		color: var(--text-40);
		cursor: pointer;
	}

	.column-order button:hover:not(:disabled) {
		color: var(--color-text-primary);
	}

	.column-order button:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.column-order span {
		font-size: 0.75rem;
		color: var(--text-40);
	}

	.column-details {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.column-details input[type="text"] {
		padding: 0.375rem 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.column-options {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.wip-limit {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--text-50);
	}

	.wip-limit input {
		width: 3rem;
		padding: 0.25rem 0.375rem;
		font-size: 0.75rem;
		text-align: center;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--text-50);
		cursor: pointer;
	}

	.column-options input[type="color"] {
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border: none;
		border-radius: 0.25rem;
		cursor: pointer;
	}

	/* T-shirt sizing */
	.tshirt-grid {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 0.75rem;
	}

	.tshirt-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
		padding: 1rem;
		background: var(--color-bg);
		border: 1px solid var(--text-08);
		border-radius: 0.5rem;
		text-align: center;
	}

	.tshirt-label {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-accent);
	}

	.tshirt-desc {
		font-size: 0.6875rem;
		color: var(--text-40);
	}

	.tshirt-item input {
		width: 4rem;
		padding: 0.375rem;
		text-align: center;
		font-size: 1rem;
		font-weight: 600;
	}

	.tshirt-unit {
		font-size: 0.6875rem;
		color: var(--text-40);
	}

	.estimation-tips {
		margin-top: 1.5rem;
		padding: 1rem;
		background: var(--color-bg);
		border: 1px solid var(--text-08);
		border-radius: 0.5rem;
	}

	.estimation-tips h4 {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin: 0 0 0.75rem;
		font-size: 0.875rem;
		color: var(--color-text-primary);
	}

	.estimation-tips ul {
		margin: 0;
		padding-left: 1.25rem;
		font-size: 0.8125rem;
		color: var(--text-60);
	}

	.estimation-tips li {
		margin-bottom: 0.375rem;
	}

	.estimation-tips strong {
		color: var(--color-accent);
	}

	/* Checklists */
	.checklist-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.checklist-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg);
		border: 1px solid var(--text-08);
		border-radius: 0.375rem;
	}

	.checklist-item input[type="text"] {
		flex: 1;
		padding: 0.375rem 0.5rem;
	}

	.checklist-item select {
		width: 130px;
		padding: 0.375rem 0.5rem;
		font-size: 0.8125rem;
	}

	.empty-checklist {
		padding: 1rem;
		text-align: center;
		color: var(--text-40);
		font-size: 0.875rem;
	}

	hr {
		border: none;
		border-top: 1px solid var(--text-08);
		margin: 1.5rem 0;
	}

	/* Client tags */
	.client-tags-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.client-tag-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg);
		border: 1px solid var(--text-08);
		border-radius: 0.375rem;
	}

	.tag-preview {
		padding: 0.25rem 0.625rem;
		background: color-mix(in srgb, var(--tag-color) 20%, transparent);
		color: var(--tag-color);
		border-radius: 1rem;
		font-size: 0.75rem;
		font-weight: 500;
		white-space: nowrap;
	}

	.client-tag-item input[type="text"] {
		flex: 1;
		padding: 0.375rem 0.5rem;
	}

	.client-tag-item input[type="color"] {
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: none;
		border-radius: 0.25rem;
		cursor: pointer;
	}

	.add-client-form {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--text-08);
	}

	.add-client-form input[type="text"] {
		flex: 1;
		padding: 0.5rem 0.75rem;
	}

	.color-picker {
		display: flex;
		gap: 0.25rem;
	}

	.color-picker button {
		width: 1.5rem;
		height: 1.5rem;
		border: 2px solid transparent;
		border-radius: 0.25rem;
		cursor: pointer;
	}

	.color-picker button:hover {
		transform: scale(1.1);
	}

	.color-picker button.selected {
		border-color: var(--color-text-primary);
	}

	/* Members */
	.roles-legend {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
		margin-bottom: 1.5rem;
		padding: 1rem;
		background: var(--color-bg);
		border: 1px solid var(--text-08);
		border-radius: 0.5rem;
	}

	.role-info {
		display: flex;
		flex-direction: column;
	}

	.role-name {
		font-size: 0.8125rem;
		text-transform: capitalize;
		color: var(--color-text-primary);
	}

	.role-info span {
		font-size: 0.75rem;
		color: var(--text-50);
	}

	.members-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.member-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		background: var(--color-bg);
		border: 1px solid var(--text-08);
		border-radius: 0.375rem;
	}

	.member-avatar {
		width: 2.5rem;
		height: 2.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--text-08);
		border-radius: 50%;
		font-size: 1.125rem;
		color: var(--text-50);
	}

	.member-avatar.po {
		background: color-mix(in srgb, #8b5cf6 20%, transparent);
		color: #8b5cf6;
	}

	.member-avatar.coach {
		background: color-mix(in srgb, #0ea5e9 20%, transparent);
		color: #0ea5e9;
	}

	.member-avatar.member {
		background: color-mix(in srgb, #10b981 20%, transparent);
		color: #10b981;
	}

	.member-avatar.viewer {
		background: var(--text-06);
		color: var(--text-40);
	}

	.member-item.owner .member-avatar {
		background: color-mix(in srgb, #f59e0b 20%, transparent);
		color: #f59e0b;
	}

	.member-info {
		flex: 1;
		min-width: 0;
	}

	.member-name {
		display: block;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.member-role,
	.member-id {
		display: block;
		font-size: 0.75rem;
		color: var(--text-50);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.member-item select {
		width: 140px;
		padding: 0.375rem 0.5rem;
		font-size: 0.8125rem;
	}

	.add-member-form {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--text-08);
	}

	.add-member-form input[type="email"] {
		flex: 1;
		padding: 0.5rem 0.75rem;
	}

	.add-member-form select {
		width: 140px;
		padding: 0.5rem;
	}

	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 50vh;
		color: var(--text-50);
	}

	.loading i {
		font-size: 2rem;
		margin-bottom: 0.5rem;
	}

	@media (max-width: 768px) {
		.settings-page {
			padding: 1rem;
		}

		.settings-layout {
			flex-direction: column;
		}

		.settings-tabs {
			flex-direction: row;
			width: 100%;
			overflow-x: auto;
			padding-bottom: 0.5rem;
		}

		.settings-tabs button {
			white-space: nowrap;
		}

		.form-row {
			grid-template-columns: 1fr;
		}

		.tshirt-grid {
			grid-template-columns: repeat(3, 1fr);
		}

		.roles-legend {
			grid-template-columns: 1fr;
		}
	}
</style>
