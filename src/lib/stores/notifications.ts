import { browser } from '$app/environment';
import { writable, derived, type Readable } from 'svelte/store';
import { user } from '$lib/stores/user';
import { subscribeUserServers } from '$lib/firestore/servers';
import { streamMyDMs, streamUnreadCount } from '$lib/firestore/dms';
import {
  subscribeUnreadForServer,
  type HighPriorityReason,
  type UnreadMap
} from '$lib/firebase/unread';
import { getDb } from '$lib/firebase';
import {
  collection,
  doc,
  getCountFromServer,
  onSnapshot,
  orderBy,
  query,
  limit,
  where,
  type Unsubscribe
} from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';
import { registerFirebaseMessagingSW, setActivePushUser, syncDeviceRegistration } from '$lib/notify/push';
import { ensureNotificationSettings } from '$lib/firebase/notifications';
import {
  extractMentionedUids,
  formatPreview,
  normalizeUid,
  pickAuthor,
  pickMessageSnippet,
  truncate
} from '$lib/utils/messagePreview';

type ChannelMeta = {
  id: string;
  serverId: string;
  name: string;
  type: 'text' | 'voice';
};

type ChannelHighWatermark = {
  reason: HighPriorityReason;
  snippet?: string | null;
  author?: string | null;
  timestamp?: number | null;
  sourceId?: string | null;
};

type ChannelActivity = {
  total: number;
  high: number;
  low: number;
  threadHigh: number;
  lastActivity: number | null;
  preview?: string | null;
  priorityPreview?: string | null;
  latestHigh?: ChannelHighWatermark | null;
};

type ThreadActivity = {
  threadId: string;
  serverId: string;
  channelId: string;
  title: string;
  preview?: string | null;
  lastActivity: number | null;
  unread: number;
};

type ThreadState = {
  threadId: string;
  serverId: string;
  channelId: string;
  name?: string | null;
  preview?: string | null;
  lastMessageAt: number | null;
  lastReadAt: Timestamp | null;
  unread: number;
  stopMeta?: Unsubscribe;
  recomputeRunning: boolean;
  recomputeQueued: boolean;
};

type LatestMessage = {
  timestamp: number | null;
  author?: string | null;
  snippet?: string | null;
};

type ServerInfo = {
  id: string;
  name: string;
  icon?: string | null;
};

type DMRow = {
  id: string;
  otherDisplayName?: string;
  otherEmail?: string;
  otherPhotoURL?: string | null;
  lastMessage?: string | null;
  updatedAt?: any;
};

export type NotificationItem = {
  id: string;
  kind: 'channel' | 'dm' | 'thread';
  priority: 'low' | 'high';
  serverId?: string;
  channelId?: string;
  threadId?: string;
  title: string;
  context?: string | null;
  preview?: string | null;
  unread: number;
  highCount?: number;
  lowCount?: number;
  lastActivity: number | null;
  href: string;
  photoURL?: string | null;
  isMention?: boolean;
  reason?: HighPriorityReason | null;
};

type ChannelIndicatorState = {
  high: number;
  low: number;
};

const notificationsInternal = writable<NotificationItem[]>([]);
const notificationCountInternal = writable(0);
const dmUnreadCountInternal = writable(0);
const channelUnreadCountInternal = writable(0);
const readyInternal = writable(false);
const channelIndicatorsInternal = writable<Record<string, Record<string, ChannelIndicatorState>>>({});
let lastBadgeValue: number | null = null;

export const notifications: Readable<NotificationItem[]> = {
  subscribe: notificationsInternal.subscribe
};

export const notificationCount: Readable<number> = {
  subscribe: notificationCountInternal.subscribe
};

export const dmUnreadCount: Readable<number> = {
  subscribe: dmUnreadCountInternal.subscribe
};

export const channelUnreadCount: Readable<number> = {
  subscribe: channelUnreadCountInternal.subscribe
};

export const notificationsReady = derived(readyInternal, (value) => value);
export const hasNotifications = derived(notificationCountInternal, (total) => total > 0);
export const channelIndicators = derived(channelIndicatorsInternal, (value) => value);

