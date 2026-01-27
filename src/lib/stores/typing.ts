// src/lib/stores/typing.ts
// Typing indicator store and Firestore helpers
import { browser } from '$app/environment';
import { getDb } from '$lib/firebase';
import {
	collection,
	doc,
	setDoc,
	deleteDoc,
	onSnapshot,
	serverTimestamp,
	type Unsubscribe
} from 'firebase/firestore';
import { writable } from 'svelte/store';

/* ===========================
   Configuration
=========================== */
const TYPING_TIMEOUT_MS = 5000; // Auto-clear after 5 seconds
const DEBOUNCE_WRITE_MS = 2000; // Only write to Firestore every 2 seconds

/* ===========================
   Types
=========================== */
export type TypingUser = {
	uid: string;
	displayName: string | null;
	timestamp: number;
};

export type TypingLocation =
	| { type: 'channel'; serverId: string; channelId: string; threadId?: string | null }
	| { type: 'dm'; threadId: string };

type TypingState = {
	users: TypingUser[];
};

/* ===========================
   Local State
=========================== */
// Map of location key -> store of typing users
const typingStores = new Map<string, ReturnType<typeof writable<TypingState>>>();
const subscriptions = new Map<string, Unsubscribe>();
const localTimers = new Map<string, ReturnType<typeof setTimeout>>();
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastWriteTime = new Map<string, number>();

/* ===========================
   Helpers
=========================== */
function locationKey(loc: TypingLocation): string {
	if (loc.type === 'channel') {
		const base = `channel:${loc.serverId}:${loc.channelId}`;
		return loc.threadId ? `${base}:thread:${loc.threadId}` : base;
	}
	return `dm:${loc.threadId}`;
}

function getTypingCollectionRef(loc: TypingLocation) {
	const db = getDb();
	if (loc.type === 'channel') {
		if (loc.threadId) {
			return collection(
				db,
				'servers',
				loc.serverId,
				'channels',
				loc.channelId,
				'threads',
				loc.threadId,
				'typing'
			);
		}
		return collection(db, 'servers', loc.serverId, 'channels', loc.channelId, 'typing');
	}
	return collection(db, 'dms', loc.threadId, 'typing');
}

function getTypingDocRef(loc: TypingLocation, uid: string) {
	const colRef = getTypingCollectionRef(loc);
	return doc(colRef, uid);
}

/* ===========================
   Get/Create Store
=========================== */
function getOrCreateStore(key: string) {
	let store = typingStores.get(key);
	if (!store) {
		store = writable<TypingState>({ users: [] });
		typingStores.set(key, store);
	}
	return store;
}

/* ===========================
   Subscribe to Typing
=========================== */
export function subscribeToTyping(
	loc: TypingLocation,
	currentUid: string | null
): ReturnType<typeof writable<TypingState>> {
	if (!browser) {
		return writable<TypingState>({ users: [] });
	}

	console.log('[Typing] subscribeToTyping called:', { loc, currentUid });
	const key = locationKey(loc);
	const store = getOrCreateStore(key);

	// Already subscribed
	if (subscriptions.has(key)) {
		console.log('[Typing] Already subscribed to:', key);
		return store;
	}

	try {
		const colRef = getTypingCollectionRef(loc);
		console.log('[Typing] Setting up onSnapshot for:', colRef.path);
		const unsub = onSnapshot(
			colRef,
			(snapshot) => {
				const now = Date.now();
				const users: TypingUser[] = [];

				snapshot.forEach((docSnap) => {
					const data = docSnap.data();
					const uid = docSnap.id;

					// Skip self
					if (uid === currentUid) return;

					// Check if typing state is still valid (within timeout)
					const timestamp = data?.timestamp?.toMillis?.() ?? data?.timestamp ?? 0;
					if (now - timestamp < TYPING_TIMEOUT_MS) {
						users.push({
							uid,
							displayName: data?.displayName ?? null,
							timestamp
						});
					}
				});

				// Sort by timestamp (oldest first)
				users.sort((a, b) => a.timestamp - b.timestamp);

				console.log('[Typing] Received snapshot update, users typing:', users);
				store.set({ users });
			},
			(error) => {
				console.warn('[Typing] Subscription error:', error);
				store.set({ users: [] });
			}
		);

		subscriptions.set(key, unsub);
	} catch (error) {
		console.warn('[Typing] Failed to subscribe:', error);
	}

	return store;
}

/* ===========================
   Unsubscribe
=========================== */
export function unsubscribeFromTyping(loc: TypingLocation): void {
	const key = locationKey(loc);
	const unsub = subscriptions.get(key);
	if (unsub) {
		unsub();
		subscriptions.delete(key);
	}
}

