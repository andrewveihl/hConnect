<script lang="ts">
  import { createServer } from '$lib/db/servers';
  import { user } from '$lib/stores/user';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';

  export let open = false;
  export let onClose: () => void = () => {};

  let name = '';
  let isPublic = true;
  let busy = false;

  function close() {
    // keep your onClose behavior; also reflect local state
    open = false;
    onClose();
  }

  // ✅ fixed syntax (kept)
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) close();
  };

  onMount(() => {
    window.addEventListener('keydown', handleKey);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKey);
  });

  async function submit() {
    if (busy) return;
    const owner = $user?.uid;
    if (!name.trim() || !owner) return;

    try {
      busy = true;
      // ⬇️ unchanged shape; matches your server.ts signature
      const serverId = await createServer(owner, {
        name: name.trim(),
        isPublic,
        icon: null
      });

      close();
      await goto(`/servers/${serverId}`);
    } finally {
      busy = false;
    }
  }
</script>

{#if open}
  <div class="fixed inset-0 z-50">
    <!-- Accessible backdrop -->
    <button
      type="button"
      class="absolute inset-0 w-full h-full bg-black/60"
      aria-label="Close modal"
      on:click={close}
    ></button>

    <!-- Centered modal panel -->
    <div class="absolute inset-0 grid place-items-center p-4">
      <div
        class="relative z-10 bg-[#2b2d31] text-white  shadow-xl w-full max-w-md p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-server-title"
      >
        <h2 id="create-server-title" class="text-xl font-semibold mb-4">Create a server</h2>

        <div class="space-y-4">
          <input
            class="input"
            placeholder="Server name"
            bind:value={name}
            on:keydown={(e) => (e.key === 'Enter' ? submit() : null)}
          />

          <div class="flex items-center gap-4 text-sm">
            <label class="flex items-center gap-2">
              <input type="radio" name="vis" checked={isPublic} on:change={() => (isPublic = true)} />
              <span>Public</span>
            </label>
            <label class="flex items-center gap-2">
              <input type="radio" name="vis" checked={!isPublic} on:change={() => (isPublic = false)} />
              <span>Private (invite only)</span>
            </label>
          </div>

          <div class="flex gap-2">
            <button type="button" class="btn btn-ghost flex-1" on:click={close} disabled={busy}>Cancel</button>
            <button
              type="button"
              class="btn btn-primary flex-1 disabled:opacity-50"
              on:click={submit}
              disabled={busy || !name.trim() || !$user}
            >
              {#if busy}Creating…{:else}Create{/if}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}



