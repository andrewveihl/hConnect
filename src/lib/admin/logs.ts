import { ensureFirebaseReady } from '$lib/firebase';
import { db } from '$lib/firestore/client';
import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  type QueryConstraint,
  Timestamp
} from 'firebase/firestore';
import type {
  AdminLogEntry,
  AdminLogFilter,
  AdminLogLevel,
  AdminLogType,
  ClientErrorLogEntry
} from './types';

type LogWritePayload = {
  type: AdminLogType;
  level: AdminLogLevel;
  message: string;
  data?: Record<string, unknown>;
  serverId?: string | null;
  channelId?: string | null;
  dmId?: string | null;
  userId?: string | null;
};

const logsCollection = () => collection(db(), 'logs');
const clientErrorsCollection = () => collection(db(), 'clientErrors');

export async function logAdminAction(payload: LogWritePayload) {
  await ensureFirebaseReady();
  await addDoc(logsCollection(), {
    ...payload,
    createdAt: serverTimestamp()
  });
}

const timestampToDate = (value: Timestamp | Date | null | undefined) => {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  return value.toDate();
};

const toLogEntry = (docSnap: any): AdminLogEntry => {
  const data = docSnap.data() ?? {};
  return {
    id: docSnap.id,
    type: data.type ?? 'system',
    message: data.message ?? '',
    data: data.data ?? null,
    serverId: data.serverId ?? null,
    channelId: data.channelId ?? null,
    dmId: data.dmId ?? null,
    userId: data.userId ?? null,
    level: data.level ?? 'info',
    createdAt: timestampToDate(data.createdAt ?? null)
  };
};

const toClientErrorEntry = (docSnap: any): ClientErrorLogEntry => {
  const data = docSnap.data() ?? {};
  return {
    id: docSnap.id,
    message: data.message ?? 'Unknown error',
    stack: data.stack ?? null,
    source: data.source ?? null,
    context: data.context ?? null,
    path: data.path ?? null,
    userId: data.userId ?? null,
    userEmail: data.userEmail ?? null,
    userAgent: data.userAgent ?? null,
    severity: data.severity ?? 'error',
    createdAt: timestampToDate(data.createdAt ?? null)
  };
};

export async function fetchLogs(filter: AdminLogFilter = {}): Promise<AdminLogEntry[]> {
  await ensureFirebaseReady();
  const constraints: QueryConstraint[] = [];

  if (filter.type) constraints.push(where('type', '==', filter.type));
  if (filter.level) constraints.push(where('level', '==', filter.level));
  if (filter.serverId) constraints.push(where('serverId', '==', filter.serverId));
  if (filter.channelId) constraints.push(where('channelId', '==', filter.channelId));
  if (filter.dmId) constraints.push(where('dmId', '==', filter.dmId));
  if (filter.userId) constraints.push(where('userId', '==', filter.userId));

  if (filter.startDate) constraints.push(where('createdAt', '>=', Timestamp.fromDate(filter.startDate)));
  if (filter.endDate) constraints.push(where('createdAt', '<=', Timestamp.fromDate(filter.endDate)));

  constraints.push(orderBy('createdAt', 'desc'));
  constraints.push(limit(filter.limit ?? 150));

  const snapshot = await getDocs(query(logsCollection(), ...constraints));
  const entries = snapshot.docs.map(toLogEntry);
  if (filter.search) {
    const search = filter.search.toLowerCase();
    return entries.filter((entry) => {
      const base = `${entry.message} ${JSON.stringify(entry.data ?? {})}`.toLowerCase();
      return base.includes(search);
    });
  }
  return entries;
}

export async function fetchClientErrors(limitCount = 50): Promise<ClientErrorLogEntry[]> {
  await ensureFirebaseReady();
  const snapshot = await getDocs(
    query(clientErrorsCollection(), orderBy('createdAt', 'desc'), limit(limitCount))
  );
  return snapshot.docs.map(toClientErrorEntry);
}

export function summarizeLogs(entries: AdminLogEntry[]) {
  const byType = new Map<string, number>();
  const byLevel = new Map<string, number>();
  for (const entry of entries) {
    byType.set(entry.type, (byType.get(entry.type) ?? 0) + 1);
    byLevel.set(entry.level, (byLevel.get(entry.level) ?? 0) + 1);
  }
  return {
    typeCounts: Array.from(byType.entries()).map(([type, count]) => ({ type, count })),
    levelCounts: Array.from(byLevel.entries()).map(([level, count]) => ({ level, count }))
  };
}

export function logsToText(entries: AdminLogEntry[]): string {
  return entries
    .map((entry) => {
      const date = entry.createdAt.toISOString();
      const scope = [entry.serverId, entry.channelId, entry.dmId, entry.userId]
        .filter(Boolean)
        .join(' | ');
      const context = scope ? ` (${scope})` : '';
      const data = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
      return `[${entry.level.toUpperCase()}] ${date} [${entry.type}] ${entry.message}${context}${data}`;
    })
    .join('\n');
}
