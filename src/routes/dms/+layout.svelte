<script lang="ts">
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/user';

  import LeftPane from '$lib/components/LeftPane.svelte';

  // Notifications helpers (make sure the file below exists)
  import { requestDMNotificationPermission, enableDMNotifications } from '$lib/notify/dms';

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

<div class="h-dvh bg-[#0b111b] text-white flex overflow-hidden">
  <LeftPane activeServerId={null} />
  <div class="flex-1 flex flex-col overflow-hidden">
    <slot />
  </div>
</div>
