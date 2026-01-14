// src/lib/stores/messageCache.ts
// In-memory message cache for instant channel/DM switching
// Stores recent messages per channel/DM so navigation feels instant
/* eslint-disable @typescript-eslint/no-explicit-any */

import { writable, get } from 'svelte/store';

/* ===========================
   Configuration
=========================== */
const MAX_MESSAGES_PER_CHANNEL = 100; // Keep last N messages per channel
const MAX_CACHED_CHANNELS = 30; // Max channels to keep in memory
const MAX_CACHED_DMS = 20; // Max DM threads to keep in memory
const MAX_CACHED_SERVERS = 15; // Max servers to keep channel lists cached

/* ===========================
   Utilities
=========================== */
/**
 * Extract a sortable timestamp from a Firestore timestamp or Date
 */
function getMessageTime(createdAt: any): number {
	if (!createdAt) return 0;
	if (typeof createdAt.toMillis === 'function') return createdAt.toMillis();
	if (typeof createdAt.seconds === 'number') return createdAt.seconds * 1000;
	if (createdAt instanceof Date) return createdAt.getTime();
	if (typeof createdAt === 'number') return createdAt;
	return 0;
}

/**
 * Sort messages by createdAt timestamp (ascending)
 */
function sortMessagesByTime(messages: CachedMessage[]): CachedMessage[] {
	return messages.sort((a, b) => getMessageTime(a.createdAt) - getMessageTime(b.createdAt));
}

/* ===========================
   Types
=========================== */
export type CachedMessage = {
	id: string;
	uid: string;
	text?: string;
	content?: string;
	type?: string;
	createdAt?: any;
	displayName?: string | null;
	photoURL?: string | null;
	reactions?: Record<string, any>;
	replyTo?: any;
	attachments?: any[];
	poll?: any;
	form?: any;
	editedAt?: any;
	[key: string]: any; // Allow additional fields
};

type ChannelCacheEntry = {
	messages: CachedMessage[];
	lastAccessed: number;
	earliestLoaded?: any; // For pagination tracking
	hasOlderMessages?: boolean;
};

type DMCacheEntry = {
	messages: CachedMessage[];
	lastAccessed: number;
	earliestLoaded?: any;
	hasOlderMessages?: boolean;
};

type ChannelCacheState = {
	// Key: `${serverId}:${channelId}`
	channels: Map<string, ChannelCacheEntry>;
};

type DMCacheState = {
	// Key: threadId
	threads: Map<string, DMCacheEntry>;
};

/* ===========================
   Stores
=========================== */
const channelCache = writable<ChannelCacheState>({
	channels: new Map()
});

const dmCache = writable<DMCacheState>({
	threads: new Map()
});

/* ===========================
   Channel Cache Functions
=========================== */

/**
 * Generate cache key for a channel
 */
export function channelKey(serverId: string, channelId: string): string {
	return `${serverId}:${channelId}`;
}

/**
 * Get cached messages for a channel (returns empty array if not cached)
 */
export function getCachedChannelMessages(serverId: string, channelId: string): CachedMessage[] {
	const state = get(channelCache);
	const key = channelKey(serverId, channelId);
	const entry = state.channels.get(key);
	
	if (entry) {
		// Update last accessed time
		entry.lastAccessed = Date.now();
		return [...entry.messages];
	}
	
	return [];
}

/**
 * Check if channel has cached messages
 */
export function hasChannelCache(serverId: string, channelId: string): boolean {
	const state = get(channelCache);
	const key = channelKey(serverId, channelId);
	return state.channels.has(key);
}

/**
 * Update channel cache with new messages (from Firestore subscription)
 * This intelligently merges new messages with existing cache
 */
