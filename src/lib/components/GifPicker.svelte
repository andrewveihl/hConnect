<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { browser } from '$app/environment';
  import { PUBLIC_TENOR_API_KEY } from '$env/static/public';

  const dispatch = createEventDispatcher();

  let q = '';
  let gifs: Array<{ url: string; preview: string }> = [];
  let loading = false;
  let errorMsg = '';
  let urlPaste = ''; // fallback if no API key

  async function searchTenor(query: string) {
    if (!browser) return;
    if (!PUBLIC_TENOR_API_KEY) {
      errorMsg = 'No Tenor API key set. Use URL paste below.';
      gifs = [];
      return;
    }
    loading = true;
    errorMsg = '';
    try {
      const p = new URLSearchParams({
        key: PUBLIC_TENOR_API_KEY,
        q: query || 'trending',
        limit: '18',
        media_filter: 'minimal',
        contentfilter: 'high'
      });
      const res = await fetch(`https://tenor.googleapis.com/v2/search?${p.toString()}`);
      const data = await res.json();
      gifs = (data?.results ?? []).map((r: any) => {
        // choose a webp/mp4/gif; fallback to gif
        const u =
          r?.media_formats?.gif?.url ||
          r?.media_formats?.tinygif?.url ||
          r?.media_formats?.nanogif?.url ||
          r?.url;
        const thumb =
          r?.media_formats?.tinygif?.url ||
          r?.media_formats?.nanogif?.url ||
          r?.media_formats?.gif?.url ||
          r?.url;
        return { url: u, preview: thumb };
      });
    } catch (e) {
      errorMsg = 'GIF search failed.';
      gifs = [];
    } finally {
      loading = false;
    }
  }

  // initial trending
  if (browser) searchTenor('');
</script>

<div class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="GIF picker">
  <div class="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#111827]/95 backdrop-blur-xl p-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-lg font-semibold">Add a GIF</h3>
      <button class="rounded-md px-2 py-1 hover:bg-white/10" on:click={() => dispatch('close')} aria-label="Close">✕</button>
    </div>

    <div class="flex gap-2 mb-3">
      <input
        class="input flex-1"
        placeholder="Search Tenor…"
        bind:value={q}
        on:keydown={(e)=>{ if (e.key==='Enter') searchTenor(q); }}
      />
      <button class="px-3 py-2 rounded-md bg-white/10 hover:bg-white/20" on:click={() => searchTenor(q)} disabled={loading}>
        {#if loading}Searching…{:else}Search{/if}
      </button>
    </div>

    {#if errorMsg}
      <div class="text-sm text-red-300 mb-3">{errorMsg}</div>
    {/if}

    <!-- Results -->
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[50vh] overflow-auto pr-1">
      {#each gifs as g}
        <button
          class="group relative rounded-lg overflow-hidden border border-white/10 hover:ring-2 hover:ring-[#5865f2]"
          on:click={() => dispatch('pick', g.url)}
          title="Use this GIF"
        >
          <img src={g.preview} alt="GIF" class="block w-full h-full object-cover" />
          <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20"></div>
        </button>
      {/each}
      {#if !gifs.length && PUBLIC_TENOR_API_KEY}
        <div class="col-span-full text-center text-white/60">No results.</div>
      {/if}
    </div>

    <!-- Fallback URL paste -->
    <div class="mt-4 border-t border-white/10 pt-3">
      <div class="text-sm text-white/70 mb-2">No API key? Paste a GIF URL:</div>
      <div class="flex gap-2">
        <input class="input flex-1" type="url" placeholder="https://media.tenor.com/…gif" bind:value={urlPaste} />
        <button class="px-3 py-2 rounded-md bg-[#5865f2] hover:bg-[#4752c4]" on:click={() => urlPaste.trim() && dispatch('pick', urlPaste.trim())}>
          Add GIF
        </button>
      </div>
    </div>
  </div>
</div>
