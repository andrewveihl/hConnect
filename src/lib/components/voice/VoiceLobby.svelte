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
    hasAudio?: boolean;
    hasVideo?: boolean;
    screenSharing?: boolean;
    streamId?: string | null;
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
    joinVoice: { muted?: boolean; videoOff?: boolean };
    joinMuted: { muted?: boolean; videoOff?: boolean };
    startStreaming: { muted?: boolean; videoOff?: boolean };
    returnToSession: void;
    openChat: void;
  }>();

  let participants: ParticipantPreview[] = $state([]);
  let unsub: Unsubscribe | null = $state(null);
  let copyStatus = $state('');
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let muteOnJoin = $state(false);
  let videoOffOnJoin = $state(false);

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
    dispatch('joinVoice', { muted: muteOnJoin, videoOff: videoOffOnJoin });
  }

  function handleJoinMuted() {
    dispatch('joinMuted', { muted: true, videoOff: videoOffOnJoin });
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
    dispatch('startStreaming', { muted: muteOnJoin, videoOff: false });
  }

  function handleOpenChat() {
    dispatch('openChat');
  }

  function toggleMute() {
    muteOnJoin = !muteOnJoin;
  }

  function toggleVideo() {
    videoOffOnJoin = !videoOffOnJoin;
  }

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
              status: (data.status ?? 'active') as 'active' | 'left',
              hasAudio: data.hasAudio ?? true,
              hasVideo: data.hasVideo ?? false,
              screenSharing: data.screenSharing ?? false,
              streamId: data.streamId ?? null
            };
          })
          .filter((participant) => participant.status === 'active');
      });
    }
  });

  const connectedElsewhere = $derived(
    Boolean(
      connectedChannelId &&
        (connectedChannelId !== channelId || (connectedServerId && connectedServerId !== serverId))
    )
  );

  let participantCount = $derived(participants.length);
  let videoCount = $derived(participants.filter((p) => p.hasVideo).length);
  let streamCount = $derived(participants.filter((p) => p.screenSharing).length);
  let displayedParticipants = $derived(participants.slice(0, 5));
  let overflowCount = $derived(Math.max(participantCount - displayedParticipants.length, 0));
  let previewImage = $derived(
    currentUserAvatar || displayedParticipants[0]?.photoURL || participants[0]?.photoURL || null
  );
  let callGridCols = $derived(Math.min(3, Math.max(1, participantCount || 1)));
</script>

