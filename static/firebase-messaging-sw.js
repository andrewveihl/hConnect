/* firebase-messaging-sw.js
 * Handles Firebase Cloud Messaging push events, notification presentation,
 * and deep links into the hConnect client for both browser and installed PWAs.
 */

importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging-compat.js');

const DEFAULT_ICON = '/Logo_transparent.png';
const CLIENT_MESSAGE = 'HCONNECT_PUSH_DEEP_LINK';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

let initialized = false;
let messagingInstance = null;

async function ensureFirebaseInit() {
  if (initialized) return;
  const cfg = self.__FIREBASE_CONFIG || null;
  if (cfg?.apiKey) {
    firebase.initializeApp(cfg);
    initialized = true;
    return;
  }
  try {
    const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json && json.apiKey) {
        firebase.initializeApp(json);
        initialized = true;
      }
    }
  } catch {
    // Hosting bootstrap may be unavailable (local dev) �?" rely on page message below.
  }
}

self.addEventListener('message', (event) => {
  const data = event?.data || {};
  if (data?.type === 'FIREBASE_CONFIG' && data?.config && !initialized) {
    try {
      self.__FIREBASE_CONFIG = data.config;
      firebase.initializeApp(data.config);
      initialized = true;
    } catch (err) {
      console.warn('firebase config relay failed', err);
    }
  }
});

async function getMessaging() {
  await ensureFirebaseInit();
  if (!initialized) return null;
  if (messagingInstance) return messagingInstance;
  try {
    messagingInstance = firebase.messaging();
    return messagingInstance;
  } catch (err) {
    console.warn('firebase messaging init failed', err);
    return null;
  }
}

function readPayloadFromPush(event) {
  if (!event?.data) return null;
  try {
    return event.data.json();
  } catch {
    try {
      return JSON.parse(event.data.text());
    } catch {
      return null;
    }
  }
}

function deriveDeepLink(data = {}) {
  const origin = data.origin || 'push';
  if (data.dmId) {
    const params = new URLSearchParams({ origin, dm: data.dmId });
    if (data.messageId) params.set('messageId', data.messageId);
    return `/dms/${encodeURIComponent(data.dmId)}?${params}`;
  }
  if (data.serverId && data.channelId) {
    const params = new URLSearchParams({ origin, channel: data.channelId });
    if (data.threadId) params.set('thread', data.threadId);
    if (data.messageId) params.set('messageId', data.messageId);
    return `/servers/${encodeURIComponent(data.serverId)}?${params}`;
  }
  return `/?origin=${encodeURIComponent(origin)}`;
}

function coercePayloadData(payload) {
  const data = payload?.data ? { ...payload.data } : {};
  const notification = payload?.notification || {};
  if (!data.title && notification.title) data.title = notification.title;
  if (!data.body && notification.body) data.body = notification.body;
  if (!data.icon && notification.icon) data.icon = notification.icon;
  data.targetUrl = data.targetUrl || deriveDeepLink(data);
  data.origin = data.origin || 'push';
  return data;
}

async function showNotification(payload) {
  if (!payload) return;
  const data = coercePayloadData(payload);
  const title = data.title || 'New message';
  const body = data.body || '';
  const mentionType = data.mentionType || 'direct';
  const icon = data.icon || DEFAULT_ICON;
  const badgeCount = Number(data.badge ?? 0);
  const tagParts = [data.serverId, data.channelId, data.threadId, data.dmId, mentionType].filter(Boolean);
  const tag = tagParts.length ? tagParts.join(':') : `hconnect:${mentionType}`;
  const options = {
    body,
    icon,
    badge: data.badgeIcon || undefined,
    image: data.image || undefined,
    tag,
    renotify: mentionType === 'direct' || mentionType === 'dm',
    requireInteraction: mentionType !== 'ambient',
    data,
    actions: Array.isArray(data.actions) ? data.actions : undefined
  };
  await self.registration.showNotification(title, options);
  if (typeof self.registration.setAppBadge === 'function' && badgeCount >= 0) {
    Promise.resolve()
      .then(() => self.registration.setAppBadge(badgeCount || 1))
      .catch(() => {});
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function focusOrOpenClient(data) {
  const targetUrl = data.targetUrl || deriveDeepLink(data);
  const payload = { ...data, targetUrl, origin: data.origin || 'push', clickedAt: Date.now() };
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    if (client.url) {
      try {
        await client.focus();
      } catch {
        // fallback to navigate if focus fails
        if (typeof client.navigate === 'function') {
          try {
            await client.navigate(targetUrl);
          } catch {}
        }
      }
      client.postMessage({ type: CLIENT_MESSAGE, payload });
      return;
    }
  }
  const created = await self.clients.openWindow(targetUrl);
  if (created) {
    await delay(800);
    try {
      created.postMessage({ type: CLIENT_MESSAGE, payload });
    } catch {
      // Window might not be ready yet; wait again
      await delay(800);
      try {
        created.postMessage({ type: CLIENT_MESSAGE, payload });
      } catch {}
    }
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const payload = readPayloadFromPush(event);
      if (payload) {
        await showNotification(payload);
      }
    })()
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const messaging = await getMessaging();
      if (!messaging) return;
      try {
        const token = await messaging.getToken();
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        clients.forEach((client) =>
          client.postMessage({ type: 'FCM_TOKEN_REFRESHED', token: token || null })
        );
      } catch (err) {
        console.warn('push subscription refresh failed', err);
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification?.data || {};
  event.waitUntil(
    (async () => {
      await focusOrOpenClient(data);
      if (typeof self.registration.clearAppBadge === 'function') {
        try {
          await self.registration.clearAppBadge();
        } catch {}
      }
    })()
  );
});
