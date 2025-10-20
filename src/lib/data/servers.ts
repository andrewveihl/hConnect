import { getDb } from '$lib/firebase';
import {
  collection, doc, setDoc, addDoc, getDoc, updateDoc, deleteDoc,
  serverTimestamp, onSnapshot, query, where, orderBy, type Unsubscribe
} from 'firebase/firestore';

export type Role = 'owner' | 'admin' | 'member';
export type ServerDoc = { name: string; emoji?: string | null; owner: string; createdAt: any };

export async function createServer(uid: string, data: { name: string; emoji?: string }) {
  const db = getDb();
  const serverRef = doc(collection(db, 'servers'));
  await setDoc(serverRef, {
    name: data.name,
    emoji: data.emoji ?? null,
    owner: uid,
    createdAt: serverTimestamp()
  } satisfies ServerDoc);
  await setDoc(doc(db, 'servers', serverRef.id, 'members', uid), {
    role: 'owner' as Role,
    addedAt: serverTimestamp()
  });
  await setDoc(doc(db, 'servers', serverRef.id, 'channels', 'general'), {
    name: 'general', kind: 'text', createdAt: serverTimestamp(), createdBy: uid
  });
  return serverRef.id;
}

export async function deleteServer(serverId: string) {
  const db = getDb();
  await deleteDoc(doc(db, 'servers', serverId)); // NOTE: subcollections require a CFN to cascade in prod
}

export function subscribeMemberServers(uid: string, cb: (rows: { id: string; name: string; emoji?: string|null }[]) => void): Unsubscribe {
  const db = getDb();
  const q = query(collection(db, 'servers'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, async (snap) => {
    const out: any[] = [];
    for (const d of snap.docs) {
      const m = await getDoc(doc(db, 'servers', d.id, 'members', uid));
      if (m.exists()) out.push({ id: d.id, ...(d.data() as any) });
    }
    cb(out);
  });
}

export async function setMemberRole(serverId: string, targetUid: string, role: Role) {
  const db = getDb();
  await setDoc(doc(db, 'servers', serverId, 'members', targetUid), { role, updatedAt: serverTimestamp() }, { merge: true });
}

export async function createChannel(serverId: string, uid: string, name: string) {
  const db = getDb();
  const ref = doc(collection(db, 'servers', serverId, 'channels'));
  await setDoc(ref, { name, kind: 'text', createdAt: serverTimestamp(), createdBy: uid });
  return ref.id;
}

export async function inviteByEmail(serverId: string, adminUid: string, recipientEmail: string) {
  const db = getDb();
  await addDoc(collection(db, 'servers', serverId, 'invites'), {
    recipientEmail: recipientEmail.toLowerCase(),
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    status: 'pending'
  });
}
