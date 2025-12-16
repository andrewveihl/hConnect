<script lang="ts">
  import { run } from 'svelte/legacy';

  import { createEventDispatcher, onMount } from 'svelte';
  import { EMOJI, searchEmoji, type EmojiEntry } from '$lib/data/emoji';

  const dispatch = createEventDispatcher();
  const MAX_RESULTS = 160;

  type EmojiCategory = {
    id: string;
    name: string;
    icon: string;
    matcher: (entry: EmojiEntry) => boolean;
  };

  const CATEGORIES: EmojiCategory[] = [
    {
      id: 'all',
      name: 'All emoji',
      icon: '🌐',
      matcher: () => true
    },
    {
      id: 'smileys',
      name: 'Smileys & people',
      icon: '😄',
      matcher: (entry) => {
        const keywords = entry.keywords.map((keyword) => keyword.toLowerCase());
        const isAnimal = keywords.some((keyword) =>
          [
            'animal',
            'pet',
            'cat',
            'dog',
            'bear',
            'rabbit',
            'frog',
            'bird',
            'fish',
            'fox',
            'horse',
            'insect',
            'nature',
            'unicorn',
            'dragon',
            'monster',
            'myth'
          ].some((check) => keyword.includes(check))
        );
        if (isAnimal) return false;
        const nameMatch = /\b(face|smile|laugh|cry|wink|tongue|angry|kiss|people|person|eyes)\b/i.test(entry.name);
        const keywordMatch = keywords.some((keyword) =>
          ['smile', 'laugh', 'cry', 'wink', 'kiss', 'happy', 'sad', 'angry', 'person', 'people', 'face', 'emotion', 'gesture'].some((check) =>
            keyword.includes(check)
          )
        );
        return nameMatch || keywordMatch;
      }
    },
    {
      id: 'hands',
      name: 'Hands & gestures',
      icon: '🤝',
      matcher: (entry) =>
        entry.keywords.some((keyword) => ['hand', 'hands', 'gesture', 'wave', 'thumb'].some((target) => keyword.includes(target)))
    },
    {
      id: 'hearts',
      name: 'Hearts & symbols',
      icon: '💖',
      matcher: (entry) => entry.keywords.some((keyword) => keyword.includes('heart')) || /\bheart\b/i.test(entry.name)
    },
    {
      id: 'animals',
      name: 'Animals & nature',
      icon: '🐾',
      matcher: (entry) =>
        entry.keywords.some((keyword) => ['animal', 'pet', 'nature', 'plant', 'leaf'].some((target) => keyword.includes(target)))
    },
    {
      id: 'food',
      name: 'Food & drink',
      icon: '🍔',
      matcher: (entry) =>
        entry.keywords.some((keyword) => ['food', 'drink', 'snack', 'sweet', 'coffee', 'tea'].some((target) => keyword.includes(target)))
    },
    {
      id: 'objects',
      name: 'Objects & activities',
      icon: '🎮',
      matcher: (entry) =>
        entry.keywords.some((keyword) =>
          ['work', 'music', 'sport', 'object', 'tool', 'game', 'tech', 'device', 'office', 'study'].some((target) =>
            keyword.includes(target)
          )
        )
    }
  ];

  let search = $state('');
  let filtered: EmojiEntry[] = $state(EMOJI);
  let visible: EmojiEntry[] = $state(EMOJI.slice(0, MAX_RESULTS));
  let searchInput: HTMLInputElement | null = $state(null);
  let activeCategory = $state<string>(CATEGORIES[0].id);

  let trimmed = $derived(search.trim());
  run(() => {
    const base = trimmed ? searchEmoji(trimmed) : EMOJI;
    filtered = base.filter((entry) => {
      const category = CATEGORIES.find((cat) => cat.id === activeCategory);
      return category ? category.matcher(entry) : true;
    });
  });

  onMount(() => {
    const frame = requestAnimationFrame(() => searchInput?.focus());
    return () => cancelAnimationFrame(frame);
  });
  run(() => {
    visible = filtered.slice(0, MAX_RESULTS);
  });

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

<svelte:window onkeydown={onKeydown} />

