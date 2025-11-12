<script lang="ts">
  import { run } from 'svelte/legacy';

  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/user';

  import LeftPane from '$lib/components/app/LeftPane.svelte';
  import ServerSidebar from '$lib/components/servers/ServerSidebar.svelte';
import ChannelHeader from '$lib/components/servers/ChannelHeader.svelte';
import MembersPane from '$lib/components/servers/MembersPane.svelte';
import ThreadMembersPane from '$lib/components/servers/ThreadMembersPane.svelte';
  import NewServerModal from '$lib/components/servers/NewServerModal.svelte';
  import ChannelMessagePane from '$lib/components/servers/ChannelMessagePane.svelte';
  import ThreadPane from '$lib/components/chat/ThreadPane.svelte';
  import VideoChat from '$lib/components/voice/VideoChat.svelte';
  import VoiceLobby from '$lib/components/voice/VoiceLobby.svelte';
  import { voiceSession } from '$lib/stores/voice';
  import type { VoiceSession } from '$lib/stores/voice';

  import { db } from '$lib/firestore';
  import { collection, doc, onSnapshot, orderBy, query, getDocs, getDoc, endBefore, limitToLast, where, limit, type Unsubscribe } from 'firebase/firestore';
  import { sendChannelMessage, submitChannelForm, toggleChannelReaction, voteOnChannelPoll } from '$lib/firestore/messages';
  import type { ReplyReferenceInput } from '$lib/firestore/messages';
  import { subscribeServerDirectory, type MentionDirectoryEntry } from '$lib/firestore/membersDirectory';
  import {
    createChannelThread,
    sendThreadMessage,
    streamChannelThreads,
    streamThreadMessages,
    markThreadRead as markThreadReadThread,
    type ChannelThread,
    type ThreadMessage
  } from '$lib/firestore/threads';
import { markChannelRead } from '$lib/firebase/unread';
import { uploadChannelFile } from '$lib/firebase/storage';
import { looksLikeImage } from '$lib/utils/fileType';
import type { PendingUploadPreview } from '$lib/components/chat/types';
  import { resolveProfilePhotoURL } from '$lib/utils/profile';

  
  interface Props {
    data: { serverId: string | null };
  }

  let { data }: Props = $props();

  const resolveServerId = (
    params: Record<string, string | undefined>,
    fallback: string | null | undefined
  ) => params.serverID ?? params.serversID ?? params.serverId ?? fallback ?? null;

  let serverId = $state<string | null>(null);
  run(() => {
    serverId = resolveServerId(
      $page.params as Record<string, string | undefined>,
      data?.serverId ?? null
    );
  });


  type Channel = { id: string; name: string; type: 'text' | 'voice'; position?: number };
  type MentionSendRecord = {
    uid: string;
    handle: string | null;
    label: string | null;
    color?: string | null;
    kind?: 'member' | 'role';
  };
  type ThreadPreviewMeta = {
    threadId: string;
    count: number;
    lastAt?: number;
    status: ChannelThread['status'];
    name?: string;
    unread?: boolean;
    archived?: boolean;
  };

