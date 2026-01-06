/* firebase-messaging-sw.js
 * Handles Firebase Cloud Messaging push events, notification presentation,
 * and deep links into the hConnect client for both browser and installed PWAs.
 */

importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging-compat.js');

const SW_VERSION = '2025-IOS-PUSH-FIX-01';
const DEFAULT_ICON = '/Logo_transparent.png';
const CLIENT_MESSAGE = 'HCONNECT_PUSH_DEEP_LINK';
const PUSH_CHANNEL_NAME = 'hconnect-push-events';
let activeDeviceId = null;
const pushBroadcastChannel =
  typeof BroadcastChannel === 'function' ? new BroadcastChannel(PUSH_CHANNEL_NAME) : null;
const clientMessagePorts = new Set();

const describePayload = (payload) => {
  if (payload === undefined) return 'undefined';
  if (payload === null) return 'null';
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
};

const swInfo = (message, payload) => {
  if (payload === undefined) {
    console.info(`[firebase-messaging-sw] ${message}`);
  } else {
    console.info(`[firebase-messaging-sw] ${message}: ${describePayload(payload)}`);
  }
};

const swWarn = (message, payload) => {
  if (payload === undefined) {
    console.warn(`[firebase-messaging-sw] ${message}`);
  } else {
    console.warn(`[firebase-messaging-sw] ${message}: ${describePayload(payload)}`);
  }
};

self.addEventListener('install', (event) => {
  swInfo('Service worker installing', { version: SW_VERSION });
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  swInfo('Service worker activating', { version: SW_VERSION });
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Clear old caches if any
      caches.keys().then((names) => {
        return Promise.all(
          names.filter((name) => name.startsWith('hconnect-')).map((name) => caches.delete(name))
        );
      })
    ]).then(() => {
      swInfo('Service worker activated and claimed clients', { version: SW_VERSION });
    })
  );
});

// Fetch handler - important for iOS PWA to keep service worker alive
self.addEventListener('fetch', (event) => {
  // Only handle navigation requests and push-related URLs
  const url = new URL(event.request.url);
  
  // Don't intercept cross-origin requests or Firebase SDK
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('firebasejs')) return;
  if (url.pathname.includes('__')) return; // Firebase hosting internal paths
  
  // For navigation requests, let the browser handle it but ensure SW stays active
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Fallback for offline - return cached app shell if available
        return caches.match('/') || new Response('Offline', { status: 503 });
      })
    );
    return;
  }
  
  // Let other requests pass through normally
});

let initialized = false;
let messagingInstance = null;
swInfo('Service worker bootstrapped', { version: SW_VERSION });

// Set up Firebase Messaging background message handler early
// This ensures FCM can deliver messages even before full init
async function setupBackgroundMessageHandler() {
  try {
    await ensureFirebaseInit();
    if (!initialized) return;
    if (messagingInstance) return;
    
    messagingInstance = firebase.messaging();
    
    // Handle background messages from FCM
    messagingInstance.onBackgroundMessage((payload) => {
      const hasNotification = Boolean(payload?.notification);
      const hasData = Boolean(payload?.data);
      const title = payload?.notification?.title ?? payload?.data?.title ?? null;
      const messageId = payload?.data?.messageId ?? null;
      const platform = payload?.data?.platform ?? 'unknown';
      
      swInfo('onBackgroundMessage received', {
        hasNotification,
        hasData,
        title,
        messageId,
        platform,
        dataKeys: Object.keys(payload?.data ?? {})
      });
      
      // If FCM already showed a notification (notification key present), we may skip
      // But on iOS, we want to ensure it shows, so always call showNotification
      return showNotification(payload);
    });
    
    swInfo('onBackgroundMessage handler registered');
  } catch (err) {
    swWarn('setupBackgroundMessageHandler failed', { error: err?.message ?? String(err) });
  }
}

// Call setup immediately and also on push events
Promise.resolve().then(() => setupBackgroundMessageHandler()).catch(() => {});

async function ensureFirebaseInit() {
  if (initialized) return;
  const cfg = self.__FIREBASE_CONFIG || null;
  if (cfg?.apiKey) {
    firebase.initializeApp(cfg);
    swInfo('Firebase initialized from page config');
    initialized = true;
    return;
  }
  try {
    const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json && json.apiKey) {
        firebase.initializeApp(json);
        swInfo('Firebase initialized from fetched config');
        initialized = true;
      } else {
        swWarn('Fetched firebase config missing apiKey');
      }
    } else {
      swWarn('Failed to fetch firebase init config', { status: res.status });
    }
  } catch (err) {
    swWarn('ensureFirebaseInit fetch failed', { error: err?.message ?? String(err) });
  }
}

