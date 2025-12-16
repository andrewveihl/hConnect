import type { LayoutLoad } from './$types';
import { fetchFeatureFlags } from '$lib/admin/featureFlags';
import { fetchSuperAdminEmails, getCurrentUser, isSuperAdmin } from '$lib/admin/superAdmin';
import { redirect } from '@sveltejs/kit';

export const load: LayoutLoad = async () => {
	const user = await getCurrentUser();
	if (!user || !(await isSuperAdmin(user))) {
		throw redirect(303, '/');
	}

	const [featureFlags, superAdminEmails] = await Promise.all([
		fetchFeatureFlags(),
		fetchSuperAdminEmails()
	]);

	return {
		user,
		userEmail: user.email ?? '',
		superAdminEmails,
		featureFlags
	};
};
