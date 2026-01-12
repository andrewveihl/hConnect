// src/lib/stores/subscriptionManager.ts
// Centralized subscription manager to prevent listener explosion
// Implements connection pooling, deferred subscriptions, and automatic cleanup

import { browser } from '$app/environment';
import { getDb } from '$lib/firebase';
import {
	collection,
	doc,
	onSnapshot,
	query,
	orderBy,
	limitToLast,
	where,
	getDocs,
	getDoc,
	getDocFromCache,
	type Unsubscribe,
	type DocumentSnapshot,
	type QuerySnapshot
} from 'firebase/firestore';

/* ===========================
   Configuration
=========================== */
const MAX_ACTIVE_SUBSCRIPTIONS = 15; // Maximum concurrent Firestore listeners
const SUBSCRIPTION_IDLE_TIMEOUT = 60000; // 1 minute before cleaning up idle subscriptions
const PROFILE_BATCH_DELAY = 50; // ms to wait before batching profile fetches
const PROFILE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes profile cache TTL
const MESSAGE_SUBSCRIPTION_PRIORITY = 10;
const PROFILE_SUBSCRIPTION_PRIORITY = 5;
const UNREAD_SUBSCRIPTION_PRIORITY = 3;

/* ===========================
   Types
=========================== */
type SubscriptionType = 'messages' | 'profile' | 'unread' | 'metadata' | 'presence';

interface ManagedSubscription {
	id: string;
	type: SubscriptionType;
	priority: number;
	unsub: Unsubscribe;
	lastAccessed: number;
	isActive: boolean;
}

interface ProfileCacheEntry {
	data: any;
	fetchedAt: number;
}

interface PendingProfileFetch {
	uid: string;
	callbacks: Array<(data: any) => void>;
}

/* ===========================
   State
=========================== */
const activeSubscriptions = new Map<string, ManagedSubscription>();
const profileCache = new Map<string, ProfileCacheEntry>();
const pendingProfileFetches = new Map<string, PendingProfileFetch>();
let profileBatchTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/* ===========================
   Initialization
=========================== */
export function initSubscriptionManager(): void {
	if (!browser) return;
	
	// Start periodic cleanup of idle subscriptions
	if (!cleanupTimer) {
		cleanupTimer = setInterval(cleanupIdleSubscriptions, 30000);
	}
}

export function destroySubscriptionManager(): void {
	// Clean up all subscriptions
	for (const [, sub] of activeSubscriptions) {
		try {
			sub.unsub();
		} catch {}
	}
	activeSubscriptions.clear();
	profileCache.clear();
	pendingProfileFetches.clear();
	
	if (profileBatchTimer) {
		clearTimeout(profileBatchTimer);
		profileBatchTimer = null;
	}
	
	if (cleanupTimer) {
		clearInterval(cleanupTimer);
		cleanupTimer = null;
	}
}

/* ===========================
   Subscription Management
=========================== */

function getSubscriptionKey(type: SubscriptionType, ...ids: string[]): string {
	return `${type}:${ids.join(':')}`;
}

function canAddSubscription(): boolean {
	return activeSubscriptions.size < MAX_ACTIVE_SUBSCRIPTIONS;
}

function evictLowestPrioritySubscription(): void {
	let lowestPriority = Infinity;
	let lowestKey: string | null = null;
	let oldestAccess = Infinity;
	
	for (const [key, sub] of activeSubscriptions) {
		// Find the lowest priority subscription that was accessed longest ago
		if (sub.priority < lowestPriority || 
			(sub.priority === lowestPriority && sub.lastAccessed < oldestAccess)) {
			lowestPriority = sub.priority;
			oldestAccess = sub.lastAccessed;
			lowestKey = key;
		}
	}
	
	if (lowestKey) {
		const sub = activeSubscriptions.get(lowestKey);
		if (sub) {
			try {
				sub.unsub();
			} catch {}
			activeSubscriptions.delete(lowestKey);
		}
	}
}

function registerSubscription(
	key: string,
	type: SubscriptionType,
	priority: number,
	unsub: Unsubscribe
): void {
	// Evict if at capacity
	if (!canAddSubscription()) {
		evictLowestPrioritySubscription();
	}
	
	activeSubscriptions.set(key, {
		id: key,
		type,
		priority,
		unsub,
		lastAccessed: Date.now(),
		isActive: true
	});
}

