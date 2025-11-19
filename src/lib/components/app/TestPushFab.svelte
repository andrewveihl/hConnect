<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/user';
  import { superAdminEmailsStore } from '$lib/admin/superAdmin';
  import { triggerTestPush } from '$lib/notify/testPush';

  const superAdminEmails = superAdminEmailsStore();

  let sending = $state(false);
  let status = $state<'idle' | 'success' | 'error'>('idle');
  let message = $state<string | null>(null);
  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    return () => {
      if (clearTimer) clearTimeout(clearTimer);
    };
  });

  const isSuperAdmin = $derived(
    (() => {
      const email = $user?.email ? $user.email.toLowerCase() : null;
      if (!email) return false;
      const allowList = Array.isArray($superAdminEmails) ? $superAdminEmails : [];
      return allowList.includes(email);
    })()
  );

  function scheduleClear() {
    if (!browser) return;
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      message = null;
      status = 'idle';
    }, 4000);
  }

  async function handleTestPush() {
    if (!$user?.uid) {
      status = 'error';
      message = 'Sign in to send a test push.';
      scheduleClear();
      return;
    }
    sending = true;
    status = 'idle';
    message = null;
    try {
      const result = await triggerTestPush();
      if (result.ok) {
        status = 'success';
        const count = result.tokens ?? 0;
        const suffix = count === 1 ? 'device' : 'devices';
        message = count > 0 ? `Sent to ${count} ${suffix}.` : 'Test notification sent.';
      } else {
        status = 'error';
        message =
          result.reason === 'no_tokens'
            ? 'Enable push on this device first.'
            : 'Test push failed.';
      }
    } catch {
      status = 'error';
      message = 'Could not send test push.';
    } finally {
      sending = false;
      scheduleClear();
    }
  }
</script>

<div class="test-push-fab" data-status={status}>
  <button
    type="button"
    class="test-push-fab__icon"
    aria-label="Send test push notification"
    aria-busy={sending}
    onclick={handleTestPush}
  >
    <i class="bx bx-bell" aria-hidden="true"></i>
    <span class="test-push-fab__label">Test push</span>
  </button>
  {#if message}
    <p class="test-push-fab__status" aria-live="polite">{message}</p>
  {/if}
</div>

<style>
  .test-push-fab {
    width: var(--floating-fab-size, 3.1rem);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.45rem;
    position: relative;
  }

  .test-push-fab__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    width: 100%;
    height: var(--floating-fab-size, 3.1rem);
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--color-border-strong) 55%, transparent);
    background: color-mix(in srgb, var(--surface-panel) 92%, transparent);
    color: var(--text-90);
    box-shadow: 0 12px 26px rgba(15, 23, 42, 0.28);
    cursor: pointer;
    transition: transform 150ms ease, box-shadow 150ms ease, opacity 150ms ease;
    padding: 0;
  }

  .test-push-fab__icon[aria-busy='true'] {
    opacity: 0.7;
    pointer-events: none;
  }

  .test-push-fab__icon:hover,
  .test-push-fab__icon:focus-visible {
    transform: translateY(-1px);
    box-shadow: 0 16px 30px rgba(15, 23, 42, 0.32);
    outline: none;
  }

  .test-push-fab__icon i {
    font-size: 1.2rem;
  }

  .test-push-fab__label {
    display: none;
  }

  .test-push-fab__status {
    font-size: 0.78rem;
    margin: 0;
    padding: 0.25rem 0.65rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface-panel) 80%, transparent);
    color: var(--text-70);
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.25);
    max-width: min(13rem, 72vw);
    text-align: center;
  }

  .test-push-fab__admin-toggle {
    border: none;
    background: transparent;
    color: var(--text-50);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    padding: 0.15rem 0.4rem;
    border-radius: 999px;
    transition: color 120ms ease, background 120ms ease;
  }

  .test-push-fab__admin-toggle:hover,
  .test-push-fab__admin-toggle:focus-visible {
    color: var(--text-80);
    background: color-mix(in srgb, var(--surface-panel) 40%, transparent);
    outline: none;
  }

  .test-push-fab[data-status='success'] .test-push-fab__status {
    color: color-mix(in srgb, var(--color-success, #22c55e) 85%, var(--text-70));
  }

  .test-push-fab[data-status='error'] .test-push-fab__status {
    color: color-mix(in srgb, var(--color-danger, #f87171) 85%, var(--text-70));
  }

  @media (prefers-reduced-motion: reduce) {
    .test-push-fab__icon {
      transition: none;
    }
  }
</style>
