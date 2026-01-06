import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { db } from './firebase';
import type { DeviceDoc, NotificationSettings, PresenceDoc, WebPushSubscription } from './types';

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
  allowChannelMessagePush: true,
  pushChannelMentionsOnly: false,
  emailEnabled: false,
  emailForDMs: true,
  emailForMentions: true,
  emailForChannelMessages: false,
  emailForAllChannelMessages: false,
  emailChannelMentionsOnly: false,
  emailOnlyWhenNoPush: true,
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
  token?: string | null;
  platform?: string | null;
  subscription?: WebPushSubscription | null;
};

export async function fetchDeviceTokens(uid: string, deviceId?: string): Promise<DeviceTokenRecord[]> {
  try {
    if (deviceId) {
      const docSnap = await db.doc(`profiles/${uid}/devices/${deviceId}`).get();
      if (!docSnap.exists) {
        console.info('[fetchDeviceTokens] Device doc not found', { uid, deviceId });
        return [];
      }
      const doc = docSnap.data() as DeviceDoc | undefined;
      const hasToken = hasValidToken(doc);
      const hasSubscription = hasSafariSubscription(doc);
      const permission = doc?.permission;
      const enabled = doc?.enabled;
      
      if (
        (hasToken || hasSubscription) &&
        (permission === 'granted' || permission === undefined) &&
        enabled !== false
      ) {
        console.info('[fetchDeviceTokens] Device included', { uid, deviceId, platform: doc?.platform, hasToken, hasSubscription });
        return [
          {
            token: doc.token ?? null,
            platform: doc.platform ?? null,
            subscription: doc.subscription ?? null
          }
        ];
      }
      console.info('[fetchDeviceTokens] Device filtered out', {
        uid,
        deviceId,
        platform: doc?.platform,
        hasToken,
        hasSubscription,
        permission,
        enabled,
        reasons: {
          noTokenOrSubscription: !hasToken && !hasSubscription,
          permissionDenied: permission === 'denied',
          permissionDefault: permission === 'default',
          disabled: enabled === false
        }
      });
      return [];
    }
    const snap = await db.collection(`profiles/${uid}/devices`).get();
    const allDocs = snap.docs.map((docSnap: QueryDocumentSnapshot) => ({
      id: docSnap.id,
      ...(docSnap.data() as DeviceDoc)
    }));
    
    // Log all devices found for debugging
    console.info('[fetchDeviceTokens] All devices for user', {
      uid,
      totalDevices: allDocs.length,
      devices: allDocs.map((d) => ({
        id: d.id,
        platform: d.platform,
        hasToken: hasValidToken(d),
        hasSubscription: hasSafariSubscription(d),
        permission: d.permission,
        enabled: d.enabled
      }))
    });

    const filtered = allDocs
      .filter(
        (doc) =>
          (hasValidToken(doc) || hasSafariSubscription(doc)) &&
          (doc.permission === 'granted' || doc.permission === undefined) &&
          doc.enabled !== false
      )
      .map((doc) => ({
        token: doc.token ?? null,
        platform: doc.platform ?? null,
        subscription: doc.subscription ?? null
      }));

    console.info('[fetchDeviceTokens] Filtered devices', {
      uid,
      filteredCount: filtered.length,
      platforms: filtered.map((d) => d.platform ?? 'unknown')
    });

    return filtered;
  } catch (err) {
    console.warn('Failed to fetch device tokens', uid, err);
    return [];
  }
}

function hasValidToken(doc?: DeviceDoc | null) {
  return typeof doc?.token === 'string' && doc.token.length > 0;
}

function hasSafariSubscription(doc?: DeviceDoc | null) {
  return Boolean(doc?.subscription?.endpoint);
}
