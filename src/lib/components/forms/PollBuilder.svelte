<script lang="ts">
  import { preventDefault } from 'svelte/legacy';

  import { createEventDispatcher, onMount } from 'svelte';
  const dispatch = createEventDispatcher();

  let question = $state('');
  let options: string[] = $state(['Option 1', 'Option 2']);

  let qInput: HTMLInputElement | null = $state(null);
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

  const uid = `poll-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div
  class="poll-backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Create poll"
  tabindex="-1"
  onkeydown={onKeydown}
>
  <div class="poll-panel">
    <form onsubmit={preventDefault(create)} class="poll-form">
      <div class="poll-header">
        <h3 class="poll-title">Create a poll</h3>
        <button type="button" class="poll-close" onclick={() => dispatch('close')} aria-label="Close">
          <i class="bx bx-x" aria-hidden="true"></i>
        </button>
      </div>

      <label for="{uid}-question" class="poll-label">Question</label>
      <input
        id="{uid}-question"
        class="input w-full"
        bind:value={question}
        placeholder="What should we build next?"
        bind:this={qInput}
      />

      <fieldset class="poll-options">
        <legend class="poll-label">Options</legend>
        <div class="poll-option-list">
          {#each options as opt, i}
            {#key i}
              <div class="poll-option-row">
                <label class="sr-only" for="{uid}-opt-{i}">Option {i + 1}</label>
                <input
                  id="{uid}-opt-{i}"
                  class="input flex-1"
                  bind:value={options[i]}
                  placeholder={`Option ${i + 1}`}
                />
                <button
                  type="button"
                  class="poll-option-remove"
                  onclick={() => remove(i)}
                  aria-label={`Remove option ${i + 1}`}
                  aria-controls="{uid}-opt-{i}"
                  title="Remove option"
                >
                  <i class="bx bx-x" aria-hidden="true"></i>
                </button>
              </div>
            {/key}
          {/each}
        </div>
      </fieldset>

      <div class="poll-footer">
        <button type="button" class="btn btn-ghost btn-sm" onclick={add}>
          <i class="bx bx-plus" aria-hidden="true"></i>
          Add option
        </button>

        <div class="poll-actions">
          <button type="button" class="btn btn-ghost btn-sm" onclick={() => dispatch('close')}>
            Cancel
          </button>
          <button
            type="submit"
            class="btn btn-primary btn-sm"
            disabled={!question.trim() || options.map((o) => o.trim()).filter(Boolean).length < 2}
          >
            Create poll
          </button>
        </div>
      </div>
    </form>
  </div>
</div>

<style>
  .poll-backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    z-index: 50;
    background: color-mix(in srgb, var(--color-app-overlay) 65%, transparent);
    backdrop-filter: blur(8px);
    padding: 1rem;
  }

  .poll-panel {
    width: min(640px, 100%);
    background: color-mix(in srgb, var(--color-panel) 96%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    border-radius: var(--radius-lg);
    padding: clamp(1rem, 4vw, 1.5rem);
    box-shadow: var(--shadow-elevated);
    color: var(--color-text-primary);
  }

  .poll-form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .poll-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .poll-title {
    font-size: clamp(1.1rem, 3vw, 1.35rem);
    font-weight: 600;
    margin: 0;
  }

  .poll-close {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 75%, transparent);
    background: color-mix(in srgb, var(--color-panel) 85%, transparent);
    color: var(--color-text-primary);
    display: grid;
    place-items: center;
    font-size: 1.3rem;
    transition: background 120ms ease, border 120ms ease;
  }

  .poll-close:hover {
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
  }

  .poll-label {
    font-size: 0.8rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-60);
  }

  .poll-options {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    border: none;
    padding: 0;
    margin: 0;
  }

  .poll-option-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .poll-option-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .poll-option-remove {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    background: color-mix(in srgb, var(--color-panel) 85%, transparent);
    color: var(--text-60);
    display: grid;
    place-items: center;
    transition: background 120ms ease, border 120ms ease;
  }

  .poll-option-remove:hover {
    color: var(--color-text-primary);
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
  }

  .poll-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    padding-top: 0.75rem;
  }

  .poll-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  :global(:root[data-theme='light']) .poll-backdrop {
    background: color-mix(in srgb, var(--color-app-overlay) 55%, transparent);
  }

  :global(:root[data-theme='light']) .poll-panel {
    background: color-mix(in srgb, var(--color-panel) 99%, transparent);
  }
</style>
