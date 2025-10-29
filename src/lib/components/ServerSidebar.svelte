<script lang="ts">
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { getDb } from '$lib/firebase';
  import { user } from '$lib/stores/user';
  import ChannelCreateModal from '$lib/components/ChannelCreateModal.svelte';
  import VoiceMiniPanel from '$lib/components/VoiceMiniPanel.svelte';
  import { voiceSession } from '$lib/stores/voice';
  import type { VoiceSession } from '$lib/stores/voice';
  import { subscribeUnreadForServer, type UnreadMap } from '$lib/unread';

  import {
    collection,
    onSnapshot,
    orderBy,
    query,
    doc,
    type Unsubscribe,
    deleteDoc,
    updateDoc,
    setDoc,
    writeBatch
  } from 'firebase/firestore';

  export let serverId: string | undefined;
  export let activeChannelId: string | null = null;
  export let onPickChannel: (id: string) => void = () => {};
  const dispatch = createEventDispatcher<{ pick: string }>();

  $: computedServerId =
    serverId ??
    $page.params.serverID ??
    ($page.params as any).serverId ??
    null;

  type Chan = {
    id: string;
    name: string;
    type: 'text' | 'voice';
    position?: number;
    isPrivate?: boolean;
  };

  const CALL_DOC_ID = 'live';

  type VoiceParticipant = {
    uid: string;
    displayName?: string;
    photoURL?: string | null;
    hasAudio?: boolean;
    hasVideo?: boolean;
    status?: 'active' | 'left';
  };

  let channels: Chan[] = [];
  let serverName = 'Server';
  let showCreate = false;
  let myChannelOrder: string[] = [];
  let reorderMode: 'none' | 'default' | 'personal' = 'none';
  let workingOrder: string[] = [];
  let savingOrder = false;
  let orderError: string | null = null;

  let voicePresence: Record<string, VoiceParticipant[]> = {};
  const voiceUnsubs = new Map<string, Unsubscribe>();
  let activeVoice: VoiceSession | null = null;
  const unsubscribeVoiceSession = voiceSession.subscribe((value) => {
    activeVoice = value;
  });

  let unsubChannels: Unsubscribe | null = null;
  let unsubServerMeta: Unsubscribe | null = null;
  let unsubMyMember: Unsubscribe | null = null;
  let unsubUnread: Unsubscribe | null = null;
  let unsubPersonalOrder: Unsubscribe | null = null;

  let ownerId: string | null = null;
  let myRole: 'owner' | 'admin' | 'member' | null = null;
  let myPerms: Record<string, any> | null = null;
  let myRoleIds: string[] = [];
  let lastServerId: string | null = null;

  // Basic notification prefs (subset of full settings)
  let notifDesktopEnabled = false;
  let notifAllMessages = false;
  function subscribeNotifPrefs() {
    if (!$user?.uid) return;
    const db = getDb();
    const ref = doc(db, 'profiles', $user.uid);
    return onSnapshot(ref, (snap) => {
      const s: any = snap.data()?.settings ?? {};
      const p: any = s.notificationPrefs ?? {};
      notifDesktopEnabled = !!p.desktopEnabled;
      notifAllMessages = !!p.allMessages;
    });
  }
  const stopNotif = subscribeNotifPrefs();

  function deriveOwnerId(data: any): string | null {
    return data?.ownerId ?? data?.owner ?? data?.createdBy ?? null;
  }

  function computeIsOwner(): boolean {
    return !!(ownerId && $user?.uid && $user.uid === ownerId);
  }

  function voiceInitial(name?: string): string {
    if (!name) return '?';
    return name.trim().charAt(0).toUpperCase() || '?';
  }

  function isVoiceChannelActive(id: string): boolean {
    return !!(activeVoice && activeVoice.serverId === computedServerId && activeVoice.channelId === id);
  }

  function resetVoiceWatchers() {
    voiceUnsubs.forEach((unsub) => unsub());
    voiceUnsubs.clear();
    voicePresence = {};
  }

  function syncVoicePresenceWatchers(list: Chan[]) {
    if (!computedServerId) {
      resetVoiceWatchers();
      return;
    }

    const voiceIds = new Set(list.filter((c) => c.type === 'voice').map((c) => c.id));

    voiceUnsubs.forEach((unsub, channelId) => {
      if (!voiceIds.has(channelId)) {
        unsub();
        voiceUnsubs.delete(channelId);
        voicePresence = { ...voicePresence, [channelId]: [] };
      }
    });

    list.forEach((chan) => {
      if (chan.type !== 'voice' || voiceUnsubs.has(chan.id)) return;

      const db = getDb();
      const callDoc = doc(db, 'servers', computedServerId, 'channels', chan.id, 'calls', CALL_DOC_ID);
      const participantsRef = collection(callDoc, 'participants');
      const unsub = onSnapshot(
        participantsRef,
        (snap) => {
          const participants = snap.docs
            .map((d) => {
              const data = d.data() as any;
              const status = (data.status ?? 'active') as 'active' | 'left';
              return {
                uid: data.uid ?? d.id,
                displayName: data.displayName ?? 'Member',
                photoURL: data.photoURL ?? null,
                hasAudio: data.hasAudio ?? false,
                hasVideo: data.hasVideo ?? false,
                status
              } as VoiceParticipant;
            })
            .filter((p) => p.status !== 'left');

          voicePresence = { ...voicePresence, [chan.id]: participants };
        },
        () => {
          voicePresence = { ...voicePresence, [chan.id]: [] };
        }
      );

      voiceUnsubs.set(chan.id, unsub);
    });
  }

  function channelById(id: string): Chan | undefined {
    return channels.find((c) => c.id === id);
  }

  function channelTypeById(id: string): Chan['type'] | null {
    const chan = channelById(id);
    return chan?.type ?? null;
  }

  function defaultOrderIds(list: Chan[] = channels): string[] {
    return [...list]
      .sort((a, b) => {
        const pa = typeof a.position === 'number' ? a.position : 0;
        const pb = typeof b.position === 'number' ? b.position : 0;
        if (pa === pb) return (a.name ?? '').localeCompare(b.name ?? '');
        return pa - pb;
      })
      .map((c) => c.id);
  }

  function personalOrderIds(list: Chan[] = channels): string[] {
    if (!Array.isArray(myChannelOrder) || myChannelOrder.length === 0) return defaultOrderIds(list);
    const ids = list.map((c) => c.id);
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const id of myChannelOrder) {
      if (ids.includes(id) && !seen.has(id)) {
        ordered.push(id);
        seen.add(id);
      }
    }
    for (const id of ids) {
      if (!seen.has(id)) {
        ordered.push(id);
        seen.add(id);
      }
    }
    return ordered;
  }

  function mergeOrder(base: string[], target: string[]): string[] {
    const next: string[] = [];
    const seen = new Set<string>();
    for (const id of base) {
      if (target.includes(id) && !seen.has(id)) {
        next.push(id);
        seen.add(id);
      }
    }
    for (const id of target) {
      if (!seen.has(id)) {
        next.push(id);
        seen.add(id);
      }
    }
    return next;
  }

  function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function applyOrder(ids: string[], list: Chan[]): Chan[] {
    const map = new Map(list.map((c) => [c.id, c]));
    const ordered: Chan[] = [];
    for (const id of ids) {
      const chan = map.get(id);
      if (chan) {
        ordered.push(chan);
        map.delete(id);
      }
    }
    map.forEach((chan) => ordered.push(chan));
    return ordered;
  }

  function getDisplayOrderIds(): string[] {
    if (reorderMode === 'default' || reorderMode === 'personal') {
      return workingOrder;
    }
    return canManageChannels ? defaultOrderIds() : personalOrderIds();
  }

  function findSibling(id: string, type: Chan['type'], delta: number): string | null {
    if (!workingOrder.length) return null;
    const ids = workingOrder.filter((cid) => {
      const chan = channelById(cid);
      if (!chan || chan.type !== type) return false;
      if (reorderMode === 'default') return true;
      return canSeeChannel(chan);
    });
    const currentIndex = ids.indexOf(id);
    if (currentIndex === -1) return null;
    const targetIndex = currentIndex + delta;
    if (targetIndex < 0 || targetIndex >= ids.length) return null;
    return ids[targetIndex] ?? null;
  }

  function moveChannelInWorkingOrder(id: string, type: Chan['type'], delta: number) {
    if (!workingOrder.length) return;
    const scoped = workingOrder
      .map((cid, index) => ({ cid, index }))
      .filter(({ cid }) => {
        const chan = channelById(cid);
        if (!chan || chan.type !== type) return false;
        if (reorderMode === 'default') return true;
        return canSeeChannel(chan);
      });

    const current = scoped.findIndex((entry) => entry.cid === id);
    if (current === -1) return;
    const target = current + delta;
    if (target < 0 || target >= scoped.length) return;

    const fromIndex = scoped[current].index;
    const targetIndexRaw = scoped[target].index;
    const targetIndexAfterRemoval = targetIndexRaw - (targetIndexRaw > fromIndex ? 1 : 0);
    const insertIndex = delta > 0 ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval;

    const result = [...workingOrder];
    const [moved] = result.splice(fromIndex, 1);
    result.splice(Math.max(0, Math.min(result.length, insertIndex)), 0, moved);
    workingOrder = result;
  }

  function canMoveChannel(id: string, type: Chan['type'], delta: number) {
    return !!findSibling(id, type, delta);
  }

  $: isOwner = computeIsOwner();
  $: isAdminLike =
    isOwner ||
    myRole === 'admin' ||
    !!(myPerms?.manageServer || myPerms?.manageRoles);
  $: canManageChannels =
    isOwner ||
    !!myPerms?.manageChannels ||
    !!myPerms?.manageServer;
  $: canReorderPersonal = !!myPerms?.reorderChannels;

  function watchServerMeta(server: string) {
    unsubServerMeta?.();
    const db = getDb();
    const ref = doc(db, 'servers', server);
    unsubServerMeta = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          serverName = 'Server';
          ownerId = null;
          return;
        }
        const data = snap.data() as any;
        serverName = data?.name ?? 'Server';
        ownerId = deriveOwnerId(data);
        if (computeIsOwner()) {
          myRole = 'owner';
        }
      },
      () => {
        serverName = 'Server';
        ownerId = null;
      }
    );
  }

  function watchMyMember(server: string) {
    unsubMyMember?.();
    myRole = computeIsOwner() ? 'owner' : null;
    myPerms = null;
    myRoleIds = [];

    if (!$user?.uid) return;

    const db = getDb();
    const ref = doc(db, 'servers', server, 'members', $user.uid);
    unsubMyMember = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? (snap.data() as any) : null;
        const maybeRole = data?.role ?? null;
        myRole = computeIsOwner() ? 'owner' : (maybeRole as any);
        myPerms = data?.perms ?? null;
        myRoleIds = Array.isArray(data?.roleIds) ? data.roleIds : [];
      },
      () => {
        myRole = computeIsOwner() ? 'owner' : null;
        myPerms = null;
        myRoleIds = [];
      }
    );
  }

  function watchChannelOrder(server: string) {
    unsubPersonalOrder?.();
    myChannelOrder = [];
    if (!$user?.uid) return;

    const db = getDb();
    const ref = doc(db, 'profiles', $user.uid, 'servers', server);
    unsubPersonalOrder = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as any;
        if (Array.isArray(data?.channelOrder)) {
          myChannelOrder = data.channelOrder.filter((id: unknown) => typeof id === 'string');
        } else {
          myChannelOrder = [];
        }
      },
      () => {
        myChannelOrder = [];
      }
    );
  }

  function watchChannels(server: string) {
    unsubChannels?.();
    channels = [];

    const db = getDb();
    const qRef = query(collection(db, 'servers', server, 'channels'), orderBy('position'));
    unsubChannels = onSnapshot(qRef, (snap) => {
      channels = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Chan[];
      syncVoicePresenceWatchers(channels);
    });
  }

  function canSeeChannel(chan: Chan): boolean {
    const allowed = (chan as any)?.allowedRoleIds;
    if (!Array.isArray(allowed) || allowed.length === 0) return true;
    if (isAdminLike) return true;
    if (!Array.isArray(myRoleIds) || myRoleIds.length === 0) return false;
    return allowed.some((roleId: string) => myRoleIds.includes(roleId));
  }

  let displayOrderIds: string[] = [];
  let orderedChannels: Chan[] = [];
  let visibleChannels: Chan[] = [];

