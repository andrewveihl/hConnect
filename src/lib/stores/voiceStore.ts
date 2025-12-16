/**
 * Enhanced Voice Store
 * Comprehensive state management for voice channels with Guilded-style UX.
 * Handles participants, connection states, presence, and speaking indicators.
 */

import { browser } from '$app/environment';
import { writable, derived, get, type Readable, type Writable } from 'svelte/store';
import type { ConnectionState } from '$lib/webrtc/rtcClient';

// Connection quality type (defined here since we don't want circular imports)
export type ConnectionQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'disconnected' | 'unknown';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface VoiceParticipant {
	uid: string;
	displayName: string;
	photoURL: string | null;
	isMuted: boolean;
	isDeafened: boolean;
	videoEnabled: boolean;
	screenSharing: boolean;
	isSpeaking: boolean;
	speakingLevel: number;
	joinedAt: number;
	/** Server-side muted by moderator */
	serverMuted?: boolean;
	/** Server-side deafened by moderator */
	serverDeafened?: boolean;
}

export interface VoiceChannelState {
	serverId: string | null;
	channelId: string | null;
	channelName: string;
	serverName: string;
}

export interface VoiceConnectionState {
	status: ConnectionState;
	quality: ConnectionQuality;
	reconnectAttempt: number;
	maxReconnectAttempts: number;
	lastConnectedAt: number | null;
	error: string | null;
	/** Round trip time in milliseconds */
	rtt: number | null;
	/** Packet loss percentage (0-100) */
	packetLoss: number | null;
}

export interface VoiceLocalState {
	isMuted: boolean;
	isDeafened: boolean;
	videoEnabled: boolean;
	screenSharing: boolean;
	isSpeaking: boolean;
	speakingLevel: number;
}

export interface VoiceUIState {
	panelVisible: boolean;
	panelMinimized: boolean;
	showDevicePicker: boolean;
	showSettings: boolean;
}

export interface FullVoiceState {
	channel: VoiceChannelState;
	connection: VoiceConnectionState;
	local: VoiceLocalState;
	participants: VoiceParticipant[];
	ui: VoiceUIState;
}

// ─────────────────────────────────────────────────────────────────────────────
// Initial States
// ─────────────────────────────────────────────────────────────────────────────

const initialChannelState: VoiceChannelState = {
	serverId: null,
	channelId: null,
	channelName: '',
	serverName: ''
};

const initialConnectionState: VoiceConnectionState = {
	status: 'idle',
	quality: 'disconnected',
	reconnectAttempt: 0,
	maxReconnectAttempts: 3,
	lastConnectedAt: null,
	error: null,
	rtt: null,
	packetLoss: null
};

const initialLocalState: VoiceLocalState = {
	isMuted: true, // Start muted by default (Guilded behavior)
	isDeafened: false,
	videoEnabled: false, // Video off by default
	screenSharing: false,
	isSpeaking: false,
	speakingLevel: 0
};

const initialUIState: VoiceUIState = {
	panelVisible: false,
	panelMinimized: false,
	showDevicePicker: false,
	showSettings: false
};

// ─────────────────────────────────────────────────────────────────────────────
// Store Implementation
// ─────────────────────────────────────────────────────────────────────────────

