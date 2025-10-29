<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/stores';
  import { user } from '$lib/stores/user';
  import { getDb } from '$lib/firebase';
  import { collection, doc, getDoc } from 'firebase/firestore';

  import {
    subscribeInbox,
    acceptInvite,
    declineInvite,
    sendServerInvite,
    subscribePendingInviteForUser,
    type ServerInvite,
  } from '$lib/firestore/invites';

  let invites: ServerInvite[] = [];
  let unsubInbox: (() => void) | null = null;

  /** If your Settings route has a server param, we'll use it to enable "Invite by UID" */
  export let serverId: string | null = null;

  let serverName: string | null = null;
  let serverIcon: string | null = null;

  // Permissions (naive)
  let isOwner = false;
  let isAdmin = false;

  // Invite by UID controls
  let candidateUid = '';
  let sending = false;
  let sent = false;
  let inviteErr = '';

  let unsubSent: (() => void) | null = null;

  function dlog(...args: any[]) {
    if (typeof window !== 'undefined' && (window as any).__DEBUG) {
      console.debug('[InvitePanel]', ...args);
    }
  }

  async function loadServerMeta() {
    if (!serverId) return;
    const db = getDb();
    const sRef = doc(db, 'servers', serverId);
    const s = await getDoc(sRef);
    if (s.exists()) {
      const d = s.data() as any;
      serverName = d.name ?? serverId;
      serverIcon = d.icon ?? null;

      const me = $user?.uid;
      if (me) {
        isOwner = d.owner === me;
        const memRef = doc(db, 'servers', serverId, 'members', me);
        const mem = await getDoc(memRef);
        const role = mem.exists() ? (mem.data() as any).role : null;
        isAdmin = role === 'admin' || role === 'owner';
      }
    }
    dlog('loadServerMeta', { serverId, serverName, isOwner, isAdmin });
  }

  async function onSendInvite() {
    inviteErr = '';
    sending = true;
    try {
      if (!serverId) throw new Error('Missing serverId');
      const me = $user?.uid;
      if (!me) throw new Error('Must be signed in');
      if (!candidateUid) throw new Error('Provide a user id to invite');

      const res = await sendServerInvite({
        toUid: candidateUid.trim(),
        fromUid: me,
        serverId,
        serverName,
        serverIcon,
      });

      if (!res.ok) {
        inviteErr = `Invite failed: ${res.error ?? 'Unknown error'}${res.code ? ` (${res.code})` : ''}`;
        console.debug('[InvitePanel] sendServerInvite failed', res);
      } else {
        console.debug('[InvitePanel] sendServerInvite ok', res);
      }
      // "sent" state is driven by subscription below
    } catch (e: any) {
      inviteErr = e?.message ?? 'Invite failed';
      console.debug('[InvitePanel] onSendInvite error', e);
    } finally {
      sending = false;
    }
  }

  async function onAccept(inv: ServerInvite) {
    const me = $user?.uid;
    if (!me) {
      alert('You need to be signed in to accept invites.');
      return;
    }
    const res = await acceptInvite(inv.id!, me);
    if (!res.ok) {
      alert(`Accept failed: ${res.error ?? 'Unknown'}`);
      console.debug('[InvitePanel] acceptInvite failed', inv, res);
    } else {
      console.debug('[InvitePanel] acceptInvite ok', inv);
    }
  }

  async function onDecline(inv: ServerInvite) {
    const me = $user?.uid;
    if (!me) {
      alert('You need to be signed in to decline invites.');
      return;
    }
    const res = await declineInvite(inv.id!, me);
    if (!res.ok) {
      alert(`Decline failed: ${res.error ?? 'Unknown'}`);
      console.debug('[InvitePanel] declineInvite failed', inv, res);
    } else {
      console.debug('[InvitePanel] declineInvite ok', inv);
    }
  }

  onMount(async () => {
    // If the parent page has a param, use it; otherwise try from $page
    serverId = serverId ?? $page.params.serverID ?? null;

    if ($user?.uid) {
      unsubInbox?.();
      unsubInbox = subscribeInbox($user.uid, (rows) => {
        invites = rows.sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
      });
    }

    await loadServerMeta();
  });

  // Invites button live "Sent" indicator
  $: {
    const trimmed = candidateUid.trim();
    unsubSent?.();
    if (serverId && trimmed) {
      unsubSent = subscribePendingInviteForUser(trimmed, serverId, (inv) => {
        sent = !!inv;
        dlog('pendingInvite subscription', { candidateUid: trimmed, serverId, sent, inv });
      });
    } else {
      sent = false;
      unsubSent = null;
    }
  }

  onDestroy(() => {
    unsubInbox?.();
    unsubSent?.();
  });
</script>

<!-- INVITES PANEL â€“ keep styles simple so it blends with your existing page -->
<div class="mt-8 space-y-6">
  <h2 class="text-lg font-semibold">Invites</h2>

  <!-- Inbox -->
  <div class="  border border-white/10 bg-white/5">
    <div class="px-4 py-3 border-b border-white/10 font-medium">Your Pending Invites</div>
    <div class="p-4">
      {#if !$user}
        <p>Please sign in to view your invites.</p>
      {:else if invites.length === 0}
        <p class="text-white/70">No pending invites.</p>
      {:else}
        <ul class="space-y-3">
          {#each invites as inv (inv.id)}
            <li class="p-3  bg-white/5 border border-white/10 flex items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                {#if inv.serverIcon}
                  <img alt="" src={inv.serverIcon} class="w-10 h-10  object-cover" />
                {:else}
                  <div class="w-10 h-10  bg-white/10 grid place-items-center">ðŸ·</div>
                {/if}
                <div>
                  <div class="font-medium">{inv.serverName ?? inv.serverId}</div>
                  {#if inv.channelName}
                    <div class="text-xs text-white/60 truncate">Channel: #{inv.channelName}</div>
                  {/if}
                  <div class="text-xs text-white/50">From: {inv.fromUid}</div>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <button class="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500" on:click={() => onAccept(inv)}>Accept</button>
                <button class="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20" on:click={() => onDecline(inv)}>Decline</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>

  <!-- Invite by UID (only if this Settings view is for a specific server + user is owner/admin) -->
  {#if serverId && (isOwner || isAdmin)}
    <div class="  border border-white/10 bg-white/5">
      <div class="px-4 py-3 border-b border-white/10 font-medium">Invite a User (by UID)</div>
      <div class="p-4 flex items-center gap-2">
        <input
          class="px-3 py-2 rounded bg-white/5 border border-white/10 w-80"
          placeholder="Enter user UID"
          bind:value={candidateUid}
        />
        <button
          class="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-60"
          on:click={onSendInvite}
          disabled={!candidateUid || sent || sending}
        >
          {#if sent}Sent{:else if sending}Sendingâ€¦{:else}Invite{/if}
        </button>
      </div>
      {#if inviteErr}
        <div class="px-4 pb-4 text-red-400 text-sm">{inviteErr}</div>
      {/if}
      <div class="px-4 pb-4 text-xs text-white/50">
        Debug: serverId={serverId} name={serverName} owner={isOwner} admin={isAdmin} sent={String(sent)}
      </div>
    </div>
  {/if}
</div>



