import type { PageLoad } from './$types';
import { fetchLogs } from '$lib/admin/logs';

export const load: PageLoad = async () => {
  return {
    initialLogs: await fetchLogs({ limit: 100 })
  };
};