<div class="lobby" aria-live="polite">
  {#if connectedElsewhere}
    <div class="lobby-alert">
      <div class="lobby-alert__icon"><i class="bx bx-info-circle"></i></div>
      <div class="lobby-alert__body">
        <p class="lobby-alert__title">You're already in #{connectedChannelName ?? 'another channel'}.</p>
        <p class="lobby-alert__desc">Returning will bring that call forward.</p>
      </div>
      <button type="button" class="lobby-alert__btn" onclick={handleReturnToSession}>Return</button>
    </div>
  {/if}

  <div class="call-grid-wrapper">
    <div
      class={`call-grid call-grid--preview ${participantCount === 1 ? 'call-grid--single' : ''}`}
      style={`--call-grid-cols:${callGridCols}`}
    >
      {#if participantCount}
        {#each displayedParticipants as participant (participant.uid)}
          <div class="call-tile">
            <div class="call-tile__media">
              {#if participant.photoURL}
                <div class="call-tile__bg" style:background-image={`url(${participant.photoURL})`}></div>
              {/if}
              <div class="call-tile__scrim"></div>
              <div class="call-avatar call-avatar--center">
                <div class="call-avatar__image">
                  {#if participant.photoURL}
                    <img src={participant.photoURL} alt={participant.displayName} loading="lazy" />
                  {:else}
                    <span>{initials(participant.displayName)}</span>
                  {/if}
                </div>
                {#if participant.screenSharing}
                  <span class="call-tile__footer-pill call-tile__footer-pill--share">Live</span>
                {/if}
              </div>
            </div>
            <div class="call-tile__footer">
              <div class="call-tile__footer-name">
                <span>{participant.displayName}</span>
              </div>
              <div class="call-tile__footer-icons">
                <i class={`bx ${participant.hasVideo ? 'bx-video' : 'bx-video-off is-off'}`}></i>
                <i class={`bx ${participant.hasAudio === false ? 'bx-microphone-off is-off' : 'bx-microphone'}`}></i>
              </div>
            </div>
          </div>
        {/each}
        {#if overflowCount}
          <div class="call-tile call-tile--empty">
            <div class="call-tile__media">
              <div class="call-empty-msg">+{overflowCount} more getting ready</div>
            </div>
          </div>
        {/if}
      {:else}
        <div class="call-tile call-tile--empty call-tile--spacer">
          <div class="call-tile__media">
            <div class="call-empty-msg">
              <i class="bx bx-planet"></i>
              <p>Waiting for someone to hop in.</p>
              <span>You're not in the call yet.</span>
            </div>
          </div>
        </div>
      {/if}
    </div>
    <div class="preview-actions">
      <div class="toggle-row toggle-row--actions">
        <button
          type="button"
          class={`icon-toggle ${videoOffOnJoin ? '' : 'is-active'}`}
          aria-pressed={!videoOffOnJoin}
          onclick={toggleVideo}
          title={videoOffOnJoin ? 'Camera off' : 'Camera on'}
        >
          <i class={`bx ${videoOffOnJoin ? 'bx-video-off' : 'bx-video'}`}></i>
        </button>
        <button
          type="button"
          class={`icon-toggle ${muteOnJoin ? '' : 'is-active'}`}
          aria-pressed={!muteOnJoin}
          onclick={toggleMute}
          title={muteOnJoin ? 'Muted' : 'Mic on'}
        >
          <i class={`bx ${muteOnJoin ? 'bx-microphone-off' : 'bx-microphone'}`}></i>
        </button>
        <button
          type="button"
          class="icon-toggle icon-toggle--join"
          onclick={handleJoin}
          title="Join call"
        >
          <i class="bx bx-phone-call"></i>
          <span class="sr-only">Join call</span>
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .lobby {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .lobby-alert {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.6rem;
    align-items: center;
    padding: 0.65rem 0.8rem;
    border-radius: 0.75rem;
    border: 1px solid color-mix(in srgb, var(--color-accent) 60%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-accent-soft, #1e293b) 60%, transparent);
  }

  .lobby-alert__icon {
    color: var(--color-accent);
    font-size: 1.2rem;
  }

  .lobby-alert__body {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .lobby-alert__title {
    margin: 0;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  .lobby-alert__desc {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: 0.9rem;
  }

  .lobby-alert__btn {
    border: 1px solid color-mix(in srgb, var(--color-accent) 60%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-panel) 60%, transparent);
    color: var(--color-text-primary);
    border-radius: 0.6rem;
    padding: 0.4rem 0.8rem;
    font-weight: 700;
    cursor: pointer;
  }

  .call-grid {
    display: grid;
    grid-template-columns: repeat(var(--call-grid-cols, 1), minmax(0, 1fr));
    gap: 0.65rem;
    align-items: stretch;
    align-content: center;
    justify-items: stretch;
    width: 100%;
    max-width: calc(var(--call-grid-cols, 1) * 780px);
    margin: 0 auto;
  }

.call-grid--single {
  grid-template-columns: minmax(0, 640px);
  max-width: 640px;
  justify-content: center;
}

.call-grid-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: clamp(420px, 70vh, 820px);
}

@media (min-width: 1200px) {
  .call-grid--preview {
    grid-template-columns: repeat(var(--call-grid-cols, 1), minmax(0, 1fr));
    max-width: calc(var(--call-grid-cols, 1) * 820px);
  }
    .call-grid--single {
      grid-template-columns: minmax(0, 720px);
      max-width: 720px;
    }
  }

  .call-tile {
    position: relative;
    border-radius: 0.65rem;
    overflow: hidden;
    background: color-mix(in srgb, var(--color-panel) 75%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    display: flex;
    flex-direction: column;
    transition: box-shadow 0.16s ease, border-color 0.16s ease, transform 120ms ease;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
    --call-tile-aspect: 16 / 9;
    min-height: clamp(200px, 28vw, 360px);
    aspect-ratio: var(--call-tile-aspect, 16 / 9);
  }

  .call-tile:hover {
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
    border-color: color-mix(in srgb, #ffffff 10%, rgba(54, 57, 63, 0.7));
  }

  .call-tile--self {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 32%, transparent);
  }

  .call-tile__media {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--color-panel-muted) 72%, rgba(0, 0, 0, 0.4));
    overflow: hidden;
  }

  .call-tile__bg {
    position: absolute;
    inset: 0;
    background-position: center;
    background-size: cover;
    filter: blur(18px);
    transform: scale(1.05);
    opacity: 0.85;
  }

  .call-tile__scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.22), rgba(0, 0, 0, 0.4));
  }

  .call-avatar {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem;
    color: var(--text-70);
    transform: none;
  }

  .call-avatar--center {
    margin: auto;
  }

  .call-avatar__image {
    width: clamp(56px, 10vw, 96px);
    height: clamp(56px, 10vw, 96px);
    border-radius: 999px;
    overflow: hidden;
    border: 2px solid rgba(255, 255, 255, 0.08);
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--color-panel) 55%, transparent);
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-80);
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.03);
    text-transform: uppercase;
  }

  .call-avatar__image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .call-avatar__hint {
    text-transform: uppercase;
    font-size: 0.72rem;
    letter-spacing: 0.14em;
    color: var(--text-50);
  }

  .call-tile__footer {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.55rem 0.75rem;
    background: color-mix(in srgb, var(--color-panel) 80%, rgba(0, 0, 0, 0.55));
    border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
  }

  .call-tile__footer-name {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-weight: 700;
    color: #ffffff;
    font-size: 0.95rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .call-tile__footer-icons {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: #b9bbbe;
    font-size: 1.05rem;
  }

  .call-tile__footer-icons .is-off {
    color: #b9bbbe;
  }

  .call-tile__footer-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    background: color-mix(in srgb, var(--color-panel-muted) 80%, transparent);
    color: var(--color-text-primary);
  }

  .call-tile__footer-pill--share {
    background: color-mix(in srgb, var(--color-accent) 70%, transparent);
    color: var(--color-text-inverse);
  }

  .call-tile--empty {
    border-style: dashed;
  }

  .call-tile--spacer {
    grid-column: 1 / -1;
  }

  .call-empty-msg {
    position: relative;
    z-index: 1;
    display: grid;
    gap: 0.35rem;
    place-items: center;
    text-align: center;
    color: var(--color-text-secondary);
    font-weight: 600;
  }

  .call-empty-msg i {
    font-size: 2rem;
    color: var(--color-text-tertiary);
  }

  .preview-actions {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 1rem;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }

  .toggle-row {
    display: inline-flex;
    gap: 0.5rem;
  }

  .toggle-row--actions {
    pointer-events: auto;
    padding: 0.45rem 0.6rem;
    border-radius: 0.85rem;
    background: color-mix(in srgb, var(--color-panel) 82%, rgba(0, 0, 0, 0.28));
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    box-shadow: 0 10px 28px rgba(7, 10, 22, 0.35);
  }

  .icon-toggle {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 75%, transparent);
    color: var(--color-text-secondary);
    display: grid;
    place-items: center;
    font-size: 1.1rem;
    cursor: pointer;
    transition: border-color 120ms ease, color 120ms ease, background 120ms ease, transform 120ms ease;
  }

  .icon-toggle.is-active {
    color: var(--color-text-primary);
    border-color: color-mix(in srgb, var(--color-accent) 55%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-panel));
  }

  .icon-toggle:active {
    transform: translateY(1px);
  }

  .toggle-row--actions {
    gap: 0.65rem;
    justify-content: center;
  }

  .icon-toggle--join {
    background: linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 90%, #7dd3fc 10%), var(--color-accent));
    color: var(--color-text-inverse);
    border-color: color-mix(in srgb, var(--color-accent) 60%, var(--color-border-subtle));
    box-shadow: 0 10px 20px -12px rgba(0, 0, 0, 0.35);
    --icon-color: var(--color-text-inverse);
  }

  .icon-toggle--join:hover {
    transform: translateY(-1px);
    box-shadow: 0 12px 22px -14px rgba(0, 0, 0, 0.45);
  }

  @media (max-width: 640px) {
    .call-tile {
      min-height: 200px;
    }

    .call-avatar__image {
      width: 64px;
      height: 64px;
    }
  }
</style>

