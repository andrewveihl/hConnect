/**
 * Voice Connection Sounds & State Integration
 *
 * Handles:
 * - Playing join/leave sounds at appropriate times
 * - Connection state transitions
 * - User sound preferences
 * - Reconnection UI triggers
 */

import { browser } from '$app/environment';
import { playSound } from '$lib/utils/sounds';
import { voiceStore, type VoiceConnectionState } from '$lib/stores/voiceStore';

export type ConnectionState = VoiceConnectionState['status'];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface VoiceSoundConfig {
	/** Whether to play sounds at all */
	enabled: boolean;
	/** Play sound when user joins a voice channel */
	onSelfJoin: boolean;
	/** Play sound when user leaves a voice channel */
	onSelfLeave: boolean;
	/** Play sound when another user joins */
	onOtherJoin: boolean;
	/** Play sound when another user leaves */
	onOtherLeave: boolean;
}

export const DEFAULT_SOUND_CONFIG: VoiceSoundConfig = {
	enabled: true,
	onSelfJoin: true,
	onSelfLeave: true,
	onOtherJoin: true,
	onOtherLeave: true
};

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let soundConfig: VoiceSoundConfig = { ...DEFAULT_SOUND_CONFIG };
let lastConnectionState: ConnectionState = 'idle';
let reconnectAttempts = 0;