function touchSubscription(key: string): void {
	const sub = activeSubscriptions.get(key);
	if (sub) {
		sub.lastAccessed = Date.now();
	}
}

function cleanupIdleSubscriptions(): void {
	const now = Date.now();
	const toRemove: string[] = [];
	
	for (const [key, sub] of activeSubscriptions) {
		// Don't clean up high-priority subscriptions
		if (sub.priority >= MESSAGE_SUBSCRIPTION_PRIORITY) continue;
		
		if (now - sub.lastAccessed > SUBSCRIPTION_IDLE_TIMEOUT) {
			toRemove.push(key);
		}
	}
	
	for (const key of toRemove) {
		const sub = activeSubscriptions.get(key);
		if (sub) {
			try {
				sub.unsub();
			} catch {}
			activeSubscriptions.delete(key);
		}
	}
}

export function unsubscribe(key: string): void {
	const sub = activeSubscriptions.get(key);
	if (sub) {
		try {
			sub.unsub();
		} catch {}
		activeSubscriptions.delete(key);
	}
}

export function unsubscribeByType(type: SubscriptionType): void {
	const toRemove: string[] = [];
	
	for (const [key, sub] of activeSubscriptions) {
		if (sub.type === type) {
			toRemove.push(key);
		}
	}
	
	for (const key of toRemove) {
		unsubscribe(key);
	}
}

export function unsubscribeByPrefix(prefix: string): void {
	const toRemove: string[] = [];
	
	for (const [key] of activeSubscriptions) {
		if (key.startsWith(prefix)) {
			toRemove.push(key);
		}
	}
	
	for (const key of toRemove) {
		unsubscribe(key);
	}
}

/* ===========================
   Profile Batching & Caching
=========================== */

function isProfileCacheValid(entry: ProfileCacheEntry): boolean {
	return Date.now() - entry.fetchedAt < PROFILE_CACHE_TTL;
}

/**
 * Get a profile from cache if available and valid
 */
export function getCachedProfile(uid: string): any | null {
	const entry = profileCache.get(uid);
	if (entry && isProfileCacheValid(entry)) {
		return entry.data;
	}
	return null;
}

/**
 * Update profile cache directly
 */
export function setCachedProfile(uid: string, data: any): void {
	profileCache.set(uid, {
		data,
		fetchedAt: Date.now()
	});
}

/**
 * Batch fetch multiple profiles at once
 * Much more efficient than individual subscriptions
 */
export async function batchFetchProfiles(uids: string[]): Promise<Map<string, any>> {
	if (!browser || !uids.length) return new Map();
	
	const results = new Map<string, any>();
	const toFetch: string[] = [];
	
	// Check cache first
	for (const uid of uids) {
		const cached = getCachedProfile(uid);
		if (cached) {
			results.set(uid, cached);
		} else {
			toFetch.push(uid);
		}
	}
	
	if (toFetch.length === 0) return results;
	
	// Fetch remaining profiles in parallel
	const db = getDb();
	const fetchPromises = toFetch.map(async (uid) => {
		try {
			const profileRef = doc(db, 'profiles', uid);
			// Try cache first
			let snap: DocumentSnapshot;
			try {
				snap = await getDocFromCache(profileRef);
			} catch {
				snap = await getDoc(profileRef);
			}
			
			const data = snap.exists() ? snap.data() : null;
			if (data) {
				setCachedProfile(uid, data);
				return { uid, data };
			}
			return { uid, data: null };
		} catch {
			return { uid, data: null };
		}
	});
	
	const fetched = await Promise.all(fetchPromises);
	for (const { uid, data } of fetched) {
		if (data) {
			results.set(uid, data);
		}
	}
	
	return results;
}

/**
 * Request a profile fetch - automatically batched for efficiency
 */
export function requestProfileFetch(uid: string, callback: (data: any) => void): void {
	if (!browser || !uid) return;
	
	// Check cache first
	const cached = getCachedProfile(uid);
	if (cached) {
		callback(cached);
		return;
	}
	
	// Add to pending batch
	const existing = pendingProfileFetches.get(uid);
	if (existing) {
		existing.callbacks.push(callback);
	} else {
		pendingProfileFetches.set(uid, {
			uid,
			callbacks: [callback]
		});
	}
	
	// Schedule batch fetch
	if (!profileBatchTimer) {
		profileBatchTimer = setTimeout(executePendingProfileFetches, PROFILE_BATCH_DELAY);
	}
}

