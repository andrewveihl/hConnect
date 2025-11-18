<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  interface Props {
    open: boolean;
    title: string;
    body: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'danger' | 'default';
    busy?: boolean;
  }

  const dispatch = createEventDispatcher<{
    confirm: void;
    cancel: void;
  }>();

  let {
    open = false,
    title = 'Confirm',
    body = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'danger',
    busy = false
  }: Props = $props();

  const handleBackdrop = () => {
    if (busy) return;
    dispatch('cancel');
  };
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={title}>
    <button
      type="button"
      class="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
      aria-label="Dismiss dialog"
      onclick={handleBackdrop}
      onkeydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') handleBackdrop();
      }}
    ></button>
    <div class="relative w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-6 text-slate-900 shadow-2xl">
      <h3 class="text-lg font-semibold text-slate-900">{title}</h3>
      <p class="mt-3 text-sm text-slate-600">{body}</p>
      <div class="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          class="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          onclick={() => dispatch('cancel')}
          disabled={busy}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          class="rounded-full px-5 py-2 text-sm font-semibold text-white shadow-lg transition"
          class:bg-rose-500={tone === 'danger'}
          class:bg-slate-900={tone === 'default'}
          class:opacity-60={busy}
          class:cursor-not-allowed={busy}
          onclick={() => dispatch('confirm')}
          disabled={busy}
        >
          {#if busy}
            <span class="flex items-center gap-2">
              <span class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
              Working...
            </span>
          {:else}
            {confirmLabel}
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
