// src/routes/servers/[serverId]/+page.ts
export const ssr = false; // client-side, for Firebase

import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
  if (!params.serverId) {
    console.error('[+page.ts] Missing params.serverId!');
  }
  return { serverId: params.serverId };
  
};

