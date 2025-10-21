export const ssr = false;

import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
  // IMPORTANT: your folder is [serversID], so the param name is "serversID"
  // Map it to "serverId" so the rest of your code can keep using serverId
  return {
    serverId: params.serversID
  };
};
