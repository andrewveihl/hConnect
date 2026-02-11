<script lang="ts">
	import { page } from '$app/state'
	import { profile, servers, ChannelsState } from '$lib/data'

	let { children } = $props()

	const server = $derived(servers.current?.find((server) => server.id === page.params.server_id))
	const channels = $derived(new ChannelsState(page.params.server_id!))
</script>

<!-- 2. CHANNEL SIDEBAR -->
<div class="flex w-64 flex-shrink-0 flex-col border-l border-white/10 bg-[#3F0E40] text-purple-100">
	<!-- Header -->
	<div class="flex cursor-pointer items-center justify-between border-b border-white/10 p-4 hover:bg-black/10">
		<h1 class="truncate text-lg font-bold">{server?.name}</h1>
		<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"
			><path
				d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
			></path></svg
		>
	</div>

	<!-- Content Scrollable -->
	<div class="flex-1 overflow-y-auto py-4">
		<!-- Channels Section -->
		<div class="mb-4 px-4">
			<div class="mb-2 flex items-center justify-between text-xs font-semibold tracking-wider text-white/60 uppercase">
				<span>Channels</span>
				<span class="cursor-pointer text-lg">+</span>
			</div>
			<ul class="space-y-1">
				{#each channels.current as channel (channel.id)}
					<li
						class="cursor-pointer rounded px-2 py-1 {channel.id === page.params.channel_id
							? 'bg-[#1164A3]'
							: 'hover:bg-white/10'}"
					>
						<a class="block h-full w-full" href="/{page.params.server_id}/{channel.id}">
							# {channel.name}
						</a>
					</li>
				{/each}
			</ul>
		</div>

		<!-- Direct Messages Section -->
		<div class="px-4">
			<div class="mb-2 flex items-center justify-between text-xs font-semibold tracking-wider text-white/60 uppercase">
				<span>Direct Messages</span>
				<span class="cursor-pointer text-lg">+</span>
			</div>
			<ul class="space-y-1">
				<li class="flex cursor-pointer items-center rounded px-2 py-1 hover:bg-white/10">
					<span class="mr-2 h-2 w-2 rounded-full bg-green-500"></span>
					<span>Jane Doe (you)</span>
				</li>
				<li class="flex cursor-pointer items-center rounded px-2 py-1 hover:bg-white/10">
					<span class="mr-2 h-2 w-2 rounded-full bg-green-500"></span>
					<span>John Smith</span>
				</li>
				<li class="flex cursor-pointer items-center rounded px-2 py-1 hover:bg-white/10">
					<span class="mr-2 h-2 w-2 rounded-full border border-white/40"></span>
					<span class="opacity-70">Alex Rivera</span>
				</li>
			</ul>
		</div>
	</div>
</div>

{@render children()}
