<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { startAuthListener } from '$lib/firebase';
  import { startPresenceService } from '$lib/presence';
  import { browser } from '$app/environment';

  onMount(() => {
    const stopAuth = startAuthListener();
    const stopPresence = startPresenceService();

    if (browser) {
      (window as any).__DEBUG = true;
    }

    return () => {
      stopPresence?.();
      stopAuth?.();
    };
  });
</script>

<!-- Full-screen app surface -->
<div class="min-h-dvh bg-[rgb(3,7,18)] text-white">
  <slot />
</div>
