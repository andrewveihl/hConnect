<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { user } from '$lib/stores/user';
	import { showAdminToast } from '$lib/admin/stores/toast';
	import { isMobileViewport } from '$lib/stores/viewport';
	import {
		subscribeBoard,
		subscribeItems,
		subscribeSprints,
		subscribeEpics,
		createItem,
		updateItem,
		deleteItem,
		createSprint,
		startSprint,
		completeSprint,
		moveItemToSprint,
		deleteBoard,
		type AgileBoard,
		type BacklogItem,
		type Sprint,
		type Epic,
		type ItemStatus,
		type ItemType,
		type ItemPriority
	} from '$lib/firestore/agile';
	import type { Unsubscribe } from 'firebase/firestore';

	// Get board ID from URL
	const boardId = $derived($page.params.boardId);

	// Subscriptions
	let unsubBoard: Unsubscribe | null = null;
	let unsubItems: Unsubscribe | null = null;
	let unsubSprints: Unsubscribe | null = null;
	let unsubEpics: Unsubscribe | null = null;

	// State
	let loading = $state(true);
	let board = $state<AgileBoard | null>(null);
	let items = $state<BacklogItem[]>([]);
	let sprints = $state<Sprint[]>([]);
	let epics = $state<Epic[]>([]);

	// UI State
	type ViewMode = 'board' | 'backlog' | 'sprints';
	let viewMode = $state<ViewMode>('board');
	let showCreateItemModal = $state(false);
	let showCreateSprintModal = $state(false);
	let showSettingsPanel = $state(false);
	let showDeleteConfirm = $state(false);
	let deleting = $state(false);

	// Form state
	let newItemTitle = $state('');
	let newItemType = $state<ItemType>('task');
	let newItemPriority = $state<ItemPriority>('medium');
	let newItemDescription = $state('');
	let creatingItem = $state(false);

	let newSprintName = $state('');
	let newSprintGoal = $state('');
	let sprintDuration = $state(2);
	let creatingSprint = $state(false);

	// Drag state
	let draggedItem = $state<BacklogItem | null>(null);
	let dragOverColumn = $state<ItemStatus | null>(null);

	const mobileViewport = $derived($isMobileViewport);

	// Column config for Kanban board (subset of ItemStatus used for sprint board)
	type BoardColumnStatus = 'todo' | 'in_progress' | 'review' | 'done';

	// Derived data
	const activeSprint = $derived(sprints.find((s) => s.status === 'active'));
	const backlogItems = $derived(items.filter((i) => !i.sprintId));
	const sprintItems = $derived(activeSprint ? items.filter((i) => i.sprintId === activeSprint.id) : []);

	const itemsByStatus = $derived<Record<BoardColumnStatus, BacklogItem[]>>({
		todo: sprintItems.filter((i) => i.status === 'todo'),
		in_progress: sprintItems.filter((i) => i.status === 'in_progress'),
		review: sprintItems.filter((i) => i.status === 'review'),
		done: sprintItems.filter((i) => i.status === 'done')
	});

	const sprintProgress = $derived.by(() => {
		if (!activeSprint || sprintItems.length === 0) return 0;
		const done = sprintItems.filter((i) => i.status === 'done').length;
		return Math.round((done / sprintItems.length) * 100);
	});

	const columns: { id: BoardColumnStatus; label: string; color: string; icon: string }[] = [
		{ id: 'todo', label: 'To Do', color: '#6b7280', icon: 'bx-circle' },
		{ id: 'in_progress', label: 'In Progress', color: '#3b82f6', icon: 'bx-play-circle' },
		{ id: 'review', label: 'Review', color: '#8b5cf6', icon: 'bx-search' },
		{ id: 'done', label: 'Done', color: '#10b981', icon: 'bx-check-circle' }
	];

	const priorityConfig: Record<ItemPriority, { color: string; label: string }> = {
		critical: { color: '#ef4444', label: 'Critical' },
		high: { color: '#f97316', label: 'High' },
		medium: { color: '#eab308', label: 'Medium' },
		low: { color: '#22c55e', label: 'Low' }
	};

	const typeConfig: Record<ItemType, { icon: string; color: string; label: string }> = {
		story: { icon: 'bx-book-bookmark', color: '#22c55e', label: 'Story' },
		bug: { icon: 'bx-bug', color: '#ef4444', label: 'Bug' },
		task: { icon: 'bx-check-square', color: '#3b82f6', label: 'Task' },
		epic: { icon: 'bx-rocket', color: '#8b5cf6', label: 'Epic' },
		subtask: { icon: 'bx-subdirectory-right', color: '#6b7280', label: 'Subtask' }
	};

	// Subscribe to board data
	function subscribeToBoard(id: string) {
		// Clear old subscriptions
		unsubBoard?.();
		unsubItems?.();
		unsubSprints?.();
		unsubEpics?.();

		loading = true;

		unsubBoard = subscribeBoard(id, (b) => {
			board = b;
			if (!b) {
				loading = false;
				// Board not found or no access
				goto('/agile');
			}
		});

		unsubItems = subscribeItems(id, (i) => {
			items = i;
			loading = false;
		});

		unsubSprints = subscribeSprints(id, (s) => {
			sprints = s;
		});

		unsubEpics = subscribeEpics(id, (e) => {
			epics = e;
		});
	}

	// Watch for board ID changes
	$effect(() => {
		if (boardId) {
			subscribeToBoard(boardId);
		}
	});

	onDestroy(() => {
		unsubBoard?.();
		unsubItems?.();
		unsubSprints?.();
		unsubEpics?.();
	});

	// Handlers
	async function handleCreateItem() {
		const uid = $user?.uid;
		if (!board || !newItemTitle.trim() || !uid) return;

		creatingItem = true;
		try {
			await createItem(board.id, {
				title: newItemTitle.trim(),
				type: newItemType,
				priority: newItemPriority,
				description: newItemDescription.trim() || undefined,
				reporterId: uid,
				sprintId: activeSprint?.id // Add to active sprint if exists
			});
			showAdminToast({ type: 'success', message: 'Item created!' });
			showCreateItemModal = false;
			newItemTitle = '';
			newItemDescription = '';
		} catch (err) {
			console.error('Failed to create item:', err);
			showAdminToast({ type: 'error', message: 'Failed to create item' });
		} finally {
			creatingItem = false;
		}
	}

	async function handleCreateSprint() {
		const uid = $user?.uid;
		if (!board || !newSprintName.trim() || !uid) return;

		creatingSprint = true;
		try {
			const startDate = new Date();
			const endDate = new Date();
			endDate.setDate(endDate.getDate() + sprintDuration * 7);

			await createSprint(board.id, {
				name: newSprintName.trim(),
				goal: newSprintGoal.trim() || undefined,
				startDate,
				endDate
			}, uid);
			showAdminToast({ type: 'success', message: 'Sprint created!' });
			showCreateSprintModal = false;
			newSprintName = '';
			newSprintGoal = '';
		} catch (err) {
			console.error('Failed to create sprint:', err);
			showAdminToast({ type: 'error', message: 'Failed to create sprint' });
		} finally {
			creatingSprint = false;
		}
	}

	async function handleStartSprint(sprintId: string) {
		const uid = $user?.uid;
		if (!board || !uid) return;
		try {
			const endDate = new Date();
			endDate.setDate(endDate.getDate() + sprintDuration * 7);
			await startSprint(board.id, sprintId, endDate, uid);
			showAdminToast({ type: 'success', message: 'Sprint started!' });
		} catch (err) {
			console.error('Failed to start sprint:', err);
			showAdminToast({ type: 'error', message: 'Failed to start sprint' });
		}
	}

	async function handleCompleteSprint(sprintId: string) {
		const uid = $user?.uid;
		if (!board || !uid) return;
		try {
			await completeSprint(board.id, sprintId, uid);
			showAdminToast({ type: 'success', message: 'Sprint completed!' });
		} catch (err) {
			console.error('Failed to complete sprint:', err);
			showAdminToast({ type: 'error', message: 'Failed to complete sprint' });
		}
	}

	async function handleMoveToSprint(itemId: string, sprintId: string | null) {
		const uid = $user?.uid;
		if (!board || !uid) return;
		try {
			await moveItemToSprint(board.id, itemId, sprintId, uid);
		} catch (err) {
			console.error('Failed to move item:', err);
			showAdminToast({ type: 'error', message: 'Failed to move item' });
		}
	}

	async function handleStatusChange(item: BacklogItem, newStatus: ItemStatus) {
		if (!board) return;
		try {
			await updateItem(board.id, item.id, { status: newStatus });
		} catch (err) {
			console.error('Failed to update status:', err);
			showAdminToast({ type: 'error', message: 'Failed to update status' });
		}
	}

	async function handleDeleteBoard() {
		if (!board) return;
		const boardName = board.name;
		deleting = true;
		try {
			await deleteBoard(board.id);
			showAdminToast({ type: 'success', message: `Board "${boardName}" deleted` });
			goto('/agile');
		} catch (err) {
			console.error('Failed to delete board:', err);
			showAdminToast({ type: 'error', message: 'Failed to delete board' });
		} finally {
			deleting = false;
		}
	}

	// Drag & Drop handlers
	function handleDragStart(item: BacklogItem) {
		draggedItem = item;
	}

	function handleDragOver(e: DragEvent, column: ItemStatus) {
		e.preventDefault();
		dragOverColumn = column;
	}

	function handleDragLeave() {
		dragOverColumn = null;
	}

	async function handleDrop(column: ItemStatus) {
		if (draggedItem && draggedItem.status !== column) {
			await handleStatusChange(draggedItem, column);
		}
		draggedItem = null;
		dragOverColumn = null;
	}

	function handleDragEnd() {
		draggedItem = null;
		dragOverColumn = null;
	}