async function executePendingProfileFetches(): Promise<void> {
	profileBatchTimer = null;
	
	const pending = new Map(pendingProfileFetches);
	pendingProfileFetches.clear();
	
	if (pending.size === 0) return;
	
	const uids = Array.from(pending.keys());
	const profiles = await batchFetchProfiles(uids);
	
	// Call all callbacks
	for (const [uid, entry] of pending) {
		const data = profiles.get(uid) || null;
		for (const callback of entry.callbacks) {
			try {
				callback(data);
			} catch {}
		}
	}
}

/**
 * Subscribe to a single profile with caching
 * Only creates a listener if absolutely necessary
 */
export function subscribeProfile(
	uid: string,
	callback: (data: any) => void,
	options?: { forceRealtime?: boolean }
): Unsubscribe {
	if (!browser || !uid) return () => {};
	
	const key = getSubscriptionKey('profile', uid);
	
	// If not forcing realtime, just fetch once and cache
	if (!options?.forceRealtime) {
		requestProfileFetch(uid, callback);
		return () => {};
	}
	
	// Check if we already have a subscription
	if (activeSubscriptions.has(key)) {
		touchSubscription(key);
		// Still fetch from cache to provide immediate data
		const cached = getCachedProfile(uid);
		if (cached) {
			callback(cached);
		}
		return () => unsubscribe(key);
	}
	
	const db = getDb();
	const unsub = onSnapshot(
		doc(db, 'profiles', uid),
		(snap) => {
			const data = snap.exists() ? snap.data() : null;
			if (data) {
				setCachedProfile(uid, data);
			}
			callback(data);
		},
		() => {
			unsubscribe(key);
		}
	);
	
	registerSubscription(key, 'profile', PROFILE_SUBSCRIPTION_PRIORITY, unsub);
	
	return () => unsubscribe(key);
}

/* ===========================
   Message Subscriptions
=========================== */

interface MessageSubscriptionOptions {
	pageSize?: number;
	onMessages: (messages: any[], firstDoc?: any) => void;
	onError?: (error: any) => void;
}

/**
 * Subscribe to channel messages with optimized patterns
 */
export function subscribeChannelMessages(
	serverId: string,
	channelId: string,
	options: MessageSubscriptionOptions
): Unsubscribe {
	if (!browser || !serverId || !channelId) return () => {};
	
	const key = getSubscriptionKey('messages', 'channel', serverId, channelId);
	const pageSize = options.pageSize ?? 50;
	
	// Unsubscribe from previous if exists
	unsubscribe(key);
	
	const db = getDb();
	const q = query(
		collection(db, 'servers', serverId, 'channels', channelId, 'messages'),
		orderBy('createdAt', 'asc'),
		limitToLast(pageSize)
	);
	
	const unsub = onSnapshot(
		q,
		(snap: QuerySnapshot) => {
			const messages: any[] = [];
			snap.docs.forEach((docSnap) => {
				messages.push({
					id: docSnap.id,
					...docSnap.data()
				});
			});
			options.onMessages(messages, snap.docs[0] || null);
		},
		(error) => {
			options.onError?.(error);
			unsubscribe(key);
		}
	);
	
	registerSubscription(key, 'messages', MESSAGE_SUBSCRIPTION_PRIORITY, unsub);
	
	return () => unsubscribe(key);
}

/**
 * Subscribe to DM messages with optimized patterns
 */
export function subscribeDMMessages(
	threadId: string,
	options: MessageSubscriptionOptions
): Unsubscribe {
	if (!browser || !threadId) return () => {};
	
	const key = getSubscriptionKey('messages', 'dm', threadId);
	const pageSize = options.pageSize ?? 50;
	
	// Unsubscribe from previous if exists
	unsubscribe(key);
	
	const db = getDb();
	const q = query(
		collection(db, 'dms', threadId, 'messages'),
		orderBy('createdAt', 'asc'),
		limitToLast(pageSize)
	);
	
	const unsub = onSnapshot(
		q,
		(snap: QuerySnapshot) => {
			const messages: any[] = [];
			snap.docs.forEach((docSnap) => {
				messages.push({
					id: docSnap.id,
					...docSnap.data()
				});
			});
			options.onMessages(messages, snap.docs[0] || null);
		},
		(error) => {
			options.onError?.(error);
			unsubscribe(key);
		}
	);
	
	registerSubscription(key, 'messages', MESSAGE_SUBSCRIPTION_PRIORITY, unsub);
	
	return () => unsubscribe(key);
}

