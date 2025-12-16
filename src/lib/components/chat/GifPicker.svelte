<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { PUBLIC_TENOR_API_KEY } from '$env/static/public';

  type GifResult = { url: string; preview: string };

  const dispatch = createEventDispatcher();
  const tenorApiKey = PUBLIC_TENOR_API_KEY;

  let q = $state('');
  let gifs: GifResult[] = $state([]);
  let loading = $state(false);
  let errorMsg = $state('');
  let searchTimer: number | null = $state(null);
  let searchInputEl: HTMLInputElement | null = $state(null);

  async function searchTenor(query: string) {
    if (!browser) return;
    if (!tenorApiKey) {
      errorMsg = 'No Tenor API key configured.';
      gifs = [];
      return;
    }
    loading = true;
    errorMsg = '';
    try {
      const endpoint = query?.trim() ? 'search' : 'featured';
      const params = new URLSearchParams({
        key: tenorApiKey,
        limit: '30',
        media_filter: 'minimal',
        contentfilter: 'high'
      });
      if (query?.trim()) {
        params.set('q', query);
      }
      const res = await fetch(`https://tenor.googleapis.com/v2/${endpoint}?${params.toString()}`);
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      gifs = (data?.results ?? []).map((item: any) => {
        const formats = item?.media_formats ?? {};
        const main =
          formats?.gif?.url ??
          formats?.mediumgif?.url ??
          formats?.tinygif?.url ??
          item?.url;
        const preview =
          formats?.tinygif?.url ??
          formats?.nanogif?.url ??
          formats?.gif?.url ??
          item?.url;
        return {
          url: main ?? '',
          preview: preview ?? main ?? ''
        };
      });
    } catch (err) {
      console.error(err);
      gifs = [];
      errorMsg = 'GIF search failed. Please try again.';
    } finally {
      loading = false;
    }
  }

  function handleSearchInput() {
    if (!browser) return;
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    // Instant search as you type with debounce
    searchTimer = window.setTimeout(() => {
      void searchTenor(q);
    }, 250);
  }

  onMount(() => {
    // Load trending on mount and focus search
    searchTenor('');
    setTimeout(() => searchInputEl?.focus(), 100);
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div 
  class="gif-backdrop" 
  role="dialog" 
  aria-modal="true" 
  aria-label="GIF picker"
  tabindex="-1"
  onclick={(e) => e.target === e.currentTarget && dispatch('close')}
  onkeydown={(e) => e.key === 'Escape' && dispatch('close')}
>
  <div class="gif-panel">
    <div class="gif-header">
      <h3 class="gif-title">
        <i class="bx bx-film gif-title-icon" aria-hidden="true"></i>
        Choose a GIF
      </h3>
      <button type="button" class="gif-close" onclick={() => dispatch('close')} aria-label="Close picker">
        <i class="bx bx-x" aria-hidden="true"></i>
      </button>
    </div>

    <div class="gif-search">
      <div class="gif-search-input-wrapper">
        <i class="bx bx-search gif-search-icon" aria-hidden="true"></i>
        <input
          class="gif-search-input"
          placeholder="Search for GIFs..."
          bind:value={q}
          bind:this={searchInputEl}
          oninput={handleSearchInput}
          inputmode="search"
          autocomplete="off"
        />
        {#if loading}
          <div class="gif-search-spinner">
            <i class="bx bx-loader-alt bx-spin" aria-hidden="true"></i>
          </div>
        {:else if q}
          <button type="button" class="gif-search-clear" onclick={() => { q = ''; searchTenor(''); }} aria-label="Clear search">
            <i class="bx bx-x" aria-hidden="true"></i>
          </button>
        {/if}
      </div>
    </div>

    {#if errorMsg}
      <div class="gif-message gif-message--error">
        <i class="bx bx-error-circle" aria-hidden="true"></i>
        {errorMsg}
      </div>
    {/if}

    <div class="gif-grid-scroll" role="list">
      {#if loading && !gifs.length}
        <div class="gif-loading">
          <div class="gif-loading-spinner"></div>
          <span>Finding the perfect GIF...</span>
        </div>
      {:else if gifs.length}
        <div class="gif-grid">
          {#each gifs as gif}
            <button type="button" class="gif-item" onclick={() => dispatch('pick', gif.url)} title="Use this GIF">
              <img src={gif.preview} alt="GIF preview" loading="lazy" />
              <div class="gif-item-overlay">
                <i class="bx bx-plus-circle" aria-hidden="true"></i>
              </div>
            </button>
          {/each}
        </div>
      {:else if tenorApiKey}
        <div class="gif-empty">
          <i class="bx bx-search-alt-2" aria-hidden="true"></i>
          <span>No GIFs found. Try a different search.</span>
        </div>
      {:else}
        <div class="gif-empty">
          <i class="bx bx-key" aria-hidden="true"></i>
          <span>Add a Tenor API key to enable search.</span>
        </div>
      {/if}
    </div>

    <div class="gif-footer">
      <span class="gif-powered">
        <i class="bx bxs-zap" aria-hidden="true"></i>
        Powered by Tenor
      </span>
    </div>
  </div>
</div>

<style>
  .gif-backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--color-app-overlay) 60%, transparent);
    display: grid;
    place-items: center;
    z-index: 500;
    padding: clamp(0.75rem, 4vw, 2rem);
    backdrop-filter: blur(4px);
  }

  .gif-panel {
    width: min(600px, 100%);
    max-height: min(580px, 85vh);
    background: var(--color-panel);
    border-radius: 1.5rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    box-shadow: 
      0 25px 50px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(255, 255, 255, 0.05) inset;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    color: var(--color-text-primary);
    overflow: hidden;
  }

  .gif-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.5rem;
  }

  .gif-title {
    font-size: 1.15rem;
    font-weight: 600;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .gif-title-icon {
    font-size: 1.3rem;
    color: var(--color-accent);
  }

  .gif-close {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
    background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
    color: var(--text-70);
    display: grid;
    place-items: center;
    font-size: 1.25rem;
    transition: all 150ms ease;
  }

  .gif-close:hover {
    background: color-mix(in srgb, var(--color-danger) 15%, transparent);
    border-color: color-mix(in srgb, var(--color-danger) 40%, transparent);
    color: var(--color-danger);
    transform: rotate(90deg);
  }

  .gif-search {
    display: flex;
    gap: 0.5rem;
  }

  .gif-search-input-wrapper {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
  }

  .gif-search-icon {
    position: absolute;
    left: 1rem;
    font-size: 1.15rem;
    color: var(--text-50);
    pointer-events: none;
  }

  .gif-search-input {
    width: 100%;
    height: 2.75rem;
    padding: 0 2.75rem 0 2.75rem;
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    background: color-mix(in srgb, var(--color-panel-muted) 40%, transparent);
    color: var(--color-text-primary);
    font-size: 0.95rem;
    transition: all 150ms ease;
  }

  .gif-search-input::placeholder {
    color: var(--text-40);
  }

  .gif-search-input:focus {
    outline: none;
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-panel-muted) 60%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 20%, transparent);
  }

  .gif-search-spinner,
  .gif-search-clear {
    position: absolute;
    right: 0.75rem;
    width: 1.75rem;
    height: 1.75rem;
    display: grid;
    place-items: center;
    font-size: 1.1rem;
    color: var(--text-50);
  }

  .gif-search-clear {
    border: none;
    background: transparent;
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: all 120ms ease;
  }

  .gif-search-clear:hover {
    background: color-mix(in srgb, var(--color-panel-muted) 80%, transparent);
    color: var(--color-text-primary);
  }

  .gif-grid-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    margin: 0 -0.5rem;
    padding: 0 0.5rem;
    min-height: 200px;
  }

  .gif-message {
    color: var(--text-60);
    font-size: 0.95rem;
    text-align: center;
    padding: 2rem 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .gif-message--error {
    color: var(--color-danger);
    background: color-mix(in srgb, var(--color-danger) 10%, transparent);
    border-radius: var(--radius-md);
    padding: 1rem;
  }

  .gif-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 3rem 1rem;
    color: var(--text-50);
    font-size: 0.9rem;
  }

  .gif-loading-spinner {
    width: 2.5rem;
    height: 2.5rem;
    border: 3px solid color-mix(in srgb, var(--color-accent) 20%, transparent);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: gif-spin 0.8s linear infinite;
  }

  @keyframes gif-spin {
    to { transform: rotate(360deg); }
  }

  .gif-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 3rem 1rem;
    color: var(--text-50);
    font-size: 0.9rem;
    text-align: center;
  }

  .gif-empty i {
    font-size: 2.5rem;
    opacity: 0.5;
  }

  .gif-grid {
    display: grid;
    gap: 0.65rem;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  }

  .gif-item {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--radius-lg);
    overflow: hidden;
    border: 2px solid transparent;
    background: color-mix(in srgb, var(--color-panel-muted) 60%, transparent);
    padding: 0;
    cursor: pointer;
    transition: all 180ms ease;
  }

  .gif-item img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 200ms ease;
  }

  .gif-item-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, 
      color-mix(in srgb, var(--color-accent) 60%, transparent) 0%, 
      color-mix(in srgb, var(--color-accent) 30%, transparent) 100%
    );
    display: grid;
    place-items: center;
    opacity: 0;
    transition: opacity 180ms ease;
  }

  .gif-item-overlay i {
    font-size: 2rem;
    color: white;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
    transform: scale(0.8);
    transition: transform 200ms ease;
  }

  .gif-item:hover,
  .gif-item:focus-visible {
    border-color: var(--color-accent);
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
  }

  .gif-item:hover img,
  .gif-item:focus-visible img {
    transform: scale(1.08);
  }

  .gif-item:hover .gif-item-overlay,
  .gif-item:focus-visible .gif-item-overlay {
    opacity: 1;
  }

  .gif-item:hover .gif-item-overlay i,
  .gif-item:focus-visible .gif-item-overlay i {
    transform: scale(1);
  }

  .gif-item:active {
    transform: translateY(0) scale(0.98);
  }

  .gif-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    padding-top: 0.75rem;
    border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 40%, transparent);
  }

  .gif-powered {
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-40);
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .gif-powered i {
    font-size: 0.85rem;
    color: var(--color-accent);
  }

  /* Mobile styles */
  @media (max-width: 640px) {
    .gif-backdrop {
      padding: 0;
      align-items: flex-end;
    }

    .gif-panel {
      width: 100%;
      max-height: 85vh;
      border-radius: 1.5rem 1.5rem 0 0;
      padding: 1rem;
      padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0));
    }

    .gif-title {
      font-size: 1rem;
    }

    .gif-search-input {
      height: 2.5rem;
      font-size: 16px; /* Prevent iOS zoom */
    }

    .gif-grid {
      grid-template-columns: repeat(3, 1fr);
      gap: 0.5rem;
    }

    .gif-item {
      border-radius: var(--radius-md);
    }

    .gif-grid-scroll {
      min-height: 180px;
    }
  }

  /* Tablet */
  @media (min-width: 641px) and (max-width: 1024px) {
    .gif-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  /* Light theme */
  :global(:root[data-theme-tone='light']) .gif-backdrop {
    background: color-mix(in srgb, var(--color-app-overlay) 40%, transparent);
  }

  :global(:root[data-theme-tone='light']) .gif-panel {
    box-shadow: 
      0 25px 50px rgba(0, 0, 0, 0.2),
      0 0 0 1px rgba(0, 0, 0, 0.05);
  }

  :global(:root[data-theme-tone='light']) .gif-item {
    background: color-mix(in srgb, var(--color-panel-muted) 80%, transparent);
  }
</style>

