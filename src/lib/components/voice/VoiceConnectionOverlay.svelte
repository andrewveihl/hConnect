<script lang="ts">
  /**
   * VoiceConnectionOverlay - Shows connection state overlays
   * 
   * Displays:
   * - Connecting spinner
   * - Reconnecting with attempt count
   * - Failed with tap to retry
   * - Poor connection warning
   */
  import { createEventDispatcher } from 'svelte';
  import { getConnectionStateInfo, getConnectionQuality, type ConnectionState, type ConnectionQuality } from '$lib/webrtc/voiceSounds';

  // ─────────────────────────────────────────────────────────────────────────
  // Props
  // ─────────────────────────────────────────────────────────────────────────

  interface Props {
    state?: ConnectionState;
    rtt?: number | null;
    packetLoss?: number | null;
    showQuality?: boolean;
    onRetry?: () => void;
  }

  let {
    state = 'idle',
    rtt = null,
    packetLoss = null,
    showQuality = true,
    onRetry
  }: Props = $props();

  const dispatch = createEventDispatcher<{
    retry: void;
  }>();

  // ─────────────────────────────────────────────────────────────────────────
  // Derived State
  // ─────────────────────────────────────────────────────────────────────────

  const stateInfo = $derived(getConnectionStateInfo(state));
  const qualityInfo = $derived(getConnectionQuality(rtt, packetLoss));
  
  const showOverlay = $derived(stateInfo.showOverlay);
  const showQualityBar = $derived(showQuality && state === 'connected' && qualityInfo.quality !== 'unknown');

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────

  function handleRetry() {
    if (stateInfo.canRetry) {
      onRetry?.();
      dispatch('retry');
    }
  }
</script>

<!-- Connection Quality Bar (when connected) -->
{#if showQualityBar}
  <div 
    class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[color:var(--color-panel-muted)]/80 backdrop-blur-sm"
    title="{qualityInfo.message} - RTT: {rtt?.toFixed(0) ?? '?'}ms, Loss: {packetLoss?.toFixed(1) ?? '?'}%"
  >
    <!-- Signal bars -->
    <div class="flex items-end gap-0.5 h-3">
      {#each [1, 2, 3, 4] as bar}
        <div 
          class="w-1 rounded-sm transition-colors"
          class:bg-current={bar <= qualityInfo.bars}
          class:bg-gray-600={bar > qualityInfo.bars}
          class:h-1={bar === 1}
          class:h-1.5={bar === 2}
          class:h-2={bar === 3}
          class:h-3={bar === 4}
          class:text-emerald-400={qualityInfo.quality === 'excellent'}
          class:text-lime-400={qualityInfo.quality === 'good'}
          class:text-amber-400={qualityInfo.quality === 'fair'}
          class:text-rose-400={qualityInfo.quality === 'poor'}
        ></div>
      {/each}
    </div>
    
    <span class="text-xs {qualityInfo.color}">{qualityInfo.message}</span>
  </div>
{/if}

<!-- State Overlay (connecting, reconnecting, failed) -->
{#if showOverlay}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div 
    class="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm rounded-lg"
    class:cursor-pointer={stateInfo.canRetry}
    onclick={handleRetry}
    onkeydown={(e) => e.key === 'Enter' && handleRetry()}
    role={stateInfo.canRetry ? 'button' : 'status'}
    tabindex={stateInfo.canRetry ? 0 : -1}
    aria-label={stateInfo.message}
  >
    <div class="flex flex-col items-center gap-3 text-center px-4">
      <!-- Icon -->
      <div 
        class="w-12 h-12 rounded-full flex items-center justify-center"
        class:bg-emerald-500={state === 'connecting'}
        class:bg-opacity-20={state === 'connecting'}
        class:bg-amber-500={state === 'reconnecting'}
        class:bg-rose-500={state === 'failed'}
      >
        {#if state === 'connecting'}
          <i class="bx bx-loader-alt text-2xl text-emerald-400 animate-spin"></i>
        {:else if state === 'reconnecting'}
          <i class="bx bx-refresh text-2xl text-amber-400 animate-spin"></i>
        {:else if state === 'failed'}
          <i class="bx bx-error-circle text-2xl text-rose-400"></i>
        {/if}
      </div>
      
      <!-- Message -->
      <div class="space-y-1">
        <p class="text-sm font-medium text-[color:var(--color-text-primary)]">
          {stateInfo.message}
        </p>
        
        {#if stateInfo.canRetry}
          <p class="text-xs text-[color:var(--color-text-secondary)]">
            Tap anywhere to try again
          </p>
        {/if}
      </div>
    </div>
  </div>
{/if}
