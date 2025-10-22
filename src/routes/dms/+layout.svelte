<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/user';

  import LeftPane from '$lib/components/LeftPane.svelte';
  import DMsSidebar from '$lib/components/DMsSidebar.svelte';

  // Notifications helpers (make sure the file below exists)
  import { requestDMNotificationPermission, enableDMNotifications } from '$lib/notify/dms';

  const servers: any[] = [];
  $: activeThreadId = $page.params.threadID ?? null;

  let stopNotify: (() => void) | null = null;

  onMount(async () => {
    // ask once; ignored if unsupported or already granted/denied
    try { await requestDMNotificationPermission(); } catch {}

    const unsubUser = user.subscribe((u) => {
      // rewire per-auth change
      stopNotify?.();
      if (u?.uid) stopNotify = enableDMNotifications(u.uid);
      else stopNotify = null;
    });

    return () => {
      unsubUser();
      stopNotify?.();
    };
  });
</script>

<div class="min-h-[100dvh] bg-[#0b1220] text-white flex">
  <LeftPane {servers} activeId={null} />
  <DMsSidebar {activeThreadId} />
  <section class="flex-1 flex flex-col">
    <slot />
  </section>
</div>
