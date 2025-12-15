<script lang="ts">
  /**
   * VoiceDevicePicker - Audio/Video device selection modal
   * Features:
   * - Lists available microphones, speakers, and cameras
   * - Persists selection to localStorage
   * - Live preview/test for audio input
   */
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { browser } from '$app/environment';
  import { getMediaDevices, type MediaDeviceInfo } from '$lib/webrtc/rtcClient';
  import { voicePreferences } from '$lib/stores/voicePreferences';

  // ─────────────────────────────────────────────────────────────────────────
  // Props
  // ─────────────────────────────────────────────────────────────────────────

  interface Props {
    /** Whether the picker is visible */
    open?: boolean;
    /** Callback when picker is closed */
    onClose?: () => void;
    /** Callback when devices are selected */
    onSave?: (devices: { inputDeviceId: string | null; outputDeviceId: string | null; cameraDeviceId: string | null }) => void;
  }

  let {
    open = false,
    onClose,
    onSave
  }: Props = $props();

  const dispatch = createEventDispatcher<{
    close: void;
    save: { inputDeviceId: string | null; outputDeviceId: string | null; cameraDeviceId: string | null };
  }>();

  // ─────────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────────

  let audioInputs: MediaDeviceInfo[] = $state([]);
  let audioOutputs: MediaDeviceInfo[] = $state([]);
  let videoInputs: MediaDeviceInfo[] = $state([]);

  let selectedInput: string = $state('');
  let selectedOutput: string = $state('');
  let selectedCamera: string = $state('');

  let loading = $state(true);
  let error: string | null = $state(null);

  // Audio preview state
  let previewStream: MediaStream | null = $state(null);
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let audioLevel = $state(0);
  let previewAnimationFrame: number | null = null;

  // Video preview state
  let videoPreviewStream: MediaStream | null = $state(null);
  let videoEl: HTMLVideoElement | null = $state(null);

  // ─────────────────────────────────────────────────────────────────────────
  // Load Devices
  // ─────────────────────────────────────────────────────────────────────────

  async function loadDevices() {
    if (!browser) return;
    
    loading = true;
    error = null;
    
    try {
      // Request permissions first (needed to get device labels)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        stream.getTracks().forEach(t => t.stop());
      } catch {
        // May not have all permissions, that's ok
      }
      
      const devices = await getMediaDevices();
      audioInputs = devices.audioInputs;
      audioOutputs = devices.audioOutputs;
      videoInputs = devices.videoInputs;
      
      // Load saved preferences
      const prefs = $voicePreferences;
      
      // Set defaults or saved values
      if (prefs.inputDeviceId && audioInputs.some(d => d.deviceId === prefs.inputDeviceId)) {
        selectedInput = prefs.inputDeviceId;
      } else if (audioInputs.length > 0) {
        selectedInput = audioInputs[0].deviceId;
      }
      
      if (prefs.outputDeviceId && audioOutputs.some(d => d.deviceId === prefs.outputDeviceId)) {
        selectedOutput = prefs.outputDeviceId;
      } else if (audioOutputs.length > 0) {
        selectedOutput = audioOutputs[0].deviceId;
      }
      
      if (prefs.cameraDeviceId && videoInputs.some(d => d.deviceId === prefs.cameraDeviceId)) {
        selectedCamera = prefs.cameraDeviceId;
      } else if (videoInputs.length > 0) {
        selectedCamera = videoInputs[0].deviceId;
      }
      
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load devices';
    } finally {
      loading = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Audio Preview
  // ─────────────────────────────────────────────────────────────────────────

  async function startAudioPreview() {
    stopAudioPreview();
    
    if (!selectedInput || !browser) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: selectedInput } }
      });
      
      previewStream = stream;
      
      // Set up audio level monitoring
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContext = new AudioContextClass();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      
      const dataArray = new Uint8Array(analyser.fftSize);
      
      const updateLevel = () => {
        if (!analyser) return;
        
        analyser.getByteTimeDomainData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const deviation = (dataArray[i] - 128) / 128;
          sum += deviation * deviation;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        audioLevel = Math.min(1, rms / 0.15);
        
        previewAnimationFrame = requestAnimationFrame(updateLevel);
      };
      
      updateLevel();
    } catch {
      // Ignore preview errors
    }
  }

  function stopAudioPreview() {
    if (previewAnimationFrame) {
      cancelAnimationFrame(previewAnimationFrame);
      previewAnimationFrame = null;
    }
    
    if (analyser) {
      analyser.disconnect();
      analyser = null;
    }
    
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    
    if (previewStream) {
      previewStream.getTracks().forEach(t => t.stop());
      previewStream = null;
    }
    
    audioLevel = 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Video Preview
  // ─────────────────────────────────────────────────────────────────────────

  async function startVideoPreview() {
    stopVideoPreview();
    
    if (!selectedCamera || !browser) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: selectedCamera } }
      });
      
      videoPreviewStream = stream;
      
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.play().catch(() => {});
      }
    } catch {
      // Ignore preview errors
    }
  }

  function stopVideoPreview() {
    if (videoEl) {
      videoEl.srcObject = null;
    }
    
    if (videoPreviewStream) {
      videoPreviewStream.getTracks().forEach(t => t.stop());
      videoPreviewStream = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────

  function handleInputChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    selectedInput = target.value;
    startAudioPreview();
  }

  function handleOutputChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    selectedOutput = target.value;
  }

  function handleCameraChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    selectedCamera = target.value;
    startVideoPreview();
  }

  function handleSave() {
    // Update preferences store
    voicePreferences.update(prefs => ({
      ...prefs,
      inputDeviceId: selectedInput || null,
      outputDeviceId: selectedOutput || null,
      cameraDeviceId: selectedCamera || null
    }));
    
    const devices = {
      inputDeviceId: selectedInput || null,
      outputDeviceId: selectedOutput || null,
      cameraDeviceId: selectedCamera || null
    };
    
    onSave?.(devices);
    dispatch('save', devices);
    handleClose();
  }

  function handleClose() {
    stopAudioPreview();
    stopVideoPreview();
    onClose?.();
    dispatch('close');
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  $effect(() => {
    if (open) {
      loadDevices();
    } else {
      stopAudioPreview();
      stopVideoPreview();
    }
  });

  onDestroy(() => {
    stopAudioPreview();
    stopVideoPreview();
  });
</script>

{#if open}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    aria-labelledby="device-picker-title"
    tabindex="-1"
  >
    <!-- Modal -->
    <div class="w-full max-w-lg rounded-xl bg-[color:var(--color-panel)] border border-[color:var(--color-border-subtle)] shadow-2xl overflow-hidden">
      <!-- Header -->
      <header class="flex items-center justify-between px-5 py-4 border-b border-[color:var(--color-border-subtle)]">
        <h2 id="device-picker-title" class="text-lg font-semibold text-[color:var(--color-text-primary)]">
          Audio & Video Settings
        </h2>
        <button
          onclick={handleClose}
          class="p-2 rounded-lg text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-panel-muted)] transition-colors"
          aria-label="Close"
        >
          <i class="bx bx-x text-xl"></i>
        </button>
      </header>

      <!-- Content -->
      <div class="p-5 space-y-6 max-h-[60vh] overflow-y-auto">
        {#if loading}
          <div class="flex items-center justify-center py-8">
            <i class="bx bx-loader-alt text-3xl text-[color:var(--color-text-secondary)] animate-spin"></i>
          </div>
        {:else if error}
          <div class="flex items-center gap-3 px-4 py-3 rounded-lg bg-rose-500/10 text-rose-300">
            <i class="bx bx-error-circle text-xl"></i>
            <span class="text-sm">{error}</span>
          </div>
        {:else}
          <!-- Microphone Selection -->
          <div class="space-y-3">
            <label for="mic-select" class="flex items-center gap-2 text-sm font-medium text-[color:var(--color-text-primary)]">
              <i class="bx bx-microphone text-lg text-[color:var(--color-text-secondary)]"></i>
              Microphone
            </label>
            
            <select
              id="mic-select"
              value={selectedInput}
              onchange={handleInputChange}
              class="w-full px-4 py-2.5 rounded-lg bg-[color:var(--color-panel-muted)] border border-[color:var(--color-border-subtle)] text-[color:var(--color-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent,#5865f2)]"
            >
              {#each audioInputs as device}
                <option value={device.deviceId}>{device.label}</option>
              {/each}
              {#if audioInputs.length === 0}
                <option value="" disabled>No microphones found</option>
              {/if}
            </select>

            <!-- Audio level meter -->
            <div class="flex items-center gap-3">
              <span class="text-xs text-[color:var(--color-text-secondary)]">Input level:</span>
              <div class="flex-1 h-2 rounded-full bg-[color:var(--color-panel-muted)] overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-75"
                  class:bg-emerald-500={audioLevel > 0}
                  class:bg-amber-500={audioLevel > 0.7}
                  class:bg-rose-500={audioLevel > 0.9}
                  style="width: {audioLevel * 100}%"
                ></div>
              </div>
            </div>
          </div>

          <!-- Speaker Selection -->
          {#if audioOutputs.length > 0}
            <div class="space-y-3">
              <label for="speaker-select" class="flex items-center gap-2 text-sm font-medium text-[color:var(--color-text-primary)]">
                <i class="bx bx-volume-full text-lg text-[color:var(--color-text-secondary)]"></i>
                Speaker
              </label>
              
              <select
                id="speaker-select"
                value={selectedOutput}
                onchange={handleOutputChange}
                class="w-full px-4 py-2.5 rounded-lg bg-[color:var(--color-panel-muted)] border border-[color:var(--color-border-subtle)] text-[color:var(--color-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent,#5865f2)]"
              >
                {#each audioOutputs as device}
                  <option value={device.deviceId}>{device.label}</option>
                {/each}
              </select>
            </div>
          {/if}

          <!-- Camera Selection -->
          <div class="space-y-3">
            <label for="camera-select" class="flex items-center gap-2 text-sm font-medium text-[color:var(--color-text-primary)]">
              <i class="bx bx-video text-lg text-[color:var(--color-text-secondary)]"></i>
              Camera
            </label>
            
            <select
              id="camera-select"
              value={selectedCamera}
              onchange={handleCameraChange}
              class="w-full px-4 py-2.5 rounded-lg bg-[color:var(--color-panel-muted)] border border-[color:var(--color-border-subtle)] text-[color:var(--color-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent,#5865f2)]"
            >
              {#each videoInputs as device}
                <option value={device.deviceId}>{device.label}</option>
              {/each}
              {#if videoInputs.length === 0}
                <option value="" disabled>No cameras found</option>
              {/if}
            </select>

            <!-- Video preview -->
            <div class="relative aspect-video rounded-lg bg-black overflow-hidden">
              <video
                bind:this={videoEl}
                class="w-full h-full object-cover"
                muted
                playsinline
              ></video>
              {#if !videoPreviewStream}
                <div class="absolute inset-0 flex items-center justify-center">
                  <div class="text-center text-[color:var(--color-text-secondary)]">
                    <i class="bx bx-video-off text-4xl mb-2"></i>
                    <p class="text-sm">Camera preview</p>
                  </div>
                </div>
              {/if}
            </div>

            <button
              onclick={() => videoPreviewStream ? stopVideoPreview() : startVideoPreview()}
              class="w-full px-4 py-2 rounded-lg text-sm font-medium text-[color:var(--color-text-primary)] bg-[color:var(--color-panel-muted)] hover:bg-[color:var(--color-card)] transition-colors"
            >
              {videoPreviewStream ? 'Stop Preview' : 'Test Camera'}
            </button>
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <footer class="flex items-center justify-end gap-3 px-5 py-4 border-t border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)]/50">
        <button
          onclick={handleClose}
          class="px-4 py-2 rounded-lg text-sm font-medium text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-panel-muted)] transition-colors"
        >
          Cancel
        </button>
        <button
          onclick={handleSave}
          class="px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
          disabled={loading}
        >
          Save Changes
        </button>
      </footer>
    </div>
  </div>
{/if}
