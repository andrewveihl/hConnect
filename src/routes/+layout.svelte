<script lang="ts">
	import './layout.css'
	import favicon from '$lib/assets/BrowserTabIcon/HSBrowserTab.png'
	import { Auth, ServerRail, UserPanel, BottomDock } from '$lib/components'
	import { user, mobile } from '$lib/data'

	let { children } = $props()

	const isMobile = $derived(mobile.isMobile)
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<Auth>
	<div
		class="relative flex h-full"
		style:height={isMobile ? 'var(--app-height, 100vh)' : undefined}
	>
		<!-- Server rail: always shown on desktop, conditionally on mobile -->
		{#if mobile.railVisible}
			<ServerRail />
		{/if}

		<div class="flex min-h-0 min-w-0 flex-1 flex-col">
			{@render children()}
		</div>

		<!-- Desktop: floating user panel -->
		{#if !isMobile && user.current}
			<div class="absolute bottom-3 left-3 z-50">
				<UserPanel />
			</div>
		{/if}

		<!-- Mobile: bottom dock -->
		{#if isMobile}
			<BottomDock />
		{/if}
	</div>
</Auth>

<style>
	:global(main) {
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
		background: var(--scrollbar-thumb);
		border-radius: 10px;
		border: 2px solid transparent;
		background-clip: content-box;
	}
</style>
