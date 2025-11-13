<script lang="ts">
  import { run } from 'svelte/legacy';

  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { getDb } from '$lib/firebase';
  import { user } from '$lib/stores/user';
  import ChannelCreateModal from '$lib/components/servers/ChannelCreateModal.svelte';
  import VoiceMiniPanel from '$lib/components/voice/VoiceMiniPanel.svelte';
  import { appendVoiceDebugEvent, removeVoiceDebugSection, setVoiceDebugSection } from '$lib/utils/voiceDebugContext';
  import { resolveProfilePhotoURL } from '$lib/utils/profile';
  import { voiceSession } from '$lib/stores/voice';
  import type { VoiceSession } from '$lib/stores/voice';
  import { subscribeUnreadForServer, type UnreadMap } from '$lib/firebase/unread';
  import { notifications } from '$lib/stores/notifications';

  import {
    collection,
    onSnapshot,
    orderBy,
    query,
    doc,
    type Unsubscribe,
    setDoc,
    writeBatch
  } from 'firebase/firestore';

  import type { ChannelThread } from '$lib/firestore/threads';

  interface Props {
    serverId: string | undefined;
    activeChannelId?: string | null;
    onPickChannel?: (id: string) => void;
    threads?: Array<ChannelThread & { unread?: boolean }>;
    activeThreadId?: string | null;
    onPickThread?: (thread: { id: string; parentChannelId: string }) => void;
  }

  let {
    serverId,
    activeChannelId = null,
    onPickChannel = () => {},
    threads = [],
    activeThreadId = null,
    onPickThread = () => {}
  }: Props = $props();
  const dispatch = createEventDispatcher<{ pick: string }>();


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

  type PermissionFlags = {
    manageServer?: boolean;
    manageRoles?: boolean;
    manageChannels?: boolean;
    reorderChannels?: boolean;
  };

  let channels: Chan[] = $state([]);
  let serverName = $state('Server');
  let showCreate = $state(false);
  let myChannelOrder: string[] = [];
  let reorderMode: 'none' | 'default' | 'personal' = $state('none');
  let workingOrder: string[] = $state([]);
  let savingOrder = $state(false);
  let orderError: string | null = $state(null);
  let draggingChannelId: string | null = $state(null);
  let draggingChannelType: Chan['type'] | null = $state(null);
  let dragOverChannelId: string | null = $state(null);
  let dragOverAfter = $state(false);

  let voicePresence: Record<string, VoiceParticipant[]> = $state({});
  const voiceUnsubs = new Map<string, Unsubscribe>();
  let activeVoice: VoiceSession | null = $state(null);
  const unsubscribeVoiceSession = voiceSession.subscribe((value) => {
    activeVoice = value;
  });




  let unsubChannels: Unsubscribe | null = null;
  let unsubServerMeta: Unsubscribe | null = null;
  let unsubMyMember: Unsubscribe | null = null;
  let unsubUnread: Unsubscribe | null = null;
  let unsubPersonalOrder: Unsubscribe | null = null;

  let ownerId: string | null = null;
  let myRole: 'owner' | 'admin' | 'member' | null = $state(null);
  let myPerms = $state<PermissionFlags | null>(null);
  let myRoleIds: string[] = [];
  let lastServerId: string | null = $state(null);
  let mentionHighlights: Set<string> = $state(new Set());

  // Basic notification prefs (subset of full settings)
  let notifDesktopEnabled = $state(false);
  let notifAllMessages = $state(false);
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
    if (voiceUnsubs.size) {
      appendVoiceDebugEvent('sidebar', 'resetVoiceWatchers', {
        serverId: computedServerId ?? null,
        watcherCount: voiceUnsubs.size
      });
    }
    voiceUnsubs.forEach((unsub) => unsub());
    voiceUnsubs.clear();
    voicePresence = {};
  }

  function summarizeVoicePresence(
    state: Record<string, VoiceParticipant[]>
  ): Record<string, unknown> {
    const summary: Record<string, unknown> = {};
    Object.entries(state).forEach(([channel, list]) => {
      summary[channel] = {
        count: list.length,
        participants: list.slice(0, 8).map((member) => ({
          uid: member.uid,
          hasAudio: member.hasAudio ?? true,
          hasVideo: member.hasVideo ?? false
        }))
      };
    });
    return summary;
  }

  function syncVoicePresenceWatchers(list: Chan[]) {
    if (!computedServerId) {
      resetVoiceWatchers();
      return;
    }

    const voiceChannels = list.filter((c) => c.type === 'voice');
    const voiceIds = new Set(voiceChannels.map((c) => c.id));

    if (browser) {
      appendVoiceDebugEvent('sidebar', 'syncVoicePresenceWatchers', {
        serverId: computedServerId ?? null,
        voiceChannelCount: voiceChannels.length
      });
    }

    voiceUnsubs.forEach((unsub, channelId) => {
      if (!voiceIds.has(channelId)) {
        if (browser) {
          appendVoiceDebugEvent('sidebar', 'voicePresenceWatcherRemoved', {
            serverId: computedServerId ?? null,
            channelId
          });
        }
        unsub();
        voiceUnsubs.delete(channelId);
        voicePresence = { ...voicePresence, [channelId]: [] };
      }
    });

    list.forEach((chan) => {
      if (chan.type !== 'voice' || voiceUnsubs.has(chan.id)) return;

      if (browser) {
        appendVoiceDebugEvent('sidebar', 'voicePresenceWatcherAdded', {
          serverId: computedServerId ?? null,
          channelId: chan.id,
          channelName: chan.name ?? null
        });
      }

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
                photoURL: resolveProfilePhotoURL(data),
                hasAudio: data.hasAudio ?? false,
                hasVideo: data.hasVideo ?? false,
                status
              } as VoiceParticipant;
            })
            .filter((p) => p.status !== 'left');

          voicePresence = { ...voicePresence, [chan.id]: participants };
          if (browser) {
            appendVoiceDebugEvent('sidebar', 'voicePresenceUpdate', {
              serverId: computedServerId ?? null,
              channelId: chan.id,
              count: participants.length
            });
          }
        },
        () => {
          voicePresence = { ...voicePresence, [chan.id]: [] };
          if (browser) {
            appendVoiceDebugEvent('sidebar', 'voicePresenceWatcherError', {
              serverId: computedServerId ?? null,
              channelId: chan.id
            });
          }
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

  function resetDragState() {
    draggingChannelId = null;
    draggingChannelType = null;
    dragOverChannelId = null;
    dragOverAfter = false;
  }

  function startChannelDrag(event: DragEvent, id: string, type: Chan['type']) {
    if (reorderMode === 'none' || savingOrder) {
      event.preventDefault();
      return;
    }
    draggingChannelId = id;
    draggingChannelType = type;
    dragOverChannelId = null;
    dragOverAfter = false;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    }
  }

  function handleChannelDragOver(event: DragEvent, targetId: string, type: Chan['type']) {
    if (reorderMode === 'none' || !draggingChannelId || savingOrder) return;
    if (draggingChannelId === targetId) {
      event.preventDefault();
      return;
    }
    if (draggingChannelType && draggingChannelType !== type) return;
    const sourceChan = channelById(draggingChannelId);
    const targetChan = channelById(targetId);
    if (!sourceChan || !targetChan) return;
    if (sourceChan.type !== type || targetChan.type !== type) return;
    if (reorderMode !== 'default' && (!canSeeChannel(sourceChan) || !canSeeChannel(targetChan))) return;

    const element = event.currentTarget as HTMLElement;
    const rect = element.getBoundingClientRect();
    const after = event.clientY - rect.top > rect.height / 2;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    dragOverChannelId = targetId;
    dragOverAfter = after;
  }

  function reorderChannelsByDrag(sourceId: string, targetId: string, type: Chan['type'], placeAfter: boolean) {
    if (reorderMode === 'none' || !workingOrder.length) return;
    if (sourceId === targetId) return;
    const scoped = workingOrder
      .map((cid, index) => ({ cid, index }))
      .filter(({ cid }) => {
        const chan = channelById(cid);
        if (!chan || chan.type !== type) return false;
        if (reorderMode === 'default') return true;
        return canSeeChannel(chan);
      });

    const sourceEntry = scoped.find((entry) => entry.cid === sourceId);
    const targetEntry = scoped.find((entry) => entry.cid === targetId);
    if (!sourceEntry || !targetEntry) return;

    const result = [...workingOrder];
    result.splice(sourceEntry.index, 1);

    let targetIndex = targetEntry.index;
    if (sourceEntry.index < targetEntry.index) {
      targetIndex -= 1;
    }
    let insertIndex = placeAfter ? targetIndex + 1 : targetIndex;
    insertIndex = Math.max(0, Math.min(result.length, insertIndex));
    result.splice(insertIndex, 0, sourceEntry.cid);
    workingOrder = result;
  }

  function handleChannelDrop(event: DragEvent, targetId: string, type: Chan['type']) {
    if (reorderMode === 'none' || !draggingChannelId || savingOrder) {
      resetDragState();
      return;
    }
    if (draggingChannelType && draggingChannelType !== type) {
      resetDragState();
      return;
    }
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    const rect = element.getBoundingClientRect();
    const after = event.clientY - rect.top > rect.height / 2;
    reorderChannelsByDrag(draggingChannelId, targetId, type, after);
    resetDragState();
  }

  function endChannelDrag() {
    resetDragState();
  }


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

  let displayOrderIds: string[] = $state([]);
  let orderedChannels: Chan[] = $state([]);
  let visibleChannels: Chan[] = $state([]);



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




  onDestroy(() => {
    unsubChannels?.();
    unsubServerMeta?.();
    unsubMyMember?.();
    unsubUnread?.();
    unsubPersonalOrder?.();
    resetVoiceWatchers();
    unsubscribeVoiceSession();
    stopNotif?.();
    removeVoiceDebugSection('serverSidebar.channels');
    removeVoiceDebugSection('serverSidebar.voicePresence');
    removeVoiceDebugSection('serverSidebar.voiceSession');
  });

  function pick(id: string) {
    if (reorderMode !== 'none') return;
    if (!id) return;
    const chan = channelById(id);
    if (chan?.type === 'voice') {
      if (browser) {
        appendVoiceDebugEvent('sidebar', 'pick voice channel', {
          serverId: computedServerId ?? null,
          channelId: id,
          channelName: chan.name ?? null
        });
      }

      const me = get(user);
      if (me?.uid) {
        const nameCandidates = [
          (me as any)?.nickname,
          (me as any)?.displayName,
          (me as any)?.name,
          (me as any)?.profile?.displayName,
          (me as any)?.profile?.name,
          (me as any)?.email
        ];
        let displayName = 'You';
        for (const candidate of nameCandidates) {
          if (typeof candidate === 'string') {
            const trimmed = candidate.trim();
            if (trimmed.length) {
              displayName = trimmed;
              break;
            }
          }
        }

        const photoURL =
          resolveProfilePhotoURL(me, (me as any)?.photoURL ?? (me as any)?.authPhotoURL ?? null) ?? null;
        const existing = voicePresence[id] ?? [];
        const base: VoiceParticipant = {
          uid: me.uid,
          displayName,
          photoURL,
          hasAudio: true,
          hasVideo: false,
          status: 'active'
        };
        const index = existing.findIndex((p) => p.uid === me.uid);
        const nextPresence =
          index === -1 ? [...existing, base] : existing.map((p, idx) => (idx === index ? { ...p, ...base } : p));
        voicePresence = { ...voicePresence, [id]: nextPresence };
      }
    }
    onPickChannel(id);
    dispatch('pick', id);
    // Optimistically clear unread badge for picked channel
    if (unreadByChannel[id] && unreadByChannel[id] > 0) {
      unreadByChannel = { ...unreadByChannel, [id]: 0 };
    }
  }

  function beginReorder() {
    orderError = null;
    resetDragState();
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
    resetDragState();
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
      resetDragState();
      savingOrder = false;
    }
  }

  function openServerSettings() {
    if (!computedServerId || !isAdminLike) return;
    goto(`/servers/${computedServerId}/settings`);
  }

  // Unread state map
  let unreadByChannel: Record<string, number> = $state({});
  let prevUnread: Record<string, number> = $state({});
  let unreadReady = $state(false);

  let computedServerId =
    $derived(serverId ??
    $page.params.serverID ??
    ($page.params as any).serverId ??
    null);
  run(() => {
    if (browser) {
      setVoiceDebugSection('serverSidebar.channels', {
        serverId: computedServerId ?? null,
        totalChannels: channels.length,
        voiceChannels: channels
          .filter((c) => c.type === 'voice')
          .map((c) => ({
            id: c.id,
            name: c.name,
            position: typeof c.position === 'number' ? c.position : null,
            isPrivate: !!c.isPrivate
          })),
        reorderMode,
        activeChannelId
      });
    }
  });
  run(() => {
    if (browser) {
      setVoiceDebugSection('serverSidebar.voicePresence', {
        serverId: computedServerId ?? null,
        watcherCount: voiceUnsubs.size,
        presence: summarizeVoicePresence(voicePresence)
      });
    }
  });
  run(() => {
    if (browser) {
      setVoiceDebugSection('serverSidebar.voiceSession', {
        activeVoice: activeVoice
          ? {
              serverId: activeVoice.serverId,
              channelId: activeVoice.channelId,
              channelName: activeVoice.channelName
            }
          : null,
        computedServerId
      });
    }
  });
  run(() => {
    mentionHighlights = new Set(
      ($notifications ?? [])
        .filter(
          (item) =>
            item.kind === 'channel' &&
            item.isMention &&
            item.serverId === computedServerId &&
            typeof item.channelId === 'string'
        )
        .map((item) => item.channelId as string)
    );
  });
  let isOwner = $derived(computeIsOwner());
  let isAdminLike =
    $derived(isOwner ||
    myRole === 'admin' ||
    !!(myPerms?.manageServer || myPerms?.manageRoles));
  let canManageChannels =
    $derived(isOwner ||
    !!myPerms?.manageChannels ||
    !!myPerms?.manageServer);
  let canReorderPersonal = $derived(!!myPerms?.reorderChannels);
