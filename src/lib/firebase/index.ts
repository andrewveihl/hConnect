// src/lib/firebase/index.ts
import { browser } from '$app/environment';
import {
	PUBLIC_FIREBASE_API_KEY,
	PUBLIC_FIREBASE_AUTH_DOMAIN,
	PUBLIC_FIREBASE_PROJECT_ID,
	PUBLIC_FIREBASE_APP_ID,
	PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
	PUBLIC_FIREBASE_STORAGE_BUCKET,
	PUBLIC_FIREBASE_STORAGE_BUCKET_URL
} from '$env/static/public';

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
	getAuth,
	type Auth,
	setPersistence,
	browserLocalPersistence,
	indexedDBLocalPersistence,
	GoogleAuthProvider,
	OAuthProvider,
	signInWithPopup,
	reauthenticateWithPopup,
	onAuthStateChanged,
	signOut
} from 'firebase/auth';
import {
	initializeFirestore,
	persistentLocalCache,
	persistentMultipleTabManager,
	doc,
	getDoc,
	setDoc,
	updateDoc,
	serverTimestamp,
	setLogLevel,
	type Firestore
} from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { getFunctions, type Functions } from 'firebase/functions';

import { user as userStore } from '$lib/stores/user';

if (import.meta.env.DEV) {
	setLogLevel('debug');
}

/* ------------------------------------------------------------------ */
/* Config resolution (LOCAL/CI -> Hosting script -> Hosting JSON)      */
/* ------------------------------------------------------------------ */
const storageBucketRaw = PUBLIC_FIREBASE_STORAGE_BUCKET ?? '';
const storageBucketUrl =
	PUBLIC_FIREBASE_STORAGE_BUCKET_URL ??
	(storageBucketRaw
		? storageBucketRaw.startsWith('gs://')
			? storageBucketRaw
			: `gs://${storageBucketRaw}`
		: null);
