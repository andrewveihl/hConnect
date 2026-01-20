<script lang="ts">
	import { onMount, onDestroy, getContext } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { user } from '$lib/stores/user';
	import {
		subscribeItems,
		updateItem,
		deleteItem,
		createItem,
		splitItem,
		createUrgentItem,
		isProductOwner,
		isAgileCoach,
		type AgileTeam,
		type BacklogItem,
		type TShirtSize,
		type ClientTag,
		type TShirtMapping
	} from '$lib/firestore/agile';

	const DEFAULT_TSHIRT_MAPPING: TShirtMapping = { XS: 1, S: 2, M: 3, L: 5, XL: 8, XXL: 13 };
	import type { Unsubscribe } from 'firebase/firestore';

	const boardId = $derived($page.params.boardId);
	const boardData = getContext<{ board: AgileTeam | null }>('agile-board');
	const board = $derived(boardData?.board);
	const currentUserId = $derived($user?.uid ?? '');

	const userIsPO = $derived(board ? isProductOwner(board, currentUserId) : false);
	const userIsCoach = $derived(board ? isAgileCoach(board, currentUserId) : false);
	const canEditPriority = $derived(userIsPO);
	const canCreateItems = $derived(userIsPO || userIsCoach);

	let items = $state<BacklogItem[]>([]);
	let loading = $state(true);
	let filterType = $state<'all' | 'story' | 'bug' | 'task'>('all');
	let filterClient = $state<string | null>(null);
	let filterReady = $state<'all' | 'ready' | 'not-ready'>('all');
	let searchQuery = $state('');
	let sortBy = $state<'priority' | 'size' | 'client' | 'created'>('priority');
	let showCreateModal = $state(false);
	let showSplitModal = $state(false);
	let showUrgentModal = $state(false);
	let selectedItem = $state<BacklogItem | null>(null);

	let newItem = $state({
		title: '',
		description: '',
		type: 'story' as 'story' | 'bug' | 'task',
		priority: 'medium' as 'critical' | 'high' | 'medium' | 'low',
		tshirtSize: undefined as TShirtSize | undefined,
		clientTagId: undefined as string | undefined,
		acceptanceCriteria: [] as string[],
		isUrgent: false
	});

	let splitItems = $state<{ title: string; description: string; size: TShirtSize }[]>([
		{ title: '', description: '', size: 'M' }
	]);
	let urgentReason = $state('');
	let draggedItem = $state<BacklogItem | null>(null);
	let unsubItems: Unsubscribe | null = null;

	const tshirtMapping = $derived(board?.settings?.tshirtMapping ?? DEFAULT_TSHIRT_MAPPING);
	const clientTags = $derived<ClientTag[]>(board?.clientTags ?? []);
	const readyChecklist = $derived(board?.settings?.readyChecklist ?? []);

	const backlogItems = $derived.by(() => {
		let filtered = items.filter(i => !i.sprintId && i.status !== 'done');
		if (filterType !== 'all') filtered = filtered.filter(i => i.type === filterType);
		if (filterClient) filtered = filtered.filter(i => i.clientTagId === filterClient);
		if (filterReady === 'ready') filtered = filtered.filter(i => checkItemReady(i));
		else if (filterReady === 'not-ready') filtered = filtered.filter(i => !checkItemReady(i));
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			filtered = filtered.filter(i => i.title.toLowerCase().includes(query) || i.key.toLowerCase().includes(query) || i.description?.toLowerCase().includes(query));
		}
		return filtered.sort((a, b) => {
			switch (sortBy) {
				case 'priority': {
					const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
					const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
					if (pDiff !== 0) return pDiff;
					return (a.backlogOrder || 0) - (b.backlogOrder || 0);
				}
				case 'size': {
					const sizeOrder: Record<TShirtSize, number> = { XS: 0, S: 1, M: 2, L: 3, XL: 4, XXL: 5 };
					return (a.tshirtSize ? sizeOrder[a.tshirtSize] : 6) - (b.tshirtSize ? sizeOrder[b.tshirtSize] : 6);
				}
				case 'client': return (a.clientTagId || 'zzz').localeCompare(b.clientTagId || 'zzz');
				case 'created': return (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);
				default: return 0;
			}
		});
	});

	const totalHours = $derived(backlogItems.reduce((sum, item) => item.tshirtSize ? sum + (tshirtMapping[item.tshirtSize] || 0) : sum, 0));
	const readyCount = $derived(backlogItems.filter(i => checkItemReady(i)).length);
	const urgentItems = $derived(items.filter(i => i.isUrgent && !i.sprintId));

	onMount(() => {
		if (!boardId) return;
		unsubItems = subscribeItems(boardId, (i) => { items = i; loading = false; });
	});
	onDestroy(() => { unsubItems?.(); });

	function checkItemReady(item: BacklogItem): boolean {
		if (!item.title.trim() || !item.tshirtSize || !item.description?.trim()) return false;
		if (readyChecklist.length > 0) {
			const requiredItems = readyChecklist.filter(r => r.required);
			const itemReadyStatus = item.readyChecklist || {};
			return requiredItems.every(r => itemReadyStatus[r.id] === true);
		}
		return true;
	}

	function getPriorityColor(priority: string): string {
		return { critical: '#dc2626', high: '#f97316', medium: '#eab308', low: '#22c55e' }[priority] || '#6b7280';
	}
	function getTypeIcon(type: string): string {
		return { story: 'bx-book-content', bug: 'bx-bug', task: 'bx-check-square', epic: 'bx-bolt' }[type] || 'bx-file';
	}
	function getSizeColor(size: TShirtSize): string {
		const colors: Record<TShirtSize, string> = { XS: '#22c55e', S: '#84cc16', M: '#eab308', L: '#f97316', XL: '#dc2626', XXL: '#991b1b' };
		return colors[size];
	}
	function getClientTag(id: string | null | undefined): ClientTag | undefined {
		return id ? clientTags.find(t => t.id === id) : undefined;
	}

	async function handleCreateItem() {
		if (!board || !$user || !newItem.title.trim() || !canCreateItems || !boardId) return;
		try {
			await createItem(boardId, {
				title: newItem.title,
				description: newItem.description,
				type: newItem.type,
				priority: newItem.priority,
				tshirtSize: newItem.tshirtSize,
				clientTagId: newItem.clientTagId,
				acceptanceCriteria: newItem.acceptanceCriteria,
				reporterId: $user.uid
			});
			resetNewItem(); showCreateModal = false;
		} catch (err) { console.error('Failed to create item:', err); }
	}

	async function handleUrgentCreate() {
		if (!board || !$user || !newItem.title.trim() || !urgentReason.trim() || !boardId) return;
		try {
			await createUrgentItem(boardId, {
				title: newItem.title,
				description: newItem.description,
				type: newItem.type,
				tshirtSize: newItem.tshirtSize,
				clientTagId: newItem.clientTagId,
				reporterId: $user.uid,
				urgentReason
			}, $user.uid);
			resetNewItem(); urgentReason = ''; showUrgentModal = false;
		} catch (err) { console.error('Failed to create urgent item:', err); }
	}

	function resetNewItem() {
		newItem = { title: '', description: '', type: 'story', priority: 'medium', tshirtSize: undefined, clientTagId: undefined, acceptanceCriteria: [], isUrgent: false };
	}

	async function handleUpdatePriority(item: BacklogItem, priority: BacklogItem['priority']) {
		if (!canEditPriority || !boardId) return;
		try { await updateItem(boardId, item.id, { priority }); } catch (err) { console.error('Failed:', err); }
	}
	async function handleUpdateSize(item: BacklogItem, size: TShirtSize | undefined) {
		if (!boardId) return;
		try { await updateItem(boardId, item.id, { tshirtSize: size }); } catch (err) { console.error('Failed:', err); }
	}
	async function handleUpdateClient(item: BacklogItem, clientId: string | undefined) {
		if (!canEditPriority || !boardId) return;
		try { await updateItem(boardId, item.id, { clientTagId: clientId || null }); } catch (err) { console.error('Failed:', err); }
	}
	async function handleDeleteItem(itemId: string) {
		if (!confirm('Delete this item?') || !boardId) return;
		try { await deleteItem(boardId, itemId); } catch (err) { console.error('Failed:', err); }
	}

	function openSplitModal(item: BacklogItem) {
		selectedItem = item;
		splitItems = [{ title: `${item.title} - Part 1`, description: '', size: 'M' }, { title: `${item.title} - Part 2`, description: '', size: 'M' }];
		showSplitModal = true;
	}
	function addSplitItem() { splitItems = [...splitItems, { title: '', description: '', size: 'M' }]; }
	function removeSplitItem(index: number) { if (splitItems.length > 2) splitItems = splitItems.filter((_, i) => i !== index); }

	async function handleSplit() {
		if (!selectedItem || splitItems.some(s => !s.title.trim()) || !boardId) return;
		try {
			await splitItem(boardId, selectedItem.id, splitItems.map((s, i) => ({ title: s.title, description: s.description, tshirtSize: s.size, order: i })), $user?.uid || '');
			showSplitModal = false; selectedItem = null;
		} catch (err) { console.error('Failed:', err); }
	}

	function handleDragStart(e: DragEvent, item: BacklogItem) {
		if (!canEditPriority) return; draggedItem = item;
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}
	async function handleDrop(e: DragEvent, targetItem: BacklogItem) {
		e.preventDefault();
		if (!draggedItem || draggedItem.id === targetItem.id || !canEditPriority || !boardId) return;
		const targetIndex = backlogItems.findIndex(i => i.id === targetItem.id);
		const newOrder = targetIndex > 0 ? backlogItems[targetIndex - 1].backlogOrder || 0 : 0;
		try { await updateItem(boardId, draggedItem.id, { backlogOrder: newOrder + 0.5 }); } catch (err) { console.error('Failed:', err); }
		draggedItem = null;
	}
	function handleDragOver(e: DragEvent) { e.preventDefault(); }
	function addAcceptanceCriteria() { newItem.acceptanceCriteria = [...newItem.acceptanceCriteria, '']; }
	function removeAcceptanceCriteria(index: number) { newItem.acceptanceCriteria = newItem.acceptanceCriteria.filter((_, i) => i !== index); }
