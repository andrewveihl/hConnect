<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { get } from 'svelte/store';

  import { resolveServerSettingsSection } from '$lib/servers/settingsSections';
  import { isMobileViewport } from '$lib/stores/viewport';
  import {
    openServerSettings,
    serverSettingsUI
  } from '$lib/stores/serverSettingsUI';

  export const ssr = false;

  let initialized = $state(false);
  let fallbackPath: string | null = $state(null);

  onMount(() => {
    const serverId = ($page?.params as any)?.serverID ?? null;
    const sectionParam = resolveServerSettingsSection($page?.url?.searchParams?.get('section'));
    fallbackPath = $page?.url?.searchParams?.get('from') ?? (serverId ? `/servers/${serverId}` : '/servers');
    const mobile = get(isMobileViewport);

    openServerSettings({
      serverId,
      section: sectionParam,
      source: 'route',
      returnTo: fallbackPath
    });
    initialized = true;

    if (!mobile && fallbackPath) {
      goto(fallbackPath, { replaceState: true, keepFocus: true, noScroll: true });
    }
  });

  $effect(() => {
    if (!initialized) return;
    if (!$serverSettingsUI.open && fallbackPath && ($page?.url?.pathname ?? '').includes('/settings')) {
      goto(fallbackPath, { replaceState: true, keepFocus: true, noScroll: true });
    }
  });
</script>

<div class="flex min-h-screen items-center justify-center bg-[rgb(3,7,18)] px-4">
  <div class="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-slate-200">
    Opening server settings...
  </div>
</div>
