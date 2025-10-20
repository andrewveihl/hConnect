<script lang="ts">
  export let servers: { id: string; name: string; emoji?: string|null }[] = [];
  export let activeId: string | null = null;
  export let onCreateServer: () => void = () => {};
  export let onPickServer: (id: string) => void = () => {};
  export let onOpenDMs: () => void = () => {};
</script>

<aside class="w-[72px] h-full bg-[#0b0f1a] border-r border-white/10 flex flex-col items-center py-3 gap-3">
  <button type="button" class="relative h-12 w-12 rounded-2xl grid place-items-center border border-white/10 bg-white/10 hover:bg-white/15"
    on:click={onOpenDMs} title="Direct Messages" aria-label="Open direct messages">
    <svg viewBox="0 0 24 24" class="h-6 w-6" fill="currentColor" aria-hidden="true">
      <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-5.33 0-8 2.667-8 4v2h16v-2c0-1.333-2.67-4-8-4Z"/>
    </svg>
  </button>

  <div class="w-10 h-px bg-white/10" aria-hidden="true"></div>

  {#each servers as s}
    <button
      type="button"
      class="relative h-12 w-12 rounded-2xl grid place-items-center border border-white/10 transition
             {activeId === s.id ? 'bg-white text-slate-900 shadow-lg' : 'bg-white/10 hover:bg-white/15'}"
      on:click={() => onPickServer(s.id)}
      title={s.name}
      aria-label={`Open server ${s.name}`}
    >
      {#if activeId === s.id}
        <span class="absolute -left-2 h-7 w-1.5 rounded-full bg-white/90" aria-hidden="true"></span>
      {/if}
      <span class="text-lg" aria-hidden="true">{s.emoji || s.name.slice(0,1).toUpperCase()}</span>
    </button>
  {/each}

  <div class="mt-auto" aria-hidden="true"></div>

  <button type="button" class="h-12 w-12 rounded-2xl border border-emerald-400/40 bg-emerald-500/20 hover:bg-emerald-500/30 grid place-items-center"
    title="Create server" aria-label="Create server" on:click={onCreateServer}>
    <span class="text-2xl leading-none">+</span>
  </button>
</aside>
