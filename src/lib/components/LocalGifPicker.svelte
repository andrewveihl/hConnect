<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  // A tiny built-in gallery you can expand anytime
  const SAMPLES = [
    'https://media.tenor.com/4ZJfCwQ4gT4AAAAC/yes.gif',
    'https://media.tenor.com/VW3sIP4PqL4AAAAC/party-celebrate.gif',
    'https://media.tenor.com/hQH1P2nY2f8AAAAC/clapping-leonardo-dicaprio.gif',
    'https://media.tenor.com/yyH0Z6aQ0bMAAAAC/thumbs-up-okay.gif',
    'https://media.tenor.com/k2r8zCwK8l4AAAAC/dance-happy.gif',
    'https://media.tenor.com/Wv0q7cKJ8_UAAAAC/mind-blown-wow.gif',
    'https://media.tenor.com/Gm7T8m0Bz1oAAAAC/nope-shake-head.gif',
    'https://media.tenor.com/y1b4c0n4n0EAAAAC/loading-wait.gif',
  ];

  let urlPaste = '';
</script>

<div class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="GIF picker">
  <div class="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#111827]/95 backdrop-blur-xl p-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-lg font-semibold">Add a GIF</h3>
      <button class="rounded-md px-2 py-1 hover:bg-white/10" on:click={() => dispatch('close')} aria-label="Close">✕</button>
    </div>

    <div class="text-sm text-white/70 mb-2">Pick one or paste any GIF URL.</div>

    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[50vh] overflow-auto pr-1 mb-4">
      {#each SAMPLES as src}
        <button
          class="group relative rounded-lg overflow-hidden border border-white/10 hover:ring-2 hover:ring-[#5865f2]"
          on:click={() => dispatch('pick', src)}
          title="Use this GIF"
        >
          <img src={src} alt="GIF" class="block w-full h-full object-cover" />
          <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20"></div>
        </button>
      {/each}
    </div>

    <div class="border-t border-white/10 pt-3">
      <div class="text-sm text-white/70 mb-2">Paste a URL:</div>
      <div class="flex gap-2">
        <input class="input flex-1" type="url" placeholder="https://…/your.gif" bind:value={urlPaste} />
        <button
          class="px-3 py-2 rounded-md bg-[#5865f2] hover:bg-[#4752c4]"
          on:click={() => urlPaste.trim() && dispatch('pick', urlPaste.trim())}
        >
          Add GIF
        </button>
      </div>
    </div>
  </div>
</div>
