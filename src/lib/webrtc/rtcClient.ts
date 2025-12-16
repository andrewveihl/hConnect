/**
 * WebRTC Client Module
 * Handles peer connections, track management, ICE handling, and reconnection logic.
 * Designed for Guilded-style voice channels with mesh topology (capped at 4 video senders).
 */

import { browser } from '$app/environment';
import { writable, get, type Writable } from 'svelte/store';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ConnectionState =
	| 'idle'
	| 'connecting'
	| 'connected'
	| 'reconnecting'
	| 'failed'
	| 'closed';

export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'disconnected';

export interface RTCClientConfig {
	iceServers?: RTCIceServer[];
	enableTurnFallback?: boolean;
	maxReconnectAttempts?: number;
	reconnectDelayMs?: number;
	heartbeatIntervalMs?: number;
}

export interface TrackInfo {
	track: MediaStreamTrack;
	stream: MediaStream;
	sender?: RTCRtpSender;
	transceiver?: RTCRtpTransceiver;
}

export interface PeerState {
	peerId: string;
	connectionState: RTCPeerConnectionState;
	iceConnectionState: RTCIceConnectionState;
	stream: MediaStream | null;
	hasAudio: boolean;
	hasVideo: boolean;
}

export interface RTCClientCallbacks {
	onConnectionStateChange?: (state: ConnectionState, quality: ConnectionQuality) => void;
	onRemoteTrack?: (peerId: string, track: MediaStreamTrack, stream: MediaStream) => void;
	onRemoteTrackEnded?: (peerId: string, track: MediaStreamTrack) => void;
	onLocalTrackAdded?: (track: MediaStreamTrack) => void;
	onLocalTrackRemoved?: (track: MediaStreamTrack) => void;
	onIceCandidate?: (candidate: RTCIceCandidate) => void;
	onNegotiationNeeded?: () => void;
	onError?: (error: Error, context: string) => void;
	onReconnecting?: (attempt: number, maxAttempts: number) => void;
	onReconnected?: () => void;
	onStatsUpdate?: (stats: RTCStatsSnapshot) => void;
}

export interface RTCStatsSnapshot {
	timestamp: number;
	roundTripTime: number | null;
	packetLoss: number;
	jitter: number | null;
	bitrate: {
		audio: { inbound: number; outbound: number };
		video: { inbound: number; outbound: number };
		total: { inbound: number; outbound: number };
	};
	quality: ConnectionQuality;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_STUN_SERVERS: RTCIceServer[] = [
	{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
	{ urls: ['stun:stun2.l.google.com:19302', 'stun:stun3.l.google.com:19302'] }
];

const FALLBACK_TURN_SERVER: RTCIceServer = {
	urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'],
	username: 'openrelayproject',
	credential: 'openrelayproject'
};

const DEFAULT_CONFIG: Required<RTCClientConfig> = {
	iceServers: DEFAULT_STUN_SERVERS,
	enableTurnFallback: true,
	maxReconnectAttempts: 3,
	reconnectDelayMs: 2000,
	heartbeatIntervalMs: 10000
};

// Media constraints for high-quality voice
export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
	echoCancellation: true,
	noiseSuppression: true,
	autoGainControl: true,
	sampleRate: 48000,
	channelCount: 1
};

// Video constraints with fallback
export const VIDEO_CONSTRAINTS_720P: MediaTrackConstraints = {
	width: { ideal: 1280, max: 1280 },
	height: { ideal: 720, max: 720 },
	frameRate: { ideal: 30, max: 30 }
};

export const VIDEO_CONSTRAINTS_480P: MediaTrackConstraints = {
	width: { ideal: 854, max: 854 },
	height: { ideal: 480, max: 480 },
	frameRate: { ideal: 24, max: 30 }
};

// ─────────────────────────────────────────────────────────────────────────────
// RTCClient Class
// ─────────────────────────────────────────────────────────────────────────────

export class RTCClient {
	private pc: RTCPeerConnection | null = null;
	private config: Required<RTCClientConfig>;
	private callbacks: RTCClientCallbacks;

