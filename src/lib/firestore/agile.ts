// src/lib/firestore/agile.ts
// Agile Board/Team Firestore operations
// Aligned with company agile training: POs own intake, Coaches facilitate, Engineers build
// Stored in /agileTeams/{teamId} collection (renamed from boards for clarity)

import { getDb } from '$lib/firebase';
import {
	collection,
	doc,
	getDoc,
	getDocs,
	setDoc,
	updateDoc,
	deleteDoc,
	onSnapshot,
	query,
	where,
	orderBy,
	limit,
	serverTimestamp,
	writeBatch,
	arrayUnion,
	arrayRemove,
	increment,
	type Timestamp,
	type Unsubscribe
} from 'firebase/firestore';

// ============================================================================
// TYPES - Aligned with Company Agile Training
// ============================================================================

export type ItemPriority = 'critical' | 'high' | 'medium' | 'low';
export type ItemType = 'story' | 'bug' | 'task' | 'epic' | 'subtask' | 'spike';
export type ItemStatus = 'backlog' | 'ready' | 'planned' | 'in_progress' | 'review' | 'test' | 'blocked' | 'done';
export type SprintStatus = 'planning' | 'active' | 'completed';

// T-shirt sizes for estimation (default unit per spec)
export type TShirtSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';

// Agile roles per spec: PO, Agile Coach, Team Member
export type AgileRole = 'product_owner' | 'agile_coach' | 'team_member' | 'viewer';

// Team member in a team
export type TeamMember = {
	userId: string;
	role: AgileRole;
	displayName?: string;
	avatarUrl?: string;
	email?: string;
	joinedAt?: Timestamp;
};

// Legacy role type for backward compatibility
export type TeamRole = 'owner' | 'admin' | 'scrum_master' | 'product_owner' | 'developer' | 'designer' | 'qa' | 'viewer';

// Client tag for tracking work by client
export type ClientTag = {
	id: string;
	name: string;
	color: string;
	description?: string;
};

// T-shirt size to numeric weight mapping (configurable per team)
export type TShirtMapping = {
	XS: number;
	S: number;
	M: number;
	L: number;
	XL: number;
	XXL: number;
};

// Ready checklist item (configurable per team)
export type ReadyChecklistItem = {
	id: string;
	label: string;
	required: boolean;
	order: number;
};

// Definition of Done checklist item (configurable per team)
export type DoDChecklistItem = {
	id: string;
	label: string;
	required: boolean;
	order: number;
};

// Story template fields (editable per team)
export type StoryTemplate = {
	titlePrefix?: string;
	problemGoalPrompt: string;
	outcomePrompt: string;
	acceptanceCriteriaPrompt: string;
	notesPrompt: string;
	defaultFields: string[];
};

// Agile Team (formerly AgileBoard - renamed for clarity per spec)
// This is the central entity: "Teams run 1 week sprints"
export type AgileTeam = {
	id: string;
	name: string;
	description?: string | null;
	key: string; // Short prefix like "HCON" for item IDs
	iconEmoji?: string;
	ownerId: string;
	memberIds: string[];
	members: TeamMember[]; // Full member details with roles
	
	// Role assignments per spec
	productOwnerIds: string[]; // Multiple POs allowed
	agileCoachId?: string | null; // One coach per team
	
	// Client tags for this team
	clientTags: ClientTag[];
	
	createdAt?: Timestamp;
	updatedAt?: Timestamp;
	settings: TeamSettings;
	
	// Analytics
	totalItemsCreated?: number;
	totalSprintsCompleted?: number;
	averageVelocity?: number;
};

// Backward compatibility alias
export type AgileBoard = AgileTeam;

// Team settings - aligned with spec requirements
export type TeamSettings = {
	// Sprint settings - "Teams run 1 week sprints"
	sprintDurationDays: number; // Default 7 for 1-week sprints
	sprintStartDay: number; // 0=Sunday, 1=Monday, etc
	sprintEndDay: number;
	autoStartSprints: boolean;
	
	// Estimation - T-shirt sizes by default
	estimationUnit: 'tshirt' | 'points' | 'hours';
	tshirtMapping: TShirtMapping;
	storyPointScale: number[]; // For planning poker
	
	// Board columns (customizable per team)
	columns: BoardColumn[];
	
	// WIP limits per column
	wipLimits: Record<string, number>;
	
	// Swimlanes
	swimlanes: 'none' | 'assignee' | 'epic' | 'priority' | 'client';
	
	// Features
	enableEpics: boolean;
	enableSubtasks: boolean;
	enableTimeTracking: boolean;
	enableUrgentIntake: boolean; // Urgent request path
	enableBlockedNotifications: boolean;
	blockedAgeThresholdDays: number;
	
	// Definition of Done checklist
	dodChecklist: DoDChecklistItem[];
	
	// Ready for Sprint checklist  
	readyChecklist: ReadyChecklistItem[];
	
	// Story template
	storyTemplate: StoryTemplate;
	
	// Team health settings
	healthCheckAnonymous: boolean;
};

// Board column configuration
export type BoardColumn = {
	id: string;
	name: string;
	status: ItemStatus;
	color: string;
	order: number;
};

// Legacy BoardSettings for backward compatibility
export type BoardSettings = TeamSettings;

// Epic - groups of related stories
export type Epic = {
	id: string;
	boardId: string;
	key: string; // e.g., "HCON-E1"
	name: string;
	description?: string | null;
	color: string;
	status: 'active' | 'completed';
	ownerId: string;
	targetDate?: Timestamp | null;
	createdAt?: Timestamp;
	updatedAt?: Timestamp;
	progress: number; // 0-100
};

// Sprint - "Teams run 1 week sprints"
export type Sprint = {
	id: string;
	boardId: string;
	name: string;
	goal?: string | null;
	status: SprintStatus;
	startDate?: Timestamp | null;
	endDate?: Timestamp | null;
	createdAt?: Timestamp;
	completedAt?: Timestamp | null;
	
	// Velocity tracking with T-shirt sizes
	plannedVelocity?: number | null; // Yesterday's weather commitment
	actualVelocity?: number | null; // Completed points
	velocity?: number | null; // Legacy alias for actualVelocity
	
	itemIds: string[];
	
	// Progress tracking
	totalItems?: number;
	completedItems?: number;
	totalPoints?: number;
	completedPoints?: number;
	
	// Capacity planning
	teamCapacity?: number; // Available capacity in points
	
	// Retrospective link
	retroId?: string | null;
};

// Backlog Item (Story, Bug, Task, etc.) - Enhanced per spec
export type BacklogItem = {
	id: string;
	boardId: string;
	key: string; // e.g., "HCON-123"
	type: ItemType;
	title: string;
	description?: string | null;
	status: ItemStatus;
	priority: ItemPriority;
	
	// Story template fields per spec
	problemGoal?: string | null;      // "Problem or goal"
	outcome?: string | null;          // "Outcome statement"
	acceptanceCriteria?: string[];    // List of acceptance criteria
	testNotes?: string | null;        // Test notes field
	designNotes?: string | null;      // Design/UX notes
	notes?: string | null;            // General notes and links
	
	// Assignment
	reporterId: string;               // Created by (usually PO)
	assigneeId?: string | null;       // Assigned to
	ownerPoId?: string | null;        // Owner PO per spec
	assignedCoachId?: string | null;  // Assigned Agile Coach per spec
	
	// Client tagging per spec
	clientTagId?: string | null;
	
	// Hierarchy
	epicId?: string | null;
	parentId?: string | null; // For subtasks
	subtaskIds?: string[];
	childItemIds?: string[];  // For split stories
	splitFromId?: string | null; // If this was split from another item
	
	// Sprint & Backlog
	sprintId?: string | null;
	backlogOrder: number;
	boardOrder: number;
	
	// T-shirt sizing (default) per spec
	tshirtSize?: TShirtSize | null;
	storyPoints?: number | null; // Calculated from T-shirt or manual
	
	// Time tracking (optional)
	originalEstimateHours?: number | null;
	timeSpentHours?: number | null;
	remainingEstimateHours?: number | null;
	
	// Dates
	createdAt?: Timestamp;
	updatedAt?: Timestamp;
	dueDate?: Timestamp | null;
	resolvedAt?: Timestamp | null;
	
	// Blocked handling per spec
	blockedAt?: Timestamp | null;
	blockedReason?: string | null;
	blockedOwnerId?: string | null; // Who is responsible for unblocking
	
	// Ready checklist status (per team config)
	readyChecklist?: Record<string, boolean>;
	
	// DoD checklist status
	dodChecklist?: Record<string, boolean>;
	
	// Urgent flag per spec
	isUrgent?: boolean;
	urgentReason?: string | null;
	urgentApprovedBy?: string | null; // PO who approved urgent
	
	// Dependencies per spec
	dependencies?: string[]; // Item IDs this depends on
	
	// Labels & Custom
	labels: string[];
	customFields?: Record<string, unknown>;
	
	// Attachments (URLs)
	attachments?: string[];
	
	// Comments stored in subcollection
	commentCount: number;
	
	// Future: Link to ticket
	linkedTicketId?: string | null;
	linkedServerId?: string | null;
};

// Comment on item
export type ItemComment = {
	id: string;
	itemId: string;
	authorId: string;
	content: string;
	createdAt?: Timestamp;
	updatedAt?: Timestamp;
	edited: boolean;
	// Comment type for structured feedback
	commentType?: 'general' | 'test_note' | 'acceptance_suggestion' | 'blocker_update';
};

// Activity log entry
export type ActivityEntry = {
	id: string;
	boardId: string;
	itemId?: string | null;
	sprintId?: string | null;
	userId: string;
	action: string;
	details?: Record<string, unknown>;
	createdAt?: Timestamp;
};

// Retrospective per spec - "Include a retro tool per sprint"
export type Retrospective = {
	id: string;
	boardId: string;
	sprintId: string;
	sprintName: string;
	createdAt?: Timestamp;
	completedAt?: Timestamp | null;
	
	// Retro categories per spec
	wentWell: RetroItem[];
	didNotGoWell: RetroItem[];
	
	// Actions with owners and due dates per spec
	actions: RetroAction[];
	
	// Team health check per spec (8 dimensions)
	healthCheck?: TeamHealthCheck;
};

export type RetroItem = {
	id: string;
	text: string;
	authorId: string;
	votes: number;
	voterIds: string[];
	createdAt?: Timestamp;
};

export type RetroAction = {
	id: string;
	text: string;
	ownerId: string;
	dueDate?: Timestamp | null;
	status: 'pending' | 'in_progress' | 'completed';
	completedAt?: Timestamp | null;
	createdAt?: Timestamp;
};

// Team Health Check per spec - "Sprint health check aligned to these dimensions"
export type TeamHealthCheck = {
	id: string;
	sprintId: string;
	boardId: string;
	responses: TeamHealthResponse[];
	aggregated?: TeamHealthAggregated;
	createdAt?: Timestamp;
};

export type TeamHealthResponse = {
	userId?: string; // Optional for anonymous
	anonymous: boolean;
	ratings: {
		teamwork: number; // 1-5
		pawnsOrPlayers: number;
		mission: number;
		codebaseHealth: number;
		speed: number;
		deliveringValue: number;
		suitableProcess: number;
		fun: number;
	};
	comments?: Record<string, string>;
	submittedAt?: Timestamp;
};