</script>

<div class="backlog-page">
	<header class="page-header">
		<button type="button" class="back-btn" onclick={() => goto(`/agile/board/${boardId}`)}><i class="bx bx-arrow-back"></i></button>
		<div class="header-content">
			<h1>Product Backlog</h1>
			<p>{board?.name} • {backlogItems.length} items • {readyCount} ready • ~{totalHours}h estimated</p>
		</div>
		<div class="header-actions">
			{#if userIsPO}<button type="button" class="urgent-btn" onclick={() => showUrgentModal = true}><i class="bx bx-error"></i> Urgent Intake</button>{/if}
			{#if canCreateItems}<button type="button" class="create-btn" onclick={() => showCreateModal = true}><i class="bx bx-plus"></i> Add Item</button>{/if}
		</div>
	</header>

	{#if loading}<div class="loading"><i class="bx bx-loader-alt bx-spin"></i></div>
	{:else}
		<main class="backlog-main">
			{#if urgentItems.length > 0}
				<section class="urgent-alert">
					<i class="bx bx-error-circle"></i>
					<div class="urgent-content"><strong>{urgentItems.length} Urgent {urgentItems.length === 1 ? 'Item' : 'Items'}</strong><span>Awaiting PO prioritization</span></div>
					<button type="button" onclick={() => { filterType = 'all'; searchQuery = ''; }}>View All</button>
				</section>
			{/if}

			<div class="role-bar">
				{#if userIsPO}<span class="role-badge po"><i class="bx bx-crown"></i> Product Owner</span><span class="role-hint">You can prioritize, reorder, and manage client tags</span>
				{:else if userIsCoach}<span class="role-badge coach"><i class="bx bx-shield-quarter"></i> Agile Coach</span><span class="role-hint">You can create items and estimate sizes</span>
				{:else}<span class="role-badge member"><i class="bx bx-user"></i> Team Member</span><span class="role-hint">You can estimate sizes and view the backlog</span>{/if}
			</div>

			<div class="filter-bar">
				<div class="search-box"><i class="bx bx-search"></i><input type="text" placeholder="Search backlog..." bind:value={searchQuery} /></div>
				<div class="filter-group"><label>Type</label><select bind:value={filterType}><option value="all">All Types</option><option value="story">Stories</option><option value="bug">Bugs</option><option value="task">Tasks</option></select></div>
				{#if clientTags.length > 0}<div class="filter-group"><label>Client</label><select bind:value={filterClient}><option value={null}>All Clients</option>{#each clientTags as tag (tag.id)}<option value={tag.id}>{tag.name}</option>{/each}</select></div>{/if}
				<div class="filter-group"><label>Ready</label><select bind:value={filterReady}><option value="all">All</option><option value="ready">Ready</option><option value="not-ready">Not Ready</option></select></div>
				<div class="filter-group"><label>Sort</label><select bind:value={sortBy}><option value="priority">Priority</option><option value="size">Size</option><option value="client">Client</option><option value="created">Created</option></select></div>
			</div>

			{#if backlogItems.length === 0}
				<div class="empty-backlog">
					<i class="bx bx-package"></i><h2>Backlog is empty</h2><p>Add user stories, bugs, and tasks to build your product backlog.</p>
					{#if canCreateItems}<button type="button" onclick={() => showCreateModal = true}><i class="bx bx-plus"></i> Create First Item</button>{/if}
				</div>
			{:else}
				<div class="backlog-list">
					{#each backlogItems as item, index (item.id)}
						{@const clientTag = getClientTag(item.clientTagId)}
						{@const isReady = checkItemReady(item)}
						<div class="backlog-item" class:urgent={item.isUrgent} class:ready={isReady} draggable={canEditPriority ? "true" : "false"} ondragstart={(e) => handleDragStart(e, item)} ondragover={handleDragOver} ondrop={(e) => handleDrop(e, item)}>
							<div class="item-rank">{index + 1}</div>
							<div class="item-type" title={item.type}><i class="bx {getTypeIcon(item.type)}"></i></div>
							<div class="item-content">
								<div class="item-header">
									<span class="item-key">{item.key}</span>
									{#if item.isUrgent}<span class="urgent-tag">URGENT</span>{/if}
									{#if clientTag}<span class="client-tag" style="--tag-color: {clientTag.color}">{clientTag.name}</span>{/if}
									<span class="item-priority" style="background: {getPriorityColor(item.priority)}20; color: {getPriorityColor(item.priority)}">{item.priority}</span>
									{#if isReady}<span class="ready-badge" title="Meets Definition of Ready"><i class="bx bx-check-circle"></i> Ready</span>{/if}
								</div>
								<h3 class="item-title">{item.title}</h3>
								{#if item.description}<p class="item-desc">{item.description}</p>{/if}
						</div>
						<div class="item-meta">
							<div class="size-selector"><label>Size</label><div class="size-buttons">{#each (['XS', 'S', 'M', 'L', 'XL'] as const) as size}<button type="button" class:active={item.tshirtSize === size} style="--size-color: {getSizeColor(size)}" onclick={() => handleUpdateSize(item, size)} title="{size} (~{tshirtMapping[size]}h)">{size}</button>{/each}</div></div>
							{#if canEditPriority}<div class="priority-selector"><label>Priority</label><select value={item.priority} onchange={(e) => handleUpdatePriority(item, e.currentTarget.value as BacklogItem['priority'])}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>{/if}
							{#if canEditPriority && clientTags.length > 0}<div class="client-selector"><label>Client</label><select value={item.clientTagId || ''} onchange={(e) => handleUpdateClient(item, e.currentTarget.value || undefined)}><option value="">None</option>{#each clientTags as tag (tag.id)}<option value={tag.id}>{tag.name}</option>{/each}</select></div>{/if}
						</div>
						<div class="item-actions">
							{#if item.tshirtSize === 'XL' || item.tshirtSize === 'L'}<button type="button" class="action-btn split" onclick={() => openSplitModal(item)} title="Split this item"><i class="bx bx-git-branch"></i></button>{/if}
							<button type="button" class="action-btn" onclick={() => goto(`/agile/board/${boardId}/item/${item.id}`)} title="View details"><i class="bx bx-expand-alt"></i></button>
							{#if canCreateItems}<button type="button" class="action-btn danger" onclick={() => handleDeleteItem(item.id)} title="Delete"><i class="bx bx-trash"></i></button>{/if}
							</div>
							{#if canEditPriority}<div class="drag-handle"><i class="bx bx-grid-vertical"></i></div>{/if}
						</div>
					{/each}
				</div>
			{/if}

			<section class="dor-section">
				<h3><i class="bx bx-check-shield"></i> Definition of Ready</h3>
				{#if readyChecklist.length > 0}
					<p>Items must meet these criteria before being pulled into a sprint:</p>
					<ul>{#each readyChecklist as item (item.id)}<li class:required={item.required}>{item.label}{#if item.required}<span class="required-badge">Required</span>{/if}</li>{/each}</ul>
				{:else}
					<p>Items should meet these criteria before being pulled into a sprint:</p>
					<ul><li>Clear, concise title and description</li><li>T-shirt size estimated</li><li>Acceptance criteria defined</li><li>Small enough to complete in one sprint (M or smaller)</li><li>Dependencies identified</li></ul>
				{/if}
			</section>
		</main>
	{/if}
</div>

{#if showCreateModal}
	<div class="modal-overlay" onclick={() => showCreateModal = false} onkeydown={(e) => e.key === 'Escape' && (showCreateModal = false)} role="dialog" aria-modal="true">
		<div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} role="document">
			<div class="modal-header">
				<h2>Create Backlog Item</h2>
				<button type="button" class="close-btn" onclick={() => showCreateModal = false} aria-label="Close"><i class="bx bx-x"></i></button>
			</div>
			<div class="modal-body">
				<div class="form-row">
					<div class="form-group"><label for="item-type">Type</label><select id="item-type" bind:value={newItem.type}><option value="story">User Story</option><option value="bug">Bug</option><option value="task">Task</option></select></div>
					<div class="form-group"><label for="item-size">T-Shirt Size</label><select id="item-size" bind:value={newItem.tshirtSize}><option value={undefined}>Not estimated</option><option value="XS">XS (~{tshirtMapping.XS}h)</option><option value="S">S (~{tshirtMapping.S}h)</option><option value="M">M (~{tshirtMapping.M}h)</option><option value="L">L (~{tshirtMapping.L}h)</option><option value="XL">XL (~{tshirtMapping.XL}h)</option></select></div>
				</div>
				<div class="form-group"><label for="item-title">Title</label><input type="text" id="item-title" bind:value={newItem.title} placeholder={newItem.type === 'story' ? "As a user, I want to..." : "Short description"} /></div>
				<div class="form-group"><label for="item-desc">Description</label><textarea id="item-desc" bind:value={newItem.description} placeholder="Describe the feature or issue..." rows="3"></textarea></div>
				<div class="form-group">
					<label>Acceptance Criteria</label>
					{#each newItem.acceptanceCriteria as _, i}<div class="ac-row"><span class="ac-prefix">Given/When/Then</span><input type="text" bind:value={newItem.acceptanceCriteria[i]} placeholder="e.g., When I click submit, the form is saved" /><button type="button" class="remove-ac" onclick={() => removeAcceptanceCriteria(i)}><i class="bx bx-x"></i></button></div>{/each}
					<button type="button" class="add-ac-btn" onclick={addAcceptanceCriteria}><i class="bx bx-plus"></i> Add Acceptance Criteria</button>
				</div>
				<div class="form-row">
					<div class="form-group"><label for="item-priority">Priority</label><select id="item-priority" bind:value={newItem.priority}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
					{#if clientTags.length > 0}<div class="form-group"><label for="item-client">Client</label><select id="item-client" bind:value={newItem.clientTagId}><option value={undefined}>No client</option>{#each clientTags as tag (tag.id)}<option value={tag.id}>{tag.name}</option>{/each}</select></div>{/if}
				</div>
			</div>
			<div class="modal-footer"><button type="button" class="cancel-btn" onclick={() => showCreateModal = false}>Cancel</button><button type="button" class="submit-btn" onclick={handleCreateItem} disabled={!newItem.title.trim()}>Create Item</button></div>
		</div>
	</div>
{/if}

{#if showUrgentModal}
	<div class="modal-overlay" onclick={() => showUrgentModal = false} onkeydown={(e) => e.key === 'Escape' && (showUrgentModal = false)} role="dialog" aria-modal="true">
		<div class="modal urgent-modal" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} role="document">
			<div class="modal-header"><h2><i class="bx bx-error"></i> Urgent Intake</h2><button type="button" class="close-btn" onclick={() => showUrgentModal = false} aria-label="Close"><i class="bx bx-x"></i></button></div>
			<div class="modal-body">
				<div class="urgent-warning"><i class="bx bx-info-circle"></i><p>Urgent items bypass normal prioritization and go directly to the top of the backlog for immediate attention. Use sparingly.</p></div>
				<div class="form-group"><label for="urgent-title">Title</label><input type="text" id="urgent-title" bind:value={newItem.title} placeholder="What needs to be done urgently?" /></div>
				<div class="form-group"><label for="urgent-reason">Reason for Urgency</label><textarea id="urgent-reason" bind:value={urgentReason} placeholder="Why is this urgent? What's the business impact?" rows="3"></textarea></div>
				<div class="form-row">
					<div class="form-group"><label for="urgent-type">Type</label><select id="urgent-type" bind:value={newItem.type}><option value="bug">Bug</option><option value="task">Task</option><option value="story">Story</option></select></div>
					<div class="form-group"><label for="urgent-size">Estimated Size</label><select id="urgent-size" bind:value={newItem.tshirtSize}><option value="XS">XS (~{tshirtMapping.XS}h)</option><option value="S">S (~{tshirtMapping.S}h)</option><option value="M">M (~{tshirtMapping.M}h)</option></select></div>
				</div>
				{#if clientTags.length > 0}<div class="form-group"><label for="urgent-client">Client</label><select id="urgent-client" bind:value={newItem.clientTagId}><option value={undefined}>No client</option>{#each clientTags as tag (tag.id)}<option value={tag.id}>{tag.name}</option>{/each}</select></div>{/if}
			</div>
			<div class="modal-footer"><button type="button" class="cancel-btn" onclick={() => showUrgentModal = false}>Cancel</button><button type="button" class="submit-btn urgent" onclick={handleUrgentCreate} disabled={!newItem.title.trim() || !urgentReason.trim()}><i class="bx bx-error"></i> Create Urgent Item</button></div>
		</div>
	</div>
{/if}

{#if showSplitModal && selectedItem}
	<div class="modal-overlay" onclick={() => showSplitModal = false} onkeydown={(e) => e.key === 'Escape' && (showSplitModal = false)} role="dialog" aria-modal="true">
		<div class="modal split-modal" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} role="document">
			<div class="modal-header"><h2><i class="bx bx-git-branch"></i> Split Item</h2><button type="button" class="close-btn" onclick={() => showSplitModal = false} aria-label="Close"><i class="bx bx-x"></i></button></div>
			<div class="modal-body">
				<div class="split-info"><p>Splitting: <strong>{selectedItem.key}</strong> - {selectedItem.title}</p><p class="split-hint">Large items should be split into smaller, deliverable pieces.</p></div>
				<div class="split-items">
					{#each splitItems as _, index}
						<div class="split-item">
							<div class="split-item-header"><span>Part {index + 1}</span>{#if splitItems.length > 2}<button type="button" class="remove-split" onclick={() => removeSplitItem(index)} aria-label="Remove part"><i class="bx bx-x"></i></button>{/if}</div>
							<input type="text" bind:value={splitItems[index].title} placeholder="Title for this part..." />
							<textarea bind:value={splitItems[index].description} placeholder="Description (optional)..." rows="2"></textarea>
							<select bind:value={splitItems[index].size}><option value="XS">XS (~{tshirtMapping.XS}h)</option><option value="S">S (~{tshirtMapping.S}h)</option><option value="M">M (~{tshirtMapping.M}h)</option></select>
						</div>
					{/each}
				</div>
				<button type="button" class="add-split-btn" onclick={addSplitItem}><i class="bx bx-plus"></i> Add Another Part</button>
			</div>
			<div class="modal-footer"><button type="button" class="cancel-btn" onclick={() => showSplitModal = false}>Cancel</button><button type="button" class="submit-btn" onclick={handleSplit} disabled={splitItems.some(s => !s.title.trim())}>Split into {splitItems.length} Items</button></div>
		</div>
	</div>
{/if}

<style>
	.backlog-page { height: 100%; overflow-y: auto; background: var(--color-panel-muted); }
	.page-header { display: flex; align-items: flex-start; gap: 1rem; padding: 1.25rem 1.5rem; background: var(--color-panel); border-bottom: 1px solid var(--text-08); }
	.back-btn { display: flex; align-items: center; justify-content: center; width: 2.25rem; height: 2.25rem; border: none; border-radius: 0.5rem; background: var(--text-06); color: var(--color-text-primary); cursor: pointer; }
	.back-btn:hover { background: var(--text-10); }
	.header-content { flex: 1; }
	.header-content h1 { font-size: 1.25rem; font-weight: 600; color: var(--color-text-primary); margin: 0; }
	.header-content p { font-size: 0.8125rem; color: var(--text-50); margin: 0.125rem 0 0; }
	.header-actions { display: flex; gap: 0.5rem; }
	.create-btn { display: flex; align-items: center; gap: 0.375rem; padding: 0.5rem 0.875rem; background: var(--color-accent); color: white; border: none; border-radius: 0.375rem; font-size: 0.875rem; cursor: pointer; }
	.create-btn:hover { background: var(--color-accent-bright); }
	.urgent-btn { display: flex; align-items: center; gap: 0.375rem; padding: 0.5rem 0.875rem; background: color-mix(in srgb, #dc2626 15%, transparent); color: #dc2626; border: 1px solid #dc2626; border-radius: 0.375rem; font-size: 0.875rem; cursor: pointer; }
	.urgent-btn:hover { background: color-mix(in srgb, #dc2626 25%, transparent); }
	.loading { display: flex; justify-content: center; padding: 4rem; font-size: 2rem; color: var(--text-30); }
	.backlog-main { padding: 1.5rem; }
	.urgent-alert { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; margin-bottom: 1rem; background: color-mix(in srgb, #dc2626 10%, var(--color-panel)); border: 1px solid color-mix(in srgb, #dc2626 30%, transparent); border-radius: 0.5rem; }
	.urgent-alert i { font-size: 1.5rem; color: #dc2626; }
	.urgent-content { flex: 1; }
	.urgent-content strong { display: block; color: #dc2626; font-size: 0.875rem; }
	.urgent-content span { font-size: 0.75rem; color: var(--text-50); }
	.urgent-alert button { padding: 0.375rem 0.75rem; background: #dc2626; border: none; border-radius: 0.25rem; color: white; font-size: 0.75rem; cursor: pointer; }
	.role-bar { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0.75rem; margin-bottom: 1rem; background: var(--color-panel); border: 1px solid var(--text-08); border-radius: 0.375rem; }
	.role-badge { display: flex; align-items: center; gap: 0.375rem; padding: 0.25rem 0.625rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 500; }
	.role-badge.po { background: color-mix(in srgb, #8b5cf6 15%, transparent); color: #8b5cf6; }
	.role-badge.coach { background: color-mix(in srgb, #0ea5e9 15%, transparent); color: #0ea5e9; }
	.role-badge.member { background: color-mix(in srgb, #10b981 15%, transparent); color: #10b981; }
	.role-hint { font-size: 0.75rem; color: var(--text-40); }
	.filter-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; padding: 1rem; margin-bottom: 1rem; background: var(--color-panel); border: 1px solid var(--text-08); border-radius: 0.5rem; }
	.search-box { flex: 1; min-width: 200px; position: relative; }
	.search-box i { position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--text-40); }
	.search-box input { width: 100%; padding: 0.5rem 0.75rem 0.5rem 2.25rem; background: var(--color-bg); border: 1px solid var(--text-12); border-radius: 0.375rem; font-size: 0.875rem; color: var(--color-text-primary); }
	.filter-group { display: flex; flex-direction: column; gap: 0.25rem; }
	.filter-group label { font-size: 0.625rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-40); }
	.filter-group select { padding: 0.375rem 0.5rem; background: var(--color-bg); border: 1px solid var(--text-12); border-radius: 0.25rem; font-size: 0.8125rem; color: var(--color-text-primary); }
	.empty-backlog { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4rem 2rem; background: var(--color-panel); border: 1px solid var(--text-08); border-radius: 0.5rem; text-align: center; }
	.empty-backlog i { font-size: 3rem; color: var(--text-20); margin-bottom: 1rem; }
	.empty-backlog h2 { margin: 0 0 0.5rem; font-size: 1.125rem; color: var(--color-text-primary); }
	.empty-backlog p { margin: 0 0 1.5rem; color: var(--text-50); }
	.empty-backlog button { display: flex; align-items: center; gap: 0.375rem; padding: 0.625rem 1rem; background: var(--color-accent); border: none; border-radius: 0.375rem; color: white; cursor: pointer; }
	.backlog-list { display: flex; flex-direction: column; gap: 0.5rem; }
	.backlog-item { display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.875rem 1rem; background: var(--color-panel); border: 1px solid var(--text-08); border-radius: 0.5rem; transition: border-color 0.1s; }
	.backlog-item:hover { border-color: var(--text-15); }
	.backlog-item.urgent { border-left: 3px solid #dc2626; background: color-mix(in srgb, #dc2626 3%, var(--color-panel)); }
	.backlog-item.ready { border-left: 3px solid #22c55e; }
	.item-rank { min-width: 1.75rem; height: 1.75rem; display: flex; align-items: center; justify-content: center; background: var(--text-06); border-radius: 0.25rem; font-size: 0.75rem; font-weight: 600; color: var(--text-50); }
	.item-type { width: 1.75rem; height: 1.75rem; display: flex; align-items: center; justify-content: center; font-size: 1rem; color: var(--text-50); }
	.item-content { flex: 1; min-width: 0; }
	.item-header { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.25rem; }
	.item-key { font-size: 0.6875rem; font-weight: 600; color: var(--text-40); }
	.urgent-tag { padding: 0.125rem 0.375rem; background: #dc2626; border-radius: 0.25rem; font-size: 0.5625rem; font-weight: 700; color: white; letter-spacing: 0.05em; }
	.client-tag { padding: 0.125rem 0.5rem; background: color-mix(in srgb, var(--tag-color) 20%, transparent); color: var(--tag-color); border-radius: 1rem; font-size: 0.6875rem; font-weight: 500; }
	.item-priority { padding: 0.125rem 0.5rem; border-radius: 0.25rem; font-size: 0.625rem; font-weight: 600; text-transform: uppercase; }
	.ready-badge { display: flex; align-items: center; gap: 0.25rem; padding: 0.125rem 0.375rem; background: color-mix(in srgb, #22c55e 15%, transparent); border-radius: 0.25rem; font-size: 0.625rem; font-weight: 500; color: #22c55e; }
	.item-title { margin: 0; font-size: 0.9375rem; font-weight: 500; color: var(--color-text-primary); }
	.item-desc { margin: 0.25rem 0 0; font-size: 0.8125rem; color: var(--text-50); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
	.item-meta { display: flex; flex-direction: column; gap: 0.5rem; min-width: 140px; }
	.size-selector, .priority-selector, .client-selector { display: flex; flex-direction: column; gap: 0.25rem; }
	.size-selector label, .priority-selector label, .client-selector label { font-size: 0.625rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-40); }
	.size-buttons { display: flex; gap: 0.25rem; }
	.size-buttons button { flex: 1; padding: 0.25rem; background: var(--text-06); border: 1px solid var(--text-12); border-radius: 0.25rem; font-size: 0.625rem; font-weight: 600; color: var(--text-50); cursor: pointer; transition: all 0.1s; }
	.size-buttons button:hover { background: var(--text-10); color: var(--size-color); }
	.size-buttons button.active { background: color-mix(in srgb, var(--size-color) 20%, transparent); border-color: var(--size-color); color: var(--size-color); }
	.priority-selector select, .client-selector select { padding: 0.25rem 0.375rem; background: var(--color-bg); border: 1px solid var(--text-12); border-radius: 0.25rem; font-size: 0.75rem; color: var(--color-text-primary); }
	.item-actions { display: flex; flex-direction: column; gap: 0.25rem; }
	.action-btn { width: 2rem; height: 2rem; display: flex; align-items: center; justify-content: center; background: transparent; border: none; border-radius: 0.25rem; color: var(--text-40); cursor: pointer; }
	.action-btn:hover { background: var(--text-08); color: var(--color-text-primary); }
	.action-btn.danger:hover { background: color-mix(in srgb, #dc2626 15%, transparent); color: #dc2626; }
	.action-btn.split { color: var(--color-accent); }
	.action-btn.split:hover { background: var(--color-accent-muted); }
	.drag-handle { padding: 0.5rem; color: var(--text-30); cursor: grab; }
	.drag-handle:active { cursor: grabbing; }
	.dor-section { margin-top: 2rem; padding: 1.5rem; background: var(--color-panel); border: 1px solid var(--text-08); border-radius: 0.5rem; }
	.dor-section h3 { display: flex; align-items: center; gap: 0.5rem; margin: 0 0 0.5rem; font-size: 1rem; color: var(--color-text-primary); }
	.dor-section p { margin: 0 0 1rem; font-size: 0.875rem; color: var(--text-50); }
	.dor-section ul { margin: 0; padding-left: 1.5rem; }
	.dor-section li { margin-bottom: 0.375rem; font-size: 0.875rem; color: var(--text-70); }
	.dor-section li.required { font-weight: 500; }
	.required-badge { margin-left: 0.5rem; padding: 0.125rem 0.375rem; background: color-mix(in srgb, #f59e0b 15%, transparent); border-radius: 0.25rem; font-size: 0.625rem; font-weight: 600; color: #f59e0b; }
	.modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1rem; }
	.modal { width: 100%; max-width: 560px; max-height: 90vh; background: var(--color-panel); border: 1px solid var(--text-15); border-radius: 0.75rem; overflow: hidden; display: flex; flex-direction: column; }
	.modal.urgent-modal .modal-header { background: color-mix(in srgb, #dc2626 10%, var(--color-panel)); }
	.modal.urgent-modal .modal-header h2 { color: #dc2626; }
	.modal.split-modal { max-width: 640px; }
	.modal-header { display: flex; align-items: center; gap: 0.75rem; padding: 1rem 1.25rem; border-bottom: 1px solid var(--text-08); }
	.modal-header h2 { flex: 1; margin: 0; font-size: 1.125rem; color: var(--color-text-primary); }
	.close-btn { width: 2rem; height: 2rem; display: flex; align-items: center; justify-content: center; background: transparent; border: none; border-radius: 0.25rem; color: var(--text-50); cursor: pointer; }
	.close-btn:hover { background: var(--text-08); }
	.modal-body { flex: 1; overflow-y: auto; padding: 1.25rem; }
	.urgent-warning { display: flex; gap: 0.625rem; padding: 0.75rem; margin-bottom: 1rem; background: color-mix(in srgb, #f59e0b 10%, var(--color-bg)); border: 1px solid color-mix(in srgb, #f59e0b 30%, transparent); border-radius: 0.375rem; }
	.urgent-warning i { font-size: 1.25rem; color: #f59e0b; }
	.urgent-warning p { margin: 0; font-size: 0.8125rem; color: var(--text-60); }
	.form-group { margin-bottom: 1rem; }
	.form-group label { display: block; margin-bottom: 0.375rem; font-size: 0.8125rem; font-weight: 500; color: var(--color-text-primary); }
	.form-group input, .form-group select, .form-group textarea { width: 100%; padding: 0.5rem 0.75rem; background: var(--color-bg); border: 1px solid var(--text-12); border-radius: 0.375rem; font-size: 0.875rem; color: var(--color-text-primary); font-family: inherit; }
	.form-group input:focus, .form-group select:focus, .form-group textarea:focus { outline: none; border-color: var(--color-accent); }
	.form-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }
	.ac-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
	.ac-prefix { font-size: 0.6875rem; font-weight: 600; color: var(--text-40); white-space: nowrap; }
	.ac-row input { flex: 1; }
	.remove-ac { width: 1.75rem; height: 1.75rem; display: flex; align-items: center; justify-content: center; background: transparent; border: none; border-radius: 0.25rem; color: var(--text-40); cursor: pointer; }
	.remove-ac:hover { background: color-mix(in srgb, #dc2626 15%, transparent); color: #dc2626; }
	.add-ac-btn { display: flex; align-items: center; gap: 0.375rem; padding: 0.5rem; background: transparent; border: 1px dashed var(--text-20); border-radius: 0.375rem; width: 100%; font-size: 0.8125rem; color: var(--text-50); cursor: pointer; }
	.add-ac-btn:hover { background: var(--text-04); border-color: var(--text-30); }
	.split-info { padding: 0.75rem 1rem; margin-bottom: 1rem; background: var(--color-bg); border: 1px solid var(--text-08); border-radius: 0.375rem; }
	.split-info p { margin: 0; font-size: 0.875rem; color: var(--color-text-primary); }
	.split-hint { margin-top: 0.375rem !important; font-size: 0.75rem !important; color: var(--text-50) !important; }
	.split-items { display: flex; flex-direction: column; gap: 0.75rem; }
	.split-item { padding: 0.75rem; background: var(--color-bg); border: 1px solid var(--text-08); border-radius: 0.375rem; }
	.split-item-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
	.split-item-header span { font-size: 0.75rem; font-weight: 600; color: var(--text-50); }
	.remove-split { width: 1.5rem; height: 1.5rem; display: flex; align-items: center; justify-content: center; background: transparent; border: none; border-radius: 0.25rem; color: var(--text-40); cursor: pointer; }
	.remove-split:hover { background: color-mix(in srgb, #dc2626 15%, transparent); color: #dc2626; }
	.split-item input, .split-item textarea, .split-item select { width: 100%; padding: 0.5rem; margin-bottom: 0.5rem; background: var(--color-panel); border: 1px solid var(--text-12); border-radius: 0.25rem; font-size: 0.8125rem; color: var(--color-text-primary); font-family: inherit; }
	.split-item select { width: auto; margin-bottom: 0; }
	.add-split-btn { display: flex; align-items: center; justify-content: center; gap: 0.375rem; width: 100%; padding: 0.625rem; margin-top: 0.75rem; background: transparent; border: 1px dashed var(--text-20); border-radius: 0.375rem; font-size: 0.8125rem; color: var(--text-50); cursor: pointer; }
	.add-split-btn:hover { background: var(--text-04); border-color: var(--color-accent); color: var(--color-accent); }
	.modal-footer { display: flex; justify-content: flex-end; gap: 0.75rem; padding: 1rem 1.25rem; border-top: 1px solid var(--text-08); }
	.cancel-btn { padding: 0.5rem 1rem; background: transparent; border: 1px solid var(--text-20); border-radius: 0.375rem; font-size: 0.875rem; color: var(--text-60); cursor: pointer; }
	.cancel-btn:hover { background: var(--text-06); }
	.submit-btn { display: flex; align-items: center; gap: 0.375rem; padding: 0.5rem 1rem; background: var(--color-accent); border: none; border-radius: 0.375rem; font-size: 0.875rem; font-weight: 500; color: white; cursor: pointer; }
	.submit-btn:hover:not(:disabled) { background: var(--color-accent-bright); }
	.submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
	.submit-btn.urgent { background: #dc2626; }
	.submit-btn.urgent:hover:not(:disabled) { background: #b91c1c; }
	@media (max-width: 768px) {
		.page-header { flex-wrap: wrap; }
		.header-actions { width: 100%; margin-top: 0.5rem; }
		.filter-bar { flex-direction: column; align-items: stretch; }
		.search-box { min-width: auto; }
		.filter-group { flex-direction: row; align-items: center; gap: 0.5rem; }
		.filter-group select { flex: 1; }
		.backlog-item { flex-wrap: wrap; }
		.item-meta { width: 100%; flex-direction: row; flex-wrap: wrap; min-width: auto; }
		.form-row { grid-template-columns: 1fr; }
	}
</style>