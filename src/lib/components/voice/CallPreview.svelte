<script lang="ts">
  /**
   * CallPreview - Shows a live preview of an active call
   * 
   * Displays the same grid view that participants in the call see.
   * - If people are in the call, shows their video cards exactly as they'd appear
   * - If no one is in the call, shows a single centered "No one in call" card
   * - On hover, shows only a Join button (no other controls)
   */
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { run } from 'svelte/legacy';
  import { untrack } from 'svelte';
  import { getDb } from '$lib/firebase';
  import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
  import { resolveProfilePhotoURL } from '$lib/utils/profile';

  const CALL_DOC_ID = 'live';

  type Participant = {
    uid: string;
    displayName: string;
    photoURL: string | null;
    hasAudio: boolean;
    hasVideo: boolean;
    screenSharing: boolean;
    isSpeaking: boolean;
    thumbnailUrl: string | null;
  };

  interface Props {
    serverId?: string | null;
    channelId?: string | null;
    channelName?: string;
    /** If user is connected to another voice channel */
    connectedElsewhere?: boolean;
    connectedChannelName?: string | null;
  }

  let {
    serverId = null,
    channelId = null,
    channelName = 'Voice Channel',
    connectedElsewhere = false,
    connectedChannelName = null
  }: Props = $props();

  const dispatch = createEventDispatcher<{
    join: void;
    returnToSession: void;
  }>();

  // ─────────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────────

  let participants: Participant[] = $state([]);
  let thumbnails = $state(new Map<string, string>());
  let isHovering = $state(false);
  let isJoining = $state(false);

  let unsub: Unsubscribe | null = null;
  let thumbnailUnsub: Unsubscribe | null = null;

  onDestroy(() => {
    unsub?.();
    thumbnailUnsub?.();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Data Fetching
  // ─────────────────────────────────────────────────────────────────────────

  run(() => {
    untrack(() => unsub)?.();
    untrack(() => thumbnailUnsub)?.();
    participants = [];
    thumbnails = new Map();

    if (!serverId || !channelId) {
      unsub = null;
      thumbnailUnsub = null;
      return;
    }

    const db = getDb();
    const callDoc = doc(db, 'servers', serverId, 'channels', channelId, 'calls', CALL_DOC_ID);
    const participantsRef = collection(callDoc, 'participants');
    const thumbnailsRef = collection(callDoc, 'thumbnails');

    // Subscribe to participants
    unsub = onSnapshot(
      participantsRef,
      (snap) => {
        participants = snap.docs
          .map((entry) => {
            const data = entry.data() as Record<string, unknown>;
            const uid = (data.uid as string) ?? entry.id;
            return {
              uid,
              displayName: (data.displayName as string) ?? 'Member',
              photoURL: resolveProfilePhotoURL(data),
              hasAudio: (data.hasAudio as boolean) ?? true,
              hasVideo: (data.hasVideo as boolean) ?? false,
              screenSharing: (data.screenSharing as boolean) ?? false,
              isSpeaking: (data.isSpeaking as boolean) ?? false,
              thumbnailUrl: thumbnails.get(uid) ?? null
            };
          })
          .filter((p) => (p as Record<string, unknown>).status !== 'left');
      },
      (err) => {
        console.error('[CallPreview] Error fetching participants:', err);
        participants = [];
      }
    );

    // Subscribe to thumbnails for live video preview
    thumbnailUnsub = onSnapshot(
      thumbnailsRef,
      (snap) => {
        const newThumbnails = new Map<string, string>();
        snap.docs.forEach((entry) => {
          const data = entry.data() as Record<string, unknown>;
          if (data.imageData) {
            newThumbnails.set(entry.id, data.imageData as string);
          }
        });
        thumbnails = newThumbnails;

        // Update participants with new thumbnails
        participants = participants.map((p) => ({
          ...p,
          thumbnailUrl: newThumbnails.get(p.uid) ?? null
        }));
      },
      (err) => {
        console.warn('[CallPreview] Error fetching thumbnails:', err);
      }
    );
  });

  // Reset joining state when channel changes
  $effect(() => {
    channelId;
    isJoining = false;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────

  function handleJoin() {
    if (isJoining) return;
    isJoining = true;
    dispatch('join');
  }

  function handleReturn() {
    dispatch('returnToSession');
  }

  function getInitial(name: string): string {
    return name?.trim().charAt(0).toUpperCase() || '?';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────────────────────

  const hasParticipants = $derived(participants.length > 0);
</script>

<div
  class="call-preview"
  role="region"
  aria-label="Call preview for {channelName}"
  onmouseenter={() => (isHovering = true)}
  onmouseleave={() => (isHovering = false)}
>
  <!-- Connected elsewhere alert -->
  {#if connectedElsewhere}
    <div class="preview-alert">
      <i class="bx bx-info-circle"></i>
      <span>You're in #{connectedChannelName ?? 'another channel'}</span>
      <button type="button" class="preview-alert__btn" onclick={handleReturn}>
        <i class="bx bx-arrow-back"></i>
        Return
      </button>
    </div>
  {/if}

  <!-- Call Stage (matches VideoChat exactly) -->
  <section class="call-stage">
    <div class="call-grid" class:call-grid--single={participants.length <= 1}>
      {#if !hasParticipants}
        <!-- Empty state: identical to a single participant tile -->
        <article class="call-tile">
          <div class="call-tile__media">
            <div class="call-avatar">
              <div class="call-avatar__image call-avatar__image--empty">
                <i class="bx bx-video-off"></i>
              </div>
            </div>
          </div>
          <div class="call-tile__footer">
            <div class="call-tile__footer-name">
              <span class="call-tile__footer-text">No one in call</span>
            </div>
            <div class="call-tile__footer-icons">
              <i class="bx bx-microphone-off is-off"></i>
              <i class="bx bx-video-off is-off"></i>
            </div>
          </div>
        </article>
      {:else}
        <!-- Participant tiles -->
        {#each participants as participant (participant.uid)}
          <article
            class="call-tile"
            class:call-tile--speaking={participant.isSpeaking}
            class:call-tile--sharing={participant.screenSharing}
          >
            <div class="call-tile__media">
              {#if participant.thumbnailUrl && participant.hasVideo}
                <!-- Live video thumbnail -->
                <img
                  src={participant.thumbnailUrl}
                  alt="{participant.displayName}'s video"
                  class="call-tile__thumbnail"
                />
              {:else}
                <!-- Avatar fallback -->
                <div class="call-avatar">
                  <div class="call-avatar__image">
                    {#if participant.photoURL}
                      <img src={participant.photoURL} alt={participant.displayName} loading="lazy" />
                    {:else}
                      <span>{getInitial(participant.displayName)}</span>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
            <div class="call-tile__footer">
              <div class="call-tile__footer-name">
                <span class="call-tile__footer-text" title={participant.displayName}>
                  {participant.displayName}
                </span>
                {#if participant.screenSharing}
                  <span class="call-tile__footer-pill call-tile__footer-pill--share">LIVE</span>
                {/if}
              </div>
              <div class="call-tile__footer-icons">
                <i class={`bx ${participant.hasAudio ? 'bx-microphone' : 'bx-microphone-off is-off'}`}></i>
                <i class={`bx ${participant.hasVideo ? 'bx-video' : 'bx-video-off is-off'}`}></i>
              </div>
            </div>
          </article>
        {/each}
      {/if}
    </div>
  </section>

  <!-- Hover overlay with Join button -->
  <div class="preview-overlay" class:preview-overlay--visible={isHovering}>
    <div class="preview-overlay__content">
      <!-- Channel name header -->
      <div class="preview-overlay__header">
        <i class="bx bx-video"></i>
        <span>{channelName}</span>
        {#if hasParticipants}
          <span class="preview-overlay__count">{participants.length}</span>
        {/if}
      </div>

      <!-- Join button -->
      <div class="preview-overlay__actions">
        {#if isJoining}
          <div class="preview-overlay__spinner"></div>
        {:else}
          <button type="button" class="preview-join-btn" onclick={handleJoin}>
            <i class="bx bx-phone-call"></i>
            <span>Join Call</span>
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  /* ══════════════════════════════════════════════════════════════════════════
     CALL PREVIEW CONTAINER
     ══════════════════════════════════════════════════════════════════════════ */

  .call-preview {
    position: relative;
    width: 100%;
    background: #1e1f22;
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CALL STAGE - Matches VideoChat exactly
     ══════════════════════════════════════════════════════════════════════════ */

  .call-stage {
    flex: 1;
    min-height: clamp(280px, 50vh, 600px);
    display: flex;
    position: relative;
    overflow: hidden;
    background: #1e1f22;
    border-radius: 8px;
    padding: 8px;
    padding-bottom: 16px;
    justify-content: center;
    align-items: center;
  }

  /* Connected elsewhere alert */
  .preview-alert {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(250, 168, 26, 0.1);
    border-bottom: 1px solid rgba(250, 168, 26, 0.2);
    color: #faa81a;
    font-size: 13px;
    font-weight: 500;
    flex-shrink: 0;
  }

  .preview-alert i {
    font-size: 16px;
  }

  .preview-alert span {
    flex: 1;
    color: #f2f3f5;
  }

  .preview-alert__btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 4px;
    background: #2b2d31;
    border: none;
    color: #f2f3f5;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 150ms ease;
  }

  .preview-alert__btn:hover {
    background: #404249;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CALL GRID - Matches VideoChat layout exactly
     ══════════════════════════════════════════════════════════════════════════ */

  .call-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    width: 100%;
    height: 100%;
    padding: 8px;
    box-sizing: border-box;
    align-items: center;
    justify-content: center;
    align-content: center;
  }

  .call-grid--single {
    max-width: 800px;
    margin: 0 auto;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CALL TILE - Matches VideoChat .call-tile exactly
     ══════════════════════════════════════════════════════════════════════════ */

  .call-tile {
    position: relative;
    width: 360px;
    height: 202px;
    border-radius: 8px;
    overflow: hidden;
    background: #2b2d31;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  /* Double size when alone in call */
  .call-grid--single .call-tile {
    width: 720px;
    height: 404px;
  }

  /* Speaking glow */
  .call-tile--speaking {
    box-shadow: 0 0 0 2px #23a559,
                0 0 16px rgba(35, 165, 89, 0.4);
  }

  /* Screen sharing glow */
  .call-tile--sharing {
    box-shadow: 0 0 0 2px #23a559;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     TILE MEDIA - Matches VideoChat .call-tile__media
     ══════════════════════════════════════════════════════════════════════════ */

  .call-tile__media {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #2b2d31;
    overflow: hidden;
    min-height: 0;
  }

  .call-tile__thumbnail {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     AVATAR - Matches VideoChat .call-avatar
     ══════════════════════════════════════════════════════════════════════════ */

  .call-avatar {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: #b5bac1;
    padding: 8px;
  }

  .call-avatar__image {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, var(--color-accent, #5865f2) 0%, var(--color-accent-strong, #4752c4) 100%);
    font-size: 2rem;
    font-weight: 600;
    color: white;
  }

  .call-avatar__image--empty {
    background: #1e1f22;
    color: #4e5058;
    font-size: 28px;
  }

  .call-avatar__image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     FOOTER - Matches VideoChat .call-tile__footer
     ══════════════════════════════════════════════════════════════════════════ */

  .call-tile__footer {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 0, 0.4) 60%, transparent 100%);
  }

  .call-tile__footer-name {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    color: #f2f3f5;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .call-tile__footer-text {
    font-weight: 500;
    color: #f2f3f5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .call-tile__footer-pill {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    border-radius: 4px;
    color: #f2f3f5;
    background: rgba(255, 255, 255, 0.1);
    text-transform: uppercase;
  }

  .call-tile__footer-pill--share {
    background: #23a559;
    color: white;
  }

  .call-tile__footer-icons {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #b5bac1;
    font-size: 14px;
  }

  .call-tile__footer-icons .is-off {
    color: #f23f43;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     HOVER OVERLAY
     ══════════════════════════════════════════════════════════════════════════ */

  .preview-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(
      180deg,
      rgba(0, 0, 0, 0.7) 0%,
      rgba(0, 0, 0, 0.3) 40%,
      rgba(0, 0, 0, 0.3) 60%,
      rgba(0, 0, 0, 0.7) 100%
    );
    opacity: 0;
    pointer-events: none;
    transition: opacity 200ms ease;
    z-index: 10;
  }

  .preview-overlay--visible {
    opacity: 1;
    pointer-events: auto;
  }

  .preview-overlay__content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
  }

  .preview-overlay__header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #f2f3f5;
    font-size: 15px;
    font-weight: 600;
  }

  .preview-overlay__header i {
    font-size: 18px;
    color: var(--color-accent, #5865f2);
  }

  .preview-overlay__count {
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.15);
    font-size: 12px;
    font-weight: 600;
  }

  .preview-overlay__actions {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
  }

  /* Join button */
  .preview-join-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 32px;
    border-radius: 8px;
    border: none;
    background: #23a559;
    color: white;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: background 150ms ease, transform 100ms ease;
  }

  .preview-join-btn:hover {
    background: #1a7d41;
  }

  .preview-join-btn:active {
    transform: scale(0.98);
  }

  .preview-join-btn i {
    font-size: 18px;
  }

  /* Spinner */
  .preview-overlay__spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.2);
    border-top-color: #23a559;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     RESPONSIVE
     ══════════════════════════════════════════════════════════════════════════ */

  @media (max-width: 800px) {
    /* Scale down single tile on smaller screens */
    .call-grid--single .call-tile {
      width: min(90%, 720px);
      height: auto;
      aspect-ratio: 16 / 9;
    }
  }

  @media (max-width: 640px) {
    .call-grid {
      padding: 4px;
      gap: 4px;
    }

    .call-tile {
      width: 280px;
      height: 157px;
    }

    .call-grid--single .call-tile {
      width: min(95%, 560px);
      height: auto;
      aspect-ratio: 16 / 9;
    }

    .call-avatar__image {
      width: 56px;
      height: 56px;
      font-size: 1.5rem;
    }

    .call-tile__footer {
      padding: 6px 8px;
    }

    .call-tile__footer-text {
      font-size: 11px;
    }

    .preview-join-btn {
      padding: 10px 24px;
      font-size: 14px;
    }

    .preview-overlay__header {
      font-size: 13px;
    }
  }
</style>
