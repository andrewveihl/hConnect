// src/lib/perf/cacheDb.ts
// IndexedDB-backed LRU cache for instant paint on navigation
// Provides serverRail, dmRail, serverView, threadView caches with TTL and eviction

import { browser } from '$app/environment';

/* ===========================
   Configuration
=========================== */
const DB_NAME = 'hconnect_cache';
const DB_VERSION = 1;

// Store names
const STORE_SERVER_RAIL = 'serverRail';
const STORE_DM_RAIL = 'dmRail';
const STORE_SERVER_VIEW = 'serverView';
const STORE_THREAD_VIEW = 'threadView';
const STORE_AVATAR = 'avatarBlobs';

// LRU limits
const MAX_SERVER_VIEWS = 15;
const MAX_THREAD_VIEWS = 30;
const MAX_AVATAR_BLOBS = 100;

// TTL (milliseconds)
const SERVER_VIEW_TTL = 24 * 60 * 60 * 1000; // 24 hours
const THREAD_VIEW_TTL = 12 * 60 * 60 * 1000; // 12 hours
const AVATAR_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/* ===========================
   Types
=========================== */
export type ServerRailEntry = {
	id: string;
	name: string;
	icon?: string | null;
	position?: number | null;
	joinedAt?: number | null;
};

export type DMRailEntry = {
	id: string;
	participants?: string[];
	otherUid?: string | null;
	lastMessage?: string | null;
	updatedAt?: number | null;
	hidden?: boolean;
	isGroup?: boolean;
	groupName?: string | null;
};

export type ChannelEntry = {
	id: string;
	name: string;
	type: 'text' | 'voice';
	position?: number;
	isPrivate?: boolean;
	categoryId?: string | null;
};

export type ServerViewData = {
	serverId: string;
	channels: ChannelEntry[];
	lastChannelId?: string | null;
	serverMeta?: {
		name?: string;
		iconURL?: string | null;
		description?: string | null;
		ownerId?: string | null;
	};
	collapsedCategoryIds?: string[]; // User's collapsed folder state for instant UI
	updatedAt: number;
};

export type ThreadViewMessage = {
	id: string;
	uid: string;
	text?: string;
	content?: string;
	type?: string;
	createdAt?: number;
	displayName?: string | null;
	photoURL?: string | null;
	reactions?: Record<string, unknown>;
	replyTo?: unknown;
	attachments?: unknown[];
	pending?: boolean;
	clientId?: string;
};

export type ThreadViewData = {
	threadKey: string; // serverId:channelId or dmThreadId
	messages: ThreadViewMessage[];
	earliestLoaded?: number | null;
	hasOlderMessages?: boolean;
	updatedAt: number;
};

export type AvatarBlobEntry = {
	url: string;
	blob: Blob;
	contentType: string;
	size: number;
	cachedAt: number;
	lastAccessed: number;
};

/* ===========================
   In-memory cache layer
=========================== */
let memoryServerRail: ServerRailEntry[] | null = null;
let memoryDmRail: DMRailEntry[] | null = null;
const memoryServerViews = new Map<string, ServerViewData>();
const memoryThreadViews = new Map<string, ThreadViewData>();
const memoryAvatarUrls = new Map<string, string>(); // url -> objectURL

// localStorage keys for instant first-paint (synchronous access)
const LS_SERVER_RAIL = 'hc_server_rail';
const LS_DM_RAIL = 'hc_dm_rail';

// Debug event log
const eventLog: Array<{ time: number; event: string; key?: string; size?: number }> = [];
const MAX_EVENT_LOG = 100;

function logEvent(event: string, key?: string, size?: number) {
	eventLog.push({ time: Date.now(), event, key, size });
	if (eventLog.length > MAX_EVENT_LOG) {
		eventLog.shift();
	}
}

/* ===========================
   IndexedDB singleton
=========================== */
let dbPromise: Promise<IDBDatabase> | null = null;
let dbInstance: IDBDatabase | null = null;

