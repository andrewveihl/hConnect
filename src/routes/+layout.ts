// ✅ Client-only; avoids SSR + Firebase mismatches
export const ssr = false;

import { redirect, type Load } from '@sveltejs/kit';

export const load: Load = async ({ url }) => {
  const isSignIn = url.pathname === '/sign-in';

  // Lazy-load to avoid SSR issues
  const { getFirebase, completeRedirectIfNeeded } = await import('$lib/firebase');

  // If an OAuth redirect is pending (e.g., Apple/Safari), finish it
  if (typeof completeRedirectIfNeeded === 'function') {
    await completeRedirectIfNeeded();
  }

  const { auth } = getFirebase();

  // 🔒 Allow the sign-in route to render WITHOUT any Firestore/Auth gating side-effects.
  // (Do not subscribe and do not query Firestore here.)
  if (isSignIn) {
    // If already signed in, bounce to next/home right away
    if (auth.currentUser) {
      const next = url.searchParams.get('next') || '/';
      throw redirect(302, next);
    }
    return { user: null };
  }

  // 🔑 For every other route, wait exactly once for auth state.
  const user = await new Promise<import('firebase/auth').User | null>((resolve) => {
    const unsub = auth.onAuthStateChanged((u) => {
      resolve(u);
      unsub();
    });
  });

  if (!user) {
    const next = encodeURIComponent(url.pathname + url.search);
    throw redirect(302, `/sign-in?next=${next}`);
  }

  return { user };
};