	// Track management
	private localAudioTrack: TrackInfo | null = null;
	private localVideoTrack: TrackInfo | null = null;
	private remoteStreams = new Map<string, MediaStream>();

	// Reconnection state
	private reconnectAttempts = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private isReconnecting = false;

	// Stats collection
	private statsInterval: ReturnType<typeof setInterval> | null = null;
	private lastStats: RTCStatsSnapshot | null = null;
	private prevBytesReceived = 0;
	private prevBytesSent = 0;
	private prevTimestamp = 0;

	// Connection state
	private _connectionState: Writable<ConnectionState> = writable('idle');
	private _connectionQuality: Writable<ConnectionQuality> = writable('disconnected');

	public connectionState = { subscribe: this._connectionState.subscribe };
	public connectionQuality = { subscribe: this._connectionQuality.subscribe };

	constructor(config: RTCClientConfig = {}, callbacks: RTCClientCallbacks = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.callbacks = callbacks;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Initialize the peer connection
	 */
	async initialize(): Promise<RTCPeerConnection> {
		if (!browser) throw new Error('RTCClient can only be used in browser');

		this.cleanup();
		this._connectionState.set('connecting');

		const iceServers = this.buildIceServers();

		this.pc = new RTCPeerConnection({
			iceServers,
			iceCandidatePoolSize: 10
		});

		this.attachEventListeners();
		this.startStatsCollection();

		return this.pc;
	}

	/**
	 * Clean up all resources
	 */
	cleanup(): void {
		this.stopStatsCollection();
		this.clearReconnectTimer();

		// Stop local tracks
		if (this.localAudioTrack?.track) {
			this.localAudioTrack.track.stop();
			this.callbacks.onLocalTrackRemoved?.(this.localAudioTrack.track);
		}
		if (this.localVideoTrack?.track) {
			this.localVideoTrack.track.stop();
			this.callbacks.onLocalTrackRemoved?.(this.localVideoTrack.track);
		}

		this.localAudioTrack = null;
		this.localVideoTrack = null;
		this.remoteStreams.clear();

		if (this.pc) {
			this.pc.onicecandidate = null;
			this.pc.ontrack = null;
			this.pc.onconnectionstatechange = null;
			this.pc.oniceconnectionstatechange = null;
			this.pc.onnegotiationneeded = null;
			this.pc.close();
			this.pc = null;
		}

		this._connectionState.set('closed');
		this._connectionQuality.set('disconnected');
		this.reconnectAttempts = 0;
		this.isReconnecting = false;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// ICE Configuration
	// ─────────────────────────────────────────────────────────────────────────

	private buildIceServers(): RTCIceServer[] {
		const servers = [...this.config.iceServers];

		if (this.config.enableTurnFallback && this.reconnectAttempts > 0) {
			servers.push(FALLBACK_TURN_SERVER);
		}

		return servers;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Event Listeners
	// ─────────────────────────────────────────────────────────────────────────

	private attachEventListeners(): void {
		if (!this.pc) return;

		this.pc.onicecandidate = (event) => {
			if (event.candidate) {
				this.callbacks.onIceCandidate?.(event.candidate);
			}
		};

		this.pc.ontrack = (event) => {
			const [stream] = event.streams;
			if (!stream) return;

			const peerId = stream.id;
			this.remoteStreams.set(peerId, stream);

			this.callbacks.onRemoteTrack?.(peerId, event.track, stream);

			event.track.onended = () => {
				this.callbacks.onRemoteTrackEnded?.(peerId, event.track);
			};
		};

		this.pc.onconnectionstatechange = () => {
			if (!this.pc) return;
			this.handleConnectionStateChange(this.pc.connectionState);
		};

		this.pc.oniceconnectionstatechange = () => {
			if (!this.pc) return;
			this.handleIceConnectionStateChange(this.pc.iceConnectionState);
		};

		this.pc.onnegotiationneeded = () => {
			this.callbacks.onNegotiationNeeded?.();
		};

		// Handle ICE failures with additional context
		this.pc.onicecandidateerror = (event) => {
			const iceEvent = event as RTCPeerConnectionIceErrorEvent;
			console.warn('[RTCClient] ICE candidate error:', {
				errorCode: iceEvent.errorCode,
				errorText: iceEvent.errorText,
				url: iceEvent.url,
				address: iceEvent.address,
				port: iceEvent.port
			});
		};
	}

	private handleConnectionStateChange(state: RTCPeerConnectionState): void {
		switch (state) {
			case 'connected':
				this._connectionState.set('connected');
				this.reconnectAttempts = 0;
				this.isReconnecting = false;
				if (this.isReconnecting) {
					this.callbacks.onReconnected?.();
				}
				this.callbacks.onConnectionStateChange?.('connected', get(this._connectionQuality));
				break;

			case 'disconnected':
			case 'failed':
				this.handleDisconnection(state);
				break;

			case 'closed':
				this._connectionState.set('closed');
				this.callbacks.onConnectionStateChange?.('closed', 'disconnected');
				break;
		}
	}

	private handleIceConnectionStateChange(state: RTCIceConnectionState): void {
		if (state === 'failed') {
			this.handleDisconnection('failed');
		} else if (state === 'disconnected') {
			// Wait briefly before treating as disconnection (may recover)
			setTimeout(() => {
				if (this.pc?.iceConnectionState === 'disconnected') {
					this.handleDisconnection('disconnected');
				}
			}, 2000);
		}
	}

	private handleDisconnection(reason: string): void {
		if (this.isReconnecting) return;

		if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
			this.attemptReconnect();
		} else {
			this._connectionState.set('failed');
			this._connectionQuality.set('disconnected');
			this.callbacks.onConnectionStateChange?.('failed', 'disconnected');
			this.callbacks.onError?.(
				new Error(`Connection failed after ${this.reconnectAttempts} attempts`),
				reason
			);
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Reconnection Logic
	// ─────────────────────────────────────────────────────────────────────────

	private attemptReconnect(): void {
		if (this.isReconnecting) return;

		this.isReconnecting = true;
		this.reconnectAttempts++;

		this._connectionState.set('reconnecting');
		this.callbacks.onReconnecting?.(this.reconnectAttempts, this.config.maxReconnectAttempts);

		this.clearReconnectTimer();
		this.reconnectTimer = setTimeout(async () => {
			try {
				// Trigger ICE restart
				if (this.pc) {
					const offer = await this.pc.createOffer({ iceRestart: true });
					await this.pc.setLocalDescription(offer);
					this.callbacks.onNegotiationNeeded?.();
				}
			} catch (err) {
				console.error('[RTCClient] Reconnection failed:', err);
				this.isReconnecting = false;
				this.handleDisconnection('reconnect-failed');
			}
		}, this.config.reconnectDelayMs * this.reconnectAttempts);
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	/**
	 * Manually trigger reconnection (e.g., from "tap to reconnect" button)
	 */
	async reconnect(): Promise<void> {
		this.reconnectAttempts = 0;
		this.isReconnecting = false;
		this.attemptReconnect();
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Media Track Management
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Acquire microphone track with best practices
	 */
	async acquireAudioTrack(deviceId?: string): Promise<MediaStreamTrack | null> {
		if (!browser) return null;

		try {
			const constraints: MediaStreamConstraints = {
				audio: {
					...AUDIO_CONSTRAINTS,
					...(deviceId ? { deviceId: { exact: deviceId } } : {})
				}
			};

			const stream = await navigator.mediaDevices.getUserMedia(constraints);
			const track = stream.getAudioTracks()[0];

			if (!track) {
				throw new Error('No audio track acquired');
			}

			// Replace existing track if any
			if (this.localAudioTrack) {
				await this.replaceTrack('audio', track);
			} else {
				await this.addTrack(track, stream, 'audio');
			}

			this.localAudioTrack = { track, stream };
			this.callbacks.onLocalTrackAdded?.(track);

			return track;
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			this.callbacks.onError?.(error, 'acquireAudioTrack');
			return null;
		}
	}

	/**
	 * Acquire camera track with 720p target, 480p fallback
	 */
	async acquireVideoTrack(deviceId?: string): Promise<MediaStreamTrack | null> {
		if (!browser) return null;

		// Try 720p first
		let track = await this.tryAcquireVideo(VIDEO_CONSTRAINTS_720P, deviceId);

		// Fallback to 480p if 720p fails
		if (!track) {
			track = await this.tryAcquireVideo(VIDEO_CONSTRAINTS_480P, deviceId);
		}

		if (!track) {
			this.callbacks.onError?.(new Error('Failed to acquire video track'), 'acquireVideoTrack');
			return null;
		}

		return track;
	}

	private async tryAcquireVideo(
		constraints: MediaTrackConstraints,
		deviceId?: string
	): Promise<MediaStreamTrack | null> {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: {
					...constraints,
					...(deviceId ? { deviceId: { exact: deviceId } } : {})
				}
			});

			const track = stream.getVideoTracks()[0];
			if (!track) return null;

			if (this.localVideoTrack) {
				await this.replaceTrack('video', track);
			} else {
				await this.addTrack(track, stream, 'video');
			}

			this.localVideoTrack = { track, stream };
			this.callbacks.onLocalTrackAdded?.(track);

			return track;
		} catch {
			return null;
		}
	}

	/**
	 * Add a track to the peer connection
	 */
	private async addTrack(
		track: MediaStreamTrack,
		stream: MediaStream,
		kind: 'audio' | 'video'
	): Promise<void> {
		if (!this.pc) return;

		const sender = this.pc.addTrack(track, stream);
		const transceiver = this.pc.getTransceivers().find((t) => t.sender === sender);

		const trackInfo = kind === 'audio' ? this.localAudioTrack : this.localVideoTrack;
		if (trackInfo) {
			trackInfo.sender = sender;
			trackInfo.transceiver = transceiver;
		}
	}

	/**
	 * Replace an existing track
	 */
	async replaceTrack(kind: 'audio' | 'video', newTrack: MediaStreamTrack): Promise<void> {
		const trackInfo = kind === 'audio' ? this.localAudioTrack : this.localVideoTrack;

		if (trackInfo?.sender) {
			await trackInfo.sender.replaceTrack(newTrack);

			// Stop old track
			if (trackInfo.track && trackInfo.track !== newTrack) {
				trackInfo.track.stop();
				this.callbacks.onLocalTrackRemoved?.(trackInfo.track);
			}

			trackInfo.track = newTrack;
		}
	}

	/**
	 * Stop and remove a local track
	 */
	stopTrack(kind: 'audio' | 'video'): void {
		const trackInfo = kind === 'audio' ? this.localAudioTrack : this.localVideoTrack;

		if (trackInfo?.track) {
			trackInfo.track.stop();
			trackInfo.sender?.replaceTrack(null).catch(() => {});
			this.callbacks.onLocalTrackRemoved?.(trackInfo.track);
		}

		if (kind === 'audio') {
			this.localAudioTrack = null;
		} else {
			this.localVideoTrack = null;
		}
	}

	/**
	 * Set track enabled state (mute/unmute without stopping)
	 */
	setTrackEnabled(kind: 'audio' | 'video', enabled: boolean): void {
		const trackInfo = kind === 'audio' ? this.localAudioTrack : this.localVideoTrack;
		if (trackInfo?.track) {
			trackInfo.track.enabled = enabled;
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Signaling Helpers
	// ─────────────────────────────────────────────────────────────────────────

	async createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit | null> {
		if (!this.pc) return null;

		try {
			const offer = await this.pc.createOffer(options);
			await this.pc.setLocalDescription(offer);
			return offer;
		} catch (err) {
			this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)), 'createOffer');
			return null;
		}
	}

	async createAnswer(): Promise<RTCSessionDescriptionInit | null> {
		if (!this.pc) return null;

		try {
			const answer = await this.pc.createAnswer();
			await this.pc.setLocalDescription(answer);
			return answer;
		} catch (err) {
			this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)), 'createAnswer');
			return null;
		}
	}

