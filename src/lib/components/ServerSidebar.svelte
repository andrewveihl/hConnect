<script lang="ts">
  import { page } from '$app/stores';
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { getDb } from '$lib/firebase';
  import { collection, onSnapshot, orderBy, query, doc, getDoc, type Unsubscribe } from 'firebase/firestore';
  import { user } from '$lib/stores/user';
  import ChannelCreateModal from '$lib/components/ChannelCreateModal.svelte';

  export let serverId: string | undefined;
  export let activeChannelId: string | null = null;

  const dispatch = createEventDispatcher<{ pick: string }>();

  $: serverIdFinal =
    serverId ??
    $page.params.serverId ??
    ($page.params as any).serversID ??
    ($page.params as any).id;

  type Chan = { id: string; name: string; type: 'text'|'voice'; position?: number; isPrivate?: boolean };

  let channels: Chan[] = [];
  let serverName = 'Server';
  let unsub: Unsubscribe | null = null;

  let showCreate = false;

  onMount(async () => {
    if (!serverIdFinal) return;
    const db = getDb();

    try {
      const meta = await getDoc(doc(db, 'servers', serverIdFinal));
      if (meta.exists()) serverName = (meta.data() as any)?.name ?? 'Server';
    } catch { /* ignore */ }

    const q = query(collection(db, 'servers', serverIdFinal, 'channels'), orderBy('position'));
    unsub = onSnapshot(q, (snap) => {
      channels = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Chan[];
    });

    return () => unsub?.();
  });

  onDestroy(() => unsub?.());

  function pick(id: string) {
    if (!id) return;
    dispatch('pick', id);
  }
</script>

<aside class="h-dvh w-64 bg-[#2b2d31] border-r border-black/40 text-white flex flex-col">
  <!-- Header -->
  <div class="h-12 px-3 flex items-center justify-between border-b border-black/40">
    <div class="font-semibold truncate" title={serverName}>{serverName}</div>
    <div class="flex items-center gap-1">
      <button
        type="button"
        class="btn btn-ghost h-8 w-8 grid place-items-center"
        title="Create channel"
        aria-label="Create channel"
        on:click={() => (showCreate = true)}
      >
        <i class="bx bx-plus" aria-hidden="true"></i>
      </button>
    </div>
  </div>

  <!-- Lists -->
  <div class="p-3 space-y-4 overflow-y-auto">
    <div>
      <div class="text-[10px] uppercase tracking-wider text-white/50 px-2 mb-1">Text channels</div>
      <div class="space-y-1">
        {#each channels.filter(c => c.type === 'text') as c (c.id)}
          <button
            type="button"
            class={`w-full text-left px-3 py-1.5 rounded-md flex items-center gap-2 hover:bg-white/10 ${activeChannelId === c.id ? 'bg-white/10' : ''}`}
            on:click={() => pick(c.id)}
            aria-label={`Open #${c.name} text channel`}
          >
            <i class="bx bx-hash" aria-hidden="true"></i>
            <span class="truncate">{c.name}</span>
            {#if c.isPrivate}<i class="bx bx-lock text-xs ml-auto opacity-70" aria-hidden="true"></i>{/if}
          </button>
        {/each}
        {#if !channels.some(c => c.type === 'text')}
          <div class="text-xs text-white/50 px-3 py-2">No text channels yet.</div>
        {/if}
      </div>
    </div>

    <div>
      <div class="text-[10px] uppercase tracking-wider text-white/50 px-2 mb-1">Voice channels</div>
      <div class="space-y-1">
        {#each channels.filter(c => c.type === 'voice') as c (c.id)}
          <button
            type="button"
            class={`px-3 py-1.5 w-full text-left rounded-md flex items-center gap-2 hover:bg-white/10 ${activeChannelId === c.id ? 'bg-white/10' : ''}`}
            on:click={() => pick(c.id)}
            aria-label={`Open ${c.name} voice channel`}
          >
            <i class="bx bx-headphone" aria-hidden="true"></i>
            <span class="truncate">{c.name}</span>
            {#if c.isPrivate}<i class="bx bx-lock text-xs ml-auto opacity-70" aria-hidden="true"></i>{/if}
          </button>
        {/each}
        {#if !channels.some(c => c.type === 'voice')}
          <div class="text-xs text-white/50 px-3 py-2">No voice channels yet.</div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Create Channel Modal -->
  <ChannelCreateModal
    bind:open={showCreate}
    serverId={serverIdFinal}
    onClose={() => (showCreate = false)}
    onCreated={(id) => pick(id)}
  />
</aside>
