// src/lib/db/dms.ts
import { getDb } from '$lib/firebase';
import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot,
  orderBy, query, serverTimestamp, setDoc, updateDoc,
  where, limit, deleteField, runTransaction, type Unsubscribe
} from 'firebase/firestore';
import { buildMessageDocument, reactionKeyFromEmoji, type MessageInput } from './messages';

/* ===========================
   Types
=========================== */
export type MinimalUser = {
  uid: string;
  displayName?: string;   // from profiles.name (fallback displayName)
  photoURL?: string | null;
  email?: string | null;
};

export type DMThread = {
  key: string;
  participants: string[];
  createdAt?: any;
  updatedAt?: any;
  lastMessage?: string | null;
  lastSender?: string | null;
};

export type DMMessage = {
  uid: string; // author uid
  type?: 'text' | 'gif' | 'poll' | 'form';
  text?: string;
  content?: string;
  url?: string;
  poll?: {
    question: string;
    options: string[];
    votesByUser?: Record<string, number>;
  };
  form?: {
    title: string;
    questions: string[];
    responses?: Record<string, { answers: string[]; submittedAt?: any }>;
  };
  reactions?: Record<string, string[]>;
  displayName?: string | null;
  photoURL?: string | null;
  author?: {
    displayName?: string | null;
    photoURL?: string | null;
  };
  createdAt?: any;
};

/* ===========================
   Collection constants
=========================== */
const COL_DMS = 'dms';
const COL_PROFILES = 'profiles';
const SUB_MESSAGES = 'messages';
const SUB_READS = 'reads';

/* ===========================
   Utilities
=========================== */
export function participantsKey(uids: string[]) {
  return [...uids].sort().join('_');
}

export async function getProfile(uid: string): Promise<MinimalUser | null> {
  const db = getDb();
  const snap = await getDoc(doc(db, COL_PROFILES, uid));
  if (!snap.exists()) return null;
  const data: any = snap.data();
  return {
    uid: snap.id,
    displayName: data.name ?? data.displayName ?? undefined,
    photoURL: data.photoURL ?? null,
    email: data.email ?? null
  };
}

// Replace your current streamProfiles with this version:
export function streamProfiles(
  cb: (people: MinimalUser[]) => void,
  opts?: { limitTo?: number }
): Unsubscribe {
  const db = getDb();
  const lim = opts?.limitTo ?? 500;

  // No orderBy — avoids index/field issues if some docs lack "name"
  const ref = collection(db, 'profiles');

  return onSnapshot(ref, (snap) => {
    let list: MinimalUser[] = snap.docs.map((d) => {
      const data: any = d.data();
      return {
        uid: d.id,
        // show Name: field if present, else displayName, else fallback
        displayName: data.name ?? data.displayName ?? undefined,
        photoURL: data.photoURL ?? null,
        email: data.email ?? null
      };
    });

    // Client-side sort by name/displayName, then email, then uid
    list.sort((a, b) => {
      const A = (a.displayName ?? a.email ?? a.uid).toLowerCase();
      const B = (b.displayName ?? b.email ?? b.uid).toLowerCase();
      return A.localeCompare(B);
    });

    // Apply limit if requested
    if (list.length > lim) list = list.slice(0, lim);

    cb(list);
  });
}


/* ===========================
   Threads & messages
=========================== */
export async function getThread(threadId: string) {
  const db = getDb();
  const snap = await getDoc(doc(db, COL_DMS, threadId));
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as DMThread) }) : null;
}

/** Convenience: deterministic 1:1 thread key and fetch/create. */
export async function getOrCreateDMWith(aUid: string, bUid: string) {
  return getOrCreateDMThread([aUid, bUid]);
}

