/* firebase-messaging-sw.js
 * Background handler for Firebase Cloud Messaging + basic config bootstrap.
 * Uses compat builds via importScripts to avoid bundling.
 */

// Load compat libraries (match major version in package.json; use latest minor)
importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging-compat.js');

self.addEventListener('install', (e) => {
  // Activate immediately
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  self.clients.claim();
});

let initialized = false;
let messagingInstance = null;

async function ensureFirebaseInit() {
  if (initialized) return;
  // Try config injected by page
  const cfg = self.__FIREBASE_CONFIG || null;
  if (cfg && cfg.apiKey) {
    firebase.initializeApp(cfg);
    initialized = true;
    return;
  }
  // Try to fetch Hosting-provided config (works on Firebase Hosting)
  try {
    const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json && json.apiKey) {
        firebase.initializeApp(json);
        initialized = true;
      }
    }
  } catch {}
}

// Accept config from the page after registration
self.addEventListener('message', (event) => {
  const data = event?.data || {};
  if (data?.type === 'FIREBASE_CONFIG' && data?.config && !initialized) {
    try {
      self.__FIREBASE_CONFIG = data.config;
      firebase.initializeApp(data.config);
      initialized = true;
    } catch (err) {
      // ignore
    }
  }
});

async function getMessaging() {
  await ensureFirebaseInit();
  if (!initialized) return null;
  if (messagingInstance) return messagingInstance;
  try {
    messagingInstance = firebase.messaging();
  } catch (err) {
    console.warn('firebase messaging init failed', err);
    return null;
  }
  return messagingInstance;
}

async function setupBackgroundHandler() {
  const messaging = await getMessaging();
  if (!messaging) return;
  messaging.onBackgroundMessage((payload) => {
    const title = payload?.notification?.title || payload?.data?.title || 'New message';
    const body = payload?.notification?.body || payload?.data?.body || '';
    const tag = payload?.data?.tag || undefined;
    const icon = payload?.notification?.icon || '/Logo_transparent.png';

    self.registration.showNotification(title, {
      body,
      icon,
      tag,
      data: payload?.data || {}
    });
  });
}

setupBackgroundHandler();
