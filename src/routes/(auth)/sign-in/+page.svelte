<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/user';
  import { signInWithGoogle, signInWithApple } from '$lib/firebase';
  import logoMarkUrl from '$lib/assets/Logo_transparent.png';

  onMount(() => {
    const unsub = user.subscribe((u) => {
      if (u) goto('/');
    });
    return unsub;
  });

  async function google() {
    try {
      await signInWithGoogle();
      goto('/');
    } catch (error) {
      console.error(error);
    }
  }

  async function apple() {
    try {
      await signInWithApple();
      goto('/');
    } catch (error) {
      console.error(error);
    }
  }
</script>

<svelte:head><title>Sign in</title></svelte:head>

<div class="auth-surface flex min-h-dvh items-center justify-center px-4">
  <div class="auth-panel flex w-full max-w-md flex-col items-center space-y-8 rounded-3xl px-6 py-10 text-center shadow-2xl backdrop-blur">
    <div class="flex flex-col items-center">
      <img class="logo-mark" alt="Healthspaces logo" src={logoMarkUrl} />
      <h2 class="auth-heading mt-6 text-3xl font-bold tracking-tight">Sign in to your account</h2>
    </div>
    <div class="flex flex-col items-center">
      <button
        onclick={google}
        type="button"
        class="primary-action mb-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-center text-sm font-semibold transition">
        <svg class="-ml-1" width="18" height="18" viewBox="0 0 488 512" aria-hidden="true">
          <path
            fill="currentColor"
            d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z" />
        </svg>
        Sign in with Google
      </button>

      <button
        onclick={apple}
        type="button"
        class="secondary-action inline-flex w-full items-center justify-center gap-2 rounded-xl border px-5 py-3 text-center text-sm font-semibold transition">
        <svg class="-ml-1" width="18" height="18" viewBox="0 0 384 512" aria-hidden="true">
          <path
            fill="currentColor"
            d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
        </svg>
        Sign in with Apple
      </button>
    </div>
  </div>
</div>

<style>
  .auth-surface {
    background: radial-gradient(circle at top, rgba(51, 200, 191, 0.25), transparent 55%),
      var(--surface-root);
  }

  .auth-panel {
    background: color-mix(in srgb, var(--color-panel) 75%, rgba(12, 16, 20, 0.4));
    border: 1px solid var(--color-border-subtle);
  }

  .logo-mark {
    height: 9rem;
    width: 9rem;
    border-radius: 1.5rem;
    object-fit: cover;
    background: rgba(255, 255, 255, 0.9);
  }

  .auth-heading {
    color: var(--color-text-primary);
  }

  .primary-action {
    background: linear-gradient(120deg, var(--color-accent), var(--color-accent-strong));
    color: var(--color-text-inverse);
    box-shadow: 0 8px 30px rgba(51, 200, 191, 0.25);
  }

  .primary-action:hover {
    background: var(--button-primary-hover);
  }

  .secondary-action {
    background: rgba(255, 255, 255, 0.02);
    border-color: var(--color-border-subtle);
    color: var(--color-text-primary);
  }

  .secondary-action:hover {
    background: rgba(255, 255, 255, 0.06);
  }
</style>
