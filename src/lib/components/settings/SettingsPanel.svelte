<script lang="ts">
import { run } from 'svelte/legacy';

import { onMount, onDestroy } from 'svelte';
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
  import { voicePreferences, loadVoicePreferences, defaultVoicePreferences, type VoicePreferences } from '$lib/stores/voicePreferences';

import SignOutButton from '$lib/components/auth/SignOutButton.svelte';
import InvitePanel from '$lib/components/app/InvitePanel.svelte';
import { defaultSettingsSection, settingsSections, type SettingsSectionId } from '$lib/settings/sections';

  interface Props {
    serverId?: string | null;
    activeSection?: SettingsSectionId;
  }

  let { serverId = null, activeSection = defaultSettingsSection }: Props = $props();

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
  const fieldInputClasses =
    'w-full rounded-md border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel)] px-3 py-2 text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--color-text-tertiary)] focus:border-[color:var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)]';
  const mutedTextClasses = 'text-sm text-[color:var(--text-70)]';
  const primaryButtonClasses =
    'inline-flex items-center justify-center rounded-md bg-[color:var(--color-accent)] px-3 py-2 text-sm font-medium text-[color:var(--color-text-inverse)] shadow-sm transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60';
  const secondaryButtonClasses =
    'inline-flex items-center justify-center rounded-md border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] px-3 py-2 text-sm font-medium text-[color:var(--color-text-primary)] transition hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-panel)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60';
  const pillButtonClasses =
    'inline-flex items-center rounded-full border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] px-3 py-1.5 text-sm font-medium text-[color:var(--color-text-primary)] transition hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-panel)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50';
  const cardBaseClasses =
    'rounded-xl border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel)] shadow-sm';
  const themeSwatchClasses = (id: ThemeMode | 'holiday') => {
    switch (id) {
      case 'light':
        return 'h-10 w-14 rounded-md border border-slate-200 bg-gradient-to-br from-white via-slate-100 to-slate-200 shadow-inner ring-1 ring-slate-300';
      case 'dark':
        return 'h-10 w-14 rounded-md border border-slate-700 bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 shadow-inner ring-1 ring-slate-800';
      case 'midnight':
        return 'h-10 w-14 rounded-md border border-slate-800 bg-gradient-to-br from-black via-slate-900 to-slate-950 shadow-inner ring-1 ring-teal-400/50';
      case 'holiday':
        return 'h-10 w-14 rounded-md border border-amber-500/60 bg-gradient-to-br from-emerald-500 via-red-500 to-amber-400 shadow-inner ring-1 ring-amber-400/60 text-white';
      default:
        return 'h-10 w-14 rounded-md border border-[color:var(--color-border-subtle)] bg-gradient-to-br from-[color:var(--color-panel-muted)] via-[color:var(--color-panel)] to-[color:var(--surface-root)] shadow-inner ring-1 ring-[color:var(--color-border-subtle)]';
    }
  };
  const currentSection =
    $derived(settingsSections.find((section) => section.id === activeSection));
  const currentSectionLabel = $derived(currentSection?.label ?? 'Settings');
  const currentSectionGroup = $derived(currentSection?.group ?? 'User Settings');
  let voicePrefs = $state<VoicePreferences>(loadVoicePreferences());
  const stopVoicePref = voicePreferences.subscribe((value) => (voicePrefs = value));
  const VOICE_TAB_KEY = 'hconnect:settings:voiceTab';
  function readVoiceTab(): 'voice' | 'video' | 'debug' {
    if (typeof localStorage === 'undefined') return 'voice';
    try {
      const raw = localStorage.getItem(VOICE_TAB_KEY);
      if (raw === 'voice' || raw === 'video' || raw === 'debug') return raw;
    } catch {
      /* ignore */
    }
    return 'voice';
  }
  function persistVoiceTab(tab: 'voice' | 'video' | 'debug') {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(VOICE_TAB_KEY, tab);
    } catch {
      /* ignore */
    }
  }
  let voiceTab = $state<'voice' | 'video' | 'debug'>(readVoiceTab());
  let voiceInputSensitivity = $state(50);
  let micTestRunning = $state(false);
  let micTestStream = $state<MediaStream | null>(null);
  let micTestAudioCtx = $state<AudioContext | null>(null);
  let micTestLevel = $state(0);
  let micTestError = $state<string | null>(null);
  let micTestRaf: number | null = null;
  let diagnosticRecording = $state(false);
  let videoTestRunning = $state(false);
  let videoTestStream = $state<MediaStream | null>(null);
  let videoTestError = $state<string | null>(null);
  let videoTestEl = $state<HTMLVideoElement | null>(null);
  let debugDownloadStatus = $state<'idle' | 'saved' | 'error'>('idle');
  let inputDevices = $state<MediaDeviceInfo[]>([]);
  let outputDevices = $state<MediaDeviceInfo[]>([]);
  let videoDevices = $state<MediaDeviceInfo[]>([]);
  let overlayStats = $state({ fps: 0, bitrate: 0, packetLoss: 0, ping: 0 });
  let diagnosticLevel = $state(0);
  let diagnosticTimer = $state(0);
  let diagnosticInterval: ReturnType<typeof setInterval> | null = null;
  let diagnosticRaf: number | null = null;
  let diagnosticAudioCtx: AudioContext | null = null;
  let diagnosticStream: MediaStream | null = null;
