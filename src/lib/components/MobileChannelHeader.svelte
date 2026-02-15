<!--
	MobileChannelHeader — top header bar on mobile.
	Shows: back/chevron (opens channel list overlay), channel name, members toggle.
	Extends background behind safe-area to cover notch/dynamic island.
-->
<script lang="ts">
	interface Props {
		channelName?: string
		showBackButton?: boolean
		onback?: () => void
		onToggleMembers?: () => void
		membersOpen?: boolean
	}

	let {
		channelName = '',
		showBackButton = true,
		onback,
		onToggleMembers,
		membersOpen = false,
	}: Props = $props()
</script>

<header
	class="flex flex-shrink-0 items-center justify-between border-b border-(--border-default) bg-(--surface-base) px-3"
	style="height: calc(var(--mobile-header-height) + var(--sat, 0px)); padding-top: var(--sat, 0px);"
>
	<!-- Left: Back button -->
	<div class="flex items-center gap-2">
		{#if showBackButton}
			<button
				class="flex h-10 w-10 items-center justify-center rounded-lg text-(--text-muted) transition-colors hover:bg-(--surface-hover) hover:text-(--text-primary)"
				onclick={onback}
				aria-label="Back"
			>
				<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
				</svg>
			</button>
		{/if}
	</div>

	<!-- Center: Channel name -->
	<div class="flex min-w-0 flex-1 items-center justify-center gap-1.5">
		{#if channelName}
			<span class="text-sm font-semibold text-(--text-primary) truncate"># {channelName}</span>
		{/if}
	</div>

	<!-- Right: Members toggle -->
	<div class="flex items-center">
		{#if onToggleMembers}
			<button
				class="flex h-10 w-10 items-center justify-center rounded-lg transition-colors {membersOpen
					? 'bg-(--accent)/20 text-(--accent)'
					: 'text-(--text-muted) hover:bg-(--surface-hover) hover:text-(--text-primary)'}"
				onclick={onToggleMembers}
				aria-label={membersOpen ? 'Hide members' : 'Show members'}
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<path d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
				</svg>
			</button>
		{/if}
	</div>
</header>
