<script lang="ts">
  import { run } from 'svelte/legacy';

  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/user';
  import { getDb } from '$lib/firebase';
  import { doc, getDoc, onSnapshot, type Unsubscribe } from 'firebase/firestore';

  import DMsSidebar from '$lib/components/dms/DMsSidebar.svelte';
  import MessageList from '$lib/components/chat/MessageList.svelte';
  import ChatInput from '$lib/components/chat/ChatInput.svelte';

import { sendDMMessage, streamDMMessages, markThreadRead, voteOnDMPoll, submitDMForm, toggleDMReaction } from '$lib/firestore/dms';
import type { ReplyReferenceInput } from '$lib/firestore/messages';
import { resolveProfilePhotoURL } from '$lib/utils/profile';
import { RESUME_DM_SCROLL_KEY } from '$lib/constants/navigation';
import { uploadDMFile } from '$lib/firebase/storage';
import type { PendingUploadPreview } from '$lib/components/chat/types';
import { looksLikeImage } from '$lib/utils/fileType';

  interface Props {
    data: { threadID: string };
  }

  let { data }: Props = $props();
  let threadID = $derived(data.threadID);

  let me: any = $state(null);
  run(() => {
    me = $user;
  });

let messages: any[] = $state([]);
let messagesLoading = $state(true);
let messageUsers: Record<string, any> = $state({});
let pendingUploads: PendingUploadPreview[] = $state([]);
const profileUnsubs: Record<string, Unsubscribe> = {};
let sidebarRef: InstanceType<typeof DMsSidebar> | null = $state(null);
let sidebarRefMobile: InstanceType<typeof DMsSidebar> | null = $state(null);
type MentionOption = {
  uid: string;
  label: string;
  handle: string;
  avatar: string | null;
  search: string;
  aliases: string[];
  kind?: 'member' | 'role';
  color?: string | null;
};
type MentionSendRecord = {
  uid: string;
  handle: string | null;
  label: string | null;
  color?: string | null;
  kind?: 'member' | 'role';
};
let mentionOptions: MentionOption[] = $state([]);
let resumeDmScroll = false;
let scrollResumeSignal = $state(0);
let lastPendingThreadId: string | null = null;

onMount(() => {
  if (!browser) return;
  try {
    const storedResume = sessionStorage.getItem(RESUME_DM_SCROLL_KEY) === '1';
    resumeDmScroll = storedResume;
    if (storedResume) {
      sessionStorage.removeItem(RESUME_DM_SCROLL_KEY);
    }
  } catch {
    resumeDmScroll = false;
  }
});

  run(() => {
    if (threadID !== lastPendingThreadId) {
      lastPendingThreadId = threadID;
      pendingUploads = [];
    }
  });

  function updateMessageUserCache(uid: string, patch: any) {
    if (!uid) return;
    const prev = messageUsers[uid] ?? {};
    const next = { ...prev, ...patch };
    messageUsers = { ...messageUsers, [uid]: next };
  }

  function ensureProfileSubscription(database: ReturnType<typeof getDb>, uid: string) {
    if (!uid || profileUnsubs[uid]) return;
    profileUnsubs[uid] = onSnapshot(
      doc(database, 'profiles', uid),
      (snap) => {
        const data: any = snap.data() ?? {};
        const displayName =
          pickString(data?.name) ?? pickString(data?.displayName) ?? pickString(data?.email);
        const photoURL = resolveProfilePhotoURL(data);
        updateMessageUserCache(uid, {
          uid,
          displayName,
          name: displayName,
          photoURL,
          authPhotoURL: data?.authPhotoURL ?? null,
          settings: data?.settings ?? undefined
        });
      },
      () => {
        profileUnsubs[uid]?.();
        delete profileUnsubs[uid];
      }
    );
  }
  let unsub: (() => void) | null = $state(null);
  let mounted = $state(false);

  let otherUid: string | null = $state(null);
  let otherProfile: any = $state(null);
  let otherMessageUser: any = $state(null);
  let metaLoading = $state(true);