function openDatabase(): Promise<IDBDatabase> {
	if (!browser) {
		return Promise.reject(new Error('IndexedDB not available on server'));
	}
	if (dbInstance) {
		return Promise.resolve(dbInstance);
	}
	if (dbPromise) {
		return dbPromise;
	}

	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onerror = () => {
			console.error('[cacheDb] Failed to open IndexedDB:', request.error);
			reject(request.error);
		};

		request.onsuccess = () => {
			dbInstance = request.result;
			logEvent('db:open');
			resolve(dbInstance);
		};

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;

			// Server rail store
			if (!db.objectStoreNames.contains(STORE_SERVER_RAIL)) {
				db.createObjectStore(STORE_SERVER_RAIL, { keyPath: 'uid' });
			}

			// DM rail store
			if (!db.objectStoreNames.contains(STORE_DM_RAIL)) {
				db.createObjectStore(STORE_DM_RAIL, { keyPath: 'uid' });
			}

			// Server view store (channels + metadata per server)
			if (!db.objectStoreNames.contains(STORE_SERVER_VIEW)) {
				const store = db.createObjectStore(STORE_SERVER_VIEW, { keyPath: 'serverId' });
				store.createIndex('updatedAt', 'updatedAt', { unique: false });
			}

			// Thread view store (messages per channel/DM)
			if (!db.objectStoreNames.contains(STORE_THREAD_VIEW)) {
				const store = db.createObjectStore(STORE_THREAD_VIEW, { keyPath: 'threadKey' });
				store.createIndex('updatedAt', 'updatedAt', { unique: false });
			}

			// Avatar blob store
			if (!db.objectStoreNames.contains(STORE_AVATAR)) {
				const store = db.createObjectStore(STORE_AVATAR, { keyPath: 'url' });
				store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
			}

			logEvent('db:upgrade');
		};
	});

	return dbPromise;
}

/* ===========================
   Server Rail Cache
=========================== */
export async function getServerRail(uid: string): Promise<ServerRailEntry[]> {
	// Memory first
	if (memoryServerRail !== null) {
		logEvent('serverRail:memory-hit', uid);
		return memoryServerRail;
	}

	try {
		const db = await openDatabase();
		return new Promise((resolve) => {
			const tx = db.transaction(STORE_SERVER_RAIL, 'readonly');
			const store = tx.objectStore(STORE_SERVER_RAIL);
			const request = store.get(uid);

			request.onsuccess = () => {
				const data = request.result;
				if (data?.servers) {
					memoryServerRail = data.servers;
					logEvent('serverRail:idb-hit', uid, data.servers.length);
					resolve(data.servers);
				} else {
					logEvent('serverRail:idb-miss', uid);
					resolve([]);
				}
			};

			request.onerror = () => {
				logEvent('serverRail:idb-error', uid);
				resolve([]);
			};
		});
	} catch {
		return [];
	}
}

/**
 * Synchronous getter for preloaded server rail.
 * Reads from localStorage if memory not yet populated (instant first paint).
 * Use this for initial render before async operations.
 */
export function getServerRailSync(): ServerRailEntry[] {
	if (memoryServerRail !== null) return memoryServerRail;
	
	// Try localStorage for instant first paint
	if (browser) {
		try {
			const stored = localStorage.getItem(LS_SERVER_RAIL);
			if (stored) {
				const parsed = JSON.parse(stored);
				if (Array.isArray(parsed)) {
					memoryServerRail = parsed;
					logEvent('serverRail:localStorage-hit', 'sync', parsed.length);
					return parsed;
				}
			}
		} catch {}
	}
	return [];
}

export async function setServerRail(uid: string, servers: ServerRailEntry[]): Promise<void> {
	memoryServerRail = servers;
	logEvent('serverRail:set', uid, servers.length);
	
	// Save to localStorage for instant first paint on refresh
	if (browser) {
		try {
			localStorage.setItem(LS_SERVER_RAIL, JSON.stringify(servers));
		} catch {}
	}

	try {
		const db = await openDatabase();
		const tx = db.transaction(STORE_SERVER_RAIL, 'readwrite');
		const store = tx.objectStore(STORE_SERVER_RAIL);
		store.put({ uid, servers, updatedAt: Date.now() });
	} catch (e) {
		console.warn('[cacheDb] Failed to persist server rail:', e);
	}
}

