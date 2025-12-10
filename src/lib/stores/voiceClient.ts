import { writable, type Writable } from 'svelte/store';

export type VoiceClientSnapshot = {
  connected: boolean;
  muted: boolean;
  deafened: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  channelName: string | null;
  serverName: string | null;
  participantCount: number;
};

export type VoiceClientControls = {
  toggleMute?: () => void;
  toggleDeafen?: () => void;
  toggleVideo?: () => void;
  toggleScreenShare?: () => void;
  leave?: () => void;
  showCall?: () => void;
  openSettings?: () => void;
};

const defaultSnapshot: VoiceClientSnapshot = {
  connected: false,
  muted: false,
  deafened: false,
  videoEnabled: false,
  screenSharing: false,
  channelName: null,
  serverName: null,
  participantCount: 0
};

const snapshotStore: Writable<VoiceClientSnapshot> = writable(defaultSnapshot);
let controls: VoiceClientControls = {};

export const voiceClientState = {
  subscribe: snapshotStore.subscribe
};

export function updateVoiceClientState(patch: Partial<VoiceClientSnapshot>) {
  snapshotStore.update((prev) => ({ ...prev, ...patch }));
}

export function resetVoiceClientState() {
  snapshotStore.set(defaultSnapshot);
  controls = {};
}

export function setVoiceClientControls(next: VoiceClientControls) {
  controls = next;
}

export function invokeVoiceClientControl(action: keyof VoiceClientControls) {
  controls[action]?.();
}

