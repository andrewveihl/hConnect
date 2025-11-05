// src/lib/firebase/index.ts
import { browser } from '$app/environment';
import { env as dynamicPublic } from '$env/dynamic/public';

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

import { user as userStore } from '$lib/stores/user';

if (import.meta.env.DEV) {
  setLogLevel('debug');
}

/* ------------------------------------------------------------------ */
/* Config resolution (LOCAL/CI -> Hosting script -> Hosting JSON)      */
/* ------------------------------------------------------------------ */
async function resolveFirebaseConfig(): Promise<Record<string, any>> {
  // 1) Local/CI via PUBLIC_* (runtime)
  if (dynamicPublic.PUBLIC_FIREBASE_API_KEY) {
    return {
      apiKey: dynamicPublic.PUBLIC_FIREBASE_API_KEY,
      authDomain: dynamicPublic.PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: dynamicPublic.PUBLIC_FIREBASE_PROJECT_ID,
      appId: dynamicPublic.PUBLIC_FIREBASE_APP_ID,
      messagingSenderId: dynamicPublic.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      storageBucket: dynamicPublic.PUBLIC_FIREBASE_STORAGE_BUCKET
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
  return { app, auth, db };
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
  return { app: _app, auth: auth!, db: db! };
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
  await ensureUserDoc(current.uid, {
    email: current.email,
    name: current.displayName ?? (current.email ? current.email.split('@')[0] : current.uid),
    photoURL: current.photoURL
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
