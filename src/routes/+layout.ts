// src/routes/+layout.ts
export const ssr = false;

import { redirect } from '@sveltejs/kit';

export async function load({ url }) {
  const { completeRedirectIfNeeded, waitForAuthInit, ensureFirebaseReady } = await import('$lib/firebase');

  await completeRedirectIfNeeded?.();
  // Wait for Firebase to finish resolving the current session.
  await waitForAuthInit();
  const { auth } = await ensureFirebaseReady();

  const isSignedIn = !!auth?.currentUser;

  // Only public path is /sign-in (and its children if you ever add any)
  const isSignInRoute = url.pathname === '/sign-in' || url.pathname.startsWith('/sign-in/');

  if (!isSignedIn && !isSignInRoute) {
    throw redirect(302, '/sign-in');
  }
  if (isSignedIn && isSignInRoute) {
    throw redirect(302, '/');
  }

  return {};
}
