import { getDb } from '$lib/firebase';
import {
  collection, addDoc, serverTimestamp, onSnapshot, query, orderBy, type Unsubscribe
} from 'firebase/firestore';

export type Message = { authorUid: string; text: string; createdAt: any };

export async function sendChannelMessage(serverId: string, channelId: string, uid: string, text: string) {
  const db = getDb();
  await addDoc(collection(db, 'servers', serverId, 'channels', channelId, 'messages'), {
    authorUid: uid, text, createdAt: serverTimestamp()
  } satisfies Message);
}

export function subscribeChannelMessages(serverId: string, channelId: string, cb: (msgs: (Message & {id:string})[]) => void): Unsubscribe {
  const db = getDb();
  const q = query(collection(db, 'servers', serverId, 'channels', channelId, 'messages'), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))));
}
