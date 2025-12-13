<script lang="ts">
  import { authLoading, authUser } from '$lib/stores/index';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  
  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  onMount(() => {
    // Redirect to home if already authenticated
    if (!$authLoading && $authUser) {
      goto('/');
    }
  });

  $effect(() => {
    if (!$authLoading && $authUser) {
      goto('/');
    }
  });
</script>

<div class="auth-layout">
  <div class="auth-layout__content">
    {@render children?.()}
  </div>
  <div class="auth-layout__safe-area"></div>
</div>

<style>
  .auth-layout {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
    background: radial-gradient(circle at top, rgba(51, 200, 191, 0.25), transparent 55%),
      var(--surface-root);
  }
  
  .auth-layout__content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
  }
  
  /* This fills the bottom safe area with the same background */
  .auth-layout__safe-area {
    flex-shrink: 0;
    height: constant(safe-area-inset-bottom);
    height: env(safe-area-inset-bottom);
    background: var(--surface-root);
  }
</style>

