<script lang="ts">
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/user';

  import LeftPane from '$lib/components/app/LeftPane.svelte';
  import { requestDMNotificationPermission, enableDMNotifications } from '$lib/notify/dms';

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  let stopNotify: (() => void) | null = null;
  const leftPaneClasses = 'h-full hidden lg:flex';

  onMount(() => {
    (async () => {
      try {
        await requestDMNotificationPermission();
      } catch {
        // ignore permission errors
      }
    })();

    const unsubUser = user.subscribe((u) => {
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

<div class="h-dvh app-bg text-primary flex overflow-hidden">
  <div class={leftPaneClasses}>
    <LeftPane activeServerId={null} />
  </div>
  <div class="flex-1 flex flex-col overflow-hidden panel">
    {@render children?.()}
  </div>
</div>
