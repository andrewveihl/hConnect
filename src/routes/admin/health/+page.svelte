<script lang="ts">
	import type { PageData } from './$types';
	import AdminCard from '$lib/admin/components/AdminCard.svelte';
	import { showAdminToast } from '$lib/admin/stores/toast';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	let refreshing = $state(false);
	let storageEstimate: { usage: number; quota: number } | null = $state(null);
	let connectionStatus = $state<'online' | 'offline'>('online');

	const metrics = $derived([
		{
			label: 'Total Servers',
			value: data.metrics.totalServers,
			icon: 'bx-server',
			color: 'from-teal-500 to-cyan-500'
		},
		{
			label: 'Total Users',
			value: data.metrics.totalUsers,
			icon: 'bx-group',
			color: 'from-violet-500 to-purple-500'
		},
		{
			label: 'DM Threads',
			value: data.metrics.totalDms,
			icon: 'bx-message-detail',
			color: 'from-amber-500 to-orange-500'
		},
		{
			label: 'Total Logs',
			value: data.metrics.totalLogs,
			icon: 'bx-list-ul',
			color: 'from-slate-500 to-slate-600'
		},
		{
			label: 'Logs (24h)',
			value: data.metrics.logsLast24h,
			icon: 'bx-time',
			color: 'from-sky-500 to-blue-500'
		},
		{
			label: 'Errors (24h)',
			value: data.metrics.errorsLast24h,
			icon: 'bx-error-circle',
			color:
				data.metrics.errorsLast24h > 10
					? 'from-rose-500 to-red-500'
					: 'from-emerald-500 to-green-500'
		}
	]);

	const healthStatus = $derived(() => {
		const errorRate = data.metrics.errorsLast24h;
		if (errorRate === 0)
			return { status: 'healthy', label: 'All Systems Operational', color: 'emerald' };
		if (errorRate < 5) return { status: 'warning', label: 'Minor Issues Detected', color: 'amber' };
		if (errorRate < 20)
			return { status: 'degraded', label: 'Performance Degraded', color: 'orange' };
		return { status: 'critical', label: 'Critical Issues', color: 'rose' };
	});

	const formatBytes = (bytes: number) => {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	};

	const formatRelativeTime = (value: Date | string | null | undefined) => {
		if (!value) return '--';
		const date = value instanceof Date ? value : new Date(value);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);

		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		return date.toLocaleDateString();
	};

	onMount(() => {
		if (browser) {
			// Check storage
			if ('storage' in navigator && 'estimate' in navigator.storage) {
				navigator.storage.estimate().then((estimate) => {
					storageEstimate = {
						usage: estimate.usage ?? 0,
						quota: estimate.quota ?? 0
					};
				});
			}

			// Monitor connection
			connectionStatus = navigator.onLine ? 'online' : 'offline';
			const handleOnline = () => (connectionStatus = 'online');
			const handleOffline = () => (connectionStatus = 'offline');
			window.addEventListener('online', handleOnline);
			window.addEventListener('offline', handleOffline);

			return () => {
				window.removeEventListener('online', handleOnline);
				window.removeEventListener('offline', handleOffline);
			};
		}
	});

	const handleRefresh = async () => {
		refreshing = true;
		try {
			// Force page reload to refresh data
			window.location.reload();
		} catch (err) {
			showAdminToast({ type: 'error', message: 'Failed to refresh metrics' });
			refreshing = false;
		}
	};

	const clearLocalStorage = () => {
		if (!browser) return;
		try {
			const keysToPreserve = ['firebase:authUser'];
			const allKeys = Object.keys(localStorage);
			let cleared = 0;

			allKeys.forEach((key) => {
				if (!keysToPreserve.some((preserve) => key.includes(preserve))) {
					localStorage.removeItem(key);
					cleared++;
				}
			});

			showAdminToast({ type: 'success', message: `Cleared ${cleared} local storage items` });
		} catch (err) {
			showAdminToast({ type: 'error', message: 'Failed to clear local storage' });
		}
	};
</script>

