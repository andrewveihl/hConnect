<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import SplashScreen from '$lib/components/app/SplashScreen.svelte';
	import { initMobileNavigation } from '$lib/stores/mobileNav';
	import { splashVisible } from '$lib/stores/splash';
	import FloatingActionDock from '$lib/components/app/FloatingActionDock.svelte';
	import TicketFab from '$lib/components/app/TicketFab.svelte';
	import ThreadsFab from '$lib/components/app/ThreadsFab.svelte';
	import SuperAdminFab from '$lib/components/app/SuperAdminFab.svelte';
	import VoiceDebugFab from '$lib/components/app/VoiceDebugFab.svelte';
	import DesktopUserBar from '$lib/components/app/DesktopUserBar.svelte';
	import {
		initClientErrorReporting,
		teardownClientErrorReporting
	} from '$lib/telemetry/clientErrors';
	import {
		customizationConfigStore,
		applyThemeOverrides,
		type CustomizationConfig
	} from '$lib/admin/customization';
	import { theme } from '$lib/stores/theme';
	import { setSoundOverrides } from '$lib/utils/sounds';
	import { initFabSnappingSettings, initFabSnapSync } from '$lib/stores/fabSnap';

	interface Props {
		children?: import('svelte').Snippet;
	}

	let { children }: Props = $props();
	let isAppReady = $state(true); // Default to ready so desktop / SSR never renders the splash.
	let shouldShowMobileSplash = $state(false);
	let splashTimer: ReturnType<typeof setTimeout> | null = null;
	let hardFailSafeTimer: ReturnType<typeof setTimeout> | null = null;
	let detachViewportListeners: (() => void) | null = null;
	const currentPath = $derived($page?.url?.pathname ?? '/');
	const isAuthPage = $derived(
		currentPath.startsWith('/sign-in') || currentPath.startsWith('/login')
	);
	const isAdminPage = $derived(currentPath.startsWith('/admin'));
	const hideFloatingDock = $derived(currentPath.startsWith('/splash') || isAuthPage);

	// Global customization config for themes and splash
	const customization = customizationConfigStore();
	let currentTheme = $state<'dark' | 'light' | 'midnight'>('dark');

	// Subscribe to theme changes and apply admin overrides
	$effect(() => {
		const unsub = theme.subscribe((t) => {
			// Map holiday to dark for override purposes
			currentTheme = (t === 'holiday' ? 'dark' : t) as 'dark' | 'light' | 'midnight';
		});
		return unsub;
	});

	// Apply theme overrides whenever config or theme changes
	$effect(() => {
		if ($customization) {
			applyThemeOverrides($customization, currentTheme);
			setSoundOverrides($customization.sounds);
		}
	});

	// Prefer the largest available viewport metric so iOS URL bars don't shrink the app.
	// On desktop, just use innerHeight directly for accurate resizing.
	const setAppHeight = () => {
		if (typeof window === 'undefined') return;
		const vv = window.visualViewport;
		const isMobile = window.matchMedia('(max-width: 767px)').matches;
		
		let height: number;
		if (isMobile) {
			// On mobile, prefer the largest value to avoid shrinking when keyboard opens
			const candidates = [
				window.innerHeight,
				document.documentElement.clientHeight,
				window.outerHeight,
				vv?.height ?? 0,
				window.screen?.height ?? 0,
				window.screen?.availHeight ?? 0
			].filter((n) => typeof n === 'number' && n > 0);
			height = candidates.length ? Math.max(...candidates) : window.innerHeight;
		} else {
			// On desktop, use actual window height for accurate resize behavior
			height = window.innerHeight;
		}

		const next = `${height}px`;
		document.documentElement.style.setProperty('--app-height', next);
		document.documentElement.style.height = next;
		document.documentElement.style.minHeight = next;
		document.body.style.height = next;
		document.body.style.minHeight = next;
		const app = document.getElementById('app');
		if (app) {
			app.style.height = next;
			app.style.minHeight = next;
		}
	};

	// Small scroll nudge to encourage Safari to collapse the URL bar.
	const nudgeSafariBar = () => {
		if (typeof window === 'undefined') return;
		requestAnimationFrame(() => {
			if (window.scrollY < 2) {
				window.scrollTo(0, 1);
				setTimeout(() => {
					if (window.scrollY < 2) window.scrollTo(0, 1);
				}, 180);
			}
		});
	};

	const attachViewportListeners = () => {
		const vv = typeof window !== 'undefined' ? window.visualViewport : null;
		setAppHeight();
		// Re-apply shortly after mount to catch late Safari viewport adjustments.
		setTimeout(setAppHeight, 100);
		setTimeout(setAppHeight, 350);
		setTimeout(nudgeSafariBar, 200);
		window.addEventListener('resize', setAppHeight);
		window.addEventListener('orientationchange', setAppHeight);
		vv?.addEventListener('resize', setAppHeight);

		return () => {
			window.removeEventListener('resize', setAppHeight);
			window.removeEventListener('orientationchange', setAppHeight);
			vv?.removeEventListener('resize', setAppHeight);
		};
	};

	onMount(() => {
		detachViewportListeners = attachViewportListeners();
		const teardownNavigation = initMobileNavigation();
		initClientErrorReporting();
		initFabSnappingSettings();
		initFabSnapSync();
		const isMobile = shouldUseMobileSplash();

		if (!isMobile) {
			isAppReady = true;
			shouldShowMobileSplash = false;
			splashVisible.set(false);
			return () => {
				teardownNavigation?.();
				teardownClientErrorReporting();
				detachViewportListeners?.();
			};
		}

		shouldShowMobileSplash = true;
		isAppReady = false;
		splashVisible.set(true);

		splashTimer = setTimeout(() => {
			isAppReady = true;
		}, 1200); // Length of time we intentionally show the splash on mobile.

		hardFailSafeTimer = setTimeout(() => {
			isAppReady = true;
			shouldShowMobileSplash = false;
			splashVisible.set(false);
		}, 5000); // Absolute ceiling so the UI never remains blocked.

		return () => {
			teardownNavigation?.();
			teardownClientErrorReporting();
			detachViewportListeners?.();
			splashVisible.set(false);
			if (splashTimer) clearTimeout(splashTimer);
			if (hardFailSafeTimer) clearTimeout(hardFailSafeTimer);
		};
	});

	const shouldUseMobileSplash = () => {
		if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

		const match = (query: string) =>
			typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;
		const smallViewport = match('(max-width: 820px)');
		const coarsePointer = match('(pointer: coarse)');
		const touchDevice =
			typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
		const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
			navigator.userAgent
		);

		return smallViewport || (coarsePointer && touchDevice) || mobileUA;
	};