let channels: Channel[] = $state([]);
let activeChannel: Channel | null = $state(null);
let requestedChannelId: string | null = $state(null);
let messages: any[] = $state([]);
let channelThreads: ChannelThread[] = $state([]);
let threadsByChannel: Record<string, ChannelThread[]> = $state({});
let threadServerScope: string | null = null;
let threadStats: Record<string, ThreadPreviewMeta> = $state({});
let activeThreadRoot: any = $state(null);
let activeThread: ChannelThread | null = $state(null);
let threadMessages: ThreadMessage[] = $state([]);
let threadReplyTarget: ReplyReferenceInput | null = $state(null);
let threadConversationContext: any[] = $state([]);
let threadDefaultSuggestionSource: any = $state(null);
let threadUnreadMap: Record<string, boolean> = $state({});
let latestInboundMessage: any = $state(null);
let aiConversationContext: any[] = $state([]);
let aiAssistEnabled = $state(true);
let replyTarget: ReplyReferenceInput | null = $state(null);
let lastReplyChannelId: string | null = $state(null);
let profiles: Record<string, any> = $state({});
let pendingUploads: PendingUploadPreview[] = $state([]);
let scrollToBottomSignal = $state(0);
let lastPendingChannelId: string | null = $state(null);
let pendingThreadId: string | null = null;
let pendingThreadRoot: any = null;
const threadReadStops = new Map<string, Unsubscribe>();
let threadReadCursors: Record<string, number | null> = {};
let threadsUnsub: Unsubscribe | null = null;
let threadMessagesUnsub: Unsubscribe | null = null;
let lastThreadStreamChannel: string | null = null;
let lastThreadStreamId: string | null = null;
  const profileUnsubs: Record<string, Unsubscribe> = {};
  let serverDisplayName = $state('Server');
  let serverMetaUnsub: Unsubscribe | null = $state(null);
  let mentionOptions: MentionDirectoryEntry[] = $state([]);
  let memberMentionOptions: MentionDirectoryEntry[] = $state([]);
  let roleMentionOptions: MentionDirectoryEntry[] = $state([]);
  let mentionDirectoryStop: Unsubscribe | null = $state(null);
  let mentionRolesStop: Unsubscribe | null = $state(null);
  let lastMentionServer: string | null = $state(null);

  const canonicalHandle = (value: string) =>
    (value ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

  function updateMentionOptionList() {
    mentionOptions = [...memberMentionOptions, ...roleMentionOptions];
  }

  function buildRoleMentionEntry(roleId: string, data: any): MentionDirectoryEntry {
    const label = pickString(data?.name) ?? 'Role';
    const color = pickString(data?.color) ?? null;
    const base = canonicalHandle(label) || 'role';
    const suffix = roleId.slice(-4).toLowerCase();
    const handle = `${base}${suffix}`;
    const aliases = new Set<string>();
    aliases.add(base);
    label
      .split(/\s+/)
      .filter(Boolean)
      .forEach((part) => aliases.add(canonicalHandle(part)));
    aliases.add((label ?? '').replace(/\s+/g, '').toLowerCase());
    return {
      uid: `role:${roleId}`,
      label,
      handle,
      avatar: null,
      search: `${label}`.toLowerCase(),
      aliases: Array.from(aliases).filter(Boolean),
      kind: 'role',
      color,
      roleId
    };
  }

  function startRoleMentionWatch(serverId: string) {
    mentionRolesStop?.();
    roleMentionOptions = [];
    const database = db();
    const roleQuery = query(collection(database, 'servers', serverId, 'roles'), orderBy('position'));
    mentionRolesStop = onSnapshot(
      roleQuery,
      (snap) => {
        roleMentionOptions = snap.docs.map((docSnap) =>
          buildRoleMentionEntry(docSnap.id, docSnap.data())
        );
        updateMentionOptionList();
      },
      () => {
        roleMentionOptions = [];
        updateMentionOptionList();
      }
    );
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

  function inferMessageType(raw: any) {
    return (
      raw?.type ??
      (raw?.file
        ? 'file'
        : raw?.poll
          ? 'poll'
          : raw?.form
            ? 'form'
            : raw?.url
              ? 'gif'
              : 'text')
    );
  }

  const REPLY_SNIPPET_LIMIT = 140;

  function clipReply(value: string | null | undefined, limit = REPLY_SNIPPET_LIMIT) {
    if (!value) return '';
    return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
  }

  function describeReplyPreview(raw: any, type: string) {
    switch (type) {
      case 'gif':
        return 'GIF';
      case 'file': {
        const name = pickString(raw?.file?.name);
        return name ? `File: ${name}` : 'File';
      }
      case 'poll': {
        const question = pickString(raw?.poll?.question);
        return question ? `Poll: ${question}` : 'Poll';
      }
      case 'form': {
        const title = pickString(raw?.form?.title);
        return title ? `Form: ${title}` : 'Form';
      }
      default: {
        const body = pickString(raw?.text) ?? pickString(raw?.content) ?? '';
        const clipped = clipReply(body);
        return clipped || 'Message';
      }
    }
  }


  function buildReplyReference(message: any): ReplyReferenceInput | null {
    const messageId = pickString(message?.id);
    if (!messageId) return null;
    const type = inferMessageType(message);
    const authorId = pickString(message?.uid) ?? pickString(message?.authorId) ?? null;
    const authorRecord = authorId ? profiles[authorId] : null;
    const authorName =
      pickString(message?.displayName) ??
      pickString(authorRecord?.displayName) ??
      (authorId === $user?.uid ? 'You' : authorId);
    const preview = describeReplyPreview(message, type);
    const parent = cloneReplyChain(message?.replyTo ?? null);
    const replyRef: ReplyReferenceInput = {
      messageId,
      authorId,
      authorName: authorName ?? null,
      preview: preview || null,
      text: preview || null,
      type
    };
    if (parent) replyRef.parent = parent;
    return replyRef;
  }

  function cloneReplyChain(raw: any): ReplyReferenceInput | null {
    const messageId = pickString(raw?.messageId);
    if (!messageId) return null;
    const preview =
      clipReply(pickString(raw?.preview) ?? pickString(raw?.text) ?? '') || null;
    const node: ReplyReferenceInput = {
      messageId,
      authorId: pickString(raw?.authorId) ?? null,
      authorName: pickString(raw?.authorName) ?? null,
      preview,
      text: pickString(raw?.text) ?? preview,
      type: pickString(raw?.type) ?? null
    };
    const parent = cloneReplyChain(raw?.parent ?? null);
    if (parent) node.parent = parent;
    return node;
  }

  function resolveThreadRootId(reply: ReplyReferenceInput | null | undefined) {
    if (!reply) return null;
    let current: ReplyReferenceInput | null | undefined = reply;
    let candidate: string | null = null;
    while (current) {
      candidate = pickString(current.messageId) || candidate;
      current = current.parent;
    }
    return candidate;
  }

  function messageBelongsToThread(message: any, rootId: string | null) {
    if (!rootId) return false;
    const replyRef = message?.replyTo ?? null;
    if (!replyRef) return false;
    const resolved = resolveThreadRootId(replyRef) ?? pickString(replyRef.messageId);
    return resolved === rootId;
  }

  function toMillis(value: any) {
    if (!value) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value?.toMillis === 'function') {
      try {
        return value.toMillis();
      } catch {
        // ignore
      }
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function consumeReply(explicit?: ReplyReferenceInput | null) {
    const candidate =
      explicit && explicit.messageId
        ? explicit
        : replyTarget && replyTarget.messageId
          ? replyTarget
          : null;
    replyTarget = null;
    return candidate && candidate.messageId ? candidate : null;
  }

  function restoreReply(ref: ReplyReferenceInput | null) {
    if (ref?.messageId) {
      replyTarget = ref;
    }
  }

  function toChatMessage(id: string, raw: any) {
    const uid = pickString(raw?.uid) ?? pickString(raw?.authorId) ?? 'unknown';
    const displayName =
      pickString(raw?.displayName) ?? pickString(raw?.author?.displayName);
    const photoURL =
      pickString(raw?.photoURL) ?? pickString(raw?.author?.photoURL);
    const createdAt = raw?.createdAt ?? null;
    const inferredType = inferMessageType(raw);

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
            label: pickString((value as any)?.label) ?? null,
            color: pickString((value as any)?.color) ?? null,
            kind: (value as any)?.kind === 'role' ? 'role' : (value as any)?.kind === 'member' ? 'member' : undefined
          }))
        : [];
    const mentions = mentionArray
      .map((entry) => ({
        uid: pickString(entry?.uid) ?? '',
        handle: pickString((entry as any)?.handle) ?? null,
        label: pickString((entry as any)?.label) ?? null,
        color: pickString((entry as any)?.color) ?? null,
        kind: (entry as any)?.kind === 'role' ? 'role' : (entry as any)?.kind === 'member' ? 'member' : undefined
      }))
      .filter((entry) => entry.uid);
    if (mentions.length) {
      message.mentions = mentions;
    }

    const replyTree = cloneReplyChain(raw?.replyTo ?? null);
    if (replyTree) {
      message.replyTo = replyTree;
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

  const makeUploadId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2);
  };

  function registerPendingUpload(file: File): {
    id: string;
    update(progress: number): void;
    finish(success: boolean): void;
  } {
    const id = makeUploadId();
    const isImage = looksLikeImage({ name: file?.name, type: file?.type });
    const previewUrl =
      isImage && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : null;
    let currentProgress = 0;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;

    const entry: PendingUploadPreview = {
      id,
      uid: $user?.uid ?? null,
      name: file?.name || 'Upload',
      size: file?.size,
      contentType: file?.type ?? null,
      isImage,
      progress: currentProgress,
      previewUrl
    };
    pendingUploads = [...pendingUploads, entry];

    const commitProgress = (value: number) => {
      if (!Number.isFinite(value)) return;
      currentProgress = Math.min(1, Math.max(currentProgress, value));
      pendingUploads = pendingUploads.map((item) =>
        item.id === id ? { ...item, progress: currentProgress } : item
      );
      if (currentProgress >= 0.99 && fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const ensureFallback = () => {
      if (fallbackTimer) return;
      fallbackTimer = setInterval(() => {
        if (currentProgress >= 0.95) return;
        commitProgress(currentProgress + 0.01);
      }, 1200);
    };

    ensureFallback();

    return {
      id,
      update(progress: number) {
        ensureFallback();
        commitProgress(progress);
      },
      finish(success: boolean) {
        if (fallbackTimer) {
          clearInterval(fallbackTimer);
          fallbackTimer = null;
        }
        if (success) {
          commitProgress(1);
        }
        pendingUploads = pendingUploads.filter((item) => item.id !== id);
        if (previewUrl) {
          try {
            URL.revokeObjectURL(previewUrl);
          } catch {
            // ignore
          }
        }
      }
    };
  }
  let showCreate = $state(false);
  let voiceState: VoiceSession | null = $state(null);
  let isVoiceChannelView = $state(false);
  let isViewingActiveVoiceChannel = $state(false);
  let showVoiceLobby = $state(false);
  let voiceInviteUrl: string | null = $state(null);
  let currentUserDisplayName = $state('');
  let currentUserPhotoURL: string | null = $state(null);
  const unsubscribeVoice = voiceSession.subscribe((value) => {
    voiceState = value;
  });





  // listeners
  let channelsUnsub: (() => void) | null = $state(null);
  let messagesUnsub: (() => void) | null = null;

  function clearChannelsUnsub() { channelsUnsub?.(); channelsUnsub = null; }
  function clearMessagesUnsub() { messagesUnsub?.(); messagesUnsub = null; }
  function clearThreadsUnsub() { threadsUnsub?.(); threadsUnsub = null; }
  function clearThreadMessagesUnsub() { threadMessagesUnsub?.(); threadMessagesUnsub = null; }
  function clearThreadReadSubs() {
    threadReadStops.forEach((stop) => stop());
    threadReadStops.clear();
    threadReadCursors = {};
  }
  function resetThreadState(options: { resetCache?: boolean } = {}) {
    clearThreadMessagesUnsub();
    clearThreadsUnsub();
    clearThreadReadSubs();
    channelThreads = [];
    threadStats = {};
    threadUnreadMap = {};
    activeThread = null;
    activeThreadRoot = null;
    threadMessages = [];
    threadConversationContext = [];
    threadDefaultSuggestionSource = null;
    threadReplyTarget = null;
    pendingThreadId = null;
    pendingThreadRoot = null;
    if (options.resetCache) {
      threadsByChannel = {};
    }
  }

  function selectChannelObject(id: string): Channel {
    const found = channels.find((c) => c.id === id);
    return found ?? { id, name: id, type: 'text' };
  }

  const triggerScrollToBottom = () => {
    scrollToBottomSignal = Date.now();
  };

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
      triggerScrollToBottom();
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

  function watchThreadRead(threadId: string) {
    if (!$user?.uid) return;
    if (threadReadStops.has(threadId)) return;
    const database = db();
    const ref = doc(database, 'profiles', $user.uid, 'threadMembership', threadId);
    const stop = onSnapshot(
      ref,
      (snap) => {
        const data: any = snap.data() ?? {};
        const raw = data?.lastReadAt ?? null;
        threadReadCursors[threadId] = raw?.toMillis?.() ? raw.toMillis() : toMillis(raw);
        recomputeThreadStats();
      },
      () => {
        threadReadCursors[threadId] = null;
      }
    );
    threadReadStops.set(threadId, stop);
  }

  function recomputeThreadStats() {
    const aggregates: Record<string, ThreadPreviewMeta> = {};
    const unreadMap: Record<string, boolean> = {};
    for (const thread of channelThreads) {
      const rootId = pickString(thread.createdFromMessageId ?? null);
      if (!rootId) continue;
      const lastAt = toMillis(thread.lastMessageAt);
      const readAt = threadReadCursors[thread.id] ?? null;
      const unread = Boolean(lastAt && (!readAt || readAt < lastAt));
      aggregates[rootId] = {
        threadId: thread.id,
        count: thread.messageCount ?? 0,
        lastAt: lastAt ?? undefined,
        status: thread.status,
        name: thread.name,
        unread,
        archived: thread.status === 'archived'
      };
      unreadMap[thread.id] = unread;
    }
    threadStats = aggregates;
    threadUnreadMap = unreadMap;
  }

  function subscribeThreads(currServerId: string, channelId: string) {
    clearThreadsUnsub();
    channelThreads = [];
    const stop = streamChannelThreads(currServerId, channelId, (list) => {
      channelThreads = list;
      threadsByChannel = { ...threadsByChannel, [channelId]: list };
      const present = new Set(list.map((thread) => thread.id));
      present.forEach((threadId) => watchThreadRead(threadId));
      for (const [threadId, stopRead] of threadReadStops) {
        if (!present.has(threadId)) {
          stopRead();
          threadReadStops.delete(threadId);
          delete threadReadCursors[threadId];
        }
      }
      if (pendingThreadId) {
        const pending = list.find((thread) => thread.id === pendingThreadId);
        if (pending) {
          const root =
            pendingThreadRoot ??
            messages.find((msg) => msg.id === pending.createdFromMessageId) ??
            activeThreadRoot ??
            null;
          if (root) {
            activateThreadView(pending, root);
          } else {
            activeThread = pending;
            prefetchThreadMemberProfiles(pending);
          }
          pendingThreadId = null;
          pendingThreadRoot = null;
        }
      } else if (activeThread) {
        const current = list.find((thread) => thread.id === activeThread?.id);
        if (current) {
          activeThread = current;
          prefetchThreadMemberProfiles(current);
        } else {
          closeThreadView();
        }
      }
      recomputeThreadStats();
    });
    threadsUnsub = stop;
  }

function sidebarThreadList() {
  const combined: Array<ChannelThread & { unread?: boolean }> = [];
  const cacheEntries = Object.values(threadsByChannel);
  const seen = new Set<string>();
  if (cacheEntries.length) {
    for (const list of cacheEntries) {
      for (const thread of list ?? []) {
        if (!thread || thread.status === 'archived' || seen.has(thread.id)) continue;
        seen.add(thread.id);
        combined.push({
          ...thread,
          unread: threadUnreadMap[thread.id] ?? false
        });
      }
    }
  } else if (channelThreads.length) {
    for (const thread of channelThreads) {
      if (thread.status === 'archived') continue;
      combined.push({
        ...thread,
        unread: threadUnreadMap[thread.id] ?? false
      });
    }
  }
  return combined;
}

  function resolveThreadMembers() {
    if (!activeThread) return [];
    return (activeThread.memberUids ?? []).map((uid) => {
      const profile = profiles[uid] ?? {};
      return {
        uid,
        displayName:
          pickString(profile.displayName) ??
          pickString(profile.name) ??
          pickString(profile.email) ??
          uid,
        photoURL: resolveProfilePhotoURL(profile)
      };
    });
  }

  function attachThreadStream(thread: ChannelThread | null) {
    if (!thread || !serverId || !activeChannel?.id) {
      clearThreadMessagesUnsub();
      threadMessages = [];
      lastThreadStreamChannel = null;
      lastThreadStreamId = null;
      return;
    }
    if (
      lastThreadStreamChannel === activeChannel.id &&
      lastThreadStreamId === thread.id
    ) {
      return;
    }
    clearThreadMessagesUnsub();
    lastThreadStreamChannel = activeChannel.id;
    lastThreadStreamId = thread.id;
    threadMessagesUnsub = streamThreadMessages(serverId, activeChannel.id, thread.id, (list) => {
      threadMessages = list;
      if ($user?.uid && activeThread?.id === thread.id && serverId && activeChannel?.id) {
        const last = list[list.length - 1];
        const at = last?.createdAt ?? null;
        const lastId = last?.id ?? null;
        void markThreadReadThread($user.uid, serverId, activeChannel.id, thread.id, {
          at,
          lastMessageId: lastId
        });
      }
    });
  }

  function pickChannel(id: string) {
    if (!serverId) return;
    const next = selectChannelObject(id);
    activeChannel = next;
    messages = [];
    resetThreadState();

    if (next.type === 'voice') {
      clearMessagesUnsub();
      cleanupProfileSubscriptions();
      profiles = {};
      if (voiceState && voiceState.serverId === serverId && voiceState.channelId === next.id) {
        voiceSession.setVisible(true);
      } else if (voiceState) {
        voiceSession.setVisible(false);
      }
    } else {
      subscribeMessages(serverId, id);
      subscribeThreads(serverId, id);
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
            keepFocus: true,
            noScroll: true
          });
        }
      } catch {}
    }
  }

  function joinSelectedVoiceChannel() {
    if (!serverId || !activeChannel || activeChannel.type !== 'voice') return;
    if (
      voiceState &&
      voiceState.serverId === serverId &&
      voiceState.channelId === activeChannel.id
    ) {
      voiceSession.setVisible(true);
      return;
    }
    voiceSession.join(serverId, activeChannel.id, activeChannel.name ?? 'Voice channel', serverDisplayName);
    voiceSession.setVisible(true);
  }

  /* ===========================
     Mobile panels + gestures
     =========================== */
  let showChannels = $state(false);
  let showMembers = $state(false);
  let isMobile = $state(false);
  let mobileVoicePane: 'call' | 'chat' = $state('chat');
  let mobilePaneTracking = false;
  let mobilePaneStartX = 0;
  let mobilePaneStartY = 0;
  let lastVoiceVisible = $state(false);
  let lastIsMobile = $state(false);
  let hideMessageInput = $state(false);

  const LEFT_RAIL = 72;
  const EDGE_ZONE = 40;
  const SWIPE = 48;

  let tracking = false;
  let startX = 0;
  let startY = 0;

  const inLeftEdgeZone = (value: number) => {
    if (isMobile) return value <= EDGE_ZONE;
    return value >= LEFT_RAIL && value <= LEFT_RAIL + EDGE_ZONE;
  };

  function setupGestures() {
    if (typeof window === 'undefined') return () => {};

    const mdQuery = window.matchMedia('(min-width: 768px)');
    const lgQuery = window.matchMedia('(min-width: 1024px)');

    const onMedia = () => {
      const nextIsMobile = !mdQuery.matches;
      isMobile = nextIsMobile;
      if (!nextIsMobile) {
        mobileVoicePane = 'chat';
      } else if (voiceState?.visible) {
        mobileVoicePane = 'call';
      }
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

      const nearLeft = inLeftEdgeZone(startX);
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
        const fromLeft = inLeftEdgeZone(startX) && dx >= SWIPE;
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

  function setMobileVoicePane(pane: 'call' | 'chat') {
    mobileVoicePane = pane;
  }

  function handleMobilePaneTouchStart(event: TouchEvent) {
    if (!isMobile || !(voiceState && voiceState.visible)) return;
    if (event.touches.length !== 1) return;
    mobilePaneTracking = true;
    const touch = event.touches[0];
    mobilePaneStartX = touch.clientX;
    mobilePaneStartY = touch.clientY;
  }

  function handleMobilePaneTouchMove(event: TouchEvent) {
    if (!mobilePaneTracking || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - mobilePaneStartX;
    const dy = touch.clientY - mobilePaneStartY;
    if (Math.abs(dy) > Math.abs(dx) * 1.25) return;
    if (mobileVoicePane === 'call' && dx <= -SWIPE) {
      mobileVoicePane = 'chat';
      mobilePaneTracking = false;
    } else if (mobileVoicePane === 'chat' && dx >= SWIPE) {
      mobileVoicePane = 'call';
      mobilePaneTracking = false;
    }
  }

  function handleMobilePaneTouchEnd() {
    mobilePaneTracking = false;
  }




  onDestroy(() => {
    clearChannelsUnsub();
    clearMessagesUnsub();
    resetThreadState();
    cleanupProfileSubscriptions();
    unsubscribeVoice();
    serverMetaUnsub?.();
    serverMetaUnsub = null;
    mentionDirectoryStop?.();
    mentionDirectoryStop = null;
    mentionRolesStop?.();
    mentionRolesStop = null;
    lastMentionServer = null;
    memberMentionOptions = [];
    roleMentionOptions = [];
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

  function normalizeMentionSendList(list: MentionSendRecord[] | undefined) {
    if (!Array.isArray(list) || !list.length) return [];
    const cleaned = list.filter(
      (item): item is MentionSendRecord =>
        !!item?.uid && (!!item?.handle || !!item?.label)
    );
    if (!cleaned.length || !mentionOptions.length) return cleaned;
    const allowed = new Set(mentionOptions.map((entry) => entry.uid));
    return cleaned.filter((item) => allowed.has(item.uid));
  }

  async function handleSend(payload: string | { text: string; mentions?: MentionSendRecord[]; replyTo?: ReplyReferenceInput | null }) {
    const raw = typeof payload === 'string' ? payload : payload?.text ?? '';
    const trimmed = raw?.trim?.() ?? '';
    if (!trimmed) return;
    if (!serverId) { alert('Missing server id.'); return; }
    if (!activeChannel?.id) { alert('Pick a channel first.'); return; }
    if (!$user) { alert('Sign in to send messages.'); return; }
    const replyRef = consumeReply(typeof payload === 'object' ? payload?.replyTo ?? null : null);
    const mentionList = normalizeMentionSendList(
      typeof payload === 'object' ? payload?.mentions ?? [] : []
    );
    try {
      await sendChannelMessage(serverId, activeChannel.id, {
        type: 'text',
        text: trimmed,
        uid: $user.uid,
        displayName: deriveCurrentDisplayName(),
        photoURL: deriveCurrentPhotoURL(),
        mentions: mentionList,
        replyTo: replyRef ?? undefined
      });
    } catch (err) {
      restoreReply(replyRef);
      console.error(err);
      alert(`Failed to send message: ${err}`);
    }
  }

  async function handleSendGif(detail: string | { url: string; replyTo?: ReplyReferenceInput | null }) {
    const trimmed = pickString(typeof detail === 'string' ? detail : detail?.url);
    if (!trimmed) return;
    if (!serverId) { alert('Missing server id.'); return; }
    if (!activeChannel?.id) { alert('Pick a channel first.'); return; }
    if (!$user) { alert('Sign in to send messages.'); return; }
    const replyRef = consumeReply(typeof detail === 'object' ? detail?.replyTo ?? null : null);
    try {
      await sendChannelMessage(serverId, activeChannel.id, {
        type: 'gif',
        url: trimmed,
        uid: $user.uid,
        displayName: deriveCurrentDisplayName(),
        photoURL: deriveCurrentPhotoURL(),
        replyTo: replyRef ?? undefined
      });
    } catch (err) {
      restoreReply(replyRef);
      console.error(err);
      alert(`Failed to share GIF: ${err}`);
    }
  }

  async function handleUploadFiles(request: { files: File[]; replyTo?: ReplyReferenceInput | null }) {
    const selection = Array.from(request?.files ?? []).filter((file): file is File => file instanceof File);
    if (!selection.length) return;
    if (!serverId) { alert('Missing server id.'); return; }
    if (!activeChannel?.id) { alert('Pick a channel first.'); return; }
    if (!$user) { alert('Sign in to send messages.'); return; }
    const replyRef = consumeReply(request?.replyTo ?? null);
    let replyUsed = false;
    const identity = {
      uid: $user.uid,
      displayName: deriveCurrentDisplayName(),
      photoURL: deriveCurrentPhotoURL()
    };
    for (const file of selection) {
      const pending = registerPendingUpload(file);
      try {
        const uploaded = await uploadChannelFile({
          serverId,
          channelId: activeChannel.id,
          uid: $user.uid,
          file,
          onProgress: (progress) => pending.update(progress ?? 0)
        });
        await sendChannelMessage(serverId, activeChannel.id, {
          type: 'file',
          file: {
            name: file.name || uploaded.name,
            url: uploaded.url,
            size: file.size ?? uploaded.size,
            contentType: file.type || uploaded.contentType,
            storagePath: uploaded.storagePath
          },
          ...identity,
          replyTo: !replyUsed && replyRef ? replyRef : undefined
        });
        pending.finish(true);
        if (replyRef && !replyUsed) {
          replyUsed = true;
        }
      } catch (err) {
        pending.finish(false);
        if (replyRef && !replyUsed) {
          restoreReply(replyRef);
        }
        console.error(err);
        alert(`Failed to upload ${file?.name || 'file'}: ${err instanceof Error ? err.message : err}`);
        break;
      }
    }
  }

  async function handleCreatePoll(poll: { question: string; options: string[]; replyTo?: ReplyReferenceInput | null }) {
    if (!serverId) { alert('Missing server id.'); return; }
    if (!activeChannel?.id) { alert('Pick a channel first.'); return; }
    if (!$user) { alert('Sign in to send messages.'); return; }
    const replyRef = consumeReply(poll?.replyTo ?? null);
    try {
      await sendChannelMessage(serverId, activeChannel.id, {
        type: 'poll',
        poll: {
          question: poll.question,
          options: poll.options
        },
        uid: $user.uid,
        displayName: deriveCurrentDisplayName(),
        photoURL: deriveCurrentPhotoURL(),
        replyTo: replyRef ?? undefined
      });
    } catch (err) {
      restoreReply(replyRef);
      console.error(err);
      alert(`Failed to create poll: ${err}`);
    }
  }

  async function handleCreateForm(form: { title: string; questions: string[]; replyTo?: ReplyReferenceInput | null }) {
    if (!serverId) { alert('Missing server id.'); return; }
    if (!activeChannel?.id) { alert('Pick a channel first.'); return; }
    if (!$user) { alert('Sign in to send messages.'); return; }
    const replyRef = consumeReply(form?.replyTo ?? null);
    try {
      await sendChannelMessage(serverId, activeChannel.id, {
        type: 'form',
        form: {
          title: form.title,
          questions: form.questions
        },
        uid: $user.uid,
        displayName: deriveCurrentDisplayName(),
        photoURL: deriveCurrentPhotoURL(),
        replyTo: replyRef ?? undefined
      });
    } catch (err) {
      restoreReply(replyRef);
      console.error(err);
      alert(`Failed to share form: ${err}`);
    }
  }

  async function handleThreadSend(payload: string | { text: string; mentions?: MentionSendRecord[] }) {
    const raw = typeof payload === 'string' ? payload : payload?.text ?? '';
    const trimmed = raw?.trim?.() ?? '';
    if (!trimmed) return;
    if (!serverId) { alert('Missing server id.'); return; }
    if (!activeChannel?.id) { alert('Pick a channel first.'); return; }
    if (!activeThread) { alert('Open a thread before replying.'); return; }
    if (!$user) { alert('Sign in to send messages.'); return; }
    const mentions = normalizeMentionSendList(
      typeof payload === 'object' ? payload?.mentions ?? [] : []
    );
    try {
      await sendThreadMessage({
        serverId,
        channelId: activeChannel.id,
        threadId: activeThread.id,
        author: {
          uid: $user.uid,
          displayName: deriveCurrentDisplayName()
        },
        text: trimmed,
        mentions
      });
    } catch (err) {
      console.error(err);
      alert(`Failed to send thread reply: ${err instanceof Error ? err.message : err}`);
    }
  }

  async function handleThreadSendGif() {
    alert('GIFs are not supported inside threads yet.');
  }

  async function handleThreadUploadFiles() {
    alert('File uploads are not supported inside threads yet.');
  }

  async function handleThreadCreatePoll() {
    alert('Polls are not supported inside threads yet.');
  }

  async function handleThreadCreateForm() {
    alert('Forms are not supported inside threads yet.');
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

  function handleReplyRequest(event: CustomEvent<{ message: any }>) {
    const ref = buildReplyReference(event.detail?.message);
    if (ref) replyTarget = ref;
  }

  function activateThreadView(thread: ChannelThread, rootMessage: any) {
    activeThreadRoot = rootMessage;
    threadReplyTarget = null;
    activeThread = thread;
    pendingThreadId = null;
    pendingThreadRoot = null;
    attachThreadStream(thread);
    prefetchThreadMemberProfiles(thread);
  }

  function prefetchThreadMemberProfiles(thread: ChannelThread | null) {
    if (!thread) return;
    try {
      const database = db();
      for (const uid of thread.memberUids ?? []) {
        ensureProfileSubscription(database, uid);
      }
    } catch (err) {
      console.error('[threads] failed to prefetch member profiles', err);
    }
  }

  async function openThreadFromMessage(message: any) {
    if (!message) return;
    if (!serverId) { alert('Missing server id.'); return; }
    if (!activeChannel?.id) { alert('Pick a channel first.'); return; }
    let existing =
      channelThreads.find((thread) => thread.createdFromMessageId === message.id) ?? null;
    if (!existing) {
      try {
        const database = db();
        const threadSnap = await getDocs(
          query(
            collection(database, 'servers', serverId, 'channels', activeChannel.id, 'threads'),
            where('createdFromMessageId', '==', message.id),
            limit(1)
          )
        );
        const docSnap = threadSnap.docs[0];
        if (docSnap) {
          pendingThreadId = docSnap.id;
          pendingThreadRoot = message;
          return;
        }
      } catch (err) {
        console.error('[threads] lookup failed', err);
      }
    }
    if (existing) {
      activateThreadView(existing, message);
      return;
    }
    if (!$user) {
      alert('Sign in to start a thread.');
      return;
    }
    try {
      const mentionUids = Array.isArray(message?.mentions)
        ? message.mentions
            .map((mention: any) => pickString(mention?.uid))
            .filter((value: string | undefined): value is string => Boolean(value))
        : [];
      pendingThreadId = await createChannelThread({
        serverId,
        channelId: activeChannel.id,
        sourceMessageId: message.id,
        sourceMessageText:
          pickString(message?.text) ??
          pickString(message?.content) ??
          pickString(message?.preview) ??
          '',
        creator: {
          uid: $user.uid,
          displayName: deriveCurrentDisplayName()
        },
        initialMentions: mentionUids,
        mentionProfiles: profiles
      });
      pendingThreadRoot = message;
      await hydrateThreadAfterCreate(pendingThreadId, message);
    } catch (err) {
      console.error(err);
      alert(`Failed to start thread: ${err instanceof Error ? err.message : err}`);
      pendingThreadId = null;
      pendingThreadRoot = null;
    }
  }

  async function hydrateThreadAfterCreate(threadId: string | null, rootMessage: any) {
    if (!threadId || !serverId || !activeChannel?.id) return;
    try {
      const database = db();
      const snap = await getDoc(
        doc(database, 'servers', serverId, 'channels', activeChannel.id, 'threads', threadId)
      );
      if (!snap.exists()) return;
      const raw = snap.data() ?? {};
      const hydrated = { id: snap.id, ...(raw as ChannelThread) } as ChannelThread;
      activateThreadView(hydrated, rootMessage);
      const channelId = activeChannel.id;
      const previous = threadsByChannel[channelId] ?? [];
      const nextList = previous.some((entry) => entry.id === hydrated.id)
        ? previous.map((entry) => (entry.id === hydrated.id ? hydrated : entry))
        : [hydrated, ...previous];
      threadsByChannel = { ...threadsByChannel, [channelId]: nextList };
      if (!channelThreads.some((entry) => entry.id === hydrated.id)) {
        channelThreads = [hydrated, ...channelThreads];
        recomputeThreadStats();
      }
    } catch (err) {
      console.error('[threads] failed to hydrate newly created thread', err);
    }
  }

  async function ensureChannelActive(channelId: string) {
    if (!channelId) return false;
    if (activeChannel?.id === channelId) return true;
    pickChannel(channelId);
    const started = Date.now();
    while (Date.now() - started < 2000) {
      if (activeChannel?.id === channelId) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return activeChannel?.id === channelId;
  }

  async function openThreadFromSidebar(target: { id: string; parentChannelId: string }) {
    if (!serverId) return;
    const { id: threadId, parentChannelId } = target;
    const channelReady = await ensureChannelActive(parentChannelId);
    if (!channelReady || !activeChannel?.id) {
      alert('Unable to open the thread yet. Please try again.');
      return;
    }
    let thread = channelThreads.find((entry) => entry.id === threadId);
    if (!thread) {
      try {
        const database = db();
        const snap = await getDoc(
          doc(database, 'servers', serverId, 'channels', activeChannel.id, 'threads', threadId)
        );
        if (snap.exists()) {
          const raw = snap.data() as ChannelThread;
          thread = {
            id: snap.id,
            ...raw,
            channelId: raw?.channelId ?? raw?.parentChannelId ?? activeChannel.id,
            parentChannelId: raw?.parentChannelId ?? raw?.channelId ?? activeChannel.id
          };
        }
      } catch (err) {
        console.error('[threads] failed to load thread metadata', err);
      }
    }
    if (!thread) {
      alert('Unable to load that thread right now.');
      return;
    }
    let root = messages.find((msg) => msg.id === thread.createdFromMessageId) ?? null;
    if (!root) {
      try {
        const database = db();
        const snap = await getDoc(
          doc(database, 'servers', serverId, 'channels', activeChannel.id, 'messages', thread.createdFromMessageId)
        );
        if (snap.exists()) {
          root = toChatMessage(snap.id, snap.data());
        }
      } catch (err) {
        console.error('[threads] failed to load root message', err);
      }
    }
    if (!root) {
      alert('Unable to load the thread source message yet.');
      return;
    }
    activateThreadView(thread as ChannelThread, root);
  }

  function closeThreadView() {
    activeThreadRoot = null;
    activeThread = null;
    threadReplyTarget = null;
    threadMessages = [];
    threadConversationContext = [];
    threadDefaultSuggestionSource = null;
    pendingThreadId = null;
    pendingThreadRoot = null;
    attachThreadStream(null);
  }

  function handleThreadReplySelect(event: CustomEvent<{ message: any }>) {
    const ref = buildReplyReference(event.detail?.message) ?? buildReplyReference(activeThreadRoot);
    threadReplyTarget = ref;
  }

  function resetThreadReplyTarget() {
    threadReplyTarget = null;
  }
  run(() => {
    const scope = serverId ?? null;
    if (scope !== threadServerScope) {
      threadServerScope = scope;
      resetThreadState({ resetCache: true });
    }
  });
  run(() => {
    const currentMentionServer = serverId ?? null;
    if (currentMentionServer !== lastMentionServer) {
      mentionDirectoryStop?.();
      mentionRolesStop?.();
      memberMentionOptions = [];
      roleMentionOptions = [];
      mentionOptions = [];
      lastMentionServer = currentMentionServer;
      if (currentMentionServer) {
        mentionDirectoryStop = subscribeServerDirectory(currentMentionServer, (entries) => {
          memberMentionOptions = entries;
          updateMentionOptionList();
        });
        startRoleMentionWatch(currentMentionServer);
      } else {
        mentionDirectoryStop = null;
        mentionRolesStop = null;
      }
    }
  });
  run(() => {
    requestedChannelId = $page?.url?.searchParams?.get('channel') ?? null;
  });
  // subscribe to channels
  run(() => {
    if (serverId) {
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
  });
  run(() => {
    const channelId = activeChannel?.id ?? null;
    if (channelId !== lastReplyChannelId) {
      lastReplyChannelId = channelId;
      replyTarget = null;
    }
    if (channelId !== lastPendingChannelId) {
      lastPendingChannelId = channelId;
      pendingUploads = [];
    }
  });
  run(() => {
    const visible = !!(voiceState && voiceState.visible);
    if (visible !== lastVoiceVisible) {
      lastVoiceVisible = visible;
      if (isMobile) {
        mobileVoicePane = visible ? 'call' : 'chat';
      }
    }
  });
  run(() => {
    isVoiceChannelView = activeChannel?.type === 'voice';
  });
  run(() => {
    isViewingActiveVoiceChannel =
      Boolean(
        isVoiceChannelView &&
          voiceState &&
          serverId &&
          voiceState.serverId === serverId &&
          voiceState.channelId === activeChannel?.id
      );
  });
  run(() => {
    showVoiceLobby = Boolean(isVoiceChannelView && !isViewingActiveVoiceChannel);
  });
  run(() => {
    voiceInviteUrl = (() => {
      if (!serverId || !activeChannel || activeChannel.type !== 'voice') return null;
      try {
        const url = new URL($page.url.href);
        url.searchParams.set('channel', activeChannel.id);
        return url.toString();
      } catch {
        return `${$page.url.pathname}?channel=${encodeURIComponent(activeChannel.id)}`;
      }
    })();
  });
  run(() => {
    if (isViewingActiveVoiceChannel && voiceState && !voiceState.visible) {
      voiceSession.setVisible(true);
    }
  });
  run(() => {
    currentUserDisplayName = deriveCurrentDisplayName();
  });
  run(() => {
    currentUserPhotoURL = deriveCurrentPhotoURL();
  });
  run(() => {
    if (isMobile !== lastIsMobile) {
      lastIsMobile = isMobile;
      if (!isMobile) {
        mobileVoicePane = 'chat';
      } else if (voiceState?.visible) {
        mobileVoicePane = 'call';
      }
    }
  });
  run(() => {
    if ($user?.uid) {
      const fallbackPhoto = pickString($user.photoURL) ?? null;
      updateProfileCache($user.uid, {
        displayName: pickString($user.displayName) ?? pickString($user.email) ?? 'You',
        photoURL: fallbackPhoto,
        authPhotoURL: fallbackPhoto,
        email: pickString($user.email) ?? undefined
      });
    }
  });
  // mobile: when switching servers, open channels panel
  run(() => {
    if (serverId) {
      const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
      if (!isDesktop && !activeChannel) {
        showChannels = true;
        showMembers = false;
      }
    }
  });
  run(() => {
    hideMessageInput = isMobile && showChannels;
  });
  run(() => {
    attachThreadStream(activeThread ?? null);
  });
  run(() => {
    if (!$user?.uid) {
      clearThreadReadSubs();
      return;
    }
    channelThreads.forEach((thread) => watchThreadRead(thread.id));
  });
  run(() => {
    const contextSources = [activeThreadRoot, ...threadMessages].filter(Boolean).slice(-10);
    threadConversationContext = contextSources;
    const latestAuthored =
      [...threadMessages].reverse().find(
        (msg) => (msg as any)?.authorId ?? (msg as any)?.uid
      ) ?? (activeThreadRoot?.uid ? activeThreadRoot : null);
    if (!latestAuthored) {
      threadDefaultSuggestionSource = null;
      return;
    }
    const latestUid =
      (latestAuthored as any)?.authorId ??
      (latestAuthored as any)?.uid ??
      null;
    if ($user?.uid && latestUid === $user.uid) {
      threadDefaultSuggestionSource = null;
      return;
    }
    threadDefaultSuggestionSource = latestAuthored;
  });
  run(() => {
    if (!activeThread) {
      threadReplyTarget = null;
    }
  });
  run(() => {
    aiConversationContext = messages.slice(-10);
  });
  run(() => {
    if (!messages.length) {
      latestInboundMessage = null;
      return;
    }
    const latestAuthored = [...messages].reverse().find((msg) => msg?.uid);
    if (!latestAuthored) {
      latestInboundMessage = null;
      return;
    }
    if ($user?.uid && latestAuthored.uid === $user.uid) {
      latestInboundMessage = null;
      return;
    }
    latestInboundMessage = latestAuthored;
  });
  run(() => {
    if (!$user?.uid) {
      aiAssistEnabled = true;
      return;
    }
    const me = profiles[$user.uid] ?? null;
    const prefs = (me?.settings ?? {}) as any;
    aiAssistEnabled = prefs?.aiAssist?.enabled !== false;
  });
  run(() => {
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
          if (serverId) {
            voiceSession.setServerName(serverId, nextName);
          }
        },
        () => {
          serverDisplayName = 'Server';
          if (serverId) {
            voiceSession.setServerName(serverId, 'Server');
          }
        }
      );
    } else {
      serverMetaUnsub?.();
      serverMetaUnsub = null;
      serverDisplayName = 'Server';
    }
  });
  run(() => {
    if (
      requestedChannelId &&
      requestedChannelId !== activeChannel?.id &&
      channels.some((c) => c.id === requestedChannelId)
    ) {
      pickChannel(requestedChannelId);
    }
  });
  run(() => {
    if (voiceState && serverId && voiceState.serverId !== serverId && voiceState.visible) {
      voiceSession.setVisible(false);
    }
  });
</script>

<!-- Layout summary:
  - Mobile (<768px): hide the server rail until the nav drawer opens (swipe/right button), with members on the right swipe.
  - Desktop (>=1024px): server rail + channels stay pinned; members pane opens at large breakpoints.
-->
<div class="flex h-dvh app-bg text-primary overflow-hidden">
  <div class="hidden md:flex md:shrink-0">
    <LeftPane activeServerId={serverId} onCreateServer={() => (showCreate = true)} />
  </div>
  <div class="flex flex-1 overflow-hidden panel-muted">
    <div class="hidden md:flex md:w-80 xl:w-80 shrink-0 flex-col border-r border-subtle">
      {#if serverId}
        <ServerSidebar
          serverId={serverId}
          activeChannelId={activeChannel?.id ?? null}
          onPickChannel={(id: string) => pickChannel(id)}
          threads={sidebarThreadList()}
          activeThreadId={activeThread?.id ?? null}
          onPickThread={(thread) => void openThreadFromSidebar(thread)}
        />
      {:else}
        <div class="p-4 text-white/70">Select a server from the left to view channels.</div>
      {/if}
    </div>

    <div class="flex flex-1 min-w-0 flex-col panel" style="border-radius: var(--radius-sm);">
      <ChannelHeader
        channel={activeChannel}
        thread={activeThread}
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
        onExitThread={() => closeThreadView()}
      />

      <div class="flex-1 panel-muted flex flex-col min-h-0">
        {#if isMobile && voiceState && voiceState.visible}
          <div class="mobile-call-wrapper md:hidden" ontouchstart={handleMobilePaneTouchStart} ontouchmove={handleMobilePaneTouchMove} ontouchend={handleMobilePaneTouchEnd}>
            <div class="mobile-call-tabs">
              <button
                type="button"
                class={`mobile-call-tab ${mobileVoicePane === 'call' ? 'is-active' : ''}`}
                onclick={() => setMobileVoicePane('call')}
                aria-pressed={mobileVoicePane === 'call'}
              >
                <i class="bx bx-headphone"></i>
                <span>Call</span>
              </button>
              <button
                type="button"
                class={`mobile-call-tab ${mobileVoicePane === 'chat' ? 'is-active' : ''}`}
                onclick={() => setMobileVoicePane('chat')}
                aria-pressed={mobileVoicePane === 'chat'}
              >
                <i class="bx bx-message-dots"></i>
                <span>Messages</span>
              </button>
            </div>

            {#if mobileVoicePane === 'call'}
              <div class="mobile-call-card">
                <VideoChat layout="embedded" on:openMobileChat={() => setMobileVoicePane('chat')} />
              </div>
            {:else}
              <div class="mobile-chat-card">
                {#if activeThread}
                  <ThreadPane
                    root={activeThreadRoot}
                    messages={threadMessages}
                    users={profiles}
                    currentUserId={$user?.uid ?? null}
                    mentionOptions={mentionOptions}
                    pendingUploads={[]}
                    aiAssistEnabled={aiAssistEnabled}
                    threadLabel={activeThread?.name ?? activeChannel?.name ?? ''}
                    conversationContext={threadConversationContext}
                    replyTarget={threadReplyTarget}
                    defaultSuggestionSource={threadDefaultSuggestionSource}
                    members={resolveThreadMembers()}
                    threadStatus={activeThread?.status ?? null}
                    on:close={closeThreadView}
                    on:send={(event) => handleThreadSend(event.detail)}
                    on:sendGif={handleThreadSendGif}
                    on:upload={handleThreadUploadFiles}
                    on:createPoll={handleThreadCreatePoll}
                    on:createForm={handleThreadCreateForm}
                    on:reply={handleThreadReplySelect}
                    on:cancelReply={resetThreadReplyTarget}
                  />
                {:else}
                  <ChannelMessagePane
                    hasChannel={Boolean(serverId && activeChannel)}
                    channelName={activeChannel?.name ?? ''}
                    {messages}
                    {profiles}
                    currentUserId={$user?.uid ?? null}
                    {mentionOptions}
                    {replyTarget}
                    threadStats={threadStats}
                    defaultSuggestionSource={latestInboundMessage}
                    conversationContext={aiConversationContext}
                    aiAssistEnabled={aiAssistEnabled}
                    threadLabel={activeChannel?.name ?? ''}
                    {pendingUploads}
                    {scrollToBottomSignal}
                    listClass="message-scroll-region flex-1 overflow-y-auto p-3"
                    inputWrapperClass="chat-input-region border-t border-subtle panel-muted p-3"
                    inputPaddingBottom="calc(env(safe-area-inset-bottom, 0px) + 0.85rem)"
                    emptyMessage={!serverId ? 'Pick a server to start chatting.' : 'Pick a channel to start chatting.'}
                    onVote={handleVote}
                    onSubmitForm={handleFormSubmit}
                    onReact={handleReaction}
                    onLoadMore={() => {
                      if (serverId && activeChannel?.id) {
                        loadOlderMessages(serverId, activeChannel.id);
                      }
                    }}
                    onSend={handleSend}
                    onSendGif={handleSendGif}
                    onCreatePoll={handleCreatePoll}
                    onCreateForm={handleCreateForm}
                    onUploadFiles={handleUploadFiles}
                    hideInput={hideMessageInput}
                    on:reply={handleReplyRequest}
                    on:thread={(event) => void openThreadFromMessage(event.detail?.message)}
                    on:cancelReply={() => (replyTarget = null)}
                  />
                {/if}
              </div>
            {/if}
          </div>
        {:else}
          {#if showVoiceLobby}
            <div class="voice-lobby-container">
              <VoiceLobby
                serverId={serverId}
                channelId={activeChannel?.id ?? null}
                channelName={activeChannel?.name ?? 'Voice channel'}
                serverName={serverDisplayName}
                inviteUrl={voiceInviteUrl}
                currentUserAvatar={currentUserPhotoURL}
                currentUserName={currentUserDisplayName}
                connectedChannelId={voiceState?.channelId ?? null}
                connectedChannelName={voiceState?.channelName ?? null}
                connectedServerId={voiceState?.serverId ?? null}
                connectedServerName={voiceState?.serverName ?? voiceState?.serverId ?? null}
                on:joinVoice={() => joinSelectedVoiceChannel()}
                on:startStreaming={() => joinSelectedVoiceChannel()}
                on:returnToSession={() => voiceSession.setVisible(true)}
              />
            </div>
          {/if}

          {#if voiceState && voiceState.visible}
            <div class="flex-none mb-4 md:mb-5">
              <VideoChat layout="embedded" on:openMobileChat={() => setMobileVoicePane('chat')} />
            </div>
          {/if}

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
                  onclick={() => voiceSession.setVisible(true)}
                >
                  Return to voice
                </button>
                <button
                  class="btn btn-danger px-3 py-1.5 text-sm font-medium"
                  type="button"
                  onclick={() => voiceSession.leave()}
                >
                  Leave
                </button>
              </div>
            </div>
          {/if}

          {#if activeThread}
            <ThreadPane
              root={activeThreadRoot}
              messages={threadMessages}
              users={profiles}
              currentUserId={$user?.uid ?? null}
              mentionOptions={mentionOptions}
              pendingUploads={[]}
              aiAssistEnabled={aiAssistEnabled}
              threadLabel={activeThread?.name ?? activeChannel?.name ?? ''}
              conversationContext={threadConversationContext}
              replyTarget={threadReplyTarget}
              defaultSuggestionSource={threadDefaultSuggestionSource}
              members={resolveThreadMembers()}
              threadStatus={activeThread?.status ?? null}
              on:close={closeThreadView}
              on:send={(event) => handleThreadSend(event.detail)}
              on:sendGif={handleThreadSendGif}
              on:upload={handleThreadUploadFiles}
              on:createPoll={handleThreadCreatePoll}
              on:createForm={handleThreadCreateForm}
              on:reply={handleThreadReplySelect}
              on:cancelReply={resetThreadReplyTarget}
            />
          {:else}
            <ChannelMessagePane
              hasChannel={Boolean(serverId && activeChannel)}
              channelName={activeChannel?.name ?? ''}
              {messages}
              {profiles}
              currentUserId={$user?.uid ?? null}
              {mentionOptions}
              {replyTarget}
              threadStats={threadStats}
              defaultSuggestionSource={latestInboundMessage}
              conversationContext={aiConversationContext}
              aiAssistEnabled={aiAssistEnabled}
              threadLabel={activeChannel?.name ?? ''}
              {pendingUploads}
              {scrollToBottomSignal}
              emptyMessage={!serverId ? 'Pick a server to start chatting.' : 'Pick a channel to start chatting.'}
              onVote={handleVote}
              onSubmitForm={handleFormSubmit}
              onReact={handleReaction}
              onLoadMore={() => {
                if (serverId && activeChannel?.id) {
                  loadOlderMessages(serverId, activeChannel.id);
                }
              }}
              onSend={handleSend}
              onSendGif={handleSendGif}
              onCreatePoll={handleCreatePoll}
              onCreateForm={handleCreateForm}
              onUploadFiles={handleUploadFiles}
              hideInput={hideMessageInput}
              on:reply={handleReplyRequest}
              on:thread={(event) => void openThreadFromMessage(event.detail?.message)}
              on:cancelReply={() => (replyTarget = null)}
            />
          {/if}
        {/if}
      </div>
    </div>

    <div class="hidden lg:flex lg:w-72 xl:w-80 panel-muted border-l border-subtle overflow-y-auto">
      {#if activeThread}
        {@const threadMembers = resolveThreadMembers()}
        <ThreadMembersPane members={threadMembers} threadName={activeThread?.name ?? activeChannel?.name ?? 'Thread'} />
      {:else if serverId}
        <MembersPane {serverId} />
      {:else}
        <div class="p-4 text-muted">No server selected.</div>
      {/if}
    </div>
  </div>
</div>

<!-- ======= MOBILE FULL-SCREEN PANELS (leave 72px rail visible) ======= -->

<!-- Navigation panel (servers + channels, slides from left) -->
<div
  class="mobile-panel md:hidden fixed inset-0 z-50 flex flex-col transition-transform duration-300 will-change-transform"
  style:transform={showChannels ? 'translateX(0)' : 'translateX(-100%)'}
  style:pointer-events={showChannels ? 'auto' : 'none'}
  aria-label="Servers and channels"
  style:bottom="calc(var(--mobile-dock-height, 0px) + env(safe-area-inset-bottom, 0px))"
>

  <div class="mobile-panel__body md:hidden">
    {#if showChannels}
      <div class="mobile-panel__servers">
        <LeftPane
          activeServerId={serverId}
          onCreateServer={() => (showCreate = true)}
          padForDock={false}
          showBottomActions={false}
        />
      </div>
    {/if}
    <div class="mobile-panel__channels">
      {#if serverId}
        <ServerSidebar
          serverId={serverId}
          activeChannelId={activeChannel?.id ?? null}
          onPickChannel={(id: string) => pickChannel(id)}
          threads={sidebarThreadList()}
          activeThreadId={activeThread?.id ?? null}
          onPickThread={(thread) => {
            showChannels = false;
            void openThreadFromSidebar(thread);
          }}
          on:pick={() => (showChannels = false)}
        />
      {:else}
        <div class="p-4 text-white/70">Select a server to view channels.</div>
      {/if}
    </div>
  </div>
</div>

<!-- Members panel (slides from right) -->
<div
  class="mobile-panel md:hidden fixed inset-0 z-50 flex flex-col transition-transform duration-300 will-change-transform"
  style:transform={showMembers ? 'translateX(0)' : 'translateX(100%)'}
  style:pointer-events={showMembers ? 'auto' : 'none'}
  aria-label="Members"
  style:bottom="calc(var(--mobile-dock-height, 0px) + env(safe-area-inset-bottom, 0px))"
>
  <div class="mobile-panel__header md:hidden">
    <button
      class="mobile-panel__close -ml-2"
      aria-label="Back to chat"
      type="button"
      onclick={() => (showMembers = false)}
    >
      <i class="bx bx-chevron-right text-2xl"></i>
    </button>
    <div class="mobile-panel__title">{activeThread ? 'Thread members' : 'Members'}</div>
  </div>

  <div class="flex-1 overflow-y-auto">
    {#if activeThread}
      {@const threadMembers = resolveThreadMembers()}
      <ThreadMembersPane members={threadMembers} threadName={activeThread?.name ?? activeChannel?.name ?? 'Thread'} />
    {:else if serverId}
      <MembersPane {serverId} showHeader={false} />
    {:else}
      <div class="p-4 text-white/70">No server selected.</div>
    {/if}
  </div>
</div>

<NewServerModal bind:open={showCreate} onClose={() => (showCreate = false)} />
<style>
  .mobile-panel__body {
    flex: 1;
    display: flex;
    background: var(--color-panel);
    border-top: 1px solid var(--color-border-subtle);
    min-height: 0;
  }

  .mobile-panel {
    padding-bottom: 0;
  }

  .mobile-panel__servers {
    width: 84px;
    flex: 0 0 84px;
    display: flex;
    justify-content: center;
    background: color-mix(in srgb, var(--color-panel-muted) 85%, transparent);
    border-right: 1px solid var(--color-border-subtle);
    overflow-y: auto;
  }

  .mobile-panel__servers :global(.app-rail) {
    position: relative;
    inset: auto;
    width: 72px;
    height: 100%;
    min-height: 0;
    border-radius: 0;
    box-shadow: none;
    padding-top: 0.5rem;
  }

  .mobile-panel__channels {
    flex: 1;
    min-width: 0;
    background: color-mix(in srgb, var(--color-panel-muted) 96%, transparent);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .mobile-panel__channels :global(.sidebar-surface) {
    flex: 1;
    min-height: 0;
    border-right: none !important;
    border-left: none !important;
    border: none !important;
  }

  .voice-lobby-container {
    padding: 1.25rem 1.5rem 0;
  }


  .mobile-call-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.75rem 0.9rem 0.95rem;
    flex: 1;
    min-height: 0;
  }

  .mobile-call-tabs {
    display: inline-flex;
    align-self: center;
    background: color-mix(in srgb, var(--color-panel) 70%, transparent);
    border-radius: 999px;
    padding: 0.35rem;
    gap: 0.35rem;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      0 8px 24px rgba(7, 10, 22, 0.4);
  }

  .mobile-call-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.48rem 1.05rem;
    border-radius: 999px;
    border: none;
    background: transparent;
    color: var(--text-55);
    font-size: 0.78rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    transition: background 170ms ease, color 170ms ease, transform 170ms ease, box-shadow 170ms ease;
  }

  .mobile-call-tab i {
    font-size: 1.05rem;
  }

  .mobile-call-tab.is-active {
    background: color-mix(in srgb, var(--color-accent) 26%, transparent);
    color: color-mix(in srgb, var(--color-accent) 85%, white);
    box-shadow:
      0 10px 28px rgba(10, 12, 20, 0.45),
      inset 0 1px 0 rgba(255, 255, 255, 0.28);
  }

  .mobile-call-card,
  .mobile-chat-card {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      border-radius: 0.75rem;
      border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
      box-shadow:
        0 24px 45px rgba(10, 15, 30, 0.45),
        inset 0 1px 0 rgba(255, 255, 255, 0.05);
      overflow: hidden;
  }

  .mobile-call-card {
    background: color-mix(in srgb, var(--color-panel) 86%, transparent);
    padding: 0.6rem;
    height: clamp(220px, 52vh, 360px);
  }

  .mobile-call-card :global(.voice-root) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .mobile-call-card :global(.call-shell) {
    flex: 1;
    min-height: 0;
  }

  .mobile-chat-card {
      background: color-mix(in srgb, var(--color-panel-muted) 94%, transparent);
      padding: 0.65rem;
    }

  .mobile-chat-card :global(.chat-input-region) {
      border-radius: 0 0 0.75rem 0.75rem;
    }

  .mobile-chat-card :global(.message-scroll-region) {
      border-radius: 0.75rem 0.75rem 0 0;
    }

  @media (min-width: 768px) {
    .mobile-call-wrapper {
      display: none;
    }
    .voice-lobby-container {
      padding: 0 1.5rem 0;
      margin-bottom: 1.5rem;
    }

  }

  @media (max-width: 767px) {
    .voice-lobby-container {
      padding: 0.75rem 0.9rem 0;
    }
  }
</style>