self.addEventListener('message', (event) => {
  const data = event?.data || {};
  swInfo('message event received', {
    type: data?.type ?? 'unknown',
    hasPort: Boolean(event?.ports?.length)
  });
  if (data?.type === 'FIREBASE_CONFIG' && data?.config && !initialized) {
    try {
      self.__FIREBASE_CONFIG = data.config;
      firebase.initializeApp(data.config);
      initialized = true;
    } catch (err) {
      swWarn('firebase config relay failed', { error: err?.message ?? String(err) });
    }
  } else if (data?.type === 'CLIENT_PORT') {
    if (event.ports && event.ports[0]) {
      swInfo('CLIENT_PORT message received');
      registerClientPort(event.ports[0]);
    } else {
      swWarn('CLIENT_PORT message missing port');
    }
  } else if (data?.type === 'DEVICE_ID' && typeof data.deviceId === 'string' && data.deviceId.length) {
    swInfo('DEVICE_ID message received', { deviceId: data.deviceId });
    activeDeviceId = data.deviceId;
  } else if (data?.type === 'CLAIM_CLIENTS') {
    event.waitUntil(
      (async () => {
        try {
          await self.clients.claim();
          swInfo('CLAIM_CLIENTS processed');
        } catch (err) {
          swWarn('Failed to claim clients on request', { error: err?.message ?? String(err) });
        }
      })()
    );
  } else if (data?.type === 'TEST_PUSH_PING') {
    const response = {
      type: 'TEST_PUSH_PONG',
      messageId: data.messageId ?? null,
      timestamp: Date.now()
    };
    let responded = false;
    if (event?.ports && event.ports[0]) {
      try {
        event.ports[0].postMessage(response);
        responded = true;
        swInfo('Responded to ping via MessagePort');
      } catch (err) {
        swWarn('Failed to respond to ping via MessagePort', {
          error: err?.message ?? String(err)
        });
      }
    }
    if (!responded) {
      try {
        event?.source?.postMessage?.(response);
        responded = true;
        swInfo('Responded to ping via event.source');
      } catch (err) {
        swWarn('Failed to respond to ping via event.source', {
          error: err?.message ?? String(err)
        });
      }
    }
    if (!responded) {
      swWarn('TEST_PUSH_PING response had no direct channel');
    }
    broadcastPushMessage(response);
    postMessageToPorts(response);
    event.waitUntil(
      (async () => {
        try {
          const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
          swInfo('TEST_PUSH_PING posting to window clients', {
            clientCount: clients.length
          });
          clients.forEach((client) => {
            try {
              client.postMessage(response);
              swInfo('TEST_PUSH_PING posted to client', { url: client.url ?? 'unknown' });
            } catch (err) {
              swWarn('TEST_PUSH_PING client post failed', {
                error: err?.message ?? String(err)
              });
            }
          });
        } catch (err) {
          swWarn('TEST_PUSH_PING matchAll failed', { error: err?.message ?? String(err) });
        }
      })()
    );
  } else {
    swInfo('message event unhandled', {
      type: data?.type ?? 'unknown',
      keys: typeof data === 'object' && data ? Object.keys(data) : []
    });
  }
});

async function getMessaging() {
  await ensureFirebaseInit();
  if (!initialized) return null;
  if (messagingInstance) {
    swInfo('firebase.messaging instance reused');
    return messagingInstance;
  }
  try {
    messagingInstance = firebase.messaging();
    swInfo('firebase.messaging instance created');
    return messagingInstance;
  } catch (err) {
    swWarn('firebase messaging init failed', { error: err?.message ?? String(err) });
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
    } catch (err) {
      swWarn('Failed to parse push payload', {
        error: err?.message ?? String(err),
        raw: event?.data?.text ? event.data.text() : null
      });
      return null;
    }
  }
}

const DEVICE_ID_KEYS = [
  'testDeviceId',
  'test_device_id',
  'targetDeviceId',
  'target_device_id',
  'deviceId',
  'device_id'
];
const MESSAGE_ID_KEYS = ['messageId', 'message_id'];

function pickStringValue(data, keys) {
  if (!data || typeof data !== 'object') return null;
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.length) {
      return value;
    }
  }
  return null;
}

function extractDeviceIdFromData(data) {
  return pickStringValue(data, DEVICE_ID_KEYS);
}

function extractMessageIdFromData(data) {
  return pickStringValue(data, MESSAGE_ID_KEYS);
}

