<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/user';
  import { signInWithGoogle, signInWithApple } from '$lib/firebase';

  let status = $state('Ready');
  let errorMsg = $state('');

  onMount(() => {
    const unsub = user.subscribe((u) => {
      if (u) goto('/');
    });
    return unsub;
  });

  async function google() {
    status = 'Opening Google...';
    errorMsg = '';
    try {
      await signInWithGoogle();
      status = 'Signed in';
      goto('/');
    } catch (e: any) {
      errorMsg = e?.message || String(e);
      status = 'Failed';
    }
  }

  async function apple() {
    status = 'Opening Apple...';
    errorMsg = '';
    try {
      await signInWithApple();
      status = 'Signed in';
      goto('/');
    } catch (e: any) {
      errorMsg = e?.message || String(e);
      status = 'Failed';
    }
  }
</script>

<svelte:head><title>Sign in</title></svelte:head>

<div class="min-h-dvh grid place-items-center">
  <div class="w-[92%] max-w-md rounded-3xl bg-white/5 backdrop-blur-xl shadow-2xl ring-1 ring-white/10 p-8 sm:p-10">
    <div class="mb-6 text-center">
      <div class="mx-auto mb-4 h-12 w-12 rounded-2xl bg-white/10 grid place-items-center">HC</div>
      <h1 class="text-2xl"><span class="font-semibold">Welcome</span></h1>
      <p class="text-white/70">Sign in to continue</p>
    </div>

    <div class="mb-4 text-xs">
      <div class="text-white/80">Status: {status}</div>
      {#if errorMsg}<div class="text-rose-400">{errorMsg}</div>{/if}
    </div>

    <div class="space-y-3">
      <button
        onclick={google}
        class="w-full rounded-xl border border-white/15 bg-white text-slate-900 px-4 py-3 text-sm font-medium hover:bg-white/95 active:scale-[.99]">
        Continue with Google
      </button>

      <button
        onclick={apple}
        class="w-full rounded-xl border border-white/15 bg-black text-white px-4 py-3 text-sm font-medium hover:bg-black/90 active:scale-[.99]">
        Continue with Apple
      </button>
    </div>

    <p class="mt-6 text-center text-xs text-white/60">
      By continuing, you agree to our
      <a href="/legal/terms" class="underline decoration-white/30 hover:decoration-white">Terms</a>
      and
      <a href="/legal/privacy" class="underline decoration-white/30 hover:decoration-white">Privacy</a>.
    </p>

    <p class="mt-4 text-center text-sm text-white/70">
      Having trouble? <a href="/support" class="underline decoration-white/30 hover:decoration-white">Contact support</a>
    </p>
  </div>
</div>
