<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { getDb } from '$lib/firebase';
  import { voiceSession } from '$lib/stores/voice';
  import type { VoiceSession } from '$lib/stores/voice';
  import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
  import {
    appendVoiceDebugEvent,
    copyVoiceDebugAggregate,
    removeVoiceDebugSection,
    setVoiceDebugSection
  } from '$lib/utils/voiceDebugContext';

  export let serverId: string | null = null;
  export let session: VoiceSession | null = null;

  const CALL_DOC_ID = 'live';

  type VoiceParticipant = {
    uid: string;
    displayName?: string;
    photoURL?: string | null;
    hasAudio?: boolean;
    hasVideo?: boolean;
    status?: 'active' | 'left';
  };

  let participants: VoiceParticipant[] = [];
  let unsub: Unsubscribe | null = null;
  let copyStatus = '';
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  $: {
    unsub?.();
    participants = [];
    if (!session?.serverId || !session?.channelId) {
      unsub = null;
    } else {
      const db = getDb();
      const callDoc = doc(db, 'servers', session.serverId, 'channels', session.channelId, 'calls', CALL_DOC_ID);
      const ref = collection(callDoc, 'participants');
      unsub = onSnapshot(ref, (snap) => {
        const list: VoiceParticipant[] = snap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              uid: data.uid ?? d.id,
              displayName: data.displayName ?? 'Member',
              photoURL: data.photoURL ?? null,
              hasAudio: data.hasAudio ?? true,
              hasVideo: data.hasVideo ?? false,
              status: (data.status ?? 'active') as 'active' | 'left'
            };
          })
          .filter((p) => p.status !== 'left');
        participants = list;
        if (browser) {
          appendVoiceDebugEvent('mini-panel', 'participants snapshot', {
            serverId: session?.serverId ?? null,
            channelId: session?.channelId ?? null,
            count: list.length,
            participants: list.slice(0, 6).map((p) => ({
              uid: p.uid,
              hasAudio: p.hasAudio ?? true,
              hasVideo: p.hasVideo ?? false
            }))
          });
        }
      });
    }
  }

  onDestroy(() => {
    unsub?.();
    unsub = null;
    if (copyTimeout) {
      clearTimeout(copyTimeout);
      copyTimeout = null;
    }
    removeVoiceDebugSection('miniPanel.snapshot');
  });

  function leaveCall() {
    voiceSession.leave();
  }

  function openVoice() {
    voiceSession.setVisible(true);
  }

  async function copyDebug() {
    appendVoiceDebugEvent('mini-panel', 'copy debug requested', {
      serverId: session?.serverId ?? null,
      channelId: session?.channelId ?? null,
      participantCount: participants.length
    });
    const success = await copyVoiceDebugAggregate({ includeLogs: 50, includeEvents: 80 });
    copyStatus = success ? 'Debug info copied.' : 'Debug info logged to console.';
    if (copyTimeout) {
      clearTimeout(copyTimeout);
    }
    copyTimeout = setTimeout(() => {
      copyStatus = '';
    }, 4000);
  }

  function initials(name?: string) {
    if (!name) return '?';
    return name.trim().charAt(0).toUpperCase() || '?';
  }

  $: namesLine = participants.slice(0, 3).map((p) => p.displayName || 'Member').join(', ');
  $: serverLabel = session?.serverName ?? session?.serverId ?? 'Server';
  $: connectedElsewhere = !!session && !!serverId && session.serverId !== serverId;
  $: if (browser) {
    setVoiceDebugSection('miniPanel.snapshot', {
      serverId: session?.serverId ?? null,
      channelId: session?.channelId ?? null,
      channelName: session?.channelName ?? null,
      participantCount: participants.length,
      connectedElsewhere,
      participants: participants.slice(0, 8).map((p) => ({
        uid: p.uid,
        hasAudio: p.hasAudio ?? true,
        hasVideo: p.hasVideo ?? false
      }))
    });
  }
</script>

