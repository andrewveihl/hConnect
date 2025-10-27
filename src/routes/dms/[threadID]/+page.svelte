<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/user';
  import { getDb } from '$lib/firebase';
  import { doc, getDoc, onSnapshot, type Unsubscribe } from 'firebase/firestore';

  import DMsSidebar from '$lib/components/DMsSidebar.svelte';
  import MessageList from '$lib/components/MessageList.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';

  import { sendDMMessage, streamDMMessages, markThreadRead, voteOnDMPoll, submitDMForm, toggleDMReaction } from '$lib/db/dms';

  export let data: { threadID: string };
  $: threadID = data.threadID;

  let me: any = null;
  $: me = $user;

  let messages: any[] = [];
  let messageUsers: Record<string, any> = {};
const profileUnsubs: Record<string, Unsubscribe> = {};
let sidebarRef: InstanceType<typeof DMsSidebar> | null = null;
let sidebarRefMobile: InstanceType<typeof DMsSidebar> | null = null;

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
        const photoURL = pickString(data?.photoURL) ?? null;
        updateMessageUserCache(uid, { uid, displayName, name: displayName, photoURL });
      },
      () => {
        profileUnsubs[uid]?.();
        delete profileUnsubs[uid];
      }
    );
  }
  let unsub: (() => void) | null = null;
  let mounted = false;

  let otherUid: string | null = null;
  let otherProfile: any = null;
  let metaLoading = true;

  let showThreads = false;
  let showInfo = false;

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

  function deriveMeDisplayName() {
    return (
      pickString(me?.displayName) ??
      pickString(me?.email) ??
      'You'
    );
  }

  function deriveMePhotoURL() {
    return pickString(me?.photoURL) ?? null;
  }

  function normalizeUserRecord(uid: string, data: any = {}) {
    const displayName =
      pickString(data?.displayName) ??
      pickString(data?.name) ??
      pickString(data?.email) ??
      'Member';
    const name =
      pickString(data?.name) ??
      displayName;
    const photoURL = pickString(data?.photoURL) ?? null;
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

$: {
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
}

  $: if (threadID) {
    loadThreadMeta();
  }

  $: {
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
        displayName: displayName ?? existing.displayName ?? 'Member',
        name: name ?? existing.name ?? displayName ?? 'Member',
        photoURL: photoURL ?? existing.photoURL ?? null
      };
    }
    messageUsers = next;
  }

  function setupGestures() {
    if (typeof window === 'undefined') return () => {};

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        showThreads = false;
        showInfo = false;
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
  $: if (Object.keys(messageUsers).length > 0) {
    try {
      const database = getDb();
      for (const uid in messageUsers) ensureProfileSubscription(database, uid);
    } catch {}
  }

  $: if (mounted && threadID) {
    unsub?.();
    unsub = streamDMMessages(threadID, async (msgs) => {
      messages = msgs.map((row: any) => toChatMessage(row.id, row));
      if (me?.uid) {
        const last = messages[messages.length - 1];
        const at = last?.createdAt ?? null;
        const lastId = last?.id ?? null;
        await markThreadRead(threadID, me.uid, { at, lastMessageId: lastId });
      }
    });
  }

  async function handleSend(text: string) {
    const trimmed = text?.trim();
    if (!trimmed || !me?.uid) return;
    await sendDMMessage(threadID, {
      type: 'text',
      text: trimmed,
      uid: me.uid,
      displayName: deriveMeDisplayName(),
      photoURL: deriveMePhotoURL()
    });
  }

  async function handleSendGif(url: string) {
    const trimmed = pickString(url);
    if (!trimmed || !me?.uid) return;
    try {
      await sendDMMessage(threadID, {
        type: 'gif',
        url: trimmed,
        uid: me.uid,
        displayName: deriveMeDisplayName(),
        photoURL: deriveMePhotoURL()
      });
    } catch (err) {
      console.error(err);
      alert(`Failed to share GIF: ${err}`);
    }
  }

  async function handleCreatePoll(poll: { question: string; options: string[] }) {
    if (!me?.uid) return;
    try {
      await sendDMMessage(threadID, {
        type: 'poll',
        poll,
        uid: me.uid,
        displayName: deriveMeDisplayName(),
        photoURL: deriveMePhotoURL()
      });
    } catch (err) {
      console.error(err);
      alert(`Failed to create poll: ${err}`);
    }
  }

  async function handleCreateForm(form: { title: string; questions: string[] }) {
    if (!me?.uid) return;
    try {
      await sendDMMessage(threadID, {
        type: 'form',
        form,
        uid: me.uid,
        displayName: deriveMeDisplayName(),
        photoURL: deriveMePhotoURL()
      });
    } catch (err) {
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

  function onSend(e: CustomEvent<any>) {
    const val = typeof e.detail === 'string' ? e.detail : e.detail?.text;
    handleSend(val ?? '');
  }

  $: displayName =
    pickString(otherProfile?.displayName) ??
    pickString(otherProfile?.name) ??
    pickString(otherProfile?.email) ??
    (otherProfile ? 'Member' : 'Direct Message');
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
          on:click={() => (showThreads = true)}
        >
          <i class="bx bx-menu text-2xl"></i>
        </button>
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
      </div>
      <button
        class="md:hidden p-2  hover:bg-white/10 active:bg-white/15 transition"
        aria-label="View profile"
        on:click={() => (showInfo = true)}
      >
        <i class="bx bx-user-circle text-2xl"></i>
      </button>
    </header>

    <main class="flex-1 overflow-hidden panel-muted">
      <div class="h-full flex flex-col">
        <div class="flex-1 overflow-hidden p-3 sm:p-4">
          <MessageList
            {messages}
            users={messageUsers}
            currentUserId={me?.uid ?? null}
            on:vote={handleVote}
            on:submitForm={handleFormSubmit}
            on:react={handleReaction}
          />
        </div>
      </div>
    </main>

    <div class="border-t border-subtle panel p-3">
      <ChatInput
        placeholder={`Message ${displayName}`}
        on:send={onSend}
        on:submit={onSend}
        on:sendGif={(e) => handleSendGif(e.detail)}
        on:createPoll={(e) => handleCreatePoll(e.detail)}
        on:createForm={(e) => handleCreateForm(e.detail)}
      />
    </div>
  </div>

  <aside class="hidden lg:flex lg:w-72 xl:w-80 panel-muted border-l border-subtle overflow-y-auto">
    <div class="p-4 w-full">
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
</div>

<!-- Mobile overlays -->
<div
  class="mobile-panel md:hidden fixed inset-y-0 right-0 left-[72px] z-40 flex flex-col transition-transform duration-300 will-change-transform"
  style:transform={showThreads ? 'translateX(0)' : 'translateX(-100%)'}
  style:pointer-events={showThreads ? 'auto' : 'none'}
  aria-label="Conversations"
>
  <div class="mobile-panel__header md:hidden">
    <button class="mobile-panel__close -ml-2" aria-label="Close" type="button" on:click={() => (showThreads = false)}>
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
  class="mobile-panel md:hidden fixed inset-y-0 right-0 left-[72px] z-40 flex flex-col transition-transform duration-300 will-change-transform"
  style:transform={showInfo ? 'translateX(0)' : 'translateX(100%)'}
  style:pointer-events={showInfo ? 'auto' : 'none'}
  aria-label="Profile"
>
  <div class="mobile-panel__header md:hidden">
    <button class="mobile-panel__close -ml-2" aria-label="Close" type="button" on:click={() => (showInfo = false)}>
      <i class="bx bx-chevron-left text-2xl"></i>
    </button>
    <div class="mobile-panel__title">Profile</div>
  </div>

  <div class="flex-1 overflow-y-auto p-4">
    {#if metaLoading}
      <div class="animate-pulse text-soft">Loading profile…</div>
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
          <p>This user hasn’t added a bio yet.</p>
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




