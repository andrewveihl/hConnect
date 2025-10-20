import { db } from './index';
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';

export async function createTextChannel(serverId: string, name: string, position = 0, topic: string|null = null) {
  const database = db();
  const ch = doc(collection(database, 'servers', serverId, 'channels'));
  await setDoc(ch, { id: ch.id, type: 'text', name, position, topic, createdAt: serverTimestamp() });
  return ch.id;
}

export async function createVoiceChannel(serverId: string, name: string, position = 0, bitrate: number|null = 64000, userLimit: number|null = null) {
  const database = db();
  const ch = doc(collection(database, 'servers', serverId, 'channels'));
  await setDoc(ch, { id: ch.id, type: 'voice', name, position, bitrate, userLimit, createdAt: serverTimestamp() });
  return ch.id;
}
