import { ensureFirebaseReady } from '$lib/firebase';
import { db } from '$lib/firestore/client';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import type { Readable } from 'svelte/store';
import { readable } from 'svelte/store';
import type { FeatureFlagKey, FeatureFlagMap } from './types';
import { DEFAULT_FEATURE_FLAGS } from './types';
import { logAdminAction } from './logs';
import type { User } from 'firebase/auth';

const featureFlagsRef = () => doc(db(), 'appConfig', 'featureFlags');

export async function fetchFeatureFlags(): Promise<FeatureFlagMap> {
	await ensureFirebaseReady();
	const snap = await getDoc(featureFlagsRef());
	const data = (snap.exists() ? (snap.data() as FeatureFlagMap) : {}) ?? {};
	return { ...DEFAULT_FEATURE_FLAGS, ...data };
}

export async function updateFeatureFlag(key: FeatureFlagKey, value: boolean, actor: User) {
	await ensureFirebaseReady();
	await setDoc(
		featureFlagsRef(),
		{
			[key]: value,
			updatedAt: serverTimestamp()
		},
		{ merge: true }
	);

	await logAdminAction({
		type: 'featureToggle',
		level: 'info',
		message: `Toggled ${key} to ${value ? 'on' : 'off'}`,
		data: {
			action: 'featureToggle:update',
			key,
			value,
			actor: {
				uid: actor.uid,
				email: actor.email ?? null
			}
		},
		userId: actor.uid
	});
}

export function featureFlagsStore(): Readable<FeatureFlagMap> {
	return readable<FeatureFlagMap>(DEFAULT_FEATURE_FLAGS, (set) => {
		let unsubscribe: (() => void) | null = null;

		const boot = async () => {
			await ensureFirebaseReady();
			set(await fetchFeatureFlags());
			unsubscribe = onSnapshot(featureFlagsRef(), (snap) => {
				const data = (snap.exists() ? (snap.data() as FeatureFlagMap) : {}) ?? {};
				set({ ...DEFAULT_FEATURE_FLAGS, ...data });
			});
		};

		boot().catch(() => set(DEFAULT_FEATURE_FLAGS));

		return () => {
			unsubscribe?.();
		};
	});
}
