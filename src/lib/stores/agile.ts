// src/lib/stores/agile.ts
// Agile board state management stores

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type {
	AgileBoard,
	BacklogItem,
	Sprint,
	Epic,
	ItemStatus,
	BoardStats,
	ActivityEntry
} from '$lib/firestore/agile';

// ============================================================================
// STORE TYPES
// ============================================================================

export type AgileViewMode = 'board' | 'backlog' | 'timeline' | 'reports';
export type ItemFilter = {
	types: string[];
	priorities: string[];
	assigneeIds: string[];
	epicIds: string[];
	labels: string[];
	searchQuery: string;
};

export type BoardUIState = {
	viewMode: AgileViewMode;
	selectedItemId: string | null;
	selectedSprintId: string | null;
	draggedItemId: string | null;
	filter: ItemFilter;
	showCompletedItems: boolean;
	swimlanes: 'none' | 'assignee' | 'epic' | 'priority';
	collapsedColumns: string[];
	collapsedEpics: string[];
};

// ============================================================================
// STORES
// ============================================================================

// Current active board
export const currentBoard = writable<AgileBoard | null>(null);

// All boards user has access to
export const userBoards = writable<AgileBoard[]>([]);

// Items for current board
export const boardItems = writable<BacklogItem[]>([]);

// Sprints for current board
export const boardSprints = writable<Sprint[]>([]);

// Epics for current board
export const boardEpics = writable<Epic[]>([]);

// Board statistics
export const boardStats = writable<BoardStats | null>(null);

// Recent activity
export const boardActivity = writable<ActivityEntry[]>([]);

// UI State
const defaultFilter: ItemFilter = {
	types: [],
	priorities: [],
	assigneeIds: [],
	epicIds: [],
	labels: [],
	searchQuery: ''
};

const defaultUIState: BoardUIState = {
	viewMode: 'board',
	selectedItemId: null,
	selectedSprintId: null,
	draggedItemId: null,
	filter: defaultFilter,
	showCompletedItems: false,
	swimlanes: 'none',
	collapsedColumns: [],
	collapsedEpics: []
};

export const boardUI = writable<BoardUIState>(defaultUIState);

// ============================================================================
// DERIVED STORES
// ============================================================================

// Active sprint
export const activeSprint = derived(boardSprints, ($sprints) => {
	return $sprints.find((s) => s.status === 'active') ?? null;
});

// Planning sprints
export const planningSprints = derived(boardSprints, ($sprints) => {
	return $sprints.filter((s) => s.status === 'planning');
});

// Completed sprints
export const completedSprints = derived(boardSprints, ($sprints) => {
	return $sprints.filter((s) => s.status === 'completed');
});

// Backlog items (not in any sprint)
export const backlogItems = derived([boardItems, boardUI], ([$items, $ui]) => {
	let items = $items.filter((i) => !i.sprintId);
	items = applyFilters(items, $ui.filter);
	return items.sort((a, b) => a.backlogOrder - b.backlogOrder);
});

// Sprint items for active sprint
export const activeSprintItems = derived(
	[boardItems, activeSprint, boardUI],
	([$items, $sprint, $ui]) => {
		if (!$sprint) return [];
		let items = $items.filter((i) => i.sprintId === $sprint.id);
		items = applyFilters(items, $ui.filter);
		if (!$ui.showCompletedItems) {
			items = items.filter((i) => i.status !== 'done');
		}
		return items;
	}
);

// Items grouped by status for board view
export const itemsByStatus = derived(
	[activeSprintItems, currentBoard],
	([$items]) => {
		const grouped: Record<ItemStatus, BacklogItem[]> = {
			backlog: [],
			todo: [],
			in_progress: [],
			review: [],
			done: [],
			blocked: []
		};
		
		for (const item of $items) {
			if (grouped[item.status]) {
				grouped[item.status].push(item);
			}
		}
		
		// Sort within each column
		for (const status of Object.keys(grouped) as ItemStatus[]) {
			grouped[status].sort((a, b) => a.boardOrder - b.boardOrder);
		}
		
		return grouped;
	}
);

// Items grouped by swimlane
export const itemsBySwimlane = derived(
	[activeSprintItems, boardUI, boardEpics],
	([$items, $ui, $epics]) => {
		if ($ui.swimlanes === 'none') {
			return { 'all': $items };
		}
		
		const grouped: Record<string, BacklogItem[]> = {};
		
		for (const item of $items) {
			let key: string;
			
			switch ($ui.swimlanes) {
				case 'assignee':
					key = item.assigneeId ?? 'unassigned';
					break;
				case 'epic': {
					const epic = $epics.find((e) => e.id === item.epicId);
					key = epic?.name ?? 'No Epic';
					break;
				}
				case 'priority':
					key = item.priority;
					break;
				default:
					key = 'all';
			}
			
			if (!grouped[key]) grouped[key] = [];
			grouped[key].push(item);
		}
		
		return grouped;
	}
);

// Selected item details
export const selectedItem = derived([boardItems, boardUI], ([$items, $ui]) => {
	if (!$ui.selectedItemId) return null;
	return $items.find((i) => i.id === $ui.selectedItemId) ?? null;
});

// Epic progress map
export const epicProgress = derived([boardItems, boardEpics], ([$items, $epics]) => {
	const progress: Record<string, { total: number; done: number; percent: number }> = {};
	
	for (const epic of $epics) {
		const epicItems = $items.filter((i) => i.epicId === epic.id);
		const done = epicItems.filter((i) => i.status === 'done').length;
		progress[epic.id] = {
			total: epicItems.length,
			done,
			percent: epicItems.length > 0 ? Math.round((done / epicItems.length) * 100) : 0
		};
	}
	
	return progress;
});

