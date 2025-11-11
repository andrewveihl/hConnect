<script lang="ts">
  import { run } from 'svelte/legacy';

  import { createEventDispatcher, onDestroy } from 'svelte';
  import { getDb } from '$lib/firebase';
  import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
  import { resolveProfilePhotoURL } from '$lib/utils/profile';
  import { copyTextToClipboard } from '$lib/utils/clipboard';

  const CALL_DOC_ID = 'live';

  type ParticipantPreview = {
    uid: string;
    displayName: string;
    photoURL: string | null;
    status: 'active' | 'left';
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
    joinVoice: void;
    startStreaming: void;
    returnToSession: void;
  }>();

  let participants: ParticipantPreview[] = $state([]);
  let unsub: Unsubscribe | null = $state(null);
  let copyStatus = '';
  let copyTimer: ReturnType<typeof setTimeout> | null = null;




  onDestroy(() => {
    unsub?.();
    if (copyTimer) {
      clearTimeout(copyTimer);
      copyTimer = null;
    }
  });

  function initials(name?: string) {
    if (!name) return '?';
    const trimmed = name.trim();
    if (!trimmed.length) return '?';
    return trimmed.charAt(0).toUpperCase();
  }

  function handleJoin() {
    dispatch('joinVoice');
  }

  function handleReturnToSession() {
    dispatch('returnToSession');
  }

  async function handleCopyInvite() {
    if (!inviteUrl) return;
    const result = await copyTextToClipboard(inviteUrl);
    copyStatus = result.success ? 'Invite copied!' : 'Unable to copy invite.';
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copyStatus = '';
      copyTimer = null;
    }, 2400);
  }

  function handleStartStreaming() {
    dispatch('startStreaming');
  }
  let connectedElsewhere =
    $derived(Boolean(connectedChannelId) &&
    (connectedChannelId !== channelId || (connectedServerId && connectedServerId !== serverId)));
  run(() => {
    unsub?.();
    participants = [];
    if (!serverId || !channelId) {
      unsub = null;
    } else {
      const database = getDb();
      const callDoc = doc(database, 'servers', serverId, 'channels', channelId, 'calls', CALL_DOC_ID);
      const ref = collection(callDoc, 'participants');
      unsub = onSnapshot(ref, (snap) => {
        participants = snap.docs
          .map((entry) => {
            const data = entry.data() as any;
            return {
              uid: data.uid ?? entry.id,
              displayName: data.displayName ?? 'Member',
              photoURL: resolveProfilePhotoURL(data),
              status: (data.status ?? 'active') as 'active' | 'left'
            };
          })
          .filter((participant) => participant.status === 'active');
      });
    }
  });
  let participantCount = $derived(participants.length);
  let displayedParticipants = $derived(participants.slice(0, 5));
  let overflowCount = $derived(Math.max(participantCount - displayedParticipants.length, 0));
  let previewAvatarUrl = $derived(currentUserAvatar ?? displayedParticipants[0]?.photoURL ?? null);
  let previewInitial = $derived(initials(currentUserName ?? displayedParticipants[0]?.displayName ?? channelName));
</script>