export type TeamHealthAggregated = {
	teamwork: { avg: number; trend: 'up' | 'down' | 'stable' };
	pawnsOrPlayers: { avg: number; trend: 'up' | 'down' | 'stable' };
	mission: { avg: number; trend: 'up' | 'down' | 'stable' };
	codebaseHealth: { avg: number; trend: 'up' | 'down' | 'stable' };
	speed: { avg: number; trend: 'up' | 'down' | 'stable' };
	deliveringValue: { avg: number; trend: 'up' | 'down' | 'stable' };
	suitableProcess: { avg: number; trend: 'up' | 'down' | 'stable' };
	fun: { avg: number; trend: 'up' | 'down' | 'stable' };
	overallHealth: number;
	responseCount: number;
};

// ============================================================================
// BOARD OPERATIONS
// ============================================================================

// Default columns per spec: Backlog, Ready, Planned for Sprint, In Progress, Review, Test, Blocked, Done
const DEFAULT_COLUMNS: BoardColumn[] = [
	{ id: 'backlog', name: 'Backlog', status: 'backlog', color: '#6b7280', order: 0 },
	{ id: 'ready', name: 'Ready', status: 'ready', color: '#0ea5e9', order: 1 },
	{ id: 'planned', name: 'Planned for Sprint', status: 'planned', color: '#3b82f6', order: 2 },
	{ id: 'in_progress', name: 'In Progress', status: 'in_progress', color: '#f59e0b', order: 3 },
	{ id: 'review', name: 'Review', status: 'review', color: '#8b5cf6', order: 4 },
	{ id: 'test', name: 'Test', status: 'test', color: '#ec4899', order: 5 },
	{ id: 'blocked', name: 'Blocked', status: 'blocked', color: '#ef4444', order: 6 },
	{ id: 'done', name: 'Done', status: 'done', color: '#10b981', order: 7 }
];

// Default T-shirt mapping to numeric weights
const DEFAULT_TSHIRT_MAPPING: TShirtMapping = {
	XS: 1,
	S: 2,
	M: 3,
	L: 5,
	XL: 8,
	XXL: 13
};

// Default Ready checklist per spec
const DEFAULT_READY_CHECKLIST: ReadyChecklistItem[] = [
	{ id: 'ac', label: 'Acceptance criteria present', required: true, order: 0 },
	{ id: 'deps', label: 'Dependencies noted', required: true, order: 1 },
	{ id: 'test', label: 'Test notes added', required: false, order: 2 },
	{ id: 'design', label: 'Design/UX notes (if needed)', required: false, order: 3 },
	{ id: 'sized', label: 'Item is sized (T-shirt)', required: true, order: 4 }
];

// Default DoD checklist per spec
const DEFAULT_DOD_CHECKLIST: DoDChecklistItem[] = [
	{ id: 'coded', label: 'Code complete and reviewed', required: true, order: 0 },
	{ id: 'tested', label: 'Tested (unit/integration)', required: true, order: 1 },
	{ id: 'ac_met', label: 'Acceptance criteria met', required: true, order: 2 },
	{ id: 'no_bugs', label: 'No known bugs', required: true, order: 3 },
	{ id: 'documented', label: 'Documentation updated', required: false, order: 4 },
	{ id: 'deployed', label: 'Deployed to staging', required: false, order: 5 }
];

// Default story template per spec
const DEFAULT_STORY_TEMPLATE: StoryTemplate = {
	problemGoalPrompt: 'What problem are we solving or goal are we achieving?',
	outcomePrompt: 'What is the desired outcome?',
	acceptanceCriteriaPrompt: 'How will we know this is done? List specific criteria.',
	notesPrompt: 'Additional notes, links, or context',
	defaultFields: ['title', 'clientTag', 'problemGoal', 'outcome', 'acceptanceCriteria', 'notes', 'tshirtSize', 'priority']
};

// Default team settings - "Teams run 1 week sprints"
const DEFAULT_SETTINGS: TeamSettings = {
	sprintDurationDays: 7, // 1 week sprints per spec
	sprintStartDay: 1, // Monday
	sprintEndDay: 5, // Friday
	autoStartSprints: false,
	
	estimationUnit: 'tshirt',
	tshirtMapping: DEFAULT_TSHIRT_MAPPING,
	storyPointScale: [1, 2, 3, 5, 8, 13, 21],
	
	columns: DEFAULT_COLUMNS,
	wipLimits: {},
	swimlanes: 'none',
	
	enableEpics: true,
	enableSubtasks: true,
	enableTimeTracking: false,
	enableUrgentIntake: true,
	enableBlockedNotifications: true,
	blockedAgeThresholdDays: 2,
	
	dodChecklist: DEFAULT_DOD_CHECKLIST,
	readyChecklist: DEFAULT_READY_CHECKLIST,
	storyTemplate: DEFAULT_STORY_TEMPLATE,
	
	healthCheckAnonymous: true
};

// ============================================================================
// PERMISSIONS - Per spec role-based access
// ============================================================================

export type Permission = 
	| 'create_item'      // Create work items
	| 'edit_priority'    // Edit priority (PO only)
	| 'edit_client_tag'  // Edit client tag (PO only)
	| 'edit_story'       // Edit story fields
	| 'edit_acceptance'  // Add/edit acceptance criteria
	| 'move_to_planned'  // Move items to Planned for Sprint
	| 'move_workflow'    // Move items across workflow states (Coach)
	| 'manage_wip'       // Manage WIP limits and columns (Coach)
	| 'facilitate'       // Facilitate sprints, standup, retro, reporting (Coach)
	| 'move_in_progress' // Move items from In Progress onward (Engineer)
	| 'add_comments'     // Add comments, test notes
	| 'mark_blocked'     // Mark blocked with reason
	| 'complete_items'   // Complete items when DoD is met
	| 'view_board'       // View board
	| 'view_reports';    // View analytics/reports

// Get user's role in a team
export function getUserRole(team: AgileTeam, userId: string): AgileRole | null {
	const member = team.members?.find(m => m.userId === userId);
	return member?.role ?? null;
}

// Check if user is a Product Owner
export function isProductOwner(team: AgileTeam, userId: string): boolean {
	return team.productOwnerIds?.includes(userId) ?? false;
}

// Check if user is the Agile Coach
export function isAgileCoach(team: AgileTeam, userId: string): boolean {
	return team.agileCoachId === userId;
}

// Check if user is a team member
export function isTeamMember(team: AgileTeam, userId: string): boolean {
	return team.memberIds?.includes(userId) ?? false;
}

// Get permissions for a role
export function getPermissionsForRole(role: AgileRole): Permission[] {
	switch (role) {
		case 'product_owner':
			return [
				'create_item',
				'edit_priority',
				'edit_client_tag',
				'edit_story',
				'edit_acceptance',
				'move_to_planned',
				'add_comments',
				'view_board',
				'view_reports'
			];
		case 'agile_coach':
			return [
				'move_workflow',
				'manage_wip',
				'facilitate',
				'edit_story',
				'edit_acceptance',
				'add_comments',
				'mark_blocked',
				'view_board',
				'view_reports'
			];
		case 'team_member':
			return [
				'move_in_progress',
				'add_comments',
				'mark_blocked',
				'complete_items',
				'edit_acceptance', // Can suggest acceptance criteria
				'view_board',
				'view_reports'
			];
		case 'viewer':
			return ['view_board', 'view_reports', 'add_comments'];
		default:
			return ['view_board'];
	}
}

// Check if user has a specific permission
export function hasPermission(team: AgileTeam, userId: string, permission: Permission): boolean {
	// Owner has all permissions
	if (team.ownerId === userId) return true;
	
	const role = getUserRole(team, userId);
	if (!role) return false;
	
	// POs and Coaches may have overlapping permissions for practical use
	if (isProductOwner(team, userId) && getPermissionsForRole('product_owner').includes(permission)) {
		return true;
	}
	if (isAgileCoach(team, userId) && getPermissionsForRole('agile_coach').includes(permission)) {
		return true;
	}
	
	return getPermissionsForRole(role).includes(permission);
}

// Convert T-shirt size to points using team mapping
export function tshirtToPoints(size: TShirtSize | null, mapping: TShirtMapping): number {
	if (!size) return 0;
	return mapping[size] ?? 0;
}

// ============================================================================
// COLLECTION REFERENCES
// ============================================================================

export function boardsCol() {
	return collection(getDb(), 'agileBoards');
}

export function boardDoc(boardId: string) {
	return doc(getDb(), 'agileBoards', boardId);
}

export function itemsCol(boardId: string) {
	return collection(getDb(), 'agileBoards', boardId, 'items');
}

export function itemDoc(boardId: string, itemId: string) {
	return doc(getDb(), 'agileBoards', boardId, 'items', itemId);
}

export function sprintsCol(boardId: string) {
	return collection(getDb(), 'agileBoards', boardId, 'sprints');
}

export function sprintDoc(boardId: string, sprintId: string) {
	return doc(getDb(), 'agileBoards', boardId, 'sprints', sprintId);
}

export function epicsCol(boardId: string) {
	return collection(getDb(), 'agileBoards', boardId, 'epics');
}

export function epicDoc(boardId: string, epicId: string) {
	return doc(getDb(), 'agileBoards', boardId, 'epics', epicId);
}

export function commentsCol(boardId: string, itemId: string) {
	return collection(getDb(), 'agileBoards', boardId, 'items', itemId, 'comments');
}

export function activityCol(boardId: string) {
	return collection(getDb(), 'agileBoards', boardId, 'activity');
}

export function retrosCol(boardId: string) {
	return collection(getDb(), 'agileBoards', boardId, 'retros');
}

export function retroDoc(boardId: string, retroId: string) {
	return doc(getDb(), 'agileBoards', boardId, 'retros', retroId);
}

export function healthChecksCol(boardId: string) {
	return collection(getDb(), 'agileBoards', boardId, 'healthChecks');
}

// Create a new team/board
export async function createBoard(data: {
	name: string;
	description?: string;
	key?: string;
	iconEmoji?: string;
	ownerId: string;
	settings?: Partial<TeamSettings>;
}): Promise<string> {
	const db = getDb();
	const ref = doc(collection(db, 'agileBoards'));
	
	// Auto-generate key from name if not provided
	const key = data.key?.toUpperCase() || data.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'TEAM';
	
	const team: Omit<AgileTeam, 'id'> = {
		name: data.name,
		description: data.description ?? null,
		key,
		iconEmoji: data.iconEmoji ?? '👥',
		ownerId: data.ownerId,
		memberIds: [data.ownerId],
		members: [{
			userId: data.ownerId,
			role: 'product_owner', // Creator becomes PO by default
			joinedAt: serverTimestamp() as unknown as Timestamp
		}],
		productOwnerIds: [data.ownerId],
		agileCoachId: null,
		clientTags: [],
		createdAt: serverTimestamp() as unknown as Timestamp,
		updatedAt: serverTimestamp() as unknown as Timestamp,
		settings: { ...DEFAULT_SETTINGS, ...data.settings }
	};
	await setDoc(ref, team);
	
	// Log activity
	await logActivity(ref.id, data.ownerId, 'team_created', { name: data.name });
	
	return ref.id;
}

