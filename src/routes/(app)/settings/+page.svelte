<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { get } from 'svelte/store';

  import { LAST_LOCATION_STORAGE_KEY } from '$lib/constants/navigation';
  import { resolveSectionId } from '$lib/settings/sections';
  import { isMobileViewport } from '$lib/stores/viewport';
  import { openSettings, settingsUI } from '$lib/stores/settingsUI';

  let initialized = $state(false);
  let fallbackPath: string | null = $state(null);

  function readStoredPath(): string | null {
    if (!browser) return null;
    try {
      const raw = localStorage.getItem(LAST_LOCATION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.pathname !== 'string') return null;
      return `${parsed.pathname}${parsed.search ?? ''}${parsed.hash ?? ''}`;
    } catch {
      return null;
    }
  }

  onMount(() => {
    const sectionParam = resolveSectionId($page.url.searchParams.get('section'));
    fallbackPath = $page.url.searchParams.get('from') ?? readStoredPath() ?? '/';
    const mobile = get(isMobileViewport);
    openSettings({
      section: sectionParam,
      source: 'route',
      returnTo: fallbackPath
    });
    initialized = true;
    if (!mobile && $page.url.pathname === '/settings' && fallbackPath) {
      goto(fallbackPath, { replaceState: true, keepFocus: true, noScroll: true });
    }
  });

  $effect(() => {
    if (!initialized) return;
    if (!$settingsUI.open && $page.url.pathname === '/settings' && fallbackPath) {
      goto(fallbackPath, { replaceState: true, keepFocus: true, noScroll: true });
    }
  });
</script>

<div class="flex min-h-screen items-center justify-center bg-[rgb(3,7,18)] px-4">
  <div class="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-slate-200">
    Loading settings...
  </div>
</div>