export function setServerRailMemory(servers: ServerRailEntry[]): void {
	memoryServerRail = servers;
}

/* ===========================
   DM Rail Cache
=========================== */
export async function getDmRail(uid: string): Promise<DMRailEntry[]> {
	// Memory first
	if (memoryDmRail !== null) {
		logEvent('dmRail:memory-hit', uid);
		return memoryDmRail;
	}

	try {
		const db = await openDatabase();
		return new Promise((resolve) => {
			const tx = db.transaction(STORE_DM_RAIL, 'readonly');
			const store = tx.objectStore(STORE_DM_RAIL);
			const request = store.get(uid);

			request.onsuccess = () => {
				const data = request.result;
				if (data?.threads) {
					memoryDmRail = data.threads;
					logEvent('dmRail:idb-hit', uid, data.threads.length);
					resolve(data.threads);
				} else {
					logEvent('dmRail:idb-miss', uid);
					resolve([]);
				}
			};

			request.onerror = () => {
				logEvent('dmRail:idb-error', uid);
				resolve([]);
			};
		});
	} catch {
		return [];
	}
}

/**
 * Synchronous getter for preloaded DM rail.
 * Reads from localStorage if memory not yet populated (instant first paint).
 */
export function getDmRailSync(): DMRailEntry[] {
	if (memoryDmRail !== null) return memoryDmRail;
	
	// Try localStorage for instant first paint
	if (browser) {
		try {
			const stored = localStorage.getItem(LS_DM_RAIL);
			if (stored) {
				const parsed = JSON.parse(stored);
				if (Array.isArray(parsed)) {
					memoryDmRail = parsed;
					logEvent('dmRail:localStorage-hit', 'sync', parsed.length);
					return parsed;
				}
			}
		} catch {}
	}
	return [];
}

export async function setDmRail(uid: string, threads: DMRailEntry[]): Promise<void> {
	memoryDmRail = threads;
	logEvent('dmRail:set', uid, threads.length);
	
	// Save to localStorage for instant first paint on refresh
	if (browser) {
		try {
			localStorage.setItem(LS_DM_RAIL, JSON.stringify(threads));
		} catch {}
	}

	try {
		const db = await openDatabase();
		const tx = db.transaction(STORE_DM_RAIL, 'readwrite');
		const store = tx.objectStore(STORE_DM_RAIL);
		store.put({ uid, threads, updatedAt: Date.now() });
	} catch (e) {
		console.warn('[cacheDb] Failed to persist DM rail:', e);
	}
}

export function setDmRailMemory(threads: DMRailEntry[]): void {
	memoryDmRail = threads;
}

/* ===========================
   Server View Cache (channels + meta)
=========================== */
export function getServerViewMemory(serverId: string): ServerViewData | null {
	const data = memoryServerViews.get(serverId);
	if (data) {
		logEvent('serverView:memory-hit', serverId);
		return data;
	}
	return null;
}

export async function getServerView(serverId: string): Promise<ServerViewData | null> {
	// Memory first
	const memData = memoryServerViews.get(serverId);
	if (memData) {
		logEvent('serverView:memory-hit', serverId);
		return memData;
	}

	try {
		const db = await openDatabase();
		return new Promise((resolve) => {
			const tx = db.transaction(STORE_SERVER_VIEW, 'readonly');
			const store = tx.objectStore(STORE_SERVER_VIEW);
			const request = store.get(serverId);

			request.onsuccess = () => {
				const data = request.result as ServerViewData | undefined;
				if (data) {
					// Check TTL
					if (Date.now() - data.updatedAt > SERVER_VIEW_TTL) {
						logEvent('serverView:idb-expired', serverId);
						resolve(null);
						return;
					}
					memoryServerViews.set(serverId, data);
					evictOldServerViews();
					logEvent('serverView:idb-hit', serverId, data.channels?.length);
					resolve(data);
				} else {
					logEvent('serverView:idb-miss', serverId);
					resolve(null);
				}
			};

			request.onerror = () => {
				logEvent('serverView:idb-error', serverId);
				resolve(null);
			};
		});
	} catch {
		return null;
	}
}

