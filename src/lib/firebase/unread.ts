// src/lib/firebase/unread.ts
import { getDb } from '$lib/firebase';
import {
  collection,
  doc,
  getCountFromServer,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  limit,
  type Unsubscribe
} from 'firebase/firestore';
import type { DocumentData, DocumentSnapshot, Timestamp } from 'firebase/firestore';
import { pickAuthor, pickMessageSnippet } from '$lib/utils/messagePreview';

export type HighPriorityReason = 'mention' | 'reply' | 'thread';

export type ChannelPrioritySnapshot = {
  total: number;
  high: number;
  low: number;
  latestHigh?: {
    id: string | null;
    reason: HighPriorityReason;
    author?: string | null;
    snippet?: string | null;
    timestamp?: number | null;
  } | null;
};

export type UnreadMap = Record<string, ChannelPrioritySnapshot>;

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

type ChannelState = {
  id: string;
  lastReadAt: Timestamp | null;
  recomputeRunning: boolean;
  recomputeQueued: boolean;
  stopLatest?: Unsubscribe;
  stopRead?: Unsubscribe;
};

type HighEvent = {
  id: string;
  reason: HighPriorityReason;
  author: string | null;
  snippet: string | null;
  timestamp: number | null;
};

function timestampToMillis(value: Timestamp | Date | number | null | undefined): number | null {
  if (!value) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof (value as any)?.toMillis === 'function') {
    try {
      return (value as Timestamp).toMillis();
    } catch {
      return null;
    }
  }
  return null;
}

function buildHighEvent(
  docSnap: DocumentSnapshot<DocumentData>,
  reason: HighPriorityReason
): HighEvent {
  const data = docSnap.data() ?? {};
  const snippet = pickMessageSnippet(data);
  const author = pickAuthor(data);
  const timestamp = timestampToMillis(data?.createdAt);
  return {
    id: docSnap.id,
    reason,
    author,
    snippet,
    timestamp
  };
}

async function computeChannelSnapshot(options: {
  db: ReturnType<typeof getDb>;
  uid: string;
  serverId: string;
  channelId: string;
  lastReadAt: Timestamp | null;
}): Promise<ChannelPrioritySnapshot> {
  const { db, uid, serverId, channelId, lastReadAt } = options;
  const base = collection(db, 'servers', serverId, 'channels', channelId, 'messages');
  const timeConstraint = lastReadAt ? [where('createdAt', '>', lastReadAt)] : [];

  let total = 0;
  try {
    const agg = await getCountFromServer(query(base, ...timeConstraint));
    total = agg.data().count ?? 0;
  } catch (err) {
    console.warn('[unread] total count failed', { serverId, channelId }, err);
    return { total: 0, high: 0, low: 0, latestHigh: null };
  }

  if (total === 0) {
    return { total: 0, high: 0, low: 0, latestHigh: null };
  }

  const highEvents = new Map<string, HighEvent>();

  try {
    const mentionQuery = query(
      base,
      ...timeConstraint,
      where(`mentionsMap.${uid}`, '==', true)
    );
    const mentionSnap = await getDocs(mentionQuery);
    mentionSnap.forEach((docSnap) => {
      const event = buildHighEvent(docSnap, 'mention');
      highEvents.set(docSnap.id, event);
    });
  } catch (err) {
    console.warn('[unread] mention query failed', { serverId, channelId }, err);
  }

  try {
    const replyQuery = query(
      base,
      ...timeConstraint,
      where('replyTo.authorId', '==', uid)
    );
    const replySnap = await getDocs(replyQuery);
    replySnap.forEach((docSnap) => {
      if (highEvents.has(docSnap.id)) return;
      const event = buildHighEvent(docSnap, 'reply');
      highEvents.set(docSnap.id, event);
    });
  } catch (err) {
    console.warn('[unread] reply query failed', { serverId, channelId }, err);
  }

  const highList = Array.from(highEvents.values()).sort(
    (a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)
  );
  const highCount = highEvents.size;
  const low = Math.max(total - highCount, 0);

  return {
    total,
    high: highCount,
    low,
    latestHigh: highList[0] ?? null
  };
}

/**
 * Watches each channel's latest message and returns per-channel unread counts,
 * split into high priority (mentions/replies) and low priority buckets.
 */
export function subscribeUnreadForServer(
  uid: string,
  serverId: string,
  onUpdate: (map: UnreadMap) => void
): Unsubscribe {
  const db = getDb();
  const channelStates = new Map<string, ChannelState>();
  const counts: UnreadMap = {};

  const emit = () => {
    onUpdate({ ...counts });
  };

  const scheduleRecompute = (channelId: string) => {
    const state = channelStates.get(channelId);
    if (!state) return;
    if (state.recomputeRunning) {
      state.recomputeQueued = true;
      return;
    }
    state.recomputeRunning = true;
    state.recomputeQueued = false;
    computeChannelSnapshot({
      db,
      uid,
      serverId,
      channelId,
      lastReadAt: state.lastReadAt
    })
      .then((snapshot) => {
        counts[channelId] = snapshot;
        emit();
      })
      .catch((err) => {
        console.warn('[unread] failed to compute snapshot', { serverId, channelId }, err);
      })
      .finally(() => {
        state.recomputeRunning = false;
        if (state.recomputeQueued) {
          state.recomputeQueued = false;
          scheduleRecompute(channelId);
        }
      });
  };

  const detachChannel = (channelId: string) => {
    const state = channelStates.get(channelId);
    if (!state) return;
    state.stopLatest?.();
    state.stopRead?.();
    channelStates.delete(channelId);
    delete counts[channelId];
    emit();
  };

  const attachChannel = (channelId: string) => {
    if (channelStates.has(channelId)) return;
    const state: ChannelState = {
      id: channelId,
      lastReadAt: null,
      recomputeRunning: false,
      recomputeQueued: false
    };
    channelStates.set(channelId, state);

    state.stopLatest = onSnapshot(
      query(
        collection(db, 'servers', serverId, 'channels', channelId, 'messages'),
        orderBy('createdAt', 'desc'),
        limit(1)
      ),
      () => scheduleRecompute(channelId),
      () => scheduleRecompute(channelId)
    );

    state.stopRead = onSnapshot(
      doc(db, 'profiles', uid, 'reads', keyFor(serverId, channelId)),
      (snap) => {
        const data: any = snap.data() ?? {};
        state.lastReadAt = data?.lastReadAt ?? null;
        scheduleRecompute(channelId);
      },
      () => {
        state.lastReadAt = null;
        scheduleRecompute(channelId);
      }
    );

    scheduleRecompute(channelId);
  };

  const stopChannels = onSnapshot(
    query(collection(db, 'servers', serverId, 'channels'), orderBy('position')),
    (snap) => {
      const present = new Set<string>();
      snap.forEach((docSnap) => {
        const channelId = docSnap.id;
        present.add(channelId);
        attachChannel(channelId);
      });
      for (const channelId of Array.from(channelStates.keys())) {
        if (!present.has(channelId)) {
          detachChannel(channelId);
        }
      }
    },
    () => {
      for (const channelId of Array.from(channelStates.keys())) {
        detachChannel(channelId);
      }
    }
  );

  return () => {
    stopChannels?.();
    for (const channelId of Array.from(channelStates.keys())) {
      detachChannel(channelId);
    }
  };
}
