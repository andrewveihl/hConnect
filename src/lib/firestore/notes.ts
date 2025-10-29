// src/lib/db/notes.ts
import { getDb } from '$lib/firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe
} from 'firebase/firestore';

export type NoteDoc = {
  id?: string;
  title: string;
  content: string;
  color?: string | null;
  pinned?: boolean;
  archived?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

function notesCol(uid: string) {
  const db = getDb();
  return collection(db, 'profiles', uid, 'notes');
}

export function subscribeNotes(
  uid: string,
  cb: (notes: NoteDoc[]) => void
): Unsubscribe {
  // Use a single orderBy to avoid composite index requirements; sort pinned client-side
  const q = query(notesCol(uid), orderBy('updatedAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as NoteDoc[];
      const visible = all.filter((n) => !n.archived);
      const pinned: NoteDoc[] = [];
      const others: NoteDoc[] = [];
      for (const n of visible) (n.pinned ? pinned : others).push(n);
      cb([...pinned, ...others]);
    },
    (err) => {
      console.error('subscribeNotes failed:', err);
      cb([]);
    }
  );
}

export async function addNote(uid: string, data: Partial<NoteDoc>) {
  const now = serverTimestamp();
  await addDoc(notesCol(uid), {
    title: data.title ?? '',
    content: data.content ?? '',
    color: data.color ?? null,
    pinned: !!data.pinned,
    archived: !!data.archived,
    createdAt: now,
    updatedAt: now
  });
}

export async function updateNote(uid: string, id: string, patch: Partial<NoteDoc>) {
  const db = getDb();
  await updateDoc(doc(db, 'profiles', uid, 'notes', id), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

export async function setNote(uid: string, id: string, data: Partial<NoteDoc>) {
  const db = getDb();
  await setDoc(doc(db, 'profiles', uid, 'notes', id), {
    ...data,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export async function deleteNote(uid: string, id: string) {
  const db = getDb();
  await deleteDoc(doc(db, 'profiles', uid, 'notes', id));
}
