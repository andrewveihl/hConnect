<script lang="ts">
  import { run, stopPropagation } from 'svelte/legacy';

  import { createEventDispatcher, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
  import { db } from '$lib/firestore';
  import { user } from '$lib/stores/user';
  import {
    searchUsersByName, getOrCreateDMThread, streamMyDMs,
    streamUnreadCount, streamProfiles, getProfile, deleteThreadForUser,
    streamThreadMeta
  } from '$lib/firestore/dms';

  const dispatch = createEventDispatcher();
  let me: any = $state(null);

  interface Props {
    activeThreadId?: string | null;
  }

  type PresenceState = 'online' | 'idle' | 'offline';

  type PresenceDoc = {
    state?: string | null;
    status?: string | null;
    online?: boolean | null;
    isOnline?: boolean | null;
    active?: boolean | null;
    lastActive?: any;
    lastSeen?: any;
    updatedAt?: any;
    timestamp?: any;
  };

  const presenceLabels: Record<PresenceState, string> = {
    online: 'Online',
    idle: 'Idle',
    offline: 'Offline'
  };

  const presenceClassMap: Record<PresenceState, string> = {
    online: 'presence-dot--online',
    idle: 'presence-dot--idle',
    offline: 'presence-dot--offline'
  };

  const THREAD_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const THREAD_DATE_WITH_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  let { activeThreadId = $bindable(null) }: Props = $props();

  export function updatePartnerMeta(meta: { uid: string; displayName?: string | null; name?: string | null; email?: string | null }) {
    const partner = meta?.uid?.trim?.();
    if (!partner) return;
    const resolved = meta.displayName ?? meta.name ?? meta.email ?? partner;
    nameCache = { ...nameCache, [partner]: resolved };
    threads = threads.map((thread) => {
      const other = thread.otherUid || (thread.participants || []).find((p: string) => p !== me?.uid);
      if (other !== partner) return thread;
      return {
        ...thread,
        otherDisplayName: meta.displayName ?? meta.name ?? thread.otherDisplayName ?? thread.otherName ?? null,
        otherEmail: meta.email ?? thread.otherEmail ?? null
      };
    });
  }

  /* ---------------- Search ---------------- */
  const SEARCH_PAGE_SIZE = 20;
  const PEOPLE_PAGE_SIZE = 40;
  const THREAD_PLACEHOLDERS = Array.from({ length: 4 }, (_, i) => i);
  const PEOPLE_PLACEHOLDERS = Array.from({ length: 5 }, (_, i) => i);

  let term = $state('');
  let searching = $state(false);
  let results: any[] = $state([]);
  let error: string | null = $state(null);
  let searchTimer: any;
  let showPeoplePicker = $state(false);
  let searchVisibleCount = $state(SEARCH_PAGE_SIZE);
  let peopleVisibleCount = $state(PEOPLE_PAGE_SIZE);
  let visibleSearchResults: any[] = $state([]);
  let visiblePeopleList: any[] = $state([]);

  function resetSearchState() {
    clearTimeout(searchTimer);
    searchTimer = null;
    term = '';
    results = [];
    error = null;
    searching = false;
    searchVisibleCount = SEARCH_PAGE_SIZE;
  }

  function openPeoplePicker() {
    resetSearchState();
    peopleVisibleCount = Math.min(PEOPLE_PAGE_SIZE, people.length || PEOPLE_PAGE_SIZE);
    showPeoplePicker = true;
  }

  function closePeoplePicker() {
    resetSearchState();
    showPeoplePicker = false;
    peopleVisibleCount = PEOPLE_PAGE_SIZE;
  }

  async function runSearch(q: string) {
    error = null;
    const s = q.trim();
    if (s.length < 2) {
      results = [];
      searchVisibleCount = SEARCH_PAGE_SIZE;
      return;
    }
    searching = true;
    try {
      const found = await searchUsersByName(s, { limitTo: 25 });
      results = me?.uid ? found.filter((u) => u.uid !== me.uid) : found;
      searchVisibleCount = SEARCH_PAGE_SIZE;
    } catch (e: any) {
      error = e?.message ?? 'Search failed';
    } finally {
      searching = false;
    }
  }

  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(term), 200);
  }

  /* ---------------- Threads ---------------- */
  let threads: any[] = $state([]);
  let threadsLoading = $state(true);
  let unsubThreads: (() => void) | null = $state(null);
  let threadMeta: Record<string, { lastMessage: string | null; lastSender: string | null; updatedAt: any | null }> = $state({});
  let metaUnsubs: Record<string, () => void> = {};
  let decoratedThreads: any[] = $state([]);
  let sortedThreads: any[] = $state([]);

  onDestroy(() => unsubThreads?.());
  onDestroy(() => {
    Object.values(metaUnsubs).forEach((stop) => stop());
    metaUnsubs = {};
  });
  onDestroy(() => cleanupPresence());

  // Resolve names for "other" participant so the list shows names, not UIDs.
  let nameCache: Record<string, string> = $state({});

  function pickDisplayCandidate(source: any): string | null {
    if (!source) return null;
    const candidates = Array.isArray(source)
      ? source
      : [
          source.otherDisplayName,
          source.otherName,
          source.otherEmail,
          source.displayName,
          source.name,
          source.profile?.name,
          source.profile?.displayName,
          source.profile?.email
        ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    return null;
  }

  function pickString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length) return trimmed;
    }
    return undefined;
  }

  const isRecent = (value: unknown, ms = 5 * 60 * 1000) => {
    if (!value) return false;
    try {
      if (typeof value === 'number') {
        return Date.now() - value <= ms;
      }
      if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) && Date.now() - parsed <= ms;
      }
      if (value instanceof Date) {
        return Date.now() - value.getTime() <= ms;
      }
      if (typeof (value as any)?.toMillis === 'function') {
        const ts = (value as any).toMillis();
        return Number.isFinite(ts) && Date.now() - ts <= ms;
      }
    } catch {
      return false;
    }
    return false;
  };



  function resolveOtherUid(t: any) {
    return t.otherUid || (t.participants || []).find((p: string) => p !== me?.uid) || null;
  }

  function otherOf(t: any) {
    const o = resolveOtherUid(t);
    if (!o) return 'Unknown';
    if (nameCache[o]) return nameCache[o];
    const fromPeople = peopleMap[o];
    if (fromPeople) {
      return fromPeople.displayName || fromPeople.name || fromPeople.email || o;
    }
    const fallback =
      t.otherName ??
      t.otherDisplayName ??
      t.otherEmail ??
      t.displayName ??
      t.name ??
      (t.profile && (t.profile.name ?? t.profile.displayName ?? t.profile.email)) ??
      null;
    return fallback ?? o;
  }

  function otherPhotoOf(t: any) {
    const other = resolveOtherUid(t);
    if (!other) return null;
    const fromPeople = peopleMap[other];
    if (fromPeople) {
      if (fromPeople.photoURL) return fromPeople.photoURL;
      if (fromPeople.authPhotoURL) return fromPeople.authPhotoURL;
    }
    return (
      t.otherPhotoURL ??
      t.photoURL ??
      t.profile?.photoURL ??
      t.profile?.authPhotoURL ??
      null
    );
  }

  function timestampValue(value: any): number {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (typeof value?.toMillis === 'function') {
      try {
        return value.toMillis();
      } catch {
        return 0;
      }
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (typeof value?.seconds === 'number') {
      const base = value.seconds * 1000;
      const extra = typeof value.nanoseconds === 'number' ? value.nanoseconds / 1e6 : 0;
      return base + extra;
    }
    if (value instanceof Date) return value.getTime();
    return 0;
  }

  function formatThreadTimestamp(value: any): string | null {
    const ts = timestampValue(value);
    if (!ts) return null;
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60 * 1000) return 'Now';
    if (diff < 60 * 60 * 1000) {
      const mins = Math.max(1, Math.round(diff / 60000));
      return `${mins}m`;
    }
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.max(1, Math.round(diff / 3600000));
      return `${hours}h`;
    }
    const date = new Date(ts);
    const nowDate = new Date();
    if (date.getFullYear() === nowDate.getFullYear()) {
      return THREAD_DATE_FORMAT.format(date);
    }
    return THREAD_DATE_WITH_YEAR_FORMAT.format(date);
  }

  function previewTextFor(thread: any) {
    const summary = thread?.lastMessage;
    if (!summary) return 'No messages yet';
    if (thread?.lastSender && me?.uid && thread.lastSender === me.uid) {
      return `You: ${summary}`;
    }
    return summary;
  }


  function manageThreadMetaSubscriptions(currentThreads: any[]) {
    if (!Array.isArray(currentThreads)) return;
    const ids = new Set(
      currentThreads
        .map((t) => t?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    );
    ids.forEach((id) => {
      if (!metaUnsubs[id]) {
        metaUnsubs[id] = streamThreadMeta(id, (meta) => {
          threadMeta = { ...threadMeta, [id]: meta };
        });
      }
    });
    for (const id of Object.keys(metaUnsubs)) {
      if (!ids.has(id)) {
        metaUnsubs[id]?.();
        delete metaUnsubs[id];
        if (threadMeta[id]) {
          const next = { ...threadMeta };
          delete next[id];
          threadMeta = next;
        }
      }
    }
  }


  /* ---------------- Presence tracking ---------------- */
  let presenceDocs: Record<string, PresenceDoc> = $state({});
  const presenceUnsubs: Record<string, Unsubscribe> = {};
  let presenceDb: ReturnType<typeof db> | null = null;

  function ensurePresenceDb() {
    if (typeof window === 'undefined') return null;
    if (!presenceDb) {
      try {
        presenceDb = db();
      } catch (err) {
        console.warn('Failed to init Firestore for presence', err);
        return null;
      }
    }
    return presenceDb;
  }

  function unsubscribePresence(uid: string) {
    if (!uid || !presenceUnsubs[uid]) return;
    presenceUnsubs[uid]!();
    delete presenceUnsubs[uid];
    if (presenceDocs[uid]) {
      const next = { ...presenceDocs };
      delete next[uid];
      presenceDocs = next;
    }
  }

  function subscribePresence(uid: string) {
    if (!uid || presenceUnsubs[uid]) return;
    const database = ensurePresenceDb();
    if (!database) return;
    try {
      const ref = doc(database, 'profiles', uid, 'presence', 'status');
      presenceUnsubs[uid] = onSnapshot(
        ref,
        (snap) => {
          presenceDocs = { ...presenceDocs, [uid]: (snap.data() as PresenceDoc) ?? {} };
        },
        () => {
          unsubscribePresence(uid);
        }
      );
    } catch (err) {
      console.warn('Failed to subscribe to presence', err);
    }
  }

  function cleanupPresence() {
    for (const uid in presenceUnsubs) {
      presenceUnsubs[uid]!();
      delete presenceUnsubs[uid];
    }
    presenceDocs = {};
    presenceDb = null;
  }

  function syncPresenceSubscriptions() {
    if (typeof window === 'undefined') return;
    const partnerUids = new Set(
      threads
        .map((t) => resolveOtherUid(t))
        .filter((uid): uid is string => typeof uid === 'string' && uid.length > 0)
    );
    partnerUids.forEach((uid) => subscribePresence(uid));
    Object.keys(presenceUnsubs).forEach((uid) => {
      if (!partnerUids.has(uid)) {
        unsubscribePresence(uid);
      }
    });
  }

  function booleanPresenceFrom(source: any): boolean | null {
    if (!source || typeof source !== 'object') return null;
    if (typeof source.online === 'boolean') return source.online;
    if (typeof source.isOnline === 'boolean') return source.isOnline;
    if (typeof source.active === 'boolean') return source.active;
    return null;
  }

  function statusFromSource(source: any): string | undefined {
    if (!source || typeof source !== 'object') return undefined;
    return (
      pickString(source.status) ??
      pickString(source.state) ??
      pickString(source.presenceState) ??
      pickString((source.presence as any)?.state)
    );
  }

  function recentActivityFrom(source: any) {
    if (!source || typeof source !== 'object') return null;
    return source.lastActive ?? source.lastSeen ?? source.updatedAt ?? source.timestamp ?? null;
  }

  function presenceStateFor(uid: string | null, thread?: any): PresenceState {
    if (!uid) return 'offline';
    const sources = [
      thread?.presence ?? null,
      thread?.profile ?? null,
      thread ?? null,
      peopleMap[uid] ?? null,
      presenceDocs[uid] ?? null
    ];

    for (const source of sources) {
      const bool = booleanPresenceFrom(source);
      if (bool !== null) {
        return bool ? 'online' : 'offline';
      }
    }

    for (const source of sources) {
      const raw = statusFromSource(source);
      if (!raw) continue;
      const normalized = raw.toLowerCase();
      if (['online', 'active', 'available', 'connected', 'here'].includes(normalized)) return 'online';
      if (['idle', 'away', 'brb', 'soon'].includes(normalized)) return 'idle';
      if (['dnd', 'busy', 'offline', 'invisible', 'do not disturb', 'off'].includes(normalized)) return 'offline';
    }

    for (const source of sources) {
      const recent = recentActivityFrom(source);
      if (!recent) continue;
      if (isRecent(recent, 5 * 60 * 1000)) return 'online';
      if (isRecent(recent, 30 * 60 * 1000)) return 'idle';
      return 'offline';
    }

    return 'offline';
  }

  const presenceClassFromState = (state: PresenceState) =>
    presenceClassMap[state] ?? presenceClassMap.offline;


  /* ---------------- Unread badges ---------------- */
  let unreadMap: Record<string, number> = $state({});
  let unsubsUnread: Array<() => void> = $state([]);

  onDestroy(() => unsubsUnread.forEach((u) => u()));

  /* ---------------- Everyone (profiles) ---------------- */
  let people: any[] = $state([]);
  let peopleLoading = $state(true);
  let peopleMap: Record<string, any> = $state({});
  let unsubPeople: (() => void) | null = $state(null);

  onDestroy(() => unsubPeople?.());


  function loadMoreSearchResults() {
    if (!showPeoplePicker) return;
    if (results.length > searchVisibleCount) {
      searchVisibleCount = Math.min(results.length, searchVisibleCount + SEARCH_PAGE_SIZE);
    }
  }

  function loadMorePeople() {
    if (!showPeoplePicker) return;
    if (people.length > peopleVisibleCount) {
      peopleVisibleCount = Math.min(people.length, peopleVisibleCount + PEOPLE_PAGE_SIZE);
    }
  }

  function createLazyObserver(callback: () => void) {
    return (node: HTMLElement) => {
      if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined' || !node) {
        return { destroy() {} };
      }
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) callback();
          });
        },
        { rootMargin: '160px 0px 0px', threshold: 0 }
      );
      observer.observe(node);
      return {
        destroy() {
          observer.disconnect();
        }
      };
    };
  }

  const searchSentinelAction = createLazyObserver(loadMoreSearchResults);
  const peopleSentinelAction = createLazyObserver(loadMorePeople);

  /* ---------------- Actions ---------------- */
  function openExisting(threadId: string) {
    activeThreadId = threadId;
    dispatch('select', threadId);
    // Optimistically clear unread
    if (unreadMap[threadId] && unreadMap[threadId] > 0) {
      unreadMap = { ...unreadMap, [threadId]: 0 };
    }
    void goto(`/dms/${threadId}`);
  }

  async function openOrStartDM(targetUid: string) {
    if (!me?.uid) return;
    try {
      const t = await getOrCreateDMThread([me.uid, targetUid], me.uid);

      if (!threads.find((x) => x.id === t.id)) {
        threads = [
          {
            id: t.id,
            participants: [me.uid, targetUid].sort(),
            lastMessage: t.lastMessage ?? null,
            updatedAt: new Date()
          },
          ...threads
        ];
      }

      activeThreadId = t.id;
      dispatch('select', t.id);
      // Optimistically clear unread
      if (unreadMap[t.id] && unreadMap[t.id] > 0) {
        unreadMap = { ...unreadMap, [t.id]: 0 };
      }
      closePeoplePicker();
      await goto(`/dms/${t.id}`);
    } catch (err: any) {
      console.error('Failed to open/start DM', err);
      alert(err?.message ?? 'Failed to open DM. Check Firestore rules/permissions.');
    }
  }

  async function deleteThread(threadId: string) {
    if (!me?.uid) return;
    const confirmDelete = window.confirm('Remove this conversation? You can start it again later.');
    if (!confirmDelete) return;

    try {
      await deleteThreadForUser(threadId, me.uid);
      threads = threads.filter((t) => t.id !== threadId);
      const nextMap = { ...unreadMap };
      delete nextMap[threadId];
      unreadMap = nextMap;
      if (activeThreadId === threadId) {
        activeThreadId = null;
      }
      dispatch('delete', threadId);
    } catch (err) {
      console.error('Failed to delete DM thread', err);
    }
  }
  run(() => {
    me = $user;
  });
  run(() => {
    unsubThreads?.();
    if (me?.uid) {
      threadsLoading = true;
      unsubThreads = streamMyDMs(me.uid, (t) => {
        threads = t;
        threadsLoading = false;
      });
    } else {
      threads = [];
      threadsLoading = false;
    }
  });
  run(() => {
    if (threads?.length) {
      let updated = false;
      const nextCache = { ...nameCache };
      for (const t of threads) {
        const other = resolveOtherUid(t);
        if (!other) continue;
        const seeded = pickDisplayCandidate(t);
        if (seeded && nextCache[other] !== seeded) {
          nextCache[other] = seeded;
          updated = true;
        }
      }
      if (updated) {
        nameCache = nextCache;
      }
    }
  });
  run(() => {
    (async () => {
      if (!threads?.length) return;
      for (const t of threads) {
        const other = resolveOtherUid(t);
        if (other && !nameCache[other]) {
          try {
            const prof = await getProfile(other);
            const resolved =
              prof?.displayName ??
              prof?.name ??
              prof?.email ??
              null;
            if (resolved) {
              nameCache = { ...nameCache, [other]: resolved };
            }
          } catch {}
        }
      }
    })();
  });
  run(() => {
    manageThreadMetaSubscriptions(threads);
  });
  run(() => {
    syncPresenceSubscriptions();
  });
  run(() => {
    decoratedThreads = threads.map((thread) => {
      const meta = threadMeta[thread.id] ?? null;
      const lastMessage = meta?.lastMessage ?? thread.lastMessage ?? null;
      const lastSender = meta?.lastSender ?? thread.lastSender ?? null;
      const updatedAt = meta?.updatedAt ?? thread.updatedAt ?? null;
      return {
        ...thread,
        lastMessage,
        lastSender,
        updatedAt,
        _sortValue: timestampValue(updatedAt)
      };
    });
  });
  run(() => {
    sortedThreads = decoratedThreads
      .slice()
      .sort((a, b) => {
        const diff = (b._sortValue ?? 0) - (a._sortValue ?? 0);
        if (diff !== 0) return diff;
        return (a.id || '').localeCompare(b.id || '');
      });
  });
  run(() => {
    unsubsUnread.forEach((u) => u());
    unsubsUnread = [];
    if (me?.uid) {
      for (const t of threads) {
        const stop = streamUnreadCount(t.id, me.uid, (n) => {
          unreadMap = { ...unreadMap, [t.id]: n };
        });
        unsubsUnread.push(stop);
      }
    }
  });
  run(() => {
    peopleLoading = true;
    unsubPeople?.();
    unsubPeople = streamProfiles((list) => {
      const filtered = (me?.uid) ? list.filter((p) => p.uid !== me.uid) : list;
      people = filtered;
      const map: Record<string, any> = {};
      for (const p of list) map[p.uid] = p;
      peopleMap = map;

      if (filtered.length) {
        const next = { ...nameCache };
        let updated = false;
        for (const person of filtered) {
          const uid = person?.uid;
          if (!uid) continue;
          const resolved =
            person?.displayName ??
            person?.name ??
            person?.email ??
            null;
          if (resolved && next[uid] !== resolved) {
            next[uid] = resolved;
            updated = true;
          }
        }
        if (updated) {
          nameCache = next;
        }
      }

      peopleLoading = false;
    }, { limitTo: 500 });
  });
  run(() => {
    visibleSearchResults = results.slice(0, Math.min(searchVisibleCount, results.length));
  });
  run(() => {
    visiblePeopleList = people.slice(0, Math.min(peopleVisibleCount, people.length));
  });
