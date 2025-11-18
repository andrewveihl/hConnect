<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/user';
  import { superAdminEmailsStore } from '$lib/admin/superAdmin';
  import { triggerTestPush } from '$lib/notify/testPush';

  const STORAGE_KEY = 'hconnect:testPushFab:hidden';
  const superAdminEmails = superAdminEmailsStore();

  let hidden = $state(false);
  let sending = $state(false);
  let status = $state<'idle' | 'success' | 'error'>('idle');
  let message = $state<string | null>(null);
  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    if (browser) {
      hidden = localStorage.getItem(STORAGE_KEY) === '1';
    }
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

  function persistHidden(value: boolean) {
    hidden = value;
    if (!browser) return;
    if (value) {
      localStorage.setItem(STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function dismissFab() {
    if (!isSuperAdmin) return;
    persistHidden(true);
  }

  function restoreFab() {
    persistHidden(false);
  }

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

{#if !hidden}
  <div class="test-push-fab" data-status={status}>
    <button
      type="button"
      class="test-push-fab__button"
      aria-label="Send test push notification"
      aria-busy={sending}
      onclick={handleTestPush}
    >
      <i class="bx bx-bell-ring" aria-hidden="true"></i>
      <span>Test push</span>
    </button>
    {#if isSuperAdmin}
      <button
        type="button"
        class="test-push-fab__dismiss"
        title="Hide test push button"
        onclick={(event) => {
          event.stopPropagation();
          dismissFab();
        }}
      >
        <i class="bx bx-x" aria-hidden="true"></i>
      </button>
    {/if}
    {#if message}
      <p class="test-push-fab__status" aria-live="polite">{message}</p>
    {/if}
  </div>
{:else if isSuperAdmin}
  <button type="button" class="test-push-fab__restore" onclick={restoreFab}>
    <i class="bx bx-bell" aria-hidden="true"></i>
    <span>Show Test Push</span>
  </button>
{/if}

<style>
  .test-push-fab {
    position: fixed;
    right: calc(clamp(0.85rem, 2.5vw, 1.75rem) + 4.1rem);
    bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    z-index: 59;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.4rem;
  }

  .test-push-fab__button {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-border-strong) 55%, transparent);
    background: color-mix(in srgb, var(--surface-panel) 90%, transparent);
    color: var(--text-90);
    font-weight: 600;
    letter-spacing: 0.01em;
    padding: 0.6rem 1.1rem;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.25);
    cursor: pointer;
    transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease;
  }

  .test-push-fab__button[aria-busy='true'] {
    opacity: 0.7;
    pointer-events: none;
  }

  .test-push-fab__button:hover,
  .test-push-fab__button:focus-visible {
    transform: translateY(-2px);
    box-shadow: 0 16px 30px rgba(15, 23, 42, 0.3);
    outline: none;
  }

  .test-push-fab__button i {
    font-size: 1.2rem;
  }

  .test-push-fab__dismiss {
    position: absolute;
    top: -0.4rem;
    left: -0.4rem;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    border: none;
    background: rgba(15, 23, 42, 0.8);
    color: #f8fafc;
    display: grid;
    place-items: center;
    cursor: pointer;
    font-size: 0.95rem;
  }

  .test-push-fab__status {
    font-size: 0.82rem;
    margin: 0;
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface-panel) 80%, transparent);
    color: var(--text-70);
  }

  .test-push-fab[data-status='success'] .test-push-fab__status {
    color: color-mix(in srgb, var(--color-success, #22c55e) 85%, var(--text-70));
  }

  .test-push-fab[data-status='error'] .test-push-fab__status {
    color: color-mix(in srgb, var(--color-danger, #f87171) 85%, var(--text-70));
  }

  .test-push-fab__restore {
    position: fixed;
    right: calc(clamp(0.85rem, 2.5vw, 1.75rem) + 4.1rem);
    bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    border-radius: 999px;
    border: 1px dashed color-mix(in srgb, var(--color-border-subtle) 75%, transparent);
    background: color-mix(in srgb, var(--surface-panel) 85%, transparent);
    color: var(--text-70);
    padding: 0.35rem 0.9rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
    z-index: 58;
  }

  .test-push-fab__restore:hover,
  .test-push-fab__restore:focus-visible {
    color: var(--text-90);
    border-color: color-mix(in srgb, var(--color-border-strong) 65%, transparent);
  }

  @media (max-width: 767px) {
    .test-push-fab,
    .test-push-fab__restore {
      display: none;
    }
  }
</style>