function previewPayloadData(data) {
  if (!data || typeof data !== 'object') {
    return { hasData: false };
  }
  const keys = Object.keys(data);
  const preview = {};
  for (const key of keys.slice(0, 8)) {
    preview[key] = data[key];
  }
  return {
    hasData: keys.length > 0,
    keys,
    preview
  };
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
  if (!payload) return null;
  const data = coercePayloadData(payload);
  const title = data.title || 'New message';
  const body = data.body || '';
  const mentionType = data.mentionType || 'direct';
  const icon = data.icon || DEFAULT_ICON;
  const badgeCount = Number(data.badge ?? 1);
  const tagParts = [data.serverId, data.channelId, data.threadId, data.dmId, mentionType].filter(Boolean);
  const tag = tagParts.length ? tagParts.join(':') : `hconnect:${mentionType}`;
  
  // iOS PWA specific: always renotify and require interaction for reliability
  const isIOSPWA = /iPhone|iPad|iPod/.test(self.navigator?.userAgent || '') ||
    (self.navigator?.standalone === true);
  
  const options = {
    body,
    icon,
    badge: data.badgeIcon || DEFAULT_ICON,
    image: data.image || undefined,
    tag,
    // For iOS: always renotify to ensure the notification shows even with same tag
    renotify: true,
    // Require interaction on all platforms for better visibility
    requireInteraction: true,
    // Silent false to ensure sound plays
    silent: false,
    data,
    actions: Array.isArray(data.actions) ? data.actions : undefined,
    // iOS 16.4+ supports vibration pattern
    vibrate: [200, 100, 200]
  };
  
  swInfo('showNotification preparing', {
    title,
    bodyLength: body.length,
    tag,
    mentionType,
    isIOSPWA,
    platform: data.platform ?? 'unknown',
    messageId: data.messageId ?? null,
    hasIcon: Boolean(options.icon),
    dataKeys: Object.keys(data)
  });
  
  try {
    await self.registration.showNotification(title, options);
    swInfo('showNotification succeeded', { tag, title, messageId: data.messageId, platform: data.platform });
  } catch (err) {
    swWarn('showNotification error', { error: err?.message ?? String(err), tag, platform: data.platform });
    // Fallback: try with minimal options for iOS compatibility
    try {
      await self.registration.showNotification(title, {
        body,
        icon: DEFAULT_ICON,
        tag,
        data
      });
      swInfo('showNotification fallback succeeded');
    } catch (fallbackErr) {
      swWarn('showNotification fallback also failed', { 
        error: fallbackErr?.message ?? String(fallbackErr) 
      });
      throw fallbackErr;
    }
  }
  
  // Set app badge for iOS
  if (typeof self.registration.setAppBadge === 'function') {
    Promise.resolve()
      .then(() => self.registration.setAppBadge(badgeCount || 1))
      .then(() => swInfo('App badge set', { count: badgeCount }))
      .catch((err) => swWarn('setAppBadge failed', { error: err?.message ?? String(err) }));
  }
  
  return {
    title,
    body,
    tag,
    mentionType,
    badgeCount,
    targetUrl: data.targetUrl || null,
    dataKeys: Object.keys(data)
  };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function focusOrOpenClient(data) {
  const targetUrl = data.targetUrl || deriveDeepLink(data);
  const payload = { ...data, targetUrl, origin: data.origin || 'push', clickedAt: Date.now() };
  swInfo('focusOrOpenClient invoked', {
    targetUrl,
    origin: payload.origin,
    hasExistingData: Boolean(data)
  });
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    if (client.url) {
      try {
        swInfo('Attempting to focus existing window client', { url: client.url });
        await client.focus();
      } catch {
        // fallback to navigate if focus fails
        if (typeof client.navigate === 'function') {
          try {
            swInfo('Falling back to navigate existing client', {
              url: client.url,
              targetUrl
            });
            await client.navigate(targetUrl);
          } catch {}
        }
      }
      client.postMessage({ type: CLIENT_MESSAGE, payload });
      swInfo('Posted deep link payload to existing client', { url: client.url });
      return;
    }
  }
  const created = await self.clients.openWindow(targetUrl);
  if (created) {
    swInfo('Opened new window client for notification', { targetUrl });
    await delay(800);
    try {
      created.postMessage({ type: CLIENT_MESSAGE, payload });
      swInfo('Posted deep link payload to new window client');
    } catch {
      // Window might not be ready yet; wait again
      await delay(800);
      try {
        created.postMessage({ type: CLIENT_MESSAGE, payload });
        swInfo('Posted deep link payload to new window client after retry');
      } catch {}
    }
  } else {
    swWarn('Unable to open window client for notification', { targetUrl });
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const payload = readPayloadFromPush(event);
      swInfo('Push event fired', {
        hasPayload: Boolean(payload),
        raw: payload ? undefined : describePayload(event?.data?.text ? event.data.text() : null)
      });
      if (!payload) {
        swWarn('Push event missing payload');
        return;
      }
      const payloadData = payload?.data || {};
      swInfo('Push payload data preview', previewPayloadData(payloadData));
      const explicitDeviceId = extractDeviceIdFromData(payloadData);
      const messageId = extractMessageIdFromData(payloadData);
      const isTestPush =
        Boolean(explicitDeviceId) ||
        (typeof messageId === 'string' && messageId.startsWith('test-'));
      swInfo('Test push detection', {
        isTestPush,
        explicitDeviceId,
        messageId,
        activeDeviceId
      });
      if (explicitDeviceId) {
        if (!activeDeviceId) {
          activeDeviceId = explicitDeviceId;
          void requestDeviceIdFromClients('missing_device_id');
          swInfo('No active device id, adopting from payload', { explicitDeviceId });
        } else if (explicitDeviceId !== activeDeviceId) {
          swInfo('Target device mismatch, adopting payload id', {
            activeDeviceId,
            explicitDeviceId
          });
          activeDeviceId = explicitDeviceId;
          void requestDeviceIdFromClients('mismatched_device_id');
        }
      } else if (!activeDeviceId && isTestPush) {
        swInfo('Test push missing explicit device id, requesting from clients');
        void requestDeviceIdFromClients('missing_device_id_from_payload');
      }
      const ackDeviceId = explicitDeviceId || activeDeviceId || null;
      let deliveryStatus = 'delivered';
      let deliveryError = null;
      swInfo('Push payload parsed', {
        explicitDeviceId,
        ackDeviceId,
        activeDeviceId,
        hasNotification: Boolean(payload?.notification),
        hasData: Boolean(payload?.data),
        messageId
      });
      let notificationInfo = null;
      try {
        notificationInfo = await showNotification(payload);
        swInfo('Notification displayed', {
          ackDeviceId,
          messageId,
          mentionType: notificationInfo?.mentionType ?? null,
          title: notificationInfo?.title ?? null,
          tag: notificationInfo?.tag ?? null
        });
      } catch (err) {
        deliveryStatus = 'failed';
        deliveryError = err instanceof Error ? err.message : 'Notification display failed.';
        swWarn('showNotification failed', { error: err?.message ?? String(err) });
      }
      if (isTestPush) {
        swInfo('Dispatching TEST_PUSH_RESULT', {
          ackDeviceId,
          messageId,
          status: deliveryStatus,
          error: deliveryError
        });
        await notifyClientTestPush({
          type: 'TEST_PUSH_RESULT',
          deviceId: ackDeviceId,
          messageId,
          sentAt: Date.now(),
          status: deliveryStatus,
          error: deliveryError
        });
        if (!ackDeviceId) {
          swInfo('Test push result dispatched without device id');
        }
      }
    })()
  );
});

