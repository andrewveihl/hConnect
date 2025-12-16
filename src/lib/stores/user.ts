import { writable, derived, get } from 'svelte/store';
import type { User } from 'firebase/auth';
import { browser } from '$app/environment';

export const user = writable<User | null>(null);

// Store for the user's Firestore profile data (includes cachedPhotoURL, customPhotoURL, etc.)
export type UserProfile = {
	uid: string;
	displayName: string | null;
	photoURL: string | null;
	customPhotoURL: string | null;
	cachedPhotoURL: string | null;
	authPhotoURL: string | null;
	email: string | null;
} | null;

export const userProfile = writable<UserProfile>(null);

// Subscription management
let profileUnsubscribe: (() => void) | null = null;

/**
 * Start listening to the current user's profile document in Firestore.
 * Call this once when the app initializes (e.g., in root layout).
 */
export async function startProfileListener() {
	if (!browser) return;

	// Dynamic imports to avoid SSR issues
	const { onSnapshot, doc } = await import('firebase/firestore');
	const { getDb } = await import('$lib/firebase');

	// Subscribe to user store changes
	const unsubUser = user.subscribe(async (u) => {
		// Clean up existing profile subscription
		if (profileUnsubscribe) {
			profileUnsubscribe();
			profileUnsubscribe = null;
		}

		if (!u?.uid) {
			userProfile.set(null);
			return;
		}

		try {
			const database = getDb();
			const profileRef = doc(database, 'profiles', u.uid);

			profileUnsubscribe = onSnapshot(profileRef, (snap) => {
				if (!snap.exists()) {
					userProfile.set(null);
					return;
				}

				const data = snap.data() as Record<string, any>;
				userProfile.set({
					uid: u.uid,
					displayName: data.displayName ?? data.name ?? null,
					photoURL: data.photoURL ?? null,
					customPhotoURL: data.customPhotoURL ?? null,
					cachedPhotoURL: data.cachedPhotoURL ?? null,
					authPhotoURL: data.authPhotoURL ?? null,
					email: data.email ?? null
				});
			});
		} catch (e) {
			console.warn('Failed to subscribe to user profile:', e);
		}
	});

	return () => {
		unsubUser();
		if (profileUnsubscribe) {
			profileUnsubscribe();
			profileUnsubscribe = null;
		}
	};
}
