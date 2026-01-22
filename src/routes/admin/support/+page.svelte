<script lang="ts">
	import type { PageData } from './$types';
	import AdminCard from '$lib/admin/components/AdminCard.svelte';
	import { goto } from '$app/navigation';
	import { showAdminToast } from '$lib/admin/stores/toast';
	import { getDb } from '$lib/firebase';
	import { doc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
	import { isMobileViewport } from '$lib/stores/viewport';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	// Local reactive state for tickets and servers (so updates trigger re-renders)
	let allTickets = $state([...data.allTickets]);
	let servers = $state([...data.servers]);

	// State
	let searchQuery = $state('');
	let statusFilter = $state<'all' | 'opened' | 'in_progress' | 'closed'>('all');
	let serverFilter = $state<string>('all');
	let typeFilter = $state<'all' | 'bug' | 'feature_request' | 'question' | 'other'>('all');
	let selectedTicket = $state<typeof data.recentTickets[number] | null>(null);
	let showTicketModal = $state(false);
	let actionBusy = $state(false);

	// Dropdown states
	let statusDropdownOpen = $state(false);
	let serverDropdownOpen = $state(false);
	let typeDropdownOpen = $state(false);

	const mobileViewport = $derived($isMobileViewport);

	// Computed stats based on local ticket state
	const liveStats = $derived({
		totalTickets: allTickets.length,
		openTickets: allTickets.filter(t => t.status === 'opened').length,
		inProgressTickets: allTickets.filter(t => t.status === 'in_progress').length,
		closedTickets: allTickets.filter(t => t.status === 'closed').length,
		totalServersWithSupport: data.stats.totalServersWithSupport,
		ticketsLast24h: data.stats.ticketsLast24h,
		ticketsLast7d: data.stats.ticketsLast7d,
		avgResponseTimeMs: data.stats.avgResponseTimeMs
	});

	// Dropdown options
	const statusOptions = [
		{ value: 'all', label: 'All Statuses' },
		{ value: 'opened', label: 'Open' },
		{ value: 'in_progress', label: 'In Progress' },
		{ value: 'closed', label: 'Closed' }
	] as const;

	const typeOptions = [
		{ value: 'all', label: 'All Types' },
		{ value: 'bug', label: 'Bug' },
		{ value: 'feature_request', label: 'Feature Request' },
		{ value: 'question', label: 'Question' },
		{ value: 'other', label: 'Other' }
	] as const;

	const serverOptions = $derived([
		{ value: 'all', label: 'All Servers' },
		...servers.map(s => ({ value: s.id, label: `${s.name} (${s.totalTickets})` }))
	]);

	function closeAllDropdowns() {
		statusDropdownOpen = false;
		serverDropdownOpen = false;
		typeDropdownOpen = false;
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.custom-dropdown')) {
			closeAllDropdowns();
		}
	}

	// Stat cards
	const statCards = $derived([
		{
			key: 'total',
			label: 'Total Tickets',
			value: liveStats.totalTickets,
			icon: 'bx-receipt',
			color: 'from-blue-500 to-indigo-500'
		},
		{
			key: 'open',
			label: 'Open',
			value: liveStats.openTickets,
			icon: 'bx-envelope-open',
			color: 'from-amber-500 to-orange-500'
		},
		{
			key: 'progress',
			label: 'In Progress',
			value: liveStats.inProgressTickets,
			icon: 'bx-loader-alt',
			color: 'from-cyan-500 to-teal-500'
		},
		{
			key: 'closed',
			label: 'Resolved',
			value: liveStats.closedTickets,
			icon: 'bx-check-circle',
			color: 'from-emerald-500 to-green-500'
		}
	]);

	const timeStats = $derived([
		{
			key: '24h',
			label: 'Last 24h',
			value: liveStats.ticketsLast24h,
			icon: 'bx-time-five',
			color: 'from-purple-500 to-violet-500'
		},
		{
			key: '7d',
			label: 'Last 7 Days',
			value: liveStats.ticketsLast7d,
			icon: 'bx-calendar-week',
			color: 'from-rose-500 to-pink-500'
		},
		{
			key: 'servers',
			label: 'Servers Enabled',
			value: liveStats.totalServersWithSupport,
			icon: 'bx-server',
			color: 'from-teal-500 to-cyan-500'
		},
		{
			key: 'avgResponse',
			label: 'Avg Response',
			value: formatDuration(liveStats.avgResponseTimeMs),
			icon: 'bx-stopwatch',
			color: 'from-indigo-500 to-blue-500',
			isTime: true
		}
	]);

	// Filter tickets
	const filteredTickets = $derived.by(() => {
		let tickets = [...allTickets];

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

		return tickets;
	});

	// Helpers
	function formatDuration(ms: number | null): string {
		if (ms === null) return '--';
		const hours = Math.floor(ms / (1000 * 60 * 60));
		const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
		if (hours > 24) {
			const days = Math.floor(hours / 24);
			return `${days}d ${hours % 24}h`;
		}
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	}

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

	function getTypeLabel(type: string | null): string {
		switch (type) {
			case 'bug':
				return 'Bug';
			case 'feature_request':
				return 'Feature';
			case 'question':
				return 'Question';
			case 'other':
				return 'Other';
			default:
				return 'General';
		}
	}

	// Actions
	function openTicketDetail(ticket: typeof data.recentTickets[number]) {
		selectedTicket = ticket;
		showTicketModal = true;
	}

	function closeTicketModal() {
		showTicketModal = false;
		selectedTicket = null;
	}

	async function updateTicketStatus(ticketId: string, serverId: string, newStatus: string) {
		actionBusy = true;
		try {
			const db = getDb();
			await updateDoc(doc(db, 'servers', serverId, 'ticketAiIssues', ticketId), {
				status: newStatus,
				...(newStatus === 'closed' ? { closedAt: new Date() } : {})
			});
			showAdminToast({ type: 'success', message: `Ticket marked as ${getStatusLabel(newStatus)}` });
			// Update local reactive state
			allTickets = allTickets.map((t) =>
				t.id === ticketId ? { ...t, status: newStatus } : t
			);
			if (selectedTicket?.id === ticketId) {
				selectedTicket = { ...selectedTicket, status: newStatus };
			}
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: 'Failed to update ticket status' });
		} finally {
			actionBusy = false;
		}
	}

	async function deleteTicket(ticketId: string, serverId: string) {
		if (!confirm('Are you sure you want to permanently delete this ticket?')) return;
		
		actionBusy = true;
		try {
			const db = getDb();
			await deleteDoc(doc(db, 'servers', serverId, 'ticketAiIssues', ticketId));
			showAdminToast({ type: 'success', message: 'Ticket deleted' });
			allTickets = allTickets.filter((t) => t.id !== ticketId);
			if (selectedTicket?.id === ticketId) {
				closeTicketModal();
			}
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: 'Failed to delete ticket' });
		} finally {
			actionBusy = false;
		}
	}

	async function deleteAllServerTickets(serverId: string, serverName: string) {
		if (!confirm(`Are you sure you want to delete ALL tickets for "${serverName}"? This cannot be undone.`)) return;
		
		actionBusy = true;
		try {
			const db = getDb();
			const ticketsRef = collection(db, 'servers', serverId, 'ticketAiIssues');
			const snapshot = await getDocs(ticketsRef);
			
			const deletePromises = snapshot.docs.map((d) => deleteDoc(d.ref));
			await Promise.all(deletePromises);
			
			showAdminToast({ type: 'success', message: `Deleted ${snapshot.size} tickets from ${serverName}` });
			allTickets = allTickets.filter((t) => t.serverId !== serverId);
			servers = servers.filter((s) => s.id !== serverId);
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: 'Failed to delete server tickets' });
		} finally {
			actionBusy = false;
		}
	}

	async function toggleServerSupport(serverId: string, currentEnabled: boolean) {
		actionBusy = true;
		try {
			const db = getDb();
			await updateDoc(doc(db, 'servers', serverId, 'ticketAiSettings', 'current'), {
				enabled: !currentEnabled
			});
			showAdminToast({ 
				type: 'success', 
				message: `Support AI ${!currentEnabled ? 'enabled' : 'disabled'} for server` 
			});
			servers = servers.map((s) =>
				s.id === serverId ? { ...s, enabled: !currentEnabled } : s
			);
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: 'Failed to toggle support status' });
		} finally {
			actionBusy = false;
		}
	}

	function exportTickets() {
		const csv = [
			['ID', 'Server', 'Status', 'Type', 'Author', 'Summary', 'Created', 'Messages'].join(','),
			...filteredTickets.map((t) =>
				[
					t.id,
					`"${t.serverName}"`,
					t.status,
					t.typeTag ?? 'general',
					`"${t.authorName ?? 'Unknown'}"`,
					`"${(t.summary ?? '').replace(/"/g, '""')}"`,
					t.createdAt?.toISOString() ?? '',
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
		showAdminToast({ type: 'success', message: `Exported ${filteredTickets.length} tickets` });
	}
</script>

<div class="admin-page space-y-6">
	<!-- Overview Stats -->
	<div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
		{#each statCards as stat}
			<button
				type="button"
				class="group relative overflow-hidden rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-4 text-left transition-all duration-200 hover:scale-[1.02] hover:shadow-lg sm:p-5"
				style="background: color-mix(in srgb, var(--surface-panel) 95%, transparent);"
				onclick={() => {
					if (stat.key === 'open') statusFilter = 'opened';
					else if (stat.key === 'progress') statusFilter = 'in_progress';
					else if (stat.key === 'closed') statusFilter = 'closed';
					else statusFilter = 'all';
				}}
			>
				<div
					class="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-gradient-to-br {stat.color} opacity-10 transition-transform duration-300 group-hover:scale-150"
				></div>
				<div class="relative">
					<div
						class="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br {stat.color}"
					>
						<i class="bx {stat.icon} text-xl text-white"></i>
					</div>
					<p class="text-2xl font-bold text-[color:var(--color-text-primary)] sm:text-3xl">
						{stat.value.toLocaleString()}
					</p>
					<p
						class="mt-1 text-xs font-medium uppercase tracking-wider text-[color:var(--text-60,#6b7280)]"
					>
						{stat.label}
					</p>
				</div>
			</button>
		{/each}
	</div>

	<!-- Time-based Stats -->
	<div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
		{#each timeStats as stat}
			<div
				class="relative overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
				style="background: color-mix(in srgb, var(--surface-panel) 90%, transparent);"
			>
				<div class="flex items-center gap-3">
					<div
						class="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br {stat.color} opacity-80"
					>
						<i class="bx {stat.icon} text-lg text-white"></i>
					</div>
					<div>
						<p class="text-lg font-semibold text-[color:var(--color-text-primary)]">
							{stat.isTime ? stat.value : stat.value.toLocaleString()}
						</p>
						<p class="text-xs text-[color:var(--text-60,#6b7280)]">{stat.label}</p>
					</div>
				</div>
			</div>
		{/each}
	</div>

	<!-- Quick Actions -->
	<div class="flex flex-wrap gap-2">
		<button
			type="button"
			class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
			onclick={() => goto('/admin/support/tickets')}
		>
			<i class="bx bx-list-ul"></i>
			All Tickets
		</button>
		<button
			type="button"
			class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
			onclick={() => goto('/admin/support/servers')}
		>
			<i class="bx bx-server"></i>
			Server Config
		</button>
		<button
			type="button"
			class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
			onclick={() => goto('/admin/support/analytics')}
		>
			<i class="bx bx-bar-chart-alt-2"></i>
			Analytics
		</button>
		<button
			type="button"
			class="flex items-center gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-4 py-2.5 text-sm font-medium text-[color:var(--color-text-primary)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)6%,transparent)]"
			onclick={exportTickets}
		>
			<i class="bx bx-export"></i>
			Export CSV
		</button>
		<button
			type="button"
			class="flex items-center gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-4 py-2.5 text-sm font-medium text-[color:var(--color-text-primary)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)6%,transparent)]"
			onclick={() => goto('/support')}
		>
			<i class="bx bx-link-external"></i>
			Open Staff Dashboard
		</button>
	</div>

	<!-- Search & Filters -->
	<AdminCard title="All Tickets" description="Search and manage tickets across all servers">
		<div class="space-y-4">
			<!-- Search Bar -->
			<div class="flex flex-col gap-3 sm:flex-row">
				<div class="relative flex-1">
					<i
						class="bx bx-search absolute left-3 top-1/2 -translate-y-1/2 text-lg text-[color:var(--text-50,#94a3b8)]"
					></i>
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Search tickets by summary, author, server..."
						class="w-full rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] bg-[color-mix(in_srgb,var(--surface-root)50%,transparent)] py-2.5 pl-10 pr-4 text-sm text-[color:var(--color-text-primary)] placeholder-[color:var(--text-50,#94a3b8)] outline-none transition focus:border-[color:var(--accent-primary)] focus:ring-2 focus:ring-[color:var(--accent-primary)]/20"
					/>
				</div>
			</div>

			<!-- Filters -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="flex flex-wrap gap-2" onclick={handleClickOutside}>
				<!-- Status Filter -->
				<div class="custom-dropdown relative">
					<button
						type="button"
						class="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white hover:border-zinc-600 transition-colors min-w-[140px]"
						onclick={(e) => {
							e.stopPropagation();
							statusDropdownOpen = !statusDropdownOpen;
							serverDropdownOpen = false;
							typeDropdownOpen = false;
						}}
					>
						<span class="flex-1 text-left">{statusOptions.find(o => o.value === statusFilter)?.label}</span>
						<i class="bx bx-chevron-down text-zinc-400 transition-transform {statusDropdownOpen ? 'rotate-180' : ''}"></i>
					</button>
					{#if statusDropdownOpen}
						<div class="absolute top-full left-0 z-50 mt-1 w-full min-w-[160px] rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
							{#each statusOptions as option}
								<button
									type="button"
									class="w-full px-3 py-2 text-left text-sm transition-colors {statusFilter === option.value ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'}"
									onclick={(e) => {
										e.stopPropagation();
										statusFilter = option.value;
										statusDropdownOpen = false;
									}}
								>
									{option.label}
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Server Filter -->
				<div class="custom-dropdown relative">
					<button
						type="button"
						class="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white hover:border-zinc-600 transition-colors min-w-[180px]"
						onclick={(e) => {
							e.stopPropagation();
							serverDropdownOpen = !serverDropdownOpen;
							statusDropdownOpen = false;
							typeDropdownOpen = false;
						}}
					>
						<span class="flex-1 text-left truncate">{serverOptions.find(o => o.value === serverFilter)?.label}</span>
						<i class="bx bx-chevron-down text-zinc-400 transition-transform {serverDropdownOpen ? 'rotate-180' : ''}"></i>
					</button>
					{#if serverDropdownOpen}
						<div class="absolute top-full left-0 z-50 mt-1 w-full min-w-[200px] max-h-[300px] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
							{#each serverOptions as option}
								<button
									type="button"
									class="w-full px-3 py-2 text-left text-sm transition-colors {serverFilter === option.value ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'}"
									onclick={(e) => {
										e.stopPropagation();
										serverFilter = option.value;
										serverDropdownOpen = false;
									}}
								>
									{option.label}
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Type Filter -->
				<div class="custom-dropdown relative">
					<button
						type="button"
						class="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white hover:border-zinc-600 transition-colors min-w-[140px]"
						onclick={(e) => {
							e.stopPropagation();
							typeDropdownOpen = !typeDropdownOpen;
							statusDropdownOpen = false;
							serverDropdownOpen = false;
						}}
					>
						<span class="flex-1 text-left">{typeOptions.find(o => o.value === typeFilter)?.label}</span>
						<i class="bx bx-chevron-down text-zinc-400 transition-transform {typeDropdownOpen ? 'rotate-180' : ''}"></i>
					</button>
					{#if typeDropdownOpen}
						<div class="absolute top-full left-0 z-50 mt-1 w-full min-w-[160px] rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
							{#each typeOptions as option}
								<button
									type="button"
									class="w-full px-3 py-2 text-left text-sm transition-colors {typeFilter === option.value ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'}"
									onclick={(e) => {
										e.stopPropagation();
										typeFilter = option.value;
										typeDropdownOpen = false;
									}}
								>
									{option.label}
								</button>
							{/each}
						</div>
					{/if}
				</div>

				{#if searchQuery || statusFilter !== 'all' || serverFilter !== 'all' || typeFilter !== 'all'}
					<button
						type="button"
						class="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-violet-400 hover:bg-violet-500/10 transition-colors"
						onclick={() => {
							searchQuery = '';
							statusFilter = 'all';
							serverFilter = 'all';
							typeFilter = 'all';
						}}
					>
						<i class="bx bx-x"></i>
						Clear Filters
					</button>
				{/if}
			</div>

			<!-- Results Count -->
			<p class="text-sm text-[color:var(--text-60,#6b7280)]">
				Showing {filteredTickets.length} of {allTickets.length} tickets
			</p>

			<!-- Tickets Table -->
			<div class="overflow-x-auto">
				<table class="w-full min-w-[700px]">
					<thead>
						<tr
							class="border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)]"
						>
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
								class="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]"
								>Actions</th
							>
						</tr>
					</thead>
					<tbody class="divide-y divide-[color:color-mix(in_srgb,var(--color-text-primary)5%,transparent)]">
						{#each filteredTickets.slice(0, 50) as ticket (ticket.id)}
							<tr
								class="group cursor-pointer transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)4%,transparent)]"
								onclick={() => openTicketDetail(ticket)}
							>
								<td class="px-3 py-3">
									<div class="flex flex-col gap-0.5">
										<span
											class="text-sm font-medium text-[color:var(--color-text-primary)] line-clamp-1"
										>
											{ticket.summary ?? 'No summary'}
										</span>
										<span class="text-xs text-[color:var(--text-50,#94a3b8)]">
											{ticket.authorName ?? 'Unknown'} · {ticket.messageCount} messages
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
										{getTypeLabel(ticket.typeTag)}
									</span>
								</td>
								<td class="px-3 py-3">
									<span class="text-sm text-[color:var(--text-60,#6b7280)]">
										{formatRelativeTime(ticket.createdAt)}
									</span>
								</td>
								<td class="px-3 py-3 text-right">
									<div class="flex items-center justify-end gap-1 opacity-0 transition group-hover:opacity-100">
										{#if ticket.status !== 'closed'}
											<button
												type="button"
												class="rounded-lg p-1.5 text-emerald-400 hover:bg-emerald-500/10"
												title="Mark as Closed"
												onclick={(e) => {
													e.stopPropagation();
													updateTicketStatus(ticket.id, ticket.serverId, 'closed');
												}}
											>
												<i class="bx bx-check-circle text-lg"></i>
											</button>
										{/if}
										<button
											type="button"
											class="rounded-lg p-1.5 text-rose-400 hover:bg-rose-500/10"
											title="Delete Ticket"
											onclick={(e) => {
												e.stopPropagation();
												deleteTicket(ticket.id, ticket.serverId);
											}}
										>
											<i class="bx bx-trash text-lg"></i>
										</button>
									</div>
								</td>
							</tr>
						{:else}
							<tr>
								<td colspan="6" class="px-3 py-12 text-center">
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

			{#if filteredTickets.length > 50}
				<p class="text-center text-sm text-[color:var(--text-50,#94a3b8)]">
					Showing first 50 results. Refine your search to see more specific tickets.
				</p>
			{/if}
		</div>
	</AdminCard>

	<!-- Servers Overview -->
	<AdminCard title="Servers with Support" description="Manage AI support per server">
		<div class="space-y-3">
			{#each servers as server (server.id)}
				<div
					class="flex flex-col gap-3 rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4 sm:flex-row sm:items-center sm:justify-between"
					style="background: color-mix(in srgb, var(--surface-root) 50%, transparent);"
				>
					<div class="flex items-center gap-3">
						{#if server.icon}
							<img
								src={server.icon}
								alt={server.name}
								class="h-10 w-10 rounded-xl object-cover"
							/>
						{:else}
							<div
								class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600"
							>
								<span class="text-lg font-bold text-white">
									{server.name.charAt(0).toUpperCase()}
								</span>
							</div>
						{/if}
						<div>
							<p class="font-medium text-[color:var(--color-text-primary)]">{server.name}</p>
							<p class="text-xs text-[color:var(--text-50,#94a3b8)]">
								{server.totalTickets} total · {server.openTickets} open · {server.inProgressTickets} in progress
							</p>
						</div>
					</div>
					<div class="flex items-center gap-2">
						<span
							class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium {server.enabled ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-gray-500/20 text-gray-400 border-gray-500/30'}"
						>
							{server.enabled ? 'Enabled' : 'Disabled'}
						</span>
						<button
							type="button"
							class="rounded-lg p-2 text-[color:var(--text-60)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)] hover:text-[color:var(--color-text-primary)]"
							title="Toggle Support"
							onclick={() => toggleServerSupport(server.id, server.enabled)}
							disabled={actionBusy}
						>
							<i class="bx {server.enabled ? 'bx-toggle-right text-emerald-400' : 'bx-toggle-left'} text-xl"></i>
						</button>
						<button
							type="button"
							class="rounded-lg p-2 text-[color:var(--text-60)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)] hover:text-[color:var(--color-text-primary)]"
							title="View Server Tickets"
							onclick={() => {
								serverFilter = server.id;
								document.querySelector('.admin-page')?.scrollTo({ top: 0, behavior: 'smooth' });
							}}
						>
							<i class="bx bx-list-ul text-lg"></i>
						</button>
						<button
							type="button"
							class="rounded-lg p-2 text-rose-400 transition hover:bg-rose-500/10"
							title="Delete All Tickets"
							onclick={() => deleteAllServerTickets(server.id, server.name)}
							disabled={actionBusy}
						>
							<i class="bx bx-trash text-lg"></i>
						</button>
					</div>
				</div>
			{:else}
				<div class="py-8 text-center">
					<i class="bx bx-server text-4xl text-[color:var(--text-40,#94a3b8)]"></i>
					<p class="mt-2 text-sm text-[color:var(--text-60,#6b7280)]">
						No servers with support tickets yet
					</p>
				</div>
			{/each}
		</div>
	</AdminCard>
</div>

<!-- Ticket Detail Modal -->
{#if showTicketModal && selectedTicket}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
		onclick={closeTicketModal}
		onkeydown={(e) => e.key === 'Escape' && closeTicketModal()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div
			class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			onkeydown={() => {}}
			role="document"
			tabindex="0"
		>
			<!-- Modal Header -->
			<div
				class="flex items-center justify-between border-b border-zinc-700 px-6 py-4"
			>
				<div class="flex items-center gap-3">
					<div
						class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-cyan-500"
					>
						<i class="bx bx-support text-xl text-white"></i>
					</div>
					<div>
						<h2 class="text-lg font-semibold text-[color:var(--color-text-primary)]">
							Ticket Details
						</h2>
						<p class="text-xs text-[color:var(--text-50,#94a3b8)]">
							ID: {selectedTicket.id.slice(0, 8)}...
						</p>
					</div>
				</div>
				<button
					type="button"
					class="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
					onclick={closeTicketModal}
				>
					<i class="bx bx-x text-2xl"></i>
				</button>
			</div>

			<!-- Modal Content -->
			<div class="space-y-4 px-6 py-5">
				<!-- Status & Type -->
				<div class="flex flex-wrap gap-2">
					<span
						class="inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium {getStatusColor(
							selectedTicket.status
						)}"
					>
						{getStatusLabel(selectedTicket.status)}
					</span>
					<span
						class="inline-flex items-center gap-1 rounded-full border border-zinc-600 bg-zinc-800 px-3 py-1 text-sm text-zinc-300"
					>
						<i class="bx {getTypeIcon(selectedTicket.typeTag)}"></i>
						{getTypeLabel(selectedTicket.typeTag)}
					</span>
				</div>

				<!-- Summary -->
				<div>
					<h3 class="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
						Summary
					</h3>
					<p class="text-white">
						{selectedTicket.summary ?? 'No summary available'}
					</p>
				</div>

				<!-- Details Grid -->
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<h3 class="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
							Server
						</h3>
						<p class="text-white">{selectedTicket.serverName}</p>
					</div>
					<div>
						<h3 class="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
							Author
						</h3>
						<p class="text-white">
							{selectedTicket.authorName ?? 'Unknown'}
						</p>
					</div>
					<div>
						<h3 class="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
							Created
						</h3>
						<p class="text-white">
							{formatDate(selectedTicket.createdAt)}
						</p>
					</div>
					<div>
						<h3 class="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
							Last Activity
						</h3>
						<p class="text-white">
							{formatRelativeTime(selectedTicket.lastMessageAt ?? selectedTicket.createdAt)}
						</p>
					</div>
					<div>
						<h3 class="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
							Messages
						</h3>
						<p class="text-white">{selectedTicket.messageCount}</p>
					</div>
					<div>
						<h3 class="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
							Staff Assigned
						</h3>
						<p class="text-white">
							{selectedTicket.staffMemberIds.length > 0
								? `${selectedTicket.staffMemberIds.length} member(s)`
								: 'Unassigned'}
						</p>
					</div>
				</div>

				<!-- View Full Details Link -->
				<div class="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
					<div class="flex items-center justify-between">
						<div>
							<h3 class="text-sm font-medium text-white">View Full Conversation</h3>
							<p class="text-xs text-zinc-400">See complete ticket details, messages, and timeline</p>
						</div>
						<a
							href="/admin/support/ticket/{selectedTicket.serverId}/{selectedTicket.id}"
							class="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700"
						>
							<i class="bx bx-message-detail"></i>
							View Details
						</a>
					</div>
				</div>

				<!-- Actions -->
				<div
					class="flex flex-wrap gap-2 border-t border-zinc-700 pt-4"
				>
					{#if selectedTicket.status !== 'opened'}
						<button
							type="button"
							class="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-400 transition hover:bg-amber-500/20"
							onclick={() =>
								updateTicketStatus(selectedTicket!.id, selectedTicket!.serverId, 'opened')}
							disabled={actionBusy}
						>
							<i class="bx bx-envelope-open"></i>
							Reopen
						</button>
					{/if}
					{#if selectedTicket.status !== 'in_progress'}
						<button
							type="button"
							class="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-400 transition hover:bg-cyan-500/20"
							onclick={() =>
								updateTicketStatus(selectedTicket!.id, selectedTicket!.serverId, 'in_progress')}
							disabled={actionBusy}
						>
							<i class="bx bx-loader-alt"></i>
							In Progress
						</button>
					{/if}
					{#if selectedTicket.status !== 'closed'}
						<button
							type="button"
							class="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/20"
							onclick={() =>
								updateTicketStatus(selectedTicket!.id, selectedTicket!.serverId, 'closed')}
							disabled={actionBusy}
						>
							<i class="bx bx-check-circle"></i>
							Close
						</button>
					{/if}
					<button
						type="button"
						class="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-400 transition hover:bg-rose-500/20"
						onclick={() => deleteTicket(selectedTicket!.id, selectedTicket!.serverId)}
						disabled={actionBusy}
					>
						<i class="bx bx-trash"></i>
						Delete
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
