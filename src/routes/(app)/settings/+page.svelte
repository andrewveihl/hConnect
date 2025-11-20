<script lang="ts">
import { run } from 'svelte/legacy';

import { onMount } from 'svelte';
import { get } from 'svelte/store';
import { user } from '$lib/stores/user';
import { theme as themeStore, setTheme, type ThemeMode } from '$lib/stores/theme';
import { db } from '$lib/firestore';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { uploadProfileAvatar } from '$lib/firebase/storage';
import {
    enablePushForUser,
    requestNotificationPermission,
    getCurrentDeviceId,
    pingServiceWorker,
    disablePushForUser
  } from '$lib/notify/push';
  import { featureFlag } from '$lib/stores/featureFlags';
  import type { PushDebugEvent } from '$lib/notify/push';
  import { triggerTestPush } from '$lib/notify/testPush';

import SignOutButton from '$lib/components/auth/SignOutButton.svelte';
import InvitePanel from '$lib/components/app/InvitePanel.svelte';
import LeftPane from '$lib/components/app/LeftPane.svelte';

  interface Props {
    serverId?: string | null;
  }

  let { serverId = null }: Props = $props();

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

const IOS_DEVICE_REGEX = /iP(ad|hone|od)/i;
const SAFARI_REGEX = /Safari/i;
const IOS_ALT_BROWSERS = /(CriOS|FxiOS|OPiOS|EdgiOS)/i;
  const showNotificationDebugTools = featureFlag('showNotificationDebugTools');

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return IOS_DEVICE_REGEX.test(ua) && SAFARI_REGEX.test(ua) && !IOS_ALT_BROWSERS.test(ua);
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  if (typeof nav.standalone === 'boolean') return nav.standalone;
  if (typeof window.matchMedia === 'function') {
    const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
    try {
      if (modes.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

function getIosNotificationHelpMessage(permission: NotificationPermission | 'unsupported') {
  if (permission === 'denied') {
    return 'Notifications are disabled for hConnect. Open the Settings app → Notifications → hConnect and turn on "Allow Notifications", then reopen the app from your Home Screen.';
  }
  if (permission === 'default') {
    return 'Safari could not show the notification prompt. Make sure hConnect was launched from the Home Screen and that notifications are enabled in Settings → Notifications → hConnect.';
  }
  return 'iOS is blocking notifications for this app. Open Settings → Notifications → hConnect, enable "Allow Notifications", then relaunch the app from your Home Screen.';
}

function hasServiceWorkerSupport() {
  if (typeof navigator === 'undefined') return false;
  try {
    if ('serviceWorker' in navigator) return true;
  } catch {
    // Safari might throw when checking `in` before the API is ready.
  }
  try {
    return Boolean((navigator as Navigator & { serviceWorker?: ServiceWorkerContainer }).serviceWorker);
  } catch {
    return false;
  }
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
let avatarUploadBusy = $state(false);
let avatarUploadProgress = $state(0);

  const AUTOSAVE_DELAY = 900;
  type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
  let saveState: SaveState = $state('idle');
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveInFlight = false;
  let saveQueued = false;

  type NotifPrefs = {
    desktopEnabled: boolean;
    pushEnabled: boolean;
    dms: boolean;
    mentions: boolean;
    allMessages: boolean;
  };

let notif = $state<NotifPrefs>({
  desktopEnabled: false,
  pushEnabled: false,
  dms: true,
  mentions: true,
  allMessages: false
});

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
  }

  function queueAutoSave() {
    if (!$user?.uid) return;
    if (saveState !== 'saving') {
      saveState = 'pending';
    }
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
    }
    const run = () => {
      autosaveTimer = null;
      void triggerAutoSave();
    };
    if (typeof window === 'undefined') {
      run();
      return;
    }
    autosaveTimer = setTimeout(run, AUTOSAVE_DELAY);
  }

  function flushAutoSave() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    return triggerAutoSave();
  }

  async function triggerAutoSave() {
    if (saveInFlight) {
      saveQueued = true;
      return;
    }
    saveInFlight = true;
    saveState = 'saving';
    try {
      await save();
      saveState = 'saved';
      setTimeout(() => {
        if (saveState === 'saved') {
          saveState = 'idle';
        }
      }, 2000);
    } catch (error) {
      console.error(error);
      saveState = 'error';
    } finally {
      saveInFlight = false;
      if (saveQueued) {
        saveQueued = false;
        queueAutoSave();
      }
    }
  }

  function useGooglePhoto() {
    const provider =
      pickString($user?.photoURL) ??
      pickString(authPhotoURL);
    if (provider) {
      authPhotoURL = provider;
      photoURL = '';
      avatarError = null;
      queueAutoSave();
    }
  }

  function triggerAvatarUpload() {
    avatarFileInput?.click();
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
    if (!$user?.uid) {
      avatarError = 'Sign in to upload a profile photo.';
      input.value = '';
      return;
    }
    avatarUploadBusy = true;
    avatarUploadProgress = 0;
    try {
      const result = await uploadProfileAvatar({
        file,
        uid: $user.uid,
        onProgress: (progress) => {
          avatarUploadProgress = progress;
        }
      });
      photoURL = result.url;
      avatarError = null;
      queueAutoSave();
    } catch (error: any) {
      avatarError = error?.message ?? 'Could not upload the selected file.';
    } finally {
      avatarUploadBusy = false;
      avatarUploadProgress = 0;
      input.value = '';
    }
  }

  async function enableDesktopNotifications() {
    const granted = await requestNotificationPermission();
    if (!granted) {
      const permissionStatus =
        typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
      if (isIosSafari()) {
        alert(getIosNotificationHelpMessage(permissionStatus as NotificationPermission));
      } else {
        alert('Notifications are blocked by the browser. Enable them in site settings.');
      }
      return;
    }
    notif.desktopEnabled = true;
  }

  async function handleDesktopToggleChange(event: Event) {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target) return;
    const desired = target.checked;
    const previous = notif.desktopEnabled;
    if (desired) {
      desktopToggleBusy = true;
      await enableDesktopNotifications();
      desktopToggleBusy = false;
      if (!notif.desktopEnabled) {
        target.checked = previous;
      }
    } else {
      notif.desktopEnabled = false;
    }
    if (notif.desktopEnabled !== previous) {
      queueAutoSave();
    }
  }

  async function enablePush() {
    pushDebugCopyState = 'idle';
    appendPushDebug({ tag: 'enable', message: 'Enable push button clicked.' });
    enablePushLoading = true;
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
    const deviceId = getCurrentDeviceId();
    appendPushDebug({
      tag: 'enable',
      message: 'Current device id snapshot.',
      details: { deviceId }
    });
    const iosSafari = isIosSafari();
    const iosStandalone = isStandaloneDisplayMode();
    if (iosSafari && !iosStandalone) {
      const iosMessage =
        'On iOS Safari, push notifications only work when hConnect is installed to your Home Screen. Tap the share icon, choose "Add to Home Screen", then reopen the app from that icon before enabling push.';
      appendPushDebug({
        tag: 'enable',
        level: 'warn',
        message: 'iOS Safari detected outside standalone mode; push enable blocked.',
        details: { standalone: iosStandalone }
      });
      const proceed = typeof window !== 'undefined' ? window.confirm(`${iosMessage}\n\nTap OK to try anyway or Cancel to add the app now.`) : false;
      if (!proceed) {
        alert(iosMessage);
        return;
      }
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
    if (typeof navigator === 'undefined') {
      appendPushDebug({
        tag: 'enable',
        level: 'error',
        message: 'Navigator object unavailable.'
      });
      alert('Push notifications require a browser environment.');
      return;
    }
    const serviceWorkerAvailable = hasServiceWorkerSupport();
    appendPushDebug({
      tag: 'enable',
      message: 'serviceWorker availability check',
      details: { serviceWorkerAvailable }
    });
    if (!serviceWorkerAvailable) {
      appendPushDebug({
        tag: 'enable',
        level: 'error',
        message: 'Service worker API missing on navigator.'
      });
      if (iosSafari) {
        alert(
          'Safari on iOS only exposes push inside an installed app. Close this tab and launch hConnect from your Home Screen, then try again.'
        );
      } else {
        alert('This browser cannot register push service workers.');
      }
      return;
    }
    appendPushDebug({
      tag: 'enable',
      message: 'serviceWorker supported on navigator.'
    });
    let manualPermissionPrompt = false;
    let permissionStatus: NotificationPermission | 'unsupported' =
      typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    if (iosSafari && permissionStatus === 'default') {
      manualPermissionPrompt = true;
      appendPushDebug({
        tag: 'enable',
        message: 'Triggering iOS notification permission prompt immediately.'
      });
      const granted = await requestNotificationPermission();
      permissionStatus =
        typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
      appendPushDebug({
        tag: 'enable',
        message: 'iOS notification prompt result.',
        details: { granted, permission: permissionStatus }
      });
      if (!granted) {
        alert(getIosNotificationHelpMessage(permissionStatus));
        return;
      }
    }
    await logPushEnvironment('Preflight snapshot (enable)');
    await pingServiceWorkerForDebug('enable');
    appendPushDebug({
      tag: 'enable',
      message: 'Calling enablePushForUser via Firebase Messaging.'
    });
    try {
      const token = await enablePushForUser($user.uid, {
        prompt: !manualPermissionPrompt,
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
        details: { tokenPreview: `${token.slice(0, 10)}...${token.slice(-6)}` }
      });
      notif.pushEnabled = true;
      await flushAutoSave();
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
    } finally {
      enablePushLoading = false;
    }
  }

  async function handlePushToggleChange(event: Event) {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target) return;
    const desired = target.checked;
    if (desired) {
      await enablePush();
      if (!notif.pushEnabled) {
        target.checked = false;
      }
      return;
    }
    target.checked = false;
    if (!$user?.uid) {
      notif.pushEnabled = false;
      return;
    }
    pushToggleBusy = true;
    try {
      await disablePushForUser($user.uid);
      notif.pushEnabled = false;
      appendPushDebug({
        tag: 'enable',
        message: 'Push disabled for this device.'
      });
      queueAutoSave();
    } catch (error) {
      appendPushDebug({
        tag: 'enable',
        level: 'error',
        message: 'Failed to disable push for this device.',
        details: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      });
      target.checked = true;
      notif.pushEnabled = true;
    } finally {
      pushToggleBusy = false;
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
let enablePushLoading = $state(false);
  let desktopToggleBusy = $state(false);
  let pushToggleBusy = $state(false);

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

</script>

<div class="settings-stage app-bg text-primary">
  <aside class="settings-left-pane">
    <LeftPane activeServerId={serverId ?? null} />
  </aside>

  <div class="settings-page">
    <div class="settings-shell">
    <header class="settings-bar">
      <div class="settings-bar__row">
        <div class="settings-bar__left">
          <p class="settings-eyebrow">Account</p>
          <h1 class="settings-title">Settings</h1>
        </div>
        <div class="settings-bar__actions">
          {#if saveState !== 'idle'}
            <span class={`save-indicator save-indicator--${saveState}`}>
              {saveState === 'pending'
                ? 'Pending save'
                : saveState === 'saving'
                  ? 'Saving…'
                  : saveState === 'saved'
                    ? 'Saved'
                    : saveState === 'error'
                      ? 'Save failed'
                      : ''}
            </span>
          {/if}
          <SignOutButton />
        </div>
      </div>
    </header>

    <main class="settings-content">
      {#if loading}
        <div class="settings-placeholder">Loading profile...</div>
      {:else if !$user}
        <div class="settings-placeholder">Sign in to manage your settings.</div>
      {:else}
        <div class="settings-grid">
          <section class="settings-card settings-card--profile">
            <header>
              <h2>Profile</h2>
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
                <div class="profile-upload">
                  <button
                    type="button"
                    class="btn btn-secondary"
                    onclick={triggerAvatarUpload}
                    disabled={avatarUploadBusy}
                  >
                    {avatarUploadBusy ? 'Uploading…' : 'Upload photo'}
                  </button>
                  {#if providerPhotoAvailable}
                    <button
                      type="button"
                      class="btn btn-ghost"
                      onclick={useGooglePhoto}
                      disabled={avatarUploadBusy}
                    >
                      Use linked photo
                    </button>
                  {/if}
                </div>
                <input
                  class="hidden"
                  type="file"
                  accept="image/*"
                  bind:this={avatarFileInput}
                  onchange={onAvatarFileSelected}
                />
                {#if avatarUploadBusy}
                  <p class="settings-hint">
                    Uploading {Math.round(avatarUploadProgress * 100)}%
                  </p>
                {/if}
                {#if avatarError}
                  <p class="settings-hint settings-hint--error">{avatarError}</p>
                {/if}
              </div>
            </div>

            <label class="settings-field settings-field--name">
              <span>Display name</span>
              <input class="input" bind:value={displayName} maxlength={32} oninput={queueAutoSave} />
            </label>

          </section>

          <section class="settings-card settings-card--notifications">
            <header>
              <h2>Notifications</h2>
            </header>

            <div class="settings-notif-options">
              <article class="settings-notif-option">
                <div class="settings-notif-option__body">
                  <h3>Push</h3>
                  <p>Mobile and background alerts.</p>
                </div>
                <div class="settings-notif-option__actions">
                  <label class="settings-toggle">
                    <input
                      type="checkbox"
                      checked={notif.pushEnabled}
                      disabled={pushToggleBusy || enablePushLoading}
                      onchange={handlePushToggleChange}
                    />
                    <span class="settings-toggle__track" aria-hidden="true">
                      <span class="settings-toggle__thumb" aria-hidden="true"></span>
                    </span>
                    <span class="settings-toggle__label">
                      {notif.pushEnabled ? 'Enabled on this device' : 'Tap to enable push'}
                    </span>
                  </label>
                </div>
              </article>

              <article class="settings-notif-option">
                <div class="settings-notif-option__body">
                  <h3>Desktop banners</h3>
                  <p>Native browser notifications.</p>
                </div>
                <div class="settings-notif-option__actions">
                  <label class="settings-toggle">
                    <input
                      type="checkbox"
                      checked={notif.desktopEnabled}
                      disabled={desktopToggleBusy}
                      onchange={handleDesktopToggleChange}
                    />
                    <span class="settings-toggle__track" aria-hidden="true">
                      <span class="settings-toggle__thumb" aria-hidden="true"></span>
                    </span>
                    <span class="settings-toggle__label">
                      {notif.desktopEnabled ? 'Desktop alerts enabled' : 'Enable desktop alerts'}
                    </span>
                  </label>
                </div>
              </article>
            </div>

            {#if $showNotificationDebugTools}
              <div class="settings-notif-debug" aria-live="polite">
                <div class="settings-notif-debug__header">
                  <div>
                    <h3>Send test push</h3>
                    <p>Super admins can fire a diagnostic push at this device.</p>
                  </div>
                  <button
                    class="settings-chip settings-chip--secondary"
                    aria-busy={testPushState === 'loading'}
                    disabled={!notif.pushEnabled || testPushState === 'loading'}
                    onclick={sendTestPushNotification}
                  >
                    {testPushState === 'loading' ? 'Sending...' : 'Send test push'}
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
                <div class="settings-push-debug">
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
                        Clear log
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
                    <p class="settings-push-debug__empty">
                      Logs appear here when you enable push or send a test notification.
                    </p>
                  {/if}
                </div>
              </div>
            {/if}

          </section>

          <section class="settings-card settings-card--ai">
            <div class="settings-ai-row">
              <div>
                <h2>AI assist</h2>
                <p>Inline suggestions while typing.</p>
              </div>
              <label class="settings-switch">
                <input
                  type="checkbox"
                  bind:checked={aiAssist.enabled}
                  aria-label="Enable AI typing assistant"
                  onchange={queueAutoSave}
                />
                <span class="settings-switch__track">
                  <span class="settings-switch__thumb"></span>
                </span>
              </label>
            </div>
          </section>

          <section class="settings-card settings-card--appearance">
            <header>
              <h2>Appearance</h2>
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
            </header>
            <InvitePanel {serverId} embedded />
          </section>
        </div>
      {/if}
    </main>
  </div>
</div>
</div>

<style>
  .settings-stage {
    display: flex;
    min-height: 100dvh;
    background: var(--surface-root);
    color: var(--text-100);
    overflow: hidden;
  }

  .settings-left-pane {
    display: none;
    flex-shrink: 0;
    min-height: 100dvh;
  }

  @media (min-width: 768px) {
    .settings-left-pane {
      display: flex;
    }
  }

  .settings-page {
    flex: 1 1 auto;
    min-height: 100dvh;
    height: 100dvh;
    background: var(--surface-root);
    display: flex;
    flex-direction: column;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .settings-shell {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: calc(env(safe-area-inset-top, 0px) + 1.5rem) clamp(1rem, 6vw, 3rem) 2rem;
    min-height: 100dvh;
    width: min(1200px, 100%);
    margin: 0 auto;
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

  .settings-bar__actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .settings-eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 0.75rem;
    color: var(--text-50);
    margin: 0;
  }

  .save-indicator {
    font-size: 0.8rem;
    padding: 0.3rem 0.75rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-border-subtle) 45%, transparent);
    color: var(--text-80);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
  }

  .save-indicator--saving,
  .save-indicator--pending {
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    color: color-mix(in srgb, var(--color-accent) 90%, var(--color-text-primary));
    border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
  }

  .save-indicator--saved {
    background: color-mix(in srgb, var(--color-success, #22c55e) 20%, transparent);
    color: color-mix(in srgb, var(--color-success, #22c55e) 85%, white);
    border-color: color-mix(in srgb, var(--color-success, #22c55e) 45%, transparent);
  }

  .save-indicator--error {
    background: color-mix(in srgb, var(--color-danger, #f87171) 22%, transparent);
    color: color-mix(in srgb, var(--color-danger, #f87171) 90%, white);
    border-color: color-mix(in srgb, var(--color-danger, #f87171) 55%, transparent);
  }

  .settings-shell::-webkit-scrollbar {
    display: none;
  }

  .settings-title {
    font-size: 1.75rem;
    font-weight: 600;
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
    display: grid;
    gap: 1.25rem;
    width: 100%;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    align-items: stretch;
  }

  @media (min-width: 1024px) {
    .settings-card--profile,
    .settings-card--notifications {
      grid-column: span 2;
    }

    .settings-card--appearance {
      grid-column: span 2;
    }
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

  .settings-ai-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .settings-ai-row p {
    margin: 0.25rem 0 0;
    color: var(--text-60);
    font-size: 0.85rem;
  }

  .settings-card {
    background: color-mix(in srgb, var(--surface-root) 92%, transparent);
    border-radius: var(--radius-lg);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    box-shadow: none;
    padding: 1.2rem 1.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    min-width: 0;
  }

  .settings-card header h2 {
    font-size: 1.15rem;
    font-weight: 600;
    margin: 0;
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
    align-items: flex-start;
  }

  .profile-upload {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
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

  .settings-field--name {
    max-width: 16rem;
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

  .settings-notif-options {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .settings-notif-option {
    border-radius: var(--radius-lg);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    background: color-mix(in srgb, var(--surface-panel) 96%, transparent);
    padding: 1rem 1.15rem;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 1rem;
  }

  .settings-notif-option__body {
    flex: 1 1 16rem;
    min-width: 12rem;
  }

  .settings-notif-option__body h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-80);
  }

  .settings-notif-option__body p {
    margin: 0.25rem 0 0;
    color: var(--text-60);
    font-size: 0.86rem;
    line-height: 1.35;
  }

  .settings-notif-option__actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.65rem;
    justify-content: flex-end;
  }

  .settings-notif-debug {
    margin-top: 1.25rem;
    border-radius: var(--radius-lg);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    padding: 1.2rem;
    display: grid;
    gap: 0.85rem;
    background: color-mix(in srgb, var(--surface-overlay) 92%, transparent);
  }

  .settings-notif-debug__header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .settings-notif-debug__header h3 {
    margin: 0;
    font-size: 1rem;
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

  .settings-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.65rem;
    cursor: pointer;
    user-select: none;
  }

  .settings-toggle input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .settings-toggle__track {
    width: 2.85rem;
    height: 1.45rem;
    border-radius: 999px;
    background: linear-gradient(
      120deg,
      color-mix(in srgb, var(--surface-panel) 85%, transparent),
      color-mix(in srgb, var(--surface-panel) 65%, transparent)
    );
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
    position: relative;
    transition: background 160ms ease, border-color 160ms ease;
    flex-shrink: 0;
  }

  .settings-toggle__thumb {
    position: absolute;
    top: 0.1rem;
    left: 0.15rem;
    width: 1.15rem;
    height: 1.15rem;
    border-radius: 50%;
    background: color-mix(in srgb, var(--surface-base) 85%, var(--color-border-subtle));
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.25);
    transition: transform 160ms ease, background 160ms ease;
  }

  .settings-toggle input:checked + .settings-toggle__track {
    background: linear-gradient(
      120deg,
      color-mix(in srgb, var(--color-accent, #22d3ee) 85%, var(--surface-panel)),
      color-mix(in srgb, var(--color-accent, #22d3ee) 65%, var(--surface-panel))
    );
    border-color: color-mix(in srgb, var(--color-accent, #22d3ee) 70%, var(--color-border-subtle));
  }

  .settings-toggle input:checked + .settings-toggle__track .settings-toggle__thumb {
    transform: translateX(1.35rem);
    background: color-mix(in srgb, var(--color-accent, #22d3ee) 85%, white);
  }

  .settings-toggle__label {
    font-size: 0.82rem;
    color: var(--text-70);
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

    .settings-notif-options {
      gap: 0.75rem;
    }

    .settings-notif-option {
      flex-direction: column;
      padding: 0.9rem;
    }

    .settings-notif-option__actions {
      width: 100%;
      justify-content: flex-start;
    }

    .settings-notif-debug {
      padding: 1rem;
    }

    .settings-push-debug {
      padding: 0.75rem 0.85rem;
    }

    .settings-push-debug__actions {
      width: 100%;
      justify-content: flex-start;
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
