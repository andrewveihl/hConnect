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
let copyStatusState = $state<'idle' | 'copying' | 'copied' | 'error'>('idle');
let statusDebugLines = $state<string[]>([]);
  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  let deliveryTimeout: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeDelivery: (() => void) | null = null;

  onMount(() => {
    if (browser) {
      unsubscribeDelivery = listenForTestPushDelivery((payload) => {
        pushStatusDebug('listenForTestPushDelivery payload received', {
          payloadDeviceId: payload.deviceId ?? null,
          payloadMessageId: payload.messageId ?? null,
          status: payload.status,
          pendingMessageId: pendingTest?.messageId ?? null
        });
        if (!pendingTest) {
          pushStatusDebug('TEST_PUSH_RESULT received but no pending test', {
            payloadDeviceId: payload.deviceId ?? null,
            payloadMessageId: payload.messageId ?? null
          });
          return;
        }
        const localDevice = getCurrentDeviceId();
        if (payload.deviceId && localDevice && payload.deviceId !== localDevice) {
          pushStatusDebug('Ignoring TEST_PUSH_RESULT for different device', {
            localDevice,
            payloadDevice: payload.deviceId,
            pendingMessageId: pendingTest.messageId
          });
          return;
        }
        if (pendingTest.messageId && payload.messageId && pendingTest.messageId !== payload.messageId) {
          pushStatusDebug('Ignoring TEST_PUSH_RESULT for mismatched messageId', {
            pendingMessageId: pendingTest.messageId,
            payloadMessageId: payload.messageId
          });
          return;
        }
        pushStatusDebug('TEST_PUSH_RESULT message received', {
          payloadDeviceId: payload.deviceId ?? null,
          payloadMessageId: payload.messageId ?? null,
          status: payload.status,
          pendingMessageId: pendingTest?.messageId ?? null
        });
        pendingTest = null;
        pushStatusDebug('Pending test cleared due to TEST_PUSH_RESULT');
        if (deliveryTimeout) {
          clearTimeout(deliveryTimeout);
          deliveryTimeout = null;
        }
        if (payload.status === 'failed') {
          status = 'error';
          updateStatusMessage(
            payload.error ??
              'Edge could not display the notification. Check site permissions and try turning notifications off/on again.'
          );
          pushStatusDebug('Delivery event reported failure', {
            error: payload.error ?? null,
            messageId: payload.messageId ?? null
          });
        } else {
          status = 'success';
          updateStatusMessage('Notification displayed on this device.');
          pushStatusDebug('Delivery confirmed by service worker', {
            messageId: payload.messageId ?? null
          });
        }
        scheduleClear({ force: payload.status !== 'failed' });
      });
      pushStatusDebug('listenForTestPushDelivery subscribed', {
        hasController:
          typeof navigator !== 'undefined' && 'serviceWorker' in navigator
            ? Boolean(navigator.serviceWorker.controller)
            : false
      });
    }
    return () => {
      if (clearTimer) clearTimeout(clearTimer);
      if (deliveryTimeout) clearTimeout(deliveryTimeout);
      unsubscribeDelivery?.();
      pushStatusDebug('listenForTestPushDelivery unsubscribed');
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
      updateStatusMessage(null);
      status = 'idle';
    }, 4000);
  }

  function scheduleDeliveryWatch() {
    if (deliveryTimeout) clearTimeout(deliveryTimeout);
    pushStatusDebug('Watching for delivery acknowledgement', {
      timeoutMs: DELIVERY_TIMEOUT_MS,
      pendingMessageId: pendingTest?.messageId ?? null,
      pendingSince: pendingTest?.startedAt ?? null
    });
    deliveryTimeout = setTimeout(() => {
      deliveryTimeout = null;
       pushStatusDebug('Delivery acknowledgement timeout fired', {
        hadPendingTest: Boolean(pendingTest),
        pendingMessageId: pendingTest?.messageId ?? null
      });
      if (!pendingTest) return;
      void handleUndeliveredPush();
    }, DELIVERY_TIMEOUT_MS);
  }

  function updateStatusMessage(value: string | null, options: { preserveLog?: boolean } = {}) {
    const { preserveLog = false } = options;
    message = value;
    copyStatusState = 'idle';
    if (value === null && !preserveLog) {
      resetStatusDebugLog();
    }
  }

  function resetStatusDebugLog() {
    statusDebugLines = [];
  }

  function pushStatusDebug(message: string, details?: unknown) {
    const ts = new Date().toLocaleTimeString([], { hour12: false });
    const formattedDetails = details !== undefined ? formatDebugDetails(details) : null;
    const entry = formattedDetails ? `${ts} — ${message}\n${formattedDetails}` : `${ts} — ${message}`;
    statusDebugLines = [...statusDebugLines, entry].slice(-30);
    if (formattedDetails) {
      console.info('[test-push-debug]', message, details);
    } else {
      console.info('[test-push-debug]', message);
    }
  }

  function formatDebugDetails(details: unknown) {
    if (details === null || details === undefined) return null;
    if (typeof details === 'string') return details;
    try {
      return JSON.stringify(details, null, 2);
    } catch (error) {
      return String(details);
    }
  }

  async function copyStatusMessage() {
    if (!message) return;
    const text = buildStatusCopyText();
    copyStatusState = 'copying';
    const success = await writeToClipboard(text);
    copyStatusState = success ? 'copied' : 'error';
    if (success) {
      setTimeout(() => {
        copyStatusState = 'idle';
      }, 2000);
    }
  }

  function buildStatusCopyText() {
    const lines: string[] = [];
    if (message) {
      lines.push(message);
    }
    if (statusDebugLines.length) {
      lines.push('', 'Debug log:');
      statusDebugLines.forEach((line) => {
        lines.push(line);
      });
    }
    return lines.join('\n');
  }

  function closeStatusMessage() {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    updateStatusMessage(null);
    if (status !== 'success') {
      status = 'idle';
    }
  }

  async function writeToClipboard(text: string) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      console.warn('clipboard.writeText failed', error);
    }
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      return document.execCommand('copy');
    } catch (error) {
      console.warn('execCommand copy failed', error);
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }

  async function showLocalTestNotification() {
    if (
      !browser ||
      typeof Notification === 'undefined' ||
      Notification.permission !== 'granted'
    ) {
      return;
    }
    try {
      const registration = await navigator.serviceWorker?.ready;
      if (!registration?.showNotification) return;
      const targetUrl = '/settings?origin=test_push';
      await registration.showNotification('hConnect test notification', {
        body: 'Tap to open hConnect. If push is enabled you will also get the remote notification.',
        icon: '/Logo_transparent.png',
        tag: 'hconnect:test-push',
        requireInteraction: true,
        data: {
          origin: 'local_test_push',
          targetUrl,
          timestamp: Date.now()
        }
      });
      pushStatusDebug('Local test notification displayed via service worker');
    } catch (error) {
      pushStatusDebug(
        'Local test notification failed',
        error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      );
    }
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
    resetStatusDebugLog();
    pushStatusDebug('handleTestPush invoked', {
      hasUser: Boolean($user?.uid),
      deviceId: getCurrentDeviceId()
    });
    if (!$user?.uid) {
      status = 'error';
      updateStatusMessage('Sign in to send a test push.');
      pushStatusDebug('Aborting test push: no signed-in user');
      scheduleClear();
      return;
    }
    if (!browser || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      status = 'error';
      updateStatusMessage(resolveError('no_service_worker'));
      pushStatusDebug('Aborting test push: service worker API unavailable');
      scheduleClear();
      return;
    }
    sending = true;
    status = 'idle';
    updateStatusMessage(null, { preserveLog: true });
    pushStatusDebug('Calling triggerTestPush', {
      hasController:
        typeof navigator !== 'undefined' && 'serviceWorker' in navigator
          ? Boolean(navigator.serviceWorker.controller)
          : false
    });
    try {
      const result = await triggerTestPush();
      pushStatusDebug('triggerTestPush result', {
        ok: result.ok,
        tokens: result.tokens ?? 0,
        reason: result.reason ?? null,
        messageId: result.messageId ?? null
      });
      if (result.ok) {
        status = 'success';
        const count = result.tokens ?? 0;
        pendingTest = { messageId: result.messageId ?? null, startedAt: Date.now() };
        pushStatusDebug('Tracking pending test push', {
          messageId: pendingTest.messageId ?? null,
          startedAt: pendingTest.startedAt
        });
        const suffix = count === 1 ? 'device' : 'devices';
        updateStatusMessage(
          count > 0 ? `Sent to ${count} ${suffix}. Waiting for delivery...` : 'Test notification sent.'
        );
        pushStatusDebug('Awaiting delivery acknowledgement', {
          pendingMessageId: pendingTest.messageId,
          tokens: count
        });
        scheduleDeliveryWatch();
        void showLocalTestNotification();
      } else {
        status = 'error';
        pendingTest = null;
        updateStatusMessage(resolveError(result.reason));
        pushStatusDebug('triggerTestPush indicated failure', {
          reason: result.reason ?? 'unknown'
        });
      }
    } catch (error) {
      status = 'error';
      pendingTest = null;
      updateStatusMessage('Could not send test push.');
      pushStatusDebug('triggerTestPush threw', error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    } finally {
      sending = false;
      scheduleClear();
    }
  }

  async function handleUndeliveredPush() {
    if (!pendingTest) {
      pushStatusDebug('handleUndeliveredPush aborted (no pending test)');
      return;
    }
    const currentTest = pendingTest;
    pendingTest = null;
    pushStatusDebug('Pending test cleared due to timeout/diagnostics');
    pushStatusDebug('handleUndeliveredPush invoked', {
      pendingMessageId: currentTest.messageId
    });
    const workerResponsive = await pingServiceWorker(currentTest.messageId ?? undefined);
    pushStatusDebug('pingServiceWorker result', {
      workerResponsive,
      messageId: currentTest.messageId ?? null
    });
    const reason = await diagnoseDeliveryIssue(workerResponsive);
    status = 'error';
    updateStatusMessage(reason);
    pushStatusDebug('handleUndeliveredPush completed', { reason });
    scheduleClear();
  }

  async function diagnoseDeliveryIssue(workerResponsive: boolean): Promise<string> {
    pushStatusDebug('diagnoseDeliveryIssue invoked', { workerResponsive });
    if (!browser) {
      const reason = 'Sent push but this browser did not confirm delivery.';
      pushStatusDebug('diagnoseDeliveryIssue result', { reason });
      return reason;
    }
    if (!('Notification' in window)) {
      const reason = 'This browser does not support notifications.';
      pushStatusDebug('diagnoseDeliveryIssue result', { reason });
      return reason;
    }
    const diagnostics: string[] = [];
    const finish = (reason: string) => {
      pushStatusDebug('diagnoseDeliveryIssue result', { reason, diagnostics });
      return [reason, formatDiagnostics(diagnostics)].join('\n');
    };
    const deviceId = getCurrentDeviceId();
    diagnostics.push(`deviceId=${deviceId ?? 'unknown'}`);
    diagnostics.push(`userAgent=${navigator.userAgent}`);
    diagnostics.push(`notificationPermission=${Notification.permission}`);
    if (Notification.permission === 'default') {
      return finish(
        'Notifications have not been enabled yet. Allow notifications using the browser permissions prompt.'
      );
    }
    if (Notification.permission === 'denied') {
      return finish('Notifications are blocked for this site. Enable them in your browser site settings.');
    }
    if (!('serviceWorker' in navigator)) {
      return finish('This browser cannot run the push service worker required for notifications.');
    }
    let registration: ServiceWorkerRegistration | null = null;
    try {
      registration = (await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js')) ?? null;
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
      return finish('Push service worker is not registered. Reload the page after enabling notifications.');
    }
    diagnostics.push(`swScope=${registration.scope}`);
    diagnostics.push(
      `swScript=${registration.active?.scriptURL ?? registration.waiting?.scriptURL ?? registration.installing?.scriptURL ?? 'unknown'}`
    );
    diagnostics.push(`swState=${registration.active?.state ?? registration.waiting?.state ?? registration.installing?.state ?? 'none'}`);
    if (registration.active?.state !== 'activated') {
      return finish(
        `Push service worker is still initializing (state=${registration.active?.state ?? 'none'}). Wait a moment and try again.`
      );
    }
    try {
      const subscription = await registration.pushManager.getSubscription();
      diagnostics.push(`pushSubscription=${subscription ? 'present' : 'missing'}`);
      if (subscription?.endpoint) {
        diagnostics.push(`subscriptionEndpointSuffix=${subscription.endpoint.slice(-12)}`);
      }
      if (!subscription) {
        return finish(
          'This browser is not subscribed for push notifications. Re-enable notifications via Settings -> Notifications.'
        );
      }
    } catch {
      diagnostics.push('pushSubscription=error');
      return finish('Could not read the push subscription. Refresh the page and re-enable notifications.');
    }
    if (!controller) {
      return finish(
        'We sent the push notification but no controlled service worker acknowledged it. Reload the page to ensure the messaging worker is controlling this tab.'
      );
    }
    diagnostics.push(`controllerState=${controller.state ?? 'unknown'}`);
    diagnostics.push(`swPingResponsive=${workerResponsive}`);
    if (!workerResponsive) {
      return finish(
        'Push service worker did not respond to a ping. Reload the page so the worker controls this tab, then try again.'
      );
    }
    return finish('We sent the push notification but did not receive a delivery acknowledgement from this device.');
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
    <div class="test-push-fab__status">
      <button
        type="button"
        class="test-push-fab__status-close"
        aria-label="Dismiss status message"
        onclick={closeStatusMessage}
      >
        ×
      </button>
      <div class="test-push-fab__status-text" aria-live="polite" aria-atomic="true">
        {message}
      </div>
      <button
        type="button"
        class="test-push-fab__status-btn"
        onclick={copyStatusMessage}
        disabled={copyStatusState === 'copying'}
      >
        {#if copyStatusState === 'copying'}
          Copying…
        {:else if copyStatusState === 'copied'}
          Copied!
        {:else if copyStatusState === 'error'}
          Copy failed
        {:else}
          Copy
        {/if}
      </button>
      {#if statusDebugLines.length}
        <div class="test-push-fab__status-log">
          <p class="test-push-fab__status-log-title">Debug log</p>
          <ol class="test-push-fab__status-log-list">
            {#each statusDebugLines as line, index (line + index)}
              <li class="test-push-fab__status-log-item">
                <pre>{line}</pre>
              </li>
            {/each}
          </ol>
        </div>
      {/if}
    </div>
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
    padding: 0.7rem 2.4rem 0.55rem 0.85rem;
    border-radius: 1rem;
    background: color-mix(in srgb, var(--surface-panel) 80%, transparent);
    color: var(--text-70);
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.25);
    width: min(28rem, 92vw);
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    position: relative;
  }

  .test-push-fab__status-text {
    max-height: 9rem;
    overflow-y: auto;
    padding-right: 0.2rem;
    white-space: pre-line;
    word-break: break-word;
    overflow-wrap: anywhere;
    line-height: 1.35;
  }

  .test-push-fab__status-btn {
    border: none;
    border-radius: 0.4rem;
    padding: 0.15rem 0.65rem;
    font-size: 0.7rem;
    font-weight: 500;
    cursor: pointer;
    background: color-mix(in srgb, var(--color-accent, #22d3ee) 24%, var(--surface-panel));
    color: var(--text-90);
    transition: opacity 120ms ease;
    align-self: flex-start;
    margin-top: 0.2rem;
  }

  .test-push-fab__status-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .test-push-fab__status-log {
    width: 100%;
    border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    padding-top: 0.35rem;
    margin-top: 0.25rem;
    display: grid;
    gap: 0.3rem;
  }

  .test-push-fab__status-log-title {
    margin: 0;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-50);
  }

  .test-push-fab__status-log-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.25rem;
    max-height: 8.5rem;
    overflow-y: auto;
  }

  .test-push-fab__status-log-item {
    margin: 0;
  }

  .test-push-fab__status-log-item pre {
    margin: 0;
    font-size: 0.7rem;
    white-space: pre-wrap;
    background: color-mix(in srgb, var(--surface-panel) 90%, transparent);
    border-radius: 0.35rem;
    padding: 0.3rem 0.4rem;
    color: var(--text-70);
  }

  .test-push-fab__status-close {
    border: none;
    background: transparent;
    color: var(--text-60);
    font-size: 1.05rem;
    width: 1.8rem;
    height: 1.8rem;
    border-radius: 50%;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 120ms ease, color 120ms ease;
    position: absolute;
    top: 0.15rem;
    right: 0.15rem;
  }

  .test-push-fab__status-close:hover,
  .test-push-fab__status-close:focus-visible {
    background: color-mix(in srgb, var(--surface-panel) 50%, transparent);
    color: var(--text-80);
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
