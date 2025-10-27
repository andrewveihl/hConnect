// src/lib/db/channels.ts
import { getDb } from '$lib/firebase';
import { collection, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';

export async function createChannel(
  serverId: string,
  name: string,
  type: 'text' | 'voice' = 'text',
  isPrivate = false
) {
  const db = getDb();
  const channelsCol = collection(db, 'servers', serverId, 'channels');

  // compute next position
  const snap = await getDocs(channelsCol);
  let maxPos = -1;
  snap.forEach((d) => {
    const p = (d.data() as any).position ?? 0;
    if (typeof p === 'number' && p > maxPos) maxPos = p;
  });
  const position = maxPos + 1;

  const chRef = doc(channelsCol);
  const payload =
    type === 'text'
      ? { id: chRef.id, type: 'text', name, position, topic: null, isPrivate, allowedRoleIds: [], createdAt: serverTimestamp() }
      : { id: chRef.id, type: 'voice', name, position, bitrate: 64000, userLimit: null, isPrivate, allowedRoleIds: [], createdAt: serverTimestamp() };

  await setDoc(chRef, payload);
  return chRef.id;
}
