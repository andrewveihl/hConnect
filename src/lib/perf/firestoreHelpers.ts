// src/lib/perf/firestoreHelpers.ts
// Integration helpers for Firestore with performance infrastructure
// Provides optimized subscription patterns with caching and deduplication

import { browser } from '$app/environment';
import { onSnapshot, collection, query, orderBy, doc, type Unsubscribe, limitToLast, type Query, type DocumentData } from 'firebase/firestore';
import { getDb } from '$lib/firebase';
import {
	getOrCreateListener,
	listenerKey,
	forceUnsubscribePrefix,
	registerActiveViewListener,
	cleanupActiveViewListeners
} from './listenerPool';
import {
	getServerRail,
	setServerRail,
	setServerRailMemory,
	getDmRail,
	setDmRail,
	setDmRailMemory,
	getServerView,
	setServerView,
	setServerViewMemory,
	getThreadView,
	getThreadViewMemory,
	setThreadView,
	threadKey,
	dmThreadKey,
	type ServerRailEntry,
	type DMRailEntry,
	type ServerViewData,
	type ThreadViewData,
	type ThreadViewMessage
} from './cacheDb';
import {
	timeServerSwitch,
	timeChannelSwitch,
	timeDmSwitch,
	recordMetric
} from './metrics';

/* ===========================
   Server Rail Subscription
=========================== */
type ServerRailCallback = (servers: ServerRailEntry[]) => void;

/**
 * Subscribe to user's server rail with cache-first pattern
 * - Immediately returns cached data if available  
 * - Sets up listeners for each server document to get icons
 * - Updates cache on changes
 * 
 * Note: This needs to mirror the complexity of subscribeUserServers because
 * server icons are stored on `servers/{id}` not on `profiles/{uid}/servers/{id}`
 */
export async function subscribeServerRailOptimized(
	uid: string,
	callback: ServerRailCallback
): Promise<Unsubscribe> {
	// 1. Load from cache first (instant paint)
	const cached = await getServerRail(uid);
	if (cached.length > 0) {
		callback(cached);
	}

	// 2. Set up listener - we need per-server listeners for icons
	// Track current state and individual server unsubs
	const current: Record<string, ServerRailEntry> = {};
	const serverUnsubs: Record<string, () => void> = {};
	const db = getDb();

	const emit = () => {
		const values = Object.values(current).sort((a, b) => {
			if (a.position != null && b.position != null && a.position !== b.position) {
				return a.position - b.position;
			}
			if (a.position != null && b.position == null) return -1;
			if (b.position != null && a.position == null) return 1;
			return (b.joinedAt ?? 0) - (a.joinedAt ?? 0);
		});
		
		// Update cache and callback
		setServerRailMemory(values);
		setServerRail(uid, values);
		callback(values);
	};

	const q = query(
		collection(db, 'profiles', uid, 'servers'),
		orderBy('joinedAt', 'desc')
	);

	const mainUnsub = onSnapshot(
		q,
		(snap) => {
			const seen: Record<string, true> = {};
			
			for (const docSnap of snap.docs) {
				const id = docSnap.id;
				seen[id] = true;
				const data = docSnap.data();
				const existing = current[id];
				
				current[id] = {
					...existing,
					id,
					name: existing?.name ?? data.name ?? id,
					icon: existing?.icon ?? data.icon ?? null,
					position: typeof data.position === 'number' ? data.position : null,
					joinedAt: toMillis(data.joinedAt)
				};

				// Subscribe to server doc for icon/name updates
				if (!serverUnsubs[id]) {
					const serverRef = doc(db, 'servers', id);
					serverUnsubs[id] = onSnapshot(
						serverRef,
						(sv) => {
							if (!sv.exists()) {
								delete current[id];
								serverUnsubs[id]?.();
								delete serverUnsubs[id];
								emit();
								return;
							}
							const payload = sv.data();
							const existing = current[id];
							if (existing) {
								current[id] = {
									...existing,
									name: payload?.name ?? existing.name,
									icon: payload?.icon ?? existing.icon ?? null
								};
								emit();
							}
						},
						() => {
							// Error - ignore
						}
					);
				}
			}

			// Cleanup removed servers
			for (const id in current) {
				if (!seen[id]) {
					serverUnsubs[id]?.();
					delete serverUnsubs[id];
					delete current[id];
				}
			}

			emit();
		},
		(error) => {
			console.error('[serverRail] Subscription error:', error);
		}
	);

	return () => {
		mainUnsub();
		for (const k in serverUnsubs) {
			serverUnsubs[k]();
		}
	};
}

/* ===========================
   DM Rail Subscription
=========================== */
type DMRailCallback = (threads: DMRailEntry[]) => void;

/**
 * Subscribe to user's DM rail with cache-first pattern
 */