/** Find a DM thread for exactly these participants, or create it. */
export async function getOrCreateDMThread(uids: string[]) {
  if (uids.length < 2) throw new Error('DM needs at least 2 participants');
  const db = getDb();
  const key = participantsKey(uids);

  const dmsCol = collection(db, COL_DMS);
  const q1 = query(dmsCol, where('key', '==', key), limit(1));
  const snap = await getDocs(q1);

  if (!snap.empty) {
    const d = snap.docs[0];
    return { id: d.id, ...(d.data() as DMThread) };
  }

  const docRef = await addDoc(dmsCol, {
    key,
    participants: [...uids].sort(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessage: null,
    lastSender: null
  } as DMThread);

  const created = await getDoc(docRef);
  return { id: docRef.id, ...(created.data() as DMThread) };
}

/** Send a DM message into a thread (updates thread meta). */
const THREAD_SUMMARY_MAX = 120;

function trimValue(value: string | null | undefined) {
  if (typeof value !== 'string') return '';
  const next = value.trim();
  return next.length ? next : '';
}

function summarizeMessageForThread(payload: MessageInput): string {
  const type = payload.type ?? 'text';

  if (type === 'gif') {
    return 'sent a GIF';
  }

  if (type === 'poll' && 'poll' in payload) {
    const question = trimValue(payload.poll?.question);
    return question ? `created a poll: ${question}` : 'created a poll';
  }

  if (type === 'form' && 'form' in payload) {
    const title = trimValue(payload.form?.title);
    return title ? `shared a form: ${title}` : 'shared a form';
  }

  const text = trimValue('text' in payload ? payload.text : undefined);
  if (!text) return 'sent a message';
  return text.length > THREAD_SUMMARY_MAX
    ? `${text.slice(0, THREAD_SUMMARY_MAX - 1)}…`
    : text;
}

export async function sendDMMessage(threadId: string, payload: MessageInput) {
  const cleanThreadId = trimValue(threadId);
  if (!cleanThreadId) throw new Error('Missing DM thread id.');

  const db = getDb();
  const messagesCol = collection(db, COL_DMS, cleanThreadId, SUB_MESSAGES);
  const docData = buildMessageDocument(payload);

  await addDoc(messagesCol, docData);

  // bump thread meta
  const tRef = doc(db, COL_DMS, cleanThreadId);
  const tSnap = await getDoc(tRef);
  const threadData: any = tSnap.exists() ? tSnap.data() : null;
  const participants: string[] = threadData?.participants ?? [];
  const resets: Record<string, any> = {};
  for (const participant of participants) {
    resets[`deletedFor.${participant}`] = deleteField();
  }

  await updateDoc(tRef, {
    updatedAt: serverTimestamp(),
    lastMessage: summarizeMessageForThread(payload),
    lastType: payload.type ?? 'text',
    lastSender: payload.uid,
    ...resets
  });
}

/** Live messages for a thread (ascending). */
export async function toggleDMReaction(
  threadId: string,
  messageId: string,
  uid: string,
  emoji: string
) {
  const cleanThreadId = trimValue(threadId);
  const cleanMessage = trimValue(messageId);
  const cleanUid = trimValue(uid);
  const symbol = trimValue(emoji);
  if (!cleanThreadId || !cleanMessage || !cleanUid || !symbol) {
    throw new Error('Missing reaction identifiers.');
  }

  const key = reactionKeyFromEmoji(symbol);
  const db = getDb();
  const messageRef = doc(db, COL_DMS, cleanThreadId, SUB_MESSAGES, cleanMessage);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(messageRef);
    if (!snap.exists()) throw new Error('Message not found.');
    const data: any = snap.data() ?? {};
    const reactions: Record<string, any> = data.reactions ?? {};
    const entry = reactions[key] ?? { emoji: symbol, users: {} };
    const users: Record<string, boolean> = { ...(entry.users ?? {}) };
    const has = Boolean(users[cleanUid]);

    if (has) {
      delete users[cleanUid];
      if (Object.keys(users).length === 0) {
        tx.update(messageRef, {
          [`reactions.${key}`]: deleteField()
        });
      } else {
        tx.update(messageRef, {
          [`reactions.${key}.users`]: users
        });
      }
    } else {
      users[cleanUid] = true;
      tx.update(messageRef, {
        [`reactions.${key}.emoji`]: symbol,
        [`reactions.${key}.users`]: users
      });
    }
  });
}

export async function voteOnDMPoll(
  threadId: string,
  messageId: string,
  uid: string,
  optionIndex: number
) {
  const cleanThreadId = trimValue(threadId);
  const cleanMessage = trimValue(messageId);
  const cleanUid = trimValue(uid);
  if (!cleanThreadId || !cleanMessage || !cleanUid) {
    throw new Error('Missing poll vote identifiers.');
  }
  const choice = Number(optionIndex);
  if (!Number.isFinite(choice) || choice < 0) {
    throw new Error('Invalid poll option index.');
  }
  const db = getDb();
  await updateDoc(
    doc(db, COL_DMS, cleanThreadId, SUB_MESSAGES, cleanMessage),
    {
      [`poll.votesByUser.${cleanUid}`]: Math.floor(choice)
    }
  );
}

export async function submitDMForm(
  threadId: string,
  messageId: string,
  uid: string,
  answers: string[]
) {
  const cleanThreadId = trimValue(threadId);
  const cleanMessage = trimValue(messageId);
  const cleanUid = trimValue(uid);
  if (!cleanThreadId || !cleanMessage || !cleanUid) {
    throw new Error('Missing form submission identifiers.');
  }
  const sanitized = (answers ?? []).map((ans) => trimValue(ans));
  const db = getDb();
  await updateDoc(
    doc(db, COL_DMS, cleanThreadId, SUB_MESSAGES, cleanMessage),
    {
      [`form.responses.${cleanUid}`]: {
        answers: sanitized,
        submittedAt: serverTimestamp()
      }
    }
  );
}

