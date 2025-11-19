<script lang="ts">
import { run } from 'svelte/legacy';

import { onMount } from 'svelte';
import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { user } from '$lib/stores/user';
import { theme as themeStore, setTheme, type ThemeMode } from '$lib/stores/theme';
import { db } from '$lib/firestore';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
  import {
    enablePushForUser,
    requestNotificationPermission,
    getCurrentDeviceId,
    pingServiceWorker
  } from '$lib/notify/push';
  import type { PushDebugEvent } from '$lib/notify/push';
  import { triggerTestPush } from '$lib/notify/testPush';

import SignOutButton from '$lib/components/auth/SignOutButton.svelte';
import InvitePanel from '$lib/components/app/InvitePanel.svelte';

  interface Props {
    serverId?: string | null;
  }

  let { serverId = null }: Props = $props();

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FIRESTORE_IMAGE_LIMIT = 900 * 1024; // Keep data URLs safely under 1 MB Firestore limit
const AVATAR_MAX_DIMENSION = 512;

function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

let displayName = $state('');
let photoURL = $state('');
let authPhotoURL = $state('');
let previewPhotoURL = $state('');
let providerPhotoAvailable = $state(false);
let loading = $state(true);
let loadedUid: string | null = $state(null);
let avatarFileInput: HTMLInputElement | null = $state(null);
let avatarError: string | null = $state(null);

  type NotifPrefs = {
    desktopEnabled: boolean;
    pushEnabled: boolean;
    dms: boolean;
    mentions: boolean;
    allMessages: boolean;
  };

  let notif: NotifPrefs = {
    desktopEnabled: false,
    pushEnabled: false,
    dms: true,
    mentions: true,
    allMessages: false
  };

  type AiAssistPrefs = {
    enabled: boolean;
  };

  let aiAssist: AiAssistPrefs = $state({
    enabled: true
  });

  run(() => {
    previewPhotoURL =
      pickString(photoURL) ??
      pickString(authPhotoURL) ??
      pickString($user?.photoURL) ??
      '';
  });

  run(() => {
    providerPhotoAvailable =
      Boolean(pickString(authPhotoURL) ?? pickString($user?.photoURL));
  });

  const themeChoices: Array<{ id: ThemeMode; label: string; description: string }> = [
    { id: 'light', label: 'Light', description: 'Bright panels and the same teal accent palette.' },
    { id: 'dark', label: 'Dark', description: 'Charcoal surfaces with teal highlights.' },
    { id: 'midnight', label: 'Midnight', description: 'Pure black panels with neon teal glow.' },
    { id: 'holiday', label: 'Holiday', description: 'Auto palette that mirrors major celebrations.' }
  ];

  let themeMode: ThemeMode = $state(get(themeStore));
  run(() => {
    themeMode = $themeStore;
  });

  async function loadProfile(uid: string) {
    const database = db();
    const ref = doc(database, 'profiles', uid);

    // Bootstrap document if missing.
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, {
        displayName: $user?.displayName ?? 'New User',
        email: $user?.email ?? null,
        photoURL: $user?.photoURL ?? null,
        createdAt: serverTimestamp(),
        lastActiveAt: serverTimestamp()
      });
    }

    const data = (await getDoc(ref)).data() ?? {};
    displayName = (data.displayName as string) ?? '';

    const storedAuth =
      pickString(data.authPhotoURL) ??
      pickString($user?.photoURL);
    const storedPhoto = pickString(data.photoURL);
    const storedCustom = pickString(data.customPhotoURL);

    authPhotoURL = storedAuth ?? '';

    if (storedCustom) {
      photoURL = storedCustom;
    } else if (storedPhoto && storedAuth && storedPhoto !== storedAuth) {
      photoURL = storedPhoto;
    } else if (storedPhoto && !storedAuth) {
      photoURL = storedPhoto;
    } else {
      photoURL = '';
    }

    loadedUid = uid;

    const settings = (data.settings ?? {}) as any;
    const prefs = (settings.notificationPrefs ?? {}) as any;
    notif = {
      desktopEnabled: !!prefs.desktopEnabled,
      pushEnabled: !!prefs.pushEnabled,
      dms: prefs.dms ?? true,
      mentions: prefs.mentions ?? true,
      allMessages: !!prefs.allMessages
    };

    const aiPrefs = (settings.aiAssist ?? {}) as any;
    aiAssist = {
      enabled: aiPrefs.enabled !== false
    };

    const themePref = settings.theme as ThemeMode | 'seasonal' | undefined;
    if (themePref === 'seasonal') {
      setTheme('holiday', { persist: true });
    } else if (themePref === 'light' || themePref === 'dark' || themePref === 'midnight' || themePref === 'holiday') {
      setTheme(themePref, { persist: true });
    }
  }

  onMount(async () => {
    loading = true;
    if ($user?.uid) {
      await loadProfile($user.uid);
    }
    loading = false;
  });

  run(() => {
    if ($user?.uid && !loadedUid) {
      loading = true;
      loadProfile($user.uid)
        .catch((error) => console.error('Failed to load profile', error))
        .finally(() => {
          loading = false;
        });
    }
  });

  async function save() {
    if (!$user?.uid) return;
    const database = db();
    const customPhoto = pickString(photoURL) ?? null;
    const normalizedAuthPhoto =
      pickString(authPhotoURL) ??
      pickString($user?.photoURL) ??
      null;
    await updateDoc(doc(database, 'profiles', $user.uid), {
      displayName,
      photoURL: customPhoto ?? normalizedAuthPhoto,
      customPhotoURL: customPhoto,
      authPhotoURL: normalizedAuthPhoto,
      lastActiveAt: serverTimestamp(),
      'settings.notificationPrefs': notif,
      'settings.theme': themeMode,
      'settings.aiAssist': aiAssist
    });
    alert('Saved.');
  }

  function useGooglePhoto() {
    const provider =
      pickString($user?.photoURL) ??
      pickString(authPhotoURL);
    if (provider) {
      authPhotoURL = provider;
      photoURL = '';
      avatarError = null;
    }
  }

  function triggerAvatarUpload() {
    avatarFileInput?.click();
  }

  function dataUrlBytes(dataUrl: string): number {
    const base64 = dataUrl.split(',')[1] ?? '';
    return Math.ceil((base64.length * 3) / 4);
  }

  async function compressImageFile(file: File, maxDimension: number): Promise<string> {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = objectUrl;
      });

      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(img.width * scale));
      canvas.height = Math.max(1, Math.floor(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      let quality = 0.92;
      let result = canvas.toDataURL('image/webp', quality);
      while (dataUrlBytes(result) > FIRESTORE_IMAGE_LIMIT && quality > 0.4) {
        quality -= 0.1;
        result = canvas.toDataURL('image/webp', quality);
      }
      if (dataUrlBytes(result) > FIRESTORE_IMAGE_LIMIT) {
        throw new Error('Image is still too large after compression.');
      }
      return result;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function onAvatarFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      avatarError = 'Please choose an image file.';
      input.value = '';
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      avatarError = 'Image must be smaller than 8 MB.';
      input.value = '';
      return;
    }
    try {
      const processed = await compressImageFile(file, AVATAR_MAX_DIMENSION);
      photoURL = processed;
      avatarError = null;
    } catch (error: any) {
      avatarError = error?.message ?? 'Could not process the selected file.';
    }
    input.value = '';
  }

  async function enableDesktopNotifications() {
    const granted = await requestNotificationPermission();
    if (!granted) {
      alert('Notifications are blocked by the browser. Enable them in site settings.');
      return;
    }
    notif.desktopEnabled = true;
  }

  async function enablePush() {
    pushDebugCopyState = 'idle';
    appendPushDebug({ tag: 'enable', message: 'Enable push button clicked.' });
    await logPushEnvironment('Preflight snapshot (enable)');
    const deviceId = getCurrentDeviceId();
    appendPushDebug({
      tag: 'enable',
      message: 'Current device id snapshot.',
      details: { deviceId }
    });
    if (!$user?.uid) {
      appendPushDebug({
        tag: 'enable',
        level: 'error',
        message: 'Cannot enable push without an authenticated user.'
      });
      alert('Sign in to enable push notifications.');
      return;
    }
    if (typeof window === 'undefined') {
      appendPushDebug({
        tag: 'enable',
        level: 'error',
        message: 'Window object not present.'
      });
      alert('Push notifications require a browser environment.');
      return;
    }
    if (typeof Notification === 'undefined') {
      appendPushDebug({
        tag: 'enable',
        level: 'error',
        message: 'Notification API unavailable in this browser.'
      });
      alert('This browser does not support push notifications.');
      return;
    }
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      appendPushDebug({
        tag: 'enable',
        level: 'error',
        message: 'Service worker API missing; cannot register for push.'
      });
      alert('This browser cannot register push service workers.');
      return;
    }
    await pingServiceWorkerForDebug('enable');
    appendPushDebug({
      tag: 'enable',
      message: 'Calling enablePushForUser via Firebase Messaging.'
    });
    try {
      const token = await enablePushForUser($user.uid, {
        prompt: true,
        debug: createPushDebugBridge('enable')
      });
      if (!token) {
        appendPushDebug({
          tag: 'enable',
          level: 'warn',
          message: 'enablePushForUser returned no token.'
        });
        alert('Could not enable push on this device.');
        return;
      }
      appendPushDebug({
        tag: 'enable',
        message: 'Push token obtained.',
        details: { tokenPreview: `${token.slice(0, 10)}…${token.slice(-6)}` }
      });
      notif.pushEnabled = true;
      await save();
      appendPushDebug({
        tag: 'enable',
        message: 'Notification settings saved with pushEnabled=true.'
      });
      alert('Push notifications enabled on this device.');
    } catch (error) {
      appendPushDebug({
        tag: 'enable',
        level: 'error',
        message: 'enablePushForUser threw an exception.',
        details: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      });
      alert('Could not enable push on this device.');
    }
  }

  let testPushState = $state<'idle' | 'loading' | 'success' | 'error'>('idle');
  let testPushMessage: string | null = $state(null);

  type PushDebugEntry = {
    id: string;
    timestamp: number;
    level: 'info' | 'warn' | 'error';
    tag: string | null;
    message: string;
    details?: string;
  };

  let pushDebugLog: PushDebugEntry[] = $state([]);
  let pushDebugCopyState = $state<'idle' | 'copying' | 'copied' | 'error'>('idle');

  const PUSH_DEBUG_MAX_ENTRIES = 200;

  function appendPushDebug(entry: { message: string; level?: 'info' | 'warn' | 'error'; tag?: string | null; details?: unknown }) {
    const timestamp = Date.now();
    const level = entry.level ?? 'info';
    const tag = entry.tag ?? null;
    const details = entry.details !== undefined ? formatDebugDetails(entry.details) : undefined;
    const logEntry: PushDebugEntry = {
      id: `${timestamp}_${Math.random().toString(16).slice(2)}`,
      timestamp,
      level,
      tag,
      message: entry.message,
      details
    };
    pushDebugLog = [...pushDebugLog, logEntry].slice(-PUSH_DEBUG_MAX_ENTRIES);
    const prefix = tag ? `[push-debug:${tag}]` : '[push-debug]';
    const consoleArgs: unknown[] = [`${prefix} ${entry.message}`];
    if (entry.details !== undefined) {
      consoleArgs.push(entry.details);
    }
    const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    logger(...consoleArgs);
  }

  function formatDebugDetails(details: unknown): string | undefined {
    if (details === null || details === undefined) return undefined;
    if (typeof details === 'string') return details;
    try {
      return JSON.stringify(details, null, 2);
    } catch (error) {
      return String(details);
    }
  }

  function formatDebugTimestamp(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString();
  }

  function clearPushDebugLog() {
    pushDebugLog = [];
    pushDebugCopyState = 'idle';
    console.info('[push-debug] Log cleared.');
  }

  function createPushDebugBridge(tag: string) {
    return (event: PushDebugEvent) => {
      const context: Record<string, unknown> = {};
      if (event.context !== undefined) {
        context.context = event.context;
      }
      if (event.error) {
        context.error = event.error;
      }
      if (event.at) {
        context.eventTimestamp = new Date(event.at).toISOString();
      }
      appendPushDebug({
        tag,
        level: event.error ? 'error' : 'info',
        message: event.message ? `${event.step}: ${event.message}` : event.step,
        details: Object.keys(context).length ? context : undefined
      });
    };
  }

  async function copyPushDebugLog() {
    if (!pushDebugLog.length) return;
    pushDebugCopyState = 'copying';
    const text = buildPushDebugText();
    const success = await writeToClipboard(text);
    pushDebugCopyState = success ? 'copied' : 'error';
    if (success) {
      setTimeout(() => {
        pushDebugCopyState = 'idle';
      }, 1800);
    }
  }

  function buildPushDebugText() {
    return pushDebugLog
      .map((entry) => {
        const ts = new Date(entry.timestamp).toISOString();
        const tag = entry.tag ? `[${entry.tag}]` : '';
        const base = `${ts} ${entry.level.toUpperCase()} ${tag} ${entry.message}`;
        return entry.details ? `${base}\n${entry.details}` : base;
      })
      .join('\n');
  }

  async function writeToClipboard(text: string) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      console.warn('Navigator clipboard copy failed, falling back', error);
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
      const ok = document.execCommand('copy');
      return ok;
    } catch (error) {
      console.warn('execCommand copy failed', error);
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }

  async function logPushEnvironment(label: string) {
    const snapshot = await collectPushDiagnostics();
    appendPushDebug({
      tag: 'env',
      message: label,
      details: snapshot
    });
  }

  async function collectPushDiagnostics() {
    if (typeof window === 'undefined') return { browser: false };
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const docState = typeof document !== 'undefined' ? document.visibilityState : null;
    const diag: Record<string, unknown> = {
      browser: true,
      location: typeof window !== 'undefined' ? window.location.href : null,
      userAgent: nav?.userAgent ?? null,
      online: nav?.onLine ?? null,
      secureContext: typeof window !== 'undefined' ? window.isSecureContext : null,
      notificationPermission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
      hasNotificationAPI: typeof Notification !== 'undefined',
      hasPushManager: typeof window !== 'undefined' && 'PushManager' in window,
      visibilityState: docState,
      deviceId: getCurrentDeviceId(),
      timezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : null
    };
    if (nav && 'serviceWorker' in nav) {
      const controller = nav.serviceWorker.controller;
      const swInfo: Record<string, unknown> = {
        supported: true,
        controllerState: controller?.state ?? null,
        controllerScript: controller?.scriptURL ?? null
      };
      try {
        const registration = await nav.serviceWorker.getRegistration();
        if (registration) {
          swInfo.scope = registration.scope;
          swInfo.activeState = registration.active?.state ?? null;
          swInfo.waitingState = registration.waiting?.state ?? null;
          swInfo.installingState = registration.installing?.state ?? null;
        }
      } catch (error) {
        swInfo.registrationError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }
      diag.serviceWorker = swInfo;
    } else {
      diag.serviceWorker = {
        supported: false
      };
    }
    return diag;
  }

  async function pingServiceWorkerForDebug(tag: string) {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      appendPushDebug({
        tag,
        level: 'warn',
        message: 'Service worker API not available in this environment.'
      });
      return;
    }
    appendPushDebug({
      tag,
      message: 'Pinging active service worker (2.5s timeout)...'
    });
    try {
      const responded = await pingServiceWorker(undefined, 2500);
      appendPushDebug({
        tag,
        level: responded ? 'info' : 'warn',
        message: responded ? 'Service worker responded to ping.' : 'No service worker pong before timeout.'
      });
    } catch (error) {
      appendPushDebug({
        tag,
        level: 'error',
        message: 'Ping invocation failed.',
        details: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      });
    }
  }

  async function sendTestPushNotification() {
    pushDebugCopyState = 'idle';
    appendPushDebug({ tag: 'test', message: 'Send test push button clicked.' });
    await logPushEnvironment('Preflight snapshot (test)');
    const deviceId = getCurrentDeviceId();
    appendPushDebug({
      tag: 'test',
      message: 'Current device id snapshot.',
      details: { deviceId }
    });
    if (!$user?.uid) {
      appendPushDebug({
        tag: 'test',
        level: 'error',
        message: 'Cannot send test push without signed in user.'
      });
      testPushState = 'error';
      testPushMessage = 'Sign in to send a test notification.';
      return;
    }
    await pingServiceWorkerForDebug('test');
    testPushState = 'loading';
    testPushMessage = null;
    try {
      const result = await triggerTestPush({ debug: createPushDebugBridge('test') });
      appendPushDebug({
        tag: 'test',
        message: 'Callable result received.',
        details: result
      });
      if (result.ok) {
        testPushState = 'success';
        const count = result.tokens ?? 0;
        const suffix = count === 1 ? 'device' : 'devices';
        testPushMessage = count > 0 ? `Sent to ${count} ${suffix}.` : 'Test push sent.';
        appendPushDebug({
          tag: 'test',
          message: 'Push acknowledged by Cloud Functions.',
          details: { count, messageId: result.messageId ?? null }
        });
      } else {
        testPushState = 'error';
        testPushMessage =
          result.reason === 'no_tokens'
            ? 'No push-enabled devices found. Enable push first.'
            : 'Test push failed.';
        appendPushDebug({
          tag: 'test',
          level: 'warn',
          message: 'Callable reported failure.',
          details: result
        });
      }
    } catch (err) {
      console.warn('Test push failed', err);
      appendPushDebug({
        tag: 'test',
        level: 'error',
        message: 'triggerTestPush threw an exception.',
        details: err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      });
      testPushState = 'error';
      testPushMessage = 'Could not send test notification.';
    }
  }

  async function updateThemePreference(mode: ThemeMode) {
    const current = get(themeStore);
    if (current === mode) return;
    setTheme(mode, { persist: true });
    if (!$user?.uid) return;
    try {
      const database = db();
      await updateDoc(doc(database, 'profiles', $user.uid), {
        'settings.theme': mode,
        lastActiveAt: serverTimestamp()
      });
    } catch (error) {
      console.warn('Failed to persist theme preference', error);
    }
  }

  function exitSettings() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
      return;
    }
    if (serverId) {
      void goto(`/servers/${serverId}`);
    } else {
      void goto('/');
    }
  }