// Get a board by ID
export async function getBoard(boardId: string): Promise<AgileBoard | null> {
	const snap = await getDoc(boardDoc(boardId));
	if (!snap.exists()) return null;
	return { id: snap.id, ...snap.data() } as AgileBoard;
}

// Update board
export async function updateBoard(boardId: string, data: Partial<AgileBoard>): Promise<void> {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { id: _id, ...updateData } = data;
	await updateDoc(boardDoc(boardId), {
		...updateData,
		updatedAt: serverTimestamp()
	});
}

// Delete board and all sub-collections
export async function deleteBoard(boardId: string): Promise<void> {
	const batch = writeBatch(getDb());
	
	// Delete items
	const itemsSnap = await getDocs(itemsCol(boardId));
	itemsSnap.forEach((d) => batch.delete(d.ref));
	
	// Delete sprints
	const sprintsSnap = await getDocs(sprintsCol(boardId));
	sprintsSnap.forEach((d) => batch.delete(d.ref));
	
	// Delete epics
	const epicsSnap = await getDocs(epicsCol(boardId));
	epicsSnap.forEach((d) => batch.delete(d.ref));
	
	// Delete board
	batch.delete(boardDoc(boardId));
	
	await batch.commit();
}

// Subscribe to user's boards
export function subscribeUserBoards(
	userId: string,
	cb: (boards: AgileBoard[]) => void
): Unsubscribe {
	const q = query(
		boardsCol(),
		where('memberIds', 'array-contains', userId),
		orderBy('updatedAt', 'desc')
	);
	return onSnapshot(q, (snap) => {
		const boards = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AgileBoard);
		cb(boards);
	}, (err) => {
		console.error('[agile] Error subscribing to boards:', err);
		cb([]);
	});
}

// Subscribe to a specific board
export function subscribeBoard(
	boardId: string,
	cb: (board: AgileBoard | null) => void
): Unsubscribe {
	return onSnapshot(boardDoc(boardId), (snap) => {
		if (!snap.exists()) {
			cb(null);
			return;
		}
		cb({ id: snap.id, ...snap.data() } as AgileBoard);
	});
}

// Add/remove board members
export async function addBoardMember(boardId: string, userId: string): Promise<void> {
	await updateDoc(boardDoc(boardId), {
		memberIds: arrayUnion(userId),
		updatedAt: serverTimestamp()
	});
}

export async function removeBoardMember(boardId: string, userId: string): Promise<void> {
	await updateDoc(boardDoc(boardId), {
		memberIds: arrayRemove(userId),
		updatedAt: serverTimestamp()
	});
}

// ============================================================================
// ITEM OPERATIONS - "Only POs can create work items" per spec
// ============================================================================

// Get next item number for a board
async function getNextItemNumber(boardId: string): Promise<number> {
	const counterRef = doc(getDb(), 'agileBoards', boardId, 'meta', 'counter');
	const snap = await getDoc(counterRef);
	const current = snap.exists() ? (snap.data()?.itemNumber ?? 0) : 0;
	const next = current + 1;
	await setDoc(counterRef, { itemNumber: next }, { merge: true });
	return next;
}

// Create a new item - Enhanced for spec requirements
export async function createItem(
	boardId: string,
	data: {
		type: ItemType;
		title: string;
		description?: string;
		priority?: ItemPriority;
		reporterId: string;
		assigneeId?: string;
		ownerPoId?: string;
		assignedCoachId?: string;
		epicId?: string;
		parentId?: string;
		sprintId?: string;
		splitFromId?: string;
		
		// Story template fields per spec
		problemGoal?: string;
		outcome?: string;
		acceptanceCriteria?: string[];
		testNotes?: string;
		designNotes?: string;
		notes?: string;
		
		// T-shirt sizing per spec
		tshirtSize?: TShirtSize;
		storyPoints?: number;
		
		// Client tag per spec
		clientTagId?: string;
		
		// Urgent intake per spec
		isUrgent?: boolean;
		urgentReason?: string;
		urgentApprovedBy?: string;
		
		// Dependencies per spec
		dependencies?: string[];
		
		labels?: string[];
		dueDate?: Date;
	}
): Promise<string> {
	const board = await getBoard(boardId);
	if (!board) throw new Error('Board not found');
	
	const itemNum = await getNextItemNumber(boardId);
	const key = `${board.key}-${itemNum}`;
	
	const ref = doc(itemsCol(boardId));
	
	// Get max backlog order
	const allItems = await getDocs(itemsCol(boardId));
	let maxOrder = 0;
	allItems.docs.forEach(d => {
		const order = d.data().backlogOrder ?? 0;
		if (order > maxOrder) maxOrder = order;
	});
	
	// Calculate story points from T-shirt if using that system
	let storyPoints = data.storyPoints ?? null;
	if (!storyPoints && data.tshirtSize && board.settings?.tshirtMapping) {
		storyPoints = tshirtToPoints(data.tshirtSize, board.settings.tshirtMapping);
	}
	
	// Initialize ready checklist from team config
	const readyChecklist: Record<string, boolean> = {};
	(board.settings?.readyChecklist || []).forEach(item => {
		readyChecklist[item.id] = false;
	});
	
	// Initialize DoD checklist from team config
	const dodChecklist: Record<string, boolean> = {};
	(board.settings?.dodChecklist || []).forEach(item => {
		dodChecklist[item.id] = false;
	});
	
	const item: Omit<BacklogItem, 'id'> = {
		boardId,
		key,
		type: data.type,
		title: data.title,
		description: data.description ?? null,
		status: data.sprintId ? 'planned' : 'backlog',
		priority: data.priority ?? 'medium',
		
		// Story template fields
		problemGoal: data.problemGoal ?? null,
		outcome: data.outcome ?? null,
		acceptanceCriteria: data.acceptanceCriteria ?? [],
		testNotes: data.testNotes ?? null,
		designNotes: data.designNotes ?? null,
		notes: data.notes ?? null,
		
		// Assignment
		reporterId: data.reporterId,
		assigneeId: data.assigneeId ?? null,
		ownerPoId: data.ownerPoId ?? data.reporterId, // Default to reporter
		assignedCoachId: data.assignedCoachId ?? board.agileCoachId ?? null,
		
		// Client tag
		clientTagId: data.clientTagId ?? null,
		
		// Hierarchy
		epicId: data.epicId ?? null,
		parentId: data.parentId ?? null,
		subtaskIds: [],
		childItemIds: [],
		splitFromId: data.splitFromId ?? null,
		
		// Sprint & Backlog
		sprintId: data.sprintId ?? null,
		backlogOrder: data.isUrgent ? 0 : maxOrder + 1, // Urgent items go to top
		boardOrder: 0,
		
		// Sizing
		tshirtSize: data.tshirtSize ?? null,
		storyPoints,
		
		// Ready/DoD checklists
		readyChecklist,
		dodChecklist,
		
		// Urgent handling
		isUrgent: data.isUrgent ?? false,
		urgentReason: data.urgentReason ?? null,
		urgentApprovedBy: data.urgentApprovedBy ?? null,
		
		// Dependencies
		dependencies: data.dependencies ?? [],
		
		// Labels
		labels: data.labels ?? [],
		commentCount: 0,
		
		// Dates
		createdAt: serverTimestamp() as unknown as Timestamp,
		updatedAt: serverTimestamp() as unknown as Timestamp,
		dueDate: data.dueDate ? (data.dueDate as unknown as Timestamp) : null
	};
	
	await setDoc(ref, item);
	
	// If parent, add to parent's subtaskIds
	if (data.parentId) {
		await updateDoc(itemDoc(boardId, data.parentId), {
			subtaskIds: arrayUnion(ref.id)
		});
	}
	
	// If split from another item, add to parent's childItemIds
	if (data.splitFromId) {
		await updateDoc(itemDoc(boardId, data.splitFromId), {
			childItemIds: arrayUnion(ref.id)
		});
	}
	
	// If sprint, add to sprint's itemIds
	if (data.sprintId) {
		await updateDoc(sprintDoc(boardId, data.sprintId), {
			itemIds: arrayUnion(ref.id)
		});
	}
	
	// Log activity
	await logActivity(boardId, data.reporterId, 'item_created', {
		itemId: ref.id,
		key,
		type: data.type,
		title: data.title
	});
	
	return ref.id;
}

// Get an item
export async function getItem(boardId: string, itemId: string): Promise<BacklogItem | null> {
	const snap = await getDoc(itemDoc(boardId, itemId));
	if (!snap.exists()) return null;
	return { id: snap.id, ...snap.data() } as BacklogItem;
}

// Update an item
export async function updateItem(
	boardId: string,
	itemId: string,
	data: Partial<BacklogItem>,
	userId?: string
): Promise<void> {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { id: _id, ...updateData } = data;
	
	// Check for status change to log
	const oldItem = await getItem(boardId, itemId);
	const statusChanged = oldItem && data.status && oldItem.status !== data.status;
	const assigneeChanged = oldItem && data.assigneeId !== undefined && oldItem.assigneeId !== data.assigneeId;
	
	await updateDoc(itemDoc(boardId, itemId), {
		...updateData,
		updatedAt: serverTimestamp(),
		...(data.status === 'done' && !oldItem?.resolvedAt ? { resolvedAt: serverTimestamp() } : {})
	});
	
	// Log activity
	if (userId) {
		if (statusChanged) {
			await logActivity(boardId, userId, 'status_changed', {
				itemId,
				key: oldItem?.key,
				from: oldItem?.status,
				to: data.status
			});
		}
		if (assigneeChanged) {
			await logActivity(boardId, userId, 'assignee_changed', {
				itemId,
				key: oldItem?.key,
				assigneeId: data.assigneeId
			});
		}
	}
}

// Delete an item
export async function deleteItem(boardId: string, itemId: string): Promise<void> {
	const item = await getItem(boardId, itemId);
	if (!item) return;
	
	const db = getDb();
	const batch = writeBatch(db);
	
	// Remove from parent's subtaskIds
	if (item.parentId) {
		batch.update(itemDoc(boardId, item.parentId), {
			subtaskIds: arrayRemove(itemId)
		});
	}
	
	// Remove from sprint's itemIds
	if (item.sprintId) {
		batch.update(sprintDoc(boardId, item.sprintId), {
			itemIds: arrayRemove(itemId)
		});
	}
	
	// Delete subtasks
	for (const subtaskId of item.subtaskIds ?? []) {
		batch.delete(itemDoc(boardId, subtaskId));
	}
	
	// Delete item
	batch.delete(itemDoc(boardId, itemId));
	
	await batch.commit();
}

// Subscribe to all items in a board
export function subscribeItems(
	boardId: string,
	cb: (items: BacklogItem[]) => void
): Unsubscribe {
	const q = query(itemsCol(boardId), orderBy('backlogOrder', 'asc'));
	return onSnapshot(q, (snap) => {
		const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BacklogItem);
		cb(items);
	}, (err) => {
		console.error('[agile] Error subscribing to items:', err);
		cb([]);
	});
}

