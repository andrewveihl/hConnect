// src/lib/stores/profileCache.ts
// Centralized profile cache with batch loading for optimized performance
// Eliminates redundant profile subscriptions across the app

import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';
import { getDb } from '$lib/firebase';
import {
	doc,
	getDoc,
	getDocFromCache,
	onSnapshot,
	type Unsubscribe
} from 'firebase/firestore';

/* ===========================
   Configuration
=========================== */
const PROFILE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const BATCH_DELAY_MS = 30; // Wait this long to batch profile requests
const MAX_BATCH_SIZE = 20; // Maximum profiles to fetch in one batch
const MAX_REALTIME_SUBSCRIPTIONS = 10; // Limit realtime profile subs

/* ===========================
   Types
=========================== */
export interface CachedProfile {
	uid: string;
	displayName?: string | null;
	name?: string | null;
	email?: string | null;
	photoURL?: string | null;
	authPhotoURL?: string | null;
	settings?: any;
	[key: string]: any;
}

interface ProfileCacheEntry {
	profile: CachedProfile;
	fetchedAt: number;
	isRealtime: boolean;
}

interface PendingRequest {
	uid: string;
	callbacks: Array<(profile: CachedProfile | null) => void>;
	priority: number;
}

/* ===========================
   State
=========================== */
const cache = new Map<string, ProfileCacheEntry>();
const realtimeUnsubs = new Map<string, Unsubscribe>();
const pendingRequests = new Map<string, PendingRequest>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;

// Svelte store for reactive updates
const profileStoreInternal = writable<Record<string, CachedProfile>>({});

/* ===========================
   Store Export
=========================== */
export const profileStore = {
	subscribe: profileStoreInternal.subscribe,
	get: (uid: string) => get(profileStoreInternal)[uid] || null
};

/* ===========================
   Internal Helpers
=========================== */

function normalizeProfile(uid: string, data: any): CachedProfile {
	const raw = data || {};
	
	const displayName = 
		pickString(raw.name) ?? 
		pickString(raw.displayName) ?? 
		pickString(raw.email) ?? 
		'Member';
	
	const name = pickString(raw.name) ?? displayName;
	
	// Resolve photo URL with proper fallback chain
	let photoURL: string | null = null;
	if (pickString(raw.photoURL)) {
		photoURL = raw.photoURL;
	} else if (pickString(raw.authPhotoURL)) {
		photoURL = raw.authPhotoURL;
	} else if (raw.settings?.avatar) {
		photoURL = raw.settings.avatar;
	}
	
	return {
		uid,
		displayName,
		name,
		email: pickString(raw.email) ?? null,
		photoURL,
		authPhotoURL: pickString(raw.authPhotoURL) ?? null,
		settings: raw.settings ?? undefined,
		...raw
	};
}

function pickString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length ? trimmed : undefined;
}

function isCacheValid(entry: ProfileCacheEntry): boolean {
	// Realtime entries are always valid
	if (entry.isRealtime) return true;
	return Date.now() - entry.fetchedAt < PROFILE_CACHE_TTL;
}

function updateStore(uid: string, profile: CachedProfile): void {
	profileStoreInternal.update(store => ({
		...store,
		[uid]: profile
	}));
}

function removeFromStore(uid: string): void {
	profileStoreInternal.update(store => {
		const next = { ...store };
		delete next[uid];
		return next;
	});
}

/* ===========================
   Public API
=========================== */

/**
 * Get a profile synchronously from cache
 * Returns null if not cached or cache is stale
 */
export function getProfile(uid: string): CachedProfile | null {
	if (!uid) return null;
	
	const entry = cache.get(uid);
	if (entry && isCacheValid(entry)) {
		return entry.profile;
	}
	
	return null;
}

/**
 * Check if a profile is cached
 */
export function hasProfile(uid: string): boolean {
	const entry = cache.get(uid);
	return entry !== undefined && isCacheValid(entry);
}

