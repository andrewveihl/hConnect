<script lang="ts">
	import AdminShell from '$lib/admin/components/AdminShell.svelte';
	import AdminCard from '$lib/admin/components/AdminCard.svelte';
	import type { PageData } from './$types';
	import { doc, updateDoc } from 'firebase/firestore';
	import { getDb } from '$lib/firebase';

	let { data }: { data: PageData } = $props();

	let updating = $state(false);
	let statusMessage = $state<string | null>(null);

	const statusColors: Record<string, string> = {
		opened: 'bg-amber-500',
		in_progress: 'bg-blue-500',
		closed: 'bg-emerald-500'
	};

	const statusLabels: Record<string, string> = {
		opened: 'Open',
		in_progress: 'In Progress',
		closed: 'Closed'
	};

	const typeColors: Record<string, string> = {
		bug: 'bg-red-500',
		feature_request: 'bg-purple-500',
		question: 'bg-blue-500',
		other: 'bg-gray-500'
	};

	const typeLabels: Record<string, string> = {
		bug: 'Bug',
		feature_request: 'Feature Request',
		question: 'Question',
		other: 'Other'
	};

	function formatDate(date: Date | null): string {
		if (!date) return 'N/A';
		return date.toLocaleString();
	}

	function formatDuration(ms: number | null): string {
		if (ms === null) return 'N/A';
		const hours = Math.floor(ms / (1000 * 60 * 60));
		const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
		if (hours > 24) {
			const days = Math.floor(hours / 24);
			return `${days}d ${hours % 24}h`;
		}
		return `${hours}h ${minutes}m`;
	}

	async function updateStatus(newStatus: 'opened' | 'in_progress' | 'closed') {
		if (updating || newStatus === data.ticket.status) return;
		updating = true;
		statusMessage = null;

		try {
			const db = getDb();
			const ticketRef = doc(db, 'servers', data.ticket.serverId, 'ticketAiIssues', data.ticket.id);

			const updateData: Record<string, any> = {
				status: newStatus,
				lastMessageAt: new Date()
			};

			if (newStatus === 'closed' && !data.ticket.closedAt) {
				updateData.closedAt = new Date();
			}

			await updateDoc(ticketRef, updateData);
			data.ticket.status = newStatus;
			statusMessage = `Status updated to ${statusLabels[newStatus]}`;
		} catch (e) {
			console.error('Failed to update status:', e);
			statusMessage = 'Failed to update status';
		} finally {
			updating = false;
		}
	}
</script>