// Subscribe to backlog items (not in any sprint)
export function subscribeBacklog(
	boardId: string,
	cb: (items: BacklogItem[]) => void
): Unsubscribe {
	const q = query(
		itemsCol(boardId),
		where('sprintId', '==', null),
		orderBy('backlogOrder', 'asc')
	);
	return onSnapshot(q, (snap) => {
		const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BacklogItem);
		cb(items);
	}, (err) => {
		console.error('[agile] Error subscribing to backlog:', err);
		cb([]);
	});
}

// Subscribe to sprint items
export function subscribeSprintItems(
	boardId: string,
	sprintId: string,
	cb: (items: BacklogItem[]) => void
): Unsubscribe {
	const q = query(
		itemsCol(boardId),
		where('sprintId', '==', sprintId),
		orderBy('boardOrder', 'asc')
	);
	return onSnapshot(q, (snap) => {
		const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BacklogItem);
		cb(items);
	}, (err) => {
		console.error('[agile] Error subscribing to sprint items:', err);
		cb([]);
	});
}

// Move item to sprint
export async function moveItemToSprint(
	boardId: string,
	itemId: string,
	sprintId: string | null,
	userId: string
): Promise<void> {
	const item = await getItem(boardId, itemId);
	if (!item) return;
	
	const db = getDb();
	const batch = writeBatch(db);
	
	// Remove from old sprint
	if (item.sprintId) {
		batch.update(sprintDoc(boardId, item.sprintId), {
			itemIds: arrayRemove(itemId)
		});
	}
	
	// Add to new sprint
	if (sprintId) {
		batch.update(sprintDoc(boardId, sprintId), {
			itemIds: arrayUnion(itemId)
		});
		batch.update(itemDoc(boardId, itemId), {
			sprintId,
			status: item.status === 'backlog' ? 'todo' : item.status,
			updatedAt: serverTimestamp()
		});
	} else {
		batch.update(itemDoc(boardId, itemId), {
			sprintId: null,
			status: 'backlog',
			updatedAt: serverTimestamp()
		});
	}
	
	await batch.commit();
	
	// Log activity
	await logActivity(boardId, userId, 'item_moved_sprint', {
		itemId,
		key: item.key,
		sprintId
	});
}

// Reorder items within column
export async function reorderItems(
	boardId: string,
	itemIds: string[],
	field: 'backlogOrder' | 'boardOrder'
): Promise<void> {
	const db = getDb();
	const batch = writeBatch(db);
	
	itemIds.forEach((id, index) => {
		batch.update(itemDoc(boardId, id), { [field]: index });
	});
	
	await batch.commit();
}

// ============================================================================
// SPRINT OPERATIONS
// ============================================================================

// Create a new sprint
export async function createSprint(
	boardId: string,
	data: {
		name: string;
		goal?: string;
		startDate?: Date;
		endDate?: Date;
	},
	userId: string
): Promise<string> {
	const ref = doc(sprintsCol(boardId));
	
	const sprint: Omit<Sprint, 'id'> = {
		boardId,
		name: data.name,
		goal: data.goal ?? null,
		status: 'planning',
		startDate: data.startDate ? (data.startDate as unknown as Timestamp) : null,
		endDate: data.endDate ? (data.endDate as unknown as Timestamp) : null,
		createdAt: serverTimestamp() as unknown as Timestamp,
		itemIds: []
	};
	
	await setDoc(ref, sprint);
	
	await logActivity(boardId, userId, 'sprint_created', {
		sprintId: ref.id,
		name: data.name
	});
	
	return ref.id;
}

// Get a sprint
export async function getSprint(boardId: string, sprintId: string): Promise<Sprint | null> {
	const snap = await getDoc(sprintDoc(boardId, sprintId));
	if (!snap.exists()) return null;
	return { id: snap.id, ...snap.data() } as Sprint;
}

// Update sprint
export async function updateSprint(
	boardId: string,
	sprintId: string,
	data: Partial<Sprint>
): Promise<void> {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { id: _id, ...updateData } = data;
	await updateDoc(sprintDoc(boardId, sprintId), updateData);
}

// Start a sprint
export async function startSprint(
	boardId: string,
	sprintId: string,
	endDate: Date,
	userId: string
): Promise<void> {
	// End any active sprint first
	const activeSprints = await getDocs(
		query(sprintsCol(boardId), where('status', '==', 'active'))
	);
	
	const batch = writeBatch(getDb());
	
	for (const s of activeSprints.docs) {
		batch.update(s.ref, { status: 'completed', completedAt: serverTimestamp() });
	}
	
	batch.update(sprintDoc(boardId, sprintId), {
		status: 'active',
		startDate: serverTimestamp(),
		endDate
	});
	
	await batch.commit();
	
	await logActivity(boardId, userId, 'sprint_started', { sprintId });
}

// Complete a sprint
export async function completeSprint(
	boardId: string,
	sprintId: string,
	userId: string,
	moveIncompleteToBacklog = true
): Promise<void> {
	const sprint = await getSprint(boardId, sprintId);
	if (!sprint) return;
	
	const batch = writeBatch(getDb());
	
	// Calculate velocity
	const itemsSnap = await getDocs(
		query(itemsCol(boardId), where('sprintId', '==', sprintId), where('status', '==', 'done'))
	);
	const velocity = itemsSnap.docs.reduce((sum, d) => sum + (d.data().storyPoints ?? 0), 0);
	
	batch.update(sprintDoc(boardId, sprintId), {
		status: 'completed',
		completedAt: serverTimestamp(),
		velocity
	});
	
	// Move incomplete items to backlog if requested
	if (moveIncompleteToBacklog) {
		const incompleteSnap = await getDocs(
			query(
				itemsCol(boardId),
				where('sprintId', '==', sprintId),
				where('status', 'in', ['todo', 'in_progress', 'review', 'blocked'])
			)
		);
		
		for (const d of incompleteSnap.docs) {
			batch.update(d.ref, {
				sprintId: null,
				status: 'backlog'
			});
		}
	}
	
	await batch.commit();
	
	await logActivity(boardId, userId, 'sprint_completed', {
		sprintId,
		velocity
	});
}

// Subscribe to sprints
export function subscribeSprints(
	boardId: string,
	cb: (sprints: Sprint[]) => void
): Unsubscribe {
	const q = query(sprintsCol(boardId), orderBy('createdAt', 'desc'));
	return onSnapshot(q, (snap) => {
		const sprints = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Sprint);
		cb(sprints);
	}, (err) => {
		console.error('[agile] Error subscribing to sprints:', err);
		cb([]);
	});
}

// Get active sprint
export async function getActiveSprint(boardId: string): Promise<Sprint | null> {
	const snap = await getDocs(
		query(sprintsCol(boardId), where('status', '==', 'active'))
	);
	if (snap.empty) return null;
	const d = snap.docs[0];
	return { id: d.id, ...d.data() } as Sprint;
}

// Subscribe to active sprints across multiple boards
export function subscribeActiveSprints(
	boardIds: string[],
	cb: (sprints: Sprint[]) => void
): Unsubscribe {
	if (boardIds.length === 0) {
		cb([]);
		return () => {};
	}
	
	// Track sprints from each board
	const sprintsByBoard: Map<string, Sprint[]> = new Map();
	const unsubscribes: Unsubscribe[] = [];
	
	// Subscribe to each board's active sprints
	boardIds.forEach(boardId => {
		const q = query(sprintsCol(boardId), where('status', '==', 'active'));
		const unsub = onSnapshot(q, (snap) => {
			const sprints = snap.docs.map((d) => ({ 
				id: d.id, 
				boardId, // Ensure boardId is set
				...d.data() 
			}) as Sprint);
			sprintsByBoard.set(boardId, sprints);
			
			// Combine all sprints and callback
			const allSprints: Sprint[] = [];
			sprintsByBoard.forEach(boardSprints => allSprints.push(...boardSprints));
			cb(allSprints);
		}, (err) => {
			console.error(`[agile] Error subscribing to active sprints for board ${boardId}:`, err);
		});
		unsubscribes.push(unsub);
	});
	
	// Return combined unsubscribe function
	return () => {
		unsubscribes.forEach(unsub => unsub());
	};
}

// ============================================================================
// EPIC OPERATIONS
// ============================================================================

// Get next epic number
async function getNextEpicNumber(boardId: string): Promise<number> {
	const counterRef = doc(getDb(), 'agileBoards', boardId, 'meta', 'counter');
	const snap = await getDoc(counterRef);
	const current = snap.exists() ? (snap.data()?.epicNumber ?? 0) : 0;
	const next = current + 1;
	await setDoc(counterRef, { epicNumber: next }, { merge: true });
	return next;
}

// Create epic
export async function createEpic(
	boardId: string,
	data: {
		name: string;
		description?: string;
		color?: string;
		ownerId: string;
		targetDate?: Date;
	}
): Promise<string> {
	const board = await getBoard(boardId);
	if (!board) throw new Error('Board not found');
	
	const epicNum = await getNextEpicNumber(boardId);
	const key = `${board.key}-E${epicNum}`;
	
	const ref = doc(epicsCol(boardId));
	
	const epic: Omit<Epic, 'id'> = {
		boardId,
		key,
		name: data.name,
		description: data.description ?? null,
		color: data.color ?? '#8b5cf6',
		status: 'active',
		ownerId: data.ownerId,
		targetDate: data.targetDate ? (data.targetDate as unknown as Timestamp) : null,
		createdAt: serverTimestamp() as unknown as Timestamp,
		updatedAt: serverTimestamp() as unknown as Timestamp,
		progress: 0
	};
	
	await setDoc(ref, epic);
	
	await logActivity(boardId, data.ownerId, 'epic_created', {
		epicId: ref.id,
		key,
		name: data.name
	});
	
	return ref.id;
}

// Get epic
export async function getEpic(boardId: string, epicId: string): Promise<Epic | null> {
	const snap = await getDoc(epicDoc(boardId, epicId));
	if (!snap.exists()) return null;
	return { id: snap.id, ...snap.data() } as Epic;
}

// Update epic
export async function updateEpic(
	boardId: string,
	epicId: string,
	data: Partial<Epic>
): Promise<void> {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { id: _id, ...updateData } = data;
	await updateDoc(epicDoc(boardId, epicId), {
		...updateData,
		updatedAt: serverTimestamp()
	});
}

// Delete epic
export async function deleteEpic(boardId: string, epicId: string): Promise<void> {
	// Remove epicId from all items
	const itemsWithEpic = await getDocs(
		query(itemsCol(boardId), where('epicId', '==', epicId))
	);
	
	const batch = writeBatch(getDb());
	
	for (const d of itemsWithEpic.docs) {
		batch.update(d.ref, { epicId: null });
	}
	
	batch.delete(epicDoc(boardId, epicId));
	
	await batch.commit();
}

// Subscribe to epics
export function subscribeEpics(
	boardId: string,
	cb: (epics: Epic[]) => void
): Unsubscribe {
	const q = query(epicsCol(boardId), orderBy('createdAt', 'desc'));
	return onSnapshot(q, (snap) => {
		const epics = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Epic);
		cb(epics);
	}, (err) => {
		console.error('[agile] Error subscribing to epics:', err);
		cb([]);
	});
}

