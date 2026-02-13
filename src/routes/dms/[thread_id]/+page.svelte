<script lang="ts">
	import { page } from '$app/state'
	import { dms } from '$lib/data'

	const threadId = $derived(page.params.thread_id!)
	const dmEntry = $derived(dms.channels.find((dm) => dm.threadId === threadId))
	const other = $derived(dmEntry ? dms.getOtherParticipant(dmEntry) : undefined)

	// Mark as read when viewing
	$effect(() => {
		if (threadId) {
			dms.markRead(threadId)
		}
	})
</script>

<!-- DM Thread Content -->
<div class="flex flex-1 flex-col bg-(--surface-base)">
	<!-- Chat Header -->
	<header class="flex h-14 flex-shrink-0 items-center border-b border-(--border-default) px-6">
		<div class="flex items-center gap-3">
			{#if other?.photoURL}
				<img class="h-8 w-8 rounded-full object-cover" src={other.photoURL} alt={other.displayName} />
			{:else if other}
				<div class="flex h-8 w-8 items-center justify-center rounded-full bg-(--rail-icon-bg)">
					<span class="text-xs font-semibold text-(--rail-text)">{other.displayName.slice(0, 2).toUpperCase()}</span>
				</div>
			{/if}
			<span class="text-lg font-bold text-(--text-primary)">{other?.displayName ?? 'Direct Message'}</span>
		</div>
	</header>

	<!-- Messages Area (placeholder — wire up with DM messages data class) -->
	<main class="flex-1 overflow-y-auto p-6">
		<div class="flex flex-col items-center justify-center py-12 text-(--text-muted)">
			{#if other}
				{#if other.photoURL}
					<img class="mb-4 h-20 w-20 rounded-full object-cover" src={other.photoURL} alt={other.displayName} />
				{:else}
					<div class="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-(--rail-icon-bg)">
						<span class="text-2xl font-semibold text-(--rail-text)">{other.displayName.slice(0, 2).toUpperCase()}</span>
					</div>
				{/if}
				<h2 class="text-xl font-bold text-(--text-primary)">{other.displayName}</h2>
				<p class="mt-1 text-sm">This is the beginning of your direct message history with <strong class="text-(--text-primary)">{other.displayName}</strong>.</p>
			{/if}
		</div>
	</main>

	<!-- Message Input (placeholder) -->
	<footer class="p-6 pt-0">
		<div class="overflow-hidden rounded-lg border-2 border-(--border-input) transition-colors focus-within:border-(--border-input-focus)">
			<textarea
				placeholder="Message {other?.displayName ?? ''}"
				class="min-h-[80px] w-full resize-none bg-(--surface-input) p-3 text-(--text-primary) placeholder:text-(--text-muted) focus:outline-none"
			></textarea>
		</div>
	</footer>
</div>
