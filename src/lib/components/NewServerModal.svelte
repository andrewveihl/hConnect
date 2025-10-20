<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher<{ submit: { name: string; emoji?: string }, close: void }>();

  export let open = false;
  let name = '';
  let emoji = '🎯';
  let creating = false;

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const n = name.trim();
    if (!n || creating) return;
    creating = true;
    try {
      // dispatch is sync; parent does the async work
      dispatch('submit', { name: n, emoji: emoji?.trim() || undefined });
      name = '';
      emoji = '🎯';
      dispatch('close');
    } finally {
      creating = false;
    }
  }
</script>


{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center">
    <div class="absolute inset-0 bg-black/60" on:click={() => dispatch('close')}></div>

    <div class="relative w-[92%] max-w-md rounded-2xl bg-slate-950/90 backdrop-blur-xl border border-white/10 p-5 text-white shadow-2xl">
      <div class="mb-4 flex items-center justify-between">
        <h3 class="text-lg font-semibold">Create a server</h3>
        <button class="rounded-lg px-2 py-1 hover:bg-white/10" on:click={() => dispatch('close')}>✕</button>
      </div>

      <form on:submit={handleSubmit} class="space-y-4">
        <label class="block text-sm">
          <span class="text-white/70">Server name</span>
          <input
            bind:value={name}
            class="mt-1 w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 outline-none focus:border-white/30"
            placeholder="My Team"
            required
          />
        </label>

        <label class="block text-sm">
          <span class="text-white/70">Emoji (optional)</span>
          <input
            bind:value={emoji}
            class="mt-1 w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 outline-none focus:border-white/30"
            placeholder="🎯"
            maxlength="4"
          />
        </label>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" class="rounded-xl px-3 py-2 hover:bg-white/10" on:click={() => dispatch('close')} disabled={creating}>Cancel</button>
          <button type="submit" class="rounded-xl bg-white text-slate-900 px-4 py-2 font-medium hover:bg-white/90 disabled:opacity-60" disabled={creating || !name.trim()}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
