// src/lib/notify/push.ts
import { browser } from '$app/environment';
import { PUBLIC_FCM_VAPID_KEY } from '$env/static/public';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { collection, doc, serverTimestamp, setDoc, deleteDoc } from 'firebase/firestore';

let swReg: ServiceWorkerRegistration | null = null;

export async function registerFirebaseMessagingSW() {
  if (!browser || !('serviceWorker' in navigator)) return null;
  if (swReg) return swReg;
  try {
    swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/',
      type: 'classic' // file is non-ESM using importScripts
    });
    // Try to pass Firebase config to the SW so it can initialize off-host
    const { app } = await ensureFirebaseReady();
    const cfg = (app as any)?.options ?? null;
    const post = () => navigator.serviceWorker.controller?.postMessage({ type: 'FIREBASE_CONFIG', config: cfg });
    // Wait for controller
    if (!navigator.serviceWorker.controller) {
      await navigator.serviceWorker.ready;
      navigator.serviceWorker.addEventListener('controllerchange', () => post());
    } else {
      post();
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

export type TokenRecord = {
  token: string;
  platform?: 'ios' | 'android' | 'mac' | 'windows' | 'linux' | 'web';
  userAgent?: string | null;
  enabled?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

export async function enablePushForUser(uid: string): Promise<string | null> {
  if (!browser) return null;
  const perm = await requestNotificationPermission();
  if (!perm) return null;

  const sw = await registerFirebaseMessagingSW();
  if (!sw) return null;

  const { app } = await ensureFirebaseReady();
  const vapid = PUBLIC_FCM_VAPID_KEY ?? '';
  if (!vapid) {
    console.warn('No PUBLIC_FCM_VAPID_KEY set; push will be limited to foreground notifications.');
  }

  try {
    // Lazy import messaging to avoid SSR issues
    const m = await import('firebase/messaging');
    const messaging = m.getMessaging(app);
    const token = await m.getToken(messaging, {
      vapidKey: vapid || undefined,
      serviceWorkerRegistration: sw
    });
    if (!token) return null;

    const db = getDb();
    const ref = doc(collection(db, 'profiles', uid, 'fcmTokens'), token);
    const rec: TokenRecord = {
      token,
      platform: derivePlatform(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      enabled: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    await setDoc(ref, rec, { merge: true });
    return token;
  } catch (err) {
    console.error('Failed to obtain FCM token', err);
    return null;
  }
}

export async function disablePushForUser(uid: string, token: string) {
  try {
    const db = getDb();
    await deleteDoc(doc(db, 'profiles', uid, 'fcmTokens', token));
  } catch {}
}

function derivePlatform(): TokenRecord['platform'] {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh/i.test(ua)) return 'mac';
  if (/Linux/i.test(ua)) return 'linux';
  return 'web';
}

