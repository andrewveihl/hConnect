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
  pushChannelMentionsOnly: boolean;
  emailEnabled: boolean;
  emailForDMs: boolean;
  emailForMentions: boolean;
  emailForChannelMessages: boolean;
  emailForAllChannelMessages: boolean;
  emailChannelMentionsOnly: boolean;
  emailOnlyWhenNoPush: boolean;
  doNotDisturbUntil: number | null;
};

const SETTINGS_DOC_ID = 'preferences';
const SUBCOLLECTION = 'notificationSettings';

export const defaultNotificationSettings: NotificationSettings = {
	globalMute: false,
	muteDMs: false,
	muteServerIds: [],
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
  pushChannelMentionsOnly: false,
  emailEnabled: false,
  emailForDMs: true,
  emailForMentions: true,
  emailForChannelMessages: false,
  emailForAllChannelMessages: false,
  emailChannelMentionsOnly: false,
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