// Update epic progress based on child items
export async function updateEpicProgress(boardId: string, epicId: string): Promise<void> {
	const items = await getDocs(
		query(itemsCol(boardId), where('epicId', '==', epicId))
	);
	
	if (items.empty) {
		await updateDoc(epicDoc(boardId, epicId), { progress: 0 });
		return;
	}
	
	const total = items.size;
	const done = items.docs.filter((d) => d.data().status === 'done').length;
	const progress = Math.round((done / total) * 100);
	
	await updateDoc(epicDoc(boardId, epicId), { progress });
}

// ============================================================================
// COMMENT OPERATIONS
// ============================================================================

// Add comment
export async function addComment(
	boardId: string,
	itemId: string,
	data: {
		authorId: string;
		content: string;
	}
): Promise<string> {
	const ref = doc(commentsCol(boardId, itemId));
	
	const comment: Omit<ItemComment, 'id'> = {
		itemId,
		authorId: data.authorId,
		content: data.content,
		createdAt: serverTimestamp() as unknown as Timestamp,
		updatedAt: serverTimestamp() as unknown as Timestamp,
		edited: false
	};
	
	await setDoc(ref, comment);
	
	// Increment comment count
	await updateDoc(itemDoc(boardId, itemId), {
		commentCount: increment(1)
	});
	
	return ref.id;
}

// Subscribe to comments
export function subscribeComments(
	boardId: string,
	itemId: string,
	cb: (comments: ItemComment[]) => void
): Unsubscribe {
	const q = query(commentsCol(boardId, itemId), orderBy('createdAt', 'asc'));
	return onSnapshot(q, (snap) => {
		const comments = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ItemComment);
		cb(comments);
	});
}

// ============================================================================
// ACTIVITY LOG
// ============================================================================

export async function logActivity(
	boardId: string,
	userId: string,
	action: string,
	details?: Record<string, unknown>
): Promise<void> {
	const ref = doc(activityCol(boardId));
	
	await setDoc(ref, {
		boardId,
		userId,
		action,
		details: details ?? null,
		createdAt: serverTimestamp()
	});
}

// Subscribe to recent activity
export function subscribeActivity(
	boardId: string,
	cb: (activity: ActivityEntry[]) => void,
	limitCount = 50
): Unsubscribe {
	const q = query(
		activityCol(boardId),
		orderBy('createdAt', 'desc'),
		limit(limitCount)
	);
	return onSnapshot(q, (snap) => {
		const activity = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ActivityEntry);
		cb(activity);
	});
}

// ============================================================================
// ANALYTICS & REPORTS
// ============================================================================

export type BoardStats = {
	totalItems: number;
	byStatus: Record<ItemStatus, number>;
	byType: Record<ItemType, number>;
	byPriority: Record<ItemPriority, number>;
	totalStoryPoints: number;
	completedStoryPoints: number;
	avgCycleTimeMs: number | null;
	sprintVelocities: number[];
};

export async function getBoardStats(boardId: string): Promise<BoardStats> {
	const itemsSnap = await getDocs(itemsCol(boardId));
	const items = itemsSnap.docs.map((d) => d.data() as BacklogItem);
	
	const stats: BoardStats = {
		totalItems: items.length,
		byStatus: { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, blocked: 0 },
		byType: { story: 0, bug: 0, task: 0, epic: 0, subtask: 0 },
		byPriority: { critical: 0, high: 0, medium: 0, low: 0 },
		totalStoryPoints: 0,
		completedStoryPoints: 0,
		avgCycleTimeMs: null,
		sprintVelocities: []
	};
	
	const cycleTimes: number[] = [];
	
	for (const item of items) {
		stats.byStatus[item.status]++;
		stats.byType[item.type]++;
		stats.byPriority[item.priority]++;
		stats.totalStoryPoints += item.storyPoints ?? 0;
		
		if (item.status === 'done') {
			stats.completedStoryPoints += item.storyPoints ?? 0;
			
			// Calculate cycle time
			if (item.createdAt && item.resolvedAt) {
				const created = item.createdAt.toMillis?.() ?? 0;
				const resolved = item.resolvedAt.toMillis?.() ?? 0;
				if (resolved > created) {
					cycleTimes.push(resolved - created);
				}
			}
		}
	}
	
	if (cycleTimes.length > 0) {
		stats.avgCycleTimeMs = cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length;
	}
	
	// Get sprint velocities
	const sprintsSnap = await getDocs(
		query(sprintsCol(boardId), where('status', '==', 'completed'))
	);
	stats.sprintVelocities = sprintsSnap.docs
		.map((d) => d.data().velocity ?? 0)
		.filter((v) => v > 0);
	
	return stats;
}

// ============================================================================
// TICKET INTEGRATION (Future)
// ============================================================================

// Link an existing ticket to a backlog item
export async function linkTicketToItem(
	boardId: string,
	itemId: string,
	ticketId: string,
	serverId: string
): Promise<void> {
	await updateDoc(itemDoc(boardId, itemId), {
		linkedTicketId: ticketId,
		linkedServerId: serverId,
		updatedAt: serverTimestamp()
	});
}

// Create item from ticket
export async function createItemFromTicket(
	boardId: string,
	ticketData: {
		ticketId: string;
		serverId: string;
		title: string;
		description?: string;
		reporterId: string;
	}
): Promise<string> {
	return createItem(boardId, {
		type: 'bug', // Tickets usually become bugs
		title: ticketData.title,
		description: ticketData.description,
		reporterId: ticketData.reporterId,
		labels: ['from-ticket']
	}).then(async (itemId) => {
		await linkTicketToItem(boardId, itemId, ticketData.ticketId, ticketData.serverId);
		return itemId;
	});
}

// ============================================================================
// WORKSPACE OPERATIONS
// ============================================================================

const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
	defaultSprintDurationWeeks: 2,
	enableStoryPoints: true,
	storyPointScale: [1, 2, 3, 5, 8, 13, 21],
	workingDaysPerWeek: 5
};

export function workspacesCol() {
	return collection(getDb(), 'agileWorkspaces');
}

export function workspaceDoc(workspaceId: string) {
	return doc(getDb(), 'agileWorkspaces', workspaceId);
}

// Create a new workspace
export async function createWorkspace(data: {
	name: string;
	description?: string;
	iconEmoji?: string;
	ownerId: string;
	settings?: Partial<WorkspaceSettings>;
}): Promise<string> {
	const db = getDb();
	const ref = doc(collection(db, 'agileWorkspaces'));
	const workspace: Omit<AgileWorkspace, 'id'> = {
		name: data.name,
		description: data.description ?? null,
		iconEmoji: data.iconEmoji ?? '🚀',
		ownerId: data.ownerId,
		members: [{
			userId: data.ownerId,
			role: 'owner',
			joinedAt: serverTimestamp() as unknown as Timestamp
		}],
		createdAt: serverTimestamp() as unknown as Timestamp,
		updatedAt: serverTimestamp() as unknown as Timestamp,
		settings: { ...DEFAULT_WORKSPACE_SETTINGS, ...data.settings }
	};
	await setDoc(ref, workspace);
	return ref.id;
}

// Get workspace by ID
export async function getWorkspace(workspaceId: string): Promise<AgileWorkspace | null> {
	const snap = await getDoc(workspaceDoc(workspaceId));
	if (!snap.exists()) return null;
	return { id: snap.id, ...snap.data() } as AgileWorkspace;
}

// Subscribe to user's workspaces
export function subscribeUserWorkspaces(
	userId: string,
	cb: (workspaces: AgileWorkspace[]) => void
): Unsubscribe {
	const q = query(
		workspacesCol(),
		where('members', 'array-contains-any', [
			{ userId, role: 'owner' },
			{ userId, role: 'admin' },
			{ userId, role: 'scrum_master' },
			{ userId, role: 'product_owner' },
			{ userId, role: 'developer' },
			{ userId, role: 'designer' },
			{ userId, role: 'qa' },
			{ userId, role: 'viewer' }
		])
	);
	// Fallback: get all workspaces where user is a member
	return onSnapshot(workspacesCol(), (snap) => {
		const workspaces = snap.docs
			.map((d) => ({ id: d.id, ...d.data() }) as AgileWorkspace)
			.filter((ws) => ws.members.some((m) => m.userId === userId));
		cb(workspaces);
	});
}

// Add member to workspace
export async function addWorkspaceMember(
	workspaceId: string,
	member: Omit<TeamMember, 'joinedAt'>
): Promise<void> {
	const workspace = await getWorkspace(workspaceId);
	if (!workspace) throw new Error('Workspace not found');
	
	// Check if already a member
	if (workspace.members.some((m) => m.userId === member.userId)) {
		throw new Error('User is already a member');
	}
	
	await updateDoc(workspaceDoc(workspaceId), {
		members: arrayUnion({
			...member,
			joinedAt: serverTimestamp()
		}),
		updatedAt: serverTimestamp()
	});
}

// Update member role
export async function updateWorkspaceMemberRole(
	workspaceId: string,
	userId: string,
	newRole: TeamRole
): Promise<void> {
	const workspace = await getWorkspace(workspaceId);
	if (!workspace) throw new Error('Workspace not found');
	
	const updatedMembers = workspace.members.map((m) =>
		m.userId === userId ? { ...m, role: newRole } : m
	);
	
	await updateDoc(workspaceDoc(workspaceId), {
		members: updatedMembers,
		updatedAt: serverTimestamp()
	});
}

// Remove member from workspace
export async function removeWorkspaceMember(
	workspaceId: string,
	userId: string
): Promise<void> {
	const workspace = await getWorkspace(workspaceId);
	if (!workspace) throw new Error('Workspace not found');
	
	const member = workspace.members.find((m) => m.userId === userId);
	if (member) {
		await updateDoc(workspaceDoc(workspaceId), {
			members: arrayRemove(member),
			updatedAt: serverTimestamp()
		});
	}
}

// ============================================================================
// ENHANCED ANALYTICS
// ============================================================================

export type SprintReport = {
	sprint: Sprint;
	totalItems: number;
	completedItems: number;
	completionRate: number;
	totalPoints: number;
	completedPoints: number;
	velocity: number;
	burndownData: { date: string; remaining: number; ideal: number }[];
	itemsByStatus: Record<ItemStatus, number>;
	itemsByAssignee: Record<string, { total: number; completed: number; points: number }>;
};

