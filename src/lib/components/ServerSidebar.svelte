<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { getDb } from '$lib/firebase';
  import { user } from '$lib/stores/user';
  import ChannelCreateModal from '$lib/components/ChannelCreateModal.svelte';

  import {
    collection, onSnapshot, orderBy, query, doc,
    type Unsubscribe, deleteDoc, updateDoc
  } from 'firebase/firestore';

  // ===== Props (unchanged) =====
  export let serverId: string | undefined;
  export let activeChannelId: string | null = null;
  export let onPickChannel: (id: string) => void = () => {};
  const dispatch = createEventDispatcher<{ pick: string }>();

  // ===== Resolve server id from prop/route (unchanged) =====
  $: computedServerId =
    serverId ??
    $page.params.serverId ??
    ($page.params as any).serverID ??
    null;

  // ===== Types / State =====
  type Chan = {
    id: string; name: string; type: 'text' | 'voice';
    position?: number; isPrivate?: boolean
  };

  let channels: Chan[] = [];
  let serverName = 'Server';
  let showCreate = false;

  // live unsubscribers
  let unsubChannels: Unsubscribe | null = null;
  let unsubServerMeta: Unsubscribe | null = null;
  let unsubMyMember: Unsubscribe | null = null;

  // role/capability state
  let ownerId: string | null = null;
  let myRole: 'owner' | 'admin' | 'member' | null = null; // keep old role path
  let myPerms: { [k: string]: any } | null = null;        // NEW: read perms safely

  // tracking
  let lastServerId: string | null = null;
  let didAutopick = false;

  // ===== Helpers =====
  function deriveOwnerId(data: any): string | null {
    // your schema uses ownerId; support alternates too
    return data?.ownerId ?? data?.owner ?? data?.createdBy ?? null;
  }
  function computeIsOwner(): boolean {
    return !!(ownerId && $user?.uid && $user.uid === ownerId);
  }

  // Keep your original flags, just extend admin detection to include perms
  $: isOwner = computeIsOwner();
  $: isAdminLike =
      isOwner ||
      myRole === 'admin' ||
      !!(myPerms?.manageServer || myPerms?.manageRoles); // treat as admin if can manage
  $: canManageChannels =
      isOwner ||
      !!(myPerms?.manageChannels) ||
      !!(myPerms?.manageServer); // server managers can manage channels too

  // ===== Live subscriptions (unchanged patterns) =====
  function watchServerMeta(server: string) {
    unsubServerMeta?.();
    const db = getDb();
    const ref = doc(db, 'servers', server);
    unsubServerMeta = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        serverName = 'Server';
        ownerId = null;
        return;
      }
      const data = snap.data() as any;
      serverName = data?.name ?? 'Server';
      ownerId = deriveOwnerId(data);

      // If you are the owner per server doc, force owner role immediately
      if (computeIsOwner()) myRole = 'owner';
    }, () => {
      serverName = 'Server';
      ownerId = null;
    });
  }

  function watchMyMember(server: string) {
    unsubMyMember?.();
    myRole = computeIsOwner() ? 'owner' : null; // safe default
    myPerms = null;

    if (!$user?.uid) return;
    const db = getDb();
    const ref = doc(db, 'servers', server, 'members', $user.uid);
    unsubMyMember = onSnapshot(ref, (snap) => {
      const data = snap.exists() ? (snap.data() as any) : null;
      // Keep any existing role logic if you use it elsewhere
      const maybeRole = data?.role ?? null; // some builds still set role
      myRole = computeIsOwner() ? 'owner' : (maybeRole as any);
      // NEW: read perms but don't require them
      myPerms = data?.perms ?? null;
    }, () => {
      myRole = computeIsOwner() ? 'owner' : null;
      myPerms = null;
    });
  }

  function watchChannels(server: string) {
    unsubChannels?.();
    channels = [];
    didAutopick = false;

    const db = getDb();
    const qRef = query(collection(db, 'servers', server, 'channels'), orderBy('position'));
    unsubChannels = onSnapshot(qRef, (snap) => {
      channels = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Chan[];
      if (!didAutopick && !activeChannelId && channels.length) {
        didAutopick = true;
        pick(channels[0].id);
      }
    });
  }

  function subscribeAll(server: string) {
    watchServerMeta(server);
    watchMyMember(server);
    watchChannels(server);
  }

  // Re-subscribe when the server id actually changes
  $: if (computedServerId && computedServerId !== lastServerId) {
    lastServerId = computedServerId;
    subscribeAll(computedServerId);
  }

  // Also refresh member when auth resolves
  $: if (computedServerId && $user?.uid) {
    watchMyMember(computedServerId);
  }

  onDestroy(() => {
    unsubChannels?.();
    unsubServerMeta?.();
    unsubMyMember?.();
  });

  // ===== Actions (unchanged API) =====
  function pick(id: string) {
    if (!id) return;
    onPickChannel(id);
    dispatch('pick', id);
  }

  function openServerSettings() {
    if (!computedServerId || !isAdminLike) return;
    goto(`/servers/${computedServerId}/settings`);
  }

  async function deleteChannel(id: string, name: string) {
    if (!computedServerId || !canManageChannels) return;
    const ok = confirm(`Delete channel “#${name}”? This cannot be undone.`);
    if (!ok) return;

    const db = getDb();
    try {
      await deleteDoc(doc(db, 'servers', computedServerId, 'channels', id));
      if (activeChannelId === id) {
        const next = channels.find((c) => c.id !== id);
        if (next) pick(next.id);
      }
    } catch (err) {
      alert('Failed to delete channel.');
      console.error(err);
    }
  }

  async function renameChannel(id: string, oldName: string) {
    if (!computedServerId || !canManageChannels) return;
    const name = prompt('Rename channel to:', oldName);
    if (!name || name.trim() === oldName) return;
    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', computedServerId, 'channels', id), { name: name.trim() });
    } catch (err) {
      alert('Failed to rename channel.');
      console.error(err);
    }
  }
