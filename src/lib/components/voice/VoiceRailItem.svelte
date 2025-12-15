<script lang="ts">
  import { run } from 'svelte/legacy';

  import { onDestroy, untrack } from 'svelte';
  import { getDb } from '$lib/firebase';
  import { voiceSession } from '$lib/stores/voice';
  import type { VoiceSession } from '$lib/stores/voice';
  import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';

  // Desktop-only rail item that appears when a voice session is active

  const CALL_DOC_ID = 'live';
  let session: VoiceSession | null = $state(null);
  const stopSession = voiceSession.subscribe((s) => (session = s));

  let participants = $state(0);
  let unsub: Unsubscribe | null = null;

  run(() => {
    untrack(() => unsub)?.();
    participants = 0;
    if (session?.serverId && session?.channelId) {
      const db = getDb();
      const callDoc = doc(db, 'servers', session.serverId, 'channels', session.channelId, 'calls', CALL_DOC_ID);
      const ref = collection(callDoc, 'participants');
      unsub = onSnapshot(ref, (snap) => {
        let count = 0;
        for (const d of snap.docs) {
          const s: any = d.data();
          if ((s?.status ?? 'active') !== 'left') count++;
        }
        participants = count;
      });
    }
  });

  onDestroy(() => {
    unsub?.();
    stopSession?.();
  });

  function openVoice() {
    voiceSession.setVisible(true);
  }
  function leave() {
    voiceSession.leave();
  }
</script>

{#if session}
  <div class="hidden md:grid place-items-center w-full">
    <button
      type="button"
      class="relative my-1 w-12 h-12 grid place-items-center bg-[#243042] ring-2 ring-emerald-400/40 hover:bg-[#2c3a50] transition-all select-none"
      aria-label="Voice connected. Click to return. Shift+Click to leave."
      title={`Voice: ${session.channelName}`}
      onclick={(e) => (e.shiftKey ? leave() : openVoice())}
    >
      <i class="bx bx-headphone text-xl text-emerald-300"></i>
      {#if participants > 0}
        <span class="absolute -bottom-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-[10px] font-semibold grid place-items-center">
          {participants}
        </span>
      {/if}
    </button>
  </div>
{/if}




