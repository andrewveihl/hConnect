<script lang="ts">
	import { ChatInput, MembersPane } from '$lib/components'
	import { ChannelsState, MessagesState, MembersState, RolesState } from '$lib/data'
	import { page } from '$app/state'

	const messages = $derived(new MessagesState(page.params.server_id!, page.params.channel_id!))
	const channels = $derived(new ChannelsState(page.params.server_id!))
	const channel = $derived(channels.current?.find((channel) => channel.id === page.params.channel_id))

	const members = $derived(new MembersState(page.params.server_id!))
	const roles = $derived(new RolesState(page.params.server_id!))

	let showMembers = $state(true)

	function fade(img: HTMLImageElement) {
		const completed = () => (img.style.opacity = '1')
		img.onload = completed
	}
</script>

<!-- Flex row: chat area + optional members pane -->
<div class="flex flex-1 min-h-0">
	<!-- Chat Column -->
	<div class="flex flex-1 flex-col bg-(--surface-base) min-w-0">
		<!-- Chat Header -->
		<header class="flex h-14 flex-shrink-0 items-center justify-between border-b border-(--border-default) px-6">
			<div class="flex items-center space-x-2">
				<span class="text-lg font-bold text-(--text-primary)"># {channel?.name}</span>
				<span class="text-(--text-muted)">
				</span>
			</div>
			<div class="flex items-center space-x-4 text-(--text-muted)">
				<button
					class="flex h-8 w-8 items-center justify-center rounded-lg transition-colors {showMembers ? 'bg-(--accent)/20 text-(--accent)' : 'hover:bg-(--surface-hover) hover:text-(--text-primary)'}"
					onclick={() => (showMembers = !showMembers)}
					aria-label={showMembers ? 'Hide members' : 'Show members'}
					title={showMembers ? 'Hide members' : 'Show members'}
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
					</svg>
				</button>
			</div>
		</header>

		<!-- Messages Area -->
		<main class="flex-1 space-y-6 overflow-y-auto p-6">
			{#each messages.current as message (message.id)}
				<div class="group flex items-start">
					<img
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md font-bold opacity-0 transition-opacity duration-300 ease-in"
						src={message.author.photoURL}
						alt=""
						use:fade
					/>
					<div class="ml-3">
						<div class="flex items-baseline space-x-2">
							<span class="cursor-pointer font-bold text-(--text-primary) hover:underline"
								>{message.author.displayName}</span
							>
							<span class="text-xs text-(--text-timestamp)">{message.createdAt.toDate().toISOString()}</span>
						</div>
						<p class="text-(--text-secondary)">
							{message.text}
						</p>
					</div>
				</div>
			{/each}
		</main>

		<!-- Message Input -->
		<footer class="px-4 pb-3">
			<ChatInput placeholder="Message #{channel?.name ?? ''}" />
		</footer>
	</div>

	<!-- Members Pane (closeable) -->
	{#if showMembers}
		<MembersPane
			members={members.current}
			roles={roles.current}
			onclose={() => (showMembers = false)}
		/>
	{/if}
</div>
