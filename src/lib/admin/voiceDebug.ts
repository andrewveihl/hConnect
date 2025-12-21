import { ensureFirebaseReady } from '$lib/firebase';
import { db } from '$lib/firestore/client';
import { readable, type Readable } from 'svelte/store';
import {
	doc,
	getDoc,
	onSnapshot,
	serverTimestamp,
	setDoc,
	deleteField
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { logAdminAction } from './logs';

export type VoiceDebugAssignment = {
	email: string;
	addedBy?: string | null;
	addedAt?: Date | null;
	note?: string | null;
};

export type VoiceDebugConfig = {
	enabled: boolean;
	assignedEmails: Record<string, VoiceDebugAssignment>;
	updatedAt?: Date | null;
};

const voiceDebugRef = () => doc(db(), 'appConfig', 'voiceDebug');

const normalizeEmail = (value?: string | null) =>
	typeof value === 'string' ? value.trim().toLowerCase() : null;

const readTimestamp = (value: unknown): Date | null => {
	const maybe = value as { toDate?: () => Date } | null | undefined;
	if (maybe?.toDate && typeof maybe.toDate === 'function') {
		try {
			return maybe.toDate();
		} catch {
			return null;
		}
	}
	return null;
};

function normalizeConfig(raw: Record<string, unknown> | null): VoiceDebugConfig {
	const assigned = (raw?.assignedEmails as Record<string, any> | undefined) ?? {};
	const normalized: Record<string, VoiceDebugAssignment> = {};
	for (const [key, value] of Object.entries(assigned)) {
		const email = normalizeEmail(key);
		if (!email) continue;
		normalized[email] = {
			email,
			addedBy: value?.addedBy ?? null,
			addedAt: readTimestamp(value?.addedAt),
			note: value?.note ?? null
		};
	}
	return {
		enabled: Boolean(raw?.enabled),
		assignedEmails: normalized,
		updatedAt: readTimestamp(raw?.updatedAt)
	};
}

export async function fetchVoiceDebugConfig(): Promise<VoiceDebugConfig> {
	await ensureFirebaseReady();
	const snap = await getDoc(voiceDebugRef());
	return normalizeConfig((snap.exists() ? snap.data() : {}) as Record<string, unknown>);
}

export function voiceDebugConfigStore(): Readable<VoiceDebugConfig> {
	return readable<VoiceDebugConfig>({ enabled: false, assignedEmails: {} }, (set) => {
		let unsubscribe: (() => void) | null = null;

		const boot = async () => {
			await ensureFirebaseReady();
			set(await fetchVoiceDebugConfig());
			unsubscribe = onSnapshot(voiceDebugRef(), (snap) => {
				const data = (snap.exists() ? snap.data() : {}) as Record<string, unknown>;
				set(normalizeConfig(data));
			});
		};

		boot().catch(() => set({ enabled: false, assignedEmails: {} }));

		return () => {
			unsubscribe?.();
		};
	});
}

export async function setVoiceDebugEnabled(enabled: boolean, actor: User) {
	await ensureFirebaseReady();
	await setDoc(
		voiceDebugRef(),
		{ enabled, updatedAt: serverTimestamp() },
		{ merge: true }
	);

	await logAdminAction({
		type: 'featureToggle',
		level: 'info',
		message: `Voice debug bubble ${enabled ? 'enabled' : 'disabled'}`,
		data: {
			action: 'voiceDebug:toggle',
			enabled,
			actor: { uid: actor.uid, email: actor.email ?? null }
		},
		userId: actor.uid
	});
}

export async function addVoiceDebugAssignee(emailInput: string, actor: User, note?: string | null) {
	const email = normalizeEmail(emailInput);
	if (!email) throw new Error('Email required');
	await ensureFirebaseReady();

	await setDoc(
		voiceDebugRef(),
		{
			assignedEmails: {
				[email]: {
					email,
					addedBy: actor.uid ?? null,
					addedAt: serverTimestamp(),
					note: note ?? null
				}
			},
			updatedAt: serverTimestamp()
		},
		{ merge: true }
	);

	await logAdminAction({
		type: 'adminAction',
		level: 'info',
		message: `Added ${email} to voice debug bubble allow list`,
		data: {
			action: 'voiceDebug:addUser',
			email,
			note: note ?? null,
			actor: { uid: actor.uid, email: actor.email ?? null }
		},
		userId: actor.uid
	});
}

export async function removeVoiceDebugAssignee(emailInput: string, actor: User) {
	const email = normalizeEmail(emailInput);
	if (!email) throw new Error('Email required');
	await ensureFirebaseReady();

	await setDoc(
		voiceDebugRef(),
		{
			assignedEmails: {
				[email]: deleteField()
			},
			updatedAt: serverTimestamp()
		},
		{ merge: true }
	);

	await logAdminAction({
		type: 'adminAction',
		level: 'warning',
		message: `Removed ${email} from voice debug bubble allow list`,
		data: {
			action: 'voiceDebug:removeUser',
			email,
			actor: { uid: actor.uid, email: actor.email ?? null }
		},
		userId: actor.uid
	});
}

export function isVoiceDebugAssignee(config: VoiceDebugConfig, email?: string | null): boolean {
	const normalized = normalizeEmail(email);
	if (!normalized) return false;
	return Boolean(config.assignedEmails?.[normalized]);
}
