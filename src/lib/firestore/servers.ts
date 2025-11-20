// src/lib/db/servers.ts
// Purpose: server creation, membership helpers, rail mapping (LeftPane), subscriptions
// Debugging is loud: set window.__DEBUG = true to see extra logs

import { getDb } from '$lib/firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe
} from 'firebase/firestore';

type PermissionKey =
  | 'manageServer'
  | 'manageRoles'
  | 'manageChannels'
  | 'kickMembers'
  | 'banMembers'
  | 'reorderChannels'
  | 'viewChannels'
  | 'sendMessages'
  | 'manageMessages'
  | 'connectVoice'
  | 'speakVoice';

type RoleDoc = {
  id: string;
  name: string;
  color: string | null;
  position: number;
  permissions: Record<PermissionKey, boolean>;
};

export type RoleName = 'owner' | 'admin' | 'member';

export type ServerDoc = {
  id?: string;
  name: string;
  icon?: string | null;
  emoji?: string | null;
  owner: string;
  isPublic?: boolean;
  createdAt: any;
  systemChannelId?: string | null;
  defaultRoleId?: string | null;
};

const DEFAULT_PERMS: Record<PermissionKey, boolean> = {
  manageServer: false,
  manageRoles: false,
  manageChannels: false,
  kickMembers: false,
  banMembers: false,
  reorderChannels: false,
  viewChannels: true,
  sendMessages: true,
  manageMessages: false,
  connectVoice: true,
  speakVoice: true,
};

function dlog(...args: any[]) {
  if (typeof window !== 'undefined' && (window as any).__DEBUG) {
    console.debug('[servers.ts]', ...args);
  }
}

/**
 * Rail mapping so the server appears in the user’s LeftPane.
 */
export async function upsertUserMembership(
  serverId: string,
  uid: string,
  data: { name: string; icon?: string | null; position?: number }
) {
  const db = getDb();
  dlog('upsertUserMembership', { serverId, uid, data });
  await setDoc(
    doc(db, 'profiles', uid, 'servers', serverId),
    {
      serverId,
      name: data.name,
      icon: data.icon ?? null,
      joinedAt: serverTimestamp(),
      position: typeof data.position === 'number' ? data.position : -Date.now()
    },
    { merge: true }
  );
}

export async function removeUserMembership(serverId: string, uid: string) {
  const db = getDb();
  dlog('removeUserMembership', { serverId, uid });
  try {
    await deleteDoc(doc(db, 'profiles', uid, 'servers', serverId));
  } catch (err) {
    console.warn('[servers.ts] removeUserMembership failed', err);
  }
}

/**
 * Idempotently add a user to a server’s members subcollection.
 */
export async function addMemberToServer(
  serverId: string,
  uid: string,
  extra: { role?: RoleName } = {}
) {
  const db = getDb();
  const memRef = doc(db, 'servers', serverId, 'members', uid);
  const snap = await getDoc(memRef);
  dlog('addMemberToServer: exists?', snap.exists());

  if (!snap.exists()) {
    await setDoc(memRef, {
      uid,
      role: extra.role ?? ('member' as RoleName),
      nickname: null,
      joinedAt: serverTimestamp(),
      muted: false,
      deafened: false,
      perms: {
        ...DEFAULT_PERMS,
      },
    });
  } else if (extra.role) {
    await setDoc(memRef, { role: extra.role }, { merge: true });
  }
}

/**
 * Convenience wrapper to add the member AND rail-map them.
 */
export async function joinServer(serverId: string, uid: string) {
  const db = getDb();
  const sRef = doc(db, 'servers', serverId);
  const s = await getDoc(sRef);
  if (!s.exists()) throw new Error('Server not found');

  const data = s.data() as ServerDoc;
  dlog('joinServer', { serverId, uid, serverName: data.name });

  await addMemberToServer(serverId, uid, { role: 'member' });
  await upsertUserMembership(serverId, uid, { name: data.name, icon: (data as any).icon ?? null });
}

/**
 * Create server: default roles, default channels, owner membership, rail map
 */