async function notifyClientTestPush(payload) {
  swInfo('notifyClientTestPush invoked', {
    type: payload?.type,
    status: payload?.status,
    deviceId: payload?.deviceId ?? null,
    messageId: payload?.messageId ?? null,
    portCount: clientMessagePorts.size
  });
  postMessageToPorts(payload);
  swInfo('notifyClientTestPush postMessageToPorts completed', {
    ports: clientMessagePorts.size
  });
  broadcastPushMessage(payload);
  swInfo('notifyClientTestPush broadcast complete', {
    hasBroadcastChannel: Boolean(pushBroadcastChannel)
  });
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    swInfo('notifyClientTestPush posting to windows', {
      clientCount: clients.length
    });
    if (!clients.length) {
      swInfo('notifyClientTestPush found zero window clients');
    }
    clients.forEach((client) => {
      try {
        client.postMessage(payload);
        swInfo('notifyClientTestPush posted to client', {
          url: client.url ?? 'unknown'
        });
      } catch (err) {
        swWarn('notifyClientTestPush postMessage failed', { error: err?.message ?? String(err) });
      }
    });
  } catch (err) {
    swWarn('notifyClientTestPush clients.matchAll failed', { error: err?.message ?? String(err) });
  }
  swInfo('notifyClientTestPush completed dispatch', {
    status: payload?.status,
    deviceId: payload?.deviceId ?? null,
    messageId: payload?.messageId ?? null
  });
}