export async function getSprintReport(boardId: string, sprintId: string): Promise<SprintReport | null> {
	const sprint = await getSprint(boardId, sprintId);
	if (!sprint) return null;
	
	const itemsSnap = await getDocs(
		query(itemsCol(boardId), where('sprintId', '==', sprintId))
	);
	const items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as BacklogItem);
	
	const completedItems = items.filter((i) => i.status === 'done');
	const totalPoints = items.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
	const completedPoints = completedItems.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
	
	// Items by status
	const itemsByStatus: Record<ItemStatus, number> = {
		backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, blocked: 0
	};
	items.forEach((i) => itemsByStatus[i.status]++);
	
	// Items by assignee
	const itemsByAssignee: Record<string, { total: number; completed: number; points: number }> = {};
	items.forEach((i) => {
		const assignee = i.assigneeId ?? 'unassigned';
		if (!itemsByAssignee[assignee]) {
			itemsByAssignee[assignee] = { total: 0, completed: 0, points: 0 };
		}
		itemsByAssignee[assignee].total++;
		itemsByAssignee[assignee].points += i.storyPoints ?? 0;
		if (i.status === 'done') {
			itemsByAssignee[assignee].completed++;
		}
	});
	
	// Generate burndown data (simplified - would need daily snapshots for accuracy)
	const burndownData: { date: string; remaining: number; ideal: number }[] = [];
	if (sprint.startDate && sprint.endDate) {
		const startMs = sprint.startDate.toMillis();
		const endMs = sprint.endDate.toMillis();
		const totalDays = Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24));
		const pointsPerDay = totalPoints / totalDays;
		
		for (let i = 0; i <= totalDays; i++) {
			const date = new Date(startMs + i * 24 * 60 * 60 * 1000);
			burndownData.push({
				date: date.toISOString().split('T')[0],
				remaining: Math.max(0, totalPoints - (completedPoints * (i / totalDays))),
				ideal: Math.max(0, totalPoints - (pointsPerDay * i))
			});
		}
	}
	
	return {
		sprint,
		totalItems: items.length,
		completedItems: completedItems.length,
		completionRate: items.length > 0 ? (completedItems.length / items.length) * 100 : 0,
		totalPoints,
		completedPoints,
		velocity: completedPoints,
		burndownData,
		itemsByStatus,
		itemsByAssignee
	};
}

export type TeamPerformance = {
	memberId: string;
	totalItemsAssigned: number;
	totalItemsCompleted: number;
	totalPointsAssigned: number;
	totalPointsCompleted: number;
	avgCompletionRate: number;
	recentVelocity: number[]; // Last 5 sprints
};

export async function getTeamPerformance(boardId: string): Promise<TeamPerformance[]> {
	const itemsSnap = await getDocs(itemsCol(boardId));
	const items = itemsSnap.docs.map((d) => d.data() as BacklogItem);
	
	const memberStats: Record<string, TeamPerformance> = {};
	
	items.forEach((item) => {
		const memberId = item.assigneeId ?? 'unassigned';
		if (!memberStats[memberId]) {
			memberStats[memberId] = {
				memberId,
				totalItemsAssigned: 0,
				totalItemsCompleted: 0,
				totalPointsAssigned: 0,
				totalPointsCompleted: 0,
				avgCompletionRate: 0,
				recentVelocity: []
			};
		}
		
		memberStats[memberId].totalItemsAssigned++;
		memberStats[memberId].totalPointsAssigned += item.storyPoints ?? 0;
		
		if (item.status === 'done') {
			memberStats[memberId].totalItemsCompleted++;
			memberStats[memberId].totalPointsCompleted += item.storyPoints ?? 0;
		}
	});
	
	// Calculate completion rates
	Object.values(memberStats).forEach((stats) => {
		stats.avgCompletionRate = stats.totalItemsAssigned > 0
			? (stats.totalItemsCompleted / stats.totalItemsAssigned) * 100
			: 0;
	});
	
	return Object.values(memberStats);
}

// Get velocity trend over last N sprints
export async function getVelocityTrend(boardId: string, count = 10): Promise<{ sprintName: string; velocity: number; commitment: number }[]> {
	const sprintsSnap = await getDocs(
		query(
			sprintsCol(boardId),
			where('status', '==', 'completed'),
			orderBy('completedAt', 'desc'),
			limit(count)
		)
	);
	
	const results: { sprintName: string; velocity: number; commitment: number }[] = [];
	
	for (const sprintDoc of sprintsSnap.docs) {
		const sprint = { id: sprintDoc.id, ...sprintDoc.data() } as Sprint;
		
		// Get items for this sprint to calculate commitment
		const itemsSnap = await getDocs(
			query(itemsCol(boardId), where('sprintId', '==', sprint.id))
		);
		const commitment = itemsSnap.docs.reduce((sum, d) => sum + (d.data().storyPoints ?? 0), 0);
		
		results.push({
			sprintName: sprint.name,
			velocity: sprint.velocity ?? 0,
			commitment
		});
	}
	
	return results.reverse(); // Oldest to newest
}

// Get helper info for agile beginners - Based on company training
export const AGILE_TIPS = {
	backlog: {
		title: 'Product Backlog',
		description: 'A force-ranked list of User Stories representing value to the customer. The Product Owner owns this list and keeps it perfectly "sharpened" so the team always knows what\'s most valuable.',
		tips: [
			'Force rank items - avoid equal priorities',
			'Write stories in customer language, not technical geek speak',
			'Use "Slicing the Cake" to break down large features',
			'Do Just-In-Time analysis - don\'t over-prepare'
		]
	},
	sprint: {
		title: 'Sprint/Iteration',
		description: 'A fixed time-box (usually 1-2 weeks) where the team commits to delivering a "Potentially Shippable Product" increment. Work is pulled from the backlog, never pushed.',
		tips: [
			'Deliver working product every week - it\'s the primary measure of progress',
			'Flex on Scope, not Budget or Time',
			'Handle interruptions through your process, not around it',
			'Define "Done" clearly with Acceptance Criteria'
		]
	},
	storyPoints: {
		title: 'Story Points & Estimation',
		description: 'A unitless, relative measure of effort/complexity. Humans are better at relative estimation than absolute. Use Planning Poker for team consensus.',
		tips: [
			'Points are relative - compare to known reference stories',
			'Unitless is intentional - avoid mapping to hours',
			'Planning Poker helps avoid anchoring bias',
			'Fibonacci scale (1,2,3,5,8,13,21) reflects increasing uncertainty'
		]
	},
	velocity: {
		title: 'Velocity',
		description: 'How many story points your team completes per sprint. Use it for planning capacity, NOT for measuring individual performance or comparing teams.',
		tips: [
			'Use "Yesterday\'s Weather" - past performance predicts future',
			'Takes 3-5 sprints to establish baseline',
			'Never use velocity to compare teams or individuals',
			'Protects team from over-commitment'
		]
	},
	burndown: {
		title: 'Burndown Chart',
		description: 'Visual progress tracker showing remaining work vs. time. Daily or weekly depending on iteration length. The line should trend toward zero.',
		tips: [
			'Update daily for accurate tracking',
			'Line above ideal = behind schedule',
			'Flat lines indicate blockers - swarm on them!',
			'Use for iteration-level tracking'
		]
	},
	oneTeam: {
		title: 'One Team',
		description: 'Agile teams blur roles - everyone works together with shared ownership. Business and developers must work together daily. No "us vs them".',
		tips: [
			'Developers only develop, testers only test? Not agile!',
			'Servant leaders remove blockers, not manage people',
			'Self-organizing teams make the best decisions',
			'Face-to-face conversation beats email every time'
		]
	},
	dailyStandup: {
		title: 'Daily Stand-up',
		description: 'A brief daily sync (15 min max) where team members share: What I did yesterday, What I\'m doing today, What\'s blocking me.',
		tips: [
			'Stand up - keeps it short!',
			'Raise hands if blocked - make blockers visible',
			'Talk to each other, not to a manager',
			'Take detailed discussions offline'
		]
	},
	retrospective: {
		title: 'Retrospective',
		description: 'Two goals: Inspect how the sprint went and Adapt the process for improvement. The team reflects, then tunes and adjusts behavior accordingly.',
		tips: [
			'What went well? What could improve?',
			'Action items must have owners',
			'Vary the format to avoid staleness',
			'Celebrate wins, don\'t just focus on problems'
		]
	},
	kanban: {
		title: 'Kanban',
		description: 'A "pull system" created by Taiichi Ohno at Toyota. Work is visualized, WIP is limited, and flow is measured. Helps mitigate context switching inefficiencies.',
		tips: [
			'Limit Work In Progress (WIP) per column',
			'Pull work, don\'t push - start new work only when capacity allows',
			'Sick board signs: Too many items in one column, stale cards',
			'Flow efficiency > resource efficiency'
		]
	}
};

// Team Health Check dimensions - from company training
export const TEAM_HEALTH_DIMENSIONS = {
	teamwork: {
		title: 'Teamwork',
		description: 'Communication within the Team is easy and happens often enough. No grudges or bad feelings.',
		healthy: 'We receive enough mentoring on this subject.',
		unhealthy: 'Communication is difficult, conflicts are unresolved.'
	},
	pawnsOrPlayers: {
		title: 'Pawns or Players',
		description: 'As a Team we feel that we are actually players who decide where the pawns are moved, not just chess pieces.',
		healthy: 'We have autonomy and influence in the big picture.',
		unhealthy: 'We feel like pawns being moved around by management.'
	},
	mission: {
		title: 'Mission',
		description: 'The mission and vision of our work is crystal clear. The Product Owner keeps us updated on direction.',
		healthy: 'We understand what is value to the customer.',
		unhealthy: 'We don\'t know why we\'re building what we\'re building.'
	},
	codebaseHealth: {
		title: 'Codebase Health',
		description: 'Our code is healthy - easily read, tested, and refactored. Technical excellence and good design enhances agility.',
		healthy: 'If a major change came tomorrow, we\'d smile because it\'s easy.',
		unhealthy: 'Legacy code makes every change painful and risky.'
	},
	speed: {
		title: 'Speed',
		description: 'Our work is fluid and moving fast. Problems are immediately swarmed upon with furious motivation.',
		healthy: 'We feel invincible - nothing can stop this bullet-speed train.',
		unhealthy: 'We\'re slow and bogged down by process or blockers.'
	},
	deliveringValue: {
		title: 'Delivering Value',
		description: 'Each Iteration delivers valuable pieces of software with outstanding quality.',
		healthy: 'Work is measured against clear Definition of Done and Acceptance Criteria.',
		unhealthy: 'We ship incomplete or low-quality work.'
	},
	suitableProcess: {
		title: 'Suitable Process',
		description: 'We\'ve crafted a rock solid process that yields high value at a steady pace.',
		healthy: 'Process serves us so we can serve the customer.',
		unhealthy: 'Process slows us down and gets in our way.'
	},
	fun: {
		title: 'Fun',
		description: 'Our Team is having so much fun that it hardly seems like work coming here Monday morning.',
		healthy: 'We enjoy our work and each other.',
		unhealthy: 'Work feels like a grind with no joy.'
	}
};

// Role descriptions for team members - Based on company Agile training
export const ROLE_DESCRIPTIONS: Record<TeamRole, { title: string; description: string; permissions: string[] }> = {
	owner: {
		title: 'Workspace Owner',
		description: 'Full control over the workspace and all boards',
		permissions: ['All permissions', 'Delete workspace', 'Manage billing']
	},
	admin: {
		title: 'Administrator',
		description: 'Can manage boards, members, and settings',
		permissions: ['Create/delete boards', 'Manage members', 'Edit settings']
	},
	scrum_master: {
		title: 'Agile Coach / Scrum Master',
		description: 'Servant leader who facilitates the team. Removes blockers, protects the team from outside interference, and coaches on agile practices. NOT a project manager.',
		permissions: ['Manage sprints', 'Edit items', 'View analytics', 'Facilitate ceremonies']
	},
	product_owner: {
		title: 'Product Owner',
		description: 'Represents the voice of the customer. Owns and prioritizes the backlog, ensures the team understands what delivers value. Works daily with the team.',
		permissions: ['Manage backlog', 'Prioritize items', 'Approve completion', 'Define acceptance criteria']
	},
	developer: {
		title: 'Team Member',
		description: 'Self-organizing member of the team. Determines how long things take and how work gets done. Blurred roles - may test, design, document as needed.',
		permissions: ['Create items', 'Update status', 'Log time', 'Estimate work']
	},
	designer: {
		title: 'Designer',
		description: 'Works on design tasks within the self-organizing team. Collaborates closely with developers and QA.',
		permissions: ['Create items', 'Update status', 'Add attachments', 'Review designs']
	},
	qa: {
		title: 'QA Engineer',
		description: 'Quality advocate within the team. In agile, testing is continuous and everyone owns quality.',
		permissions: ['Create bugs', 'Update status', 'Review items', 'Define test criteria']
	},
	viewer: {
		title: 'Stakeholder/Viewer',
		description: 'Can view boards and provide feedback but doesn\'t make changes. Attends sprint reviews.',
		permissions: ['View boards', 'View analytics', 'Add comments', 'Attend reviews']
	}
};

