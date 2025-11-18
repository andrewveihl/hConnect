import { URLSearchParams } from 'url';

import { logger } from 'firebase-functions';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { FirestoreEvent, QueryDocumentSnapshot } from 'firebase-functions/v2/firestore';

import { db, messaging } from './firebase';
import {
  fetchDeviceTokens,
  fetchNotificationSettings,
  fetchPresence,
  perChannelKey,
  perRoleKey
} from './settings';
import type {
  ChannelDoc,
  DmDoc,
  MentionEntry,
  MentionKind,
  MentionType,
  NotificationSettings,
  RawMessage,
  ServerDoc,
  ServerMember,
  ThreadDoc
} from './types';

const SPECIAL_MENTION_IDS = {
  EVERYONE: 'special:mention:everyone',
  HERE: 'special:mention:here'
} as const;

const MENTION_PRIORITY: Record<MentionType, number> = {
  dm: 5,
  direct: 4,
  role: 3,
  here: 2,
  everyone: 1
};

type MessageContext = {
  serverId?: string;
  channelId?: string;
  threadId?: string | null;
  dmId?: string | null;
  messageId: string;
  server?: ServerDoc | null;
  channel?: ChannelDoc | null;
  thread?: ThreadDoc | null;
  dm?: DmDoc | null;
  roleNames?: Record<string, string>;
};

type CandidateTarget = {
  uid: string;
  mentionType: MentionType;
  roleId?: string | null;
  requirePresence?: boolean;
};

type DeliveryTarget = CandidateTarget & {
  settings: NotificationSettings;
};

class ServerMemberCache {
  private cache = new Map<string, ServerMember>();
  private fullyLoaded = false;

  constructor(private readonly serverId: string) {}

  async get(uid: string): Promise<ServerMember | null> {
    if (this.cache.has(uid)) return this.cache.get(uid)!;
    try {
      const snap = await db.doc(`servers/${this.serverId}/members/${uid}`).get();
      if (!snap.exists) return null;
      const payload = snap.data() as ServerMember;
      const member: ServerMember = { ...payload, uid };
      this.cache.set(uid, member);
      return member;
    } catch (err) {
      logger.warn('Failed to load member', { serverId: this.serverId, uid, err });
      return null;
    }
  }

  async getAll(): Promise<ServerMember[]> {
    if (this.fullyLoaded) {
      return Array.from(this.cache.values());
    }
    try {
      const snap = await db.collection(`servers/${this.serverId}/members`).get();
      snap.forEach((docSnap) => {
        const payload = docSnap.data() as ServerMember;
        this.cache.set(docSnap.id, { ...payload, uid: docSnap.id });
      });
      this.fullyLoaded = true;
    } catch (err) {
      logger.error('Failed to list server members', { serverId: this.serverId, err });
    }
    return Array.from(this.cache.values());
  }
}

const mentionLabel = (type: MentionType, roleName?: string | null) => {
  switch (type) {
    case 'dm':
      return '[DM]';
    case 'direct':
      return '[mention]';
    case 'role':
      return roleName ? `[@${roleName}]` : '[@role]';
    case 'here':
      return '[here]';
    case 'everyone':
    default:
      return '[everyone]';
  }
};

function normalizeUid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeUidList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const set = new Set<string>();
  for (const value of values) {
    const uid = normalizeUid(value);
    if (uid) set.add(uid);
  }
  return Array.from(set);
}

function normalizeUidMap(mapLike: unknown): string[] {
  if (!mapLike || typeof mapLike !== 'object') return [];
  const set = new Set<string>();
  const entries = Object.entries(mapLike as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (!value) continue;
    const uid = normalizeUid(key);
    if (uid) set.add(uid);
  }
  return Array.from(set);
}

function resolveDmParticipants(dm: DmDoc | null): string[] {
  if (!dm) return [];
  const sources: string[][] = [
    normalizeUidList(dm.participants),
    normalizeUidList(dm.participantUids),
    normalizeUidMap(dm.participantsMap),
    typeof dm.key === 'string' ? normalizeUidList(dm.key.split('_')) : []
  ];
  for (const list of sources) {
    if (list.length) return list;
  }
  return [];
}

function extractMentions(message: RawMessage): MentionEntry[] {
  if (Array.isArray(message?.mentions) && message.mentions.length) {
    return message.mentions;
  }
  if (message?.mentionsMap && typeof message.mentionsMap === 'object') {
    return Object.keys(message.mentionsMap).map((key) => ({
      uid: key,
      ...(message.mentionsMap?.[key] ?? {})
    }));
  }
  return [];
}