const servers = new Map<string, ServerInfo>();
const serverChannelMeta = new Map<string, Map<string, ChannelMeta>>();
const serverChannelActivity = new Map<string, Map<string, ChannelActivity>>();
const serverLatestMessages = new Map<string, Map<string, LatestMessage>>();

const dmRows = new Map<string, DMRow>();
const dmCounts = new Map<string, number>();
const threadStates = new Map<string, ThreadState>();
const threadActivities = new Map<string, ThreadActivity>();
const channelThreadTotals = new Map<string, number>();
const notifiedMentionMessages = new Set<string>();
const notifiedDMVersions = new Map<string, number>();
const pushSetupFor = new Set<string>();

let stopServers: Unsubscribe | null = null;
const serverChannelStops = new Map<string, Unsubscribe>();
const serverUnreadStops = new Map<string, Unsubscribe>();
const latestMessageStops = new Map<string, Map<string, Unsubscribe>>();
let stopDMs: Unsubscribe | null = null;
const dmUnreadStops = new Map<string, Unsubscribe>();
let stopThreads: Unsubscribe | null = null;

let activeUid: string | null = null;

function timestampToMillis(value: any): number | null {
  if (!value) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') {
    try {
      return value.toMillis();
    } catch {
      return null;
    }
  }
  return null;
}

function maybeNotifyMention(
  serverId: string,
  channelId: string,
  channelLabel: string,
  messageId: string | null,
  body: string | null
) {
  if (typeof window === 'undefined') return;
  if (!messageId) return;
  const key = `${serverId}:${channelId}:${messageId}`;
  if (notifiedMentionMessages.has(key)) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
  notifiedMentionMessages.add(key);
  try {
    const title = channelLabel && channelLabel.trim().length
      ? `Mention in ${channelLabel}`
      : 'You were mentioned';
    new Notification(title, {
      body: body ?? 'New mention waiting for you.',
      tag: key,
      data: {
        type: 'mention',
        serverId,
        channelId,
        messageId,
        url: `/servers/${serverId}?channel=${channelId}`
      }
    });
  } catch {
    // noop
  }
}

