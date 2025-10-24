<script lang="ts">
  export let channel: { id: string; type: 'text' | 'voice'; name: string } | null = null;
  export let onOpenChannels: (() => void) | null = null;
  export let onOpenMembers: (() => void) | null = null;
</script>

<header class="h-12 bg-[#1e1f24] border-b border-black/40 px-3 sm:px-4 flex items-center gap-3 text-white">
  <div class="flex items-center gap-2 min-w-0">
    <button
      class="md:hidden p-2 -ml-1 rounded-md hover:bg-white/10 active:bg-white/15 transition"
      type="button"
      aria-label="Open channels"
      on:click={() => onOpenChannels?.()}
    >
      <i class="bx bx-menu text-xl"></i>
    </button>
    {#if channel}
      <div class="text-base font-semibold flex items-center gap-2 min-w-0">
        <span class="text-[#9aa4ff]">
          {#if channel.type === 'text'}
            <i class="bx bx-hash"></i>
          {:else}
            <i class="bx bx-headphone"></i>
          {/if}
        </span>
        <span class="truncate max-w-[160px] sm:max-w-none">{channel.name}</span>
      </div>
    {:else}
      <div class="text-base font-semibold">Select a channel</div>
    {/if}
  </div>
  <div class="flex items-center gap-2 ml-auto">
    <button
      class="md:hidden p-2 rounded-md hover:bg-white/10 active:bg-white/15 transition"
      type="button"
      aria-label="Open members"
      on:click={() => onOpenMembers?.()}
    >
      <i class="bx bx-user text-xl"></i>
    </button>
    <div class="hidden sm:flex items-center">
      <input
        class="h-8 w-48 md:w-56 rounded-md bg-white/5 border border-white/10 px-3 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#5865f2]/60"
        placeholder="Search"
      />
    </div>
  </div>
</header>