/**
 * Set/update a profile in cache directly
 * Useful when we get profile data from other sources (like message payloads)
 */
export function setProfile(uid: string, data: any): void {
	if (!uid) return;
	
	const profile = normalizeProfile(uid, data);
	const existingEntry = cache.get(uid);
	
	cache.set(uid, {
		profile,
		fetchedAt: Date.now(),
		isRealtime: existingEntry?.isRealtime ?? false
	});
	
	updateStore(uid, profile);
}

/**
 * Fetch a single profile with caching
 * Returns cached version immediately if available
 */
export async function fetchProfile(uid: string): Promise<CachedProfile | null> {
	if (!browser || !uid) return null;
	
	// Check cache
	const cached = getProfile(uid);
	if (cached) return cached;
	
	try {
		const db = getDb();
		const profileRef = doc(db, 'profiles', uid);
		
		// Try local cache first
		let snap;
		try {
			snap = await getDocFromCache(profileRef);
		} catch {
			snap = await getDoc(profileRef);
		}
		
		const data = snap.exists() ? snap.data() : null;
		const profile = normalizeProfile(uid, data);
		
		cache.set(uid, {
			profile,
			fetchedAt: Date.now(),
			isRealtime: false
		});
		
		updateStore(uid, profile);
		
		return profile;
	} catch {
		return null;
	}
}

/**
 * Request a profile - batched for efficiency
 * Calls callback immediately with cached data if available,
 * then fetches fresh data and calls again
 */
export function requestProfile(
	uid: string, 
	callback: (profile: CachedProfile | null) => void,
	options?: { priority?: number }
): void {
	if (!browser || !uid) {
		callback(null);
		return;
	}
	
	// Return cached immediately if valid
	const cached = getProfile(uid);
	if (cached) {
		callback(cached);
		return;
	}
	
	// Add to pending batch
	const existing = pendingRequests.get(uid);
	const priority = options?.priority ?? 1;
	
	if (existing) {
		existing.callbacks.push(callback);
		existing.priority = Math.max(existing.priority, priority);
	} else {
		pendingRequests.set(uid, {
			uid,
			callbacks: [callback],
			priority
		});
	}
	
	// Schedule batch execution
	scheduleBatch();
}

/**
 * Batch fetch multiple profiles at once
 * Much more efficient than individual fetches
 */
export async function fetchProfiles(uids: string[]): Promise<Map<string, CachedProfile>> {
	if (!browser || !uids.length) return new Map();
	
	const results = new Map<string, CachedProfile>();
	const toFetch: string[] = [];
	
	// Check cache first
	for (const uid of uids) {
		const cached = getProfile(uid);
		if (cached) {
			results.set(uid, cached);
		} else {
			toFetch.push(uid);
		}
	}
	
	if (toFetch.length === 0) return results;
	
	// Fetch remaining in parallel
	const db = getDb();
	const fetchPromises = toFetch.map(async (uid) => {
		try {
			const profileRef = doc(db, 'profiles', uid);
			let snap;
			try {
				snap = await getDocFromCache(profileRef);
			} catch {
				snap = await getDoc(profileRef);
			}
			
			const data = snap.exists() ? snap.data() : null;
			const profile = normalizeProfile(uid, data);
			
			cache.set(uid, {
				profile,
				fetchedAt: Date.now(),
				isRealtime: false
			});
			
			updateStore(uid, profile);
			
			return { uid, profile };
		} catch {
			return { uid, profile: normalizeProfile(uid, {}) };
		}
	});
	
	const fetched = await Promise.all(fetchPromises);
	for (const { uid, profile } of fetched) {
		results.set(uid, profile);
	}
	
	return results;
}

/**
 * Subscribe to realtime profile updates
 * Limited to MAX_REALTIME_SUBSCRIPTIONS to prevent listener explosion
 */