export function updateChannelCache(
	serverId: string,
	channelId: string,
	messages: CachedMessage[],
	options?: {
		earliestLoaded?: any;
		hasOlderMessages?: boolean;
		prepend?: boolean; // For older messages loaded via pagination
	}
): void {
	channelCache.update((state) => {
		const key = channelKey(serverId, channelId);
		const existing = state.channels.get(key);
		
		let newMessages: CachedMessage[];
		
		if (options?.prepend && existing) {
			// Prepending older messages (pagination)
			const existingIds = new Set(existing.messages.map(m => m.id));
			const uniqueOlder = messages.filter(m => !existingIds.has(m.id));
			newMessages = [...uniqueOlder, ...existing.messages];
		} else if (existing && messages.length > 0) {
			// Merge: keep messages not in new batch, add new batch
			// This handles real-time updates where we might get partial updates
			const newIds = new Set(messages.map(m => m.id));
			const oldMessagesNotReplaced = existing.messages.filter(m => !newIds.has(m.id));
			
			// Combine and sort by createdAt
			newMessages = sortMessagesByTime([...oldMessagesNotReplaced, ...messages]);
		} else {
			newMessages = [...messages];
		}
		
		// Trim to max size (keep most recent)
		if (newMessages.length > MAX_MESSAGES_PER_CHANNEL) {
			newMessages = newMessages.slice(-MAX_MESSAGES_PER_CHANNEL);
		}
		
		state.channels.set(key, {
			messages: newMessages,
			lastAccessed: Date.now(),
			earliestLoaded: options?.earliestLoaded ?? existing?.earliestLoaded,
			hasOlderMessages: options?.hasOlderMessages ?? existing?.hasOlderMessages ?? true
		});
		
		// Evict old channels if over limit
		evictOldChannels(state);
		
		return state;
	});
}

/**
 * Add a single message to channel cache (for optimistic updates)
 */
export function addMessageToChannelCache(
	serverId: string,
	channelId: string,
	message: CachedMessage
): void {
	channelCache.update((state) => {
		const key = channelKey(serverId, channelId);
		const existing = state.channels.get(key);
		
		if (!existing) {
			// No cache entry yet, create one with just this message
			state.channels.set(key, {
				messages: [message],
				lastAccessed: Date.now(),
				hasOlderMessages: true
			});
		} else {
			// Check if message already exists (update it) or add new
			const idx = existing.messages.findIndex(m => m.id === message.id);
			if (idx >= 0) {
				existing.messages[idx] = message;
			} else {
				existing.messages.push(message);
				// Keep sorted
				existing.messages = sortMessagesByTime(existing.messages);
			}
			
			// Trim if needed
			if (existing.messages.length > MAX_MESSAGES_PER_CHANNEL) {
				existing.messages = existing.messages.slice(-MAX_MESSAGES_PER_CHANNEL);
			}
			
			existing.lastAccessed = Date.now();
		}
		
		return state;
	});
}

/**
 * Update a specific message in cache (for reactions, edits, etc.)
 */
export function updateMessageInChannelCache(
	serverId: string,
	channelId: string,
	messageId: string,
	updates: Partial<CachedMessage>
): void {
	channelCache.update((state) => {
		const key = channelKey(serverId, channelId);
		const existing = state.channels.get(key);
		
		if (existing) {
			const idx = existing.messages.findIndex(m => m.id === messageId);
			if (idx >= 0) {
				existing.messages[idx] = { ...existing.messages[idx], ...updates };
			}
		}
		
		return state;
	});
}

/**
 * Clear cache for a specific channel
 */
export function clearChannelCache(serverId: string, channelId: string): void {
	channelCache.update((state) => {
		const key = channelKey(serverId, channelId);
		state.channels.delete(key);
		return state;
	});
}

/**
 * Clear all channel caches for a server
 */
export function clearServerCache(serverId: string): void {
	channelCache.update((state) => {
		const prefix = `${serverId}:`;
		for (const key of state.channels.keys()) {
			if (key.startsWith(prefix)) {
				state.channels.delete(key);
			}
		}
		return state;
	});
}

/**
 * Evict oldest channels when over limit
 */
function evictOldChannels(state: ChannelCacheState): void {
	if (state.channels.size <= MAX_CACHED_CHANNELS) return;
	
	const entries = Array.from(state.channels.entries())
		.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
	
	const toRemove = entries.slice(0, state.channels.size - MAX_CACHED_CHANNELS);
	for (const [key] of toRemove) {
		state.channels.delete(key);
	}
}

