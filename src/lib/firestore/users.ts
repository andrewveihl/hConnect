// src/lib/firestore/users.ts
import { db } from './client';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';

export async function getUserUidByEmail(email: string): Promise<string> {
  const d = db();
  const q = query(collection(d, 'profiles'), where('email', '==', email.toLowerCase()), limit(1));
  const snap = await getDocs(q);
  const doc = snap.docs[0];
  if (!doc) throw new Error('No user with that email.');
  return doc.id; // or doc.data().uid depending on your schema
}
