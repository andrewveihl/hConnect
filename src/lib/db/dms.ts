import { db } from './index';
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

function threadIdFor(a: string, b: string) { return [a, b].sort().join('_'); }

export async function openDmThread(uida: string, uidb: string) {
  const database = db();
  const id = threadIdFor(uida, uidb);
  const ref = doc(database, 'dms', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { participants: [uida, uidb].sort(), createdAt: serverTimestamp(), lastMessageAt: serverTimestamp() });
  }
  return id;
}

export async function sendDmMessage(threadId: string, authorId: string, content: string) {
  const database = db();
  const gifUrl = content.trim().match(/https?:\/\/\S+\.gif(\?\S+)?$/i)?.[0] ?? null;
  return addDoc(collection(database, 'dms', threadId, 'messages'), {
    authorId, content, gifUrl, createdAt: serverTimestamp(), editedAt: null, deleted: false
  });
}
