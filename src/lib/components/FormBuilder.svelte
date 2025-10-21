<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  const dispatch = createEventDispatcher();

  let title = '';
  let questions: string[] = [''];

  // focus the title when opened
  let titleInput: HTMLInputElement | null = null;
  onMount(() => titleInput?.focus());

  const add = () => (questions = [...questions, '']);
  const remove = (i: number) => {
    if (questions.length > 1) questions = questions.filter((_, idx) => idx !== i);
  };

  const create = () => {
    const t = title.trim();
    const qs = questions.map((q) => q.trim()).filter(Boolean);
    if (!t || !qs.length) return;
    dispatch('create', { title: t, questions: qs });
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      dispatch('close');
    }
  };

  // simple unique id base for inputs
  const uid = `form-${Math.random().toString(36).slice(2, 8)}`;
</script>

<!-- Dialog container -->
<div
  class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
  role="dialog"
  aria-modal="true"
  aria-label="Create form"
  tabindex="-1"
  on:keydown={onKeydown}
>
  <div class="w-full max-w-lg rounded-2xl border border-white/10 bg-[#111827]/95 backdrop-blur-xl p-4">
    <form on:submit|preventDefault={create}>
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-semibold">New question form</h3>
        <button
          type="button"
          class="rounded-md px-2 py-1 hover:bg-white/10"
          on:click={() => dispatch('close')}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <!-- Title -->
      <label for="{uid}-title" class="block text-sm mb-2">Title</label>
      <input
        id="{uid}-title"
        class="input w-full mb-4"
        bind:value={title}
        placeholder="Sprint Retro — Team Alpha"
        bind:this={titleInput}
      />

      <!-- Questions group -->
      <fieldset class="mb-3">
        <legend class="block text-sm mb-2">Questions</legend>

        <div class="space-y-2">
          {#each questions as q, i}
            {#key i}
              <div class="flex items-center gap-2">
                <label class="sr-only" for="{uid}-q-{i}">Question {i + 1}</label>
                <input
                  id="{uid}-q-{i}"
                  class="input flex-1"
                  bind:value={questions[i]}
                  placeholder={`Question ${i + 1}`}
                />
                <button
                  type="button"
                  class="rounded-md px-2 py-2 hover:bg-white/10"
                  on:click={() => remove(i)}
                  aria-label={`Remove question ${i + 1}`}
                  aria-controls="{uid}-q-{i}"
                  title="Remove"
                >
                  −
                </button>
              </div>
            {/key}
          {/each}
        </div>
      </fieldset>

      <div class="flex items-center justify-between">
        <button
          type="button"
          class="rounded-md px-3 py-2 hover:bg-white/10"
          on:click={add}
        >
          ＋ Add question
        </button>

        <div class="flex gap-2">
          <button
            type="button"
            class="rounded-md px-3 py-2 hover:bg-white/10"
            on:click={() => dispatch('close')}
          >
            Cancel
          </button>
          <button
            type="submit"
            class="px-3 py-2 rounded-md bg-[#5865f2] hover:bg-[#4752c4] disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!title.trim() || questions.every((q) => !q.trim())}
          >
            Create form
          </button>
        </div>
      </div>
    </form>
  </div>
</div>