// New Agile role descriptions per spec
export const AGILE_ROLE_DESCRIPTIONS: Record<AgileRole, { title: string; description: string; permissions: string[] }> = {
	product_owner: {
		title: 'Product Owner (PO)',
		description: 'Owns intake from clients. Creates work items and stories. Sets and changes priority. Plans future sprints by adding items to the team backlog. Provides direction and value focus.',
		permissions: [
			'Create work items',
			'Edit priority',
			'Edit client tag',
			'Edit story fields',
			'Add/edit acceptance criteria',
			'Move items to Planned for Sprint'
		]
	},
	agile_coach: {
		title: 'Agile Coach (Scrum Master)',
		description: 'Moves work items through the workflow states. Helps teams follow the process and improve it. Supports WIP control and flow. Facilitates ceremonies.',
		permissions: [
			'Move items across workflow states',
			'Manage WIP limits and columns',
			'Facilitate sprints, standup, retro, reporting'
		]
	},
	team_member: {
		title: 'Team Member (Engineer)',
		description: 'Picks work from the sprint plan. Builds and tests (no dedicated QA). Delivers working product each iteration. Swarms on blockers when needed.',
		permissions: [
			'Move items from In Progress onward',
			'Add comments, test notes',
			'Suggest acceptance criteria',
			'Mark blocked with reason',
			'Complete items when DoD is met'
		]
	},
	viewer: {
		title: 'Stakeholder/Viewer',
		description: 'Can view boards, reports, and provide feedback via comments.',
		permissions: ['View board', 'View reports', 'Add comments']
	}
};

// ============================================================================
// SPLIT ITEM OPERATION - "Backlog items should be broken down into small bite sized pieces"
// ============================================================================

export async function splitItem(
	boardId: string,
	parentItemId: string,
	childItems: Array<{
		title: string;
		description?: string;
		tshirtSize?: TShirtSize;
		acceptanceCriteria?: string[];
	}>,
	userId: string
): Promise<string[]> {
	const parentItem = await getItem(boardId, parentItemId);
	if (!parentItem) throw new Error('Parent item not found');
	
	const childIds: string[] = [];
	
	for (const child of childItems) {
		const childId = await createItem(boardId, {
			type: parentItem.type,
			title: child.title,
			description: child.description,
			priority: parentItem.priority,
			reporterId: userId,
			ownerPoId: parentItem.ownerPoId,
			epicId: parentItem.epicId,
			clientTagId: parentItem.clientTagId,
			splitFromId: parentItemId,
			tshirtSize: child.tshirtSize,
			acceptanceCriteria: child.acceptanceCriteria,
			labels: parentItem.labels
		});
		childIds.push(childId);
	}
	
	// Update parent to mark as split
	await updateDoc(itemDoc(boardId, parentItemId), {
		childItemIds: childIds,
		status: 'done', // Original item is "done" by being split
		updatedAt: serverTimestamp()
	});
	
	await logActivity(boardId, userId, 'item_split', {
		parentItemId,
		parentKey: parentItem.key,
		childCount: childIds.length
	});
	
	return childIds;
}

// ============================================================================
// CLIENT TAG OPERATIONS - "Backlog items get tagged to a client"
// ============================================================================

export async function addClientTag(
	boardId: string,
	tag: Omit<ClientTag, 'id'>
): Promise<string> {
	const board = await getBoard(boardId);
	if (!board) throw new Error('Board not found');
	
	const id = `tag_${Date.now()}`;
	const newTag: ClientTag = { id, ...tag };
	
	await updateDoc(boardDoc(boardId), {
		clientTags: arrayUnion(newTag),
		updatedAt: serverTimestamp()
	});
	
	return id;
}

export async function updateClientTag(
	boardId: string,
	tagId: string,
	updates: Partial<Omit<ClientTag, 'id'>>
): Promise<void> {
	const board = await getBoard(boardId);
	if (!board) throw new Error('Board not found');
	
	const updatedTags = board.clientTags.map(tag => 
		tag.id === tagId ? { ...tag, ...updates } : tag
	);
	
	await updateDoc(boardDoc(boardId), {
		clientTags: updatedTags,
		updatedAt: serverTimestamp()
	});
}

export async function removeClientTag(boardId: string, tagId: string): Promise<void> {
	const board = await getBoard(boardId);
	if (!board) throw new Error('Board not found');
	
	const tag = board.clientTags.find(t => t.id === tagId);
	if (tag) {
		await updateDoc(boardDoc(boardId), {
			clientTags: arrayRemove(tag),
			updatedAt: serverTimestamp()
		});
	}
}

// ============================================================================
// RETROSPECTIVE OPERATIONS - "Include a retro tool per sprint"
// ============================================================================

export async function createRetrospective(
	boardId: string,
	sprintId: string,
	userId: string
): Promise<string> {
	const sprint = await getSprint(boardId, sprintId);
	if (!sprint) throw new Error('Sprint not found');
	
	const ref = doc(retrosCol(boardId));
	
	const retro: Omit<Retrospective, 'id'> = {
		boardId,
		sprintId,
		sprintName: sprint.name,
		wentWell: [],
		didNotGoWell: [],
		actions: [],
		createdAt: serverTimestamp() as unknown as Timestamp
	};
	
	await setDoc(ref, retro);
	
	// Link retro to sprint
	await updateDoc(sprintDoc(boardId, sprintId), {
		retroId: ref.id
	});
	
	await logActivity(boardId, userId, 'retro_created', {
		retroId: ref.id,
		sprintId,
		sprintName: sprint.name
	});
	
	return ref.id;
}

export async function getRetrospective(boardId: string, retroId: string): Promise<Retrospective | null> {
	const snap = await getDoc(retroDoc(boardId, retroId));
	if (!snap.exists()) return null;
	return { id: snap.id, ...snap.data() } as Retrospective;
}

export function subscribeRetrospective(
	boardId: string,
	retroId: string,
	cb: (retro: Retrospective | null) => void
): Unsubscribe {
	return onSnapshot(retroDoc(boardId, retroId), (snap) => {
		if (!snap.exists()) {
			cb(null);
			return;
		}
		cb({ id: snap.id, ...snap.data() } as Retrospective);
	});
}

export async function addRetroItem(
	boardId: string,
	retroId: string,
	category: 'wentWell' | 'didNotGoWell',
	text: string,
	userId: string
): Promise<void> {
	const item: RetroItem = {
		id: `item_${Date.now()}`,
		text,
		authorId: userId,
		votes: 0,
		voterIds: [],
		createdAt: serverTimestamp() as unknown as Timestamp
	};
	
	await updateDoc(retroDoc(boardId, retroId), {
		[category]: arrayUnion(item),
		updatedAt: serverTimestamp()
	});
}

export async function voteRetroItem(
	boardId: string,
	retroId: string,
	category: 'wentWell' | 'didNotGoWell',
	itemId: string,
	userId: string
): Promise<void> {
	const retro = await getRetrospective(boardId, retroId);
	if (!retro) throw new Error('Retro not found');
	
	const items = retro[category];
	const updatedItems = items.map(item => {
		if (item.id === itemId) {
			const hasVoted = item.voterIds.includes(userId);
			return {
				...item,
				votes: hasVoted ? item.votes - 1 : item.votes + 1,
				voterIds: hasVoted 
					? item.voterIds.filter(id => id !== userId)
					: [...item.voterIds, userId]
			};
		}
		return item;
	});
	
	await updateDoc(retroDoc(boardId, retroId), {
		[category]: updatedItems,
		updatedAt: serverTimestamp()
	});
}

export async function addRetroAction(
	boardId: string,
	retroId: string,
	text: string,
	ownerId: string,
	dueDate?: Date
): Promise<void> {
	const action: RetroAction = {
		id: `action_${Date.now()}`,
		text,
		ownerId,
		dueDate: dueDate ? (dueDate as unknown as Timestamp) : null,
		status: 'pending',
		createdAt: serverTimestamp() as unknown as Timestamp
	};
	
	await updateDoc(retroDoc(boardId, retroId), {
		actions: arrayUnion(action),
		updatedAt: serverTimestamp()
	});
}

export async function updateRetroAction(
	boardId: string,
	retroId: string,
	actionId: string,
	updates: Partial<Pick<RetroAction, 'text' | 'ownerId' | 'status' | 'dueDate'>>
): Promise<void> {
	const retro = await getRetrospective(boardId, retroId);
	if (!retro) throw new Error('Retro not found');
	
	const updatedActions = retro.actions.map(action => {
		if (action.id === actionId) {
			return {
				...action,
				...updates,
				completedAt: updates.status === 'completed' 
					? serverTimestamp() as unknown as Timestamp 
					: action.completedAt
			};
		}
		return action;
	});
	
	await updateDoc(retroDoc(boardId, retroId), {
		actions: updatedActions,
		updatedAt: serverTimestamp()
	});
}

// ============================================================================
// TEAM HEALTH CHECK OPERATIONS - Per spec's 8 dimensions
// ============================================================================

export async function createTeamHealthCheck(
	boardId: string,
	sprintId: string
): Promise<string> {
	const ref = doc(healthChecksCol(boardId));
	
	const healthCheck: Omit<TeamHealthCheck, 'id'> = {
		sprintId,
		boardId,
		responses: [],
		createdAt: serverTimestamp() as unknown as Timestamp
	};
	
	await setDoc(ref, healthCheck);
	return ref.id;
}

export async function submitHealthCheckResponse(
	boardId: string,
	healthCheckId: string,
	response: Omit<TeamHealthResponse, 'submittedAt'>,
	userId?: string
): Promise<void> {
	const ref = doc(healthChecksCol(boardId), healthCheckId);
	
	const fullResponse: TeamHealthResponse = {
		...response,
		userId: response.anonymous ? undefined : userId,
		submittedAt: serverTimestamp() as unknown as Timestamp
	};
	
	await updateDoc(ref, {
		responses: arrayUnion(fullResponse)
	});
	
	// Recalculate aggregated scores
	await aggregateHealthCheck(boardId, healthCheckId);
}

