/**
 * Audio Level Detection Module
 * Implements speaking detection using Web Audio API with RMS calculation and noise gate.
 * Designed for fast, flicker-free speaking indicators like Guilded/Discord.
 */

import { browser } from '$app/environment';
import { writable, type Readable } from 'svelte/store';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SpeakingState {
  isSpeaking: boolean;
  level: number; // 0-1 normalized
  rawRms: number;
}

export interface AudioLevelConfig {
  /** RMS threshold to consider as "speaking" (0-1). Default: 0.015 */
  speakingThreshold: number;
  /** Milliseconds above threshold before marking as speaking. Default: 150 */
  activationDelayMs: number;
  /** Milliseconds below threshold before marking as not speaking. Default: 300 */
  deactivationDelayMs: number;
  /** FFT size for analysis. Default: 1024 */
  fftSize: number;
  /** Smoothing time constant for analyser (0-1). Default: 0.8 */
  smoothingTimeConstant: number;
  /** Maximum updates per second for callback. Default: 20 (50ms intervals) */
  maxUpdatesPerSecond: number;
}

export interface AudioLevelCallbacks {
  onSpeakingChange?: (isSpeaking: boolean, level: number) => void;
  onLevelUpdate?: (level: number, rawRms: number) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AudioLevelConfig = {
  speakingThreshold: 0.015,
  activationDelayMs: 150,
  deactivationDelayMs: 300,
  fftSize: 1024,
  smoothingTimeConstant: 0.8,
  maxUpdatesPerSecond: 20
};

// Noise floor - ignore signals below this level
const NOISE_FLOOR = 0.005;

// ─────────────────────────────────────────────────────────────────────────────
// AudioLevelMonitor Class
// ─────────────────────────────────────────────────────────────────────────────

export class AudioLevelMonitor {
  private config: AudioLevelConfig;
  private callbacks: AudioLevelCallbacks;
  
  // Web Audio nodes
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private dataArray: Uint8Array<ArrayBuffer> | null = null;
  
  // Animation frame
  private animationFrame: number | null = null;
  
  // Speaking detection state
  private isSpeaking = false;
  private lastSpokeAt = 0;
  private lastAboveThresholdAt = 0;
  private lastCallbackAt = 0;
  
  // Stores for reactive UI
  private _speakingState = writable<SpeakingState>({
    isSpeaking: false,
    level: 0,
    rawRms: 0
  });
  
  public speakingState: Readable<SpeakingState> = {
    subscribe: this._speakingState.subscribe
  };

  constructor(config: Partial<AudioLevelConfig> = {}, callbacks: AudioLevelCallbacks = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.callbacks = callbacks;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start monitoring audio levels from a MediaStream
   */
  start(stream: MediaStream): boolean {
    if (!browser || !stream) return false;
    
    // Stop any existing monitoring
    this.stop();
    
    // Check for audio tracks
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      console.warn('[AudioLevelMonitor] No audio tracks in stream');
      return false;
    }
    
    // Create AudioContext (handle iOS Safari autoplay restrictions)
    try {
      // Safari WebKit prefix support
      type WebkitWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
      const AudioContextClass = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
      if (!AudioContextClass) {
        console.error('[AudioLevelMonitor] AudioContext not supported');
        return false;
      }
      this.audioContext = new AudioContextClass();
      
      // Resume if suspended (iOS)
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
    } catch (err) {
      console.error('[AudioLevelMonitor] Failed to create AudioContext:', err);
      return false;
    }
    
    try {
      // Create analyser node
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.config.fftSize;
      this.analyser.smoothingTimeConstant = this.config.smoothingTimeConstant;
      
      // Create source from stream
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.source.connect(this.analyser);
      
      // Create data array for time-domain analysis
      this.dataArray = new Uint8Array(this.analyser.fftSize);
      
      // Start the analysis loop
      this.startAnalysisLoop();
      
      return true;
    } catch (err) {
      console.error('[AudioLevelMonitor] Failed to setup audio analysis:', err);
      this.cleanup();
      return false;
    }
  }

  /**
   * Stop monitoring and clean up resources
   */
  stop(): void {
    this.cleanup();
    this.resetState();
  }

  private cleanup(): void {
    // Cancel animation frame
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    
    // Disconnect nodes
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.source = null;
    }
    
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.analyser = null;
    }
    
    // Close audio context
    if (this.audioContext) {
      if (this.audioContext.state !== 'closed') {
        this.audioContext.close().catch(() => {});
      }
      this.audioContext = null;
    }
    
