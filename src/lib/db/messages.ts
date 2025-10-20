import { db } from './index';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

export async function sendChannelMessage(serverId: string, channelId: string, authorId: string, content: string) {
  const database = db();
  const gifUrl = content.trim().match(/https?:\/\/\S+\.gif(\?\S+)?$/i)?.[0] ?? null;
  return addDoc(collection(database, 'servers', serverId, 'channels', channelId, 'messages'), {
    authorId, content, gifUrl, attachments: [], createdAt: serverTimestamp(), editedAt: null, deleted: false
  });
}
