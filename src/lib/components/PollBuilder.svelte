<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  let question = '';
  let options: string[] = ['Option 1', 'Option 2'];

  const add = () => (options = [...options, `Option ${options.length + 1}`]);
  const remove = (i: number) => { if (options.length > 2) options = options.filter((_, idx) => idx !== i); };
  const create = () => {
    const q = question.trim();
    const opts = options.map(o => o.trim()).filter(Boolean);
    if (!q || opts.length < 2) return;
    dispatch('create', { question: q, options: opts });
  };
</script>

<div class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Create poll">
  <div class="w-full max-w-lg rounded-2xl border border-white/10 bg-[#111827]/95 backdrop-blur-xl p-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-lg font-semibold">Create a poll</h3>
      <button class="rounded-md px-2 py-1 hover:bg-white/10" on:click={() => dispatch('close')} aria-label="Close">✕</button>
    </div>

    <label class="block text-sm mb-2">Question</label>
    <input class="input w-full mb-4" bind:value={question} placeholder="What should we build next?" />

    <label class="block text-sm mb-2">Options</label>
    <div class="space-y-2 mb-3">
      {#each options as opt, i}
        <div class="flex items-center gap-2">
          <input class="input flex-1" bind:value={options[i]} />
          <button class="rounded-md px-2 py-2 hover:bg-white/10" on:click={() => remove(i)} title="Remove" aria-label="Remove">−</button>
        </div>
      {/each}
    </div>

    <div class="flex items-center justify-between">
      <button class="rounded-md px-3 py-2 hover:bg-white/10" on:click={add}>＋ Add option</button>
      <div class="flex gap-2">
        <button class="rounded-md px-3 py-2 hover:bg-white/10" on:click={() => dispatch('close')}>Cancel</button>
        <button
          class="px-3 py-2 rounded-md bg-[#5865f2] hover:bg-[#4752c4]"
          on:click={create}
          disabled={!question.trim() || options.map(o=>o.trim()).filter(Boolean).length < 2}
        >
          Create poll
        </button>
      </div>
    </div>
  </div>
</div>