$: if (reorderMode === 'default') {
  const target = defaultOrderIds();
  const merged = mergeOrder(workingOrder.length ? workingOrder : target, target);
  if (!arraysEqual(workingOrder, merged)) workingOrder = merged;
} else if (reorderMode === 'personal') {
  const target = personalOrderIds();
  const merged = mergeOrder(workingOrder.length ? workingOrder : target, target);
  if (!arraysEqual(workingOrder, merged)) workingOrder = merged;
} else if (workingOrder.length) {
  workingOrder = [];
}

  $: displayOrderIds = getDisplayOrderIds();
  $: orderedChannels = applyOrder(displayOrderIds, channels);
  $: visibleChannels = orderedChannels.filter(canSeeChannel);

  function subscribeAll(server: string) {
    resetVoiceWatchers();
    watchServerMeta(server);
    watchMyMember(server);
    watchChannels(server);
    watchChannelOrder(server);
    reorderMode = 'none';
    workingOrder = [];
    orderError = null;
    savingOrder = false;
    // Unread per channel
    unsubUnread?.();
    if ($user?.uid) {
      unreadReady = false;
      unsubUnread = subscribeUnreadForServer($user.uid, server, (map: UnreadMap) => {
        unreadByChannel = map;
        if (!unreadReady) { prevUnread = { ...map }; unreadReady = true; }
      });
    }
  }

  $: if (computedServerId && computedServerId !== lastServerId) {
    lastServerId = computedServerId;
    subscribeAll(computedServerId);
  }

  $: if (computedServerId && $user?.uid) {
    watchMyMember(computedServerId);
  }

  $: if (browser && window.matchMedia('(min-width: 768px)').matches && computedServerId) {
    if (activeChannelId && !visibleChannels.some((c) => c.id === activeChannelId)) {
      const fallback = visibleChannels[0];
      if (fallback) pick(fallback.id);
    } else if (!activeChannelId && visibleChannels.length) {
      pick(visibleChannels[0].id);
    }
  }

  onDestroy(() => {
    unsubChannels?.();
    unsubServerMeta?.();
    unsubMyMember?.();
    unsubUnread?.();
    unsubPersonalOrder?.();
    resetVoiceWatchers();
    unsubscribeVoiceSession();
    stopNotif?.();
  });

  function pick(id: string) {
    if (reorderMode !== 'none') return;
    if (!id) return;
    onPickChannel(id);
    dispatch('pick', id);
    // Optimistically clear unread badge for picked channel
    if (unreadByChannel[id] && unreadByChannel[id] > 0) {
      unreadByChannel = { ...unreadByChannel, [id]: 0 };
    }
  }

  function beginReorder() {
    orderError = null;
    if (canManageChannels) {
      reorderMode = 'default';
      workingOrder = defaultOrderIds();
    } else if (canReorderPersonal) {
      reorderMode = 'personal';
      workingOrder = personalOrderIds();
    }
  }

  function cancelReorder() {
    reorderMode = 'none';
    workingOrder = [];
    orderError = null;
  }

  async function saveReorder() {
    if (reorderMode === 'none' || savingOrder) return;
    if (!computedServerId) return;

    const ids = workingOrder.filter((id) => !!channelById(id));
    if (!ids.length) {
      reorderMode = 'none';
      workingOrder = [];
      return;
    }

    const database = getDb();
    orderError = null;
    savingOrder = true;

    try {
      if (reorderMode === 'default') {
        const batch = writeBatch(database);
        ids.forEach((id, index) => {
          batch.update(doc(database, 'servers', computedServerId, 'channels', id), { position: index });
        });
        await batch.commit();
      } else if (reorderMode === 'personal' && $user?.uid) {
        await setDoc(
          doc(database, 'profiles', $user.uid, 'servers', computedServerId),
          { channelOrder: ids },
          { merge: true }
        );
        myChannelOrder = ids;
      }
      reorderMode = 'none';
      workingOrder = [];
    } catch (error) {
      console.error('Failed to save channel order', error);
      orderError = 'Could not save channel order. Try again.';
    } finally {
      savingOrder = false;
    }
  }

  function openServerSettings() {
    if (!computedServerId || !isAdminLike) return;
    goto(`/servers/${computedServerId}/settings`);
  }

  // Unread state map
  let unreadByChannel: Record<string, number> = {};
  let prevUnread: Record<string, number> = {};
  let unreadReady = false;
  $: if (browser && unreadReady && document.visibilityState === 'hidden' && notifDesktopEnabled && notifAllMessages) {
    try {
      for (const id in unreadByChannel) {
        const curr = unreadByChannel[id] ?? 0;
        const prev = prevUnread[id] ?? 0;
        if (curr > prev && id !== activeChannelId) {
          const chan = channels.find((c) => c.id === id);
          const title = chan?.name ? `#${chan.name}` : 'New message';
          new Notification(title, { body: `New messages in ${serverName}`, tag: `ch-${id}` });
        }
      }
    } catch {}
    prevUnread = { ...unreadByChannel };
  } else {
    prevUnread = { ...unreadByChannel };
  }

  async function deleteChannel(id: string, name: string) {
    if (!computedServerId || !canManageChannels) return;
    const ok = confirm(`Delete channel #${name}? This cannot be undone.`);
    if (!ok) return;

    const db = getDb();
    try {
      await deleteDoc(doc(db, 'servers', computedServerId, 'channels', id));
      if (activeChannelId === id) {
        const next = channels.find((c) => c.id !== id);
        if (next) pick(next.id);
      }
    } catch (err) {
      alert('Failed to delete channel.');
      console.error(err);
    }
  }

  async function renameChannel(id: string, oldName: string) {
    if (!computedServerId || !canManageChannels) return;
    const name = prompt('Rename channel to:', oldName);
    if (!name || name.trim() === oldName) return;

    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', computedServerId, 'channels', id), {
        name: name.trim()
      });
    } catch (err) {
      alert('Failed to rename channel.');
      console.error(err);
    }
  }
