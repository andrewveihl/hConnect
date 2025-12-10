<script lang="ts">
  export type MediaStageMode = 'video' | 'voice';

  export type MediaTile = {
    uid: string;
    displayName: string;
    photoURL: string | null;
    hasVideo: boolean;
    hasAudio: boolean;
    controls: { muted: boolean; volume: number };
    stream: MediaStream | null;
    isSelf: boolean;
    screenSharing: boolean;
    isSpeaking: boolean;
  };

  export type MediaStageProps = {
    mode?: MediaStageMode;
    tiles?: MediaTile[];
    gridColumns?: number;
    focusedTileId?: string | null;
    gridMode?: 'grid' | 'focus';
    showSelf?: boolean;
    muteActive?: boolean;
    videoActive?: boolean;
    shareActive?: boolean;
    shareDisabled?: boolean;
    moreOpen?: boolean;
    onToggleMute?: (() => void) | null;
    onToggleVideo?: (() => void) | null;
    onToggleShare?: (() => void) | null;
    onOpenMore?: (() => void) | null;
    onToggleGrid?: (() => void) | null;
    onToggleSelf?: (() => void) | null;
    onOpenSettings?: (() => void) | null;
    controlsVisibleOverride?: boolean | null;
  };

  export type Props = MediaStageProps;

  let {
    mode = 'voice',
    tiles = [],
    gridColumns = 1,
    focusedTileId = null,
    gridMode = 'grid',
    showSelf = true,
    muteActive = false,
    videoActive = false,
    shareActive = false,
    shareDisabled = false,
    moreOpen = false,
    onToggleMute = null,
    onToggleVideo = null,
    onToggleShare = null,
    onOpenMore = null,
    onToggleGrid = null,
    onToggleSelf = null,
    onOpenSettings = null,
    controlsVisibleOverride = null
  }: MediaStageProps = $props();

  let hoverEnabled = true;
  let hovering = false;
  let internalMute = muteActive;
  let internalVideo = videoActive;
  let internalShare = shareActive;
  let internalMore = moreOpen;

  $effect(() => {
    internalMute = muteActive;
    internalVideo = videoActive;
    internalShare = shareActive;
    internalMore = moreOpen;
  });

  const resolvedMute = $derived(onToggleMute ? muteActive : internalMute);
  const resolvedVideo = $derived(onToggleVideo ? videoActive : internalVideo);
  const resolvedShare = $derived(onToggleShare ? shareActive : internalShare);
  const resolvedMore = $derived(onOpenMore ? moreOpen : internalMore);

  function handleToggleMute() {
    if (onToggleMute) return onToggleMute();
    internalMute = !internalMute;
  }

  function handleToggleVideo() {
    if (onToggleVideo) return onToggleVideo();
    internalVideo = !internalVideo;
  }

  function handleToggleShare() {
    if (shareDisabled) return;
    if (onToggleShare) return onToggleShare();
    internalShare = !internalShare;
  }

  function handleToggleMore() {
    if (onOpenMore) return onOpenMore();
    internalMore = !internalMore;
  }

  function handleToggleGrid() {
    onToggleGrid?.();
  }

  function handleToggleSelf() {
    onToggleSelf?.();
  }

  function handleOpenSettings() {
    onOpenSettings?.();
    internalMore = false;
  }

  const initial = (value: string | null | undefined) => {
    if (!value) return '?';
    const trimmed = value.trim();
    if (!trimmed) return '?';
    return trimmed.slice(0, 1).toUpperCase();
  };

  function handlePointerEnter() {
    if (!hoverEnabled) return;
    hovering = true;
  }

  function handlePointerLeave() {
    if (!hoverEnabled) return;
    hovering = false;
  }

  function handlePointerEnterArea() {
    hovering = true;
  }

  function handlePointerLeaveArea() {
    if (!hoverEnabled) return;
    hovering = false;
  }

  $effect(() => {
    if (typeof window === 'undefined') return;
    try {
      const media = window.matchMedia('(pointer: coarse)');
      const update = () => {
        hoverEnabled = !media.matches;
        if (!hoverEnabled) {
          hovering = true;
        }
      };
      media.addEventListener('change', update);
      update();
      return () => media.removeEventListener('change', update);
    } catch {
      hoverEnabled = true;
    }
  });


  const controlVisible = $derived(
    controlsVisibleOverride !== null && controlsVisibleOverride !== undefined
      ? controlsVisibleOverride
      : hovering || !hoverEnabled
  );
  const isSolo = $derived(tiles.length === 1);
