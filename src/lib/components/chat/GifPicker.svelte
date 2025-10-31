<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { browser } from '$app/environment';
  import { PUBLIC_TENOR_API_KEY } from '$env/static/public';

  const dispatch = createEventDispatcher();

  let q = '';
  let gifs: Array<{ url: string; preview: string }> = [];
  let loading = false;
  let errorMsg = '';
  let urlPaste = '';

  async function searchTenor(query: string) {
    if (!browser) return;
    if (!PUBLIC_TENOR_API_KEY) {
      errorMsg = 'No Tenor API key set. Paste a URL below instead.';
      gifs = [];
      return;
    }
    loading = true;
    errorMsg = '';
    try {
      const params = new URLSearchParams({
        key: PUBLIC_TENOR_API_KEY,
        q: query || 'trending',
        limit: '24',
        media_filter: 'minimal',
        contentfilter: 'high'
      });
      const res = await fetch(`https://tenor.googleapis.com/v2/search?${params.toString()}`);
      const data = await res.json();
      gifs = (data?.results ?? []).map((r: any) => {
        const variants = r?.media_formats ?? {};
        const gifUrl =
          variants?.gif?.url ||
          variants?.tinygif?.url ||
          variants?.nanogif?.url ||
          r?.url;
        const previewUrl =
          variants?.tinygif?.url ||
          variants?.nanogif?.url ||
          variants?.gif?.url ||
          r?.url;
        return { url: gifUrl, preview: previewUrl };
      });
    } catch (err) {
      console.error(err);
      errorMsg = 'GIF search failed. Try again or paste a link below.';
      gifs = [];
    } finally {
      loading = false;
    }
  }

  if (browser) searchTenor('');
</script>
<div class="gif-backdrop" role="dialog" aria-modal="true" aria-label="GIF picker">
  <div class="gif-panel">
    <div class="gif-header">
      <h3 class="gif-title">Add a GIF</h3>
      <button type="button" class="gif-close" on:click={() => dispatch('close')} aria-label="Close picker">
        <i class="bx bx-x" aria-hidden="true"></i>
      </button>
    </div>

    <form class="gif-search" on:submit|preventDefault={() => searchTenor(q)}>
      <input
        class="input flex-1 min-w-[200px]"
        placeholder="Search Tenor…"
        bind:value={q}
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
          {#each gifs as g}
            <button
              type="button"
              class="gif-item"
              on:click={() => dispatch('pick', g.url)}
              title="Use this GIF"
            >
              <img src={g.preview} alt="GIF preview" loading="lazy" />
            </button>
          {/each}
        </div>
      {:else if PUBLIC_TENOR_API_KEY}
        <div class="gif-message">No results. Try another search term.</div>
      {:else}
        <div class="gif-message">Add a Tenor API key to enable search.</div>
      {/if}
    </div>

    <div class="gif-footer">
      <label class="gif-footer-label" for="gif-url">Paste a URL</label>
      <div class="gif-url-row">
        <input
          id="gif-url"
          class="input flex-1 min-w-[200px]"
          type="url"
          inputmode="url"
          placeholder="https://media.tenor.com/your.gif"
          bind:value={urlPaste}
        />
        <button
          type="button"
          class="btn btn-primary btn-sm min-w-[110px]"
          on:click={() => urlPaste.trim() && dispatch('pick', urlPaste.trim())}
          disabled={!urlPaste.trim()}
        >
          Add GIF
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .gif-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    flex-direction: column;
    background: color-mix(in srgb, var(--color-app-overlay) 65%, transparent);
    backdrop-filter: blur(8px);
    padding: 1rem;
    padding-top: calc(env(safe-area-inset-top, 1rem) + 0.5rem);
    padding-bottom: calc(env(safe-area-inset-bottom, 1rem) + 0.75rem);
  }

  @media (min-width: 640px) {
    .gif-backdrop {
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
    }
  }

  .gif-panel {
    width: 100%;
    max-width: 680px;
    background: color-mix(in srgb, var(--color-panel) 96%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    border-radius: clamp(1rem, 2vw, 1.5rem);
    padding: clamp(1rem, 4vw, 1.5rem);
    display: flex;
    flex-direction: column;
    min-height: min(620px, 100%);
    max-height: 100%;
    box-shadow: var(--shadow-elevated);
    color: var(--color-text-primary);
  }

  .gif-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .gif-title {
    font-size: clamp(1.15rem, 4vw, 1.35rem);
    font-weight: 600;
    margin: 0;
  }

  .gif-close {
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

  .gif-close:hover {
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
  }

  .gif-search {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-bottom: 1.25rem;
  }

  .gif-grid-scroll {
    flex: 1;
    overflow-y: auto;
    margin: 0 -0.35rem 1.25rem 0;
    padding-right: 0.35rem;
  }

  .gif-message {
    color: var(--text-60);
    font-size: 0.95rem;
    text-align: center;
    padding: 1.5rem 0.5rem;
  }

  .gif-message--error {
    color: color-mix(in srgb, var(--color-danger) 75%, white);
  }

  .gif-grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }

  @media (max-width: 480px) {
    .gif-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .gif-item {
    position: relative;
    border-radius: var(--radius-md);
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
    background: color-mix(in srgb, var(--color-panel) 88%, transparent);
    padding: 0;
  }

  .gif-item img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.2s ease;
  }

  .gif-item::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, transparent 0%, color-mix(in srgb, var(--color-accent) 40%, transparent) 100%);
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .gif-item:active img,
  .gif-item:focus-visible img,
  .gif-item:hover img {
    transform: scale(1.03);
  }

  .gif-item:active::after,
  .gif-item:focus-visible::after,
  .gif-item:hover::after {
    opacity: 1;
  }

  .gif-footer {
    border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    padding-top: 1rem;
    margin-top: auto;
  }

  .gif-footer-label {
    display: block;
    font-size: 0.75rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-60);
    margin-bottom: 0.6rem;
  }

  .gif-url-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  :global(:root[data-theme='light']) .gif-backdrop {
    background: color-mix(in srgb, var(--color-app-overlay) 55%, transparent);
  }

  :global(:root[data-theme='light']) .gif-panel {
    background: color-mix(in srgb, var(--color-panel) 99%, transparent);
  }

  :global(:root[data-theme='light']) .gif-item {
    background: color-mix(in srgb, var(--color-panel) 96%, transparent);
  }
</style>