function ensureLatestWatcher(serverId: string, channelId: string) {
  let perServer = latestMessageStops.get(serverId);
  if (!perServer) {
    perServer = new Map();
    latestMessageStops.set(serverId, perServer);
  }
  if (perServer.has(channelId)) return;

  const db = getDb();
  const q = query(
    collection(db, 'servers', serverId, 'channels', channelId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(1)
  );

  const stop = onSnapshot(
    q,
    (snap) => {
      const docSnap = snap.docs[0];
      const raw = docSnap?.data();
      const ts = timestampToMillis(raw?.createdAt) ?? Date.now();
      const author = pickAuthor(raw);
      const snippet = pickMessageSnippet(raw);

      let perServerLatest = serverLatestMessages.get(serverId);
      if (!perServerLatest) {
        perServerLatest = new Map();
        serverLatestMessages.set(serverId, perServerLatest);
      }
      perServerLatest.set(channelId, { timestamp: ts, author, snippet });

      const authorUid = normalizeUid(raw?.uid ?? raw?.authorId);
      const mentionedUids = extractMentionedUids(raw);
      const mentionHit =
        activeUid && activeUid !== authorUid ? mentionedUids.includes(activeUid) : false;
      const activity = serverChannelActivity.get(serverId);
      if (activity) {
                const current =
          activity.get(channelId) ??
          {
            total: 0,
            high: 0,
            low: 0,
            threadHigh: 0,
            lastActivity: ts,
            latestHigh: null
          };
        const basePreview = formatPreview(author, snippet);
        current.lastActivity = ts;
        current.preview = basePreview ?? current.preview ?? null;
        if (mentionHit) {
          current.latestHigh = {
            reason: 'mention',
            snippet: snippet ?? basePreview ?? null,
            author,
            timestamp: ts,
            sourceId: docSnap?.id ?? null
          };
          current.priorityPreview = snippet
            ? `You were mentioned - ${snippet}`
            : basePreview ?? 'You were mentioned';
          const channelMeta = serverChannelMeta.get(serverId)?.get(channelId);
          const channelName = channelMeta?.name ?? '';
          maybeNotifyMention(
            serverId,
            channelId,
            channelMeta?.type === 'voice' ? channelName : channelName ? `#${channelName}` : '',
            docSnap?.id ?? null,
            snippet ?? author ?? 'New mention'
          );
        }
        activity.set(channelId, current);
      }
      recompute();
    },
    () => {
      const perServerLatest = serverLatestMessages.get(serverId);
      perServerLatest?.delete(channelId);
    }
  );

  perServer.set(channelId, stop);
}

function stopLatestWatcher(serverId: string, channelId: string) {
  const perServer = latestMessageStops.get(serverId);
  if (!perServer) return;
  const stop = perServer.get(channelId);
  if (stop) stop();
  perServer.delete(channelId);
  if (!perServer.size) latestMessageStops.delete(serverId);

  const latest = serverLatestMessages.get(serverId);
  latest?.delete(channelId);
  if (latest && !latest.size) serverLatestMessages.delete(serverId);
}

function handleUnreadUpdate(serverId: string, map: UnreadMap) {
  let activity = serverChannelActivity.get(serverId);
  if (!activity) {
    activity = new Map();
    serverChannelActivity.set(serverId, activity);
  }

  const seen = new Set(Object.keys(map));
  const now = Date.now();

  for (const channelId of seen) {
    const snapshot = map[channelId];
    const current =
      activity.get(channelId) ??
      {
        total: 0,
        high: 0,
        low: 0,
        threadHigh: 0,
        lastActivity: null,
        latestHigh: null
      };

    current.total = snapshot?.total ?? 0;
    current.high = snapshot?.high ?? 0;
    current.low = snapshot?.low ?? 0;
    if (current.total + (current.threadHigh ?? 0) > 0) {
      if (!current.lastActivity) current.lastActivity = now;
      ensureLatestWatcher(serverId, channelId);
    } else {
      current.lastActivity = null;
      current.preview = null;
      current.priorityPreview = null;
      current.latestHigh = null;
      stopLatestWatcher(serverId, channelId);
    }

    if (snapshot?.latestHigh) {
      current.latestHigh = {
        reason: snapshot.latestHigh.reason,
        snippet: snapshot.latestHigh.snippet ?? null,
        author: snapshot.latestHigh.author ?? null,
        timestamp: snapshot.latestHigh.timestamp ?? null,
        sourceId: snapshot.latestHigh.id ?? null
      };
      current.priorityPreview =
        snapshot.latestHigh.snippet ??
        formatPreview(snapshot.latestHigh.author ?? null, snapshot.latestHigh.snippet ?? null);
    } else if (current.high === 0 && current.threadHigh === 0) {
      current.latestHigh = null;
      current.priorityPreview = null;
    }

    activity.set(channelId, current);
  }

  for (const [channelId, current] of activity) {
    if (!seen.has(channelId)) {
      if ((current.threadHigh ?? 0) > 0) continue;
      activity.delete(channelId);
      stopLatestWatcher(serverId, channelId);
    }
  }

  recompute();
}

function watchServerChannels(serverId: string) {
  if (serverChannelStops.has(serverId)) return;
  const db = getDb();
  const q = query(collection(db, 'servers', serverId, 'channels'), orderBy('position'));
  const stop = onSnapshot(
    q,
    (snap) => {
      const meta = new Map<string, ChannelMeta>();
      snap.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const name =
          typeof data?.name === 'string' && data.name.trim().length
            ? data.name.trim()
            : 'channel';
        const type = data?.type === 'voice' ? 'voice' : 'text';
        meta.set(docSnap.id, { id: docSnap.id, serverId, name, type });
      });
      serverChannelMeta.set(serverId, meta);

      const validIds = new Set(meta.keys());
      const activity = serverChannelActivity.get(serverId);
      if (activity) {
        for (const [channelId] of activity) {
          if (!validIds.has(channelId)) {
            activity.delete(channelId);
            stopLatestWatcher(serverId, channelId);
          }
        }
      }
      recompute();
    },
    () => {
      serverChannelMeta.delete(serverId);
    }
  );
  serverChannelStops.set(serverId, stop);
}

