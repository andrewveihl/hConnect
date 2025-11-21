import type { PageLoad } from './$types';
import { DEFAULT_FEATURE_FLAGS } from '$lib/admin/types';

export const load: PageLoad = async ({ parent }) => {
  const parentData = await parent();

  return {
    featureFlags: parentData.featureFlags ?? DEFAULT_FEATURE_FLAGS,
    user: parentData.user
  };
};
