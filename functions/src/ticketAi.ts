import { logger } from 'firebase-functions';
import { Timestamp } from 'firebase-admin/firestore';
import type { FirestoreEvent, QueryDocumentSnapshot } from 'firebase-functions/v2/firestore';

import { auth, db } from './firebase';

type IssueStatus = 'opened' | 'in_progress' | 'closed';

type TicketAiSettings = {
  enabled: boolean;
  monitoredChannelIds: string[];
  staffDomains: string[];
  staffMemberIds: string[];
  allowedRoleIds: string[];
  retention: 'forever' | '1y' | '90d';
  schedule?: {
    enabled: boolean;
    frequency: 'weekly' | 'monthly';
    dayOfWeek?: number | null;
    timeUtc?: string | null;
    targetChannelId?: string | null;
  };
};

type ThreadMeta = {
  createdFromMessageId?: string | null;
  createdAt?: Timestamp | FirebaseFirestore.Timestamp | null;
  name?: string | null;
  preview?: string | null;
};

type MessageMeta = {
  createdAt?: Timestamp | FirebaseFirestore.Timestamp | null;
  text?: string | null;
  content?: string | null;
  plainTextContent?: string | null;
  uid?: string | null;
  authorId?: string | null;
  reactions?: Record<string, unknown> | null;
  type?: string | null;
  systemKind?: string | null;
};

type IssueTimelineEntry = { status: IssueStatus; at: Timestamp };

type IssueDoc = {
  serverId: string;
  channelId: string;
  threadId: string;
  parentMessageId?: string | null;
  createdAt: Timestamp;
  rootCreatedAt: Timestamp;
  status: IssueStatus;
  statusTimeline: IssueTimelineEntry[];
  summary?: string | null;
  typeTag?: 'bug' | 'feature_request' | 'question' | 'other';
  reopenedAfterClose?: boolean;
  firstStaffResponseAt?: Timestamp | null;
  closedAt?: Timestamp | null;
  timeToFirstResponseMs?: number | null;
  timeToResolutionMs?: number | null;
  staffMemberIds?: string[];
  messageCount: number;
  staffMessageCount: number;
  clientMessageCount: number;
  lastMessageAt?: Timestamp | null;
  lastMessageText?: string | null;
  staffDomains?: string[];
  retention?: TicketAiSettings['retention'];
};

const SETTINGS_DOC_ID = 'current';
const RETENTION_WINDOWS: Record<string, number> = {
  forever: 0,
  '1y': 365 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000
};

const DEFAULT_SETTINGS: TicketAiSettings = {
  enabled: false,
  monitoredChannelIds: [],
  staffDomains: [],
  staffMemberIds: [],
  allowedRoleIds: [],
  retention: 'forever',
  schedule: {
    enabled: false,
    frequency: 'weekly',
    dayOfWeek: 1,
    timeUtc: '09:00',
    targetChannelId: null
  }
};

const normalizeList = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    set.add(trimmed);
  }
  return Array.from(set);
};

const normalizeDomain = (domain: string) => {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
};

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') {
    return value.toDate();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const retentionCutoff = (retention: TicketAiSettings['retention']): number | null => {
  const windowMs = RETENTION_WINDOWS[retention ?? 'forever'] ?? 0;
  if (!windowMs) return null;
  return Date.now() - windowMs;
};

async function fetchSettings(serverId: string): Promise<TicketAiSettings | null> {
  try {
    const snap = await db.doc(`servers/${serverId}/ticketAiSettings/${SETTINGS_DOC_ID}`).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    return {
      ...DEFAULT_SETTINGS,
      enabled: !!data.enabled,
      monitoredChannelIds: normalizeList(data.monitoredChannelIds),
      staffDomains: normalizeList(data.staffDomains).map(normalizeDomain),
      staffMemberIds: normalizeList(data.staffMemberIds),
      allowedRoleIds: normalizeList(data.allowedRoleIds),
      retention: (data.retention as TicketAiSettings['retention']) ?? 'forever',
      schedule: {
        ...DEFAULT_SETTINGS.schedule,
        ...(data.schedule ?? {})
      }
    };
  } catch (err) {
    logger.error('[ticketAi] failed to fetch settings', { serverId, err });
    return null;
  }
}