</script>

<div
  class={`media-stage media-stage--${mode} ${mode === 'voice' && isSolo ? 'media-stage--voice-solo' : ''}`}
  onpointerenter={handlePointerEnter}
  onpointerleave={handlePointerLeave}
>
  {#if mode === 'video'}
    <!-- svelte-ignore slot_element_deprecated -->
    <slot name="video" />
  {:else}
    <div
      class={`voice-grid ${isSolo ? 'voice-grid--solo' : ''}`}
      style={`--voice-cols:${Math.min(4, Math.max(1, tiles.length))}`}
      onpointerenter={handlePointerEnterArea}
      onpointerleave={handlePointerLeaveArea}
    >
      {#each tiles as tile (tile.uid)}
        <article class={`voice-card ${tile.isSpeaking ? 'is-speaking' : ''}`}>
          <div class="voice-card__avatar" aria-hidden="true">
            {#if tile.photoURL}
              <img src={tile.photoURL} alt={tile.displayName} loading="lazy" />
            {:else}
              <span>{initial(tile.displayName)}</span>
            {/if}
            <span class="voice-card__halo"></span>
          </div>
          <div class="voice-card__body">
            <div class="voice-card__name">
              {tile.displayName}
              {#if tile.isSelf}<span class="voice-card__pill">You</span>{/if}
            </div>
          </div>
        </article>
      {/each}
    </div>
  {/if}
  <div
    class={`stage-controls ${controlVisible ? 'is-visible' : ''}`}
    onpointerenter={handlePointerEnterArea}
    onpointerleave={handlePointerLeaveArea}
  >
    <button
      type="button"
      class={`stage-control ${resolvedMute ? 'is-active' : ''}`}
      onclick={handleToggleMute}
      aria-label={resolvedMute ? 'Unmute microphone' : 'Mute microphone'}
    >
      <i class={`bx ${resolvedMute ? 'bx-microphone' : 'bx-microphone-off'}`}></i>
      <span>{resolvedMute ? 'Unmute' : 'Mute'}</span>
    </button>
    <button
      type="button"
      class={`stage-control ${resolvedVideo ? 'is-active' : ''}`}
      onclick={handleToggleVideo}
      aria-label={resolvedVideo ? 'Turn camera off' : 'Turn camera on'}
    >
      <i class={`bx ${resolvedVideo ? 'bx-video' : 'bx-video-off'}`}></i>
      <span>{resolvedVideo ? 'Camera on' : 'Camera off'}</span>
    </button>
    <button
      type="button"
      class={`stage-control ${resolvedShare ? 'is-active' : ''} ${shareDisabled ? 'is-disabled' : ''}`}
      onclick={handleToggleShare}
      aria-label={resolvedShare ? 'Stop sharing screen' : 'Share screen'}
    >
      <i class="bx bx-desktop"></i>
      <span>{resolvedShare ? 'Stop' : 'Share'}</span>
    </button>
    <div class="stage-control stage-control--more">
      <button type="button" class={`stage-control ${resolvedMore ? 'is-active' : ''}`} onclick={handleToggleMore} aria-expanded={resolvedMore}>
        <i class="bx bx-dots-horizontal-rounded"></i>
        <span>More</span>
      </button>
      {#if resolvedMore}
        <div class="stage-more-menu">
          <button type="button" onclick={handleToggleGrid}>Toggle grid</button>
          <button type="button" onclick={handleToggleSelf}>{showSelf ? 'Hide self view' : 'Show self view'}</button>
          <button type="button" onclick={handleOpenSettings}>Voice & Video settings</button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .media-stage {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
    width: 100%;
  }

  .media-stage--voice {
    align-items: center;
    justify-content: center;
    padding: clamp(1rem, 2vw, 1.5rem);
    padding-bottom: clamp(2.25rem, 4vw, 3rem);
  }

  .media-stage--voice-solo {
    padding-inline: clamp(1.5rem, 4vw, 3rem);
  }

  .voice-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(480px, 1fr));
    gap: clamp(1rem, 2.6vw, 1.5rem);
    width: min(100%, 1680px);
    justify-content: center;
    justify-items: stretch;
    margin: 0 auto;
    align-content: start;
  }

  .voice-grid--solo {
    grid-template-columns: minmax(680px, 1fr);
    width: min(100%, 1680px);
  }

  .voice-card {
    border-radius: 1rem;
    padding: 0.95rem 1rem;
    background: color-mix(in srgb, var(--color-panel) 75%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
    width: 100%;
    max-width: 820px;
    min-width: 360px;
    min-height: 260px;
    box-shadow: 0 8px 18px rgba(0, 0, 0, 0.18);
    transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
    aspect-ratio: 16 / 9;
    text-align: center;
  }

  .voice-grid--solo .voice-card {
    max-width: none;
    width: 100%;
    min-height: clamp(520px, 70vh, 860px);
    background: #2a2421;
    border-color: #332b27;
    box-shadow: 0 18px 38px rgba(0, 0, 0, 0.32);
    gap: 1.25rem;
  }

  .voice-card:hover,
  .voice-card:focus-visible {
    transform: translateY(-2px);
    box-shadow: 0 14px 28px rgba(0, 0, 0, 0.26);
    border-color: color-mix(in srgb, #ffffff 12%, var(--color-border-subtle) 88%);
    outline: none;
  }

  .voice-card.is-speaking {
    border-color: color-mix(in srgb, var(--color-accent) 65%, transparent);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  }

  .voice-card__avatar {
    position: relative;
    width: 3.65rem;
    height: 3.65rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-panel-muted) 65%, transparent);
    display: grid;
    place-items: center;
    overflow: hidden;
  }

  .voice-grid--solo .voice-card__avatar {
    width: 6.2rem;
    height: 6.2rem;
    background: rgba(255, 255, 255, 0.05);
  }

  .voice-card__avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .voice-card__avatar span {
    font-weight: 700;
    color: var(--text-80);
  }

  .voice-card__halo {
    position: absolute;
    inset: -2px;
    border: 2px solid color-mix(in srgb, var(--color-accent) 55%, transparent);
    border-radius: inherit;
    opacity: 0;
    transition: opacity 160ms ease;
  }

  .voice-grid--solo .voice-card__halo {
    inset: -3px;
  }

  .voice-card.is-speaking .voice-card__halo {
    opacity: 1;
  }

  .voice-card__body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    align-items: center;
  }

  .voice-card__name {
    font-weight: 700;
    color: var(--text-90);
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    justify-content: center;
  }

  .voice-grid--solo .voice-card__name {
    font-size: 1.05rem;
  }

  .voice-card__pill {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-panel-muted) 75%, transparent);
    color: var(--text-70);
  }