// Sprint progress
export const sprintProgress = derived(
	[activeSprintItems],
	([$items]) => {
		const total = $items.length;
		const done = $items.filter((i) => i.status === 'done').length;
		const inProgress = $items.filter((i) => i.status === 'in_progress').length;
		const totalPoints = $items.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
		const donePoints = $items
			.filter((i) => i.status === 'done')
			.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
		
		return {
			total,
			done,
			inProgress,
			percent: total > 0 ? Math.round((done / total) * 100) : 0,
			totalPoints,
			donePoints,
			pointsPercent: totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : 0
		};
	}
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function applyFilters(items: BacklogItem[], filter: ItemFilter): BacklogItem[] {
	return items.filter((item) => {
		// Type filter
		if (filter.types.length > 0 && !filter.types.includes(item.type)) {
			return false;
		}
		
		// Priority filter
		if (filter.priorities.length > 0 && !filter.priorities.includes(item.priority)) {
			return false;
		}
		
		// Assignee filter
		if (filter.assigneeIds.length > 0) {
			if (!item.assigneeId || !filter.assigneeIds.includes(item.assigneeId)) {
				return false;
			}
		}
		
		// Epic filter
		if (filter.epicIds.length > 0) {
			if (!item.epicId || !filter.epicIds.includes(item.epicId)) {
				return false;
			}
		}
		
		// Label filter
		if (filter.labels.length > 0) {
			if (!item.labels.some((l) => filter.labels.includes(l))) {
				return false;
			}
		}
		
		// Search query
		if (filter.searchQuery) {
			const query = filter.searchQuery.toLowerCase();
			const matches =
				item.title.toLowerCase().includes(query) ||
				item.key.toLowerCase().includes(query) ||
				(item.description?.toLowerCase().includes(query) ?? false);
			if (!matches) return false;
		}
		
		return true;
	});
}

// ============================================================================
// STORE ACTIONS
// ============================================================================

export const agileActions = {
	// Reset all stores
	reset() {
		currentBoard.set(null);
		boardItems.set([]);
		boardSprints.set([]);
		boardEpics.set([]);
		boardStats.set(null);
		boardActivity.set([]);
		boardUI.set(defaultUIState);
	},
	
	// Set view mode
	setViewMode(mode: AgileViewMode) {
		boardUI.update((s) => ({ ...s, viewMode: mode }));
	},
	
	// Select item
	selectItem(itemId: string | null) {
		boardUI.update((s) => ({ ...s, selectedItemId: itemId }));
	},
	
	// Toggle completed items visibility
	toggleShowCompleted() {
		boardUI.update((s) => ({ ...s, showCompletedItems: !s.showCompletedItems }));
	},
	
	// Set swimlanes
	setSwimlanes(swimlanes: 'none' | 'assignee' | 'epic' | 'priority') {
		boardUI.update((s) => ({ ...s, swimlanes }));
	},
	
	// Update filter
	setFilter(filter: Partial<ItemFilter>) {
		boardUI.update((s) => ({
			...s,
			filter: { ...s.filter, ...filter }
		}));
	},
	
	// Clear filters
	clearFilters() {
		boardUI.update((s) => ({ ...s, filter: defaultFilter }));
	},
	
	// Set search query
	setSearchQuery(query: string) {
		boardUI.update((s) => ({
			...s,
			filter: { ...s.filter, searchQuery: query }
		}));
	},
	
	// Toggle column collapse
	toggleColumnCollapse(columnId: string) {
		boardUI.update((s) => {
			const collapsed = s.collapsedColumns.includes(columnId)
				? s.collapsedColumns.filter((c) => c !== columnId)
				: [...s.collapsedColumns, columnId];
			return { ...s, collapsedColumns: collapsed };
		});
	},
	
	// Toggle epic collapse
	toggleEpicCollapse(epicId: string) {
		boardUI.update((s) => {
			const collapsed = s.collapsedEpics.includes(epicId)
				? s.collapsedEpics.filter((e) => e !== epicId)
				: [...s.collapsedEpics, epicId];
			return { ...s, collapsedEpics: collapsed };
		});
	},
	
	// Start dragging
	startDrag(itemId: string) {
		boardUI.update((s) => ({ ...s, draggedItemId: itemId }));
	},
	
	// End dragging
	endDrag() {
		boardUI.update((s) => ({ ...s, draggedItemId: null }));
	},
	
	// Select sprint for viewing
	selectSprint(sprintId: string | null) {
		boardUI.update((s) => ({ ...s, selectedSprintId: sprintId }));
	}
};

// ============================================================================
// PERSISTENCE (localStorage)
// ============================================================================

const UI_STORAGE_KEY = 'hconnect_agile_ui';

// Save UI preferences to localStorage
export function saveUIPreferences() {
	if (!browser) return;
	
	const ui = get(boardUI);
	const toSave = {
		swimlanes: ui.swimlanes,
		showCompletedItems: ui.showCompletedItems,
		collapsedColumns: ui.collapsedColumns
	};
	
	try {
		localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(toSave));
	} catch (e) {
		console.warn('[agile] Failed to save UI preferences:', e);
	}
}

// Load UI preferences from localStorage
export function loadUIPreferences() {
	if (!browser) return;
	
	try {
		const saved = localStorage.getItem(UI_STORAGE_KEY);
		if (saved) {
			const parsed = JSON.parse(saved);
			boardUI.update((s) => ({
				...s,
				swimlanes: parsed.swimlanes ?? s.swimlanes,
				showCompletedItems: parsed.showCompletedItems ?? s.showCompletedItems,
				collapsedColumns: parsed.collapsedColumns ?? s.collapsedColumns
			}));
		}
	} catch (e) {
		console.warn('[agile] Failed to load UI preferences:', e);
	}
}
