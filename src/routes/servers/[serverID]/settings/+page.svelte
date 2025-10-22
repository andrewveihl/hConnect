<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { user } from '$lib/stores/user';
  import { getDb } from '$lib/firebase';

  import {
    collection, doc, getDoc, onSnapshot, getDocs,
    query, orderBy, where, setDoc, updateDoc, deleteDoc
  } from 'firebase/firestore';

  // routing
  let serverId: string | null = null;

  // access
  let allowed = false;
  let isOwner = false;
  let isAdmin = false;

  // server meta
  let serverName = '';
  let serverIcon: string | null = null;

  // tabs
  type Tab = 'overview' | 'members' | 'channels' | 'danger';
  let tab: Tab = 'overview';

  // live lists
  let members: Array<{ uid: string; displayName?: string; photoURL?: string; role?: string }> = [];
  let bans: Array<{ uid: string; reason?: string; bannedAt?: any }> = [];
  let channels: Array<{ id: string; name: string; type: 'text' | 'voice'; position?: number }> = [];

  function ownerFrom(data: any) {
    return data?.owner ?? data?.ownerId ?? data?.createdBy ?? null;
  }

  async function gate() {
    const db = getDb();
    const snap = await getDoc(doc(db, 'servers', serverId!));
    if (!snap.exists()) return goto('/');

    const data = snap.data() as any;
    serverName = data?.name ?? 'Server';
    serverIcon = data?.icon ?? null;
    const owner = ownerFrom(data);

    isOwner = !!($user?.uid && owner && $user.uid === owner);

    // admin if role is 'admin' in members or owner
    if (!isOwner && $user?.uid) {
      const memberSnap = await getDoc(doc(db, 'servers', serverId!, 'members', $user.uid));
      const role = memberSnap.exists() ? (memberSnap.data() as any).role : null;
      isAdmin = role === 'admin';
    } else {
      isAdmin = true; // owner is admin+
    }

    allowed = isOwner || isAdmin;
    if (!allowed) goto(`/servers/${serverId}`);
  }

  function goBack() {
    // Prefer real back if there is history
    if (history.length > 1) {
      history.back();
    } else {
      // Fallback: go to the server page (or home)
      goto(serverId ? `/servers/${serverId}` : '/');
    }
  }

  function watchMembers() {
    const db = getDb();
    return onSnapshot(collection(db, 'servers', serverId!, 'members'), (snap) => {
      members = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
    });
  }

  function watchBans() {
    const db = getDb();
    return onSnapshot(collection(db, 'servers', serverId!, 'bans'), (snap) => {
      bans = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
    });
  }

  function watchChannels() {
    const db = getDb();
    const qRef = query(collection(db, 'servers', serverId!, 'channels'), orderBy('position'));
    return onSnapshot(qRef, (snap) => {
      channels = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    });
  }

  onMount(async () => {
    serverId = $page.params.serverId || ($page.params as any).serverID || null;
    if (!serverId) return goto('/');

    await gate();

    // live watchers
    const offMembers = watchMembers();
    const offBans = watchBans();
    const offChannels = watchChannels();

    return () => {
      offMembers?.();
      offBans?.();
      offChannels?.();
    };
  });

  // ----- actions: Overview -----
  async function saveOverview() {
    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', serverId!), {
        name: serverName,
        icon: serverIcon ?? null
      });
      alert('Saved.');
    } catch (e) {
      console.error(e);
      alert('Failed to save.');
    }
  }

  // ----- actions: Members / Roles -----
  async function setRole(uid: string, role: 'admin' | 'member') {
    if (!isOwner && role === 'admin' && !isAdmin) return; // safety
    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', serverId!, 'members', uid), { role });
    } catch (e) {
      console.error(e);
      alert('Failed to update role.');
    }
  }

  async function kick(uid: string) {
    if (!isAdmin) return;
    if (!confirm('Kick this user? They can rejoin with an invite.')) return;
    const db = getDb();
    try {
      await deleteDoc(doc(db, 'servers', serverId!, 'members', uid));
    } catch (e) {
      console.error(e);
      alert('Failed to kick user.');
    }
  }

  async function ban(uid: string) {
    if (!isAdmin) return;
    const reason = prompt('Reason for ban? (optional)') || '';
    if (!confirm('Ban this user? They will be removed and prevented from rejoining.')) return;
    const db = getDb();
    try {
      await setDoc(doc(db, 'servers', serverId!, 'bans', uid), {
        reason,
        bannedAt: Date.now(),
        by: $user?.uid ?? null
      });
      await deleteDoc(doc(db, 'servers', serverId!, 'members', uid));
    } catch (e) {
      console.error(e);
      alert('Failed to ban user.');
    }
  }

  async function unban(uid: string) {
    if (!isAdmin) return;
    const db = getDb();
    try {
      await deleteDoc(doc(db, 'servers', serverId!, 'bans', uid));
    } catch (e) {
      console.error(e);
      alert('Failed to unban user.');
    }
  }

  // ----- actions: Channels -----
  async function renameChannel(id: string, oldName: string) {
    if (!isAdmin) return;
    const name = prompt('Rename channel to:', oldName);
    if (!name || name.trim() === oldName) return;
    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', serverId!, 'channels', id), { name: name.trim() });
    } catch (e) {
      console.error(e);
      alert('Failed to rename channel.');
    }
  }

  async function deleteChannel(id: string, name: string) {
    if (!isAdmin) return;
    if (!confirm(`Delete channel “#${name}”? This cannot be undone.`)) return;
    const db = getDb();
    try {
      await deleteDoc(doc(db, 'servers', serverId!, 'channels', id));
    } catch (e) {
      console.error(e);
      alert('Failed to delete channel.');
    }
  }

  // ----- actions: Danger Zone (owner only) -----
  async function deleteServer() {
    if (!isOwner) return;
    if (!confirm('Delete this server and all its data? This cannot be undone.')) return;

    const db = getDb();
    try {
      // Best-effort recursive deletes (collections: channels, members, bans)
      const colls = ['channels', 'members', 'bans'];
      for (const c of colls) {
        const snap = await getDocs(collection(db, 'servers', serverId!, c));
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      }
      await deleteDoc(doc(db, 'servers', serverId!));
      alert('Server deleted.');
      goto('/'); // go home
    } catch (e) {
      console.error(e);
      alert('Failed to delete server. (Consider a Cloud Function for large deletes.)');
    }
  }
