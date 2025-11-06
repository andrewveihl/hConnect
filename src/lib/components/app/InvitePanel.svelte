<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/stores';
  import { user } from '$lib/stores/user';
  import { getDb } from '$lib/firebase';
  import { doc, getDoc, updateDoc } from 'firebase/firestore';

  import {
    subscribeInbox,
    acceptInvite,
    declineInvite,
    sendServerInvite,
    subscribePendingInviteForUser,
    type ServerInvite
  } from '$lib/firestore/invites';

  export let serverId: string | null = null;
  export let embedded = false;

  let invites: ServerInvite[] = [];
  let unsubInbox: (() => void) | null = null;
  let unsubSent: (() => void) | null = null;

  let serverName: string | null = null;
  let serverIcon: string | null = null;

  let isOwner = false;
  let isAdmin = false;

  let candidateUid = '';
  let sending = false;
  let sent = false;
  let inviteErr = '';

  let metaLoadedFor: string | null = null;
  let inboxUid: string | null = null;

  let senderNames: Record<string, string> = {};
  const pendingSenderLoads = new Set<string>();

  function dlog(...args: any[]) {
    if (typeof window !== 'undefined' && (window as any).__DEBUG) {
      console.debug('[InvitePanel]', ...args);
    }
  }

  function pickString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }

  function serverInitial(inv: ServerInvite): string {
    const source = (inv.serverName ?? inv.serverId ?? '').trim();
    return source ? source[0]!.toUpperCase() : '#';
  }

  function abbreviateUid(uid: string): string {
    return uid.length > 12 ? `${uid.slice(0, 6)}…${uid.slice(-4)}` : uid;
  }

  async function loadServerMeta(force = false) {
    if (!serverId) return;
    if (!force && metaLoadedFor === serverId) return;

    const db = getDb();
    const sRef = doc(db, 'servers', serverId);
    const s = await getDoc(sRef);

    if (s.exists()) {
      const data = s.data() as any;
      serverName = data.name ?? serverId;
      serverIcon = data.icon ?? null;

      const me = $user?.uid;
      if (me) {
        isOwner = data.owner === me;
        const memRef = doc(db, 'servers', serverId, 'members', me);
        const mem = await getDoc(memRef);
        const role = mem.exists() ? (mem.data() as any).role : null;
        isAdmin = role === 'admin' || role === 'owner';
      } else {
        isOwner = false;
        isAdmin = false;
      }
    } else {
      serverName = serverId;
      serverIcon = null;
      isOwner = false;
      isAdmin = false;
    }

    metaLoadedFor = serverId;
    dlog('loadServerMeta', { serverId, serverName, isOwner, isAdmin });
  }

  async function ensureSenderDisplayName(inv: ServerInvite) {
    const uid = inv.fromUid;
    if (!uid) return;
    if (senderNames[uid]) return;

    const normalizedProvided = pickString(inv.fromDisplayName);
    if (normalizedProvided) {
      senderNames = { ...senderNames, [uid]: normalizedProvided };
      return;
    }

    if (pendingSenderLoads.has(uid)) return;
    pendingSenderLoads.add(uid);
    try {
      const db = getDb();
      const profileSnap = await getDoc(doc(db, 'profiles', uid));
      let resolved: string | undefined;
      if (profileSnap.exists()) {
        const data = profileSnap.data() as any;
        resolved =
          pickString(data?.displayName) ??
          pickString(data?.name) ??
          pickString(data?.username) ??
          pickString(data?.handle);
      }
      if (!resolved && inv.serverId) {
        try {
          const memberSnap = await getDoc(doc(db, 'servers', inv.serverId, 'members', uid));
          if (memberSnap.exists()) {
            const memberData = memberSnap.data() as any;
            resolved =
              resolved ??
              pickString(memberData?.displayName) ??
              pickString(memberData?.nickname) ??
              pickString(memberData?.name) ??
              pickString(memberData?.email);
          }
        } catch (memberError) {
          dlog('ensureSenderDisplayName member lookup failed', { uid, serverId: inv.serverId, memberError });
        }
      }
      if (!resolved && $user?.uid === uid) {
        resolved = pickString($user?.displayName) ?? pickString($user?.email);
      }
      senderNames = { ...senderNames, [uid]: resolved ?? abbreviateUid(uid) };

      if (!normalizedProvided && inv.id && resolved) {
        try {
          await updateDoc(doc(db, 'invites', inv.id), { fromDisplayName: resolved });
        } catch (writeError) {
          dlog('ensureSenderDisplayName update skipped', { uid, inviteId: inv.id, writeError });
        }
      }
    } catch (error) {
      dlog('ensureSenderDisplayName error', { uid, error });
      senderNames = { ...senderNames, [uid]: abbreviateUid(uid) };
    } finally {
      pendingSenderLoads.delete(uid);
    }
  }

  async function onSendInvite() {
    inviteErr = '';
    const trimmed = trimmedCandidate;
    if (!serverId || !trimmed) return;

    const me = $user?.uid;
    if (!me) {
      inviteErr = 'You need to be signed in to send an invite.';
      return;
    }

    sending = true;
    try {
      const displayName =
        pickString($user?.displayName) ?? pickString($user?.email) ?? null;
      const res = await sendServerInvite({
        toUid: trimmed,
        fromUid: me,
        fromDisplayName: displayName,
        serverId,
        serverName,
        serverIcon
      });

      if (!res.ok) {
        inviteErr = `Invite failed: ${res.error ?? 'Unknown error'}${res.code ? ` (${res.code})` : ''}`;
        dlog('sendServerInvite failed', res);
      } else {
        dlog('sendServerInvite ok', res);
        if (displayName) {
          senderNames = { ...senderNames, [me]: displayName };
        }
      }
    } catch (error: any) {
      inviteErr = error?.message ?? 'Invite failed';
      dlog('onSendInvite error', error);
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
      dlog('acceptInvite failed', inv, res);
    } else {
      dlog('acceptInvite ok', inv);
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
      dlog('declineInvite failed', inv, res);
    } else {
      dlog('declineInvite ok', inv);
    }
  }

  onMount(async () => {
    serverId = serverId ?? $page.params.serverID ?? null;
    if (serverId) {
      await loadServerMeta(true);
    }
  });

  $: if (typeof window !== 'undefined') {
    const uid = $user?.uid ?? null;
    if (uid !== inboxUid) {
      unsubInbox?.();
      inboxUid = uid;
      if (uid) {
        unsubInbox = subscribeInbox(uid, (rows) => {
          invites = rows
            .slice()
            .sort((a, b) => {
              const ta = a.createdAt?.toMillis?.() ?? 0;
              const tb = b.createdAt?.toMillis?.() ?? 0;
              return tb - ta;
            });
        });
      } else {
        invites = [];
        unsubInbox = null;
      }
    }
  }

  $: if (typeof window !== 'undefined') {
    for (const inv of invites) {
      void ensureSenderDisplayName(inv);
    }
  }

  $: trimmedCandidate = candidateUid.trim();
  $: inviteButtonDisabled = sending || sent || !trimmedCandidate;
  $: inviteButtonLabel = sent ? 'Sent' : sending ? 'Sending...' : 'Invite';
  $: canInviteByUid = Boolean(serverId && (isOwner || isAdmin));

  $: if (serverId) {
    loadServerMeta();
  }

  $: {
    unsubSent?.();
    if (serverId && trimmedCandidate) {
      unsubSent = subscribePendingInviteForUser(trimmedCandidate, serverId, (inv) => {
        sent = !!inv;
        dlog('pendingInvite subscription', {
          candidateUid: trimmedCandidate,
          serverId,
          sent,
          inv
        });
      });
    } else {
      sent = false;
      unsubSent = null;
    }
  }

  function senderLabelFor(inv: ServerInvite): string {
    const uid = inv.fromUid;
    if (!uid) return 'Unknown member';
    return senderNames[uid] ?? pickString(inv.fromDisplayName) ?? abbreviateUid(uid);
  }

  onDestroy(() => {
    unsubInbox?.();
    unsubSent?.();
  });