/* ===========================
   DM Cache Functions
=========================== */

/**
 * Get cached messages for a DM thread
 */
export function getCachedDMMessages(threadId: string): CachedMessage[] {
	const state = get(dmCache);
	const entry = state.threads.get(threadId);
	
	if (entry) {
		entry.lastAccessed = Date.now();
		return [...entry.messages];
	}
	
	return [];
}

/**
 * Check if DM thread has cached messages
 */
export function hasDMCache(threadId: string): boolean {
	const state = get(dmCache);
	return state.threads.has(threadId);
}

/**
 * Update DM cache with new messages
 */
export function updateDMCache(
	threadId: string,
	messages: CachedMessage[],
	options?: {
		earliestLoaded?: any;
		hasOlderMessages?: boolean;
		prepend?: boolean;
	}
): void {
	dmCache.update((state) => {
		const existing = state.threads.get(threadId);
		
		let newMessages: CachedMessage[];
		
		if (options?.prepend && existing) {
			const existingIds = new Set(existing.messages.map(m => m.id));
			const uniqueOlder = messages.filter(m => !existingIds.has(m.id));
			newMessages = [...uniqueOlder, ...existing.messages];
		} else if (existing && messages.length > 0) {
			const newIds = new Set(messages.map(m => m.id));
			const oldMessagesNotReplaced = existing.messages.filter(m => !newIds.has(m.id));
			
			newMessages = sortMessagesByTime([...oldMessagesNotReplaced, ...messages]);
		} else {
			newMessages = [...messages];
		}
		
		if (newMessages.length > MAX_MESSAGES_PER_CHANNEL) {
			newMessages = newMessages.slice(-MAX_MESSAGES_PER_CHANNEL);
		}
		
		state.threads.set(threadId, {
			messages: newMessages,
			lastAccessed: Date.now(),
			earliestLoaded: options?.earliestLoaded ?? existing?.earliestLoaded,
			hasOlderMessages: options?.hasOlderMessages ?? existing?.hasOlderMessages ?? true
		});
		
		// Evict old DMs if over limit
		evictOldDMs(state);
		
		return state;
	});
}

/**
 * Add a single message to DM cache
 */
export function addMessageToDMCache(threadId: string, message: CachedMessage): void {
	dmCache.update((state) => {
		const existing = state.threads.get(threadId);
		
		if (!existing) {
			state.threads.set(threadId, {
				messages: [message],
				lastAccessed: Date.now(),
				hasOlderMessages: true
			});
		} else {
			const idx = existing.messages.findIndex(m => m.id === message.id);
			if (idx >= 0) {
				existing.messages[idx] = message;
			} else {
				existing.messages.push(message);
				existing.messages = sortMessagesByTime(existing.messages);
			}
			
			if (existing.messages.length > MAX_MESSAGES_PER_CHANNEL) {
				existing.messages = existing.messages.slice(-MAX_MESSAGES_PER_CHANNEL);
			}
			
			existing.lastAccessed = Date.now();
		}
		
		return state;
	});
}

/**
 * Update a specific message in DM cache
 */
export function updateMessageInDMCache(
	threadId: string,
	messageId: string,
	updates: Partial<CachedMessage>
): void {
	dmCache.update((state) => {
		const existing = state.threads.get(threadId);
		
		if (existing) {
			const idx = existing.messages.findIndex(m => m.id === messageId);
			if (idx >= 0) {
				existing.messages[idx] = { ...existing.messages[idx], ...updates };
			}
		}
		
		return state;
	});
}

/**
 * Clear cache for a specific DM thread
 */
export function clearDMCache(threadId: string): void {
	dmCache.update((state) => {
		state.threads.delete(threadId);
		return state;
	});
}

/**
 * Evict oldest DM threads when over limit
 */