async function requestDeviceIdFromClients(trigger) {
  const message = { type: 'REQUEST_DEVICE_ID', trigger: trigger || null };
  swInfo('requestDeviceIdFromClients invoked', {
    ...message,
    activeDeviceId
  });
  postMessageToPorts(message);
  broadcastPushMessage(message);
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    swInfo('requestDeviceIdFromClients posting to windows', {
      clientCount: clients.length
    });
    if (!clients.length) {
      swInfo('REQUEST_DEVICE_ID had zero clients');
    }
    clients.forEach((client) => {
      try {
        client.postMessage({ type: 'REQUEST_DEVICE_ID', trigger: trigger || null });
        swInfo('REQUEST_DEVICE_ID sent to client', { url: client.url ?? 'unknown' });
      } catch (err) {
        swWarn('REQUEST_DEVICE_ID post failed', { error: err?.message ?? String(err) });
      }
    });
  } catch (err) {
    swWarn('requestDeviceIdFromClients matchAll failed', { error: err?.message ?? String(err) });
  }
}

function broadcastPushMessage(payload) {
  if (!pushBroadcastChannel) {
    swInfo('BroadcastChannel unavailable, payload not broadcast');
    return;
  }
  try {
    pushBroadcastChannel.postMessage(payload);
    swInfo('BroadcastChannel postMessage', { type: payload?.type });
  } catch (err) {
    swWarn('BroadcastChannel postMessage failed', { error: err?.message ?? String(err) });
  }
}

function postMessageToPorts(payload) {
  if (!clientMessagePorts.size) {
    swInfo('postMessageToPorts skipped (no ports)', { payloadType: payload?.type });
    return;
  }
  swInfo('postMessageToPorts', {
    payloadType: payload?.type,
    ports: clientMessagePorts.size
  });
  for (const port of Array.from(clientMessagePorts)) {
    try {
      port.postMessage(payload);
      swInfo('postMessageToPorts delivered payload', {
        payloadType: payload?.type
      });
    } catch (err) {
      swWarn('postMessageToPorts failed', { error: err?.message ?? String(err) });
      try {
        port.close?.();
      } catch {}
      clientMessagePorts.delete(port);
      swInfo('Removed closed port', { total: clientMessagePorts.size });
    }
  }
}

function registerClientPort(port) {
  if (!port) return;
  try {
    port.start?.();
    port.addEventListener('message', (event) => {
      swInfo('CLIENT_PORT forwarded message', {
        type: event?.data?.type ?? 'unknown'
      });
    });
    port.addEventListener('messageerror', () => {
      try {
        port.close?.();
      } catch {}
      clientMessagePorts.delete(port);
      swInfo('CLIENT_PORT removed due to messageerror', {
        total: clientMessagePorts.size
      });
    });
  } catch (err) {
    swWarn('Failed to register CLIENT_PORT', { error: err?.message ?? String(err) });
  }
  clientMessagePorts.add(port);
  swInfo('CLIENT_PORT registered', { total: clientMessagePorts.size });
}

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
        swWarn('push subscription refresh failed', { error: err?.message ?? String(err) });
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  swInfo('notificationclick event', {
    tag: event.notification?.tag ?? null,
    action: event.action ?? null,
    hasData: Boolean(event.notification?.data)
  });
  
  event.notification.close();
  const data = event.notification?.data || {};
  
  event.waitUntil(
    (async () => {
      try {
        await focusOrOpenClient(data);
        swInfo('notificationclick handled, focused/opened client');
      } catch (err) {
        swWarn('notificationclick focusOrOpenClient failed', { 
          error: err?.message ?? String(err) 
        });
        // Fallback: try to open the URL directly
        const targetUrl = data.targetUrl || deriveDeepLink(data);
        try {
          await self.clients.openWindow(targetUrl);
          swInfo('notificationclick fallback openWindow succeeded');
        } catch (e) {
          swWarn('notificationclick fallback openWindow failed', {
            error: e?.message ?? String(e)
          });
        }
      }
      
      // Clear badge
      if (typeof self.registration.clearAppBadge === 'function') {
        try {
          await self.registration.clearAppBadge();
          swInfo('App badge cleared');
        } catch (err) {
          swWarn('clearAppBadge failed', { error: err?.message ?? String(err) });
        }
      }
    })()
  );
});

// Handle notification close (user dismissed)
self.addEventListener('notificationclose', (event) => {
  swInfo('notificationclose event', {
    tag: event.notification?.tag ?? null
  });
