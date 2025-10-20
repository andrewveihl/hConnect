// src/routes/sign-in/+page.ts
export const ssr = false;

import { redirect } from '@sveltejs/kit';

export async function load() {
  // Lazy-import to avoid bundling Firebase into SSR
  const { getFirebase } = await import('$lib/firebase');
  const { auth } = getFirebase();

  // If already logged in, go home (handled as a redirect, not an error)
  if (auth?.currentUser) {
    throw redirect(302, '/'); // or '/app'
  }

  // Otherwise render the sign-in page
  return {};
}
