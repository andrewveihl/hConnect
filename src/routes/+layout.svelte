<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import SplashScreen from '$lib/components/app/SplashScreen.svelte';

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();
  let isAppReady = $state(true); // Default to ready so desktop / SSR never renders the splash.
  let shouldShowMobileSplash = $state(false);
  let splashTimer: ReturnType<typeof setTimeout> | null = null;
  let hardFailSafeTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
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
  {#if shouldShowMobileSplash}
    <SplashScreen {isAppReady} on:complete={() => (shouldShowMobileSplash = false)} />
  {/if}
  {@render children?.()}
</div>