let diagnosticSampleUrl = $state<string | null>(null);
  let debugLogs = $state<string[]>([]);

  function updateVoicePref<K extends keyof VoicePreferences>(key: K, value: VoicePreferences[K]) {
    voicePreferences.update((prev) => ({ ...prev, [key]: value }));
    if (key === 'debugLogging') {
      try {
        if (typeof localStorage !== 'undefined') {
          if (value) {
            localStorage.setItem('hconnect:voice:debug', '1');
          } else {
            localStorage.removeItem('hconnect:voice:debug');
          }
        }
      } catch {
        // ignore storage errors
      }
    }
  }

  function resetVoicePrefs() {
    voicePreferences.set(defaultVoicePreferences);
    debugDownloadStatus = 'idle';
  }

  function stopMicTest() {
    micTestRunning = false;
    if (micTestRaf) {
      cancelAnimationFrame(micTestRaf);
      micTestRaf = null;
    }
    micTestLevel = 0;
    micTestStream?.getTracks()?.forEach((track) => track.stop());
    micTestStream = null;
    micTestAudioCtx?.close?.().catch(() => {});
    micTestAudioCtx = null;
  }

  async function startMicTest() {
    if (micTestRunning) return;
    micTestError = null;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      micTestError = 'Mic test not supported on this device.';
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micTestStream = stream;
      micTestRunning = true;
      micTestAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = micTestAudioCtx.createMediaStreamSource(stream);
      const analyser = micTestAudioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const centered = data[i] - 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / data.length);
        micTestLevel = Math.min(100, Math.max(0, Math.round((rms / 64) * 100)));
        if (micTestRunning) {
          micTestRaf = requestAnimationFrame(tick);
        }
      };
      tick();
    } catch (error) {
      console.warn('Mic test failed', error);
      micTestError = 'Unable to access microphone.';
      stopMicTest();
    }
  }

  function stopVideoTest() {
    videoTestRunning = false;
    videoTestStream?.getTracks()?.forEach((track) => track.stop());
    videoTestStream = null;
    if (videoTestEl) {
      videoTestEl.srcObject = null;
    }
    videoTestError = null;
  }

  async function startVideoTest() {
    if (videoTestRunning) return;
    videoTestError = null;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      videoTestError = 'Camera test not supported on this device.';
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      videoTestStream = stream;
      videoTestRunning = true;
      if (videoTestEl) {
        videoTestEl.srcObject = stream;
        videoTestEl.play?.();
      }
    } catch (error) {
      console.warn('Video test failed', error);
      videoTestError = 'Unable to access camera.';
      stopVideoTest();
    }
  }

  function downloadVoiceDebugLog() {
    if (typeof window === 'undefined') return;
    try {
      const payload = {
        generatedAt: new Date().toISOString(),
        userId: $user?.uid ?? 'anonymous',
        voicePrefs,
        logs: debugLogs,
        overlay: overlayStats,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown'
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `voice-video-debug-${Date.now()}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      debugDownloadStatus = 'saved';
    } catch (error) {
      console.error('Failed to download debug log', error);
      debugDownloadStatus = 'error';
    }
  }

  onDestroy(() => {
    stopVoicePref?.();
    stopMicTest();
    stopVideoTest();
    stopDiagnosticRecorder();
    stopOverlayStats();
  });

  $effect(() => {
    if (voicePrefs.showStreamOverlay) {
      startOverlayStats();
    } else {
      stopOverlayStats();
    }
  });

  async function refreshDevices() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      inputDevices = devices.filter((d) => d.kind === 'audioinput');
      outputDevices = devices.filter((d) => d.kind === 'audiooutput');
      videoDevices = devices.filter((d) => d.kind === 'videoinput');
    } catch (error) {
      console.warn('Failed to enumerate devices', error);
    }
  }

  onMount(() => {
    refreshDevices();
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
      return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
    }
  });

  $effect(() => {
    if (videoTestEl && videoTestStream) {
      videoTestEl.srcObject = videoTestStream;
      videoTestEl.play?.().catch(() => {});
    }
  });

  function appendDebugLog(message: string) {
    const stamp = new Date().toLocaleTimeString();
    debugLogs = [`[${stamp}] ${message}`, ...debugLogs].slice(0, 50);
  }

  let overlayInterval: ReturnType<typeof setInterval> | null = null;
  function startOverlayStats() {
    if (overlayInterval) return;
    overlayInterval = setInterval(() => {
      overlayStats = {
        fps: Math.round(26 + Math.random() * 10),
        bitrate: Math.round(1800 + Math.random() * 1400),
        packetLoss: Number((Math.random() * 1.5).toFixed(2)),
        ping: Math.round(25 + Math.random() * 30)
      };
    }, 2000);
  }

  function stopOverlayStats() {
    if (overlayInterval) {
      clearInterval(overlayInterval);
      overlayInterval = null;
    }
  }

  let diagnosticRecorder: MediaRecorder | null = null;
  function startDiagnosticRecorder() {
    if (diagnosticRecording) return;
    diagnosticRecording = true;
    diagnosticTimer = 0;
    diagnosticLevel = 0;
    diagnosticSampleUrl && URL.revokeObjectURL(diagnosticSampleUrl);
    diagnosticSampleUrl = null;
    diagnosticInterval = setInterval(() => (diagnosticTimer += 1), 1000);
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true, video: false })
        .then((stream) => {
          diagnosticStream = stream;
          diagnosticAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const source = diagnosticAudioCtx.createMediaStreamSource(stream);
          const analyser = diagnosticAudioCtx.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          const pump = () => {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i += 1) {
              const centered = data[i] - 128;
              sum += centered * centered;
            }
            const rms = Math.sqrt(sum / data.length);
            diagnosticLevel = Math.min(100, Math.max(0, Math.round((rms / 64) * 100)));
            if (diagnosticRecording) {
              diagnosticRaf = requestAnimationFrame(pump);
            }
          };
          pump();
          if ('MediaRecorder' in window) {
            diagnosticRecorder = new MediaRecorder(stream);
            const chunks: BlobPart[] = [];
            diagnosticRecorder.ondataavailable = (event) => {
              if (event.data.size > 0) chunks.push(event.data);
            };
            diagnosticRecorder.onstop = () => {
              const blob = new Blob(chunks, { type: 'audio/webm' });
              diagnosticSampleUrl = URL.createObjectURL(blob);
            };
            diagnosticRecorder.start();
          }
        })
        .catch((err) => {
          console.warn('Failed to start diagnostic recorder', err);
          diagnosticLevel = 0;
        });
    }
  }

  function stopDiagnosticRecorder() {
    if (!diagnosticRecording) return;
    diagnosticRecording = false;
    diagnosticInterval && clearInterval(diagnosticInterval);
    diagnosticInterval = null;
    diagnosticRecorder?.stop?.();
    diagnosticRecorder = null;
    if (diagnosticRaf) {
      cancelAnimationFrame(diagnosticRaf);
      diagnosticRaf = null;
    }
    diagnosticAudioCtx?.close?.().catch(() => {});
    diagnosticAudioCtx = null;
    diagnosticStream?.getTracks()?.forEach((t) => t.stop());
    diagnosticStream = null;
  }

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

{#if loading}
  <div class={`${cardBaseClasses} px-4 py-3 text-sm text-[color:var(--color-text-secondary)]`}>
    Loading profile...
  </div>
{:else if !$user}
  <div class={`${cardBaseClasses} px-4 py-3 text-sm text-[color:var(--color-text-secondary)]`}>
    Sign in to manage your settings.
  </div>
{:else}
  <div class="space-y-6 text-[color:var(--color-text-primary)]">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p class="text-xs uppercase tracking-[0.15em] text-[color:var(--text-70)]">{currentSectionGroup}</p>
        <h1 class="text-xl font-semibold">{currentSectionLabel}</h1>
      </div>
      {#if saveState !== 'idle'}
        <span
          class={`rounded-full border px-3 py-1 text-xs font-medium ${
            saveState === 'pending' || saveState === 'saving'
              ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-inverse)]'
              : saveState === 'saved'
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-100'
                : 'border-rose-500/60 bg-rose-500/15 text-rose-100'
          }`}
        >
          {saveState === 'pending'
            ? 'Pending save'
            : saveState === 'saving'
              ? 'Saving...'
              : saveState === 'saved'
                ? 'Saved'
                : 'Save failed'}
        </span>
      {/if}
    </div>

    {#if activeSection === 'account'}
      <div class="space-y-4">
        <div class={`${cardBaseClasses} p-5`}>
          <div class="space-y-4">
            <div class="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] px-4 py-2">
              <div>
                <p class="text-sm font-semibold text-[color:var(--color-text-primary)]">Account</p>
                <p class={mutedTextClasses}>Signed in as {$user?.email ?? 'user'}.</p>
              </div>
              <SignOutButton />
            </div>
            <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div class="flex items-center gap-4">
                <div class="h-20 w-20 aspect-square overflow-hidden rounded-full border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] shadow-inner">
                  {#if previewPhotoURL}
                    <img
                      src={previewPhotoURL}
                      alt="Avatar preview"
                      class="h-full w-full rounded-full object-cover"
                      loading="lazy"
                    />
                  {:else}
                    <div class="flex h-full w-full items-center justify-center text-xs uppercase tracking-wide text-[color:var(--text-70)]">
                      No image
                    </div>
                  {/if}
                </div>
                <div class="space-y-2">
                  <p class="text-sm font-medium text-[color:var(--color-text-primary)]">Profile photo</p>
                  <p class={mutedTextClasses}>Upload a square image for best results.</p>
                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      class={primaryButtonClasses}
                      onclick={triggerAvatarUpload}
                      disabled={avatarUploadBusy}
                    >
                      {avatarUploadBusy ? 'Uploading...' : 'Upload photo'}
                    </button>
                    {#if providerPhotoAvailable}
                      <button
                        type="button"
                        class={secondaryButtonClasses}
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
                    <p class="text-xs text-[color:var(--text-70)]">Uploading {Math.round(avatarUploadProgress * 100)}%</p>
                  {/if}
                  {#if avatarError}
                    <p class="text-xs text-rose-300">{avatarError}</p>
                  {/if}
                </div>
              </div>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium text-[color:var(--color-text-primary)]" for="display-name">Display name</label>
              <input
                id="display-name"
                class={fieldInputClasses}
                bind:value={displayName}
                maxlength={32}
                oninput={queueAutoSave}
              />
            </div>
          </div>
        </div>
      </div>
    {:else if activeSection === 'notifications'}
      <div class="space-y-4">
        <div class={`${cardBaseClasses} p-5 space-y-4`}>
          <div class="flex items-center justify-between gap-2">
            <div>
              <h2 class="text-lg font-semibold text-[color:var(--color-text-primary)]">Notifications</h2>
              <p class={mutedTextClasses}>Control push and desktop alerts.</p>
            </div>
          </div>

          <div class="space-y-3">
            <div class="flex items-start justify-between gap-4 rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] p-4">
              <div class="space-y-1">
                <h3 class="text-sm font-semibold text-[color:var(--color-text-primary)]">Push</h3>
                <p class={mutedTextClasses}>Mobile and background alerts.</p>
              </div>
              <label class="flex items-center gap-3">
                <input
                  type="checkbox"
                  class="peer sr-only"
                  checked={notif.pushEnabled}
                  disabled={pushToggleBusy || enablePushLoading}
                  onchange={handlePushToggleChange}
                />
                <span class="relative inline-flex h-6 w-11 rounded-full bg-[color:var(--color-border-subtle)] transition peer-checked:bg-[color:var(--color-accent)]">
                  <span class="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition peer-checked:translate-x-5"></span>
                </span>
                <span class="text-xs text-[color:var(--text-70)]">
                  {notif.pushEnabled ? 'Enabled on this device' : 'Tap to enable push'}
                </span>
              </label>
            </div>

            <div class="flex items-start justify-between gap-4 rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] p-4">
              <div class="space-y-1">
                <h3 class="text-sm font-semibold text-[color:var(--color-text-primary)]">Desktop banners</h3>
                <p class={mutedTextClasses}>Native browser notifications.</p>
              </div>
              <label class="flex items-center gap-3">
                <input
                  type="checkbox"
                  class="peer sr-only"
                  checked={notif.desktopEnabled}
                  disabled={desktopToggleBusy}
                  onchange={handleDesktopToggleChange}
                />
                <span class="relative inline-flex h-6 w-11 rounded-full bg-[color:var(--color-border-subtle)] transition peer-checked:bg-[color:var(--color-accent)]">
                  <span class="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition peer-checked:translate-x-5"></span>
                </span>
                <span class="text-xs text-[color:var(--text-70)]">
                  {notif.desktopEnabled ? 'Desktop alerts enabled' : 'Enable desktop alerts'}
                </span>
              </label>
            </div>
          </div>

          {#if $showNotificationDebugTools}
            <div class="rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel)] p-4 space-y-4">
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 class="text-sm font-semibold text-[color:var(--color-text-primary)]">Send test push</h3>
                  <p class={mutedTextClasses}>Super admins can send a diagnostic push to this device.</p>
                </div>
                <button
                  class={pillButtonClasses}
                  aria-busy={testPushState === 'loading'}
                  disabled={!notif.pushEnabled || testPushState === 'loading'}
                  onclick={sendTestPushNotification}
                >
                  {testPushState === 'loading' ? 'Sending...' : 'Send test push'}
                </button>
              </div>
              {#if testPushMessage}
                <p
                  class={`text-sm ${
                    testPushState === 'success'
                      ? 'text-[color:var(--color-text-primary)]'
                      : testPushState === 'error'
                        ? 'text-rose-200'
                        : 'text-[color:var(--color-text-secondary)]'
                  }`}
                >
                  {testPushMessage}
                </p>
              {/if}

              <div class="space-y-3 rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] p-3">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 class="text-sm font-semibold text-[color:var(--color-text-primary)]">Push debug log</h4>
                    <p class="text-xs text-[color:var(--text-70)]">
                      {#if pushDebugCopyState === 'copied'}
                        Copied to clipboard.
                      {:else if pushDebugCopyState === 'error'}
                        Could not copy log. Copy manually from below.
                      {:else}
                        Diagnostic entries from enable/test actions.
                      {/if}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      class={pillButtonClasses}
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
                      class={pillButtonClasses}
                      onclick={clearPushDebugLog}
                      disabled={!pushDebugLog.length}
                    >
                      Clear log
                    </button>
                  </div>
                </div>
                {#if pushDebugLog.length}
                  <ol class="space-y-2">
                    {#each pushDebugLog as entry (entry.id)}
                      <li class="rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel)] p-3 space-y-2">
                        <div class="flex flex-wrap items-center gap-2 text-xs text-[color:var(--text-70)]">
                          <span>{formatDebugTimestamp(entry.timestamp)}</span>
                          {#if entry.tag}
                            <span class="rounded-full bg-[color:var(--color-panel-muted)] px-2 py-0.5 text-[11px] uppercase tracking-wide text-[color:var(--color-text-secondary)]">
                              {entry.tag}
                            </span>
                          {/if}
                          <span
                            class={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                              entry.level === 'error'
                                ? 'bg-rose-500/20 text-rose-100'
                                : entry.level === 'warn'
                                  ? 'bg-amber-500/20 text-amber-100'
                                  : 'bg-[color:var(--color-panel-muted)] text-[color:var(--color-text-primary)]'
                            }`}
                          >
                            {entry.level}
                          </span>
                        </div>
                        <p
                          class={`text-sm ${
                            entry.level === 'error'
                              ? 'text-rose-200'
                              : entry.level === 'warn'
                                ? 'text-amber-200'
                                : 'text-[color:var(--color-text-primary)]'
                          }`}
                        >
                          {entry.message}
                        </p>
                        {#if entry.details}
                          <pre class="whitespace-pre-wrap rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] p-3 text-xs text-[color:var(--color-text-primary)]">{entry.details}</pre>
                        {/if}
                      </li>
                    {/each}
                  </ol>
                {:else}
                  <p class="text-sm text-[color:var(--text-70)]">Logs appear when you enable push or send a test notification.</p>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      </div>
    {:else if activeSection === 'voice'}
      <div class="space-y-4">
        <div class={`${cardBaseClasses} p-5 space-y-4`}>
          <div class="flex items-center justify-between gap-2">
            <div>
              <h2 class="text-lg font-semibold text-[color:var(--color-text-primary)]">Voice &amp; Video</h2>
              <p class={mutedTextClasses}>Tune your call devices, defaults, and debugging tools.</p>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              class={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                voiceTab === 'voice'
                  ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-inverse)]'
                  : 'border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] text-[color:var(--color-text-primary)]'
              }`}
              type="button"
              onclick={() => {
                voiceTab = 'voice';
                persistVoiceTab('voice');
              }}
            >
              <i class="bx bx-microphone"></i>
              Voice
            </button>
            <button
              class={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                voiceTab === 'video'
                  ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-inverse)]'
                  : 'border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] text-[color:var(--color-text-primary)]'
              }`}
              type="button"
              onclick={() => {
                voiceTab = 'video';
                persistVoiceTab('video');
              }}
            >
              <i class="bx bx-video"></i>
              Video
            </button>
            <button
              class={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                voiceTab === 'debug'
                  ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-inverse)]'
                  : 'border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] text-[color:var(--color-text-primary)]'
              }`}
              type="button"
              onclick={() => {
                voiceTab = 'debug';
                persistVoiceTab('debug');
              }}
            >
              <i class="bx bx-bug"></i>
              Debugging
            </button>
          </div>

          {#if voiceTab === 'voice'}
            <div class="rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] p-4">
              <div class="flex items-start gap-3">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-panel)] text-[color:var(--color-accent)]">
                  <i class="bx bx-mouse-alt text-lg"></i>
                </span>
                <div class="space-y-1 text-sm">
                  <p class="font-semibold text-[color:var(--color-text-primary)]">Desktop overlay</p>
                  <p class={mutedTextClasses}>
                    Hover over the video to surface mute, video, screen share, and more options -- just like Discord.
                  </p>
                </div>
              </div>
            </div>
            <div class="grid gap-4 md:grid-cols-2">
              <div class="space-y-3 rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] p-4">
                <div>
                  <h3 class="text-sm font-semibold text-[color:var(--color-text-primary)]">Devices</h3>
                  <p class={mutedTextClasses}>Choose your mic and speakers.</p>
                </div>
                <div class="space-y-2">
                  <label class="text-sm font-medium text-[color:var(--color-text-primary)]" for="voice-input-device">Input device</label>
                  <select
                    id="voice-input-device"
                    class={fieldInputClasses}
                    value={voicePrefs.inputDeviceId ?? ''}
                    onchange={(event) => updateVoicePref('inputDeviceId', event.currentTarget.value || null)}
                  >
                    <option value="">System default</option>
                    {#each inputDevices as device}
                      <option value={device.deviceId}>{device.label || 'Microphone'}</option>
                    {/each}
                    {#if voicePrefs.inputDeviceId && !inputDevices.some((d) => d.deviceId === voicePrefs.inputDeviceId)}
                      <option value={voicePrefs.inputDeviceId}>Saved device</option>
                    {/if}
                  </select>
                  <div class="flex flex-wrap items-center gap-3 text-sm text-[color:var(--color-text-primary)]">
                    <button
                      type="button"
                      class={secondaryButtonClasses}
                      onclick={micTestRunning ? stopMicTest : startMicTest}
                    >
                      {micTestRunning ? 'Stop mic test' : 'Test mic'}
                    </button>
                    <div class="flex items-center gap-2" aria-label="Mic level meter">
                      <div class="h-2 w-32 rounded-full bg-[color:var(--color-panel)]">
                        <div
                          class="h-2 rounded-full bg-[color:var(--color-accent)] transition-all duration-150"
                          style={`width:${Math.max(8, micTestLevel)}%`}
                        ></div>
                      </div>
                      <span class="text-xs text-[color:var(--text-70)]">{micTestRunning ? 'Listening' : 'Idle'}</span>
                    </div>
                  </div>
                  {#if micTestError}
                    <p class="text-xs text-[color:var(--color-danger)]">{micTestError}</p>
                  {/if}
                </div>
                <div class="space-y-2">
                  <label class="text-sm font-medium text-[color:var(--color-text-primary)]" for="voice-output-device">Output device</label>
                  <select
                    id="voice-output-device"
                    class={fieldInputClasses}
                    value={voicePrefs.outputDeviceId ?? ''}
                    onchange={(event) => updateVoicePref('outputDeviceId', event.currentTarget.value || null)}
                  >
                    <option value="">System default</option>
                    {#each outputDevices as device}
                      <option value={device.deviceId}>{device.label || 'Speakers'}</option>
                    {/each}
                    {#if voicePrefs.outputDeviceId && !outputDevices.some((d) => d.deviceId === voicePrefs.outputDeviceId)}
                      <option value={voicePrefs.outputDeviceId}>Saved device</option>
                    {/if}
                  </select>
                </div>
              </div>

              <div class="space-y-3 rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] p-4">
                <div class="flex items-center justify-between gap-2">
                  <div>
                    <h3 class="text-sm font-semibold text-[color:var(--color-text-primary)]">Input mode</h3>
                    <p class={mutedTextClasses}>Switch between voice activity or push-to-talk.</p>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class={`${pillButtonClasses} ${voicePrefs.inputMode === 'voice' ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-inverse)]' : ''}`}
                    onclick={() => updateVoicePref('inputMode', 'voice')}
                  >
                    Voice activity
                  </button>
                  <button
                    type="button"
                    class={`${pillButtonClasses} ${voicePrefs.inputMode === 'ptt' ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-inverse)]' : ''}`}
                    onclick={() => updateVoicePref('inputMode', 'ptt')}
                  >
                    Push to talk
                  </button>
                </div>
                {#if voicePrefs.inputMode === 'ptt'}
                  <div class="space-y-2">
                    <label class="text-sm font-medium text-[color:var(--color-text-primary)]" for="ptt-keybind">Keybind</label>
                    <input
                      id="ptt-keybind"
                      class={fieldInputClasses}
                      value={voicePrefs.pushToTalkKey ?? ''}
                      oninput={(event) => updateVoicePref('pushToTalkKey', event.currentTarget.value || null)}
                      placeholder="Press a key"
                    />
                    <div class="flex gap-2 text-xs text-[color:var(--text-70)]">
                      <label class="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={voicePrefs.pushToTalkKey === 'toggle'}
                          onclick={() => updateVoicePref('pushToTalkKey', voicePrefs.pushToTalkKey === 'toggle' ? 'V' : 'toggle')}
                        />
                        Toggle mode
                      </label>
                    </div>
                  </div>
                {:else}
                  <div class="space-y-2">
                    <label class="text-sm font-medium text-[color:var(--color-text-primary)]" for="input-sensitivity">Input sensitivity</label>
                    <input
                      id="input-sensitivity"
                      type="range"
                      min="1"
                      max="100"
                      value={voiceInputSensitivity}
                      oninput={(event) => (voiceInputSensitivity = Number(event.currentTarget.value))}
                    />
                    <div class="flex gap-2">
                      <label class="inline-flex items-center gap-2 text-sm text-[color:var(--color-text-primary)]">
                        <input
                          type="checkbox"
                          checked={voicePrefs.autoGain}
                          onchange={(event) => updateVoicePref('autoGain', event.currentTarget.checked)}
                        />
                        Auto gain control
                      </label>
                      <label class="inline-flex items-center gap-2 text-sm text-[color:var(--color-text-primary)]">
                        <input
                          type="checkbox"
                          checked={voicePrefs.noiseSuppression}
                          onchange={(event) => updateVoicePref('noiseSuppression', event.currentTarget.checked)}
                        />
                        Noise suppression
                      </label>
                      <label class="inline-flex items-center gap-2 text-sm text-[color:var(--color-text-primary)]">
                        <input
                          type="checkbox"
                          checked={voicePrefs.echoCancellation}
                          onchange={(event) => updateVoicePref('echoCancellation', event.currentTarget.checked)}
                        />
                        Echo cancellation
                      </label>
                    </div>
                  </div>
                {/if}
              </div>

              <div class="space-y-3 rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] p-4">
                <div class="flex items-center justify-between gap-2">
                  <div>
                    <h3 class="text-sm font-semibold text-[color:var(--color-text-primary)]">Mic test</h3>
                    <p class={mutedTextClasses}>Record a quick sample to hear levels.</p>
                  </div>
                  <span class="rounded-full bg-[color:var(--color-panel)] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-text-secondary)]">
                    Live
                  </span>
                </div>
                <div class="flex gap-2">
                  <button
                    type="button"
                    class={primaryButtonClasses}
                    onclick={startMicTest}
                    disabled={micTestRunning}
                  >
                    {micTestRunning ? 'Listening...' : 'Start test'}
                  </button>
                  <button
                    type="button"
                    class={secondaryButtonClasses}
                    onclick={stopMicTest}
                    disabled={!micTestRunning}
                  >
                    Stop
                  </button>
                </div>
                <div class="h-2 rounded-full bg-[color:var(--color-panel)]" aria-label="Mic level meter">
                  <div
                    class="h-2 rounded-full bg-[color:var(--color-accent)] transition-all duration-200"
                    style={`width:${Math.max(8, micTestLevel)}%`}
                  ></div>
                </div>
                {#if micTestError}
                  <p class="text-xs text-[color:var(--color-danger)]">{micTestError}</p>
                {/if}
              </div>

              <div class="space-y-3 rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] p-4">
                <h3 class="text-sm font-semibold text-[color:var(--color-text-primary)]">Join behavior</h3>
                <label class="inline-flex items-center gap-2 text-sm text-[color:var(--color-text-primary)]">
                  <input
                    type="checkbox"
                    checked={voicePrefs.muteOnJoin}
                    onchange={(event) => updateVoicePref('muteOnJoin', event.currentTarget.checked)}
                  />
                  Mute microphone when joining a voice channel
                </label>
                <div class="rounded-md border border-dashed border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel)] p-3 text-sm text-[color:var(--text-70)]">
                  <p class="font-semibold text-[color:var(--color-text-primary)]">
                    Voice processing
                    <span class="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[color:var(--color-text-secondary)]">
                      Coming soon
                    </span>
                  </p>
                  <p class="text-xs text-[color:var(--text-70)]">Advanced effects coming soon.</p>
                  <div class="mt-2 flex flex-wrap gap-3">
                    <label class="inline-flex items-center gap-2 opacity-60">
                      <input type="checkbox" disabled />
                      Studio clarity (coming soon)
                    </label>
                    <label class="inline-flex items-center gap-2 opacity-60">
                      <input type="checkbox" disabled />
                      Spatial audio (coming soon)
                    </label>
                  </div>
                </div>
              </div>
            </div>
          {:else if voiceTab === 'video'}
            <div class="grid gap-4 md:grid-cols-2">
              <div class="space-y-3 rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] p-4">
                <h3 class="text-sm font-semibold text-[color:var(--color-text-primary)]">Preview</h3>
                <div class="aspect-video w-full overflow-hidden rounded-lg border border-dashed border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel)] text-center text-sm text-[color:var(--text-70)] grid place-items-center">
                  {#if videoTestRunning}
                    <video class="h-full w-full object-cover" autoplay playsinline muted bind:this={videoTestEl}></video>
                  {:else}
                    Camera preview placeholder
                  {/if}
                </div>
                <div class="flex gap-2">
                  <button
                    type="button"
                    class={primaryButtonClasses}
                    onclick={startVideoTest}
                    disabled={videoTestRunning}
                  >
                    Start test video
                  </button>
                  <button
                    type="button"
                    class={secondaryButtonClasses}
                    onclick={stopVideoTest}
                    disabled={!videoTestRunning}
                  >
                    Stop
                  </button>
                </div>
                <p class="text-xs text-[color:var(--text-70)]">Preview uses your actual camera feed.</p>
                {#if videoTestError}
                  <p class="text-xs text-[color:var(--color-danger)]">{videoTestError}</p>
                {/if}
                <div class="space-y-2">
                  <label class="text-sm font-medium text-[color:var(--color-text-primary)]" for="camera-device">Camera</label>
                  <select
                    id="camera-device"
                    class={fieldInputClasses}
                    value={voicePrefs.cameraDeviceId ?? ''}
                    onchange={(event) => updateVoicePref('cameraDeviceId', event.currentTarget.value || null)}
                  >
                    <option value="">System default</option>
                    {#each videoDevices as device}
                      <option value={device.deviceId}>{device.label || 'Camera'}</option>
                    {/each}
                    {#if voicePrefs.cameraDeviceId && !videoDevices.some((d) => d.deviceId === voicePrefs.cameraDeviceId)}
                      <option value={voicePrefs.cameraDeviceId}>Saved device</option>
                    {/if}
                  </select>
                </div>
                <div class="space-y-2">
                  <label class="text-sm font-medium text-[color:var(--color-text-primary)]" for="camera-quality">Video quality</label>
                  <select
                    id="camera-quality"
                    class={fieldInputClasses}
                    value={voicePrefs.videoQuality ?? '720p'}
                    onchange={(event) =>
                      updateVoicePref('videoQuality', (event.currentTarget.value || '720p') as VoicePreferences['videoQuality'])
                    }
                  >
                    <option value="1080p">1080p</option>
                    <option value="720p">720p</option>
                    <option value="480p">480p</option>
                  </select>
                </div>
              </div>
              <div class="space-y-3 rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] p-4">
                <h3 class="text-sm font-semibold text-[color:var(--color-text-primary)]">Video options</h3>
                <label class="inline-flex items-center gap-2 text-sm text-[color:var(--color-text-primary)]">
                  <input
                    type="checkbox"
                    checked={voicePrefs.mirrorVideo}
                    onchange={(event) => updateVoicePref('mirrorVideo', event.currentTarget.checked)}
                  />
                  Mirror my video
                </label>
                <label class="inline-flex items-center gap-2 text-sm text-[color:var(--color-text-primary)]">
                  <input
                    type="checkbox"
                    checked={voicePrefs.backgroundBlur}
                    onchange={(event) => updateVoicePref('backgroundBlur', event.currentTarget.checked)}
                  />
                  Background blur
                </label>
                <div class="space-y-1">
                  <label class="text-sm font-medium text-[color:var(--color-text-primary)]" for="video-background-image">Background image</label>
                  <select
                    id="video-background-image"
                    class={fieldInputClasses}
                    value={voicePrefs.backgroundImage ?? ''}
                    onchange={(event) => updateVoicePref('backgroundImage', event.currentTarget.value || null)}
                  >
                    <option value="">None</option>
                    <option value="coming-soon" disabled>Background gallery (coming soon)</option>
                  </select>
                </div>
                <label class="inline-flex items-center gap-2 text-sm text-[color:var(--color-text-primary)]">
                  <input
                    type="checkbox"
                    checked={voicePrefs.lowBandwidthMode}
                    onchange={(event) => updateVoicePref('lowBandwidthMode', event.currentTarget.checked)}
                  />
                  Low bandwidth mode
                </label>
                <label class="inline-flex items-center gap-2 text-sm text-[color:var(--color-text-primary)]">
                  <input
                    type="checkbox"
                    checked={voicePrefs.videoOffOnJoin}
                    onchange={(event) => updateVoicePref('videoOffOnJoin', event.currentTarget.checked)}
                  />
                  Turn off video when joining
                </label>
              </div>
            </div>
          {:else}
            <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div class="space-y-3 rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] p-4">
                <h3 class="text-sm font-semibold text-[color:var(--color-text-primary)]">Debug logging</h3>
                <p class={mutedTextClasses}>Keep a rolling voice/video log and export it for support.</p>
                <label class="inline-flex items-center gap-2 text-sm text-[color:var(--color-text-primary)]">
                  <input
                    type="checkbox"
                    checked={voicePrefs.debugLogging}
                    onchange={(event) => {
                      updateVoicePref('debugLogging', event.currentTarget.checked);
                      appendDebugLog(event.currentTarget.checked ? 'Debug logging enabled' : 'Debug logging disabled');
                    }}
                  />
                  Enable debug logging
                </label>
                <div class="space-y-2 rounded-md border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel)] p-2">
                  {#if debugLogs.length === 0}
                    <p class="text-xs text-[color:var(--text-70)]">No recent events.</p>
                  {:else}
                    <div class="max-h-32 overflow-y-auto text-xs text-[color:var(--color-text-primary)] space-y-1">
                      {#each debugLogs as log, idx}
                        <div class={idx === 0 ? 'font-semibold' : ''}>{log}</div>
                      {/each}
                    </div>
                  {/if}
                </div>
                <div class="flex items-center gap-2">
                  <button type="button" class={secondaryButtonClasses} onclick={downloadVoiceDebugLog}>
                    Download debug log
                  </button>
                  {#if debugDownloadStatus === 'saved'}
                    <span class="text-xs text-emerald-400">Saved</span>
                  {:else if debugDownloadStatus === 'error'}
                    <span class="text-xs text-[color:var(--color-danger)]">Failed</span>
                  {/if}
                </div>
              </div>
              <div class="space-y-3 rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] p-4">
                <h3 class="text-sm font-semibold text-[color:var(--color-text-primary)]">Stream info overlay</h3>
                <label class="inline-flex items-center gap-2 text-sm text-[color:var(--color-text-primary)]">
                  <input
                    type="checkbox"
                    checked={voicePrefs.showStreamOverlay}
                    onchange={(event) => {
                      updateVoicePref('showStreamOverlay', event.currentTarget.checked);
                      if (event.currentTarget.checked) {
                        startOverlayStats();
                      } else {
                        stopOverlayStats();
                      }
                    }}
                  />
                  Show stream info overlay in calls
                </label>
                <div class="grid grid-cols-2 gap-2 text-xs text-[color:var(--color-text-primary)]">
                  <div class="rounded-md bg-[color:var(--color-panel)] p-2">
                    <p class="text-[color:var(--text-70)]">FPS</p>
                    <p class="text-sm font-semibold">{overlayStats.fps || '—'}</p>
                  </div>
                  <div class="rounded-md bg-[color:var(--color-panel)] p-2">
                    <p class="text-[color:var(--text-70)]">Bitrate (kbps)</p>
                    <p class="text-sm font-semibold">{overlayStats.bitrate || '—'}</p>
                  </div>
                  <div class="rounded-md bg-[color:var(--color-panel)] p-2">
                    <p class="text-[color:var(--text-70)]">Packet loss %</p>
                    <p class="text-sm font-semibold">{overlayStats.packetLoss || '—'}</p>
                  </div>
                  <div class="rounded-md bg-[color:var(--color-panel)] p-2">
                    <p class="text-[color:var(--text-70)]">Ping (ms)</p>
                    <p class="text-sm font-semibold">{overlayStats.ping || '—'}</p>
                  </div>
                </div>
              </div>
              <div class="space-y-3 rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] p-4">
                <h3 class="text-sm font-semibold text-[color:var(--color-text-primary)]">Diagnostic audio recorder</h3>
                <p class={mutedTextClasses}>Records your mic only for troubleshooting; not shared with others.</p>
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    class={primaryButtonClasses}
                    onclick={startDiagnosticRecorder}
                    disabled={diagnosticRecording}
                  >
                    Record sample
                  </button>
                  <button
                    type="button"
                    class={secondaryButtonClasses}
                    onclick={stopDiagnosticRecorder}
                    disabled={!diagnosticRecording}
                  >
                    Stop
                  </button>
                  <span class="text-xs text-[color:var(--text-70)]">Timer: {diagnosticTimer}s</span>
                  <div class="h-2 w-24 rounded-full bg-[color:var(--color-panel)]">
                    <div
                      class="h-2 rounded-full bg-[color:var(--color-accent)] transition-all duration-150"
                      style={`width:${Math.max(6, diagnosticLevel)}%`}
                    ></div>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class={secondaryButtonClasses}
                    onclick={() => {
                      if (diagnosticSampleUrl) {
                        const audio = new Audio(diagnosticSampleUrl);
                        audio.play().catch(() => {});
                      }
                    }}
                    disabled={!diagnosticSampleUrl}
                  >
                    Play sample
                  </button>
                  {#if diagnosticSampleUrl}
                    <span class="text-xs text-[color:var(--text-70)]">Sample ready</span>
                  {/if}
                </div>
              </div>
              <div class="space-y-3 rounded-lg border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] p-4 md:col-span-2 xl:col-span-3">
                <h3 class="text-sm font-semibold text-[color:var(--color-text-primary)]">Reset</h3>
                <p class={mutedTextClasses}>Restore voice and video settings to their defaults.</p>
                <button
                  type="button"
                  class={secondaryButtonClasses}
                  onclick={() => {
                    if (confirm('Reset voice and video settings to default?')) resetVoicePrefs();
                  }}
                >
                  Reset voice and video settings
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {:else if activeSection === 'ai'}
      <div class={`${cardBaseClasses} p-5 space-y-4`}>
        <div class="flex items-center justify-between gap-2">
          <div>
            <h2 class="text-lg font-semibold text-[color:var(--color-text-primary)]">AI assist</h2>
            <p class={mutedTextClasses}>Inline suggestions while typing.</p>
          </div>
          <label class="flex items-center gap-3">
            <input
              type="checkbox"
              class="peer sr-only"
              bind:checked={aiAssist.enabled}
              aria-label="Enable AI typing assistant"
              onchange={queueAutoSave}
            />
            <span class="relative inline-flex h-6 w-11 rounded-full bg-[color:var(--color-border-subtle)] transition peer-checked:bg-[color:var(--color-accent)]">
              <span class="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition peer-checked:translate-x-5"></span>
            </span>
          </label>
        </div>
      </div>
    {:else if activeSection === 'appearance'}
      <div class={`${cardBaseClasses} p-5 space-y-4`}>
        <div>
          <h2 class="text-lg font-semibold text-[color:var(--color-text-primary)]">Appearance</h2>
          <p class={mutedTextClasses}>Choose your theme.</p>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          {#each themeChoices as choice}
            <button
              type="button"
              class={`flex items-center gap-3 rounded-lg border p-4 text-left transition ${
                themeMode === choice.id
                  ? 'border-[color:var(--color-accent)] bg-[color:var(--color-panel)] ring-2 ring-[color:var(--color-accent)]'
                  : 'border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] hover:border-[color:var(--color-accent)]'
              }`}
              onclick={() => updateThemePreference(choice.id)}
            >
              <span class={themeSwatchClasses(choice.id)}></span>
              <div class="space-y-1">
                <span class="block text-sm font-semibold text-[color:var(--color-text-primary)]">{choice.label}</span>
                <span class="block text-xs leading-snug text-[color:var(--text-70)]">{choice.description}</span>
              </div>
              {#if themeMode === choice.id}
                <span class="ml-auto rounded-full bg-[color:var(--color-accent-soft)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-text-primary)]">
                  Active
                </span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    {:else if activeSection === 'invites'}
      <div class={`${cardBaseClasses} p-5 space-y-3`}>
        <div>
          <h2 class="text-lg font-semibold text-[color:var(--color-text-primary)]">Invites</h2>
          <p class={mutedTextClasses}>Share access to your spaces.</p>
        </div>
        <InvitePanel {serverId} embedded />
      </div>
    {/if}
  </div>
{/if}

