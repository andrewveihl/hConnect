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
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp, setLogLevel, type Firestore
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
    db = getFirestore(_app);
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
    throw new Error('Firestore not initialized. Call ensureFirebaseReady() early (e.g., in +layout onMount).');
  }
  return db!;
}

export function getStorageInstance(): FirebaseStorage {
  if (!storage) {
    throw new Error('Storage not initialized. Call ensureFirebaseReady() early (e.g., in +layout onMount).');
  }
  return storage;
}

export async function getFunctionsClient(): Promise<Functions> {
  await ensureFirebaseReady();
  if (!functionsInstance) {
    throw new Error('Functions not initialized. Call ensureFirebaseReady() early (e.g., in +layout onMount).');
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

async function afterLoginEnsureDoc() {
  await ensureFirebaseReady();
  const current = auth?.currentUser;
  if (!current) return;

  // Check if user already has a custom or cached photo in Firestore
  const ref = profileRef(current.uid);
  const snap = await getDoc(ref);
  const existing: Record<string, any> | null = snap.exists() ? (snap.data() as any) : null;
  const hasCustom = !!existing?.customPhotoURL;
  const hasCached = !!existing?.photoURL && existing.photoURL !== existing?.authPhotoURL;

  let cachedPhotoURL = existing?.photoURL;
  // If no custom/cached photo, cache Google photoURL in Storage
  if (!hasCustom && !hasCached && current.photoURL) {
    try {
      // Fetch Google photo as blob
      const response = await fetch(current.photoURL);
      const blob = await response.blob();
      const file = new File([blob], 'google-avatar.jpg', { type: blob.type || 'image/jpeg' });
      // Upload to Storage
      const { uploadProfileAvatar } = await import('./storage');
      const uploaded = await uploadProfileAvatar({ file, uid: current.uid });
      cachedPhotoURL = uploaded.url;
    } catch (e) {
      console.warn('Failed to cache Google photoURL:', e);
    }
  }

  await ensureUserDoc(current.uid, {
    email: current.email,
    name: current.displayName ?? (current.email ? current.email.split('@')[0] : current.uid),
    photoURL: cachedPhotoURL || current.photoURL
  });
}

/* ------------------------------------------------------------------ */
/* App-level auth listener (call once from root)                      */
/* ------------------------------------------------------------------ */
export function startAuthListener() {
  let unsubscribe: (() => void) | null = null;

  ensureFirebaseReady().then(() => {
    unsubscribe = onAuthStateChanged(auth!, async (u) => {
      userStore.set(u);
      if (u) {
        await ensureUserDoc(u.uid, {
          email: u.email,
          name: u.displayName ?? (u.email ? u.email.split('@')[0] : null),
          photoURL: u.photoURL
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

  const payload: Record<string, any> = {
    uid,
    email,
    name,
    nameLower: typeof name === 'string' ? name.toLowerCase() : null,
    displayName: name ?? null, // keep legacy
    authPhotoURL: authPhotoURL || null,
    customPhotoURL: customPhoto || null,
    photoURL: finalPhoto || null,
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
