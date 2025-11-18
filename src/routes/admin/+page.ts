import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { collection, getCountFromServer, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { fetchLogs } from '$lib/admin/logs';

export const load: PageLoad = async () => {
  await ensureFirebaseReady();
  const database = getDb();

  const [serversAgg, usersAgg, dmsAgg, logsAgg] = await Promise.all([
    getCountFromServer(collection(database, 'servers')),
    getCountFromServer(collection(database, 'profiles')),
    getCountFromServer(collection(database, 'dms')),
    getCountFromServer(collection(database, 'logs'))
  ]);

  const spotlightSnapshot = await getDocs(
    query(collection(database, 'servers'), orderBy('createdAt', 'desc'), limit(5))
  );

  const baseLogs = await fetchLogs({ limit: 25 });
  const recentLogs = baseLogs.slice(0, 10);
  const recentErrorLogs = baseLogs.filter((log) => log.level === 'error').slice(0, 8);

  return {
    stats: {
      servers: serversAgg.data().count ?? 0,
      users: usersAgg.data().count ?? 0,
      dms: dmsAgg.data().count ?? 0,
      logs: logsAgg.data().count ?? 0
    },
    spotlightServers: spotlightSnapshot.docs.map((docSnap) => {
      const payload = docSnap.data() as Record<string, any>;
      return {
        id: docSnap.id,
        name: payload.name ?? 'Untitled Server',
        owner: payload.owner ?? 'unknown',
        status: payload.archived === true ? 'archived' : 'active',
        createdAt: payload.createdAt?.toDate?.() ?? null
      };
    }),
    recentLogs,
    recentErrorLogs
  };
};