<div class="emoji-panel" role="dialog" aria-label="Emoji picker">
  <div class="emoji-layout">
    <div class="emoji-category-bar" aria-label="Emoji categories">
      {#each CATEGORIES as category}
        <button
          type="button"
          class={`emoji-category ${activeCategory === category.id ? 'is-active' : ''}`}
          title={category.name}
          aria-label={category.name}
          onclick={() => (activeCategory = category.id)}
        >
          <span aria-hidden="true">{category.icon}</span>
        </button>
      {/each}
    </div>
    <div class="emoji-content">
      <div class="emoji-header">
        <div>
      <div class="emoji-title">Emoji</div>
        </div>
        <button class="emoji-close btn btn-ghost btn-sm" type="button" onclick={close} aria-label="Close emoji picker">
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
          bind:this={searchInput}
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
              onclick={() => pick(emoji.char)}
            >
              <span aria-hidden="true">{emoji.char}</span>
            </button>
          {/each}
        </div>
      {:else}
        <p class="emoji-empty">No emoji found. Try a different search.</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .emoji-panel {
    --emoji-cell-size: clamp(44px, 10vw, 54px);
    width: min(420px, 80vw);
    max-height: min(440px, 65vh);
    height: 100%;
    background: color-mix(in srgb, var(--color-panel) 98%, transparent);
    border-radius: 1rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    box-shadow: 0 18px 52px rgba(4, 8, 16, 0.25);
    color: var(--color-text-primary);
    display: flex;
    flex-direction: column;
  }

  .emoji-layout {
    display: flex;
    gap: 0.65rem;
    height: 100%;
    min-height: 0;
  }

  .emoji-category-bar {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.35rem 0.25rem;
    border-right: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
  }

  .emoji-category {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.35rem;
    cursor: pointer;
    transition: background 120ms ease, border 120ms ease, transform 120ms ease;
  }

  .emoji-category.is-active {
    border-color: color-mix(in srgb, var(--color-accent) 80%, transparent);
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
  }

  .emoji-category:not(.is-active):hover,
  .emoji-category:not(.is-active):focus-visible {
    border-color: color-mix(in srgb, var(--color-border-subtle) 75%, transparent);
    background: color-mix(in srgb, var(--color-border-subtle) 25%, transparent);
    outline: none;
    transform: translateY(-1px);
  }

  .emoji-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-left: 0.25rem;
    min-height: 0;
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
    grid-template-columns: repeat(auto-fit, minmax(var(--emoji-cell-size), var(--emoji-cell-size)));
    gap: 0.25rem;
    overflow-y: auto;
    padding: 0.2rem 0.35rem 0.1rem 0;
    scrollbar-width: none;
    -ms-overflow-style: none;
    flex: 1;
    min-height: 0;
    scroll-snap-type: y mandatory;
    justify-content: flex-start;
  }

  .emoji-grid::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }

  .emoji-cell {
    display: grid;
    place-items: center;
    width: var(--emoji-cell-size);
    height: var(--emoji-cell-size);
    padding: 0.2rem;
    border-radius: var(--radius-md);
    font-size: 1.5rem;
    background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    transition: transform 120ms ease, background 120ms ease, border 120ms ease;
    scroll-snap-align: start;
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
      width: min(320px, 92vw);
      height: min(420px, 75vh);
      max-height: min(420px, 75vh);
      --emoji-cell-size: clamp(38px, 12vw, 46px);
    }

    .emoji-layout {
      flex-direction: column;
      gap: 0.35rem;
    }

    .emoji-category-bar {
      flex-direction: row;
      border-right: none;
      border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
      padding-bottom: 0.45rem;
      overflow-x: auto;
      gap: 0.4rem;
    }

    .emoji-category {
      flex: 1;
      min-width: 3rem;
      max-width: 3.2rem;
    }

    .emoji-grid {
      grid-template-columns: repeat(auto-fill, minmax(var(--emoji-cell-size), var(--emoji-cell-size)));
    }
  }

  @media (min-width: 960px) {
    .emoji-panel {
      width: 440px;
      max-height: 480px;
      height: 480px;
      --emoji-cell-size: 54px;
    }
  }
</style>

