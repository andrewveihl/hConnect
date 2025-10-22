<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { user } from '$lib/stores/user';
  import { getDb } from '$lib/firebase';
  import { doc, getDoc } from 'firebase/firestore';

  import MessageList from '$lib/components/MessageList.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';

  import { sendDMMessage, streamDMMessages, markThreadRead } from '$lib/db/dms';

  export let data: { threadID: string };
  $: threadID = data.threadID;

  let me: any = null;
  $: me = $user;

  let messages: any[] = [];
  let unsub: (() => void) | null = null;

  // Header meta
  let otherUid: string | null = null;
  let otherProfile: any = null;

  async function loadThreadMeta() {
    const db = getDb();
    const tSnap = await getDoc(doc(db, 'dms', threadID));
    const t: any = tSnap.data() ?? {};
    const parts: string[] = t.participants ?? [];
    otherUid = parts.find((p) => p !== me?.uid) ?? null;

    if (otherUid) {
      // try profiles, fall back to users if you still have that collection
      let p = await getDoc(doc(db, 'profiles', otherUid));
      if (!p.exists()) p = await getDoc(doc(db, 'users', otherUid));
      if (p.exists()) otherProfile = { uid: p.id, ...p.data() };
    }
  }

  onMount(async () => {
    // stream messages immediately
    unsub = streamDMMessages(threadID, async (msgs) => {
      messages = msgs;
      if (me?.uid) await markThreadRead(threadID, me.uid);
    });
    // load header meta in parallel
    loadThreadMeta();
  });

  onDestroy(() => unsub?.());

  async function handleSend(text: string) {
    if (!text?.trim() || !me?.uid) return;
    await sendDMMessage(threadID, {
      uid: me.uid,
      text: text.trim(),
      displayName: me.displayName ?? null,
      photoURL: me.photoURL ?? null
    });
  }

  // handle both {detail: string} and {detail: {text}}
  function onSend(e: CustomEvent<any>) {
    const val = typeof e.detail === 'string' ? e.detail : e.detail?.text;
    handleSend(val ?? '');
  }
</script>

<!-- Header -->
<div class="h-14 border-b border-white/10 px-4 flex items-center gap-3">
  <div class="w-9 h-9 rounded-full bg-white/10 grid place-items-center overflow-hidden">
    {#if otherProfile?.photoURL}
      <img class="w-9 h-9 object-cover" src={otherProfile.photoURL} alt="" />
    {:else}
      <i class="bx bx-user text-lg"></i>
    {/if}
  </div>
  <div class="leading-5">
    <div class="font-semibold">
      {otherProfile?.name || otherProfile?.displayName || otherUid || 'Direct Message'}
    </div>
    {#if otherProfile?.email}<div class="text-xs text-white/60">{otherProfile.email}</div>{/if}
  </div>
</div>

<!-- Messages -->
<div class="flex-1 overflow-y-auto">
  <MessageList {messages} users={{}} />
</div>

<!-- Composer -->
<div class="border-t border-white/10 p-3">
  <ChatInput on:send={onSend} on:submit={onSend} />
</div>
