<script lang="ts">
  import { preventDefault } from 'svelte/legacy';

  import { goto } from '$app/navigation';
  import { signOutUser } from '$lib/firebase'; // ✅ use existing export

  let busy = $state(false);
  async function handleClick() {
    try {
      busy = true;
      await signOutUser();
      goto('/sign-in');
    } finally {
      busy = false;
    }
  }
</script>

<button
  class="inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] px-3 py-1 text-sm font-medium text-[color:var(--color-text-primary)] transition hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-panel)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
  onclick={preventDefault(handleClick)}
  disabled={busy}
  aria-busy={busy}
>
  {#if busy}
    <span class="flex items-center gap-2"><i class="bx bx-log-out"></i> Signing out...</span>
  {:else}
    <span class="flex items-center gap-2"><i class="bx bx-log-out"></i> Sign out</span>
  {/if}
</button>
