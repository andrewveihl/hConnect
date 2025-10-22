export const ssr = false;
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
  return { threadID: params.threadID };
};
