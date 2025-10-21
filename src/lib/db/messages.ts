// Robust writer: ensures fields your UI expects are present.
// Works with your existing import: `import { sendChannelMessage } from '$lib/db/messages';`
import { getDb } from '$lib/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

export async function sendChannelMessage(
  serverId: string,
  channelId: string,
  uid: string,
  text: string
) {
  const db = getDb();
  const clean = text.trim();
  if (!clean) return;

  // Write with overlapping field names so old/new readers see it:
  // - text + content
  // - uid + authorId
  // - createdAt (for orderBy)
  const payload = {
    text: clean,
    content: clean,
    uid,
    authorId: uid,
    createdAt: serverTimestamp()
  };

  await addDoc(
    collection(db, 'servers', serverId, 'channels', channelId, 'messages'),
    payload
  );
}
