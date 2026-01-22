<!-- Support Dashboard - Engineer Multi-Ticket Management -->
<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { getDb } from '$lib/firebase';
	import { user, userProfile } from '$lib/stores/user';
	import { serverMemberships } from '$lib/stores';
	import { isMobileViewport } from '$lib/stores/viewport';
	import type { Membership } from '$lib/types';
	import {
		doc,
		onSnapshot,
		collection,
		query,
		where,
		updateDoc,
		serverTimestamp,
		getDoc,
		getDocs,
		type Unsubscribe,
		type Timestamp
	} from 'firebase/firestore';
	import { toggleChannelReaction } from '$lib/firestore/messages';
	import { subscribeUserServers } from '$lib/firestore/servers';
	import {
		streamThreadMessages,
		markThreadRead,
		sendThreadMessage,
		createChannelThread,
		type ThreadMessage
	} from '$lib/firestore/threads';

	// Types
	type IssueStatus = 'opened' | 'in_progress' | 'closed';
	type IssueUrgency = 'critical' | 'high' | 'medium' | 'low';
	type TicketIssue = {
		id: string;
		serverId: string;
		channelId: string;
		threadId: string;
		parentMessageId?: string | null;
		authorId?: string | null;
		authorName?: string | null;
		summary: string;
		status: IssueStatus;
		typeTag?: string | null;
		staffMemberIds?: string[];
		createdAt?: Timestamp;
		messageCount?: number;
		lastMessageAt?: Timestamp | null;
	};

	type ServerInfo = {
		id: string;
		name: string;
		icon?: string | null;
		enabled: boolean;
	};

	type OpenTicket = {
		issue: TicketIssue;
		serverName: string;
		channelName: string;
		messages: ThreadMessage[];
		loading: boolean;
		sending: boolean;
		inputText: string;
		unsubMessages?: Unsubscribe | null;
	};

	type QuickResponse = {
		id: string;
		title: string;
		content: string;
	};

	type ClientOption = {
		value: string;
		label: string;
	};

	// Storage keys
	const OPEN_TICKETS_STORAGE_KEY = 'hconnect:support:openTickets';
	const QUICK_RESPONSES_STORAGE_KEY = 'hconnect:support:quickResponses';

	// Default quick responses
	const DEFAULT_QUICK_RESPONSES: QuickResponse[] = [
		{
			id: 'password-reset',
			title: 'Password Reset',
			content: 'To reset your password:\n1. Go to the login page\n2. Click "Forgot Password"\n3. Enter your email address\n4. Check your inbox for the reset link\n5. Click the link and create a new password\n\nIf you don\'t receive the email within 5 minutes, please check your spam folder.'
		},
		{
			id: 'checking-issue',
			title: 'Checking on Issue',
			content: 'Thank you for reporting this issue. I\'m currently looking into it and will update you shortly with more information.'
		},
		{
			id: 'need-more-info',
			title: 'Need More Info',
			content: 'To help resolve your issue, could you please provide:\n- What you were trying to do\n- What happened instead\n- Any error messages you saw\n- Your browser/device info'
		}
	];

	// State
	let loading = $state(true);
	let staffServers = $state<ServerInfo[]>([]);
	let serverIssuesMap = $state<Record<string, TicketIssue[]>>({});
	let serverUnsubs: Record<string, { settings: Unsubscribe | null; issues: Unsubscribe | null }> = {};
	let serversUnsub: Unsubscribe | null = null;
	let channelNames = $state<Record<string, string>>({});
	let openTickets = $state<OpenTicket[]>([]);
	let sidebarFilter = $state<'unassigned' | 'mine' | 'all'>('unassigned');
	let clientFilters = $state<string[]>(['all']);
	let sidebarCollapsed = $state(false);
	let focusedTicketId = $state<string | null>(null);
	let mobileActiveTicket = $state<string | null>(null);
	let restoredOpenTickets = $state(false);
	let selectedSidebarIndex = $state(0);

	// Quick responses state
	let quickResponses = $state<QuickResponse[]>([]);
	let showQuickResponsePopup = $state<string | null>(null); // ticket id or null
	let showQuickResponseEditor = $state(false);
	let editingResponse = $state<QuickResponse | null>(null);
	let newResponseTitle = $state('');
	let newResponseContent = $state('');

	// Slash command autocomplete state (like @mentions)
	let slashMenuActive = $state<string | null>(null); // ticket id when slash menu is open
	let slashMenuQuery = $state('');
	let slashMenuSelectedIndex = $state(0);

	// Client filter dropdown state
	let clientMenuOpen = $state(false);
	let clientMenuAnchor: HTMLDivElement | null = null;

	// Track which textareas are expanded (multi-line)
	let expandedTextareas = $state<Set<string>>(new Set());
	
	// Store refs to textareas for programmatic resize
	let textareaRefs = $state<Record<string, HTMLTextAreaElement | null>>({});

	// Auto-resize textarea to fit content
	function syncTextareaSize(textarea: HTMLTextAreaElement | null, ticketId: string) {
		if (!textarea) return;
		const minHeight = 40; // ~2.5rem
		const maxHeight = 160; // ~10rem max before scrolling
		textarea.style.height = 'auto';
		const scrollHeight = textarea.scrollHeight;
		const nextHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
		textarea.style.height = `${nextHeight}px`;
		
		const isExpanded = nextHeight > minHeight + 2;
		if (isExpanded && !expandedTextareas.has(ticketId)) {
			expandedTextareas = new Set([...expandedTextareas, ticketId]);
		} else if (!isExpanded && expandedTextareas.has(ticketId)) {
			const newSet = new Set(expandedTextareas);
			newSet.delete(ticketId);
			expandedTextareas = newSet;
		}
		
		textarea.style.overflowY = scrollHeight > nextHeight ? 'auto' : 'hidden';
	}
	
	// Sync textarea sizes when ticket input text changes (e.g., from quick responses)
	$effect(() => {
		for (const ticket of openTickets) {
			const textarea = textareaRefs[ticket.issue.id];
			if (textarea && ticket.inputText !== undefined) {
				// Use requestAnimationFrame to ensure DOM has updated
				requestAnimationFrame(() => syncTextareaSize(textarea, ticket.issue.id));
			}
		}
	});

	// Filtered quick responses for slash command - show 3 by default, filter by title when typing
	const slashMenuResults = $derived.by(() => {
		if (!slashMenuActive) return [];
		if (!slashMenuQuery) {
			// Show up to 3 most recent quick responses when no query
			return quickResponses.slice(0, 3);
		}
		const q = slashMenuQuery.toLowerCase();
		return quickResponses
			.filter((r) => r.title.toLowerCase().includes(q))
			.slice(0, 5); // Limit filtered results too
	});

	// Sound notification state
	let previousTicketCount = $state(0);
	let notificationSound: HTMLAudioElement | null = null;
	let soundEnabled = $state(true);

	const mobileViewport = $derived($isMobileViewport);

	// Derived ticket lists
	const allIssues = $derived.by(() => {
		const all: TicketIssue[] = [];
		for (const serverId of Object.keys(serverIssuesMap)) {
			all.push(...serverIssuesMap[serverId]);
		}
		// Sort by creation time, newest first
		return all.sort((a, b) => {
			const aTime = a.createdAt?.toMillis?.() ?? 0;
			const bTime = b.createdAt?.toMillis?.() ?? 0;
			return bTime - aTime;
		});
	});

	const unassignedIssues = $derived(allIssues.filter((i) => (i.staffMemberIds?.length ?? 0) === 0));
	const myIssues = $derived(allIssues.filter((i) => i.staffMemberIds?.includes($user?.uid ?? '')));

	const baseFilteredIssues = $derived.by(() => {
		if (sidebarFilter === 'unassigned') return unassignedIssues;
		if (sidebarFilter === 'mine') return myIssues;
		return allIssues;
	});

	const clientOptions = $derived.by((): ClientOption[] => {
		const counts = new Map<string, number>();
		for (const issue of allIssues) {
			counts.set(issue.serverId, (counts.get(issue.serverId) ?? 0) + 1);
		}
		return staffServers
			.filter((server) => counts.has(server.id))
			.map((server) => ({
				value: server.id,
				label: server.name
			}))
			.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
	});

	const allClientsSelected = $derived.by(
		() => clientFilters.length === 0 || clientFilters.includes('all')
	);

	const activeClientFilters = $derived.by(
		() => new Set(clientFilters.filter((value) => value !== 'all'))
	);

	const clientFilterLabel = $derived.by(() => {
		if (allClientsSelected) return 'All clients';
		const selected = clientOptions
			.filter((option) => activeClientFilters.has(option.value))
			.map((option) => option.label);
		if (selected.length === 0) return 'All clients';
		if (selected.length === 1) return selected[0];
		return `${selected[0]} +${selected.length - 1}`;
	});

	const filteredIssues = $derived.by(() => {
		if (allClientsSelected || activeClientFilters.size === 0) return baseFilteredIssues;
		return baseFilteredIssues.filter((issue) => activeClientFilters.has(issue.serverId));
	});

	$effect(() => {
		const valid = new Set(clientOptions.map((option) => option.value));
		let next = clientFilters.filter((value) => value === 'all' || valid.has(value));
		if (next.length === 0) {
			clientFilters = ['all'];
			return;
		}
		if (next.includes('all') && next.length > 1) {
			next = ['all'];
		}
		if (next.length !== clientFilters.length) {
			clientFilters = next;
		}
	});

	// Group issues by server for sidebar
	const issuesByServer = $derived.by(() => {
		const grouped: Record<string, { server: ServerInfo; issues: TicketIssue[] }> = {};
		for (const issue of filteredIssues) {
			const server = staffServers.find((s) => s.id === issue.serverId);
			if (!server) continue;
			if (!grouped[issue.serverId]) {
				grouped[issue.serverId] = { server, issues: [] };
			}
			grouped[issue.serverId].issues.push(issue);
		}
		return grouped;
	});

	// Calculate urgency based on age and activity
	function getUrgency(issue: TicketIssue): IssueUrgency {
		const ageMs = Date.now() - (issue.createdAt?.toMillis?.() ?? Date.now());
		const ageHours = ageMs / (1000 * 60 * 60);
		const isUnassigned = (issue.staffMemberIds?.length ?? 0) === 0;

		if (isUnassigned && ageHours > 24) return 'critical';
		if (isUnassigned && ageHours > 4) return 'high';
		if (ageHours > 48) return 'high';
		if (ageHours > 12) return 'medium';
		return 'low';
	}

	function getUrgencyColor(urgency: IssueUrgency): string {
		switch (urgency) {
			case 'critical':
				return '#ef4444';
			case 'high':
				return '#fb923c';
			case 'medium':
				return '#eab308';
			case 'low':
				return '#22c55e';
		}
	}

	// Server staff access check - checks admin/owner role
	function isServerAdminOrOwner(serverId: string, uid: string): boolean {
		const memberships = $serverMemberships as Membership[];
		const membership = memberships.find((m) => m.serverId === serverId && m.userId === uid);
		return membership?.role === 'admin' || membership?.role === 'owner';
	}

	// Fetch channel name
	async function fetchChannelName(serverId: string, channelId: string): Promise<string> {
		if (channelNames[channelId]) return channelNames[channelId];
		try {
			const db = getDb();
			const channelDoc = await getDoc(doc(db, 'servers', serverId, 'channels', channelId));
			if (channelDoc.exists()) {
				const name = channelDoc.data()?.name ?? 'unknown';
				channelNames = { ...channelNames, [channelId]: name };
				return name;
			}
			channelNames = { ...channelNames, [channelId]: 'deleted' };
			return 'deleted';
		} catch {
			channelNames = { ...channelNames, [channelId]: 'unknown' };
			return 'unknown';
		}
	}

	// Subscribe to servers and issues
	async function subscribeToServers(uid: string, email: string) {
		const db = getDb();

		serversUnsub = subscribeUserServers(uid, async (rows) => {
			const toUnsubscribe = new Set(Object.keys(serverUnsubs));

			for (const row of rows ?? []) {
				const serverId = row.id;
				toUnsubscribe.delete(serverId);

				const adminOrOwner = isServerAdminOrOwner(serverId, uid);

				// Subscribe to ticket settings if not already
				if (!serverUnsubs[serverId]) {
					serverUnsubs[serverId] = { settings: null, issues: null };

					// Settings subscription - same path as TicketFab
					serverUnsubs[serverId].settings = onSnapshot(
						doc(db, 'servers', serverId, 'ticketAiSettings', 'current'),
						(snap) => {
							const data = snap.data();
							const staffMemberIds = Array.isArray(data?.staffMemberIds) ? data.staffMemberIds : [];
							const staffDomains = Array.isArray(data?.staffDomains) ? data.staffDomains : [];
							const serverEnabled = data?.enabled ?? false;

							// Check if user is staff (same logic as TicketFab)
							let userIsStaff = false;
							if (adminOrOwner) {
								userIsStaff = true;
							} else if (staffMemberIds.includes(uid)) {
								userIsStaff = true;
							} else if (staffDomains.length && email) {
								const domain = email.split('@')[1]?.toLowerCase();
								if (domain && staffDomains.some((d: string) => d.toLowerCase().replace('@', '') === domain)) {
									userIsStaff = true;
								}
							}

							if (userIsStaff) {
								// Update or add server to staffServers
								const existingIdx = staffServers.findIndex((s) => s.id === serverId);
								if (existingIdx >= 0) {
									staffServers[existingIdx].enabled = serverEnabled;
									staffServers[existingIdx].name = row.name;
									staffServers = [...staffServers];
								} else {
									staffServers = [...staffServers, {
										id: serverId,
										name: row.name,
										icon: row.icon ?? null,
										enabled: serverEnabled
									}];
								}

								// Subscribe to issues if enabled - same path as TicketFab
								if (serverEnabled && !serverUnsubs[serverId]?.issues) {
									const issuesQuery = query(
										collection(db, 'servers', serverId, 'ticketAiIssues'),
										where('status', 'in', ['opened', 'in_progress'])
									);

									serverUnsubs[serverId].issues = onSnapshot(issuesQuery, (issueSnap) => {
										const issues: TicketIssue[] = issueSnap.docs.map((d) => ({
											id: d.id,
											serverId,
											...d.data()
										})) as TicketIssue[];

										serverIssuesMap = { ...serverIssuesMap, [serverId]: issues };

										// Fetch channel names for new issues
										issues.forEach((issue) => {
											fetchChannelName(serverId, issue.channelId);
										});
									});
								} else if (!serverEnabled && serverUnsubs[serverId]?.issues) {
									serverUnsubs[serverId].issues?.();
									serverUnsubs[serverId].issues = null;
									serverIssuesMap = { ...serverIssuesMap, [serverId]: [] };
								}
							} else {
								// Remove from staffServers if not staff
								staffServers = staffServers.filter(s => s.id !== serverId);
								serverUnsubs[serverId]?.issues?.();
								if (serverUnsubs[serverId]) {
									serverUnsubs[serverId].issues = null;
								}
								const { [serverId]: _, ...rest } = serverIssuesMap;
								serverIssuesMap = rest;
							}

							loading = false;
						},
						(error) => {
							console.warn('[Support] Settings error for server', serverId, ':', error.code);
							loading = false;
							// If admin/owner, still show as staff
							if (adminOrOwner) {
								const existing = staffServers.find(s => s.id === serverId);
								if (!existing) {
									staffServers = [...staffServers, {
										id: serverId,
										name: row.name,
										icon: row.icon ?? null,
										enabled: false
									}];
								}
							}
						}
					);
				}
			}

			// Cleanup old subscriptions
			for (const serverId of toUnsubscribe) {
				serverUnsubs[serverId]?.settings?.();
				serverUnsubs[serverId]?.issues?.();
				delete serverUnsubs[serverId];
				const { [serverId]: _, ...rest } = serverIssuesMap;
				serverIssuesMap = rest;
				staffServers = staffServers.filter(s => s.id !== serverId);
			}

			loading = false;
		});
	}

	// Open a ticket in a new panel
	async function openTicket(issue: TicketIssue) {
		// Check if already open
		const existingIdx = openTickets.findIndex((t) => t.issue.id === issue.id);
		if (existingIdx >= 0) {
			focusedTicketId = issue.id;
			if (mobileViewport) mobileActiveTicket = issue.id;
			return;
		}

		const server = staffServers.find((s) => s.id === issue.serverId);
		const channelName = await fetchChannelName(issue.serverId, issue.channelId);

		const newTicket: OpenTicket = {
			issue,
			serverName: server?.name ?? 'Unknown',
			channelName,
			messages: [],
			loading: true,
			sending: false,
			inputText: ''
		};

		openTickets = [...openTickets, newTicket];
		focusedTicketId = issue.id;
		if (mobileViewport) mobileActiveTicket = issue.id;

		// Ensure we have a threadId - create one if missing
		let threadId = issue.threadId;
		if (!threadId && issue.parentMessageId) {
			try {
				const uid = $user?.uid;
				const displayName = $user?.displayName ?? $userProfile?.displayName ?? 'Staff';
				
				threadId = await createChannelThread({
					serverId: issue.serverId,
					channelId: issue.channelId,
					sourceMessageId: issue.parentMessageId,
					sourceMessageText: issue.summary?.slice(0, 100),
					creator: { uid: uid ?? '', displayName },
					initialMentions: issue.authorId ? [issue.authorId] : []
				});

				// Update the issue with the new threadId
				const db = getDb();
				const issueRef = doc(db, 'servers', issue.serverId, 'ticketAiIssues', issue.id);
				await updateDoc(issueRef, { threadId });

				// Update local issue reference
				issue.threadId = threadId;
				const idx = openTickets.findIndex((t) => t.issue.id === issue.id);
				if (idx >= 0) {
					openTickets[idx].issue.threadId = threadId;
				}
			} catch (err) {
				console.error('[Support] Failed to create thread:', err);
				// Mark as not loading with error
				const idx = openTickets.findIndex((t) => t.issue.id === issue.id);
				if (idx >= 0) {
					openTickets[idx].loading = false;
					openTickets = [...openTickets];
				}
				return;
			}
		}

		if (!threadId) {
			console.warn('[Support] No threadId available for issue:', issue.id);
			const idx = openTickets.findIndex((t) => t.issue.id === issue.id);
			if (idx >= 0) {
				openTickets[idx].loading = false;
				openTickets = [...openTickets];
			}
			return;
		}

		// Subscribe to messages
		const unsub = streamThreadMessages(
			issue.serverId,
			issue.channelId,
			threadId,
			(msgs) => {
				const idx = openTickets.findIndex((t) => t.issue.id === issue.id);
				if (idx >= 0) {
					openTickets[idx].messages = msgs;
					openTickets[idx].loading = false;
					openTickets = [...openTickets];
				}
			}
		);

		const idx = openTickets.findIndex((t) => t.issue.id === issue.id);
		if (idx >= 0) {
			openTickets[idx].unsubMessages = unsub;
		}
	}

	// Close a ticket panel
	function closeTicket(issueId: string) {
		const idx = openTickets.findIndex((t) => t.issue.id === issueId);
		if (idx >= 0) {
			openTickets[idx].unsubMessages?.();
			openTickets = openTickets.filter((t) => t.issue.id !== issueId);
		}
		if (focusedTicketId === issueId) {
			focusedTicketId = openTickets[0]?.issue.id ?? null;
		}
		if (mobileActiveTicket === issueId) {
			mobileActiveTicket = null;
		}
	}

	// Claim a ticket
	async function claimTicket(issue: TicketIssue) {
		const uid = $user?.uid;
		if (!uid) return;

		try {
			const db = getDb();
			const issueRef = doc(db, 'servers', issue.serverId, 'ticketAiIssues', issue.id);

			await updateDoc(issueRef, {
				staffMemberIds: [uid],
				status: 'in_progress'
			});
		} catch (err) {
			console.error('[Support] Failed to claim ticket:', err);
		}
	}

	// Resolve a ticket
	async function resolveTicket(issue: TicketIssue) {
		try {
			const db = getDb();
			const issueRef = doc(db, 'servers', issue.serverId, 'ticketAiIssues', issue.id);

			await updateDoc(issueRef, {
				status: 'closed',
				closedAt: serverTimestamp()
			});

			// Add checkmark reaction to parent message if exists
			if (issue.parentMessageId && $user?.uid) {
				try {
					await toggleChannelReaction(
						issue.serverId,
						issue.channelId,
						issue.parentMessageId,
						$user.uid,
						'✅'
					);
				} catch {
					// Reaction failed, but ticket is resolved
				}
			}

			closeTicket(issue.id);
		} catch (err) {
			console.error('[Support] Failed to resolve ticket:', err);
		}
	}

	// Send message in ticket
	async function sendMessage(ticket: OpenTicket) {
		const text = ticket.inputText.trim();
		const uid = $user?.uid;
		const displayName = $userProfile?.displayName ?? $user?.displayName ?? 'Staff';
		const photoURL = $userProfile?.photoURL ?? $user?.photoURL ?? null;
		
		if (!text || ticket.sending || !uid) return;

		// Need a threadId to send messages
		if (!ticket.issue.threadId) {
			console.error('[Support] Cannot send message: no threadId for ticket', ticket.issue.id);
			return;
		}

		const idx = openTickets.findIndex((t) => t.issue.id === ticket.issue.id);
		if (idx < 0) return;

		openTickets[idx].sending = true;
		openTickets[idx].inputText = '';
		openTickets = [...openTickets];

		try {
			await sendThreadMessage({
				serverId: ticket.issue.serverId,
				channelId: ticket.issue.channelId,
				threadId: ticket.issue.threadId,
				message: { 
					text,
					uid,
					displayName,
					photoURL
				}
			});
		} catch (err) {
			console.error('[Support] Failed to send message:', err);
			openTickets[idx].inputText = text;
		} finally {
			openTickets[idx].sending = false;
			openTickets = [...openTickets];
		}
	}

	// Navigate to ticket in channel
	function goToTicket(issue: TicketIssue) {
		goto(`/servers/${issue.serverId}?channel=${issue.channelId}&thread=${issue.threadId}`);
	}

	// Format time ago
	function formatTimeAgo(timestamp?: Timestamp | null): string {
		if (!timestamp) return '';
		const ms = Date.now() - (timestamp.toMillis?.() ?? 0);
		const mins = Math.floor(ms / 60000);
		if (mins < 1) return 'now';
		if (mins < 60) return `${mins}m`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h`;
		const days = Math.floor(hours / 24);
		return `${days}d`;
	}

	// Truncate text
	function truncate(text: string, max = 60): string {
		if (!text) return '';
		return text.length > max ? text.slice(0, max) + '…' : text;
	}

	// Save open ticket IDs to localStorage
	function saveOpenTicketIds() {
		if (!browser) return;
		const ids = openTickets.map((t) => t.issue.id);
		localStorage.setItem(OPEN_TICKETS_STORAGE_KEY, JSON.stringify(ids));
	}

	// Load saved open ticket IDs from localStorage
	function loadSavedTicketIds(): string[] {
		if (!browser) return [];
		try {
			const raw = localStorage.getItem(OPEN_TICKETS_STORAGE_KEY);
			if (!raw) return [];
			const ids = JSON.parse(raw);
			return Array.isArray(ids) ? ids : [];
		} catch {
			return [];
		}
	}

	// Restore open tickets from saved IDs
	async function restoreOpenTickets() {
		if (restoredOpenTickets) return;
		restoredOpenTickets = true;

		const savedIds = loadSavedTicketIds();
		if (savedIds.length === 0) return;

		// Find issues that match saved IDs
		for (const issueId of savedIds) {
			const issue = allIssues.find((i) => i.id === issueId);
			if (issue) {
				await openTicket(issue);
			}
		}
	}

	// Effect to save open tickets when they change
	$effect(() => {
		if (browser && openTickets.length >= 0) {
			saveOpenTicketIds();
		}
	});

	// Effect to restore open tickets once issues are loaded
	$effect(() => {
		if (!loading && allIssues.length > 0 && !restoredOpenTickets) {
			restoreOpenTickets();
		}
	});

	// ============ Quick Responses ============

	// Load quick responses from localStorage
	function loadQuickResponses() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(QUICK_RESPONSES_STORAGE_KEY);
			if (raw) {
				const saved = JSON.parse(raw);
				if (Array.isArray(saved) && saved.length > 0) {
					quickResponses = saved;
					return;
				}
			}
		} catch {
			// Use defaults
		}
		quickResponses = [...DEFAULT_QUICK_RESPONSES];
	}

	// Save quick responses to localStorage
	function saveQuickResponses() {
		if (!browser) return;
		localStorage.setItem(QUICK_RESPONSES_STORAGE_KEY, JSON.stringify(quickResponses));
	}

	// Add a new quick response
	function addQuickResponse() {
		if (!newResponseTitle.trim() || !newResponseContent.trim()) return;
		const newResponse: QuickResponse = {
			id: `custom-${Date.now()}`,
			title: newResponseTitle.trim(),
			content: newResponseContent.trim()
		};
		quickResponses = [...quickResponses, newResponse];
		saveQuickResponses();
		newResponseTitle = '';
		newResponseContent = '';
		showQuickResponseEditor = false;
	}

	// Update an existing quick response
	function updateQuickResponse() {
		if (!editingResponse || !newResponseTitle.trim() || !newResponseContent.trim()) return;
		quickResponses = quickResponses.map((r) =>
			r.id === editingResponse!.id
				? { ...r, title: newResponseTitle.trim(), content: newResponseContent.trim() }
				: r
		);
		saveQuickResponses();
		editingResponse = null;
		newResponseTitle = '';
		newResponseContent = '';
		showQuickResponseEditor = false;
	}

	// Delete a quick response
	function deleteQuickResponse(id: string) {
		quickResponses = quickResponses.filter((r) => r.id !== id);
		saveQuickResponses();
	}

	// Start editing a response
	function startEditingResponse(response: QuickResponse) {
		editingResponse = response;
		newResponseTitle = response.title;
		newResponseContent = response.content;
		showQuickResponseEditor = true;
	}

	// Insert quick response into ticket input
	function insertQuickResponse(ticketId: string, content: string) {
		const idx = openTickets.findIndex((t) => t.issue.id === ticketId);
		if (idx >= 0) {
			openTickets[idx].inputText = content;
			openTickets = [...openTickets];
		}
		showQuickResponsePopup = null;
		slashMenuActive = null;
		slashMenuQuery = '';
		slashMenuSelectedIndex = 0;
	}

	// Handle input changes for slash command detection
	function handleInputChange(ticketId: string, value: string) {
		const idx = openTickets.findIndex((t) => t.issue.id === ticketId);
		if (idx >= 0) {
			openTickets[idx].inputText = value;
			openTickets = [...openTickets];
		}

		// Check for slash command trigger
		// Detect "/" at start of input or after a space, with optional query after
		let slashPos = -1;
		
		if (value.startsWith('/')) {
			slashPos = 0;
		} else {
			// Find last occurrence of " /"
			const spaceSlashIdx = value.lastIndexOf(' /');
			if (spaceSlashIdx >= 0) {
				slashPos = spaceSlashIdx + 1; // Position of the /
			}
		}
		
		if (slashPos >= 0) {
			const afterSlash = value.slice(slashPos + 1);
			// Only show menu if no space after the slash (still typing the command)
			if (!afterSlash.includes(' ')) {
				slashMenuActive = ticketId;
				slashMenuQuery = afterSlash;
				slashMenuSelectedIndex = 0;
				return;
			}
		}
		
		// Close menu if it was open for this ticket
		if (slashMenuActive === ticketId) {
			slashMenuActive = null;
			slashMenuQuery = '';
			slashMenuSelectedIndex = 0;
		}
	}

	// Handle keyboard navigation for slash commands
	function handleSlashKeydown(e: KeyboardEvent, ticketId: string) {
		if (slashMenuActive !== ticketId) return false;

		const results = slashMenuResults;
		if (results.length === 0) return false;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			slashMenuSelectedIndex = (slashMenuSelectedIndex + 1) % results.length;
			return true;
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			slashMenuSelectedIndex = (slashMenuSelectedIndex - 1 + results.length) % results.length;
			return true;
		}
		if (e.key === 'Tab' || e.key === 'Enter') {
			e.preventDefault();
			const selected = results[slashMenuSelectedIndex];
			if (selected) {
				const idx = openTickets.findIndex((t) => t.issue.id === ticketId);
				if (idx >= 0) {
					const currentText = openTickets[idx].inputText;
					// Find and replace the /query portion
					let newText: string;
					if (currentText.startsWith('/')) {
						// Replace from start
						newText = selected.content;
					} else {
						// Find last " /" and replace from there
						const spaceSlashIdx = currentText.lastIndexOf(' /');
						if (spaceSlashIdx >= 0) {
							newText = currentText.slice(0, spaceSlashIdx + 1) + selected.content;
						} else {
							newText = selected.content;
						}
					}
					openTickets[idx].inputText = newText;
					openTickets = [...openTickets];
				}
				slashMenuActive = null;
				slashMenuQuery = '';
				slashMenuSelectedIndex = 0;
			}
			return true;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			slashMenuActive = null;
			slashMenuQuery = '';
			return true;
		}
		return false;
	}

	function toggleClientMenu() {
		clientMenuOpen = !clientMenuOpen;
	}

	function toggleClientFilter(value: string) {
		if (value === 'all') {
			clientFilters = ['all'];
			return;
		}
		const next = new Set(clientFilters.filter((entry) => entry !== 'all'));
		if (next.has(value)) {
			next.delete(value);
		} else {
			next.add(value);
		}
		clientFilters = next.size > 0 ? Array.from(next) : ['all'];
	}

	function handleClientMenuKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			clientMenuOpen = false;
		}
	}

	// ============ Sound Notifications ============

	// Initialize notification sound
	function initNotificationSound() {
		if (!browser) return;
		try {
			notificationSound = new Audio('/sounds/notification.mp3');
			notificationSound.volume = 0.5;
		} catch {
			// Sound not available
		}
	}

	// Play notification sound for new tickets
	function playNewTicketSound() {
		if (!soundEnabled || !notificationSound) return;
		try {
			notificationSound.currentTime = 0;
			notificationSound.play().catch(() => {});
		} catch {
			// Ignore audio errors
		}
	}

	// Effect to play sound when new unassigned tickets arrive
	$effect(() => {
		const currentCount = unassignedIssues.length;
		if (previousTicketCount > 0 && currentCount > previousTicketCount) {
			playNewTicketSound();
		}
		previousTicketCount = currentCount;
	});

	// ============ Keyboard Shortcuts ============

	function handleKeydown(event: KeyboardEvent) {
		// Don't handle shortcuts when typing in input fields
		const target = event.target as HTMLElement;
		const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
		
		if (isInput) {
			// Only Escape works in inputs
			if (event.key === 'Escape') {
				event.preventDefault();
				(target as HTMLElement).blur();
				showQuickResponsePopup = null;
				showQuickResponseEditor = false;
			}
			return;
		}

		// Close popup on Escape
		if (event.key === 'Escape') {
			if (showQuickResponsePopup) {
				showQuickResponsePopup = null;
				return;
			}
			if (showQuickResponseEditor) {
				showQuickResponseEditor = false;
				editingResponse = null;
				return;
			}
			if (focusedTicketId) {
				closeTicket(focusedTicketId);
				return;
			}
		}

		// J - Navigate down in ticket list
		if (event.key === 'j' || event.key === 'J') {
			event.preventDefault();
			if (filteredIssues.length > 0) {
				selectedSidebarIndex = Math.min(selectedSidebarIndex + 1, filteredIssues.length - 1);
			}
		}

		// K - Navigate up in ticket list
		if (event.key === 'k' || event.key === 'K') {
			event.preventDefault();
			if (filteredIssues.length > 0) {
				selectedSidebarIndex = Math.max(selectedSidebarIndex - 1, 0);
			}
		}

		// O - Open selected ticket
		if (event.key === 'o' || event.key === 'O') {
			event.preventDefault();
			const issue = filteredIssues[selectedSidebarIndex];
			if (issue) {
				openTicket(issue);
			}
		}

		// R - Focus reply input for focused ticket
		if (event.key === 'r' || event.key === 'R') {
			if (focusedTicketId) {
				event.preventDefault();
				const panel = document.querySelector('.ticket-panel--focused');
				const input = panel?.querySelector('input[type="text"]') as HTMLInputElement;
				if (input) {
					input.focus();
				}
			}
		}

		// D - Mark focused ticket as done/resolved
		if (event.key === 'd' || event.key === 'D') {
			if (focusedTicketId) {
				event.preventDefault();
				const ticket = openTickets.find((t) => t.issue.id === focusedTicketId);
				if (ticket) {
					resolveTicket(ticket.issue);
				}
			}
		}

		// A - Assign focused ticket to self
		if (event.key === 'a' || event.key === 'A') {
			if (focusedTicketId) {
				event.preventDefault();
				const ticket = openTickets.find((t) => t.issue.id === focusedTicketId);
				if (ticket && !ticket.issue.staffMemberIds?.includes($user?.uid ?? '')) {
					claimTicket(ticket.issue);
				}
			}
		}

		// ? - Show keyboard shortcuts help
		if (event.key === '?') {
			event.preventDefault();
			// Could show a help modal here
		}
	}

	onMount(() => {
		// Initialize quick responses
		loadQuickResponses();
		
		// Initialize notification sound
		initNotificationSound();
		
		// Add keyboard listener
		if (browser) {
			window.addEventListener('keydown', handleKeydown);
		}

		const handlePointerDown = (event: PointerEvent) => {
			if (!clientMenuOpen || !clientMenuAnchor) return;
			const target = event.target as Node | null;
			if (target && !clientMenuAnchor.contains(target)) {
				clientMenuOpen = false;
			}
		};

		const unsubUser = user.subscribe((u) => {
			if (u?.uid) {
				subscribeToServers(u.uid, u.email ?? '');
			}
		});

		window.addEventListener('pointerdown', handlePointerDown);

		return () => {
			unsubUser();
			serversUnsub?.();
			for (const serverId of Object.keys(serverUnsubs)) {
				serverUnsubs[serverId]?.settings?.();
				serverUnsubs[serverId]?.issues?.();
			}
			for (const ticket of openTickets) {
				ticket.unsubMessages?.();
			}
			if (browser) {
				window.removeEventListener('keydown', handleKeydown);
			}
			window.removeEventListener('pointerdown', handlePointerDown);
		};
	});
</script>

<div class="support-wrapper">
<div class="support-dashboard" class:support-dashboard--mobile={mobileViewport}>
	<!-- Header -->
	<header class="support-header">
		<div class="support-header__left">
			<div class="support-header__title">
				<i class="bx bx-support"></i>
				<span>Support Dashboard</span>
			</div>
		</div>
		<div class="support-header__stats">
			<div class="support-stat">
				<span class="support-stat__value">{unassignedIssues.length}</span>
				<span class="support-stat__label">Unassigned</span>
			</div>
			<div class="support-stat support-stat--mine">
				<span class="support-stat__value">{myIssues.length}</span>
				<span class="support-stat__label">My Tickets</span>
			</div>
			<div class="support-stat">
				<span class="support-stat__value">{allIssues.length}</span>
				<span class="support-stat__label">Total Open</span>
			</div>
		</div>
		<div class="support-header__actions">
			{#if !mobileViewport}
				<button
					type="button"
					class="support-header__btn"
					onclick={() => (soundEnabled = !soundEnabled)}
					title={soundEnabled ? 'Disable new ticket sounds' : 'Enable new ticket sounds'}
				>
					<i class="bx {soundEnabled ? 'bx-volume-full' : 'bx-volume-mute'}"></i>
				</button>
				<div class="keyboard-hint" title="Keyboard shortcuts: J/K navigate, O open, R reply, D done, A assign, Esc close">
					<i class="bx bx-keyboard"></i>
					<span>?</span>
				</div>
				<button
					type="button"
					class="support-header__toggle"
					onclick={() => (sidebarCollapsed = !sidebarCollapsed)}
					title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
				>
					<i class="bx {sidebarCollapsed ? 'bx-menu' : 'bx-menu-alt-right'}"></i>
				</button>
			{/if}
		</div>
	</header>

	<div class="support-body">
		<!-- Sidebar - Ticket Queue -->
		{#if !mobileViewport || !mobileActiveTicket}
			<aside
				class="support-sidebar"
				class:support-sidebar--collapsed={sidebarCollapsed && !mobileViewport}
			>
				<div class="support-sidebar__header">
					<h3>Ticket Queue</h3>
				</div>

				<!-- Filters -->
				<div class="support-sidebar__filters">
					<div class="support-sidebar__filter-row">
						<button
							type="button"
							class="filter-btn"
							class:filter-btn--active={sidebarFilter === 'unassigned'}
							onclick={() => (sidebarFilter = 'unassigned')}
						>
							Unassigned ({unassignedIssues.length})
						</button>
						<button
							type="button"
							class="filter-btn"
							class:filter-btn--active={sidebarFilter === 'mine'}
							onclick={() => (sidebarFilter = 'mine')}
						>
							Mine ({myIssues.length})
						</button>
						<button
							type="button"
							class="filter-btn"
							class:filter-btn--active={sidebarFilter === 'all'}
							onclick={() => (sidebarFilter = 'all')}
						>
							All ({allIssues.length})
						</button>
					</div>
					<div class="support-sidebar__filter-row support-sidebar__filter-row--select">
						<label class="filter-label" for="client-filter">Client</label>
						<div
							class="filter-select"
							class:filter-select--open={clientMenuOpen}
							bind:this={clientMenuAnchor}
						>
							<i class="bx bx-server filter-select__icon" aria-hidden="true"></i>
							<button
								id="client-filter"
								type="button"
								class="filter-select__trigger"
								aria-haspopup="listbox"
								aria-expanded={clientMenuOpen}
								onclick={toggleClientMenu}
								onkeydown={handleClientMenuKeydown}
							>
								<span class="filter-select__label">{clientFilterLabel}</span>
								<i class="bx bx-chevron-down filter-select__chevron" aria-hidden="true"></i>
							</button>
							{#if !allClientsSelected}
								<button
									type="button"
									class="filter-clear-btn"
									onclick={() => toggleClientFilter('all')}
									title="Clear client filter"
									aria-label="Clear client filter"
								>
									<i class="bx bx-x"></i>
								</button>
							{/if}
							{#if clientMenuOpen}
								<div
									class="filter-select__menu"
									role="listbox"
									aria-labelledby="client-filter"
									aria-multiselectable="true"
									onkeydown={handleClientMenuKeydown}
								>
									<button
										type="button"
										class="filter-select__option"
										class:filter-select__option--active={allClientsSelected}
										role="option"
										aria-selected={allClientsSelected}
										onclick={() => toggleClientFilter('all')}
										onkeydown={handleClientMenuKeydown}
									>
										<span>All clients</span>
										{#if allClientsSelected}
											<i class="bx bx-check" aria-hidden="true"></i>
										{/if}
									</button>
									{#each clientOptions as client}
										<button
											type="button"
											class="filter-select__option"
											class:filter-select__option--active={activeClientFilters.has(client.value)}
											role="option"
											aria-selected={activeClientFilters.has(client.value)}
											onclick={() => toggleClientFilter(client.value)}
											onkeydown={handleClientMenuKeydown}
										>
											<span>{client.label}</span>
											{#if activeClientFilters.has(client.value)}
												<i class="bx bx-check" aria-hidden="true"></i>
											{/if}
										</button>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				</div>

				<!-- Ticket List -->
				<div class="support-sidebar__list">
					{#if loading}
						<div class="support-sidebar__loading">
							<i class="bx bx-loader-alt bx-spin"></i>
							<span>Loading tickets...</span>
						</div>
					{:else if filteredIssues.length === 0}
						<div class="support-sidebar__empty">
							<i class="bx bx-check-circle"></i>
							<span>No tickets</span>
							<p>
								{!allClientsSelected
									? 'No tickets match this client filter.'
									: sidebarFilter === 'unassigned'
										? 'All tickets are assigned!'
										: sidebarFilter === 'mine'
											? "You don't have any tickets"
											: 'No open tickets'}
							</p>
						</div>
					{:else}
						{#each Object.entries(issuesByServer) as [serverId, { server, issues }]}
							<div class="server-group">
								<div class="server-group__header">
									{#if server.icon}
										<img src={server.icon} alt="" class="server-group__icon" />
									{:else}
										<div class="server-group__icon server-group__icon--placeholder">
											{server.name.charAt(0)}
										</div>
									{/if}
									<span class="server-group__name">{server.name}</span>
									<span class="server-group__count">{issues.length}</span>
								</div>
								<div class="server-group__issues">
									{#each issues as issue, issueIdx (issue.id)}
										{@const urgency = getUrgency(issue)}
										{@const isOpen = openTickets.some((t) => t.issue.id === issue.id)}
										{@const globalIdx = filteredIssues.findIndex((i) => i.id === issue.id)}
										<button
											type="button"
											class="ticket-item"
											class:ticket-item--open={isOpen}
											class:ticket-item--focused={focusedTicketId === issue.id}
											class:ticket-item--selected={selectedSidebarIndex === globalIdx}
											onclick={() => openTicket(issue)}
										>
											<div
												class="ticket-item__urgency"
												style="background: {getUrgencyColor(urgency)}"
												title="{urgency} priority"
											></div>
											<div class="ticket-item__content">
												<div class="ticket-item__header">
													<span class="ticket-item__channel">
														#{channelNames[issue.channelId] ?? '...'}
													</span>
													{#if issue.authorName}
														<span class="ticket-item__author">
															<i class="bx bx-user"></i> {issue.authorName}
														</span>
													{/if}
													<span class="ticket-item__time">{formatTimeAgo(issue.createdAt)}</span>
												</div>
												<div class="ticket-item__summary">{truncate(issue.summary)}</div>
												<div class="ticket-item__meta">
													{#if issue.typeTag}
														<span class="ticket-item__tag ticket-item__tag--{issue.typeTag}">
															{issue.typeTag.replace('_', ' ')}
														</span>
													{/if}
													<span class="ticket-item__status ticket-item__status--{issue.status}">
														{issue.status === 'opened' ? 'Open' : 'In Progress'}
													</span>
													{#if (issue.staffMemberIds?.length ?? 0) > 0}
														<span class="ticket-item__assigned">
															<i class="bx bx-user-check"></i>
														</span>
													{/if}
												</div>
											</div>
											{#if isOpen}
												<div class="ticket-item__open-indicator">
													<i class="bx bx-window-open"></i>
												</div>
											{/if}
										</button>
									{/each}
								</div>
							</div>
						{/each}
					{/if}
				</div>
			</aside>
		{/if}

		<!-- Main Panel - Open Tickets -->
		<main class="support-main">
			{#if openTickets.length === 0}
				<div class="support-main__empty">
					<i class="bx bx-conversation"></i>
					<h3>No Tickets Open</h3>
					<p>Select a ticket from the queue to start helping users</p>
				</div>
			{:else if mobileViewport && mobileActiveTicket}
				<!-- Mobile: Show single active ticket fullscreen -->
				{@const ticket = openTickets.find((t) => t.issue.id === mobileActiveTicket)}
				{#if ticket}
					<div class="ticket-panel ticket-panel--mobile">
						<div class="ticket-panel__header">
							<button
								type="button"
								class="ticket-panel__back"
								onclick={() => (mobileActiveTicket = null)}
								aria-label="Back to ticket queue"
							>
								<i class="bx bx-chevron-left"></i>
							</button>
							<div class="ticket-panel__info">
								<span class="ticket-panel__server">{ticket.serverName}</span>
								<span class="ticket-panel__channel">#{ticket.channelName}</span>
							</div>
							<div class="ticket-panel__actions">
								{#if !ticket.issue.staffMemberIds?.includes($user?.uid ?? '')}
									<button
										type="button"
										class="action-btn action-btn--claim"
										onclick={() => claimTicket(ticket.issue)}
										title="Claim ticket"
									>
										<i class="bx bx-user-plus"></i>
									</button>
								{/if}
								<button
									type="button"
									class="action-btn action-btn--resolve"
									onclick={() => resolveTicket(ticket.issue)}
									title="Mark resolved"
								>
									<i class="bx bx-check-circle"></i>
								</button>
								<button
									type="button"
									class="action-btn"
									onclick={() => goToTicket(ticket.issue)}
									title="Open in channel"
								>
									<i class="bx bx-link-external"></i>
								</button>
							</div>
						</div>

						<div class="ticket-panel__summary">
							{#if ticket.issue.authorName}
								<div class="ticket-panel__author">
									<i class="bx bx-user"></i> {ticket.issue.authorName}
								</div>
							{/if}
							<div class="ticket-panel__summary-text">{ticket.issue.summary}</div>
						</div>

						<div class="ticket-panel__messages">
							{#if ticket.loading}
								<div class="ticket-panel__loading">
									<i class="bx bx-loader-alt bx-spin"></i>
								</div>
							{:else}
								{#each ticket.messages as msg (msg.id)}
									<div
										class="message"
										class:message--staff={msg.authorId === $user?.uid}
									>
										<div class="message__author">{msg.authorName ?? 'User'}</div>
										<div class="message__text">{msg.text}</div>
										<div class="message__time">{formatTimeAgo(msg.createdAt)}</div>
									</div>
								{/each}
							{/if}
						</div>

						<div class="ticket-panel__input">
							<input
								type="text"
								placeholder="Type a reply..."
								bind:value={ticket.inputText}
								onkeydown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										e.preventDefault();
										sendMessage(ticket);
									}
								}}
								disabled={ticket.sending}
							/>
							<button
								type="button"
								class="send-btn"
								onclick={() => sendMessage(ticket)}
								disabled={!ticket.inputText.trim() || ticket.sending}
							>
								{#if ticket.sending}
									<i class="bx bx-loader-alt bx-spin"></i>
								{:else}
									<i class="bx bx-send"></i>
								{/if}
							</button>
						</div>
					</div>
				{/if}
			{:else}
				<!-- Desktop: Multi-panel grid -->
				<div class="ticket-grid ticket-grid--{Math.min(openTickets.length, 9)}">
					{#each openTickets as ticket, idx (ticket.issue.id)}
						<div
							class="ticket-panel"
							class:ticket-panel--focused={focusedTicketId === ticket.issue.id}
							class:ticket-panel--span-2={openTickets.length === 3 && idx === 2}
							onclick={() => (focusedTicketId = ticket.issue.id)}
							role="button"
							tabindex="0"
							onkeydown={(e) => {
								if (e.key === 'Enter') focusedTicketId = ticket.issue.id;
							}}
						>
							<div class="ticket-panel__header">
								<div class="ticket-panel__info">
									<span class="ticket-panel__server">{ticket.serverName}</span>
									<span class="ticket-panel__channel">#{ticket.channelName}</span>
								</div>
								<div class="ticket-panel__actions">
									{#if !ticket.issue.staffMemberIds?.includes($user?.uid ?? '')}
										<button
											type="button"
											class="action-btn action-btn--claim"
											onclick={(e) => {
												e.stopPropagation();
												claimTicket(ticket.issue);
											}}
											title="Claim ticket"
										>
											<i class="bx bx-user-plus"></i>
										</button>
									{/if}
									<button
										type="button"
										class="action-btn action-btn--resolve"
										onclick={(e) => {
											e.stopPropagation();
											resolveTicket(ticket.issue);
										}}
										title="Mark resolved"
									>
										<i class="bx bx-check-circle"></i>
									</button>
									<button
										type="button"
										class="action-btn"
										onclick={(e) => {
											e.stopPropagation();
											goToTicket(ticket.issue);
										}}
										title="Open in channel"
									>
										<i class="bx bx-link-external"></i>
									</button>
									<button
										type="button"
										class="action-btn action-btn--close"
										onclick={(e) => {
											e.stopPropagation();
											closeTicket(ticket.issue.id);
										}}
										title="Close panel"
									>
										<i class="bx bx-x"></i>
									</button>
								</div>
							</div>

							<div class="ticket-panel__summary">
								{#if ticket.issue.authorName}
									<div class="ticket-panel__author">
										<i class="bx bx-user"></i> {ticket.issue.authorName}
									</div>
								{/if}
								<div class="ticket-panel__summary-text">{truncate(ticket.issue.summary, 100)}</div>
							</div>

							<div class="ticket-panel__messages">
								{#if ticket.loading}
									<div class="ticket-panel__loading">
										<i class="bx bx-loader-alt bx-spin"></i>
									</div>
								{:else}
									{#each ticket.messages.slice(-20) as msg (msg.id)}
										<div
											class="message"
											class:message--staff={msg.authorId === $user?.uid}
										>
											<div class="message__author">{msg.authorName ?? 'User'}</div>
											<div class="message__text">{msg.text}</div>
										</div>
									{/each}
								{/if}
							</div>

							<div class="ticket-panel__input" class:is-expanded={expandedTextareas.has(ticket.issue.id)}>
								<div class="input-wrapper">
									<button
										type="button"
										class="quick-response-btn"
										onclick={(e) => {
											e.stopPropagation();
											showQuickResponsePopup = showQuickResponsePopup === ticket.issue.id ? null : ticket.issue.id;
										}}
										title="Quick responses (or type /)"
									>
										<i class="bx bx-bolt-circle"></i>
									</button>
									<textarea
										bind:this={textareaRefs[ticket.issue.id]}
										rows="1"
										placeholder="Reply... (/ for quick responses)"
										bind:value={ticket.inputText}
										oninput={(e) => {
											handleInputChange(ticket.issue.id, e.currentTarget.value);
											syncTextareaSize(e.currentTarget, ticket.issue.id);
										}}
										onkeydown={(e) => {
											// Handle slash command navigation first
											if (handleSlashKeydown(e, ticket.issue.id)) return;
											// Then handle regular enter to send (Shift+Enter for newline)
											if (e.key === 'Enter' && !e.shiftKey && !slashMenuActive) {
												e.preventDefault();
												sendMessage(ticket);
											}
										}}
										disabled={ticket.sending}
										onfocus={() => (focusedTicketId = ticket.issue.id)}
									></textarea>
									<!-- Slash Command Autocomplete (like @mentions) -->
									{#if slashMenuActive === ticket.issue.id && slashMenuResults.length > 0}
										<div class="slash-menu">
											<div class="slash-menu__header">Insert a quick response</div>
											<div class="slash-menu__list">
												{#each slashMenuResults as response, i (response.id)}
													<button
														type="button"
														class="slash-menu__item"
														class:is-active={i === slashMenuSelectedIndex}
														onmousedown={(e) => {
															e.preventDefault();
															e.stopPropagation();
															// Replace /query with content
															const idx = openTickets.findIndex((t) => t.issue.id === ticket.issue.id);
															if (idx >= 0) {
																const currentText = openTickets[idx].inputText;
																let newText: string;
																if (currentText.startsWith('/')) {
																	newText = response.content;
																} else {
																	const spaceSlashIdx = currentText.lastIndexOf(' /');
																	if (spaceSlashIdx >= 0) {
																		newText = currentText.slice(0, spaceSlashIdx + 1) + response.content;
																	} else {
																		newText = response.content;
																	}
																}
																openTickets[idx].inputText = newText;
																openTickets = [...openTickets];
															}
															slashMenuActive = null;
															slashMenuQuery = '';
															slashMenuSelectedIndex = 0;
														}}
														onmouseenter={() => (slashMenuSelectedIndex = i)}
													>
														<span class="slash-menu__icon">/</span>
														<span class="slash-menu__content">
															<span class="slash-menu__title">{response.title}</span>
															<span class="slash-menu__preview">{truncate(response.content, 50)}</span>
														</span>
														{#if i === slashMenuSelectedIndex}
															<span class="slash-menu__kbd">Tab</span>
														{/if}
													</button>
												{/each}
											</div>
										</div>
									{/if}
									<!-- Quick Response Popup (button click) -->
									{#if showQuickResponsePopup === ticket.issue.id}
										<div class="quick-response-popup">
											<div class="quick-response-popup__header">
												<span>Quick Responses</span>
												<button
													type="button"
													class="quick-response-popup__manage"
													onclick={(e) => {
														e.stopPropagation();
														showQuickResponseEditor = true;
														showQuickResponsePopup = null;
													}}
													title="Manage responses"
												>
													<i class="bx bx-cog"></i>
												</button>
											</div>
											<div class="quick-response-popup__list">
												{#each quickResponses as response (response.id)}
													<button
														type="button"
														class="quick-response-item"
														onclick={(e) => {
															e.stopPropagation();
															insertQuickResponse(ticket.issue.id, response.content);
														}}
													>
														<span class="quick-response-item__title">{response.title}</span>
														<span class="quick-response-item__preview">{truncate(response.content, 50)}</span>
													</button>
												{/each}
											</div>
										</div>
									{/if}
								</div>
								<button
									type="button"
									class="send-btn"
									onclick={() => sendMessage(ticket)}
									disabled={!ticket.inputText.trim() || ticket.sending}
								>
									{#if ticket.sending}
										<i class="bx bx-loader-alt bx-spin"></i>
									{:else}
										<i class="bx bx-send"></i>
									{/if}
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</main>
	</div>
</div>
</div>

<!-- Quick Response Editor Modal -->
{#if showQuickResponseEditor}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="modal-backdrop"
		onclick={() => { showQuickResponseEditor = false; editingResponse = null; }}
		role="presentation"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_interactive_supports_focus -->
		<div
			class="modal-content"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-labelledby="modal-title"
			tabindex="-1"
		>
			<div class="modal-header">
				<h3 id="modal-title">{editingResponse ? 'Edit Response' : 'Manage Quick Responses'}</h3>
				<button
					type="button"
					class="modal-close"
					onclick={() => { showQuickResponseEditor = false; editingResponse = null; }}
					title="Close"
				>
					<i class="bx bx-x"></i>
				</button>
			</div>
			
			{#if editingResponse || quickResponses.length < 10}
				<div class="modal-form">
					<div class="form-group">
						<label for="response-title">Title</label>
						<input
							id="response-title"
							type="text"
							placeholder="e.g., Password Reset"
							bind:value={newResponseTitle}
						/>
					</div>
					<div class="form-group">
						<label for="response-content">Response Content</label>
						<textarea
							id="response-content"
							placeholder="Enter the full response text..."
							bind:value={newResponseContent}
							rows="5"
						></textarea>
					</div>
					<div class="form-actions">
						{#if editingResponse}
							<button type="button" class="btn btn--secondary" onclick={() => { editingResponse = null; newResponseTitle = ''; newResponseContent = ''; }}>
								Cancel
							</button>
							<button type="button" class="btn btn--primary" onclick={updateQuickResponse} disabled={!newResponseTitle.trim() || !newResponseContent.trim()}>
								Save Changes
							</button>
						{:else}
							<button type="button" class="btn btn--primary" onclick={addQuickResponse} disabled={!newResponseTitle.trim() || !newResponseContent.trim()}>
								<i class="bx bx-plus"></i> Add Response
							</button>
						{/if}
					</div>
				</div>
			{/if}

			<div class="modal-list">
				<h4>Your Quick Responses ({quickResponses.length})</h4>
				{#each quickResponses as response (response.id)}
					<div class="response-card">
						<div class="response-card__content">
							<strong>{response.title}</strong>
							<p>{truncate(response.content, 100)}</p>
						</div>
						<div class="response-card__actions">
							<button type="button" onclick={() => startEditingResponse(response)} title="Edit">
								<i class="bx bx-edit"></i>
							</button>
							<button type="button" onclick={() => deleteQuickResponse(response.id)} title="Delete">
								<i class="bx bx-trash"></i>
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
	.support-wrapper {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		height: 100%;
		max-height: 100dvh;
		overflow: hidden;
	}

	.support-dashboard {
		flex: 1;
		min-height: 0;
		height: 100%;
		max-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--surface-root, #0a0e14);
		color: var(--color-text-primary, #e2e8f0);
		overflow: hidden;
	}

	/* Header */
	.support-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		height: 3.5rem;
		padding: 0 1rem;
		background: var(--color-panel, #0f141c);
		border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
		flex-shrink: 0;
	}

	.support-header__left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.support-header__back {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		background: transparent;
		color: var(--color-text-secondary, #94a3b8);
		border-radius: 6px;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.support-header__back:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--color-text-primary, #e2e8f0);
	}

	.support-header__title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
	}

	.support-header__title i {
		color: var(--color-accent);
	}

	.support-header__stats {
		display: flex;
		align-items: center;
		gap: 1.5rem;
	}

	.support-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.125rem;
	}

	.support-stat__value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.support-stat--mine .support-stat__value {
		color: var(--color-accent);
	}

	.support-stat__label {
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted, #64748b);
	}

	.support-header__actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.support-header__toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		border-radius: 6px;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.support-header__toggle:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	.support-header__btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		border-radius: 6px;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.support-header__btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--color-text-primary);
	}

	.keyboard-hint {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 6px;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		cursor: help;
	}

	.keyboard-hint i {
		font-size: 0.875rem;
	}

	.keyboard-hint span {
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	/* Body Layout */
	.support-body {
		display: flex;
		flex: 1;
		min-height: 0;
		height: calc(100dvh - 3.5rem); /* viewport minus header */
		max-height: calc(100dvh - 3.5rem);
		overflow: hidden;
	}

	/* Sidebar */
	.support-sidebar {
		width: 320px;
		display: flex;
		flex-direction: column;
		background: var(--color-panel-muted, #131a24);
		border-right: 1px solid var(--color-border-subtle);
		transition: width 200ms ease, transform 200ms ease;
		flex-shrink: 0;
		min-height: 0;
		overflow: hidden;
	}

	.support-sidebar--collapsed {
		width: 0;
		overflow: hidden;
		border-right: none;
	}

	.support-sidebar__header {
		padding: 1rem;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.support-sidebar__header h3 {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.support-sidebar__filters {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.support-sidebar__filter-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.support-sidebar__filter-row--select {
		gap: 0.5rem;
	}

	.filter-label {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.filter-select {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		background: color-mix(in srgb, var(--color-panel) 78%, #0e1218);
		border-radius: 10px;
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
		transition: border-color 150ms ease, box-shadow 150ms ease;
		color-scheme: dark;
		position: relative;
		z-index: 2;
	}

	.filter-select:focus-within {
		border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
		box-shadow:
			inset 0 1px 2px rgba(0, 0, 0, 0.25),
			0 0 0 1px color-mix(in srgb, var(--color-accent) 25%, transparent);
	}

	.filter-select__icon {
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}

	.filter-select__trigger {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.2rem 0.15rem;
		cursor: pointer;
		text-align: left;
	}

	.filter-select__label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.filter-select__menu {
		position: absolute;
		top: calc(100% + 0.45rem);
		left: 0;
		right: 0;
		background: var(--color-panel, #0f141c);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		border-radius: 12px;
		box-shadow:
			0 12px 28px rgba(0, 0, 0, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.04);
		padding: 0.35rem;
		max-height: 240px;
		overflow-y: auto;
		z-index: 10;
	}

	.filter-select__option {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.45rem 0.6rem;
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		font-size: 0.75rem;
		font-weight: 500;
		border-radius: 8px;
		cursor: pointer;
		transition: background 150ms ease, color 150ms ease;
		text-align: left;
	}

	.filter-select__option:hover {
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}

	.filter-select__option--active {
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		color: var(--color-accent);
	}

	.filter-select__option--active i {
		color: var(--color-accent);
	}

	.filter-select .filter-select__chevron {
		font-size: 0.95rem;
		color: var(--color-text-muted);
		transition: color 150ms ease, transform 150ms ease;
	}

	.filter-select:focus-within .filter-select__chevron {
		color: var(--color-accent);
		transform: translateY(1px);
	}

	.filter-select--open .filter-select__chevron {
		transform: rotate(180deg);
		color: var(--color-accent);
	}

	.filter-clear-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.35rem;
		height: 1.35rem;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		border-radius: 4px;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.filter-clear-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--color-text-primary);
	}

	.filter-btn {
		flex: 1;
		padding: 0.5rem 0.25rem;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		font-weight: 500;
		border-radius: 6px;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.filter-btn:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.filter-btn--active {
		background: var(--color-accent-soft);
		color: var(--color-accent);
	}

	.support-sidebar__list {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 0.5rem;
		padding-bottom: 5rem;
		min-height: 0;
	}

	.support-sidebar__loading,
	.support-sidebar__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2rem 1rem;
		text-align: center;
		color: var(--color-text-secondary);
		gap: 0.5rem;
	}

	.support-sidebar__loading i,
	.support-sidebar__empty i {
		font-size: 2rem;
		opacity: 0.5;
	}

	.support-sidebar__empty p {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	/* Server Group */
	.server-group {
		margin-bottom: 1rem;
	}

	.server-group__header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.server-group__icon {
		width: 20px;
		height: 20px;
		border-radius: 6px;
		object-fit: cover;
	}

	.server-group__icon--placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-accent);
		color: var(--color-text-inverse);
		font-size: 0.625rem;
		font-weight: 600;
	}

	.server-group__name {
		flex: 1;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.server-group__count {
		font-size: 0.625rem;
		padding: 0.125rem 0.375rem;
		background: rgba(255, 255, 255, 0.08);
		border-radius: 999px;
		color: var(--color-text-muted);
	}

	.server-group__issues {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	/* Ticket Item */
	.ticket-item {
		position: relative;
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid transparent;
		background: rgba(255, 255, 255, 0.02);
		border-radius: 8px;
		cursor: pointer;
		transition: all 150ms ease;
		text-align: left;
		width: 100%;
	}

	.ticket-item:hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: var(--color-border-subtle);
	}

	.ticket-item--open {
		background: var(--color-accent-soft);
		border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
	}

	.ticket-item--focused {
		border-color: var(--color-accent);
	}

	.ticket-item--selected {
		background: var(--color-accent-soft);
		border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
	}

	.ticket-item--selected::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 3px;
		background: var(--color-accent);
		border-radius: 0 2px 2px 0;
	}

	.ticket-item__urgency {
		width: 4px;
		border-radius: 2px;
		flex-shrink: 0;
	}

	.ticket-item__content {
		flex: 1;
		min-width: 0;
	}

	.ticket-item__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.ticket-item__channel {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
	}

	.ticket-item__author {
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.ticket-item__author i {
		font-size: 0.75rem;
	}

	.ticket-item__time {
		font-size: 0.625rem;
		color: var(--color-text-muted);
	}

	.ticket-item__summary {
		font-size: 0.8125rem;
		color: var(--color-text-primary);
		line-height: 1.4;
		margin-bottom: 0.375rem;
	}

	.ticket-item__meta {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.ticket-item__tag {
		font-size: 0.625rem;
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
		background: rgba(148, 163, 184, 0.15);
		color: var(--color-text-secondary);
		text-transform: capitalize;
	}

	.ticket-item__tag--bug {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}

	.ticket-item__tag--feature_request {
		background: rgba(168, 85, 247, 0.15);
		color: #a855f7;
	}

	.ticket-item__tag--question {
		background: var(--color-accent-soft);
		color: var(--color-accent);
	}

	.ticket-item__status {
		font-size: 0.625rem;
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
	}

	.ticket-item__status--opened {
		background: rgba(251, 191, 36, 0.15);
		color: #fbbf24;
	}

	.ticket-item__status--in_progress {
		background: var(--color-accent-soft);
		color: var(--color-accent);
	}

	.ticket-item__assigned {
		color: var(--color-accent);
		font-size: 0.75rem;
	}

	.ticket-item__open-indicator {
		color: var(--color-accent);
		font-size: 0.875rem;
	}

	/* Main Panel */
	.support-main {
		flex: 1;
		min-width: 0;
		min-height: 0;
		height: 100%;
		max-height: 100%;
		position: relative;
	}

	.support-main__empty {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		color: var(--color-text-secondary);
		text-align: center;
		padding: 2rem;
	}

	.support-main__empty i {
		font-size: 4rem;
		opacity: 0.3;
		color: var(--color-accent);
	}

	.support-main__empty h3 {
		margin: 0;
		font-size: 1.25rem;
		color: var(--color-text-primary);
	}

	.support-main__empty p {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	/* Ticket Grid - Smart Layout Based on Count */
	.ticket-grid {
		display: grid;
		gap: 0.5rem;
		padding: 0.5rem;
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		overflow: visible;
	}

	/* Ensure grid cells constrain their children */
	.ticket-grid > * {
		min-height: 0;
		min-width: 0;
		overflow: visible;
	}

	/* 1 ticket: full screen */
	.ticket-grid--1 {
		grid-template-columns: 1fr;
		grid-template-rows: minmax(0, 1fr);
	}

	/* 2 tickets: side by side */
	.ticket-grid--2 {
		grid-template-columns: 1fr 1fr;
		grid-template-rows: minmax(0, 1fr);
	}

	/* 3 tickets: 2 on top, 1 spanning bottom */
	.ticket-grid--3 {
		grid-template-columns: 1fr 1fr;
		grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
	}

	.ticket-panel--span-2 {
		grid-column: span 2;
	}

	/* 4 tickets: 2x2 */
	.ticket-grid--4 {
		grid-template-columns: 1fr 1fr;
		grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
	}

	/* 5 tickets: 3 on top, 2 on bottom */
	.ticket-grid--5 {
		grid-template-columns: repeat(6, 1fr);
		grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
	}

	.ticket-grid--5 .ticket-panel:nth-child(1),
	.ticket-grid--5 .ticket-panel:nth-child(2),
	.ticket-grid--5 .ticket-panel:nth-child(3) {
		grid-column: span 2;
	}

	.ticket-grid--5 .ticket-panel:nth-child(4),
	.ticket-grid--5 .ticket-panel:nth-child(5) {
		grid-column: span 3;
	}

	/* 6 tickets: 3x2 */
	.ticket-grid--6 {
		grid-template-columns: repeat(3, 1fr);
		grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
	}

	/* 7 tickets: 3 + 3 + 1 spanning */
	.ticket-grid--7 {
		grid-template-columns: repeat(3, 1fr);
		grid-template-rows: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
	}

	/* 8 tickets: 3 + 3 + 2 */
	.ticket-grid--8 {
		grid-template-columns: repeat(6, 1fr);
		grid-template-rows: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
	}

	.ticket-grid--8 .ticket-panel:nth-child(1),
	.ticket-grid--8 .ticket-panel:nth-child(2),
	.ticket-grid--8 .ticket-panel:nth-child(3),
	.ticket-grid--8 .ticket-panel:nth-child(4),
	.ticket-grid--8 .ticket-panel:nth-child(5),
	.ticket-grid--8 .ticket-panel:nth-child(6) {
		grid-column: span 2;
	}

	.ticket-grid--8 .ticket-panel:nth-child(7),
	.ticket-grid--8 .ticket-panel:nth-child(8) {
		grid-column: span 3;
	}

	/* 9 tickets: 3x3 (max) */
	.ticket-grid--9 {
		grid-template-columns: repeat(3, 1fr);
		grid-template-rows: repeat(3, minmax(0, 1fr));
	}

	/* Ticket Panel */
	.ticket-panel {
		display: flex;
		flex-direction: column;
		background: var(--color-panel, #0f141c);
		border: 1px solid var(--color-border-subtle);
		border-radius: 12px;
		min-height: 0;
		min-width: 0;
		height: 100%;
		max-height: 100%;
		overflow: visible;
		transition: border-color 150ms ease, box-shadow 150ms ease;
	}

	.ticket-panel--focused {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 30%, transparent);
	}

	.ticket-panel--mobile {
		max-height: none;
		flex: 1;
		border-radius: 0;
		border: none;
	}

	.ticket-panel__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: var(--color-panel-muted);
		border-bottom: 1px solid var(--color-border-subtle);
		flex-shrink: 0;
	}

	.ticket-panel__back {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		border-radius: 6px;
		cursor: pointer;
	}

	.ticket-panel__info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.ticket-panel__server {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-accent);
	}

	.ticket-panel__channel {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
	}

	.ticket-panel__actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		border-radius: 6px;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.action-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--color-text-primary);
	}

	.action-btn--claim:hover {
		background: var(--color-accent-soft);
		color: var(--color-accent);
	}

	.action-btn--resolve:hover {
		background: var(--color-accent-soft);
		color: var(--color-accent);
	}

	.action-btn--resolve {
		width: 2.5rem;
		height: 2.5rem;
		font-size: 1.25rem;
		background: var(--color-accent-soft);
		color: var(--color-accent);
	}

	.action-btn--close:hover {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}

	.ticket-panel__summary {
		padding: 0.75rem 1rem;
		font-size: 0.8125rem;
		color: var(--color-text-primary);
		line-height: 1.5;
		border-bottom: 1px solid var(--color-border-subtle);
		background: rgba(255, 255, 255, 0.02);
		flex-shrink: 0;
		max-height: 100px;
		overflow-y: auto;
	}

	.ticket-panel__author {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-accent);
		margin-bottom: 0.375rem;
	}

	.ticket-panel__author i {
		font-size: 0.875rem;
	}

	.ticket-panel__summary-text {
		color: var(--color-text-secondary);
	}

	.ticket-panel__messages {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 0;
	}

	.ticket-panel__loading {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		color: var(--color-text-muted);
	}

	.message {
		padding: 0.5rem 0.75rem;
		background: var(--chat-bubble-other-bg);
		border: 1px solid var(--chat-bubble-other-border);
		border-radius: 8px;
		max-width: 85%;
	}

	.message--staff {
		align-self: flex-end;
		background: var(--color-accent);
		border: 1px solid var(--chat-bubble-self-border);
	}

	.message__author {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		margin-bottom: 0.25rem;
	}

	.message--staff .message__author {
		color: var(--chat-bubble-self-text);
	}

	.message__text {
		font-size: 0.8125rem;
		color: var(--chat-bubble-other-text);
		line-height: 1.4;
		word-break: break-word;
	}

	.message--staff .message__text {
		color: var(--chat-bubble-self-text);
	}

	.message__time {
		font-size: 0.625rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}

	.ticket-panel__input {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem;
		background: var(--color-panel-muted);
		border-top: 1px solid var(--color-border-subtle);
		flex-shrink: 0;
		min-height: 56px;
		align-items: center;
		border-radius: 0 0 12px 12px;
	}

	/* Direct input (for mobile view without quick response wrapper) */
	.ticket-panel__input > input {
		flex: 1;
		min-width: 0;
		padding: 0.55rem 1rem;
		min-height: 2.5rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 90%, transparent);
		background: color-mix(in srgb, var(--color-panel) 80%, #1a1d21);
		color: var(--text-100, var(--color-text-primary));
		font-size: 0.875rem;
		border-radius: 999px;
		outline: none;
		box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.25);
		transition: border-color 150ms ease, box-shadow 150ms ease;
	}

	.ticket-panel__input > input:focus {
		border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
		box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.25), 0 0 0 2px color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	.ticket-panel__input > input::placeholder {
		color: var(--text-50, var(--color-text-muted));
	}

	.send-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		flex-shrink: 0;
		border: none;
		background: var(--color-accent);
		color: var(--color-text-inverse);
		border-radius: 999px;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.send-btn:hover:not(:disabled) {
		background: var(--color-accent-strong);
		transform: scale(1.05);
	}

	.send-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Input wrapper for quick response */
	.input-wrapper {
		flex: 1;
		min-width: 0;
		max-width: 100%;
		position: relative;
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
	}

	.input-wrapper textarea {
		flex: 1;
		min-width: 0;
		padding: 0.6rem 1rem;
		min-height: 2.5rem;
		max-height: 10rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 90%, transparent);
		background: color-mix(in srgb, var(--color-panel) 80%, #1a1d21);
		color: var(--text-100, var(--color-text-primary));
		font-size: 0.875rem;
		font-family: inherit;
		line-height: 1.35;
		border-radius: 1.25rem;
		outline: none;
		box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.25);
		transition: border-color 150ms ease, box-shadow 150ms ease, border-radius 150ms ease;
		resize: none;
		overflow-y: hidden;
	}

	.input-wrapper textarea:focus {
		border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
		box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.25), 0 0 0 2px color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	.input-wrapper textarea::placeholder {
		color: var(--text-50, var(--color-text-muted));
	}

	/* When expanded (multi-line), use rounded corners instead of pill */
	.ticket-panel__input.is-expanded .input-wrapper textarea {
		border-radius: 1.1rem;
	}

	.quick-response-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		flex-shrink: 0;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
		background: color-mix(in srgb, var(--color-panel) 85%, transparent);
		color: var(--color-text-secondary);
		border-radius: 999px;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.quick-response-btn:hover {
		background: color-mix(in srgb, var(--color-accent) 20%, var(--color-panel) 80%);
		border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
		color: var(--color-accent);
		transform: scale(1.05);
	}

	.quick-response-btn i {
		font-size: 1.125rem;
	}

	/* Quick Response Popup */
	.quick-response-popup {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 0;
		width: 280px;
		max-height: 300px;
		background: var(--color-panel, #0f141c);
		border: 1px solid var(--color-border-subtle);
		border-radius: 12px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		overflow: hidden;
		z-index: 9999;
	}

	.quick-response-popup__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border-subtle);
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.quick-response-popup__manage {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		border-radius: 4px;
		cursor: pointer;
	}

	.quick-response-popup__manage:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--color-text-primary);
	}

	.quick-response-popup__list {
		max-height: 240px;
		overflow-y: auto;
	}

	.quick-response-item {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
		width: 100%;
		padding: 0.75rem 1rem;
		border: none;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: background 150ms ease;
	}

	.quick-response-item:hover {
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}

	.quick-response-item__title {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.quick-response-item__preview {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	/* Slash Menu (like @mentions) */
	.slash-menu {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 0;
		min-width: 280px;
		max-width: 400px;
		background: color-mix(in srgb, var(--color-panel) 95%, #1a1d21);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		border-radius: 12px;
		box-shadow: 
			inset 0 1px 0 rgba(255, 255, 255, 0.04),
			0 8px 24px rgba(0, 0, 0, 0.35);
		overflow: hidden;
		z-index: 9999;
	}

	.slash-menu__header {
		padding: 0.55rem 0.85rem;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-55, var(--color-text-muted));
		border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.slash-menu__list {
		max-height: 180px;
		overflow-y: auto;
	}

	.slash-menu__item {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		width: 100%;
		padding: 0.55rem 0.85rem;
		border: none;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: background 140ms ease, color 140ms ease;
	}

	.slash-menu__item:hover,
	.slash-menu__item.is-active {
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}

	.slash-menu__icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
		color: var(--color-accent);
		font-size: 0.875rem;
		font-weight: 700;
		border-radius: 999px;
		flex-shrink: 0;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
	}

	.slash-menu__content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.slash-menu__title {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-90, var(--color-text-primary));
	}

	.slash-menu__preview {
		font-size: 0.75rem;
		color: var(--text-60, var(--color-text-muted));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.slash-menu__kbd {
		flex-shrink: 0;
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
		border-radius: 4px;
		font-family: ui-monospace, monospace;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	/* Modal Styles */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
	}

	.modal-content {
		width: 100%;
		max-width: 500px;
		max-height: 80vh;
		background: var(--color-panel, #0f141c);
		border: 1px solid var(--color-border-subtle);
		border-radius: 16px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.modal-header h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.modal-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		border-radius: 6px;
		cursor: pointer;
	}

	.modal-close:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--color-text-primary);
	}

	.modal-form {
		padding: 1.25rem;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.form-group {
		margin-bottom: 1rem;
	}

	.form-group:last-child {
		margin-bottom: 0;
	}

	.form-group label {
		display: block;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		margin-bottom: 0.5rem;
	}

	.form-group input,
	.form-group textarea {
		width: 100%;
		padding: 0.625rem 0.875rem;
		border: 1px solid var(--color-border-subtle);
		background: var(--surface-root, #0a0e14);
		color: var(--color-text-primary);
		font-size: 0.875rem;
		border-radius: 8px;
		outline: none;
		font-family: inherit;
		resize: vertical;
	}

	.form-group input:focus,
	.form-group textarea:focus {
		border-color: var(--color-accent);
	}

	.form-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
		margin-top: 1rem;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 8px;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.btn--primary {
		background: var(--color-accent);
		color: var(--color-text-inverse);
	}

	.btn--primary:hover:not(:disabled) {
		background: var(--color-accent-strong);
	}

	.btn--primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn--secondary {
		background: rgba(255, 255, 255, 0.08);
		color: var(--color-text-primary);
	}

	.btn--secondary:hover {
		background: rgba(255, 255, 255, 0.12);
	}

	.modal-list {
		flex: 1;
		overflow-y: auto;
		padding: 1rem 1.25rem;
	}

	.modal-list h4 {
		margin: 0 0 0.75rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.response-card {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.75rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--color-border-subtle);
		border-radius: 8px;
		margin-bottom: 0.5rem;
	}

	.response-card__content {
		flex: 1;
		min-width: 0;
	}

	.response-card__content strong {
		display: block;
		font-size: 0.8125rem;
		color: var(--color-text-primary);
		margin-bottom: 0.25rem;
	}

	.response-card__content p {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		line-height: 1.4;
	}

	.response-card__actions {
		display: flex;
		gap: 0.25rem;
	}

	.response-card__actions button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		border-radius: 4px;
		cursor: pointer;
	}

	.response-card__actions button:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--color-text-primary);
	}

	/* Mobile adjustments */
	.support-dashboard--mobile .support-header {
		height: auto;
		padding: 0.75rem;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.support-dashboard--mobile .support-header__stats {
		order: 3;
		width: 100%;
		justify-content: space-around;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border-subtle);
	}

	.support-dashboard--mobile .support-sidebar {
		width: 100%;
		border-right: none;
	}

	@media (max-width: 767px) {
		.support-header__title span {
			display: none;
		}
	}
</style>