export async function setServerView(data: ServerViewData): Promise<void> {
	data.updatedAt = Date.now();
	memoryServerViews.set(data.serverId, data);
	evictOldServerViews();
	logEvent('serverView:set', data.serverId, data.channels?.length);

	try {
		const db = await openDatabase();
		const tx = db.transaction(STORE_SERVER_VIEW, 'readwrite');
		const store = tx.objectStore(STORE_SERVER_VIEW);
		store.put(data);
	} catch (e) {
		console.warn('[cacheDb] Failed to persist server view:', e);
	}
}

export function setServerViewMemory(data: ServerViewData): void {
	data.updatedAt = Date.now();
	memoryServerViews.set(data.serverId, data);
	evictOldServerViews();
}

export function updateServerViewLastChannel(serverId: string, channelId: string): void {
	const data = memoryServerViews.get(serverId);
	if (data) {
		data.lastChannelId = channelId;
		data.updatedAt = Date.now();
		// Persist async
		setServerView(data).catch(() => {});
	}
}

function evictOldServerViews(): void {
	if (memoryServerViews.size <= MAX_SERVER_VIEWS) return;

	const entries = Array.from(memoryServerViews.entries())
		.sort((a, b) => a[1].updatedAt - b[1].updatedAt);

	const toRemove = entries.slice(0, memoryServerViews.size - MAX_SERVER_VIEWS);
	for (const [key] of toRemove) {
		memoryServerViews.delete(key);
		logEvent('serverView:evict', key);
	}
}

/* ===========================
   Thread View Cache (messages per channel/DM)
=========================== */
export function threadKey(serverId: string, channelId: string): string {
	return `${serverId}:${channelId}`;
}

export function dmThreadKey(threadId: string): string {
	return `dm:${threadId}`;
}

export function getThreadViewMemory(key: string): ThreadViewData | null {
	const data = memoryThreadViews.get(key);
	if (data) {
		logEvent('threadView:memory-hit', key);
		return data;
	}
	return null;
}

export async function getThreadView(key: string): Promise<ThreadViewData | null> {
	// Memory first
	const memData = memoryThreadViews.get(key);
	if (memData) {
		logEvent('threadView:memory-hit', key);
		return memData;
	}

	try {
		const db = await openDatabase();
		return new Promise((resolve) => {
			const tx = db.transaction(STORE_THREAD_VIEW, 'readonly');
			const store = tx.objectStore(STORE_THREAD_VIEW);
			const request = store.get(key);

			request.onsuccess = () => {
				const data = request.result as ThreadViewData | undefined;
				if (data) {
					// Check TTL
					if (Date.now() - data.updatedAt > THREAD_VIEW_TTL) {
						logEvent('threadView:idb-expired', key);
						resolve(null);
						return;
					}
					memoryThreadViews.set(key, data);
					evictOldThreadViews();
					logEvent('threadView:idb-hit', key, data.messages?.length);
					resolve(data);
				} else {
					logEvent('threadView:idb-miss', key);
					resolve(null);
				}
			};

			request.onerror = () => {
				logEvent('threadView:idb-error', key);
				resolve(null);
			};
		});
	} catch {
		return null;
	}
}

export async function setThreadView(data: ThreadViewData): Promise<void> {
	data.updatedAt = Date.now();
	memoryThreadViews.set(data.threadKey, data);
	evictOldThreadViews();
	logEvent('threadView:set', data.threadKey, data.messages?.length);

	try {
		const db = await openDatabase();
		const tx = db.transaction(STORE_THREAD_VIEW, 'readwrite');
		const store = tx.objectStore(STORE_THREAD_VIEW);
		store.put(data);
	} catch (e) {
		console.warn('[cacheDb] Failed to persist thread view:', e);
	}
}

