// src/lib/firebase/unread.ts
import { getDb } from '$lib/firebase';
import {
  collection,
  doc,
  getCountFromServer,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  limit,
  getDoc,
  type Unsubscribe
} from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';

export type UnreadMap = Record<string, number>;

function keyFor(serverId: string, channelId: string) {
  return `${serverId}__${channelId}`;
}

export async function markChannelRead(
  uid: string,
  serverId: string,
  channelId: string,
  opts?: { at?: any; lastMessageId?: string | null }
) {
  const db = getDb();
  const id = keyFor(serverId, channelId);
  await setDoc(
    doc(db, 'profiles', uid, 'reads', id),
    {
      serverId,
      channelId,
      lastReadAt: opts?.at ?? serverTimestamp(),
      lastReadMessageId: opts?.lastMessageId ?? null,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

/**
 * Watches each channel's latest message and returns per-channel unread counts.
 * Uses a lightweight latest-message listener + on-demand count query when needed.
 */
export function subscribeUnreadForServer(
  uid: string,
  serverId: string,
  onUpdate: (map: UnreadMap) => void
): Unsubscribe {
  const db = getDb();

  let stopChannels: Unsubscribe | null = null;
  const perChannelStops = new Map<string, Unsubscribe>();
  const lastRead: Record<string, Timestamp | null> = {};
  const counts: UnreadMap = {};

  // Watch all channels in the server
  stopChannels = onSnapshot(
    query(collection(db, 'servers', serverId, 'channels'), orderBy('position')),
    (chSnap) => {
      const present = new Set<string>();
      for (const ch of chSnap.docs) {
        const channelId = ch.id;
        present.add(channelId);
        if (perChannelStops.has(channelId)) continue;

        // For each channel, watch the most recent message timestamp
        // Latest message watcher (limit 1 for efficiency)
        const stopLatest = onSnapshot(
          query(
            collection(db, 'servers', serverId, 'channels', channelId, 'messages'),
            orderBy('createdAt', 'desc'),
            limit(1)
          ),
          async (msgSnap) => {
            const latest = msgSnap.docs[0]?.data() as any | undefined;
            const latestTs: Timestamp | null = latest?.createdAt ?? null;

            // If we don't have a read for this channel yet, fetch once
            if (lastRead[channelId] === undefined) {
              try {
                const readDoc = await getDoc(doc(db, 'profiles', uid, 'reads', keyFor(serverId, channelId)));
                lastRead[channelId] = (readDoc.data() as any)?.lastReadAt ?? null;
              } catch {
                lastRead[channelId] = null;
              }
            }

            const lr = lastRead[channelId];
            if (!latestTs) {
              counts[channelId] = 0;
              onUpdate({ ...counts });
              return;
            }
            if (lr && latestTs.toMillis() <= lr.toMillis()) {
              counts[channelId] = 0;
              onUpdate({ ...counts });
              return;
            }

            try {
              // On-demand count of messages newer than lastRead
              const q = lr
                ? query(
                    collection(db, 'servers', serverId, 'channels', channelId, 'messages'),
                    where('createdAt', '>', lr)
                  )
                : query(collection(db, 'servers', serverId, 'channels', channelId, 'messages'));
              const agg = await getCountFromServer(q);
              const n = agg.data().count ?? 0;
              counts[channelId] = lr ? n : n; // if no lastRead, show total as unread
              onUpdate({ ...counts });
            } catch {
              // Best-effort; if count fails, show 1+ when latest is newer than lastRead
              counts[channelId] = lr ? 1 : (counts[channelId] ?? 0);
              onUpdate({ ...counts });
            }
          }
        );

        // Watch my read doc for this channel and recompute when it changes
        const stopRead = onSnapshot(
          doc(db, 'profiles', uid, 'reads', keyFor(serverId, channelId)),
          async (readSnap) => {
            const lr: Timestamp | null = (readSnap.data() as any)?.lastReadAt ?? null;
            lastRead[channelId] = lr;
            // Recompute quickly: if latest <= lr, clear; else fetch count
            try {
              if (!lr) {
                const agg = await getCountFromServer(
                  query(collection(db, 'servers', serverId, 'channels', channelId, 'messages'))
                );
                counts[channelId] = agg.data().count ?? 0;
              } else {
                const agg = await getCountFromServer(
                  query(
                    collection(db, 'servers', serverId, 'channels', channelId, 'messages'),
                    where('createdAt', '>', lr)
                  )
                );
                counts[channelId] = agg.data().count ?? 0;
              }
              onUpdate({ ...counts });
            } catch {
              counts[channelId] = 0;
              onUpdate({ ...counts });
            }
          }
        );

        perChannelStops.set(
          channelId,
          () => {
            stopLatest();
            stopRead();
          }
        );
      }

      // Cleanup removed channels
      for (const [cid, stop] of perChannelStops) {
        if (!present.has(cid)) {
          stop();
          perChannelStops.delete(cid);
          delete lastRead[cid];
          delete counts[cid];
        }
      }

      onUpdate({ ...counts });
    }
  );

  return () => {
    stopChannels?.();
    perChannelStops.forEach((s) => s());
    perChannelStops.clear();
  };
}
