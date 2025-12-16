// src/routes/sign-in/+page.ts
export const ssr = false;

import { redirect } from '@sveltejs/kit';

export async function load() {
	const { completeRedirectIfNeeded, waitForAuthInit, ensureFirebaseReady } =
		await import('$lib/firebase');
	await completeRedirectIfNeeded?.();
	await waitForAuthInit();
	const { auth } = await ensureFirebaseReady();
	if (auth?.currentUser) throw redirect(302, '/');
	return {};
}
