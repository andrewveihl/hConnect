import { derived } from 'svelte/store';
import { featureFlagsStore } from '$lib/admin/featureFlags';
import type { FeatureFlagKey } from '$lib/admin/types';

export const featureFlags = featureFlagsStore();

export const featureFlag = (key: FeatureFlagKey) =>
	derived(featureFlags, (flags) => Boolean(flags[key]));