</script>

<aside class="relative w-80 shrink-0 sidebar-surface border-r border-subtle h-[100dvh] flex flex-col text-primary">
  <!-- Header -->
  <div class="px-4 py-3 flex items-center justify-between gap-2">
    <div class="text-base font-semibold">Direct Messages</div>
    <div class="flex items-center gap-2">
      <button
        class="p-2 rounded-full bg-white/5 text-white/80 hover:text-white hover:bg-white/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
        type="button"
        aria-label="Start a conversation"
        onclick={openPeoplePicker}
        disabled={showPeoplePicker}
      >
        <i class="bx bx-plus text-xl"></i>
      </button>
      <i class="bx bx-message-dots text-xl text-white/70"></i>
    </div>
  </div>

  <div class="mt-4 flex-1 overflow-y-auto px-2 pb-4 space-y-6">
    <section>
      <div class="text-xs uppercase tracking-wide text-soft px-2 mb-1">Personal</div>
      <ul class="space-y-1 pr-1">
        <li>
          <a
            href="/dms/notes"
            class={`channel-row ${activeThreadId === '__notes' ? 'channel-row--active' : ''}`}
            onclick={() => dispatch('select', { id: '__notes' })}
          >
            <div class="w-9 h-9 rounded-full bg-white/10 grid place-items-center">
              <i class="bx bx-notepad text-lg"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium leading-5 truncate">My Notes</div>
              <div class="text-xs text-soft truncate">Private to you</div>
            </div>
          </a>
        </li>
      </ul>
    </section>

    <section>
      <div class="text-xs uppercase tracking-wide text-soft px-2 mb-1">Messages</div>
      <ul class="space-y-0.5 pr-1">
        {#if threadsLoading}
          {#each THREAD_PLACEHOLDERS as idx}
            <li>
              <div class="flex items-center gap-3 px-2 py-2 animate-pulse">
                <div class="w-9 h-9 rounded-full bg-white/10"></div>
                <div class="flex-1 min-w-0 space-y-1">
                  <div class="h-3 rounded bg-white/15 w-1/2"></div>
                  <div class="h-3 rounded bg-white/10 w-1/3"></div>
                </div>
                <div class="w-6 h-6 rounded-full bg-white/10"></div>
              </div>
            </li>
          {/each}
          <li class="sr-only" aria-live="polite">Loading conversations...</li>
        {:else}
          {#each sortedThreads as t}
            {@const isActive = activeThreadId === t.id}
            {@const otherPhoto = otherPhotoOf(t)}
            {@const otherUid = resolveOtherUid(t)}
            {@const presenceState = presenceStateFor(otherUid, t)}
            {@const timestampLabel = formatThreadTimestamp(t.updatedAt)}
            <li>
              <div class={`group flex items-center gap-2 px-2 py-2 overflow-hidden ${isActive ? 'bg-white/10' : 'hover:bg-white/5'}`}>
                <button
                  class="flex-1 flex items-center gap-3 text-left focus:outline-none min-w-0"
                  onclick={() => openExisting(t.id)}
                >
                  <div class="dm-thread__avatar">
                    <div class="dm-thread__avatar-img">
                      {#if otherPhoto}
                        <img class="w-full h-full object-cover" src={otherPhoto} alt="" />
                      {:else}
                        <i class="bx bx-user text-lg text-white/80"></i>
                      {/if}
                    </div>
                    {#if otherUid}
                      <span
                        class={`presence-dot ${presenceClassFromState(presenceState)}`}
                        aria-label={presenceLabels[presenceState]}
                        title={presenceLabels[presenceState]}
                      ></span>
                    {/if}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 min-w-0">
                      <div class="text-sm font-medium leading-5 truncate flex-1 min-w-0">{otherOf(t)}</div>
                      {#if timestampLabel}
                        <span class="dm-thread__timestamp">{timestampLabel}</span>
                      {/if}
                    </div>
                    <div class="text-xs text-white/50 truncate">{previewTextFor(t)}</div>
                  </div>
                  {#if (unreadMap[t.id] ?? 0) > 0}
                    <span class="ml-2 min-w-6 h-6 px-2 text-xs grid place-items-center rounded-full bg-red-600">
                      {unreadMap[t.id]}
                    </span>
                  {/if}
                </button>
                <button
                  class="p-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 hover:bg-white/10 text-white/70 hover:text-white transition transition-opacity"
                  aria-label="Delete conversation"
                  onclick={stopPropagation(() => deleteThread(t.id))}
                >
                  <i class="bx bx-trash"></i>
                </button>
              </div>
            </li>
          {/each}
          {#if sortedThreads.length === 0}
            <li class="px-2 py-2 text-sm text-white/60">No conversations yet.</li>
          {/if}
        {/if}
      </ul>
    </section>

  </div>

  {#if showPeoplePicker}
    <div class="people-picker absolute inset-0 z-20 flex flex-col text-primary">
      <div class="px-4 py-3 border-b border-subtle flex items-center justify-between">
        <div>
          <div class="text-base font-semibold">Start a conversation</div>
          <div class="people-picker__subtitle">Search anyone on hConnect</div>
        </div>
        <button
          class="btn btn-ghost btn-sm rounded-full people-picker__close"
          type="button"
          aria-label="Close people picker"
          onclick={closePeoplePicker}
        >
          <i class="bx bx-x text-xl"></i>
        </button>
      </div>

      <div class="p-4 border-b border-subtle space-y-2">
        <div class="people-picker__input">
          <i class="bx bx-search people-picker__search-icon"></i>
          <input
            class="input input--compact pl-9 pr-3 people-picker__field"
            placeholder="Search people by name"
            bind:value={term}
            oninput={onSearchInput}
          />
        </div>
        {#if error}
          <p class="people-picker__hint text-red-400">{error}</p>
        {:else if searching}
          <p class="people-picker__hint">Searching...</p>
        {:else if term.trim().length < 2}
          <p class="people-picker__hint">Type at least 2 characters to search.</p>
        {/if}
      </div>

      <div class="people-picker__body flex-1 overflow-y-auto p-4 space-y-6">
        <section>
          <div class="people-picker__section-label px-2">Search results</div>
          {#if visibleSearchResults.length > 0}
            <ul class="space-y-1">
              {#each visibleSearchResults as u}
                <li>
                  <button
                    class="people-picker__option"
                    onclick={() => openOrStartDM(u.uid)}
                  >
                    <img class="w-8 h-8 rounded-full object-cover" src={u.photoURL || u.authPhotoURL || '/static/demo-cursor.png'} alt="" />
                    <div class="text-sm text-left">
                      <div class="font-medium leading-5">{u.displayName || u.email || u.uid}</div>
                      {#if u.email}<div class="people-picker__muted">{u.email}</div>{/if}
                    </div>
                  </button>
                </li>
              {/each}
              {#if results.length > visibleSearchResults.length}
                <li>
                  <div class="people-picker__sentinel" use:searchSentinelAction aria-hidden="true"></div>
                </li>
              {/if}
            </ul>
          {:else if term.trim().length >= 2 && !searching && !error}
            <p class="people-picker__empty">No people found.</p>
          {:else if searching}
            <p class="people-picker__empty">Looking up people...</p>
          {:else}
            <p class="people-picker__empty">Start typing to search for anyone on hConnect.</p>
          {/if}
        </section>

        <section>
          <div class="people-picker__section-label px-2">All people</div>
          {#if peopleLoading}
            <ul class="space-y-1 pr-1" aria-hidden="true">
              {#each PEOPLE_PLACEHOLDERS as idx}
                <li>
                  <div class="people-picker__option animate-pulse cursor-default select-none">
                    <div class="w-8 h-8 rounded-full bg-white/10"></div>
                    <div class="flex-1 space-y-1">
                      <div class="h-3 w-2/3 rounded bg-white/10"></div>
                      <div class="h-3 w-1/2 rounded bg-white/5"></div>
                    </div>
                  </div>
                </li>
              {/each}
            </ul>
            <p class="sr-only" aria-live="polite">Loading people...</p>
          {:else if visiblePeopleList.length > 0}
            <ul class="space-y-1 pr-1">
              {#each visiblePeopleList as p}
                <li>
                  <button
                    class="people-picker__option"
                    onclick={() => openOrStartDM(p.uid)}
                  >
                    <img class="w-8 h-8 rounded-full object-cover" src={p.photoURL || p.authPhotoURL || '/static/demo-cursor.png'} alt="" />
                    <div class="text-sm text-left">
                      <div class="font-medium leading-5">{p.displayName || p.email || 'User'}</div>
                      {#if p.email}<div class="people-picker__muted">{p.email}</div>{/if}
                    </div>
                  </button>
                </li>
              {/each}
              {#if people.length > visiblePeopleList.length}
                <li>
                  <div class="people-picker__sentinel" use:peopleSentinelAction aria-hidden="true"></div>
                </li>
              {/if}
            </ul>
          {:else}
            <p class="people-picker__empty px-2">No users yet.</p>
          {/if}
        </section>
      </div>
    </div>
  {/if}
</aside>






<style>
  .dm-thread__timestamp {
    font-size: 0.7rem;
    color: var(--color-text-tertiary, rgba(255, 255, 255, 0.6));
    line-height: 1;
    flex-shrink: 0;
  }

  .dm-thread__avatar {
    position: relative;
    width: 2.25rem;
    height: 2.25rem;
    flex-shrink: 0;
    display: grid;
    place-items: center;
  }

  .dm-thread__avatar-img {
    width: 100%;
    height: 100%;
    border-radius: 9999px;
    overflow: hidden;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--color-sidebar, #0f172a) 70%, rgba(255, 255, 255, 0.08));
  }

  .dm-thread__avatar-img img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
  }

  .dm-thread__avatar .presence-dot {
    pointer-events: none;
    z-index: 1;
    transform: translate(15%, 15%);
    border-color: color-mix(in srgb, var(--color-sidebar, #0f172a) 70%, rgba(0, 0, 0, 0.6));
  }

  .people-picker {
    background: color-mix(in srgb, var(--color-sidebar) 92%, var(--color-app-overlay) 45%);
    backdrop-filter: blur(14px);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
    color: var(--color-text-primary);
  }

  .people-picker__subtitle {
    font-size: 0.82rem;
    color: var(--color-text-secondary);
  }

  .people-picker__close {
    min-width: 2.25rem;
    height: 2.25rem;
  }

  .people-picker__input {
    position: relative;
  }

  .people-picker__search-icon {
    position: absolute;
    left: 0.85rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-tertiary);
    pointer-events: none;
    font-size: 1rem;
  }

  .people-picker__field {
    background: var(--input-bg);
    border-color: var(--input-border);
  }

  .people-picker__hint {
    font-size: 0.78rem;
    color: var(--color-text-tertiary);
  }

  .people-picker__body {
    background: color-mix(in srgb, var(--color-panel-muted) 90%, transparent);
    border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 40%, transparent);
  }

  .people-picker__section-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-tertiary);
    margin-bottom: 0.3rem;
  }

  .people-picker__option {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-md);
    text-align: left;
    transition: background 120ms ease, box-shadow 120ms ease;
    background: transparent;
  }

  .people-picker__option:hover,
  .people-picker__option:focus-visible {
    background: color-mix(in srgb, var(--color-panel-muted) 65%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
  }

  .people-picker__option:focus-visible {
    outline: none;
  }

  .people-picker__muted,
  .people-picker__empty {
    font-size: 0.82rem;
    color: var(--color-text-secondary);
  }

  .people-picker__empty {
    padding: 0.25rem 0;
  }

  .people-picker__sentinel {
    width: 100%;
    height: 1px;
  }
</style>
