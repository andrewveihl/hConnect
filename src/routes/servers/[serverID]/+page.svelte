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
  import { collection, doc, onSnapshot, orderBy, query, getDocs, endBefore, limitToLast, type Unsubscribe } from 'firebase/firestore';
  import { sendChannelMessage, submitChannelForm, toggleChannelReaction, voteOnChannelPoll } from '$lib/db/messages';
  import { markChannelRead } from '$lib/unread';

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
  const profileUnsubs: Record<string, Unsubscribe> = {};

  function pickString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }

  function normalizeProfile(uid: string, data: any, previous: any = profiles[uid] ?? {}) {
    const displayName =
      pickString(data?.name) ??
      pickString(data?.displayName) ??
      pickString(previous.displayName) ??
      pickString(previous.name) ??
      pickString(data?.email) ??
      'Member';

    const name =
      pickString(data?.name) ??
      pickString(previous.name) ??
      pickString(data?.displayName) ??
      displayName;

    const photoURL =
      pickString(data?.photoURL) ??
      pickString(previous.photoURL) ??
      null;

    return {
      ...previous,
      ...data,
      uid,
      displayName,
      name,
      photoURL
    };
  }

  function updateProfileCache(uid: string, patch: any) {
    if (!uid) return;
    const next = normalizeProfile(uid, patch ?? {}, profiles[uid]);
    const prev = profiles[uid];
    if (!prev) {
      profiles = { ...profiles, [uid]: next };
      return;
    }
    if (
      prev.displayName === next.displayName &&
      prev.photoURL === next.photoURL &&
      prev.name === next.name
    ) {
      // merge any extra fields without triggering unnecessary reactivity
      const merged = { ...prev, ...next };
      if (merged !== prev) {
        profiles = { ...profiles, [uid]: merged };
      }
      return;
    }
    profiles = { ...profiles, [uid]: next };
  }

  function ensureProfileSubscription(database: ReturnType<typeof db>, uid: string) {
    if (!uid || profileUnsubs[uid]) return;
    profileUnsubs[uid] = onSnapshot(
      doc(database, 'profiles', uid),
      (snap) => {
        updateProfileCache(uid, snap.data() ?? {});
      },
      () => {
        profileUnsubs[uid]?.();
        delete profileUnsubs[uid];
      }
    );
  }

  function cleanupProfileSubscriptions() {
    for (const uid in profileUnsubs) {
      profileUnsubs[uid]?.();
      delete profileUnsubs[uid];
    }
  }

  function normalizePoll(raw: any) {
    const question = pickString(raw?.question) ?? '';
    const options = Array.isArray(raw?.options) ? raw.options : [];
    const votesByUser =
      raw?.votesByUser && typeof raw.votesByUser === 'object'
        ? raw.votesByUser
        : raw?.votes && typeof raw.votes === 'object'
          ? raw.votes
          : {};
    const voteCounts: Record<number, number> = {};
    for (const voter in votesByUser) {
      const idx = votesByUser[voter];
      if (typeof idx === 'number' && Number.isFinite(idx)) {
        voteCounts[idx] = (voteCounts[idx] ?? 0) + 1;
      }
    }
    return { question, options, votesByUser, votes: voteCounts };
  }

  function normalizeForm(raw: any) {
    const title = pickString(raw?.title) ?? '';
    const questions = Array.isArray(raw?.questions) ? raw.questions : [];
    const responses =
      raw?.responses && typeof raw.responses === 'object' ? raw.responses : {};
    return { title, questions, responses };
  }

  function toChatMessage(id: string, raw: any) {
    const uid = pickString(raw?.uid) ?? pickString(raw?.authorId) ?? 'unknown';
    const displayName =
      pickString(raw?.displayName) ?? pickString(raw?.author?.displayName);
    const photoURL =
      pickString(raw?.photoURL) ?? pickString(raw?.author?.photoURL);
    const createdAt = raw?.createdAt ?? null;
    const inferredType =
      raw?.type ??
      (raw?.file
        ? 'file'
        : raw?.poll
          ? 'poll'
          : raw?.form
            ? 'form'
            : raw?.url
              ? 'gif'
              : 'text');

    const message: any = {
      id,
      uid,
      type: inferredType,
      createdAt,
      displayName: displayName ?? undefined,
      photoURL: photoURL ?? undefined,
      reactions: raw?.reactions ?? {}
    };

    if (raw?.text !== undefined || raw?.content !== undefined) {
      message.text = raw?.text ?? raw?.content ?? '';
    }

    if (raw?.url) {
      message.url = raw.url;
    }

    if (raw?.file) {
      message.file = raw.file;
    }

    if (inferredType === 'poll') {
      message.poll = normalizePoll(raw?.poll ?? {});
    }

    if (inferredType === 'form') {
      message.form = normalizeForm(raw?.form ?? {});
    }

    return message;
  }

  function deriveCurrentDisplayName() {
    const uid = $user?.uid ?? '';
    const profile = uid ? profiles[uid] : null;
    return (
      pickString(profile?.displayName) ??
      pickString(profile?.name) ??
      pickString($user?.displayName) ??
      pickString($user?.email) ??
      'You'
    );
  }

  function deriveCurrentPhotoURL() {
    const uid = $user?.uid ?? '';
    const profile = uid ? profiles[uid] : null;
    const candidate =
      pickString(profile?.photoURL) ??
      pickString($user?.photoURL);
    return candidate ?? null;
  }
  let showCreate = false;
  let voiceState: VoiceSession | null = null;
  const unsubscribeVoice = voiceSession.subscribe((value) => {
    voiceState = value;
  });

  $: if ($user?.uid) {
    updateProfileCache($user.uid, {
      displayName: pickString($user.displayName) ?? pickString($user.email) ?? 'You',
      photoURL: pickString($user.photoURL) ?? null,
      email: pickString($user.email) ?? undefined
    });
  }

  // listeners
  let channelsUnsub: (() => void) | null = null;
  let messagesUnsub: (() => void) | null = null;

  function clearChannelsUnsub() { channelsUnsub?.(); channelsUnsub = null; }
  function clearMessagesUnsub() { messagesUnsub?.(); messagesUnsub = null; }

  function selectChannelObject(id: string): Channel {
    const found = channels.find((c) => c.id === id);
    return found ?? { id, name: id, type: 'text' };
  }

  const PAGE_SIZE = 50;
  let earliestLoaded: any = null; // Firestore Timestamp or Date

  async function loadOlderMessages(currServerId: string, channelId: string) {
    try {
      const database = db();
      if (!earliestLoaded) return; // nothing to load yet
      const q = query(
        collection(database, 'servers', currServerId, 'channels', channelId, 'messages'),
        orderBy('createdAt', 'asc'),
        endBefore(earliestLoaded),
        limitToLast(PAGE_SIZE)
      );
      const snap = await getDocs(q);
      const older: any[] = [];
      snap.forEach((d) => older.push(toChatMessage(d.id, d.data())));
      messages = [...older, ...messages];
      if (older.length) {
        earliestLoaded = older[0]?.createdAt ?? earliestLoaded;
      }
    } catch (err) {
      console.error('Failed to load older messages', err);
    }
  }

  function subscribeMessages(currServerId: string, channelId: string) {
    const database = db();
    const q = query(
      collection(database, 'servers', currServerId, 'channels', channelId, 'messages'),
      orderBy('createdAt', 'asc'),
      // Show last page live; older are fetched on-demand
      limitToLast(PAGE_SIZE)
    );
    clearMessagesUnsub();
    cleanupProfileSubscriptions();
    profiles = {};
    if ($user?.uid) {
      updateProfileCache($user.uid, {
        displayName: pickString($user.displayName) ?? pickString($user.email) ?? 'You',
        photoURL: pickString($user.photoURL) ?? null
      });
    }
    messagesUnsub = onSnapshot(q, (snap) => {
      const nextMessages: any[] = [];
      const seen = new Set<string>();

      for (const docSnap of snap.docs) {
        const raw: any = docSnap.data();
        const msg = toChatMessage(docSnap.id, raw);
        nextMessages.push(msg);

        if (msg?.uid && msg.uid !== 'unknown') {
          seen.add(msg.uid);
          if (msg.displayName || msg.photoURL) {
            updateProfileCache(msg.uid, {
              displayName: msg.displayName,
              photoURL: msg.photoURL
            });
          }
        }
      }

      messages = nextMessages;
      if (messages.length) {
        earliestLoaded = messages[0]?.createdAt ?? null;
      }
      seen.forEach((uid) => ensureProfileSubscription(database, uid));

      // Mark as read when viewing this channel
      try {
        if ($user?.uid && activeChannel?.id === channelId) {
          const last = nextMessages[nextMessages.length - 1];
          const at = last?.createdAt ?? null;
          const lastId = last?.id ?? null;
          void markChannelRead($user.uid, currServerId, channelId, { at, lastMessageId: lastId });
        }
      } catch {}
    });
  }

  function pickChannel(id: string) {
    if (!serverId) return;
    const next = selectChannelObject(id);
    activeChannel = next;
    messages = [];

    if (next.type === 'voice') {
      clearMessagesUnsub();
      cleanupProfileSubscriptions();
      profiles = {};
      voiceSession.join(serverId, id, next.name ?? 'Voice channel');
      voiceSession.setVisible(true);
    } else {
      subscribeMessages(serverId, id);
      voiceSession.setVisible(false);
      // Optimistically mark as read on navigation to the channel
      if ($user?.uid) {
        const last = messages[messages.length - 1];
        const at = last?.createdAt ?? null;
        const lastId = last?.id ?? null;
        void markChannelRead($user.uid, serverId, id, { at, lastMessageId: lastId });
      }
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

  onDestroy(() => {
    clearChannelsUnsub();
    clearMessagesUnsub();
    cleanupProfileSubscriptions();
    unsubscribeVoice();
    voiceSession.leave();
  });

  // Persist read state when tab is hidden
  if (typeof window !== 'undefined') {
    const onVis = () => {
      if (document.visibilityState === 'hidden' && serverId && activeChannel?.id && $user?.uid) {
        const last = messages[messages.length - 1];
        const at = last?.createdAt ?? null;
        const lastId = last?.id ?? null;
        void markChannelRead($user.uid, serverId, activeChannel.id, { at, lastMessageId: lastId });
      }
    };
    window.addEventListener('visibilitychange', onVis);
    onDestroy(() => window.removeEventListener('visibilitychange', onVis));
  }

  async function handleSend(text: string) {
    const trimmed = text?.trim();
    if (!trimmed) return;
    if (!serverId) { alert('Missing server id.'); return; }
    if (!activeChannel?.id) { alert('Pick a channel first.'); return; }
    if (!$user) { alert('Sign in to send messages.'); return; }
    try {
      await sendChannelMessage(serverId, activeChannel.id, {
        type: 'text',
        text: trimmed,
        uid: $user.uid,
        displayName: deriveCurrentDisplayName(),
        photoURL: deriveCurrentPhotoURL()
      });
    } catch (err) {
      console.error(err);
      alert(`Failed to send message: ${err}`);
    }
  }

  async function handleSendGif(url: string) {
    const trimmed = pickString(url);
    if (!trimmed) return;
    if (!serverId) { alert('Missing server id.'); return; }
    if (!activeChannel?.id) { alert('Pick a channel first.'); return; }
    if (!$user) { alert('Sign in to send messages.'); return; }
    try {
      await sendChannelMessage(serverId, activeChannel.id, {
        type: 'gif',
        url: trimmed,
        uid: $user.uid,
        displayName: deriveCurrentDisplayName(),
        photoURL: deriveCurrentPhotoURL()
      });
    } catch (err) {
      console.error(err);
      alert(`Failed to share GIF: ${err}`);
    }
  }

  async function handleCreatePoll(poll: { question: string; options: string[] }) {
    if (!serverId) { alert('Missing server id.'); return; }
    if (!activeChannel?.id) { alert('Pick a channel first.'); return; }
    if (!$user) { alert('Sign in to send messages.'); return; }
    try {
      await sendChannelMessage(serverId, activeChannel.id, {
        type: 'poll',
        poll,
        uid: $user.uid,
        displayName: deriveCurrentDisplayName(),
        photoURL: deriveCurrentPhotoURL()
      });
    } catch (err) {
      console.error(err);
      alert(`Failed to create poll: ${err}`);
    }
  }

  async function handleCreateForm(form: { title: string; questions: string[] }) {
    if (!serverId) { alert('Missing server id.'); return; }
    if (!activeChannel?.id) { alert('Pick a channel first.'); return; }
    if (!$user) { alert('Sign in to send messages.'); return; }
    try {
      await sendChannelMessage(serverId, activeChannel.id, {
        type: 'form',
        form,
        uid: $user.uid,
        displayName: deriveCurrentDisplayName(),
        photoURL: deriveCurrentPhotoURL()
      });
    } catch (err) {
      console.error(err);
      alert(`Failed to share form: ${err}`);
    }
  }

  async function handleVote(event: CustomEvent<{ messageId: string; optionIndex: number }>) {
    if (!serverId || !activeChannel?.id || !$user) return;
    const { messageId, optionIndex } = event.detail ?? {};
    if (!messageId || optionIndex === undefined) return;
    try {
      await voteOnChannelPoll(serverId, activeChannel.id, messageId, $user.uid, optionIndex);
    } catch (err) {
      console.error(err);
      alert(`Failed to record vote: ${err}`);
    }
  }

  async function handleFormSubmit(event: CustomEvent<{ messageId: string; answers: string[] }>) {
    if (!serverId || !activeChannel?.id || !$user) return;
    const { messageId, answers } = event.detail ?? {};
    if (!messageId || !answers) return;
    try {
      await submitChannelForm(serverId, activeChannel.id, messageId, $user.uid, answers);
    } catch (err) {
      console.error(err);
      alert(`Failed to submit form: ${err}`);
    }
  }

  async function handleReaction(event: CustomEvent<{ messageId: string; emoji: string }>) {
    if (!serverId || !activeChannel?.id || !$user) return;
    const { messageId, emoji } = event.detail ?? {};
    if (!messageId || !emoji) return;
    try {
      await toggleChannelReaction(serverId, activeChannel.id, messageId, $user.uid, emoji);
    } catch (err) {
      console.error(err);
      alert(`Failed to toggle reaction: ${err}`);
    }
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
              <MessageList
                {messages}
                users={profiles}
                currentUserId={$user?.uid ?? null}
                on:vote={handleVote}
                on:submitForm={handleFormSubmit}
                on:react={handleReaction}
                on:loadMore={() => serverId && activeChannel?.id && loadOlderMessages(serverId, activeChannel.id)}
              />
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
              <ChatInput
                placeholder={`Message #${activeChannel?.name ?? ''}`}
                onSend={handleSend}
                onSendGif={handleSendGif}
                onCreatePoll={handleCreatePoll}
                onCreateForm={handleCreateForm}
              />
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

    <div class="hidden lg:flex lg:w-72 xl:w-80 bg-[#1e1f24] border-l border-black/40 overflow-y-auto">
      {#if serverId}
        <MembersPane {serverId} />
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

