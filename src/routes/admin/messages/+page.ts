import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { collectionGroup, getDocs, limit, orderBy, query } from 'firebase/firestore';

export const load: PageLoad = async ({ parent, url }) => {
  await ensureFirebaseReady();
  const parentData = await parent();
  const db = getDb();
  const snapshot = await getDocs(
    query(collectionGroup(db, 'messages'), orderBy('createdAt', 'desc'), limit(120))
  );

  return {
    user: parentData.user,
    messages: snapshot.docs.map((docSnap) => {
      const data = docSnap.data() as Record<string, any>;
      const segments = docSnap.ref.path.split('/');
      let serverId: string | null = null;
      let channelId: string | null = null;
      let dmId: string | null = null;

      if (segments[0] === 'servers') {
        serverId = segments[1] ?? null;
        channelId = segments[3] ?? null;
      } else if (segments[0] === 'dms') {
        dmId = segments[1] ?? null;
      }

      return {
        id: docSnap.id,
        text: data.text ?? data.content ?? '',
        type: data.type ?? 'text',
        authorId: data.uid ?? data.authorId ?? null,
        createdAt: data.createdAt?.toDate?.() ?? null,
        serverId,
        channelId,
        dmId,
        path: docSnap.ref.path
      };
    }),
    initialFilters: {
      serverId: url.searchParams.get('serverId') ?? '',
      authorId: url.searchParams.get('authorId') ?? '',
      dmId: url.searchParams.get('dmId') ?? ''
    }
  };
};
