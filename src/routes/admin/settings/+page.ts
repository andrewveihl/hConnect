import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

const DEFAULT_SETTINGS = {
  logRetentionDays: 7,
  archiveRetentionDays: 365,
  requireDoubleConfirm: true,
  extraLogging: false
};

export const load: PageLoad = async ({ parent }) => {
  await ensureFirebaseReady();
  const parentData = await parent();
  const db = getDb();
  const ref = doc(db, 'appConfig', 'adminSettings');
  const snap = await getDoc(ref);

  return {
    user: parentData.user,
    settings: snap.exists() ? { ...DEFAULT_SETTINGS, ...(snap.data() as Record<string, any>) } : DEFAULT_SETTINGS
  };
};
