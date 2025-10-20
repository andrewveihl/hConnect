import { db } from './index';
import {
  addDoc, collection, doc, getDoc, getDocs, serverTimestamp,
  setDoc, updateDoc, deleteDoc, query, orderBy, onSnapshot, type Unsubscribe
} from 'firebase/firestore';
import type { PermissionKey, Role } from './schema';

const DEFAULT_PERMS: Record<PermissionKey, boolean> = {
  manageServer: false, manageRoles: false, manageChannels: false, kickMembers: false, banMembers: false,
  viewChannels: true, sendMessages: true, manageMessages: false, connectVoice: true, speakVoice: true
};

async function upsertUserMembership(serverId: string, uid: string, data: { name: string; icon?: string|null }) {
  const database = db();
  await setDoc(doc(database, 'profiles', uid, 'servers', serverId), {
    serverId, name: data.name, icon: data.icon ?? null, joinedAt: serverTimestamp()
  }, { merge: true });
}

async function ensureOwnerPerms(serverId: string, ownerId: string) {
  // Ensure owners of legacy servers have full perms on their member doc
  const database = db();
  const memRef = doc(database, 'servers', serverId, 'members', ownerId);
  const mem = await getDoc(memRef);
  if (!mem.exists()) return;
  const data = mem.data() as any;
  if (!data.perms) {
    await updateDoc(memRef, {
      perms: {
        viewChannels: true, sendMessages: true, manageMessages: true,
        manageServer: true, manageRoles: true, manageChannels: true,
        connectVoice: true, speakVoice: true
      }
    });
  }
}

export async function createServer(params: {
  ownerId: string; name: string; isPublic: boolean; icon?: string | null;
}) {
  const database = db();
  const serverRef = await addDoc(collection(database, 'servers'), {
    name: params.name,
    ownerId: params.ownerId,
    isPublic: params.isPublic,
    icon: params.icon ?? null,
    createdAt: serverTimestamp(),
    systemChannelId: null,
    defaultRoleId: null
  });
  const serverId = serverRef.id;

  // roles
  const rolesCol = collection(database, 'servers', serverId, 'roles');
  const everyoneRef = doc(rolesCol);
  const adminRef = doc(rolesCol);

  const everyone: Role = {
    id: everyoneRef.id, name: 'Everyone', color: null, position: 0,
    permissions: { ...DEFAULT_PERMS }
  };
  const admin: Role = {
    id: adminRef.id, name: 'Admin', color: null, position: 100,
    permissions: { ...DEFAULT_PERMS, manageServer: true, manageRoles: true, manageChannels: true, manageMessages: true }
  };
  await Promise.all([ setDoc(everyoneRef, everyone), setDoc(adminRef, admin) ]);

  // owner is member (with full perms for rules)
  await setDoc(doc(database, 'servers', serverId, 'members', params.ownerId), {
    roleIds: [admin.id, everyone.id],
    nickname: null, joinedAt: serverTimestamp(), muted: false, deafened: false,
    perms: {
      viewChannels: true, sendMessages: true, manageMessages: true,
      manageServer: true, manageRoles: true, manageChannels: true,
      connectVoice: true, speakVoice: true
    }
  });

  // default channels
  const channelsCol = collection(database, 'servers', serverId, 'channels');
  const generalRef = doc(channelsCol);
  await setDoc(generalRef, {
    id: generalRef.id, type: 'text', name: 'general', position: 0, topic: 'Welcome!', createdAt: serverTimestamp()
  });
  const voiceRef = doc(channelsCol);
  await setDoc(voiceRef, {
    id: voiceRef.id, type: 'voice', name: 'General', position: 1, bitrate: 64000, userLimit: null, createdAt: serverTimestamp()
  });

  await updateDoc(serverRef, { systemChannelId: generalRef.id, defaultRoleId: everyone.id });

  // membership map for rail
  await upsertUserMembership(serverId, params.ownerId, { name: params.name, icon: params.icon ?? null });

  return serverId;
}

/** Owner-only hard delete (and clean up owner’s rail mapping) */
export async function deleteServer(serverId: string, ownerId: string) {
  const database = db();

  // shallow cleanup (prod: use Cloud Function to recurse)
  const chSnap = await getDocs(collection(database, 'servers', serverId, 'channels'));
  for (const ch of chSnap.docs) {
    const msgs = await getDocs(collection(database, 'servers', serverId, 'channels', ch.id, 'messages'));
    for (const m of msgs.docs) await deleteDoc(m.ref);
    await deleteDoc(ch.ref);
  }
  const memSnap = await getDocs(collection(database, 'servers', serverId, 'members'));
  for (const m of memSnap.docs) await deleteDoc(m.ref);
  const rolesSnap = await getDocs(collection(database, 'servers', serverId, 'roles'));
  for (const r of rolesSnap.docs) await deleteDoc(r.ref);

  await deleteDoc(doc(database, 'servers', serverId));
  await deleteDoc(doc(database, 'profiles', ownerId, 'servers', serverId));
}
export function subscribeUserServers(
  uid: string,
  cb: (rows: { id: string; name: string; icon?: string | null }[]) => void
): Unsubscribe {
  const database = db();
  const q = query(collection(database, 'profiles', uid, 'servers'), orderBy('joinedAt', 'desc'));

  let current: Record<string, { id: string; name: string; icon?: string | null }> = {};
  let serverUnsubs: Record<string, () => void> = {};
  const emit = () => cb(Object.values(current));

  async function verifyAndMaybePurge(serverId: string) {
    // 1) Try to read the server doc
    try {
      const s = await getDoc(doc(database, 'servers', serverId));
      if (s.exists()) return true; // valid
    } catch (_) {
      // permission denied is fine; check membership next
    }

    // 2) If we cannot read the server doc (private), check membership
    try {
      const m = await getDoc(doc(database, 'servers', serverId, 'members', uid));
      if (m.exists()) return true; // still a valid member
    } catch (_) {
      // if we can't read membership either, treat as invalid
    }

    // 3) Invalid → delete mapping and drop from rail
    try { await deleteDoc(doc(database, 'profiles', uid, 'servers', serverId)); } catch {}
    delete current[serverId];
    emit();
    return false;
  }

  const stop = onSnapshot(q, (snap) => {
    const seen: Record<string, true> = {};

    // Add/update visible entries from the mapping
    for (const d of snap.docs) {
      const id = d.id;
      seen[id] = true;
      const data = d.data() as any;
      current[id] = { id, name: data.name, icon: data.icon ?? null };

      // Start a watcher for the server doc to react to hard-deletes
      if (!serverUnsubs[id]) {
        serverUnsubs[id] = onSnapshot(
          doc(database, 'servers', id),
          // next: if it vanishes, double-check membership and purge if needed
          (sv) => { if (!sv.exists()) void verifyAndMaybePurge(id); },
          // error (permission denied): verify via membership, purge if invalid
          () => { void verifyAndMaybePurge(id); }
        );
        // Also run an immediate verify so stale entries drop right away
        void verifyAndMaybePurge(id);
      }
    }

    // Clean up watchers for mappings that were removed
    for (const id in serverUnsubs) {
      if (!seen[id]) {
        serverUnsubs[id](); delete serverUnsubs[id];
        delete current[id];
      }
    }

    emit();
  });

  return () => {
    stop();
    for (const k in serverUnsubs) {
      serverUnsubs[k]();
    }
  };
}
