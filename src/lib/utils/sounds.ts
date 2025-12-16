import { browser } from '$app/environment';

export type SoundEffect = 'notification' | 'call-join' | 'call-leave' | 'message-send';
export type SoundSources = {
	notificationUrl: string;
	callJoinUrl: string;
	callLeaveUrl: string;
	messageSendUrl: string;
};

export type SoundPreferences = {
	enabled: boolean;
	notificationSound: boolean;
	callJoinSound: boolean;
	callLeaveSound: boolean;
	messageSendSound: boolean;
	volume: number;
};

const SOUND_PREFS_KEY = 'hconnect:sound:preferences';

const defaultSoundPrefs: SoundPreferences = {
	enabled: true,
	notificationSound: true,
	callJoinSound: true,
	callLeaveSound: true,
	messageSendSound: true,
	volume: 70
};

function loadSoundPrefs(): SoundPreferences {
	if (!browser || typeof localStorage === 'undefined') return defaultSoundPrefs;
	try {
		const raw = localStorage.getItem(SOUND_PREFS_KEY);
		if (!raw) return defaultSoundPrefs;
		return { ...defaultSoundPrefs, ...JSON.parse(raw) };
	} catch {
		return defaultSoundPrefs;
	}
}

function isSoundEnabled(effect: SoundEffect): boolean {
	const prefs = loadSoundPrefs();
	if (!prefs.enabled) return false;

	switch (effect) {
		case 'notification':
			return prefs.notificationSound;
		case 'call-join':
			return prefs.callJoinSound;
		case 'call-leave':
			return prefs.callLeaveSound;
		case 'message-send':
			return prefs.messageSendSound;
		default:
			return true;
	}
}

function getVolumeMultiplier(): number {
	const prefs = loadSoundPrefs();
	return prefs.volume / 100;
}

export const DEFAULT_SOUND_SOURCES: SoundSources = {
	notificationUrl: '/sounds/notification.wav',
	callJoinUrl: '/sounds/call-join.wav',
	callLeaveUrl: '/sounds/call-leave.wav',
	messageSendUrl: '/sounds/message-send.wav'
};

const SOUND_CONFIG: Record<SoundEffect, { getUrl: () => string; volume: number }> = {
	notification: { getUrl: () => currentSources.notificationUrl, volume: 0.7 },
	'call-join': { getUrl: () => currentSources.callJoinUrl, volume: 0.75 },
	'call-leave': { getUrl: () => currentSources.callLeaveUrl, volume: 0.7 },
	'message-send': { getUrl: () => currentSources.messageSendUrl, volume: 0.5 }
};

let currentSources: SoundSources = { ...DEFAULT_SOUND_SOURCES };

const audioCache = new Map<SoundEffect, HTMLAudioElement>();
const pendingQueue: SoundEffect[] = [];
const unlockEvents = ['pointerdown', 'mousedown', 'touchstart', 'keydown'] as const;
let unlocked = false;
let unlockAttached = false;

// Use window global for notification debounce to survive HMR
declare global {
	interface Window {
		__notificationSoundLock?: { time: number; scheduled: boolean };
	}
}

function getNotificationLock() {
	if (typeof window === 'undefined') return { time: 0, scheduled: false };
	if (!window.__notificationSoundLock) {
		window.__notificationSoundLock = { time: 0, scheduled: false };
	}
	return window.__notificationSoundLock;
}

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
	// Apply user's volume preference
	const volumeMultiplier = getVolumeMultiplier();
	node.volume = template.volume * volumeMultiplier;
	node.src = SOUND_CONFIG[id].getUrl();
	node.currentTime = 0;
	node.play().catch(() => {});
}

function flushPending() {
	if (!pendingQueue.length) return;
	const queued = pendingQueue.splice(0, pendingQueue.length);
	// Filter out disabled sounds before playing
	queued
		.slice(-4)
		.filter(isSoundEnabled)
		.forEach((id) => tryPlay(id));
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

/**
 * Play a sound effect, respecting user preferences.
 * If sounds are disabled globally or for the specific effect type, no sound plays.
 * @param id The sound effect to play
 * @param force If true, bypasses preference checks (useful for preview in settings)
 */
export function playSound(id: SoundEffect, force = false) {
	if (!browser) return;

	// Check if this sound is enabled (unless forced for preview)
	if (!force && !isSoundEnabled(id)) return;

	// Debounce notification sounds with global lock (survives HMR)
	if (id === 'notification' && !force) {
		const lock = getNotificationLock();
		const now = Date.now();
		
		// Block if already scheduled or within cooldown
		if (lock.scheduled || now - lock.time < 3000) {
			return;
		}
		
		// Set locks immediately
		lock.scheduled = true;
		lock.time = now;
		
		// Play after short delay to coalesce multiple triggers
		setTimeout(() => {
			lock.scheduled = false;
			if (unlocked) {
				tryPlay('notification');
			}
		}, 100);
		return;
	}

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
		next.callLeaveUrl !== currentSources.callLeaveUrl ||
		next.messageSendUrl !== currentSources.messageSendUrl;
	if (!changed) return;
	currentSources = next;
	audioCache.clear();
	if (unlocked) {
		// Preload new sources for snappier playback
		(['notification', 'call-join', 'call-leave', 'message-send'] as SoundEffect[]).forEach((id) =>
			getAudio(id)
		);
	}
}
