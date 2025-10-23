<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { user } from '$lib/stores/user';

  import LeftPane from '$lib/components/LeftPane.svelte';
  import ServerSidebar from '$lib/components/ServerSidebar.svelte';
  import ChannelHeader from '$lib/components/ChannelHeader.svelte';
  import MembersPane from '$lib/components/MembersPane.svelte';
  import MessageList from '$lib/components/MessageList.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import NewServerModal from '$lib/components/NewServerModal.svelte';

  import { db } from '$lib/db';
  import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
  import { sendChannelMessage } from '$lib/db/messages';

  // Comes from +page.ts
  export let data: { serverId: string | null };

  // Normalize once
  $: serverId =
    data?.serverId ??
    $page.params.serverID ??
    $page.params.serverId ??
    null;

  type Channel = { id: string; name?: string; type?: 'text' | 'voice'; position?: number };

  let channels: Channel[] = [];
  let activeChannel: Channel | null = null;
  let messages: any[] = [];
  let profiles: Record<string, any> = {};
  let showCreate = false;

  // listeners
  let channelsUnsub: (() => void) | null = null;
  let messagesUnsub: (() => void) | null = null;

  function clearChannelsUnsub() { channelsUnsub?.(); channelsUnsub = null; }
  function clearMessagesUnsub() { messagesUnsub?.(); messagesUnsub = null; }

  function selectChannelObject(id: string): Channel {
    const found = channels.find((c) => c.id === id);
    return found ?? { id, name: id, type: 'text' };
  }

  function subscribeMessages(currServerId: string, channelId: string) {
    const database = db();
    const q = query(
      collection(database, 'servers', currServerId, 'channels', channelId, 'messages'),
      orderBy('createdAt', 'asc')
    );
    clearMessagesUnsub();
    messagesUnsub = onSnapshot(q, (snap) => {
      messages = snap.docs.map((d) => {
        const raw: any = d.data();
        const uid = raw.uid ?? raw.authorId ?? 'unknown';
        const text = raw.text ?? raw.content ?? '';
        return { id: d.id, ...raw, uid, text };
      });

      // lightweight profiles
      const uids = Array.from(new Set(messages.map((m) => m.uid).filter(Boolean)));
      uids.forEach((uid) => {
        onSnapshot(doc(database, 'profiles', uid), (s) => {
          profiles[uid] = s.data();
        });
      });
    });
  }

  function pickChannel(id: string) {
    if (!serverId) return;
    activeChannel = selectChannelObject(id);
    messages = [];
    subscribeMessages(serverId, id);
    // close channels panel on mobile
    showChannels = false;
  }

  /* ===========================
     Mobile panels + gestures
     =========================== */
  let showChannels = false; // mobile panels (leave rail visible)
  let showMembers = false;

  const LEFT_RAIL = 72; // px
  const LEFT_EDGE = 24;
  const RIGHT_EDGE = 24;
  const SWIPE = 50;

  let tracking = false;
  let startX = 0;
  let startY = 0;

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { showChannels = false; showMembers = false; }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;

      // open-channels starts just right of the rail; open-members from right edge
      const nearLeft = startX >= LEFT_RAIL && startX <= (LEFT_RAIL + LEFT_EDGE);
      const nearRight = (window.innerWidth - startX) <= RIGHT_EDGE;

      tracking = (nearLeft || nearRight) || showChannels || showMembers;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      // ignore mostly vertical
      if (Math.abs(dy) > Math.abs(dx) * 1.25) return;

      if (!showChannels && !showMembers) {
        const fromInnerLeft = startX >= LEFT_RAIL && startX <= (LEFT_RAIL + LEFT_EDGE) && dx >= SWIPE;
        const fromRightEdge = (window.innerWidth - startX) <= RIGHT_EDGE && dx <= -SWIPE;
        if (fromInnerLeft) { showChannels = true; tracking = false; }
        if (fromRightEdge) { showMembers = true; tracking = false; }
        return;
      }

      if (showChannels && dx <= -SWIPE) { showChannels = false; tracking = false; }
      if (showMembers && dx >= SWIPE) { showMembers = false; tracking = false; }
    };

    const onTouchEnd = () => { tracking = false; };

    window.addEventListener('keydown', onKey);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  });

  // subscribe to channels
  $: if (serverId) {
    const database = db();
    const q = query(collection(database, 'servers', serverId, 'channels'), orderBy('position'));
    clearChannelsUnsub();
    channelsUnsub = onSnapshot(q, (snap) => {
      channels = snap.docs.map((d) => {
        const x: any = d.data();
        return { id: d.id, ...x, type: x.type ?? 'text' } as Channel;
      });

      const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

      if (!activeChannel && channels.length) {
        if (isDesktop) {
          // desktop: auto-pick first channel
          pickChannel(channels[0].id);
        } else {
          // mobile: show channel list first
          activeChannel = null;
          showMembers = false;
          showChannels = true;
        }
      } else if (activeChannel) {
        const updated = channels.find((c) => c.id === activeChannel!.id);
        if (updated) {
          activeChannel = updated;
        } else if (channels.length) {
          if (isDesktop) pickChannel(channels[0].id);
          else { activeChannel = null; showMembers = false; showChannels = true; }
        } else {
          activeChannel = null;
          clearMessagesUnsub();
          messages = [];
          showChannels = false;
          showMembers = false;
        }
      }
    });
  } else {
    clearChannelsUnsub();
    clearMessagesUnsub();
    channels = [];
    activeChannel = null;
    messages = [];
    profiles = {};
  }

  onDestroy(() => { clearChannelsUnsub(); clearMessagesUnsub(); });

  async function handleSend(text: string) {
    if (!serverId) { alert('Missing server id.'); return; }
    if (!activeChannel?.id) { alert('Pick a channel first.'); return; }
    if (!$user) { alert('Sign in to send messages.'); return; }
    try { await sendChannelMessage(serverId, activeChannel.id, $user.uid, text); }
    catch (err) { console.error(err); alert(`Failed to send message: ${err}`); }
  }

  // mobile: when switching servers, open channels panel
  $: if (serverId) {
    const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
    if (!isDesktop) { showChannels = true; showMembers = false; }
  }