</script>

<div class="settings-page app-bg text-primary">
  <div class="settings-shell">
    <header class="settings-bar">
      <div class="settings-bar__row">
        <div class="settings-bar__left">
          <button type="button" class="settings-back" onclick={exitSettings} aria-label="Back to app">
            <i class="bx bx-chevron-left" aria-hidden="true"></i>
            <span>Back</span>
          </button>
          <div>
            <h1 class="settings-title">Account settings</h1>
            <p class="settings-subtitle">Manage your profile, appearance, and notifications.</p>
          </div>
        </div>
        <SignOutButton />
      </div>
    </header>

    <main class="settings-content">
      {#if loading}
        <div class="settings-placeholder">Loading profile...</div>
      {:else if !$user}
        <div class="settings-placeholder">Sign in to manage your settings.</div>
      {:else}
        <div class="settings-grid">
          <section class="settings-card settings-card--accent settings-card--profile">
            <header>
              <h2>Profile</h2>
              <p>These details appear to people you add or invite.</p>
            </header>

            <div class="settings-profile">
              <div class="settings-avatar">
                {#if previewPhotoURL}
                  <img src={previewPhotoURL} alt="Avatar preview" loading="lazy" />
                {:else}
                  <div class="settings-avatar__empty">No image</div>
                {/if}
              </div>
              <div class="settings-avatar__actions">
                <div class="settings-chip-row">
                  <button class="settings-chip" onclick={useGooglePhoto} disabled={!providerPhotoAvailable}>
                    Use Google/Apple photo
                  </button>
                  <button type="button" class="settings-chip settings-chip--primary" onclick={triggerAvatarUpload}>
                    Upload photo
                  </button>
                </div>
                <input
                  class="hidden"
                  type="file"
                  accept="image/*"
                  bind:this={avatarFileInput}
                  onchange={onAvatarFileSelected}
                />
                {#if avatarError}
                  <p class="settings-hint settings-hint--error">{avatarError}</p>
                {/if}
                {#if !pickString(photoURL) && previewPhotoURL}
                  <p class="settings-hint">Currently using your Google or Apple profile photo.</p>
                {/if}
                {#if !providerPhotoAvailable}
                  <p class="settings-hint">Link Google or Apple to enable the fallback option.</p>
                {/if}
                <p class="settings-hint">JPG, PNG, GIF up to 8&nbsp;MB. Larger images are compressed automatically.</p>
              </div>
            </div>

            <label class="settings-field">
              <span>Display name</span>
              <input class="input" bind:value={displayName} />
            </label>

            <label class="settings-field settings-field--inline">
              <span>Avatar URL</span>
              <input
                class="input input--compact"
                bind:value={photoURL}
                placeholder="https://example.com/avatar.png"
                maxlength="240"
              />
            </label>

            <footer class="settings-actions">
              <button class="btn btn-primary" onclick={save}>Save profile</button>
            </footer>
          </section>

          <section class="settings-card settings-card--notifications">
            <header>
              <h2>Notifications</h2>
              <p>Control when hConnect taps you on the shoulder.</p>
            </header>

            <div class="settings-notif-grid">
              <div class="settings-notif-tile">
                <div class="settings-notif-tile__body">
                  <h3>Desktop notifications</h3>
                  <p>Show native alerts when new messages arrive.</p>
                </div>
                <div class="settings-notif-tile__actions">
                  <button class="settings-chip" onclick={enableDesktopNotifications}>Grant permission</button>
                </div>
              </div>

              <div class="settings-notif-tile">
                <div class="settings-notif-tile__body">
                  <h3>Push notifications</h3>
                  <p>Receive updates even when the app is closed.</p>
                </div>
                <div class="settings-notif-tile__actions">
                  <button class="settings-chip" onclick={enablePush}>Enable on this device</button>
                  <button
                    class="settings-chip settings-chip--secondary"
                    aria-busy={testPushState === 'loading'}
                    onclick={sendTestPushNotification}
                  >
                    Send test push
                  </button>
                </div>
                {#if testPushMessage}
                  <p
                    class="settings-notif-status"
                    class:settings-notif-status--success={testPushState === 'success'}
                    class:settings-notif-status--error={testPushState === 'error'}
                  >
                    {testPushMessage}
                  </p>
                {/if}
              </div>

              <div class="settings-push-debug" aria-live="polite">
                <div class="settings-push-debug__header">
                  <div>
                    <h4>Push debug log</h4>
                    <p class="settings-push-debug__hint">
                      {#if pushDebugCopyState === 'copied'}
                        Copied to clipboard.
                      {:else if pushDebugCopyState === 'error'}
                        Could not copy log. Copy manually from below.
                      {:else}
                        Diagnostic entries from enable/test actions.
                      {/if}
                    </p>
                  </div>
                  <div class="settings-push-debug__actions">
                    <button
                      class="settings-chip"
                      onclick={copyPushDebugLog}
                      disabled={!pushDebugLog.length || pushDebugCopyState === 'copying'}
                    >
                      {#if pushDebugCopyState === 'copying'}
                        Copying...
                      {:else if pushDebugCopyState === 'copied'}
                        Copied!
                      {:else}
                        Copy log
                      {/if}
                    </button>
                    <button
                      class="settings-chip settings-chip--secondary"
                      onclick={clearPushDebugLog}
                      disabled={!pushDebugLog.length}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                {#if pushDebugLog.length}
                  <ol class="settings-push-debug__list">
                    {#each pushDebugLog as entry (entry.id)}
                      <li class="settings-push-debug__item" data-level={entry.level}>
                        <div class="settings-push-debug__meta">
                          <span class="settings-push-debug__time">{formatDebugTimestamp(entry.timestamp)}</span>
                          {#if entry.tag}
                            <span class="settings-push-debug__tag">{entry.tag}</span>
                          {/if}
                          <span class="settings-push-debug__level">{entry.level}</span>
                        </div>
                        <p class="settings-push-debug__message">{entry.message}</p>
                        {#if entry.details}
                          <pre class="settings-push-debug__details">{entry.details}</pre>
                        {/if}
                      </li>
                    {/each}
                  </ol>
                {:else}
                  <p class="settings-push-debug__empty">Logs appear here when you enable push or send a test notification.</p>
                {/if}
              </div>

              <div class="settings-notif-tile">
                <div class="settings-notif-tile__body">
                  <h3>Channel highlights</h3>
                  <p>Choose which updates we surface.</p>
                </div>
                <div class="settings-notif-list">
                </div>
              </div>
            </div>

            <p class="settings-hint">
              Want per-server controls? Tell us what would help and we'll line it up next.
            </p>

            <footer class="settings-actions settings-actions--inline">
              <button class="btn btn-primary" onclick={save}>Save notification settings</button>
            </footer>
          </section>

          <section class="settings-card settings-card--ai">
            <header>
              <h2>AI typing assist</h2>
              <p>Let OpenAI draft starter replies, next words, and mobile quick-type chips.</p>
            </header>
            <div class="settings-ai-toggle">
              <label class="settings-switch">
                <input
                  type="checkbox"
                  bind:checked={aiAssist.enabled}
                  aria-label="Enable AI typing assistant"
                />
                <span class="settings-switch__track">
                  <span class="settings-switch__thumb"></span>
                </span>
              </label>
              <div class="settings-ai-copy">
                <h3>Smart compose</h3>
                <p>
                  On desktop, replying to a message offers an OpenAI suggestion and inline next-word predictions.
                  Mobile keyboards show three quick-type options inspired by Apple's autofill bar. Disable it anytime if you prefer manual typing.
                </p>
              </div>
            </div>
            <footer class="settings-actions settings-actions--inline">
              <button class="btn btn-primary" onclick={save}>Save AI settings</button>
            </footer>
          </section>

          <section class="settings-card settings-card--appearance">
            <header>
              <h2>Appearance</h2>
              <p>Pick the theme that feels right. Changes apply instantly.</p>
            </header>
            <div class="settings-theme-grid">
              {#each themeChoices as choice}
                <button
                  type="button"
                  class={`appearance-option ${themeMode === choice.id ? 'appearance-option--active' : ''}`}
                  onclick={() => updateThemePreference(choice.id)}
                >
                  <span class="appearance-swatch" data-theme={choice.id}></span>
                  <span class="font-semibold">{choice.label}</span>
                  <span class="text-xs text-soft leading-snug">{choice.description}</span>
                </button>
              {/each}
            </div>
          </section>

          <section class="settings-card settings-card--invite">
            <header>
              <h2>Invites</h2>
              <p>Review new invites and share access when you need to loop others in.</p>
            </header>
            <InvitePanel {serverId} embedded />
          </section>
        </div>
      {/if}
    </main>
  </div>
</div>

<style>
  .settings-page {
    min-height: 100dvh;
    background: var(--surface-root);
  }

  .settings-shell {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: calc(env(safe-area-inset-top, 0px) + 1.5rem) clamp(1rem, 4vw, 1.75rem) 1.75rem;
    min-height: 100dvh;
    max-height: 100dvh;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    scroll-padding-bottom: calc(var(--mobile-dock-height, 0px) + 2rem);
    max-width: 960px;
    margin: 0 auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .settings-bar {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
  }

  .settings-bar__row {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: flex-start;
  }

  .settings-bar__left {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .settings-back {
    display: none;
    align-items: center;
    gap: 0.35rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    background: transparent;
    color: var(--text-70);
    padding: 0.35rem 0.95rem;
    font-weight: 600;
    transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
  }

  .settings-back:hover,
  .settings-back:focus-visible {
    color: var(--color-text-primary);
    border-color: color-mix(in srgb, var(--color-border-subtle) 90%, transparent);
    background: color-mix(in srgb, var(--color-panel-muted) 80%, transparent);
    outline: none;
  }

  .settings-back i {
    font-size: 1.15rem;
  }

  .settings-shell::-webkit-scrollbar {
    display: none;
  }

  .settings-title {
    font-size: 1.75rem;
    font-weight: 600;
  }

  .settings-subtitle {
    margin-top: 0.35rem;
    color: var(--text-60);
    font-size: 0.95rem;
  }

  .settings-content {
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: visible;
    padding-bottom: calc(var(--mobile-dock-height, 0px) + 2rem);
  }

  .settings-placeholder {
    color: var(--text-60);
    font-size: 0.95rem;
    border-radius: var(--radius-lg);
    padding: 1rem 1.25rem;
    border: 1px dashed color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    background: color-mix(in srgb, var(--surface-root) 98%, transparent);
    width: fit-content;
  }

  .settings-grid {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
  }

  .settings-card--profile {
    grid-area: profile;
  }

  .settings-card--notifications {
    grid-area: notifications;
  }

  .settings-card--ai {
    grid-area: ai;
  }

  .settings-card--appearance {
    grid-area: appearance;
  }

  .settings-card--invite {
    grid-area: invite;
  }

  .settings-ai-toggle {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    align-items: flex-start;
  }

  .settings-switch {
    position: relative;
    width: 3.1rem;
    height: 1.6rem;
    flex-shrink: 0;
  }

  .settings-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .settings-switch__track {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    transition: background 0.2s ease;
    cursor: pointer;
    padding: 0.2rem;
  }

  .settings-switch__thumb {
    display: block;
    width: 1.2rem;
    height: 1.2rem;
    border-radius: 50%;
    background: var(--color-panel);
    box-shadow: var(--shadow-soft);
    transition: transform 0.2s ease;
  }

  .settings-switch input:checked + .settings-switch__track {
    background: color-mix(in srgb, var(--color-accent) 60%, transparent);
  }

  .settings-switch input:checked + .settings-switch__track .settings-switch__thumb {
    transform: translateX(1.45rem);
    background: var(--color-accent);
  }

  .settings-ai-copy h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .settings-ai-copy p {
    margin: 0.25rem 0 0;
    color: var(--text-60);
    font-size: 0.88rem;
    line-height: 1.35;
  }

  .settings-card {
    background: color-mix(in srgb, var(--surface-root) 96%, transparent);
    border-radius: var(--radius-lg);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    box-shadow: none;
    padding: 1.15rem;
    display: grid;
    gap: 0.85rem;
    min-width: 0;
  }

  .settings-card header h2 {
    font-size: 1.2rem;
    font-weight: 600;
    margin-bottom: 0.35rem;
  }

  .settings-card header p {
    margin: 0;
    color: var(--text-60);
    font-size: 0.9rem;
  }

  .settings-card--accent::after {
    display: none;
  }

  .settings-profile {
    display: grid;
    gap: 1rem;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
  }

  .settings-avatar {
    display: grid;
  }

  @media (max-width: 640px) {
    .settings-profile {
      grid-template-columns: 1fr;
      justify-items: start;
    }
  }

  .settings-avatar img {
    width: 5rem;
    height: 5rem;
    border-radius: 999px;
    border: 2px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    object-fit: cover;
    box-shadow: var(--shadow-elevated);
  }

  .settings-avatar__empty {
    width: 5rem;
    height: 5rem;
    border-radius: 999px;
    border: 2px dashed color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
    display: grid;
    place-items: center;
    color: var(--text-60);
    font-size: 0.75rem;
    text-transform: uppercase;
  }

  .settings-avatar__actions {
    display: grid;
    gap: 0.6rem;
  }

  .settings-chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .settings-chip {
    border-radius: 999px;
    padding: 0.45rem 0.9rem;
    background: color-mix(in srgb, var(--color-panel) 45%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    color: var(--text-70);
    font-size: 0.85rem;
    cursor: pointer;
    transition: background 0.18s ease, color 0.18s ease, border 0.18s ease;
  }

  .settings-chip:disabled {
    opacity: 0.45;
    pointer-events: none;
  }

  .settings-chip:hover {
    background: color-mix(in srgb, var(--color-panel) 65%, transparent);
    color: var(--text-90);
  }

  .settings-chip--primary {
    background: color-mix(in srgb, var(--color-accent) 85%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
    color: var(--color-text-inverse);
  }

  .settings-chip--primary:hover {
    background: var(--color-accent-strong);
  }

  .settings-chip--secondary {
    border-color: color-mix(in srgb, var(--color-border-strong) 60%, transparent);
    color: var(--text-80);
  }

  .settings-chip--secondary:hover {
    background: color-mix(in srgb, var(--color-panel) 75%, transparent);
  }

  .settings-field {
    display: grid;
    gap: 0.4rem;
    color: var(--text-70);
    font-size: 0.9rem;
  }

  .settings-field--inline {
    max-width: 28rem;
  }

  .settings-field--url {
    max-width: 48rem;
  }

  .input--compact {
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
  }

  .input--compact:focus {
    overflow: auto;
    white-space: normal;
  }

  .settings-hint {
    font-size: 0.8rem;
    color: var(--text-55);
  }

  .settings-hint--error {
    color: color-mix(in srgb, var(--color-danger) 80%, white);
  }

  .settings-actions {
    margin-top: 0.5rem;
  }

  .settings-actions--inline {
    display: flex;
    justify-content: flex-end;
  }

  .settings-theme-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .settings-notif-grid {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .settings-push-debug {
    border: 1px dashed color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--surface-root) 98%, transparent);
    padding: 0.9rem 1rem;
    display: grid;
    gap: 0.7rem;
  }

  .settings-push-debug__header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .settings-push-debug__header h4 {
    margin: 0;
    font-size: 0.95rem;
  }

  .settings-push-debug__hint {
    margin: 0.25rem 0 0;
    font-size: 0.8rem;
    color: var(--text-50);
  }

  .settings-push-debug__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    justify-content: flex-end;
  }

  .settings-push-debug__list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.55rem;
    max-height: 280px;
    overflow: auto;
  }

  .settings-push-debug__item {
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 75%, transparent);
    padding: 0.45rem 0.5rem;
    background: color-mix(in srgb, var(--surface-root) 99%, transparent);
    display: grid;
    gap: 0.3rem;
  }

  .settings-push-debug__item[data-level='warn'] {
    border-color: color-mix(in srgb, var(--color-warning, #fbbf24) 40%, var(--color-border-subtle));
  }

  .settings-push-debug__item[data-level='error'] {
    border-color: color-mix(in srgb, var(--color-danger, #f87171) 55%, var(--color-border-subtle));
  }

  .settings-push-debug__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    font-size: 0.75rem;
    color: var(--text-50);
  }

  .settings-push-debug__tag {
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-60);
  }

  .settings-push-debug__level {
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-50);
  }

  .settings-push-debug__message {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-80);
  }

  .settings-push-debug__details {
    margin: 0;
    font-size: 0.75rem;
    background: color-mix(in srgb, var(--surface-overlay) 65%, transparent);
    border-radius: var(--radius-sm);
    padding: 0.45rem;
    white-space: pre-wrap;
    max-height: 160px;
    overflow: auto;
  }

  .settings-push-debug__empty {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-50);
  }

  .settings-push-debug__time {
    font-variant-numeric: tabular-nums;
  }

  .settings-notif-tile {
    border-radius: var(--radius-md);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    background: color-mix(in srgb, var(--surface-root) 98%, transparent);
    padding: 0.85rem 1rem;
    display: grid;
    gap: 0.45rem;
    min-width: 0;
  }

  .settings-notif-tile__body h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-80);
  }

  .settings-notif-tile__body p {
    margin: 0.2rem 0 0;
    color: var(--text-60);
    font-size: 0.85rem;
    line-height: 1.35;
  }

  .settings-notif-tile__actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
  }

  .settings-notif-status {
    margin: 0.6rem 0 0;
    font-size: 0.85rem;
    color: var(--text-60);
  }

  .settings-notif-status--success {
    color: color-mix(in srgb, var(--color-success, #22c55e) 80%, var(--text-60));
  }

  .settings-notif-status--error {
    color: color-mix(in srgb, var(--color-danger, #f87171) 85%, var(--text-60));
  }

  .settings-notif-list {
    display: grid;
    gap: 0.45rem;
  }

  .appearance-option {
    text-align: left;
    border-radius: var(--radius-md);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    background: color-mix(in srgb, var(--surface-root) 98%, transparent);
    padding: 0.9rem;
    display: grid;
    gap: 0.5rem;
    transition: border 0.2s ease, background 0.2s ease;
  }

  .appearance-option:hover {
    border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
    background: color-mix(in srgb, var(--surface-root) 100%, transparent);
  }

  .appearance-option--active {
    border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
    box-shadow: none;
  }

  .appearance-swatch {
    display: block;
    height: 2.5rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel-muted) 65%, transparent);
  }

  .appearance-swatch[data-theme='light'] {
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(225, 233, 240, 0.85));
  }

  .appearance-swatch[data-theme='dark'] {
    background: linear-gradient(135deg, rgba(32, 36, 44, 0.95), rgba(12, 15, 22, 0.85));
  }

  .appearance-swatch[data-theme='midnight'] {
    background: linear-gradient(135deg, rgba(0, 2, 4, 0.96), rgba(3, 17, 33, 0.88));
    box-shadow: inset 0 0 0 1px rgba(20, 229, 201, 0.25);
  }

  .appearance-swatch[data-theme='holiday'] {
    background: linear-gradient(
      120deg,
      rgba(3, 6, 26, 0.95),
      rgba(255, 126, 167, 0.8),
      rgba(31, 191, 101, 0.8),
      rgba(255, 138, 45, 0.9),
      rgba(235, 84, 119, 0.85)
    );
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
  }

  @media (max-width: 1024px) {
    .settings-shell {
      padding: calc(env(safe-area-inset-top, 0px) + 1.5rem) 1.5rem 1.5rem;
    }
  }

  @media (min-width: 768px) {
    .settings-back {
      display: inline-flex;
    }

    .settings-bar__row {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }

    .settings-bar__left {
      align-items: center;
    }
  }

  @media (max-width: 768px) {
    .settings-shell {
      padding: calc(env(safe-area-inset-top, 0px) + 1.1rem) 1.1rem 1.25rem;
      gap: 1.25rem;
    }

    .settings-bar {
      flex-direction: column;
      align-items: flex-start;
    }

    .settings-card {
      padding: 1.35rem;
      gap: 1rem;
    }

    .settings-profile {
      grid-template-columns: 1fr;
    }

    .settings-avatar {
      display: flex;
      gap: 1rem;
      align-items: center;
    }

    .settings-avatar img,
    .settings-avatar__empty {
      width: 4.25rem;
      height: 4.25rem;
    }

    .settings-notif-grid {
      gap: 0.75rem;
    }

    .settings-notif-tile {
      padding: 0.75rem 0.9rem;
    }

    .settings-push-debug {
      padding: 0.75rem 0.85rem;
    }

    .settings-push-debug__actions {
      width: 100%;
      justify-content: flex-start;
    }

    .settings-notif-tile__actions {
      flex-direction: column;
      align-items: flex-start;
    }

    .settings-chip-row {
      gap: 0.4rem;
    }

    .settings-chip {
      padding: 0.4rem 0.75rem;
      font-size: 0.82rem;
    }

    .appearance-option {
      padding: 0.85rem;
    }
  }
</style>
