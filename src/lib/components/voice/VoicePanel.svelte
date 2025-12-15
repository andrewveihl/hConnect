<script lang="ts">
  /**
   * VoicePanel - Guilded-style voice channel panel
   * Features:
   * - Channel header with connection state
   * - Member list with speaking indicators
   * - Bottom control bar with iOS safe area support
   * - Device picker integration
   * - Connection overlay for reconnecting states
   */
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { browser } from '$app/environment';
  import { voiceStore, type VoiceParticipant } from '$lib/stores/voiceStore';
  import { playSound } from '$lib/utils/sounds';
  import VoiceDevicePicker from './VoiceDevicePicker.svelte';
  import VoiceConnectionOverlay from './VoiceConnectionOverlay.svelte';
  import { onSelfLeave } from '$lib/webrtc/voiceSounds';

  // ─────────────────────────────────────────────────────────────────────────
  // Props
  // ─────────────────────────────────────────────────────────────────────────

  interface Props {
    /** Position: right side panel or floating */
    position?: 'side' | 'floating';
    /** Enable drag to reposition (floating mode only) */
    draggable?: boolean;
    /** Show the device picker button */
    showDevicePicker?: boolean;
    /** Hide video controls (audio-only mode) */
    audioOnly?: boolean;
    /** Callback when user wants to leave */
    onLeave?: () => void;
    /** Callback when user toggles mute */
    onToggleMute?: () => void;
    /** Callback when user toggles deafen */
    onToggleDeafen?: () => void;
    /** Callback when user toggles video */
    onToggleVideo?: () => void;
    /** Callback when user toggles screen share */
    onToggleScreenShare?: () => void;
    /** Callback when user wants to open settings */
    onOpenSettings?: () => void;
    /** Callback when user wants to reconnect */
    onReconnect?: () => void;
  }

  let {
    position = 'side',
    draggable = false,
    showDevicePicker = true,
    audioOnly = false,
    onLeave,
    onToggleMute,
    onToggleDeafen,
    onToggleVideo,
    onToggleScreenShare,
    onOpenSettings,
    onReconnect
  }: Props = $props();

  const dispatch = createEventDispatcher<{
    leave: void;
    toggleMute: void;
    toggleDeafen: void;
    toggleVideo: void;
    toggleScreenShare: void;
    openSettings: void;
    reconnect: void;
    openDevicePicker: void;
  }>();

  // ─────────────────────────────────────────────────────────────────────────
  // Store Subscriptions
  // ─────────────────────────────────────────────────────────────────────────

  const channel = voiceStore.channel;
  const connection = voiceStore.connection;
  const local = voiceStore.local;
  const participants = voiceStore.activeParticipants;
  const participantCount = voiceStore.participantCount;
  const statusMessage = voiceStore.statusMessage;
  const showReconnectButton = voiceStore.showReconnectButton;
  const isConnected = voiceStore.isConnected;
  const isConnecting = voiceStore.isConnecting;

  // ─────────────────────────────────────────────────────────────────────────
  // Local State
  // ─────────────────────────────────────────────────────────────────────────

  let panelEl: HTMLElement | null = $state(null);
  let showMoreMenu = $state(false);
  let isMobile = $state(false);
  let devicePickerOpen = $state(false);

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────

  function handleLeave() {
    onSelfLeave();
    onLeave?.();
    dispatch('leave');
  }

  function handleToggleMute() {
    const newState = voiceStore.toggleMute();
    onToggleMute?.();
    dispatch('toggleMute');
  }

  function handleToggleDeafen() {
    voiceStore.toggleDeafen();
    onToggleDeafen?.();
    dispatch('toggleDeafen');
  }

  function handleToggleVideo() {
    voiceStore.toggleVideo();
    onToggleVideo?.();
    dispatch('toggleVideo');
  }

  function handleToggleScreenShare() {
    voiceStore.toggleScreenShare();
    onToggleScreenShare?.();
    dispatch('toggleScreenShare');
  }

  function handleOpenSettings() {
    onOpenSettings?.();
    dispatch('openSettings');
  }

  function handleReconnect() {
    voiceStore.clearError();
    onReconnect?.();
    dispatch('reconnect');
  }

  function handleOpenDevicePicker() {
    devicePickerOpen = true;
    dispatch('openDevicePicker');
  }

  function handleCloseDevicePicker() {
    devicePickerOpen = false;
  }

  function handleDevicesSaved(event: { inputDeviceId: string | null; outputDeviceId: string | null; cameraDeviceId: string | null }) {
    // Device selection was saved, UI will react to voicePreferences store changes
    devicePickerOpen = false;
  }

  function toggleMoreMenu() {
    showMoreMenu = !showMoreMenu;
  }

  function closeMoreMenu() {
    showMoreMenu = false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────

  function getInitials(name: string): string {
    if (!name) return '?';
    return name.trim().charAt(0).toUpperCase() || '?';
  }

  function formatConnectionStatus(status: string, quality: string): string {
    if (status === 'connected') {
      if (quality === 'poor') return 'Poor connection';
      return 'Voice Connected';
    }
    if (status === 'connecting') return 'Connecting...';
    if (status === 'reconnecting') return 'Reconnecting...';
    if (status === 'failed') return 'Connection failed';
    return '';
  }

  function getQualityIcon(quality: string): string {
    switch (quality) {
      case 'excellent': return 'bx-signal-5';
      case 'good': return 'bx-signal-4';
      case 'poor': return 'bx-signal-2';
      default: return 'bx-signal-1';
    }
  }

  function getQualityColor(quality: string): string {
    switch (quality) {
      case 'excellent': return 'text-emerald-400';
      case 'good': return 'text-emerald-400';
      case 'poor': return 'text-amber-400';
      default: return 'text-rose-400';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  onMount(() => {
    if (browser) {
      const mediaQuery = window.matchMedia('(max-width: 768px)');
      isMobile = mediaQuery.matches;
      
      const handler = (e: MediaQueryListEvent) => {
        isMobile = e.matches;
      };
      
      mediaQuery.addEventListener('change', handler);
      
      // Close menu on outside click
      const handleOutsideClick = (e: MouseEvent) => {
        if (showMoreMenu && panelEl && !panelEl.contains(e.target as Node)) {
          closeMoreMenu();
        }
      };
      window.addEventListener('click', handleOutsideClick);
      
      return () => {
        mediaQuery.removeEventListener('change', handler);
        window.removeEventListener('click', handleOutsideClick);
      };
    }
  });
</script>

<!-- Main Panel Container -->
<aside
  bind:this={panelEl}
  class="voice-panel flex flex-col bg-[color:var(--color-sidebar)] border-l border-[color:var(--color-border-subtle)]"
  class:voice-panel--side={position === 'side'}
  class:voice-panel--floating={position === 'floating'}
  aria-label="Voice channel panel"
>
  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <!-- Header                                                                   -->
  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <header class="voice-panel__header flex items-center gap-3 px-4 py-3 border-b border-[color:var(--color-border-subtle)]">
    <!-- Connection indicator -->
    <div class="flex items-center gap-2">
      {#if $isConnected}
        <span class="relative flex h-3 w-3">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
          <span class="relative inline-flex h-3 w-3 rounded-full bg-emerald-500"></span>
        </span>
      {:else if $isConnecting}
        <span class="h-3 w-3 rounded-full bg-amber-400 animate-pulse"></span>
      {:else}
        <span class="h-3 w-3 rounded-full bg-zinc-500"></span>
      {/if}
    </div>

    <!-- Channel info -->
    <div class="flex-1 min-w-0">
      <h2 class="text-sm font-semibold text-[color:var(--color-text-primary)] truncate">
        {$channel.channelName || 'Voice Channel'}
      </h2>
      <p class="text-xs text-[color:var(--color-text-secondary)] truncate">
        {#if $connection.status === 'connected'}
          <span class={getQualityColor($connection.quality)}>
            <i class="bx {getQualityIcon($connection.quality)} mr-1"></i>
            {$statusMessage}
          </span>
        {:else}
          {$statusMessage}
        {/if}
      </p>
    </div>

    <!-- Participant count -->
    <div class="flex items-center gap-1 px-2 py-1 rounded-full bg-[color:var(--color-panel-muted)]">
      <i class="bx bx-user text-sm text-[color:var(--color-text-secondary)]"></i>
      <span class="text-xs font-medium text-[color:var(--color-text-primary)]">{$participantCount}</span>
    </div>
  </header>

  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <!-- Reconnect Banner (if failed)                                            -->
  <!-- ─────────────────────────────────────────────────────────────────────── -->
  {#if $showReconnectButton}
    <div class="voice-panel__reconnect flex items-center justify-between gap-3 px-4 py-2 bg-rose-500/10 border-b border-rose-500/20">
      <div class="flex items-center gap-2 text-rose-300">
        <i class="bx bx-error-circle text-lg"></i>
        <span class="text-sm">Connection lost</span>
      </div>
      <button
        onclick={handleReconnect}
        class="px-3 py-1.5 text-xs font-medium text-white bg-rose-500 hover:bg-rose-600 rounded-md transition-colors"
        aria-label="Reconnect to voice channel"
      >
        Reconnect
      </button>
    </div>
  {/if}

  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <!-- Participant List                                                         -->
  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <div class="voice-panel__members flex-1 overflow-y-auto px-2 py-3" role="list" aria-label="Voice channel members">
    {#if $participants.length === 0}
      <div class="flex flex-col items-center justify-center h-full text-center px-4 py-8">
        <div class="w-16 h-16 rounded-full bg-[color:var(--color-panel-muted)] flex items-center justify-center mb-4">
          <i class="bx bx-user-voice text-3xl text-[color:var(--color-text-tertiary)]"></i>
        </div>
        <p class="text-sm text-[color:var(--color-text-secondary)]">
          {#if $isConnecting}
            Joining voice channel...
          {:else}
            No one else is here yet
          {/if}
        </p>
      </div>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each $participants as participant (participant.uid)}
          {@const isSpeaking = participant.isSpeaking}
          <li
            class="voice-member group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[color:var(--color-panel-muted)] transition-colors"
            class:voice-member--speaking={isSpeaking}
            role="listitem"
          >
            <!-- Avatar with speaking ring -->
            <div class="relative flex-shrink-0">
              <div
                class="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center bg-[color:var(--color-panel)] transition-all duration-150"
                class:ring-2={isSpeaking}
                class:ring-emerald-400={isSpeaking}
                class:ring-offset-2={isSpeaking}
                class:ring-offset-[color:var(--color-sidebar)]={isSpeaking}
              >
                {#if participant.photoURL}
                  <img
                    src={participant.photoURL}
                    alt={participant.displayName}
                    class="w-full h-full object-cover"
                    loading="lazy"
                  />
                {:else}
                  <span class="text-sm font-semibold text-[color:var(--color-text-primary)]">
                    {getInitials(participant.displayName)}
                  </span>
                {/if}
              </div>
              
              <!-- Status badges -->
              {#if participant.isMuted || participant.serverMuted}
                <div class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-rose-500 flex items-center justify-center ring-2 ring-[color:var(--color-sidebar)]">
                  <i class="bx bx-microphone-off text-[10px] text-white"></i>
                </div>
              {/if}
            </div>

            <!-- Name and status -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-[color:var(--color-text-primary)] truncate">
                  {participant.displayName}
                </span>
                {#if participant.screenSharing}
                  <span class="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-200 bg-rose-500/20 rounded">
                    Live
                  </span>
                {/if}
              </div>
              
              <!-- Status icons row -->
              <div class="flex items-center gap-1.5 mt-0.5">
                {#if participant.isDeafened || participant.serverDeafened}
                  <i class="bx bx-volume-mute text-xs text-rose-400" title="Deafened"></i>
                {/if}
                {#if participant.videoEnabled}
                  <i class="bx bx-video text-xs text-emerald-400" title="Camera on"></i>
                {/if}
              </div>
            </div>

            <!-- Speaking level indicator (subtle bar) -->
            {#if isSpeaking}
              <div class="w-1 h-6 rounded-full bg-[color:var(--color-panel-muted)] overflow-hidden">
                <div
                  class="w-full bg-emerald-400 transition-all duration-75 rounded-full"
                  style="height: {Math.min(100, participant.speakingLevel * 100)}%"
                ></div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <!-- Control Bar                                                              -->
  <!-- ─────────────────────────────────────────────────────────────────────── -->
  <div class="voice-panel__controls border-t border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel)] px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
    <div class="flex items-center justify-center gap-2">
      <!-- Mute Button -->
      <button
        onclick={handleToggleMute}
        class="voice-control-btn group relative flex items-center justify-center w-11 h-11 rounded-full transition-all"
        class:voice-control-btn--active={!$local.isMuted}
        class:voice-control-btn--muted={$local.isMuted}
        aria-label={$local.isMuted ? 'Unmute microphone' : 'Mute microphone'}
        aria-pressed={!$local.isMuted}
      >
        <i class="bx {$local.isMuted ? 'bx-microphone-off' : 'bx-microphone'} text-xl"></i>
        <span class="sr-only">{$local.isMuted ? 'Unmute' : 'Mute'}</span>
      </button>

      <!-- Deafen Button -->
      <button
        onclick={handleToggleDeafen}
        class="voice-control-btn group relative flex items-center justify-center w-11 h-11 rounded-full transition-all"
        class:voice-control-btn--active={!$local.isDeafened}
        class:voice-control-btn--muted={$local.isDeafened}
        aria-label={$local.isDeafened ? 'Undeafen' : 'Deafen'}
        aria-pressed={!$local.isDeafened}
      >
        <i class="bx {$local.isDeafened ? 'bx-volume-mute' : 'bx-volume-full'} text-xl"></i>
        <span class="sr-only">{$local.isDeafened ? 'Undeafen' : 'Deafen'}</span>
      </button>

      <!-- Video Button (if not audio-only) -->
      {#if !audioOnly}
        <button
          onclick={handleToggleVideo}
          class="voice-control-btn group relative flex items-center justify-center w-11 h-11 rounded-full transition-all"
          class:voice-control-btn--active={$local.videoEnabled}
          class:voice-control-btn--off={!$local.videoEnabled}
          aria-label={$local.videoEnabled ? 'Turn off camera' : 'Turn on camera'}
          aria-pressed={$local.videoEnabled}
        >
          <i class="bx {$local.videoEnabled ? 'bx-video' : 'bx-video-off'} text-xl"></i>
          <span class="sr-only">{$local.videoEnabled ? 'Camera on' : 'Camera off'}</span>
        </button>

        <!-- Screen Share Button (desktop only) -->
        {#if !isMobile}
          <button
            onclick={handleToggleScreenShare}
            class="voice-control-btn group relative flex items-center justify-center w-11 h-11 rounded-full transition-all"
            class:voice-control-btn--active={$local.screenSharing}
            class:voice-control-btn--off={!$local.screenSharing}
            aria-label={$local.screenSharing ? 'Stop sharing screen' : 'Share screen'}
            aria-pressed={$local.screenSharing}
          >
            <i class="bx {$local.screenSharing ? 'bxs-window-alt' : 'bx-window-alt'} text-xl"></i>
            <span class="sr-only">{$local.screenSharing ? 'Stop sharing' : 'Share screen'}</span>
          </button>
        {/if}
      {/if}

      <!-- More Menu Button -->
      <div class="relative">
        <button
          onclick={toggleMoreMenu}
          class="voice-control-btn group relative flex items-center justify-center w-11 h-11 rounded-full transition-all"
          aria-label="More options"
          aria-expanded={showMoreMenu}
          aria-haspopup="menu"
        >
          <i class="bx bx-dots-horizontal-rounded text-xl"></i>
        </button>

        <!-- More Menu Dropdown -->
        {#if showMoreMenu}
          <div
            class="absolute bottom-full right-0 mb-2 w-48 py-1 rounded-lg bg-[color:var(--color-panel)] border border-[color:var(--color-border-subtle)] shadow-lg z-50"
            role="menu"
          >
            {#if showDevicePicker}
              <button
                onclick={() => { closeMoreMenu(); handleOpenDevicePicker(); }}
                class="w-full flex items-center gap-3 px-3 py-2 text-sm text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-panel-muted)] transition-colors"
                role="menuitem"
              >
                <i class="bx bx-cog text-lg text-[color:var(--color-text-secondary)]"></i>
                Audio Settings
              </button>
            {/if}
            <button
              onclick={() => { closeMoreMenu(); handleOpenSettings(); }}
              class="w-full flex items-center gap-3 px-3 py-2 text-sm text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-panel-muted)] transition-colors"
              role="menuitem"
            >
              <i class="bx bx-slider-alt text-lg text-[color:var(--color-text-secondary)]"></i>
              Voice Settings
            </button>
            <div class="my-1 border-t border-[color:var(--color-border-subtle)]"></div>
            <button
              onclick={() => { closeMoreMenu(); handleLeave(); }}
              class="w-full flex items-center gap-3 px-3 py-2 text-sm text-rose-400 hover:bg-rose-500/10 transition-colors"
              role="menuitem"
            >
              <i class="bx bx-phone-off text-lg"></i>
              Disconnect
            </button>
          </div>
        {/if}
      </div>

      <!-- Leave Button -->
      <button
        onclick={handleLeave}
        class="voice-control-btn voice-control-btn--danger flex items-center justify-center w-11 h-11 rounded-full transition-all"
        aria-label="Leave voice channel"
      >
        <i class="bx bx-phone-off text-xl"></i>
        <span class="sr-only">Leave</span>
      </button>
    </div>
  </div>

  <!-- Screen reader announcement for connection status -->
  <div class="sr-only" aria-live="polite" aria-atomic="true">
    {$statusMessage}
  </div>
</aside>

<!-- Device Picker Modal -->
<VoiceDevicePicker 
  open={devicePickerOpen}
  onClose={handleCloseDevicePicker}
  onSave={handleDevicesSaved}
/>

<!-- Connection Overlay (shows connecting/reconnecting/failed states) -->
{#if $connection.status === 'connecting' || $connection.status === 'reconnecting' || $connection.status === 'failed'}
  <VoiceConnectionOverlay
    state={$connection.status}
    rtt={$connection.rtt}
    packetLoss={$connection.packetLoss}
    showQuality={false}
    onRetry={handleReconnect}
  />
{/if}

<style>
  /* Panel Layout */
  .voice-panel {
    --panel-width: 280px;
    width: var(--panel-width);
    height: 100%;
    max-height: 100vh;
    max-height: 100dvh;
  }

  .voice-panel--floating {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    height: auto;
    max-height: calc(100vh - 2rem);
    max-height: calc(100dvh - 2rem);
    border-radius: 12px;
    border: 1px solid var(--color-border-subtle);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    z-index: 100;
  }

  /* Control Button Styles */
  .voice-control-btn {
    background: var(--color-panel-muted);
    color: var(--color-text-secondary);
  }

  .voice-control-btn:hover {
    background: var(--color-card);
    color: var(--color-text-primary);
  }

  .voice-control-btn:focus-visible {
    outline: 2px solid var(--color-accent, #5865f2);
    outline-offset: 2px;
  }

  .voice-control-btn--active {
    background: #23a559;
    color: white;
  }

  .voice-control-btn--active:hover {
    background: #1a7d41;
  }

  .voice-control-btn--muted {
    background: #f23f43;
    color: white;
  }

  .voice-control-btn--muted:hover {
    background: #d12d30;
  }

  .voice-control-btn--off {
    background: var(--color-panel-muted);
    color: var(--color-text-secondary);
  }

  .voice-control-btn--danger {
    background: #f23f43;
    color: white;
  }

  .voice-control-btn--danger:hover {
    background: #d12d30;
  }

  /* Speaking member highlight */
  .voice-member--speaking {
    background: rgba(35, 165, 89, 0.1);
  }

  /* Mobile adjustments */
  @media (max-width: 768px) {
    .voice-panel {
      --panel-width: 100%;
      border-left: none;
      border-radius: 0;
    }

    .voice-panel--floating {
      right: 0;
      bottom: 0;
      left: 0;
      width: 100%;
      max-height: 60vh;
      border-radius: 16px 16px 0 0;
    }

    .voice-control-btn {
      width: 3rem;
      height: 3rem;
    }
  }

  /* Custom scrollbar */
  .voice-panel__members {
    scrollbar-width: thin;
    scrollbar-color: var(--color-scroll-thumb) transparent;
  }

  .voice-panel__members::-webkit-scrollbar {
    width: 6px;
  }

  .voice-panel__members::-webkit-scrollbar-track {
    background: transparent;
  }

  .voice-panel__members::-webkit-scrollbar-thumb {
    background: var(--color-scroll-thumb);
    border-radius: 3px;
  }
</style>