async function aggregateHealthCheck(boardId: string, healthCheckId: string): Promise<void> {
	const snap = await getDoc(doc(healthChecksCol(boardId), healthCheckId));
	if (!snap.exists()) return;
	
	const data = snap.data() as TeamHealthCheck;
	const responses = data.responses || [];
	
	if (responses.length === 0) return;
	
	const dimensions = ['teamwork', 'pawnsOrPlayers', 'mission', 'codebaseHealth', 'speed', 'deliveringValue', 'suitableProcess', 'fun'] as const;
	
	const aggregated: TeamHealthAggregated = {
		teamwork: { avg: 0, trend: 'stable' },
		pawnsOrPlayers: { avg: 0, trend: 'stable' },
		mission: { avg: 0, trend: 'stable' },
		codebaseHealth: { avg: 0, trend: 'stable' },
		speed: { avg: 0, trend: 'stable' },
		deliveringValue: { avg: 0, trend: 'stable' },
		suitableProcess: { avg: 0, trend: 'stable' },
		fun: { avg: 0, trend: 'stable' },
		overallHealth: 0,
		responseCount: responses.length
	};
	
	let totalSum = 0;
	
	for (const dim of dimensions) {
		const sum = responses.reduce((acc, r) => acc + (r.ratings[dim] || 0), 0);
		const avg = sum / responses.length;
		aggregated[dim].avg = Math.round(avg * 10) / 10;
		totalSum += avg;
	}
	
	aggregated.overallHealth = Math.round((totalSum / 8) * 10) / 10;
	
	await updateDoc(doc(healthChecksCol(boardId), healthCheckId), {
		aggregated
	});
}

export function subscribeTeamHealthCheck(
	boardId: string,
	healthCheckId: string,
	cb: (check: TeamHealthCheck | null) => void
): Unsubscribe {
	return onSnapshot(doc(healthChecksCol(boardId), healthCheckId), (snap) => {
		if (!snap.exists()) {
			cb(null);
			return;
		}
		cb({ id: snap.id, ...snap.data() } as TeamHealthCheck);
	});
}

// Get health trend over multiple sprints
export async function getHealthTrend(boardId: string, sprintCount = 5): Promise<Array<{
	sprintName: string;
	overallHealth: number;
	dimensions: Record<string, number>;
}>> {
	const sprintsSnap = await getDocs(
		query(
			sprintsCol(boardId),
			where('status', '==', 'completed'),
			orderBy('completedAt', 'desc'),
			limit(sprintCount)
		)
	);
	
	const results: Array<{
		sprintName: string;
		overallHealth: number;
		dimensions: Record<string, number>;
	}> = [];
	
	for (const s of sprintsSnap.docs) {
		const sprint = s.data() as Sprint;
		if (!sprint.retroId) continue;
		
		// Find health check for this sprint
		const healthSnap = await getDocs(
			query(healthChecksCol(boardId), where('sprintId', '==', s.id))
		);
		
		if (healthSnap.empty) continue;
		
		const healthData = healthSnap.docs[0].data() as TeamHealthCheck;
		if (!healthData.aggregated) continue;
		
		results.push({
			sprintName: sprint.name,
			overallHealth: healthData.aggregated.overallHealth,
			dimensions: {
				teamwork: healthData.aggregated.teamwork.avg,
				pawnsOrPlayers: healthData.aggregated.pawnsOrPlayers.avg,
				mission: healthData.aggregated.mission.avg,
				codebaseHealth: healthData.aggregated.codebaseHealth.avg,
				speed: healthData.aggregated.speed.avg,
				deliveringValue: healthData.aggregated.deliveringValue.avg,
				suitableProcess: healthData.aggregated.suitableProcess.avg,
				fun: healthData.aggregated.fun.avg
			}
		});
	}
	
	return results.reverse();
}

// ============================================================================
// BLOCKED ITEM TRACKING - "Show blocked items first in daily view"
// ============================================================================

export async function markItemBlocked(
	boardId: string,
	itemId: string,
	reason: string,
	ownerId: string,
	userId: string
): Promise<void> {
	await updateDoc(itemDoc(boardId, itemId), {
		status: 'blocked',
		blockedAt: serverTimestamp(),
		blockedReason: reason,
		blockedOwnerId: ownerId,
		updatedAt: serverTimestamp()
	});
	
	await logActivity(boardId, userId, 'item_blocked', {
		itemId,
		reason,
		ownerId
	});
}

export async function unblockItem(
	boardId: string,
	itemId: string,
	newStatus: ItemStatus,
	userId: string
): Promise<void> {
	await updateDoc(itemDoc(boardId, itemId), {
		status: newStatus,
		blockedAt: null,
		blockedReason: null,
		blockedOwnerId: null,
		updatedAt: serverTimestamp()
	});
	
	await logActivity(boardId, userId, 'item_unblocked', { itemId });
}

// Get blocked items with aging info
export async function getBlockedItems(boardId: string): Promise<Array<BacklogItem & { blockedDays: number }>> {
	const snap = await getDocs(
		query(itemsCol(boardId), where('status', '==', 'blocked'))
	);
	
	const now = Date.now();
	
	return snap.docs.map(d => {
		const item = { id: d.id, ...d.data() } as BacklogItem;
		const blockedAt = item.blockedAt?.toMillis?.() ?? now;
		const blockedDays = Math.floor((now - blockedAt) / (1000 * 60 * 60 * 24));
		return { ...item, blockedDays };
	}).sort((a, b) => b.blockedDays - a.blockedDays); // Oldest blocked first
}

// ============================================================================
// URGENT INTAKE PATH - "Simple urgent intake path while keeping PO ownership"
// ============================================================================

export async function createUrgentItem(
	boardId: string,
	data: Parameters<typeof createItem>[1] & {
		urgentReason: string;
	},
	approvingPoId: string
): Promise<string> {
	const board = await getBoard(boardId);
	if (!board) throw new Error('Board not found');
	
	// Verify approver is a PO
	if (!board.productOwnerIds.includes(approvingPoId)) {
		throw new Error('Only Product Owners can approve urgent items');
	}
	
	const itemId = await createItem(boardId, {
		...data,
		isUrgent: true,
		urgentApprovedBy: approvingPoId
	});
	
	await logActivity(boardId, approvingPoId, 'urgent_item_created', {
		itemId,
		reason: data.urgentReason
	});
	
	return itemId;
}

// ============================================================================
// YESTERDAY'S WEATHER - "Use yesterday's weather to plan capacity based on past completion"
// ============================================================================

export async function getYesterdaysWeather(boardId: string, sprintCount = 3): Promise<{
	averageVelocity: number;
	velocities: number[];
	recommendation: string;
}> {
	const sprintsSnap = await getDocs(
		query(
			sprintsCol(boardId),
			where('status', '==', 'completed'),
			orderBy('completedAt', 'desc'),
			limit(sprintCount)
		)
	);
	
	const velocities = sprintsSnap.docs
		.map(d => d.data().actualVelocity ?? d.data().velocity ?? 0)
		.filter(v => v > 0);
	
	if (velocities.length === 0) {
		return {
			averageVelocity: 0,
			velocities: [],
			recommendation: 'No completed sprints yet. Start with a conservative commitment and adjust based on actual delivery.'
		};
	}
	
	const averageVelocity = Math.round(velocities.reduce((a, b) => a + b, 0) / velocities.length);
	
	let recommendation: string;
	if (velocities.length < 3) {
		recommendation = `Based on ${velocities.length} sprint(s), your average velocity is ${averageVelocity} points. Consider this a rough estimate until you have 3+ sprints of data.`;
	} else {
		const variance = Math.max(...velocities) - Math.min(...velocities);
		if (variance > averageVelocity * 0.3) {
			recommendation = `Your velocity varies significantly (${Math.min(...velocities)}-${Math.max(...velocities)}). Plan for ${Math.round(averageVelocity * 0.85)} points to be safe.`;
		} else {
			recommendation = `Your velocity is stable around ${averageVelocity} points. You can confidently plan for this capacity.`;
		}
	}
	
	return {
		averageVelocity,
		velocities,
		recommendation
	};
}

// ============================================================================
// TEAM MEMBER MANAGEMENT - Per spec role assignments
// ============================================================================

export async function setTeamProductOwners(
	boardId: string,
	poIds: string[]
): Promise<void> {
	const board = await getBoard(boardId);
	if (!board) throw new Error('Board not found');
	
	// Update members list with PO role
	const updatedMembers = board.members.map(m => ({
		...m,
		role: poIds.includes(m.userId) ? 'product_owner' as AgileRole : m.role
	}));
	
	await updateDoc(boardDoc(boardId), {
		productOwnerIds: poIds,
		members: updatedMembers,
		updatedAt: serverTimestamp()
	});
}

export async function setTeamAgileCoach(
	boardId: string,
	coachId: string | null
): Promise<void> {
	const board = await getBoard(boardId);
	if (!board) throw new Error('Board not found');
	
	// Update members list with Coach role
	const updatedMembers = board.members.map(m => ({
		...m,
		role: m.userId === coachId ? 'agile_coach' as AgileRole : 
			(m.role === 'agile_coach' ? 'team_member' as AgileRole : m.role)
	}));
	
	await updateDoc(boardDoc(boardId), {
		agileCoachId: coachId,
		members: updatedMembers,
		updatedAt: serverTimestamp()
	});
}

export async function addTeamMember(
	boardId: string,
	userId: string,
	role: AgileRole = 'team_member',
	displayName?: string,
	email?: string
): Promise<void> {
	const board = await getBoard(boardId);
	if (!board) throw new Error('Board not found');
	
	if (board.memberIds.includes(userId)) {
		throw new Error('User is already a team member');
	}
	
	const member: TeamMember = {
		userId,
		role,
		displayName,
		email,
		joinedAt: serverTimestamp() as unknown as Timestamp
	};
	
	await updateDoc(boardDoc(boardId), {
		memberIds: arrayUnion(userId),
		members: arrayUnion(member),
		...(role === 'product_owner' ? { productOwnerIds: arrayUnion(userId) } : {}),
		...(role === 'agile_coach' ? { agileCoachId: userId } : {}),
		updatedAt: serverTimestamp()
	});
}

export async function updateTeamMemberRole(
	boardId: string,
	userId: string,
	newRole: AgileRole
): Promise<void> {
	const board = await getBoard(boardId);
	if (!board) throw new Error('Board not found');
	
	const updatedMembers = board.members.map(m => 
		m.userId === userId ? { ...m, role: newRole } : m
	);
	
	// Update PO list
	let productOwnerIds = board.productOwnerIds.filter(id => id !== userId);
	if (newRole === 'product_owner') {
		productOwnerIds = [...productOwnerIds, userId];
	}
	
	// Update coach
	let agileCoachId = board.agileCoachId === userId ? null : board.agileCoachId;
	if (newRole === 'agile_coach') {
		agileCoachId = userId;
	}
	
	await updateDoc(boardDoc(boardId), {
		members: updatedMembers,
		productOwnerIds,
		agileCoachId,
		updatedAt: serverTimestamp()
	});
}

export async function removeTeamMember(
	boardId: string,
	userId: string
): Promise<void> {
	const board = await getBoard(boardId);
	if (!board) throw new Error('Board not found');
	
	const member = board.members.find(m => m.userId === userId);
	if (!member) return;
	
	await updateDoc(boardDoc(boardId), {
		memberIds: arrayRemove(userId),
		members: arrayRemove(member),
		productOwnerIds: arrayRemove(userId),
		...(board.agileCoachId === userId ? { agileCoachId: null } : {}),
		updatedAt: serverTimestamp()
	});
}
