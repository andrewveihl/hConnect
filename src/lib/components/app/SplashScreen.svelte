<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fade } from 'svelte/transition';

  interface Props {
    isAppReady?: boolean;
  }

  const GIF_DURATION = 2600; // milliseconds for one loop of the splash GIF

  const dispatch = createEventDispatcher<{ complete: void }>();
  let { isAppReady = false }: Props = $props(); // Props API for runes-mode components.
  let completionTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (!isAppReady) {
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }
      return;
    }

    completionTimer = setTimeout(() => {
      dispatch('complete');
    }, GIF_DURATION);

    return () => {
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }
    };
  });
</script>

{#if !isAppReady}
  <div class="splash-screen" transition:fade={{ duration: 120 }}>
    <img
      src="/HS_splash_reveal.gif"
      alt="Loading hConnect"
      class="splash-screen__gif"
      draggable="false"
    />
    <span class="splash-screen__sr-only" aria-live="polite">Loading</span>
  </div>
{/if}
