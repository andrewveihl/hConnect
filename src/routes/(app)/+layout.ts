// src/routes/(app)/+layout.ts
export const ssr = false;

import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';

export async function load() {
	const { completeRedirectIfNeeded, waitForAuthInit, ensureFirebaseReady } =
		await import('$lib/firebase');
	const { user } = await import('$lib/stores/user');

	// IMPORTANT: Preload IndexedDB cache FIRST (before any Firestore calls)
	// This loads servers, channels, DMs, messages from local device storage
	// so the app can paint instantly without waiting for network
	if (browser) {
		const { preloadCacheFromDb } = await import('$lib/perf');
		await preloadCacheFromDb();
	}

	await completeRedirectIfNeeded?.();
	await waitForAuthInit();
	const { auth } = await ensureFirebaseReady();

	if (!auth?.currentUser) {
		throw redirect(302, '/sign-in');
	}

	// Pre-populate the user store so reactive effects in child components
	// have access to the authenticated user immediately on first render.
	// This prevents race conditions where subscriptions start before $user is set.
	user.set(auth.currentUser);

	return {};
}
