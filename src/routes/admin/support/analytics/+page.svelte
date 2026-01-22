<script lang="ts">
	import type { PageData } from './$types';
	import AdminCard from '$lib/admin/components/AdminCard.svelte';
	import { goto } from '$app/navigation';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

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

	function formatMonth(monthKey: string): string {
		const [year, month] = monthKey.split('-');
		const date = new Date(parseInt(year), parseInt(month) - 1);
		return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
	}

	function formatWeek(weekKey: string): string {
		const date = new Date(weekKey);
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	// Calculate max values for chart scaling
	const maxDailyTickets = $derived(
		Math.max(...data.analytics.ticketsByDay.map((d) => d.count), 1)
	);
	const maxMonthlyTickets = $derived(
		Math.max(...data.analytics.ticketsByMonth.map((d) => d.count), 1)
	);
	const totalTickets = $derived(
		data.analytics.statusDistribution.opened +
			data.analytics.statusDistribution.in_progress +
			data.analytics.statusDistribution.closed
	);
	const totalTypes = $derived(
		data.analytics.typeDistribution.bug +
			data.analytics.typeDistribution.feature_request +
			data.analytics.typeDistribution.question +
			data.analytics.typeDistribution.other +
			data.analytics.typeDistribution.unknown
	);
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
			<h1 class="text-2xl font-bold text-[color:var(--color-text-primary)]">Support Analytics</h1>
			<p class="text-sm text-[color:var(--text-60)]">
				AI usage statistics and ticket metrics
			</p>
		</div>
	</div>

	<!-- Key Metrics -->
	<div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
		<div
			class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
			style="background: color-mix(in srgb, var(--surface-panel) 90%, transparent);"
		>
			<div class="flex items-center gap-3">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600"
				>
					<i class="bx bx-bot text-xl text-white"></i>
				</div>
				<div>
					<p class="text-2xl font-bold text-[color:var(--color-text-primary)]">
						{data.analytics.estimatedAiClassifications.toLocaleString()}
					</p>
					<p class="text-xs text-[color:var(--text-60)]">AI Classifications</p>
				</div>
			</div>
		</div>
		<div
			class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
			style="background: color-mix(in srgb, var(--surface-panel) 90%, transparent);"
		>
			<div class="flex items-center gap-3">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-cyan-500"
				>
					<i class="bx bx-user-check text-xl text-white"></i>
				</div>
				<div>
					<p class="text-2xl font-bold text-[color:var(--color-text-primary)]">
						{data.analytics.activeStaffCount}
					</p>
					<p class="text-xs text-[color:var(--text-60)]">Active Staff</p>
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
					<i class="bx bx-stopwatch text-xl text-white"></i>
				</div>
				<div>
					<p class="text-2xl font-bold text-[color:var(--color-text-primary)]">
						{formatDuration(data.analytics.avgResponseTimeMs)}
					</p>
					<p class="text-xs text-[color:var(--text-60)]">Avg Response Time</p>
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
					<i class="bx bx-check-double text-xl text-white"></i>
				</div>
				<div>
					<p class="text-2xl font-bold text-[color:var(--color-text-primary)]">
						{formatDuration(data.analytics.avgResolutionTimeMs)}
					</p>
					<p class="text-xs text-[color:var(--text-60)]">Avg Resolution Time</p>
				</div>
			</div>
		</div>
	</div>

	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Status Distribution -->
		<AdminCard title="Status Distribution" description="Current ticket status breakdown">
			<div class="space-y-4">
				{#each [
					{ key: 'opened', label: 'Open', count: data.analytics.statusDistribution.opened, color: 'bg-amber-500' },
					{ key: 'in_progress', label: 'In Progress', count: data.analytics.statusDistribution.in_progress, color: 'bg-cyan-500' },
					{ key: 'closed', label: 'Closed', count: data.analytics.statusDistribution.closed, color: 'bg-emerald-500' }
				] as item}
					<div class="space-y-1">
						<div class="flex items-center justify-between text-sm">
							<span class="text-[color:var(--color-text-primary)]">{item.label}</span>
							<span class="text-[color:var(--text-60)]">
								{item.count} ({totalTickets > 0 ? Math.round((item.count / totalTickets) * 100) : 0}%)
							</span>
						</div>
						<div
							class="h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-text-primary)10%,transparent)]"
						>
							<div
								class="h-full transition-all duration-500 {item.color}"
								style="width: {totalTickets > 0 ? (item.count / totalTickets) * 100 : 0}%"
							></div>
						</div>
					</div>
				{/each}
			</div>
		</AdminCard>

		<!-- Type Distribution -->
		<AdminCard title="Ticket Types" description="Distribution by ticket category">
			<div class="space-y-4">
				{#each [
					{ key: 'bug', label: 'Bug', count: data.analytics.typeDistribution.bug, color: 'bg-rose-500', icon: 'bx-bug' },
					{ key: 'feature_request', label: 'Feature Request', count: data.analytics.typeDistribution.feature_request, color: 'bg-violet-500', icon: 'bx-bulb' },
					{ key: 'question', label: 'Question', count: data.analytics.typeDistribution.question, color: 'bg-blue-500', icon: 'bx-help-circle' },
					{ key: 'other', label: 'Other', count: data.analytics.typeDistribution.other, color: 'bg-gray-500', icon: 'bx-message-detail' },
					{ key: 'unknown', label: 'Unclassified', count: data.analytics.typeDistribution.unknown, color: 'bg-gray-400', icon: 'bx-question-mark' }
				] as item}
					{#if item.count > 0}
						<div class="space-y-1">
							<div class="flex items-center justify-between text-sm">
								<span class="flex items-center gap-2 text-[color:var(--color-text-primary)]">
									<i class="bx {item.icon}"></i>
									{item.label}
								</span>
								<span class="text-[color:var(--text-60)]">
									{item.count} ({totalTypes > 0 ? Math.round((item.count / totalTypes) * 100) : 0}%)
								</span>
							</div>
							<div
								class="h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-text-primary)10%,transparent)]"
							>
								<div
									class="h-full transition-all duration-500 {item.color}"
									style="width: {totalTypes > 0 ? (item.count / totalTypes) * 100 : 0}%"
								></div>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</AdminCard>
	</div>

	<!-- Tickets Over Time Chart -->
	<AdminCard title="Tickets Over Time" description="Last 30 days of ticket volume">
		{#if data.analytics.ticketsByDay.length > 0}
			<div class="h-48">
				<div class="flex h-full items-end gap-1">
					{#each data.analytics.ticketsByDay as day}
						<div
							class="group relative flex-1 rounded-t bg-gradient-to-t from-teal-500 to-cyan-500 transition-all hover:opacity-80"
							style="height: {(day.count / maxDailyTickets) * 100}%; min-height: 4px;"
							title="{day.date}: {day.count} tickets"
						>
							<div
								class="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition group-hover:opacity-100"
							>
								{day.count}
							</div>
						</div>
					{/each}
				</div>
				<div class="mt-2 flex justify-between text-xs text-[color:var(--text-50)]">
					<span>{data.analytics.ticketsByDay[0]?.date ?? ''}</span>
					<span>{data.analytics.ticketsByDay[data.analytics.ticketsByDay.length - 1]?.date ?? ''}</span>
				</div>
			</div>
		{:else}
			<div class="flex h-48 items-center justify-center text-[color:var(--text-50)]">
				No data available
			</div>
		{/if}
	</AdminCard>

	<!-- Monthly Trend -->
	<AdminCard title="Monthly Trend" description="Ticket volume by month">
		{#if data.analytics.ticketsByMonth.length > 0}
			<div class="h-48">
				<div class="flex h-full items-end gap-2">
					{#each data.analytics.ticketsByMonth as month}
						<div class="flex flex-1 flex-col items-center gap-1">
							<div
								class="w-full rounded-t bg-gradient-to-t from-violet-500 to-purple-500 transition-all hover:opacity-80"
								style="height: {(month.count / maxMonthlyTickets) * 100}%; min-height: 4px;"
								title="{month.month}: {month.count} tickets"
							></div>
							<span class="text-[10px] text-[color:var(--text-50)]">
								{formatMonth(month.month)}
							</span>
						</div>
					{/each}
				</div>
			</div>
		{:else}
			<div class="flex h-48 items-center justify-center text-[color:var(--text-50)]">
				No data available
			</div>
		{/if}
	</AdminCard>

	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Top Servers by Total Tickets -->
		<AdminCard title="Top Servers (Total)" description="Servers with most tickets">
			<div class="space-y-3">
				{#each data.analytics.topServersByTickets as server, i}
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-3">
							<span
								class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
								class:bg-amber-500={i === 0}
								class:bg-gray-400={i === 1}
								class:bg-orange-600={i === 2}
								class:bg-gray-600={i > 2}
								class:text-white={true}
							>
								{i + 1}
							</span>
							<span class="text-sm text-[color:var(--color-text-primary)]">
								{server.serverName}
							</span>
						</div>
						<span class="font-medium text-[color:var(--color-text-primary)]">
							{server.count}
						</span>
					</div>
				{:else}
					<p class="text-center text-sm text-[color:var(--text-50)]">No servers yet</p>
				{/each}
			</div>
		</AdminCard>

		<!-- Top Servers by Open Tickets -->
		<AdminCard title="Top Servers (Open)" description="Servers with most open tickets">
			<div class="space-y-3">
				{#each data.analytics.topServersByOpenTickets as server, i}
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-3">
							<span
								class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
								class:bg-rose-500={i === 0}
								class:bg-gray-400={i === 1}
								class:bg-orange-600={i === 2}
								class:bg-gray-600={i > 2}
								class:text-white={true}
							>
								{i + 1}
							</span>
							<span class="text-sm text-[color:var(--color-text-primary)]">
								{server.serverName}
							</span>
						</div>
						<span class="font-medium text-amber-400">
							{server.count} open
						</span>
					</div>
				{:else}
					<p class="text-center text-sm text-[color:var(--text-50)]">No open tickets</p>
				{/each}
			</div>
		</AdminCard>
	</div>

	<!-- Additional Metrics -->
	<AdminCard title="Additional Metrics" description="Other useful statistics">
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<div
				class="rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4 text-center"
			>
				<p class="text-2xl font-bold text-[color:var(--color-text-primary)]">
					{formatDuration(data.analytics.medianResponseTimeMs)}
				</p>
				<p class="text-xs text-[color:var(--text-60)]">Median Response Time</p>
			</div>
			<div
				class="rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4 text-center"
			>
				<p class="text-2xl font-bold text-[color:var(--color-text-primary)]">
					{formatDuration(data.analytics.medianResolutionTimeMs)}
				</p>
				<p class="text-xs text-[color:var(--text-60)]">Median Resolution Time</p>
			</div>
			<div
				class="rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4 text-center"
			>
				<p class="text-2xl font-bold text-[color:var(--color-text-primary)]">
					{data.analytics.ticketsWithMultipleStaff}
				</p>
				<p class="text-xs text-[color:var(--text-60)]">Multi-Staff Tickets</p>
			</div>
			<div
				class="rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4 text-center"
			>
				<p class="text-2xl font-bold text-[color:var(--color-text-primary)]">
					{data.analytics.reopenedTickets}
				</p>
				<p class="text-xs text-[color:var(--text-60)]">Reopened Tickets</p>
			</div>
		</div>
	</AdminCard>
</div>
