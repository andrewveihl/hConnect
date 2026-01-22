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
	settings?: {
		theme?: string;
		customThemeId?: string;
		keybinds?: Record<string, string | null>;
	};
} | null;

// localStorage key for instant profile restore
const LS_USER_PROFILE = 'hc_user_profile';

// Try to load cached profile immediately for instant first paint
function loadCachedProfile(): UserProfile {
	if (!browser) return null;
	try {
		const stored = localStorage.getItem(LS_USER_PROFILE);
		if (stored) {
			const parsed = JSON.parse(stored);
			if (parsed?.uid) return parsed;
		}
	} catch {}
	return null;
}

function saveCachedProfile(profile: UserProfile): void {
	if (!browser) return;
	try {
		if (profile) {
			localStorage.setItem(LS_USER_PROFILE, JSON.stringify(profile));
		} else {
			localStorage.removeItem(LS_USER_PROFILE);
		}
	} catch {}
}

export const userProfile = writable<UserProfile>(loadCachedProfile());

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
					saveCachedProfile(null);
					return;
				}

				const data = snap.data() as Record<string, any>;
				const settings = data.settings as Record<string, any> | undefined;
				const profile: UserProfile = {
					uid: u.uid,
					displayName: data.displayName ?? data.name ?? null,
					photoURL: data.photoURL ?? null,
					customPhotoURL: data.customPhotoURL ?? null,
					cachedPhotoURL: data.cachedPhotoURL ?? null,
					authPhotoURL: data.authPhotoURL ?? null,
					email: data.email ?? null,
					settings: settings ? {
						theme: settings.theme ?? undefined,
						customThemeId: settings.customThemeId ?? undefined,
						keybinds: settings.keybinds ?? undefined
					} : undefined
				};
				userProfile.set(profile);
				saveCachedProfile(profile);
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
