/**
 * Slack Integration Store
 * Manages Slack workspace connections and channel bridges
 */

import { writable, derived, get } from 'svelte/store';
import { getDb, ensureFirebaseReady } from '$lib/firebase';
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
import type {
	SlackWorkspace,
	SlackChannelBridge,
	SlackIntegrationConfig
} from './types';

// ============ Stores ============

const defaultConfig: SlackIntegrationConfig = {
	enabled: false,
	workspaces: [],
	bridges: [],
	globalSettings: {
		defaultSyncDirection: 'bidirectional',
		defaultSyncReactions: true,
		defaultSyncThreads: true,
		defaultSyncAttachments: true,
		rateLimitPerMinute: 60
	}
};

export const slackConfigStore = writable<SlackIntegrationConfig>(defaultConfig);
export const slackWorkspacesStore = writable<SlackWorkspace[]>([]);
export const slackBridgesStore = writable<SlackChannelBridge[]>([]);
export const slackLoadingStore = writable(false);
export const slackErrorStore = writable<string | null>(null);

// Derived store for quick status checks
export const slackStatusStore = derived(
	[slackConfigStore, slackWorkspacesStore, slackBridgesStore],
	([$config, $workspaces, $bridges]) => ({
		enabled: $config.enabled,
		workspaceCount: $workspaces.length,
		bridgeCount: $bridges.length,
		activeBridges: $bridges.filter(b => b.status === 'active').length,
		hasErrors: $bridges.some(b => b.status === 'error')
	})
);

// ============ Firestore Paths ============

const SLACK_CONFIG_DOC = 'integrations/slack';
const SLACK_WORKSPACES_COL = 'integrations/slack/workspaces';
const SLACK_BRIDGES_COL = 'integrations/slack/bridges';

// ============ Load Functions ============

export async function loadSlackConfig(): Promise<SlackIntegrationConfig> {
	slackLoadingStore.set(true);
	slackErrorStore.set(null);

	try {
		await ensureFirebaseReady();
		const db = getDb();
		const configDoc = await getDoc(doc(db, SLACK_CONFIG_DOC));
		
		if (configDoc.exists()) {
			const data = configDoc.data() as Partial<SlackIntegrationConfig>;
			const config: SlackIntegrationConfig = {
				...defaultConfig,
				...data,
				globalSettings: {
					...defaultConfig.globalSettings,
					...(data.globalSettings ?? {})
				}
			};
			slackConfigStore.set(config);
			return config;
		}
		
		return defaultConfig;
	} catch (err) {
		console.error('[slack-store] Failed to load config:', err);
		slackErrorStore.set((err as Error)?.message ?? 'Failed to load Slack configuration');
		return defaultConfig;
	} finally {
		slackLoadingStore.set(false);
	}
}

export async function loadSlackWorkspaces(): Promise<SlackWorkspace[]> {
	try {
		await ensureFirebaseReady();
		const db = getDb();
		const snapshot = await getDocs(collection(db, SLACK_WORKSPACES_COL));
		
		const workspaces = snapshot.docs.map(d => ({
			id: d.id,
			...d.data()
		})) as SlackWorkspace[];
		
		slackWorkspacesStore.set(workspaces);
		return workspaces;
	} catch (err) {
		console.error('[slack-store] Failed to load workspaces:', err);
		return [];
	}
}

export async function loadSlackBridges(): Promise<SlackChannelBridge[]> {
	try {
		await ensureFirebaseReady();
		const db = getDb();
		const snapshot = await getDocs(
			query(collection(db, SLACK_BRIDGES_COL), orderBy('createdAt', 'desc'))
		);
		
		const bridges = snapshot.docs.map(d => ({
			id: d.id,
			...d.data()
		})) as SlackChannelBridge[];
		
		slackBridgesStore.set(bridges);
		return bridges;
	} catch (err) {
		console.error('[slack-store] Failed to load bridges:', err);
		return [];
	}
}

export async function loadAllSlackData() {
	slackLoadingStore.set(true);
	try {
		await Promise.all([
			loadSlackConfig(),
			loadSlackWorkspaces(),
			loadSlackBridges()
		]);
	} finally {
		slackLoadingStore.set(false);
	}
}

// ============ Real-time Subscriptions ============

let configUnsubscribe: (() => void) | null = null;
let bridgesUnsubscribe: (() => void) | null = null;

