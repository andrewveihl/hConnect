// src/lib/firestore/invites.ts
// Centralized invites with dedupe and verbose debugging.

import { getDb } from '$lib/firebase';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { joinServer, upsertUserMembership } from './servers';

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'canceled';

export type ServerInvite = {
  id?: string;
  toUid: string;
  fromUid: string;
  fromDisplayName?: string | null;
  serverId: string;
  serverName?: string | null;
  serverIcon?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  type?: string | null;
  status: InviteStatus;
  createdAt: any;
};

function dlog(...args: any[]) {
  if (typeof window !== 'undefined' && (window as any).__DEBUG) {
    console.debug('[invites.ts]', ...args);
  }
}

function invitesCol() {
  return collection(getDb(), 'invites');
}

function inviteDoc(serverId: string, toUid: string) {
  return doc(invitesCol(), `${serverId}__${toUid}`);
}

export async function sendServerInvite(params: {
  toUid: string;
  fromUid: string;
  fromDisplayName?: string | null;
  serverId: string;
  serverName?: string | null;
  serverIcon?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  type?: string | null;
}) {
  const {
    toUid,
    fromUid,
    fromDisplayName = null,
    serverId,
    serverName = null,
    serverIcon = null,
    channelId = null,
    channelName = null,
    type = 'channel',
  } = params;

  const payload = {
    toUid,
    fromUid,
    fromDisplayName,
    serverId,
    serverName,
    serverIcon,
    channelId,
    channelName,
    type: type ?? 'channel',
    status: 'pending' as InviteStatus,
    createdAt: serverTimestamp(),
  };

  const invRef = inviteDoc(serverId, toUid);

  try {
    await setDoc(invRef, payload);
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      console.warn('[invites.ts] sendServerInvite: invite already exists', { serverId, toUid });
      return { ok: true, inviteId: invRef.id, alreadyExisted: true as const };
    }

    console.error('[invites.ts] sendServerInvite error', err);
    return { ok: false, error: err?.message ?? 'Failed to send invite', code: err?.code };
  }

  dlog('sendServerInvite: created', invRef.id);
  return { ok: true, inviteId: invRef.id };
}

/** Live one-pending-invite watcher for a specific (toUid, serverId) pair. */
export function subscribePendingInviteForUser(
  toUid: string,
  serverId: string,
  cb: (invite: ServerInvite | null) => void
): Unsubscribe {
  const qy = query(
    invitesCol(),
    where('toUid', '==', toUid),
    where('serverId', '==', serverId),
    where('status', '==', 'pending'),
    limit(1)
  );
  dlog('subscribePendingInviteForUser start', { toUid, serverId });
  return onSnapshot(
    qy,
    (snap) => {
      const d = snap.docs[0];
      const inv = d ? ({ id: d.id, ...(d.data() as any) } as ServerInvite) : null;
      dlog('subscribePendingInviteForUser snapshot', inv);
      cb(inv);
    },
    (err) => {
      console.error('[invites.ts] subscribePendingInviteForUser error', err);
      cb(null);
    }
  );
}

/** Inbox: invites to me with status=pending */
export function subscribeInbox(uid: string, cb: (invites: ServerInvite[]) => void): Unsubscribe {
  const qy = query(invitesCol(), where('toUid', '==', uid), where('status', '==', 'pending'));
  dlog('subscribeInbox start', { uid });
  return onSnapshot(
    qy,
    (snap) => {
      const rows: ServerInvite[] = [];
      snap.forEach((d) => rows.push({ id: d.id, ...(d.data() as any) }));
      dlog('subscribeInbox snapshot', rows);
      cb(rows);
    },
    (err) => {
      console.error('[invites.ts] subscribeInbox error', err);
      cb([]);
    }
  );
}

/** Accept invite: join server + rail map + mark accepted */
export async function acceptInvite(inviteId: string, actingUid: string) {
  const db = getDb();
  const ref = doc(db, 'invites', inviteId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ok: false, error: 'Invite not found' };

  const inv = snap.data() as ServerInvite;
  if (inv.toUid !== actingUid) return { ok: false, error: 'Not authorized to accept' };
  if (inv.status !== 'pending') return { ok: false, error: `Invite is ${inv.status}` };

  try {
    await joinServer(inv.serverId, actingUid);
    // extra safety: in case joinServer is modified later
    await upsertUserMembership(inv.serverId, actingUid, {
      name: inv.serverName ?? inv.serverId,
      icon: inv.serverIcon ?? null,
    });

    await updateDoc(ref, { status: 'accepted' as InviteStatus, acceptedAt: serverTimestamp() });
    await deleteDoc(ref).catch(() => {});
    dlog('acceptInvite ok', inviteId);
    return { ok: true };
  } catch (err: any) {
    console.error('[invites.ts] acceptInvite error', err);
    return { ok: false, error: err?.message ?? 'Failed to accept invite', code: err?.code };
  }
}

/** Decline invite */
export async function declineInvite(inviteId: string, actingUid: string) {
  const db = getDb();
  const ref = doc(db, 'invites', inviteId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ok: false, error: 'Invite not found' };

  const inv = snap.data() as ServerInvite;
  if (inv.toUid !== actingUid) return { ok: false, error: 'Not authorized to decline' };
  if (inv.status !== 'pending') return { ok: false, error: `Invite is ${inv.status}` };

  try {
    await deleteDoc(ref);
    dlog('declineInvite ok', inviteId);
    return { ok: true };
  } catch (err: any) {
    console.error('[invites.ts] declineInvite error', err);
    return { ok: false, error: err?.message ?? 'Failed to decline invite', code: err?.code };
  }
}