</script>

<svelte:head>
	<meta
		name="viewport"
		content="width=device-width, height=device-height, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no, interactive-widget=resizes-content"
	/>
	<meta name="theme-color" content="#404549" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-title" content="hConnect" />
	<meta name="format-detection" content="telephone=no" />
</svelte:head>

<div class="app-root">
	<div class="app-shell">
		{#if shouldShowMobileSplash}
			<SplashScreen {isAppReady} on:complete={() => { shouldShowMobileSplash = false; splashVisible.set(false); }} />
		{/if}
		<div 
			class="app-shell__stage" 
			data-app-ready={isAppReady}
			style:visibility={shouldShowMobileSplash && !isAppReady ? 'hidden' : 'visible'}
			style:opacity={shouldShowMobileSplash && !isAppReady ? '0' : '1'}
		>
			{@render children?.()}
		</div>
	</div>
	{#if !hideFloatingDock && !shouldShowMobileSplash}
		<FloatingActionDock />
		<TicketFab />
		<ThreadsFab />
		<VoiceDebugFab />
		{#if !isAdminPage}
			<SuperAdminFab />
			<DesktopUserBar />
		{/if}
	{/if}
</div>

<style>
	.app-root {
		flex: 1 1 0%;
		height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
		width: 100%;
	}

	.app-shell {
		flex: 1 1 0%;
		height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
		width: 100%;
		background:
			radial-gradient(circle at 20% -10%, rgba(88, 101, 242, 0.25), transparent 40%),
			radial-gradient(circle at 75% 10%, rgba(51, 200, 191, 0.22), transparent 45%),
			var(--surface-root);
		background-attachment: fixed;
		box-shadow: inset 0 0 35px rgba(0, 0, 0, 0.45);
		color: var(--color-text-primary);
		padding-top: 0;
		padding-right: constant(safe-area-inset-right);
		padding-right: env(safe-area-inset-right);
		padding-bottom: 0;
		padding-left: constant(safe-area-inset-left);
		padding-left: env(safe-area-inset-left);
	}

	/* Mobile: use single flat background to match theme */
	@media (max-width: 932px) {
		.app-shell {
			background: var(--color-panel-muted);
			background-attachment: scroll;
			box-shadow: none;
		}
	}

	@media (min-width: 933px) {
		.app-shell {
			padding-top: constant(safe-area-inset-top);
			padding-top: env(safe-area-inset-top);
			padding-bottom: constant(safe-area-inset-bottom);
			padding-bottom: env(safe-area-inset-bottom);
		}
	}

	.app-shell__stage {
		flex: 1 1 0%;
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
</style>