// Load config from localStorage
if (browser) {
	try {
		const stored = localStorage.getItem('hconnect:voice:sounds');
		if (stored) {
			soundConfig = { ...DEFAULT_SOUND_CONFIG, ...JSON.parse(stored) };
		}
	} catch {
		// Use defaults
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Sound Playback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Play the join sound if enabled
 */
export function playJoinSound(): void {
	if (!browser || !soundConfig.enabled) return;
	playSound('call-join');
}

/**
 * Play the leave sound if enabled
 */
export function playLeaveSound(): void {
	if (!browser || !soundConfig.enabled) return;
	playSound('call-leave');
}

/**
 * Handle self joining a voice channel
 */
export function onSelfJoin(): void {
	if (soundConfig.onSelfJoin) {
		playJoinSound();
	}
	reconnectAttempts = 0;
}

/**
 * Handle self leaving a voice channel
 */
export function onSelfLeave(): void {
	if (soundConfig.onSelfLeave) {
		playLeaveSound();
	}
	reconnectAttempts = 0;
}

/**
 * Handle another user joining the channel
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function onParticipantJoin(_uid: string): void {
	if (soundConfig.onOtherJoin) {
		playJoinSound();
	}
}

/**
 * Handle another user leaving the channel
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function onParticipantLeave(_uid: string): void {
	if (soundConfig.onOtherLeave) {
		playLeaveSound();
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Sound Config Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update sound configuration
 */
export function setSoundConfig(config: Partial<VoiceSoundConfig>): void {
	soundConfig = { ...soundConfig, ...config };
	if (browser) {
		localStorage.setItem('hconnect:voice:sounds', JSON.stringify(soundConfig));
	}
}

/**
 * Get current sound configuration
 */
export function getSoundConfig(): VoiceSoundConfig {
	return { ...soundConfig };
}

/**
 * Toggle all sounds on/off
 */
export function toggleSounds(enabled: boolean): void {
	setSoundConfig({ enabled });
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection State Management
// ─────────────────────────────────────────────────────────────────────────────

export interface ConnectionStateInfo {
	state: ConnectionState;
	message: string;
	icon: string;
	canRetry: boolean;
	showOverlay: boolean;
}

/**
 * Get human-readable info for a connection state
 */
export function getConnectionStateInfo(state: ConnectionState): ConnectionStateInfo {
	switch (state) {
		case 'idle':
		case 'closed':
			return {
				state,
				message: 'Not connected',
				icon: 'bx-plug',
				canRetry: false,
				showOverlay: false
			};

		case 'connecting':
			return {
				state,
				message: 'Connecting...',
				icon: 'bx-loader-alt',
				canRetry: false,
				showOverlay: true
			};

		case 'connected':
			return {
				state,
				message: 'Connected',
				icon: 'bx-check-circle',
				canRetry: false,
				showOverlay: false
			};

		case 'reconnecting':
			return {
				state,
				message: `Reconnecting... (attempt ${reconnectAttempts})`,
				icon: 'bx-refresh',
				canRetry: false,
				showOverlay: true
			};

		case 'failed':
			return {
				state,
				message: reconnectAttempts >= 3 ? 'Connection failed. Tap to retry.' : 'Connection lost',
				icon: 'bx-error-circle',
				canRetry: reconnectAttempts >= 3,
				showOverlay: true
			};

		default:
			return {
				state: 'idle',
				message: 'Unknown state',
				icon: 'bx-question-mark',
				canRetry: false,
				showOverlay: false
			};
	}
}

/**
 * Handle connection state transition
 */
export function handleConnectionStateChange(
	newState: ConnectionState,
	callbacks?: {
		onConnected?: () => void;
		onDisconnected?: () => void;
		onFailed?: () => void;
		onReconnecting?: () => void;
	}
): void {
	const prevState = lastConnectionState;
	lastConnectionState = newState;

	// Track reconnect attempts
	if (newState === 'reconnecting') {
		reconnectAttempts++;
	} else if (newState === 'connected') {
		reconnectAttempts = 0;
	}

	// Update voice store using the proper action
	voiceStore.setConnectionStatus(newState);

	// Trigger callbacks
	switch (newState) {
		case 'connected':
			if (prevState !== 'connected') {
				callbacks?.onConnected?.();
			}
			break;

		case 'idle':
		case 'closed':
			callbacks?.onDisconnected?.();
			break;

		case 'failed':
			callbacks?.onFailed?.();
			break;

		case 'reconnecting':
			callbacks?.onReconnecting?.();
			break;
	}
}

/**
 * Reset reconnect counter
 */
export function resetReconnectAttempts(): void {
	reconnectAttempts = 0;
}

/**
 * Get current reconnect attempt count
 */
export function getReconnectAttempts(): number {
	return reconnectAttempts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection Quality
// ─────────────────────────────────────────────────────────────────────────────

export type ConnectionQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

export interface ConnectionQualityInfo {
	quality: ConnectionQuality;
	message: string;
	color: string;
	bars: number;
}

/**
 * Get quality info from RTT and packet loss
 */
export function getConnectionQuality(
	roundTripTime: number | null,
	packetLoss: number | null
): ConnectionQualityInfo {
	// If we don't have stats yet
	if (roundTripTime === null || packetLoss === null) {
		return {
			quality: 'unknown',
			message: 'Measuring connection...',
			color: 'text-gray-400',
			bars: 0
		};
	}

	// Excellent: RTT < 100ms, loss < 1%
	if (roundTripTime < 100 && packetLoss < 1) {
		return {
			quality: 'excellent',
			message: 'Excellent connection',
			color: 'text-emerald-400',
			bars: 4
		};
	}

	// Good: RTT < 200ms, loss < 3%
	if (roundTripTime < 200 && packetLoss < 3) {
		return {
			quality: 'good',
			message: 'Good connection',
			color: 'text-lime-400',
			bars: 3
		};
	}

	// Fair: RTT < 400ms, loss < 5%
	if (roundTripTime < 400 && packetLoss < 5) {
		return {
			quality: 'fair',
			message: 'Fair connection',
			color: 'text-amber-400',
			bars: 2
		};
	}

	// Poor: anything else
	return {
		quality: 'poor',
		message: 'Poor connection',
		color: 'text-rose-400',
		bars: 1
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice State Sync
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize voice sounds by wiring up to the voice store
 */
export function initVoiceSounds(currentUserId?: string): () => void {
	if (!browser) return () => {};

	// Track connected participants to detect joins/leaves
	let knownParticipants = new Set<string>();

	const unsubscribe = voiceStore.participants.subscribe((participants) => {
		const currentUids = new Set(Object.keys(participants));

		// Detect joins
		for (const uid of currentUids) {
			if (!knownParticipants.has(uid)) {
				// New participant - don't play sound for self
				if (!currentUserId || uid !== currentUserId) {
					onParticipantJoin(uid);
				}
			}
		}

		// Detect leaves
		for (const uid of knownParticipants) {
			if (!currentUids.has(uid)) {
				// Participant left - don't play sound for self
				if (!currentUserId || uid !== currentUserId) {
					onParticipantLeave(uid);
				}
			}
		}

		knownParticipants = currentUids;
	});

	return unsubscribe;
}

// ─────────────────────────────────────────────────────────────────────────────
// Export all for convenience
// ─────────────────────────────────────────────────────────────────────────────

export const voiceSounds = {
	playJoinSound,
	playLeaveSound,
	onSelfJoin,
	onSelfLeave,
	onParticipantJoin,
	onParticipantLeave,
	setSoundConfig,
	getSoundConfig,
	toggleSounds,
	getConnectionStateInfo,
	handleConnectionStateChange,
	resetReconnectAttempts,
	getReconnectAttempts,
	getConnectionQuality,
	initVoiceSounds
};
