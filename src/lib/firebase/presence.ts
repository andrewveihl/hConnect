import { browser } from '$app/environment';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { user as userStore } from '$lib/stores/user';
import type { PresenceState } from '$lib/presence/state';

let currentUid: string | null = null;
let lastState: PresenceState | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;

const windowUnsubs: Array<() => void> = [];

const HEARTBEAT_INTERVAL = 60 * 1000; // 60 seconds - increased from 30s to reduce Firestore writes

type WindowEventKey = keyof WindowEventMap;

function addWindowListener<E extends WindowEventKey>(
	event: E,
	handler: (event: WindowEventMap[E]) => void
) {
	if (!browser) return () => {};
	window.addEventListener(event, handler as EventListener);
	return () => window.removeEventListener(event, handler as EventListener);
}

function addDocumentListener<E extends keyof DocumentEventMap>(
	event: E,
	handler: (event: DocumentEventMap[E]) => void
) {
	if (!browser) return () => {};
	document.addEventListener(event, handler as EventListener);
	return () => document.removeEventListener(event, handler as EventListener);
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
			updatedAt: now
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
	// Only run heartbeat if tab is visible (saves battery on mobile)
	if (document.hidden) return;
	heartbeat = setInterval(() => {
		// Skip heartbeat when tab is hidden to save battery
		if (document.hidden) return;
		const state = stateFromEnvironment();
		void writePresence(state, { force: true });
	}, HEARTBEAT_INTERVAL);
}

function pauseHeartbeatIfHidden() {
	if (document.hidden) {
		clearHeartbeat();
	} else {
		startHeartbeat();
	}
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

	// visibilitychange is a document event, not window
	windowUnsubs.push(
		addDocumentListener('visibilitychange', () => {
			const state = stateFromEnvironment();
			void writePresence(state, { force: true });
			// Pause/resume heartbeat based on visibility (saves battery on mobile)
			pauseHeartbeatIfHidden();
		})
	);

	// Track focus/blur for more accurate presence
	windowUnsubs.push(
		addWindowListener('focus', () => {
			void writePresence('online', { force: true });
		})
	);

	windowUnsubs.push(
		addWindowListener('blur', () => {
			// When window loses focus, set to idle (not offline - they may come back)
			void writePresence('idle', { force: true });
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

	// Also use pagehide for mobile browsers where beforeunload is unreliable
	windowUnsubs.push(
		addWindowListener('pagehide', () => {
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
