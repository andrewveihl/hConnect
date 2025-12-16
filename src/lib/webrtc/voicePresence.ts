/**
 * Voice Presence Module
 * Manages participant presence in Firestore for voice channels.
 * Implements heartbeat mechanism with stale cleanup.
 *
 * Firestore structure:
 * voiceChannels/{channelId}/participants/{uid}
 *   - uid: string
 *   - displayName: string
 *   - photoURL: string | null
 *   - muted: boolean
 *   - deafened: boolean
 *   - videoEnabled: boolean
 *   - screenSharing: boolean
 *   - speaking: boolean (rate-limited)
 *   - joinedAt: Timestamp
 *   - lastHeartbeat: Timestamp
 *   - status: 'active' | 'left'
 */

import { browser } from '$app/environment';
import { getDb } from '$lib/firebase';
import {
	collection,
	doc,
	setDoc,
	updateDoc,
	deleteDoc,
	onSnapshot,
	serverTimestamp,
	query,
	where,
	getDocs,
	writeBatch,
	type Unsubscribe,
	type DocumentReference,
	Timestamp
} from 'firebase/firestore';
import type { VoiceParticipant } from '$lib/stores/voiceStore';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PresenceData {
	uid: string;
	displayName: string;
	photoURL: string | null;
	muted: boolean;
	deafened: boolean;
	videoEnabled: boolean;
	screenSharing: boolean;
	speaking: boolean;
	joinedAt: ReturnType<typeof serverTimestamp> | Timestamp;
	lastHeartbeat: ReturnType<typeof serverTimestamp> | Timestamp;
	status: 'active' | 'left';
}

export interface PresenceCallbacks {
	onParticipantJoined?: (participant: VoiceParticipant) => void;
	onParticipantLeft?: (uid: string) => void;
	onParticipantUpdated?: (participant: VoiceParticipant) => void;
	onParticipantsChanged?: (participants: VoiceParticipant[]) => void;
	onError?: (error: Error, context: string) => void;
}

export interface PresenceManagerConfig {
	/** Heartbeat interval in ms. Default: 10000 (10 seconds) */
	heartbeatIntervalMs: number;
	/** Time before considering a participant stale in ms. Default: 30000 (30 seconds) */
	staleThresholdMs: number;
	/** Rate limit for speaking state updates in ms. Default: 200 (5 updates/second) */
	speakingUpdateRateLimitMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: PresenceManagerConfig = {
	heartbeatIntervalMs: 10000,
	staleThresholdMs: 30000,
	speakingUpdateRateLimitMs: 200
};

// ─────────────────────────────────────────────────────────────────────────────
// PresenceManager Class
// ─────────────────────────────────────────────────────────────────────────────

export class VoicePresenceManager {
	private config: PresenceManagerConfig;
	private callbacks: PresenceCallbacks;

	// Current channel
	private serverId: string | null = null;
	private channelId: string | null = null;
	private uid: string | null = null;

	// Firestore references
	private participantDocRef: DocumentReference | null = null;
	private participantsUnsub: Unsubscribe | null = null;

	// Heartbeat
	private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
	private staleCleanupInterval: ReturnType<typeof setInterval> | null = null;

	// Speaking rate limiter
	private lastSpeakingUpdate = 0;
	private pendingSpeakingUpdate: boolean | null = null;
	private speakingUpdateTimer: ReturnType<typeof setTimeout> | null = null;

	// Local cache of participants
	private participants = new Map<string, VoiceParticipant>();

	// onDisconnect cleanup (for browser close/crash)
	private cleanupRegistered = false;

