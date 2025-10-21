// src/lib/firebase.ts
import { browser } from '$app/environment';
import { env as dynamicPublic } from '$env/dynamic/public'; // runtime PUBLIC_* if present

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth, type Auth, setPersistence, browserLocalPersistence,
  GoogleAuthProvider, OAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp, type Firestore
} from 'firebase/firestore';
import { user } from '$lib/stores/user';

/** Resolve Firebase web config from PUBLIC_* or FIREBASE_WEBAPP_CONFIG */
function loadFirebaseConfig() {
  // 1) Local/CI: PUBLIC_* via $env/dynamic/public
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

  // 2) Firebase Hosting build: FIREBASE_WEBAPP_CONFIG (JSON string)
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

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

/* ---------------- Core init ---------------- */
export function getFirebase() {
  if (!browser) return { app: undefined, auth: undefined };

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

  return { app: app!, auth: auth! };
}

/** Use the DEFAULT Firestore database (fixes hanging writes). */
export function getDb() {
  const { app } = getFirebase();
  if (!db) db = getFirestore(app); // default DB
  return db!;
}

/* ---------------- Auth flows ---------------- */
export async function signInWithGoogle() {
  const { auth } = getFirebase();
  await signInWithPopup(auth, new GoogleAuthProvider());
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

async function afterLoginEnsureDoc() {
  const { auth } = getFirebase();
  const u = auth.currentUser;
  if (u) {
    await ensureUserDoc(u.uid, {
      email: u.email,
      name: u.displayName,
      photoURL: u.photoURL
    });
  }
}

export function startAuthListener() {
  const { auth } = getFirebase();
  onAuthStateChanged(auth, async (u) => {
    user.set(u);
    if (u) {
      await ensureUserDoc(u.uid, {
        email: u.email,
        name: u.displayName,
        photoURL: u.photoURL
      });
    }
  });
}

export async function signOutUser() {
  const { auth } = getFirebase();
  await signOut(auth);
}

/* ---------------- users/{uid} ---------------- */
function userRef(uid: string) {
  return doc(getDb(), 'users', uid);
}

/** Create or merge users/{uid} with defaults */
export async function ensureUserDoc(
  uid: string,
  data?: { email?: string | null; name?: string | null; photoURL?: string | null }
) {
  await setDoc(
    userRef(uid),
    {
      createdAt: serverTimestamp(),
      email: data?.email ?? null,
      name: data?.name ?? null,
      photoURL: data?.photoURL ?? null,
      settings: { theme: 'dark', notifications: true }
    },
    { merge: true }
  );
}

/** Read user settings ({} if missing). */
export async function getUserSettings(uid: string) {
  const snap = await getDoc(userRef(uid));
  return snap.exists() ? (snap.data().settings ?? {}) : {};
}

/** Merge-update user settings. */
export async function updateUserSettings(uid: string, partial: Record<string, unknown>) {
  await updateDoc(userRef(uid), { settings: partial });
}
