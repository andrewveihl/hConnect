export const ssr = false;

import { redirect } from '@sveltejs/kit';

export async function load({ url }) {
  const { getFirebase, completeRedirectIfNeeded } = await import('$lib/firebase');

  if (typeof completeRedirectIfNeeded === 'function') {
    await completeRedirectIfNeeded();
  }

  const { auth } = getFirebase();

  // If already logged in, respect ?next=… or go home
  if (auth.currentUser) {
    const next = url.searchParams.get('next') || '/';
    throw redirect(302, next);
  }

  return {};
}