    this.dataArray = null;
  }

  private resetState(): void {
    const wasSpeaking = this.isSpeaking;
    this.isSpeaking = false;
    this.lastSpokeAt = 0;
    this.lastAboveThresholdAt = 0;
    
    this._speakingState.set({
      isSpeaking: false,
      level: 0,
      rawRms: 0
    });
    
    if (wasSpeaking) {
      this.callbacks.onSpeakingChange?.(false, 0);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Analysis Loop
  // ─────────────────────────────────────────────────────────────────────────

  private startAnalysisLoop(): void {
    const analyze = () => {
      if (!this.analyser || !this.dataArray) return;
      
      // Get time-domain data
      this.analyser.getByteTimeDomainData(this.dataArray);
      
      // Calculate RMS (Root Mean Square)
      const rms = this.calculateRms(this.dataArray);
      
      // Apply noise gate
      const gatedRms = rms < NOISE_FLOOR ? 0 : rms;
      
      // Normalize to 0-1 range (assuming max theoretical RMS is ~0.5 for 8-bit samples)
      const normalizedLevel = Math.min(1, gatedRms / 0.15);
      
      // Update speaking state with hysteresis
      this.updateSpeakingState(gatedRms, normalizedLevel);
      
      // Schedule next frame
      this.animationFrame = requestAnimationFrame(analyze);
    };
    
    this.animationFrame = requestAnimationFrame(analyze);
  }

  /**
   * Calculate Root Mean Square (RMS) of audio samples
   * RMS is a good measure of perceived loudness
   */
  private calculateRms(data: Uint8Array): number {
    let sumSquares = 0;
    
    for (let i = 0; i < data.length; i++) {
      // Convert from 0-255 to -1 to 1 range
      const normalized = (data[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    
    return Math.sqrt(sumSquares / data.length);
  }

  /**
   * Update speaking state with activation/deactivation delays to prevent flicker
   */
  private updateSpeakingState(rawRms: number, normalizedLevel: number): void {
    const now = performance.now();
    const isAboveThreshold = rawRms > this.config.speakingThreshold;
    
    if (isAboveThreshold) {
      this.lastAboveThresholdAt = now;
    }
    
    // Determine new speaking state
    let newSpeaking = this.isSpeaking;
    
    if (!this.isSpeaking) {
      // Not currently speaking - check if we should start
      // Only start speaking if above threshold for activation delay
      if (isAboveThreshold) {
        if (now - this.lastAboveThresholdAt >= this.config.activationDelayMs || 
            this.lastAboveThresholdAt === now) {
          // First frame above threshold or been above long enough
          const timeSinceFirstAbove = this.lastSpokeAt > 0 
            ? now - this.lastSpokeAt 
            : this.config.activationDelayMs;
          
          if (timeSinceFirstAbove >= this.config.activationDelayMs) {
            newSpeaking = true;
          }
        }
        this.lastSpokeAt = this.lastSpokeAt || now;
      } else {
        this.lastSpokeAt = 0;
      }
    } else {
      // Currently speaking - check if we should stop
      // Only stop if below threshold for deactivation delay
      if (!isAboveThreshold) {
        const timeSinceSpoke = now - this.lastAboveThresholdAt;
        if (timeSinceSpoke >= this.config.deactivationDelayMs) {
          newSpeaking = false;
          this.lastSpokeAt = 0;
        }
      }
    }
    
    // Update state
    const stateChanged = newSpeaking !== this.isSpeaking;
    this.isSpeaking = newSpeaking;
    
    // Update store
    this._speakingState.set({
      isSpeaking: this.isSpeaking,
      level: normalizedLevel,
      rawRms
    });
    
    // Rate-limit callbacks
    const minCallbackInterval = 1000 / this.config.maxUpdatesPerSecond;
    const shouldCallback = now - this.lastCallbackAt >= minCallbackInterval;
    
    if (stateChanged) {
      this.callbacks.onSpeakingChange?.(this.isSpeaking, normalizedLevel);
      this.lastCallbackAt = now;
    } else if (shouldCallback) {
      this.callbacks.onLevelUpdate?.(normalizedLevel, rawRms);
      this.lastCallbackAt = now;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update configuration on the fly
   */
  updateConfig(config: Partial<AudioLevelConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Update analyser if active
    if (this.analyser) {
      if (config.fftSize !== undefined) {
        this.analyser.fftSize = config.fftSize;
        this.dataArray = new Uint8Array(config.fftSize);
      }
      if (config.smoothingTimeConstant !== undefined) {
        this.analyser.smoothingTimeConstant = config.smoothingTimeConstant;
      }
    }
  }

  /**
   * Get current speaking state
   */
  getState(): SpeakingState {
    return {
      isSpeaking: this.isSpeaking,
      level: 0, // Would need to read from analyser
      rawRms: 0
    };
  }

  /**
   * Check if monitor is active
   */
  isActive(): boolean {
    return this.analyser !== null && this.audioContext?.state === 'running';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-participant Speaking Manager
// ─────────────────────────────────────────────────────────────────────────────

export interface ParticipantSpeakingState {
  participantId: string;
  isSpeaking: boolean;
  level: number;
  lastActiveAt: number;
}

/**
 * Manages speaking detection for multiple participants
 */
export class SpeakingManager {
  private monitors = new Map<string, AudioLevelMonitor>();
  private states = new Map<string, ParticipantSpeakingState>();
  private _speakingParticipants = writable<Set<string>>(new Set());
  private _activeSpeaker = writable<string | null>(null);
  
  public speakingParticipants: Readable<Set<string>> = {
    subscribe: this._speakingParticipants.subscribe
  };
  
  public activeSpeaker: Readable<string | null> = {
    subscribe: this._activeSpeaker.subscribe
  };

  private config: Partial<AudioLevelConfig>;
  private onSpeakingChangeCallback?: (participantId: string, isSpeaking: boolean) => void;

  constructor(
    config: Partial<AudioLevelConfig> = {},
    onSpeakingChange?: (participantId: string, isSpeaking: boolean) => void
  ) {
    this.config = config;
    this.onSpeakingChangeCallback = onSpeakingChange;
  }

  /**
   * Start monitoring a participant's audio stream
   */
  addParticipant(participantId: string, stream: MediaStream): boolean {
    // Remove existing monitor if any
    this.removeParticipant(participantId);
    
    const monitor = new AudioLevelMonitor(this.config, {
      onSpeakingChange: (isSpeaking, level) => {
        this.handleSpeakingChange(participantId, isSpeaking, level);
      }
    });
    
    const started = monitor.start(stream);
    if (!started) {
      return false;
    }
    
    this.monitors.set(participantId, monitor);
    this.states.set(participantId, {
      participantId,
      isSpeaking: false,
      level: 0,
      lastActiveAt: 0
    });
    
    return true;
  }

  /**
   * Stop monitoring a participant
   */
  removeParticipant(participantId: string): void {
    const monitor = this.monitors.get(participantId);
    if (monitor) {
      monitor.stop();
      this.monitors.delete(participantId);
    }
    
    this.states.delete(participantId);
    this.updateSpeakingSet();
  }

  /**
   * Stop all monitors
   */
  cleanup(): void {
    this.monitors.forEach(monitor => monitor.stop());
    this.monitors.clear();
    this.states.clear();
    this._speakingParticipants.set(new Set());
    this._activeSpeaker.set(null);
  }

  private handleSpeakingChange(participantId: string, isSpeaking: boolean, level: number): void {
    const state = this.states.get(participantId);
    if (!state) return;
    
    state.isSpeaking = isSpeaking;
    state.level = level;
    
    if (isSpeaking) {
      state.lastActiveAt = Date.now();
    }
    
    this.updateSpeakingSet();
    this.updateActiveSpeaker();
    
    this.onSpeakingChangeCallback?.(participantId, isSpeaking);
  }

  private updateSpeakingSet(): void {
    const speaking = new Set<string>();
    this.states.forEach((state, id) => {
      if (state.isSpeaking) {
        speaking.add(id);
      }
    });
    this._speakingParticipants.set(speaking);
  }

  private updateActiveSpeaker(): void {
    // Find the most recently active speaker
    let activeSpeaker: string | null = null;
    let latestTime = 0;
    
    this.states.forEach((state) => {
      if (state.isSpeaking && state.lastActiveAt > latestTime) {
        latestTime = state.lastActiveAt;
        activeSpeaker = state.participantId;
      }
    });
    
    this._activeSpeaker.set(activeSpeaker);
  }

  /**
   * Get speaking state for a participant
   */
  getParticipantState(participantId: string): ParticipantSpeakingState | null {
    return this.states.get(participantId) ?? null;
  }

  /**
   * Check if a participant is speaking
   */
  isParticipantSpeaking(participantId: string): boolean {
    return this.states.get(participantId)?.isSpeaking ?? false;
  }

  /**
   * Get all currently speaking participant IDs
   */
  getSpeakingParticipants(): string[] {
    const speaking: string[] = [];
    this.states.forEach((state, id) => {
      if (state.isSpeaking) {
        speaking.push(id);
      }
    });
    return speaking;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Shared AudioContext
// ─────────────────────────────────────────────────────────────────────────────

let sharedAudioContext: AudioContext | null = null;

/**
 * Get or create a shared AudioContext for the app
 * Useful for reducing resource usage when multiple features need audio processing
 */
export function getSharedAudioContext(): AudioContext | null {
  if (!browser) return null;
  
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    try {
      type WebkitWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
      const AudioContextClass = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
      if (!AudioContextClass) return null;
      sharedAudioContext = new AudioContextClass();
    } catch {
      return null;
    }
  }
  
  // Resume if suspended
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(() => {});
  }
  
  return sharedAudioContext;
}

/**
 * Resume the shared AudioContext (call on user gesture for iOS)
 */
export async function resumeSharedAudioContext(): Promise<boolean> {
  const ctx = getSharedAudioContext();
  if (!ctx) return false;
  
  try {
    await ctx.resume();
    return ctx.state === 'running';
  } catch {
    return false;
  }
}