export async function subscribeDmRailOptimized(
	uid: string,
	callback: DMRailCallback
): Promise<Unsubscribe> {
	// 1. Load from cache first
	const cached = await getDmRail(uid);
	if (cached.length > 0) {
		callback(cached);
	}

	// 2. Set up deduplicated listener
	const key = listenerKey(['dmRail', uid]);

	return getOrCreateListener(
		key,
		() => {
			const db = getDb();
			const q = query(
				collection(db, 'profiles', uid, 'dms'),
				orderBy('updatedAt', 'desc')
			);

			return onSnapshot(
				q,
				(snap) => {
					const threads: DMRailEntry[] = snap.docs.map((docSnap) => {
						const data = docSnap.data();
						return {
							id: docSnap.id,
							participants: data.participants ?? [],
							otherUid: data.otherUid ?? null,
							lastMessage: data.lastMessage ?? null,
							updatedAt: toMillis(data.updatedAt),
							hidden: data.hidden ?? false,
							isGroup: data.isGroup ?? false,
							groupName: data.groupName ?? null
						};
					});

					// Update cache and callback
					setDmRailMemory(threads);
					setDmRail(uid, threads);
					callback(threads);
				},
				(error) => {
					console.error('[dmRail] Subscription error:', error);
				}
			);
		},
		'subscribeDmRailOptimized'
	);
}

/* ===========================
   Server View (Channels) Subscription
=========================== */
type ChannelCallback = (data: ServerViewData) => void;

/**
 * Subscribe to server channels with cache-first pattern
 * Returns cached data immediately, then starts live listener
 */
export function subscribeServerViewOptimized(
	serverId: string,
	callback: ChannelCallback,
	options?: { lastChannelId?: string }
): { cached: ServerViewData | null; unsubscribe: () => void } {
	const endTimer = timeServerSwitch(serverId);
	let timerEnded = false;

	// 1. Load from cache synchronously if available
	const memCached = getServerView(serverId);
	let cachedData: ServerViewData | null = null;

	if (memCached instanceof Promise) {
		// Async cache load - start it but don't wait
		memCached.then((data) => {
			if (data && !timerEnded) {
				cachedData = data;
				callback(data);
				endTimer();
				timerEnded = true;
			}
		});
	} else if (memCached) {
		cachedData = memCached;
		callback(memCached);
		endTimer();
		timerEnded = true;
	}

	// 2. Set up deduplicated listener
	const key = listenerKey(['serverView', serverId]);
	registerActiveViewListener('server', key);

	const unsubscribe = getOrCreateListener(
		key,
		() => {
			const db = getDb();
			const q = query(
				collection(db, 'servers', serverId, 'channels'),
				orderBy('position')
			);

			return onSnapshot(
				q,
				(snap) => {
					const channels = snap.docs.map((docSnap) => {
						const data = docSnap.data();
						return {
							id: docSnap.id,
							name: data.name ?? docSnap.id,
							type: (data.type ?? 'text') as 'text' | 'voice',
							position: data.position ?? 0,
							isPrivate: data.isPrivate ?? false,
							categoryId: data.categoryId ?? null
						};
					});

					const viewData: ServerViewData = {
						serverId,
						channels,
						lastChannelId: options?.lastChannelId ?? cachedData?.lastChannelId,
						updatedAt: Date.now()
					};

					// Update cache
					setServerViewMemory(viewData);
					setServerView(viewData);
					callback(viewData);

					if (!timerEnded) {
						endTimer();
						timerEnded = true;
					}
				},
				(error) => {
					console.error('[serverView] Subscription error:', error);
				}
			);
		},
		'subscribeServerViewOptimized'
	);

	return { cached: cachedData, unsubscribe };
}

/* ===========================
   Channel Messages Subscription
=========================== */
type MessageCallback = (messages: ThreadViewMessage[], fromCache: boolean) => void;

/**
 * Subscribe to channel messages with cache-first pattern
 * Returns cached messages immediately, then starts live tail listener
 */
export function subscribeChannelMessagesOptimized(
	serverId: string,
	channelId: string,
	callback: MessageCallback,
	pageSize = 50
): { cached: ThreadViewMessage[] | null; unsubscribe: () => void } {
	const endTimer = timeChannelSwitch(channelId);
	let timerEnded = false;
	const key = threadKey(serverId, channelId);

	// 1. Load from memory cache synchronously first
	const memCached = getThreadViewMemory(key);
	let cachedMessages: ThreadViewMessage[] | null = null;

	if (memCached?.messages?.length) {
		cachedMessages = memCached.messages;
		callback(memCached.messages, true);
		endTimer();
		timerEnded = true;
	} else {
		// Try async IndexedDB lookup
		getThreadView(key).then((data) => {
			if (data?.messages?.length && !timerEnded) {
				cachedMessages = data.messages;
				callback(data.messages, true);
				endTimer();
				timerEnded = true;
			}
		});
	}

	// 2. Set up deduplicated listener for this channel only
	const listenerKeyStr = listenerKey(['channelMessages', serverId, channelId]);
	registerActiveViewListener('channel', listenerKeyStr);

	const unsubscribe = getOrCreateListener(
		listenerKeyStr,
		() => {
			const db = getDb();
			const q = query(
				collection(db, 'servers', serverId, 'channels', channelId, 'messages'),
				orderBy('createdAt', 'asc'),
				limitToLast(pageSize)
			);

			return onSnapshot(
				q,
				(snap) => {
					const messages: ThreadViewMessage[] = snap.docs.map((docSnap) => {
						const data = docSnap.data();
						return {
							id: docSnap.id,
							uid: data.uid ?? 'unknown',
							text: data.text ?? data.content,
							content: data.content ?? data.text,
							type: data.type ?? 'text',
							createdAt: toMillis(data.createdAt) ?? Date.now(),
							displayName: data.displayName ?? data.author?.displayName,
							photoURL: data.photoURL ?? data.author?.photoURL,
							reactions: data.reactions ?? {},
							replyTo: data.replyTo,
							attachments: data.attachments ?? data.file ? [data.file] : [],
							poll: data.poll,
							form: data.form
						};
					});

					// Update cache
					const viewData: ThreadViewData = {
						threadKey: key,
						messages,
						earliestLoaded: messages[0]?.createdAt,
						hasOlderMessages: messages.length >= pageSize,
						updatedAt: Date.now()
					};
					setThreadView(viewData);

					callback(messages, false);

					if (!timerEnded) {
						endTimer();
						timerEnded = true;
					}
				},
				(error) => {
					console.error('[channelMessages] Subscription error:', error);
				}
			);
		},
		'subscribeChannelMessagesOptimized'
	);

	return { cached: cachedMessages, unsubscribe };
}

