// src/lib/stores/splashPreload.ts
// High-priority preloading during splash screen
// Loads servers, channels, and initial messages for instant app readiness
/* eslint-disable @typescript-eslint/no-explicit-any */

import { writable } from 'svelte/store';
import { markChannelAsPriority, clearPriorityChannels, isChannelPriority } from './messageCache';

/* ===========================
   Configuration
=========================== */
const MAX_SERVERS_TO_PRELOAD = 10; // Preload channels for top 10 servers
const MESSAGES_PER_CHANNEL = 5; // Keep 5 messages per channel preloaded
const MAX_DMS_TO_PRELOAD = 10; // Preload first 10 DM threads
const PRIORITY_CACHE_KEY = 'hconnect:priority-cache';

/* ===========================
   Types
=========================== */
export interface PreloadProgress {
	phase: 'idle' | 'servers' | 'channels' | 'messages' | 'complete';
	serversLoaded: number;
	totalServers: number;
	channelsLoaded: number;
	totalChannels: number;
	messagesLoaded: number;
	totalMessages: number;
	startTime: number;
	endTime?: number;
	// Explicit flag: true when ALL channels for ALL servers are loaded into cache
	channelsReady: boolean;
}

export interface PriorityCachedChannel {
	serverId: string;
	channelId: string;
	channelName: string;
	channelType: 'text' | 'voice';
	position?: number;
}

export interface PriorityCachedMessage {
	id: string;
	serverId: string;
	channelId: string;
	uid: string;
	text?: string;
	content?: string;
	createdAt?: any;
	displayName?: string | null;
	photoURL?: string | null;
	[key: string]: any;
}

export interface PriorityCachedDM {
	id: string;
	participants: string[];
	otherUid: string | null;
	lastMessage?: string | null;
	updatedAt?: any;
	isGroup?: boolean;
	groupName?: string | null;
	iconURL?: string | null;
	// Name fields for instant display
	otherName?: string | null;
	otherDisplayName?: string | null;
	otherEmail?: string | null;
	otherPhotoURL?: string | null;
	[key: string]: unknown; // Index signature for compatibility with DMRailEntry
}

interface PriorityCache {
	servers: Array<{
		id: string;
		name: string;
		icon: string | null;
		position: number | null;
	}>;
	channels: PriorityCachedChannel[];
	messages: PriorityCachedMessage[];
	dms: PriorityCachedDM[];
	lastUpdated: number;
}

/* ===========================
   Stores
=========================== */
export const preloadProgress = writable<PreloadProgress>({
	phase: 'idle',
	serversLoaded: 0,
	totalServers: 0,
	channelsLoaded: 0,
	totalChannels: 0,
	messagesLoaded: 0,
	totalMessages: 0,
	startTime: 0,
	channelsReady: false
});

// Priority messages cache (kept in memory for instant access)
const priorityMessages = new Map<string, PriorityCachedMessage[]>();

// Server icons cache
const serverIconCache = new Map<string, string | null>();

/* ===========================
   Persistent Cache
=========================== */
function loadPriorityCache(): PriorityCache | null {
	if (typeof window === 'undefined') return null;
	try {
		const stored = localStorage.getItem(PRIORITY_CACHE_KEY);
		if (!stored) return null;
		const parsed = JSON.parse(stored) as PriorityCache;
		// Check if cache is less than 1 hour old
		if (Date.now() - parsed.lastUpdated < 3600000) {
			return parsed;
		}
	} catch {
		// Ignore errors
	}
	return null;
}

function savePriorityCache(cache: PriorityCache): void {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(PRIORITY_CACHE_KEY, JSON.stringify(cache));
	} catch {
		// Ignore storage errors
	}
}

/* ===========================
   Priority Cache Accessors
=========================== */

/**
 * Check if a channel is a priority channel (should not be evicted)
 */
export function isPriorityChannel(serverId: string, channelId: string): boolean {
	return isChannelPriority(serverId, channelId);
}

/**
 * Get priority messages for a channel (the preloaded 5 messages)
 */
export function getPriorityMessages(serverId: string, channelId: string): PriorityCachedMessage[] {
	return priorityMessages.get(`${serverId}:${channelId}`) ?? [];
}