/* ===========================
   Optimized Unread Counting
=========================== */

interface UnreadState {
	threadId: string;
	count: number;
	lastChecked: number;
}

const dmUnreadCache = new Map<string, UnreadState>();
let dmUnreadBatchTimer: ReturnType<typeof setTimeout> | null = null;
const pendingUnreadChecks = new Set<string>();

/**
 * Get cached unread count for a DM thread
 */
export function getCachedDMUnread(threadId: string): number {
	const state = dmUnreadCache.get(threadId);
	return state?.count ?? 0;
}

/**
 * Request unread count check - batched for efficiency
 * Instead of creating a listener per DM, we batch check on demand
 */
export function requestDMUnreadCheck(
	threadId: string,
	uid: string,
	callback: (count: number) => void
): void {
	if (!browser || !threadId || !uid) {
		callback(0);
		return;
	}
	
	// Return cached value immediately if recent
	const cached = dmUnreadCache.get(threadId);
	if (cached && Date.now() - cached.lastChecked < 30000) {
		callback(cached.count);
		return;
	}
	
	// Queue for batch check
	pendingUnreadChecks.add(threadId);
	
	// Schedule batch
	if (!dmUnreadBatchTimer) {
		dmUnreadBatchTimer = setTimeout(() => {
			executeBatchUnreadCheck(uid, callback);
		}, 100);
	}
}

async function executeBatchUnreadCheck(
	uid: string,
	callback: (count: number) => void
): Promise<void> {
	dmUnreadBatchTimer = null;
	
	const threadIds = Array.from(pendingUnreadChecks);
	pendingUnreadChecks.clear();
	
	if (threadIds.length === 0) return;
	
	const db = getDb();
	
	// Fetch unread counts in parallel
	await Promise.all(threadIds.map(async (threadId) => {
		try {
			// Get last read timestamp
			const readDocRef = doc(db, 'dms', threadId, 'reads', uid);
			let lastReadAt: any = null;
			
			try {
				const readSnap = await getDocFromCache(readDocRef);
				lastReadAt = readSnap.exists() ? readSnap.data()?.lastReadAt : null;
			} catch {
				const readSnap = await getDoc(readDocRef);
				lastReadAt = readSnap.exists() ? readSnap.data()?.lastReadAt : null;
			}
			
			// Count messages after lastReadAt
			let count = 0;
			if (lastReadAt) {
				const q = query(
					collection(db, 'dms', threadId, 'messages'),
					where('createdAt', '>', lastReadAt),
					where('uid', '!=', uid)
				);
				const snap = await getDocs(q);
				count = snap.size;
			}
			
			dmUnreadCache.set(threadId, {
				threadId,
				count,
				lastChecked: Date.now()
			});
			
			callback(count);
		} catch {
			// Ignore errors, keep cached value
		}
	}));
}

/**
 * Update unread cache when marking as read
 */
export function markDMUnreadCacheRead(threadId: string): void {
	dmUnreadCache.set(threadId, {
		threadId,
		count: 0,
		lastChecked: Date.now()
	});
}

/**
 * Increment unread cache when receiving a new message
 */
export function incrementDMUnreadCache(threadId: string): void {
	const current = dmUnreadCache.get(threadId);
	dmUnreadCache.set(threadId, {
		threadId,
		count: (current?.count ?? 0) + 1,
		lastChecked: Date.now()
	});
}

/* ===========================
   Debug & Stats
=========================== */

export function getSubscriptionStats(): {
	active: number;
	byType: Record<SubscriptionType, number>;
	profileCacheSize: number;
} {
	const byType: Record<SubscriptionType, number> = {
		messages: 0,
		profile: 0,
		unread: 0,
		metadata: 0,
		presence: 0
	};
	
	for (const [, sub] of activeSubscriptions) {
		byType[sub.type]++;
	}
	
	return {
		active: activeSubscriptions.size,
		byType,
		profileCacheSize: profileCache.size
	};
}
