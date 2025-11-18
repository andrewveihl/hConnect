<script lang="ts">
  import type { PageData } from './$types';
  import AdminCard from '$lib/admin/components/AdminCard.svelte';
  import { ensureFirebaseReady, getDb } from '$lib/firebase';
  import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    startAfter,
    type QueryDocumentSnapshot,
    type QueryConstraint
  } from 'firebase/firestore';
  import { showAdminToast } from '$lib/admin/stores/toast';

  type DMMessage = {
    id: string;
    text?: string;
    type?: string;
    authorId?: string;
    createdAt?: Date | null;
  };

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let search = $state('');
  let selectedThreadId: string | null = $state(data.threads[0]?.id ?? null);
  let threadMessages: DMMessage[] = $state([]);
  let loading = $state(false);
  const MESSAGE_BATCH = 100;
  let hasMore = $state(false);
  let nextCursor: QueryDocumentSnapshot | null = null;
  let profileLookup = $state<Record<string, string>>({ ...(data.profileLookup ?? {}) });
  let messageSearch = $state('');
  let messageScroller = $state<HTMLDivElement | null>(null);
  let topSentinel = $state<HTMLDivElement | null>(null);

  const filteredThreads = $derived(
    data.threads.filter((thread) => {
      if (!search) return true;
      const q = search.toLowerCase();
      const base = `${thread.participantLabels.join(',')} ${thread.id}`.toLowerCase();
      return base.includes(q);
    })
  );

  const selectedThread = $derived(data.threads.find((thread) => thread.id === selectedThreadId) ?? null);
  const selectedThreadLabel = $derived(
    selectedThread ? (selectedThread.participantLabels ?? []).join(', ') : ''
  );

  let lastLoadedThread: string | null = null;
$effect(() => {
  if (!selectedThreadId || selectedThreadId === lastLoadedThread) return;
  lastLoadedThread = selectedThreadId;
  void loadThread(selectedThreadId);
});

  async function loadThread(threadId: string) {
    loading = true;
    nextCursor = null;
    hasMore = false;
    try {
      await ensureFirebaseReady();
      const { messages, cursor } = await fetchMessagesBatch(threadId);
      nextCursor = cursor;
      hasMore = Boolean(cursor);
      const missing = Array.from(
        new Set(messages.map((message) => message.authorId).filter((uid) => uid && !profileLookup[uid!]))
      );
      if (missing.length) {
        await ensureAuthorProfiles(missing as string[]);
      }
      threadMessages = messages.sort((a, b) => {
        const aTime = a.createdAt?.getTime?.() ?? 0;
        const bTime = b.createdAt?.getTime?.() ?? 0;
        return aTime - bTime;
      });
      messageSearch = '';
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Unable to load DM.' });
    } finally {
      loading = false;
    }
  }

  const ensureAuthorProfiles = async (uids: string[]) => {
    try {
      await ensureFirebaseReady();
      const db = getDb();
      const lookups = await Promise.all(
        uids.map(async (uid) => {
          const snap = await getDoc(doc(db, 'profiles', uid));
          const payload = snap.exists() ? (snap.data() as Record<string, any>) : null;
          return { uid, displayName: payload?.displayName ?? payload?.name ?? null };
        })
      );
      const next = { ...profileLookup };
      lookups.forEach((entry) => {
        if (entry.displayName) next[entry.uid] = entry.displayName;
      });
      profileLookup = next;
    } catch (err) {
      console.error(err);
    }
  };

  const fetchMessagesBatch = async (threadId: string, cursor: QueryDocumentSnapshot | null = null) => {
    const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc'), limit(MESSAGE_BATCH)];
    if (cursor) constraints.push(startAfter(cursor));
    const db = getDb();
    const snap = await getDocs(query(collection(db, 'dms', threadId, 'messages'), ...constraints));
    return {
      messages: snap.docs.map((docSnap) => {
        const payload = docSnap.data() as Record<string, any>;
        return {
          id: docSnap.id,
          text: payload.text ?? payload.content ?? '',
          type: payload.type ?? 'text',
          authorId: payload.uid ?? payload.author?.uid ?? '',
          createdAt: payload.createdAt?.toDate?.() ?? null
        };
      }),
      cursor: snap.docs.length === MESSAGE_BATCH ? snap.docs[snap.docs.length - 1]! : null
    };
  };

  const loadMoreMessages = async () => {
    if (!selectedThreadId || !nextCursor || loading) return;
    loading = true;
    try {
      const { messages, cursor } = await fetchMessagesBatch(selectedThreadId, nextCursor);
      nextCursor = cursor;
      hasMore = Boolean(cursor);
      const missing = Array.from(
        new Set(messages.map((message) => message.authorId).filter((uid) => uid && !profileLookup[uid!]))
      );
      if (missing.length) {
        await ensureAuthorProfiles(missing as string[]);
      }
      threadMessages = [...messages, ...threadMessages].sort((a, b) => {
        const aTime = a.createdAt?.getTime?.() ?? 0;
        const bTime = b.createdAt?.getTime?.() ?? 0;
        return aTime - bTime;
      });
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: 'Unable to Load older messages.' });
    } finally {
      loading = false;
    }
  };

  const labelFor = (uid: string | undefined) => {
    if (!uid) return 'Unknown user';
    return profileLookup[uid] ?? uid;
  };

  const visibleMessages = $derived(
    messageSearch
      ? threadMessages.filter((message) =>
          (message.text ?? '').toLowerCase().includes(messageSearch.toLowerCase())
        )
      : threadMessages
  );

  $effect(() => {
    if (!topSentinel || !messageScroller) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && hasMore && !loading) {
            void loadMoreMessages();
          }
        });
      },
      { root: messageScroller, threshold: 0.1 }
    );
    observer.observe(topSentinel);
    return () => observer.disconnect();
  });
