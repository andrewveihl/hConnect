<script lang="ts">
  export let items: { id: string; authorUid: string; text: string; createdAt?: any }[] = [];
  const avatar = (uid: string) => uid?.slice(0,2).toUpperCase();
</script>

<div class="flex-1 overflow-y-auto px-4 py-5 space-y-3">
  {#if items.length}
    {#each items as m}
      <div class="flex items-start gap-3">
        <div class="h-8 w-8 rounded-full bg-white/10 border border-white/10 grid place-items-center text-xs">{avatar(m.authorUid)}</div>
        <div class="min-w-0">
          <div class="text-xs text-white/50 -mb-1">{m.authorUid}</div>
          <div class="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 max-w-[72ch]">
            <div class="text-white/90 leading-relaxed break-words">{m.text}</div>
          </div>
        </div>
      </div>
    {/each}
  {:else}
    <div class="text-white/50 text-sm">No messages yet.</div>
  {/if}
</div>