</script>

<!--
Layout:
- base (<md): 72px rail + chat; channels/members are full-screen panels (leaving rail visible).
- md (≥768): rail + channels + chat
- xl (≥1280): rail + channels + chat + members
-->
<div
  class="h-dvh overflow-hidden grid
         md:[grid-template-columns:72px_256px_1fr] md:[grid-template-rows:48px_1fr_auto]
         xl:[grid-template-columns:72px_256px_1fr_288px]"
  style="grid-template-columns: 72px 1fr; grid-template-rows: 48px 1fr auto;"
>
  <!-- Left rail — ALWAYS visible -->
  <div class="col-start-1 row-span-3 z-30">
    <LeftPane activeServerId={serverId} onCreateServer={() => (showCreate = true)} />
  </div>

  <!-- Header -->
  <div class="col-start-2 md:col-start-3 md:col-end-4 xl:col-end-5">
    <ChannelHeader channel={activeChannel} />
  </div>

  <!-- Channels (desktop column) -->
  <div class="hidden md:block col-start-2 row-start-2 row-end-4">
    {#if serverId}
      <ServerSidebar
        serverId={serverId}
        activeChannelId={activeChannel?.id ?? null}
        onPickChannel={(id) => pickChannel(id)}
      />
    {:else}
      <div class="p-4 text-white/70">Select a server from the left to view channels.</div>
    {/if}
  </div>

  <!-- Chat (flexes between channels and members) -->
  <main class="bg-[#313338] col-start-2 row-start-2 row-end-3
                md:col-start-3 md:row-start-2 md:row-end-3
                overflow-hidden">
    {#if serverId && activeChannel}
      <div class="h-full flex flex-col">
        <div class="flex-1 overflow-hidden p-4">
          <MessageList {messages} users={profiles} />
        </div>
        <div class="shrink-0 border-t border-black/40 bg-[#2b2d31] p-3">
          <ChatInput placeholder={`Message #${activeChannel?.name ?? ''}`} onSend={handleSend} />
        </div>
      </div>
    {:else}
      <div class="h-full grid place-items-center text-white/60">
        {#if !serverId}
          <div>Pick a server to start chatting.</div>
        {:else}
          <div>Pick a channel to start chatting.</div>
        {/if}
      </div>
    {/if}
  </main>

  <!-- Members (xl and up) -->
  <div class="hidden xl:block col-start-4 row-start-2 row-end-4">
    {#if serverId}
      <MembersPane {serverId} />
    {:else}
      <div class="p-4 text-white/70">No server selected.</div>
    {/if}
  </div>
</div>

<!-- ======= MOBILE FULL-SCREEN PANELS (leave 72px rail visible) ======= -->

<!-- Channels panel (slides from left) -->
<div
  class="md:hidden fixed inset-y-0 right-0 left-[72px] z-50 bg-[#2b2d31] text-white flex flex-col transition-transform duration-300 will-change-transform"
  style:transform={showChannels ? 'translateX(0)' : 'translateX(-100%)'}
  aria-label="Channels"
>
  <!-- mobile-only top bar (prevents stray arrow on desktop) -->
  <div class="md:hidden h-12 px-2 flex items-center gap-2 border-b border-black/40">
    <button class="p-2 -ml-2 rounded-md hover:bg-white/10 active:bg-white/15"
            aria-label="Back to chat" on:click={() => (showChannels = false)}>
      <i class="bx bx-chevron-left text-2xl"></i>
    </button>
    <div class="text-xs uppercase tracking-wide text-white/60">Channels</div>
  </div>

  <div class="flex-1 overflow-y-auto">
    {#if serverId}
      <ServerSidebar
        serverId={serverId}
        activeChannelId={activeChannel?.id ?? null}
        onPickChannel={(id) => pickChannel(id)}
        on:pick={() => (showChannels = false)}
      />
    {:else}
      <div class="p-4 text-white/70">Select a server to view channels.</div>
    {/if}
  </div>
</div>

<!-- Members panel (slides from right) -->
<div
  class="md:hidden fixed inset-y-0 right-0 left-[72px] z-50 bg-[#2b2d31] text-white flex flex-col transition-transform duration-300 will-change-transform"
  style:transform={showMembers ? 'translateX(0)' : 'translateX(100%)'}
  aria-label="Members"
>
  <div class="md:hidden h-12 px-2 flex items-center gap-2 border-b border-black/40">
    <button class="p-2 -ml-2 rounded-md hover:bg-white/10 active:bg-white/15"
            aria-label="Back to chat" on:click={() => (showMembers = false)}>
      <i class="bx bx-chevron-left text-2xl"></i>
    </button>
    <div class="text-xs uppercase tracking-wide text-white/60">Members</div>
  </div>

  <div class="flex-1 overflow-y-auto">
    {#if serverId}
      <MembersPane {serverId} />
    {:else}
      <div class="p-4 text-white/70">No server selected.</div>
    {/if}
  </div>
</div>

<NewServerModal bind:open={showCreate} onClose={() => (showCreate = false)} />
