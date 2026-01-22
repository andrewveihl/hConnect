<script lang="ts">
	import type { PageData } from './$types';
	import AdminCard from '$lib/admin/components/AdminCard.svelte';
	import { goto } from '$app/navigation';
	import { showAdminToast } from '$lib/admin/stores/toast';
	import { getDb } from '$lib/firebase';
	import { doc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
	import { isMobileViewport } from '$lib/stores/viewport';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	// State
	let searchQuery = $state('');
	let statusFilter = $state<'all' | 'opened' | 'in_progress' | 'closed'>('all');
	let serverFilter = $state<string>('all');
	let typeFilter = $state<'all' | 'bug' | 'feature_request' | 'question' | 'other'>('all');
	let dateFilter = $state<'all' | '24h' | '7d' | '30d' | '90d'>('all');
	let sortBy = $state<'created' | 'updated' | 'messages'>('created');
	let sortOrder = $state<'asc' | 'desc'>('desc');
	let selectedTickets = $state<Set<string>>(new Set());
	let actionBusy = $state(false);
	let showBulkActions = $state(false);

	const mobileViewport = $derived($isMobileViewport);

	// Filter tickets
	const filteredTickets = $derived.by(() => {
		let tickets = [...data.allTickets];

		// Search filter
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			tickets = tickets.filter(
				(t) =>
					t.summary?.toLowerCase().includes(q) ||
					t.authorName?.toLowerCase().includes(q) ||
					t.serverName.toLowerCase().includes(q) ||
					t.id.toLowerCase().includes(q)
			);
		}

		// Status filter
		if (statusFilter !== 'all') {
			tickets = tickets.filter((t) => t.status === statusFilter);
		}

		// Server filter
		if (serverFilter !== 'all') {
			tickets = tickets.filter((t) => t.serverId === serverFilter);
		}

		// Type filter
		if (typeFilter !== 'all') {
			tickets = tickets.filter((t) => t.typeTag === typeFilter);
		}

		// Date filter
		if (dateFilter !== 'all') {
			const now = Date.now();
			const cutoffs: Record<string, number> = {
				'24h': 24 * 60 * 60 * 1000,
				'7d': 7 * 24 * 60 * 60 * 1000,
				'30d': 30 * 24 * 60 * 60 * 1000,
				'90d': 90 * 24 * 60 * 60 * 1000
			};
			const cutoff = now - cutoffs[dateFilter];
			tickets = tickets.filter((t) => (t.createdAt?.getTime() ?? 0) > cutoff);
		}

		// Sort
		tickets.sort((a, b) => {
			let aVal: number, bVal: number;
			switch (sortBy) {
				case 'created':
					aVal = a.createdAt?.getTime() ?? 0;
					bVal = b.createdAt?.getTime() ?? 0;
					break;
				case 'updated':
					aVal = a.lastMessageAt?.getTime() ?? a.createdAt?.getTime() ?? 0;
					bVal = b.lastMessageAt?.getTime() ?? b.createdAt?.getTime() ?? 0;
					break;
				case 'messages':
					aVal = a.messageCount;
					bVal = b.messageCount;
					break;
				default:
					aVal = 0;
					bVal = 0;
			}
			return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
		});

		return tickets;
	});

	const allSelected = $derived(
		filteredTickets.length > 0 && selectedTickets.size === filteredTickets.length
	);
	const someSelected = $derived(selectedTickets.size > 0 && !allSelected);

	// Helpers
	function formatDate(date: Date | null): string {
		if (!date) return '--';
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatRelativeTime(date: Date | null): string {
		if (!date) return '--';
		const diff = Date.now() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days < 30) return `${days}d ago`;
		return `${Math.floor(days / 30)}mo ago`;
	}

	function getStatusColor(status: string): string {
		switch (status) {
			case 'opened':
				return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
			case 'in_progress':
				return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
			case 'closed':
				return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
			default:
				return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
		}
	}

	function getStatusLabel(status: string): string {
		switch (status) {
			case 'opened':
				return 'Open';
			case 'in_progress':
				return 'In Progress';
			case 'closed':
				return 'Closed';
			default:
				return status;
		}
	}

	function getTypeIcon(type: string | null): string {
		switch (type) {
			case 'bug':
				return 'bx-bug';
			case 'feature_request':
				return 'bx-bulb';
			case 'question':
				return 'bx-help-circle';
			default:
				return 'bx-message-detail';
		}
	}

	// Selection
	function toggleSelect(ticketId: string) {
		const newSet = new Set(selectedTickets);
		if (newSet.has(ticketId)) {
			newSet.delete(ticketId);
		} else {
			newSet.add(ticketId);
		}
		selectedTickets = newSet;
	}

	function toggleSelectAll() {
		if (allSelected) {
			selectedTickets = new Set();
		} else {
			selectedTickets = new Set(filteredTickets.map((t) => t.id));
		}
	}

	// Bulk Actions
	async function bulkUpdateStatus(newStatus: string) {
		if (selectedTickets.size === 0) return;

		actionBusy = true;
		try {
			const db = getDb();
			const batch = writeBatch(db);
			let count = 0;

			for (const ticket of filteredTickets) {
				if (selectedTickets.has(ticket.id)) {
					const ref = doc(db, 'servers', ticket.serverId, 'ticketAiIssues', ticket.id);
					batch.update(ref, {
						status: newStatus,
						...(newStatus === 'closed' ? { closedAt: new Date() } : {})
					});
					count++;
				}
			}

			await batch.commit();
			showAdminToast({
				type: 'success',
				message: `Updated ${count} tickets to ${getStatusLabel(newStatus)}`
			});

			// Update local data
			data.allTickets = data.allTickets.map((t) =>
				selectedTickets.has(t.id) ? { ...t, status: newStatus } : t
			);
			selectedTickets = new Set();
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: 'Failed to update tickets' });
		} finally {
			actionBusy = false;
		}
	}

	async function bulkDelete() {
		if (selectedTickets.size === 0) return;
		if (!confirm(`Delete ${selectedTickets.size} tickets? This cannot be undone.`)) return;

		actionBusy = true;
		try {
			const db = getDb();
			const deletePromises: Promise<void>[] = [];

			for (const ticket of filteredTickets) {
				if (selectedTickets.has(ticket.id)) {
					deletePromises.push(
						deleteDoc(doc(db, 'servers', ticket.serverId, 'ticketAiIssues', ticket.id))
					);
				}
			}

			await Promise.all(deletePromises);
			showAdminToast({
				type: 'success',
				message: `Deleted ${selectedTickets.size} tickets`
			});

			// Update local data
			data.allTickets = data.allTickets.filter((t) => !selectedTickets.has(t.id));
			selectedTickets = new Set();
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: 'Failed to delete tickets' });
		} finally {
			actionBusy = false;
		}
	}

	function exportSelected() {
		const ticketsToExport = selectedTickets.size > 0
			? filteredTickets.filter((t) => selectedTickets.has(t.id))
			: filteredTickets;

		const csv = [
			['ID', 'Server', 'Status', 'Type', 'Author', 'Summary', 'Created', 'Last Activity', 'Messages'].join(','),
			...ticketsToExport.map((t) =>
				[
					t.id,
					`"${t.serverName}"`,
					t.status,
					t.typeTag ?? 'general',
					`"${t.authorName ?? 'Unknown'}"`,
					`"${(t.summary ?? '').replace(/"/g, '""')}"`,
					t.createdAt?.toISOString() ?? '',
					t.lastMessageAt?.toISOString() ?? '',
					t.messageCount
				].join(',')
			)
		].join('\n');

		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `support-tickets-${new Date().toISOString().split('T')[0]}.csv`;
		a.click();
		URL.revokeObjectURL(url);
		showAdminToast({
			type: 'success',
			message: `Exported ${ticketsToExport.length} tickets`
		});
	}
