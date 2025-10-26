<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { startAuthListener } from '$lib/firebase';
  import { startPresenceService } from '$lib/presence';
  import { browser } from '$app/environment';
  import { afterNavigate } from '$app/navigation';
  import { registerFirebaseMessagingSW } from '$lib/notify/push';

  // App name used everywhere (tab title, social tags)
  const APP_TITLE = 'hConnect';

  // Re-assert after every route change (overrides page-level titles)
  afterNavigate(() => {
    if (typeof document !== 'undefined') document.title = APP_TITLE;
  });

  onMount(() => {
    const stopAuth = startAuthListener();
    const stopPresence = startPresenceService();

    if (browser) {
      (window as any).__DEBUG = true;
      // Set once on first client paint
      document.title = APP_TITLE;
      // Best-effort register SW for push/notifications (no permission prompt here)
      registerFirebaseMessagingSW().catch(() => {});
    }

    return () => {
      stopPresence?.();
      stopAuth?.();
    };
  });
</script>

<svelte:head>
  <!-- Default title for initial SSR + hydration -->
  <title>{APP_TITLE}</title>
  <!-- Optional: keep social/SEO cards consistent -->
  <meta property="og:title" content={APP_TITLE} />
  <meta name="twitter:title" content={APP_TITLE} />
</svelte:head>

<!-- Full-screen app surface -->
<div class="min-h-dvh bg-[rgb(3,7,18)] text-white">
  <slot />
</div>