</script>

<aside
  class="h-dvh w-64 panel flex flex-col border-r border-subtle text-primary"
  aria-label="Channels"
>
  <div class="h-12 px-3 flex items-center justify-between border-b border-subtle">
    <div class="flex items-center gap-2 min-w-0">
      <div class="font-semibold truncate" title={serverName}>{serverName}</div>
      {#if isOwner}
        <span class="badge-accent text-[10px] px-1.5 py-0.5">owner</span>
      {:else if isAdminLike}
        <span class="badge-accent text-[10px] px-1.5 py-0.5">admin</span>
      {/if}
    </div>

    <div class="flex items-center gap-1">
      {#if canManageChannels || canReorderPersonal}
        {#if reorderMode === 'none'}
          <button
            type="button"
            class="btn btn-ghost h-8 px-2 "
            title="Reorder channels"
            aria-label="Reorder channels"
            on:click={beginReorder}
          >
            <i class="bx bx-sort-alt-2 text-lg" aria-hidden="true"></i>
          </button>
        {:else}
          <button
            type="button"
            class="btn btn-primary h-8 px-3 "
            on:click={saveReorder}
            disabled={savingOrder}
          >
            {savingOrder ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            class="btn btn-ghost h-8 px-2 "
            on:click={cancelReorder}
            disabled={savingOrder}
          >
            Cancel
          </button>
        {/if}
      {/if}
      {#if isAdminLike}
        <button
          type="button"
          class="btn btn-ghost h-8 w-8 grid place-items-center "
          title="Server settings"
          aria-label="Server settings"
          on:click={openServerSettings}
        >
          <i class="bx bx-cog text-[16px]" aria-hidden="true"></i>
        </button>
      {/if}
      <button
        type="button"
        class="btn btn-ghost h-8 w-8 grid place-items-center "
        title="Create channel"
        aria-label="Create channel"
        on:click={() => (showCreate = true)}
        disabled={reorderMode !== 'none'}
      >
        <i class="bx bx-plus" aria-hidden="true"></i>
      </button>
    </div>
  </div>

  {#if reorderMode !== 'none'}
    <div class="px-3 pt-2 text-xs text-soft">
      {#if reorderMode === 'default'}
        Reordering default channel order (applies to everyone).
      {:else}
        Reordering your personal channel order.
      {/if}
    </div>
  {/if}
  {#if orderError}
    <div class="px-3 pt-2 text-xs text-red-300">{orderError}</div>
  {/if}

<div class="p-3 space-y-4 overflow-y-auto overflow-x-hidden">
    {#if activeVoice}
      <!-- Desktop-only mini voice panel -->
      <div class="hidden md:block">
        <VoiceMiniPanel serverId={computedServerId} session={activeVoice} />
      </div>
    {/if}
    <div>
      <div class="channel-section-header">Text channels</div>
      <div class="space-y-1">
        {#each visibleChannels.filter((c) => c.type === 'text') as c (c.id)}
          <div
            class={`channel-row ${(activeChannelId === c.id || isVoiceChannelActive(c.id)) ? 'channel-row--active' : ''}`}
          >
            {#if reorderMode !== 'none'}
              <div class="channel-reorder-controls">
                <button
                  type="button"
                  class="channel-reorder-button"
                  title="Move up"
                  aria-label="Move channel up"
                  on:click={() => moveChannelInWorkingOrder(c.id, 'text', -1)}
                  disabled={!canMoveChannel(c.id, 'text', -1) || savingOrder}
                >
                  <i class="bx bx-chevron-up text-sm" aria-hidden="true"></i>
                </button>
                <button
                  type="button"
                  class="channel-reorder-button"
                  title="Move down"
                  aria-label="Move channel down"
                  on:click={() => moveChannelInWorkingOrder(c.id, 'text', 1)}
                  disabled={!canMoveChannel(c.id, 'text', 1) || savingOrder}
                >
                  <i class="bx bx-chevron-down text-sm" aria-hidden="true"></i>
                </button>
              </div>
            {/if}

            <button
              type="button"
              class="channel-row__button"
              on:click={() => pick(c.id)}
              aria-label={`Open #${c.name} text channel`}
              disabled={reorderMode !== 'none'}
            >
              <i class="bx bx-hash" aria-hidden="true"></i>
              <span class="truncate">{c.name}</span>
              <span class="ml-auto flex items-center gap-1">
                {#if (unreadByChannel[c.id] ?? 0) > 0}
                  <span class="channel-unread">
                    {unreadByChannel[c.id] > 99 ? '99+' : unreadByChannel[c.id]}
                  </span>
                {/if}
                {#if Array.isArray((c as any).allowedRoleIds) && (c as any).allowedRoleIds.length}
                  <i class="bx bx-lock text-xs opacity-70" aria-hidden="true"></i>
                {/if}
              </span>
            </button>

            {#if canManageChannels && reorderMode === 'none'}
              <div class="channel-actions shrink-0">
                <button
                  class="h-7 w-7 shrink-0 grid place-items-center rounded hover:bg-white/10"
                  title="Rename"
                  aria-label="Rename channel"
                  on:click={() => renameChannel(c.id, c.name)}
                >
                  <i class="bx bx-edit text-sm"></i>
                </button>
                <button
                  class="h-7 w-7 shrink-0 grid place-items-center rounded hover:bg-white/10 text-red-400"
                  title="Delete"
                  aria-label="Delete channel"
                  on:click={() => deleteChannel(c.id, c.name)}
                >
                  <i class="bx bx-trash text-sm"></i>
                </button>
              </div>
            {/if}
          </div>
        {/each}
        {#if !visibleChannels.some((c) => c.type === 'text')}
          <div class="text-xs text-soft px-3 py-2">No accessible text channels.</div>
        {/if}
      </div>
    </div>

    <div>
      <div class="channel-section-header">Voice channels</div>
      <div class="space-y-1">
        {#each visibleChannels.filter((c) => c.type === 'voice') as c (c.id)}
          <div
            class={`channel-row ${(activeChannelId === c.id || isVoiceChannelActive(c.id)) ? 'channel-row--active' : ''}`}
          >
            {#if reorderMode !== 'none'}
              <div class="channel-reorder-controls">
                <button
                  type="button"
                  class="channel-reorder-button"
                  title="Move up"
                  aria-label="Move voice channel up"
                  on:click={() => moveChannelInWorkingOrder(c.id, 'voice', -1)}
                  disabled={!canMoveChannel(c.id, 'voice', -1) || savingOrder}
                >
                  <i class="bx bx-chevron-up text-sm" aria-hidden="true"></i>
                </button>
                <button
                  type="button"
                  class="channel-reorder-button"
                  title="Move down"
                  aria-label="Move voice channel down"
                  on:click={() => moveChannelInWorkingOrder(c.id, 'voice', 1)}
                  disabled={!canMoveChannel(c.id, 'voice', 1) || savingOrder}
                >
                  <i class="bx bx-chevron-down text-sm" aria-hidden="true"></i>
                </button>
              </div>
            {/if}

            <button
              type="button"
              class="channel-row__button"
              on:click={() => pick(c.id)}
              aria-label={`Open ${c.name} voice channel`}
              disabled={reorderMode !== 'none'}
            >
              <i class="bx bx-headphone" aria-hidden="true"></i>
              <span class="truncate">{c.name}</span>
              <span class="ml-auto flex items-center gap-2">
                {#if (voicePresence[c.id]?.length ?? 0) > 0}
                  <span class="channel-voice-count">
                    {voicePresence[c.id].length}
                  </span>
                {/if}
                {#if Array.isArray((c as any).allowedRoleIds) && (c as any).allowedRoleIds.length}
                  <i class="bx bx-lock text-xs opacity-70" aria-hidden="true"></i>
                {/if}
              </span>
            </button>

            {#if canManageChannels && reorderMode === 'none'}
              <div class="channel-actions shrink-0">
                <button
                  class="h-7 w-7 grid place-items-center rounded hover:bg-white/10"
                  title="Rename"
                  aria-label="Rename channel"
                  on:click={() => renameChannel(c.id, c.name)}
                >
                  <i class="bx bx-edit text-sm"></i>
                </button>
                <button
                  class="h-7 w-7 grid place-items-center rounded hover:bg-white/10 text-red-400"
                  title="Delete"
                  aria-label="Delete channel"
                  on:click={() => deleteChannel(c.id, c.name)}
                >
                  <i class="bx bx-trash text-sm"></i>
                </button>
              </div>
            {/if}
          </div>

          {#if (voicePresence[c.id]?.length ?? 0) > 0}
            <div class="channel-voice-presence">
              <div class="flex flex-wrap items-center gap-2">
                <div class="flex items-center -space-x-2">
                  {#each voicePresence[c.id].slice(0, 4) as member (member.uid)}
                    <div class="channel-voice-avatar">
                      {#if member.photoURL}
                        <img
                          src={member.photoURL}
                          alt={member.displayName}
                          class="h-full w-full object-cover"
                          loading="lazy"
                        />
                      {:else}
                        <div class="grid h-full w-full place-items-center text-[10px] font-semibold text-primary">
                          {voiceInitial(member.displayName)}
                        </div>
                      {/if}
                      {#if member.hasVideo === false}
                        <i class="bx bx-video-off channel-voice-indicator channel-voice-indicator--video"></i>
                      {/if}
                      {#if member.hasAudio === false}
                        <i class="bx bx-microphone-off channel-voice-indicator channel-voice-indicator--audio"></i>
                      {/if}
                    </div>
                  {/each}
                  {#if voicePresence[c.id].length > 4}
                    <div class="channel-voice-more">
                      +{voicePresence[c.id].length - 4}
                    </div>
                  {/if}
                </div>
                <span class="ml-auto text-[10px] uppercase tracking-wide text-soft">
                  {voicePresence[c.id].length} online
                </span>
              </div>
            </div>
          {/if}
        {/each}
        {#if !visibleChannels.some((c) => c.type === 'voice')}
          <div class="text-xs text-soft px-3 py-2">No accessible voice channels.</div>
        {/if}
      </div>
    </div>

    <ChannelCreateModal
      bind:open={showCreate}
      serverId={computedServerId}
      onClose={() => (showCreate = false)}
      onCreated={(id) => pick(id)}
    />
  </div>
</aside>



