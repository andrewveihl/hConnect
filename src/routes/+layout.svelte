<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { startAuthListener } from '$lib/firebase';

  onMount(() => {
    const stop = startAuthListener();
    return () => stop?.();
  });

window.__DEBUG = true;

</script>

<!-- Full-screen app surface -->
<div class="min-h-dvh bg-[rgb(3,7,18)] text-white">
  <slot />
</div>
