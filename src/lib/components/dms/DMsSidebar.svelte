<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/user';
  import {
    searchUsersByName, getOrCreateDMThread, streamMyDMs,
    streamUnreadCount, streamProfiles, getProfile, deleteThreadForUser
  } from '$lib/firestore/dms';

  const dispatch = createEventDispatcher();
  let me: any = null;
  $: me = $user;

  export let activeThreadId: string | null = null;

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
  let term = '';
  let searching = false;
  let results: any[] = [];
  let error: string | null = null;
  let searchTimer: any;

  async function runSearch(q: string) {
    error = null;
    const s = q.trim();
    if (s.length < 2) {
      results = [];
      return;
    }
    searching = true;
    try {
      const found = await searchUsersByName(s, { limitTo: 25 });
      results = (me?.uid) ? found.filter((u) => u.uid !== me.uid) : found;
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
  let threads: any[] = [];
  let unsubThreads: (() => void) | null = null;

  $: if (me?.uid) {
    unsubThreads?.();
    unsubThreads = streamMyDMs(me.uid, (t) => {
      threads = t;
    });
  }
  onDestroy(() => unsubThreads?.());

  // Resolve names for "other" participant so the list shows names, not UIDs.
  let nameCache: Record<string, string> = {};

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

  $: if (threads?.length) {
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

  $: (async () => {
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

  function resolveOtherUid(t: any) {
    return t.otherUid || (t.participants || []).find((p: string) => p !== me?.uid) || null;
  }

  function otherOf(t: any) {
    const o = resolveOtherUid(t);
    if (!o) return 'Unknown';
    if (nameCache[o]) return nameCache[o];
    const fromPeople = peopleMap[o];
    if (fromPeople) {
      const resolved = fromPeople.displayName || fromPeople.name || fromPeople.email || o;
      nameCache = { ...nameCache, [o]: resolved };
      return resolved;
    }
    const fallback =
      t.otherName ??
      t.otherDisplayName ??
      t.otherEmail ??
      t.displayName ??
      t.name ??
      (t.profile && (t.profile.name ?? t.profile.displayName ?? t.profile.email)) ??
      null;
    if (fallback) {
      nameCache = { ...nameCache, [o]: fallback };
      return fallback;
    }
    return o;
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

  /* ---------------- Unread badges ---------------- */
  let unreadMap: Record<string, number> = {};
  let unsubsUnread: Array<() => void> = [];

  $: {
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
  }
  onDestroy(() => unsubsUnread.forEach((u) => u()));

  /* ---------------- Everyone (profiles) ---------------- */
  let people: any[] = [];
  let peopleMap: Record<string, any> = {};
  let unsubPeople: (() => void) | null = null;

  $: {
    unsubPeople?.();
    unsubPeople = streamProfiles((list) => {
      const filtered = (me?.uid) ? list.filter((p) => p.uid !== me.uid) : list;
      people = filtered;
      const map: Record<string, any> = {};
      for (const p of list) map[p.uid] = p;
      peopleMap = map;
    }, { limitTo: 500 });
  }
  onDestroy(() => unsubPeople?.());

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
</script>

<aside class="w-80 shrink-0 bg-[#0f172a] border-r border-white/10 h-[100dvh] flex flex-col">
  <!-- Header -->
  <div class="px-4 py-3 flex items-center justify-between">
    <div class="text-base font-semibold">Direct Messages</div>
    <i class="bx bx-message-dots text-xl text-white/70"></i>
  </div>

  <!-- Search -->
  <div class="px-3">
    <div class="relative">
      <i class="bx bx-search absolute left-3 top-2.5 text-white/50"></i>
      <input
        class="w-full pl-9 pr-3 py-2  bg-white/5 outline-none focus:ring-2 ring-white/20"
        placeholder="Search people by name"
        bind:value={term}
        on:input={onSearchInput}
      />
    </div>
    {#if error}<p class="text-xs text-red-400 mt-2">{error}</p>{/if}
    {#if searching}<p class="text-xs text-white/60 mt-2">Searchingâ€¦</p>{/if}
  </div>

  <!-- Search results -->
  {#if results.length > 0}
    <div class="px-2 mt-2">
      <div class="text-xs uppercase tracking-wide text-soft px-2 mb-1">Search results</div>
      <ul class="space-y-1">
        {#each results as u}
          <li>
            <button
              class="w-full flex items-center gap-3 px-2 py-2  hover:bg-white/5"
              on:click={() => openOrStartDM(u.uid)}
            >
              <img class="w-8 h-8 rounded-full object-cover" src={u.photoURL || u.authPhotoURL || '/static/demo-cursor.png'} alt="" />
              <div class="text-sm text-left">
                <div class="font-medium leading-5">{u.displayName || u.email || u.uid}</div>
                {#if u.email}<div class="text-xs text-white/50">{u.email}</div>{/if}
              </div>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="mt-4 flex-1 overflow-y-auto px-2 pb-4 space-y-6">
    <section>
      <div class="text-xs uppercase tracking-wide text-soft px-2 mb-1">Personal</div>
      <ul class="space-y-1 pr-1">
        <li>
          <a
            href="/dms/notes"
            class={`channel-row ${activeThreadId === '__notes' ? 'channel-row--active' : ''}`}
            on:click={() => dispatch('select', { id: '__notes' })}
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
        {#each threads as t}
          {@const isActive = activeThreadId === t.id}
          {@const otherPhoto = otherPhotoOf(t)}
          <li>
            <div class={`flex items-center gap-2 px-2 py-2  ${isActive ? 'bg-white/10' : 'hover:bg-white/5'}`}>
              <button
                class="flex-1 flex items-center gap-3 text-left focus:outline-none"
                on:click={() => openExisting(t.id)}
              >
                <div class="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center overflow-hidden">
                  {#if otherPhoto}
                    <img class="w-full h-full object-cover" src={otherPhoto} alt="" />
                  {:else}
                    <i class="bx bx-user text-lg"></i>
                  {/if}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium leading-5 truncate">{otherOf(t)}</div>
                  <div class="text-xs text-white/50 truncate">{t.lastMessage || 'No messages yet'}</div>
                </div>
                {#if (unreadMap[t.id] ?? 0) > 0}
                  <span class="ml-2 min-w-6 h-6 px-2 text-xs grid place-items-center rounded-full bg-red-600">
                    {unreadMap[t.id]}
                  </span>
                {/if}
              </button>
              <button
                class="p-2  hover:bg-white/10 text-white/70 hover:text-white transition"
                aria-label="Delete conversation"
                on:click|stopPropagation={() => deleteThread(t.id)}
              >
                <i class="bx bx-trash"></i>
              </button>
            </div>
          </li>
        {/each}
        {#if threads.length === 0}
          <li class="px-2 py-2 text-sm text-white/60">No conversations yet.</li>
        {/if}
      </ul>
    </section>

    <section>
      <div class="text-xs uppercase tracking-wide text-soft px-2 mb-1">All people</div>
      <ul class="space-y-1 pr-1">
        {#each people as p}
          <li>
            <button
              class="w-full flex items-center gap-3 px-2 py-2  hover:bg-white/5"
              on:click={() => openOrStartDM(p.uid)}
            >
              <img class="w-8 h-8 rounded-full object-cover" src={p.photoURL || p.authPhotoURL || '/static/demo-cursor.png'} alt="" />
              <div class="text-sm text-left">
                <div class="font-medium leading-5">{p.displayName || p.email || 'User'}</div>
                {#if p.email}<div class="text-xs text-white/50">{p.email}</div>{/if}
              </div>
            </button>
          </li>
        {/each}
        {#if people.length === 0}
          <li class="px-2 py-2 text-sm text-white/60">No users yet.</li>
        {/if}
      </ul>
    </section>
  </div>
</aside>