/* ===========================
   Set Typing (debounced)
=========================== */
export function setTyping(
	loc: TypingLocation,
	uid: string,
	displayName: string | null,
	isTyping: boolean
): void {
	if (!browser || !uid) return;

	console.log('[Typing] setTyping called:', { loc, uid, displayName, isTyping });

	const key = locationKey(loc);

	// Clear existing timers
	const existingTimer = localTimers.get(key);
	if (existingTimer) {
		clearTimeout(existingTimer);
		localTimers.delete(key);
	}

	const existingWriteTimer = writeTimers.get(key);
	if (existingWriteTimer) {
		clearTimeout(existingWriteTimer);
		writeTimers.delete(key);
	}

	if (!isTyping) {
		// Immediately clear typing status
		void clearTypingDoc(loc, uid);
		return;
	}

	// Check debounce - only write if enough time has passed
	const lastWrite = lastWriteTime.get(key) ?? 0;
	const now = Date.now();
	const timeSinceLastWrite = now - lastWrite;

	if (timeSinceLastWrite >= DEBOUNCE_WRITE_MS) {
		// Enough time has passed, write immediately
		void writeTypingDoc(loc, uid, displayName);
		lastWriteTime.set(key, now);
	} else {
		// Schedule a write for later
		const delay = DEBOUNCE_WRITE_MS - timeSinceLastWrite;
		const timer = setTimeout(() => {
			void writeTypingDoc(loc, uid, displayName);
			lastWriteTime.set(key, Date.now());
			writeTimers.delete(key);
		}, delay);
		writeTimers.set(key, timer);
	}

	// Auto-clear after timeout
	const clearTimer = setTimeout(() => {
		void clearTypingDoc(loc, uid);
		localTimers.delete(key);
	}, TYPING_TIMEOUT_MS);
	localTimers.set(key, clearTimer);
}

/* ===========================
   Firestore Operations
=========================== */
async function writeTypingDoc(
	loc: TypingLocation,
	uid: string,
	displayName: string | null
): Promise<void> {
	try {
		const docRef = getTypingDocRef(loc, uid);
		console.log('[Typing] Writing doc:', docRef.path, { displayName });
		await setDoc(docRef, {
			displayName,
			timestamp: serverTimestamp()
		});
		console.log('[Typing] Doc written successfully:', docRef.path);
	} catch (error) {
		// Silently fail - typing indicators are non-critical
		console.debug('[Typing] Write failed:', error);
	}
}

async function clearTypingDoc(loc: TypingLocation, uid: string): Promise<void> {
	try {
		const docRef = getTypingDocRef(loc, uid);
		await deleteDoc(docRef);
	} catch (error) {
		// Silently fail
		console.debug('[Typing] Clear failed:', error);
	}
}

/* ===========================
   Clear on Send
=========================== */
export function clearTypingOnSend(loc: TypingLocation, uid: string): void {
	if (!browser || !uid) return;

	const key = locationKey(loc);

	// Clear all timers
	const existingTimer = localTimers.get(key);
	if (existingTimer) {
		clearTimeout(existingTimer);
		localTimers.delete(key);
	}

	const existingWriteTimer = writeTimers.get(key);
	if (existingWriteTimer) {
		clearTimeout(existingWriteTimer);
		writeTimers.delete(key);
	}

	// Clear last write time so next typing session starts fresh
	lastWriteTime.delete(key);

	// Clear from Firestore
	void clearTypingDoc(loc, uid);
}

/* ===========================
   Cleanup All
=========================== */
export function cleanupTyping(): void {
	// Clear all subscriptions
	for (const unsub of subscriptions.values()) {
		unsub();
	}
	subscriptions.clear();

	// Clear all timers
	for (const timer of localTimers.values()) {
		clearTimeout(timer);
	}
	localTimers.clear();

	for (const timer of writeTimers.values()) {
		clearTimeout(timer);
	}
	writeTimers.clear();

	// Clear stores
	typingStores.clear();
	lastWriteTime.clear();
}

/* ===========================
   Format Helper
=========================== */
export function formatTypingText(users: TypingUser[], maxNames = 3): string {
	if (users.length === 0) return '';

	const names = users.map((u) => u.displayName || 'Someone').slice(0, maxNames);

	if (users.length === 1) {
		return `${names[0]} is typing`;
	}

	if (users.length === 2) {
		return `${names[0]} and ${names[1]} are typing`;
	}

	if (users.length === 3 && maxNames >= 3) {
		return `${names[0]}, ${names[1]}, and ${names[2]} are typing`;
	}

	const othersCount = users.length - maxNames + 1;
	const displayedNames = names.slice(0, maxNames - 1);
	return `${displayedNames.join(', ')} and ${othersCount} others are typing`;
}
