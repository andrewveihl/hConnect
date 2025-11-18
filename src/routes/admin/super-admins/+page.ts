import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { collection, getDocs, query, where, limit } from 'firebase/firestore';

const chunkArray = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

export const load: PageLoad = async ({ parent }) => {
  await ensureFirebaseReady();
  const parentData = await parent();
  const emails = parentData.superAdminEmails ?? [];
  const db = getDb();
  const lookup: Record<string, { displayName: string | null }> = {};

  for (const batch of chunkArray(emails.filter(Boolean), 10)) {
    const snap = await getDocs(
      query(collection(db, 'profiles'), where('email', 'in', batch), limit(10))
    );
    snap.docs.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, any>;
      const email = (data.email ?? '').toLowerCase();
      if (email) {
        lookup[email] = {
          displayName: data.displayName ?? data.name ?? null
        };
      }
    });
  }

  const superAdmins = emails.map((email) => ({
    email,
    displayName: lookup[email.toLowerCase()]?.displayName ?? null
  }));

  return {
    superAdmins,
    profileLookup: lookup,
    user: parentData.user
  };
};
