// src/lib/db/channels.ts
import { getDb } from '$lib/firebase';
import {
  collection, doc, getDocs, serverTimestamp, setDoc
} from 'firebase/firestore';

/**
 * Create a channel under servers/{serverId}/channels
 * type: 'text' | 'voice'
 * isPrivate: boolean stored for future ACL
 */
export async function createChannel(
  serverId: string,
  name: string,
  type: 'text' | 'voice' = 'text',
  isPrivate = false
) {
  if (!serverId) throw new Error('Missing serverId');

  const db = getDb();
  const channelsCol = collection(db, 'servers', serverId, 'channels');

  // compute next position for this type
  const snap = await getDocs(channelsCol);
  let maxPos = -1;
  snap.forEach((d) => {
    const data: any = d.data();
    if (data?.type === type) {
      const p = typeof data.position === 'number' ? data.position : 0;
      if (p > maxPos) maxPos = p;
    }
  });
  const position = maxPos + 1;

  const chRef = doc(channelsCol);
  const payload =
    type === 'text'
      ? { id: chRef.id, type: 'text', name, position, topic: null, isPrivate, createdAt: serverTimestamp() }
      : { id: chRef.id, type: 'voice', name, position, bitrate: 64000, userLimit: null, isPrivate, createdAt: serverTimestamp() };

  await setDoc(chRef, payload);
  return chRef.id;
}