function createVoiceStore() {
	// Core stores
	const channel: Writable<VoiceChannelState> = writable(initialChannelState);
	const connection: Writable<VoiceConnectionState> = writable(initialConnectionState);
	const local: Writable<VoiceLocalState> = writable(initialLocalState);
	const participants: Writable<VoiceParticipant[]> = writable([]);
	const ui: Writable<VoiceUIState> = writable(initialUIState);

	// Speaking state map for quick lookups
	const speakingMap: Writable<Map<string, boolean>> = writable(new Map());

	// ─────────────────────────────────────────────────────────────────────────
	// Derived Stores
	// ─────────────────────────────────────────────────────────────────────────

	/** Whether currently in a voice channel */
	const isConnected: Readable<boolean> = derived(
		connection,
		($conn) => $conn.status === 'connected'
	);

	/** Whether connecting or reconnecting */
	const isConnecting: Readable<boolean> = derived(
		connection,
		($conn) => $conn.status === 'connecting' || $conn.status === 'reconnecting'
	);

	/** Active participants (sorted by join time) */
	const activeParticipants: Readable<VoiceParticipant[]> = derived(participants, ($participants) =>
		[...$participants].filter((p) => p.joinedAt > 0).sort((a, b) => a.joinedAt - b.joinedAt)
	);

	/** Count of participants */
	const participantCount: Readable<number> = derived(
		participants,
		($participants) => $participants.length
	);

	/** Currently speaking participants */
	const speakingParticipants: Readable<VoiceParticipant[]> = derived(
		participants,
		($participants) => $participants.filter((p) => p.isSpeaking)
	);

	/** Connection status message for UI */
	const statusMessage: Readable<string> = derived(connection, ($conn) => {
		switch ($conn.status) {
			case 'idle':
				return '';
			case 'connecting':
				return 'Connecting...';
			case 'connected':
				if ($conn.quality === 'poor') {
					return 'Poor connection';
				}
				return 'Connected';
			case 'reconnecting':
				return `Reconnecting (${$conn.reconnectAttempt}/${$conn.maxReconnectAttempts})...`;
			case 'failed':
				return $conn.error || 'Connection failed. Tap to reconnect.';
			case 'closed':
				return 'Disconnected';
			default:
				return '';
		}
	});

	/** Whether to show reconnect button */
	const showReconnectButton: Readable<boolean> = derived(
		connection,
		($conn) => $conn.status === 'failed'
	);

	// ─────────────────────────────────────────────────────────────────────────
	// Channel Actions
	// ─────────────────────────────────────────────────────────────────────────

	function joinChannel(
		serverId: string,
		channelId: string,
		channelName: string,
		serverName: string = ''
	): void {
		channel.set({
			serverId,
			channelId,
			channelName,
			serverName
		});

		connection.update((c) => ({
			...c,
			status: 'connecting',
			error: null
		}));

		ui.update((u) => ({
			...u,
			panelVisible: true,
			panelMinimized: false
		}));
	}

	function leaveChannel(): void {
		channel.set(initialChannelState);
		connection.set(initialConnectionState);
		participants.set([]);
		speakingMap.set(new Map());

		// Reset local state but preserve mute preference
		local.update((l) => ({
			...initialLocalState,
			isMuted: l.isMuted // Preserve mute state
		}));

		ui.update((u) => ({
			...u,
			panelVisible: false
		}));
	}

	function switchChannel(
		serverId: string,
		channelId: string,
		channelName: string,
		serverName: string = ''
	): void {
		// Preserve local mute/deafen state when switching
		const currentLocal = get(local);

		channel.set({
			serverId,
			channelId,
			channelName,
			serverName
		});

		connection.update((c) => ({
			...c,
			status: 'connecting',
			error: null
		}));

		participants.set([]);
		speakingMap.set(new Map());

		// Keep mute/deafen state
		local.set({
			...initialLocalState,
			isMuted: currentLocal.isMuted,
			isDeafened: currentLocal.isDeafened
		});
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Connection Actions
	// ─────────────────────────────────────────────────────────────────────────

	function setConnectionStatus(status: ConnectionState): void {
		connection.update((c) => ({
			...c,
			status,
			quality: status === 'connected' ? c.quality : 'disconnected'
		}));
	}

	function setConnected(quality: ConnectionQuality = 'good'): void {
		connection.update((c) => ({
			...c,
			status: 'connected',
			quality,
			reconnectAttempt: 0,
			lastConnectedAt: Date.now(),
			error: null
		}));
	}

	function setReconnecting(attempt: number, maxAttempts: number): void {
		connection.update((c) => ({
			...c,
			status: 'reconnecting',
			reconnectAttempt: attempt,
			maxReconnectAttempts: maxAttempts
		}));
	}

	function setConnectionFailed(error: string): void {
		connection.update((c) => ({
			...c,
			status: 'failed',
			quality: 'disconnected',
			error
		}));
	}

	function setConnectionQuality(quality: ConnectionQuality): void {
		connection.update((c) => ({
			...c,
			quality
		}));
	}

	function clearError(): void {
		connection.update((c) => ({
			...c,
			error: null
		}));
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Local State Actions
	// ─────────────────────────────────────────────────────────────────────────

	function toggleMute(): boolean {
		let newState = false;
		local.update((l) => {
			newState = !l.isMuted;
			return { ...l, isMuted: newState };
		});
		return newState;
	}

	function setMuted(muted: boolean): void {
		local.update((l) => ({ ...l, isMuted: muted }));
	}

	function toggleDeafen(): boolean {
		let newState = false;
		local.update((l) => {
			newState = !l.isDeafened;
			// Deafening also mutes
			return {
				...l,
				isDeafened: newState,
				isMuted: newState ? true : l.isMuted
			};
		});
		return newState;
	}

	function setDeafened(deafened: boolean): void {
		local.update((l) => ({
			...l,
			isDeafened: deafened,
			isMuted: deafened ? true : l.isMuted
		}));
	}

	function toggleVideo(): boolean {
		let newState = false;
		local.update((l) => {
			newState = !l.videoEnabled;
			return { ...l, videoEnabled: newState };
		});
		return newState;
	}

	function setVideoEnabled(enabled: boolean): void {
		local.update((l) => ({ ...l, videoEnabled: enabled }));
	}

	function toggleScreenShare(): boolean {
		let newState = false;
		local.update((l) => {
			newState = !l.screenSharing;
			return { ...l, screenSharing: newState };
		});
		return newState;
	}

	function setScreenSharing(sharing: boolean): void {
		local.update((l) => ({ ...l, screenSharing: sharing }));
	}

	function setLocalSpeaking(speaking: boolean, level: number = 0): void {
		local.update((l) => ({
			...l,
			isSpeaking: speaking,
			speakingLevel: level
		}));
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Participant Actions
	// ─────────────────────────────────────────────────────────────────────────

	function addParticipant(participant: VoiceParticipant): void {
		participants.update((list) => {
			const existing = list.findIndex((p) => p.uid === participant.uid);
			if (existing >= 0) {
				// Update existing
				const updated = [...list];
				updated[existing] = participant;
				return updated;
			}
			return [...list, participant];
		});
	}

	function removeParticipant(uid: string): void {
		participants.update((list) => list.filter((p) => p.uid !== uid));
		speakingMap.update((map) => {
			map.delete(uid);
			return map;
		});
	}

	function updateParticipant(uid: string, updates: Partial<VoiceParticipant>): void {
		participants.update((list) => {
			const index = list.findIndex((p) => p.uid === uid);
			if (index < 0) return list;

			const updated = [...list];
			updated[index] = { ...updated[index], ...updates };
			return updated;
		});
	}

	function setParticipants(newParticipants: VoiceParticipant[]): void {
		participants.set(newParticipants);

		// Update speaking map
		const newSpeakingMap = new Map<string, boolean>();
		newParticipants.forEach((p) => {
			if (p.isSpeaking) {
				newSpeakingMap.set(p.uid, true);
			}
		});
		speakingMap.set(newSpeakingMap);
	}

	function setParticipantSpeaking(uid: string, speaking: boolean, level: number = 0): void {
		participants.update((list) => {
			const index = list.findIndex((p) => p.uid === uid);
			if (index < 0) return list;

			const updated = [...list];
			updated[index] = {
				...updated[index],
				isSpeaking: speaking,
				speakingLevel: level
			};
			return updated;
		});

		speakingMap.update((map) => {
			if (speaking) {
				map.set(uid, true);
			} else {
				map.delete(uid);
			}
			return map;
		});
	}

	/** Check if a participant is speaking (fast lookup) */
	function isParticipantSpeaking(uid: string): boolean {
		return get(speakingMap).has(uid);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// UI Actions
	// ─────────────────────────────────────────────────────────────────────────

	function setPanelVisible(visible: boolean): void {
		ui.update((u) => ({ ...u, panelVisible: visible }));
	}

	function togglePanel(): boolean {
		let newState = false;
		ui.update((u) => {
			newState = !u.panelVisible;
			return { ...u, panelVisible: newState };
		});
		return newState;
	}

	function setPanelMinimized(minimized: boolean): void {
		ui.update((u) => ({ ...u, panelMinimized: minimized }));
	}

	function toggleMinimize(): boolean {
		let newState = false;
		ui.update((u) => {
			newState = !u.panelMinimized;
			return { ...u, panelMinimized: newState };
		});
		return newState;
	}

	function showDevicePicker(): void {
		ui.update((u) => ({ ...u, showDevicePicker: true }));
	}

	function hideDevicePicker(): void {
		ui.update((u) => ({ ...u, showDevicePicker: false }));
	}

	function showSettings(): void {
		ui.update((u) => ({ ...u, showSettings: true }));
	}

	function hideSettings(): void {
		ui.update((u) => ({ ...u, showSettings: false }));
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Snapshot & Reset
	// ─────────────────────────────────────────────────────────────────────────

	function getSnapshot(): FullVoiceState {
		return {
			channel: get(channel),
			connection: get(connection),
			local: get(local),
			participants: get(participants),
			ui: get(ui)
		};
	}

	function reset(): void {
		channel.set(initialChannelState);
		connection.set(initialConnectionState);
		local.set(initialLocalState);
		participants.set([]);
		ui.set(initialUIState);
		speakingMap.set(new Map());
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Return Store API
	// ─────────────────────────────────────────────────────────────────────────

	return {
		// Core stores (readable)
		channel: { subscribe: channel.subscribe },
		connection: { subscribe: connection.subscribe },
		local: { subscribe: local.subscribe },
		participants: { subscribe: participants.subscribe },
		ui: { subscribe: ui.subscribe },

		// Derived stores
		isConnected,
		isConnecting,
		activeParticipants,
		participantCount,
		speakingParticipants,
		statusMessage,
		showReconnectButton,

		// Channel actions
		joinChannel,
		leaveChannel,
		switchChannel,

		// Connection actions
		setConnectionStatus,
		setConnected,
		setReconnecting,
		setConnectionFailed,
		setConnectionQuality,
		clearError,

		// Local state actions
		toggleMute,
		setMuted,
		toggleDeafen,
		setDeafened,
		toggleVideo,
		setVideoEnabled,
		toggleScreenShare,
		setScreenSharing,
		setLocalSpeaking,

		// Participant actions
		addParticipant,
		removeParticipant,
		updateParticipant,
		setParticipants,
		setParticipantSpeaking,
		isParticipantSpeaking,

		// UI actions
		setPanelVisible,
		togglePanel,
		setPanelMinimized,
		toggleMinimize,
		showDevicePicker,
		hideDevicePicker,
		showSettings,
		hideSettings,

		// Utilities
		getSnapshot,
		reset
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Export Singleton Store
// ─────────────────────────────────────────────────────────────────────────────

export const voiceStore = createVoiceStore();

// ─────────────────────────────────────────────────────────────────────────────
// Persistence Helpers
// ─────────────────────────────────────────────────────────────────────────────

const VOICE_PREFS_KEY = 'hconnect:voice:local-prefs';

interface VoiceLocalPrefs {
	defaultMuted: boolean;
	defaultVideoOff: boolean;
	joinSoundsEnabled: boolean;
	speakingIndicatorSensitivity: 'low' | 'medium' | 'high';
}

const defaultVoiceLocalPrefs: VoiceLocalPrefs = {
	defaultMuted: true,
	defaultVideoOff: true,
	joinSoundsEnabled: true,
	speakingIndicatorSensitivity: 'medium'
};

export function loadVoiceLocalPrefs(): VoiceLocalPrefs {
	if (!browser) return defaultVoiceLocalPrefs;

	try {
		const stored = localStorage.getItem(VOICE_PREFS_KEY);
		if (!stored) return defaultVoiceLocalPrefs;
		return { ...defaultVoiceLocalPrefs, ...JSON.parse(stored) };
	} catch {
		return defaultVoiceLocalPrefs;
	}
}

export function saveVoiceLocalPrefs(prefs: Partial<VoiceLocalPrefs>): void {
	if (!browser) return;

	try {
		const current = loadVoiceLocalPrefs();
		const updated = { ...current, ...prefs };
		localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(updated));
	} catch {
		// Ignore storage errors
	}
}