function watchServerUnread(uid: string, serverId: string) {
  if (serverUnreadStops.has(serverId)) return;
  const stop = subscribeUnreadForServer(uid, serverId, (map) => handleUnreadUpdate(serverId, map));
  serverUnreadStops.set(serverId, stop);
}

function ensureServerWatchers(uid: string, serverId: string) {
  watchServerChannels(serverId);
  watchServerUnread(uid, serverId);
}

function stopServerWatchers(serverId: string) {
  serverChannelStops.get(serverId)?.();
  serverChannelStops.delete(serverId);

  serverUnreadStops.get(serverId)?.();
  serverUnreadStops.delete(serverId);

  const perServerLatest = latestMessageStops.get(serverId);
  if (perServerLatest) {
    perServerLatest.forEach((stop) => stop());
    latestMessageStops.delete(serverId);
  }

  serverChannelMeta.delete(serverId);
  serverChannelActivity.delete(serverId);
  serverLatestMessages.delete(serverId);
}

function handleServersUpdate(uid: string, rows: ServerInfo[]) {
  const seen = new Set<string>();
  rows.forEach((row) => {
    servers.set(row.id, row);
    seen.add(row.id);
    ensureServerWatchers(uid, row.id);
  });

  for (const [serverId] of servers) {
    if (!seen.has(serverId)) {
      servers.delete(serverId);
      stopServerWatchers(serverId);
    }
  }

  recompute();
}

function startServerRail(uid: string) {
  stopServers = subscribeUserServers(uid, (rows) => handleServersUpdate(uid, rows));
}

function startDMWatchers(uid: string) {
  stopDMs = streamMyDMs(uid, (rows) => {
    const seen = new Set<string>();
    rows.forEach((row) => {
      const id = row.id;
      dmRows.set(id, row);
      seen.add(id);
      if (!dmUnreadStops.has(id)) {
        const stop = streamUnreadCount(id, uid, (count) => {
          dmCounts.set(id, count);
          recompute();
        });
        dmUnreadStops.set(id, stop);
      }
    });

    for (const [threadId, stop] of dmUnreadStops) {
      if (!seen.has(threadId)) {
        stop();
        dmUnreadStops.delete(threadId);
        dmCounts.delete(threadId);
        dmRows.delete(threadId);
      }
    }

    recompute();
  });
}

function channelThreadKey(serverId: string, channelId: string) {
  return `${serverId}:${channelId}`;
}

function updateThreadActivityEntry(state: ThreadState) {
  if (state.unread > 0) {
    threadActivities.set(state.threadId, {
      threadId: state.threadId,
      serverId: state.serverId,
      channelId: state.channelId,
      title: state.name ?? 'Thread',
      preview: state.preview ?? null,
      lastActivity: state.lastMessageAt ?? Date.now(),
      unread: state.unread
    });
  } else {
    threadActivities.delete(state.threadId);
  }
}

function applyThreadContribution(state: ThreadState, nextUnread: number) {
  const key = channelThreadKey(state.serverId, state.channelId);
  const currentTotal = channelThreadTotals.get(key) ?? 0;
  const delta = nextUnread - (state.unread ?? 0);
  const nextTotal = Math.max(0, currentTotal + delta);
  channelThreadTotals.set(key, nextTotal);
  state.unread = nextUnread;

  let serverMap = serverChannelActivity.get(state.serverId);
  if (!serverMap) {
    serverMap = new Map();
    serverChannelActivity.set(state.serverId, serverMap);
  }
  const existing =
    serverMap.get(state.channelId) ??
    {
      total: 0,
      high: 0,
      low: 0,
      threadHigh: 0,
      lastActivity: null,
      latestHigh: null
    };
  existing.threadHigh = nextTotal;
  if (nextTotal > 0 && !existing.lastActivity) {
    existing.lastActivity = state.lastMessageAt ?? Date.now();
  } else if (nextTotal === 0 && existing.high === 0 && existing.low === 0) {
    existing.lastActivity = null;
  }
  serverMap.set(state.channelId, existing);
}

