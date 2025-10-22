// src/lib/firebase.ts
import { browser } from '$app/environment';
import { env as dynamicPublic } from '$env/dynamic/public';

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  type Auth,
  setPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  type Firestore
} from 'firebase/firestore';

import { user as userStore } from '$lib/stores/user';

/* ------------------------------------------------------------------ */
/* Firebase config resolution                                          */
/* ------------------------------------------------------------------ */
function loadFirebaseConfig() {
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

  // 2) Firebase Hosting build-time injected JSON
  const raw =
    (typeof process !== 'undefined' && (process as any)?.env?.FIREBASE_WEBAPP_CONFIG) || '';
  try {
    const cfg = raw ? JSON.parse(raw) : {};
    if (cfg?.apiKey && cfg?.projectId && cfg?.appId) return cfg;
  } catch {
    /* ignore */
  }

  throw new Error(
    'Firebase config not found. Provide PUBLIC_FIREBASE_* envs locally or rely on FIREBASE_WEBAPP_CONFIG in Hosting.'
  );
}

/* ------------------------------------------------------------------ */
/* Singletons                                                         */
/* ------------------------------------------------------------------ */
let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;


// Waits for the first auth state resolution so `auth.currentUser` is reliable.
export function waitForAuthInit(): Promise<void> {
  const { auth } = getFirebase();
  // If Firebase already resolved auth state, currentUser is non-undefined.
  // In v9, it’s undefined until the first onAuthStateChanged fires.
  if ((auth as any)._initializationComplete || auth.currentUser !== undefined) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, () => {
      // Mark as initialized to avoid future waits in this session
      (auth as any)._initializationComplete = true;
      unsub();
      resolve();
    });
  });
}

/* ------------------------------------------------------------------ */
/* Core init (no Firestore usage here)                                */
/* ------------------------------------------------------------------ */
export function getFirebase() {
  if (!browser) {
    return { app: undefined as any, auth: undefined as any, db: undefined as any };
  }

  if (!getApps().length) {
    app = initializeApp(loadFirebaseConfig());
  } else {
    app = getApps()[0]!;
  }

  if (!auth) {
    auth = getAuth(app);
    // best-effort; ignore failures (e.g., private mode)
    setPersistence(auth, browserLocalPersistence).catch(() => {});
  }

  return { app: app!, auth: auth!, db: db as Firestore | undefined };
}

/** Get the default Firestore instance (lazy). */
export function getDb() {
  const { app } = getFirebase();
  if (!db) db = getFirestore(app);
  return db!;
}

/** Optional helper for redirect-based providers (safe no-op for popup flow). */
export async function completeRedirectIfNeeded() {
  // If you ever switch to signInWithRedirect, handle the result here.
}

/* ------------------------------------------------------------------ */
/* Auth flows (popup only; no window.close; minimal Firestore writes) */
/* ------------------------------------------------------------------ */
export async function signInWithGoogle() {
  const { auth } = getFirebase();
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
  await afterLoginEnsureDoc();
}

export async function signInWithApple() {
  const { auth } = getFirebase();
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');
  await signInWithPopup(auth, provider);
  await afterLoginEnsureDoc();
}

export async function signOutUser() {
  const { auth } = getFirebase();
  await signOut(auth);
}

// Alias used by some components (e.g., SignOutButton.svelte)
export const signOutNow = signOutUser;

/* ------------------------------------------------------------------ */
/* Minimal profile upsert after login                                 */
/* ------------------------------------------------------------------ */
async function afterLoginEnsureDoc() {
  const { auth } = getFirebase();
  const u = auth.currentUser;
  if (!u) return;

  // Single, guarded write to profiles/{uid}; no listeners.
  await ensureUserDoc(u.uid, {
    email: u.email,
    name: u.displayName ?? (u.email ? u.email.split('@')[0] : null),
    photoURL: u.photoURL
  });
}

/* ------------------------------------------------------------------ */
/* App-level auth listener (call once from root)                      */
/* ------------------------------------------------------------------ */
export function startAuthListener() {
  const { auth } = getFirebase();
  return onAuthStateChanged(auth, async (u) => {
    userStore.set(u);
    // Optional: keep profile doc warm after refresh
    if (u) {
      await ensureUserDoc(u.uid, {
        email: u.email,
        name: u.displayName ?? (u.email ? u.email.split('@')[0] : null),
        photoURL: u.photoURL
      });
    }
  });
}

/* ------------------------------------------------------------------ */
/* profiles/{uid} helpers (keeps your Settings & DMs working)         */
/* ------------------------------------------------------------------ */
function profileRef(uid: string) {
  return doc(getDb(), 'profiles', uid);
}

/** Create/merge profiles/{uid} with sane defaults. 
 *  Minimal change: adds `name` and `nameLower` (for DMs search/list),
 *  keeps your `displayName` field for backward compatibility.
 */
export async function ensureUserDoc(
  uid: string,
  data?: { email?: string | null; name?: string | null; photoURL?: string | null }
) {
  const name = data?.name ?? null;
  await setDoc(
    profileRef(uid),
    {
      uid,
      email: data?.email ?? null,
      // New fields to support DMs sidebar & search:
      name,
      nameLower: typeof name === 'string' ? name.toLowerCase() : null,

      // Keep legacy field so existing pages don’t break:
      displayName: data?.name ?? null,

      photoURL: data?.photoURL ?? null,
      settings: { theme: 'dark', notifications: true },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

/** Read user settings ({} if missing). */
export async function getUserSettings(uid: string) {
  const snap = await getDoc(profileRef(uid));
  return snap.exists() ? (snap.data().settings ?? {}) : {};
}

/** Merge-update user settings (shallow merge of the 'settings' object). */
export async function updateUserSettings(uid: string, partial: Record<string, unknown>) {
  await updateDoc(profileRef(uid), { settings: partial, updatedAt: serverTimestamp() });
}
