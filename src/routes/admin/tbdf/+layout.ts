import type { LayoutLoad } from './$types';
import { getCurrentUser, isSuperAdmin } from '$lib/admin/superAdmin';
import { redirect } from '@sveltejs/kit';

export const load: LayoutLoad = async () => {
	const user = await getCurrentUser();
	if (!user || !(await isSuperAdmin(user))) {
		throw redirect(303, '/');
	}

	return {
		user,
		userEmail: user.email ?? ''
	};
};