function evictOldDMs(state: DMCacheState): void {
	if (state.threads.size <= MAX_CACHED_DMS) return;
	
	const entries = Array.from(state.threads.entries())
		.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
	
	const toRemove = entries.slice(0, state.threads.size - MAX_CACHED_DMS);
	for (const [key] of toRemove) {
		state.threads.delete(key);
	}
}

/* ===========================
   Global Cache Management
=========================== */

/**
 * Clear all caches (useful for logout)
 */
export function clearAllMessageCaches(): void {
	channelCache.set({ channels: new Map() });
	dmCache.set({ threads: new Map() });
	serverCache.set({ servers: new Map() });
	memberCache.set({ servers: new Map() });
}

/**
 * Get cache stats (for debugging)
 */
export function getCacheStats(): {
	channelCount: number;
	dmCount: number;
	serverCount: number;
	totalMessages: number;
} {
	const chState = get(channelCache);
	const dmState = get(dmCache);
	const srvState = get(serverCache);
	
	let totalMessages = 0;
	for (const entry of chState.channels.values()) {
		totalMessages += entry.messages.length;
	}
	for (const entry of dmState.threads.values()) {
		totalMessages += entry.messages.length;
	}
	
	return {
		channelCount: chState.channels.size,
		dmCount: dmState.threads.size,
		serverCount: srvState.servers.size,
		totalMessages
	};
}

/* ===========================
   Server Cache Types
=========================== */
export type CachedChannel = {
	id: string;
	name: string;
	type: 'text' | 'voice';
	position?: number;
	isPrivate?: boolean;
	allowedRoleIds?: string[];
	[key: string]: any;
};

export type CachedServerMeta = {
	id: string;
	name?: string;
	iconURL?: string | null;
	description?: string | null;
	ownerId?: string | null;
	[key: string]: any;
};

type ServerCacheEntry = {
	channels: CachedChannel[];
	meta?: CachedServerMeta;
	lastAccessed: number;
};

type ServerCacheState = {
	servers: Map<string, ServerCacheEntry>;
};

/* ===========================
   Server Cache Store
=========================== */
const serverCache = writable<ServerCacheState>({
	servers: new Map()
});

/* ===========================
   Server Cache Functions
=========================== */

/**
 * Check if server has cached data
 */
export function hasServerCache(serverId: string): boolean {
	const state = get(serverCache);
	return state.servers.has(serverId);
}

/**
 * Get cached channels for a server
 */
export function getCachedServerChannels(serverId: string): CachedChannel[] {
	const state = get(serverCache);
	const entry = state.servers.get(serverId);
	
	if (entry) {
		entry.lastAccessed = Date.now();
		return [...entry.channels];
	}
	
	return [];
}

/**
 * Get cached server metadata
 */
export function getCachedServerMeta(serverId: string): CachedServerMeta | null {
	const state = get(serverCache);
	const entry = state.servers.get(serverId);
	
	if (entry?.meta) {
		entry.lastAccessed = Date.now();
		return { ...entry.meta };
	}
	
	return null;
}

/**
 * Update server channel cache
 */
export function updateServerChannelCache(
	serverId: string,
	channels: CachedChannel[]
): void {
	serverCache.update((state) => {
		const existing = state.servers.get(serverId);
		
		state.servers.set(serverId, {
			channels: [...channels],
			meta: existing?.meta,
			lastAccessed: Date.now()
		});
		
		// Evict old servers if over limit
		evictOldServers(state);
		
		return state;
	});
}

/**
 * Update server metadata cache
 */
export function updateServerMetaCache(
	serverId: string,
	meta: CachedServerMeta
): void {
	serverCache.update((state) => {
		const existing = state.servers.get(serverId);
		
		state.servers.set(serverId, {
			channels: existing?.channels ?? [],
			meta: { ...meta },
			lastAccessed: Date.now()
		});
		
		// Evict old servers if over limit
		evictOldServers(state);
		
		return state;
	});
}

/**
 * Update both channels and metadata at once
 */