.stage-controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0.35rem;
  transform: none;
  display: inline-flex;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  border-radius: 0.65rem;
  background: rgba(12, 14, 20, 0.82);
  border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
  box-shadow: 0 14px 28px rgba(0, 0, 0, 0.4);
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms ease, transform 160ms ease;
  backdrop-filter: blur(8px);
  z-index: 5;
  display: none;
}

.stage-controls.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.stage-control {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.42rem 0.65rem;
  border-radius: 0.55rem;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-80);
  font-size: 0.85rem;
  font-weight: 600;
  transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
}

  .stage-control.is-active {
    color: color-mix(in srgb, var(--color-accent) 95%, white);
    border-color: color-mix(in srgb, var(--color-accent) 65%, transparent);
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
  }

  .stage-control.is-disabled {
    opacity: 0.55;
  }

  .stage-control:hover:not(.is-disabled),
  .stage-control:focus-visible:not(.is-disabled) {
    color: var(--text-100);
    border-color: color-mix(in srgb, var(--color-border-strong) 55%, transparent);
    background: color-mix(in srgb, var(--color-panel) 55%, transparent);
    outline: none;
  }

  .stage-control i {
    font-size: 1.15rem;
  }


  @media (max-width: 768px) {
    .stage-controls {
      width: calc(100% - 1.4rem);
      justify-content: space-between;
      gap: 0.25rem;
    }

    .stage-control span {
      display: none;
    }
  }
</style>
