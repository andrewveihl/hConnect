// src/lib/stores/preloadService.ts
// Background preloading service for faster navigation
// Prefetches messages, channels, and profiles for likely navigation targets

import { browser } from '$app/environment';
import { getDb } from '$lib/firebase';
import {
	collection,
	query,
	orderBy,
	limitToLast,
	getDocs,
	doc,
	getDoc,
	limit
} from 'firebase/firestore';
import {
	updateChannelCache,
	updateDMCache,
	updateServerChannelCache,
	hasChannelCache,
	hasDMCache,
	hasServerCache,
	type CachedMessage,
	type CachedChannel
} from './messageCache';
import { serverRailCache } from './serverRailCache';
import { dmRailCache } from './dmRailCache';

/* ===========================
   Configuration
=========================== */
const PRELOAD_MESSAGE_COUNT = 30; // Fewer messages for preload (faster)
const PRELOAD_DEBOUNCE_MS = 150; // Debounce rapid hover events
const PRELOAD_COOLDOWN_MS = 5000; // Don't re-preload same target within this time
const MAX_CONCURRENT_PRELOADS = 2; // Limit concurrent preload operations
const IDLE_PRELOAD_DELAY_MS = 2000; // Wait before preloading on idle

/* ===========================
   State
=========================== */
const preloadCooldowns = new Map<string, number>();
const preloadQueue: Array<() => Promise<void>> = [];
let activePreloads = 0;
let preloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let idlePreloadTimer: ReturnType<typeof setTimeout> | null = null;

/* ===========================
   Queue Management
=========================== */
async function processPreloadQueue() {
	while (preloadQueue.length > 0 && activePreloads < MAX_CONCURRENT_PRELOADS) {
		const task = preloadQueue.shift();
		if (task) {
			activePreloads++;
			try {
				await task();
			} catch (err) {
				// Silently ignore preload errors - they're non-critical
				if (typeof window !== 'undefined' && (window as unknown as { __DEBUG?: boolean }).__DEBUG) {
					console.debug('[preload] task failed:', err);
				}
			} finally {
				activePreloads--;
			}
		}
	}
}

function queuePreload(key: string, task: () => Promise<void>) {
	// Check cooldown
	const lastPreload = preloadCooldowns.get(key);
	if (lastPreload && Date.now() - lastPreload < PRELOAD_COOLDOWN_MS) {
		return;
	}

	// Mark cooldown
	preloadCooldowns.set(key, Date.now());

	// Add to queue and process
	preloadQueue.push(task);
	processPreloadQueue();
}

/* ===========================
   Channel Message Preloading
=========================== */

/**
 * Preload messages for a channel (call on hover or when likely to navigate)
 */
export function preloadChannelMessages(serverId: string, channelId: string): void {
	if (!browser || !serverId || !channelId) return;

	// Skip if already cached
	if (hasChannelCache(serverId, channelId)) return;

	const key = `channel:${serverId}:${channelId}`;
	queuePreload(key, async () => {
		try {
			const db = getDb();
			const q = query(
				collection(db, 'servers', serverId, 'channels', channelId, 'messages'),
				orderBy('createdAt', 'asc'),
				limitToLast(PRELOAD_MESSAGE_COUNT)
			);

			const snap = await getDocs(q);
			const messages: CachedMessage[] = snap.docs.map((d) => ({
				id: d.id,
				...d.data()
			})) as CachedMessage[];

			if (messages.length > 0) {
				updateChannelCache(serverId, channelId, messages, {
					hasOlderMessages: messages.length >= PRELOAD_MESSAGE_COUNT,
					earliestLoaded: messages[0]?.createdAt ?? null
				});
			}
		} catch {
			// Ignore errors silently
		}
	});
}

/**
 * Preload messages for a DM thread
 */
export function preloadDMMessages(threadId: string): void {
	if (!browser || !threadId) return;

	// Skip if already cached
	if (hasDMCache(threadId)) return;

	const key = `dm:${threadId}`;
	queuePreload(key, async () => {
		try {
			const db = getDb();
			const q = query(
				collection(db, 'dms', threadId, 'messages'),
				orderBy('createdAt', 'asc'),
				limitToLast(PRELOAD_MESSAGE_COUNT)
			);

			const snap = await getDocs(q);
			const messages: CachedMessage[] = snap.docs.map((d) => ({
				id: d.id,
				...d.data()
			})) as CachedMessage[];

			if (messages.length > 0) {
				updateDMCache(threadId, messages, {
					hasOlderMessages: messages.length >= PRELOAD_MESSAGE_COUNT
				});
			}
		} catch {
			// Ignore errors silently
		}
	});
}

/* ===========================
   Server Channel List Preloading
=========================== */

/**
 * Preload channel list for a server
 */
export function preloadServerChannels(serverId: string): void {
	if (!browser || !serverId) return;

	// Skip if already cached
	if (hasServerCache(serverId)) return;

	const key = `server:${serverId}`;
	queuePreload(key, async () => {
		try {
			const db = getDb();
			const snap = await getDocs(
				query(collection(db, 'servers', serverId, 'channels'), orderBy('position', 'asc'))
			);

			const channels: CachedChannel[] = snap.docs.map((d) => {
				const data = d.data();
				return {
					id: d.id,
					name: data.name ?? 'Channel',
					type: data.type ?? 'text',
					position: data.position ?? 0,
					isPrivate: data.isPrivate ?? false,
					allowedRoleIds: data.allowedRoleIds ?? []
				};
			});

			if (channels.length > 0) {
				updateServerChannelCache(serverId, channels);
			}
		} catch {
			// Ignore errors silently
		}
	});
}

