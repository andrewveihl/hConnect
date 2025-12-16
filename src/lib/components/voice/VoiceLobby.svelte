<script lang="ts">
	import { run } from 'svelte/legacy';

	import { createEventDispatcher, onDestroy, untrack } from 'svelte';
	import { getDb } from '$lib/firebase';
	import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
	import { resolveProfilePhotoURL } from '$lib/utils/profile';
	import CallTile from './CallTile.svelte';

	const CALL_DOC_ID = 'live';
	const THUMBNAIL_REFRESH_INTERVAL = 2000; // How often to check for new thumbnails

	type ParticipantPreview = {
		uid: string;
		displayName: string;
		photoURL: string | null;
		status: 'active' | 'left';
		hasAudio?: boolean;
		hasVideo?: boolean;
		screenSharing?: boolean;
		streamId?: string | null;
		stream?: MediaStream | null;
		thumbnailUrl?: string | null; // Base64 thumbnail from in-call participant
		thumbnailUpdatedAt?: number;
	};

	interface Props {
		serverId?: string | null;
		channelId?: string | null;
		channelName?: string;
		serverName?: string;
		inviteUrl?: string | null;
		connectedChannelId?: string | null;
		connectedChannelName?: string | null;
		connectedServerId?: string | null;
		connectedServerName?: string | null;
		currentUserAvatar?: string | null;
		currentUserName?: string | null;
	}

	let {
		serverId = null,
		channelId = null,
		channelName = 'Voice channel',
		serverName = 'Server',
		inviteUrl = null,
		connectedChannelId = null,
		connectedChannelName = null,
		connectedServerId = null,
		connectedServerName = null,
		currentUserAvatar = null,
		currentUserName = null
	}: Props = $props();

	const dispatch = createEventDispatcher<{
		joinVoice: { muted?: boolean; videoOff?: boolean };
		joinMuted: { muted?: boolean; videoOff?: boolean };
		startStreaming: { muted?: boolean; videoOff?: boolean };
		returnToSession: void;
		openChat: void;
	}>();

	let participants: ParticipantPreview[] = $state([]);
	let unsub: Unsubscribe | null = null;
	let thumbnailUnsub: Unsubscribe | null = null;
	let muteOnJoin = $state(false);
	let videoOffOnJoin = $state(true);
	let isHovering = $state(false);
	let thumbnails: Map<string, { url: string; updatedAt: number }> = $state(new Map());

	onDestroy(() => {
		unsub?.();
		thumbnailUnsub?.();
	});

	function handleJoin() {
		dispatch('joinVoice', { muted: muteOnJoin, videoOff: videoOffOnJoin });
	}

	function handleJoinMuted() {
		dispatch('joinMuted', { muted: true, videoOff: videoOffOnJoin });
	}

	function handleReturnToSession() {
		dispatch('returnToSession');
	}

	function handleStartStreaming() {
		dispatch('startStreaming', { muted: muteOnJoin, videoOff: false });
	}

	function handleOpenChat() {
		dispatch('openChat');
	}

	function toggleMute() {
		muteOnJoin = !muteOnJoin;
	}

	function toggleVideo() {
		videoOffOnJoin = !videoOffOnJoin;
	}

	run(() => {
		untrack(() => unsub)?.();
		untrack(() => thumbnailUnsub)?.();
		participants = [];
		thumbnails = new Map();
		if (!serverId || !channelId) {
			unsub = null;
			thumbnailUnsub = null;
		} else {
			const database = getDb();
			const callDoc = doc(
				database,
				'servers',
				serverId,
				'channels',
				channelId,
				'calls',
				CALL_DOC_ID
			);
			const ref = collection(callDoc, 'participants');

			// Subscribe to participants
			unsub = onSnapshot(
				ref,
				(snap) => {
					participants = snap.docs
						.map((entry) => {
							const data = entry.data() as any;
							const uid = data.uid ?? entry.id;
							const existingThumbnail = thumbnails.get(uid);
							return {
								uid,
								displayName: data.displayName ?? 'Member',
								photoURL: resolveProfilePhotoURL(data),
								status: (data.status ?? 'active') as 'active' | 'left',
								hasAudio: data.hasAudio ?? true,
								hasVideo: data.hasVideo ?? false,
								screenSharing: data.screenSharing ?? false,
								streamId: data.streamId ?? null,
								stream: null,
								thumbnailUrl: existingThumbnail?.url ?? null,
								thumbnailUpdatedAt: existingThumbnail?.updatedAt ?? 0
							};
						})
						.filter((participant) => participant.status === 'active');
				},
				(error) => {
					console.error('[VoiceLobby] Error fetching participants:', error);
					participants = [];
				}
			);

			// Subscribe to thumbnails subcollection for live preview
			const thumbnailsRef = collection(callDoc, 'thumbnails');
			thumbnailUnsub = onSnapshot(
				thumbnailsRef,
				(snap) => {
					const newThumbnails = new Map<string, { url: string; updatedAt: number }>();
					snap.docs.forEach((entry) => {
						const data = entry.data() as any;
						if (data.imageData && data.updatedAt) {
							newThumbnails.set(entry.id, {
								url: data.imageData,
								updatedAt: data.updatedAt?.toMillis?.() ?? data.updatedAt ?? Date.now()
							});
						}
					});
					thumbnails = newThumbnails;

					// Update participants with thumbnail data
					participants = participants.map((p) => ({
						...p,
						thumbnailUrl: newThumbnails.get(p.uid)?.url ?? null,
						thumbnailUpdatedAt: newThumbnails.get(p.uid)?.updatedAt ?? 0
					}));
				},
				(error) => {
					console.warn('[VoiceLobby] Error fetching thumbnails:', error);
					// Non-critical, just won't show thumbnails
				}
			);
		}
	});

	const connectedElsewhere = $derived(
		Boolean(
			connectedChannelId &&
			(connectedChannelId !== channelId || (connectedServerId && connectedServerId !== serverId))
		)
	);

	let participantCount = $derived(participants.length);
	let displayedParticipants = $derived(participants.slice(0, 8));
	let overflowCount = $derived(Math.max(participantCount - displayedParticipants.length, 0));
	let isJoining = $state(false);

	// Reset joining state when channel changes
	$effect(() => {
		channelId;
		isJoining = false;
	});

	function handleJoinWithLoading() {
		if (isJoining) return; // Prevent double-click
		isJoining = true;
		dispatch('joinVoice', { muted: muteOnJoin, videoOff: videoOffOnJoin });
	}