const storageBucketName = storageBucketUrl?.replace(/^gs:\/\//, '') ?? undefined;

async function resolveFirebaseConfig(): Promise<Record<string, any>> {
	// 1) Local/CI via PUBLIC_* (runtime)
	if (PUBLIC_FIREBASE_API_KEY) {
		return {
			apiKey: PUBLIC_FIREBASE_API_KEY,
			authDomain: PUBLIC_FIREBASE_AUTH_DOMAIN,
			projectId: PUBLIC_FIREBASE_PROJECT_ID,
			appId: PUBLIC_FIREBASE_APP_ID,
			messagingSenderId: PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
			...(storageBucketName ? { storageBucket: storageBucketName } : {})
		};
	}

	// 2) Firebase Hosting: global set by /__/firebase/init.js (if you include it in app.html)
	if (browser && typeof window !== 'undefined' && (window as any).firebaseConfig) {
		return (window as any).firebaseConfig;
	}

	// 3) Firebase Hosting: fetch the injected JSON (works even if you didn't include init.js)
	if (browser) {
		try {
			const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
			if (res.ok) {
				const cfg = await res.json();
				if (cfg?.apiKey && cfg?.projectId && cfg?.appId) return cfg;
			}
		} catch {
			// ignore and throw below
		}
	}

	throw new Error(
		'Firebase config not found. Provide PUBLIC_FIREBASE_* locally or deploy to Firebase Hosting so /__/firebase/init.json is available.'
	);
}

/* ------------------------------------------------------------------ */
/* Singletons                                                         */
/* ------------------------------------------------------------------ */
let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let storage: FirebaseStorage | undefined;
let functionsInstance: Functions | undefined;

// Promise to ensure we only resolve config once per session
let configPromise: Promise<Record<string, any>> | null = null;

async function ensureApp(): Promise<FirebaseApp> {
	if (!browser) throw new Error('Firebase can only initialize in the browser.');
	if (!getApps().length) {
		if (!configPromise) configPromise = resolveFirebaseConfig();
		const cfg = await configPromise;
		app = initializeApp(cfg);
	} else {
		app = getApps()[0]!;
	}
	return app!;
}

/* Public getters ---------------------------------------------------- */
export function getFirebase() {
	// returns lazy placeholders; real init happens in ensureReady()
	return { app, auth, db, storage, functions: functionsInstance };
}

/** Call this at app start (e.g., in +layout.svelte onMount) */
export async function ensureFirebaseReady() {
	const _app = await ensureApp();
	if (!auth) {
		auth = getAuth(_app);
		const persistenceCandidates = [indexedDBLocalPersistence, browserLocalPersistence];
		let appliedPersistence = false;
		for (const candidate of persistenceCandidates) {
			try {
				await setPersistence(auth, candidate);
				appliedPersistence = true;
				break;
			} catch {
				// ignore and try the next option (e.g., private mode may block IndexedDB)
			}
		}
		if (!appliedPersistence) {
			console.warn('[firebase] Falling back to in-memory auth persistence (storage unavailable).');
		}
	}
	if (!db) {
		try {
			// Enable offline persistence for faster reloads (reads from local cache first)
			db = initializeFirestore(_app, {
				localCache: persistentLocalCache({
					tabManager: persistentMultipleTabManager()
				})
			});
		} catch (e: any) {
			// If Firestore was already initialized (e.g., hot reload), get existing instance
			if (e?.code === 'failed-precondition' || e?.message?.includes('already been called')) {
				const { getFirestore } = await import('firebase/firestore');
				db = getFirestore(_app);
			} else {
				throw e;
			}
		}
	}
	if (!storage) {
		storage = storageBucketUrl ? getStorage(_app, storageBucketUrl) : getStorage(_app);
	}
	if (!functionsInstance) {
		functionsInstance = getFunctions(_app);
	}
	return { app: _app, auth: auth!, db: db!, storage: storage!, functions: functionsInstance };
}

// ---- Firestore getter -------------------------------------------------
/** Return the initialized Firestore instance.
 *  IMPORTANT: Call ensureFirebaseReady() early (e.g., +layout onMount) before using this.
 */
export function getDb(): Firestore {
	if (!db) {
		throw new Error(
			'Firestore not initialized. Call ensureFirebaseReady() early (e.g., in +layout onMount).'
		);
	}
	return db!;
}

export function getStorageInstance(): FirebaseStorage {
	if (!storage) {
		throw new Error(
			'Storage not initialized. Call ensureFirebaseReady() early (e.g., in +layout onMount).'
		);
	}
	return storage;
}

export async function getFunctionsClient(): Promise<Functions> {
	await ensureFirebaseReady();
	if (!functionsInstance) {
		throw new Error(
			'Functions not initialized. Call ensureFirebaseReady() early (e.g., in +layout onMount).'
		);
	}
	return functionsInstance;
}

// (Optional) keep compatibility with code that does `import getDb from '$lib/firebase'`
export default getDb;

/* Optional: wait for the first auth resolution so auth.currentUser is reliable */
export async function waitForAuthInit(): Promise<void> {
	await ensureFirebaseReady();
	if ((auth as any)._initializedOnce || auth!.currentUser !== undefined) return;
	await new Promise<void>((resolve) => {
		const unsub = onAuthStateChanged(auth!, () => {
			(auth as any)._initializedOnce = true;
			unsub();
			resolve();
		});
	});
}

/* ------------------------------------------------------------------ */
/* Auth flows                                                         */
/* ------------------------------------------------------------------ */
export async function signInWithGoogle() {
	await ensureFirebaseReady();
	const provider = new GoogleAuthProvider();
	await signInWithPopup(auth!, provider);
	await afterLoginEnsureDoc();
}

export async function signInWithApple() {
	await ensureFirebaseReady();
	const provider = new OAuthProvider('apple.com');
	provider.addScope('email');
	provider.addScope('name');
	await signInWithPopup(auth!, provider);
	await afterLoginEnsureDoc();
}

export async function signOutUser() {
	await ensureFirebaseReady();
	await signOut(auth!);
}
export const signOutNow = signOutUser;

/**
 * Re-authenticate with Google to refresh profile data (including photo).
 * This triggers a Google popup and updates the user's Firebase Auth record.
 * Returns the new photoURL if successful.
 */
export async function reauthenticateWithGoogleForPhoto(): Promise<{ success: boolean; photoURL?: string; error?: string }> {
	await ensureFirebaseReady();
	const current = auth?.currentUser;
	
	if (!current) {
		return { success: false, error: 'No user logged in' };
	}
	
	try {
		const provider = new GoogleAuthProvider();
		// Force account selection to ensure fresh data
		provider.setCustomParameters({ prompt: 'select_account' });
		
		const result = await reauthenticateWithPopup(current, provider);
		const newPhotoURL = result.user.photoURL;
		
		console.log('[reauthenticateWithGoogleForPhoto] Re-auth successful, new photoURL:', newPhotoURL);
		
		// Now cache the photo to Firebase Storage (same as afterLoginEnsureDoc)
		if (newPhotoURL) {
			try {
				const response = await fetch(newPhotoURL);
				if (!response.ok) throw new Error(`Failed to fetch avatar: ${response.status}`);
				const blob = await response.blob();
				const file = new File([blob], 'google-avatar.jpg', { type: blob.type || 'image/jpeg' });
				
				const { uploadProfileAvatar } = await import('./storage');
				const uploaded = await uploadProfileAvatar({ file, uid: current.uid });
				
				const ref = profileRef(current.uid);
				await setDoc(
					ref,
					{
						cachedPhotoURL: uploaded.url,
						cachedPhotoAt: serverTimestamp(),
						photoURL: uploaded.url,
						authPhotoURL: newPhotoURL,
						updatedAt: serverTimestamp()
					},
					{ merge: true }
				);
				
				return { success: true, photoURL: uploaded.url };
			} catch (e) {
				console.warn('[reauthenticateWithGoogleForPhoto] Failed to cache photo:', e);
				// Still return the Google URL even if caching failed
				return { success: true, photoURL: newPhotoURL };
			}
		}
		
		return { success: true, photoURL: newPhotoURL || undefined };
	} catch (e: any) {
		console.error('[reauthenticateWithGoogleForPhoto] Re-auth failed:', e);
		return { success: false, error: e.message || 'Re-authentication failed' };
	}
}

async function afterLoginEnsureDoc() {
	await ensureFirebaseReady();
	const current = auth?.currentUser;
	if (!current) return;

	// Check if user already has a custom or cached photo in Firestore
	const ref = profileRef(current.uid);
	const snap = await getDoc(ref);
	const existing: Record<string, any> | null = snap.exists() ? (snap.data() as any) : null;
	const hasCustom = !!existing?.customPhotoURL;
	const hasCached = !!existing?.cachedPhotoURL;
	const cacheExpired = isCacheExpired(existing?.cachedPhotoAt);

	let cachedPhotoURL = existing?.cachedPhotoURL ?? null;

	// Cache avatar if: no custom AND (no cached OR cache expired)
	const shouldRecache = !hasCustom && current.photoURL && (!hasCached || cacheExpired);

	if (shouldRecache) {
		try {
			// Fetch Google photo as blob
			const response = await fetch(current.photoURL);
			if (!response.ok) throw new Error(`Failed to fetch avatar: ${response.status}`);
			const blob = await response.blob();
			const file = new File([blob], 'google-avatar.jpg', { type: blob.type || 'image/jpeg' });
			// Upload to Storage
			const { uploadProfileAvatar } = await import('./storage');
			const uploaded = await uploadProfileAvatar({ file, uid: current.uid });
			cachedPhotoURL = uploaded.url;
			// Store cachedPhotoURL directly to ensure it persists (use setDoc with merge for safety)
			await setDoc(
				ref,
				{
					cachedPhotoURL,
					cachedPhotoAt: serverTimestamp(), // Track when we cached it
					photoURL: cachedPhotoURL,
					authPhotoURL: current.photoURL,
					updatedAt: serverTimestamp()
				},
				{ merge: true }
			);
			return; // Skip ensureUserDoc since we just updated
		} catch (e) {
			console.warn('Failed to cache Google photoURL:', e);
		}
	}

	await ensureUserDoc(current.uid, {
		email: current.email,
		name: current.displayName ?? (current.email ? current.email.split('@')[0] : current.uid),
		photoURL: cachedPhotoURL || existing?.photoURL || current.photoURL
	});
}

/* ------------------------------------------------------------------ */
/* App-level auth listener (call once from root)                      */
/* ------------------------------------------------------------------ */

// Cache expiration time: 24 hours in milliseconds
const AVATAR_CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000;

function isCacheExpired(cachedAt: any): boolean {
	if (!cachedAt) return true;
	const cachedTime =
		typeof cachedAt?.toMillis === 'function'
			? cachedAt.toMillis()
			: typeof cachedAt === 'number'
				? cachedAt
				: Date.parse(cachedAt);
	if (isNaN(cachedTime)) return true;
	return Date.now() - cachedTime > AVATAR_CACHE_EXPIRY_MS;
}

export function startAuthListener() {
	let unsubscribe: (() => void) | null = null;

	ensureFirebaseReady().then(() => {
		unsubscribe = onAuthStateChanged(auth!, async (u) => {
			userStore.set(u);
			if (u) {
				// Check existing profile to preserve cached/custom photos
				const ref = profileRef(u.uid);
				const snap = await getDoc(ref);
				const existing: Record<string, any> | null = snap.exists() ? (snap.data() as any) : null;
				const hasCustom = !!existing?.customPhotoURL;
				const hasCached = !!existing?.cachedPhotoURL;
				const cacheExpired = isCacheExpired(existing?.cachedPhotoAt);

				// Always store authPhotoURL if user has a provider photo (e.g., Google)
				// This ensures we can fall back to it if other avatar sources fail
				if (u.photoURL && existing?.authPhotoURL !== u.photoURL) {
					await setDoc(
						ref,
						{ authPhotoURL: u.photoURL, updatedAt: serverTimestamp() },
						{ merge: true }
					);
				}

				// Cache avatar if: no cached version OR cache is expired (older than 24h)
				const shouldRecache = !hasCustom && u.photoURL && (!hasCached || cacheExpired);

				if (shouldRecache) {
					try {
						const response = await fetch(u.photoURL);
						if (response.ok) {
							const blob = await response.blob();
							const file = new File([blob], 'google-avatar.jpg', {
								type: blob.type || 'image/jpeg'
							});
							const { uploadProfileAvatar } = await import('./storage');
							const uploaded = await uploadProfileAvatar({ file, uid: u.uid });
							await setDoc(
								ref,
								{
									cachedPhotoURL: uploaded.url,
									cachedPhotoAt: serverTimestamp(), // Track when we cached it
									photoURL: uploaded.url,
									authPhotoURL: u.photoURL,
									updatedAt: serverTimestamp()
								},
								{ merge: true }
							);
							// Update ensureUserDoc with cached photo
							await ensureUserDoc(u.uid, {
								email: u.email,
								name: u.displayName ?? (u.email ? u.email.split('@')[0] : null),
								photoURL: uploaded.url
							});
							return;
						}
					} catch (e) {
						console.warn('Failed to cache avatar on auth state change:', e);
					}
				}

				const preservedPhoto =
					existing?.cachedPhotoURL ?? existing?.customPhotoURL ?? existing?.photoURL ?? null;

				await ensureUserDoc(u.uid, {
					email: u.email,
					name: u.displayName ?? (u.email ? u.email.split('@')[0] : null),
					// Preserve existing cached/custom photo, don't overwrite with Google URL
					photoURL: preservedPhoto || u.photoURL
				});
			}
		});
	});

	return () => {
		unsubscribe?.();
		unsubscribe = null;
	};
}

/* ------------------------------------------------------------------ */
/* profiles/{uid} helpers                                             */
/* ------------------------------------------------------------------ */
function profileRef(uid: string) {
	if (!db) throw new Error('Firestore not initialized');
	return doc(db, 'profiles', uid);
}

export async function ensureUserDoc(
	uid: string,
	data?: { email?: string | null; name?: string | null; photoURL?: string | null }
) {
	await ensureFirebaseReady();
	const ref = profileRef(uid);
	const snap = await getDoc(ref);
	const existing: Record<string, any> | null = snap.exists() ? (snap.data() as any) : null;

	const name = data?.name ?? null;
	const email = data?.email ?? null;
	const trim = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

	const incomingAuth = trim(data?.photoURL ?? null);
	const existingAuth = trim(existing?.authPhotoURL ?? null);
	const authPhotoURL = incomingAuth || existingAuth || '';

	let customPhoto = trim(existing?.customPhotoURL ?? null);
	const storedPhoto = trim(existing?.photoURL ?? null);

	if (!customPhoto && storedPhoto) {
		if (!authPhotoURL) {
			customPhoto = storedPhoto;
		} else if (storedPhoto !== authPhotoURL) {
			customPhoto = storedPhoto;
		}
	}

	const finalPhoto = customPhoto || authPhotoURL || '';

	// Preserve cachedPhotoURL if it exists
	const existingCached = trim(existing?.cachedPhotoURL ?? null);

	const payload: Record<string, any> = {
		uid,
		email,
		name,
		nameLower: typeof name === 'string' ? name.toLowerCase() : null,
		displayName: name ?? null, // keep legacy
		authPhotoURL: authPhotoURL || null,
		customPhotoURL: customPhoto || null,
		cachedPhotoURL: existingCached || null,
		photoURL: customPhoto || existingCached || finalPhoto || null,
		updatedAt: serverTimestamp()
	};

	if (!snap.exists()) {
		payload.createdAt = serverTimestamp();
		payload.settings = {
			theme: 'dark',
			notifications: true
		};
	}

	await setDoc(ref, payload, { merge: true });
}

export async function getUserSettings(uid: string) {
	await ensureFirebaseReady();
	const snap = await getDoc(profileRef(uid));
	return snap.exists() ? (snap.data().settings ?? {}) : {};
}

export async function updateUserSettings(uid: string, partial: Record<string, unknown>) {
	await ensureFirebaseReady();
	await updateDoc(profileRef(uid), { settings: partial, updatedAt: serverTimestamp() });
}

/* Redirect flow placeholder (no-op for popup) */
export async function completeRedirectIfNeeded() {}
