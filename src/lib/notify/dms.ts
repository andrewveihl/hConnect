import { getDb } from '$lib/firebase';
import {
  collection, onSnapshot, query, where, orderBy, limit, type Unsubscribe
} from 'firebase/firestore';

export async function requestDMNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  // Notifications require HTTPS (or localhost). If not secure, this will no-op.
  if (Notification.permission === 'granted') return true;
  try {
    const res = await Notification.requestPermission();
    return res === 'granted';
  } catch {
    return false;
  }
}

export function enableDMNotifications(meUid: string): Unsubscribe {
  const db = getDb();
  const perThreadUnsub = new Map<string, Unsubscribe>();

  // watch my threads
  const stopThreads = onSnapshot(
    query(collection(db, 'dms'), where('participants', 'array-contains', meUid)),
    (snap) => {
      const present = new Set<string>();

      snap.forEach((d) => {
        const tid = d.id;
        present.add(tid);
        if (perThreadUnsub.has(tid)) return;

        // watch latest message in this thread
        const stopLatest = onSnapshot(
          query(collection(db, 'dms', tid, 'messages'), orderBy('createdAt', 'desc'), limit(1)),
          (ms) => {
            const m = ms.docs[0]?.data() as any | undefined;
            if (!m) return;
            if (m.uid === meUid) return; // skip my own
            if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
            if (!('Notification' in window) || Notification.permission !== 'granted') return;

            new Notification(m.displayName ?? 'New message', {
              body: String(m.text ?? ''),
              tag: `dm-${tid}` // one per thread
            });
          }
        );

        perThreadUnsub.set(tid, stopLatest);
      });

      // cleanup removed threads
      [...perThreadUnsub.keys()].forEach((tid) => {
        if (!present.has(tid)) {
          perThreadUnsub.get(tid)?.();
          perThreadUnsub.delete(tid);
        }
      });
    }
  );

  return () => {
    stopThreads?.();
    perThreadUnsub.forEach((u) => u());
    perThreadUnsub.clear();
  };
}