async function fetchThread(serverId: string, channelId: string, threadId: string): Promise<ThreadMeta | null> {
  try {
    const snap = await db.doc(`servers/${serverId}/channels/${channelId}/threads/${threadId}`).get();
    return snap.exists ? ((snap.data() as ThreadMeta) ?? null) : null;
  } catch (err) {
    logger.warn('[ticketAi] failed to fetch thread', { serverId, channelId, threadId, err });
    return null;
  }
}

async function fetchParentMessage(
  serverId: string,
  channelId: string,
  messageId: string | null | undefined
): Promise<{ createdAt: Timestamp | FirebaseFirestore.Timestamp | null; text?: string | null } | null> {
  if (!messageId) return null;
  try {
    const snap = await db.doc(`servers/${serverId}/channels/${channelId}/messages/${messageId}`).get();
    return snap.exists ? ((snap.data() as any) ?? null) : null;
  } catch (err) {
    logger.warn('[ticketAi] failed to fetch parent message', { serverId, channelId, messageId, err });
    return null;
  }
}

async function resolveUserEmail(uid?: string | null): Promise<string | null> {
  if (!uid) return null;
  try {
    const userRecord = await auth.getUser(uid);
    const email = userRecord.email ?? null;
    return email ? email.toLowerCase() : null;
  } catch (err) {
    logger.debug('[ticketAi] failed to fetch user email', { uid, err });
    return null;
  }
}

const isStaffEmail = (email: string | null, domains: string[]) => {
  if (!email) return false;
  const lower = email.toLowerCase();
  return domains.some((domain) => lower.endsWith(normalizeDomain(domain)));
};

const isStaffMember = (uid: string | null | undefined, staffMemberIds: string[]) => {
  if (!uid) return false;
  return staffMemberIds.includes(uid);
};

const hasCheckmark = (reactions: Record<string, unknown> | null | undefined) => {
  if (!reactions || typeof reactions !== 'object') return false;
  return Object.keys(reactions).some((key) => key.includes('✅') || key.toLowerCase().includes('white_check_mark'));
};

const normalizeText = (text?: string | null) => (typeof text === 'string' ? text.trim() : '');

const shouldCloseFromText = (text: string) => {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    /\b(resolved|fixed|all set|sorted|done|closing|close|closed)\b/.test(lower) ||
    /(^|\s)(thanks|thank you|appreciate it)(!|\s|$)/.test(lower)
  );
};

const inferTypeTag = (texts: string[]): IssueDoc['typeTag'] => {
  const joined = texts.map((t) => normalizeText(t).toLowerCase()).join(' ');
  if (!joined) return 'other';
  if (/(bug|error|crash|broken|fail)/.test(joined)) return 'bug';
  if (/(feature|request|enhancement|improve)/.test(joined)) return 'feature_request';
  if (/(how|help|can i|what|why|\?)/.test(joined)) return 'question';
  return 'other';
};

const buildSummary = (parentText: string, latestText: string, fallbackName?: string | null) => {
  const root = normalizeText(parentText);
  const latest = normalizeText(latestText);
  if (root && latest && root !== latest) return `${root.slice(0, 96)} — ${latest.slice(0, 96)}`;
  if (root) return root.slice(0, 160);
  if (latest) return latest.slice(0, 160);
  return fallbackName ?? 'Issue thread';
};

const timelineWith = (timeline: IssueTimelineEntry[], status: IssueStatus, at: Timestamp) => {
  if (!timeline.length || timeline[timeline.length - 1].status !== status) {
    timeline.push({ status, at });
  }
  return timeline;
};

const msDiff = (from: Date | null, to: Date | null) => {
  if (!from || !to) return null;
  const diff = to.getTime() - from.getTime();
  return diff >= 0 ? diff : null;
};

