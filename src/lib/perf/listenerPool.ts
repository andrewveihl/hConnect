// src/lib/perf/listenerPool.ts
// Deduplicated Firestore listener management with stable keys
// Prevents listener fan-out and tracks active subscriptions

import { browser } from '$app/environment';
import type { Unsubscribe } from 'firebase/firestore';

/* ===========================
   Configuration
=========================== */
const MAX_POOL_SIZE = 50;
const MAX_EVENT_LOG = 200;
const STALE_LISTENER_MS = 30 * 60 * 1000; // 30 minutes without access

/* ===========================
   Types
=========================== */
export type ListenerEntry = {
	key: string;
	unsubscribe: Unsubscribe;
	refCount: number;
	createdAt: number;
	lastAccessedAt: number;
	callSite?: string;
};

export type ListenerEvent = {
	time: number;
	event: 'subscribe' | 'reuse' | 'unsubscribe' | 'evict' | 'cleanup';
	key: string;
	callSite?: string;
	refCount?: number;
};

/* ===========================
   Listener Pool
=========================== */
const pool = new Map<string, ListenerEntry>();
const eventLog: ListenerEvent[] = [];

function logEvent(
	event: ListenerEvent['event'],
	key: string,
	callSite?: string,
	refCount?: number
) {
	eventLog.push({
		time: Date.now(),
		event,
		key,
		callSite,
		refCount
	});
	if (eventLog.length > MAX_EVENT_LOG) {
		eventLog.shift();
	}
}

/**
 * Generate a stable key for a listener
 * Keys should be based on collection path and query parameters, not object references
 */
export function listenerKey(parts: (string | number | undefined | null)[]): string {
	return parts
		.filter((p) => p !== undefined && p !== null)
		.map((p) => String(p))
		.join(':');
}

/**
 * Get or create a listener subscription
 * If a listener with the same key exists, reuse it and increment refCount
 * Otherwise, create a new subscription using the factory function
 */
export function getOrCreateListener(
	key: string,
	factory: () => Unsubscribe,
	callSite?: string
): Unsubscribe {
	const existing = pool.get(key);

	if (existing) {
		existing.refCount++;
		existing.lastAccessedAt = Date.now();
		logEvent('reuse', key, callSite, existing.refCount);
		return createRefCountedUnsubscribe(key);
	}

	// Create new listener
	const unsubscribe = factory();
	const entry: ListenerEntry = {
		key,
		unsubscribe,
		refCount: 1,
		createdAt: Date.now(),
		lastAccessedAt: Date.now(),
		callSite
	};

	pool.set(key, entry);
	logEvent('subscribe', key, callSite, 1);

	// Evict stale listeners if over limit
	evictStaleListeners();

	return createRefCountedUnsubscribe(key);
}

/**
 * Create an unsubscribe function that decrements refCount
 * Only actually unsubscribes when refCount reaches 0
 */
function createRefCountedUnsubscribe(key: string): Unsubscribe {
	let unsubscribed = false;

	return () => {
		if (unsubscribed) return;
		unsubscribed = true;

		const entry = pool.get(key);
		if (!entry) return;

		entry.refCount--;
		entry.lastAccessedAt = Date.now();

		if (entry.refCount <= 0) {
			entry.unsubscribe();
			pool.delete(key);
			logEvent('unsubscribe', key, undefined, 0);
		}
	};
}

/**
 * Force unsubscribe a listener regardless of refCount
 * Use with caution - only for cleanup scenarios
 */
export function forceUnsubscribe(key: string): void {
	const entry = pool.get(key);
	if (!entry) return;

	entry.unsubscribe();
	pool.delete(key);
	logEvent('cleanup', key, undefined, 0);
}

/**
 * Force unsubscribe all listeners matching a prefix
 * Useful for cleaning up all listeners for a server or channel
 */
export function forceUnsubscribePrefix(prefix: string): void {
	const toRemove: string[] = [];

	for (const key of pool.keys()) {
		if (key.startsWith(prefix)) {
			toRemove.push(key);
		}
	}

	for (const key of toRemove) {
		forceUnsubscribe(key);
	}
}