function scheduleThreadRecompute(state: ThreadState) {
  if (state.recomputeRunning) {
    state.recomputeQueued = true;
    return;
  }
  state.recomputeRunning = true;
  state.recomputeQueued = false;
  computeThreadUnread(state)
    .catch((err) => {
      console.warn('[notifications] failed to compute thread unread', { threadId: state.threadId }, err);
    })
    .finally(() => {
      state.recomputeRunning = false;
      if (state.recomputeQueued) {
        state.recomputeQueued = false;
        scheduleThreadRecompute(state);
      }
    });
}

async function computeThreadUnread(state: ThreadState) {
  try {
    const db = getDb();
    const base = collection(
      db,
      'servers',
      state.serverId,
      'channels',
      state.channelId,
      'threads',
      state.threadId,
      'messages'
    );
    const constraints = state.lastReadAt ? [where('createdAt', '>', state.lastReadAt)] : [];
    const agg = await getCountFromServer(query(base, ...constraints));
    const unread = agg.data().count ?? 0;
    applyThreadContribution(state, unread);
    updateThreadActivityEntry(state);
    recompute();
  } catch (err) {
    console.warn('[notifications] thread unread fetch failed', { threadId: state.threadId }, err);
  }
}

function attachThreadMeta(state: ThreadState) {
  const db = getDb();
  const ref = doc(
    db,
    'servers',
    state.serverId,
    'channels',
    state.channelId,
    'threads',
    state.threadId
  );
  state.stopMeta?.();
  state.stopMeta = onSnapshot(
    ref,
    (snap) => {
      const data: any = snap.data() ?? {};
      state.name = typeof data?.name === 'string' && data.name.trim() ? data.name : state.name ?? null;
      state.preview = data?.lastMessagePreview ?? state.preview ?? null;
      state.lastMessageAt = timestampToMillis(data?.lastMessageAt) ?? state.lastMessageAt ?? null;
      scheduleThreadRecompute(state);
    },
    () => {
      state.stopMeta?.();
      state.stopMeta = undefined;
    }
  );
}

function detachThread(threadId: string) {
  const state = threadStates.get(threadId);
  if (!state) return;
  state.stopMeta?.();
  state.stopMeta = undefined;
  applyThreadContribution(state, 0);
  updateThreadActivityEntry(state);
  threadStates.delete(threadId);
}

function startThreadWatchers(uid: string) {
  stopThreads = onSnapshot(
    collection(getDb(), 'profiles', uid, 'threadMembership'),
    (snap) => {
      const seen = new Set<string>();
      snap.forEach((docSnap) => {
        const data: any = docSnap.data() ?? {};
        const serverId = data.serverId ?? data.serverID ?? null;
        const channelId = data.channelId ?? data.parentChannelId ?? null;
        if (!serverId || !channelId) return;
        seen.add(docSnap.id);
        let state = threadStates.get(docSnap.id);
        if (!state) {
          state = {
            threadId: docSnap.id,
            serverId,
            channelId,
            name: data.name ?? null,
            preview: null,
            lastMessageAt: null,
            lastReadAt: data.lastReadAt ?? null,
            unread: 0,
            recomputeQueued: false,
            recomputeRunning: false
          };
          threadStates.set(docSnap.id, state);
          attachThreadMeta(state);
        } else {
          state.lastReadAt = data.lastReadAt ?? null;
        }
        scheduleThreadRecompute(state);
      });
      for (const threadId of Array.from(threadStates.keys())) {
        if (!seen.has(threadId)) {
          detachThread(threadId);
        }
      }
      recompute();
    },
    () => {
      stopThreadWatchers();
    }
  );
}

function stopThreadWatchers() {
  stopThreads?.();
  stopThreads = null;
  threadStates.forEach((state) => state.stopMeta?.());
  threadStates.clear();
  threadActivities.clear();
  channelThreadTotals.clear();
}

