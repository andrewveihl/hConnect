import { getDb } from '$lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
  type Timestamp,
  type Unsubscribe
} from 'firebase/firestore';

export type IssueStatus = 'opened' | 'in_progress' | 'closed';
export type TicketAiType = 'bug' | 'feature_request' | 'question' | 'other';

export type TicketAiSettings = {
  enabled: boolean;
  allowedRoleIds: string[];
  monitoredChannelIds: string[];
  staffDomains: string[];
  staffMemberIds: string[];
  retention: 'forever' | '1y' | '90d';
  schedule: {
    enabled: boolean;
    frequency: 'weekly' | 'monthly';
    dayOfWeek: number;
    timeUtc: string;
    targetChannelId: string | null;
  };
  updatedAt?: Timestamp;
  updatedBy?: string | null;
};

export type TicketAiIssue = {
  id: string;
  serverId: string;
  channelId: string;
  threadId: string;
  parentMessageId?: string | null;
  createdAt?: Timestamp;
  rootCreatedAt?: Timestamp;
  lastMessageAt?: Timestamp | null;
  closedAt?: Timestamp | null;
  firstStaffResponseAt?: Timestamp | null;
  status: IssueStatus;
  statusTimeline?: Array<{ status: IssueStatus; at: Timestamp }>;
  summary?: string | null;
  typeTag?: TicketAiType;
  reopenedAfterClose?: boolean;
  timeToFirstResponseMs?: number | null;
  timeToResolutionMs?: number | null;
  staffMemberIds?: string[];
  messageCount?: number;
  staffMessageCount?: number;
  clientMessageCount?: number;
};

// Cached analytics types
export type CachedStaffStat = {
  uid: string;
  ticketsAnswered: number;
  ticketsResolved: number;
  avgResponseMs: number | null;
  avgResolutionMs: number | null;
  totalMessages: number;
};

export type CachedTicketRow = {
  id: string;
  summary: string;
  status: IssueStatus;
  channelId: string;
  resolvedByUids: string[];
  resolvedAtMs: number | null;
  resolutionTimeMs: number | null;
  createdAtMs: number;
};

export type CachedAnalytics = {
  updatedAt: Timestamp;
  timeRangeKey: string; // e.g., "7d", "30d", "quarter"
  rangeStartMs: number | null;
  rangeEndMs: number;
  totalIssues: number;
  openIssues: number;
  inProgressIssues: number;
  closedIssues: number;
  avgResponseTimeMs: number | null;
  avgResolutionTimeMs: number | null;
  slaCompliancePercent: number | null;
  resolutionRatePercent: number | null;
  staffStats: CachedStaffStat[];
  ticketRows: CachedTicketRow[];
  issuesByType: Record<string, number>;
  issuesByChannel: Record<string, number>;
};

const SETTINGS_DOC_ID = 'current';

const defaultSettings: TicketAiSettings = {
  enabled: false,
  allowedRoleIds: [],
  monitoredChannelIds: [],
  staffDomains: [],
  staffMemberIds: [],
  retention: 'forever',
  schedule: {
    enabled: false,
    frequency: 'weekly',
    dayOfWeek: 1,
    timeUtc: '09:00',
    targetChannelId: null
  }
};

const normalizeList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const set = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    set.add(trimmed);
  }
  return Array.from(set);
};

export const normalizeSettings = (data?: DocumentData | null): TicketAiSettings => {
  const scheduleRaw = data?.schedule ?? {};
  const retention = data?.retention as TicketAiSettings['retention'];
  return {
    ...defaultSettings,
    ...(data ?? {}),
    retention: retention === '1y' || retention === '90d' || retention === 'forever' ? retention : defaultSettings.retention,
    allowedRoleIds: normalizeList(data?.allowedRoleIds),
    monitoredChannelIds: normalizeList(data?.monitoredChannelIds),
    staffDomains: normalizeList(data?.staffDomains).map((d) =>
      d.startsWith('@') ? d.toLowerCase() : `@${d.toLowerCase()}`
    ),
    staffMemberIds: normalizeList(data?.staffMemberIds),
    schedule: {
      ...defaultSettings.schedule,
      ...scheduleRaw,
      dayOfWeek:
        typeof scheduleRaw.dayOfWeek === 'number'
          ? scheduleRaw.dayOfWeek
          : Number(scheduleRaw.dayOfWeek ?? defaultSettings.schedule.dayOfWeek),
      timeUtc:
        typeof scheduleRaw.timeUtc === 'string'
          ? scheduleRaw.timeUtc
          : defaultSettings.schedule.timeUtc
    }
  };
};

export async function fetchTicketAiSettings(serverId: string): Promise<TicketAiSettings> {
  const db = getDb();
  const ref = doc(db, 'servers', serverId, 'ticketAiSettings', SETTINGS_DOC_ID);
  const snap = await getDoc(ref);
  return normalizeSettings(snap.exists() ? snap.data() : null);
}

