<script lang="ts">
  // Placeholder until you wire real members
  const members = Array.from({ length: 8 }).map((_, i) => ({ id: i, name: `Member ${i+1}` }));
</script>

<aside class="w-[260px] h-full bg-[#0f1422] border-l border-white/10 flex flex-col">
  <div class="h-12 px-3 border-b border-white/10 flex items-center">
    <div class="font-semibold">Members</div>
  </div>
  <div class="flex-1 overflow-y-auto p-2 space-y-1">
    {#each members as m}
      <div class="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-white/10">
        <div class="h-7 w-7 rounded-full bg-white/10 border border-white/10 grid place-items-center text-[10px]">{m.name.slice(0,2).toUpperCase()}</div>
        <div class="truncate">{m.name}</div>
      </div>
    {/each}
  </div>
</aside>
