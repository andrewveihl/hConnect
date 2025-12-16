<script lang="ts">
  /**
   * CallTile - A shared voice call participant tile component
   * 
   * This component renders a single participant tile used in:
   * - VideoChat (the main call view)
   * - CallPreview (preview before joining)
   * - VoiceLobby (the lobby view)
   * 
   * By using a shared component, we ensure consistent styling across all views.
   * When this component is updated, all three views will automatically match.
   */
  import Avatar from '$lib/components/app/Avatar.svelte';

  interface Props {
    /** The participant's display name */
    displayName?: string;
    /** The participant's photo URL */
    photoURL?: string | null;
    /** Full user object for avatar resolution (optional, for better fallback) */
    user?: Record<string, unknown> | null;
    /** Whether the participant has audio enabled */
    hasAudio?: boolean;
    /** Whether the participant has video enabled */
    hasVideo?: boolean;
    /** Whether the participant is screen sharing */
    screenSharing?: boolean;
    /** Whether the participant is speaking */
    isSpeaking?: boolean;
    /** URL to the participant's video thumbnail (for previews) */
    thumbnailUrl?: string | null;
    /** Whether this is the current user's tile */
    isSelf?: boolean;
    /** Whether this is an empty state tile (no one in call) */
    isEmpty?: boolean;
    /** Whether this is a single tile (gets larger sizing) */
    isSingle?: boolean;
    /** Whether to show as a self preview (shows user's avatar with "You" label) */
    isSelfPreview?: boolean;
  }

  let {
    displayName = '',
    photoURL = null,
    user = null,
    hasAudio = true,
    hasVideo = false,
    screenSharing = false,
    isSpeaking = false,
    thumbnailUrl = null,
    isSelf = false,
    isEmpty = false,
    isSingle = false,
    isSelfPreview = false
  }: Props = $props();

  function getInitial(name: string): string {
    return name?.trim().charAt(0).toUpperCase() || '?';
  }

  // For self preview mode, treat it like the user is in the call
  const showAsSelf = $derived(isSelf || isSelfPreview);
  const effectiveDisplayName = $derived(isEmpty && isSelfPreview ? (displayName || 'You') : displayName);
  const isEmptyWithoutPreview = $derived(isEmpty && !isSelfPreview);
  
  // Determine avatar size based on tile size
  const avatarSize = $derived(isSingle ? '2xl' : 'xl');
</script>

<article
  class="call-tile"
  class:call-tile--single={isSingle}
  class:call-tile--speaking={isSpeaking && !isEmpty}
  class:call-tile--sharing={screenSharing && !isEmpty}
  class:call-tile--self={showAsSelf && !isEmptyWithoutPreview}
>
  <div class="call-tile__media">
    {#if !isEmpty && thumbnailUrl && hasVideo}
      <!-- Live video thumbnail -->
      <img
        src={thumbnailUrl}
        alt="{effectiveDisplayName}'s video"
        class="call-tile__thumbnail"
      />
    {:else}
      <!-- Avatar (or empty icon) -->
      <div class="call-avatar">
        <div class="call-avatar__image" class:call-avatar__image--empty={isEmptyWithoutPreview}>
          {#if isEmptyWithoutPreview}
            <i class="bx bx-video-off"></i>
          {:else}
            <Avatar
              src={photoURL}
              user={user}
              name={effectiveDisplayName}
              size={avatarSize}
              isSelf={showAsSelf}
              class="call-avatar__avatar"
            />
          {/if}
        </div>
      </div>
    {/if}
  </div>
  <div class="call-tile__footer">
    <div class="call-tile__footer-name">
      <span class="call-tile__footer-text" title={isEmptyWithoutPreview ? undefined : effectiveDisplayName}>
        {#if isEmptyWithoutPreview}
          No one in call
        {:else if showAsSelf}
          You
        {:else}
          {effectiveDisplayName}
        {/if}
      </span>
      {#if showAsSelf && !isEmptyWithoutPreview}
        <span class="call-tile__footer-pill">YOU</span>
      {/if}
      {#if screenSharing && !isEmpty}
        <span class="call-tile__footer-pill call-tile__footer-pill--share">LIVE</span>
      {/if}
    </div>
    <div class="call-tile__footer-icons">
      <i class={`bx ${isEmptyWithoutPreview || !hasAudio ? 'bx-microphone-off is-off' : 'bx-microphone'}`}></i>
      <i class={`bx ${isEmptyWithoutPreview || !hasVideo ? 'bx-video-off is-off' : 'bx-video'}`}></i>
    </div>
  </div>
</article>

<style>
  /* ══════════════════════════════════════════════════════════════════════════
     CALL TILE - Shared component matching VideoChat exactly
     ══════════════════════════════════════════════════════════════════════════ */

  .call-tile {
    position: relative;
    width: 360px;
    max-width: 100%;
    height: 202px;
    border-radius: 8px;
    overflow: hidden;
    background: #2b2d31;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    transition: box-shadow 200ms ease;
  }

  .call-tile:hover {
    background: #32353b;
  }

  /* Double size when alone in call */
  .call-tile--single {
    width: 720px;
    max-width: calc(100% - 32px);
    height: 404px;
  }

  /* Self indicator */
  .call-tile--self {
    box-shadow: 0 0 0 2px var(--color-accent, #5865f2);
  }

  /* Screen sharing glow */
  .call-tile--sharing {
    box-shadow: 0 0 0 2px #23a559;
  }

  /* Speaking glow */
  .call-tile--speaking {
    box-shadow: 
      0 0 0 2px #23a559,
      0 0 16px rgba(35, 165, 89, 0.4);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     MEDIA CONTAINER
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
    z-index: 1;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     AVATAR - Matches VideoChat .call-avatar exactly
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

  /* Avatar component wrapper styles */
  :global(.call-avatar__image .call-avatar__avatar) {
    width: 100%;
    height: 100%;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     FOOTER - Matches VideoChat .call-tile__footer exactly
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
     RESPONSIVE
     ══════════════════════════════════════════════════════════════════════════ */

  @media (max-width: 800px) {
    .call-tile--single {
      width: min(90%, 720px);
      height: auto;
      aspect-ratio: 16 / 9;
    }
  }

  @media (max-width: 480px) {
    .call-tile {
      width: min(100%, 360px);
      height: auto;
      aspect-ratio: 16 / 9;
    }

    .call-tile--single {
      width: min(100%, 360px);
    }

    .call-avatar__image {
      width: 64px;
      height: 64px;
      font-size: 1.5rem;
    }

    .call-avatar__image--empty {
      font-size: 24px;
    }
  }
</style>
