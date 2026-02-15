<script lang="ts">
	import { page } from '$app/state'
	import { dms, DMMessagesState, mobile } from '$lib/data'
	import { ChatInput, MessageFeed } from '$lib/components'
	import { goto } from '$app/navigation'

	const threadId = $derived(page.params.thread_id!)
	const isMobile = $derived(mobile.isMobile)

	// Look up entry from the full DM list (not just unread)
	const dmEntry = $derived((dms.all ?? []).find((dm) => dm.threadId === threadId))
	const other = $derived(dmEntry ? dms.getOtherParticipant(dmEntry) : undefined)

	// Subscribe to actual DM messages
	const dmMessages = $derived(new DMMessagesState(threadId))

	// Mark as read when viewing
	$effect(() => {
		if (threadId) {
			dms.markRead(threadId)
		}
	})
</script>

<!-- DM Thread Content -->
<div
	class="flex flex-1 flex-col bg-(--surface-base)"
>
	<!-- Chat Header -->
	<header
		class="flex flex-shrink-0 items-center border-b border-(--border-default) px-4"
		style="height: {isMobile ? 'calc(var(--mobile-header-height) + var(--sat, 0px))' : '3.5rem'}; padding-top: {isMobile ? 'var(--sat, 0px)' : '0'};"
	>
		{#if isMobile}
			<button
				class="mr-2 flex h-10 w-10 items-center justify-center rounded-lg text-(--text-muted) transition-colors hover:bg-(--surface-hover)"
				onclick={() => goto('/dms')}
				aria-label="Back to DMs"
			>
				<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
				</svg>
			</button>
		{/if}
		<div class="flex items-center gap-3">
			{#if other?.photoURL}
				<img
					class="h-8 w-8 rounded-full object-cover"
					src={other.photoURL}
					alt={other.displayName}
					onerror={(e: Event) => {
						const img = e.currentTarget as HTMLImageElement
						img.style.display = 'none'
						const fb = img.nextElementSibling as HTMLElement
						if (fb) fb.style.display = 'flex'
					}}
				/>
				<div
					class="hidden h-8 w-8 items-center justify-center rounded-full bg-(--rail-icon-bg)"
				>
					<span class="text-xs font-semibold text-(--rail-text)"
						>{other.displayName.slice(0, 2).toUpperCase()}</span
					>
				</div>
			{:else if other}
				<div
					class="flex h-8 w-8 items-center justify-center rounded-full bg-(--rail-icon-bg)"
				>
					<span class="text-xs font-semibold text-(--rail-text)"
						>{other.displayName.slice(0, 2).toUpperCase()}</span
					>
				</div>
			{/if}
			<span class="text-base font-semibold text-(--text-primary)"
				>{other?.displayName ?? 'Direct Message'}</span
			>
		</div>
	</header>

	<!-- Messages Area -->
	<MessageFeed messages={dmMessages.current}>
		{#snippet hero()}
			<div class="flex flex-col items-center justify-center py-12 text-(--text-muted)">
				{#if other}
					{#if other.photoURL}
						<img
							class="mb-4 h-20 w-20 rounded-full object-cover"
							src={other.photoURL}
							alt={other.displayName}
							onerror={(e: Event) => {
								const img = e.currentTarget as HTMLImageElement
								img.style.display = 'none'
								const fb = img.nextElementSibling as HTMLElement
								if (fb) fb.style.display = 'flex'
							}}
						/>
						<div
							class="mb-4 hidden h-20 w-20 items-center justify-center rounded-full bg-(--rail-icon-bg)"
						>
							<span class="text-2xl font-semibold text-(--rail-text)"
								>{other.displayName.slice(0, 2).toUpperCase()}</span
							>
						</div>
					{:else}
						<div
							class="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-(--rail-icon-bg)"
						>
							<span class="text-2xl font-semibold text-(--rail-text)"
								>{other.displayName.slice(0, 2).toUpperCase()}</span
							>
						</div>
					{/if}
					<h2 class="text-xl font-bold text-(--text-primary)">{other.displayName}</h2>
					<p class="mt-1 text-sm">
						This is the beginning of your direct message history with <strong
							class="text-(--text-primary)">{other.displayName}</strong
						>.
					</p>
				{/if}
			</div>
		{/snippet}
	</MessageFeed>

	<!-- Message Input -->
	<footer class="px-4 pb-3"
		style={isMobile ? `padding-bottom: calc(0.75rem + var(--sab, 0px) + var(--chat-keyboard-offset, 0px));` : ''}>
		<ChatInput
			placeholder="Message {other?.displayName ?? ''}"
			onsend={(text) => dms.sendMessage(threadId, text)}
		/>
	</footer>
</div>