</script>

<svelte:head>
  <title>Server Settings</title>
</svelte:head>

{#if allowed}
  <div class="min-h-dvh bg-[rgb(3,7,18)] text-white">
    <div class="max-w-5xl mx-auto px-4 py-6">

      <div class="mb-6 flex items-center gap-3">
        <button
          type="button"
          class="h-9 w-9 grid place-items-center rounded-lg bg-white/10 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/30"
          aria-label="Go back"
          title="Back"
          on:click={goBack}
        >
          <i class="bx bx-left-arrow-alt text-xl leading-none"></i>
        </button>

        <div>
          <h1 class="text-2xl font-semibold">Server Settings</h1>
          <p class="text-white/60">Manage roles, members, channels, and dangerous actions.</p>
        </div>
      </div>

      <!-- Tabs -->
      <div class="flex gap-2 mb-4">
        <button class="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15"
          class:selected={tab==='overview'} on:click={() => tab='overview'}>Overview</button>
        <button class="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15"
          class:selected={tab==='members'} on:click={() => tab='members'}>Members</button>
        <button class="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15"
          class:selected={tab==='channels'} on:click={() => tab='channels'}>Channels</button>
        <button class="px-3 py-1.5 rounded bg-red-950/40 text-red-300 hover:bg-red-900/40"
          class:selected={tab==='danger'} on:click={() => tab='danger'}>Danger Zone</button>
      </div>

      <!-- Overview -->
      {#if tab === 'overview'}
        <div class="space-y-4">
          <div class="grid md:grid-cols-2 gap-4">
            <div class="p-4 rounded-lg bg-white/5">
              <label for="server-name" class="block text-sm text-white/70 mb-1">Server name</label>
              <input
                id="server-name"
                type="text"
                class="w-full rounded bg-white/10 px-3 py-2"
                bind:value={serverName}
                aria-label="Server name"
              />
            </div>
            <div class="p-4 rounded-lg bg-white/5">
              <label for="server-icon" class="block text-sm text-white/70 mb-1">Server icon URL (optional)</label>
              <input
                id="server-icon"
                type="url"
                class="w-full rounded bg-white/10 px-3 py-2"
                bind:value={serverIcon}
                placeholder="https://…"
                inputmode="url"
                aria-label="Server icon URL"
              />
              {#if serverIcon}
                <div class="mt-2">
                  <img src={serverIcon} alt="Server icon" class="h-14 w-14 rounded" />
                </div>
              {/if}
            </div>
          </div>
          <button class="px-4 py-2 rounded bg-[#5865f2] hover:bg-[#4955d4]" on:click={saveOverview}>
            Save
          </button>
        </div>
      {/if}

      <!-- Members -->
      {#if tab === 'members'}
        <div class="p-4 rounded-lg bg-white/5 space-y-2">
          {#if members.length === 0}
            <div class="text-white/60">No members yet.</div>
          {/if}
          {#each members as m (m.uid)}
            <div class="flex items-center gap-3 p-2 rounded hover:bg-white/10">
              <img src={m.photoURL || ''} alt="" class="h-8 w-8 rounded-full bg-white/10" on:error={(e)=>((e.target as HTMLImageElement).style.display='none')} />
              <div class="flex-1 min-w-0">
                <div class="truncate">{m.displayName || m.uid}</div>
                <div class="text-xs text-white/50">{m.role || 'member'}</div>
              </div>

              <!-- role controls (owner/admin) -->
              {#if isOwner || isAdmin}
                <div class="flex items-center gap-1">
                  <button class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                    disabled={!isOwner && m.role === 'admin'}
                    on:click={() => setRole(m.uid, 'member')}>Member</button>
                  <button class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                    on:click={() => setRole(m.uid, 'admin')}>Admin</button>
                </div>
              {/if}

              <!-- kick / ban -->
              {#if isOwner || isAdmin}
                <button class="ml-2 px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                  on:click={() => kick(m.uid)}>Kick</button>
                <button class="px-2 py-1 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60"
                  on:click={() => ban(m.uid)}>Ban</button>
              {/if}
            </div>
          {/each}
        </div>

        <div class="mt-6 p-4 rounded-lg bg-white/5">
          <div class="text-sm text-white/70 mb-2">Bans</div>
          {#if bans.length === 0}
            <div class="text-white/60">No banned users.</div>
          {/if}
          {#each bans as b (b.uid)}
            <div class="flex items-center justify-between p-2 rounded hover:bg-white/10">
              <div>
                <div class="font-medium">{b.uid}</div>
                {#if b.reason}<div class="text-xs text-white/60">Reason: {b.reason}</div>{/if}
              </div>
              {#if isOwner || isAdmin}
                <button class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                  on:click={() => unban(b.uid)}>Unban</button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <!-- Channels -->
      {#if tab === 'channels'}
        <div class="p-4 rounded-lg bg-white/5 space-y-2">
          {#if channels.length === 0}
            <div class="text-white/60">No channels yet.</div>
          {/if}
          {#each channels as c (c.id)}
            <div class="flex items-center gap-2 p-2 rounded hover:bg-white/10">
              <div class="w-6 text-center">
                {#if c.type === 'text'}<i class="bx bx-hash" aria-hidden="true"></i>{:else}<i class="bx bx-headphone" aria-hidden="true"></i>{/if}
              </div>
              <div class="flex-1 truncate">{c.name}</div>
              {#if isOwner || isAdmin}
                <button class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                  on:click={() => renameChannel(c.id, c.name)}>Rename</button>
                <button class="px-2 py-1 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60"
                  on:click={() => deleteChannel(c.id, c.name)}>Delete</button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <!-- Danger Zone -->
      {#if tab === 'danger'}
        <div class="p-4 rounded-lg bg-red-950/30 border border-red-900/30">
          <div class="text-lg font-semibold text-red-300 mb-2">Danger Zone</div>
          <p class="text-sm text-red-200/80 mb-4">
            Deleting the server will remove channels, members, and bans. This cannot be undone.
          </p>
          <button class="px-4 py-2 rounded bg-red-700 hover:bg-red-800 disabled:opacity-50"
            disabled={!isOwner} on:click={deleteServer}>
            Delete Server
          </button>
          {#if !isOwner}
            <div class="text-xs text-white/60 mt-2">Only the owner can delete the server.</div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