</script>

<div class="invite-panel" class:invite-panel--embedded={embedded}>
  {#if !embedded}
    <h2 class="invite-panel__title">Invites</h2>
  {/if}

  <section class="invite-block">
    <header class="invite-block__header">
      <h3>Your pending invites</h3>
      {#if invites.length}
        <span class="invite-badge">{invites.length}</span>
      {/if}
    </header>
    <div class="invite-block__body">
      {#if !$user}
        <p class="invite-empty">Please sign in to view your invites.</p>
      {:else if invites.length === 0}
        <p class="invite-empty">No pending invites.</p>
      {:else}
        <ul class="invite-list">
          {#each invites as inv (inv.id)}
            <li class="invite-item">
              <div class="invite-item__info">
                {#if inv.serverIcon}
                  <img alt="" src={inv.serverIcon} class="invite-item__icon" />
                {:else}
                  <div class="invite-item__icon invite-item__icon--placeholder">
                    {serverInitial(inv)}
                  </div>
                {/if}
                <div class="invite-item__meta">
                  <div class="invite-item__server">{inv.serverName ?? inv.serverId}</div>
                  {#if inv.channelName}
                    <div class="invite-item__channel">Channel: #{inv.channelName}</div>
                  {/if}
                  <div class="invite-item__from">From: {senderLabelFor(inv)}</div>
                </div>
              </div>
              <div class="invite-item__actions">
                <button type="button" class="btn btn-primary invite-button" on:click={() => onAccept(inv)}>
                  Accept
                </button>
                <button type="button" class="btn btn-ghost invite-button" on:click={() => onDecline(inv)}>
                  Decline
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>

  {#if canInviteByUid}
    <section class="invite-block">
      <header class="invite-block__header">
        <h3>Invite by UID</h3>
        {#if sent}
          <span class="invite-tag invite-tag--success">Pending</span>
        {/if}
      </header>
      <form class="invite-form" on:submit|preventDefault={onSendInvite}>
        <div class="invite-form__row">
          <input
            class="invite-input"
            placeholder="Enter user UID"
            bind:value={candidateUid}
            autocomplete="off"
          />
          <button
            type="submit"
            class="btn btn-primary invite-button invite-form__submit"
            disabled={inviteButtonDisabled}
          >
            {inviteButtonLabel}
          </button>
        </div>
        {#if inviteErr}
          <p class="invite-form__error">{inviteErr}</p>
        {/if}
        <p class="invite-form__hint">Share the user's UID to send them an invite instantly.</p>
      </form>
    </section>
  {/if}
</div>

<style>
  .invite-panel {
    display: grid;
    gap: 1.5rem;
  }

  .invite-panel--embedded {
    gap: 1.1rem;
  }

  .invite-panel__title {
    margin: 0;
    font-size: 1.35rem;
    font-weight: 600;
  }

  .invite-block {
    display: grid;
    gap: 1rem;
    border-radius: var(--radius-md);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    background: color-mix(in srgb, var(--color-panel) 55%, transparent);
    padding: 1rem 1.1rem;
  }

  .invite-panel--embedded .invite-block {
    border: none;
    background: transparent;
    padding: 0;
    gap: 0.9rem;
  }

  .invite-block__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .invite-block__header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .invite-badge {
    border-radius: 999px;
    border: 1px solid var(--color-border-subtle);
    padding: 0.2rem 0.6rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-60);
  }

  .invite-block__body {
    display: grid;
    gap: 0.9rem;
  }

  .invite-empty {
    margin: 0;
    color: var(--text-60);
    font-size: 0.9rem;
  }

  .invite-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.75rem;
  }

  .invite-item {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: center;
    border-radius: var(--radius-md);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    background: color-mix(in srgb, var(--color-panel) 35%, transparent);
    padding: 0.75rem 0.9rem;
  }

  .invite-item__info {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex: 1 1 240px;
    min-width: 0;
  }

  .invite-item__icon {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 0.9rem;
    object-fit: cover;
    flex-shrink: 0;
    background: color-mix(in srgb, var(--color-border-subtle) 40%, transparent);
  }

  .invite-item__icon--placeholder {
    display: grid;
    place-items: center;
    font-weight: 600;
    font-size: 1rem;
    color: var(--text-50);
  }

  .invite-item__meta {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }

  .invite-item__server {
    font-weight: 600;
    color: var(--text-80);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .invite-item__channel {
    font-size: 0.8rem;
    color: var(--text-60);
  }

  .invite-item__from {
    font-size: 0.75rem;
    color: var(--text-50);
  }

  .invite-item__actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .invite-button {
    padding: 0.45rem 0.85rem;
    font-size: 0.85rem;
    line-height: 1.2;
    white-space: nowrap;
  }

  .invite-form {
    display: grid;
    gap: 0.75rem;
  }

  .invite-form__row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
  }

  .invite-input {
    flex: 1 1 240px;
    min-width: 0;
    padding: 0.55rem 0.75rem;
    border-radius: var(--radius-md);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 75%, transparent);
    background: color-mix(in srgb, var(--color-panel) 45%, transparent);
    color: inherit;
  }

  .invite-input:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 35%, transparent);
  }

  .invite-form__submit {
    flex: 0 0 auto;
  }

  .invite-form__error {
    margin: 0;
    color: color-mix(in srgb, var(--color-danger, #dc2626) 80%, white);
    font-size: 0.85rem;
  }

  .invite-form__hint {
    margin: 0;
    color: var(--text-50);
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .invite-tag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .invite-tag--success {
    background: color-mix(in srgb, var(--color-success, #16a34a) 50%, transparent);
    color: #042013;
  }

  @media (max-width: 640px) {
    .invite-item__info {
      flex: 1 1 100%;
    }

    .invite-item__actions {
      justify-content: flex-start;
    }

    .invite-form__row {
      flex-direction: column;
      align-items: stretch;
    }

    .invite-form__submit {
      width: 100%;
    }
  }
</style>