</script>

<div class="admin-page space-y-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<button
				type="button"
				class="mb-2 flex items-center gap-1 text-sm text-[color:var(--text-60)] hover:text-[color:var(--color-text-primary)]"
				onclick={() => goto('/admin/support')}
			>
				<i class="bx bx-arrow-back"></i>
				Back to Support Overview
			</button>
			<h1 class="text-2xl font-bold text-[color:var(--color-text-primary)]">All Tickets</h1>
			<p class="text-sm text-[color:var(--text-60)]">
				{filteredTickets.length} of {data.allTickets.length} tickets
			</p>
		</div>
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
				onclick={exportSelected}
			>
				<i class="bx bx-export"></i>
				Export {selectedTickets.size > 0 ? `(${selectedTickets.size})` : 'All'}
			</button>
		</div>
	</div>

	<!-- Filters -->
	<AdminCard padded={true}>
		<div class="space-y-4">
			<!-- Search -->
			<div class="relative">
				<i
					class="bx bx-search absolute left-3 top-1/2 -translate-y-1/2 text-lg text-[color:var(--text-50,#94a3b8)]"
				></i>
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search by summary, author, server, or ticket ID..."
					class="w-full rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] bg-[color-mix(in_srgb,var(--surface-root)50%,transparent)] py-3 pl-10 pr-4 text-sm text-[color:var(--color-text-primary)] placeholder-[color:var(--text-50,#94a3b8)] outline-none transition focus:border-[color:var(--accent-primary)] focus:ring-2 focus:ring-[color:var(--accent-primary)]/20"
				/>
			</div>

			<!-- Filter Row -->
			<div class="flex flex-wrap items-center gap-2">
				<select
					bind:value={statusFilter}
					class="rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)80%,transparent)] px-3 py-2 text-sm text-[color:var(--color-text-primary)] outline-none"
				>
					<option value="all">All Statuses</option>
					<option value="opened">Open</option>
					<option value="in_progress">In Progress</option>
					<option value="closed">Closed</option>
				</select>

				<select
					bind:value={serverFilter}
					class="rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)80%,transparent)] px-3 py-2 text-sm text-[color:var(--color-text-primary)] outline-none"
				>
					<option value="all">All Servers</option>
					{#each data.servers as server}
						<option value={server.id}>{server.name}</option>
					{/each}
				</select>

				<select
					bind:value={typeFilter}
					class="rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)80%,transparent)] px-3 py-2 text-sm text-[color:var(--color-text-primary)] outline-none"
				>
					<option value="all">All Types</option>
					<option value="bug">Bug</option>
					<option value="feature_request">Feature Request</option>
					<option value="question">Question</option>
					<option value="other">Other</option>
				</select>

				<select
					bind:value={dateFilter}
					class="rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)80%,transparent)] px-3 py-2 text-sm text-[color:var(--color-text-primary)] outline-none"
				>
					<option value="all">All Time</option>
					<option value="24h">Last 24 Hours</option>
					<option value="7d">Last 7 Days</option>
					<option value="30d">Last 30 Days</option>
					<option value="90d">Last 90 Days</option>
				</select>

				<div class="ml-auto flex items-center gap-2">
					<select
						bind:value={sortBy}
						class="rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)80%,transparent)] px-3 py-2 text-sm text-[color:var(--color-text-primary)] outline-none"
					>
						<option value="created">Sort by Created</option>
						<option value="updated">Sort by Updated</option>
						<option value="messages">Sort by Messages</option>
					</select>

					<button
						type="button"
						class="rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] p-2 text-[color:var(--text-60)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)]"
						onclick={() => (sortOrder = sortOrder === 'desc' ? 'asc' : 'desc')}
						title="Toggle sort order"
					>
						<i class="bx {sortOrder === 'desc' ? 'bx-sort-down' : 'bx-sort-up'} text-lg"></i>
					</button>
				</div>
			</div>

			<!-- Bulk Actions Bar -->
			{#if selectedTickets.size > 0}
				<div
					class="flex flex-wrap items-center gap-2 rounded-xl border border-[color:var(--accent-primary)]/30 bg-[color:var(--accent-primary)]/10 p-3"
				>
					<span class="text-sm font-medium text-[color:var(--color-text-primary)]">
						{selectedTickets.size} selected
					</span>
					<div class="flex items-center gap-1">
						<button
							type="button"
							class="rounded-lg px-3 py-1.5 text-sm font-medium text-amber-400 transition hover:bg-amber-500/10"
							onclick={() => bulkUpdateStatus('opened')}
							disabled={actionBusy}
						>
							<i class="bx bx-envelope-open mr-1"></i>Open
						</button>
						<button
							type="button"
							class="rounded-lg px-3 py-1.5 text-sm font-medium text-cyan-400 transition hover:bg-cyan-500/10"
							onclick={() => bulkUpdateStatus('in_progress')}
							disabled={actionBusy}
						>
							<i class="bx bx-loader-alt mr-1"></i>In Progress
						</button>
						<button
							type="button"
							class="rounded-lg px-3 py-1.5 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/10"
							onclick={() => bulkUpdateStatus('closed')}
							disabled={actionBusy}
						>
							<i class="bx bx-check-circle mr-1"></i>Close
						</button>
						<button
							type="button"
							class="rounded-lg px-3 py-1.5 text-sm font-medium text-rose-400 transition hover:bg-rose-500/10"
							onclick={bulkDelete}
							disabled={actionBusy}
						>
							<i class="bx bx-trash mr-1"></i>Delete
						</button>
					</div>
					<button
						type="button"
						class="ml-auto text-sm text-[color:var(--text-60)] hover:text-[color:var(--color-text-primary)]"
						onclick={() => (selectedTickets = new Set())}
					>
						Clear selection
					</button>
				</div>
			{/if}
		</div>
	</AdminCard>

	<!-- Tickets Table -->
	<AdminCard padded={false}>
		<div class="overflow-x-auto">
			<table class="w-full min-w-[800px]">
				<thead>
					<tr
						class="border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)]"
					>
						<th class="w-10 px-4 py-3">
							<input
								type="checkbox"
								checked={allSelected}
								indeterminate={someSelected}
								onchange={toggleSelectAll}
								class="h-4 w-4 rounded border-[color:color-mix(in_srgb,var(--color-text-primary)20%,transparent)] bg-transparent text-[color:var(--accent-primary)]"
							/>
						</th>
						<th
							class="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]"
							>Ticket</th
						>
						<th
							class="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]"
							>Server</th
						>
						<th
							class="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]"
							>Status</th
						>
						<th
							class="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]"
							>Type</th
						>
						<th
							class="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]"
							>Created</th
						>
						<th
							class="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]"
							>Messages</th
						>
					</tr>
				</thead>
				<tbody
					class="divide-y divide-[color:color-mix(in_srgb,var(--color-text-primary)5%,transparent)]"
				>
					{#each filteredTickets as ticket (ticket.id)}
						<tr
							class="group transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)4%,transparent)] {selectedTickets.has(ticket.id) ? 'bg-[color:var(--accent-primary)]/5' : ''}"
						>
							<td class="px-4 py-3">
								<input
									type="checkbox"
									checked={selectedTickets.has(ticket.id)}
									onchange={() => toggleSelect(ticket.id)}
									class="h-4 w-4 rounded border-[color:color-mix(in_srgb,var(--color-text-primary)20%,transparent)] bg-transparent text-[color:var(--accent-primary)]"
								/>
							</td>
							<td class="px-3 py-3">
								<div class="flex flex-col gap-0.5">
									<span
										class="text-sm font-medium text-[color:var(--color-text-primary)] line-clamp-1"
									>
										{ticket.summary ?? 'No summary'}
									</span>
									<span class="text-xs text-[color:var(--text-50,#94a3b8)]">
										{ticket.authorName ?? 'Unknown'} · {ticket.id.slice(0, 8)}...
									</span>
								</div>
							</td>
							<td class="px-3 py-3">
								<span class="text-sm text-[color:var(--color-text-primary)]">
									{ticket.serverName}
								</span>
							</td>
							<td class="px-3 py-3">
								<span
									class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium {getStatusColor(
										ticket.status
									)}"
								>
									{getStatusLabel(ticket.status)}
								</span>
							</td>
							<td class="px-3 py-3">
								<span class="flex items-center gap-1 text-sm text-[color:var(--text-60,#6b7280)]">
									<i class="bx {getTypeIcon(ticket.typeTag)} text-base"></i>
								</span>
							</td>
							<td class="px-3 py-3">
								<div class="flex flex-col">
									<span class="text-sm text-[color:var(--color-text-primary)]">
										{formatRelativeTime(ticket.createdAt)}
									</span>
									<span class="text-xs text-[color:var(--text-50,#94a3b8)]">
										{formatDate(ticket.createdAt)}
									</span>
								</div>
							</td>
							<td class="px-3 py-3">
								<span class="text-sm text-[color:var(--color-text-primary)]">
									{ticket.messageCount}
								</span>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="7" class="px-3 py-12 text-center">
								<div class="flex flex-col items-center gap-2">
									<i class="bx bx-search text-4xl text-[color:var(--text-40,#94a3b8)]"></i>
									<p class="text-sm text-[color:var(--text-60,#6b7280)]">No tickets found</p>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</AdminCard>
</div>
