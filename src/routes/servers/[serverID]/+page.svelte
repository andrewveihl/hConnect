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
  import VideoChat from '$lib/components/VideoChat.svelte';
  import { voiceSession } from '$lib/stores/voice';
  import type { VoiceSession } from '$lib/stores/voice';

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
  let voiceState: VoiceSession | null = null;
  const unsubscribeVoice = voiceSession.subscribe((value) => {
    voiceState = value;
  });

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
    const next = selectChannelObject(id);
    activeChannel = next;
    messages = [];

    if (next.type === 'voice') {
      clearMessagesUnsub();
      voiceSession.join(serverId, id, next.name ?? 'Voice channel');
      voiceSession.setVisible(true);
    } else {
      subscribeMessages(serverId, id);
      voiceSession.setVisible(false);
    }

    // close channels panel on mobile
    showChannels = false;
  }

  /* ===========================
     Mobile panels + gestures
     =========================== */
  let showChannels = false;
  let showMembers = false;

  const LEFT_RAIL = 72;
  const EDGE_ZONE = 28;
  const SWIPE = 64;

  let tracking = false;
  let startX = 0;
  let startY = 0;

  function setupGestures() {
    if (typeof window === 'undefined') return () => {};

    const mdQuery = window.matchMedia('(min-width: 768px)');
    const lgQuery = window.matchMedia('(min-width: 1024px)');

    const onMedia = () => {
      if (mdQuery.matches) showChannels = false;
      if (lgQuery.matches) showMembers = false;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        showChannels = false;
        showMembers = false;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;

      const nearLeft = startX >= LEFT_RAIL && startX <= LEFT_RAIL + EDGE_ZONE;
      const nearRight = window.innerWidth - startX <= EDGE_ZONE;
      tracking = nearLeft || nearRight || showChannels || showMembers;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (Math.abs(dy) > Math.abs(dx) * 1.35) return;

      if (!showChannels && !showMembers) {
        const fromLeft = startX >= LEFT_RAIL && startX <= LEFT_RAIL + EDGE_ZONE && dx >= SWIPE;
        const fromRight = window.innerWidth - startX <= EDGE_ZONE && dx <= -SWIPE;
        if (fromLeft) {
          showChannels = true;
          tracking = false;
        } else if (fromRight) {
          showMembers = true;
          tracking = false;
        }
        return;
      }

      if (showChannels && dx <= -SWIPE) {
        showChannels = false;
        tracking = false;
      } else if (showMembers && dx >= SWIPE) {
        showMembers = false;
        tracking = false;
      }
    };

    const onTouchEnd = () => {
      tracking = false;
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    mdQuery.addEventListener('change', onMedia);
    lgQuery.addEventListener('change', onMedia);
    onMedia();

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      mdQuery.removeEventListener('change', onMedia);
      lgQuery.removeEventListener('change', onMedia);
    };
  }

  onMount(() => {
    const cleanup = setupGestures();
    return () => cleanup();
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

  onDestroy(() => { clearChannelsUnsub(); clearMessagesUnsub(); unsubscribeVoice(); voiceSession.leave(); });

  async function handleSend(text: string) {
    if (!serverId) { alert('Missing server id.'); return; }
    if (!activeChannel?.id) { alert('Pick a channel first.'); return; }
    if (!$user) { alert('Sign in to send messages.'); return; }
    try { await sendChannelMessage(serverId, activeChannel.id, $user.uid, text); }
    catch (err) { console.error(err); alert(`Failed to send message: ${err}`); }
  }

  $: if (voiceState && serverId && voiceState.serverId !== serverId) {
    voiceSession.leave();
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
<div class="flex h-dvh bg-[#0b111b] text-white overflow-hidden">
  <LeftPane activeServerId={serverId} onCreateServer={() => (showCreate = true)} />
  <div class="flex flex-1 overflow-hidden bg-[#1e1f24]">
    <div class="hidden md:flex md:w-64 xl:w-72 flex-col border-r border-black/40 bg-[#1e1f24]">
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

    <div class="flex flex-1 flex-col bg-[#2b2d31] overflow-hidden">
      <ChannelHeader
        channel={activeChannel}
        onOpenChannels={() => (showChannels = true)}
        onOpenMembers={() => (showMembers = true)}
      />

      <div class="flex-1 overflow-hidden bg-[#313338]">
        <div class="h-full" style:display={voiceState?.visible ? 'block' : 'none'}>
          <VideoChat />
        </div>

        <div class="h-full flex flex-col" style:display={voiceState?.visible ? 'none' : 'flex'}>
          {#if serverId && activeChannel}
            <div class="flex-1 overflow-hidden p-3 sm:p-4">
              <MessageList {messages} users={profiles} currentUserId={$user?.uid ?? null} />
            </div>
            {#if voiceState && !voiceState.visible}
              <div class="shrink-0 border-y border-black/40 bg-[#26282f] px-3 py-2 text-sm text-white/80 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <div class="flex-1 truncate">
                  <span class="font-semibold text-white">Voice connected</span>
                  <span class="ml-1 text-white/60">#{voiceState.channelName}</span>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    class="rounded-md bg-white/15 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/25"
                    type="button"
                    on:click={() => voiceSession.setVisible(true)}
                  >
                    Return to voice
                  </button>
                  <button
                    class="rounded-md bg-red-500/80 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
                    type="button"
                    on:click={() => voiceSession.leave()}
                  >
                    Leave
                  </button>
                </div>
              </div>
            {/if}
            <div class="shrink-0 border-t border-black/40 bg-[#2b2d31] p-3">
              <ChatInput placeholder={`Message #${activeChannel?.name ?? ''}`} onSend={handleSend} />
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
        </div>
      </div>
    </div>

    <div class="hidden lg:flex lg:w-72 xl:w-80 bg-[#1e1f24] border-l border-black/40 overflow-y-auto">`r`n      {#if serverId}`r`n        <MembersPane {serverId} />
      {:else}
        <div class="p-4 text-white/70">No server selected.</div>
      {/if}
    </div>
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
      <MembersPane {serverId} showHeader={false} />
    {:else}
      <div class="p-4 text-white/70">No server selected.</div>
    {/if}
  </div>
</div>

<NewServerModal bind:open={showCreate} onClose={() => (showCreate = false)} />

