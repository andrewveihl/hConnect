<script lang="ts">
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
<div class="flex flex-1 flex-col bg-white">
	<!-- Chat Header -->
	<header class="flex h-14 flex-shrink-0 items-center justify-between border-b px-6">
		<div class="flex items-center space-x-2">
			<span class="text-lg font-bold"># {channel?.name}</span>
			<span class="text-gray-400">
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
					></path></svg
				>
			</span>
		</div>
		<div class="flex items-center space-x-4 text-gray-500">
			<button class="rounded p-1 hover:bg-gray-100">
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					></path></svg
				>
			</button>
			<div class="relative">
				<input
					type="text"
					placeholder="Search"
					class="w-48 rounded border px-2 py-1 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none"
				/>
			</div>
		</div>
	</header>

	<!-- Messages Area -->
	<main class="flex-1 space-y-6 overflow-y-auto p-6">
		{#each messages.current as message (message.id)}
			<div class="group flex items-start">
				<img
					class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-white font-bold opacity-0 transition-opacity duration-300 ease-in"
					src={message.author.photoURL}
					alt=""
					use:fade
				/>
				<div class="ml-3">
					<div class="flex items-baseline space-x-2">
						<span class="cursor-pointer font-bold hover:underline">{message.author.displayName}</span>
						<span class="text-xs text-gray-400">{message.createdAt.toDate().toISOString()}</span>
					</div>
					<p class="text-gray-800">
						{message.text}
					</p>
				</div>
			</div>
		{/each}
	</main>

	<!-- Message Input -->
	<footer class="p-6 pt-0">
		<div class="overflow-hidden rounded-lg border-2 border-gray-200 transition-colors focus-within:border-gray-400">
			<div class="flex space-x-4 border-b bg-gray-50 px-3 py-2 text-gray-500">
				<button class="hover:text-gray-800"><b>B</b></button>
				<button class="hover:text-gray-800"><i>I</i></button>
				<button class="hover:text-gray-800"><s>S</s></button>
				<div class="h-4 self-center border-l"></div>
				<button class="font-mono hover:text-gray-800">&lt;/&gt;</button>
			</div>
			<textarea placeholder="Message #general" class="min-h-[80px] w-full resize-none p-3 focus:outline-none"
			></textarea>
			<div class="flex items-center justify-between px-3 py-2">
				<div class="flex space-x-3 text-gray-400">
					<button class="hover:text-gray-600">
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg
						>
					</button>
					<button class="hover:text-gray-600">
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							></path></svg
						>
					</button>
				</div>
				<button class="rounded bg-green-700 px-3 py-1 font-bold text-white transition-colors hover:bg-green-800">
					<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"
						><path
							d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"
						></path></svg
					>
				</button>
			</div>
		</div>
		<div class="mt-1 flex justify-end space-x-1 text-[10px] text-gray-400">
			<span><b>Return</b> to send</span>
			<span>•</span>
			<span><b>Shift + Return</b> for new line</span>
		</div>
	</footer>
</div>