</script>

<!-- Lobby preview - consistent fixed-size cards -->
<div
	class="lobby-preview"
	role="region"
	aria-label="Call preview"
	onmouseenter={() => (isHovering = true)}
	onmouseleave={() => (isHovering = false)}
>
	{#if connectedElsewhere}
		<div class="lobby-alert">
			<div class="lobby-alert__icon"><i class="bx bx-info-circle"></i></div>
			<div class="lobby-alert__content">
				<p class="lobby-alert__title">
					You're already in #{connectedChannelName ?? 'another channel'}
				</p>
				<p class="lobby-alert__desc">Returning will bring that call forward.</p>
			</div>
			<button type="button" class="lobby-alert__btn" onclick={handleReturnToSession}>
				<i class="bx bx-arrow-back"></i>
				Return
			</button>
		</div>
	{/if}

	<!-- The call grid - fixed size cards -->
	<div class="call-stage">
		<div class="call-grid" class:call-grid--single={participantCount <= 1}>
			<!-- Empty state card (uses shared CallTile for consistent styling) -->
			{#if participantCount === 0}
				<CallTile isEmpty={true} isSingle={true} />
			{/if}

			<!-- Participant cards (uses shared CallTile for consistent styling) -->
			{#each displayedParticipants as participant (participant.uid)}
				<CallTile
					displayName={participant.displayName}
					photoURL={participant.photoURL}
					hasAudio={participant.hasAudio ?? true}
					hasVideo={participant.hasVideo ?? false}
					screenSharing={participant.screenSharing ?? false}
					thumbnailUrl={participant.thumbnailUrl}
					isSingle={participantCount === 1}
				/>
			{/each}

			<!-- Overflow card -->
			{#if overflowCount > 0}
				<article class="call-tile call-tile--overflow">
					<div class="call-tile__media">
						<div class="call-tile__overflow">
							<span class="call-tile__overflow-num">+{overflowCount}</span>
							<span class="call-tile__overflow-label">more</span>
						</div>
					</div>
				</article>
			{/if}
		</div>
	</div>

	<!-- Hover overlay with join controls -->
	<div class="lobby-overlay" class:lobby-overlay--visible={isHovering || participantCount === 0}>
		<div class="lobby-overlay__content">
			<div class="lobby-overlay__header">
				<div class="lobby-overlay__channel">
					<i class="bx bx-video"></i>
					<span>{channelName || 'Voice Channel'}</span>
				</div>
				{#if participantCount > 0}
					<div class="lobby-overlay__count">
						<i class="bx bx-user"></i>
						{participantCount}
					</div>
				{/if}
			</div>

			<div class="lobby-overlay__actions">
				{#if isJoining}
					<div class="lobby-joining">
						<div class="lobby-joining__spinner"></div>
					</div>
				{:else}
					<div class="lobby-overlay__toggles">
						<button
							type="button"
							class="lobby-toggle"
							class:lobby-toggle--off={muteOnJoin}
							onclick={toggleMute}
							title={muteOnJoin ? 'Unmute on join' : 'Mute on join'}
						>
							<i class={`bx ${muteOnJoin ? 'bx-microphone-off' : 'bx-microphone'}`}></i>
						</button>
						<button
							type="button"
							class="lobby-toggle"
							class:lobby-toggle--off={videoOffOnJoin}
							onclick={toggleVideo}
							title={videoOffOnJoin ? 'Enable camera on join' : 'Disable camera on join'}
						>
							<i class={`bx ${videoOffOnJoin ? 'bx-video-off' : 'bx-video'}`}></i>
						</button>
					</div>

					<button type="button" class="lobby-join-btn" onclick={handleJoinWithLoading}>
						<i class="bx bx-phone-call"></i>
						Join Call
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	/* ========================================================================== */
	/* Discord-style Voice Lobby                                                   */
	/* ========================================================================== */

	/* Main preview container */
	.lobby-preview {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: #1e1f22;
		border-radius: 8px;
		overflow: hidden;
	}

	/* Alert banner */
	.lobby-alert {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		background: rgba(250, 168, 26, 0.1);
		border-bottom: 1px solid rgba(250, 168, 26, 0.2);
		flex-shrink: 0;
		z-index: 5;
	}

	.lobby-alert__icon {
		font-size: 18px;
		color: #faa81a;
		flex-shrink: 0;
	}

	.lobby-alert__content {
		flex: 1;
		min-width: 0;
	}

	.lobby-alert__title {
		margin: 0;
		font-weight: 600;
		color: #f2f3f5;
		font-size: 13px;
	}

	.lobby-alert__desc {
		margin: 2px 0 0;
		font-size: 12px;
		color: #b5bac1;
	}

	.lobby-alert__btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 4px;
		background: #2b2d31;
		border: none;
		color: #f2f3f5;
		font-weight: 500;
		font-size: 13px;
		cursor: pointer;
		transition: background 150ms ease;
	}

	.lobby-alert__btn:hover {
		background: #404249;
	}

	/* Stage - contains the call grid */
	.call-stage {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		overflow: auto;
	}

	/* Grid - Discord-style compact tiles */
	.call-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: center;
		align-content: center;
		max-width: 100%;
	}

	.call-grid--single {
		max-width: 800px;
	}

	/* Overflow tile - keeps local styles since it's not using CallTile */
	.call-tile--overflow {
		position: relative;
		width: 360px;
		height: 202px;
		border-radius: 8px;
		background: #2b2d31;
		overflow: hidden;
		flex-shrink: 0;
	}

	.call-tile--overflow:hover {
		background: #32353b;
	}

	.call-tile--overflow .call-tile__media {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
	}

	.call-tile__overflow {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.call-tile__overflow-num {
		font-size: 1.5rem;
		font-weight: 700;
		color: #f2f3f5;
	}

	.call-tile__overflow-label {
		font-size: 11px;
		color: #6d6f78;
	}

	/* ========================================================================== */
	/* Hover Overlay                                                               */
	/* ========================================================================== */

	.lobby-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		background: linear-gradient(
			to bottom,
			rgba(0, 0, 0, 0.8) 0%,
			rgba(0, 0, 0, 0.2) 30%,
			rgba(0, 0, 0, 0.2) 70%,
			rgba(0, 0, 0, 0.9) 100%
		);
		opacity: 0;
		pointer-events: none;
		transition: opacity 200ms ease;
		z-index: 10;
	}

	.lobby-overlay--visible {
		opacity: 1;
		pointer-events: auto;
	}

	.lobby-overlay__content {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		height: 100%;
		padding: 16px;
	}

	.lobby-overlay__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.lobby-overlay__channel {
		display: flex;
		align-items: center;
		gap: 8px;
		color: #f2f3f5;
		font-size: 14px;
		font-weight: 600;
	}

	.lobby-overlay__channel i {
		font-size: 16px;
		color: var(--color-accent);
	}

	.lobby-overlay__count {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.1);
		color: #f2f3f5;
		font-size: 12px;
		font-weight: 600;
	}

	.lobby-overlay__count i {
		font-size: 12px;
	}

	.lobby-overlay__actions {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}

	.lobby-overlay__toggles {
		display: flex;
		gap: 8px;
	}

	/* Toggle buttons - Discord circular style */
	.lobby-toggle {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		border: none;
		background: #2b2d31;
		color: #b5bac1;
		font-size: 18px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition:
			background 150ms ease,
			color 150ms ease;
	}

	.lobby-toggle:hover {
		background: #404249;
		color: #f2f3f5;
	}

	.lobby-toggle--off {
		background: #f23f43;
		color: white;
	}

	.lobby-toggle--off:hover {
		background: #d12d30;
	}

	/* Join button - Discord green */
	.lobby-join-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 24px;
		border-radius: 4px;
		border: none;
		background: #23a559;
		color: white;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: background 150ms ease;
	}

	.lobby-join-btn:hover {
		background: #1a7d41;
	}

	.lobby-join-btn i {
		font-size: 16px;
	}

	/* Joining state - simple spinner */
	.lobby-joining {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.lobby-joining__spinner {
		width: 40px;
		height: 40px;
		border: 3px solid rgba(255, 255, 255, 0.15);
		border-top-color: var(--color-accent, #33c8bf);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ========================================================================== */
	/* Mobile Responsive                                                           */
	/* ========================================================================== */

	@media (max-width: 640px) {
		.call-stage {
			padding: 12px;
		}

		.call-grid {
			gap: 6px;
		}

		.call-tile {
			width: 220px;
			height: 124px;
			border-radius: 6px;
		}

		.call-tile__avatar {
			width: 48px;
			height: 48px;
			font-size: 1.25rem;
		}

		.call-tile__name {
			font-size: 11px;
		}

		.call-tile__info-bar {
			padding: 8px 6px 4px;
		}

		.lobby-overlay__content {
			padding: 12px;
		}

		.lobby-alert {
			flex-wrap: wrap;
			gap: 8px;
		}

		.lobby-alert__btn {
			width: 100%;
			justify-content: center;
		}

		.lobby-toggle {
			width: 42px;
			height: 42px;
			font-size: 16px;
		}

		.lobby-join-btn {
			padding: 8px 20px;
			font-size: 13px;
		}
	}

	/* Scrollbar styling */
	.call-stage::-webkit-scrollbar {
		width: 4px;
	}

	.call-stage::-webkit-scrollbar-track {
		background: transparent;
	}

	.call-stage::-webkit-scrollbar-thumb {
		background: #3f4147;
		border-radius: 999px;
	}
</style>
