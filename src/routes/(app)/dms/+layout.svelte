<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { user } from '$lib/stores/user';

  import LeftPane from '$lib/components/app/LeftPane.svelte';
  import { requestDMNotificationPermission, enableDMNotifications } from '$lib/notify/dms';

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  let stopNotify: (() => void) | null = null;
  let currentPathname = $state(get(page)?.url?.pathname ?? '');
  const showLeftPaneOnMobile = $derived.by(() => currentPathname === '/dms');
  const leftPaneClasses = $derived.by(() =>
    showLeftPaneOnMobile ? 'h-full flex lg:flex' : 'h-full hidden lg:flex'
  );

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

    const unsubPage = page.subscribe(($page) => {
      currentPathname = $page.url.pathname ?? '';
    });

    return () => {
      unsubPage();
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
