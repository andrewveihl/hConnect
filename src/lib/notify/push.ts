// src/lib/notify/push.ts
import { browser } from '$app/environment';
import { PUBLIC_FCM_VAPID_KEY } from '$env/static/public';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';

const DEVICE_COLLECTION = 'devices';
const DEVICE_ID_STORAGE_KEY = 'hconnect_device_id';
const AUTO_PROMPT_STORAGE_KEY = 'hconnect_push_prompted_v1';

type DevicePlatform =
  | 'web_chrome'
  | 'web_firefox'
  | 'web_edge'
  | 'web_safari'
  | 'web'
  | 'ios_browser'
  | 'ios_pwa'
  | 'android_browser'
  | 'android_pwa';

type DevicePermission = NotificationPermission | 'unsupported';

type DeviceDocUpdate = {
  token?: string | null;
  permission?: DevicePermission;
  enabled?: boolean;
};

let swReg: ServiceWorkerRegistration | null = null;
let cachedDeviceId: string | null = null;
let activeDeviceUid: string | null = null;
let swMessageHandler: ((event: MessageEvent) => void) | null = null;

export async function registerFirebaseMessagingSW() {
  if (!browser || !('serviceWorker' in navigator)) return null;
  if (swReg) return swReg;
  try {
    swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/',
      type: 'classic'
    });
    const { app } = await ensureFirebaseReady();
    const cfg = (app as any)?.options ?? null;
    const postConfig = () =>
      navigator.serviceWorker.controller?.postMessage({ type: 'FIREBASE_CONFIG', config: cfg });
    if (!navigator.serviceWorker.controller) {
      await navigator.serviceWorker.ready;
      navigator.serviceWorker.addEventListener('controllerchange', () => postConfig());
    } else {
      postConfig();
    }
    return swReg;
  } catch (err) {
    console.warn('SW registration failed', err);
    return null;
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!browser || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  try {
    const res = await Notification.requestPermission();
    return res === 'granted';
  } catch {
    return false;
  }
}

export function setActivePushUser(uid: string | null) {
  activeDeviceUid = uid;
  if (!browser || !('serviceWorker' in navigator)) return;
  if (!swMessageHandler) {
    swMessageHandler = (event: MessageEvent) => {
      if (event?.data?.type === 'FCM_TOKEN_REFRESHED') {
        const token = event.data?.token ?? null;
        if (token && activeDeviceUid) {
          void persistDeviceDoc(activeDeviceUid, { token, permission: resolvePermission() });
        }
      }
    };
    navigator.serviceWorker.addEventListener('message', swMessageHandler);
  }
  if (uid) {
    void syncDeviceRegistration(uid).catch(() => {});
  }
}

export async function syncDeviceRegistration(uid: string) {
  if (!browser || !('serviceWorker' in navigator)) return;
  const permission = resolvePermission();
  if (permission === 'granted') {
    await enablePushForUser(uid, { prompt: false });
    return;
  }
  if (permission === 'default' && shouldAutoPromptForPush()) {
    markAutoPromptedForPush();
    await enablePushForUser(uid, { prompt: true });
    return;
  }
  await registerFirebaseMessagingSW();
  await persistDeviceDoc(uid, { permission });
}

export async function enablePushForUser(
  uid: string,
  { prompt = true }: { prompt?: boolean } = {}
): Promise<string | null> {
  if (!browser) return null;
  let permission = resolvePermission();
  if (permission === 'denied') {
    await persistDeviceDoc(uid, { permission, token: null });
    return null;
  }
  if (permission === 'default' && prompt) {
    const granted = await requestNotificationPermission();
    permission = resolvePermission();
    if (!granted) {
      await persistDeviceDoc(uid, { permission: permission ?? 'default', token: null });
      return null;
    }
  } else if (permission === 'default') {
    await persistDeviceDoc(uid, { permission, token: null });
    return null;
  }

  const sw = await registerFirebaseMessagingSW();
  if (!sw) {
    await persistDeviceDoc(uid, { permission, token: null });
    return null;
  }

  try {
    const { app } = await ensureFirebaseReady();
    const vapid = PUBLIC_FCM_VAPID_KEY ?? '';
    const messagingSdk = await import('firebase/messaging');
    const messaging = messagingSdk.getMessaging(app);
    const token = await messagingSdk.getToken(messaging, {
      vapidKey: vapid || undefined,
      serviceWorkerRegistration: sw
    });
    if (!token) {
      await persistDeviceDoc(uid, { permission, token: null });
      return null;
    }
    await persistDeviceDoc(uid, { permission: 'granted', token, enabled: true });
    return token;
  } catch (err) {
    console.error('Failed to obtain FCM token', err);
    await persistDeviceDoc(uid, { permission, token: null });
    return null;
  }
}

export async function disablePushForUser(uid: string) {
  if (!browser) return;
  await persistDeviceDoc(uid, { token: null, enabled: false });
}

function resolvePermission(): DevicePermission {
  if (!browser || typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

function ensureDeviceId(): string | null {
  if (!browser) return null;
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) {
      cachedDeviceId = existing;
      return existing;
    }
    const next =
      typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `dev_${Date.now()}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
    cachedDeviceId = next;
    return next;
  } catch (err) {
    console.warn('Failed to read/write device id', err);
    return null;
  }
}

function shouldAutoPromptForPush() {
  if (!browser) return false;
  try {
    return localStorage.getItem(AUTO_PROMPT_STORAGE_KEY) !== '1';
  } catch {
    return false;
  }
}

function markAutoPromptedForPush() {
  if (!browser) return;
  try {
    localStorage.setItem(AUTO_PROMPT_STORAGE_KEY, '1');
  } catch {
    // ignore
  }
}

function detectPlatform(): DevicePlatform {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent || '';
  const standalone = isStandalone();
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return standalone ? 'ios_pwa' : 'ios_browser';
  }
  if (/Android/i.test(ua)) {
    return standalone ? 'android_pwa' : 'android_browser';
  }
  if (/Edg\//i.test(ua)) return 'web_edge';
  if (/Firefox\//i.test(ua)) return 'web_firefox';
  if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'web_safari';
  if (/Chrome|Chromium/i.test(ua)) return 'web_chrome';
  return 'web';
}

function isStandalone() {
  if (!browser) return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  if (typeof nav?.standalone === 'boolean') return nav.standalone;
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
}

async function persistDeviceDoc(uid: string, update: DeviceDocUpdate) {
  const deviceId = ensureDeviceId();
  if (!deviceId) return;
  await ensureFirebaseReady();
  const db = getDb();
  const now = serverTimestamp();
  const ref = doc(collection(db, 'profiles', uid, DEVICE_COLLECTION), deviceId);
  const payload: Record<string, unknown> = {
    deviceId,
    platform: detectPlatform(),
    isStandalone: isStandalone(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    permission: update.permission ?? resolvePermission(),
    lastSeen: now,
    updatedAt: now
  };
  if (update.token !== undefined) {
    payload.token = update.token || null;
    payload.tokenUpdatedAt = now;
  }
  if (update.enabled !== undefined) {
    payload.enabled = update.enabled;
  }
  await setDoc(ref, payload, { merge: true });
}

