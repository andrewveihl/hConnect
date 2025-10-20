<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '$lib/db';
  import { collection, onSnapshot, orderBy, query, doc, getDoc } from 'firebase/firestore';
  import { createTextChannel, createVoiceChannel } from '$lib/db/channels';
  import { user } from '$lib/stores/user';
  import { deleteServer } from '$lib/db/servers';
  import { goto } from '$app/navigation';

  export let serverId: string;
  export let activeChannelId: string | null = null;
  export let onPickChannel: (id: string) => void;

  let channels: Array<{ id: string; name: string; type: 'text'|'voice'; position: number }> = [];
  let serverName = 'Server';
  let isOwner = false;
  let unsub: () => void;

  onMount(async () => {
    const database = db();
    const meta = await getDoc(doc(database, 'servers', serverId));
    if (meta.exists()) {
      const data = meta.data() as any;
      serverName = data.name ?? 'Server';
      isOwner = !!$user?.uid && data.ownerId === $user.uid;
    }
    const q = query(collection(database, 'servers', serverId, 'channels'), orderBy('position'));
    unsub = onSnapshot(q, (snap) => { channels = snap.docs.map(d => d.data() as any); });
    return () => unsub && unsub();
  });

  const nextPos = (kind: 'text'|'voice') => {
    const list = channels.filter(c => c.type === kind);
    return (list.length ? Math.max(...list.map(c => c.position ?? 0)) : -1) + 1;
  };

  async function addText() {
    try { await createTextChannel(serverId, 'new-text', nextPos('text')); }
    catch (e:any) { alert(e?.message ?? 'Failed to create text channel'); }
  }
  async function addVoice() {
    try { await createVoiceChannel(serverId, 'New Voice', nextPos('voice')); }
    catch (e:any) { alert(e?.message ?? 'Failed to create voice channel'); }
  }
  async function onDeleteServer() {
    if (!isOwner) return;
    if (!confirm(`Delete "${serverName}"? This cannot be undone.`)) return;
    await deleteServer(serverId, $user!.uid);
    await goto('/');
  }
</script>

<aside class="h-dvh w-64 bg-[#2b2d31] border-r border-black/40 text-white flex flex-col">
  <div class="h-12 px-3 flex items-center justify-between border-b border-black/40">
    <div class="font-semibold truncate" title={serverName}>{serverName}</div>
    <div class="flex items-center gap-1">
      <button class="btn btn-ghost h-8 w-8 grid place-items-center" on:click={addText} title="Add text channel"><i class="bx bx-hash"></i></button>
      <button class="btn btn-ghost h-8 w-8 grid place-items-center" on:click={addVoice} title="Add voice channel"><i class="bx bx-headphone"></i></button>
      {#if isOwner}
        <button class="btn btn-ghost h-8 w-8 grid place-items-center text-red-400 hover:text-red-300" on:click={onDeleteServer} title="Delete server"><i class="bx bx-trash"></i></button>
      {/if}
    </div>
  </div>

  <div class="p-3 space-y-4 overflow-y-auto">
    <div>
      <div class="text-[10px] uppercase tracking-wider text-white/50 px-2 mb-1">Text channels</div>
      <div class="space-y-1">
        {#each channels.filter(c => c.type === 'text') as c}
          <button
            class={`w-full text-left px-3 py-1.5 rounded-md flex items-center gap-2 hover:bg-white/10 ${activeChannelId === c.id ? 'bg-white/10' : ''}`}
            on:click={() => onPickChannel(c.id)}>
            <i class="bx bx-hash"></i><span class="truncate">{c.name}</span>
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
        {#each channels.filter(c => c.type === 'voice') as c}
          <div class={`px-3 py-1.5 rounded-md flex items-center gap-2 hover:bg-white/10 ${activeChannelId === c.id ? 'bg-white/10' : ''}`}>
            <i class="bx bx-headphone"></i><span class="truncate">{c.name}</span>
          </div>
        {/each}
        {#if !channels.some(c => c.type === 'voice')}
          <div class="text-xs text-white/50 px-3 py-2">No voice channels yet.</div>
        {/if}
      </div>
    </div>
  </div>
</aside>
