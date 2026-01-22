<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import { dmUnreadCount } from '$lib/stores/notifications';
	import { activityUnreadCount } from '$lib/stores/activityFeed';
	import { user, userProfile } from '$lib/stores/user';
	import { subscribeUserServers } from '$lib/firestore/servers';
	import { featureFlags } from '$lib/stores/featureFlags';
	import {
		closeSettings,
		openSettings,
		setSettingsSection,
		settingsUI
	} from '$lib/stores/settingsUI';
	import { defaultSettingsSection } from '$lib/settings/sections';
	import { resolveProfilePhotoURL } from '$lib/utils/profile';
	import { setupSwipeGestures } from '$lib/utils/swipeGestures';
	import { splashVisible } from '$lib/stores/splash';
	import { mobileOverlayStack, mobileSwipeProgress, serverChannelSidebarOpen } from '$lib/stores/mobileNav';
	import { LAST_SERVER_KEY, SERVER_CHANNEL_MEMORY_KEY } from '$lib/constants/navigation';
	import { preloadServerChannels, preloadUserServers } from '$lib/stores/messageCache';
	import Avatar from '$lib/components/app/Avatar.svelte';
	import { fabSnapStore, type RegisteredFab } from '$lib/stores/fabSnap';

	type LinkKey = 'activity' | 'dms';

	type Link = {
		key: LinkKey;
		href: string;
		label: string;
		icon: string;
		isActive: (path: string | null | undefined) => boolean;
	};

	type ServerShortcut = {
		id: string;
		name?: string | null;
		icon?: string | null;
	};

	type ChannelMemory = Record<string, string>;

	const navLinks: Link[] = [
		{
			key: 'dms',
			href: '/dms',
			label: 'DMs',
			icon: 'bx-message-dots',
			isActive: (path) => {
				const current = path ?? '';
				return current === '/dms' || current.startsWith('/dms/');
			}
		},
		{
			key: 'activity',
			href: '/',
			label: 'Activity',
			icon: 'bx-bell',
			isActive: (path) => (path ?? '') === '/'
		}
	];

	let currentPath = $derived($page?.url?.pathname ?? '/');
	let lastServerShortcut: ServerShortcut | null = $state(null);
	let serverRows: ServerShortcut[] = $state([]);
	let stopServers: (() => void) | null = $state(null);
	let stopUser: (() => void) | null = null;
	let serverChannelMemory: ChannelMemory = $state({});
	
	// Extract active server ID from current path
	const activeServerIdFromPath = $derived.by(() => {
		const match = /^\/servers\/([^/]+)/.exec(currentPath ?? '');
		return match ? match[1] : null;
	});
	
	// When on a server page, prefer fresh data from serverRows over cached lastServerShortcut
	const shortcut = $derived.by(() => {
		if (activeServerIdFromPath) {
			// We're on a server page - try to get fresh data from serverRows
			const freshMatch = serverRows.find((row) => row.id === activeServerIdFromPath);
			if (freshMatch) {
				return freshMatch;
			}
			// Server not found in rows yet, only show if lastServerShortcut matches this server
			if (lastServerShortcut?.id === activeServerIdFromPath) {
				return lastServerShortcut;
			}
			// Don't show stale data from a different server - show placeholder
			return { id: activeServerIdFromPath, name: null, icon: null };
		}
		// Not on a server page - use lastServerShortcut as the "go back to server" shortcut
		return lastServerShortcut;
	});
	
	const serverActive = $derived(
		shortcut ? (currentPath?.startsWith(`/servers/${shortcut.id}`) ?? false) : false
	);
	const serverHref = $derived.by(() => {
		if (!shortcut) return '/servers';
		const lastChannel = serverChannelMemory?.[shortcut.id];
		if (lastChannel) {
			return `/servers/${shortcut.id}?channel=${encodeURIComponent(lastChannel)}`;
		}
		return `/servers/${shortcut.id}`;
	});
	const featureFlagStore = featureFlags;
	const enableDMs = $derived(Boolean($featureFlagStore.enableDMs));
	const isSettingsOpen = $derived($settingsUI.open);
	const settingsActive = $derived(
		isSettingsOpen || (currentPath?.startsWith('/settings') ?? false)
	);
	const dockSuppressed = $derived(settingsActive);
	
	// Check if channel-list overlay is open (user swiped to see channels)
	// Also check the simple serverChannelSidebarOpen store which bypasses history issues
	const channelListOpen = $derived(
		$mobileOverlayStack.some(entry => entry.id === 'channel-list') || $serverChannelSidebarOpen
	);
	
	// Track swipe progress for smooth dock animation
	const swipeProgress = $derived($mobileSwipeProgress);
	const isSwipingChannels = $derived(swipeProgress.target === 'channels' && swipeProgress.progress > 0);
	
	// Calculate dock visibility based on swipe progress or overlay state
	// During swipe: use progress to smoothly animate dock
	// After swipe: use channelListOpen state
	const dockRevealProgress = $derived.by(() => {
		const path = currentPath ?? '';
		if (!path.startsWith('/servers/')) return 1; // Always visible on non-server pages
		
		// If actively swiping to open channels, use swipe progress
		if (isSwipingChannels) {
			return swipeProgress.progress;
		}
		
		// Otherwise use overlay state
		return channelListOpen ? 1 : 0;
	});
	
	// Check if we're on a page where the dock should be hidden on mobile
	// - Inside a DM conversation (has its own mobile shell)
	// - Viewing a server channel chat (full screen chat experience) - BUT show if channel list is open or swiping
	const shouldHideDock = $derived.by(() => {
		const path = currentPath ?? '';
		// Inside DM conversation
		if (path.startsWith('/dms/') && path !== '/dms') return true;
		// On a server page - hide unless channel list sidebar is open or actively swiping
		if (path.startsWith('/servers/')) {
			return !channelListOpen && !isSwipingChannels;
		}
		return false;
	});
	
	// ===== Mobile Dock Pages (swipeable) =====
	// Page 0: Main nav (Server, DMs, Activity, Profile)
	// Page 1: FAB icons (only if user has any FABs registered)
	let dockPage = $state(0);
	let registeredFabs: RegisteredFab[] = $state([]);
	let fabStoreUnsub: (() => void) | null = null;
	
	// Has FABs available determines if page 2 exists
	const hasFabPage = $derived(registeredFabs.length > 0);
	const totalDockPages = $derived(hasFabPage ? 2 : 1);
	
	// Swipe state for dock pages
	let dockSwipeStartX = $state(0);
	let dockSwipeCurrentX = $state(0);
	let isDockSwiping = $state(false);
	let dockContainerEl: HTMLElement | null = $state(null);
	
	// Calculate swipe offset for smooth animation
	const dockSwipeOffset = $derived.by(() => {
		if (!isDockSwiping) return 0;
		return dockSwipeCurrentX - dockSwipeStartX;
	});
	
	let navElement: HTMLElement | null = null;
	let detachSwipeGestures: (() => void) | null = null;

	onMount(() => {
		loadStoredLastServer();
		loadStoredChannelMemory();
		stopUser = user.subscribe((value) => {
			stopServers?.();
			serverRows = [];
			if (value?.uid) {
				stopServers = subscribeUserServers(value.uid, (rows) => {
					serverRows = rows ?? [];
					syncLastServerDetails();
				});
			} else {
				clearLastServerShortcut();
				clearServerChannelMemory();
			}
		});
		
		// Subscribe to FAB registry for page 2
		fabStoreUnsub = fabSnapStore.subscribe((state) => {
			registeredFabs = state.registeredFabs;
			// If we're on page 2 but no FABs anymore, go back to page 1
			if (dockPage === 1 && state.registeredFabs.length === 0) {
				dockPage = 0;
			}
		});

		return () => {
			stopServers?.();
			stopUser?.();
			fabStoreUnsub?.();
		};
	});

	function loadStoredLastServer() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(LAST_SERVER_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as ServerShortcut | null;
			if (parsed?.id) {
				lastServerShortcut = parsed;
			}
		} catch {
			// ignore storage read errors
		}
	}

	function persistLastServer(info: ServerShortcut | null) {
		if (!browser) return;
		try {
			if (!info) {
				localStorage.removeItem(LAST_SERVER_KEY);
				return;
			}
			localStorage.setItem(
				LAST_SERVER_KEY,
				JSON.stringify({
					id: info.id,
					name: info.name ?? null,
					icon: info.icon ?? null
				})
			);
		} catch {
			// ignore storage errors
		}
	}

	function setLastServerShortcut(info: ServerShortcut) {
		if (!info?.id) return;
		// Only use old values as fallbacks if we're updating the same server
		const isSameServer = lastServerShortcut?.id === info.id;
		const normalized: ServerShortcut = {
			id: info.id,
			name: info.name ?? (isSameServer ? lastServerShortcut?.name : null) ?? null,
			icon: info.icon ?? (isSameServer ? lastServerShortcut?.icon : null) ?? null
		};
		if (
			lastServerShortcut &&
			lastServerShortcut.id === normalized.id &&
			lastServerShortcut.name === normalized.name &&
			lastServerShortcut.icon === normalized.icon
		) {
			return;
		}
		lastServerShortcut = normalized;
		persistLastServer(normalized);
	}

	function clearLastServerShortcut() {
		if (!lastServerShortcut) return;
		lastServerShortcut = null;
		persistLastServer(null);
	}

	function syncLastServerDetails() {
		if (!serverRows.length) return;
		if (lastServerShortcut) {
			const match = serverRows.find((row) => row.id === lastServerShortcut?.id);
			if (match) {
				setLastServerShortcut(match);
				return;
			}
		}
		setLastServerShortcut(serverRows[0]);
	}

	$effect(() => {
		if (!browser) return;
		const match = /^\/servers\/([^/]+)/.exec(currentPath ?? '');
		if (!match) return;
		const serverId = match[1];
		const matchRow = serverRows.find((row) => row.id === serverId);
		setLastServerShortcut(matchRow ?? { id: serverId });
	});

	$effect(() => {
		if (!browser) return;
		const match = /^\/servers\/([^/]+)/.exec(currentPath ?? '');
		if (!match) return;
		const channelId = $page?.url?.searchParams?.get('channel') ?? null;
		if (channelId) {
			rememberServerChannel(match[1], channelId);
		}
	});
	
	// Preload server data when user is on DMs for instant server switching
	$effect(() => {
		if (!browser) return;
		const path = currentPath ?? '';
		// When on DMs or Activity page, preload the last server's channels
		if ((path === '/dms' || path.startsWith('/dms/') || path === '/') && serverRows.length > 0) {
			// Delay preload slightly so it doesn't compete with current page load
			const timer = setTimeout(() => {
				// Preload channels for servers (top 3)
				void preloadUserServers(serverRows.map(s => s.id));
			}, 500);
			return () => clearTimeout(timer);
		}
	});

	const formatBadge = (value: number): string => {
		if (!Number.isFinite(value)) return '';
		if (value > 99) return '99+';
		return value.toString();
	};

	function navigateToLink(link: Link) {
		closeSettings();
		if (typeof window !== 'undefined' && link.href === '/dms') {
			try {
				sessionStorage.setItem('dm-show-list', '1');
			} catch {
				// ignore
			}
		}
		goto(link.href);
	}

	function handleNav(event: MouseEvent, link: Link) {
		event.preventDefault();
		navigateToLink(link);
	}

	function openMobileSettings(event: MouseEvent) {
		event.preventDefault();
		setSettingsSection(defaultSettingsSection);
		openSettings({ source: 'trigger' });
	}

	function loadStoredChannelMemory() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(SERVER_CHANNEL_MEMORY_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object') return;
			const next: ChannelMemory = {};
			for (const [key, value] of Object.entries(parsed)) {
				if (typeof value === 'string' && value.trim()) {
					next[key] = value;
				}
			}
			serverChannelMemory = next;
		} catch {
			// ignore storage errors
		}
	}

	function persistChannelMemory(map: ChannelMemory) {
		if (!browser) return;
		try {
			const keys = Object.keys(map);
			if (!keys.length) {
				localStorage.removeItem(SERVER_CHANNEL_MEMORY_KEY);
			} else {
				localStorage.setItem(SERVER_CHANNEL_MEMORY_KEY, JSON.stringify(map));
			}
		} catch {
			// ignore storage errors
		}
	}

	function rememberServerChannel(serverId: string, channelId: string | null | undefined) {
		if (!serverId || !channelId) return;
		const existing = serverChannelMemory[serverId];
		if (existing === channelId) return;
		const next = { ...serverChannelMemory, [serverId]: channelId };
		serverChannelMemory = next;
		persistChannelMemory(next);
	}

	function clearServerChannelMemory() {
		if (!Object.keys(serverChannelMemory).length) return;
		serverChannelMemory = {};
		persistChannelMemory({});
	}

	function getVisibleNavLinks() {
		return navLinks.filter((link) => link.key !== 'dms' || enableDMs);
	}

	function isMobile() {
		return typeof window !== 'undefined' && window.innerWidth < 768;
	}

	function handleSwipe(direction: 'left' | 'right') {
		if (!isMobile() || dockSuppressed) return;
		const links = getVisibleNavLinks();
		if (links.length < 2) return;

		const activeIndex = links.findIndex((link) => link.isActive(currentPath));
		if (activeIndex < 0) return;

		const targetIndex = direction === 'left' ? activeIndex + 1 : activeIndex - 1;
		const target = links[targetIndex];
		if (!target) return;

		navigateToLink(target);
	}

	$effect(() => {
		detachSwipeGestures?.();
		detachSwipeGestures = null;
		if (!browser || !isMobile() || dockSuppressed || !navElement) return;
		const links = getVisibleNavLinks();
		if (links.length < 2) return;

		detachSwipeGestures = setupSwipeGestures(
			navElement,
			{
				onSwipeLeft: () => handleSwipe('left'),
				onSwipeRight: () => handleSwipe('right')
			},
			{ minDistance: 32, maxDuration: 480, verticalThreshold: 72 }
		);
	});

	onDestroy(() => {
		detachSwipeGestures?.();
	});
	
	// Preload server data on touch start for instant navigation
	function handleServerTouchStart() {
		if (shortcut?.id) {
			void preloadServerChannels(shortcut.id);
		}
	}
	
	// ===== Dock Page Swipe Handlers =====
	let dockSwipeStartY = $state(0);
	
	function handleDockTouchStart(event: TouchEvent) {
		// Only handle if we have multiple pages
		if (totalDockPages < 2) return;
		
		const touch = event.touches[0];
		dockSwipeStartX = touch.clientX;
		dockSwipeStartY = touch.clientY;
		dockSwipeCurrentX = touch.clientX;
		isDockSwiping = true;
		
		// Stop propagation immediately to prevent page behind from getting the event
		event.stopPropagation();
	}
	
	function handleDockTouchMove(event: TouchEvent) {
		if (!isDockSwiping) return;
		
		const touch = event.touches[0];
		dockSwipeCurrentX = touch.clientX;
		
		// Calculate deltas
		const deltaX = Math.abs(dockSwipeCurrentX - dockSwipeStartX);
		const deltaY = Math.abs(touch.clientY - dockSwipeStartY);
		
		// If horizontal swipe is dominant, prevent default and stop propagation
		if (deltaX > 10 && deltaX > deltaY) {
			event.preventDefault();
			event.stopPropagation();
		}
	}
	
	function handleDockTouchEnd(event: TouchEvent) {
		if (!isDockSwiping) return;
		
		// Stop propagation
		event.stopPropagation();
		
		const swipeDistance = dockSwipeCurrentX - dockSwipeStartX;
		const threshold = 50; // Minimum swipe distance to trigger page change
		
		if (swipeDistance < -threshold && dockPage < totalDockPages - 1) {
			// Swipe left - go to next page
			dockPage = dockPage + 1;
		} else if (swipeDistance > threshold && dockPage > 0) {
			// Swipe right - go to previous page
			dockPage = dockPage - 1;
		}
		
		// Reset swipe state
		isDockSwiping = false;
		dockSwipeStartX = 0;
		dockSwipeStartY = 0;
		dockSwipeCurrentX = 0;
	}
	
	function handleDockTouchCancel(event: TouchEvent) {
		event.stopPropagation();
		isDockSwiping = false;
		dockSwipeStartX = 0;
		dockSwipeStartY = 0;
		dockSwipeCurrentX = 0;
	}
	
	// Handle FAB click on mobile (dispatch event for the FAB to handle)
	function handleMobileFabClick(fab: RegisteredFab) {
		if (!browser) return;
		// Dispatch a custom event that the FAB components can listen for
		window.dispatchEvent(new CustomEvent('mobileFabClick', { detail: { fabId: fab.id } }));
	}
