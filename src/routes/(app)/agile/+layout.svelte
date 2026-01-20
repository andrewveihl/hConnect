<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { user } from '$lib/stores/user';
	import { isMobileViewport } from '$lib/stores/viewport';
	import AdminToasts from '$lib/admin/components/AdminToasts.svelte';
	import AgileSidebar from '$lib/components/agile/AgileSidebar.svelte';
	import CreateBoardModal from '$lib/components/agile/CreateBoardModal.svelte';
	import {
		subscribeUserBoards,
		type AgileBoard,
		type Sprint
	} from '$lib/firestore/agile';
	import type { Unsubscribe } from 'firebase/firestore';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	// State
	let boards = $state<AgileBoard[]>([]);
	let loading = $state(true);
	let showCreateModal = $state(false);
	let activeSprint = $state<Sprint | null>(null);
	let sidebarOpen = $state(true);

	// Subscriptions
	let unsubBoards: Unsubscribe | null = null;

	const mobileViewport = $derived($isMobileViewport);
	const currentPath = $derived($page?.url?.pathname ?? '/agile');
	
	// Extract board ID from URL if present
	const currentBoardId = $derived.by(() => {
		const match = currentPath.match(/\/agile\/board\/([^/]+)/);
		return match ? match[1] : null;
	});

	onMount(() => {
		const uid = $user?.uid;
		if (!uid) {
			loading = false;
			return;
		}

		unsubBoards = subscribeUserBoards(uid, (b) => {
			boards = b;
			loading = false;
		});
	});

	onDestroy(() => {
		unsubBoards?.();
	});

	// Toggle sidebar on mobile
	function toggleSidebar() {
		sidebarOpen = !sidebarOpen;
	}
</script>

<AdminToasts />

<div class="agile-layout" class:sidebar-collapsed={!sidebarOpen} class:mobile={mobileViewport}>
	<!-- Sidebar -->
	{#if !mobileViewport || sidebarOpen}
		<AgileSidebar 
			{boards}
			{activeSprint}
			{currentBoardId}
			onCreateBoard={() => showCreateModal = true}
		/>
	{/if}

	<!-- Main Content Area -->
	<div class="agile-main">
		<!-- Mobile Header with menu toggle -->
		{#if mobileViewport}
			<header class="mobile-header">
				<button type="button" class="menu-btn" onclick={toggleSidebar} aria-label="Toggle menu">
					<i class="bx {sidebarOpen ? 'bx-x' : 'bx-menu'}"></i>
				</button>
				<span class="mobile-title">Agile</span>
			</header>
		{/if}

		<!-- Page Content -->
		<div class="agile-content">
			{@render children()}
		</div>
	</div>

	<!-- Mobile Overlay -->
	{#if mobileViewport && sidebarOpen}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="mobile-overlay" onclick={() => sidebarOpen = false}></div>
	{/if}
</div>

<!-- Create Board Modal (shared across all agile pages) -->
{#if showCreateModal}
	<CreateBoardModal 
		open={showCreateModal}
		onClose={() => showCreateModal = false}
	/>
{/if}

<style>
	.agile-layout {
		display: flex;
		height: 100%;
		width: 100%;
		overflow: hidden;
		background: var(--color-panel-muted);
	}

	.agile-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		overflow: hidden;
	}

	.agile-content {
		flex: 1;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	/* Mobile styles */
	.agile-layout.mobile {
		position: relative;
	}

	.agile-layout.mobile :global(.agile-sidebar) {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		z-index: 100;
		box-shadow: 4px 0 24px rgba(0, 0, 0, 0.3);
	}

	.mobile-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--color-panel);
		border-bottom: 1px solid var(--text-08);
	}

	.menu-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border: none;
		border-radius: 0.5rem;
		background: var(--button-ghost-bg);
		color: var(--color-text-primary);
		font-size: 1.25rem;
		cursor: pointer;
	}

	.mobile-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.mobile-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 50;
	}
</style>
