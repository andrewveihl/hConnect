<script lang="ts">
	import type { PageData } from './$types';
	import AdminCard from '$lib/admin/components/AdminCard.svelte';
	import { goto } from '$app/navigation';
	import { showAdminToast } from '$lib/admin/stores/toast';
	import { getDb } from '$lib/firebase';
	import { doc, updateDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
	import { isMobileViewport } from '$lib/stores/viewport';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	// State
	let searchQuery = $state('');
	let filterEnabled = $state<'all' | 'enabled' | 'disabled'>('all');
	let selectedServer = $state<(typeof data.servers)[number] | null>(null);
	let showConfigModal = $state(false);
	let actionBusy = $state(false);

	// Config form state
	let configForm = $state({
		enabled: false,
		staffDomains: '',
		retention: 'forever' as 'forever' | '1y' | '90d'
	});

	const mobileViewport = $derived($isMobileViewport);

	// Filter servers
	const filteredServers = $derived.by(() => {
		let servers = [...data.servers];

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			servers = servers.filter(
				(s) =>
					s.name.toLowerCase().includes(q) ||
					s.ownerName?.toLowerCase().includes(q) ||
					s.id.toLowerCase().includes(q)
			);
		}

		if (filterEnabled === 'enabled') {
			servers = servers.filter((s) => s.enabled);
		} else if (filterEnabled === 'disabled') {
			servers = servers.filter((s) => !s.enabled);
		}

		return servers;
	});

	const enabledCount = $derived(data.servers.filter((s) => s.enabled).length);
	const totalTickets = $derived(data.servers.reduce((acc, s) => acc + s.ticketStats.total, 0));

	// Open config modal
	function openConfig(server: (typeof data.servers)[number]) {
		selectedServer = server;
		configForm = {
			enabled: server.enabled,
			staffDomains: server.staffDomains.join(', '),
			retention: server.retention as 'forever' | '1y' | '90d'
		};
		showConfigModal = true;
	}

	function closeModal() {
		showConfigModal = false;
		selectedServer = null;
	}

	// Save config
	async function saveConfig() {
		if (!selectedServer) return;

		actionBusy = true;
		try {
			const db = getDb();
			const staffDomains = configForm.staffDomains
				.split(',')
				.map((d) => d.trim())
				.filter((d) => d.length > 0);

			await setDoc(
				doc(db, 'servers', selectedServer.id, 'ticketAiSettings', 'current'),
				{
					enabled: configForm.enabled,
					staffDomains,
					retention: configForm.retention,
					monitoredChannelIds: selectedServer.monitoredChannelIds,
					staffMemberIds: selectedServer.staffMemberIds,
					allowedRoleIds: []
				},
				{ merge: true }
			);

			showAdminToast({ type: 'success', message: 'Server support settings updated' });

			// Update local data
			data.servers = data.servers.map((s) =>
				s.id === selectedServer!.id
					? { ...s, enabled: configForm.enabled, staffDomains, retention: configForm.retention }
					: s
			);

			closeModal();
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: 'Failed to update settings' });
		} finally {
			actionBusy = false;
		}
	}

	// Toggle enabled
	async function toggleEnabled(server: (typeof data.servers)[number]) {
		actionBusy = true;
		try {
			const db = getDb();
			await setDoc(
				doc(db, 'servers', server.id, 'ticketAiSettings', 'current'),
				{ enabled: !server.enabled },
				{ merge: true }
			);

			showAdminToast({
				type: 'success',
				message: `Support AI ${!server.enabled ? 'enabled' : 'disabled'} for ${server.name}`
			});

			data.servers = data.servers.map((s) =>
				s.id === server.id ? { ...s, enabled: !s.enabled } : s
			);
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: 'Failed to toggle support status' });
		} finally {
			actionBusy = false;
		}
	}

	// Delete all tickets for server
	async function deleteAllTickets(server: (typeof data.servers)[number]) {
		if (
			!confirm(
				`Delete ALL ${server.ticketStats.total} tickets for "${server.name}"? This cannot be undone.`
			)
		)
			return;

		actionBusy = true;
		try {
			const db = getDb();
			const ticketsRef = collection(db, 'servers', server.id, 'ticketAiIssues');
			const snapshot = await getDocs(ticketsRef);

			const deletePromises = snapshot.docs.map((d) => deleteDoc(d.ref));
			await Promise.all(deletePromises);

			showAdminToast({
				type: 'success',
				message: `Deleted ${snapshot.size} tickets from ${server.name}`
			});

			data.servers = data.servers.map((s) =>
				s.id === server.id
					? { ...s, ticketStats: { total: 0, open: 0, inProgress: 0, closed: 0 } }
					: s
			);
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: 'Failed to delete tickets' });
		} finally {
			actionBusy = false;
		}
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
			<h1 class="text-2xl font-bold text-[color:var(--color-text-primary)]">Server Configuration</h1>
			<p class="text-sm text-[color:var(--text-60)]">
				{enabledCount} of {data.servers.length} servers enabled · {totalTickets} total tickets
			</p>
		</div>
	</div>

	<!-- Stats Cards -->
	<div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
		<div
			class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
			style="background: color-mix(in srgb, var(--surface-panel) 90%, transparent);"
		>
			<div class="flex items-center gap-3">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-cyan-500"
				>
					<i class="bx bx-server text-xl text-white"></i>
				</div>
				<div>
					<p class="text-2xl font-bold text-[color:var(--color-text-primary)]">
						{data.servers.length}
					</p>
					<p class="text-xs text-[color:var(--text-60)]">Total Servers</p>
				</div>
			</div>
		</div>
		<div
			class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
			style="background: color-mix(in srgb, var(--surface-panel) 90%, transparent);"
		>
			<div class="flex items-center gap-3">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-green-500"
				>
					<i class="bx bx-check-circle text-xl text-white"></i>
				</div>
				<div>
					<p class="text-2xl font-bold text-[color:var(--color-text-primary)]">{enabledCount}</p>
					<p class="text-xs text-[color:var(--text-60)]">Support Enabled</p>
				</div>
			</div>
		</div>
		<div
			class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
			style="background: color-mix(in srgb, var(--surface-panel) 90%, transparent);"
		>
			<div class="flex items-center gap-3">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-500"
				>
					<i class="bx bx-receipt text-xl text-white"></i>
				</div>
				<div>
					<p class="text-2xl font-bold text-[color:var(--color-text-primary)]">{totalTickets}</p>
					<p class="text-xs text-[color:var(--text-60)]">Total Tickets</p>
				</div>
			</div>
		</div>
		<div
			class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
			style="background: color-mix(in srgb, var(--surface-panel) 90%, transparent);"
		>
			<div class="flex items-center gap-3">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-pink-500"
				>
					<i class="bx bx-x-circle text-xl text-white"></i>
				</div>
				<div>
					<p class="text-2xl font-bold text-[color:var(--color-text-primary)]">
						{data.servers.length - enabledCount}
					</p>
					<p class="text-xs text-[color:var(--text-60)]">Support Disabled</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Search & Filter -->
	<div class="flex flex-col gap-3 sm:flex-row">
		<div class="relative flex-1">
			<i
				class="bx bx-search absolute left-3 top-1/2 -translate-y-1/2 text-lg text-[color:var(--text-50,#94a3b8)]"
			></i>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search servers..."
				class="w-full rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] bg-[color-mix(in_srgb,var(--surface-root)50%,transparent)] py-2.5 pl-10 pr-4 text-sm text-[color:var(--color-text-primary)] placeholder-[color:var(--text-50,#94a3b8)] outline-none transition focus:border-[color:var(--accent-primary)]"
			/>
		</div>
		<select
			bind:value={filterEnabled}
			class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)80%,transparent)] px-4 py-2.5 text-sm text-[color:var(--color-text-primary)] outline-none"
		>
			<option value="all">All Servers</option>
			<option value="enabled">Enabled Only</option>
			<option value="disabled">Disabled Only</option>
		</select>
	</div>

	<!-- Servers List -->
	<div class="space-y-3">
		{#each filteredServers as server (server.id)}
			<div
				class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4 transition hover:border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)]"
				style="background: color-mix(in srgb, var(--surface-panel) 95%, transparent);"
			>
				<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<!-- Server Info -->
					<div class="flex items-center gap-4">
						{#if server.icon}
							<img src={server.icon} alt={server.name} class="h-12 w-12 rounded-xl object-cover" />
						{:else}
							<div
								class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600"
							>
								<span class="text-xl font-bold text-white">
									{server.name.charAt(0).toUpperCase()}
								</span>
							</div>
						{/if}
						<div>
							<h3 class="font-semibold text-[color:var(--color-text-primary)]">{server.name}</h3>
							<p class="text-sm text-[color:var(--text-50)]">
								Owner: {server.ownerName ?? 'Unknown'} · ID: {server.id.slice(0, 8)}...
							</p>
						</div>
					</div>

					<!-- Stats & Actions -->
					<div class="flex flex-wrap items-center gap-3">
						<!-- Ticket Stats -->
						<div
							class="flex items-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-3 py-1.5"
						>
							<span class="text-xs text-[color:var(--text-50)]">Tickets:</span>
							<span class="font-medium text-[color:var(--color-text-primary)]">
								{server.ticketStats.total}
							</span>
							{#if server.ticketStats.open > 0}
								<span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-400">
									{server.ticketStats.open} open
								</span>
							{/if}
						</div>

						<!-- Status Badge -->
						<span
							class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium {server.enabled ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-gray-500/20 text-gray-400 border-gray-500/30'}"
						>
							{server.enabled ? 'Enabled' : 'Disabled'}
						</span>

						<!-- Actions -->
						<div class="flex items-center gap-1">
							<button
								type="button"
								class="rounded-lg p-2 text-[color:var(--text-60)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)] hover:text-[color:var(--color-text-primary)]"
								title="Configure"
								onclick={() => openConfig(server)}
							>
								<i class="bx bx-cog text-lg"></i>
							</button>
							<button
								type="button"
								class="rounded-lg p-2 transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)]"
								class:text-emerald-400={server.enabled}
								class:text-gray-400={!server.enabled}
								title={server.enabled ? 'Disable Support' : 'Enable Support'}
								onclick={() => toggleEnabled(server)}
								disabled={actionBusy}
							>
								<i
									class="bx text-lg"
									class:bx-toggle-right={server.enabled}
									class:bx-toggle-left={!server.enabled}
								></i>
							</button>
							{#if server.ticketStats.total > 0}
								<button
									type="button"
									class="rounded-lg p-2 text-rose-400 transition hover:bg-rose-500/10"
									title="Delete All Tickets"
									onclick={() => deleteAllTickets(server)}
									disabled={actionBusy}
								>
									<i class="bx bx-trash text-lg"></i>
								</button>
							{/if}
						</div>
					</div>
				</div>

				<!-- Extra Info -->
				{#if server.enabled && (server.monitoredChannelNames.length > 0 || server.staffDomains.length > 0)}
					<div
						class="mt-3 flex flex-wrap gap-4 border-t border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] pt-3 text-xs"
					>
						{#if server.monitoredChannelNames.length > 0}
							<div class="flex items-center gap-1 text-[color:var(--text-50)]">
								<i class="bx bx-hash"></i>
								<span>Channels: {server.monitoredChannelNames.join(', ')}</span>
							</div>
						{/if}
						{#if server.staffDomains.length > 0}
							<div class="flex items-center gap-1 text-[color:var(--text-50)]">
								<i class="bx bx-at"></i>
								<span>Staff Domains: {server.staffDomains.join(', ')}</span>
							</div>
						{/if}
						<div class="flex items-center gap-1 text-[color:var(--text-50)]">
							<i class="bx bx-time"></i>
							<span>Retention: {server.retention}</span>
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<div class="py-12 text-center">
				<i class="bx bx-server text-4xl text-[color:var(--text-40)]"></i>
				<p class="mt-2 text-sm text-[color:var(--text-60)]">No servers found</p>
			</div>
		{/each}
	</div>
</div>

<!-- Config Modal -->
{#if showConfigModal && selectedServer}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={closeModal}
		onkeydown={(e) => e.key === 'Escape' && closeModal()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div
			class="w-full max-w-lg rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] shadow-2xl"
			style="background: var(--surface-panel);"
			onclick={(e) => e.stopPropagation()}
			onkeydown={() => {}}
			role="document"
			tabindex="0"
		>
			<!-- Header -->
			<div
				class="flex items-center justify-between border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-6 py-4"
			>
				<div class="flex items-center gap-3">
					{#if selectedServer.icon}
						<img
							src={selectedServer.icon}
							alt={selectedServer.name}
							class="h-10 w-10 rounded-xl object-cover"
						/>
					{:else}
						<div
							class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600"
						>
							<span class="text-lg font-bold text-white">
								{selectedServer.name.charAt(0).toUpperCase()}
							</span>
						</div>
					{/if}
					<div>
						<h2 class="font-semibold text-[color:var(--color-text-primary)]">
							{selectedServer.name}
						</h2>
						<p class="text-xs text-[color:var(--text-50)]">Support AI Configuration</p>
					</div>
				</div>
				<button
					type="button"
					class="rounded-lg p-2 text-[color:var(--text-60)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)10%,transparent)]"
					onclick={closeModal}
				>
					<i class="bx bx-x text-2xl"></i>
				</button>
			</div>

			<!-- Form -->
			<div class="space-y-4 px-6 py-5">
				<!-- Enable Toggle -->
				<label class="flex items-center justify-between">
					<span class="text-sm font-medium text-[color:var(--color-text-primary)]"
						>Enable Support AI</span
					>
					<button
						type="button"
						class="relative h-6 w-11 rounded-full transition-colors"
						class:bg-emerald-500={configForm.enabled}
						class:bg-gray-600={!configForm.enabled}
						onclick={() => (configForm.enabled = !configForm.enabled)}
					>
						<span
							class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
							class:translate-x-5={configForm.enabled}
						></span>
					</button>
				</label>

				<!-- Staff Domains -->
				<div>
					<label class="mb-1 block text-sm font-medium text-[color:var(--color-text-primary)]">
						Staff Email Domains
					</label>
					<input
						type="text"
						bind:value={configForm.staffDomains}
						placeholder="@company.com, @support.com"
						class="w-full rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] bg-[color-mix(in_srgb,var(--surface-root)50%,transparent)] px-3 py-2 text-sm text-[color:var(--color-text-primary)] outline-none transition focus:border-[color:var(--accent-primary)]"
					/>
					<p class="mt-1 text-xs text-[color:var(--text-50)]">
						Comma-separated list of email domains for staff members
					</p>
				</div>

				<!-- Retention -->
				<div>
					<label class="mb-1 block text-sm font-medium text-[color:var(--color-text-primary)]">
						Ticket Retention
					</label>
					<select
						bind:value={configForm.retention}
						class="w-full rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)80%,transparent)] px-3 py-2 text-sm text-[color:var(--color-text-primary)] outline-none"
					>
						<option value="forever">Forever</option>
						<option value="1y">1 Year</option>
						<option value="90d">90 Days</option>
					</select>
				</div>

				<!-- Current Stats -->
				<div
					class="rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-3"
				>
					<h4 class="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-50)]">
						Current Statistics
					</h4>
					<div class="grid grid-cols-2 gap-2 text-sm">
						<div>
							<span class="text-[color:var(--text-50)]">Total Tickets:</span>
							<span class="ml-1 font-medium text-[color:var(--color-text-primary)]">
								{selectedServer.ticketStats.total}
							</span>
						</div>
						<div>
							<span class="text-[color:var(--text-50)]">Open:</span>
							<span class="ml-1 font-medium text-amber-400">
								{selectedServer.ticketStats.open}
							</span>
						</div>
						<div>
							<span class="text-[color:var(--text-50)]">In Progress:</span>
							<span class="ml-1 font-medium text-cyan-400">
								{selectedServer.ticketStats.inProgress}
							</span>
						</div>
						<div>
							<span class="text-[color:var(--text-50)]">Closed:</span>
							<span class="ml-1 font-medium text-emerald-400">
								{selectedServer.ticketStats.closed}
							</span>
						</div>
					</div>
				</div>
			</div>

			<!-- Footer -->
			<div
				class="flex justify-end gap-2 border-t border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-6 py-4"
			>
				<button
					type="button"
					class="rounded-lg px-4 py-2 text-sm font-medium text-[color:var(--text-60)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)]"
					onclick={closeModal}
				>
					Cancel
				</button>
				<button
					type="button"
					class="rounded-lg bg-gradient-to-r from-teal-500 to-cyan-500 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
					onclick={saveConfig}
					disabled={actionBusy}
				>
					{actionBusy ? 'Saving...' : 'Save Changes'}
				</button>
			</div>
		</div>
	</div>
{/if}