export function subscribeTicketAiSettings(
  serverId: string,
  cb: (settings: TicketAiSettings) => void
): Unsubscribe {
  const db = getDb();
  const ref = doc(db, 'servers', serverId, 'ticketAiSettings', SETTINGS_DOC_ID);
  return onSnapshot(
    ref,
    (snap) => cb(normalizeSettings(snap.data() ?? null)),
    () => cb(defaultSettings)
  );
}

export async function saveTicketAiSettings(
  serverId: string,
  settings: Partial<TicketAiSettings>,
  updatedBy?: string | null
) {
  const db = getDb();
  const ref = doc(db, 'servers', serverId, 'ticketAiSettings', SETTINGS_DOC_ID);
  const payload: Partial<TicketAiSettings> = {
    ...settings,
    updatedAt: serverTimestamp() as unknown as Timestamp,
    updatedBy: updatedBy ?? null
  };
  await setDoc(ref, payload, { merge: true });
}

type IssueQueryOptions = {
  start?: Date | null;
  end?: Date | null;
};

const toMillis = (value: any): number | null => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const date = value instanceof Date ? value : typeof value === 'number' ? new Date(value) : null;
  return date ? date.getTime() : null;
};

export async function fetchTicketAiIssues(
  serverId: string,
  options: IssueQueryOptions = {}
): Promise<TicketAiIssue[]> {
  const db = getDb();
  const col = collection(db, 'servers', serverId, 'ticketAiIssues');
  const filters = [];
  if (options.start) {
    filters.push(where('createdAt', '>=', options.start));
  }
  if (options.end) {
    filters.push(where('createdAt', '<=', options.end));
  }
  
  // Build query - if we have date filters, we need to ensure index exists
  // For now, just order by createdAt desc (single field index)
  let qy;
  if (filters.length) {
    qy = query(col, ...filters, orderBy('createdAt', 'desc'));
  } else {
    qy = query(col, orderBy('createdAt', 'desc'));
  }

  try {
    const snap = await getDocs(qy);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as TicketAiIssue));
  } catch (err: any) {
    // If composite index is needed, fall back to simple query
    if (err?.code === 'failed-precondition' || err?.message?.includes('index')) {
      console.warn('[ticketAi] Composite index missing, falling back to simple query', err);
      const simpleQy = query(col, orderBy('createdAt', 'desc'));
      const snap = await getDocs(simpleQy);
      const allDocs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as TicketAiIssue));
      // Filter in memory
      return allDocs.filter((issue) => {
        const createdAt = issue.createdAt?.toDate?.() ?? new Date(0);
        if (options.start && createdAt < options.start) return false;
        if (options.end && createdAt > options.end) return false;
        return true;
      });
    }
    throw err;
  }
}

export function issuesToCsv(rows: TicketAiIssue[]): string {
  const headers = [
    'id',
    'serverId',
    'channelId',
    'threadId',
    'createdAt',
    'closedAt',
    'status',
    'typeTag',
    'timeToFirstResponseMs',
    'timeToResolutionMs',
    'messageCount',
    'clientMessageCount',
    'staffMessageCount'
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    const closedAt = toMillis(row.closedAt) ?? '';
    lines.push(
      [
        row.id,
        row.serverId,
        row.channelId,
        row.threadId,
        toMillis(row.createdAt) ?? '',
        closedAt,
        row.status,
        row.typeTag ?? '',
        row.timeToFirstResponseMs ?? '',
        row.timeToResolutionMs ?? '',
        row.messageCount ?? '',
        row.clientMessageCount ?? '',
        row.staffMessageCount ?? ''
      ]
        .map((entry) => `"${String(entry ?? '').replace(/"/g, '""')}"`)
        .join(',')
    );
  }
  return lines.join('\n');
}

// Cached analytics functions
const ANALYTICS_COLLECTION = 'ticketAiAnalytics';

export async function fetchCachedAnalytics(
  serverId: string,
  timeRangeKey: string
): Promise<CachedAnalytics | null> {
  const db = getDb();
  const docRef = doc(db, 'servers', serverId, ANALYTICS_COLLECTION, timeRangeKey);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return snap.data() as CachedAnalytics;
}

export async function saveCachedAnalytics(
  serverId: string,
  timeRangeKey: string,
  analytics: Omit<CachedAnalytics, 'updatedAt'>
): Promise<void> {
  const db = getDb();
  const docRef = doc(db, 'servers', serverId, ANALYTICS_COLLECTION, timeRangeKey);
  await setDoc(docRef, {
    ...analytics,
    updatedAt: serverTimestamp()
  });
}

