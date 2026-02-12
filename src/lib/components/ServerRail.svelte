<script lang="ts">
	import favicon from '$lib/assets/ServerRailIcon/Healthspaceslogo.png'
	import { profile } from '$lib/data'
	import { page } from '$app/state'

	let activeServerId = $derived(page.params?.server_id)
</script>

<ul class="flex w-[72px] shrink-0 flex-col items-center gap-2 bg-(--rail-bg) py-3">
	<!-- App logo -->
	<li class="mb-1">
		<a href="/dms" class="flex h-12 w-12 items-center justify-center rounded-2xl bg-(--rail-icon-bg) transition-all duration-200 hover:bg-(--rail-icon-hover)">
			<img src={favicon} alt="Home" class="h-10 w-10" />
		</a>
	</li>
	<li class="mx-auto mb-1 h-px w-8 bg-(--rail-divider)"></li>
	{#each profile.servers as server (server.id)}
		<li class="relative">
			<a href="/{server.id}" class="group flex h-12 w-12 items-center justify-center rounded-full bg-(--rail-icon-bg) transition-all duration-200 hover:bg-(--rail-icon-hover) overflow-hidden ring-[3px] {activeServerId === server.id ? 'ring-[#33c8bf]' : 'ring-transparent'}">
				{#if server.icon}
					<img class="h-full w-full object-cover transition-opacity duration-200 group-hover:opacity-80" src={server.icon} alt={server.name} />
				{:else}
					<span class="text-sm font-semibold text-(--rail-text)">{server.name.slice(0, 2).toUpperCase()}</span>
				{/if}
			</a>
		</li>
	{/each}
	<li>
		<button class="flex h-12 w-12 items-center justify-center rounded-full bg-(--rail-icon-bg) text-(--rail-add-text) transition-all duration-200 hover:bg-(--rail-icon-hover) hover:text-white">
			<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 5v14m-7-7h14" /></svg>
		</button>
	</li>
</ul>
