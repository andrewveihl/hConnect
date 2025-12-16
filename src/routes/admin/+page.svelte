<script lang="ts">
	import type { PageData } from './$types';
	import AdminCard from '$lib/admin/components/AdminCard.svelte';
	import { logsToText } from '$lib/admin/logs';
	import { showAdminToast } from '$lib/admin/stores/toast';
	import { goto } from '$app/navigation';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const statItems = $derived([
		{
			key: 'servers',
			label: 'Servers',
			value: data.stats.servers,
			icon: 'bx-server',
			color: 'from-teal-500 to-cyan-500',
			href: '/admin/servers'
		},
		{
			key: 'users',
			label: 'Users',
			value: data.stats.users,
			icon: 'bx-group',
			color: 'from-violet-500 to-purple-500',
			href: '/admin/users'
		},
		{
			key: 'dms',
			label: 'DM Threads',
			value: data.stats.dms,
			icon: 'bx-message-detail',
			color: 'from-amber-500 to-orange-500',
			href: '/admin/dms'
		},
		{
			key: 'logs',
			label: 'Logs (7d)',
			value: data.stats.logs,
			icon: 'bx-list-ul',
			color: 'from-rose-500 to-pink-500',
			href: '/admin/logs'
		}
	]);

	const handleCopyLogs = async () => {
		try {
			await navigator.clipboard.writeText(logsToText(data.recentLogs));
			showAdminToast({ type: 'success', message: 'Copied current log view.' });
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: 'Unable to copy logs. Check clipboard permissions.'
			});
		}
	};

	const formatDate = (value: Date | string | null | undefined) => {
		if (!value) return '--';
		const date = value instanceof Date ? value : new Date(value);
		return date.toLocaleString();
	};

	const formatRelativeTime = (value: Date | string | null | undefined) => {
		if (!value) return '--';
		const date = value instanceof Date ? value : new Date(value);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		return `${days}d ago`;
	};
</script>

<div class="admin-page space-y-6">
	<!-- Stats Grid -->
	<div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
		{#each statItems as stat}
			<button
				type="button"
				class="group relative overflow-hidden rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-4 text-left transition-all duration-200 hover:scale-[1.02] hover:shadow-lg sm:p-5"
				style="background: color-mix(in srgb, var(--surface-panel) 95%, transparent);"
				onclick={() => goto(stat.href)}
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

	<!-- Quick Actions -->
	<div class="flex flex-wrap gap-2">
		<button
			type="button"
			class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
			onclick={() => goto('/admin/features')}
		>
			<i class="bx bx-toggle-right"></i>
			Feature Flags
		</button>
		<button
			type="button"
			class="flex items-center gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-4 py-2.5 text-sm font-medium text-[color:var(--color-text-primary)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)6%,transparent)]"
			onclick={() => goto('/admin/health')}
		>
			<i class="bx bx-pulse"></i>
			System Health
		</button>
		<button
			type="button"
			class="flex items-center gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-4 py-2.5 text-sm font-medium text-[color:var(--color-text-primary)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)6%,transparent)]"
			onclick={() => goto('/admin/announcements')}
		>
			<i class="bx bx-bell"></i>
			Announcements
		</button>
	</div>

	<!-- Content Grid -->
	<div class="grid gap-4 lg:grid-cols-2">
		<!-- Newest Servers -->
		<AdminCard title="Newest Servers" description="Latest created or restored servers.">
			<div class="space-y-2">
				{#if data.spotlightServers.length === 0}
					<p class="py-4 text-center text-sm text-[color:var(--text-60,#6b7280)]">
						No servers yet.
					</p>
				{:else}
					{#each data.spotlightServers as server}
						<button
							type="button"
							class="flex w-full items-center gap-3 rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-3 text-left transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)4%,transparent)]"
							onclick={() => goto(`/admin/servers?id=${server.id}`)}
						>
							<div
								class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-700"
							>
								<i class="bx bx-server text-white"></i>
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate font-semibold text-[color:var(--color-text-primary)]">
									{server.name}
								</p>
								<p class="truncate text-xs text-[color:var(--text-60,#6b7280)]">{server.owner}</p>
							</div>
							<div class="flex flex-col items-end gap-1">
								<span
									class={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
										server.status === 'active'
											? 'bg-emerald-500/20 text-emerald-600'
											: 'bg-amber-500/20 text-amber-600'
									}`}
								>
									{server.status}
								</span>
								<span class="text-[10px] text-[color:var(--text-50,#94a3b8)]">
									{formatRelativeTime(server.createdAt)}
								</span>
							</div>
						</button>
					{/each}
				{/if}
			</div>
		</AdminCard>

		<!-- Recent Logs -->
		<AdminCard title="Recent Activity" description="Live snapshot of the latest actions.">
			<div class="space-y-2">
				<div class="flex justify-end">
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[color:var(--accent-primary,#14b8a6)] transition hover:bg-[color-mix(in_srgb,var(--accent-primary,#14b8a6)10%,transparent)]"
						onclick={handleCopyLogs}
					>
						<i class="bx bx-copy"></i>
						Copy
					</button>
				</div>
				{#if data.recentLogs.length === 0}
					<p class="py-4 text-center text-sm text-[color:var(--text-60,#6b7280)]">
						No logs yet. Actions will appear here.
					</p>
				{:else}
					<div class="space-y-2">
						{#each data.recentLogs.slice(0, 6) as log}
							<div
								class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-3"
							>
								<div class="flex items-start justify-between gap-2">
									<p class="text-sm font-medium text-[color:var(--color-text-primary)]">
										{log.message}
									</p>
									<span
										class={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
											log.level === 'info'
												? 'bg-sky-500/20 text-sky-600'
												: log.level === 'warning'
													? 'bg-amber-500/20 text-amber-600'
													: 'bg-rose-500/20 text-rose-600'
										}`}
									>
										{log.level}
									</span>
								</div>
								<div
									class="mt-1 flex items-center gap-2 text-[10px] text-[color:var(--text-50,#94a3b8)]"
								>
									<span class="uppercase">{log.type}</span>
									<span>•</span>
									<span>{formatRelativeTime(log.createdAt)}</span>
								</div>
							</div>
						{/each}
					</div>
					<button
						type="button"
						class="mt-2 w-full rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] py-2.5 text-sm font-medium text-[color:var(--color-text-primary)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)4%,transparent)]"
						onclick={() => goto('/admin/logs')}
					>
						View All Logs
					</button>
				{/if}
			</div>
		</AdminCard>
	</div>

	<!-- Error Logs Section -->
	{#if data.recentErrorLogs?.length}
		<AdminCard
			title="Recent Errors"
			description="Latest high-severity entries requiring attention."
		>
			<div class="space-y-2">
				{#each data.recentErrorLogs.slice(0, 4) as log}
					<div class="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
						<div class="flex items-start gap-3">
							<div
								class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/20"
							>
								<i class="bx bx-error text-rose-500"></i>
							</div>
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium text-[color:var(--color-text-primary)]">
									{log.message}
								</p>
								<div
									class="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[color:var(--text-50,#94a3b8)]"
								>
									<span class="uppercase">{log.type}</span>
									{#if log.userId}
										<span>• User: {log.userId.slice(0, 8)}...</span>
									{/if}
									<span>• {formatRelativeTime(log.createdAt)}</span>
								</div>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</AdminCard>
	{/if}
</div>
