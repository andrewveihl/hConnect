import type { PageLoad } from './$types';
import { fetchClientErrors, fetchLogs } from '$lib/admin/logs';

export const load: PageLoad = async () => {
  return {
    initialLogs: await fetchLogs({ limit: 100 }),
    initialClientErrors: await fetchClientErrors(50)
  };
};
