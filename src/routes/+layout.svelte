<script lang="ts">
	import './layout.css'
	import favicon from '$lib/assets/favicon.svg'
	import { Auth } from '$lib/components'
	import { profile } from '$lib/data'

	let { children } = $props()
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<Auth>
	<div class="flex h-full">
		<!-- 1. WORKSPACE BAR (Leftmost) -->
		<ul class="flex w-16 flex-shrink-0 flex-col items-center space-y-4 bg-[#3F0E40] py-4">
			<!-- to limit to profile servers: profile.servers -->
			{#each profile.servers as server (server.id)}
				<li
					class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-2xl bg-white/20 transition-all duration-200 hover:bg-white/30"
				>
					<a href="/{server.id}">
						<img class="h-10 w-10 rounded-md border border-gray-300 p-0.5" src={server.icon} alt={server.name} />
					</a>
				</li>
			{/each}
			<li
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-2xl bg-white/20 transition-all duration-200 hover:bg-white/30"
			>
				<span class="text-2xl text-white">+</span>
			</li>
		</ul>

		{@render children()}
	</div>
</Auth>

<style>
	main {
		scrollbar-gutter: stable;
	}
	/* Custom scrollbar for a cleaner look */
	::-webkit-scrollbar {
		width: 10px;
	}
	::-webkit-scrollbar-track {
		background: transparent;
	}
	::-webkit-scrollbar-thumb {
		background: #4a154b;
		border-radius: 10px;
		border: 2px solid transparent;
		background-clip: content-box;
	}
	.workspace-icon:hover {
		border-radius: 12px;
	}
</style>