	constructor(config: Partial<PresenceManagerConfig> = {}, callbacks: PresenceCallbacks = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.callbacks = callbacks;

		if (browser) {
			this.registerBrowserCleanup();
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Join a voice channel and start presence tracking
	 */
	async join(
		serverId: string,
		channelId: string,
		uid: string,
		profile: { displayName: string; photoURL: string | null },
		initialState: { muted: boolean; deafened: boolean; videoEnabled: boolean }
	): Promise<boolean> {
		if (!browser) return false;

		// Leave current channel if different
		if (this.channelId && (this.channelId !== channelId || this.serverId !== serverId)) {
			await this.leave();
		}

		this.serverId = serverId;
		this.channelId = channelId;
		this.uid = uid;

		try {
			const db = getDb();
			const participantsPath = `servers/${serverId}/channels/${channelId}/calls/live/participants`;
			const participantsRef = collection(db, participantsPath);

			this.participantDocRef = doc(participantsRef, uid);

			// Write initial presence
			const presenceData: PresenceData = {
				uid,
				displayName: profile.displayName,
				photoURL: profile.photoURL,
				muted: initialState.muted,
				deafened: initialState.deafened,
				videoEnabled: initialState.videoEnabled,
				screenSharing: false,
				speaking: false,
				joinedAt: serverTimestamp(),
				lastHeartbeat: serverTimestamp(),
				status: 'active'
			};

			await setDoc(this.participantDocRef, presenceData);

			// Subscribe to participant changes
			this.subscribeToParticipants(participantsRef);

			// Start heartbeat
			this.startHeartbeat();

			// Start stale cleanup
			this.startStaleCleanup();

			return true;
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			this.callbacks.onError?.(error, 'join');
			return false;
		}
	}

	/**
	 * Leave the current voice channel
	 */
	async leave(): Promise<void> {
		// Stop intervals
		this.stopHeartbeat();
		this.stopStaleCleanup();

		// Unsubscribe from participants
		this.participantsUnsub?.();
		this.participantsUnsub = null;

		// Clear speaking update timer
		if (this.speakingUpdateTimer) {
			clearTimeout(this.speakingUpdateTimer);
			this.speakingUpdateTimer = null;
		}

		// Mark as left in Firestore
		if (this.participantDocRef) {
			try {
				await deleteDoc(this.participantDocRef);
			} catch {
				// Try to mark as left instead if delete fails
				try {
					await updateDoc(this.participantDocRef, {
						status: 'left',
						lastHeartbeat: serverTimestamp()
					});
				} catch {
					// Ignore cleanup errors
				}
			}
		}

		// Clear local state
		this.serverId = null;
		this.channelId = null;
		this.uid = null;
		this.participantDocRef = null;
		this.participants.clear();
	}

	/**
	 * Clean up all resources
	 */
	cleanup(): void {
		this.leave();
		this.unregisterBrowserCleanup();
	}

	// ─────────────────────────────────────────────────────────────────────────
	// State Updates
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Update mute state
	 */
	async setMuted(muted: boolean): Promise<void> {
		if (!this.participantDocRef) return;

		try {
			await updateDoc(this.participantDocRef, {
				muted,
				lastHeartbeat: serverTimestamp()
			});
		} catch (err) {
			this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)), 'setMuted');
		}
	}

