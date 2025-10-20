import { getFirebase } from '$lib/firebase';
import { getFirestore } from 'firebase/firestore';

export function db() {
  const { app } = getFirebase();
  if (!app) throw new Error('Firebase app not initialized');
  return getFirestore(app);
}
