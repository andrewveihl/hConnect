// src/lib/firebase.ts
import { browser } from '$app/environment';
import {
  PUBLIC_FIREBASE_API_KEY,
  PUBLIC_FIREBASE_AUTH_DOMAIN,
  PUBLIC_FIREBASE_PROJECT_ID,
  PUBLIC_FIREBASE_APP_ID,
  PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  PUBLIC_FIREBASE_STORAGE_BUCKET
} from '$env/static/public';

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth, type Auth, setPersistence, browserLocalPersistence,
  GoogleAuthProvider, OAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp, type Firestore
} from 'firebase/firestore';
import { user } from '$lib/stores/user';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

/* ---------------- Core init ---------------- */
export function getFirebase() {
  if (!browser) return { app: undefined, auth: undefined };

  if (!getApps().length) {
    app = initializeApp({
      apiKey: PUBLIC_FIREBASE_API_KEY,
      authDomain: PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: PUBLIC_FIREBASE_PROJECT_ID,
      appId: PUBLIC_FIREBASE_APP_ID,
      messagingSenderId: PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      storageBucket: PUBLIC_FIREBASE_STORAGE_BUCKET
    });
  } else {
    app = getApps()[0];
  }

  if (!auth) {
    auth = getAuth();
    setPersistence(auth, browserLocalPersistence).catch(() => {});
  }

  return { app: app!, auth: auth! };
}

/** Use the DEFAULT Firestore database (fixes hanging writes). */
export function getDb() {
  const { app } = getFirebase();
  if (!db) db = getFirestore(app); // <-- no named DB id here
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
