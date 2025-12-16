/**
 * WebRTC Voice/Video Module Exports
 *
 * Modular voice/video calling system with:
 * - rtcClient: WebRTC peer connection management
 * - audioLevel: Speaking detection with Web Audio API
 * - voicePresence: Firestore presence management
 * - voiceSounds: Sound effects and connection state management
 */

// Core RTC client
export {
	RTCClient,
	AUDIO_CONSTRAINTS,
	VIDEO_CONSTRAINTS_720P,
	VIDEO_CONSTRAINTS_480P,
	getMediaDevices,
	requestMediaPermissions,
	type MediaDeviceInfo,
	type RTCClientConfig,
	type RTCClientCallbacks,
	type ConnectionState
} from './rtcClient';

// Audio level monitoring
export {
	AudioLevelMonitor,
	SpeakingManager,
	getSharedAudioContext,
	resumeSharedAudioContext,
	type AudioLevelCallbacks
} from './audioLevel';

// Firestore presence
export {
	VoicePresenceManager,
	getVoicePresenceManager,
	resetVoicePresenceManager,
	type PresenceData
} from './voicePresence';

// Sound effects and connection states
export {
	voiceSounds,
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
	initVoiceSounds,
	DEFAULT_SOUND_CONFIG,
	type VoiceSoundConfig,
	type ConnectionStateInfo,
	type ConnectionQuality,
	type ConnectionQualityInfo
} from './voiceSounds';
