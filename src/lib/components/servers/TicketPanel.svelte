<script lang="ts">
	import { onDestroy, createEventDispatcher } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { getDb } from '$lib/firebase';
	import { user } from '$lib/stores/user';
	import { servers, serverMemberships } from '$lib/stores';
	import {
		collection,
		query,
		where,
		onSnapshot,
		doc,
		updateDoc,
		serverTimestamp,
		type Unsubscribe
	} from 'firebase/firestore';
	import { toggleChannelReaction } from '$lib/firestore/messages';
	import { type TicketAiIssue, type TicketAiSettings } from '$lib/firestore/ticketAi';
	import type { Server } from '$lib/types';

	interface Props {
		serverId: string | null;
		channels?: Array<{ id: string; name: string }>;
	}

	let { serverId, channels = [] }: Props = $props();

	const dispatch = createEventDispatcher<{
		navigate: { channelId: string; threadId: string; messageId?: string };
		close: void;
	}>();

	type EnrichedIssue = TicketAiIssue & {
		channelName?: string;
		assignedToMe?: boolean;
		assignedToOther?: boolean;
	};

	let isStaff = $state(false);
	let issues = $state<EnrichedIssue[]>([]);
	let settings = $state<TicketAiSettings | null>(null);
	let loading = $state(true);
	let expanded = $state(false);
	let filter = $state<'all' | 'mine' | 'unassigned'>('all');
	let claimingId = $state<string | null>(null);
	let completingId = $state<string | null>(null);

	let settingsUnsub: Unsubscribe | null = null;
	let issuesUnsub: Unsubscribe | null = null;

	const DONE_EMOJI = '✅';

	// Check if user is server admin/owner
	function isServerAdminOrOwner(): boolean {
		if (!serverId || !$user?.uid) return false;
		const server = ($servers as Server[]).find((s: Server) => s.id === serverId);
		if (!server) return false;
		if (server.ownerId === $user.uid) return true;
		// Check membership for admin role
		const membership = $serverMemberships.find(
			(m) => m.serverId === serverId && m.userId === $user.uid
		);
		if (membership?.role === 'admin' || membership?.role === 'owner') return true;
		return false;
	}

	$effect(() => {
		if (!browser || !serverId || !$user?.uid) {
			cleanup();
			return;
		}

		const uid = $user.uid;
		const email = $user.email ?? '';
		const adminOrOwner = isServerAdminOrOwner();

		// Subscribe to the server's ticketAi settings
		settingsUnsub?.();

		const db = getDb();
		const settingsRef = doc(db, 'servers', serverId, 'ticketAiSettings', 'current');

		settingsUnsub = onSnapshot(
			settingsRef,
			(snap) => {
				const data = snap.data();
				const s = {
					enabled: data?.enabled ?? false,
					staffDomains: Array.isArray(data?.staffDomains) ? data.staffDomains : [],
					staffMemberIds: Array.isArray(data?.staffMemberIds) ? data.staffMemberIds : [],
					allowedRoleIds: Array.isArray(data?.allowedRoleIds) ? data.allowedRoleIds : [],
					retention: data?.retention ?? '90d'
				} as TicketAiSettings;

				settings = s;

				// Check if current user is staff
				let userIsStaff = false;

				// Admins/owners are always staff
				if (adminOrOwner) {
					userIsStaff = true;
				}
				// Check if UID is in staffMemberIds
				else if (s.staffMemberIds?.includes(uid)) {
					userIsStaff = true;
				}
				// Check if user's email domain matches staff domains
				else if (s.staffDomains?.length && email) {
					const domain = email.split('@')[1]?.toLowerCase();
					if (domain && s.staffDomains.some((d) => d.toLowerCase().replace('@', '') === domain)) {
						userIsStaff = true;
					}
				}

				isStaff = userIsStaff;

				// If staff and enabled, subscribe to issues
				if (userIsStaff && s.enabled) {
					subscribeToIssues(serverId!, uid);
				} else {
					issuesUnsub?.();
					issuesUnsub = null;
					issues = [];
					loading = false;
				}
			},
			(error) => {
				console.error('[TicketPanel] Error subscribing to settings:', error);
				// On error, still show FAB for admins/owners
				if (adminOrOwner) {
					isStaff = true;
					settings = null;
				}
				loading = false;
			}
		);
	});

	function subscribeToIssues(sId: string, currentUid: string) {
		issuesUnsub?.();

		const db = getDb();
		const issuesRef = collection(db, 'servers', sId, 'ticketAiIssues');
		// Query for open and in_progress issues
		const q = query(issuesRef, where('status', 'in', ['opened', 'in_progress']));

		issuesUnsub = onSnapshot(
			q,
			(snap) => {
				const result: EnrichedIssue[] = snap.docs.map((docSnap) => {
					const data = docSnap.data() as TicketAiIssue;
					const channelName = channels.find((c) => c.id === data.channelId)?.name ?? 'unknown';
					const staffIds = data.staffMemberIds ?? [];
					const assignedToMe = staffIds.includes(currentUid);
					const assignedToOther = staffIds.length > 0 && !assignedToMe;
					return {
						...data,
						id: docSnap.id,
						channelName,
						assignedToMe,
						assignedToOther
					};
				});
				// Sort: unassigned first, then mine, then others; within each by createdAt desc
				result.sort((a, b) => {
					const aScore = a.assignedToOther ? 2 : a.assignedToMe ? 1 : 0;
					const bScore = b.assignedToOther ? 2 : b.assignedToMe ? 1 : 0;
					if (aScore !== bScore) return aScore - bScore;
					const aTime = (a.createdAt as any)?.toMillis?.() ?? 0;
					const bTime = (b.createdAt as any)?.toMillis?.() ?? 0;
					return bTime - aTime;
				});
				issues = result;
				loading = false;
			},
			(error) => {
				console.error('[TicketPanel] Error subscribing to issues:', error);
				loading = false;
			}
		);
	}

	function cleanup() {
		settingsUnsub?.();
		issuesUnsub?.();
		settingsUnsub = null;
		issuesUnsub = null;
		issues = [];
		settings = null;
		isStaff = false;
		loading = false;
	}

	onDestroy(cleanup);

	async function claimIssue(issue: EnrichedIssue) {
		if (!serverId || !$user?.uid || claimingId) return;
		claimingId = issue.id;

		try {
			const db = getDb();
			const issueRef = doc(db, 'servers', serverId, 'ticketAiIssues', issue.id);
			await updateDoc(issueRef, {
				staffMemberIds: [$user.uid],
				status: 'in_progress',
				statusTimeline: [
					...(issue.statusTimeline ?? []),
					{ status: 'in_progress', at: serverTimestamp() }
				]
			});
		} catch (err) {
			console.error('[TicketPanel] Failed to claim issue:', err);
		} finally {
			claimingId = null;
		}
	}

	async function markComplete(issue: EnrichedIssue) {
		if (!serverId || !$user?.uid || completingId) return;
		completingId = issue.id;

		try {
			const db = getDb();
			const issueRef = doc(db, 'servers', serverId, 'ticketAiIssues', issue.id);

			// Update issue status to closed
			await updateDoc(issueRef, {
				status: 'closed',
				closedAt: serverTimestamp(),
				statusTimeline: [
					...(issue.statusTimeline ?? []),
					{ status: 'closed', at: serverTimestamp() }
				]
			});

			// Add green checkmark reaction to the original message
			if (issue.parentMessageId) {
				try {
					await toggleChannelReaction(
						serverId,
						issue.channelId,
						issue.parentMessageId,
						$user.uid,
						DONE_EMOJI
					);
				} catch (reactionErr) {
					console.warn('[TicketPanel] Could not add checkmark reaction:', reactionErr);
				}
			}
		} catch (err) {
			console.error('[TicketPanel] Failed to mark complete:', err);
		} finally {
			completingId = null;
		}
	}

	function navigateToIssue(issue: EnrichedIssue) {
		dispatch('navigate', {
			channelId: issue.channelId,
			threadId: issue.threadId,
			messageId: issue.parentMessageId ?? undefined
		});
		// Navigate to the server channel with the thread
		goto(`/servers/${serverId}?channel=${issue.channelId}&thread=${issue.threadId}`);
	}

	function formatTime(timestamp: any): string {
		if (!timestamp) return '';
		const ms = typeof timestamp.toMillis === 'function' ? timestamp.toMillis() : timestamp;
		const date = new Date(ms);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const mins = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (mins < 1) return 'Just now';
		if (mins < 60) return `${mins}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days < 7) return `${days}d ago`;
		return date.toLocaleDateString();
	}

	function truncate(text: string | null | undefined, max = 60): string {
		if (!text) return 'Issue detected';
		if (text.length <= max) return text;
		return text.slice(0, max).trim() + '…';
	}

	let filteredIssues = $derived.by(() => {
		if (filter === 'mine') return issues.filter((i) => i.assignedToMe);
		if (filter === 'unassigned') return issues.filter((i) => !i.assignedToMe && !i.assignedToOther);
		return issues;
	});

	let unassignedCount = $derived(
		issues.filter((i) => !i.assignedToMe && !i.assignedToOther).length
	);
	let myCount = $derived(issues.filter((i) => i.assignedToMe).length);
	let totalCount = $derived(issues.length);

	// Derived: show panel for staff (always) - issues only load when enabled
	let showPanel = $derived(isStaff);
</script>

{#if showPanel}
	<div class="ticket-panel" class:ticket-panel--expanded={expanded}>
		<!-- FAB Button -->
		<button
			type="button"
			class="ticket-fab"
			class:ticket-fab--has-issues={unassignedCount > 0}
			class:ticket-fab--active={expanded}
			class:ticket-fab--disabled={!settings?.enabled}
			onclick={() => (expanded = !expanded)}
			aria-label="Toggle issues panel"
			aria-expanded={expanded}
		>
			<i class="bx {expanded ? 'bx-x' : 'bx-support'}"></i>
			{#if !expanded && totalCount > 0}
				<span class="ticket-fab__badge">{totalCount > 99 ? '99+' : totalCount}</span>
			{/if}
		</button>

		<!-- Expanded Panel -->
		{#if expanded}
			<div class="ticket-panel__content">
				<div class="ticket-panel__header">
					<h3><i class="bx bx-support"></i> Support Issues</h3>
					{#if settings?.enabled}
						<span class="ticket-panel__count">{totalCount} active</span>
					{:else}
						<span class="ticket-panel__count ticket-panel__count--disabled">Disabled</span>
					{/if}
				</div>

				{#if !settings?.enabled}
					<!-- Show message when Ticket AI is disabled -->
					<div class="ticket-panel__disabled-notice">
						<i class="bx bx-info-circle"></i>
						<p>Operations Hub is not enabled for this server.</p>
						<p class="ticket-panel__disabled-hint">Enable it in Server Settings → Integrations</p>
					</div>
				{:else}
					<!-- Filter Tabs -->
					<div class="ticket-panel__filters">
						<button
							type="button"
							class="filter-tab"
							class:filter-tab--active={filter === 'all'}
							onclick={() => (filter = 'all')}
						>
							All ({totalCount})
						</button>
						<button
							type="button"
							class="filter-tab"
							class:filter-tab--active={filter === 'unassigned'}
							onclick={() => (filter = 'unassigned')}
						>
							Open ({unassignedCount})
						</button>
						<button
							type="button"
							class="filter-tab"
							class:filter-tab--active={filter === 'mine'}
							onclick={() => (filter = 'mine')}
						>
							Mine ({myCount})
						</button>
					</div>

					<!-- Issues List -->
					<div class="ticket-panel__list">
						{#if loading}
							<div class="ticket-panel__empty">
								<i class="bx bx-loader-alt bx-spin"></i>
								<span>Loading issues…</span>
							</div>
						{:else if filteredIssues.length === 0}
							<div class="ticket-panel__empty">
								<i class="bx bx-check-circle"></i>
								<span
									>{filter === 'all'
										? 'No active issues'
										: filter === 'mine'
											? 'No issues assigned to you'
											: 'No unassigned issues'}</span
								>
							</div>
						{:else}
							{#each filteredIssues as issue (issue.id)}
								<div
									class="ticket-card"
									class:ticket-card--mine={issue.assignedToMe}
									class:ticket-card--other={issue.assignedToOther}
								>
									<div class="ticket-card__header">
										<span class="ticket-card__channel">#{issue.channelName}</span>
										<span class="ticket-card__time">{formatTime(issue.createdAt)}</span>
									</div>

									<div class="ticket-card__summary">
										{truncate(issue.summary)}
									</div>

									<div class="ticket-card__meta">
										{#if issue.typeTag}
											<span class="ticket-card__tag ticket-card__tag--{issue.typeTag}"
												>{issue.typeTag.replace('_', ' ')}</span
											>
										{/if}
										<span class="ticket-card__status ticket-card__status--{issue.status}">
											{issue.status === 'opened' ? 'Open' : 'In Progress'}
										</span>
										{#if issue.assignedToMe}
											<span class="ticket-card__assigned"
												><i class="bx bx-user-check"></i> Yours</span
											>
										{:else if issue.assignedToOther}
											<span class="ticket-card__assigned ticket-card__assigned--other"
												><i class="bx bx-user"></i> Assigned</span
											>
										{/if}
									</div>

									<div class="ticket-card__actions">
										<button
											type="button"
											class="ticket-btn ticket-btn--link"
											onclick={() => navigateToIssue(issue)}
											title="Go to thread"
										>
											<i class="bx bx-link-external"></i>
											View
										</button>

										{#if !issue.assignedToMe && !issue.assignedToOther}
											<button
												type="button"
												class="ticket-btn ticket-btn--claim"
												onclick={() => claimIssue(issue)}
												disabled={claimingId === issue.id}
												title="Claim this issue"
											>
												{#if claimingId === issue.id}
													<i class="bx bx-loader-alt bx-spin"></i>
												{:else}
													<i class="bx bx-hand"></i>
												{/if}
												Claim
											</button>
										{:else if issue.assignedToMe}
											<button
												type="button"
												class="ticket-btn ticket-btn--complete"
												onclick={() => markComplete(issue)}
												disabled={completingId === issue.id}
												title="Mark as resolved"
											>
												{#if completingId === issue.id}
													<i class="bx bx-loader-alt bx-spin"></i>
												{:else}
													<i class="bx bx-check"></i>
												{/if}
												Done
											</button>
										{/if}
									</div>
								</div>
							{/each}
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.ticket-panel {
		position: relative;
		z-index: 1;
	}

	.ticket-fab {
		width: 3.1rem;
		height: 3.1rem;
		border-radius: 999px;
		border: 1px solid rgba(249, 115, 22, 0.5);
		background: linear-gradient(135deg, rgba(249, 115, 22, 0.95), rgba(234, 88, 12, 0.9));
		box-shadow: 0 8px 20px rgba(249, 115, 22, 0.3);
		color: #fff;
		display: grid;
		place-items: center;
		font-size: 1.3rem;
		cursor: pointer;
		transition:
			transform 180ms cubic-bezier(0.2, 0.65, 0.25, 1),
			box-shadow 180ms ease,
			background 180ms ease;
		position: relative;
	}

	.ticket-fab:hover,
	.ticket-fab:focus-visible {
		transform: translateY(-2px);
		box-shadow: 0 12px 28px rgba(249, 115, 22, 0.45);
		outline: none;
	}

	.ticket-fab--has-issues {
		animation: pulse-glow 2s ease-in-out infinite;
	}

	.ticket-fab--active {
		background: linear-gradient(135deg, rgba(100, 116, 139, 0.95), rgba(71, 85, 105, 0.9));
		border-color: rgba(148, 163, 184, 0.4);
		box-shadow: 0 8px 20px rgba(100, 116, 139, 0.3);
	}

	@keyframes pulse-glow {
		0%,
		100% {
			box-shadow: 0 8px 20px rgba(249, 115, 22, 0.3);
		}
		50% {
			box-shadow: 0 8px 28px rgba(249, 115, 22, 0.5);
		}
	}

	.ticket-fab__badge {
		position: absolute;
		top: -4px;
		right: -4px;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: #dc2626;
		color: #fff;
		font-size: 11px;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
	}

	.ticket-panel__content {
		position: absolute;
		bottom: calc(100% + 12px);
		right: 0;
		width: 360px;
		max-height: 480px;
		background: var(--color-panel, #0f141c);
		border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
		border-radius: 16px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.ticket-panel__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
		background: var(--color-panel-muted, #131a24);
	}

	.ticket-panel__header h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--color-text-primary, #fff);
	}

	.ticket-panel__header h3 i {
		color: #f97316;
	}

	.ticket-panel__count {
		font-size: 12px;
		color: var(--color-text-secondary, #94a3b8);
		background: rgba(249, 115, 22, 0.15);
		padding: 4px 10px;
		border-radius: 999px;
	}

	.ticket-panel__count--disabled {
		background: rgba(100, 116, 139, 0.2);
		color: #64748b;
	}

	.ticket-fab--disabled {
		background: linear-gradient(135deg, rgba(100, 116, 139, 0.85), rgba(71, 85, 105, 0.8));
		border-color: rgba(100, 116, 139, 0.3);
		animation: none;
	}

	.ticket-panel__disabled-notice {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 32px 24px;
		text-align: center;
		color: var(--color-text-secondary, #94a3b8);
	}

	.ticket-panel__disabled-notice i {
		font-size: 32px;
		margin-bottom: 12px;
		color: #64748b;
	}

	.ticket-panel__disabled-notice p {
		margin: 0 0 8px;
		font-size: 14px;
	}

	.ticket-panel__disabled-hint {
		font-size: 12px;
		color: #64748b;
	}

	.ticket-panel__filters {
		display: flex;
		gap: 4px;
		padding: 10px 12px;
		border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.05));
	}

	.filter-tab {
		flex: 1;
		padding: 6px 8px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-secondary, #94a3b8);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition:
			background 150ms ease,
			color 150ms ease;
	}

	.filter-tab:hover {
		background: rgba(255, 255, 255, 0.05);
		color: var(--color-text-primary, #fff);
	}

	.filter-tab--active {
		background: rgba(249, 115, 22, 0.15);
		color: #f97316;
	}

	.ticket-panel__list {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.ticket-panel__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 40px 20px;
		color: var(--color-text-secondary, #94a3b8);
		gap: 8px;
	}

	.ticket-panel__empty i {
		font-size: 2rem;
		opacity: 0.5;
	}

	.ticket-card {
		background: var(--color-panel-muted, #131a24);
		border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.06));
		border-radius: 12px;
		padding: 12px;
		transition:
			border-color 150ms ease,
			transform 150ms ease;
	}

	.ticket-card:hover {
		border-color: rgba(249, 115, 22, 0.3);
	}

	.ticket-card--mine {
		border-left: 3px solid #22c55e;
	}

	.ticket-card--other {
		opacity: 0.6;
	}

	.ticket-card__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 6px;
	}

	.ticket-card__channel {
		font-size: 11px;
		font-weight: 600;
		color: var(--color-accent, #33c8bf);
	}

	.ticket-card__time {
		font-size: 10px;
		color: var(--color-text-secondary, #94a3b8);
	}

	.ticket-card__summary {
		font-size: 13px;
		color: var(--color-text-primary, #fff);
		line-height: 1.4;
		margin-bottom: 8px;
	}

	.ticket-card__meta {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		margin-bottom: 10px;
	}

	.ticket-card__tag {
		font-size: 10px;
		padding: 2px 8px;
		border-radius: 999px;
		background: rgba(148, 163, 184, 0.15);
		color: var(--color-text-secondary, #94a3b8);
		text-transform: capitalize;
	}

	.ticket-card__tag--bug {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}

	.ticket-card__tag--feature_request {
		background: rgba(168, 85, 247, 0.15);
		color: #a855f7;
	}

	.ticket-card__tag--question {
		background: rgba(59, 130, 246, 0.15);
		color: #3b82f6;
	}

	.ticket-card__status {
		font-size: 10px;
		padding: 2px 8px;
		border-radius: 999px;
		font-weight: 600;
	}

	.ticket-card__status--opened {
		background: rgba(249, 115, 22, 0.15);
		color: #f97316;
	}

	.ticket-card__status--in_progress {
		background: rgba(251, 191, 36, 0.15);
		color: #fbbf24;
	}

	.ticket-card__assigned {
		font-size: 10px;
		display: flex;
		align-items: center;
		gap: 3px;
		color: #22c55e;
	}

	.ticket-card__assigned--other {
		color: var(--color-text-secondary, #94a3b8);
	}

	.ticket-card__actions {
		display: flex;
		gap: 6px;
	}

	.ticket-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 6px 10px;
		border: none;
		border-radius: 8px;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 150ms ease,
			transform 100ms ease;
	}

	.ticket-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.ticket-btn:active:not(:disabled) {
		transform: scale(0.97);
	}

	.ticket-btn--link {
		background: rgba(148, 163, 184, 0.1);
		color: var(--color-text-secondary, #94a3b8);
	}

	.ticket-btn--link:hover:not(:disabled) {
		background: rgba(148, 163, 184, 0.2);
		color: var(--color-text-primary, #fff);
	}

	.ticket-btn--claim {
		background: rgba(249, 115, 22, 0.15);
		color: #f97316;
	}

	.ticket-btn--claim:hover:not(:disabled) {
		background: rgba(249, 115, 22, 0.25);
	}

	.ticket-btn--complete {
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
	}

	.ticket-btn--complete:hover:not(:disabled) {
		background: rgba(34, 197, 94, 0.25);
	}

	/* Mobile responsiveness */
	@media (max-width: 420px) {
		.ticket-panel__content {
			width: calc(100vw - 32px);
			max-width: 360px;
		}
	}
</style>
