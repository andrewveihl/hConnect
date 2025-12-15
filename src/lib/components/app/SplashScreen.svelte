<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fade } from 'svelte/transition';
  import { customizationConfigStore } from '$lib/admin/customization';

  interface Props {
    isAppReady?: boolean;
  }

  const DEFAULT_GIF_DURATION = 2600; // milliseconds for one loop of the splash GIF
  const DEFAULT_GIF_URL = '/HS_splash_reveal.gif';
  const DEFAULT_BG_COLOR = '#0a0f14';

  const dispatch = createEventDispatcher<{ complete: void }>();
  let { isAppReady = false }: Props = $props();
  let completionTimer: ReturnType<typeof setTimeout> | null = null;

  // Subscribe to global customization for splash settings
  const customization = customizationConfigStore();
  
  // Derive splash settings from config or use defaults
  const splashEnabled = $derived($customization?.splash?.enabled ?? true);
  const gifUrl = $derived($customization?.splash?.gifUrl || DEFAULT_GIF_URL);
  const gifDuration = $derived($customization?.splash?.gifDuration || DEFAULT_GIF_DURATION);
  const backgroundColor = $derived($customization?.splash?.backgroundColor || DEFAULT_BG_COLOR);

  $effect(() => {
    if (!isAppReady) {
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }
      return;
    }

    // If splash is disabled, complete immediately
    if (!splashEnabled) {
      dispatch('complete');
      return;
    }

    completionTimer = setTimeout(() => {
      dispatch('complete');
    }, gifDuration);

    return () => {
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }
    };
  });
</script>

{#if !isAppReady && splashEnabled}
  <div class="splash-screen" style="background-color: {backgroundColor};" transition:fade={{ duration: 120 }}>
    <img
      src={gifUrl}
      alt="Loading hConnect"
      class="splash-screen__gif"
      draggable="false"
    />
    <span class="splash-screen__sr-only" aria-live="polite">Loading</span>
  </div>
{/if}
