import { ensureFirebaseReady, getFirebase } from '$lib/firebase';
import { db } from '$lib/firestore/client';
import { readable, type Readable } from 'svelte/store';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  runTransaction
} from 'firebase/firestore';
import { onAuthStateChanged, type User } from 'firebase/auth';
import type { SuperAdminMap } from './types';
import { logAdminAction } from './logs';

const DEFAULT_SUPER_ADMINS = ['andrew@healthspaces.com'];

let cachedUserPromise: Promise<User | null> | null = null;

const normalizeEmail = (value?: string | null) =>
  typeof value === 'string' ? value.trim().toLowerCase() : null;

export async function getCurrentUser(forceRefresh = false): Promise<User | null> {
  await ensureFirebaseReady();
  const { auth } = getFirebase();
  if (!auth) return null;
  if (!forceRefresh && auth.currentUser) return auth.currentUser;
  if (!forceRefresh && cachedUserPromise) return cachedUserPromise;

  cachedUserPromise = new Promise<User | null>((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (value) => {
      unsubscribe();
      cachedUserPromise = null;
      resolve(value);
    });
  });

  return cachedUserPromise;
}

async function readSuperAdminDoc(): Promise<SuperAdminMap> {
  await ensureFirebaseReady();
  const ref = doc(db(), 'appConfig', 'superAdmins');
  const snap = await getDoc(ref);
  const data = (snap.exists() ? (snap.data() as { emails?: SuperAdminMap }) : null) ?? {};
  const normalizedMap = Object.fromEntries(
    Object.entries(data.emails ?? {}).map(([email, flag]) => [normalizeEmail(email) ?? email, !!flag])
  );

  let mutated = false;
  for (const email of DEFAULT_SUPER_ADMINS) {
    const normalized = normalizeEmail(email);
    if (normalized && !normalizedMap[normalized]) {
      normalizedMap[normalized] = true;
      mutated = true;
    }
  }

  if (mutated) {
    await setDoc(
      ref,
      {
        emails: normalizedMap,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  return normalizedMap;
}

export async function fetchSuperAdminEmails(): Promise<string[]> {
  const map = await readSuperAdminDoc();
  return Object.entries(map)
    .filter(([, allowed]) => allowed)
    .map(([email]) => email);
}

export async function isSuperAdmin(user: User | null | undefined): Promise<boolean> {
  const email = normalizeEmail(user?.email);
  if (!email) return false;
  const admins = await readSuperAdminDoc();
  return Boolean(admins[email]);
}

export async function assertSuperAdmin(user?: User | null) {
  const resolvedUser = user ?? (await getCurrentUser());
  if (!(await isSuperAdmin(resolvedUser))) {
    throw new Error('Super Admin access required');
  }
}

export function superAdminEmailsStore(): Readable<string[]> {
  return readable<string[]>([], (set) => {
    let unsubscribe: (() => void) | null = null;

    const boot = async () => {
      await ensureFirebaseReady();
      try {
        set(await fetchSuperAdminEmails());
      } catch {
        set([]);
      }

      unsubscribe = onSnapshot(doc(db(), 'appConfig', 'superAdmins'), (snap) => {
        const data = (snap.exists() ? (snap.data() as { emails?: SuperAdminMap }) : null) ?? {};
        const items = Object.entries(data.emails ?? {})
          .filter(([, allowed]) => Boolean(allowed))
          .map(([email]) => email.toLowerCase());
        set(items);
      });
    };

    boot().catch(() => set([]));

    return () => {
      unsubscribe?.();
    };
  });
}

export async function addSuperAdminEmail(targetEmail: string, actor: User) {
  const cleaned = normalizeEmail(targetEmail);
  if (!cleaned) throw new Error('Email required');
  await assertSuperAdmin(actor);

  await ensureFirebaseReady();
  await runTransaction(db(), async (trx) => {
    const ref = doc(db(), 'appConfig', 'superAdmins');
    const snap = await trx.get(ref);
    const emails = ((snap.exists() ? snap.data() : {}) as { emails?: SuperAdminMap }).emails ?? {};
    emails[cleaned] = true;
    trx.set(
      ref,
      {
        emails,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  });

  await logAdminAction({
    type: 'adminAction',
    level: 'info',
    message: `Added Super Admin ${cleaned}`,
    data: {
      action: 'superAdmin:add',
      targetEmail: cleaned,
      actor: {
        uid: actor.uid,
        email: actor.email ?? null
      }
    },
    userId: actor.uid
  });
}

export async function removeSuperAdminEmail(targetEmail: string, actor: User) {
  const cleaned = normalizeEmail(targetEmail);
  if (!cleaned) throw new Error('Email required');
  await assertSuperAdmin(actor);

  await ensureFirebaseReady();
  await runTransaction(db(), async (trx) => {
    const ref = doc(db(), 'appConfig', 'superAdmins');
    const snap = await trx.get(ref);
    const emails = ((snap.exists() ? snap.data() : {}) as { emails?: SuperAdminMap }).emails ?? {};
    if (!emails[cleaned]) {
      throw new Error('Email not in Super Admin list');
    }

    const remaining = Object.entries(emails).filter(([email, flag]) => email !== cleaned && flag);
    const removingSelf = normalizeEmail(actor.email) === cleaned;
    if (remaining.length === 0 && removingSelf) {
      throw new Error('Cannot remove the last Super Admin');
    }

    delete emails[cleaned];
    trx.set(
      ref,
      {
        emails,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  });

  await logAdminAction({
    type: 'adminAction',
    level: 'warning',
    message: `Removed Super Admin ${cleaned}`,
    data: {
      action: 'superAdmin:remove',
      targetEmail: cleaned,
      actor: {
        uid: actor.uid,
        email: actor.email ?? null
      }
    },
    userId: actor.uid
  });
}
