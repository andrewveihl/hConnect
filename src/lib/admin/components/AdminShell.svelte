<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import AdminToasts from './AdminToasts.svelte';
	import AdminMobileNav from './AdminMobileNav.svelte';
	import type { AdminNavItem } from '$lib/admin/types';
	import { ADMIN_NAV_ITEMS } from '$lib/admin/types';
	import { adminNav, mobilePanel, mobileNavOpen, hasDetailPanel } from '$lib/admin/stores/adminNav';
	import { setupSwipeGestures } from '$lib/utils/swipeGestures';
	import { isMobileViewport } from '$lib/stores/viewport';
	import LeftPane from '$lib/components/app/LeftPane.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		title?: string;
		description?: string;
		currentPath?: string;
		userEmail?: string | null;
		navItems?: AdminNavItem[];
		children?: Snippet;
		toolbar?: Snippet;
		detailPanel?: Snippet;
		showBackButton?: boolean;
		onBack?: (() => void) | null;
	}

	let {
		title = 'Admin',
		description = 'Super Admin controls',
		currentPath = '',
		userEmail = '',
		navItems = ADMIN_NAV_ITEMS,
		children,
		toolbar,
		detailPanel,
		showBackButton = false,
		onBack = null
	}: Props = $props();

	let mainContentEl: HTMLDivElement | null = $state(null);
	let detachSwipe: (() => void) | null = null;

	const resolvedPath = $derived(currentPath || $page?.url?.pathname || '/admin');
	const hasToolbar = $derived(Boolean(toolbar));
	const hasDetail = $derived(Boolean(detailPanel));
	const mobileViewport = $derived($isMobileViewport);
	const currentMobilePanel = $derived($mobilePanel);
	const navOpen = $derived($mobileNavOpen);

	// Update detail panel availability
	$effect(() => {
		if (hasDetail) {
			adminNav.enableDetailPanel();
		} else {
			adminNav.disableDetailPanel();
		}
	});

	const isActive = (href: string) => {
		if (href === '/admin') {
			return resolvedPath === '/admin';
		}
		return resolvedPath === href || resolvedPath.startsWith(`${href}/`);
	};

	const handleNavigate = (href: string) => {
		adminNav.closeNav();
		goto(href);
	};

	const goBackToApp = () => goto('/');

	const handleBackButton = () => {
		if (onBack) {
			onBack();
		} else if (mobileViewport && currentMobilePanel === 'detail') {
			adminNav.showContent();
		} else {
			goBackToApp();
		}
	};

	// Setup swipe gestures
	onMount(() => {
		if (browser && mainContentEl) {
			detachSwipe = setupSwipeGestures(
				mainContentEl,
				{
					onSwipeLeft: () => {
						if (hasDetail) {
							adminNav.swipeLeft();
						}
					},
					onSwipeRight: () => {
						adminNav.swipeRight();
					}
				},
				{
					minDistance: 60,
					maxDuration: 400,
					verticalThreshold: 80
				}
			);
		}
	});

	onDestroy(() => {
		detachSwipe?.();
		adminNav.reset();
	});
</script>

<div
	class="admin-shell flex h-[100dvh] overflow-hidden"
	style="background: var(--surface-root); color: var(--color-text-primary);"
