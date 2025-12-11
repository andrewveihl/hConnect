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
    if ((err as any)?.code === 'permission-denied') {
      throw err;
    }
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
    if ((err as any)?.code === 'permission-denied') {
      throw err;
    }
    console.warn('[unread] mention query failed', { serverId, channelId }, err);
  }

  const collectBroadcastMentions = async (field: 'mentionsEveryone' | 'mentionsHere') => {
    try {
      const specialQuery = query(base, ...timeConstraint, where(field, '==', true));
      const specialSnap = await getDocs(specialQuery);
      specialSnap.forEach((docSnap) => {
        if (highEvents.has(docSnap.id)) return;
        const event = buildHighEvent(docSnap, 'mention');
        highEvents.set(docSnap.id, event);
      });
    } catch (err) {
      if ((err as any)?.code === 'permission-denied') {
        throw err;
      }
      console.warn(`[unread] ${field} query failed`, { serverId, channelId }, err);
    }
  };

  await Promise.all([collectBroadcastMentions('mentionsEveryone'), collectBroadcastMentions('mentionsHere')]);

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
    if ((err as any)?.code === 'permission-denied') {
      throw err;
    }
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
  const deniedChannels = new Set<string>();
  const channelDocs = new Map<string, any>();
  const counts: UnreadMap = {};
  let stopChannels: Unsubscribe | null = null;
  let stopPublicChannels: Unsubscribe | null = null;
  let memberRoleIds: string[] = [];
  let memberPerms: any = null;
  let isMember = false;
  let profileMembership = false;
  let defaultRoleId: string | null = null;
  let everyoneRoleId: string | null = null;
  let serverOwnerId: string | null = null;
  let serverIsPublic = false;
  let stopMember: Unsubscribe | null = null;
  let stopProfileMembership: Unsubscribe | null = null;
  let stopServerMeta: Unsubscribe | null = null;

  const emit = () => {
    onUpdate({ ...counts });
  };

  const handlePermissionDenied = (channelId: string, err: unknown): boolean => {
    if ((err as any)?.code === 'permission-denied') {
      deniedChannels.add(channelId);
      detachChannel(channelId);
      return true;
    }
    return false;
  };

  const roleSet = () => {
    const roles: string[] = [];
    if (Array.isArray(memberRoleIds)) roles.push(...memberRoleIds);
    if (typeof defaultRoleId === 'string' && defaultRoleId.length) roles.push(defaultRoleId);
    if (typeof everyoneRoleId === 'string' && everyoneRoleId.length) roles.push(everyoneRoleId);
    return Array.from(new Set(roles.filter((id) => typeof id === 'string' && id.length)));
  };

  const isAdminLike = () => {
    const perms = (memberPerms as any) ?? {};
    const legacyManage =
      (perms.manageServer === true || perms.manageRoles === true);
    const modern = perms.permissions ?? {};
    const modernManage =
      modern.MANAGE_SERVER === true ||
      modern.MANAGE_ROLES === true ||
      perms.MANAGE_SERVER === true ||
      perms.MANAGE_ROLES === true;
    const owner = typeof serverOwnerId === 'string' && uid === serverOwnerId;
    return owner || legacyManage || modernManage;
  };

  const hasServerAccess = () => {
    return isAdminLike() || serverIsPublic || isMember || profileMembership;
  };

  const canWatchChannel = (data: any): boolean => {
    if (!uid) return false;
    if (isAdminLike()) return true;
    if (!hasServerAccess()) return false;
    if ((data?.type ?? 'text') === 'voice') return false;
    const isPrivate = data?.isPrivate === true;
    if (!isPrivate) return true; // Public channels follow canViewChannel's public branch.
    // Private: must be a member and have role overlap.
    if (!isMember && !profileMembership) return false;
    const allowed = Array.isArray(data?.allowedRoleIds)
      ? (data.allowedRoleIds as unknown[]).filter((id) => typeof id === 'string')
      : [];
    if (!allowed.length) return false;
    const roles = roleSet();
    if (!roles.length) return false;
    return allowed.some((id) => roles.includes(id as string));
  };

  const scheduleRecompute = (channelId: string) => {
    if (!hasServerAccess()) return;
    // If we have already observed a permission issue for this channel, do not retry until roles change.
    if (deniedChannels.has(channelId)) return;
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
        if (handlePermissionDenied(channelId, err)) return;
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
    if (!hasServerAccess()) return;
    if (channelStates.has(channelId)) return;
    const data = channelDocs.get(channelId);
    if ((data?.type ?? 'text') === 'voice') return;
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
      (err) => {
        if (handlePermissionDenied(channelId, err)) return;
        scheduleRecompute(channelId);
      }
    );

    state.stopRead = onSnapshot(
      doc(db, 'profiles', uid, 'reads', keyFor(serverId, channelId)),
      (snap) => {
        const data: any = snap.data() ?? {};
        state.lastReadAt = data?.lastReadAt ?? null;
        scheduleRecompute(channelId);
      },
      (err) => {
        if (handlePermissionDenied(channelId, err)) return;
        state.lastReadAt = null;
        scheduleRecompute(channelId);
      }
    );

    scheduleRecompute(channelId);
  };

  const handleChannelSnapshot = (snap: any) => {
    if (!hasServerAccess()) {
      for (const channelId of Array.from(channelStates.keys())) {
        detachChannel(channelId);
        deniedChannels.delete(channelId);
        channelDocs.delete(channelId);
      }
      return;
    }
    const present = new Set<string>();
    snap.forEach((docSnap: any) => {
      const channelId = docSnap.id;
      const data = docSnap.data();
      present.add(channelId);
      channelDocs.set(channelId, data);
      if (deniedChannels.has(channelId)) return;
      if (canWatchChannel(data)) {
        attachChannel(channelId);
      } else {
        detachChannel(channelId);
      }
    });
    for (const channelId of Array.from(channelStates.keys())) {
      if (!present.has(channelId)) {
        detachChannel(channelId);
        deniedChannels.delete(channelId);
        channelDocs.delete(channelId);
      }
    }
  };

  const startPublicChannels = () => {
    if (stopPublicChannels) return;
    const qPublic = query(
      collection(db, 'servers', serverId, 'channels'),
      where('isPrivate', '==', false),
      orderBy('position')
    );
    stopPublicChannels = onSnapshot(
      qPublic,
      (snap) => handleChannelSnapshot(snap),
      () => {
        for (const channelId of Array.from(channelStates.keys())) {
          detachChannel(channelId);
        }
        stopPublicChannels?.();
        stopPublicChannels = null;
      }
    );
  };

  const startAllChannels = () => {
    stopChannels?.();
    if (!hasServerAccess()) return;
    const qAll = query(collection(db, 'servers', serverId, 'channels'), orderBy('position'));
    stopChannels = onSnapshot(
      qAll,
      (snap) => handleChannelSnapshot(snap),
      (err) => {
        if ((err as any)?.code === 'permission-denied') {
          // Fallback to public channels if full collection is not readable.
          stopChannels?.();
          stopChannels = null;
          startPublicChannels();
        } else {
          for (const channelId of Array.from(channelStates.keys())) {
            detachChannel(channelId);
          }
        }
      }
    );
  };

  startAllChannels();

  const reevaluateChannels = () => {
    if (!hasServerAccess()) {
      for (const channelId of Array.from(channelStates.keys())) {
        detachChannel(channelId);
        deniedChannels.delete(channelId);
        channelDocs.delete(channelId);
      }
      return;
    }
    for (const [channelId, data] of channelDocs.entries()) {
      if (deniedChannels.has(channelId) && canWatchChannel(data)) {
        deniedChannels.delete(channelId);
      }
      if (deniedChannels.has(channelId)) continue;
      if (canWatchChannel(data)) {
        attachChannel(channelId);
      } else {
        detachChannel(channelId);
      }
    }
  };

  stopMember = onSnapshot(
    doc(db, 'servers', serverId, 'members', uid),
    (snap) => {
      const data: any = snap.data() ?? {};
      isMember = snap.exists();
      memberRoleIds = Array.isArray(data?.roleIds) ? data.roleIds : [];
      memberPerms = data?.perms ?? data?.permissions ?? null;
      reevaluateChannels();
    },
    () => {
      isMember = false;
      memberRoleIds = [];
      memberPerms = null;
      reevaluateChannels();
    }
  );

  stopProfileMembership = onSnapshot(
    doc(db, 'profiles', uid, 'servers', serverId),
    (snap) => {
      profileMembership = snap.exists();
      if (profileMembership && !hasServerAccess()) {
        // membership gained, restart all channels
        startAllChannels();
      }
      reevaluateChannels();
    },
    () => {
      profileMembership = false;
      reevaluateChannels();
    }
  );

  stopServerMeta = onSnapshot(
    doc(db, 'servers', serverId),
    (snap) => {
      const data: any = snap.data() ?? {};
      serverOwnerId =
        typeof data?.ownerId === 'string'
          ? data.ownerId
          : typeof data?.owner === 'string'
            ? data.owner
            : null;
      defaultRoleId = typeof data?.defaultRoleId === 'string' ? data.defaultRoleId : null;
      everyoneRoleId = typeof data?.everyoneRoleId === 'string' ? data.everyoneRoleId : null;
      serverIsPublic = data?.isPublic === true;
      reevaluateChannels();
    },
    () => {
      serverOwnerId = null;
      defaultRoleId = null;
      everyoneRoleId = null;
      serverIsPublic = false;
      reevaluateChannels();
    }
  );

  return () => {
    stopChannels?.();
    stopPublicChannels?.();
    stopMember?.();
    stopProfileMembership?.();
    stopServerMeta?.();
    for (const channelId of Array.from(channelStates.keys())) {
      detachChannel(channelId);
    }
    deniedChannels.clear();
    channelDocs.clear();
  };
}
