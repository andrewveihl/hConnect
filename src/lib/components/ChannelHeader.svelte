<script lang="ts">
  export let title = '#general';
  export let showMembersToggle = true;
  export let showMembers = true;
</script>

<header class="h-12 shrink-0 border-b border-white/10 px-3 sm:px-4 bg-black/20 backdrop-blur-xl flex items-center justify-between gap-2">
  <div class="min-w-0 flex items-center gap-3">
    <div class="font-semibold truncate">{title}</div>
    <div class="hidden md:block text-xs text-white/50">|</div>
    <div class="hidden md:block text-xs text-white/60 truncate">Welcome to {title} — be kind, be clear ✨</div>
  </div>

  <div class="flex items-center gap-2">
    <div class="hidden md:flex items-center">
      <input class="rounded-md bg-white/10 border border-white/10 px-2 py-1 text-sm placeholder:text-white/40 outline-none"
             placeholder="Search…" />
    </div>

    {#if showMembersToggle}
      <button
        class="rounded-md bg-white/10 hover:bg-white/15 border border-white/10 px-2 py-1 text-xs"
        on:click={() => showMembers = !showMembers}>
        {showMembers ? 'Hide members' : 'Show members'}
      </button>
    {/if}

    <slot />
  </div>
</header>
