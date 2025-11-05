import { browser } from '$app/environment';
import { writable, derived, type Readable } from 'svelte/store';
import { user } from '$lib/stores/user';
import { subscribeUserServers } from '$lib/firestore/servers';
import { streamMyDMs, streamUnreadCount } from '$lib/firestore/dms';
import { subscribeUnreadForServer, type UnreadMap } from '$lib/firebase/unread';
import { getDb } from '$lib/firebase';
import { collection, onSnapshot, orderBy, query, limit, type Unsubscribe } from 'firebase/firestore';
import { enablePushForUser, requestNotificationPermission, registerFirebaseMessagingSW } from '$lib/notify/push';

type ChannelMeta = {
  id: string;
  serverId: string;
  name: string;
  type: 'text' | 'voice';
};

type ChannelActivity = {
  count: number;
  lastActivity: number | null;
  preview?: string | null;
  hasMention?: boolean;
  lastMentionId?: string | null;
  mentionTimestamp?: number | null;
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
  kind: 'channel' | 'dm';
  serverId?: string;
  channelId?: string;
  threadId?: string;
  title: string;
  context?: string | null;
  preview?: string | null;
  unread: number;
  lastActivity: number | null;
  href: string;
  photoURL?: string | null;
  isMention?: boolean;
};

const notificationsInternal = writable<NotificationItem[]>([]);
const notificationCountInternal = writable(0);
const dmUnreadCountInternal = writable(0);
const channelUnreadCountInternal = writable(0);
const readyInternal = writable(false);
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

const servers = new Map<string, ServerInfo>();
const serverChannelMeta = new Map<string, Map<string, ChannelMeta>>();
const serverChannelActivity = new Map<string, Map<string, ChannelActivity>>();
const serverLatestMessages = new Map<string, Map<string, LatestMessage>>();

const dmRows = new Map<string, DMRow>();
const dmCounts = new Map<string, number>();
const notifiedMentionMessages = new Set<string>();
const notifiedDMVersions = new Map<string, number>();
const pushSetupFor = new Set<string>();

let stopServers: Unsubscribe | null = null;
const serverChannelStops = new Map<string, Unsubscribe>();
const serverUnreadStops = new Map<string, Unsubscribe>();
const latestMessageStops = new Map<string, Map<string, Unsubscribe>>();
let stopDMs: Unsubscribe | null = null;
const dmUnreadStops = new Map<string, Unsubscribe>();

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

function truncate(input: string | null | undefined, limitTo = 80): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.length <= limitTo) return trimmed;
  return `${trimmed.slice(0, limitTo - 1)}…`;
}

function pickMessageSnippet(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const textCandidates = ['text', 'content', 'message', 'body'];
  for (const key of textCandidates) {
    const value = data[key];
    if (typeof value === 'string') {
      const snippet = truncate(value, 84);
      if (snippet) return snippet;
    }
  }

  if (typeof data?.url === 'string' && data.url.trim()) {
    if (data?.type === 'gif') return 'Sent a GIF';
    return 'Shared a link';
  }

  if (data?.type === 'gif') return 'Sent a GIF';
  if (data?.type === 'poll') return 'Posted a poll';
  if (data?.type === 'form') return 'Shared a form';

  return null;
}

function pickAuthor(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const candidates = [
    data.displayName,
    data.author?.displayName,
    data.author?.name,
    data.name,
    data.uid
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function formatPreview(author: string | null, snippet: string | null): string | null {
  if (snippet && author) return `${author}: ${snippet}`;
  if (snippet) return snippet;
  if (author) return `${author} sent a message`;
  return null;
}

function normalizeUid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function extractMentionedUids(raw: any): string[] {
  const set = new Set<string>();
  if (Array.isArray(raw?.mentions)) {
    raw.mentions.forEach((entry: any) => {
      const uid = normalizeUid(entry?.uid ?? entry);
      if (uid) set.add(uid);
    });
  } else if (raw?.mentionsMap && typeof raw.mentionsMap === 'object') {
    Object.keys(raw.mentionsMap).forEach((key) => {
      const uid = normalizeUid(key);
      if (uid) set.add(uid);
    });
  }
  return Array.from(set);
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
        const current = activity.get(channelId) ?? { count: 0, lastActivity: ts };
        const basePreview = formatPreview(author, snippet);
        current.lastActivity = ts;
        if (!current.hasMention) {
          current.preview = basePreview;
        }
        if (mentionHit) {
          current.hasMention = true;
          current.lastMentionId = docSnap?.id ?? null;
          current.mentionTimestamp = ts;
          current.preview = snippet ? `You were mentioned — ${snippet}` : 'You were mentioned in this channel';
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
    const count = map[channelId] ?? 0;
    const current = activity.get(channelId) ?? { count: 0, lastActivity: null };
    current.count = count;
    if (count > 0) {
      if (!current.lastActivity) current.lastActivity = now;
      ensureLatestWatcher(serverId, channelId);
    } else {
      current.lastActivity = null;
      current.preview = null;
      current.hasMention = false;
      current.lastMentionId = null;
      current.mentionTimestamp = null;
      stopLatestWatcher(serverId, channelId);
    }
    activity.set(channelId, current);
  }

  for (const [channelId] of activity) {
    if (!seen.has(channelId)) {
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

  activeUid = null;
  notificationsInternal.set([]);
  notificationCountInternal.set(0);
  dmUnreadCountInternal.set(0);
  channelUnreadCountInternal.set(0);
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
      if (!stats || !stats.count) continue;
      channelTotal += stats.count;
      const latest = serverLatestMessages.get(serverId)?.get(channelId) ?? null;
      const title =
        meta?.type === 'voice'
          ? meta?.name ?? 'Voice channel'
          : meta?.name
            ? `#${meta.name}`
            : 'Channel';
      const mentionFlag = !!stats.hasMention;
      const preview =
        mentionFlag
          ? stats.preview ?? 'You were mentioned'
          : stats.preview ??
            formatPreview(latest?.author ?? null, latest?.snippet ?? null) ??
            (stats.count === 1 ? '1 new message' : `${stats.count} new messages`);
      list.push({
        id: `server:${serverId}:${channelId}`,
        kind: 'channel',
        serverId,
        channelId,
        title,
        context: serverInfo?.name ?? 'Server',
        preview,
        unread: stats.count,
        lastActivity: stats.lastActivity ?? latest?.timestamp ?? Date.now(),
        href: `/servers/${serverId}?channel=${channelId}`,
        photoURL: serverInfo?.icon ?? null,
        isMention: mentionFlag
      });
    }
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
      threadId,
      title: display,
      context: 'Direct messages',
      preview,
      unread: count,
      lastActivity: ts,
      href: `/dms/${threadId}`,
      photoURL: row?.otherPhotoURL ?? null
    });
  }

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
    if (!uid) return;
    activeUid = uid;
    startServerRail(uid);
    startDMWatchers(uid);
  });
}