/* ===========================
   Smart Preloading Triggers
=========================== */

/**
 * Call when user hovers over a server icon (debounced)
 */
export function onServerHover(serverId: string): void {
	if (!browser || !serverId) return;

	if (preloadDebounceTimer) {
		clearTimeout(preloadDebounceTimer);
	}

	preloadDebounceTimer = setTimeout(() => {
		preloadServerChannels(serverId);
	}, PRELOAD_DEBOUNCE_MS);
}

/**
 * Call when user hovers over a channel in the sidebar
 */
export function onChannelHover(serverId: string, channelId: string): void {
	if (!browser || !serverId || !channelId) return;

	if (preloadDebounceTimer) {
		clearTimeout(preloadDebounceTimer);
	}

	preloadDebounceTimer = setTimeout(() => {
		preloadChannelMessages(serverId, channelId);
	}, PRELOAD_DEBOUNCE_MS);
}

/**
 * Call when user hovers over a DM thread
 */
export function onDMHover(threadId: string): void {
	if (!browser || !threadId) return;

	if (preloadDebounceTimer) {
		clearTimeout(preloadDebounceTimer);
	}

	preloadDebounceTimer = setTimeout(() => {
		preloadDMMessages(threadId);
	}, PRELOAD_DEBOUNCE_MS);
}

/* ===========================
   Idle-time Preloading
=========================== */

/**
 * Preload adjacent servers/channels when user is idle
 * Call this when user stops interacting with the app
 */
export function scheduleIdlePreload(
	currentServerId: string | null,
	currentChannelId: string | null,
	uid: string | null
): void {
	if (!browser) return;

	// Clear any existing timer
	if (idlePreloadTimer) {
		clearTimeout(idlePreloadTimer);
	}

	idlePreloadTimer = setTimeout(() => {
		performIdlePreload(currentServerId, currentChannelId, uid);
	}, IDLE_PRELOAD_DELAY_MS);
}

/**
 * Cancel idle preloading (call when user starts interacting)
 */
export function cancelIdlePreload(): void {
	if (idlePreloadTimer) {
		clearTimeout(idlePreloadTimer);
		idlePreloadTimer = null;
	}
}

async function performIdlePreload(
	currentServerId: string | null,
	currentChannelId: string | null,
	uid: string | null
): Promise<void> {
	if (!browser) return;

	// Get user's servers from cache
	const cachedServers = uid ? serverRailCache.get(uid) ?? [] : [];

	// Preload the next 2-3 servers in the rail
	const currentIndex = currentServerId
		? cachedServers.findIndex((s) => s.id === currentServerId)
		: -1;

	const serversToPreload: string[] = [];

	// Add adjacent servers
	if (currentIndex >= 0) {
		if (currentIndex > 0) serversToPreload.push(cachedServers[currentIndex - 1].id);
		if (currentIndex < cachedServers.length - 1)
			serversToPreload.push(cachedServers[currentIndex + 1].id);
	} else if (cachedServers.length > 0) {
		// Preload first 2 servers if not on any server
		serversToPreload.push(...cachedServers.slice(0, 2).map((s) => s.id));
	}

	// Preload server channels
	for (const serverId of serversToPreload) {
		preloadServerChannels(serverId);
	}

	// Preload recent DM threads
	const dmEntries = uid ? dmRailCache.get(uid) ?? [] : [];
	const dmsToPreload = dmEntries.slice(0, 3).map((d) => d.id);

	for (const threadId of dmsToPreload) {
		preloadDMMessages(threadId);
	}
}

/* ===========================
   Navigation Preloading
=========================== */

/**
 * Call when entering a server to preload its first channel
 */
export async function preloadServerDefault(serverId: string): Promise<void> {
	if (!browser || !serverId) return;

	// First preload the channel list
	preloadServerChannels(serverId);

	// Then try to preload the default/first channel messages
	try {
		const db = getDb();
		const serverDoc = await getDoc(doc(db, 'servers', serverId));
		const serverData = serverDoc.data();
		const defaultChannelId = serverData?.systemChannelId;

		if (defaultChannelId) {
			preloadChannelMessages(serverId, defaultChannelId);
		} else {
			// Fallback: preload first text channel
			const channelsSnap = await getDocs(
				query(
					collection(db, 'servers', serverId, 'channels'),
					orderBy('position', 'asc'),
					limit(1)
				)
			);
			const firstChannel = channelsSnap.docs[0];
			if (firstChannel) {
				preloadChannelMessages(serverId, firstChannel.id);
			}
		}
	} catch {
		// Ignore errors
	}
}

/* ===========================
   Cleanup
=========================== */

/**
 * Clear all preload state (call on logout)
 */
export function clearPreloadState(): void {
	preloadCooldowns.clear();
	preloadQueue.length = 0;
	activePreloads = 0;

	if (preloadDebounceTimer) {
		clearTimeout(preloadDebounceTimer);
		preloadDebounceTimer = null;
	}

	if (idlePreloadTimer) {
		clearTimeout(idlePreloadTimer);
		idlePreloadTimer = null;
	}
}

/* ===========================
   Debug Utilities
=========================== */

export function getPreloadStats(): {
	queueLength: number;
	activePreloads: number;
	cooldownCount: number;
} {
	return {
		queueLength: preloadQueue.length,
		activePreloads,
		cooldownCount: preloadCooldowns.size
	};
}