// Helper to compute analytics from issues
export function computeAnalytics(
  issues: TicketAiIssue[],
  timeRangeKey: string,
  rangeStart: Date | null,
  rangeEnd: Date,
  slaTargetMinutes: number = 60
): Omit<CachedAnalytics, 'updatedAt'> {
  const openIssues = issues.filter(i => i.status === 'opened').length;
  const inProgressIssues = issues.filter(i => i.status === 'in_progress').length;
  const closedIssues = issues.filter(i => i.status === 'closed').length;
  
  // Average response time
  const responseTimes = issues
    .map(i => i.timeToFirstResponseMs)
    .filter((t): t is number => typeof t === 'number');
  const avgResponseTimeMs = responseTimes.length > 0
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : null;
  
  // Average resolution time
  const resolutionTimes = issues
    .map(i => i.timeToResolutionMs)
    .filter((t): t is number => typeof t === 'number');
  const avgResolutionTimeMs = resolutionTimes.length > 0
    ? resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length
    : null;
  
  // SLA compliance
  const slaTargetMs = slaTargetMinutes * 60 * 1000;
  const issuesWithResponse = issues.filter(i => typeof i.timeToFirstResponseMs === 'number');
  const issuesWithinSla = issuesWithResponse.filter(i => (i.timeToFirstResponseMs ?? Infinity) <= slaTargetMs);
  const slaCompliancePercent = issuesWithResponse.length > 0
    ? (issuesWithinSla.length / issuesWithResponse.length) * 100
    : null;
  
  // Resolution rate
  const resolutionRatePercent = issues.length > 0
    ? (closedIssues / issues.length) * 100
    : null;
  
  // Staff stats
  const staffMap = new Map<string, {
    ticketsAnswered: number;
    ticketsResolved: number;
    responseTimes: number[];
    resolutionTimes: number[];
    totalMessages: number;
  }>();
  
  for (const issue of issues) {
    if (!issue.staffMemberIds?.length) continue;
    for (const uid of issue.staffMemberIds) {
      const existing = staffMap.get(uid) ?? {
        ticketsAnswered: 0,
        ticketsResolved: 0,
        responseTimes: [],
        resolutionTimes: [],
        totalMessages: 0
      };
      existing.ticketsAnswered += 1;
      if (issue.status === 'closed') {
        existing.ticketsResolved += 1;
      }
      if (typeof issue.timeToFirstResponseMs === 'number') {
        existing.responseTimes.push(issue.timeToFirstResponseMs);
      }
      if (typeof issue.timeToResolutionMs === 'number') {
        existing.resolutionTimes.push(issue.timeToResolutionMs);
      }
      existing.totalMessages += issue.staffMessageCount ?? 0;
      staffMap.set(uid, existing);
    }
  }
  
  const staffStats: CachedStaffStat[] = Array.from(staffMap.entries())
    .map(([uid, data]) => ({
      uid,
      ticketsAnswered: data.ticketsAnswered,
      ticketsResolved: data.ticketsResolved,
      avgResponseMs: data.responseTimes.length > 0
        ? data.responseTimes.reduce((a, b) => a + b, 0) / data.responseTimes.length
        : null,
      avgResolutionMs: data.resolutionTimes.length > 0
        ? data.resolutionTimes.reduce((a, b) => a + b, 0) / data.resolutionTimes.length
        : null,
      totalMessages: data.totalMessages
    }))
    .sort((a, b) => b.ticketsResolved - a.ticketsResolved);
  
  // Ticket rows
  const ticketRows: CachedTicketRow[] = issues.map(issue => ({
    id: issue.id,
    summary: issue.summary ?? 'No description',
    status: issue.status,
    channelId: issue.channelId,
    resolvedByUids: issue.status === 'closed' ? (issue.staffMemberIds ?? []) : [],
    resolvedAtMs: issue.closedAt?.toMillis?.() ?? null,
    resolutionTimeMs: issue.timeToResolutionMs ?? null,
    createdAtMs: issue.createdAt?.toMillis?.() ?? Date.now()
  }));
  
  // Issues by type
  const issuesByType: Record<string, number> = {};
  for (const issue of issues) {
    const type = issue.typeTag ?? 'other';
    issuesByType[type] = (issuesByType[type] ?? 0) + 1;
  }
  
  // Issues by channel
  const issuesByChannel: Record<string, number> = {};
  for (const issue of issues) {
    const channelId = issue.channelId;
    issuesByChannel[channelId] = (issuesByChannel[channelId] ?? 0) + 1;
  }
  
  return {
    timeRangeKey,
    rangeStartMs: rangeStart?.getTime() ?? null,
    rangeEndMs: rangeEnd.getTime(),
    totalIssues: issues.length,
    openIssues,
    inProgressIssues,
    closedIssues,
    avgResponseTimeMs,
    avgResolutionTimeMs,
    slaCompliancePercent,
    resolutionRatePercent,
    staffStats,
    ticketRows,
    issuesByType,
    issuesByChannel
  };
}