	/**
	 * Update deafen state
	 */
	async setDeafened(deafened: boolean): Promise<void> {
		if (!this.participantDocRef) return;

		try {
			await updateDoc(this.participantDocRef, {
				deafened,
				// Deafen also mutes
				muted: deafened ? true : undefined,
				lastHeartbeat: serverTimestamp()
			});
		} catch (err) {
			this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)), 'setDeafened');
		}
	}

	/**
	 * Update video state
	 */
	async setVideoEnabled(enabled: boolean): Promise<void> {
		if (!this.participantDocRef) return;

		try {
			await updateDoc(this.participantDocRef, {
				videoEnabled: enabled,
				lastHeartbeat: serverTimestamp()
			});
		} catch (err) {
			this.callbacks.onError?.(
				err instanceof Error ? err : new Error(String(err)),
				'setVideoEnabled'
			);
		}
	}

	/**
	 * Update screen sharing state
	 */
	async setScreenSharing(sharing: boolean): Promise<void> {
		if (!this.participantDocRef) return;

		try {
			await updateDoc(this.participantDocRef, {
				screenSharing: sharing,
				lastHeartbeat: serverTimestamp()
			});
		} catch (err) {
			this.callbacks.onError?.(
				err instanceof Error ? err : new Error(String(err)),
				'setScreenSharing'
			);
		}
	}

	/**
	 * Update speaking state (rate-limited)
	 */
	setSpeaking(speaking: boolean): void {
		if (!this.participantDocRef) return;

		const now = Date.now();
		const timeSinceLastUpdate = now - this.lastSpeakingUpdate;

		if (timeSinceLastUpdate >= this.config.speakingUpdateRateLimitMs) {
			// Update immediately
			this.doSpeakingUpdate(speaking);
		} else {
			// Queue for later
			this.pendingSpeakingUpdate = speaking;

			if (!this.speakingUpdateTimer) {
				const delay = this.config.speakingUpdateRateLimitMs - timeSinceLastUpdate;
				this.speakingUpdateTimer = setTimeout(() => {
					this.speakingUpdateTimer = null;
					if (this.pendingSpeakingUpdate !== null) {
						this.doSpeakingUpdate(this.pendingSpeakingUpdate);
						this.pendingSpeakingUpdate = null;
					}
				}, delay);
			}
		}
	}

	private async doSpeakingUpdate(speaking: boolean): Promise<void> {
		if (!this.participantDocRef) return;

		this.lastSpeakingUpdate = Date.now();

		try {
			await updateDoc(this.participantDocRef, { speaking });
		} catch {
			// Ignore speaking update errors (non-critical)
		}
	}

	/**
	 * Update multiple states at once
	 */
	async updateState(
		updates: Partial<{
			muted: boolean;
			deafened: boolean;
			videoEnabled: boolean;
			screenSharing: boolean;
		}>
	): Promise<void> {
		if (!this.participantDocRef) return;

		try {
			await updateDoc(this.participantDocRef, {
				...updates,
				lastHeartbeat: serverTimestamp()
			});
		} catch (err) {
			this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)), 'updateState');
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Participants Subscription
	// ─────────────────────────────────────────────────────────────────────────

	private subscribeToParticipants(collectionRef: ReturnType<typeof collection>): void {
		this.participantsUnsub?.();

		this.participantsUnsub = onSnapshot(
			collectionRef,
			(snapshot) => {
				const changes = snapshot.docChanges();
				const currentParticipants = new Map(this.participants);

				for (const change of changes) {
					const data = change.doc.data() as PresenceData;

					// Skip non-active participants
					if (data.status !== 'active') {
						if (change.type === 'modified' || change.type === 'removed') {
							currentParticipants.delete(data.uid);
							this.callbacks.onParticipantLeft?.(data.uid);
						}
						continue;
					}

					const participant = this.presenceToParticipant(data);

					if (change.type === 'added') {
						currentParticipants.set(data.uid, participant);
						this.callbacks.onParticipantJoined?.(participant);
					} else if (change.type === 'modified') {
						currentParticipants.set(data.uid, participant);
						this.callbacks.onParticipantUpdated?.(participant);
					} else if (change.type === 'removed') {
						currentParticipants.delete(data.uid);
						this.callbacks.onParticipantLeft?.(data.uid);
					}
				}

				this.participants = currentParticipants;
				this.callbacks.onParticipantsChanged?.(Array.from(currentParticipants.values()));
			},
			(err) => {
				this.callbacks.onError?.(
					err instanceof Error ? err : new Error(String(err)),
					'participantsSubscription'
				);
			}
		);
	}

	private presenceToParticipant(data: PresenceData): VoiceParticipant {
		const joinedAt = data.joinedAt instanceof Timestamp ? data.joinedAt.toMillis() : Date.now();

		return {
			uid: data.uid,
			displayName: data.displayName || 'Member',
			photoURL: data.photoURL,
			isMuted: data.muted,
			isDeafened: data.deafened,
			videoEnabled: data.videoEnabled,
			screenSharing: data.screenSharing,
			isSpeaking: data.speaking,
			speakingLevel: 0,
			joinedAt
		};
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Heartbeat
	// ─────────────────────────────────────────────────────────────────────────

	private startHeartbeat(): void {
		this.stopHeartbeat();

		this.heartbeatInterval = setInterval(async () => {
			if (!this.participantDocRef) return;

			try {
				await updateDoc(this.participantDocRef, {
					lastHeartbeat: serverTimestamp()
				});
			} catch {
				// Ignore heartbeat errors
			}
		}, this.config.heartbeatIntervalMs);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Stale Cleanup
	// ─────────────────────────────────────────────────────────────────────────

	private startStaleCleanup(): void {
		this.stopStaleCleanup();

		// Run cleanup every 15 seconds
		this.staleCleanupInterval = setInterval(() => {
			this.cleanupStaleParticipants();
		}, 15000);
	}

	private stopStaleCleanup(): void {
		if (this.staleCleanupInterval) {
			clearInterval(this.staleCleanupInterval);
			this.staleCleanupInterval = null;
		}
	}

	private async cleanupStaleParticipants(): Promise<void> {
		if (!this.serverId || !this.channelId) return;

		const db = getDb();
		const participantsPath = `servers/${this.serverId}/channels/${this.channelId}/calls/live/participants`;
		const participantsRef = collection(db, participantsPath);

		const cutoffTime = Timestamp.fromMillis(Date.now() - this.config.staleThresholdMs);

		try {
			const staleQuery = query(
				participantsRef,
				where('status', '==', 'active'),
				where('lastHeartbeat', '<', cutoffTime)
			);

			const staleSnapshot = await getDocs(staleQuery);

			if (staleSnapshot.empty) return;

			const batch = writeBatch(db);

			staleSnapshot.docs.forEach((doc) => {
				// Don't delete self
				if (doc.id !== this.uid) {
					batch.update(doc.ref, { status: 'left' });
				}
			});

			await batch.commit();
		} catch {
			// Ignore cleanup errors
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Browser Cleanup (onbeforeunload)
	// ─────────────────────────────────────────────────────────────────────────

	private registerBrowserCleanup(): void {
		if (!browser || this.cleanupRegistered) return;

		const handleUnload = () => {
			// Synchronous cleanup - just mark as left
			if (this.participantDocRef) {
				// Note: sendBeacon doesn't work with Firestore directly
				// We rely on stale cleanup for crashed browsers
				// The presence doc will be cleaned up by the stale participant check
			}
		};

		window.addEventListener('beforeunload', handleUnload);
		window.addEventListener('pagehide', handleUnload);
		window.addEventListener('unload', handleUnload);

		this.cleanupRegistered = true;
	}

	private unregisterBrowserCleanup(): void {
		// Cleanup is handled by garbage collection
		this.cleanupRegistered = false;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Getters
	// ─────────────────────────────────────────────────────────────────────────

	getParticipants(): VoiceParticipant[] {
		return Array.from(this.participants.values());
	}

	getParticipant(uid: string): VoiceParticipant | null {
		return this.participants.get(uid) ?? null;
	}

	isInChannel(): boolean {
		return this.channelId !== null;
	}

	getCurrentChannel(): { serverId: string; channelId: string } | null {
		if (!this.serverId || !this.channelId) return null;
		return { serverId: this.serverId, channelId: this.channelId };
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────────────────────

let presenceManagerInstance: VoicePresenceManager | null = null;

export function getVoicePresenceManager(
	config?: Partial<PresenceManagerConfig>,
	callbacks?: PresenceCallbacks
): VoicePresenceManager {
	if (!presenceManagerInstance) {
		presenceManagerInstance = new VoicePresenceManager(config, callbacks);
	}
	return presenceManagerInstance;
}

export function resetVoicePresenceManager(): void {
	if (presenceManagerInstance) {
		presenceManagerInstance.cleanup();
		presenceManagerInstance = null;
	}
}