</script>

<section class="admin-page admin-page--split h-full w-full">
  <div class="dm-panel">
    <AdminCard title="DM Threads" description="Select a thread to inspect messages." padded={false}>
      <div class="flex h-full flex-col">
        <div class="border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-6 py-4">
          <input
            type="search"
            placeholder="Search by participant or ID"
            class="w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-4 py-2 text-sm text-[color:var(--color-text-primary,#0f172a)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-[color:var(--color-text-primary,#0f172a)]"
            bind:value={search}
          />
        </div>
        <div class="flex-1 overflow-y-auto p-4">
          {#if filteredThreads.length === 0}
            <p class="text-sm text-[color:var(--text-60,#6b7280)]">No threads match.</p>
          {:else}
            <ul class="space-y-2">
              {#each filteredThreads as thread}
                <li>
                  <button
                    type="button"
                    class="w-full rounded-2xl border px-4 py-3 text-left text-sm transition"
                    class:border-teal-400={thread.id === selectedThreadId}
                    class:border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)]={thread.id !== selectedThreadId}
                    onclick={() => (selectedThreadId = thread.id)}
                  >
                    <p class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">{(thread.participantLabels ?? thread.participants ?? []).join(', ')}</p>
                    {#if thread.lastMessage}
                      <p class="text-xs text-[color:var(--text-60,#6b7280)] truncate">{thread.lastMessage}</p>
                    {/if}
                    <p class="text-xs text-[color:var(--text-55,#6b7280)]">
                      {thread.updatedAt ? thread.updatedAt.toLocaleString() : '--'}
                    </p>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    </AdminCard>
  </div>

  <div class="dm-panel">
    <AdminCard title="Conversation" description="Messages are read-only." padded={false}>
      <div class="flex h-full min-h-0 flex-col overflow-hidden">
        {#if loading}
          <p class="p-6 text-sm text-[color:var(--text-60,#6b7280)]">Loading messages…</p>
          <p class="p-6 text-sm text-[color:var(--text-60,#6b7280)]">Select a thread.</p>
        {:else if threadMessages.length === 0}
          <p class="p-6 text-sm text-[color:var(--text-60,#6b7280)]">No messages in this thread.</p>
        {:else}
          <div class="flex flex-col gap-4 border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-6 py-4">
            <div>
              <p class="text-xs uppercase tracking-[0.3em] text-[color:var(--text-60,#6b7280)]">Participants</p>
              <p class="text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)]">
                {selectedThreadLabel || 'Choose a thread'}
              </p>
            </div>
            <input
              type="search"
              placeholder={selectedThreadLabel ? `Search ${selectedThreadLabel}` : 'Search within conversation'}
              class="w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-4 py-2 text-sm text-[color:var(--color-text-primary,#0f172a)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-[color:var(--color-text-primary,#0f172a)]"
              bind:value={messageSearch}
            />
          </div>
          <div
            class="flex-1 overflow-y-auto bg-[color-mix(in_srgb,var(--surface-panel)90%,transparent)] p-6"
            bind:this={messageScroller}
          >
            <div class="h-0" bind:this={topSentinel} aria-hidden="true"></div>
            <div class="space-y-4">
              {#each visibleMessages as message}
                <div class="max-w-2xl rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)95%,transparent)] p-4 shadow">
                  <p class="text-xs uppercase tracking-wide text-[color:var(--text-60,#6b7280)]">{labelFor(message.authorId)}</p>
                  <p class="mt-2 text-sm text-[color:var(--color-text-primary,#0f172a)]">{message.text ?? `[${message.type}]`}</p>
                  <p class="mt-2 text-[11px] text-[color:var(--text-60,#6b7280)]">
                    {message.createdAt ? message.createdAt.toLocaleString() : '--'}
                  </p>
                </div>
              {/each}
            </div>
            {#if hasMore}
              <div class="mt-4 flex justify-center">
                <button
                  type="button"
                  class="rounded-full border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-4 py-2 text-xs font-semibold text-[color:var(--color-text-primary,#0f172a)]"
                  onclick={loadMoreMessages}
                  disabled={loading}
                >
                  {loading ? 'Loading…' : 'Load older messages'}
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </AdminCard>
  </div>
</section>

<style>
  .dm-panel {
    min-height: 0;
  }

  .dm-panel :global(section) {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .dm-panel :global(section > div:last-child) {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
</style>