export async function createServer(
  uid: string,
  data: { name: string; emoji?: string | null; icon?: string | null; isPublic?: boolean }
) {
  const db = getDb();

  const serverRef = doc(collection(db, 'servers'));
  await setDoc(serverRef, {
    name: data.name,
    emoji: data.emoji ?? null,
    icon: data.icon ?? null,
    owner: uid,
    isPublic: !!data.isPublic,
    createdAt: serverTimestamp(),
    systemChannelId: null,
    defaultRoleId: null,
  });

  // Roles
  const rolesCol = collection(db, 'servers', serverRef.id, 'roles');
  const everyoneRef = doc(rolesCol);
  const adminRef = doc(rolesCol);

  const everyone: RoleDoc = {
    id: everyoneRef.id,
    name: 'Everyone',
    color: null,
    position: 0,
    permissions: { ...DEFAULT_PERMS },
  };
  const admin: RoleDoc = {
    id: adminRef.id,
    name: 'Admin',
    color: null,
    position: 100,
    permissions: {
      ...DEFAULT_PERMS,
      manageServer: true,
      manageRoles: true,
      manageChannels: true,
      manageMessages: true,
      reorderChannels: true,
      kickMembers: true,
      banMembers: true,
    },
  };

  await Promise.all([setDoc(everyoneRef, everyone), setDoc(adminRef, admin)]);

  // Owner as member with full perms
  await setDoc(doc(db, 'servers', serverRef.id, 'members', uid), {
    uid,
    role: 'owner' as RoleName,
    roleIds: [admin.id, everyone.id],
    nickname: null,
    joinedAt: serverTimestamp(),
    muted: false,
    deafened: false,
    perms: {
      ...DEFAULT_PERMS,
      manageServer: true,
      manageRoles: true,
      manageChannels: true,
      manageMessages: true,
      reorderChannels: true,
    },
  });

  // Default channels
  const channelsCol = collection(db, 'servers', serverRef.id, 'channels');
  const generalRef = doc(channelsCol);
  await setDoc(generalRef, {
    id: generalRef.id,
    type: 'text',
    name: 'general',
    position: 0,
    topic: 'Welcome!',
    createdAt: serverTimestamp(),
  });
  const voiceRef = doc(channelsCol);
  await setDoc(voiceRef, {
    id: voiceRef.id,
    type: 'voice',
    name: 'General',
    position: 1,
    bitrate: 64000,
    userLimit: null,
    createdAt: serverTimestamp(),
  });

  await updateDoc(serverRef, { systemChannelId: generalRef.id, defaultRoleId: everyone.id });

  // Rail mapping
  await upsertUserMembership(serverRef.id, uid, { name: data.name, icon: data.icon ?? null });

  dlog('createServer complete', { serverId: serverRef.id });
  return serverRef.id;
}

/**
 * Hard delete server (shallow – use CF for full cascade in prod)
 */
export async function deleteServer(serverId: string, ownerId: string) {
  const db = getDb();

  const chSnap = await getDocs(collection(db, 'servers', serverId, 'channels'));
  for (const ch of chSnap.docs) {
    const msgs = await getDocs(collection(db, 'servers', serverId, 'channels', ch.id, 'messages'));
    for (const m of msgs.docs) await deleteDoc(m.ref);
    await deleteDoc(ch.ref);
  }

  const memSnap = await getDocs(collection(db, 'servers', serverId, 'members'));
  for (const m of memSnap.docs) await deleteDoc(m.ref);

  const rolesSnap = await getDocs(collection(db, 'servers', serverId, 'roles'));
  for (const r of rolesSnap.docs) await deleteDoc(r.ref);

  await deleteDoc(doc(db, 'servers', serverId));
  await deleteDoc(doc(db, 'profiles', ownerId, 'servers', serverId));

  dlog('deleteServer complete', { serverId });
}

/**
 * Left rail: subscribe to “profiles/{uid}/servers” mapping
 */