export function setThreadViewMemory(data: ThreadViewData): void {
	data.updatedAt = Date.now();
	memoryThreadViews.set(data.threadKey, data);
	evictOldThreadViews();
	// Also persist to IndexedDB in background for cold start
	setThreadView(data).catch(() => {});
}

export function appendMessagesToThreadView(key: string, messages: ThreadViewMessage[]): void {
	const data = memoryThreadViews.get(key);
	if (!data) return;

	const existingIds = new Set(data.messages.map((m) => m.id));
	const newMessages = messages.filter((m) => !existingIds.has(m.id));

	if (newMessages.length > 0) {
		data.messages = [...data.messages, ...newMessages].sort(
			(a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)
		);
		// Cap at 100 messages
		if (data.messages.length > 100) {
			data.messages = data.messages.slice(-100);
		}
		data.updatedAt = Date.now();
		// Persist async
		setThreadView(data).catch(() => {});
	}
}

export function prependMessagesToThreadView(
	key: string,
	messages: ThreadViewMessage[],
	earliestLoaded?: number | null,
	hasOlderMessages?: boolean
): void {
	const data = memoryThreadViews.get(key);
	if (!data) return;

	const existingIds = new Set(data.messages.map((m) => m.id));
	const newMessages = messages.filter((m) => !existingIds.has(m.id));

	if (newMessages.length > 0) {
		data.messages = [...newMessages, ...data.messages].sort(
			(a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)
		);
	}

	if (earliestLoaded !== undefined) {
		data.earliestLoaded = earliestLoaded;
	}
	if (hasOlderMessages !== undefined) {
		data.hasOlderMessages = hasOlderMessages;
	}
	data.updatedAt = Date.now();
	// Persist async
	setThreadView(data).catch(() => {});
}

function evictOldThreadViews(): void {
	if (memoryThreadViews.size <= MAX_THREAD_VIEWS) return;

	const entries = Array.from(memoryThreadViews.entries())
		.sort((a, b) => a[1].updatedAt - b[1].updatedAt);

	const toRemove = entries.slice(0, memoryThreadViews.size - MAX_THREAD_VIEWS);
	for (const [key] of toRemove) {
		memoryThreadViews.delete(key);
		logEvent('threadView:evict', key);
	}
}

/* ===========================
   Avatar Blob Cache
=========================== */
export async function getCachedAvatarUrl(originalUrl: string): Promise<string | null> {
	// Memory first
	const memUrl = memoryAvatarUrls.get(originalUrl);
	if (memUrl) {
		logEvent('avatar:memory-hit', originalUrl);
		return memUrl;
	}

	try {
		const db = await openDatabase();
		return new Promise((resolve) => {
			const tx = db.transaction(STORE_AVATAR, 'readonly');
			const store = tx.objectStore(STORE_AVATAR);
			const request = store.get(originalUrl);

			request.onsuccess = () => {
				const data = request.result as AvatarBlobEntry | undefined;
				if (data) {
					// Check TTL
					if (Date.now() - data.cachedAt > AVATAR_TTL) {
						logEvent('avatar:idb-expired', originalUrl);
						resolve(null);
						return;
					}
					// Create object URL from blob
					const objectUrl = URL.createObjectURL(data.blob);
					memoryAvatarUrls.set(originalUrl, objectUrl);
					// Update last accessed
					updateAvatarLastAccessed(originalUrl);
					logEvent('avatar:idb-hit', originalUrl);
					resolve(objectUrl);
				} else {
					logEvent('avatar:idb-miss', originalUrl);
					resolve(null);
				}
			};

			request.onerror = () => {
				logEvent('avatar:idb-error', originalUrl);
				resolve(null);
			};
		});
	} catch {
		return null;
	}
}

