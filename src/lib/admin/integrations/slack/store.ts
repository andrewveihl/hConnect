/**
 * Slack Integration Store (Per-Server)
 * Each server has its own Slack app configuration
 */

import { writable, derived, get } from 'svelte/store';
import { getDb, ensureFirebaseReady, getFunctionsClient } from '$lib/firebase';
import {
	collection,
	doc,
	getDoc,
	getDocs,
	setDoc,
	updateDoc,
	deleteDoc,
	onSnapshot,
	query,
	orderBy,
	Timestamp
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type {
	SlackWorkspace,
	SlackChannelBridge,
	ServerSlackConfig,
	SlackAppCredentials
} from './types';
import {
	getServerSlackConfigPath,
	getServerSlackWorkspacesPath,
	getServerSlackBridgesPath
} from './types';

// ============ Slack Channel Type ============

export interface SlackChannelInfo {
	id: string;
	name: string;
	is_private: boolean;
	is_member: boolean;
	num_members?: number;
	topic?: string;
	purpose?: string;
}

// ============ Stores ============

const defaultServerConfig: ServerSlackConfig = {
	enabled: false,
	defaultSyncDirection: 'bidirectional',
	defaultSyncReactions: true,
	defaultSyncThreads: false,
	defaultSyncAttachments: true
};

// Current server context
export const currentServerIdStore = writable<string | null>(null);
export const serverSlackConfigStore = writable<ServerSlackConfig>(defaultServerConfig);
export const serverSlackWorkspacesStore = writable<SlackWorkspace[]>([]);
export const serverSlackBridgesStore = writable<SlackChannelBridge[]>([]);
export const slackLoadingStore = writable(false);
export const slackErrorStore = writable<string | null>(null);

// Derived store for quick status checks
export const slackStatusStore = derived(
	[serverSlackConfigStore, serverSlackWorkspacesStore, serverSlackBridgesStore],
	([$config, $workspaces, $bridges]) => ({
		enabled: $config.enabled,
		hasCredentials: !!$config.credentials?.clientId,
		workspaceCount: $workspaces.length,
		bridgeCount: $bridges.length,
		activeBridges: $bridges.filter(b => b.status === 'active').length,
		hasErrors: $bridges.some(b => b.status === 'error')
	})
);

// Legacy exports for backwards compatibility
export const slackConfigStore = serverSlackConfigStore;
export const slackWorkspacesStore = serverSlackWorkspacesStore;
export const slackBridgesStore = serverSlackBridgesStore;

// ============ Load Functions (Per-Server) ============

export async function loadServerSlackConfig(serverId: string): Promise<ServerSlackConfig> {
	slackLoadingStore.set(true);
	slackErrorStore.set(null);
	currentServerIdStore.set(serverId);

	try {
		await ensureFirebaseReady();
		const db = getDb();
		const configPath = getServerSlackConfigPath(serverId);
		const configDoc = await getDoc(doc(db, configPath));
		
		if (configDoc.exists()) {
			const data = configDoc.data() as Partial<ServerSlackConfig>;
			const config: ServerSlackConfig = {
				...defaultServerConfig,
				...data
			};
			serverSlackConfigStore.set(config);
			return config;
		}
		
		serverSlackConfigStore.set(defaultServerConfig);
		return defaultServerConfig;
	} catch (err) {
		console.error('[slack-store] Failed to load server config:', err);
		slackErrorStore.set((err as Error)?.message ?? 'Failed to load Slack configuration');
		return defaultServerConfig;
	} finally {
		slackLoadingStore.set(false);
	}
}

export async function loadServerSlackWorkspaces(serverId: string): Promise<SlackWorkspace[]> {
	try {
		await ensureFirebaseReady();
		const db = getDb();
		const workspacesPath = getServerSlackWorkspacesPath(serverId);
		const snapshot = await getDocs(collection(db, workspacesPath));
		
		const workspaces = snapshot.docs.map(d => ({
			id: d.id,
			serverId,
			...d.data()
		})) as SlackWorkspace[];
		
		serverSlackWorkspacesStore.set(workspaces);
		return workspaces;
	} catch (err) {
		console.error('[slack-store] Failed to load workspaces:', err);
		return [];
	}
}

export async function loadServerSlackBridges(serverId: string): Promise<SlackChannelBridge[]> {
	try {
		await ensureFirebaseReady();
		const db = getDb();
		const bridgesPath = getServerSlackBridgesPath(serverId);
		const snapshot = await getDocs(
			query(collection(db, bridgesPath), orderBy('createdAt', 'desc'))
		);
		
		const bridges = snapshot.docs.map(d => ({
			id: d.id,
			...d.data()
		})) as SlackChannelBridge[];
		
		serverSlackBridgesStore.set(bridges);
		return bridges;
	} catch (err) {
		console.error('[slack-store] Failed to load bridges:', err);
		return [];
	}
}

export async function loadAllServerSlackData(serverId: string) {
	slackLoadingStore.set(true);
	currentServerIdStore.set(serverId);
	try {
		await Promise.all([
			loadServerSlackConfig(serverId),
			loadServerSlackWorkspaces(serverId),
			loadServerSlackBridges(serverId)
		]);
	} finally {
		slackLoadingStore.set(false);
	}
}

// Legacy function name for backwards compatibility
export const loadAllSlackData = async () => {
	const serverId = get(currentServerIdStore);
	if (serverId) {
		await loadAllServerSlackData(serverId);
	}
};

// ============ Real-time Subscriptions (Per-Server) ============

let configUnsubscribe: (() => void) | null = null;
let bridgesUnsubscribe: (() => void) | null = null;
let workspacesUnsubscribe: (() => void) | null = null;

export function subscribeToServerSlackConfig(serverId: string, callback?: (config: ServerSlackConfig) => void) {
	if (configUnsubscribe) configUnsubscribe();

	ensureFirebaseReady().then(() => {
		const db = getDb();
		const configPath = getServerSlackConfigPath(serverId);
		configUnsubscribe = onSnapshot(
			doc(db, configPath),
			(snapshot) => {
				if (snapshot.exists()) {
					const data = snapshot.data() as Partial<ServerSlackConfig>;
					const config: ServerSlackConfig = {
						...defaultServerConfig,
						...data
					};
					serverSlackConfigStore.set(config);
					callback?.(config);
				} else {
					serverSlackConfigStore.set(defaultServerConfig);
				}
			},
			(err) => {
				console.error('[slack-store] Config subscription error:', err);
			}
		);
	});

	return () => {
		configUnsubscribe?.();
		configUnsubscribe = null;
	};
}

export function subscribeToServerSlackBridges(serverId: string, callback?: (bridges: SlackChannelBridge[]) => void) {
	if (bridgesUnsubscribe) bridgesUnsubscribe();

	ensureFirebaseReady().then(() => {
		const db = getDb();
		const bridgesPath = getServerSlackBridgesPath(serverId);
		bridgesUnsubscribe = onSnapshot(
			query(collection(db, bridgesPath), orderBy('createdAt', 'desc')),
			(snapshot) => {
				const bridges = snapshot.docs.map(d => ({
					id: d.id,
					...d.data()
				})) as SlackChannelBridge[];
				serverSlackBridgesStore.set(bridges);
				callback?.(bridges);
			},
			(err) => {
				console.error('[slack-store] Bridges subscription error:', err);
			}
		);
	});

	return () => {
		bridgesUnsubscribe?.();
		bridgesUnsubscribe = null;
	};
}

export function subscribeToServerSlackWorkspaces(serverId: string, callback?: (workspaces: SlackWorkspace[]) => void) {
	if (workspacesUnsubscribe) workspacesUnsubscribe();

	ensureFirebaseReady().then(() => {
		const db = getDb();
		const workspacesPath = getServerSlackWorkspacesPath(serverId);
		workspacesUnsubscribe = onSnapshot(
			collection(db, workspacesPath),
			(snapshot) => {
				const workspaces = snapshot.docs.map(d => ({
					id: d.id,
					serverId,
					...d.data()
				})) as SlackWorkspace[];
				serverSlackWorkspacesStore.set(workspaces);
				callback?.(workspaces);
			},
			(err) => {
				console.error('[slack-store] Workspaces subscription error:', err);
			}
		);
	});

	return () => {
		workspacesUnsubscribe?.();
		workspacesUnsubscribe = null;
	};
}

// Legacy function for backwards compatibility
export function subscribeToSlackBridges(callback?: (bridges: SlackChannelBridge[]) => void) {
	const serverId = get(currentServerIdStore);
	if (serverId) {
		return subscribeToServerSlackBridges(serverId, callback);
	}
	return () => {};
}

// ============ Update Functions (Per-Server) ============

export async function updateServerSlackConfig(serverId: string, updates: Partial<ServerSlackConfig>): Promise<void> {
	await ensureFirebaseReady();
	const db = getDb();
	const configPath = getServerSlackConfigPath(serverId);
	const docRef = doc(db, configPath);
	
	const existing = await getDoc(docRef);
	if (existing.exists()) {
		await updateDoc(docRef, {
			...updates,
			updatedAt: Timestamp.now()
		});
	} else {
		await setDoc(docRef, {
			...defaultServerConfig,
			...updates,
			configuredAt: Timestamp.now(),
			updatedAt: Timestamp.now()
		});
	}
	
	// Update local store
	const currentConfig = get(serverSlackConfigStore);
	serverSlackConfigStore.set({ ...currentConfig, ...updates });
}

export async function saveSlackCredentials(serverId: string, credentials: SlackAppCredentials): Promise<void> {
	await updateServerSlackConfig(serverId, { credentials });
}

export async function toggleSlackIntegration(enabled: boolean): Promise<void> {
	const serverId = get(currentServerIdStore);
	if (serverId) {
		await updateServerSlackConfig(serverId, { enabled });
	}
}

// ============ Workspace Functions (Per-Server) ============

export async function addServerSlackWorkspace(serverId: string, workspace: Omit<SlackWorkspace, 'id' | 'serverId'>): Promise<string> {
	await ensureFirebaseReady();
	const db = getDb();
	const workspacesPath = getServerSlackWorkspacesPath(serverId);
	const workspaceRef = doc(collection(db, workspacesPath));
	
	await setDoc(workspaceRef, {
		...workspace,
		serverId,
		installedAt: Timestamp.now()
	});
	
	await loadServerSlackWorkspaces(serverId);
	return workspaceRef.id;
}

export async function removeServerSlackWorkspace(serverId: string, workspaceId: string): Promise<void> {
	await ensureFirebaseReady();
	const db = getDb();
	
	// First, remove all bridges for this workspace
	const bridges = get(serverSlackBridgesStore).filter(b => b.slackWorkspaceId === workspaceId);
	const bridgesPath = getServerSlackBridgesPath(serverId);
	await Promise.all(bridges.map(b => deleteDoc(doc(db, bridgesPath, b.id))));
	
	// Then remove the workspace
	const workspacesPath = getServerSlackWorkspacesPath(serverId);
	await deleteDoc(doc(db, workspacesPath, workspaceId));
	await loadServerSlackWorkspaces(serverId);
	await loadServerSlackBridges(serverId);
}

// ============ Bridge Functions (Per-Server) ============

export async function createSlackBridge(
	bridge: Omit<SlackChannelBridge, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
	await ensureFirebaseReady();
	const db = getDb();
	const serverId = bridge.hconnectServerId;
	const bridgesPath = getServerSlackBridgesPath(serverId);
	const bridgeRef = doc(collection(db, bridgesPath));
	
	await setDoc(bridgeRef, {
		...bridge,
		createdAt: Timestamp.now(),
		updatedAt: Timestamp.now()
	});
	
	await loadServerSlackBridges(serverId);
	return bridgeRef.id;
}

export async function updateSlackBridge(
	serverId: string,
	bridgeId: string,
	updates: Partial<SlackChannelBridge>
): Promise<void> {
	await ensureFirebaseReady();
	const db = getDb();
	const bridgesPath = getServerSlackBridgesPath(serverId);
	await updateDoc(doc(db, bridgesPath, bridgeId), {
		...updates,
		updatedAt: Timestamp.now()
	});
}

export async function deleteSlackBridge(bridgeId: string): Promise<void> {
	const serverId = get(currentServerIdStore);
	if (!serverId) return;
	
	await ensureFirebaseReady();
	const db = getDb();
	const bridgesPath = getServerSlackBridgesPath(serverId);
	await deleteDoc(doc(db, bridgesPath, bridgeId));
	await loadServerSlackBridges(serverId);
}

export async function pauseSlackBridge(bridgeId: string): Promise<void> {
	const serverId = get(currentServerIdStore);
	if (serverId) {
		await updateSlackBridge(serverId, bridgeId, { status: 'paused' });
		await loadServerSlackBridges(serverId);
	}
}

export async function resumeSlackBridge(bridgeId: string): Promise<void> {
	const serverId = get(currentServerIdStore);
	if (serverId) {
		await updateSlackBridge(serverId, bridgeId, { status: 'active' });
		await loadServerSlackBridges(serverId);
	}
}

// ============ Utility Functions ============

export function getBridgesForServer(serverId: string): SlackChannelBridge[] {
	return get(serverSlackBridgesStore).filter(b => b.hconnectServerId === serverId);
}

export function getBridgesForChannel(serverId: string, channelId: string): SlackChannelBridge[] {
	return get(serverSlackBridgesStore).filter(
		b => b.hconnectServerId === serverId && b.hconnectChannelId === channelId
	);
}

export function getWorkspaceById(workspaceId: string): SlackWorkspace | undefined {
	return get(serverSlackWorkspacesStore).find(w => w.id === workspaceId);
}

/**
 * Generate OAuth URL for connecting a Slack workspace
 * Uses the per-server credentials
 */
export function generateSlackOAuthUrl(serverId: string, clientId: string): string {
	const redirectUri = encodeURIComponent(
		`https://slackoauth-xpac7ukbha-uc.a.run.app`
	);
	const scopes = encodeURIComponent([
		'channels:history',
		'channels:read',
		'chat:write',
		'chat:write.customize',
		'files:read',
		'groups:history',
		'groups:read',
		'reactions:read',
		'reactions:write',
		'team:read',
		'users:read'
	].join(','));
	// Include serverId in state so OAuth callback knows which server to update
	const state = encodeURIComponent(JSON.stringify({
		serverId,
		returnUrl: window.location.href
	}));

	return `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;
}

// ============ Slack Channel Fetching ============

/**
 * Fetch list of Slack channels from a workspace
 */
export async function fetchSlackChannels(
	serverId: string,
	workspaceId: string
): Promise<SlackChannelInfo[]> {
	try {
		await ensureFirebaseReady();
		const functions = await getFunctionsClient();
		const getChannels = httpsCallable<
			{ serverId: string; workspaceId: string },
			{ channels: SlackChannelInfo[] }
		>(functions, 'getSlackChannels');

		const result = await getChannels({ serverId, workspaceId });
		return result.data.channels;
	} catch (err) {
		console.error('[slack-store] Failed to fetch Slack channels:', err);
		throw err;
	}
}