let showThreads = $state(false);
let showInfo = $state(false);
let lastThreadID: string | null = null;
let pendingReply: ReplyReferenceInput | null = $state(null);
let replySourceMessage: any = $state(null);
let latestInboundMessage: any = $state(null);
let aiConversationContext: any[] = $state([]);
let aiAssistEnabled = $state(true);

  const LEFT_RAIL = 72;
  const EDGE_ZONE = 28;
  const SWIPE_THRESHOLD = 64;

  let tracking = false;
  let startX = 0;
  let startY = 0;

  function pickString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
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
      uid: me?.uid ?? null,
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
  function markThreadAsSeen(opts?: { at?: any; lastMessageId?: string | null }) {
    if (!threadID || !me?.uid) return;
    const payload = {
      at: opts?.at ?? new Date(),
      lastMessageId: opts?.lastMessageId ?? null
    };
    markThreadRead(threadID, me.uid, payload).catch(() => {});
  }

  function canonical(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function normalizeUid(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  function buildMentionOption(uid: string, source: any = {}): MentionOption {
    const label =
      pickString(source?.displayName) ??
      pickString(source?.name) ??
      pickString(source?.email) ??
      'Member';
    const handleBase = canonical(label) || 'member';
    const handle = `${handleBase}${uid.slice(-4).toLowerCase()}`;
    const avatar = resolveProfilePhotoURL(source);
    const aliases = new Set<string>();
    const register = (value: unknown) => {
      const canon = canonical(value);
      if (canon) aliases.add(canon);
    };
    register(handleBase);
    register(label);
    label.split(/\s+/).forEach(register);
    if (source?.email) {
      register(String(source.email).split('@')[0]);
    }
    return {
      uid,
      label,
      handle,
      avatar: avatar ?? pickString(source?.photoURL) ?? null,
      search: [label, source?.email].filter(Boolean).join(' ').toLowerCase(),
      aliases: Array.from(aliases),
      kind: 'member',
      color: null
    };
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
        const text = pickString(raw?.text) ?? pickString(raw?.content) ?? '';
        const clipped = clipReply(text);
        return clipped || 'Message';
      }
    }
  }

  function buildReplyReference(message: any): ReplyReferenceInput | null {
    const messageId = pickString(message?.id);
    if (!messageId) return null;
    const type = inferMessageType(message);
    const authorId = pickString(message?.uid) ?? pickString(message?.authorId) ?? null;
    const authorRecord = authorId ? messageUsers[authorId] : null;
    const authorName =
      pickString(message?.displayName) ??
      pickString(authorRecord?.displayName) ??
      (authorId === me?.uid ? 'You' : authorId);
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

  function consumeReply(explicit?: ReplyReferenceInput | null) {
    const candidate =
      explicit && explicit.messageId
        ? explicit
        : pendingReply && pendingReply.messageId
          ? pendingReply
          : null;
    pendingReply = null;
    return candidate && candidate.messageId ? candidate : null;
  }

  function restoreReply(ref: ReplyReferenceInput | null) {
    if (ref?.messageId) {
      pendingReply = ref;
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

  function deriveMeDisplayName() {
    return (
      pickString(me?.displayName) ??
      pickString(me?.email) ??
      'You'
    );
  }

  function deriveMePhotoURL() {
    if (!me?.uid) {
      return pickString(me?.photoURL) ?? null;
    }
    const cached = messageUsers[me.uid];
    const fallback = pickString(me?.photoURL) ?? null;
    if (cached) {
      return resolveProfilePhotoURL(cached, fallback);
    }
    return fallback;
  }

  function normalizeUserRecord(uid: string, data: any = {}) {
    const fallbackLabel = pickString(data?.email) ?? uid ?? 'Member';
    const displayName =
      pickString(data?.displayName) ??
      pickString(data?.name) ??
      fallbackLabel;
    const name =
      pickString(data?.name) ??
      displayName;
    const photoURL = resolveProfilePhotoURL(data);
    return {
      ...data,
      uid,
      displayName,
      name,
      photoURL
    };
  }

  async function loadThreadMeta() {
    if (!threadID || typeof window === 'undefined') return;
    metaLoading = true;
    try {
      const database = getDb();
      const snap = await getDoc(doc(database, 'dms', threadID));
      const payload: any = snap.data() ?? {};
      const parts: string[] = payload.participants ?? [];
      otherUid = parts.find((p) => p !== me?.uid) ?? null;

      if (otherUid) {
        const profileDoc = await getDoc(doc(database, 'profiles', otherUid));
        if (profileDoc.exists()) {
          otherProfile = normalizeUserRecord(profileDoc.id, profileDoc.data());
        } else {
          otherProfile = normalizeUserRecord(otherUid, {});
        }
      } else {
        otherProfile = null;
      }
    } catch (err) {
      console.error('[DM thread] failed to load meta', err);
      otherProfile = null;
    } finally {
      metaLoading = false;
    }
  }

run(() => {
  if (otherProfile?.uid) {
    const meta = {
      uid: otherProfile.uid,
      displayName: pickString(otherProfile?.displayName) ?? pickString(otherProfile?.name) ?? null,
      name: pickString(otherProfile?.name) ?? null,
      email: pickString(otherProfile?.email) ?? null
    };
    sidebarRef?.updatePartnerMeta(meta);
    sidebarRefMobile?.updatePartnerMeta(meta);
  }
});

  run(() => {
    if (threadID) {
      loadThreadMeta();
    }
  });

  run(() => {
    if (threadID && threadID !== lastThreadID) {
      lastThreadID = threadID;
      showInfo = false;
      pendingReply = null;
      messages = [];
      messagesLoading = true;
    }
  });

  run(() => {
    if (resumeDmScroll && messages.length > 0) {
      scrollResumeSignal = Date.now();
      resumeDmScroll = false;
    }
  });

  run(() => {
    const next: Record<string, any> = {};
    if (me?.uid) {
      next[me.uid] = normalizeUserRecord(me.uid, {
        displayName: deriveMeDisplayName(),
        name: deriveMeDisplayName(),
        photoURL: deriveMePhotoURL(),
        email: pickString(me?.email) ?? undefined
      });
    }
    if (otherProfile?.uid) {
      next[otherProfile.uid] = normalizeUserRecord(otherProfile.uid, otherProfile);
    }
    for (const m of messages) {
      if (!m?.uid) continue;
      const existing = next[m.uid] ?? { uid: m.uid };
      const displayName =
        pickString(existing.displayName) ??
        pickString(m.displayName);
      const name =
        pickString(existing.name) ??
        pickString(m.displayName);
      const photoURL =
        pickString(existing.photoURL) ??
        pickString(m.photoURL);
      next[m.uid] = {
        ...existing,
        displayName: displayName ?? existing.displayName ?? m.uid ?? 'Member',
        name: name ?? existing.name ?? displayName ?? m.uid ?? 'Member',
        photoURL: photoURL ?? existing.photoURL ?? null
      };
    }
    messageUsers = next;
  });

  run(() => {
    const map = new Map<string, MentionOption>();
    const addCandidate = (uid: unknown, data: any) => {
      const clean = normalizeUid(uid);
      if (!clean) return;
      try {
        map.set(clean, buildMentionOption(clean, data ?? {}));
      } catch {
        // ignore malformed entries
      }
    };

    if (me?.uid) {
      addCandidate(me.uid, {
        displayName: deriveMeDisplayName(),
        photoURL: deriveMePhotoURL(),
        email: pickString(me?.email) ?? null
      });
    }
    if (otherProfile?.uid) {
      addCandidate(otherProfile.uid, otherProfile);
    }
    Object.values(messageUsers).forEach((entry) => addCandidate(entry?.uid, entry));

    mentionOptions = Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    );
  });

  function setupGestures() {
    if (typeof window === 'undefined') return () => {};

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        showThreads = false;
        showInfo = false;
        pendingReply = null;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;

      const nearLeft = startX >= LEFT_RAIL && startX <= LEFT_RAIL + EDGE_ZONE;
      const nearRight = window.innerWidth - startX <= EDGE_ZONE;

      tracking = nearLeft || nearRight || showThreads || showInfo;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (Math.abs(dy) > Math.abs(dx) * 1.25) return;

      if (!showThreads && !showInfo) {
        const fromInnerLeft = startX >= LEFT_RAIL && startX <= LEFT_RAIL + EDGE_ZONE && dx >= SWIPE_THRESHOLD;
        const fromRightEdge = window.innerWidth - startX <= EDGE_ZONE && dx <= -SWIPE_THRESHOLD;
        if (fromInnerLeft) {
          showThreads = true;
          tracking = false;
        }
        if (fromRightEdge) {
          showInfo = true;
          tracking = false;
        }
        return;
      }

      if (showThreads && dx <= -SWIPE_THRESHOLD) {
        showThreads = false;
        tracking = false;
      }
      if (showInfo && dx >= SWIPE_THRESHOLD) {
        showInfo = false;
        tracking = false;
      }
    };

    const onTouchEnd = () => {
      tracking = false;
    };

    const mdMq = window.matchMedia('(min-width: 768px)');
    const lgMq = window.matchMedia('(min-width: 1024px)');

    const onMedia = () => {
      if (mdMq.matches) showThreads = false;
      if (lgMq.matches) showInfo = false;
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    mdMq.addEventListener('change', onMedia);
    lgMq.addEventListener('change', onMedia);
    onMedia();

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      mdMq.removeEventListener('change', onMedia);
      lgMq.removeEventListener('change', onMedia);
    };
  }

  onMount(() => {
    mounted = true;
    const cleanupGestures = setupGestures();
    return () => {
      mounted = false;
      unsub?.();
      cleanupGestures();
      for (const uid in profileUnsubs) profileUnsubs[uid]?.();
    };
  });

  // After computing messageUsers map, ensure we subscribe to each author's profile
  run(() => {
    if (Object.keys(messageUsers).length > 0) {
      try {
        const database = getDb();
        for (const uid in messageUsers) ensureProfileSubscription(database, uid);
      } catch {}
    }
  });

  run(() => {
    if (mounted && threadID) {
      messagesLoading = true;
      unsub?.();
      unsub = streamDMMessages(threadID, async (msgs) => {
        messages = msgs.map((row: any) => toChatMessage(row.id, row));
        messagesLoading = false;
        if (messages.length > 0) {
          scrollResumeSignal = Date.now();
        }
        if (me?.uid) {
          const last = messages[messages.length - 1];
          const at = last?.createdAt ?? null;
          const lastId = last?.id ?? null;
          markThreadAsSeen({ at, lastMessageId: lastId });
        }
      });
    } else if (!threadID) {
      unsub?.();
      unsub = null;
      messages = [];
      messagesLoading = false;
    }
  });

  async function handleSend(payload: string | { text: string; mentions?: MentionSendRecord[]; replyTo?: ReplyReferenceInput | null }) {
    const raw = typeof payload === 'string' ? payload : payload?.text ?? '';
    const trimmed = raw?.trim?.() ?? '';
    if (!trimmed || !me?.uid) return;
    const replyRef = consumeReply(typeof payload === 'object' ? payload?.replyTo ?? null : null);
    let mentionList: MentionSendRecord[] =
      typeof payload === 'object' && payload && Array.isArray(payload.mentions)
        ? payload.mentions.filter(
            (item): item is MentionSendRecord =>
              !!item?.uid && (!!item?.handle || !!item?.label)
          )
        : [];
    if (mentionList.length && mentionOptions.length) {
      const allowed = new Set(mentionOptions.map((entry) => entry.uid));
      mentionList = mentionList.filter((item) => allowed.has(item.uid));
    }
    try {
      await sendDMMessage(threadID, {
        type: 'text',
        text: trimmed,
        uid: me.uid,
        displayName: deriveMeDisplayName(),
        photoURL: deriveMePhotoURL(),
        mentions: mentionList.length ? mentionList : undefined,
        replyTo: replyRef ?? undefined
      });
      markThreadAsSeen();
    } catch (err) {
      restoreReply(replyRef);
      console.error(err);
      alert(`Failed to send message: ${err}`);
    }
  }

  async function handleSendGif(detail: string | { url: string; replyTo?: ReplyReferenceInput | null }) {
    const trimmed = pickString(typeof detail === 'string' ? detail : detail?.url);
    if (!trimmed || !me?.uid) return;
    const replyRef = consumeReply(typeof detail === 'object' ? detail?.replyTo ?? null : null);
    try {
      await sendDMMessage(threadID, {
        type: 'gif',
        url: trimmed,
        uid: me.uid,
        displayName: deriveMeDisplayName(),
        photoURL: deriveMePhotoURL(),
        replyTo: replyRef ?? undefined
      });
      markThreadAsSeen();
    } catch (err) {
      restoreReply(replyRef);
      console.error(err);
      alert(`Failed to share GIF: ${err}`);
    }
  }

  async function handleUploadFiles(request: { files: File[]; replyTo?: ReplyReferenceInput | null }) {
    const selection = Array.from(request?.files ?? []).filter((file): file is File => file instanceof File);
    if (!selection.length || !me?.uid) return;
    const replyRef = consumeReply(request?.replyTo ?? null);
    let replyUsed = false;
    for (const file of selection) {
      const pending = registerPendingUpload(file);
      try {
        const uploaded = await uploadDMFile({
          threadId: threadID,
          uid: me.uid,
          file,
          onProgress: (progress) => pending.update(progress ?? 0)
        });
        await sendDMMessage(threadID, {
          type: 'file',
          file: {
            name: file.name || uploaded.name,
            url: uploaded.url,
            size: file.size ?? uploaded.size,
            contentType: file.type || uploaded.contentType,
            storagePath: uploaded.storagePath
          },
          uid: me.uid,
          displayName: deriveMeDisplayName(),
          photoURL: deriveMePhotoURL(),
          replyTo: !replyUsed && replyRef ? replyRef : undefined
        });
        pending.finish(true);
        if (replyRef && !replyUsed) {
          replyUsed = true;
        }
        markThreadAsSeen();
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
    if (!me?.uid) return;
    const replyRef = consumeReply(poll?.replyTo ?? null);
    try {
      await sendDMMessage(threadID, {
        type: 'poll',
        poll: {
          question: poll.question,
          options: poll.options
        },
        uid: me.uid,
        displayName: deriveMeDisplayName(),
        photoURL: deriveMePhotoURL(),
        replyTo: replyRef ?? undefined
      });
      markThreadAsSeen();
    } catch (err) {
      restoreReply(replyRef);
      console.error(err);
      alert(`Failed to create poll: ${err}`);
    }
  }

  async function handleCreateForm(form: { title: string; questions: string[]; replyTo?: ReplyReferenceInput | null }) {
    if (!me?.uid) return;
    const replyRef = consumeReply(form?.replyTo ?? null);
    try {
      await sendDMMessage(threadID, {
        type: 'form',
        form: {
          title: form.title,
          questions: form.questions
        },
        uid: me.uid,
        displayName: deriveMeDisplayName(),
        photoURL: deriveMePhotoURL(),
        replyTo: replyRef ?? undefined
      });
      markThreadAsSeen();
    } catch (err) {
      restoreReply(replyRef);
      console.error(err);
      alert(`Failed to share form: ${err}`);
    }
  }

  async function handleVote(event: CustomEvent<{ messageId: string; optionIndex: number }>) {
    if (!me?.uid) return;
    const { messageId, optionIndex } = event.detail ?? {};
    if (!messageId || optionIndex === undefined) return;
    try {
      await voteOnDMPoll(threadID, messageId, me.uid, optionIndex);
    } catch (err) {
      console.error(err);
      alert(`Failed to record vote: ${err}`);
    }
  }

  async function handleFormSubmit(event: CustomEvent<{ messageId: string; answers: string[] }>) {
    if (!me?.uid) return;
    const { messageId, answers } = event.detail ?? {};
    if (!messageId || !answers) return;
    try {
      await submitDMForm(threadID, messageId, me.uid, answers);
    } catch (err) {
      console.error(err);
      alert(`Failed to submit form: ${err}`);
    }
  }

  async function handleReaction(event: CustomEvent<{ messageId: string; emoji: string }>) {
    if (!me?.uid) return;
    const { messageId, emoji } = event.detail ?? {};
    if (!messageId || !emoji) return;
    try {
      await toggleDMReaction(threadID, messageId, me.uid, emoji);
    } catch (err) {
      console.error(err);
      alert(`Failed to toggle reaction: ${err}`);
    }
  }

  function handleReplyRequest(event: CustomEvent<{ message: any }>) {
    const target = event.detail?.message;
    const ref = buildReplyReference(target);
    if (ref) pendingReply = ref;
  }

  function onSend(e: CustomEvent<any>) {
    handleSend(e.detail ?? '');
  }

  run(() => {
    otherMessageUser = otherUid ? messageUsers[otherUid] ?? null : null;
  });

  run(() => {
    if (!me?.uid) {
      aiAssistEnabled = true;
      return;
    }
    const profile = messageUsers[me.uid] ?? null;
    const prefs = (profile?.settings ?? {}) as any;
    aiAssistEnabled = prefs.aiAssist?.enabled !== false;
  });

  run(() => {
    const targetId = pendingReply?.messageId ?? null;
    if (targetId) {
      const source = messages.find((row) => row?.id === targetId);
      replySourceMessage = source ?? null;
    } else {
      replySourceMessage = null;
    }
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
    if (me?.uid && latestAuthored.uid === me.uid) {
      latestInboundMessage = null;
      return;
    }
    latestInboundMessage = latestAuthored;
  });

  run(() => {
    aiConversationContext = messages.slice(-10);
  });

  let displayName =
    $derived(pickString(otherProfile?.displayName) ??
    pickString(otherProfile?.name) ??
    pickString(otherMessageUser?.displayName) ??
    pickString(otherMessageUser?.name) ??
    pickString(otherProfile?.email) ??
    pickString(otherMessageUser?.email) ??
    (otherProfile || otherMessageUser ? otherUid ?? 'Member' : 'Direct Message'));
</script>

<div class="flex flex-1 overflow-hidden panel-muted">
  <div class="hidden md:flex md:w-80 flex-col border-r border-subtle panel-muted">
    <DMsSidebar
      bind:this={sidebarRef}
      activeThreadId={threadID}
      on:select={() => (showThreads = false)}
      on:delete={(e) => {
        if (e.detail === threadID) {
          showInfo = false;
          void goto('/dms');
        }
      }}
    />
  </div>

  <div class="flex flex-1 flex-col panel overflow-hidden">
    <header class="h-14 px-3 sm:px-4 flex items-center justify-between border-b border-subtle panel-muted">
      <div class="flex items-center gap-3 min-w-0">
        <button
          class="md:hidden p-2  hover:bg-white/10 active:bg-white/15 transition"
          aria-label="Open conversations"
          onclick={() => (showThreads = true)}
        >
          <i class="bx bx-menu text-2xl"></i>
        </button>
        <button
          class="flex items-center gap-3 min-w-0 flex-1 text-left px-1 py-1 rounded hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 transition"
          type="button"
          aria-label="View participant profile"
          onclick={() => (showInfo = true)}
        >
          <div class="w-9 h-9 rounded-full bg-white/10 grid place-items-center overflow-hidden border border-white/10 shrink-0">
            {#if otherProfile?.photoURL}
              <img class="w-9 h-9 object-cover" src={otherProfile.photoURL} alt="" />
            {:else}
              <i class="bx bx-user text-lg text-white/80"></i>
            {/if}
          </div>
          <div class="min-w-0">
            <div class="font-semibold leading-5 truncate">{displayName}</div>
            {#if otherProfile?.email}<div class="text-xs text-white/60 truncate">{otherProfile.email}</div>{/if}
          </div>
        </button>
      </div>
      <button
        class="md:hidden p-2  hover:bg-white/10 active:bg-white/15 transition"
        aria-label="View profile"
        onclick={() => (showInfo = true)}
      >
        <i class="bx bx-user-circle text-2xl"></i>
      </button>
    </header>

    <main class="flex-1 overflow-hidden panel-muted">
      <div class="h-full flex flex-col">
        <div class="message-scroll-region relative flex-1 overflow-hidden p-3 sm:p-4">
          {#if messagesLoading}
            <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/40 backdrop-blur-sm text-soft">
              <div class="h-10 w-10 rounded-full border-2 border-white/30 border-t-white animate-spin" aria-hidden="true"></div>
              <div class="text-sm font-medium tracking-wide uppercase">Loading messages</div>
              <span class="sr-only" aria-live="polite">Loading messages...</span>
            </div>
          {/if}
          <MessageList
            {messages}
            users={messageUsers}
            currentUserId={me?.uid ?? null}
            {pendingUploads}
            scrollToBottomSignal={scrollResumeSignal}
            on:vote={handleVote}
            on:submitForm={handleFormSubmit}
            on:react={handleReaction}
            on:reply={handleReplyRequest}
          />
        </div>
      </div>
    </main>

    <div
      class="chat-input-region border-t border-subtle panel p-3"
      style:padding-bottom="calc(env(safe-area-inset-bottom, 0px) + 0.5rem)"
    >
      <ChatInput
        placeholder={`Message`}
        {mentionOptions}
        replyTarget={pendingReply}
        replySource={replySourceMessage}
        defaultSuggestionSource={latestInboundMessage}
        conversationContext={aiConversationContext}
        aiAssistEnabled={aiAssistEnabled}
        threadLabel={displayName}
        on:send={onSend}
        on:submit={onSend}
        on:sendGif={(e: CustomEvent<any>) => handleSendGif(e.detail)}
        on:upload={(e: CustomEvent<any>) => handleUploadFiles(e.detail)}
        on:createPoll={(e: CustomEvent<any>) => handleCreatePoll(e.detail)}
        on:createForm={(e: CustomEvent<any>) => handleCreateForm(e.detail)}
        on:cancelReply={() => (pendingReply = null)}
      />
    </div>
  </div>

  {#if showInfo}
    <aside class="hidden lg:flex lg:w-72 xl:w-80 panel-muted border-l border-subtle overflow-y-auto">
      <div class="p-4 w-full">
        <div class="flex items-center justify-between mb-4">
          <div class="text-sm uppercase tracking-wide text-white/60">Profile</div>
          <button
            class="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition"
            type="button"
            aria-label="Close profile panel"
            onclick={() => (showInfo = false)}
          >
            <i class="bx bx-x text-2xl"></i>
          </button>
        </div>
        {#if metaLoading}
          <div class="animate-pulse text-white/50">Loading profile...</div>
        {:else if otherProfile}
          <div class="flex flex-col items-center gap-3 text-center py-6 border-b border-white/10">
            <div class="w-20 h-20 rounded-full overflow-hidden bg-white/10 border border-white/10">
              {#if otherProfile.photoURL}
                <img class="w-full h-full object-cover" src={otherProfile.photoURL} alt="" />
              {:else}
                <div class="w-full h-full grid place-items-center text-3xl text-white/70">
                  <i class="bx bx-user"></i>
                </div>
              {/if}
            </div>
            <div class="text-lg font-semibold">{displayName}</div>
            {#if otherProfile.email}<div class="text-sm text-white/60">{otherProfile.email}</div>{/if}
          </div>

          <div class="mt-4 space-y-3 text-sm text-white/70">
            {#if otherProfile.bio}
              <p>{otherProfile.bio}</p>
            {:else}
              <p>This user hasn't added a bio yet.</p>
            {/if}
            {#if otherProfile.email}
              <a class="inline-flex items-center gap-2 text-[#8da1ff] hover:text-white transition" href={`mailto:${otherProfile.email}`}>
                <i class="bx bx-envelope"></i>
                <span>Send email</span>
              </a>
            {/if}
          </div>
        {:else}
          <div class="text-white/50">Profile unavailable.</div>
        {/if}
      </div>
    </aside>
  {/if}
</div>

<!-- Mobile overlays -->
<div
  class="mobile-panel md:hidden fixed inset-0 z-40 flex flex-col transition-transform duration-300 will-change-transform"
  style:transform={showThreads ? 'translateX(0)' : 'translateX(-100%)'}
  style:pointer-events={showThreads ? 'auto' : 'none'}
  aria-label="Conversations"
>
  <div class="mobile-panel__header md:hidden">
    <button class="mobile-panel__close -ml-2" aria-label="Close" type="button" onclick={() => (showThreads = false)}>
      <i class="bx bx-chevron-left text-2xl"></i>
    </button>
    <div class="mobile-panel__title">Conversations</div>
  </div>
  <div class="flex-1 overflow-y-auto">
    <DMsSidebar
      bind:this={sidebarRefMobile}
      activeThreadId={threadID}
      on:select={() => (showThreads = false)}
      on:delete={(e) => {
        showThreads = false;
        showInfo = false;
        if (e.detail === threadID) void goto('/dms');
      }}
    />
  </div>
</div>

<div
  class="mobile-panel md:hidden fixed inset-0 z-40 flex flex-col transition-transform duration-300 will-change-transform"
  style:transform={showInfo ? 'translateX(0)' : 'translateX(100%)'}
  style:pointer-events={showInfo ? 'auto' : 'none'}
  aria-label="Profile"
>
  <div class="mobile-panel__header md:hidden">
    <button class="mobile-panel__close -ml-2" aria-label="Close" type="button" onclick={() => (showInfo = false)}>
      <i class="bx bx-chevron-left text-2xl"></i>
    </button>
    <div class="mobile-panel__title">Profile</div>
  </div>

  <div class="flex-1 overflow-y-auto p-4">
    {#if metaLoading}
      <div class="animate-pulse text-soft">Loading profile...</div>
    {:else if otherProfile}
      <div class="flex flex-col items-center gap-3 text-center py-6 border-b border-white/10">
        <div class="w-24 h-24 rounded-full overflow-hidden bg-white/10 border border-white/10">
          {#if otherProfile.photoURL}
            <img class="w-full h-full object-cover" src={otherProfile.photoURL} alt="" />
          {:else}
            <div class="w-full h-full grid place-items-center text-3xl text-white/70">
              <i class="bx bx-user"></i>
            </div>
          {/if}
        </div>
        <div class="text-lg font-semibold">{displayName}</div>
        {#if otherProfile.email}<div class="text-sm text-white/60">{otherProfile.email}</div>{/if}
      </div>

      <div class="mt-4 space-y-3 text-sm text-white/70">
        {#if otherProfile.bio}
          <p>{otherProfile.bio}</p>
        {:else}
          <p>This user hasn't added a bio yet.</p>
        {/if}
        {#if otherProfile.email}
          <a class="inline-flex items-center gap-2 text-[#8da1ff] hover:text-white transition" href={`mailto:${otherProfile.email}`}>
            <i class="bx bx-envelope"></i>
            <span>Send email</span>
          </a>
        {/if}
      </div>
    {:else}
      <div class="text-white/50">Profile unavailable.</div>
    {/if}
  </div>
</div>




