<script lang="ts">
  import { goto } from '$app/navigation';
  import { signOutUser } from '$lib/firebase'; // ✅ use existing export

  let busy = false;
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
  class="btn btn-ghost"
  on:click|preventDefault={handleClick}
  disabled={busy}
  aria-busy={busy}
>
  {#if busy}Signing out…{/if}
  {#if !busy}<i class="bx bx-log-out mr-1"></i> Sign out{/if}
</button>
