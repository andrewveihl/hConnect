<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  let title = '';
  let questions: string[] = [''];

  const add = () => (questions = [...questions, '']);
  const remove = (i: number) => { if (questions.length > 1) questions = questions.filter((_, idx) => idx !== i); };
  const create = () => {
    const t = title.trim();
    const qs = questions.map(q => q.trim()).filter(Boolean);
    if (!t || !qs.length) return;
    dispatch('create', { title: t, questions: qs });
  };
</script>

<div class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Create form">
  <div class="w-full max-w-lg rounded-2xl border border-white/10 bg-[#111827]/95 backdrop-blur-xl p-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-lg font-semibold">New question form</h3>
      <button class="rounded-md px-2 py-1 hover:bg-white/10" on:click={() => dispatch('close')} aria-label="Close">✕</button>
    </div>

    <label class="block text-sm mb-2">Title</label>
    <input class="input w-full mb-4" bind:value={title} placeholder="Sprint Retro — Team Alpha" />

    <label class="block text-sm mb-2">Questions</label>
    <div class="space-y-2 mb-3">
      {#each questions as q, i}
        <div class="flex items-center gap-2">
          <input class="input flex-1" bind:value={questions[i]} placeholder={`Question ${i+1}`} />
          <button class="rounded-md px-2 py-2 hover:bg-white/10" on:click={() => remove(i)} title="Remove" aria-label="Remove">−</button>
        </div>
      {/each}
    </div>

    <div class="flex items-center justify-between">
      <button class="rounded-md px-3 py-2 hover:bg-white/10" on:click={add}>＋ Add question</button>
      <div class="flex gap-2">
        <button class="rounded-md px-3 py-2 hover:bg-white/10" on:click={() => dispatch('close')}>Cancel</button>
        <button
          class="px-3 py-2 rounded-md bg-[#5865f2] hover:bg-[#4752c4]"
          on:click={create}
          disabled={!title.trim() || questions.every(q=>!q.trim())}
        >
          Create form
        </button>
      </div>
    </div>
  </div>
</div>
