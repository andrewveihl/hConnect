<!-- src/routes/(app)/+layout.svelte -->
<script lang="ts">
  import '$lib/stores/theme';
  import { onDestroy, onMount } from 'svelte';
  import { startAuthListener } from '$lib/firebase';
  import { startPresenceService } from '$lib/firebase/presence';
  import { browser } from '$app/environment';
  import { afterNavigate, goto } from '$app/navigation';
  import { registerFirebaseMessagingSW } from '$lib/notify/push';
  import { LAST_LOCATION_STORAGE_KEY, RESUME_DM_SCROLL_KEY } from '$lib/constants/navigation';
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

  let hasAttemptedRestore = false;
  let pendingInitialUrl: URL | null = null;

  const persistLastLocation = (url: URL | null | undefined) => {
    if (!browser || !url) return;
    try {
      const payload = {
        pathname: url.pathname,
        search: url.search,
        hash: url.hash ?? '',
        timestamp: Date.now()
      };
      localStorage.setItem(LAST_LOCATION_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage errors (privacy / safari)
    }
  };

  const readStoredLocation = () => {
    if (!browser) return null;
    try {
      const raw = localStorage.getItem(LAST_LOCATION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed?.pathname === 'string' ? parsed : null;
    } catch {
      return null;
    }
  };

  const fullPath = (loc: { pathname: string; search?: string; hash?: string }) =>
    `${loc.pathname}${loc.search ?? ''}${loc.hash ?? ''}`;

  async function resumeLastLocation() {
    if (!browser) return;
    const stored = readStoredLocation();
    if (!stored?.pathname) return;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const target = fullPath(stored);
    if (window.location.pathname !== '/' || !target || target === current) {
      sessionStorage.removeItem(RESUME_DM_SCROLL_KEY);
      return;
    }
    const isDm = stored.pathname.startsWith('/dms/');
    if (isDm) {
      sessionStorage.setItem(RESUME_DM_SCROLL_KEY, '1');
    } else {
      sessionStorage.removeItem(RESUME_DM_SCROLL_KEY);
    }
    await goto(target, { replaceState: true, noScroll: true, keepfocus: true });
  }

  // Re-assert after every route change (overrides page-level titles) and persist location
  afterNavigate(({ to }) => {
    if (typeof document !== 'undefined') document.title = APP_TITLE;
    if (!browser || !to?.url) return;
    if (!hasAttemptedRestore) {
      pendingInitialUrl = to.url;
      return;
    }
    persistLastLocation(to.url);
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
      resumeLastLocation()
        .catch(() => {})
        .finally(() => {
          hasAttemptedRestore = true;
          if (pendingInitialUrl) {
            persistLastLocation(pendingInitialUrl);
            pendingInitialUrl = null;
          }
        });
    } else {
      hasAttemptedRestore = true;
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
