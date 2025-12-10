<script lang="ts">
  import { run } from 'svelte/legacy';

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
  import { resolveProfilePhotoURL } from '$lib/utils/profile';
  import { voiceClientState, invokeVoiceClientControl } from '$lib/stores/voiceClient';

  interface Props {
    serverId?: string | null;
    session?: VoiceSession | null;
  }

  let { serverId = null, session = null }: Props = $props();

  const CALL_DOC_ID = 'live';

  type VoiceParticipant = {
    uid: string;
    displayName?: string;
    photoURL?: string | null;
    hasAudio?: boolean;
    hasVideo?: boolean;
    status?: 'active' | 'left';
  };

  let participants: VoiceParticipant[] = $state([]);
  let unsub: Unsubscribe | null = $state(null);
  let copyStatus = $state('');
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  const callState = $derived($voiceClientState);

  run(() => {
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
              photoURL: resolveProfilePhotoURL(data),
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
  });

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

  function toggleMute() {
    invokeVoiceClientControl('toggleMute');
  }

  function toggleDeafen() {
    invokeVoiceClientControl('toggleDeafen');
  }

  let namesLine = $derived(participants.slice(0, 3).map((p) => p.displayName || 'Member').join(', '));
  let serverLabel = $derived(session?.serverName ?? session?.serverId ?? 'Server');
  let connectedElsewhere = $derived(!!session && !!serverId && session.serverId !== serverId);
  run(() => {
    if (browser) {
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
  });
</script>

{#if session}
  <div class="rounded-2xl border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel)]/90 p-3 shadow-xl backdrop-blur">
    <div class="flex flex-wrap items-center gap-3">
      <div class="relative grid h-12 w-12 place-items-center rounded-2xl bg-[color:var(--color-panel-muted)]">
        <i class="bx bx-headphone text-lg text-[color:var(--color-text-primary)]"></i>
        <span class="absolute -right-1 -bottom-1 inline-flex h-3 w-3 items-center justify-center rounded-full bg-[color:var(--color-panel)] shadow-inner">
          <span class={`h-2 w-2 rounded-full ${callState.connected ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
        </span>
      </div>
      <div class="min-w-0 flex-1 space-y-0.5">
        <div class="flex flex-wrap items-center gap-2">
          <span class="truncate text-sm font-semibold text-[color:var(--color-text-primary)]">#{session.channelName}</span>
          <span class="text-[11px] uppercase tracking-wide text-[color:var(--color-text-tertiary)]">{serverLabel}</span>
          {#if connectedElsewhere}
            <span class="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
              Other server
            </span>
          {/if}
        </div>
        <div class="flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-text-secondary)]">
          <span class="inline-flex items-center gap-1">
            <span class={`h-2 w-2 rounded-full ${callState.connected ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
            <span>{callState.connected ? 'Voice connected' : 'Reconnecting...'}</span>
          </span>
          <span class="rounded-full bg-[color:var(--color-panel-muted)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-text-secondary)]">
            {participants.length} in call
          </span>
          {#if namesLine}
            <span class="truncate">• {namesLine}</span>
          {/if}
        </div>
      </div>
      <div class="flex items-center gap-1">
        <button
          class={`inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] text-[color:var(--color-text-primary)] transition hover:border-[color:var(--color-accent)] ${callState.muted ? 'opacity-90' : ''}`}
          type="button"
          title={callState.muted ? 'Unmute' : 'Mute'}
          aria-pressed={!callState.muted}
          onclick={toggleMute}
        >
          <i class={`bx ${callState.muted ? 'bx-microphone-off' : 'bx-microphone'} text-lg`}></i>
        </button>
        <button
          class={`inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] text-[color:var(--color-text-primary)] transition hover:border-[color:var(--color-accent)] ${callState.deafened ? 'opacity-90' : ''}`}
          type="button"
          title={callState.deafened ? 'Undeafen' : 'Deafen'}
          aria-pressed={!callState.deafened}
          onclick={toggleDeafen}
        >
          <i class={`bx ${callState.deafened ? 'bx-volume-mute' : 'bx-volume-full'} text-lg`}></i>
        </button>
        <button
          class="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] text-[color:var(--color-text-primary)] transition hover:border-[color:var(--color-accent)]"
          type="button"
          title="Return to call"
          aria-label="Return to call"
          onclick={openVoice}
        >
          <i class="bx bx-window-open text-lg"></i>
        </button>
        <button
          class="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--color-danger,#ef4444)]/60 bg-[color:var(--color-danger,#ef4444)]/15 text-[color:var(--color-danger,#ef4444)] transition hover:bg-[color:var(--color-danger,#ef4444)]/25"
          type="button"
          title="Leave call"
          aria-label="Leave call"
          onclick={leaveCall}
        >
          <i class="bx bx-phone-off text-lg"></i>
        </button>
      </div>
    </div>

    {#if participants.length}
      <div class="mt-3 flex flex-wrap items-center gap-2">
        {#each participants.slice(0, 6) as p (p.uid)}
          <div class="relative h-9 w-9 overflow-hidden rounded-full border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)]">
            {#if p.photoURL}
              <img src={p.photoURL} alt={p.displayName} class="h-full w-full object-cover" loading="lazy" />
            {:else}
              <div class="grid h-full w-full place-items-center text-[11px] font-semibold text-[color:var(--color-text-primary)]">
                {initials(p.displayName)}
              </div>
            {/if}
            {#if p.hasAudio === false}
              <i class="bx bx-microphone-off absolute -right-1 -bottom-1 rounded-full bg-[color:var(--color-panel)] px-1 text-[10px] text-rose-200 shadow"></i>
            {/if}
          </div>
        {/each}
        {#if participants.length > 6}
          <div class="h-9 px-3 inline-flex items-center justify-center rounded-full border border-dashed border-[color:var(--color-border-subtle)] text-[11px] font-semibold text-[color:var(--color-text-secondary)]">
            +{participants.length - 6}
          </div>
        {/if}
      </div>
    {/if}

    <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-text-tertiary)]">
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] px-2 py-1 text-[color:var(--color-text-secondary)] transition hover:border-[color:var(--color-accent)]"
        onclick={copyDebug}
      >
        <i class="bx bx-clipboard text-xs"></i>
        <span>Copy debug</span>
      </button>
      {#if copyStatus}
        <span class="text-[color:var(--color-text-primary)]">{copyStatus}</span>
      {/if}
    </div>
  </div>
{/if}
