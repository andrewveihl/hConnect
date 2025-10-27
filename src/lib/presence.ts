import { browser } from '$app/environment';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { user as userStore } from '$lib/stores/user';

type PresenceState = 'online' | 'idle' | 'offline';

let currentUid: string | null = null;
let lastState: PresenceState | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;

const windowUnsubs: Array<() => void> = [];

const HEARTBEAT_INTERVAL = 60 * 1000;

type WindowEventKey = keyof WindowEventMap | 'visibilitychange';

function addWindowListener<E extends WindowEventKey>(
  event: E,
  handler: (event: E extends keyof WindowEventMap ? WindowEventMap[E] : Event) => void
) {
  if (!browser) return () => {};
  window.addEventListener(event as keyof WindowEventMap, handler as EventListener);
  return () => window.removeEventListener(event as keyof WindowEventMap, handler as EventListener);
}

function clearHeartbeat() {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

function detachWindowListeners() {
  while (windowUnsubs.length) {
    const unsub = windowUnsubs.pop();
    unsub?.();
  }
}

async function writePresenceFor(
  uid: string,
  state: PresenceState,
  { force = false }: { force?: boolean } = {}
) {
  if (!browser || !uid) return;
  if (!force && uid === currentUid && state === lastState) return;

  try {
    await ensureFirebaseReady();
    const db = getDb();
    const ref = doc(db, 'profiles', uid, 'presence', 'status');
    const now = serverTimestamp();

    const payload: Record<string, unknown> = {
      state,
      status: state,
      updatedAt: now,
    };

    if (state === 'online') {
      payload.online = true;
      payload.isOnline = true;
      payload.active = true;
      payload.lastActive = now;
      payload.lastSeen = now;
    } else if (state === 'idle') {
      payload.online = false;
      payload.isOnline = false;
      payload.active = false;
      payload.lastActive = now;
      payload.lastSeen = now;
    } else {
      payload.online = false;
      payload.isOnline = false;
      payload.active = false;
      payload.lastSeen = now;
    }

    await setDoc(ref, payload, { merge: true });
    if (uid === currentUid) {
      lastState = state;
    }
  } catch (err) {
    console.warn('Failed to update presence', state, err);
  }
}

function stateFromEnvironment(): PresenceState {
  if (!browser) return 'offline';
  if (!navigator.onLine) return 'offline';
  return document.hidden ? 'idle' : 'online';
}

function startHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    const state = stateFromEnvironment();
    void writePresence(state, { force: true });
  }, HEARTBEAT_INTERVAL);
}

function stopTracking() {
  const uid = currentUid;
  currentUid = null;
  lastState = null;
  clearHeartbeat();
  detachWindowListeners();
  if (uid) {
    void writePresenceFor(uid, 'offline', { force: true });
  }
}

function activateListeners() {
  if (!browser || windowUnsubs.length) return;

  windowUnsubs.push(
    addWindowListener('visibilitychange', () => {
      const state = stateFromEnvironment();
      void writePresence(state, { force: true });
    })
  );

  windowUnsubs.push(
    addWindowListener('online', () => {
      const state = stateFromEnvironment();
      void writePresence(state, { force: true });
    })
  );

  windowUnsubs.push(
    addWindowListener('offline', () => {
      void writePresence('offline', { force: true });
    })
  );

  windowUnsubs.push(
    addWindowListener('beforeunload', () => {
      if (currentUid) {
        void writePresenceFor(currentUid, 'offline', { force: true });
      }
    })
  );
}

async function writePresence(state: PresenceState, options?: { force?: boolean }) {
  if (!currentUid) return;
  await writePresenceFor(currentUid, state, options);
}

async function beginTracking(uid: string) {
  currentUid = uid;
  lastState = null;
  activateListeners();
  startHeartbeat();

  const initialState = stateFromEnvironment();
  await writePresence(initialState, { force: true });
}

export function startPresenceService() {
  if (!browser) return () => {};

  const unsubscribeUser = userStore.subscribe((u) => {
    const uid = u?.uid ?? null;
    if (!uid) {
      stopTracking();
      return;
    }
    if (uid !== currentUid) {
      void beginTracking(uid);
    } else {
      // ensure we refresh if viewport state changed while paused
      const state = stateFromEnvironment();
      void writePresence(state, { force: true });
    }
  });

  return () => {
    unsubscribeUser?.();
    stopTracking();
  };
}
