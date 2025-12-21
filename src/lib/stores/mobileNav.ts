import { browser } from '$app/environment';
import { pushState } from '$app/navigation';
import { writable } from 'svelte/store';

export type MobileOverlayId =
	| 'server-rail'
	| 'channel-list'
	| 'members-pane'
	| 'dm-list'
	| 'dm-info'
	| 'thread-pane';

type OverlayEntry = {
	id: MobileOverlayId;
	entryId: string;
};

// We stash a tiny marker on each history entry so native back gestures can close in-app drawers first.
const STATE_KEY = 'hconnect:overlayEntry';
const stackStore = writable<OverlayEntry[]>([]);
let stackSnapshot: OverlayEntry[] = [];
stackStore.subscribe((value) => {
	stackSnapshot = value;
});

const overlayListeners = new Map<MobileOverlayId, () => void>();
const entryDirectory = new Map<string, MobileOverlayId>();
let initialized = false;
let popHandler: ((event: PopStateEvent) => void) | null = null;

const fallbackId = (id: MobileOverlayId) => `${id}-${Date.now()}-${Math.random()}`;

function ensureInit() {
	if (!browser || initialized) return;
	initialized = true;
	popHandler = (event: PopStateEvent) => {
		const entryId = event.state?.[STATE_KEY];
		if (entryId && entryDirectory.has(entryId)) {
			const overlayId = entryDirectory.get(entryId)!;
			entryDirectory.delete(entryId);
			stackStore.update((stack) => stack.slice(0, -1));
			overlayListeners.get(overlayId)?.();
			return;
		}

		if (stackSnapshot.length > 0) {
			const openIds = stackSnapshot.map((entry) => entry.id);
			entryDirectory.clear();
			stackStore.set([]);
			openIds.reverse().forEach((overlayId) => overlayListeners.get(overlayId)?.());
		}
	};
	window.addEventListener('popstate', popHandler);
}

export function initMobileNavigation() {
	ensureInit();
	return () => {
		if (!browser || !popHandler) return;
		window.removeEventListener('popstate', popHandler);
		popHandler = null;
		initialized = false;
	};
}

export function registerOverlayHandler(id: MobileOverlayId, handler: () => void) {
	overlayListeners.set(id, handler);
	return () => {
		const current = overlayListeners.get(id);
		if (current === handler) {
			overlayListeners.delete(id);
		}
	};
}

export function isOverlayActive(id: MobileOverlayId) {
	return stackSnapshot.some((entry) => entry.id === id);
}

export function openOverlay(id: MobileOverlayId) {
	if (!browser) return;
	ensureInit();
	if (isOverlayActive(id)) return;
	const entryId =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : fallbackId(id);
	entryDirectory.set(entryId, id);
	const nextState = { ...(window.history.state ?? {}), [STATE_KEY]: entryId };
	pushState(window.location.href, nextState);
	stackStore.update((stack) => [...stack, { id, entryId }]);
}

export function closeOverlay(id: MobileOverlayId) {
	if (!browser) return;
	ensureInit();
	if (!isOverlayActive(id)) return;
	const top = stackSnapshot[stackSnapshot.length - 1];
	if (!top || top.id !== id) {
		stackStore.update((stack) => stack.filter((entry) => entry.id !== id));
		return;
	}
	const currentEntryId = window.history.state?.[STATE_KEY] ?? null;
	if (currentEntryId !== top.entryId) {
		// The overlay entry was replaced (e.g. via replaceState); just drop our stack entry to avoid popping real pages.
		entryDirectory.delete(top.entryId);
		stackStore.update((stack) => stack.filter((entry) => entry.entryId !== top.entryId));
		return;
	}
	window.history.back();
}

export function clearAllOverlays({ notify = true }: { notify?: boolean } = {}) {
	if (!browser) return;
	ensureInit();
	if (!stackSnapshot.length) return;
	const ids = notify ? stackSnapshot.map((entry) => entry.id) : [];
	entryDirectory.clear();
	stackStore.set([]);
	if (notify) {
		ids.reverse().forEach((id) => overlayListeners.get(id)?.());
	}
}

export const mobileOverlayStack = {
	subscribe: stackStore.subscribe
};

// Swipe progress for smooth dock animation (0 = closed, 1 = fully open)
const swipeProgressStore = writable<{ target: 'channels' | 'members' | null; progress: number }>({
	target: null,
	progress: 0
});

export const mobileSwipeProgress = {
	subscribe: swipeProgressStore.subscribe,
	set: (target: 'channels' | 'members' | null, progress: number) => {
		swipeProgressStore.set({ target, progress });
	},
	reset: () => {
		swipeProgressStore.set({ target: null, progress: 0 });
	}
};

// Track overlay state on document for CSS targeting
if (browser) {
	stackStore.subscribe((stack) => {
		if (stack.length > 0) {
			document.documentElement.classList.add('mobile-overlay-active');
		} else {
			document.documentElement.classList.remove('mobile-overlay-active');
		}
	});
}
