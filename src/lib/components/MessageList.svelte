<script lang="ts">
  export let messages: Array<{ id: string; authorId: string; content: string; gifUrl?: string|null; createdAt: any }>=[];
  export let users: Record<string, { displayName?: string; photoURL?: string|null }> = {};
</script>

<div class="flex flex-col gap-4">
  {#each messages as m (m.id)}
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded-full overflow-hidden bg-[#3f4248] grid place-items-center">
        {#if users[m.authorId]?.photoURL}
          <img src={users[m.authorId].photoURL} alt="" class="w-full h-full object-cover" />
        {:else}
          <i class="bx bx-user text-white/70"></i>
        {/if}
      </div>
      <div class="flex-1">
        <div class="text-sm">
          <span class="font-semibold">{users[m.authorId]?.displayName ?? 'User'}</span>
          <span class="text-white/40 ml-2 text-xs">
            {new Date(m.createdAt?.toMillis?.() ?? m.createdAt).toLocaleString()}
          </span>
        </div>
        <div class="whitespace-pre-wrap text-[15px] leading-6">{m.content}</div>
        {#if m.gifUrl}
          <img src={m.gifUrl} alt="gif" class="mt-2 rounded-lg max-h-64 object-contain" />
        {/if}
      </div>
    </div>
  {/each}
</div>
