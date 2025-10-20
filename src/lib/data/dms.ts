import { getDb } from '$lib/firebase';
import {
  collection, query, where, getDocs, addDoc, serverTimestamp,
  onSnapshot, orderBy, type Unsubscribe, doc, setDoc
} from 'firebase/firestore';

export async function ensureDmThread(me: string, other: string) {
  const db = getDb();
  const q = query(collection(db, 'dmThreads'), where('members', 'array-contains', me));
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    const members = (d.data() as any).members || [];
    if (members.includes(other)) return d.id;
  }
  const ref = await addDoc(collection(db, 'dmThreads'), {
    members: [me, other],
    createdAt: serverTimestamp()
  });
  return ref.id;
}

export async function sendDm(threadId: string, uid: string, text: string) {
  const db = getDb();
  await addDoc(collection(db, 'dmThreads', threadId, 'messages'), {
    authorUid: uid, text, createdAt: serverTimestamp()
  });
}

export function subscribeDmMessages(threadId: string, cb: (rows: any[]) => void): Unsubscribe {
  const db = getDb();
  const q = query(collection(db, 'dmThreads', threadId, 'messages'), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))));
}

// optional: public profile
export async function ensureProfile(uid: string, profile: { name: string|null; photoURL: string|null; email: string|null }) {
  const db = getDb();
  await setDoc(doc(db, 'profiles', uid), { ...profile }, { merge: true });
}
