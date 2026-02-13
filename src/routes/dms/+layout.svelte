<script lang="ts">
	import { page } from '$app/state'
	import { dms } from '$lib/data'

	let { children } = $props()
</script>

<!-- DM Sidebar -->
<div
	class="flex w-64 flex-shrink-0 flex-col border-r border-l border-(--border-subtle) bg-(--surface-channel-sidebar) text-(--channel-text)"
>
	<!-- Header -->
	<div
		class="flex items-center justify-between border-b border-(--border-subtle) p-4"
	>
		<h1 class="h-6 truncate text-lg font-bold text-(--text-primary)">Direct Messages</h1>
	</div>

	<!-- DM List -->
	<div class="hide-scrollbar flex-1 overflow-y-auto py-2">
		<ul class="space-y-1 px-2">
			{#each dms.channels as dm (dm.id)}
				{@const other = dms.getOtherParticipant(dm)}
				{#if other}
					<li>
						<a
							href="/dms/{dm.threadId}"
							class="flex items-center gap-3 rounded px-2 py-2 {dm.threadId === page.params.thread_id
								? 'bg-(--channel-active) text-(--channel-text-active)'
								: 'hover:bg-(--border-subtle)'}"
						>
							{#if other.photoURL}
								<img
									class="h-8 w-8 flex-shrink-0 rounded-full object-cover"
									src={other.photoURL}
									alt={other.displayName}
								/>
							{:else}
								<div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-(--rail-icon-bg)">
									<span class="text-xs font-semibold text-(--rail-text)">{other.displayName.slice(0, 2).toUpperCase()}</span>
								</div>
							{/if}
							<span class="truncate text-sm font-medium">{other.displayName}</span>
							{#if dm.unreadCount > 0}
								<span class="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
									{dm.unreadCount > 99 ? '99+' : dm.unreadCount}
								</span>
							{/if}
						</a>
					</li>
				{/if}
			{/each}
		</ul>
	</div>
</div>

{@render children()}

<style>
	.hide-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	.hide-scrollbar::-webkit-scrollbar {
		display: none;
	}
</style>
