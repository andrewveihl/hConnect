import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { db } from './firebase';
import type { DeviceDoc, NotificationSettings, PresenceDoc } from './types';

const SETTINGS_SUBCOLLECTION = 'notificationSettings';
const SETTINGS_DOC_ID = 'preferences';

export const defaultNotificationSettings: NotificationSettings = {
  globalMute: false,
  muteDMs: false,
  muteServerIds: [],
  perChannelMute: {},
  perRoleMute: {},
  allowMentionPush: true,
  allowDMPreview: true,
  allowActivityBadges: true,
  allowThreadPush: true,
  allowRoleMentionPush: true,
  allowHereMentionPush: true,
  allowEveryoneMentionPush: true,
  doNotDisturbUntil: null
};

export async function fetchNotificationSettings(uid: string): Promise<NotificationSettings> {
  const ref = db.doc(`profiles/${uid}/${SETTINGS_SUBCOLLECTION}/${SETTINGS_DOC_ID}`);
  const snap = await ref.get();
  const data = snap.exists ? (snap.data() as Partial<NotificationSettings>) : {};
  return {
    ...defaultNotificationSettings,
    ...(data ?? {})
  };
}

export function perChannelKey(serverId: string, channelId: string) {
  return `${serverId}/${channelId}`;
}

export function perRoleKey(serverId: string, roleId: string) {
  return `${serverId}/${roleId}`;
}

export async function fetchPresence(uid: string): Promise<PresenceDoc | null> {
  try {
    const snap = await db.doc(`profiles/${uid}/presence/status`).get();
    return snap.exists ? ((snap.data() as PresenceDoc) ?? null) : null;
  } catch {
    return null;
  }
}

export type DeviceTokenRecord = {
  token: string;
  platform?: string | null;
};

export async function fetchDeviceTokens(uid: string, deviceId?: string): Promise<DeviceTokenRecord[]> {
  try {
    if (deviceId) {
      const docSnap = await db.doc(`profiles/${uid}/devices/${deviceId}`).get();
      if (!docSnap.exists) return [];
      const doc = docSnap.data() as DeviceDoc | undefined;
      if (
        doc &&
        typeof doc.token === 'string' &&
        doc.token.length > 0 &&
        (doc.permission === 'granted' || doc.permission === undefined) &&
        doc.enabled !== false
      ) {
        return [
          {
            token: doc.token!,
            platform: doc.platform ?? null
          }
        ];
      }
      return [];
    }
    const snap = await db.collection(`profiles/${uid}/devices`).get();
    return snap.docs
      .map((docSnap: QueryDocumentSnapshot) => docSnap.data() as DeviceDoc)
      .filter(
        (doc) =>
          typeof doc?.token === 'string' &&
          doc.token.length > 0 &&
          (doc.permission === 'granted' || doc.permission === undefined) &&
          doc.enabled !== false
      )
      .map((doc) => ({
        token: doc.token!,
        platform: doc.platform ?? null
      }));
  } catch (err) {
    console.warn('Failed to fetch device tokens', uid, err);
    return [];
  }
}