export async function cacheAvatarBlob(
	originalUrl: string,
	blob: Blob,
	contentType: string
): Promise<string> {
	const objectUrl = URL.createObjectURL(blob);
	memoryAvatarUrls.set(originalUrl, objectUrl);
	logEvent('avatar:cache', originalUrl, blob.size);

	try {
		const db = await openDatabase();
		const tx = db.transaction(STORE_AVATAR, 'readwrite');
		const store = tx.objectStore(STORE_AVATAR);
		const entry: AvatarBlobEntry = {
			url: originalUrl,
			blob,
			contentType,
			size: blob.size,
			cachedAt: Date.now(),
			lastAccessed: Date.now()
		};
		store.put(entry);

		// Evict old avatars
		evictOldAvatars(db);
	} catch (e) {
		console.warn('[cacheDb] Failed to cache avatar:', e);
	}

	return objectUrl;
}

function updateAvatarLastAccessed(url: string): void {
	openDatabase()
		.then((db) => {
			const tx = db.transaction(STORE_AVATAR, 'readwrite');
			const store = tx.objectStore(STORE_AVATAR);
			const request = store.get(url);
			request.onsuccess = () => {
				const data = request.result;
				if (data) {
					data.lastAccessed = Date.now();
					store.put(data);
				}
			};
		})
		.catch(() => {});
}

function evictOldAvatars(db: IDBDatabase): void {
	const tx = db.transaction(STORE_AVATAR, 'readwrite');
	const store = tx.objectStore(STORE_AVATAR);
	const index = store.index('lastAccessed');

	// Count entries
	const countRequest = store.count();
	countRequest.onsuccess = () => {
		const count = countRequest.result;
		if (count <= MAX_AVATAR_BLOBS) return;

		// Get oldest entries to remove
		const toRemove = count - MAX_AVATAR_BLOBS;
		const cursor = index.openCursor();
		let removed = 0;

		cursor.onsuccess = (event) => {
			const cur = (event.target as IDBRequest<IDBCursorWithValue>).result;
			if (cur && removed < toRemove) {
				const url = cur.value.url;
				cur.delete();
				// Revoke object URL if in memory
				const objUrl = memoryAvatarUrls.get(url);
				if (objUrl) {
					URL.revokeObjectURL(objUrl);
					memoryAvatarUrls.delete(url);
				}
				logEvent('avatar:evict', url);
				removed++;
				cur.continue();
			}
		};
	};
}

/* ===========================
   Clear all caches
=========================== */
export function clearAllCaches(): void {
	memoryServerRail = null;
	memoryDmRail = null;
	memoryServerViews.clear();
	memoryThreadViews.clear();

	// Revoke all object URLs
	for (const url of memoryAvatarUrls.values()) {
		URL.revokeObjectURL(url);
	}
	memoryAvatarUrls.clear();

	logEvent('cache:clear-all');

	// Clear IndexedDB stores
	openDatabase()
		.then((db) => {
			const stores = [
				STORE_SERVER_RAIL,
				STORE_DM_RAIL,
				STORE_SERVER_VIEW,
				STORE_THREAD_VIEW,
				STORE_AVATAR
			];
			for (const storeName of stores) {
				const tx = db.transaction(storeName, 'readwrite');
				tx.objectStore(storeName).clear();
			}
		})
		.catch(() => {});
}

/* ===========================
   Debug interface
=========================== */
export function getCacheStats() {
	let totalMessages = 0;
	for (const view of memoryThreadViews.values()) {
		totalMessages += view.messages?.length ?? 0;
	}

	return {
		serverRail: memoryServerRail?.length ?? 0,
		dmRail: memoryDmRail?.length ?? 0,
		serverViews: memoryServerViews.size,
		threadViews: memoryThreadViews.size,
		avatarUrls: memoryAvatarUrls.size,
		totalMessages,
		limits: {
			maxServerViews: MAX_SERVER_VIEWS,
			maxThreadViews: MAX_THREAD_VIEWS,
			maxAvatars: MAX_AVATAR_BLOBS
		}
	};
}

export function getRecentEvents() {
	return [...eventLog];
}

/* ===========================
   Preload Functions - Load IndexedDB data into memory on startup
=========================== */
let preloadPromise: Promise<void> | null = null;

/**
 * Preload all cached data from IndexedDB into memory.
 * Call this early on app load to ensure cache is warm.
 * Returns immediately if already preloaded.
 */
