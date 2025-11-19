<script lang="ts">
import { browser } from '$app/environment';
import { onMount } from 'svelte';
import { user } from '$lib/stores/user';
import { superAdminEmailsStore } from '$lib/admin/superAdmin';
  import { triggerTestPush } from '$lib/notify/testPush';
  import { listenForTestPushDelivery, getCurrentDeviceId, pingServiceWorker } from '$lib/notify/push';

  const superAdminEmails = superAdminEmailsStore();

const DELIVERY_TIMEOUT_MS = 10000;

let sending = $state(false);
let status = $state<'idle' | 'success' | 'error'>('idle');
let message = $state<string | null>(null);
let pendingTest = $state<{ messageId: string | null; startedAt: number } | null>(null);
  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  let deliveryTimeout: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeDelivery: (() => void) | null = null;

  onMount(() => {
    if (browser) {
      unsubscribeDelivery = listenForTestPushDelivery((payload) => {
        if (!pendingTest) return;
        const localDevice = getCurrentDeviceId();
        if (payload.deviceId && localDevice && payload.deviceId !== localDevice) return;
        if (pendingTest.messageId && payload.messageId && pendingTest.messageId !== payload.messageId) return;
        pendingTest = null;
        if (deliveryTimeout) {
          clearTimeout(deliveryTimeout);
          deliveryTimeout = null;
        }
        if (payload.status === 'failed') {
          status = 'error';
          message =
            payload.error ??
            'Edge could not display the notification. Check site permissions and try turning notifications off/on again.';
        } else {
          status = 'success';
          message = 'Notification displayed on this device.';
        }
        scheduleClear({ force: payload.status !== 'failed' });
      });
    }
    return () => {
      if (clearTimer) clearTimeout(clearTimer);
      if (deliveryTimeout) clearTimeout(deliveryTimeout);
      unsubscribeDelivery?.();
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

  function scheduleClear(options: { force?: boolean } = {}) {
    const { force = false } = options;
    if (!browser) return;
    if (clearTimer) clearTimeout(clearTimer);
    if (pendingTest) return;
    if (!force && status === 'error') return;
    clearTimer = setTimeout(() => {
      message = null;
      status = 'idle';
    }, 4000);
  }

  function scheduleDeliveryWatch() {
    if (deliveryTimeout) clearTimeout(deliveryTimeout);
    deliveryTimeout = setTimeout(() => {
      deliveryTimeout = null;
      if (!pendingTest) return;
      void handleUndeliveredPush();
    }, DELIVERY_TIMEOUT_MS);
  }

  function resolveError(reason?: string | null) {
    const enableMessage = 'Enable push notifications on this device first (Settings -> Notifications).';
    switch (reason) {
      case 'missing_device':
      case 'device_not_registered':
      case 'no_tokens':
        return enableMessage;
      case 'no_service_worker':
        return 'Could not reach the push service worker. Refresh this page and ensure notifications are enabled.';
      default:
        return 'Test push failed.';
    }
  }

  async function handleTestPush() {
    if (!$user?.uid) {
      status = 'error';
      message = 'Sign in to send a test push.';
      scheduleClear();
      return;
    }
    if (!browser || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      status = 'error';
      message = resolveError('no_service_worker');
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
        pendingTest = { messageId: result.messageId ?? null, startedAt: Date.now() };
        const suffix = count === 1 ? 'device' : 'devices';
        message = count > 0 ? `Sent to ${count} ${suffix}. Waiting for delivery...` : 'Test notification sent.';
        scheduleDeliveryWatch();
      } else {
        status = 'error';
        pendingTest = null;
        message = resolveError(result.reason);
      }
    } catch {
      status = 'error';
      pendingTest = null;
      message = 'Could not send test push.';
    } finally {
      sending = false;
      scheduleClear();
    }
  }

  async function handleUndeliveredPush() {
    if (!pendingTest) return;
    const currentTest = pendingTest;
    pendingTest = null;
    const workerResponsive = await pingServiceWorker(currentTest.messageId ?? undefined);
    const reason = await diagnoseDeliveryIssue(workerResponsive);
    status = 'error';
    message = reason;
    scheduleClear();
  }

  async function diagnoseDeliveryIssue(workerResponsive: boolean): Promise<string> {
    if (!browser) {
      return 'Sent push but this browser did not confirm delivery.';
    }
    if (!('Notification' in window)) {
      return 'This browser does not support notifications.';
    }
    const diagnostics: string[] = [];
    const deviceId = getCurrentDeviceId();
    diagnostics.push(`deviceId=${deviceId ?? 'unknown'}`);
    diagnostics.push(`userAgent=${navigator.userAgent}`);
    diagnostics.push(`notificationPermission=${Notification.permission}`);
    if (Notification.permission === 'default') {
      return [
        'Notifications have not been enabled yet. Allow notifications using the browser permissions prompt.',
        formatDiagnostics(diagnostics)
      ].join('\n');
    }
    if (Notification.permission === 'denied') {
      return [
        'Notifications are blocked for this site. Enable them in your browser site settings.',
        formatDiagnostics(diagnostics)
      ].join('\n');
    }
    if (!('serviceWorker' in navigator)) {
      return 'This browser cannot run the push service worker required for notifications.';
    }
    let registration: ServiceWorkerRegistration | null = null;
    try {
      registration = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    } catch {
      registration = null;
    }
    if (!registration) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        registration = regs.find((reg) => reg.active?.scriptURL?.includes('firebase-messaging-sw.js')) ?? null;
      } catch {
        registration = null;
      }
    }
    const controller = navigator.serviceWorker.controller;
    diagnostics.push(`swController=${controller ? controller.scriptURL ?? 'present' : 'missing'}`);
    if (!registration) {
      diagnostics.push('swRegistration=missing');
      return [
        'Push service worker is not registered. Reload the page after enabling notifications.',
        formatDiagnostics(diagnostics)
      ].join('\n');
    }
    diagnostics.push(`swScope=${registration.scope}`);
    diagnostics.push(
      `swScript=${registration.active?.scriptURL ?? registration.waiting?.scriptURL ?? registration.installing?.scriptURL ?? 'unknown'}`
    );
    diagnostics.push(`swState=${registration.active?.state ?? registration.waiting?.state ?? registration.installing?.state ?? 'none'}`);
    if (registration.active?.state !== 'activated') {
      return [
        `Push service worker is still initializing (state=${registration.active?.state ?? 'none'}). Wait a moment and try again.`,
        formatDiagnostics(diagnostics)
      ].join('\n');
    }
    try {
      const subscription = await registration.pushManager.getSubscription();
      diagnostics.push(`pushSubscription=${subscription ? 'present' : 'missing'}`);
      if (subscription?.endpoint) {
        diagnostics.push(`subscriptionEndpointSuffix=${subscription.endpoint.slice(-12)}`);
      }
      if (!subscription) {
        return [
          'This browser is not subscribed for push notifications. Re-enable notifications via Settings -> Notifications.',
          formatDiagnostics(diagnostics)
        ].join('\n');
      }
    } catch {
      diagnostics.push('pushSubscription=error');
      return [
        'Could not read the push subscription. Refresh the page and re-enable notifications.',
        formatDiagnostics(diagnostics)
      ].join('\n');
    }
    if (!controller) {
      return [
        'We sent the push notification but no controlled service worker acknowledged it. Reload the page to ensure the messaging worker is controlling this tab.',
        formatDiagnostics(diagnostics)
      ].join('\n');
    }
    diagnostics.push(`controllerState=${controller.state ?? 'unknown'}`);
    diagnostics.push(`swPingResponsive=${workerResponsive}`);
    if (!workerResponsive) {
      return [
        'Push service worker did not respond to a ping. Reload the page so the worker controls this tab, then try again.',
        formatDiagnostics(diagnostics)
      ].join('\n');
    }
    return [
      'We sent the push notification but did not receive a delivery acknowledgement from this device.',
      formatDiagnostics(diagnostics)
    ].join('\n');
  }

  function formatDiagnostics(lines: string[]) {
    if (!lines.length) return '';
    return `Diagnostics:\n- ${lines.join('\n- ')}`;
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