export function subscribeToSlackConfig(callback?: (config: SlackIntegrationConfig) => void) {
	if (configUnsubscribe) configUnsubscribe();

	ensureFirebaseReady().then(() => {
		const db = getDb();
		configUnsubscribe = onSnapshot(
			doc(db, SLACK_CONFIG_DOC),
			(snapshot) => {
				if (snapshot.exists()) {
					const data = snapshot.data() as Partial<SlackIntegrationConfig>;
					const config: SlackIntegrationConfig = {
						...defaultConfig,
						...data,
						globalSettings: {
							...defaultConfig.globalSettings,
							...(data.globalSettings ?? {})
						}
					};
					slackConfigStore.set(config);
					callback?.(config);
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

export function subscribeToSlackBridges(callback?: (bridges: SlackChannelBridge[]) => void) {
	if (bridgesUnsubscribe) bridgesUnsubscribe();

	ensureFirebaseReady().then(() => {
		const db = getDb();
		bridgesUnsubscribe = onSnapshot(
			query(collection(db, SLACK_BRIDGES_COL), orderBy('createdAt', 'desc')),
			(snapshot) => {
				const bridges = snapshot.docs.map(d => ({
					id: d.id,
					...d.data()
				})) as SlackChannelBridge[];
				slackBridgesStore.set(bridges);
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

// ============ Update Functions ============

export async function updateSlackConfig(updates: Partial<SlackIntegrationConfig>): Promise<void> {
	await ensureFirebaseReady();
	const db = getDb();
	const docRef = doc(db, SLACK_CONFIG_DOC);
	
	const existing = await getDoc(docRef);
	if (existing.exists()) {
		await updateDoc(docRef, {
			...updates,
			updatedAt: Timestamp.now()
		});
	} else {
		await setDoc(docRef, {
			...defaultConfig,
			...updates,
			createdAt: Timestamp.now(),
			updatedAt: Timestamp.now()
		});
	}
}

export async function toggleSlackIntegration(enabled: boolean): Promise<void> {
	await updateSlackConfig({ enabled });
}

export async function updateGlobalSettings(
	settings: Partial<SlackIntegrationConfig['globalSettings']>
): Promise<void> {
	const current = get(slackConfigStore);
	await updateSlackConfig({
		globalSettings: {
			...current.globalSettings,
			...settings
		}
	});
}

// ============ Workspace Functions ============

export async function addSlackWorkspace(workspace: Omit<SlackWorkspace, 'id'>): Promise<string> {
	await ensureFirebaseReady();
	const db = getDb();
	const workspaceRef = doc(collection(db, SLACK_WORKSPACES_COL));
	
	await setDoc(workspaceRef, {
		...workspace,
		installedAt: Timestamp.now()
	});
	
	await loadSlackWorkspaces();
	return workspaceRef.id;
}

export async function removeSlackWorkspace(workspaceId: string): Promise<void> {
	await ensureFirebaseReady();
	const db = getDb();
	
	// First, remove all bridges for this workspace
	const bridges = get(slackBridgesStore).filter(b => b.slackWorkspaceId === workspaceId);
	await Promise.all(bridges.map(b => deleteDoc(doc(db, SLACK_BRIDGES_COL, b.id))));
	
	// Then remove the workspace
	await deleteDoc(doc(db, SLACK_WORKSPACES_COL, workspaceId));
	await loadSlackWorkspaces();
	await loadSlackBridges();
}

// ============ Bridge Functions ============

export async function createSlackBridge(
	bridge: Omit<SlackChannelBridge, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
	await ensureFirebaseReady();
	const db = getDb();
	const bridgeRef = doc(collection(db, SLACK_BRIDGES_COL));
	
	await setDoc(bridgeRef, {
		...bridge,
		createdAt: Timestamp.now(),
		updatedAt: Timestamp.now()
	});
	
	await loadSlackBridges();
	return bridgeRef.id;
}

export async function updateSlackBridge(
	bridgeId: string,
	updates: Partial<SlackChannelBridge>
): Promise<void> {
	await ensureFirebaseReady();
	const db = getDb();
	await updateDoc(doc(db, SLACK_BRIDGES_COL, bridgeId), {
		...updates,
		updatedAt: Timestamp.now()
	});
}

export async function deleteSlackBridge(bridgeId: string): Promise<void> {
	await ensureFirebaseReady();
	const db = getDb();
	await deleteDoc(doc(db, SLACK_BRIDGES_COL, bridgeId));
	await loadSlackBridges();
}

export async function pauseSlackBridge(bridgeId: string): Promise<void> {
	await updateSlackBridge(bridgeId, { status: 'paused' });
}

export async function resumeSlackBridge(bridgeId: string): Promise<void> {
	await updateSlackBridge(bridgeId, { status: 'active' });
}

// ============ Utility Functions ============

export function getBridgesForServer(serverId: string): SlackChannelBridge[] {
	return get(slackBridgesStore).filter(b => b.hconnectServerId === serverId);
}

export function getBridgesForChannel(serverId: string, channelId: string): SlackChannelBridge[] {
	return get(slackBridgesStore).filter(
		b => b.hconnectServerId === serverId && b.hconnectChannelId === channelId
	);
}

export function getWorkspaceById(workspaceId: string): SlackWorkspace | undefined {
	return get(slackWorkspacesStore).find(w => w.id === workspaceId);
}