export async function handleTicketAiThreadMessage(
  event: FirestoreEvent<QueryDocumentSnapshot>
): Promise<void> {
  const { serverId, channelId, threadId, messageId } = event.params as Record<string, string>;
  const snap = event.data;
  if (!snap || !serverId || !channelId || !threadId || !messageId) return;

  const message = snap.data() as MessageMeta;
  if (!message || message.systemKind || message.type === 'system') return;

  const settings = await fetchSettings(serverId);
  if (!settings?.enabled) return;
  if (!settings.monitoredChannelIds.includes(channelId)) return;

  const msgDate = toDate(message.createdAt) ?? new Date(event.time?.valueOf() ?? Date.now());
  const cutoff = retentionCutoff(settings.retention);
  if (cutoff && msgDate.getTime() < cutoff) {
    logger.debug('[ticketAi] skipping message outside retention window', { serverId, channelId, threadId, messageId });
    return;
  }

  const thread = await fetchThread(serverId, channelId, threadId);
  if (!thread) return;

  const parent = await fetchParentMessage(serverId, channelId, thread.createdFromMessageId ?? null);
  const rootCreated = toDate(parent?.createdAt ?? thread.createdAt) ?? msgDate;
  const parentText = normalizeText(parent?.text ?? thread.preview ?? thread.name ?? '');
  const messageText = normalizeText(
    message.text ?? message.content ?? message.plainTextContent ?? ''
  );
  const email = await resolveUserEmail(message.uid ?? message.authorId ?? null);
  const isStaff =
    isStaffMember(message.uid ?? message.authorId ?? null, settings.staffMemberIds) ||
    isStaffEmail(email, settings.staffDomains);
  const closeSignal = shouldCloseFromText(messageText) || hasCheckmark(message.reactions ?? null);

  const issueRef = db.doc(`servers/${serverId}/ticketAiIssues/${threadId}`);
  const issueSnap = await issueRef.get();
  const existing = issueSnap.exists ? ((issueSnap.data() as IssueDoc) ?? null) : null;

  const createdAt = existing?.createdAt ?? Timestamp.fromDate(rootCreated);
  const rootTimestamp = existing?.rootCreatedAt ?? Timestamp.fromDate(rootCreated);
  const lastStatus = (existing?.status ?? 'opened') as IssueStatus;

  const statusTimeline: IssueTimelineEntry[] = Array.isArray(existing?.statusTimeline)
    ? [...existing!.statusTimeline]
    : [];
  if (!statusTimeline.length) {
    statusTimeline.push({ status: 'opened', at: rootTimestamp });
  }

  let status: IssueStatus = lastStatus;
  let reopenedAfterClose = existing?.reopenedAfterClose ?? false;
  let firstStaffResponseAt = existing?.firstStaffResponseAt ?? null;
  let closedAt = existing?.closedAt ?? null;
  let timeToFirstResponseMs = existing?.timeToFirstResponseMs ?? null;
  let timeToResolutionMs = existing?.timeToResolutionMs ?? null;

  if (status === 'closed') {
    reopenedAfterClose = true;
  } else if (status === 'opened' && isStaff) {
    status = 'in_progress';
    firstStaffResponseAt = firstStaffResponseAt ?? Timestamp.fromDate(msgDate);
    timeToFirstResponseMs = timeToFirstResponseMs ?? msDiff(rootCreated, msgDate);
    timelineWith(statusTimeline, 'in_progress', Timestamp.fromDate(msgDate));
  }

  if (closeSignal) {
    status = 'closed';
    closedAt = closedAt ?? Timestamp.fromDate(msgDate);
    timeToResolutionMs = timeToResolutionMs ?? msDiff(rootCreated, msgDate);
    timelineWith(statusTimeline, 'closed', Timestamp.fromDate(msgDate));
  }

  const summaryCandidate = buildSummary(parentText, messageText, thread.name ?? 'Issue thread');
  const typeTag = existing?.typeTag ?? inferTypeTag([parentText, messageText]);

  const payload: IssueDoc = {
    serverId,
    channelId,
    threadId,
    parentMessageId: thread.createdFromMessageId ?? null,
    createdAt,
    rootCreatedAt: rootTimestamp,
    status,
    statusTimeline,
    summary: summaryCandidate,
    typeTag,
    reopenedAfterClose,
    firstStaffResponseAt,
    closedAt,
    timeToFirstResponseMs: timeToFirstResponseMs ?? null,
    timeToResolutionMs: timeToResolutionMs ?? null,
    messageCount: (existing?.messageCount ?? 0) + 1,
    staffMessageCount: (existing?.staffMessageCount ?? 0) + (isStaff ? 1 : 0),
    clientMessageCount: (existing?.clientMessageCount ?? 0) + (isStaff ? 0 : 1),
    lastMessageAt: Timestamp.fromDate(msgDate),
    lastMessageText: messageText || existing?.lastMessageText ?? null,
    staffDomains: settings.staffDomains,
    staffMemberIds: settings.staffMemberIds,
    retention: settings.retention
  };

  try {
    await issueRef.set(
      {
        ...payload,
        updatedAt: Timestamp.now(),
        lastEmailUsed: email ?? null
      },
      { merge: true }
    );
  } catch (err) {
    logger.error('[ticketAi] failed to upsert issue', {
      serverId,
      channelId,
      threadId,
      messageId,
      err
    });
  }
}