<div class="admin-page space-y-6">
	<!-- Health Status Banner -->
	<div
		class={`relative overflow-hidden rounded-2xl p-6 ${
			healthStatus().color === 'emerald'
				? 'bg-emerald-500/10'
				: healthStatus().color === 'amber'
					? 'bg-amber-500/10'
					: healthStatus().color === 'orange'
						? 'bg-orange-500/10'
						: 'bg-rose-500/10'
		}`}
	>
		<div class="relative flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
			<div
				class={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${
					healthStatus().color === 'emerald'
						? 'bg-emerald-500'
						: healthStatus().color === 'amber'
							? 'bg-amber-500'
							: healthStatus().color === 'orange'
								? 'bg-orange-500'
								: 'bg-rose-500'
				}`}
			>
				<i
					class="bx text-3xl text-white"
					class:bx-check-circle={healthStatus().status === 'healthy'}
					class:bx-info-circle={healthStatus().status === 'warning'}
					class:bx-error={healthStatus().status === 'degraded'}
					class:bx-x-circle={healthStatus().status === 'critical'}
				></i>
			</div>
			<div class="flex-1">
				<h2 class="text-xl font-bold text-[color:var(--color-text-primary)]">
					{healthStatus().label}
				</h2>
				<p class="mt-1 text-sm text-[color:var(--text-60,#6b7280)]">
					Last checked: {new Date(data.generatedAt).toLocaleString()}
				</p>
			</div>
			<button
				type="button"
				class="flex items-center gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-4 py-2.5 text-sm font-medium text-[color:var(--color-text-primary)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)6%,transparent)]"
				onclick={handleRefresh}
				disabled={refreshing}
			>
				<i class="bx bx-refresh" class:animate-spin={refreshing}></i>
				Refresh
			</button>
		</div>
	</div>

	<!-- Metrics Grid -->
	<div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
		{#each metrics as metric}
			<div
				class="relative overflow-hidden rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-4"
				style="background: color-mix(in srgb, var(--surface-panel) 95%, transparent);"
			>
				<div
					class="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-gradient-to-br {metric.color} opacity-10"
				></div>
				<div class="relative">
					<div
						class="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br {metric.color}"
					>
						<i class="bx {metric.icon} text-lg text-white"></i>
					</div>
					<p class="text-2xl font-bold text-[color:var(--color-text-primary)]">
						{metric.value.toLocaleString()}
					</p>
					<p class="mt-0.5 text-xs font-medium text-[color:var(--text-60,#6b7280)]">
						{metric.label}
					</p>
				</div>
			</div>
		{/each}
	</div>

	<div class="grid gap-4 lg:grid-cols-2">
		<!-- Client Status -->
		<AdminCard title="Client Status" description="Browser and connection information.">
			<div class="space-y-4">
				<div
					class="flex items-center justify-between rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
				>
					<div class="flex items-center gap-3">
						<div
							class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-green-500"
						>
							<i class="bx bx-wifi text-lg text-white"></i>
						</div>
						<div>
							<p class="font-medium text-[color:var(--color-text-primary)]">Connection</p>
							<p class="text-xs text-[color:var(--text-60,#6b7280)]">Network status</p>
						</div>
					</div>
					<span
						class={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${
							connectionStatus === 'online'
								? 'bg-emerald-500/20 text-emerald-600'
								: 'bg-rose-500/20 text-rose-600'
						}`}
					>
						{connectionStatus}
					</span>
				</div>

				{#if storageEstimate}
					<div
						class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
					>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-3">
								<div
									class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-500"
								>
									<i class="bx bx-data text-lg text-white"></i>
								</div>
								<div>
									<p class="font-medium text-[color:var(--color-text-primary)]">Storage</p>
									<p class="text-xs text-[color:var(--text-60,#6b7280)]">
										{formatBytes(storageEstimate.usage)} / {formatBytes(storageEstimate.quota)}
									</p>
								</div>
							</div>
							<span class="text-sm font-medium text-[color:var(--text-60,#6b7280)]">
								{((storageEstimate.usage / storageEstimate.quota) * 100).toFixed(1)}%
							</span>
						</div>
						<div
							class="mt-3 h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-text-primary)10%,transparent)]"
						>
							<div
								class="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all"
								style="width: {Math.min(
									(storageEstimate.usage / storageEstimate.quota) * 100,
									100
								)}%"
							></div>
						</div>
					</div>
				{/if}

				<button
					type="button"
					class="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-600 transition hover:bg-amber-500/20"
					onclick={clearLocalStorage}
				>
					<i class="bx bx-trash"></i>
					Clear Local Storage Cache
				</button>
			</div>
		</AdminCard>

		<!-- Recent Errors -->
		<AdminCard title="Recent Errors" description="Latest client-side errors captured.">
			<div class="space-y-2">
				{#if data.errorSamples.length === 0}
					<div class="flex flex-col items-center justify-center py-8 text-center">
						<div class="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20">
							<i class="bx bx-check text-2xl text-emerald-500"></i>
						</div>
						<p class="mt-3 font-medium text-[color:var(--color-text-primary)]">No Recent Errors</p>
						<p class="mt-1 text-sm text-[color:var(--text-60,#6b7280)]">
							System is running smoothly
						</p>
					</div>
				{:else}
					{#each data.errorSamples as error}
						<div class="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
							<p class="line-clamp-2 text-sm font-medium text-[color:var(--color-text-primary)]">
								{error.message}
							</p>
							<div
								class="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[color:var(--text-50,#94a3b8)]"
							>
								{#if error.source}
									<span
										class="rounded bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-1.5 py-0.5"
									>
										{error.source}
									</span>
								{/if}
								{#if error.path}
									<span>• {error.path}</span>
								{/if}
								<span>• {formatRelativeTime(error.createdAt)}</span>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</AdminCard>
	</div>

	<!-- System Info -->
	<AdminCard title="System Information" description="Technical details about the platform.">
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<div
				class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
			>
				<p class="text-xs font-medium uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]">
					Platform
				</p>
				<p class="mt-1 font-semibold text-[color:var(--color-text-primary)]">hConnect</p>
			</div>
			<div
				class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
			>
				<p class="text-xs font-medium uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]">
					Framework
				</p>
				<p class="mt-1 font-semibold text-[color:var(--color-text-primary)]">SvelteKit</p>
			</div>
			<div
				class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
			>
				<p class="text-xs font-medium uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]">
					Backend
				</p>
				<p class="mt-1 font-semibold text-[color:var(--color-text-primary)]">Firebase</p>
			</div>
			<div
				class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
			>
				<p class="text-xs font-medium uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]">
					Build
				</p>
				<p class="mt-1 font-semibold text-[color:var(--color-text-primary)]">Production</p>
			</div>
		</div>
	</AdminCard>
</div>
