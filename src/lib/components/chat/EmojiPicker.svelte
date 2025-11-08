<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { EMOJI, searchEmoji, type EmojiEntry } from '$lib/data/emoji';

  const dispatch = createEventDispatcher();
  const MAX_RESULTS = 160;

  let search = '';
  let filtered: EmojiEntry[] = EMOJI;
  let visible: EmojiEntry[] = EMOJI.slice(0, MAX_RESULTS);

  $: trimmed = search.trim();
  $: filtered = trimmed ? searchEmoji(trimmed) : EMOJI;
  $: visible = filtered.slice(0, MAX_RESULTS);

  function close() {
    dispatch('close');
  }

  function pick(symbol: string) {
    dispatch('pick', symbol);
    close();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="emoji-panel" role="dialog" aria-label="Emoji picker">
  <div class="emoji-header">
    <div>
      <div class="emoji-title">Emoji</div>
      <p class="emoji-subtitle">Search and add a reaction</p>
    </div>
    <button class="emoji-close btn btn-ghost btn-sm" type="button" on:click={close} aria-label="Close emoji picker">
      <i class="bx bx-x text-xl" aria-hidden="true"></i>
    </button>
  </div>

  <label class="emoji-search">
    <i class="bx bx-search" aria-hidden="true"></i>
    <input
      type="search"
      placeholder="Search emoji"
      bind:value={search}
      aria-label="Search emoji"
      autofocus
    />
  </label>

  {#if visible.length}
    <div class="emoji-grid" role="list">
      {#each visible as emoji (emoji.char + emoji.name)}
        <button
          type="button"
          class="emoji-cell"
          aria-label={emoji.name}
          title={emoji.name}
          on:click={() => pick(emoji.char)}
        >
          <span aria-hidden="true">{emoji.char}</span>
        </button>
      {/each}
    </div>
  {:else}
    <p class="emoji-empty">No emoji found. Try a different search.</p>
  {/if}
</div>

<style>
  .emoji-panel {
    width: min(320px, 70vw);
    max-height: min(420px, 60vh);
    background: color-mix(in srgb, var(--color-panel) 98%, transparent);
    border-radius: 1rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    box-shadow: 0 18px 52px rgba(4, 8, 16, 0.25);
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    color: var(--color-text-primary);
  }

  .emoji-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .emoji-title {
    font-weight: 600;
    font-size: 1.15rem;
  }

  .emoji-subtitle {
    margin: 0.1rem 0 0;
    font-size: 0.85rem;
    color: var(--color-text-secondary);
  }

  .emoji-close {
    min-width: 2.4rem;
    height: 2.4rem;
    border-radius: var(--radius-pill);
  }

  .emoji-search {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border-radius: var(--radius-lg);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    padding: 0 0.75rem;
  }

  .emoji-search i {
    color: var(--color-text-tertiary);
  }

  .emoji-search input {
    flex: 1;
    border: none;
    background: transparent;
    padding: 0.65rem 0;
    color: inherit;
    font-size: 0.95rem;
  }

  .emoji-search input:focus {
    outline: none;
  }

  .emoji-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
    gap: 0.35rem;
    overflow-y: auto;
    padding: 0.2rem 0 0.1rem;
  }

  .emoji-cell {
    display: grid;
    place-items: center;
    padding: 0.45rem;
    border-radius: var(--radius-md);
    font-size: 1.5rem;
    background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    transition: transform 120ms ease, background 120ms ease, border 120ms ease;
  }

  .emoji-cell:hover,
  .emoji-cell:focus-visible {
    transform: translateY(-2px);
    background: color-mix(in srgb, var(--color-panel-muted) 85%, transparent);
    border-color: var(--color-accent);
    outline: none;
  }

  .emoji-empty {
    text-align: center;
    color: var(--color-text-secondary);
    margin: 2rem 0 1rem;
  }

  @media (max-width: 480px) {
    .emoji-panel {
      width: min(260px, 75vw);
    }
  }
</style>