	async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<boolean> {
		if (!this.pc) return false;

		try {
			await this.pc.setRemoteDescription(new RTCSessionDescription(desc));
			return true;
		} catch (err) {
			this.callbacks.onError?.(
				err instanceof Error ? err : new Error(String(err)),
				'setRemoteDescription'
			);
			return false;
		}
	}

	async addIceCandidate(candidate: RTCIceCandidateInit): Promise<boolean> {
		if (!this.pc) return false;

		try {
			await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
			return true;
		} catch (err) {
			// Log but don't treat as fatal - ICE candidates can fail normally
			console.warn('[RTCClient] Failed to add ICE candidate:', err);
			return false;
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Stats Collection
	// ─────────────────────────────────────────────────────────────────────────

	private startStatsCollection(): void {
		if (this.statsInterval) return;

		this.statsInterval = setInterval(async () => {
			if (!this.pc || this.pc.connectionState !== 'connected') return;

			try {
				const stats = await this.collectStats();
				if (stats) {
					this.lastStats = stats;
					this.updateConnectionQuality(stats);
					this.callbacks.onStatsUpdate?.(stats);
				}
			} catch {
				// Ignore stats collection errors
			}
		}, 2000);
	}

	private stopStatsCollection(): void {
		if (this.statsInterval) {
			clearInterval(this.statsInterval);
			this.statsInterval = null;
		}
	}

	private async collectStats(): Promise<RTCStatsSnapshot | null> {
		if (!this.pc) return null;

		const report = await this.pc.getStats();
		const now = Date.now();

		let rtt: number | null = null;
		let packetLoss = 0;
		let jitter: number | null = null;
		let totalBytesReceived = 0;
		let totalBytesSent = 0;
		let audioInbound = 0;
		let audioOutbound = 0;
		let videoInbound = 0;
		let videoOutbound = 0;

		report.forEach((stat) => {
			if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
				rtt = stat.currentRoundTripTime ?? null;
			}

			if (stat.type === 'inbound-rtp') {
				const packets = stat.packetsReceived ?? 0;
				const lost = stat.packetsLost ?? 0;
				if (packets > 0) {
					packetLoss = Math.max(packetLoss, lost / (packets + lost));
				}
				jitter = stat.jitter ?? jitter;

				const bytes = stat.bytesReceived ?? 0;
				totalBytesReceived += bytes;

				if (stat.kind === 'audio') {
					audioInbound = bytes;
				} else if (stat.kind === 'video') {
					videoInbound = bytes;
				}
			}

			if (stat.type === 'outbound-rtp') {
				const bytes = stat.bytesSent ?? 0;
				totalBytesSent += bytes;

				if (stat.kind === 'audio') {
					audioOutbound = bytes;
				} else if (stat.kind === 'video') {
					videoOutbound = bytes;
				}
			}
		});

		// Calculate bitrates
		const elapsed = (now - this.prevTimestamp) / 1000;
		const totalInboundBitrate =
			elapsed > 0 ? ((totalBytesReceived - this.prevBytesReceived) * 8) / elapsed : 0;
		const totalOutboundBitrate =
			elapsed > 0 ? ((totalBytesSent - this.prevBytesSent) * 8) / elapsed : 0;

		this.prevBytesReceived = totalBytesReceived;
		this.prevBytesSent = totalBytesSent;
		this.prevTimestamp = now;

		const quality = this.calculateQuality(rtt, packetLoss, jitter);

		return {
			timestamp: now,
			roundTripTime: rtt,
			packetLoss,
			jitter,
			bitrate: {
				audio: { inbound: audioInbound, outbound: audioOutbound },
				video: { inbound: videoInbound, outbound: videoOutbound },
				total: { inbound: totalInboundBitrate, outbound: totalOutboundBitrate }
			},
			quality
		};
	}

	private calculateQuality(
		rtt: number | null,
		packetLoss: number,
		jitter: number | null
	): ConnectionQuality {
		// Quality thresholds
		if (packetLoss > 0.1) return 'poor';
		if (rtt !== null && rtt > 0.3) return 'poor';
		if (jitter !== null && jitter > 0.05) return 'poor';

		if (packetLoss > 0.03) return 'good';
		if (rtt !== null && rtt > 0.15) return 'good';
		if (jitter !== null && jitter > 0.02) return 'good';

		return 'excellent';
	}

	private updateConnectionQuality(stats: RTCStatsSnapshot): void {
		const current = get(this._connectionQuality);
		if (stats.quality !== current) {
			this._connectionQuality.set(stats.quality);
			this.callbacks.onConnectionStateChange?.(get(this._connectionState), stats.quality);
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Getters
	// ─────────────────────────────────────────────────────────────────────────

	get peerConnection(): RTCPeerConnection | null {
		return this.pc;
	}

	get localAudio(): MediaStreamTrack | null {
		return this.localAudioTrack?.track ?? null;
	}

	get localVideo(): MediaStreamTrack | null {
		return this.localVideoTrack?.track ?? null;
	}

	getRemoteStream(peerId: string): MediaStream | null {
		return this.remoteStreams.get(peerId) ?? null;
	}

	getAllRemoteStreams(): Map<string, MediaStream> {
		return new Map(this.remoteStreams);
	}

	getStats(): RTCStatsSnapshot | null {
		return this.lastStats;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Device Management Utilities
// ─────────────────────────────────────────────────────────────────────────────

export interface MediaDeviceInfo {
	deviceId: string;
	label: string;
	kind: MediaDeviceKind;
}

/**
 * Get available media devices
 */
export async function getMediaDevices(): Promise<{
	audioInputs: MediaDeviceInfo[];
	audioOutputs: MediaDeviceInfo[];
	videoInputs: MediaDeviceInfo[];
}> {
	if (!browser || !navigator.mediaDevices?.enumerateDevices) {
		return { audioInputs: [], audioOutputs: [], videoInputs: [] };
	}

	try {
		const devices = await navigator.mediaDevices.enumerateDevices();

		const audioInputs = devices
			.filter((d) => d.kind === 'audioinput')
			.map((d) => ({
				deviceId: d.deviceId,
				label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
				kind: d.kind
			}));

		const audioOutputs = devices
			.filter((d) => d.kind === 'audiooutput')
			.map((d) => ({
				deviceId: d.deviceId,
				label: d.label || `Speaker ${d.deviceId.slice(0, 8)}`,
				kind: d.kind
			}));

		const videoInputs = devices
			.filter((d) => d.kind === 'videoinput')
			.map((d) => ({
				deviceId: d.deviceId,
				label: d.label || `Camera ${d.deviceId.slice(0, 8)}`,
				kind: d.kind
			}));

		return { audioInputs, audioOutputs, videoInputs };
	} catch {
		return { audioInputs: [], audioOutputs: [], videoInputs: [] };
	}
}

/**
 * Request media permissions without keeping the stream
 */
export async function requestMediaPermissions(
	audio = true,
	video = false
): Promise<{ audio: boolean; video: boolean }> {
	if (!browser) return { audio: false, video: false };

	const result = { audio: false, video: false };

	if (audio) {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			stream.getTracks().forEach((t) => t.stop());
			result.audio = true;
		} catch {
			// Permission denied
		}
	}

	if (video) {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ video: true });
			stream.getTracks().forEach((t) => t.stop());
			result.video = true;
		} catch {
			// Permission denied
		}
	}

	return result;
}