function cleanupAll() {
  stopServers?.();
  stopServers = null;

  serverChannelStops.forEach((stop) => stop());
  serverChannelStops.clear();

  serverUnreadStops.forEach((stop) => stop());
  serverUnreadStops.clear();

  latestMessageStops.forEach((perServer) => perServer.forEach((stop) => stop()));
  latestMessageStops.clear();

  servers.clear();
  serverChannelMeta.clear();
  serverChannelActivity.clear();
  serverLatestMessages.clear();

  stopDMs?.();
  stopDMs = null;

  dmUnreadStops.forEach((stop) => stop());
  dmUnreadStops.clear();
  dmRows.clear();
  dmCounts.clear();
  stopThreadWatchers();

  setActivePushUser(null);
  activeUid = null;
  notificationsInternal.set([]);
  notificationCountInternal.set(0);
  dmUnreadCountInternal.set(0);
  channelUnreadCountInternal.set(0);
  channelIndicatorsInternal.set({});
  readyInternal.set(false);
  if (browser) {
    const nav = navigator as any;
    const clearer: (() => Promise<void> | void) | undefined =
      typeof nav?.clearAppBadge === 'function'
        ? nav.clearAppBadge.bind(nav)
        : typeof nav?.clearClientBadge === 'function'
          ? nav.clearClientBadge.bind(nav)
          : undefined;
    if (clearer) {
      lastBadgeValue = 0;
      Promise.resolve()
        .then(() => clearer())
        .catch(() => {});
    } else {
      lastBadgeValue = null;
    }
  } else {
    lastBadgeValue = null;
  }
}