export function updateServerCache(
	serverId: string,
	data: { channels?: CachedChannel[]; meta?: CachedServerMeta }
): void {
	serverCache.update((state) => {
		const existing = state.servers.get(serverId);
		
		state.servers.set(serverId, {
			channels: data.channels ?? existing?.channels ?? [],
			meta: data.meta ?? existing?.meta,
			lastAccessed: Date.now()
		});
		
		// Evict old servers if over limit
		evictOldServers(state);
		
		return state;
	});
}

/**
 * Clear server metadata/channels cache for a specific server
 */
export function clearServerMetadataCache(serverId: string): void {
	serverCache.update((state) => {
		state.servers.delete(serverId);
		return state;
	});
}

/**
 * Evict oldest servers when over limit
 */
function evictOldServers(state: ServerCacheState): void {
	if (state.servers.size <= MAX_CACHED_SERVERS) return;
	
	const entries = Array.from(state.servers.entries())
		.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
	
	const toRemove = entries.slice(0, state.servers.size - MAX_CACHED_SERVERS);
	for (const [key] of toRemove) {
		state.servers.delete(key);
	}
}

/* ===========================
   Member Cache Types
=========================== */
export type CachedMember = {
	uid: string;
	nickname?: string | null;
	displayName?: string | null;
	name?: string | null;
	email?: string | null;
	photoURL?: string | null;
	role?: 'owner' | 'admin' | 'member' | null;
	roleIds?: string[];
	[key: string]: any;
};

export type CachedProfile = {
	displayName?: string | null;
	name?: string | null;
	email?: string | null;
	photoURL?: string | null;
	cachedPhotoURL?: string | null;
	customPhotoURL?: string | null;
	authPhotoURL?: string | null;
	[key: string]: any;
};

export type CachedRole = {
	id: string;
	name: string;
	color?: string | null;
	position?: number;
	showInMemberList?: boolean;
};

export type CachedPresence = {
	state?: string | null;
	status?: string | null;
	online?: boolean | null;
	isOnline?: boolean | null;
	active?: boolean | null;
	lastActive?: any;
	lastSeen?: any;
	updatedAt?: any;
	[key: string]: any;
};

type MemberCacheEntry = {
	members: Record<string, CachedMember>;
	profiles: Record<string, CachedProfile>;
	presenceDocs: Record<string, CachedPresence>;
	roles: Record<string, CachedRole>;
	lastAccessed: number;
};

type MemberCacheState = {
	servers: Map<string, MemberCacheEntry>;
};

/* ===========================
   Member Cache Store
=========================== */
const memberCache = writable<MemberCacheState>({
	servers: new Map()
});

/* ===========================
   Member Cache Functions
=========================== */

/**
 * Check if server has cached member data
 */
export function hasMemberCache(serverId: string): boolean {
	const state = get(memberCache);
	return state.servers.has(serverId);
}

/**
 * Get cached members for a server
 */
export function getCachedMembers(serverId: string): Record<string, CachedMember> {
	const state = get(memberCache);
	const entry = state.servers.get(serverId);
	
	if (entry) {
		entry.lastAccessed = Date.now();
		return { ...entry.members };
	}
	
	return {};
}

/**
 * Get cached profiles for a server
 */
export function getCachedProfiles(serverId: string): Record<string, CachedProfile> {
	const state = get(memberCache);
	const entry = state.servers.get(serverId);
	
	if (entry) {
		entry.lastAccessed = Date.now();
		return { ...entry.profiles };
	}
	
	return {};
}

/**
 * Get cached presence data for a server
 */
export function getCachedPresence(serverId: string): Record<string, CachedPresence> {
	const state = get(memberCache);
	const entry = state.servers.get(serverId);
	
	if (entry) {
		entry.lastAccessed = Date.now();
		return { ...entry.presenceDocs };
	}
	
	return {};
}

/**
 * Get cached roles for a server
 */
export function getCachedRoles(serverId: string): Record<string, CachedRole> {
	const state = get(memberCache);
	const entry = state.servers.get(serverId);
	
	if (entry) {
		entry.lastAccessed = Date.now();
		return { ...entry.roles };
	}
	
	return {};
}