/**
 * Check if we have priority messages for a channel
 */
export function hasPriorityMessages(serverId: string, channelId: string): boolean {
	const key = `${serverId}:${channelId}`;
	const msgs = priorityMessages.get(key);
	return !!msgs && msgs.length > 0;
}

/**
 * Update priority messages for a channel (when a new message arrives)
 * Keeps only the most recent 5 messages
 */
export function updatePriorityMessage(
	serverId: string,
	channelId: string,
	message: PriorityCachedMessage
): void {
	const key = `${serverId}:${channelId}`;
	if (!isChannelPriority(serverId, channelId)) return; // Only update priority channels
	
	let msgs = priorityMessages.get(key) ?? [];
	
	// Check if message already exists (update it)
	const existingIdx = msgs.findIndex(m => m.id === message.id);
	if (existingIdx >= 0) {
		msgs[existingIdx] = message;
	} else {
		// Add new message and keep only most recent 5
		msgs = [...msgs, message].sort((a, b) => {
			const aTime = getMessageTime(a.createdAt);
			const bTime = getMessageTime(b.createdAt);
			return bTime - aTime; // Most recent first
		}).slice(0, MESSAGES_PER_CHANNEL);
	}
	
	priorityMessages.set(key, msgs);
}

/**
 * Get cached server icon
 */
export function getCachedServerIcon(serverId: string): string | null | undefined {
	return serverIconCache.get(serverId);
}

/**
 * Check if server icon is cached
 */
export function hasServerIconCache(serverId: string): boolean {
	return serverIconCache.has(serverId);
}

/* ===========================
   Utility Functions
=========================== */
function getMessageTime(createdAt: any): number {
	if (!createdAt) return 0;
	if (typeof createdAt.toMillis === 'function') return createdAt.toMillis();
	if (typeof createdAt.seconds === 'number') return createdAt.seconds * 1000;
	if (createdAt instanceof Date) return createdAt.getTime();
	if (typeof createdAt === 'number') return createdAt;
	return 0;
}

/* ===========================
   Main Preload Function
=========================== */

let preloadStarted = false;
let preloadComplete = false;

/**
 * Main preload function - call during splash screen
 * Loads servers, channels, and messages in priority order
 */
