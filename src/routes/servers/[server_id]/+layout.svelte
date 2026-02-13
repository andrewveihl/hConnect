<script lang="ts">
	import { page } from '$app/state'
	import { profile, ChannelsState } from '$lib/data'

	let { children } = $props()

	const server = $derived(profile.servers?.find((server) => server.id === page.params.server_id))
	const channels = $derived(new ChannelsState(page.params.server_id!))
</script>

<!-- 2. CHANNEL SIDEBAR -->
<div
	class="flex w-64 flex-shrink-0 flex-col border-r border-l border-(--border-subtle) bg-(--surface-channel-sidebar) text-(--channel-text)"
>
	<!-- Header -->
	<div
		class="flex cursor-pointer items-center justify-between border-b border-(--border-subtle) p-4 hover:bg-(--surface-hover)"
	>
		<h1 class="h-6 truncate text-lg font-bold text-(--text-primary)">{server?.name}</h1>
		<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"
			><path
				d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
			></path></svg
		>
	</div>

	<!-- Content Scrollable -->
	<div class="hide-scrollbar flex-1 overflow-y-auto py-4">
		<!-- Channels Section -->
		<div class="mb-4 px-4">
			<div
				class="mb-2 flex items-center justify-between text-xs font-semibold tracking-wider text-(--channel-section-text) uppercase"
			>
				<span>Channels</span>
				<span class="cursor-pointer text-lg">+</span>
			</div>
			<ul class="space-y-1">
				{#each channels.current as channel (channel.id)}
					<li
						class="cursor-pointer rounded px-2 py-1 {channel.id === page.params.channel_id
							? 'bg-(--channel-active) text-(--channel-text-active)'
							: 'hover:bg-(--border-subtle)'}"
					>
						<a class="flex items-center gap-1 h-full w-full" href="/servers/{page.params.server_id}/{channel.id}">
							<span class="relative inline-block">
								<span>#</span>
								{#if channel.isPrivate}
									<svg class="absolute -right-0.5 bottom-1 h-[8px] w-[8px] text-teal-400 drop-shadow-[0_0_1px_rgba(0,0,0,0.8)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
										<rect x="5" y="11" width="14" height="11" rx="2" />
										<path d="M8 11V7a4 4 0 1 1 8 0v4" />
									</svg>
								{/if}
							</span>
							<span class="truncate">{channel.name}</span>
						</a>
					</li>
				{/each}
			</ul>
		</div>
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
