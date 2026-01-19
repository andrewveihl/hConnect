import {
	doc,
	getDoc,
	onSnapshot,
	serverTimestamp,
	setDoc,
	type Unsubscribe
} from 'firebase/firestore';

import { ensureFirebaseReady, getDb } from '$lib/firebase';

export type NotificationSettings = {
	globalMute: boolean;
	muteDMs: boolean;
	muteServerIds: string[];
	muteCategoryIds: Record<string, boolean>; // key format: "serverId/categoryId"
	perChannelMute: Record<string, boolean>;
	perRoleMute: Record<string, boolean>;
	allowMentionPush: boolean;
	allowDMPreview: boolean;
	allowActivityBadges: boolean;
	allowThreadPush: boolean;
 allowRoleMentionPush: boolean;
 allowHereMentionPush: boolean;
 allowEveryoneMentionPush: boolean;
 allowChannelMessagePush: boolean;
  emailEnabled: boolean;
  emailForDMs: boolean;
  emailForMentions: boolean;
  emailForChannelMessages: boolean;
  emailOnlyWhenNoPush: boolean;
  doNotDisturbUntil: number | null;
};

const SETTINGS_DOC_ID = 'preferences';
const SUBCOLLECTION = 'notificationSettings';

export const defaultNotificationSettings: NotificationSettings = {
	globalMute: false,
	muteDMs: false,
	muteServerIds: [],
	muteCategoryIds: {},
	perChannelMute: {},
	perRoleMute: {},
	allowMentionPush: true,
	allowDMPreview: true,
	allowActivityBadges: true,
	allowThreadPush: true,
  allowRoleMentionPush: true,
  allowHereMentionPush: true,
  allowEveryoneMentionPush: true,
  allowChannelMessagePush: true,
  emailEnabled: false,
  emailForDMs: true,
  emailForMentions: true,
  emailForChannelMessages: false,
  emailOnlyWhenNoPush: true,
  doNotDisturbUntil: null
};

function settingsDocRef(uid: string) {
	const db = getDb();
	return doc(db, 'profiles', uid, SUBCOLLECTION, SETTINGS_DOC_ID);
}

export async function ensureNotificationSettings(uid: string) {
	await ensureFirebaseReady();
	const ref = settingsDocRef(uid);
	const snap = await getDoc(ref);
	if (!snap.exists()) {
		await setDoc(
			ref,
			{
				...defaultNotificationSettings,
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp()
			},
			{ merge: true }
		);
	}
}

const mergeSettings = (
	source: Partial<NotificationSettings> | undefined | null
): NotificationSettings => {
	return {
		...defaultNotificationSettings,
		...(source ?? {})
	};
};

export async function getNotificationSettings(uid: string): Promise<NotificationSettings> {
	await ensureNotificationSettings(uid);
	const ref = settingsDocRef(uid);
	const snap = await getDoc(ref);
	return mergeSettings((snap.data() as NotificationSettings | undefined) ?? undefined);
}

export async function updateNotificationSettings(
	uid: string,
	patch: Partial<NotificationSettings>
): Promise<void> {
	await ensureFirebaseReady();
	const ref = settingsDocRef(uid);
	await setDoc(
		ref,
		{
			...patch,
			updatedAt: serverTimestamp()
		},
		{ merge: true }
	);
}

export function subscribeNotificationSettings(
	uid: string,
	cb: (settings: NotificationSettings) => void
): Unsubscribe {
	const ref = settingsDocRef(uid);
	return onSnapshot(ref, (snap) => {
		cb(mergeSettings((snap.data() as NotificationSettings | undefined) ?? undefined));
	});
}

// ============ Mute Helper Functions ============

export function perChannelKey(serverId: string, channelId: string): string {
	return `${serverId}/${channelId}`;
}

export function perCategoryKey(serverId: string, categoryId: string): string {
	return `${serverId}/${categoryId}`;
}

/**
 * Toggle mute for an entire server
 */
export async function toggleServerMute(uid: string, serverId: string, muted: boolean): Promise<void> {
	await ensureFirebaseReady();
	const settings = await getNotificationSettings(uid);
	const muteServerIds = settings.muteServerIds ?? [];
	
	let newMuteServerIds: string[];
	if (muted) {
		// Add to mute list if not already present
		newMuteServerIds = muteServerIds.includes(serverId) ? muteServerIds : [...muteServerIds, serverId];
	} else {
		// Remove from mute list
		newMuteServerIds = muteServerIds.filter((id) => id !== serverId);
	}
	
	await updateNotificationSettings(uid, { muteServerIds: newMuteServerIds });
}

/**
 * Toggle mute for a category (folder)
 */
export async function toggleCategoryMute(
	uid: string,
	serverId: string,
	categoryId: string,
	muted: boolean
): Promise<void> {
	await ensureFirebaseReady();
	const settings = await getNotificationSettings(uid);
	const muteCategoryIds = { ...(settings.muteCategoryIds ?? {}) };
	const key = perCategoryKey(serverId, categoryId);
	
	if (muted) {
		muteCategoryIds[key] = true;
	} else {
		delete muteCategoryIds[key];
	}
	
	await updateNotificationSettings(uid, { muteCategoryIds });
}

/**
 * Toggle mute for a single channel
 */
export async function toggleChannelMute(
	uid: string,
	serverId: string,
	channelId: string,
	muted: boolean
): Promise<void> {
	await ensureFirebaseReady();
	const settings = await getNotificationSettings(uid);
	const perChannelMute = { ...(settings.perChannelMute ?? {}) };
	const key = perChannelKey(serverId, channelId);
	
	if (muted) {
		perChannelMute[key] = true;
	} else {
		delete perChannelMute[key];
	}
	
	await updateNotificationSettings(uid, { perChannelMute });
}

/**
 * Check if a server is muted
 */
export function isServerMuted(settings: NotificationSettings, serverId: string): boolean {
	return settings.muteServerIds?.includes(serverId) ?? false;
}

/**
 * Check if a category (folder) is muted
 */
export function isCategoryMuted(settings: NotificationSettings, serverId: string, categoryId: string): boolean {
	const key = perCategoryKey(serverId, categoryId);
	return settings.muteCategoryIds?.[key] === true;
}

/**
 * Check if a channel is muted (directly or via category/server)
 */
export function isChannelMuted(
	settings: NotificationSettings,
	serverId: string,
	channelId: string,
	categoryId?: string | null
): boolean {
	// Check if server is muted
	if (isServerMuted(settings, serverId)) return true;
	
	// Check if category is muted
	if (categoryId && isCategoryMuted(settings, serverId, categoryId)) return true;
	
	// Check if channel is directly muted
	const key = perChannelKey(serverId, channelId);
	return settings.perChannelMute?.[key] === true;
}
