import type { PageLoad } from './$types';
import { DEFAULT_FEATURE_FLAGS } from '$lib/admin/types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

export const load: PageLoad = async ({ parent }) => {
  await ensureFirebaseReady();
  const parentData = await parent();
  const db = getDb();
  const settingsSnap = await getDoc(doc(db, 'appConfig', 'adminSettings'));
  const defaultTheme = settingsSnap.exists() ? ((settingsSnap.data() as Record<string, any>).defaultTheme ?? 'dark') : 'dark';

  return {
    featureFlags: parentData.featureFlags ?? DEFAULT_FEATURE_FLAGS,
    user: parentData.user,
    defaultTheme
  };
};