</script>

<nav 
	class="mobile-dock md:hidden" 
	class:mobile-dock--hidden={shouldHideDock || $splashVisible}
	class:mobile-dock--swiping={isSwipingChannels}
	class:mobile-dock--has-pages={hasFabPage}
	style:--dock-reveal-progress={dockRevealProgress}
	aria-label="Primary" 
	bind:this={navElement}
	ontouchstart={handleDockTouchStart}
	ontouchmove={handleDockTouchMove}
	ontouchend={handleDockTouchEnd}
	ontouchcancel={handleDockTouchCancel}
>
	<div 
		class="mobile-dock__pages-container"
		bind:this={dockContainerEl}
		style:transform={isDockSwiping 
			? `translateX(calc(${-dockPage * 100}% + ${dockSwipeOffset}px))` 
			: `translateX(${-dockPage * 100}%)`}
		style:transition={isDockSwiping ? 'none' : 'transform 0.25s ease-out'}
	>
		<!-- Page 1: Main Navigation -->
		<div class="mobile-dock__page">
			<div class="mobile-dock__inner">
				<a
					href={serverHref}
					ontouchstart={handleServerTouchStart}
					onmouseenter={handleServerTouchStart}
					onclick={(event) => {
						event.preventDefault();
						closeSettings();
						goto(serverHref);
					}}
					class={`mobile-dock__item mobile-dock__item--server ${serverActive && !dockSuppressed ? 'is-active' : ''} ${shortcut ? '' : 'is-placeholder'}`}
					aria-label={shortcut?.name ?? 'Servers'}
					aria-current={serverActive && !dockSuppressed ? 'page' : undefined}
					title="Servers"
				>
					<span class="mobile-dock__icon-wrapper">
						{#if shortcut?.icon}
							<img
								src={shortcut.icon}
								alt={shortcut.name ?? 'Server icon'}
								class="mobile-dock__server-icon"
								loading="lazy"
							/>
						{:else if shortcut?.name}
							<span class="mobile-dock__server-fallback">
								{shortcut.name.slice(0, 1)}
							</span>
						{:else}
							<span class="mobile-dock__server-placeholder">
								<i class="bx bx-hash" aria-hidden="true"></i>
							</span>
						{/if}
					</span>
				</a>

				{#each navLinks as link (link.key)}
					{#if link.key !== 'dms' || enableDMs}
						{@const active = dockSuppressed ? false : link.isActive(currentPath)}
						{@const badge =
							link.key === 'dms' ? $dmUnreadCount : link.key === 'activity' ? $activityUnreadCount : 0}
						<a
							href={link.href}
							onclick={(event) => handleNav(event, link)}
							class={`mobile-dock__item ${active ? 'is-active' : ''}`}
							class:mobile-dock__item--alert={!active && badge > 0}
							class:mobile-dock__item--dms={link.key === 'dms'}
							class:mobile-dock__item--activity={link.key === 'activity'}
							aria-label={link.label}
							aria-current={active ? 'page' : undefined}
							title={link.label}
						>
							<span class="mobile-dock__icon-wrapper">
								<i class={`bx ${link.icon} mobile-dock__icon`} aria-hidden="true"></i>
								{#if badge > 0}
									<span class="mobile-dock__badge">{formatBadge(badge)}</span>
								{/if}
							</span>
						</a>
					{/if}
				{/each}

				<a
					href="/settings"
					onclick={openMobileSettings}
					class={`mobile-dock__item mobile-dock__item--profile ${settingsActive ? 'is-active' : ''}`}
					aria-label="Profile"
					aria-current={settingsActive ? 'page' : undefined}
					title="Profile"
				>
					<span class="mobile-dock__icon-wrapper mobile-dock__icon-wrapper--profile">
						<Avatar
							user={$userProfile ?? $user}
							size="xs"
							isSelf={true}
							class="mobile-dock__avatar-wrap"
						/>
					</span>
				</a>
			</div>
		</div>
		
		<!-- Page 2: FAB Icons (only rendered if FABs exist) -->
		{#if hasFabPage}
			<div class="mobile-dock__page mobile-dock__page--fabs">
				<div class="mobile-dock__inner">
					{#each registeredFabs as fab (fab.id)}
						<button
							type="button"
							class="mobile-dock__item mobile-dock__fab-item"
							onclick={() => handleMobileFabClick(fab)}
							aria-label={fab.label}
							title={fab.label}
						>
							<span class="mobile-dock__icon-wrapper">
								<i class={`bx ${fab.icon} mobile-dock__icon`} aria-hidden="true"></i>
							</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
	
	<!-- Page indicator dots -->
	{#if hasFabPage}
		<div class="mobile-dock__dots">
			{#each Array(totalDockPages) as _, i}
				<button
					type="button"
					class="mobile-dock__dot"
					class:mobile-dock__dot--active={dockPage === i}
					onclick={() => dockPage = i}
					aria-label={`Go to page ${i + 1}`}
				></button>
			{/each}
		</div>
	{/if}
</nav>

<style>
	.mobile-dock {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 99999;
		width: 100%;
		box-sizing: border-box;
		background: var(--color-panel) !important;
		border-top: none;
		padding: 0;
		padding-bottom: calc(
			env(safe-area-inset-bottom, 0px) + 0.65rem
		); /* Nudge nav content further upward */
		height: var(--mobile-dock-height, calc(6rem + env(safe-area-inset-bottom, 0px)));
		overflow: hidden; /* Clip the sliding pages */
		/* Ensure no transparency */
		/* Add a pseudo-element to guarantee flush color under home indicator */
	}

	.mobile-dock::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: env(safe-area-inset-bottom, 0px);
		background: var(--color-panel);
		pointer-events: none;
		z-index: 1;
	}

	.mobile-dock__inner {
		display: flex;
		flex-direction: row;
		justify-content: space-around;
		align-items: center;
		height: calc(
			var(--mobile-dock-height, calc(6rem + env(safe-area-inset-bottom, 0px))) -
				env(safe-area-inset-bottom, 0px) - 0.65rem
		);
		width: 100%;
		max-width: none;
		margin: 0;
		gap: 0;
	}

	.mobile-dock__item {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 0;
		border-radius: 0;
		border: none;
		background: transparent;
		color: var(--color-text-tertiary);
		text-decoration: none;
		transition: none;
		flex: 1;
		-webkit-tap-highlight-color: transparent;
		outline: none;
	}

	.mobile-dock__item:hover {
		color: var(--color-text-tertiary);
	}

	.mobile-dock__item.is-active {
		color: var(--color-text-primary);
	}

	.mobile-dock__item.is-active .mobile-dock__label,
	.mobile-dock__item.is-active .mobile-dock__icon {
		color: var(--color-text-primary);
	}

	.mobile-dock__icon-wrapper {
		position: relative;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 0;
		background: transparent;
		border: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 0;
	}

	.mobile-dock__icon-wrapper--profile {
		padding: 0;
	}

	.mobile-dock__icon {
		font-size: 2.25rem;
		line-height: 1;
	}

	.mobile-dock__label {
		color: inherit;
		font-size: 0.625rem;
		line-height: 1.1;
		pointer-events: none;
		font-weight: 500;
		white-space: nowrap;
	}

	.mobile-dock__badge {
		position: absolute;
		top: -0.2rem;
		right: -0.35rem;
		min-width: 0.9rem;
		height: 0.9rem;
		padding: 0 0.2rem;
		border-radius: 999px;
		background: var(--color-danger);
		color: white;
		font-size: 0.55rem;
		font-weight: 700;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--color-panel);
	}

	.mobile-dock__item--alert {
		color: var(--color-text-tertiary);
	}

	.mobile-dock__server-icon,
	.mobile-dock__avatar {
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 50%;
		object-fit: cover;
	}

	.mobile-dock__server-fallback,
	.mobile-dock__server-placeholder {
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 50%;
		background: var(--color-accent);
		color: var(--button-primary-text);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 600;
		font-size: 0.9rem;
	}

	.mobile-dock__server-placeholder {
		background: var(--color-panel-muted);
		color: var(--color-text-tertiary);
	}

	.mobile-dock__item--profile .mobile-dock__icon,
	.mobile-dock__item--notes .mobile-dock__icon,
	.mobile-dock__item--dms .mobile-dock__icon,
	.mobile-dock__item--activity .mobile-dock__icon {
		color: inherit;
	}

	.mobile-dock__item--profile .mobile-dock__label {
		color: inherit;
	}

	.mobile-dock__item--profile.is-active .mobile-dock__icon-wrapper {
		border: none;
	}

	.mobile-dock__item--profile.is-active .mobile-dock__avatar {
		box-shadow: none; /* No ring - just plain icon */
	}

	.mobile-dock--hidden {
		transform: translateY(100%);
		opacity: 0;
		pointer-events: none;
		transition:
			transform 0.15s ease-out,
			opacity 0.15s ease-out;
	}
	
	/* During swipe: use progress-based transform, no transition */
	.mobile-dock--swiping {
		transform: translateY(calc(100% * (1 - var(--dock-reveal-progress, 0))));
		opacity: var(--dock-reveal-progress, 0);
		pointer-events: none;
		transition: none;
	}
	
	/* When dock becomes visible (not hidden, not swiping), animate in quickly */
	.mobile-dock:not(.mobile-dock--hidden):not(.mobile-dock--swiping) {
		transform: translateY(0);
		opacity: 1;
		pointer-events: auto;
		transition:
			transform 0.1s ease-out,
			opacity 0.1s ease-out;
	}

	/* Keep nav + children matching the dock background to prevent artifacts */
	.mobile-dock *,
	.mobile-dock__icon-wrapper {
		background-color: var(--color-panel) !important;
		box-shadow: none !important;
	}

	/* Remove the green self-user ring from avatar in mobile nav */
	.mobile-dock :global(.avatar--self .avatar-inner) {
		box-shadow: none !important;
	}

	/* Make avatar same size as server icon (2.25rem) */
	.mobile-dock :global(.avatar-wrapper) {
		width: 2.25rem !important;
		height: 2.25rem !important;
	}

	.mobile-dock :global(.avatar-inner) {
		border: none !important;
	}
	
	/* ===== Swipeable Pages Container ===== */
	.mobile-dock__pages-container {
		display: flex;
		flex-direction: row;
		width: 100%;
		height: 100%;
		will-change: transform;
	}
	
	.mobile-dock__page {
		flex: 0 0 100%;
		width: 100%;
		min-width: 100%;
		display: flex;
		flex-direction: column;
		justify-content: flex-start;
	}
	
	.mobile-dock__page--fabs {
		/* FABs page - same styling as main page */
		align-items: stretch;
	}
	
	.mobile-dock__fab-item {
		cursor: pointer;
	}
	
	.mobile-dock__fab-item:active {
		opacity: 0.7;
	}
	
	/* ===== Page Indicator Dots ===== */
	.mobile-dock__dots {
		position: absolute;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 0.25rem);
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 0.35rem;
		z-index: 10;
	}
	
	.mobile-dock__dot {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		background: var(--color-text-tertiary) !important;
		opacity: 0.4;
		border: none;
		padding: 0;
		cursor: pointer;
		transition: opacity 0.15s ease, transform 0.15s ease;
	}
	
	.mobile-dock__dot--active {
		opacity: 1;
		transform: scale(1.2);
		background: var(--color-accent) !important;
	}
	
	/* When has multiple pages, add padding at bottom for dots */
	.mobile-dock--has-pages {
		padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1.1rem);
	}
	
	.mobile-dock--has-pages .mobile-dock__inner {
		height: calc(
			var(--mobile-dock-height, calc(6rem + env(safe-area-inset-bottom, 0px))) -
				env(safe-area-inset-bottom, 0px) - 1.1rem
		);
	}

	/* Hide on desktop screens */
	@media (min-width: 768px) {
		.mobile-dock {
			display: none !important;
		}
	}
</style>
