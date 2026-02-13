<script lang="ts">
	import { ChatInput } from '$lib/components'
	import { ChannelsState, MessagesState } from '$lib/data'
	import { page } from '$app/state'

	const messages = $derived(new MessagesState(page.params.server_id!, page.params.channel_id!))
	const channels = $derived(new ChannelsState(page.params.server_id!))
	const channel = $derived(channels.current?.find((channel) => channel.id === page.params.channel_id))

	function fade(img: HTMLImageElement) {
		const completed = () => (img.style.opacity = '1')
		img.onload = completed
	}
</script>

<!-- 3. MAIN CONTENT AREA -->
<div class="flex flex-1 flex-col bg-(--surface-base)">
	<!-- Chat Header -->
	<header class="flex h-14 flex-shrink-0 items-center justify-between border-b border-(--border-default) px-6">
		<div class="flex items-center space-x-2">
			<span class="text-lg font-bold text-(--text-primary)"># {channel?.name}</span>
			<span class="text-(--text-muted)">
			</span>
		</div>
		<div class="flex items-center space-x-4 text-(--text-muted)">
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
