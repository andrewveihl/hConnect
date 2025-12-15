<script lang="ts">
  import { run } from 'svelte/legacy';

  import { createEventDispatcher, onDestroy, untrack } from 'svelte';
  import { getDb } from '$lib/firebase';
  import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
  import { resolveProfilePhotoURL } from '$lib/utils/profile';

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

  function avatarInitial(name?: string) {
    if (!name) return '?';
    const trimmed = name.trim();
    if (!trimmed.length) return '?';
    return trimmed.charAt(0).toUpperCase();
  }

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
      const callDoc = doc(database, 'servers', serverId, 'channels', channelId, 'calls', CALL_DOC_ID);
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
          participants = participants.map(p => ({
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
  onmouseenter={() => isHovering = true}
  onmouseleave={() => isHovering = false}
>
  {#if connectedElsewhere}
    <div class="lobby-alert">
      <div class="lobby-alert__icon"><i class="bx bx-info-circle"></i></div>
      <div class="lobby-alert__content">
        <p class="lobby-alert__title">You're already in #{connectedChannelName ?? 'another channel'}</p>
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
    <div class="call-grid">
      <!-- Empty state card (always shown when no participants) -->
      {#if participantCount === 0}
        <article class="call-tile call-tile--empty">
          <div class="call-tile__media">
            <div class="call-tile__empty-content">
              <div class="call-tile__empty-icon">
                <i class="bx bx-video-off"></i>
              </div>
              <span class="call-tile__empty-text">No one in call</span>
            </div>
          </div>
        </article>
      {/if}

      <!-- Participant cards -->
      {#each displayedParticipants as participant (participant.uid)}
        <article
          class="call-tile"
          class:call-tile--video-on={participant.hasVideo}
          class:call-tile--sharing={participant.screenSharing}
        >
          <div class="call-tile__media">
            <!-- Thumbnail image (shows when we have a thumbnail from the call) -->
            {#if participant.thumbnailUrl && participant.hasVideo}
              <img
                src={participant.thumbnailUrl}
                alt={`${participant.displayName}'s video`}
                class="call-tile__thumbnail"
              />
            {:else}
              <!-- Avatar fallback -->
              <div class="call-tile__avatar-container">
                <div class="call-tile__avatar" class:call-tile__avatar--video-on={participant.hasVideo}>
                  {#if participant.photoURL}
                    <img src={participant.photoURL} alt={participant.displayName} loading="lazy" />
                  {:else}
                    <span>{avatarInitial(participant.displayName)}</span>
                  {/if}
                </div>
                {#if participant.hasVideo && !participant.thumbnailUrl}
                  <div class="call-tile__video-indicator">
                    <i class="bx bx-video"></i>
                    <span>Live</span>
                  </div>
                {/if}
              </div>
            {/if}
            
            <!-- Bottom info bar -->
            <div class="call-tile__info-bar">
              <span class="call-tile__name" title={participant.displayName}>
                {participant.displayName}
              </span>
              <div class="call-tile__status-icons">
                {#if participant.screenSharing}
                  <span class="call-tile__live-badge">Screen</span>
                {/if}
                <i class={`bx ${participant.hasAudio ? 'bx-microphone' : 'bx-microphone-off call-tile__icon--muted'}`}></i>
                <i class={`bx ${participant.hasVideo ? 'bx-video' : 'bx-video-off call-tile__icon--muted'}`}></i>
              </div>
            </div>
          </div>
        </article>
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

  /* Tile - Discord 16:9 rectangular style */
  .call-tile {
    position: relative;
    width: 360px;
    height: 202px;
    border-radius: 8px;
    background: #2b2d31;
    overflow: hidden;
    flex-shrink: 0;
    transition: box-shadow 200ms ease;
  }

  .call-tile:hover {
    background: #32353b;
  }

  .call-tile--sharing {
    box-shadow: 0 0 0 2px #23a559,
                0 0 12px rgba(35, 165, 89, 0.3);
  }

  .call-tile--video-on {
    box-shadow: 0 0 0 2px #23a559;
  }

  .call-tile--video-on.call-tile--sharing {
    box-shadow: 0 0 0 2px #23a559,
                0 0 12px rgba(35, 165, 89, 0.3);
  }

  /* Empty tile - same size as regular tiles */
  .call-tile--empty {
    background: #2b2d31;
  }

  .call-tile--empty:hover {
    background: #32353b;
  }

  .call-tile__empty-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 100%;
    color: #6d6f78;
  }

  .call-tile__empty-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: #1e1f22;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
  }

  .call-tile__empty-text {
    font-size: 13px;
    font-weight: 500;
    text-align: center;
    color: #b5bac1;
  }

  /* Tile media container */
  .call-tile__media {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #2b2d31;
  }

  /* Thumbnail image */
  .call-tile__thumbnail {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    z-index: 1;
  }

  /* Avatar container */
  .call-tile__avatar-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding-bottom: 32px;
  }

  /* Avatar - Discord circular style */
  .call-tile__avatar {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    overflow: hidden;
    background: linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-strong) 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    font-weight: 600;
    color: white;
    transition: box-shadow 200ms ease;
  }

  .call-tile__avatar--video-on {
    box-shadow: 0 0 0 3px #23a559,
                0 0 12px rgba(35, 165, 89, 0.4);
  }

  .call-tile__avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Video indicator badge */
  .call-tile__video-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 4px;
    background: #23a559;
    color: white;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .call-tile__video-indicator i {
    font-size: 11px;
  }

  /* Bottom info bar */
  .call-tile__info-bar {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.4) 70%, transparent 100%);
    padding: 10px 8px 6px;
    z-index: 2;
  }

  .call-tile__name {
    font-size: 12px;
    font-weight: 500;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #f2f3f5;
    flex: 1;
    min-width: 0;
  }

  .call-tile__status-icons {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #b5bac1;
    font-size: 13px;
    flex-shrink: 0;
  }

  .call-tile__icon--muted {
    color: #f23f43;
  }

  .call-tile__live-badge {
    padding: 1px 4px;
    border-radius: 3px;
    background: #23a559;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    color: white;
  }

  /* Overflow tile */
  .call-tile--overflow .call-tile__media {
    justify-content: center;
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
    transition: background 150ms ease, color 150ms ease;
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
    to { transform: rotate(360deg); }
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
