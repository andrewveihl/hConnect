<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/user';

  import LeftPane from '$lib/components/app/LeftPane.svelte';
  import ServerSidebar from '$lib/components/servers/ServerSidebar.svelte';
  import ChannelHeader from '$lib/components/servers/ChannelHeader.svelte';
  import MembersPane from '$lib/components/servers/MembersPane.svelte';
  import MessageList from '$lib/components/chat/MessageList.svelte';
  import ChatInput from '$lib/components/chat/ChatInput.svelte';
  import NewServerModal from '$lib/components/servers/NewServerModal.svelte';
  import VideoChat from '$lib/components/voice/VideoChat.svelte';
  import { voiceSession } from '$lib/stores/voice';
  import type { VoiceSession } from '$lib/stores/voice';

  import { db } from '$lib/firestore';
  import { collection, doc, onSnapshot, orderBy, query, getDocs, endBefore, limitToLast, type Unsubscribe } from 'firebase/firestore';
  import { sendChannelMessage, submitChannelForm, toggleChannelReaction, voteOnChannelPoll } from '$lib/firestore/messages';
  import { subscribeServerDirectory, type MentionDirectoryEntry } from '$lib/firestore/membersDirectory';
  import { markChannelRead } from '$lib/firebase/unread';
  import { resolveProfilePhotoURL } from '$lib/utils/profile';

  // Comes from +page.ts
  export let data: { serverId: string | null };

  // Normalize once
  $: serverId =
    data?.serverId ??
    $page.params.serverID ??
    ($page.params as any).serverId ??
    null;

  type Channel = { id: string; name: string; type: 'text' | 'voice'; position?: number };
  type MentionSendRecord = { uid: string; handle: string; label: string };

  let channels: Channel[] = [];
  let activeChannel: Channel | null = null;
  let requestedChannelId: string | null = null;
  let messages: any[] = [];
  let profiles: Record<string, any> = {};
  const profileUnsubs: Record<string, Unsubscribe> = {};
  let serverDisplayName = 'Server';
  let serverMetaUnsub: Unsubscribe | null = null;
  let mentionOptions: MentionDirectoryEntry[] = [];
  let mentionDirectoryStop: Unsubscribe | null = null;
  let lastMentionServer: string | null = null;

  $: {
    const currentMentionServer = serverId ?? null;
    if (currentMentionServer !== lastMentionServer) {
      mentionDirectoryStop?.();
      mentionOptions = [];
      lastMentionServer = currentMentionServer;
      if (currentMentionServer) {
        mentionDirectoryStop = subscribeServerDirectory(currentMentionServer, (entries) => {
          mentionOptions = entries;
        });
      } else {
        mentionDirectoryStop = null;
      }
    }
  }

  function pickString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }

  function normalizeProfile(uid: string, data: any, previous: any = profiles[uid] ?? {}) {
    const merged = { ...previous, ...data };
    const displayName =
      pickString(merged?.name) ??
      pickString(merged?.displayName) ??
      pickString(previous.displayName) ??
      pickString(previous.name) ??
      pickString(merged?.email) ??
      'Member';

    const name =
      pickString(merged?.name) ??
      pickString(previous.name) ??
      pickString(merged?.displayName) ??
      displayName;

    const photoURL = resolveProfilePhotoURL(merged);

    return {
      ...merged,
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

    const mentionArray: MentionSendRecord[] = Array.isArray(raw?.mentions)
      ? raw.mentions
      : raw?.mentionsMap && typeof raw.mentionsMap === 'object'
        ? Object.entries(raw.mentionsMap).map(([key, value]) => ({
            uid: pickString(key) ?? '',
            handle: pickString((value as any)?.handle) ?? null,
            label: pickString((value as any)?.label) ?? null
          }))
        : [];
    const mentions = mentionArray
      .map((entry) => ({
        uid: pickString(entry?.uid) ?? '',
        handle: pickString((entry as any)?.handle) ?? null,
        label: pickString((entry as any)?.label) ?? null
      }))
      .filter((entry) => entry.uid);
    if (mentions.length) {
      message.mentions = mentions;
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
    const authPhoto = pickString($user?.photoURL) ?? null;
    if (profile) {
      return resolveProfilePhotoURL(profile, authPhoto);
    }
    return authPhoto ?? null;
  }
  let showCreate = false;
  let voiceState: VoiceSession | null = null;
  const unsubscribeVoice = voiceSession.subscribe((value) => {
    voiceState = value;
  });

  $: if ($user?.uid) {
    const fallbackPhoto = pickString($user.photoURL) ?? null;
    updateProfileCache($user.uid, {
      displayName: pickString($user.displayName) ?? pickString($user.email) ?? 'You',
      photoURL: fallbackPhoto,
      authPhotoURL: fallbackPhoto,
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
        email: pickString($user.email) ?? undefined
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
          if (pickString(msg.displayName)) {
            updateProfileCache(msg.uid, {
              displayName: msg.displayName
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
      voiceSession.join(serverId, id, next.name ?? 'Voice channel', serverDisplayName);
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

    if (browser) {
      try {
        const current = $page?.url?.searchParams?.get('channel') ?? null;
        if (current !== id) {
          const nextUrl = new URL($page.url.href);
          nextUrl.searchParams.set('channel', id);
          goto(`${nextUrl.pathname}${nextUrl.search}`, {
            replaceState: true,
            keepfocus: true,
            noScroll: true
          });
        }
      } catch {}
    }
  }

  /* ===========================
     Mobile panels + gestures
     =========================== */
  let showChannels = false;
  let showMembers = false;

  const LEFT_RAIL = 72;
  const EDGE_ZONE = 40;
  const SWIPE = 48;

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

  $: {
    if (serverId) {
      serverMetaUnsub?.();
      const database = db();
      const ref = doc(database, 'servers', serverId);
      serverMetaUnsub = onSnapshot(
        ref,
        (snap) => {
          const data = snap.data() as any;
          const nextName =
            pickString(data?.displayName) ??
            pickString(data?.name) ??
            pickString(data?.title) ??
            'Server';
          serverDisplayName = nextName;
          voiceSession.setServerName(serverId, nextName);
        },
        () => {
          serverDisplayName = 'Server';
          voiceSession.setServerName(serverId, 'Server');
        }
      );
    } else {
      serverMetaUnsub?.();
      serverMetaUnsub = null;
      serverDisplayName = 'Server';
    }
  }

  // subscribe to channels
  $: if (serverId) {
    const database = db();
    const q = query(collection(database, 'servers', serverId, 'channels'), orderBy('position'));
    clearChannelsUnsub();
    channelsUnsub = onSnapshot(q, (snap) => {
      channels = snap.docs.map((d) => {
        const x: any = d.data();
        const name = typeof x.name === 'string' && x.name.trim() ? x.name : 'channel';
        const type = x.type === 'voice' ? 'voice' : 'text';
        return { id: d.id, ...x, name, type: type as 'text' | 'voice' } as Channel;
      });

      const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
      const requestedId = requestedChannelId;

      if (!activeChannel && channels.length) {
        if (requestedId) {
          const target = channels.find((c) => c.id === requestedId);
          if (target) {
            pickChannel(target.id);
          } else if (isDesktop) {
            pickChannel(channels[0].id);
          } else {
            activeChannel = null;
            showMembers = false;
            showChannels = true;
          }
        } else if (isDesktop) {
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
          if (requestedId) {
            const target = channels.find((c) => c.id === requestedId);
            if (target) {
              pickChannel(target.id);
            } else if (isDesktop) {
              pickChannel(channels[0].id);
            } else {
              activeChannel = null;
              showMembers = false;
              showChannels = true;
            }
          } else if (isDesktop) {
            pickChannel(channels[0].id);
          } else {
            activeChannel = null;
            showMembers = false;
            showChannels = true;
          }
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
    serverMetaUnsub?.();
    serverMetaUnsub = null;
    mentionDirectoryStop?.();
    mentionDirectoryStop = null;
    lastMentionServer = null;
    mentionOptions = [];
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

  async function handleSend(payload: string | { text: string; mentions?: MentionSendRecord[] }) {
    const raw = typeof payload === 'string' ? payload : payload?.text ?? '';
    const trimmed = raw?.trim?.() ?? '';
    if (!trimmed) return;
    if (!serverId) { alert('Missing server id.'); return; }
    if (!activeChannel?.id) { alert('Pick a channel first.'); return; }
    if (!$user) { alert('Sign in to send messages.'); return; }
    const mentionList: MentionSendRecord[] =
      typeof payload === 'object' && payload && Array.isArray(payload.mentions)
        ? payload.mentions.filter(
            (item): item is MentionSendRecord =>
              !!item?.uid && (!!item?.handle || !!item?.label)
          )
        : [];
    try {
      await sendChannelMessage(serverId, activeChannel.id, {
        type: 'text',
        text: trimmed,
        uid: $user.uid,
        displayName: deriveCurrentDisplayName(),
        photoURL: deriveCurrentPhotoURL(),
        mentions: mentionList
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

  $: requestedChannelId = $page?.url?.searchParams?.get('channel') ?? null;
  $: if (
    requestedChannelId &&
    requestedChannelId !== activeChannel?.id &&
    channels.some((c) => c.id === requestedChannelId)
  ) {
    pickChannel(requestedChannelId);
  }

  $: if (voiceState && serverId && voiceState.serverId !== serverId && voiceState.visible) {
    voiceSession.setVisible(false);
  }

  // mobile: when switching servers, open channels panel
  $: if (serverId) {
    const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
    if (!isDesktop) { showChannels = true; showMembers = false; }
  }
</script>

<!-- Layout summary:
  - Mobile (<768px): keep the 72px server rail visible while channels/members slide in.
  - Desktop (>=1024px): channels stay pinned; members pane opens at large breakpoints.
-->
<div class="flex h-dvh app-bg text-primary overflow-hidden">
  <LeftPane activeServerId={serverId} onCreateServer={() => (showCreate = true)} />
  <div class="flex flex-1 overflow-hidden panel-muted">
    <div class="hidden md:flex md:w-80 xl:w-80 shrink-0 flex-col border-r border-subtle">
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

    <div class="flex flex-1 min-w-0 flex-col panel" style="border-radius: var(--radius-sm);">
      <ChannelHeader
        channel={activeChannel}
        channelsVisible={showChannels}
        membersVisible={showMembers}
        onToggleChannels={() => {
          showChannels = true;
          showMembers = false;
        }}
        onToggleMembers={() => {
          showMembers = true;
          showChannels = false;
        }}
      />

      <div class={`flex-1 panel-muted flex flex-col ${voiceState?.visible ? '' : 'overflow-hidden'}`}>
        {#if voiceState && voiceState.visible}
          <VideoChat />
        {:else}
          {#if voiceState && !voiceState.visible}
            <div class="shrink-0 border-b border-subtle px-3 py-2 text-sm text-soft flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div class="flex-1 truncate">
                <span class="font-semibold text-primary">Voice connected</span>
                <span class="ml-1 text-soft flex flex-wrap items-center gap-1">
                  <span>#{voiceState.channelName}</span>
                  <span class="text-white/40">&bull;</span>
                  <span class="text-[11px] uppercase tracking-wide text-white/60 md:text-xs">
                    {voiceState.serverName ?? voiceState.serverId}
                  </span>
                  {#if serverId && voiceState.serverId !== serverId}
                    <span class="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/60">other server</span>
                  {/if}
                </span>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  class="bg-white/15 px-3 py-1.5 text-sm font-medium text-primary hover:bg-white/25"
                  type="button"
                  on:click={() => voiceSession.setVisible(true)}
                >
                  Return to voice
                </button>
                <button
                  class="btn btn-danger px-3 py-1.5 text-sm font-medium"
                  type="button"
                  on:click={() => voiceSession.leave()}
                >
                  Leave
                </button>
              </div>
            </div>
          {/if}

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
            <div
              class="shrink-0 border-t border-subtle panel-muted p-3"
              style:padding-bottom="calc(env(safe-area-inset-bottom, 0px) + var(--mobile-dock-height, 0px) + 0.5rem)"
            >
              <ChatInput
                placeholder={`Message #${activeChannel?.name ?? ''}`}
                mentionOptions={mentionOptions}
                onSend={handleSend}
                onSendGif={handleSendGif}
                onCreatePoll={handleCreatePoll}
                onCreateForm={handleCreateForm}
              />
            </div>
          {:else}
            <div class="flex-1 grid place-items-center text-soft">
              {#if !serverId}
                <div>Pick a server to start chatting.</div>
              {:else}
                <div>Pick a channel to start chatting.</div>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    </div>

    <div class="hidden lg:flex lg:w-72 xl:w-80 panel-muted border-l border-subtle overflow-y-auto">
      {#if serverId}
        <MembersPane {serverId} />
      {:else}
        <div class="p-4 text-muted">No server selected.</div>
      {/if}
    </div>
  </div>
</div>

<!-- ======= MOBILE FULL-SCREEN PANELS (leave 72px rail visible) ======= -->

<!-- Channels panel (slides from left) -->
<div
  class="mobile-panel md:hidden fixed inset-0 z-50 flex flex-col transition-transform duration-300 will-change-transform"
  style:transform={showChannels ? 'translateX(0)' : 'translateX(-100%)'}
  style:pointer-events={showChannels ? 'auto' : 'none'}
  aria-label="Channels"
>
  <!-- mobile-only top bar (prevents stray arrow on desktop) -->
  <div class="mobile-panel__header md:hidden">
    <button
      class="mobile-panel__close -ml-2"
      aria-label="Back to chat"
      type="button"
      on:click={() => (showChannels = false)}
    >
      <i class="bx bx-chevron-left text-2xl"></i>
    </button>
    <div class="mobile-panel__title">Channels</div>
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
  class="mobile-panel md:hidden fixed inset-0 z-50 flex flex-col transition-transform duration-300 will-change-transform"
  style:transform={showMembers ? 'translateX(0)' : 'translateX(100%)'}
  style:pointer-events={showMembers ? 'auto' : 'none'}
  aria-label="Members"
>
  <div class="mobile-panel__header md:hidden">
    <button
      class="mobile-panel__close -ml-2"
      aria-label="Back to chat"
      type="button"
      on:click={() => (showMembers = false)}
    >
      <i class="bx bx-chevron-right text-2xl"></i>
    </button>
    <div class="mobile-panel__title">Members</div>
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