function recompute() {
  const list: NotificationItem[] = [];
  let dmTotal = 0;
  let channelTotal = 0;

  for (const [serverId, activity] of serverChannelActivity) {
    const serverInfo = servers.get(serverId);
    const channels = serverChannelMeta.get(serverId);
    for (const [channelId, meta] of channels ?? []) {
      const stats = activity.get(channelId);
      if (!stats) continue;
      const directTotal = (stats.high ?? 0) + (stats.low ?? 0);
      const threadHigh = stats.threadHigh ?? 0;
      const total = directTotal + threadHigh;
      if (!total) continue;
      channelTotal += total;
      const latest = serverLatestMessages.get(serverId)?.get(channelId) ?? null;
      const highCount = (stats.high ?? 0) + threadHigh;
      const lowCount = stats.low ?? 0;
      const priority: NotificationItem['priority'] = highCount > 0 ? 'high' : 'low';
      const title =
        meta?.type === 'voice'
          ? meta?.name ?? 'Voice channel'
          : meta?.name
            ? `#${meta.name}`
            : 'Channel';
      const mentionFlag = stats.latestHigh?.reason === 'mention';
      const fallbackPreview =
        formatPreview(latest?.author ?? null, latest?.snippet ?? null) ??
        (total === 1 ? '1 new message' : `${total} new messages`);
      const preview =
        priority === 'high'
          ? stats.priorityPreview ??
            formatPreview(stats.latestHigh?.author ?? null, stats.latestHigh?.snippet ?? null) ??
            fallbackPreview
          : stats.preview ?? fallbackPreview;
      const unreadValue = priority === 'high' ? highCount : lowCount;

      list.push({
        id: `server:${serverId}:${channelId}`,
        kind: 'channel',
        priority,
        serverId,
        channelId,
        title,
        context: serverInfo?.name ?? 'Server',
        preview,
        unread: unreadValue,
        highCount,
        lowCount,
        lastActivity: stats.lastActivity ?? latest?.timestamp ?? Date.now(),
        href: `/servers/${serverId}?channel=${channelId}`,
        photoURL: serverInfo?.icon ?? null,
        isMention: mentionFlag,
        reason: stats.latestHigh?.reason ?? null
      });
    }
  }

  for (const thread of threadActivities.values()) {
    if (!thread.unread) continue;
    const serverInfo = servers.get(thread.serverId);
    const channelMeta = serverChannelMeta.get(thread.serverId)?.get(thread.channelId);
    const channelLabel = channelMeta?.name ? `#${channelMeta.name}` : null;
    list.push({
      id: `thread:${thread.threadId}`,
      kind: 'thread',
      priority: 'high',
      serverId: thread.serverId,
      channelId: thread.channelId,
      threadId: thread.threadId,
      title: thread.title,
      context:
        serverInfo?.name && channelLabel
          ? `${serverInfo.name} • ${channelLabel}`
          : serverInfo?.name ?? channelLabel ?? 'Thread',
      preview: thread.preview ?? 'New replies in this thread',
      unread: thread.unread,
      highCount: thread.unread,
      lastActivity: thread.lastActivity ?? Date.now(),
      href: `/servers/${thread.serverId}?channel=${thread.channelId}&thread=${thread.threadId}`,
      reason: 'thread'
    });
  }

  for (const [threadId, count] of dmCounts) {
    if (!count) continue;
    const row = dmRows.get(threadId);
    const display =
      row?.otherDisplayName?.trim() ||
      row?.otherEmail?.trim() ||
      'Direct message';
    const preview = truncate(row?.lastMessage ?? '', 84) ?? 'New message';
    const ts = timestampToMillis(row?.updatedAt) ?? Date.now();
    dmTotal += count;
    list.push({
      id: `dm:${threadId}`,
      kind: 'dm',
      priority: 'high',
      threadId,
      title: display,
      context: 'Direct messages',
      preview,
      unread: count,
      highCount: count,
      lastActivity: ts,
      href: `/dms/${threadId}`,
      photoURL: row?.otherPhotoURL ?? null
    });
  }

  const indicatorPayload: Record<string, Record<string, ChannelIndicatorState>> = {};
  for (const [serverId, activity] of serverChannelActivity) {
    const inner: Record<string, ChannelIndicatorState> = {};
    for (const [channelId, stats] of activity) {
      inner[channelId] = {
        high: (stats.high ?? 0) + (stats.threadHigh ?? 0),
        low: stats.low ?? 0
      };
    }
    if (Object.keys(inner).length) {
      indicatorPayload[serverId] = inner;
    }
  }
  channelIndicatorsInternal.set(indicatorPayload);

  list.sort((a, b) => {
    const aTime = a.lastActivity ?? 0;
    const bTime = b.lastActivity ?? 0;
    if (aTime === bTime) {
      return a.title.localeCompare(b.title);
    }
    return bTime - aTime;
  });

  const total = channelTotal + dmTotal;

  notificationsInternal.set(list);
  notificationCountInternal.set(total);
  dmUnreadCountInternal.set(dmTotal);
  channelUnreadCountInternal.set(channelTotal);
  readyInternal.set(true);

  if (browser) {
    const nav = navigator as any;
    const setter: ((value?: number) => Promise<void> | void) | undefined =
      typeof nav?.setAppBadge === 'function'
        ? nav.setAppBadge.bind(nav)
        : typeof nav?.setClientBadge === 'function'
          ? nav.setClientBadge.bind(nav)
          : undefined;
    const clearer: (() => Promise<void> | void) | undefined =
      typeof nav?.clearAppBadge === 'function'
        ? nav.clearAppBadge.bind(nav)
        : typeof nav?.clearClientBadge === 'function'
          ? nav.clearClientBadge.bind(nav)
          : undefined;

    if (setter && clearer) {
      const next = total > 0 ? Math.min(total, 9999) : 0;
      if (next === 0 && lastBadgeValue !== 0) {
        lastBadgeValue = 0;
        Promise.resolve()
          .then(() => clearer())
          .catch(() => {});
      } else if (next > 0 && next !== lastBadgeValue) {
        lastBadgeValue = next;
        Promise.resolve()
          .then(() => setter(next))
          .catch(() => {});
      }
    }
  }
}

if (browser) {
  user.subscribe((value) => {
    const uid = value?.uid ?? null;
    if (uid === activeUid) return;
    cleanupAll();
    setActivePushUser(uid);
    if (!uid) return;
    ensureNotificationSettings(uid).catch(() => {});
    activeUid = uid;
    if (!pushSetupFor.has(uid)) {
      pushSetupFor.add(uid);
      Promise.resolve()
        .then(() => registerFirebaseMessagingSW())
        .then(() => syncDeviceRegistration(uid))
        .catch(() => {
          pushSetupFor.delete(uid);
        });
    } else {
      void syncDeviceRegistration(uid);
    }
    startServerRail(uid);
    startDMWatchers(uid);
    startThreadWatchers(uid);
  });
}