</script>

{#if loading}
	<div class="flex h-full items-center justify-center">
		<div class="flex flex-col items-center gap-3">
			<i class="bx bx-loader-alt animate-spin text-3xl" style="color: var(--color-accent);"></i>
			<p style="color: var(--text-50);">Loading board...</p>
		</div>
	</div>
{:else if !board}
	<div class="flex h-full items-center justify-center">
		<div class="text-center">
			<i class="bx bx-error-circle text-4xl" style="color: var(--color-danger);"></i>
			<p class="mt-2" style="color: var(--text-50);">Board not found</p>
			<button
				type="button"
				class="mt-4 rounded-lg px-4 py-2 text-sm font-medium"
				style="background: var(--color-accent); color: var(--button-primary-text);"
				onclick={() => goto('/agile')}
			>
				Back to Projects
			</button>
		</div>
	</div>
{:else}
	<!-- Header -->
	<header class="shrink-0 border-b px-4 py-3 md:px-6" style="border-color: var(--text-10); background: var(--color-panel);">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<button
					type="button"
					class="rounded-lg p-2 transition"
					style="color: var(--text-50);"
					onclick={() => goto('/agile')}
					aria-label="Back to projects"
				>
					<i class="bx bx-arrow-back text-xl"></i>
				</button>
				<div>
					<div class="flex items-center gap-2">
						<span
							class="rounded px-1.5 py-0.5 text-xs font-bold"
							style="background: var(--color-accent-soft); color: var(--color-accent);"
						>
							{board.key}
						</span>
						<h1 class="text-lg font-semibold" style="color: var(--color-text-primary);">{board.name}</h1>
					</div>
					{#if activeSprint}
						<div class="mt-0.5 flex items-center gap-2 text-xs" style="color: var(--text-50);">
							<span class="flex items-center gap-1">
								<i class="bx bx-run"></i>
								{activeSprint.name}
							</span>
							<span>•</span>
							<span>{sprintProgress}% complete</span>
						</div>
					{/if}
				</div>
			</div>

			<div class="flex items-center gap-2">
				<!-- View Tabs -->
				<div class="hidden rounded-lg p-1 md:flex" style="background: var(--button-ghost-bg);">
					{#each [{ id: 'board', label: 'Board', icon: 'bx-grid-alt' }, { id: 'backlog', label: 'Backlog', icon: 'bx-list-ul' }, { id: 'sprints', label: 'Sprints', icon: 'bx-run' }] as tab}
						<button
							type="button"
							class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition"
							style={viewMode === tab.id ? 'background: var(--color-panel); color: var(--color-text-primary);' : 'color: var(--text-50);'}
							onclick={() => (viewMode = tab.id as ViewMode)}
						>
							<i class="bx {tab.icon}"></i>
							{tab.label}
						</button>
					{/each}
				</div>

				<!-- Create Button -->
				<button
					type="button"
					class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition hover:opacity-90"
					style="background: var(--color-accent); color: var(--button-primary-text);"
					onclick={() => (showCreateItemModal = true)}
				>
					<i class="bx bx-plus"></i>
					<span class="hidden sm:inline">Create</span>
				</button>

				<!-- Settings -->
				<button
					type="button"
					class="rounded-lg p-2 transition"
					style="color: var(--text-50);"
					onclick={() => (showSettingsPanel = !showSettingsPanel)}
					aria-label="Board settings"
				>
					<i class="bx bx-cog text-xl"></i>
				</button>
			</div>
		</div>

		<!-- Mobile View Tabs -->
		<div class="mt-3 flex gap-1 overflow-x-auto md:hidden" style="background: var(--button-ghost-bg); border-radius: 0.5rem; padding: 0.25rem;">
			{#each [{ id: 'board', label: 'Board', icon: 'bx-grid-alt' }, { id: 'backlog', label: 'Backlog', icon: 'bx-list-ul' }, { id: 'sprints', label: 'Sprints', icon: 'bx-run' }] as tab}
				<button
					type="button"
					class="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition"
					style={viewMode === tab.id ? 'background: var(--color-panel); color: var(--color-text-primary);' : 'color: var(--text-50);'}
					onclick={() => (viewMode = tab.id as ViewMode)}
				>
					<i class="bx {tab.icon}"></i>
					{tab.label}
				</button>
			{/each}
		</div>
	</header>

	<!-- Content -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Main Content Area -->
		<main class="flex-1 overflow-auto">
			{#if viewMode === 'board'}
				<!-- Kanban Board -->
				{#if !activeSprint}
					<div class="flex h-full flex-col items-center justify-center p-6">
						<div class="flex h-16 w-16 items-center justify-center rounded-2xl" style="background: var(--color-accent-soft);">
							<i class="bx bx-run text-3xl" style="color: var(--color-accent);"></i>
						</div>
						<h3 class="mt-4 text-lg font-semibold" style="color: var(--color-text-primary);">No Active Sprint</h3>
						<p class="mt-1 text-center text-sm" style="color: var(--text-50); max-width: 280px;">
							Start a sprint to begin tracking progress on the board.
						</p>
						<button
							type="button"
							class="mt-4 rounded-lg px-4 py-2 text-sm font-medium transition hover:opacity-90"
							style="background: var(--color-accent); color: var(--button-primary-text);"
							onclick={() => (viewMode = 'sprints')}
						>
							Go to Sprints
						</button>
					</div>
				{:else}
					<div class="flex h-full gap-4 p-4 overflow-x-auto">
						{#each columns as column}
							{@const columnItems = itemsByStatus[column.id]}
							<div
								class="flex w-72 shrink-0 flex-col rounded-xl"
								style="background: var(--button-ghost-bg);"
							>
								<!-- Column Header -->
								<div class="flex items-center justify-between px-3 py-2.5">
									<div class="flex items-center gap-2">
										<i class="bx {column.icon}" style="color: {column.color};"></i>
										<span class="text-sm font-medium" style="color: var(--color-text-primary);">{column.label}</span>
										<span class="rounded-full px-2 py-0.5 text-xs" style="background: var(--text-10); color: var(--text-50);">
											{columnItems.length}
										</span>
									</div>
								</div>

								<!-- Column Body -->
								<div
									class="flex-1 space-y-2 overflow-y-auto px-2 pb-2 min-h-[200px] rounded-lg transition-colors"
									class:ring-2={dragOverColumn === column.id}
									class:ring-[var(--color-accent)]={dragOverColumn === column.id}
									ondragover={(e) => handleDragOver(e, column.id)}
									ondragleave={handleDragLeave}
									ondrop={() => handleDrop(column.id)}
									role="list"
								>
									{#each columnItems as item (item.id)}
										<div
											class="group cursor-grab rounded-lg border p-3 transition active:cursor-grabbing"
											style="background: var(--color-panel); border-color: var(--text-08);"
											draggable="true"
											ondragstart={() => handleDragStart(item)}
											ondragend={handleDragEnd}
											role="listitem"
										>
											<!-- Item Type & Priority -->
											<div class="flex items-center gap-2">
												<i class="bx {typeConfig[item.type].icon} text-sm" style="color: {typeConfig[item.type].color};"></i>
												<span class="text-xs font-medium" style="color: var(--text-40);">
													{item.key}
												</span>
												<div class="ml-auto flex items-center gap-1">
													<div
														class="h-2 w-2 rounded-full"
														style="background: {priorityConfig[item.priority].color};"
														title={priorityConfig[item.priority].label}
													></div>
												</div>
											</div>

											<!-- Title -->
											<p class="mt-2 text-sm font-medium line-clamp-2" style="color: var(--color-text-primary);">
												{item.title}
											</p>

											<!-- Story Points -->
											{#if item.storyPoints}
												<div class="mt-2 flex items-center gap-1 text-xs" style="color: var(--text-40);">
													<i class="bx bx-star"></i>
													{item.storyPoints} pts
												</div>
											{/if}
										</div>
									{/each}

									{#if columnItems.length === 0}
										<div
											class="flex h-20 items-center justify-center rounded-lg border-2 border-dashed"
											style="border-color: var(--text-10);"
										>
											<p class="text-xs" style="color: var(--text-30);">Drop items here</p>
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{:else if viewMode === 'backlog'}
				<!-- Backlog View -->
				<div class="p-4 md:p-6">
					<div class="mx-auto max-w-4xl space-y-4">
						<!-- Active Sprint Section -->
						{#if activeSprint && sprintItems.length > 0}
							<div class="rounded-xl border" style="border-color: var(--text-10); background: var(--color-panel);">
								<div class="flex items-center justify-between border-b px-4 py-3" style="border-color: var(--text-08);">
									<div class="flex items-center gap-2">
										<i class="bx bx-run" style="color: var(--color-accent);"></i>
										<span class="font-medium" style="color: var(--color-text-primary);">{activeSprint.name}</span>
										<span class="rounded-full px-2 py-0.5 text-xs" style="background: var(--color-accent-soft); color: var(--color-accent);">
											Active
										</span>
									</div>
									<span class="text-sm" style="color: var(--text-50);">{sprintItems.length} items</span>
								</div>
								<div class="divide-y" style="border-color: var(--text-05);">
									{#each sprintItems as item (item.id)}
										<div class="flex items-center gap-3 px-4 py-3 transition hover:bg-[var(--button-ghost-bg)]">
											<i class="bx {typeConfig[item.type].icon}" style="color: {typeConfig[item.type].color};"></i>
											<span class="text-xs font-mono" style="color: var(--text-40);">{item.key}</span>
											<span class="flex-1 text-sm" style="color: var(--color-text-primary);">{item.title}</span>
											<div class="h-2 w-2 rounded-full" style="background: {priorityConfig[item.priority].color};"></div>
											<span
												class="rounded px-2 py-0.5 text-xs"
												style="background: {columns.find(c => c.id === item.status)?.color}20; color: {columns.find(c => c.id === item.status)?.color};"
											>
												{columns.find((c) => c.id === item.status)?.label}
											</span>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Backlog Section -->
						<div class="rounded-xl border" style="border-color: var(--text-10); background: var(--color-panel);">
							<div class="flex items-center justify-between border-b px-4 py-3" style="border-color: var(--text-08);">
								<div class="flex items-center gap-2">
									<i class="bx bx-list-ul" style="color: var(--text-50);"></i>
									<span class="font-medium" style="color: var(--color-text-primary);">Backlog</span>
								</div>
								<span class="text-sm" style="color: var(--text-50);">{backlogItems.length} items</span>
							</div>
							{#if backlogItems.length === 0}
								<div class="flex flex-col items-center py-12">
									<i class="bx bx-package text-4xl" style="color: var(--text-20);"></i>
									<p class="mt-2 text-sm" style="color: var(--text-40);">No items in backlog</p>
									<button
										type="button"
										class="mt-3 text-sm font-medium"
										style="color: var(--color-accent);"
										onclick={() => (showCreateItemModal = true)}
									>
										+ Add item
									</button>
								</div>
							{:else}
								<div class="divide-y" style="border-color: var(--text-05);">
									{#each backlogItems as item (item.id)}
										<div class="flex items-center gap-3 px-4 py-3 transition hover:bg-[var(--button-ghost-bg)]">
											<i class="bx {typeConfig[item.type].icon}" style="color: {typeConfig[item.type].color};"></i>
											<span class="text-xs font-mono" style="color: var(--text-40);">{item.key}</span>
											<span class="flex-1 text-sm" style="color: var(--color-text-primary);">{item.title}</span>
											<div class="h-2 w-2 rounded-full" style="background: {priorityConfig[item.priority].color};"></div>
											{#if activeSprint}
												<button
													type="button"
													class="rounded px-2 py-1 text-xs font-medium transition"
													style="background: var(--button-ghost-bg); color: var(--text-50);"
													onclick={() => handleMoveToSprint(item.id, activeSprint.id)}
												>
													Add to Sprint
												</button>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				</div>
			{:else if viewMode === 'sprints'}
				<!-- Sprints View -->
				<div class="p-4 md:p-6">
					<div class="mx-auto max-w-4xl space-y-4">
						<!-- Create Sprint Button -->
						<div class="flex justify-end">
							<button
								type="button"
								class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition hover:opacity-90"
								style="background: var(--color-accent); color: var(--button-primary-text);"
								onclick={() => (showCreateSprintModal = true)}
							>
								<i class="bx bx-plus"></i>
								New Sprint
							</button>
						</div>

						{#if sprints.length === 0}
							<div class="flex flex-col items-center rounded-xl border py-16" style="border-color: var(--text-10); background: var(--color-panel);">
								<div class="flex h-16 w-16 items-center justify-center rounded-2xl" style="background: var(--color-accent-soft);">
									<i class="bx bx-run text-3xl" style="color: var(--color-accent);"></i>
								</div>
								<h3 class="mt-4 text-lg font-semibold" style="color: var(--color-text-primary);">No sprints yet</h3>
								<p class="mt-1 text-sm" style="color: var(--text-50);">Create your first sprint to get started</p>
							</div>
						{:else}
							{#each sprints as sprint (sprint.id)}
								{@const sprintItemCount = items.filter((i) => i.sprintId === sprint.id).length}
								<div class="rounded-xl border" style="border-color: var(--text-10); background: var(--color-panel);">
									<div class="flex items-center justify-between px-4 py-3">
										<div class="flex items-center gap-3">
											<div class="flex h-10 w-10 items-center justify-center rounded-lg" style="background: var(--color-accent-soft);">
												<i class="bx bx-run text-xl" style="color: var(--color-accent);"></i>
											</div>
											<div>
												<div class="flex items-center gap-2">
													<span class="font-medium" style="color: var(--color-text-primary);">{sprint.name}</span>
													{#if sprint.status === 'active'}
														<span class="rounded-full px-2 py-0.5 text-xs" style="background: #22c55e20; color: #22c55e;">Active</span>
													{:else if sprint.status === 'completed'}
														<span class="rounded-full px-2 py-0.5 text-xs" style="background: var(--text-10); color: var(--text-50);">Completed</span>
													{:else}
														<span class="rounded-full px-2 py-0.5 text-xs" style="background: var(--text-10); color: var(--text-50);">Planned</span>
													{/if}
												</div>
												{#if sprint.goal}
													<p class="text-sm" style="color: var(--text-50);">{sprint.goal}</p>
												{/if}
											</div>
										</div>
										<div class="flex items-center gap-3">
											<span class="text-sm" style="color: var(--text-40);">{sprintItemCount} items</span>
											{#if sprint.status === 'planning'}
												<button
													type="button"
													class="rounded-lg px-3 py-1.5 text-sm font-medium transition hover:opacity-90"
													style="background: var(--color-accent); color: var(--button-primary-text);"
													onclick={() => handleStartSprint(sprint.id)}
												>
													Start Sprint
												</button>
											{:else if sprint.status === 'active'}
												<button
													type="button"
													class="rounded-lg px-3 py-1.5 text-sm font-medium transition"
													style="background: var(--button-ghost-bg); color: var(--color-text-primary);"
													onclick={() => handleCompleteSprint(sprint.id)}
												>
													Complete
												</button>
											{/if}
										</div>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</div>
			{/if}
		</main>

		<!-- Settings Panel -->
		{#if showSettingsPanel}
			<aside class="w-80 shrink-0 border-l overflow-y-auto" style="border-color: var(--text-10); background: var(--color-panel);">
				<div class="p-4">
					<div class="flex items-center justify-between mb-4">
						<h2 class="font-semibold" style="color: var(--color-text-primary);">Board Settings</h2>
						<button
							type="button"
							class="rounded-lg p-1.5"
							style="color: var(--text-50);"
							onclick={() => (showSettingsPanel = false)}
							aria-label="Close settings"
						>
							<i class="bx bx-x text-xl"></i>
						</button>
					</div>

					<div class="space-y-4">
						<!-- Board Info -->
						<div class="rounded-lg border p-3" style="border-color: var(--text-08);">
							<h3 class="text-sm font-medium mb-2" style="color: var(--color-text-secondary);">Board Info</h3>
							<div class="space-y-2 text-sm">
								<div class="flex justify-between">
									<span style="color: var(--text-50);">Key</span>
									<span class="font-mono" style="color: var(--color-accent);">{board.key}</span>
								</div>
								<div class="flex justify-between">
									<span style="color: var(--text-50);">Items</span>
									<span style="color: var(--color-text-primary);">{items.length}</span>
								</div>
								<div class="flex justify-between">
									<span style="color: var(--text-50);">Sprints</span>
									<span style="color: var(--color-text-primary);">{sprints.length}</span>
								</div>
								<div class="flex justify-between">
									<span style="color: var(--text-50);">Members</span>
									<span style="color: var(--color-text-primary);">{board.memberIds?.length ?? 1}</span>
								</div>
							</div>
						</div>

						<!-- Coming Soon -->
						<div class="rounded-lg border p-3" style="border-color: var(--text-08);">
							<div class="flex items-center gap-2 mb-2">
								<h3 class="text-sm font-medium" style="color: var(--color-text-secondary);">Integrations</h3>
								<span class="rounded-full px-2 py-0.5 text-xs" style="background: var(--color-warning)20; color: var(--color-warning);">Soon</span>
							</div>
							<p class="text-xs" style="color: var(--text-40);">Connect tickets, notifications, and more.</p>
						</div>

						<!-- Danger Zone -->
						<div class="rounded-lg border p-3" style="border-color: #ef444430;">
							<h3 class="text-sm font-medium mb-2" style="color: var(--color-danger);">Danger Zone</h3>
							<p class="text-xs mb-3" style="color: var(--text-50);">
								Deleting this board will permanently remove all items and data.
							</p>
							<button
								type="button"
								class="w-full rounded-lg py-2 text-sm font-medium transition"
								style="background: #ef444420; color: var(--color-danger);"
								onclick={() => (showDeleteConfirm = true)}
							>
								Delete Board
							</button>
						</div>
					</div>
				</div>
			</aside>
		{/if}
	</div>
{/if}

<!-- Create Item Modal -->
{#if showCreateItemModal}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		style="background: var(--color-app-overlay);"
		onclick={() => (showCreateItemModal = false)}
		onkeydown={(e) => e.key === 'Escape' && (showCreateItemModal = false)}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="w-full max-w-md rounded-xl border shadow-lg"
			style="background: var(--color-panel); border-color: var(--text-10);"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="document"
		>
			<div class="flex items-center justify-between border-b px-5 py-4" style="border-color: var(--text-08);">
				<h2 class="text-lg font-semibold" style="color: var(--color-text-primary);">Create Item</h2>
				<button
					type="button"
					class="rounded-lg p-1.5"
					style="color: var(--text-50);"
					onclick={() => (showCreateItemModal = false)}
					aria-label="Close dialog"
				>
					<i class="bx bx-x text-xl"></i>
				</button>
			</div>

			<form class="p-5" onsubmit={(e) => { e.preventDefault(); handleCreateItem(); }}>
				<div class="space-y-4">
					<!-- Type -->
					<div>
						<span class="mb-1.5 block text-sm font-medium" style="color: var(--color-text-secondary);">Type</span>
						<div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Item type">
							{#each (['task', 'story', 'bug'] as const) as type}
								<button
									type="button"
									class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition"
									style={newItemType === type 
										? `background: ${typeConfig[type].color}20; color: ${typeConfig[type].color}; border: 1px solid ${typeConfig[type].color}40;` 
										: 'background: var(--button-ghost-bg); color: var(--text-50); border: 1px solid transparent;'}
									onclick={() => (newItemType = type)}
									aria-pressed={newItemType === type}
								>
									<i class="bx {typeConfig[type].icon}"></i>
									{typeConfig[type].label}
								</button>
							{/each}
						</div>
					</div>

					<!-- Title -->
					<div>
						<label for="item-title" class="mb-1.5 block text-sm font-medium" style="color: var(--color-text-secondary);">
							Title <span style="color: var(--color-danger);">*</span>
						</label>
						<input
							id="item-title"
							type="text"
							bind:value={newItemTitle}
							placeholder="What needs to be done?"
							class="w-full rounded-lg border px-3 py-2 text-sm outline-none transition focus:border-[var(--color-accent)]"
							style="background: var(--input-bg); border-color: var(--input-border); color: var(--color-text-primary);"
							required
						/>
					</div>

					<!-- Priority -->
					<div>
						<span class="mb-1.5 block text-sm font-medium" style="color: var(--color-text-secondary);">Priority</span>
						<div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Priority level">
							{#each (['low', 'medium', 'high', 'critical'] as const) as priority}
								<button
									type="button"
									class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition"
									style={newItemPriority === priority 
										? `background: ${priorityConfig[priority].color}20; color: ${priorityConfig[priority].color}; border: 1px solid ${priorityConfig[priority].color}40;` 
										: 'background: var(--button-ghost-bg); color: var(--text-50); border: 1px solid transparent;'}
									onclick={() => (newItemPriority = priority)}
									aria-pressed={newItemPriority === priority}
								>
									<div class="h-2 w-2 rounded-full" style="background: {priorityConfig[priority].color};"></div>
									{priorityConfig[priority].label}
								</button>
							{/each}
						</div>
					</div>

					<!-- Description -->
					<div>
						<label for="item-description" class="mb-1.5 block text-sm font-medium" style="color: var(--color-text-secondary);">Description</label>
						<textarea
							id="item-description"
							bind:value={newItemDescription}
							placeholder="Add details..."
							rows="3"
							class="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition focus:border-[var(--color-accent)]"
							style="background: var(--input-bg); border-color: var(--input-border); color: var(--color-text-primary);"
						></textarea>
					</div>
				</div>

				<div class="mt-6 flex justify-end gap-3">
					<button
						type="button"
						class="rounded-lg px-4 py-2 text-sm font-medium"
						style="color: var(--text-60);"
						onclick={() => (showCreateItemModal = false)}
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={creatingItem || !newItemTitle.trim()}
						class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition hover:opacity-90 disabled:opacity-50"
						style="background: var(--color-accent); color: var(--button-primary-text);"
					>
						{#if creatingItem}
							<i class="bx bx-loader-alt animate-spin"></i>
						{/if}
						Create
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Create Sprint Modal -->
{#if showCreateSprintModal}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		style="background: var(--color-app-overlay);"
		onclick={() => (showCreateSprintModal = false)}
		onkeydown={(e) => e.key === 'Escape' && (showCreateSprintModal = false)}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="w-full max-w-md rounded-xl border shadow-lg"
			style="background: var(--color-panel); border-color: var(--text-10);"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="document"
		>
			<div class="flex items-center justify-between border-b px-5 py-4" style="border-color: var(--text-08);">
				<h2 class="text-lg font-semibold" style="color: var(--color-text-primary);">Create Sprint</h2>
				<button
					type="button"
					class="rounded-lg p-1.5"
					style="color: var(--text-50);"
					onclick={() => (showCreateSprintModal = false)}
					aria-label="Close dialog"
				>
					<i class="bx bx-x text-xl"></i>
				</button>
			</div>

			<form class="p-5" onsubmit={(e) => { e.preventDefault(); handleCreateSprint(); }}>
				<div class="space-y-4">
					<div>
						<label for="sprint-name" class="mb-1.5 block text-sm font-medium" style="color: var(--color-text-secondary);">
							Sprint Name <span style="color: var(--color-danger);">*</span>
						</label>
						<input
							id="sprint-name"
							type="text"
							bind:value={newSprintName}
							placeholder="e.g. Sprint 1"
							class="w-full rounded-lg border px-3 py-2 text-sm outline-none transition focus:border-[var(--color-accent)]"
							style="background: var(--input-bg); border-color: var(--input-border); color: var(--color-text-primary);"
							required
						/>
					</div>

					<div>
						<label for="sprint-duration" class="mb-1.5 block text-sm font-medium" style="color: var(--color-text-secondary);">Duration</label>
						<select
							id="sprint-duration"
							bind:value={sprintDuration}
							class="w-full rounded-lg border px-3 py-2 text-sm outline-none"
							style="background: var(--input-bg); border-color: var(--input-border); color: var(--color-text-primary);"
						>
							<option value={1}>1 week</option>
							<option value={2}>2 weeks</option>
							<option value={3}>3 weeks</option>
							<option value={4}>4 weeks</option>
						</select>
					</div>

					<div>
						<label for="sprint-goal" class="mb-1.5 block text-sm font-medium" style="color: var(--color-text-secondary);">Goal</label>
						<textarea
							id="sprint-goal"
							bind:value={newSprintGoal}
							placeholder="What should be achieved?"
							rows="2"
							class="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition focus:border-[var(--color-accent)]"
							style="background: var(--input-bg); border-color: var(--input-border); color: var(--color-text-primary);"
						></textarea>
					</div>
				</div>

				<div class="mt-6 flex justify-end gap-3">
					<button
						type="button"
						class="rounded-lg px-4 py-2 text-sm font-medium"
						style="color: var(--text-60);"
						onclick={() => (showCreateSprintModal = false)}
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={creatingSprint || !newSprintName.trim()}
						class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition hover:opacity-90 disabled:opacity-50"
						style="background: var(--color-accent); color: var(--button-primary-text);"
					>
						{#if creatingSprint}
							<i class="bx bx-loader-alt animate-spin"></i>
						{/if}
						Create Sprint
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Delete Confirmation Modal -->
{#if showDeleteConfirm}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		style="background: var(--color-app-overlay);"
		onclick={() => (showDeleteConfirm = false)}
		onkeydown={(e) => e.key === 'Escape' && (showDeleteConfirm = false)}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="w-full max-w-sm rounded-xl border shadow-lg"
			style="background: var(--color-panel); border-color: var(--text-10);"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="document"
		>
			<div class="p-5 text-center">
				<div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style="background: #ef444420;">
					<i class="bx bx-trash text-2xl" style="color: var(--color-danger);"></i>
				</div>
				<h3 class="mt-4 text-lg font-semibold" style="color: var(--color-text-primary);">
					Delete "{board?.name}"?
				</h3>
				<p class="mt-2 text-sm" style="color: var(--text-50);">
					This will permanently delete all items, sprints, and data.
				</p>
			</div>
			<div class="flex gap-3 border-t p-4" style="border-color: var(--text-08);">
				<button
					type="button"
					class="flex-1 rounded-lg py-2 text-sm font-medium"
					style="background: var(--button-ghost-bg); color: var(--color-text-primary);"
					onclick={() => (showDeleteConfirm = false)}
					disabled={deleting}
				>
					Cancel
				</button>
				<button
					type="button"
					class="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium text-white transition disabled:opacity-50"
					style="background: var(--color-danger);"
					onclick={handleDeleteBoard}
					disabled={deleting}
				>
					{#if deleting}
						<i class="bx bx-loader-alt animate-spin"></i>
					{/if}
					Delete
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