<section class="voice-lobby" aria-live="polite">
  {#if connectedElsewhere}
    <div class="voice-lobby__notice">
      <div class="voice-lobby__notice-icon">
        <i class="bx bx-info-circle"></i>
      </div>
      <div class="voice-lobby__notice-body">
        <p>
          You're still connected to
          <strong>#{connectedChannelName ?? 'another channel'}</strong>
          {#if connectedServerName}
            in {connectedServerName}
          {/if}
          . Joining here will switch you over.
        </p>
        <button type="button" class="voice-lobby__pill" onclick={handleReturnToSession}>
          Return to current call
        </button>
      </div>
    </div>
  {/if}

  <div class="voice-lobby__body">
    <div class="voice-lobby__preview">
      <div class="voice-lobby__preview-media">
        <div class="voice-lobby__preview-outer-glow"></div>
        <div class="voice-lobby__preview-avatar">
          {#if previewAvatarUrl}
            <img src={previewAvatarUrl} alt="" />
          {:else}
            <span>{previewInitial}</span>
          {/if}
        </div>
      </div>
    </div>

    <div class="voice-lobby__participants">
      {#if participantCount}
        <div class="voice-lobby__avatar-stack">
          {#each displayedParticipants as participant (participant.uid)}
            <div class="voice-lobby__avatar" title={participant.displayName}>
              {#if participant.photoURL}
                <img src={participant.photoURL} alt={participant.displayName} />
              {:else}
                <span>{initials(participant.displayName)}</span>
              {/if}
            </div>
          {/each}
          {#if overflowCount}
            <div class="voice-lobby__avatar voice-lobby__avatar--more">
              +{overflowCount}
            </div>
          {/if}
        </div>
      {:else}
        <div class="voice-lobby__participants-empty">
          <i class="bx bx-planet"></i>
          <span>Waiting for the first person to hop in.</span>
        </div>
      {/if}
    </div>

    <div class="voice-lobby__actions">
      <div class="voice-lobby__primary">
        <button type="button" class="voice-lobby__btn voice-lobby__btn--accent" onclick={handleStartStreaming}>
          <i class="bx bx-broadcast"></i>
          <span>Start streaming</span>
          <i class="bx bx-chevron-down caret"></i>
        </button>
        <button type="button" class="voice-lobby__btn voice-lobby__btn--outline" onclick={handleJoin}>
          <i class="bx bx-headphone"></i>
          <span>Join voice</span>
        </button>
      </div>

    </div>
  </div>
</section>

<style>
  .voice-lobby {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
    border-radius: 1.5rem;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-panel-muted) 88%, transparent),
      color-mix(in srgb, var(--color-panel) 96%, transparent)
    );
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
    box-shadow:
      var(--shadow-elevated),
      inset 0 1px 0 color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  }

  .voice-lobby__notice {
    display: flex;
    gap: 0.75rem;
    padding: 0.9rem 1.1rem;
    border-radius: 1rem;
    border: 1px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }

  .voice-lobby__notice-icon {
    font-size: 1.4rem;
    color: color-mix(in srgb, var(--color-accent) 85%, white);
  }

  .voice-lobby__notice-body {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    color: var(--text-80);
    font-size: 0.95rem;
  }

  .voice-lobby__pill {
    align-self: flex-start;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    background: transparent;
    color: var(--text-80);
    padding: 0.35rem 1rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.65rem;
  }

  .voice-lobby__body {
    display: flex;
    flex-direction: column;
    gap: 1.35rem;
    padding: 0.5rem 0 0.25rem;
  }

  .voice-lobby__preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 1rem;
    width: 100%;
  }

  .voice-lobby__preview-media {
    position: relative;
    width: min(380px, 100%);
    min-height: 220px;
    aspect-ratio: 16 / 10;
    border-radius: clamp(1.2rem, 3vw, 2.2rem);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--color-card) 90%, transparent),
      color-mix(in srgb, var(--color-panel) 95%, transparent)
    );
    display: grid;
    place-items: center;
    overflow: hidden;
    margin: 0 auto;
  }

  .voice-lobby__preview-outer-glow {
    position: absolute;
    inset: -30%;
    background: radial-gradient(
      circle,
      color-mix(in srgb, var(--color-text-primary) 15%, transparent),
      transparent 65%
    );
    opacity: 0.4;
  }

  .voice-lobby__preview-avatar {
    position: relative;
    width: clamp(120px, 20vw, 160px);
    height: clamp(120px, 20vw, 160px);
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 75%, transparent);
    background: color-mix(in srgb, var(--color-panel-muted) 60%, transparent);
    display: grid;
    place-items: center;
    overflow: hidden;
  }

  .voice-lobby__preview-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .voice-lobby__preview-avatar span {
    font-size: 2rem;
    color: var(--text-90);
    font-weight: 600;
  }

  .voice-lobby__participants {
    border-radius: 1rem;
    border: 1px dashed color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    padding: 1.1rem;
    background: color-mix(in srgb, var(--color-panel-muted) 45%, transparent);
  }

  .voice-lobby__avatar-stack {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .voice-lobby__avatar {
    width: 46px;
    height: 46px;
    border-radius: 999px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
    display: grid;
    place-items: center;
    font-weight: 600;
    color: var(--text-80);
  }

  .voice-lobby__avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .voice-lobby__avatar--more {
    font-size: 0.9rem;
  }

  .voice-lobby__participants-empty {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.95rem;
    color: var(--text-60);
  }

  .voice-lobby__participants-empty i {
    font-size: 1.2rem;
  }

  .voice-lobby__actions {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: center;
    text-align: center;
  }

  .voice-lobby__primary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    justify-content: center;
  }

  .voice-lobby__btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    border-radius: 0.8rem;
    border: 1px solid transparent;
    font-size: 0.95rem;
    font-weight: 600;
    padding: 0.85rem 1.4rem;
    transition: transform 120ms ease, background 150ms ease, border-color 150ms ease;
  }

  .voice-lobby__btn--accent {
    background: radial-gradient(circle at top, color-mix(in srgb, var(--color-accent) 75%, transparent), color-mix(in srgb, var(--color-accent) 40%, transparent));
    border-color: color-mix(in srgb, var(--color-accent) 65%, transparent);
    color: color-mix(in srgb, var(--color-accent) 95%, white);
    box-shadow:
      0 12px 28px color-mix(in srgb, var(--color-panel-muted) 45%, transparent),
      inset 0 1px 0 color-mix(in srgb, var(--color-text-primary) 18%, transparent);
  }

  .voice-lobby__btn--accent:hover {
    transform: translateY(-1px);
  }

  .voice-lobby__btn--outline {
    border-color: color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    color: var(--text-90);
    background: color-mix(in srgb, var(--color-panel-muted) 45%, transparent);
  }

  .voice-lobby__btn--outline:hover {
    border-color: color-mix(in srgb, var(--color-border-subtle) 85%, transparent);
  }

  .voice-lobby__btn .caret {
    font-size: 1.2rem;
  }

  @media (max-width: 768px) {
    .voice-lobby {
      padding: 1.1rem;
      border-radius: 1.1rem;
    }

    .voice-lobby__body {
      padding: 0.25rem 0 0;
    }

    .voice-lobby__preview {
      align-items: center;
    }

    .voice-lobby__preview-media {
      margin-left: auto;
      margin-right: auto;
    }

    .voice-lobby__preview-avatar {
      margin-left: auto;
      margin-right: auto;
    }

    .voice-lobby__btn {
      width: 100%;
      justify-content: center;
    }

    .voice-lobby__primary {
      flex-direction: column;
    }

  }
</style>
