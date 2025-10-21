<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  const dispatch = createEventDispatcher();

  let question = '';
  let options: string[] = ['Option 1', 'Option 2'];

  // focus the question input on open
  let qInput: HTMLInputElement | null = null;
  onMount(() => qInput?.focus());

  const add = () => (options = [...options, `Option ${options.length + 1}`]);
  const remove = (i: number) => {
    if (options.length > 2) options = options.filter((_, idx) => idx !== i);
  };

  const create = () => {
    const q = question.trim();
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!q || opts.length < 2) return;
    dispatch('create', { question: q, options: opts });
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      dispatch('close');
    }
  };

  // unique id base for form controls
  const uid = `poll-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div
  class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
  role="dialog"
  aria-modal="true"
  aria-label="Create poll"
  tabindex="-1"
  on:keydown={onKeydown}
>
  <div class="w-full max-w-lg rounded-2xl border border-white/10 bg-[#111827]/95 backdrop-blur-xl p-4">
    <form on:submit|preventDefault={create}>
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-semibold">Create a poll</h3>
        <button
          type="button"
          class="rounded-md px-2 py-1 hover:bg-white/10"
          on:click={() => dispatch('close')}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <!-- Question -->
      <label for="{uid}-question" class="block text-sm mb-2">Question</label>
      <input
        id="{uid}-question"
        class="input w-full mb-4"
        bind:value={question}
        placeholder="What should we build next?"
        bind:this={qInput}
      />

      <!-- Options group -->
      <fieldset class="mb-3">
        <legend class="block text-sm mb-2">Options</legend>
        <div class="space-y-2">
          {#each options as opt, i}
            {#key i}
              <div class="flex items-center gap-2">
                <label class="sr-only" for="{uid}-opt-{i}">Option {i + 1}</label>
                <input
                  id="{uid}-opt-{i}"
                  class="input flex-1"
                  bind:value={options[i]}
                  placeholder={`Option ${i + 1}`}
                />
                <button
                  type="button"
                  class="rounded-md px-2 py-2 hover:bg-white/10"
                  on:click={() => remove(i)}
                  aria-label={`Remove option ${i + 1}`}
                  aria-controls="{uid}-opt-{i}"
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
          ＋ Add option
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
            disabled={!question.trim() || options.map((o) => o.trim()).filter(Boolean).length < 2}
          >
            Create poll
          </button>
        </div>
      </div>
    </form>
  </div>
</div>
