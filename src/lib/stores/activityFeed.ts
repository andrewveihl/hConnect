import { browser } from '$app/environment';
import { derived, writable, type Readable } from 'svelte/store';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { user } from '$lib/stores/user';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Unsubscribe
} from 'firebase/firestore';

export type ActivityContext = {
  serverId?: string | null;
  serverName?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  threadId?: string | null;
  threadName?: string | null;
  dmId?: string | null;
};

export type ActivityMessageInfo = {
  messageId?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  previewText?: string | null;
  createdAt?: number | null;
};

export type ActivityEntry = {
  id: string;
  type: string;
  mentionType: string;
  title: string;
  body: string;
  context: ActivityContext;
  messageInfo: ActivityMessageInfo;
  status: {
    unread: boolean;
    clicked: boolean;
  };
  deepLink: string;
  createdAt: number | null;
};

const entriesInternal = writable<ActivityEntry[]>([]);
const readyInternal = writable(false);

export const activityEntries: Readable<ActivityEntry[]> = {
  subscribe: entriesInternal.subscribe
};

export const activityReady: Readable<boolean> = {
  subscribe: readyInternal.subscribe
};

export const activityUnreadCount = derived(activityEntries, (list) =>
  list.reduce((total, entry) => (entry.status.unread ? total + 1 : total), 0)
);

let unsubscribe: Unsubscribe | null = null;
let activeUid: string | null = null;

function toMillis(value: unknown): number | null {
  if (!value) return null;
  try {
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    if (typeof (value as any)?.toMillis === 'function') return (value as any).toMillis();
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
  } catch {
    return null;
  }
  return null;
}

function buildDeepLink(context: ActivityContext, messageId?: string | null, origin = 'activity') {
  if (context.dmId) {
    const params = new URLSearchParams({ origin });
    if (messageId) params.set('messageId', messageId);
    return `/dms/${context.dmId}?${params.toString()}`;
  }
  if (context.serverId && context.channelId) {
    const params = new URLSearchParams({ origin, channel: context.channelId });
    if (context.threadId) params.set('thread', context.threadId);
    if (messageId) params.set('messageId', messageId);
    return `/servers/${context.serverId}?${params.toString()}`;
  }
  return '/';
}

function mapActivityDoc(id: string, data: Record<string, any>): ActivityEntry {
  const context: ActivityContext = data?.context ?? {};
  const messageInfoRaw = data?.messageInfo ?? {};
  const messageInfo: ActivityMessageInfo = {
    messageId: messageInfoRaw?.messageId ?? null,
    authorId: messageInfoRaw?.authorId ?? null,
    authorName: messageInfoRaw?.authorName ?? null,
    previewText: messageInfoRaw?.previewText ?? null,
    createdAt: toMillis(messageInfoRaw?.createdAt)
  };
  const deepLink = typeof data?.deepLink === 'string' && data.deepLink.length
    ? data.deepLink
    : buildDeepLink(context, messageInfo.messageId);

  return {
    id,
    type: data?.type ?? 'mention',
    mentionType: data?.mentionType ?? data?.type ?? 'mention',
    title: data?.title ?? context.serverName ?? 'Activity',
    body: data?.body ?? messageInfo.previewText ?? 'New activity',
    context,
    messageInfo,
    status: {
      unread: data?.status?.unread !== false,
      clicked: data?.status?.clicked === true
    },
    deepLink,
    createdAt: toMillis(data?.createdAt) ?? messageInfo.createdAt ?? null
  };
}

async function attachActivityFeed(uid: string) {
  await ensureFirebaseReady();
  const db = getDb();
  const q = query(
    collection(db, 'profiles', uid, 'activity'),
    orderBy('createdAt', 'desc'),
    limit(120)
  );
  unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      readyInternal.set(true);
      const mapped = snapshot.docs.map((docSnap) => mapActivityDoc(docSnap.id, docSnap.data()));
      entriesInternal.set(mapped);
    },
    () => {
      readyInternal.set(true);
    }
  );
}

function detachActivityFeed() {
  unsubscribe?.();
  unsubscribe = null;
  entriesInternal.set([]);
  readyInternal.set(false);
}

if (browser) {
  user.subscribe((value) => {
    const uid = value?.uid ?? null;
    if (uid === activeUid) return;
    detachActivityFeed();
    activeUid = uid;
    if (!uid) {
      readyInternal.set(true);
      return;
    }
    attachActivityFeed(uid).catch(() => readyInternal.set(true));
  });
}

export async function markActivityEntry(
  entryId: string,
  updates: { unread?: boolean; clicked?: boolean } = {}
) {
  if (!browser || !activeUid || !entryId) return;
  const payload: Record<string, unknown> = {};
  if (updates.unread !== undefined) {
    payload['status.unread'] = updates.unread;
    if (!updates.unread) {
      payload['status.readAt'] = serverTimestamp();
    }
  }
  if (updates.clicked !== undefined) {
    payload['status.clicked'] = updates.clicked;
  }
  if (!Object.keys(payload).length) return;
  payload.updatedAt = serverTimestamp();
  await ensureFirebaseReady();
  const db = getDb();
  await updateDoc(doc(db, 'profiles', activeUid, 'activity', entryId), payload);
}

export function deepLinkFromActivity(entry: ActivityEntry) {
  return buildDeepLink(entry.context, entry.messageInfo.messageId);
}

export function isActivityRouteSame(entry: ActivityEntry, url: URL) {
  return entry.deepLink === `${url.pathname}${url.search}`;
}
