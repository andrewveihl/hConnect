<script lang="ts">
  import { onDestroy } from 'svelte';
  import { getDb } from '$lib/firebase';
  import { voiceSession } from '$lib/stores/voice';
  import type { VoiceSession } from '$lib/stores/voice';
  import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';

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

  $: {
    unsub?.();
    participants = [];
    if (!serverId || !session?.channelId || !session?.serverId) {
      unsub = null;
    } else if (serverId === session.serverId) {
      const db = getDb();
      const callDoc = doc(db, 'servers', session.serverId, 'channels', session.channelId, 'calls', CALL_DOC_ID);
      const ref = collection(callDoc, 'participants');
      unsub = onSnapshot(ref, (snap) => {
        const list: VoiceParticipant[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            uid: data.uid ?? d.id,
            displayName: data.displayName ?? 'Member',
            photoURL: data.photoURL ?? null,
            hasAudio: data.hasAudio ?? true,
            hasVideo: data.hasVideo ?? false,
            status: (data.status ?? 'active') as 'active' | 'left'
          };
        }).filter((p) => p.status !== 'left');
        participants = list;
      });
    }
  }

  onDestroy(() => {
    unsub?.();
    unsub = null;
  });

  function leaveCall() {
    voiceSession.leave();
  }

  function openVoice() {
    voiceSession.setVisible(true);
  }

  function initials(name?: string) {
    if (!name) return '?';
    return name.trim().charAt(0).toUpperCase() || '?';
  }

  $: namesLine = participants.slice(0, 3).map((p) => p.displayName || 'Member').join(', ');
</script>

{#if session && serverId === session.serverId}
  <div class="  border border-white/10 bg-[#1f232b] text-white p-3 shadow-sm">
    <div class="flex items-start gap-2">
      <div class="flex-1 min-w-0">
        <div class="text-emerald-400 text-sm font-semibold">Voice Connected</div>
        <div class="text-xs text-white/70 truncate">{namesLine || session.channelName}</div>
      </div>
      <div class="flex items-center gap-2">
        <button class="h-8 w-8 grid place-items-center  hover:bg-white/10" title="Open voice" aria-label="Open voice" on:click={openVoice}>
          <i class="bx bx-bar-chart"></i>
        </button>
        <button class="h-8 w-8 grid place-items-center  hover:bg-red-500/20 text-red-300" title="Leave" aria-label="Leave" on:click={leaveCall}>
          <i class="bx bx-phone"></i>
        </button>
      </div>
    </div>

    <!-- Participants row -->
    {#if participants.length}
      <div class="mt-2 flex items-center gap-2 overflow-hidden">
        {#each participants.slice(0, 6) as p (p.uid)}
          <div class="relative h-8 w-8 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0">
            {#if p.photoURL}
              <img src={p.photoURL} alt={p.displayName} class="w-full h-full object-cover" loading="lazy" />
            {:else}
              <div class="w-full h-full grid place-items-center text-[11px] text-white/80">{initials(p.displayName)}</div>
            {/if}
            {#if p.hasAudio === false}
              <i class="bx bx-microphone-off absolute -bottom-0.5 -right-0.5 text-[13px] text-red-400 drop-shadow"></i>
            {/if}
            {#if p.hasVideo === false}
              <i class="bx bx-video-off absolute -top-0.5 -left-0.5 text-[13px] text-white/80 drop-shadow"></i>
            {/if}
          </div>
        {/each}
        {#if participants.length > 6}
          <div class="h-8 px-2 grid place-items-center rounded-full bg-white/10 text-xs text-white/70">+{participants.length - 6}</div>
        {/if}
      </div>
    {/if}

    <!-- Quick actions (visual only for now) -->
    <div class="mt-3 grid grid-cols-4 gap-2">
      <button class="h-9  bg-white/5 border border-white/10 hover:bg-white/10" title="Video" aria-label="Video" on:click={openVoice}>
        <i class="bx bx-video"></i>
      </button>
      <button class="h-9  bg-white/5 border border-white/10 hover:bg-white/10" title="Screen share" aria-label="Screen share" on:click={openVoice}>
        <i class="bx bx-desktop"></i>
      </button>
      <button class="h-9  bg-white/5 border border-white/10 hover:bg-white/10" title="Invite" aria-label="Invite" on:click={openVoice}>
        <i class="bx bx-user-plus"></i>
      </button>
      <button class="h-9  bg-white/5 border border-white/10 hover:bg-white/10" title="Noise control" aria-label="Noise control" on:click={openVoice}>
        <i class="bx bx-volume-low"></i>
      </button>
    </div>
  </div>
{/if}





