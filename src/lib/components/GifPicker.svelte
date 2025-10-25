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
        ×
      </button>
    </div>

    <form
      class="gif-search"
      on:submit|preventDefault={() => searchTenor(q)}
    >
      <input
        class="gif-search-input"
        placeholder="Search Tenor…"
        bind:value={q}
        inputmode="search"
        autocomplete="off"
      />
      <button type="submit" class="gif-search-btn" disabled={loading}>
        {#if loading}
          Searching…
        {:else}
          Search
        {/if}
      </button>
    </form>

    {#if errorMsg}
      <div class="gif-error">{errorMsg}</div>
    {/if}

    <div class="gif-grid-scroll" role="list">
      {#if loading && !gifs.length}
        <div class="gif-loading">Fetching GIFs…</div>
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
        <div class="gif-empty-state">No results. Try another search term.</div>
      {:else}
        <div class="gif-empty-state">Add a Tenor API key to enable search.</div>
      {/if}
    </div>

    <div class="gif-footer">
      <label class="gif-footer-label" for="gif-url">Paste a URL</label>
      <div class="gif-url-row">
        <input
          id="gif-url"
          class="gif-url-input"
          type="url"
          inputmode="url"
          placeholder="https://media.tenor.com/your.gif"
          bind:value={urlPaste}
        />
        <button
          type="button"
          class="gif-add-btn"
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
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(6px);
    padding: 1rem;
    padding-top: calc(env(safe-area-inset-top, 1rem) + 0.5rem);
    padding-bottom: calc(env(safe-area-inset-bottom, 1rem) + 0.75rem);
    overflow: hidden;
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
    max-width: 640px;
    background: rgba(17, 24, 39, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: clamp(1rem, 2vw, 1.5rem);
    padding: clamp(1rem, 4vw, 1.5rem);
    display: flex;
    flex-direction: column;
    min-height: min(640px, 100%);
    max-height: 100%;
    box-shadow: 0 30px 60px rgba(0, 0, 0, 0.35);
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
    color: #fff;
    margin: 0;
  }

  .gif-close {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 9999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    font-size: 1.4rem;
    line-height: 1;
    display: grid;
    place-items: center;
  }

  .gif-close:active,
  .gif-close:focus-visible,
  .gif-close:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  .gif-search {
    display: flex;
    gap: 0.65rem;
    margin-bottom: 0.75rem;
    flex-wrap: wrap;
  }

  .gif-search-input {
    flex: 1 1 220px;
    min-width: 0;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(17, 20, 30, 0.9);
    padding: 0.65rem 0.85rem;
    color: #fff;
    font-size: 0.95rem;
  }

  .gif-search-input::placeholder {
    color: rgba(255, 255, 255, 0.35);
  }

  .gif-search-btn {
    border-radius: 0.75rem;
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    font-weight: 600;
    padding: 0.65rem 1.1rem;
  }

  .gif-search-btn:active,
  .gif-search-btn:focus-visible,
  .gif-search-btn:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .gif-search-btn:disabled {
    opacity: 0.5;
    cursor: progress;
  }

  .gif-subtitle {
    color: rgba(255, 255, 255, 0.68);
    font-size: 0.95rem;
    margin: 0 0 1.1rem 0;
  }

  .gif-error {
    color: #fca5a5;
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
  }

  .gif-grid-scroll {
    flex: 1;
    overflow-y: auto;
    margin: 0 -0.35rem 1.25rem 0;
    padding-right: 0.35rem;
  }

  .gif-loading,
  .gif-empty-state {
    color: rgba(255, 255, 255, 0.65);
    font-size: 0.95rem;
    text-align: center;
    padding: 1.5rem 0.5rem;
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
    border-radius: 0.9rem;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.02);
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
    background: linear-gradient(135deg, rgba(88, 101, 242, 0) 0%, rgba(88, 101, 242, 0.25) 100%);
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
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 1rem;
    margin-top: auto;
  }

  .gif-footer-label {
    display: block;
    font-size: 0.85rem;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.55);
    margin-bottom: 0.6rem;
  }

  .gif-url-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  .gif-url-input {
    flex: 1 1 200px;
    min-width: 0;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(17, 20, 30, 0.9);
    padding: 0.65rem 0.85rem;
    color: #fff;
    font-size: 0.95rem;
  }

  .gif-url-input::placeholder {
    color: rgba(255, 255, 255, 0.35);
  }

  .gif-add-btn {
    flex: 0 0 auto;
    border-radius: 0.75rem;
    background: #5865f2;
    color: #fff;
    font-weight: 600;
    padding: 0.65rem 1.15rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 110px;
  }

  .gif-add-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .gif-add-btn:active,
  .gif-add-btn:focus-visible,
  .gif-add-btn:hover {
    background: #4752c4;
  }
</style>
