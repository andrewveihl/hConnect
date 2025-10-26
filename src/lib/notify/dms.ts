import { getDb } from '$lib/firebase';
import {
  collection, onSnapshot, query, where, orderBy, limit, doc, type Unsubscribe
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
  let desktopEnabled = false;
  let dmsAllowed = true;
  const initialized = new Set<string>();

  // Watch my prefs
  const stopPrefs = (onSnapshot as any)?.call
    ? (onSnapshot as any)(
        (doc as any)(db, 'profiles', meUid),
        (snap: any) => {
          const s: any = snap.data()?.settings ?? {};
          const p: any = s.notificationPrefs ?? {};
          desktopEnabled = !!p.desktopEnabled;
          dmsAllowed = p.dms ?? true;
        }
      )
    : null;

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
            // Skip first emission on subscribe to avoid notifying on refresh
            if (!initialized.has(tid)) { initialized.add(tid); return; }
            if (m.uid === meUid) return; // skip my own
            if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            if (!desktopEnabled || !dmsAllowed) return;

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
    stopPrefs?.();
  };
}
