
<script lang="ts">
	import { page } from '$app/state'
	import { mobile, profile, user } from '$lib/data'

	const currentUser = $derived(user.current)

	// Current server (if on a server route)
	const currentServer = $derived.by(() => {
		const sid = page.params?.server_id
		if (!sid) return undefined
		return profile.servers?.find((s) => s.id === sid)
	})

	const activeTab = $derived.by(() => {
		const path = page.url?.pathname ?? ''
		if (path.startsWith('/servers')) return 'home'
		if (path.startsWith('/dms')) return 'dms'
		return 'home'
	})

	const visible = $derived(mobile.dockVisible)
</script>

{#if visible}
	<nav
		class="fixed z-40"
		style="left: 0.5rem; right: 0.5rem; bottom: var(--sab, 0px);"
		aria-label="Main navigation"
	>
		<div class="dock-container">
			<div class="flex h-14 items-stretch justify-around">
			<!-- Home -->
			<a
				href={currentServer ? `/servers/${currentServer.id}` : '/'}
				class="dock-tab"
				aria-label="Home"
				aria-current={activeTab === 'home' ? 'page' : undefined}
			>
				<span class="dock-pill {activeTab === 'home' ? 'dock-pill-active' : ''}">
					<svg class="h-5.5 w-5.5" viewBox="0 0 24 24" fill={activeTab === 'home' ? 'currentColor' : 'none'} stroke="currentColor" stroke-width={activeTab === 'home' ? 0 : 1.5}>
						{#if activeTab === 'home'}
							<path d="M11.47 3.841a.75.75 0 0 1 1.06 0l8.69 8.69a.75.75 0 1 0 1.06-1.061l-8.689-8.69a2.25 2.25 0 0 0-3.182 0l-8.69 8.69a.75.75 0 1 0 1.061 1.06l8.69-8.689Z" />
							<path d="m12 5.432 8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75V21a.75.75 0 0 1-.75.75H5.625a1.875 1.875 0 0 1-1.875-1.875v-6.198a2.29 2.29 0 0 0 .091-.086L12 5.432Z" />
						{:else}
							<path stroke-linecap="round" stroke-linejoin="round" d="m2.25 12 8.954-8.955a1.126 1.126 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
						{/if}
					</svg>
				</span>
				<span class="dock-label {activeTab === 'home' ? 'dock-label-active' : ''}">Home</span>
			</a>

			<!-- DMs -->
			<a
				href="/dms"
				class="dock-tab"
				aria-label="DMs"
				aria-current={activeTab === 'dms' ? 'page' : undefined}
			>
				<span class="dock-pill {activeTab === 'dms' ? 'dock-pill-active' : ''}">
					<svg class="h-5.5 w-5.5" viewBox="0 0 24 24" fill={activeTab === 'dms' ? 'currentColor' : 'none'} stroke="currentColor" stroke-width={activeTab === 'dms' ? 0 : 1.5}>
						{#if activeTab === 'dms'}
							<path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 0 0-1.032-.211 50.89 50.89 0 0 0-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 0 0 2.433 3.984L7.28 21.53A.75.75 0 0 1 6 21v-2.234a4.75 4.75 0 0 1-1.661-1.238 4.5 4.5 0 0 1-1.024-2.297c-.55-3.443-.55-6.995 0-10.438a4.724 4.724 0 0 1 1.598-2.835Zm7.337 3.092a49.39 49.39 0 0 0-7.842 0C3.127 5.89 2.06 7.293 1.902 8.91a32.226 32.226 0 0 0 0 6.18c.16 1.617 1.225 3.02 2.506 3.16V21a.75.75 0 0 0 1.28.53l3.096-3.096a49.326 49.326 0 0 0 4.466-.166c1.9-.159 3.413-1.668 3.572-3.569.283-3.395.283-6.813 0-10.209-.159-1.9-1.672-3.41-3.572-3.569Z" />
						{:else}
							<path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
						{/if}
					</svg>
				</span>
				<span class="dock-label {activeTab === 'dms' ? 'dock-label-active' : ''}">DMs</span>
			</a>

			<!-- Activity -->
			<button
				class="dock-tab"
				aria-label="Activity"
			>
				<span class="dock-pill relative">
					<svg class="h-5.5 w-5.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round"
							d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
					</svg>
					<!-- Notification dot -->
					<span class="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-(--dock-bg)"></span>
				</span>
				<span class="dock-label">Activity</span>
			</button>

			<!-- More -->
			<button
				class="dock-tab"
				aria-label="More"
			>
				<span class="dock-pill">
					<svg class="h-5.5 w-5.5" viewBox="0 0 24 24" fill="currentColor">
						<circle cx="5" cy="12" r="2" />
						<circle cx="12" cy="12" r="2" />
						<circle cx="19" cy="12" r="2" />
					</svg>
				</span>
				<span class="dock-label">More</span>
			</button>
			</div>
		</div>
	</nav>
{/if}

<style>
	.dock-container {
		background: var(--dock-bg);
		border: 1px solid var(--dock-border);
		border-radius: 1.25rem;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.08);
		padding: 0 0.25rem;
		overflow: hidden;
	}

	.dock-tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		flex: 1;
		min-width: 0;
		color: var(--text-muted);
		-webkit-tap-highlight-color: transparent;
		user-select: none;
		text-decoration: none;
	}

	.dock-pill {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3.5rem;
		height: 2rem;
		border-radius: 9999px;
		transition: background-color 150ms ease, color 150ms ease;
	}

	.dock-pill-active {
		background-color: color-mix(in srgb, var(--accent) 18%, transparent);
		color: var(--accent);
	}

	.dock-label {
		font-size: 0.625rem;
		font-weight: 600;
		line-height: 1;
		letter-spacing: 0.01em;
		color: var(--text-muted);
		transition: color 150ms ease;
	}

	.dock-label-active {
		color: var(--accent);
	}
</style>
