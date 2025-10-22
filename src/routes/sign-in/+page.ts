// src/routes/sign-in/+page.ts
export const ssr = false;

import { redirect } from '@sveltejs/kit';

export async function load() {
  const { getFirebase, completeRedirectIfNeeded, waitForAuthInit } = await import('$lib/firebase');
  await completeRedirectIfNeeded?.();
  await waitForAuthInit();
  const { auth } = getFirebase();
  if (auth.currentUser) throw redirect(302, '/');
  return {};
}