>
	<!-- Desktop Left Pane (server rail) -->
	<div class="hidden md:flex md:shrink-0">
		<LeftPane activeServerId={null} padForDock={false} showBottomActions={true} />
	</div>

	<!-- Desktop Sidebar Navigation -->
	<aside
		class="admin-sidebar hidden h-full w-64 flex-col overflow-y-auto md:flex"
		style="background: color-mix(in srgb, var(--surface-panel) 95%, transparent); border-right: 1px solid color-mix(in srgb, var(--color-text-primary) 8%, transparent);"
	>
		<!-- Logo / Brand -->
		<div class="px-5 py-5">
			<div class="flex items-center gap-3">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-cyan-500"
				>
					<i class="bx bx-shield-quarter text-xl text-white"></i>
				</div>
				<div>
					<p
						class="text-xs font-semibold uppercase tracking-[0.15em] text-[color:var(--text-50,#94a3b8)]"
					>
						hConnect
					</p>
					<p class="font-bold text-[color:var(--color-text-primary)]">Super Admin</p>
				</div>
			</div>
			{#if userEmail}
				<p
					class="mt-3 truncate rounded-lg bg-[color-mix(in_srgb,var(--color-text-primary)6%,transparent)] px-3 py-2 text-xs text-[color:var(--text-60,#6b7280)]"
				>
					{userEmail}
				</p>
			{/if}
		</div>

		<!-- Nav Items -->
		<nav class="flex-1 space-y-1 px-3 pb-4">
			{#each navItems as item}
				<button
					type="button"
					class="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all duration-200"
					class:bg-[color-mix(in_srgb,var(--accent-primary,#14b8a6)15%,transparent)]={isActive(
						item.href
					)}
					class:text-[color:var(--accent-primary,#14b8a6)]={isActive(item.href)}
					class:text-[color:var(--text-70,#475569)]={!isActive(item.href)}
					class:hover:bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)]={!isActive(
						item.href
					)}
					onclick={() => handleNavigate(item.href)}
				>
					<div
						class="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
						class:bg-[color:var(--accent-primary,#14b8a6)]={isActive(item.href)}
						class:text-white={isActive(item.href)}
						class:bg-[color-mix(in_srgb,var(--color-text-primary)10%,transparent)]={!isActive(
							item.href
						)}
						class:group-hover:bg-[color-mix(in_srgb,var(--color-text-primary)15%,transparent)]={!isActive(
							item.href
						)}
					>
						<i class="bx {item.icon} text-lg"></i>
					</div>
					<span class="flex-1">{item.label}</span>
					{#if item.badge}
						<span
							class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
							class:bg-emerald-500={item.badge === 'new'}
							class:bg-blue-500={item.badge === 'beta'}
							class:text-white={true}
						>
							{item.badge}
						</span>
					{/if}
				</button>
			{/each}
		</nav>

		<!-- Back to App -->
		<div
			class="border-t border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-4 py-4"
		>
			<button
				type="button"
				class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[color:var(--text-60,#6b7280)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)] hover:text-[color:var(--color-text-primary)]"
				onclick={goBackToApp}
			>
				<i class="bx bx-arrow-back text-lg"></i>
				Back to hConnect
			</button>
		</div>
	</aside>

	<!-- Main Content Area -->
	<div bind:this={mainContentEl} class="admin-content flex flex-1 flex-col overflow-hidden">
		<!-- Mobile Header -->
		<header
			class="admin-header sticky top-0 z-30 flex shrink-0 items-center justify-between border-b border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] px-4 py-3 md:hidden"
			style="background: color-mix(in srgb, var(--surface-panel) 90%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);"
		>
			<div class="flex items-center gap-3">
				{#if showBackButton || (mobileViewport && currentMobilePanel === 'detail')}
					<button
						type="button"
						class="flex h-9 w-9 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] text-[color:var(--color-text-primary)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)]"
						aria-label="Go back"
						onclick={handleBackButton}
					>
						<i class="bx bx-chevron-left text-xl"></i>
					</button>
				{:else}
					<button
						type="button"
						class="flex h-9 w-9 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] text-[color:var(--color-text-primary)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)]"
						aria-label="Back to app"
						onclick={goBackToApp}
					>
						<i class="bx bx-arrow-back text-lg"></i>
					</button>
				{/if}
				<div>
					<p
						class="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--text-50,#94a3b8)]"
					>
						Super Admin
					</p>
					<h1 class="text-base font-bold text-[color:var(--color-text-primary)]">{title}</h1>
				</div>
			</div>

			{#if hasToolbar}
				<div class="flex items-center gap-2">
					{@render toolbar?.()}
				</div>
			{/if}
		</header>

		<!-- Desktop Header -->
		<header
			class="hidden shrink-0 border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-6 py-4 md:block"
			style="background: color-mix(in srgb, var(--surface-panel) 50%, transparent);"
		>
			<div class="flex items-center justify-between">
				<div>
					<h1 class="text-xl font-bold text-[color:var(--color-text-primary)]">{title}</h1>
					{#if description}
						<p class="mt-1 text-sm text-[color:var(--text-60,#6b7280)]">{description}</p>
					{/if}
				</div>
				{#if hasToolbar}
					<div class="flex items-center gap-3">
						{@render toolbar?.()}
					</div>
				{/if}
			</div>
		</header>

		<!-- Content Wrapper with Swipe Panels -->
		<div class="admin-panels relative flex flex-1 overflow-hidden">
			<!-- Main Content -->
			<main
				class="admin-main flex-1 overflow-y-auto"
				class:translate-x-0={!mobileViewport || currentMobilePanel === 'content'}
				class:-translate-x-full={mobileViewport && currentMobilePanel === 'detail'}
				class:translate-x-full={mobileViewport && currentMobilePanel === 'nav'}
				style="-webkit-overflow-scrolling: touch;"
			>
				<div
					class="admin-main-inner mx-auto w-full max-w-7xl px-4 py-4 pb-24 sm:px-6 md:pb-6 lg:px-8"
				>
					{@render children?.()}
				</div>
			</main>

			<!-- Detail Panel (slides in from right on mobile) -->
			{#if hasDetail}
				<aside
					class="admin-detail absolute inset-y-0 right-0 w-full overflow-y-auto transition-transform duration-300 ease-out md:relative md:w-96 md:translate-x-0 md:border-l md:border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)]"
					class:translate-x-0={!mobileViewport || currentMobilePanel === 'detail'}
					class:translate-x-full={mobileViewport && currentMobilePanel !== 'detail'}
					style="background: var(--surface-panel); -webkit-overflow-scrolling: touch;"
				>
					{@render detailPanel?.()}
				</aside>
			{/if}
		</div>
	</div>
</div>

<!-- Mobile Bottom Navigation -->
<AdminMobileNav {userEmail} />

<!-- Toasts -->
<AdminToasts />

<style>
	.admin-shell {
		--admin-accent: var(--accent-primary, #14b8a6);
	}

	.admin-main {
		transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.admin-detail {
		box-shadow: -4px 0 20px rgba(0, 0, 0, 0.1);
	}

	@media (min-width: 768px) {
		.admin-detail {
			box-shadow: none;
		}
	}

	/* Ensure proper bottom padding for mobile nav */
	@supports (padding-bottom: env(safe-area-inset-bottom)) {
		.admin-main-inner {
			padding-bottom: calc(5rem + env(safe-area-inset-bottom));
		}

		@media (min-width: 768px) {
			.admin-main-inner {
				padding-bottom: 1.5rem;
			}
		}
	}

	/* Global admin page styles */
	:global(.admin-page) {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	:global(.admin-grid) {
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr;
	}

	@media (min-width: 640px) {
		:global(.admin-grid) {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (min-width: 1024px) {
		:global(.admin-grid) {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	:global(.admin-pill) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		font-weight: 600;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 0.3rem 0.95rem;
	}
</style>
