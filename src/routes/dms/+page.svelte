<script lang="ts">
</script>

<!-- DM landing: header bar + placeholder -->
<div class="flex flex-1 flex-col bg-(--surface-base)">
	<!-- Header bar matching the screenshot -->
	<header class="flex h-14 flex-shrink-0 items-center justify-between border-b border-(--border-default) px-6">
		<div class="flex items-center gap-2">
			<svg class="h-5 w-5 text-(--text-muted)" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
			</svg>
			<span class="text-base font-semibold text-(--text-primary)">Direct Messages</span>
		</div>
		<span class="text-xs text-(--text-muted)">Pick a friend to start chatting.</span>
	</header>

	<!-- Centered placeholder -->
	<div class="flex flex-1 flex-col items-center justify-center text-(--text-muted)">
		<svg class="mb-4 h-20 w-20 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
		</svg>
		<h2 class="text-lg font-semibold text-(--text-primary)">Select a conversation</h2>
		<p class="mt-1 max-w-xs text-center text-sm">
			Choose someone from your message list to begin chatting.
			Swipe right or tap the menu to open conversations on mobile.
		</p>
	</div>
</div>
