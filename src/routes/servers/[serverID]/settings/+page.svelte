<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { user } from '$lib/stores/user';
  import { getDb } from '$lib/firebase';
  import { sendServerInvite } from '$lib/db/invites';

  import {
    collection, doc, getDoc, onSnapshot, getDocs,
    query, orderBy, setDoc, updateDoc, deleteDoc,
    limit
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
  let tab: Tab = 'members'; // land on Members where Invite lives

  // live lists
  let members: Array<{ uid: string; displayName?: string; photoURL?: string; role?: string }> = [];
  let bans: Array<{ uid: string; reason?: string; bannedAt?: any }> = [];
  let channels: Array<{ id: string; name: string; type: 'text' | 'voice'; position?: number }> = [];

  // profiles (people who have logged in)
  type Profile = {
    uid: string;
    displayName?: string;
    nameLower?: string;
    email?: string;
    photoURL?: string;
  };
  let allProfiles: Profile[] = [];  // we’ll filter this as you type
  let pendingInvitesByUid: Record<string, boolean> = {};
  let inviteLoading: Record<string, boolean> = {};
  let inviteError: string | null = null;

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
    if (history.length > 1) history.back();
    else goto(serverId ? `/servers/${serverId}` : '/');
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

  // NEW: watch first N profiles ordered by nameLower (users who have logged in)
  function watchProfiles() {
    const db = getDb();
    const qRef = query(collection(db, 'profiles'), orderBy('nameLower'), limit(200));
    return onSnapshot(qRef, (snap) => {
      allProfiles = snap.docs.map((d) => {
        const p = d.data() as any;
        return {
          uid: d.id,
          displayName: p.displayName ?? p.name ?? '',
          nameLower: p.nameLower ?? (p.displayName || '').toLowerCase(),
          email: p.email ?? '',
          photoURL: p.photoURL ?? ''
        } as Profile;
      });
    });
  }

  onMount(async () => {
    serverId = $page.params.serverId || ($page.params as any).serverID || null;
    if (!serverId) return goto('/');

    await gate();

    const offMembers = watchMembers();
    const offBans = watchBans();
    const offChannels = watchChannels();
    const offProfiles = watchProfiles();

    return () => {
      offMembers?.();
      offBans?.();
      offChannels?.();
      offProfiles?.();
      pendingInvitesByUid = {};
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
    if (!isOwner && role === 'admin' && !isAdmin) return;
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

  // ===== INLINE INVITE (filter in-memory; no dialogs) =====
  let search = '';
  $: q = (search || '').trim().toLowerCase();

  // Derived: filter and exclude users already in this server (optional)
  $: memberSet = new Set(members.map(m => m.uid));
  $: filtered = allProfiles
    .filter(p => {
      // don’t show people already in the server
      if (memberSet.has(p.uid)) return false;
      if (!q) return true;
      const n = (p.nameLower || '').toLowerCase();
      const d = (p.displayName || '').toLowerCase();
      const e = (p.email || '').toLowerCase();
      const u = (p.uid || '').toLowerCase();
      return n.includes(q) || d.includes(q) || e.includes(q) || u.includes(q);
    })
    .slice(0, 50); // keep list tidy

  $: if (members.length && Object.keys(pendingInvitesByUid).length) {
    const memberIds = new Set(members.map((m) => m.uid));
    const next = { ...pendingInvitesByUid };
    let changed = false;
    for (const uid of memberIds) {
      if (next[uid]) {
        delete next[uid];
        changed = true;
      }
    }
    if (changed) pendingInvitesByUid = next;
  }

  // invite to first text channel (keeps your current accept flow)
  async function inviteUser(toUid: string) {
    if (!(isOwner || isAdmin)) return;
    if (!isOwner) { // matches your current security rules
      alert('Per current security rules, only channel owners can send invites.');
      return;
    }
    const fallback = channels.find((c) => c.type === 'text') ?? channels[0];
    if (!fallback) { alert('Create a channel first.'); return; }

    if (pendingInvitesByUid[toUid]) {
      console.debug('[ServerSettings] inviteUser skipped; pending invite already exists', {
        toUid,
        invite: pendingInvitesByUid[toUid]
      });
      return;
    }

    const fromUid = $user?.uid;
    if (!fromUid) {
      inviteError = 'You must be signed in to send invites.';
      return;
    }

    inviteError = null;
    inviteLoading = { ...inviteLoading, [toUid]: true };
    try {
      const res = await sendServerInvite({
        toUid,
        fromUid,
        serverId: serverId!,
        serverName: serverName || serverId!,
        serverIcon,
        channelId: fallback.id,
        channelName: fallback.name || 'general'
      });
      if (!res.ok) {
        inviteError = `Failed to invite ${toUid}: ${res.error ?? 'Unknown error'}`;
        console.debug('[ServerSettings] sendServerInvite failed', { toUid, res });
        if (pendingInvitesByUid[toUid]) {
          const { [toUid]: _, ...rest } = pendingInvitesByUid;
          pendingInvitesByUid = rest;
        }
      } else {
        pendingInvitesByUid = { ...pendingInvitesByUid, [toUid]: true };
        if (res.alreadyExisted) {
          inviteError = `User already has a pending invite.`;
          console.debug('[ServerSettings] sendServerInvite already existed', { toUid, res });
        } else {
          console.debug('[ServerSettings] sendServerInvite ok', { toUid, res });
        }
      }
      (window as any)?.navigator?.vibrate?.(10);
    } catch (e) {
      console.error('[ServerSettings] inviteUser error', e);
      inviteError = (e as Error)?.message ?? 'Failed to send invite.';
    }
    inviteLoading = { ...inviteLoading, [toUid]: false };
  }
</script>

<svelte:head>
  <title>Server Settings</title>
</svelte:head>

{#if allowed}
  <div class="min-h-dvh bg-[rgb(3,7,18)] text-white pb-16" style="padding-bottom: max(env(safe-area-inset-bottom), 4rem);">
    <div class="max-w-5xl mx-auto px-4 py-4 sm:py-6">

      <!-- header -->
      <div class="mb-4 flex items-center gap-3">
        <button
          type="button"
          class="h-9 w-9 grid place-items-center rounded-lg bg-white/10 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/30"
          aria-label="Go back"
          title="Back"
          on:click={goBack}
        >
          <i class="bx bx-left-arrow-alt text-xl leading-none"></i>
        </button>

        <div class="flex-1 min-w-0">
          <h1 class="text-2xl font-semibold truncate">Server Settings</h1>
          <p class="text-white/60">Manage roles, members, channels, and dangerous actions.</p>
        </div>
      </div>

      <!-- tabs -->
      <div class="flex gap-2 mb-3 overflow-x-auto no-scrollbar">
        <button class="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15" class:selected={tab==='overview'} on:click={() => tab='overview'}>Overview</button>
        <button class="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15" class:selected={tab==='members'} on:click={() => tab='members'}>Members</button>
        <button class="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15" class:selected={tab==='channels'} on:click={() => tab='channels'}>Channels</button>
        <button class="px-3 py-1.5 rounded bg-red-950/40 text-red-300 hover:bg-red-900/40" class:selected={tab==='danger'} on:click={() => tab='danger'}>Danger Zone</button>
      </div>

      <!-- overview -->
      {#if tab === 'overview'}
        <div class="space-y-4">
          <div class="grid md:grid-cols-2 gap-4">
            <div class="p-4 rounded-lg bg-white/5">
              <label class="block text-sm text-white/70 mb-1">Server name</label>
              <input class="w-full rounded bg-white/10 px-3 py-2" bind:value={serverName} aria-label="Server name" />
            </div>
            <div class="p-4 rounded-lg bg-white/5">
              <label class="block text-sm text-white/70 mb-1">Server icon URL (optional)</label>
              <input class="w-full rounded bg-white/10 px-3 py-2" type="url" bind:value={serverIcon} placeholder="https://…" inputmode="url" aria-label="Server icon URL" />
              {#if serverIcon}
                <div class="mt-2"><img src={serverIcon} alt="Server icon" class="h-14 w-14 rounded" /></div>
              {/if}
            </div>
          </div>
          <button class="w-full sm:w-auto px-4 py-2 rounded bg-[#5865f2] hover:bg-[#4955d4]" on:click={saveOverview}>Save</button>
        </div>
      {/if}

      <!-- members -->
      {#if tab === 'members'}
        <!-- Inline invite (sticky on mobile for easy access) -->
        <div class="sticky top-0 z-10 -mx-4 px-4 py-3 mb-3 bg-[rgb(3,7,18)]/95 backdrop-blur supports-[backdrop-filter]:bg-[rgb(3,7,18)]/75 border-b border-white/10">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div class="i h-10 w-10 grid place-items-center rounded-lg bg-white/10"><i class="bx bx-user-plus text-2xl"></i></div>
            <input
              class="flex-1 rounded-lg bg-white/10 px-3 py-2"
              placeholder="Invite people by name, email, or UID…"
              bind:value={search}
            />
          </div>

          <!-- results -->
          <div class="mt-2 rounded-lg bg-white/5 border border-white/10 max-h-72 overflow-y-auto">
            {#if !q}
              <div class="px-3 py-2 text-sm text-white/60">Type to filter users who have logged in.</div>
            {:else if filtered.length === 0}
              <div class="px-3 py-2 text-sm text-white/60">No users match “{search}”.</div>
            {:else}
              {#each filtered as r (r.uid)}
                <div class="px-3 py-2 flex items-center gap-3 hover:bg-white/10">
                  <img src={r.photoURL || ''} alt="" class="h-9 w-9 rounded-full bg-white/10"
                       on:error={(e)=>((e.target as HTMLImageElement).style.display='none')} />
                  <div class="flex-1 min-w-0">
                    <div class="truncate">{r.displayName || r.email || r.uid}</div>
                    {#if r.email}<div class="text-xs text-white/60 truncate">{r.email}</div>{/if}
                  </div>
                  {#if isOwner || isAdmin}
                    <button
                      class="px-3 py-1.5 text-sm rounded bg-[#5865f2] hover:bg-[#4955d4] disabled:opacity-60 disabled:cursor-not-allowed"
                      disabled={!isOwner || pendingInvitesByUid[r.uid] || inviteLoading[r.uid]}
                      on:click={() => inviteUser(r.uid)}
                    >
                      {#if pendingInvitesByUid[r.uid]}
                        Sent
                      {:else if inviteLoading[r.uid]}
                        Sending…
                      {:else}
                        Invite
                      {/if}
                    </button>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>

          {#if inviteError}
            <div class="mt-2 px-3 py-2 text-xs text-red-300 bg-red-950/30 border border-red-900/40 rounded">
              {inviteError}
            </div>
          {/if}

          <!-- owner/admin hint -->
          {#if (isOwner || isAdmin) && !isOwner}
            <div class="mt-2 text-[11px] text-white/50">Only the channel owner can send invites under current rules.</div>
          {/if}
        </div>

        <!-- current members list -->
        <div class="p-4 rounded-lg bg-white/5 space-y-2">
          {#if members.length === 0}
            <div class="text-white/60">No members yet.</div>
          {/if}
          {#each members as m (m.uid)}
            <div class="flex items-center gap-3 p-2 rounded hover:bg-white/10">
              <img src={m.photoURL || ''} alt="" class="h-9 w-9 rounded-full bg-white/10"
                   on:error={(e)=>((e.target as HTMLImageElement).style.display='none')} />
              <div class="flex-1 min-w-0">
                <div class="truncate">{m.displayName || m.uid}</div>
                <div class="text-xs text-white/50">{m.role || 'member'}</div>
              </div>

              {#if isOwner || isAdmin}
                <div class="flex items-center gap-1">
                  <button class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                    disabled={!isOwner && m.role === 'admin'}
                    on:click={() => setRole(m.uid, 'member')}>Member</button>
                  <button class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                    on:click={() => setRole(m.uid, 'admin')}>Admin</button>
                </div>
              {/if}

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

      <!-- channels -->
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

      <!-- danger -->
      {#if tab === 'danger'}
        <div class="p-4 rounded-lg bg-red-950/30 border border-red-900/30">
          <div class="text-lg font-semibold text-red-300 mb-2">Danger Zone</div>
          <p class="text-sm text-red-200/80 mb-4">
            Deleting the server will remove channels, members, and bans. This cannot be undone.
          </p>
          <button class="w-full sm:w-auto px-4 py-2 rounded bg-red-700 hover:bg-red-800 disabled:opacity-50"
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
