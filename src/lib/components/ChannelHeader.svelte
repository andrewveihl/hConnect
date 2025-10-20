<script lang="ts">
  export let channel: { id: string; type: 'text'|'voice'; name: string } | null = null;
</script>

<header class="h-12 bg-[#313338] border-b border-black/40 px-4 flex items-center gap-3 text-white">
  {#if channel}
    <div class="text-base font-semibold flex items-center gap-2">
      {#if channel.type === 'text'}<i class="bx bx-hash"></i>{:else}<i class="bx bx-headphone"></i>{/if}
      <span>{channel.name}</span>
    </div>
  {:else}
    <div class="text-base font-semibold">Select a channel</div>
  {/if}
  <div class="ml-auto">
    <input class="input h-8 w-64" placeholder="Search..." />
  </div>
</header>
