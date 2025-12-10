import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type VoicePreferences = {
  muteOnJoin: boolean;
  videoOffOnJoin: boolean;
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  cameraDeviceId: string | null;
  inputMode: 'voice' | 'ptt';
  pushToTalkKey: string | null;
  autoGain: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  mirrorVideo: boolean;
  lowBandwidthMode: boolean;
  showStreamOverlay: boolean;
  backgroundBlur: boolean;
  backgroundImage: string | null;
  videoQuality: '480p' | '720p' | '1080p';
  debugLogging: boolean;
};

const STORAGE_KEY = 'hconnect:voice:preferences';

export const defaultVoicePreferences: VoicePreferences = {
  muteOnJoin: true,
  videoOffOnJoin: true,
  inputDeviceId: null,
  outputDeviceId: null,
  cameraDeviceId: null,
  inputMode: 'voice',
  pushToTalkKey: 'V',
  autoGain: true,
  noiseSuppression: true,
  echoCancellation: true,
  mirrorVideo: true,
  lowBandwidthMode: false,
  showStreamOverlay: false,
  backgroundBlur: false,
  backgroundImage: null,
  videoQuality: '720p',
  debugLogging: true
};

export function loadVoicePreferences(): VoicePreferences {
  if (!browser) return defaultVoicePreferences;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultVoicePreferences;
    const parsed = JSON.parse(raw);
    return {
      ...defaultVoicePreferences,
      ...parsed
    } as VoicePreferences;
  } catch {
    return defaultVoicePreferences;
  }
}

export function saveVoicePreferences(prefs: VoicePreferences) {
  if (!browser) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export const voicePreferences = writable<VoicePreferences>(loadVoicePreferences());

if (browser) {
  voicePreferences.subscribe((value) => saveVoicePreferences(value));
}