function previewFromMessage(message: RawMessage): string {
  if (message.plainTextContent) return truncate(message.plainTextContent, 120);
  if (message.text) return truncate(message.text, 120);
  if (message.content) return truncate(message.content, 120);
  switch (message.type) {
    case 'gif':
      return 'Shared a GIF';
    case 'file':
      return 'Shared a file';
    case 'form':
      return 'Shared a form';
    case 'poll':
      return 'Shared a poll';
    default:
      return 'New message';
  }
}

function truncate(text: string | null | undefined, max = 120) {
  if (!text) return 'New message';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function toMillis(value: any): number {
  try {
    if (!value) return Date.now();
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : Date.now();
    }
  } catch {
    return Date.now();
  }
  return Date.now();
}

function toTimestamp(value: any): Timestamp {
  if (value instanceof Timestamp) return value;
  if (value && typeof value.toMillis === 'function') {
    return Timestamp.fromMillis(value.toMillis());
  }
  const millis = toMillis(value);
  return Timestamp.fromMillis(millis);
}

function buildDeepLink(context: MessageContext) {
  if (context.dmId) {
    const params = new URLSearchParams({ origin: 'push' });
    if (context.messageId) params.set('messageId', context.messageId);
    return `/dms/${context.dmId}?${params.toString()}`;
  }
  if (context.serverId && context.channelId) {
    const params = new URLSearchParams({ origin: 'push', channel: context.channelId });
    if (context.threadId) params.set('thread', context.threadId);
    if (context.messageId) params.set('messageId', context.messageId);
    return `/servers/${context.serverId}?${params.toString()}`;
  }
  return '/?origin=push';
}

function describeTitle(context: MessageContext): string {
  if (context.dmId) {
    return 'Direct message';
  }
  const serverName = context.server?.name ?? 'Server';
  const channelName = context.channel?.name ? `#${context.channel.name}` : '#channel';
  if (context.threadId) {
    const threadName = context.thread?.name ?? 'Thread';
    return `[${serverName}] ${channelName} • ${threadName}`;
  }
  return `[${serverName}] ${channelName}`;
}

function describeDmTitle(dm: DmDoc | null | undefined, sender: string): string {
  const participants = Array.isArray(dm?.participants) ? dm?.participants.length : 0;
  if (participants && participants > 2) {
    const name = dm?.name || dm?.title || 'Group DM';
    return `${sender} in ${name}`;
  }
  return sender;
}

function pickAuthorName(message: RawMessage) {
  return (
    message.displayName ||
    message.author?.displayName ||
    message.authorId ||
    message.uid ||
    'Someone'
  );
}

function pickMentionUids(mentions: MentionEntry[], kind?: MentionKind | null) {
  return mentions
    .filter((entry) => {
      if (!kind) return entry.kind !== 'special' && entry.kind !== 'role';
      return entry.kind === kind;
    })
    .map((entry) => normalizeUid(entry.uid))
    .filter((uid): uid is string => Boolean(uid));
}

function hasSpecialMention(mentions: MentionEntry[], id: string) {
  return mentions.some((entry) => entry.uid === id || entry.handle === id);
}

async function computeServerCandidates(options: {
  message: RawMessage;
  serverId: string;
  channelId: string;
  authorId: string | null;
  memberCache: ServerMemberCache;
}): Promise<CandidateTarget[]> {
  const { message, serverId, channelId, authorId, memberCache } = options;
  const mentionList = extractMentions(message);
  const directMentionUids = pickMentionUids(mentionList);
  const roleMentionIds = pickMentionUids(mentionList, 'role');
  const includeEveryone = hasSpecialMention(mentionList, SPECIAL_MENTION_IDS.EVERYONE);
  const includeHere = hasSpecialMention(mentionList, SPECIAL_MENTION_IDS.HERE);
  const candidateMap = new Map<string, CandidateTarget>();

  const addCandidate = (candidate: CandidateTarget) => {
    if (!candidate.uid || candidate.uid === authorId) return;
    const existing = candidateMap.get(candidate.uid);
    if (!existing || MENTION_PRIORITY[candidate.mentionType] > MENTION_PRIORITY[existing.mentionType]) {
      candidateMap.set(candidate.uid, candidate);
    }
  };

  await Promise.all(
    directMentionUids.map(async (uid) => {
      const member = await memberCache.get(uid);
      if (!member) return;
      addCandidate({ uid, mentionType: 'direct' });
    })
  );

  if (roleMentionIds.length) {
    const members = await memberCache.getAll();
    for (const roleId of roleMentionIds) {
      for (const member of members) {
        const roleIds = Array.isArray(member.roleIds) ? member.roleIds : [];
        if (roleIds.includes(roleId) && member.uid !== authorId) {
          addCandidate({ uid: member.uid, mentionType: 'role', roleId });
        }
      }
    }
  }

  if (includeEveryone || includeHere) {
    const members = await memberCache.getAll();
    if (includeEveryone) {
      members.forEach((member) =>
        addCandidate({ uid: member.uid, mentionType: 'everyone', requirePresence: false })
      );
    }
    if (includeHere) {
      members.forEach((member) =>
        addCandidate({ uid: member.uid, mentionType: 'here', requirePresence: true })
      );
    }
  }

  return Array.from(candidateMap.values());
}

