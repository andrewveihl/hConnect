<script lang="ts">
  import { preventDefault } from 'svelte/legacy';
  import { createEventDispatcher } from 'svelte';
  import { browser } from '$app/environment';
  import { PUBLIC_TENOR_API_KEY } from '$env/static/public';

  type GifResult = { url: string; preview: string };

  const dispatch = createEventDispatcher();
  const tenorApiKey = PUBLIC_TENOR_API_KEY;

  let q = $state('');
  let gifs: GifResult[] = $state([]);
  let loading = $state(false);
  let errorMsg = $state('');
  let urlPaste = $state('');
  let searchTimer: number | null = $state(null);

  async function searchTenor(query: string) {
    if (!browser) return;
    if (!tenorApiKey) {
      errorMsg = 'No Tenor API key configured. Paste a URL instead.';
      gifs = [];
      return;
    }
    loading = true;
    errorMsg = '';
    try {
      const params = new URLSearchParams({
        key: tenorApiKey,
        q: query?.trim() ? query : 'trending',
        limit: '24',
        media_filter: 'minimal',
        contentfilter: 'high'
      });
      const res = await fetch(`https://tenor.googleapis.com/v2/search?${params.toString()}`);
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

  function scheduleSearch(query: string) {
    if (!browser) return;
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    searchTimer = window.setTimeout(() => {
      void searchTenor(query);
    }, 350);
  }

  function handleUrlPick() {
    const trimmed = urlPaste.trim();
    if (!trimmed) return;
    dispatch('pick', trimmed);
    urlPaste = '';
  }

  if (browser) {
    searchTenor('');
  }
</script>

<div class="gif-backdrop" role="dialog" aria-modal="true" aria-label="GIF picker">
  <div class="gif-panel">
    <div class="gif-header">
      <h3 class="gif-title">Add a GIF</h3>
      <button type="button" class="gif-close" onclick={() => dispatch('close')} aria-label="Close picker">
        <i class="bx bx-x" aria-hidden="true"></i>
      </button>
    </div>

    <form class="gif-search" onsubmit={preventDefault(() => searchTenor(q))}>
      <input
        class="input flex-1 min-w-[200px]"
        placeholder="Search Tenor"
        bind:value={q}
        oninput={() => scheduleSearch(q)}
        inputmode="search"
        autocomplete="off"
      />
      <button type="submit" class="btn btn-primary btn-sm" disabled={loading}>
        {#if loading}
          Searching…
        {:else}
          Search
        {/if}
      </button>
    </form>

    {#if errorMsg}
      <div class="gif-message gif-message--error">{errorMsg}</div>
    {/if}

    <div class="gif-grid-scroll" role="list">
      {#if loading && !gifs.length}
        <div class="gif-message">Fetching GIFs…</div>
      {:else if gifs.length}
        <div class="gif-grid">
          {#each gifs as gif}
            <button type="button" class="gif-item" onclick={() => dispatch('pick', gif.url)} title="Use this GIF">
              <img src={gif.preview} alt="GIF preview" loading="lazy" />
            </button>
          {/each}
        </div>
      {:else if tenorApiKey}
        <div class="gif-message">No results. Try another search term.</div>
      {:else}
        <div class="gif-message">Add a Tenor API key to enable search.</div>
      {/if}
    </div>

    <div class="gif-footer">
      <label class="gif-footer-label" for="gif-url">Paste a GIF URL</label>
      <div class="gif-url-row">
        <input
          id="gif-url"
          class="input flex-1 min-w-[200px]"
          type="url"
          inputmode="url"
          placeholder="https://media.tenor.com/your.gif"
          bind:value={urlPaste}
        />
        <button type="button" class="btn btn-primary btn-sm min-w-[110px]" onclick={handleUrlPick}>Insert</button>
      </div>
    </div>
  </div>
</div>

<style>
  .gif-backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--color-app-overlay) 50%, transparent);
    display: grid;
    place-items: center;
    z-index: 500;
    padding: clamp(0.5rem, 3vw, 1.5rem);
  }

  .gif-panel {
    width: min(720px, 95vw);
    max-height: min(640px, 90vh);
    background: color-mix(in srgb, var(--color-panel) 98%, transparent);
    border-radius: 1.25rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    box-shadow: 0 20px 60px rgba(6, 10, 18, 0.55);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    color: var(--color-text-primary);
  }

  .gif-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .gif-title {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
  }

  .gif-close {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    background: color-mix(in srgb, var(--color-panel) 90%, transparent);
    color: inherit;
    display: grid;
    place-items: center;
    transition: background 120ms ease, border 120ms ease, transform 120ms ease;
  }

  .gif-close:hover {
    background: color-mix(in srgb, var(--color-panel) 96%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
    transform: translateY(-1px);
  }

  .gif-search {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-wrap: wrap;
  }

  .gif-grid-scroll {
    flex: 1;
    overflow-y: auto;
    margin: 0 -0.4rem 1rem 0;
    padding-right: 0.4rem;
  }

  .gif-message {
    color: var(--text-60);
    font-size: 0.95rem;
    text-align: center;
    padding: 1.5rem 0.5rem;
  }

  .gif-message--error {
    color: color-mix(in srgb, var(--color-danger) 80%, white);
  }

  .gif-grid {
    display: grid;
    gap: 0.85rem;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }

  @media (max-width: 640px) {
    .gif-panel {
      width: min(520px, 95vw);
      padding: 1rem;
    }

    .gif-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .gif-item {
    position: relative;
    border-radius: var(--radius-lg);
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 75%, transparent);
    background: color-mix(in srgb, var(--color-panel) 90%, transparent);
    padding: 0;
    cursor: pointer;
  }

  .gif-item img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 160ms ease;
  }

  .gif-item::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, transparent 0%, color-mix(in srgb, var(--color-accent) 40%, transparent) 100%);
    opacity: 0;
    transition: opacity 160ms ease;
  }

  .gif-item:hover img,
  .gif-item:focus-visible img {
    transform: scale(1.04);
  }

  .gif-item:hover::after,
  .gif-item:focus-visible::after {
    opacity: 0.35;
  }

  .gif-footer {
    border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    padding-top: 1rem;
    margin-top: auto;
  }

  .gif-footer-label {
    font-size: 0.75rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-60);
    margin-bottom: 0.65rem;
    display: block;
  }

  .gif-url-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-wrap: wrap;
  }

  :global(:root[data-theme-tone='light']) .gif-backdrop {
    background: color-mix(in srgb, var(--color-app-overlay) 35%, transparent);
  }

  :global(:root[data-theme-tone='light']) .gif-panel {
    background: color-mix(in srgb, var(--color-panel) 99%, transparent);
  }

  :global(:root[data-theme-tone='light']) .gif-item {
    background: color-mix(in srgb, var(--color-panel) 95%, transparent);
  }
</style>

