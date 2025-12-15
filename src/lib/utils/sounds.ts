import { browser } from '$app/environment';

export type SoundEffect = 'notification' | 'call-join' | 'call-leave';
export type SoundSources = {
  notificationUrl: string;
  callJoinUrl: string;
  callLeaveUrl: string;
};

export const DEFAULT_SOUND_SOURCES: SoundSources = {
  notificationUrl: '/sounds/notification.wav',
  callJoinUrl: '/sounds/call-join.wav',
  callLeaveUrl: '/sounds/call-leave.wav'
};

const SOUND_CONFIG: Record<SoundEffect, { getUrl: () => string; volume: number }> = {
  notification: { getUrl: () => currentSources.notificationUrl, volume: 0.7 },
  'call-join': { getUrl: () => currentSources.callJoinUrl, volume: 0.75 },
  'call-leave': { getUrl: () => currentSources.callLeaveUrl, volume: 0.7 }
};

let currentSources: SoundSources = { ...DEFAULT_SOUND_SOURCES };

const audioCache = new Map<SoundEffect, HTMLAudioElement>();
const pendingQueue: SoundEffect[] = [];
const unlockEvents = ['pointerdown', 'mousedown', 'touchstart', 'keydown'] as const;
let unlocked = false;
let unlockAttached = false;

function getAudio(id: SoundEffect): HTMLAudioElement | null {
  if (!browser || typeof Audio === 'undefined') return null;
  let audio = audioCache.get(id);
  if (!audio) {
    const config = SOUND_CONFIG[id];
    audio = new Audio(config.getUrl());
    audio.preload = 'auto';
    audio.volume = config.volume;
    audioCache.set(id, audio);
  }
  return audio;
}

function tryPlay(id: SoundEffect) {
  const template = getAudio(id);
  if (!template) return;
  const node = template.cloneNode(true) as HTMLAudioElement;
  node.volume = template.volume;
  node.src = SOUND_CONFIG[id].getUrl();
  node.currentTime = 0;
  node.play().catch(() => {});
}

function flushPending() {
  if (!pendingQueue.length) return;
  const queued = pendingQueue.splice(0, pendingQueue.length);
  queued.slice(-4).forEach((id) => tryPlay(id));
}

function detachUnlockListeners(handler: EventListener) {
  if (!unlockAttached || typeof window === 'undefined') return;
  unlockAttached = false;
  unlockEvents.forEach((event) => window.removeEventListener(event, handler));
}

function attachUnlockListeners(handler: EventListener) {
  if (unlocked || unlockAttached || typeof window === 'undefined') return;
  unlockAttached = true;
  unlockEvents.forEach((event) => window.addEventListener(event, handler, { passive: true }));
}

export function primeSoundPlayback() {
  if (!browser) return;
  const handler = () => {
    unlocked = true;
    detachUnlockListeners(handler);
    flushPending();
  };
  attachUnlockListeners(handler);
  Object.keys(SOUND_CONFIG).forEach((key) => getAudio(key as SoundEffect));
}

export function playSound(id: SoundEffect) {
  if (!browser) return;
  if (unlocked) {
    tryPlay(id);
    return;
  }
  pendingQueue.push(id);
  while (pendingQueue.length > 8) pendingQueue.shift();
  primeSoundPlayback();
}

export function setSoundOverrides(sources?: Partial<SoundSources> | null) {
  const next = { ...currentSources, ...(sources ?? {}) };
  const changed =
    next.notificationUrl !== currentSources.notificationUrl ||
    next.callJoinUrl !== currentSources.callJoinUrl ||
    next.callLeaveUrl !== currentSources.callLeaveUrl;
  if (!changed) return;
  currentSources = next;
  audioCache.clear();
  if (unlocked) {
    // Preload new sources for snappier playback
    (['notification', 'call-join', 'call-leave'] as SoundEffect[]).forEach((id) => getAudio(id));
  }
}