/**
 * Get all cached member data for a server
 */
export function getCachedMemberData(serverId: string): {
	members: Record<string, CachedMember>;
	profiles: Record<string, CachedProfile>;
	presenceDocs: Record<string, CachedPresence>;
	roles: Record<string, CachedRole>;
} | null {
	const state = get(memberCache);
	const entry = state.servers.get(serverId);
	
	if (entry) {
		entry.lastAccessed = Date.now();
		return {
			members: { ...entry.members },
			profiles: { ...entry.profiles },
			presenceDocs: { ...entry.presenceDocs },
			roles: { ...entry.roles }
		};
	}
	
	return null;
}

/**
 * Update member cache for a server
 */
export function updateMemberCache(
	serverId: string,
	data: {
		members?: Record<string, CachedMember>;
		profiles?: Record<string, CachedProfile>;
		presenceDocs?: Record<string, CachedPresence>;
		roles?: Record<string, CachedRole>;
	}
): void {
	memberCache.update((state) => {
		const existing = state.servers.get(serverId);
		
		state.servers.set(serverId, {
			members: data.members ?? existing?.members ?? {},
			profiles: data.profiles ?? existing?.profiles ?? {},
			presenceDocs: data.presenceDocs ?? existing?.presenceDocs ?? {},
			roles: data.roles ?? existing?.roles ?? {},
			lastAccessed: Date.now()
		});
		
		// Evict old servers if over limit
		evictOldMemberCaches(state);
		
		return state;
	});
}

/**
 * Update just the members for a server
 */
export function updateMembersInCache(serverId: string, members: Record<string, CachedMember>): void {
	memberCache.update((state) => {
		const existing = state.servers.get(serverId);
		
		if (existing) {
			existing.members = { ...members };
			existing.lastAccessed = Date.now();
		} else {
			state.servers.set(serverId, {
				members: { ...members },
				profiles: {},
				presenceDocs: {},
				roles: {},
				lastAccessed: Date.now()
			});
		}
		
		evictOldMemberCaches(state);
		return state;
	});
}

/**
 * Update just profiles for a server (merge with existing)
 */
export function updateProfilesInCache(serverId: string, profiles: Record<string, CachedProfile>): void {
	memberCache.update((state) => {
		const existing = state.servers.get(serverId);
		
		if (existing) {
			existing.profiles = { ...existing.profiles, ...profiles };
			existing.lastAccessed = Date.now();
		} else {
			state.servers.set(serverId, {
				members: {},
				profiles: { ...profiles },
				presenceDocs: {},
				roles: {},
				lastAccessed: Date.now()
			});
		}
		
		evictOldMemberCaches(state);
		return state;
	});
}

/**
 * Update a single profile in cache
 */
export function updateProfileInCache(serverId: string, uid: string, profile: CachedProfile): void {
	memberCache.update((state) => {
		const existing = state.servers.get(serverId);
		
		if (existing) {
			existing.profiles = { ...existing.profiles, [uid]: profile };
			existing.lastAccessed = Date.now();
		}
		
		return state;
	});
}

/**
 * Update just presence data for a server (merge with existing)
 */
export function updatePresenceInCache(serverId: string, presenceDocs: Record<string, CachedPresence>): void {
	memberCache.update((state) => {
		const existing = state.servers.get(serverId);
		
		if (existing) {
			existing.presenceDocs = { ...existing.presenceDocs, ...presenceDocs };
			existing.lastAccessed = Date.now();
		} else {
			state.servers.set(serverId, {
				members: {},
				profiles: {},
				presenceDocs: { ...presenceDocs },
				roles: {},
				lastAccessed: Date.now()
			});
		}
		
		evictOldMemberCaches(state);
		return state;
	});
}

/**
 * Update a single presence doc in cache
 */
export function updatePresenceDocInCache(serverId: string, uid: string, presence: CachedPresence): void {
	memberCache.update((state) => {
		const existing = state.servers.get(serverId);
		
		if (existing) {
			existing.presenceDocs = { ...existing.presenceDocs, [uid]: presence };
			existing.lastAccessed = Date.now();
		}
		
		return state;
	});
}