<AdminShell title="Ticket Details" description="View and manage support ticket">
	<div class="space-y-6">
		<!-- Breadcrumb -->
		<nav class="flex items-center gap-2 text-sm text-zinc-400">
			<a href="/admin/support" class="hover:text-white transition-colors">Support</a>
			<i class="bx bx-chevron-right"></i>
			<a href="/admin/support/tickets" class="hover:text-white transition-colors">Tickets</a>
			<i class="bx bx-chevron-right"></i>
			<span class="text-white">{data.ticket.id.slice(0, 8)}...</span>
		</nav>

		<!-- Header Card -->
		<AdminCard>
			<div class="flex items-start justify-between gap-4">
				<div class="flex items-start gap-4">
					{#if data.ticket.serverIcon}
						<img
							src={data.ticket.serverIcon}
							alt={data.ticket.serverName}
							class="w-12 h-12 rounded-lg"
						/>
					{:else}
						<div class="w-12 h-12 rounded-lg bg-zinc-700 flex items-center justify-center">
							<i class="bx bx-server text-xl text-zinc-400"></i>
						</div>
					{/if}
					<div>
						<h2 class="text-xl font-semibold text-white">
							{data.ticket.summary ?? 'No summary'}
						</h2>
						<p class="text-sm text-zinc-400 mt-1">
							{data.ticket.serverName} • Created {formatDate(data.ticket.createdAt)}
						</p>
						<div class="flex items-center gap-2 mt-2">
							<span
								class="px-2 py-0.5 rounded text-xs font-medium text-white {statusColors[data.ticket.status]}"
							>
								{statusLabels[data.ticket.status]}
							</span>
							{#if data.ticket.typeTag}
								<span
									class="px-2 py-0.5 rounded text-xs font-medium text-white {typeColors[data.ticket.typeTag] ?? 'bg-gray-500'}"
								>
									{typeLabels[data.ticket.typeTag] ?? data.ticket.typeTag}
								</span>
							{/if}
							{#if data.ticket.reopenedAfterClose}
								<span class="px-2 py-0.5 rounded text-xs font-medium bg-orange-500 text-white">
									Reopened
								</span>
							{/if}
						</div>
					</div>
				</div>

				<!-- Status Actions -->
				<div class="flex items-center gap-2">
					{#if statusMessage}
						<span class="text-sm text-emerald-400">{statusMessage}</span>
					{/if}
					<div class="flex items-center gap-1 bg-zinc-800 rounded-lg p-1">
						<button
							onclick={() => updateStatus('opened')}
							disabled={updating}
							class="px-3 py-1.5 rounded text-sm font-medium transition-colors {data.ticket.status === 'opened' ? 'bg-amber-500 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-700'}"
						>
							Open
						</button>
						<button
							onclick={() => updateStatus('in_progress')}
							disabled={updating}
							class="px-3 py-1.5 rounded text-sm font-medium transition-colors {data.ticket.status === 'in_progress' ? 'bg-blue-500 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-700'}"
						>
							In Progress
						</button>
						<button
							onclick={() => updateStatus('closed')}
							disabled={updating}
							class="px-3 py-1.5 rounded text-sm font-medium transition-colors {data.ticket.status === 'closed' ? 'bg-emerald-500 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-700'}"
						>
							Closed
						</button>
					</div>
				</div>
			</div>
		</AdminCard>

		<!-- Stats Grid -->
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
			<AdminCard>
				<div class="text-center">
					<div class="text-2xl font-bold text-white">{data.ticket.messageCount}</div>
					<div class="text-sm text-zinc-400">Total Messages</div>
				</div>
			</AdminCard>
			<AdminCard>
				<div class="text-center">
					<div class="text-2xl font-bold text-white">{data.ticket.staffMessageCount}</div>
					<div class="text-sm text-zinc-400">Staff Messages</div>
				</div>
			</AdminCard>
			<AdminCard>
				<div class="text-center">
					<div class="text-2xl font-bold text-white">{formatDuration(data.ticket.timeToFirstResponseMs)}</div>
					<div class="text-sm text-zinc-400">First Response</div>
				</div>
			</AdminCard>
			<AdminCard>
				<div class="text-center">
					<div class="text-2xl font-bold text-white">{formatDuration(data.ticket.timeToResolutionMs)}</div>
					<div class="text-sm text-zinc-400">Resolution Time</div>
				</div>
			</AdminCard>
		</div>

		<!-- Details & Timeline Row -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
			<!-- Ticket Details -->
			<AdminCard title="Ticket Details">
				<div class="space-y-4">
					<div class="grid grid-cols-2 gap-4">
						<div>
							<div class="text-xs text-zinc-500 uppercase tracking-wider">Ticket ID</div>
							<div class="text-sm text-white font-mono mt-1">{data.ticket.id}</div>
						</div>
						<div>
							<div class="text-xs text-zinc-500 uppercase tracking-wider">Server ID</div>
							<div class="text-sm text-white font-mono mt-1">{data.ticket.serverId}</div>
						</div>
						<div>
							<div class="text-xs text-zinc-500 uppercase tracking-wider">Channel ID</div>
							<div class="text-sm text-white font-mono mt-1">{data.ticket.channelId || 'N/A'}</div>
						</div>
						<div>
							<div class="text-xs text-zinc-500 uppercase tracking-wider">Thread ID</div>
							<div class="text-sm text-white font-mono mt-1">{data.ticket.threadId || 'N/A'}</div>
						</div>
						<div>
							<div class="text-xs text-zinc-500 uppercase tracking-wider">Author</div>
							<div class="text-sm text-white mt-1">{data.ticket.authorName ?? 'Unknown'}</div>
						</div>
						<div>
							<div class="text-xs text-zinc-500 uppercase tracking-wider">Staff Assigned</div>
							<div class="text-sm text-white mt-1">
								{data.ticket.staffMemberIds.length > 0 ? data.ticket.staffMemberIds.length : 'None'}
							</div>
						</div>
					</div>

					<div class="border-t border-zinc-700 pt-4">
						<div class="text-xs text-zinc-500 uppercase tracking-wider mb-2">Timestamps</div>
						<div class="space-y-2 text-sm">
							<div class="flex justify-between">
								<span class="text-zinc-400">Created</span>
								<span class="text-white">{formatDate(data.ticket.createdAt)}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-zinc-400">Last Activity</span>
								<span class="text-white">{formatDate(data.ticket.lastMessageAt)}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-zinc-400">First Staff Response</span>
								<span class="text-white">{formatDate(data.ticket.firstStaffResponseAt)}</span>
							</div>
							{#if data.ticket.closedAt}
								<div class="flex justify-between">
									<span class="text-zinc-400">Closed</span>
									<span class="text-white">{formatDate(data.ticket.closedAt)}</span>
								</div>
							{/if}
						</div>
					</div>
				</div>
			</AdminCard>

			<!-- Status Timeline -->
			<AdminCard title="Status Timeline">
				{#if data.ticket.statusTimeline.length > 0}
					<div class="space-y-4">
						{#each data.ticket.statusTimeline as entry, i}
							<div class="flex items-start gap-3">
								<div class="flex flex-col items-center">
									<div class="w-3 h-3 rounded-full {statusColors[entry.status]}"></div>
									{#if i < data.ticket.statusTimeline.length - 1}
										<div class="w-0.5 h-8 bg-zinc-700 mt-1"></div>
									{/if}
								</div>
								<div>
									<div class="text-sm text-white font-medium">
										{statusLabels[entry.status]}
									</div>
									<div class="text-xs text-zinc-400">
										{formatDate(entry.at)}
									</div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="text-center py-8 text-zinc-500">
						<i class="bx bx-time-five text-3xl mb-2"></i>
						<p>No timeline data available</p>
					</div>
				{/if}
			</AdminCard>
		</div>

		<!-- Messages -->
		<AdminCard title="Conversation">
			{#if data.messages.length > 0}
				<div class="space-y-4 max-h-[600px] overflow-y-auto">
					{#each data.messages as message}
						<div class="flex gap-3 {message.isStaff ? 'flex-row-reverse' : ''}">
							{#if message.authorAvatar}
								<img
									src={message.authorAvatar}
									alt={message.authorName ?? 'User'}
									class="w-8 h-8 rounded-full flex-shrink-0"
								/>
							{:else}
								<div class="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center {message.isStaff ? 'bg-blue-500/20' : 'bg-zinc-700'}">
									<i class="bx {message.isStaff ? 'bx-support' : 'bx-user'} text-sm {message.isStaff ? 'text-blue-400' : 'text-zinc-400'}"></i>
								</div>
							{/if}
							<div class="flex-1 {message.isStaff ? 'text-right' : ''}">
								<div class="flex items-center gap-2 {message.isStaff ? 'justify-end' : ''}">
									<span class="text-sm font-medium {message.isStaff ? 'text-blue-400' : 'text-white'}">
										{message.authorName ?? 'Unknown'}
									</span>
									{#if message.isStaff}
										<span class="px-1.5 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">Staff</span>
									{/if}
									<span class="text-xs text-zinc-500">
										{formatDate(message.createdAt)}
									</span>
								</div>
								<div class="mt-1 p-3 rounded-lg {message.isStaff ? 'bg-blue-500/10 text-blue-100' : 'bg-zinc-800 text-zinc-300'} {message.isStaff ? 'rounded-tr-none' : 'rounded-tl-none'}">
									<p class="text-sm whitespace-pre-wrap">{message.content}</p>
									{#if message.attachments.length > 0}
										<div class="mt-2 flex flex-wrap gap-2">
											{#each message.attachments as attachment}
												<a
													href={attachment.url}
													target="_blank"
													rel="noopener noreferrer"
													class="text-xs text-blue-400 hover:underline flex items-center gap-1"
												>
													<i class="bx bx-paperclip"></i>
													{attachment.name}
												</a>
											{/each}
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="text-center py-12 text-zinc-500">
					<i class="bx bx-message-detail text-4xl mb-3"></i>
					<p>No messages stored for this ticket</p>
					<p class="text-sm mt-1">Messages may not be persisted for this ticket type</p>
				</div>
			{/if}
		</AdminCard>

		<!-- Actions -->
		<AdminCard>
			<div class="flex items-center justify-between">
				<div class="text-sm text-zinc-400">
					Manage this support ticket
				</div>
				<div class="flex items-center gap-2">
					<a
						href="/admin/support/tickets"
						class="px-4 py-2 rounded-lg bg-zinc-700 text-white hover:bg-zinc-600 transition-colors"
					>
						Back to Tickets
					</a>
					<button
						onclick={() => {
							if (confirm('Are you sure you want to delete this ticket? This cannot be undone.')) {
								// Delete logic would go here
								alert('Delete functionality to be implemented');
							}
						}}
						class="px-4 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
					>
						<i class="bx bx-trash mr-1"></i>
						Delete Ticket
					</button>
				</div>
			</div>
		</AdminCard>
	</div>
</AdminShell>
