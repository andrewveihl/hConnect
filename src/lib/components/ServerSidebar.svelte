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
    updateDoc
  } from 'firebase/firestore';

  export let serverId: string | undefined;
  export let activeChannelId: string | null = null;
  export let onPickChannel: (id: string) => void = () => {};
  const dispatch = createEventDispatcher<{ pick: string }>();

  $: computedServerId =
    serverId ??
    $page.params.serverId ??
    ($page.params as any).serverID ??
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

  $: isOwner = computeIsOwner();
  $: isAdminLike =
    isOwner ||
    myRole === 'admin' ||
    !!(myPerms?.manageServer || myPerms?.manageRoles);
  $: canManageChannels =
    isOwner ||
    !!myPerms?.manageChannels ||
    !!myPerms?.manageServer;

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

  let visibleChannels: Chan[] = [];
  $: visibleChannels = channels.filter(canSeeChannel);

  function subscribeAll(server: string) {
    resetVoiceWatchers();
    watchServerMeta(server);
    watchMyMember(server);
    watchChannels(server);
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
    resetVoiceWatchers();
    unsubscribeVoiceSession();
    stopNotif?.();
  });

  function pick(id: string) {
    if (!id) return;
    onPickChannel(id);
    dispatch('pick', id);
    // Optimistically clear unread badge for picked channel
    if (unreadByChannel[id] && unreadByChannel[id] > 0) {
      unreadByChannel = { ...unreadByChannel, [id]: 0 };
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
  class="h-dvh w-64 bg-[#2b2d31] border-r border-black/40 text-white flex flex-col"
  aria-label="Channels"
>
  <div class="h-12 px-3 flex items-center justify-between border-b border-black/40">
    <div class="flex items-center gap-2 min-w-0">
      <div class="font-semibold truncate" title={serverName}>{serverName}</div>
      {#if isOwner}
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/30 text-emerald-300">owner</span>
      {:else if isAdminLike}
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-sky-600/30 text-sky-300">admin</span>
      {/if}
    </div>

    <div class="flex items-center gap-1">
      {#if isAdminLike}
        <button
          type="button"
          class="btn btn-ghost h-8 w-8 grid place-items-center rounded-lg hover:bg-white/10"
          title="Server settings"
          aria-label="Server settings"
          on:click={openServerSettings}
        >
          <i class="bx bx-cog text-[16px]" aria-hidden="true"></i>
        </button>
      {/if}
      <button
        type="button"
        class="btn btn-ghost h-8 w-8 grid place-items-center rounded-lg hover:bg-white/10"
        title="Create channel"
        aria-label="Create channel"
        on:click={() => (showCreate = true)}
      >
        <i class="bx bx-plus" aria-hidden="true"></i>
      </button>
    </div>
  </div>

  <div class="p-3 space-y-4 overflow-y-auto">
    {#if activeVoice && computedServerId === activeVoice.serverId}
      <!-- Desktop-only mini voice panel -->
      <div class="hidden md:block">
        <VoiceMiniPanel serverId={computedServerId} session={activeVoice} />
      </div>
    {/if}
    <div>
      <div class="text-[10px] uppercase tracking-wider text-white/50 px-2 mb-1">Text channels</div>
      <div class="space-y-1">
        {#each visibleChannels.filter((c) => c.type === 'text') as c (c.id)}
          <div
            class={`group w-full flex items-center gap-1 rounded-md ${(activeChannelId === c.id || isVoiceChannelActive(c.id)) ? 'bg-white/10' : 'hover:bg-white/10'}`}
          >
            <button
              type="button"
              class="flex-1 text-left px-3 py-1.5 rounded-md flex items-center gap-2"
              on:click={() => pick(c.id)}
              aria-label={`Open #${c.name} text channel`}
            >
              <i class="bx bx-hash" aria-hidden="true"></i>
              <span class="truncate">{c.name}</span>
              <span class="ml-auto flex items-center gap-1">
                {#if (unreadByChannel[c.id] ?? 0) > 0}
                  <span class="bg-red-600 text-white text-[10px] font-semibold rounded-full min-w-[16px] h-4 px-1 grid place-items-center">
                    {unreadByChannel[c.id] > 99 ? '99+' : unreadByChannel[c.id]}
                  </span>
                {/if}
                {#if Array.isArray((c as any).allowedRoleIds) && (c as any).allowedRoleIds.length}
                  <i class="bx bx-lock text-xs opacity-70" aria-hidden="true"></i>
                {/if}
              </span>
            </button>

            {#if canManageChannels}
              <div class="opacity-0 group-hover:opacity-100 transition pr-1 shrink-0 flex items-center gap-1">
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
        {/each}
        {#if !visibleChannels.some((c) => c.type === 'text')}
          <div class="text-xs text-white/50 px-3 py-2">No accessible text channels.</div>
        {/if}
      </div>
    </div>

    <div>
      <div class="text-[10px] uppercase tracking-wider text-white/50 px-2 mb-1">Voice channels</div>
      <div class="space-y-1">
        {#each visibleChannels.filter((c) => c.type === 'voice') as c (c.id)}
          <div
            class={`group w-full rounded-md transition ${(activeChannelId === c.id || isVoiceChannelActive(c.id)) ? 'bg-white/10' : 'hover:bg-white/5'}`}
          >
            <div class="flex items-center gap-1 px-1">
              <button
                type="button"
                class="flex-1 px-3 py-1.5 text-left flex items-center gap-2"
                on:click={() => pick(c.id)}
                aria-label={`Open ${c.name} voice channel`}
              >
                <i class="bx bx-headphone" aria-hidden="true"></i>
                <span class="truncate">{c.name}</span>
                <span class="ml-auto flex items-center gap-2">
                  {#if (voicePresence[c.id]?.length ?? 0) > 0}
                    <span class="rounded bg-white/10 px-1.5 py-[1px] text-[10px] uppercase tracking-wide text-white/70">
                      {voicePresence[c.id].length}
                    </span>
                  {/if}
                  {#if Array.isArray((c as any).allowedRoleIds) && (c as any).allowedRoleIds.length}
                    <i class="bx bx-lock text-xs opacity-70" aria-hidden="true"></i>
                  {/if}
                </span>
              </button>

              {#if canManageChannels}
                <div class="opacity-0 group-hover:opacity-100 transition pr-1 shrink-0 flex items-center gap-1">
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
              <div class="px-3 pb-2 text-[11px] text-white/60">
                <div class="flex items-center gap-2">
                  <div class="flex items-center -space-x-2">
                    {#each voicePresence[c.id].slice(0, 4) as member (member.uid)}
                      <div class="relative h-6 w-6 overflow-hidden rounded-full border border-black/40 bg-white/10">
                        {#if member.photoURL}
                          <img
                            src={member.photoURL}
                            alt={member.displayName}
                            class="h-full w-full object-cover"
                            loading="lazy"
                          />
                        {:else}
                          <div class="grid h-full w-full place-items-center text-[10px] font-semibold text-white">
                            {voiceInitial(member.displayName)}
                          </div>
                        {/if}
                        {#if member.hasVideo === false}
                          <i class="bx bx-video-off absolute -top-0.5 -left-0.5 text-[11px] text-white/80 drop-shadow"></i>
                        {/if}
                        {#if member.hasAudio === false}
                          <i class="bx bx-microphone-off absolute -bottom-0.5 -right-0.5 text-[11px] text-red-400 drop-shadow"></i>
                        {/if}
                      </div>
                    {/each}
                    {#if voicePresence[c.id].length > 4}
                      <div class="grid h-6 w-6 place-items-center rounded-full border border-dashed border-white/20 text-[10px] text-white/70">
                        +{voicePresence[c.id].length - 4}
                      </div>
                    {/if}
                  </div>
                  <span class="ml-auto text-[10px] uppercase tracking-wide text-white/40">
                    {voicePresence[c.id].length} online
                  </span>
                </div>
              </div>
            {/if}
          </div>
        {/each}
        {#if !visibleChannels.some((c) => c.type === 'voice')}
          <div class="text-xs text-white/50 px-3 py-2">No accessible voice channels.</div>
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