run(() => {
    if (reorderMode === 'default') {
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
  });
  run(() => {
    displayOrderIds = getDisplayOrderIds();
  });
  run(() => {
    orderedChannels = applyOrder(displayOrderIds, channels);
  });
  run(() => {
    visibleChannels = orderedChannels.filter(canSeeChannel);
  });
  run(() => {
    if (computedServerId && computedServerId !== lastServerId) {
      lastServerId = computedServerId;
      subscribeAll(computedServerId);
    }
  });
  run(() => {
    if (computedServerId && $user?.uid) {
      watchMyMember(computedServerId);
    }
  });
  run(() => {
    if (browser && window.matchMedia('(min-width: 768px)').matches && computedServerId) {
      if (activeChannelId && !visibleChannels.some((c) => c.id === activeChannelId)) {
        const fallback = visibleChannels[0];
        if (fallback) pick(fallback.id);
      } else if (!activeChannelId && visibleChannels.length) {
        pick(visibleChannels[0].id);
      }
    }
  });
  run(() => {
    if (browser && unreadReady && document.visibilityState === 'hidden' && notifDesktopEnabled && notifAllMessages) {
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
  });
</script>

<aside
  class="h-dvh w-80 shrink-0 sidebar-surface flex flex-col border-r border-subtle text-primary"
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

    <div class="flex items-center gap-1.5 pr-1">
      {#if canManageChannels || canReorderPersonal}
        {#if reorderMode === 'none'}
          <button
            type="button"
            class="btn btn-ghost h-8 px-2 "
            title="Reorder channels"
            aria-label="Reorder channels"
            onclick={beginReorder}
          >
            <i class="bx bx-sort-alt-2 text-lg" aria-hidden="true"></i>
          </button>
        {:else}
          <button
            type="button"
            class="btn btn-primary h-8 px-3 "
            onclick={saveReorder}
            disabled={savingOrder}
          >
            {savingOrder ? 'SavingÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦' : 'Save'}
          </button>
          <button
            type="button"
            class="btn btn-ghost h-8 px-2 "
            onclick={cancelReorder}
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
          onclick={openServerSettings}
        >
          <i class="bx bx-cog text-[16px]" aria-hidden="true"></i>
        </button>
      {/if}
      <button
        type="button"
        class="btn btn-ghost h-8 w-8 grid place-items-center "
        title="Create channel"
        aria-label="Create channel"
        onclick={() => (showCreate = true)}
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
    <div class="space-y-1">
        {#each visibleChannels.filter((c) => c.type === 'text') as c (c.id)}
        <div
          class={`channel-row ${(activeChannelId === c.id || isVoiceChannelActive(c.id)) ? 'channel-row--active' : ''} ${mentionHighlights.has(c.id) ? 'channel-row--mention' : ''} ${reorderMode !== 'none' && draggingChannelId === c.id ? 'channel-row--dragging' : ''} ${reorderMode !== 'none' && dragOverChannelId === c.id ? (dragOverAfter ? 'channel-row--drop-after' : 'channel-row--drop-before') : ''}`}
          role="listitem"
          draggable={reorderMode !== 'none' && !savingOrder}
          ondragstart={(event) => startChannelDrag(event, c.id, 'text')}
          ondragend={endChannelDrag}
          ondragover={(event) => handleChannelDragOver(event, c.id, 'text')}
          ondrop={(event) => handleChannelDrop(event, c.id, 'text')}
        >
            {#if reorderMode !== 'none'}
              <div class="channel-reorder-controls">
                <button
                  type="button"
                  class="channel-reorder-button"
                  title="Move up"
                  aria-label="Move channel up"
                  onclick={() => moveChannelInWorkingOrder(c.id, 'text', -1)}
                  disabled={!canMoveChannel(c.id, 'text', -1) || savingOrder}
                >
                  <i class="bx bx-chevron-up text-sm" aria-hidden="true"></i>
                </button>
                <button
                  type="button"
                  class="channel-reorder-button"
                  title="Move down"
                  aria-label="Move channel down"
                  onclick={() => moveChannelInWorkingOrder(c.id, 'text', 1)}
                  disabled={!canMoveChannel(c.id, 'text', 1) || savingOrder}
                >
                  <i class="bx bx-chevron-down text-sm" aria-hidden="true"></i>
                </button>
              </div>
            {/if}

            <button
              type="button"
              class="channel-row__button"
              onclick={() => pick(c.id)}
              aria-label={`Open #${c.name} text channel`}
              disabled={reorderMode !== 'none'}
            >
              <i class="bx bx-hash" aria-hidden="true"></i>
              <span class="truncate">{c.name}</span>
              <span class="channel-row__meta ml-auto">
                {#if mentionHighlights.has(c.id)}
                  <span class="channel-mention-pill" title="You were mentioned">@</span>
                {/if}
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
          </div>
        {/each}
        {#if !visibleChannels.some((c) => c.type === 'text')}
          <div class="text-xs text-soft px-3 py-2">No accessible text channels.</div>
        {/if}
    </div>

    <div class="space-y-1">
        {#each visibleChannels.filter((c) => c.type === 'voice') as c (c.id)}
        <div
          class={`channel-row ${(activeChannelId === c.id || isVoiceChannelActive(c.id)) ? 'channel-row--active' : ''} ${reorderMode !== 'none' && draggingChannelId === c.id ? 'channel-row--dragging' : ''} ${reorderMode !== 'none' && dragOverChannelId === c.id ? (dragOverAfter ? 'channel-row--drop-after' : 'channel-row--drop-before') : ''}`}
          role="listitem"
          draggable={reorderMode !== 'none' && !savingOrder}
          ondragstart={(event) => startChannelDrag(event, c.id, 'voice')}
          ondragend={endChannelDrag}
          ondragover={(event) => handleChannelDragOver(event, c.id, 'voice')}
          ondrop={(event) => handleChannelDrop(event, c.id, 'voice')}
        >
            {#if reorderMode !== 'none'}
              <div class="channel-reorder-controls">
                <button
                  type="button"
                  class="channel-reorder-button"
                  title="Move up"
                  aria-label="Move voice channel up"
                  onclick={() => moveChannelInWorkingOrder(c.id, 'voice', -1)}
                  disabled={!canMoveChannel(c.id, 'voice', -1) || savingOrder}
                >
                  <i class="bx bx-chevron-up text-sm" aria-hidden="true"></i>
                </button>
                <button
                  type="button"
                  class="channel-reorder-button"
                  title="Move down"
                  aria-label="Move voice channel down"
                  onclick={() => moveChannelInWorkingOrder(c.id, 'voice', 1)}
                  disabled={!canMoveChannel(c.id, 'voice', 1) || savingOrder}
                >
                  <i class="bx bx-chevron-down text-sm" aria-hidden="true"></i>
                </button>
              </div>
            {/if}

            <button
              type="button"
              class="channel-row__button"
              onclick={() => pick(c.id)}
              aria-label={`Open ${c.name} voice channel`}
              disabled={reorderMode !== 'none'}
            >
              <i class="bx bx-headphone" aria-hidden="true"></i>
              <span class="truncate">{c.name}</span>
              <span class="channel-row__meta ml-auto">
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
      </div>

      {@const channelThreadList = (threads ?? []).filter((thread) => thread.parentChannelId === c.id && thread.status !== 'archived')}
      {#if channelThreadList.length}
        <ul class="thread-list">
          {#each channelThreadList as thread (thread.id)}
            <li>
              <button
                type="button"
                class={`thread-row ${thread.id === activeThreadId ? 'is-active' : ''}`}
                onclick={(event) => {
                  event.stopPropagation();
                  onPickThread({
                    id: thread.id,
                    parentChannelId: thread.parentChannelId ?? c.id
                  });
                }}
              >
                <div class="thread-row__info">
                  <i class="bx bx-message-square-dots" aria-hidden="true"></i>
                  <span class="thread-row__name">{thread.name || 'Thread'}</span>
                </div>
                <div class="thread-row__meta">
                  {#if thread.unread}
                    <span class="thread-row__dot" aria-hidden="true"></span>
                  {/if}
                  {#if thread.messageCount}
                    <span class="thread-row__count">{thread.messageCount}</span>
                  {/if}
                </div>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

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

    <ChannelCreateModal
      bind:open={showCreate}
      serverId={computedServerId}
      onClose={() => (showCreate = false)}
      onCreated={(id) => pick(id)}
    />
  </div>
</aside>

<style>
  .channel-row {
    position: relative;
  }

  .channel-row[draggable='true'] {
    cursor: grab;
  }

  .channel-row[draggable='true']:active {
    cursor: grabbing;
  }

  .channel-row--dragging {
    opacity: 0.45;
  }

  .channel-row--drop-before::before,
  .channel-row--drop-after::after {
    content: '';
    position: absolute;
    left: 0.75rem;
    right: 0.75rem;
    height: 2px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent) 85%, transparent);
    pointer-events: none;
  }

  .channel-row--drop-before::before {
    top: 0;
    transform: translateY(-50%);
  }

  .channel-row--drop-after::after {
    bottom: 0;
    transform: translateY(50%);
  }

  .channel-row--mention .channel-row__button {
    border-left: 3px solid color-mix(in srgb, var(--color-accent) 70%, transparent);
    padding-left: 0.9rem;
  }

  .channel-row--mention .channel-row__button:hover {
    border-left-color: var(--color-accent);
  }

  .channel-mention-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent) 22%, transparent);
    color: var(--color-accent);
    font-size: 0.68rem;
    font-weight: 700;
  }

  .thread-list {
    list-style: none;
    margin: 0.2rem 0 0.35rem 2rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .thread-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    background: color-mix(in srgb, var(--color-panel) 75%, transparent);
    border-radius: 0.6rem;
    border: 1px solid transparent;
    padding: 0.35rem 0.45rem;
    color: var(--text-70);
    font-size: 0.8rem;
  }

  .thread-row:hover,
  .thread-row.is-active {
    border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
    color: var(--color-text-primary);
  }

  .thread-row__info {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .thread-row__info i {
    font-size: 1rem;
    opacity: 0.65;
  }

  .thread-row__meta {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .thread-row__dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: var(--color-accent);
    display: inline-block;
  }

  .thread-row__count {
    font-size: 0.7rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-accent);
  }

</style>