/**
 * Update just roles for a server
 */
export function updateRolesInCache(serverId: string, roles: Record<string, CachedRole>): void {
	memberCache.update((state) => {
		const existing = state.servers.get(serverId);
		
		if (existing) {
			existing.roles = { ...roles };
			existing.lastAccessed = Date.now();
		} else {
			state.servers.set(serverId, {
				members: {},
				profiles: {},
				presenceDocs: {},
				roles: { ...roles },
				lastAccessed: Date.now()
			});
		}
		
		evictOldMemberCaches(state);
		return state;
	});
}

/**
 * Clear member cache for a specific server
 */
export function clearMemberCache(serverId: string): void {
	memberCache.update((state) => {
		state.servers.delete(serverId);
		return state;
	});
}

/**
 * Evict oldest member caches when over limit
 */
function evictOldMemberCaches(state: MemberCacheState): void {
	if (state.servers.size <= MAX_CACHED_SERVERS) return;
	
	const entries = Array.from(state.servers.entries())
		.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
	
	const toRemove = entries.slice(0, state.servers.size - MAX_CACHED_SERVERS);
	for (const [key] of toRemove) {
		state.servers.delete(key);
	}
}

/* ===========================
   Preload Functions for Mobile Navigation
=========================== */

// Track which servers we've already preloaded to avoid duplicate fetches
const preloadedServers = new Set<string>();
let preloadInProgress = false;

/**
 * Preload server channels into cache for instant navigation
 * Called from MobileNavBar when user is on DMs to warm up server data
 */
export async function preloadServerChannels(serverId: string): Promise<void> {
	if (!serverId || preloadedServers.has(serverId) || preloadInProgress) return;
	
	// Check if already in cache
	if (hasServerCache(serverId)) {
		preloadedServers.add(serverId);
		return;
	}
	
	// Check sessionStorage first (faster than Firestore)
	if (typeof window !== 'undefined') {
		try {
			const stored = sessionStorage.getItem(`server-channels:${serverId}`);
			if (stored) {
				const channels = JSON.parse(stored);
				if (Array.isArray(channels) && channels.length > 0) {
					updateServerChannelCache(serverId, channels);
					preloadedServers.add(serverId);
					return;
				}
			}
		} catch {
			// ignore
		}
	}
	
	// Fetch from Firestore in background
	preloadInProgress = true;
	try {
		const { getDb } = await import('$lib/firebase');
		const { collection, query, orderBy, getDocs } = await import('firebase/firestore');
		
		const db = getDb();
		const q = query(
			collection(db, 'servers', serverId, 'channels'),
			orderBy('position')
		);
		
		const snap = await getDocs(q);
		const channels: CachedChannel[] = snap.docs.map((d) => ({
			id: d.id,
			...(d.data() as any)
		}));
		
		if (channels.length > 0) {
			updateServerChannelCache(serverId, channels);
			
			// Also persist to sessionStorage
			if (typeof window !== 'undefined') {
				try {
					sessionStorage.setItem(
						`server-channels:${serverId}`,
						JSON.stringify(channels.slice(0, 200))
					);
				} catch {
					// ignore
				}
			}
		}
		
		preloadedServers.add(serverId);
	} catch (err) {
		console.warn('[preload] Failed to preload server channels', serverId, err);
	} finally {
		preloadInProgress = false;
	}
}

/**
 * Preload multiple servers in sequence (call when user is idle on DMs)
 */
export async function preloadUserServers(serverIds: string[]): Promise<void> {
	for (const id of serverIds.slice(0, 3)) { // Limit to top 3 servers
		await preloadServerChannels(id);
	}
}

/**
 * Clear preload tracking (call on logout)
 */
export function clearPreloadTracking(): void {
	preloadedServers.clear();
}

// Export stores for reactive subscriptions if needed
export { channelCache, dmCache, serverCache, memberCache };