export async function preloadCacheFromDb(): Promise<void> {
	if (!browser) return;
	if (preloadPromise) return preloadPromise;
	
	preloadPromise = (async () => {
		try {
			const db = await openDatabase();
			const now = Date.now();
			
			// Load server rail (get the most recent entry - there's typically only one per user)
			await new Promise<void>((resolve) => {
				const tx = db.transaction(STORE_SERVER_RAIL, 'readonly');
				const store = tx.objectStore(STORE_SERVER_RAIL);
				const request = store.getAll();
				request.onsuccess = () => {
					const items = request.result as Array<{ uid: string; servers: ServerRailEntry[]; updatedAt?: number }> | undefined;
					if (items?.length) {
						// Use the most recently updated entry
						const sorted = items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
						const latest = sorted[0];
						if (latest?.servers?.length) {
							memoryServerRail = latest.servers;
							logEvent('preload:serverRail', 'loaded', latest.servers.length);
						}
					}
					resolve();
				};
				request.onerror = () => resolve();
			});
			
			// Load DM rail (get the most recent entry)
			await new Promise<void>((resolve) => {
				const tx = db.transaction(STORE_DM_RAIL, 'readonly');
				const store = tx.objectStore(STORE_DM_RAIL);
				const request = store.getAll();
				request.onsuccess = () => {
					const items = request.result as Array<{ uid: string; threads: DMRailEntry[]; updatedAt?: number }> | undefined;
					if (items?.length) {
						// Use the most recently updated entry
						const sorted = items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
						const latest = sorted[0];
						if (latest?.threads?.length) {
							memoryDmRail = latest.threads;
							logEvent('preload:dmRail', 'loaded', latest.threads.length);
						}
					}
					resolve();
				};
				request.onerror = () => resolve();
			});
			
			// Load all server views
			await new Promise<void>((resolve) => {
				const tx = db.transaction(STORE_SERVER_VIEW, 'readonly');
				const store = tx.objectStore(STORE_SERVER_VIEW);
				const request = store.getAll();
				request.onsuccess = () => {
					const items = request.result as ServerViewData[] | undefined;
					if (items?.length) {
						let loaded = 0;
						for (const item of items) {
							if (now - item.updatedAt <= SERVER_VIEW_TTL) {
								memoryServerViews.set(item.serverId, item);
								loaded++;
							}
						}
						logEvent('preload:serverViews', 'loaded', loaded);
					}
					resolve();
				};
				request.onerror = () => resolve();
			});
			
			// Load all thread views (most important for fast channel/DM switching)
			await new Promise<void>((resolve) => {
				const tx = db.transaction(STORE_THREAD_VIEW, 'readonly');
				const store = tx.objectStore(STORE_THREAD_VIEW);
				const request = store.getAll();
				request.onsuccess = () => {
					const items = request.result as ThreadViewData[] | undefined;
					if (items?.length) {
						let loaded = 0;
						let totalMsgs = 0;
						for (const item of items) {
							if (now - item.updatedAt <= THREAD_VIEW_TTL) {
								memoryThreadViews.set(item.threadKey, item);
								loaded++;
								totalMsgs += item.messages?.length ?? 0;
							}
						}
						logEvent('preload:threadViews', `loaded ${loaded} views, ${totalMsgs} msgs`);
					}
					resolve();
				};
				request.onerror = () => resolve();
			});
			
			logEvent('preload:complete', 'all caches loaded');
		} catch (err) {
			logEvent('preload:error', String(err));
		}
	})();
	
	return preloadPromise;
}

/**
 * Check if cache has been preloaded
 */
export function isCachePreloaded(): boolean {
	return preloadPromise !== null;
}

// Expose debug commands on window
if (browser && typeof window !== 'undefined') {
	(window as any).__cacheDb = {
		getStats: getCacheStats,
		getRecentEvents,
		getServerView: (id: string) => memoryServerViews.get(id) ?? null,
		getThreadView: (key: string) => memoryThreadViews.get(key) ?? null,
		clearAll: clearAllCaches,
		preload: preloadCacheFromDb
	};
}
