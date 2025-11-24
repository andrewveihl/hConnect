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
  const qy = filters.length
    ? query(col, ...filters, orderBy('createdAt', 'desc'))
    : query(col, orderBy('createdAt', 'desc'));

  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as TicketAiIssue));
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
