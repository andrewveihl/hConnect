<script lang="ts">
  export let serverName = 'Server';
  export let channels: { id: string; name: string }[] = [];
  export let activeChannelId: string | null = null;
  export let onPickChannel: (id: string) => void = () => {};
  export let onNewChannel: () => void = () => {};
  export let onInvite: () => void = () => {};
  export let onAdmin: () => void = () => {};
</script>

<aside class="w-72 bg-[#0f1422] flex flex-col min-w-0">
  <div class="h-12 px-3 border-b border-white/10 flex items-center justify-between">
    <div class="font-semibold truncate">{serverName}</div>
    <div class="flex gap-1">
      <button class="rounded-md px-2 py-1 bg-white/10 hover:bg-white/15 text-xs" on:click={onInvite}>Invite</button>
      <button class="rounded-md px-2 py-1 bg-white/10 hover:bg-white/15 text-xs" on:click={onNewChannel}>+ Chan</button>
      <button class="rounded-md px-2 py-1 bg-white/10 hover:bg-white/15 text-xs" on:click={onAdmin}>Admin</button>
    </div>
  </div>

  <div class="p-3">
    <input class="w-full rounded-md bg-white/10 border border-white/10 px-2 py-2 text-sm placeholder:text-white/40 outline-none" placeholder="Search channels…" />
  </div>

  <div class="px-2 pb-3 space-y-1 overflow-y-auto">
    <div class="px-2 pt-2 text-[10px] uppercase tracking-[.12em] text-white/50">Channels</div>
    {#each channels as c}
      <button
        class="w-full text-left rounded-md px-3 py-2 transition
               {activeChannelId === c.id ? 'bg-white/15 text-white' : 'hover:bg-white/10 text-white/90'}"
        on:click={() => onPickChannel(c.id)}>
        # {c.name}
      </button>
    {/each}
  </div>
</aside>