export function subscribeUserServers(
  uid: string,
  cb: (rows: { id: string; name: string; icon?: string | null; position?: number | null; joinedAt?: number | null }[]) => void
): Unsubscribe {
  const db = getDb();
  const q = query(collection(db, 'profiles', uid, 'servers'), orderBy('joinedAt', 'desc'));

  let current: Record<
    string,
    { id: string; name: string; icon?: string | null; position: number | null; joinedAt: number | null }
  > = {};
  let serverUnsubs: Record<string, () => void> = {};
  let membershipUnsubs: Record<string, () => void> = {};
  let initializingPositions = false;
  const sortServers = (
    a: { position: number | null; joinedAt: number | null },
    b: { position: number | null; joinedAt: number | null }
  ) => {
    if (a.position != null && b.position != null && a.position !== b.position) {
      return a.position - b.position;
    }
    if (a.position != null && b.position == null) return -1;
    if (b.position != null && a.position == null) return 1;
    const aJoin = a.joinedAt ?? 0;
    const bJoin = b.joinedAt ?? 0;
    return bJoin - aJoin;
  };
  const emit = () => {
    const values = Object.values(current).sort(sortServers);
    cb(values);
  };

  const toMillis = (value: any): number | null => {
    if (!value) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value?.toMillis === 'function') {
      return value.toMillis();
    }
    if (value instanceof Date) return value.getTime();
    return null;
  };

  async function backfillPositions() {
    if (initializingPositions) return;
    initializingPositions = true;
    try {
      const ordered = Object.values(current)
        .sort((a, b) => (b.joinedAt ?? 0) - (a.joinedAt ?? 0))
        .map((row, index) => ({ id: row.id, position: index * 10 }));
      if (!ordered.length) return;
      const batch = writeBatch(db);
      ordered.forEach((row) => {
        batch.update(doc(db, 'profiles', uid, 'servers', row.id), { position: row.position });
        current[row.id] = { ...current[row.id], position: row.position };
      });
      await batch.commit();
    } catch (err) {
      dlog('backfillPositions error', err);
    } finally {
      initializingPositions = false;
    }
  }

  async function verifyAndMaybePurge(serverId: string) {
    let membershipChecked = false;
    let membershipExists = false;
    try {
      const membership = await getDoc(doc(db, 'servers', serverId, 'members', uid));
      membershipChecked = true;
      membershipExists = membership.exists();
      if (membershipExists) return true;
    } catch (err) {
      dlog('verifyAndMaybePurge membership check failed', { serverId, err });
    }

    let serverExists = false;
    try {
      const serverSnap = await getDoc(doc(db, 'servers', serverId));
      serverExists = serverSnap.exists();
    } catch (err) {
      dlog('verifyAndMaybePurge server check failed', { serverId, err });
    }

    if (!serverExists || membershipChecked) {
      await cleanupServerEntry(serverId);
      return false;
    }

    return true;
  }

  async function cleanupServerEntry(serverId: string) {
    try {
      membershipUnsubs[serverId]?.();
      delete membershipUnsubs[serverId];
    } catch {}
    try {
      serverUnsubs[serverId]?.();
      delete serverUnsubs[serverId];
    } catch {}
    try {
      await deleteDoc(doc(db, 'profiles', uid, 'servers', serverId));
    } catch (err) {
      dlog('cleanupServerEntry delete doc failed', { serverId, err });
    }
    delete current[serverId];
    emit();
  }

  const stop = onSnapshot(q, (snap) => {
    const seen: Record<string, true> = {};
    let needsPositionBackfill = false;
    for (const d of snap.docs) {
      const id = d.id;
      seen[id] = true;
      const data = d.data() as any;
      const position =
        typeof data.position === 'number'
          ? data.position
          : data.position === null
            ? null
            : null;
      if (position === null) needsPositionBackfill = true;
      const joinedAt = toMillis(data.joinedAt) ?? null;
      current[id] = { id, name: data.name, icon: data.icon ?? null, position, joinedAt };

      if (!serverUnsubs[id]) {
        const serverRef = doc(db, 'servers', id);
        serverUnsubs[id] = onSnapshot(
          serverRef,
          (sv) => {
            if (!sv.exists()) {
              void verifyAndMaybePurge(id);
              return;
            }
            const payload = sv.data() as any;
            const existing =
              current[id] ?? { id, name: payload?.name ?? 'Server', icon: null, position: null, joinedAt: null };
            current[id] = {
              ...existing,
              name: payload?.name ?? existing.name,
              icon: payload?.icon ?? existing.icon ?? null
            };
            emit();
          },
          () => {
            void verifyAndMaybePurge(id);
          }
        );
        void verifyAndMaybePurge(id);

        const membershipRef = doc(db, 'servers', id, 'members', uid);
        membershipUnsubs[id] = onSnapshot(
          membershipRef,
          (mem) => {
            if (!mem.exists()) {
              void verifyAndMaybePurge(id);
            }
          },
          () => {
            void verifyAndMaybePurge(id);
          }
        );
      }
    }
    for (const id in serverUnsubs) {
      if (!seen[id]) {
        serverUnsubs[id]!();
        delete serverUnsubs[id];
        membershipUnsubs[id]?.();
        delete membershipUnsubs[id];
        delete current[id];
      }
    }
    emit();
    if (needsPositionBackfill) {
      void backfillPositions();
    }
  });

  return () => {
    stop();
    for (const k in serverUnsubs) serverUnsubs[k]!();
    for (const k in membershipUnsubs) membershipUnsubs[k]!();
  };
}

export async function saveServerOrder(uid: string, serverIds: string[]) {
  const db = getDb();
  const batch = writeBatch(db);
  serverIds.forEach((serverId, index) => {
    batch.update(doc(db, 'profiles', uid, 'servers', serverId), { position: index * 10 });
  });
  await batch.commit();
}