/* ===========================
   DM Messages Subscription
=========================== */
/**
 * Subscribe to DM thread messages with cache-first pattern
 */
export function subscribeDmMessagesOptimized(
	threadId: string,
	callback: MessageCallback,
	pageSize = 50
): { cached: ThreadViewMessage[] | null; unsubscribe: () => void } {
	const endTimer = timeDmSwitch(threadId);
	let timerEnded = false;
	const key = dmThreadKey(threadId);

	// 1. Load from memory cache synchronously first
	const memCached = getThreadViewMemory(key);
	let cachedMessages: ThreadViewMessage[] | null = null;

	if (memCached?.messages?.length) {
		cachedMessages = memCached.messages;
		callback(memCached.messages, true);
		endTimer();
		timerEnded = true;
	} else {
		// Try async IndexedDB lookup
		getThreadView(key).then((data) => {
			if (data?.messages?.length && !timerEnded) {
				cachedMessages = data.messages;
				callback(data.messages, true);
				endTimer();
				timerEnded = true;
			}
		});
	}

	// 2. Set up deduplicated listener
	const listenerKeyStr = listenerKey(['dmMessages', threadId]);
	registerActiveViewListener('dm', listenerKeyStr);

	const unsubscribe = getOrCreateListener(
		listenerKeyStr,
		() => {
			const db = getDb();
			const q = query(
				collection(db, 'dms', threadId, 'messages'),
				orderBy('createdAt', 'asc'),
				limitToLast(pageSize)
			);

			return onSnapshot(
				q,
				(snap) => {
					const messages: ThreadViewMessage[] = snap.docs.map((docSnap) => {
						const data = docSnap.data();
						return {
							id: docSnap.id,
							uid: data.uid ?? 'unknown',
							text: data.text ?? data.content,
							content: data.content ?? data.text,
							type: data.type ?? 'text',
							createdAt: toMillis(data.createdAt) ?? Date.now(),
							displayName: data.displayName ?? data.author?.displayName,
							photoURL: data.photoURL ?? data.author?.photoURL,
							reactions: data.reactions ?? {},
							replyTo: data.replyTo,
							attachments: data.attachments ?? data.file ? [data.file] : []
						};
					});

					// Update cache
					const viewData: ThreadViewData = {
						threadKey: key,
						messages,
						earliestLoaded: messages[0]?.createdAt,
						hasOlderMessages: messages.length >= pageSize,
						updatedAt: Date.now()
					};
					setThreadView(viewData);

					callback(messages, false);

					if (!timerEnded) {
						endTimer();
						timerEnded = true;
					}
				},
				(error) => {
					console.error('[dmMessages] Subscription error:', error);
				}
			);
		},
		'subscribeDmMessagesOptimized'
	);

	return { cached: cachedMessages, unsubscribe };
}

/* ===========================
   Active View Cleanup
=========================== */
/**
 * Clean up listeners when switching servers
 * Call before switching to a new server
 */
export function cleanupServerListeners(): void {
	cleanupActiveViewListeners('server');
	cleanupActiveViewListeners('channel');
}

/**
 * Clean up listeners when switching channels
 * Call before switching to a new channel
 */
export function cleanupChannelListeners(): void {
	cleanupActiveViewListeners('channel');
}

/**
 * Clean up listeners when switching DM threads
 * Call before switching to a new DM
 */
export function cleanupDmListeners(): void {
	cleanupActiveViewListeners('dm');
}

/* ===========================
   Utilities
=========================== */
function toMillis(value: unknown): number | null {
	if (!value) return null;
	if (typeof value === 'number') return value;
	if (typeof value === 'string') {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	if (typeof (value as any)?.toMillis === 'function') {
		return (value as any).toMillis();
	}
	if (value instanceof Date) return value.getTime();
	return null;
}