export function subscribeProfile(
	uid: string,
	callback: (profile: CachedProfile | null) => void
): Unsubscribe {
	if (!browser || !uid) return () => {};
	
	// If already have a realtime subscription, just use cached
	if (realtimeUnsubs.has(uid)) {
		const cached = getProfile(uid);
		if (cached) callback(cached);
		return () => {};
	}
	
	// If at limit, fall back to one-time fetch
	if (realtimeUnsubs.size >= MAX_REALTIME_SUBSCRIPTIONS) {
		requestProfile(uid, callback);
		return () => {};
	}
	
	// Create realtime subscription
	const db = getDb();
	const unsub = onSnapshot(
		doc(db, 'profiles', uid),
		(snap) => {
			const data = snap.exists() ? snap.data() : null;
			const profile = normalizeProfile(uid, data);
			
			cache.set(uid, {
				profile,
				fetchedAt: Date.now(),
				isRealtime: true
			});
			
			updateStore(uid, profile);
			callback(profile);
		},
		() => {
			// On error, clean up
			realtimeUnsubs.delete(uid);
			const entry = cache.get(uid);
			if (entry) {
				entry.isRealtime = false;
			}
		}
	);
	
	realtimeUnsubs.set(uid, unsub);
	
	return () => {
		const existingUnsub = realtimeUnsubs.get(uid);
		if (existingUnsub) {
			existingUnsub();
			realtimeUnsubs.delete(uid);
			
			const entry = cache.get(uid);
			if (entry) {
				entry.isRealtime = false;
			}
		}
	};
}

/**
 * Preload profiles for a list of UIDs (non-blocking)
 * Good for preloading message author profiles
 */
export function preloadProfiles(uids: string[]): void {
	if (!browser || !uids.length) return;
	
	// Filter to only uncached
	const toFetch = uids.filter(uid => !hasProfile(uid));
	if (toFetch.length === 0) return;
	
	// Add to pending with low priority
	for (const uid of toFetch) {
		if (!pendingRequests.has(uid)) {
			pendingRequests.set(uid, {
				uid,
				callbacks: [],
				priority: 0
			});
		}
	}
	
	scheduleBatch();
}

/**
 * Clear all cached profiles and subscriptions
 */
export function clearProfileCache(): void {
	// Clean up realtime subscriptions
	for (const [, unsub] of realtimeUnsubs) {
		try {
			unsub();
		} catch {}
	}
	realtimeUnsubs.clear();
	
	// Clear cache
	cache.clear();
	pendingRequests.clear();
	
	if (batchTimer) {
		clearTimeout(batchTimer);
		batchTimer = null;
	}
	
	profileStoreInternal.set({});
}

/* ===========================
   Batch Processing
=========================== */

function scheduleBatch(): void {
	if (batchTimer) return;
	batchTimer = setTimeout(executeBatch, BATCH_DELAY_MS);
}

async function executeBatch(): Promise<void> {
	batchTimer = null;
	
	if (pendingRequests.size === 0) return;
	
	// Sort by priority and take top MAX_BATCH_SIZE
	const sorted = Array.from(pendingRequests.values())
		.sort((a, b) => b.priority - a.priority)
		.slice(0, MAX_BATCH_SIZE);
	
	const uids = sorted.map(r => r.uid);
	
	// Clear processed from pending
	for (const uid of uids) {
		pendingRequests.delete(uid);
	}
	
	// Fetch profiles
	const profiles = await fetchProfiles(uids);
	
	// Call callbacks
	for (const request of sorted) {
		const profile = profiles.get(request.uid) || null;
		for (const callback of request.callbacks) {
			try {
				callback(profile);
			} catch {}
		}
	}
	
	// If there are more pending, schedule another batch
	if (pendingRequests.size > 0) {
		scheduleBatch();
	}
}

/* ===========================
   Debug
=========================== */

export function getProfileCacheStats(): {
	cached: number;
	realtime: number;
	pending: number;
} {
	return {
		cached: cache.size,
		realtime: realtimeUnsubs.size,
		pending: pendingRequests.size
	};
}
