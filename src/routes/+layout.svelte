<script lang="ts">
	import './layout.css'
	import favicon from '$lib/assets/favicon.svg'
	import { Auth, ServerRail, UserPanel } from '$lib/components'
	import { user } from '$lib/data'

	let { children } = $props()
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<Auth>
	<div class="relative flex h-full">
		<ServerRail />
		{@render children()}

		<!-- User Panel: floating at bottom-left, avatar aligned with server icons -->
		{#if user.current}
			<div class="absolute bottom-3 left-3 z-50">
				<UserPanel />
			</div>
		{/if}
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