/**
 * Check if a listener exists for a key
 */
export function hasListener(key: string): boolean {
	return pool.has(key);
}

/**
 * Get the current listener count
 */
export function getListenerCount(): number {
	return pool.size;
}

/**
 * Evict stale listeners that haven't been accessed recently
 */
function evictStaleListeners(): void {
	if (pool.size <= MAX_POOL_SIZE) return;

	const now = Date.now();
	const toEvict: string[] = [];

	// Find stale listeners (not accessed recently and refCount is 0 or 1)
	for (const [key, entry] of pool.entries()) {
		if (
			now - entry.lastAccessedAt > STALE_LISTENER_MS &&
			entry.refCount <= 1
		) {
			toEvict.push(key);
		}
	}

	// Sort by lastAccessedAt (oldest first) and evict until under limit
	toEvict.sort((a, b) => {
		const entryA = pool.get(a)!;
		const entryB = pool.get(b)!;
		return entryA.lastAccessedAt - entryB.lastAccessedAt;
	});

	const removeCount = Math.min(toEvict.length, pool.size - MAX_POOL_SIZE + 5);
	for (let i = 0; i < removeCount; i++) {
		const key = toEvict[i];
		const entry = pool.get(key);
		if (entry) {
			entry.unsubscribe();
			pool.delete(key);
			logEvent('evict', key, undefined, entry.refCount);
		}
	}
}

/**
 * Clean up all listeners
 * Call on logout or app unmount
 */
export function cleanupAllListeners(): void {
	for (const [key, entry] of pool.entries()) {
		entry.unsubscribe();
		logEvent('cleanup', key, undefined, entry.refCount);
	}
	pool.clear();
}

/* ===========================
   Active View Listener Management
=========================== */
type ActiveViewType = 'server' | 'channel' | 'dm';

const activeViewListeners = new Map<ActiveViewType, Set<string>>();

/**
 * Register a listener as belonging to a specific active view
 * When the view changes, these listeners can be cleaned up
 */
export function registerActiveViewListener(viewType: ActiveViewType, key: string): void {
	let set = activeViewListeners.get(viewType);
	if (!set) {
		set = new Set();
		activeViewListeners.set(viewType, set);
	}
	set.add(key);
}

/**
 * Clean up all listeners for a specific view type
 * Call when switching to a different server/channel/dm
 */
export function cleanupActiveViewListeners(viewType: ActiveViewType): void {
	const set = activeViewListeners.get(viewType);
	if (!set) return;

	for (const key of set) {
		const entry = pool.get(key);
		if (entry) {
			entry.refCount--;
			if (entry.refCount <= 0) {
				entry.unsubscribe();
				pool.delete(key);
				logEvent('unsubscribe', key, `cleanup:${viewType}`, 0);
			}
		}
	}
	set.clear();
}

/* ===========================
   Debug interface
=========================== */
export function getStats() {
	const entries: Array<{
		key: string;
		refCount: number;
		age: number;
		lastAccessed: number;
	}> = [];

	const now = Date.now();
	for (const [key, entry] of pool.entries()) {
		entries.push({
			key,
			refCount: entry.refCount,
			age: now - entry.createdAt,
			lastAccessed: now - entry.lastAccessedAt
		});
	}

	return {
		totalListeners: pool.size,
		totalRefCount: entries.reduce((sum, e) => sum + e.refCount, 0),
		entries: entries.sort((a, b) => b.lastAccessed - a.lastAccessed),
		limits: {
			maxPoolSize: MAX_POOL_SIZE,
			staleMs: STALE_LISTENER_MS
		}
	};
}

export function getRecentEvents(): ListenerEvent[] {
	return [...eventLog];
}

export function getActiveListenerKeys(): string[] {
	return Array.from(pool.keys());
}

// Expose debug commands on window
if (browser && typeof window !== 'undefined') {
	(window as any).__listenerPool = {
		getStats,
		getRecentEvents,
		getActiveListenerKeys,
		getListenerCount,
		forceUnsubscribe,
		forceUnsubscribePrefix,
		cleanupAll: cleanupAllListeners
	};
}