function presenceAllowsHere(presence: Awaited<ReturnType<typeof fetchPresence>>): boolean {
  const raw = (presence?.state || presence?.status || '').toLowerCase();
  if (!raw) return false;
  return raw === 'online' || raw === 'active' || raw === 'idle';
}

function respectsSettings(
  settings: NotificationSettings,
  candidate: CandidateTarget,
  opts: { serverId?: string; channelId?: string; threadId?: string | null; isDM?: boolean }
): boolean {
  if (settings.globalMute) return false;
  if (settings.doNotDisturbUntil && settings.doNotDisturbUntil > Date.now()) return false;
  if (opts.isDM) {
    if (settings.muteDMs) return false;
    return true;
  }
  if (!opts.serverId || !opts.channelId) return false;
  if (settings.muteServerIds?.includes(opts.serverId)) return false;
  if (settings.perChannelMute?.[perChannelKey(opts.serverId, opts.channelId)]) return false;
  if (opts.threadId && settings.allowThreadPush === false) return false;

  switch (candidate.mentionType) {
    case 'direct':
      return settings.allowMentionPush !== false;
    case 'role':
      if (!settings.allowMentionPush || settings.allowRoleMentionPush === false) return false;
      if (candidate.roleId) {
        if (settings.perRoleMute?.[perRoleKey(opts.serverId, candidate.roleId)]) return false;
      }
      return true;
    case 'here':
      return settings.allowMentionPush && settings.allowHereMentionPush !== false;
    case 'everyone':
      return settings.allowMentionPush && settings.allowEveryoneMentionPush !== false;
    default:
      return true;
  }
}

async function filterCandidates(
  candidates: CandidateTarget[],
  opts: { serverId?: string; channelId?: string; threadId?: string | null; isDM?: boolean }
): Promise<DeliveryTarget[]> {
  const deliveries: DeliveryTarget[] = [];
  for (const candidate of candidates) {
    const settings = await fetchNotificationSettings(candidate.uid);
    if (!respectsSettings(settings, candidate, opts)) continue;
    if (candidate.requirePresence) {
      const presence = await fetchPresence(candidate.uid);
      if (!presenceAllowsHere(presence)) continue;
    }
    deliveries.push({ ...candidate, settings });
  }
  return deliveries;
}

