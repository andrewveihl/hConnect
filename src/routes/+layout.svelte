<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import SplashScreen from '$lib/components/app/SplashScreen.svelte';
  import { initMobileNavigation } from '$lib/stores/mobileNav';
  import FloatingActionDock from '$lib/components/app/FloatingActionDock.svelte';
  import { initClientErrorReporting, teardownClientErrorReporting } from '$lib/telemetry/clientErrors';

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();
  let isAppReady = $state(true); // Default to ready so desktop / SSR never renders the splash.
  let shouldShowMobileSplash = $state(false);
  let splashTimer: ReturnType<typeof setTimeout> | null = null;
  let hardFailSafeTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    const teardownNavigation = initMobileNavigation();
    initClientErrorReporting();
    const isMobile = shouldUseMobileSplash();

    if (!isMobile) {
      isAppReady = true;
      shouldShowMobileSplash = false;
      return () => {};
    }

    shouldShowMobileSplash = true;
    isAppReady = false;

    splashTimer = setTimeout(() => {
      isAppReady = true;
    }, 1200); // Length of time we intentionally show the splash on mobile.

    hardFailSafeTimer = setTimeout(() => {
      isAppReady = true;
      shouldShowMobileSplash = false;
    }, 5000); // Absolute ceiling so the UI never remains blocked.

    return () => {
      teardownNavigation?.();
      teardownClientErrorReporting();
      if (splashTimer) clearTimeout(splashTimer);
      if (hardFailSafeTimer) clearTimeout(hardFailSafeTimer);
    };
  });

  const shouldUseMobileSplash = () => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

    const match = (query: string) => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
    const smallViewport = match('(max-width: 820px)');
    const coarsePointer = match('(pointer: coarse)');
    const touchDevice = typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
    const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );

    return smallViewport || (coarsePointer && touchDevice) || mobileUA;
  };
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#404549" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
</svelte:head>

<div class="app-root">
  <div class="app-shell">
    {#if shouldShowMobileSplash}
      <SplashScreen {isAppReady} on:complete={() => (shouldShowMobileSplash = false)} />
    {/if}
    <div class="app-shell__stage" data-app-ready={isAppReady}>
      {@render children?.()}
    </div>
  </div>
  <FloatingActionDock />
</div>

<style>
  .app-shell {
    min-height: 100vh;
    width: 100%;
    display: flex;
    flex-direction: column;
    background: var(--surface-root);
    color: var(--color-text-primary);
    padding-top: constant(safe-area-inset-top);
    padding-top: env(safe-area-inset-top);
    padding-right: constant(safe-area-inset-right);
    padding-right: env(safe-area-inset-right);
    padding-bottom: constant(safe-area-inset-bottom);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: constant(safe-area-inset-left);
    padding-left: env(safe-area-inset-left);
  }

  .app-shell__stage {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