{#if session}
  <div class="voice-mini panel-muted border border-subtle rounded-2xl px-3 py-3 sm:px-4 sm:py-3">
    <div class="voice-mini__header">
      <div class="voice-mini__avatar">
        <i class="bx bx-headphone text-lg"></i>
      </div>
      <div class="min-w-0 flex-1">
        <div class="voice-mini__title">
          <span class="truncate text-sm font-semibold text-primary sm:text-base">#{session.channelName}</span>
          <span class="voice-mini__separator">/</span>
          <span class="text-[11px] uppercase tracking-wide text-soft sm:text-xs">{serverLabel}</span>
          {#if connectedElsewhere}
            <span class="voice-mini__tag voice-mini__tag--remote">Other server</span>
          {/if}
        </div>
        {#if namesLine}
          <div class="voice-mini__subtitle">{namesLine}</div>
        {/if}
      </div>
      <div class="voice-mini__actions">
        <button class="voice-mini__button" type="button" title="Open call" aria-label="Open call" on:click={openVoice}>
          <i class="bx bx-window-open text-lg"></i>
        </button>
        <button class="voice-mini__button voice-mini__button--danger" type="button" title="Leave call" aria-label="Leave call" on:click={leaveCall}>
          <i class="bx bx-phone-off text-lg"></i>
        </button>
      </div>
    </div>

    {#if participants.length}
      <div class="voice-mini__avatars">
        {#each participants.slice(0, 6) as p (p.uid)}
          <div class="voice-mini__avatar-chip">
            {#if p.photoURL}
              <img src={p.photoURL} alt={p.displayName} class="h-full w-full object-cover" loading="lazy" />
            {:else}
              <div class="grid h-full w-full place-items-center text-[11px] font-semibold text-primary">
                {initials(p.displayName)}
              </div>
            {/if}
            {#if p.hasAudio === false}
              <i class="bx bx-microphone-off voice-mini__badge voice-mini__badge--audio"></i>
            {/if}
            {#if p.hasVideo === false}
              <i class="bx bx-video-off voice-mini__badge voice-mini__badge--video"></i>
            {/if}
          </div>
        {/each}
        {#if participants.length > 6}
          <div class="voice-mini__more">+{participants.length - 6}</div>
        {/if}
      </div>
    {/if}

    <div class="voice-mini__footer">
      <div class="voice-mini__status">
        <span class="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-soft">
          <span class="relative flex h-2 w-2">
            <span class={`absolute inline-flex h-full w-full rounded-full opacity-75 ${participants.length ? 'bg-emerald-400 animate-ping' : 'bg-white/25'}`}></span>
            <span class={`relative inline-flex h-2 w-2 rounded-full ${participants.length ? 'bg-emerald-400' : 'bg-white/40'}`}></span>
          </span>
          {participants.length} connected
        </span>
        <button class="voice-mini__pill" type="button" on:click={openVoice}>
          Manage
        </button>
        <button class="voice-mini__pill" type="button" on:click={copyDebug} aria-label="Copy voice debug info">
          Copy debug
        </button>
        {#if copyStatus}
          <span class="voice-mini__feedback">{copyStatus}</span>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .voice-mini {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    overflow: hidden;
  }

  .voice-mini__header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .voice-mini__avatar {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.08);
    color: var(--color-text-primary);
  }

  .voice-mini__title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .voice-mini__separator {
    color: var(--text-50);
  }

  .voice-mini__tag {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.65rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-60);
  }

  .voice-mini__tag--remote {
    background: rgba(255, 255, 255, 0.12);
    color: var(--text-70);
  }

  .voice-mini__subtitle {
    font-size: 0.75rem;
    color: var(--text-55);
    margin-top: 0.15rem;
  }

  .voice-mini__actions {
    display: flex;
    gap: 0.5rem;
  }

  .voice-mini__button {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-70);
    transition: background 150ms ease, color 150ms ease;
  }

  .voice-mini__button:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  .voice-mini__button--danger {
    background: color-mix(in srgb, var(--color-danger) 18%, transparent);
    color: color-mix(in srgb, var(--color-danger) 80%, white);
  }

  .voice-mini__button--danger:hover {
    background: color-mix(in srgb, var(--color-danger) 28%, transparent);
  }

  .voice-mini__avatars {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .voice-mini__avatar-chip {
    position: relative;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 999px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.08);
  }

  .voice-mini__badge {
    position: absolute;
    font-size: 0.75rem;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  }

  .voice-mini__badge--audio {
    right: -2px;
    bottom: -2px;
    color: color-mix(in srgb, var(--color-danger) 80%, white);
  }

  .voice-mini__badge--video {
    left: -2px;
    top: -2px;
    color: rgba(255, 255, 255, 0.85);
  }

  .voice-mini__more {
    height: 2.25rem;
    display: grid;
    place-items: center;
    padding: 0 0.75rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-70);
    font-size: 0.75rem;
  }

  .voice-mini__footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .voice-mini__status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .voice-mini__pill {
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    padding: 0.4rem 0.9rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-60);
    background: transparent;
    transition: background 150ms ease, color 150ms ease;
  }

  .voice-mini__pill:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-80);
  }

  .voice-mini__feedback {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-60);
    margin-left: 0.35rem;
  }
</style>