async function fetchRoleNames(serverId: string, roleIds: string[]): Promise<Record<string, string>> {
  const ids = Array.from(new Set(roleIds.filter((value): value is string => Boolean(value))));
  if (!ids.length) return {};
  const entries = await Promise.all(
    ids.map(async (id) => {
      try {
        const snap = await db.doc(`servers/${serverId}/roles/${id}`).get();
        if (!snap.exists) return [id, 'role'] as const;
        const data = snap.data() as { name?: string };
        return [id, data?.name || 'role'] as const;
      } catch {
        return [id, 'role'] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}

async function writeActivityEntry(
  uid: string,
  recipient: DeliveryTarget,
  message: RawMessage,
  context: MessageContext,
  title: string,
  body: string,
  hasPush: boolean
): Promise<string> {
  const ref = db.collection(`profiles/${uid}/activity`).doc();
  const preview = previewFromMessage(message);
  const authorName = pickAuthorName(message);
  const createdAt = message.createdAt ? toTimestamp(message.createdAt) : FieldValue.serverTimestamp();

  await ref.set({
    id: ref.id,
    type:
      recipient.mentionType === 'dm'
        ? 'dm'
        : recipient.mentionType === 'role'
          ? 'roleMention'
          : recipient.mentionType,
    mentionType: recipient.mentionType,
    context: {
      serverId: context.serverId ?? null,
      serverName: context.server?.name ?? null,
      channelId: context.channelId ?? null,
      channelName: context.channel?.name ?? null,
      threadId: context.threadId ?? null,
      threadName: context.thread?.name ?? null,
      dmId: context.dmId ?? null
    },
    messageInfo: {
      messageId: context.messageId,
      authorId: normalizeUid(message.authorId || message.uid),
      authorName,
      previewText: preview,
      createdAt
    },
    status: {
      unread: true,
      readAt: null,
      clicked: false
    },
    title,
    body,
    deepLink: buildDeepLink(context),
    createdAt: FieldValue.serverTimestamp(),
    lastNotifiedAt: FieldValue.serverTimestamp(),
    hasPush
  });
  return ref.id;
}

async function sendPushToTokens(tokens: string[], payload: { title: string; body: string; data: Record<string, string> }) {
  if (!tokens.length) return;
  try {
    await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: payload.title,
        body: payload.body
      },
      data: payload.data,
      webpush: {
        fcmOptions: {
          link: payload.data.targetUrl
        }
      }
    });
  } catch (err) {
    logger.error('Failed to send push payload', err);
  }
}

async function deliverToRecipients(
  recipients: DeliveryTarget[],
  message: RawMessage,
  context: MessageContext
) {
  const roleNames = context.roleNames ?? {};
  const authorName = pickAuthorName(message);
  const preview = previewFromMessage(message);

  await Promise.all(
    recipients.map(async (recipient) => {
      const tokens = await fetchDeviceTokens(recipient.uid);
      const title = context.dmId
        ? describeDmTitle(context.dm ?? null, authorName)
        : describeTitle(context);
      const roleName = recipient.roleId ? roleNames[recipient.roleId] : null;
      const label = mentionLabel(recipient.mentionType, roleName);
      const body = `${label} ${authorName}: ${preview}`;
      const activityId = await writeActivityEntry(
        recipient.uid,
        recipient,
        message,
        context,
        title,
        body,
        tokens.length > 0
      );
      if (!tokens.length) return;
      const data: Record<string, string> = {
        title,
        body,
        mentionType: recipient.mentionType,
        messageId: context.messageId,
        activityId,
        origin: 'push',
        targetUrl: buildDeepLink(context)
      };
      if (context.serverId) data.serverId = context.serverId;
      if (context.channelId) data.channelId = context.channelId;
      if (context.threadId) data.threadId = context.threadId;
      if (context.dmId) data.dmId = context.dmId;
      if (recipient.roleId) data.roleId = recipient.roleId;
      await sendPushToTokens(tokens, { title, body, data });
    })
  );
}

export async function sendTestPushForUid(
  uid: string
): Promise<{ sent: number; reason?: string }> {
  logger.info('[testPush] Fetching device tokens', { uid });
  const tokens = await fetchDeviceTokens(uid);
  logger.info('[testPush] Device token check complete', { uid, count: tokens.length });
  if (!tokens.length) {
    logger.warn('[testPush] No tokens found for user', { uid });
    return { sent: 0, reason: 'no_tokens' };
  }
  const title = 'hConnect test notification';
  const body = 'Push notifications are working on this device.';
  try {
    logger.info('[testPush] Sending push payload', { uid, count: tokens.length });
    await sendPushToTokens(tokens, {
      title,
      body,
      data: {
        title,
        body,
        origin: 'push',
        mentionType: 'direct',
        targetUrl: '/?origin=push',
        messageId: `test-${Date.now()}`
      }
    });
    logger.info('[testPush] Push send call completed', { uid, count: tokens.length });
  } catch (error) {
    logger.error('[testPush] Failed to send push payload', { uid, error });
    throw error;
  }
  return { sent: tokens.length };
}

type ChannelMessageEvent = FirestoreEvent<
  QueryDocumentSnapshot | undefined,
  { serverId: string; channelId: string; messageId: string }
>;

type ThreadMessageEvent = FirestoreEvent<
  QueryDocumentSnapshot | undefined,
  { serverId: string; channelId: string; threadId: string; messageId: string }
>;

type DmMessageEvent = FirestoreEvent<
  QueryDocumentSnapshot | undefined,
  { threadID: string; messageId: string }
>;

function messageFromEvent(event: FirestoreEvent<QueryDocumentSnapshot | undefined>): RawMessage | null {
  const data = event.data?.data();
  return data ? (data as RawMessage) : null;
}

export async function handleServerMessage(event: ChannelMessageEvent) {
  const { serverId, channelId, messageId } = event.params;
  if (!serverId || !channelId || !messageId) return;
  const message = messageFromEvent(event);
  if (!message) return;
  const authorId = normalizeUid(message.authorId || message.uid);
  if (!authorId) return;

  const [serverSnap, channelSnap] = await Promise.all([
    db.doc(`servers/${serverId}`).get(),
    db.doc(`servers/${serverId}/channels/${channelId}`).get()
  ]);
  const channel = (channelSnap.data() as ChannelDoc | undefined) ?? null;
  if (channel?.type === 'voice') return;
  const server = (serverSnap.data() as ServerDoc | undefined) ?? null;

  const memberCache = new ServerMemberCache(serverId);
  const candidates = await computeServerCandidates({
    message,
    serverId,
    channelId,
    authorId,
    memberCache
  });
  if (!candidates.length) return;
  const roleIds = candidates
    .map((candidate) => candidate.roleId)
    .filter((value): value is string => Boolean(value));
  const roleNames = await fetchRoleNames(serverId, roleIds);
  const recipients = await filterCandidates(candidates, {
    serverId,
    channelId,
    threadId: null,
    isDM: false
  });
  if (!recipients.length) return;

  await deliverToRecipients(recipients, message, {
    serverId,
    channelId,
    threadId: null,
    messageId,
    server,
    channel,
    roleNames
  });
}

export async function handleThreadMessage(event: ThreadMessageEvent) {
  const { serverId, channelId, threadId, messageId } = event.params;
  if (!serverId || !channelId || !threadId || !messageId) return;
  const message = messageFromEvent(event);
  if (!message) return;
  const authorId = normalizeUid(message.authorId || message.uid);
  if (!authorId) return;

  const [serverSnap, channelSnap, threadSnap] = await Promise.all([
    db.doc(`servers/${serverId}`).get(),
    db.doc(`servers/${serverId}/channels/${channelId}`).get(),
    db.doc(`servers/${serverId}/channels/${channelId}/threads/${threadId}`).get()
  ]);

  const server = (serverSnap.data() as ServerDoc | undefined) ?? null;
  const channel = (channelSnap.data() as ChannelDoc | undefined) ?? null;
  const thread = (threadSnap.data() as ThreadDoc | undefined) ?? null;

  const memberCache = new ServerMemberCache(serverId);
  const candidates = await computeServerCandidates({
    message,
    serverId,
    channelId,
    authorId,
    memberCache
  });
  if (!candidates.length) return;
  const roleIds = candidates
    .map((candidate) => candidate.roleId)
    .filter((value): value is string => Boolean(value));
  const roleNames = await fetchRoleNames(serverId, roleIds);
  const recipients = await filterCandidates(candidates, {
    serverId,
    channelId,
    threadId,
    isDM: false
  });
  if (!recipients.length) return;

  await deliverToRecipients(recipients, message, {
    serverId,
    channelId,
    threadId,
    messageId,
    server,
    channel,
    thread,
    roleNames
  });
}

function computeDmCandidates(dm: DmDoc | null, authorId: string | null): CandidateTarget[] {
  const participants = resolveDmParticipants(dm);
  return participants
    .map((uid) => normalizeUid(uid))
    .filter((uid): uid is string => Boolean(uid) && uid !== authorId)
    .map((uid) => ({ uid, mentionType: 'dm' as const }));
}

export async function handleDmMessage(event: DmMessageEvent) {
  const { threadID, messageId } = event.params;
  const dmId = threadID;
  if (!dmId || !messageId) return;
  const message = messageFromEvent(event);
  if (!message) return;
  const authorId = normalizeUid(message.authorId || message.uid);
  if (!authorId) return;

  const dmSnap = await db.doc(`dms/${dmId}`).get();
  if (!dmSnap.exists) return;
  const dm = (dmSnap.data() as DmDoc | undefined) ?? null;
  const candidates = computeDmCandidates(dm, authorId);
  if (!candidates.length) return;
  const recipients = await filterCandidates(candidates, {
    isDM: true
  });
  if (!recipients.length) return;

  await deliverToRecipients(recipients, message, {
    dmId,
    messageId,
    dm
  });
}

