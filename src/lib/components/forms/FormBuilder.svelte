<script lang="ts">
  import { preventDefault } from 'svelte/legacy';

  import { createEventDispatcher, onMount } from 'svelte';
  const dispatch = createEventDispatcher();

  let title = $state('');
  let questions: string[] = $state(['']);

  let titleInput: HTMLInputElement | null = $state(null);
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

  const uid = `form-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div
  class="form-backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Create form"
  tabindex="-1"
  onkeydown={onKeydown}
>
  <div class="form-panel">
    <form onsubmit={preventDefault(create)} class="form-builder">
      <div class="form-header">
        <h3 class="form-title">New question form</h3>
        <button type="button" class="form-close" onclick={() => dispatch('close')} aria-label="Close">
          <i class="bx bx-x" aria-hidden="true"></i>
        </button>
      </div>

      <label for="{uid}-title" class="form-label">Title</label>
      <input
        id="{uid}-title"
        class="input w-full"
        bind:value={title}
        placeholder="Sprint Retro – Team Alpha"
        bind:this={titleInput}
      />

      <fieldset class="form-questions">
        <legend class="form-label">Questions</legend>
        <div class="form-question-list">
          {#each questions as q, i}
            {#key i}
              <div class="form-question-row">
                <label class="sr-only" for="{uid}-q-{i}">Question {i + 1}</label>
                <input
                  id="{uid}-q-{i}"
                  class="input flex-1"
                  bind:value={questions[i]}
                  placeholder={`Question ${i + 1}`}
                />
                <button
                  type="button"
                  class="form-question-remove"
                  onclick={() => remove(i)}
                  aria-label={`Remove question ${i + 1}`}
                  aria-controls="{uid}-q-{i}"
                  title="Remove question"
                >
                  <i class="bx bx-x" aria-hidden="true"></i>
                </button>
              </div>
            {/key}
          {/each}
        </div>
      </fieldset>

      <div class="form-footer">
        <button type="button" class="btn btn-ghost btn-sm" onclick={add}>
          <i class="bx bx-plus" aria-hidden="true"></i>
          Add question
        </button>

        <div class="form-actions">
          <button type="button" class="btn btn-ghost btn-sm" onclick={() => dispatch('close')}>
            Cancel
          </button>
          <button
            type="submit"
            class="btn btn-primary btn-sm"
            disabled={!title.trim() || questions.every((q) => !q.trim())}
          >
            Create form
          </button>
        </div>
      </div>
    </form>
  </div>
</div>

<style>
  .form-backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    z-index: 50;
    background: color-mix(in srgb, var(--color-app-overlay) 65%, transparent);
    backdrop-filter: blur(8px);
    padding: 1rem;
  }

  .form-panel {
    width: min(640px, 100%);
    background: color-mix(in srgb, var(--color-panel) 96%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    border-radius: var(--radius-lg);
    padding: clamp(1rem, 4vw, 1.5rem);
    box-shadow: var(--shadow-elevated);
    color: var(--color-text-primary);
  }

  .form-builder {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .form-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .form-title {
    font-size: clamp(1.1rem, 3vw, 1.35rem);
    font-weight: 600;
    margin: 0;
  }

  .form-close {
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

  .form-close:hover {
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
  }

  .form-label {
    font-size: 0.8rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-60);
  }

  .form-questions {
    border: none;
    padding: 0;
    margin: 0;
  }

  .form-question-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 0.6rem;
  }

  .form-question-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .form-question-remove {
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

  .form-question-remove:hover {
    color: var(--color-text-primary);
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
  }

  .form-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    padding-top: 0.75rem;
  }

  .form-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  :global(:root[data-theme='light']) .form-backdrop {
    background: color-mix(in srgb, var(--color-app-overlay) 55%, transparent);
  }

  :global(:root[data-theme='light']) .form-panel {
    background: color-mix(in srgb, var(--color-panel) 99%, transparent);
  }
</style>
