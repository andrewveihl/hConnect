<!-- src/routes/(app)/+layout.svelte -->
<script lang="ts">
  import '$lib/stores/theme';
  import { onDestroy, onMount } from 'svelte';
  import { startAuthListener } from '$lib/firebase';
  import { startPresenceService } from '$lib/firebase/presence';
  import { browser } from '$app/environment';
  import { afterNavigate } from '$app/navigation';
  import { registerFirebaseMessagingSW } from '$lib/notify/push';
  import VoiceMiniPanel from '$lib/components/voice/VoiceMiniPanel.svelte';
  import MobileDock from '$lib/components/app/MobileDock.svelte';
  import { voiceSession } from '$lib/stores/voice';
  import type { VoiceSession } from '$lib/stores/voice';

  // App name used everywhere (tab title, social tags)
  const APP_TITLE = 'hConnect';

  let activeVoice: VoiceSession | null = null;
  const stopVoice = voiceSession.subscribe((value) => {
    activeVoice = value;
  });

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

  onDestroy(() => {
    stopVoice?.();
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
<div class="app-shell has-mobile-dock app-bg">
  <div class="app-shell__body">
    <slot />
  </div>

  <MobileDock />

  {#if activeVoice && !activeVoice.visible}
    <div
      class="voice-mini-fab pointer-events-none fixed left-0 right-0 z-40 flex justify-center px-4"
      style:bottom="calc(var(--mobile-dock-height, 0px) + 1rem + env(safe-area-inset-bottom, 0px))"
    >
      <div class="pointer-events-auto w-full max-w-lg">
        <VoiceMiniPanel serverId={activeVoice.serverId} session={activeVoice} />
      </div>
    </div>
  {/if}
</div>