export function streamDMMessages(threadId: string, cb: (msgs: any[]) => void): Unsubscribe {
  const db = getDb();
  const q1 = query(collection(db, COL_DMS, threadId, SUB_MESSAGES), orderBy('createdAt', 'asc'));
  return onSnapshot(q1, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

/** Live list of my threads (most recent first). */
export function streamMyThreads(uid: string, cb: (threads: any[]) => void): Unsubscribe {
  const db = getDb();
  const q1 = query(
    collection(db, COL_DMS),
    where('participants', 'array-contains', uid),
    orderBy('updatedAt', 'desc')
  );
  return onSnapshot(q1, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    cb(rows.filter((row) => !row?.deletedFor?.[uid]));
  });
}

export async function deleteThreadForUser(threadId: string, uid: string) {
  const db = getDb();
  const ref = doc(db, COL_DMS, threadId);
  await updateDoc(ref, { [`deletedFor.${uid}`]: serverTimestamp() });
}

/* ===========================
   Unread / notifications
=========================== */
export async function markThreadRead(threadId: string, uid: string) {
  const db = getDb();
  const rRef = doc(db, COL_DMS, threadId, SUB_READS, uid);
  await setDoc(rRef, { lastReadAt: serverTimestamp() }, { merge: true });
}

/**
 * Live unread count for a thread for a given user.
 * Counts messages where createdAt > lastReadAt.
 * If there’s no read doc, counts all messages.
 *
 * NOTE: use orderBy('createdAt') with the inequality filter for correctness.
 */
export function streamUnreadCount(threadId: string, uid: string, cb: (n: number) => void): Unsubscribe {
  const db = getDb();
  const readDocRef = doc(db, COL_DMS, threadId, SUB_READS, uid);

  let stopMsgs: Unsubscribe | undefined;

  const stopRead = onSnapshot(readDocRef, (readSnap) => {
    const lastReadAt = readSnap.exists() ? (readSnap.data() as any)?.lastReadAt ?? null : null;

    // re-wire messages listener
    stopMsgs?.();
    const base = collection(db, COL_DMS, threadId, SUB_MESSAGES);

    if (lastReadAt) {
      const qNew = query(base, where('createdAt', '>', lastReadAt), orderBy('createdAt', 'asc'));
      stopMsgs = onSnapshot(qNew, (s) => cb(s.size));
    } else {
      const qAll = query(base); // first-time: “all unread”
      stopMsgs = onSnapshot(qAll, (s) => cb(s.size));
    }
  });

  return () => {
    stopRead?.();
    stopMsgs?.();
  };
}

/* ===========================
   People search (profiles)
=========================== */
/**
 * Search people by name in `profiles`.
 * Prefers `nameLower` prefix if present, then exact `name`,
 * then exact `displayName`, finally optional prefix on `name`.
 */
export async function searchUsersByName(term: string, { limitTo = 25 } = {}) {
  const db = getDb();
  const results: MinimalUser[] = [];
  const seen = new Set<string>();
  const termLower = term.toLowerCase();

  const push = (id: string, data: any) => {
    if (seen.has(id)) return;
    seen.add(id);
    results.push({
      uid: id,
      displayName: data.name ?? data.displayName ?? undefined,
      photoURL: data.photoURL ?? null,
      email: data.email ?? null
    });
  };

  const base = collection(db, COL_PROFILES);

  // 1) nameLower prefix (best)
  try {
    const qLower = query(
      base,
      where('nameLower', '>=', termLower),
      where('nameLower', '<=', termLower + '\uf8ff'),
      limit(limitTo)
    );
    const sLower = await getDocs(qLower);
    sLower.forEach((d) => push(d.id, d.data()));
    if (results.length) return results;
  } catch {}

  // 2) exact name
  try {
    const qEqName = query(base, where('name', '==', term), limit(limitTo));
    const sEqName = await getDocs(qEqName);
    sEqName.forEach((d) => push(d.id, d.data()));
    if (results.length) return results;
  } catch {}

  // 3) exact displayName (legacy)
  try {
    const qEqDisplay = query(base, where('displayName', '==', term), limit(limitTo));
    const sEqDisplay = await getDocs(qEqDisplay);
    sEqDisplay.forEach((d) => push(d.id, d.data()));
    if (results.length) return results;
  } catch {}

  // 4) optional prefix on name (requires index)
  try {
    const qRange = query(
      base,
      where('name', '>=', term),
      where('name', '<=', term + '\uf8ff'),
      limit(limitTo)
    );
    const sRange = await getDocs(qRange);
    sRange.forEach((d) => push(d.id, d.data()));
  } catch {}

  return results;
}