</script>

<aside class="h-dvh w-64 bg-[#2b2d31] border-r border-black/40 text-white flex flex-col">
  <!-- Header -->
  <div class="h-12 px-3 flex items-center justify-between border-b border-black/40">
    <div class="flex items-center gap-2 min-w-0">
      <div class="font-semibold truncate" title={serverName}>{serverName}</div>
      <!-- tiny role chip (owner/admin-like) -->
      {#if isOwner}
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/30 text-emerald-300">owner</span>
      {:else if isAdminLike}
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-sky-600/30 text-sky-300">admin</span>
      {/if}
    </div>

    <div class="flex items-center gap-1">
      {#if isAdminLike}
        <button
          type="button"
          class="btn btn-ghost h-8 w-8 grid place-items-center rounded-lg hover:bg-white/10"
          title="Server settings"
          aria-label="Server settings"
          on:click={openServerSettings}
        >
          <i class="bx bx-cog text-[16px]" aria-hidden="true"></i>
        </button>
      {/if}
      <button
        type="button"
        class="btn btn-ghost h-8 w-8 grid place-items-center rounded-lg hover:bg-white/10"
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
    <!-- Text channels -->
    <div>
      <div class="text-[10px] uppercase tracking-wider text-white/50 px-2 mb-1">Text channels</div>
      <div class="space-y-1">
        {#each channels.filter(c => c.type === 'text') as c (c.id)}
          <div class={`group w-full flex items-center gap-1 rounded-md ${activeChannelId === c.id ? 'bg-white/10' : 'hover:bg-white/10'}`}>
            <button
              type="button"
              class="flex-1 text-left px-3 py-1.5 rounded-md flex items-center gap-2"
              on:click={() => pick(c.id)}
              aria-label={`Open #${c.name} text channel`}
            >
              <i class="bx bx-hash" aria-hidden="true"></i>
              <span class="truncate">{c.name}</span>
              {#if c.isPrivate}
                <i class="bx bx-lock text-xs ml-auto opacity-70" aria-hidden="true"></i>
              {/if}
            </button>

            {#if canManageChannels}
              <div class="opacity-0 group-hover:opacity-100 transition pr-1 shrink-0 flex items-center gap-1">
                <button
                  class="h-7 w-7 grid place-items-center rounded hover:bg-white/10"
                  title="Rename"
                  aria-label="Rename channel"
                  on:click={() => renameChannel(c.id, c.name)}
                >
                  <i class="bx bx-edit text-sm"></i>
                </button>
                <button
                  class="h-7 w-7 grid place-items-center rounded hover:bg-white/10 text-red-400"
                  title="Delete"
                  aria-label="Delete channel"
                  on:click={() => deleteChannel(c.id, c.name)}
                >
                  <i class="bx bx-trash text-sm"></i>
                </button>
              </div>
            {/if}
          </div>
        {/each}
        {#if !channels.some(c => c.type === 'text')}
          <div class="text-xs text-white/50 px-3 py-2">No text channels yet.</div>
        {/if}
      </div>
    </div>

    <!-- Voice channels -->
    <div>
      <div class="text-[10px] uppercase tracking-wider text-white/50 px-2 mb-1">Voice channels</div>
      <div class="space-y-1">
        {#each channels.filter(c => c.type === 'voice') as c (c.id)}
          <div class={`group w-full flex items-center gap-1 rounded-md ${activeChannelId === c.id ? 'bg-white/10' : 'hover:bg-white/10'}`}>
            <button
              type="button"
              class="px-3 py-1.5 w-full text-left rounded-md flex items-center gap-2"
              on:click={() => pick(c.id)}
              aria-label={`Open ${c.name} voice channel`}
            >
              <i class="bx bx-headphone" aria-hidden="true"></i>
              <span class="truncate">{c.name}</span>
              {#if c.isPrivate}
                <i class="bx bx-lock text-xs ml-auto opacity-70" aria-hidden="true"></i>
              {/if}
            </button>

            {#if canManageChannels}
              <div class="opacity-0 group-hover:opacity-100 transition pr-1 shrink-0 flex items-center gap-1">
                <button
                  class="h-7 w-7 grid place-items-center rounded hover:bg-white/10"
                  title="Rename"
                  aria-label="Rename channel"
                  on:click={() => renameChannel(c.id, c.name)}
                >
                  <i class="bx bx-edit text-sm"></i>
                </button>
                <button
                  class="h-7 w-7 grid place-items-center rounded hover:bg-white/10 text-red-400"
                  title="Delete"
                  aria-label="Delete channel"
                  on:click={() => deleteChannel(c.id, c.name)}
                >
                  <i class="bx bx-trash text-sm"></i>
                </button>
              </div>
            {/if}
          </div>
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
    serverId={computedServerId}
    onClose={() => (showCreate = false)}
    onCreated={(id) => pick(id)}
  />
</aside>