export async function startSplashPreload(userId: string): Promise<void> {
	if (preloadStarted || !userId) return;
	preloadStarted = true;
	
	const startTime = Date.now();
	preloadProgress.set({
		phase: 'servers',
		serversLoaded: 0,
		totalServers: 0,
		channelsLoaded: 0,
		totalChannels: 0,
		messagesLoaded: 0,
		totalMessages: 0,
		channelsReady: false,
		startTime
	});
	
	try {
		// Import messageCache functions upfront
		const { updateServerChannelCache, updateChannelCache: updateMsgCache } = await import('./messageCache');
		
		// 1. First, try to load from localStorage cache for instant paint
		const cached = loadPriorityCache();
		if (cached && cached.servers.length > 0) {
			// Restore server icons from cache
			for (const server of cached.servers) {
				serverIconCache.set(server.id, server.icon);
			}
			
			// Restore priority channels AND put them in messageCache
			// Group channels by server for batch updates
			const channelsByServer = new Map<string, typeof cached.channels>();
			for (const channel of cached.channels) {
				markChannelAsPriority(channel.serverId, channel.channelId);
				const serverChannels = channelsByServer.get(channel.serverId) ?? [];
				serverChannels.push(channel);
				channelsByServer.set(channel.serverId, serverChannels);
			}
			
			// Update messageCache with cached channels
			for (const [serverId, channels] of channelsByServer) {
				updateServerChannelCache(serverId, channels.map(c => ({
					id: c.channelId,
					name: c.channelName,
					type: c.channelType,
					position: c.position,
					isPrivate: false,
					allowedRoleIds: []
				})));
			}
			
			// Restore priority messages AND put them in messageCache
			const messagesByChannel = new Map<string, PriorityCachedMessage[]>();
			for (const msg of cached.messages) {
				const key = `${msg.serverId}:${msg.channelId}`;
				const existing = messagesByChannel.get(key) ?? [];
				if (!existing.find(m => m.id === msg.id)) {
					messagesByChannel.set(key, [...existing, msg]);
				}
			}
			
			// Update both priority messages and messageCache
			for (const [key, msgs] of messagesByChannel) {
				priorityMessages.set(key, msgs);
				const [serverId, channelId] = key.split(':');
				updateMsgCache(serverId, channelId, msgs);
			}
			
			// Restore DMs from cache
			if (cached.dms && cached.dms.length > 0) {
				const { dmRailCache } = await import('./dmRailCache');
				dmRailCache.set(userId, cached.dms);
				// Also persist to localStorage for DMsSidebar to find
				try {
					localStorage.setItem(`dm-rail:${userId}`, JSON.stringify(cached.dms));
				} catch {
					// Ignore storage errors
				}
				console.log(`[splashPreload] Restored ${cached.dms.length} DMs from cache`);
			}
			
			// If we have cached data, mark channels as loaded immediately
			// so the splash can dismiss faster on repeat visits
			console.log(`[splashPreload] Restored ${cached.channels.length} channels from cache`);
			preloadProgress.update(p => ({
				...p,
				phase: 'channels',
				totalServers: cached.servers.length,
				serversLoaded: cached.servers.length,
				channelsLoaded: cached.channels.length,
				totalChannels: cached.channels.length,
				channelsReady: true  // Cache is ready to display
			}));
		}
		
		// 2. Fetch servers from Firestore
		const { getDb } = await import('$lib/firebase');
		const { collection, query, orderBy, getDocs, limit, doc, getDoc } = await import('firebase/firestore');
		
		const db = getDb();
		
		// Get user's servers (sorted by position/joinedAt)
		const serversQuery = query(
			collection(db, 'profiles', userId, 'servers'),
			orderBy('position', 'asc'),
			limit(MAX_SERVERS_TO_PRELOAD)
		);
		
		const serversSnap = await getDocs(serversQuery);
		const serverIds: string[] = [];
		const servers: Array<{ id: string; name: string; icon: string | null; position: number | null }> = [];
		
		for (const docSnap of serversSnap.docs) {
			serverIds.push(docSnap.id);
			const data = docSnap.data();
			servers.push({
				id: docSnap.id,
				name: data.name ?? docSnap.id,
				icon: null, // Will be loaded from server doc
				position: typeof data.position === 'number' ? data.position : null
			});
		}
		
		preloadProgress.update(p => ({
			...p,
			totalServers: serverIds.length,
			serversLoaded: serverIds.length
		}));
		
		// 3. Load server icons in parallel (HIGH PRIORITY)
		const serverIconPromises = serverIds.map(async (serverId, idx) => {
			try {
				const serverDoc = await getDoc(doc(db, 'servers', serverId));
				if (serverDoc.exists()) {
					const data = serverDoc.data();
					const icon = data?.icon ?? null;
					serverIconCache.set(serverId, icon);
					servers[idx].icon = icon;
					servers[idx].name = data?.name ?? servers[idx].name;
				}
			} catch {
				// Ignore errors for individual servers
			}
		});
		
		await Promise.all(serverIconPromises);
		
		preloadProgress.update(p => ({ ...p, phase: 'channels' }));
		
		// 4. Load channels for all servers in parallel
		const allChannels: PriorityCachedChannel[] = [];
		
		const channelPromises = serverIds.map(async (serverId) => {
			try {
				const channelsQuery = query(
					collection(db, 'servers', serverId, 'channels'),
					orderBy('position', 'asc')
				);
				const channelsSnap = await getDocs(channelsQuery);
				
				const serverChannels: PriorityCachedChannel[] = [];
				for (const channelDoc of channelsSnap.docs) {
					const data = channelDoc.data();
					// Only cache text channels (voice channels don't have messages)
					if (data.type === 'text' || !data.type) {
						const channel: PriorityCachedChannel = {
							serverId,
							channelId: channelDoc.id,
							channelName: data.name ?? channelDoc.id,
							channelType: data.type ?? 'text',
							position: data.position
						};
						serverChannels.push(channel);
						markChannelAsPriority(serverId, channelDoc.id);
					}
				}
				
				allChannels.push(...serverChannels);
				
				// Also update the messageCache server channel cache
				const { updateServerChannelCache } = await import('./messageCache');
				updateServerChannelCache(serverId, channelsSnap.docs.map(d => ({
					id: d.id,
					name: d.data().name ?? d.id,
					type: d.data().type ?? 'text',
					position: d.data().position,
					isPrivate: d.data().isPrivate ?? false,
					allowedRoleIds: d.data().allowedRoleIds ?? []
				})));
				
				preloadProgress.update(p => ({
					...p,
					channelsLoaded: p.channelsLoaded + serverChannels.length
				}));
			} catch (err) {
				console.warn(`[splashPreload] Failed to load channels for server ${serverId}:`, err);
			}
		});
		
		await Promise.all(channelPromises);
		
		console.log(`[splashPreload] All channels loaded for ${serverIds.length} servers, total: ${allChannels.length} channels`);
		
		preloadProgress.update(p => ({
			...p,
			totalChannels: allChannels.length,
			channelsReady: true,  // Mark channels as ready AFTER all are loaded
			phase: 'messages'
		}));
		
		// 5. Load messages progressively: first message for all channels, then second, etc.
		const textChannels = allChannels.filter(c => c.channelType === 'text');
		const totalMessagesToLoad = textChannels.length * MESSAGES_PER_CHANNEL;
		
		preloadProgress.update(p => ({ ...p, totalMessages: totalMessagesToLoad }));
		
		// Fetch messages in rounds: first message for all, then second, etc.
		for (let round = 0; round < MESSAGES_PER_CHANNEL; round++) {
			const messagePromises = textChannels.map(async (channel) => {
				try {
					const key = `${channel.serverId}:${channel.channelId}`;
					const existing = priorityMessages.get(key) ?? [];
					
					// Skip if we already have enough messages for this channel
					if (existing.length > round) {
						preloadProgress.update(p => ({ ...p, messagesLoaded: p.messagesLoaded + 1 }));
						return;
					}
					
					const messagesQuery = query(
						collection(db, 'servers', channel.serverId, 'channels', channel.channelId, 'messages'),
						orderBy('createdAt', 'desc'),
						limit(MESSAGES_PER_CHANNEL)
					);
					
					const messagesSnap = await getDocs(messagesQuery);
					
					const messages: PriorityCachedMessage[] = messagesSnap.docs.map(msgDoc => {
						const data = msgDoc.data();
						return {
							id: msgDoc.id,
							serverId: channel.serverId,
							channelId: channel.channelId,
							uid: data.uid ?? '',
							text: data.text,
							content: data.content,
							createdAt: data.createdAt,
							displayName: data.displayName,
							photoURL: data.photoURL,
							...data
						};
					});
					
					priorityMessages.set(key, messages);
					
					// Also update the main message cache
					const { updateChannelCache } = await import('./messageCache');
					updateChannelCache(channel.serverId, channel.channelId, messages);
					
					preloadProgress.update(p => ({ ...p, messagesLoaded: p.messagesLoaded + 1 }));
				} catch {
					// Ignore individual channel errors
					preloadProgress.update(p => ({ ...p, messagesLoaded: p.messagesLoaded + 1 }));
				}
			});
			
			// Run each round in parallel (but rounds are sequential)
			await Promise.all(messagePromises);
		}
		
		// 6. Preload DM threads (first 10 most recent) with user names
		const preloadedDMs: PriorityCachedDM[] = [];
		try {
			const dmsQuery = query(
				collection(db, 'profiles', userId, 'dms'),
				orderBy('updatedAt', 'desc'),
				limit(MAX_DMS_TO_PRELOAD)
			);
			const dmsSnap = await getDocs(dmsQuery);
			
			// Collect all unique other UIDs to fetch profiles
			const otherUids = new Set<string>();
			const dmDataList: Array<{ id: string; data: any }> = [];
			
			for (const dmDoc of dmsSnap.docs) {
				const data = dmDoc.data();
				if (!data.hidden) {
					dmDataList.push({ id: dmDoc.id, data });
					if (data.otherUid && !data.isGroup) {
						otherUids.add(data.otherUid);
					}
				}
			}
			
			// Batch fetch profiles for all other UIDs
			const profileMap = new Map<string, { name?: string; displayName?: string; email?: string; photoURL?: string }>();
			if (otherUids.size > 0) {
				const profilePromises = Array.from(otherUids).map(async (uid) => {
					try {
						const profileDoc = await getDoc(doc(db, 'profiles', uid));
						if (profileDoc.exists()) {
							const pData = profileDoc.data();
							profileMap.set(uid, {
								name: pData.name ?? null,
								displayName: pData.displayName ?? null,
								email: pData.email ?? null,
								photoURL: pData.photoURL ?? null
							});
						}
					} catch {
						// Ignore individual profile fetch errors
					}
				});
				await Promise.all(profilePromises);
			}
			
			// Build preloaded DMs with profile data
			for (const { id, data } of dmDataList) {
				const otherUid = data.otherUid ?? null;
				const profile = otherUid ? profileMap.get(otherUid) : null;
				
				preloadedDMs.push({
					id,
					participants: data.participants ?? [],
					otherUid,
					lastMessage: data.lastMessage ?? null,
					updatedAt: data.updatedAt ?? null,
					isGroup: data.isGroup ?? false,
					groupName: data.groupName ?? data.name ?? null,
					iconURL: data.iconURL ?? null,
					// Add profile data for instant name display
					otherName: profile?.name ?? data.otherName ?? null,
					otherDisplayName: profile?.displayName ?? data.otherDisplayName ?? null,
					otherEmail: profile?.email ?? data.otherEmail ?? null,
					otherPhotoURL: profile?.photoURL ?? data.otherPhotoURL ?? null
				});
			}
			
			// Store in dmRailCache for instant access
			if (preloadedDMs.length > 0) {
				const { dmRailCache } = await import('./dmRailCache');
				dmRailCache.set(userId, preloadedDMs);
				
				// Also persist to localStorage for instant restore on refresh
				try {
					localStorage.setItem(`dm-rail:${userId}`, JSON.stringify(preloadedDMs));
				} catch {
					// Ignore storage errors
				}
			}
		} catch (dmErr) {
			console.warn('[splashPreload] Failed to preload DMs:', dmErr);
		}
		
		// 7. Save to persistent cache for next app load
		const allMessages: PriorityCachedMessage[] = [];
		for (const [, msgs] of priorityMessages) {
			allMessages.push(...msgs);
		}
		
		savePriorityCache({
			servers,
			channels: allChannels,
			messages: allMessages,
			dms: preloadedDMs,
			lastUpdated: Date.now()
		});
		
		preloadComplete = true;
		preloadProgress.update(p => ({
			...p,
			phase: 'complete',
			channelsReady: true,  // Ensure this is true on completion
			endTime: Date.now()
		}));
		
		console.log(`[splashPreload] Complete in ${Date.now() - startTime}ms - ${servers.length} servers, ${allChannels.length} channels, ${allMessages.length} messages`);
		
	} catch (err) {
		console.error('[splashPreload] Error during preload:', err);
		// Even on error, mark as ready so splash can dismiss
		preloadProgress.update(p => ({
			...p,
			phase: 'complete',
			channelsReady: true,  // Allow splash to dismiss even on error
			endTime: Date.now()
		}));
	}
}

/**
 * Check if preload has completed
 */
export function isPreloadComplete(): boolean {
	return preloadComplete;
}

/**
 * Reset preload state (call on logout)
 */
export function resetPreloadState(): void {
	preloadStarted = false;
	preloadComplete = false;
	clearPriorityChannels();
	priorityMessages.clear();
	serverIconCache.clear();
	preloadProgress.set({
		phase: 'idle',
		serversLoaded: 0,
		totalServers: 0,
		channelsLoaded: 0,
		totalChannels: 0,
		messagesLoaded: 0,
		totalMessages: 0,
		channelsReady: false,
		startTime: 0
	});
	
	// Clear localStorage cache
	if (typeof window !== 'undefined') {
		try {
			localStorage.removeItem(PRIORITY_CACHE_KEY);
		} catch {
			// Ignore
		}
	}
}

