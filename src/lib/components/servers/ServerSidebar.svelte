<script lang="ts">
  import { run } from 'svelte/legacy';

  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { openServerSettings } from '$lib/stores/serverSettingsUI';
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
import { notifications, channelIndicators } from '$lib/stores/notifications';

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
    threadUnreadByChannel?: Record<string, boolean>;
  }

  let {
    serverId,
    activeChannelId = null,
    onPickChannel = () => {},
    threads = [],
    activeThreadId = null,
    onPickThread = () => {},
    threadUnreadByChannel = {}
  }: Props = $props();
  const dispatch = createEventDispatcher<{ pick: string }>();


  type Chan = {
    id: string;
    name: string;
    type: 'text' | 'voice';
    position?: number;
    isPrivate?: boolean;
    allowedRoleIds?: string[];
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
  let channelDragCandidateId: string | null = null;
  let channelDragCandidateType: Chan['type'] | null = null;
  let channelDragPointerId: number | null = null;
  let channelDragStartY = 0;
  let channelDragMoved = false;
  const CHANNEL_DRAG_THRESHOLD_PX = 6;
  const channelRowRefs = new Map<string, HTMLElement>();
  let suppressChannelClick = false;
  let serverIcon: string | null = $state(null);

  let voicePresence: Record<string, VoiceParticipant[]> = $state({});
  const voiceUnsubs = new Map<string, Unsubscribe>();
  let activeVoice: VoiceSession | null = $state(null);
  const unsubscribeVoiceSession = voiceSession.subscribe((value) => {
    activeVoice = value;
  });




  let unsubChannels: Unsubscribe | null = null;
  let unsubServerMeta: Unsubscribe | null = null;
  let unsubMyMember: Unsubscribe | null = null;
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

  function reorderChannelsByDrag(sourceId: string, targetId: string, type: Chan['type'], placeAfter: boolean) {
    if (reorderMode === 'none' || !workingOrder.length) return;
    if (sourceId === targetId) return;
    const scoped = workingOrder
      .map((cid, index) => ({ cid, index }))
      .filter(({ cid }) => {
        const chan = channelById(cid);
        if (!chan) return false;
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

  function channelRowRefAction(node: HTMLElement, id: string) {
    channelRowRefs.set(id, node);
    return {
      update(nextId: string) {
        if (nextId === id) return;
        channelRowRefs.delete(id);
        id = nextId;
        channelRowRefs.set(id, node);
      },
      destroy() {
        channelRowRefs.delete(id);
      }
    };
  }

  function resetDragState() {
    draggingChannelId = null;
    draggingChannelType = null;
    dragOverChannelId = null;
    dragOverAfter = false;
    channelDragCandidateId = null;
    channelDragCandidateType = null;
    channelDragPointerId = null;
    channelDragStartY = 0;
    channelDragMoved = false;
    suppressChannelClick = false;
  }

  function ensureWorkingOrder(type: Chan['type']): boolean {
    if (reorderMode !== 'none' && workingOrder.length) return true;
    if (canManageChannels) {
      reorderMode = 'default';
      workingOrder = defaultOrderIds();
      return true;
    }
    if (canReorderPersonal) {
      reorderMode = 'personal';
      workingOrder = personalOrderIds();
      return true;
    }
    return false;
  }

  function startChannelPointerDrag(event: PointerEvent, id: string, type: Chan['type']) {
    if (savingOrder) return;
    if (!canManageChannels && !canReorderPersonal) return;
    orderError = null;
    suppressChannelClick = false;
    channelDragCandidateId = id;
    channelDragCandidateType = type;
    channelDragPointerId = event.pointerId;
    channelDragStartY = event.clientY;
    channelDragMoved = false;
  }

  function updateChannelOrderFromPointer(clientY: number, sourceId: string, type: Chan['type']) {
    if (!ensureWorkingOrder(type)) return;
    const scopedIds = workingOrder.filter((cid) => {
      const chan = channelById(cid);
      if (!chan) return false;
      if (reorderMode === 'default') return true;
      return canSeeChannel(chan);
    });
    if (!scopedIds.length) return;
    let targetId = scopedIds[scopedIds.length - 1];
    let placeAfter =
      clientY > (channelRowRefs.get(targetId)?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY);
    for (const id of scopedIds) {
      const el = channelRowRefs.get(id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (clientY < mid) {
        targetId = id;
        placeAfter = false;
        break;
      }
    }
    if (sourceId === targetId && !placeAfter) return;
    dragOverChannelId = targetId;
    dragOverAfter = placeAfter;
    reorderChannelsByDrag(sourceId, targetId, type, placeAfter);
  }

  function handleChannelPointerMove(event: PointerEvent) {
    if (reorderMode === 'none' && !channelDragCandidateId) return;
    if (savingOrder) return;
    if (channelDragPointerId !== event.pointerId) return;
    const delta = Math.abs(event.clientY - channelDragStartY);
    if (!draggingChannelId && channelDragCandidateId && delta >= CHANNEL_DRAG_THRESHOLD_PX) {
      if (!ensureWorkingOrder(channelDragCandidateType ?? channelTypeById(channelDragCandidateId) ?? 'text')) {
        resetDragState();
        return;
      }
      draggingChannelId = channelDragCandidateId;
      draggingChannelType = channelDragCandidateType ?? channelTypeById(channelDragCandidateId);
      (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    }

    if (!draggingChannelId || !draggingChannelType || reorderMode === 'none') return;
    event.preventDefault();
    channelDragMoved = true;
    suppressChannelClick = true;
    updateChannelOrderFromPointer(event.clientY, draggingChannelId, draggingChannelType);
  }

  async function handleChannelPointerUp(event: PointerEvent) {
    if (channelDragPointerId !== event.pointerId) return;
    channelDragPointerId = null;
    channelDragCandidateId = null;
    channelDragCandidateType = null;
    dragOverChannelId = null;
    dragOverAfter = false;
    if (draggingChannelId && channelDragMoved) {
      event.preventDefault();
      await saveReorder();
    }
    draggingChannelId = null;
    draggingChannelType = null;
    suppressChannelClick = false;
    channelDragMoved = false;
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
          serverIcon = null;
          return;
        }
        const data = snap.data() as any;
        serverName = data?.name ?? 'Server';
        serverIcon = typeof data?.icon === 'string' && data.icon.length ? data.icon : null;
        ownerId = deriveOwnerId(data);
        if (computeIsOwner()) {
          myRole = 'owner';
        }
      },
      () => {
        serverName = 'Server';
        serverIcon = null;
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
  }




  onDestroy(() => {
    unsubChannels?.();
    unsubServerMeta?.();
    unsubMyMember?.();
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
    const entry = unreadByChannel[id];
    if (entry && (entry.high > 0 || entry.low > 0)) {
      unreadByChannel = { ...unreadByChannel, [id]: { high: 0, low: 0 } };
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

  function openServerSettingsOverlay() {
    if (!computedServerId || !isAdminLike) return;
    openServerSettings({
      serverId: computedServerId,
      source: 'trigger'
    });
  }

  // Unread state map
  type ChannelIndicator = { high: number; low: number };
  let unreadByChannel: Record<string, ChannelIndicator> = $state({});
  let prevUnread: Record<string, number> = $state({});
  let unreadReady = $state(false);

  let computedServerId =
    $derived(serverId ??
    $page.params.serverID ??
    ($page.params as any).serverId ??
    null);
  run(() => {
    const indicators = $channelIndicators ?? {};
    const serverKey = computedServerId ?? null;
    unreadByChannel = serverKey ? indicators[serverKey] ?? {} : {};
    if (!unreadReady) unreadReady = true;
  });
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
    const totals: Record<string, number> = {};
    for (const id in unreadByChannel) {
      const entry = unreadByChannel[id];
      totals[id] = (entry?.high ?? 0) + (entry?.low ?? 0);
    }
    if (browser && unreadReady && document.visibilityState === 'hidden' && notifDesktopEnabled && notifAllMessages) {
      try {
        for (const id in totals) {
          const curr = totals[id] ?? 0;
          const prev = prevUnread[id] ?? 0;
          if (curr > prev && id !== activeChannelId) {
            const chan = channels.find((c) => c.id === id);
            const title = chan?.name ? `#${chan.name}` : 'New message';
            new Notification(title, { body: `New messages in ${serverName}`, tag: `ch-${id}` });
          }
        }
      } catch {}
    }
    prevUnread = totals;
  });
</script>

<aside
  class="server-sidebar h-dvh w-80 shrink-0 sidebar-surface flex flex-col border-r border-subtle text-primary"
  aria-label="Channels"
>
  <div class="server-sidebar__header h-12 px-3 flex items-center justify-between border-b border-subtle">
    <button
      type="button"
      class="server-header__button"
      onclick={openServerSettingsOverlay}
      aria-label="Open server settings"
      disabled={!isAdminLike}
    >
      <span class="server-avatar">
        {#if serverIcon}
          <img src={serverIcon} alt={serverName} class="h-full w-full object-cover" />
        {:else}
          <span class="server-avatar__initial">{voiceInitial(serverName)}</span>
        {/if}
      </span>
      <span class="server-header__label">
        <span class="server-label-row">
          <span class="server-name truncate" title={serverName}>{serverName}</span>
          {#if isOwner}
            <span class="badge-accent text-[10px] px-1.5 py-0.5">owner</span>
          {:else if isAdminLike}
            <span class="badge-accent text-[10px] px-1.5 py-0.5">admin</span>
          {/if}
        </span>
      </span>
    </button>
  </div>

  {#if orderError}
    <div class="px-3 pt-2 text-xs text-red-300">{orderError}</div>
  {/if}

  <div class="p-3 space-y-4 overflow-y-auto overflow-x-hidden">
    {#if activeVoice}
      <div class="hidden md:block">
        <VoiceMiniPanel serverId={computedServerId} session={activeVoice} />
      </div>
    {/if}
    <div class="channel-heading">Channels</div>
    <div class="channel-list space-y-1">
      {#each visibleChannels as c (c.id)}
        <div
          class={`channel-row ${(activeChannelId === c.id || isVoiceChannelActive(c.id)) ? 'channel-row--active' : ''} ${mentionHighlights.has(c.id) ? 'channel-row--mention' : ''} ${reorderMode !== 'none' && draggingChannelId === c.id ? 'channel-row--dragging' : ''} ${reorderMode !== 'none' && dragOverChannelId === c.id ? (dragOverAfter ? 'channel-row--drop-after' : 'channel-row--drop-before') : ''}`}
          role="listitem"
          draggable={false}
          use:channelRowRefAction={c.id}
          onpointerdown={(event) => startChannelPointerDrag(event, c.id, c.type)}
        >
          <button
            type="button"
            class="channel-row__button"
            onclick={() => pick(c.id)}
            aria-label={`Open #${c.name} text channel`}
            aria-current={activeChannelId === c.id || isVoiceChannelActive(c.id) ? 'page' : undefined}
            title={c.name}
          >
            {#if c.type === 'voice'}
              <i class="bx bx-headphone" aria-hidden="true"></i>
            {:else}
              <i class="bx bx-hash" aria-hidden="true"></i>
            {/if}
            <span class="channel-name truncate">{c.name}</span>
            <span class="channel-row__meta ml-auto">
              {#if threadUnreadByChannel?.[c.id]}
                <span class="channel-thread-unread-dot" aria-hidden="true"></span>
              {/if}
              {#if mentionHighlights.has(c.id)}
                <span class="channel-mention-pill" title="You were mentioned">@</span>
              {/if}
              {#if c.type === 'voice'}
                {#if (voicePresence[c.id]?.length ?? 0) > 0}
                  <span class="channel-voice-count">
                    {voicePresence[c.id].length}
                  </span>
                {/if}
              {:else}
                {#if (unreadByChannel[c.id]?.high ?? 0) > 0}
                  <span
                    class="channel-unread"
                    aria-label={`${unreadByChannel[c.id]?.high ?? 0} unread high priority messages`}
                  >
                    {(unreadByChannel[c.id]?.high ?? 0) > 99 ? '99+' : unreadByChannel[c.id]?.high}
                  </span>
                {:else if (unreadByChannel[c.id]?.low ?? 0) > 0}
                  <span class="channel-teal-dot" aria-hidden="true"></span>
                {/if}
              {/if}
              {#if Array.isArray((c as any).allowedRoleIds) && (c as any).allowedRoleIds.length}
                <i class="bx bx-lock text-xs opacity-70" title="Private channel" aria-hidden="true"></i>
              {/if}
            </span>
          </button>

          {#if c.type === 'voice'}
            {#if (voicePresence[c.id]?.length ?? 0) > 0}
              <div class="channel-voice-presence">
                {#each voicePresence[c.id].slice(0, 6) as member (member.uid)}
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
                {#if (voicePresence[c.id]?.length ?? 0) > 6}
                  <div class="channel-voice-more">
                    +{voicePresence[c.id].length - 6}
                  </div>
                {/if}
              </div>
            {/if}

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
          {/if}
        </div>
      {/each}

      {#if !visibleChannels.length}
        <div class="text-xs text-soft px-3 py-2">No accessible channels.</div>
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
  .server-sidebar__header {
    min-height: 3rem;
    height: 3rem;
    padding: 0.5rem 0.75rem;
    display: flex;
    align-items: center;
  }

  .server-header__button {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    width: 100%;
    padding: 0.4rem 0.55rem;
    border-radius: 0.9rem;
    border: 1px solid transparent;
    background: transparent;
    text-align: left;
    user-select: none;
  }

  .server-header__button:disabled {
    opacity: 1;
    cursor: default;
  }

  .server-avatar {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .server-avatar__initial {
    font-weight: 700;
    font-size: 1rem;
  }

  .server-header__label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .server-label-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
  }

  .server-name {
    font-weight: 700;
    font-size: 1.05rem;
  }

  .channel-heading {
    font-weight: 800;
    font-size: 0.95rem;
    padding-left: 0.25rem;
  }

  .channel-list {
    user-select: none;
  }

  .channel-row {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
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

  .channel-row__button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.55rem;
    text-align: left;
    user-select: none;
    background: transparent;
    border: 1px solid transparent;
    box-shadow: none;
  }

  .channel-row__button:hover,
  .channel-row__button:focus,
  .channel-row__button:active {
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }

  .channel-row--active .channel-row__button {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    border-radius: 0.75rem;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 25%, transparent);
    color: inherit;
  }

  .channel-row--active .channel-row__button:hover,
  .channel-row--active .channel-row__button:focus,
  .channel-row--active .channel-row__button:active {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 25%, transparent);
    color: inherit;
    border-color: transparent;
  }

  .channel-name {
    font-size: 1.05rem;
  }

  .channel-voice-count {
    min-width: 1.4rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    color: var(--color-accent);
    font-size: 0.72rem;
    font-weight: 700;
    text-align: center;
  }

  .channel-voice-presence {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.25rem;
    width: 100%;
    padding-left: 2.1rem;
  }

  .channel-voice-avatar {
    position: relative;
    width: 1.85rem;
    height: 1.85rem;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--color-accent) 16%, transparent);
  }

  .channel-voice-indicator {
    position: absolute;
    right: -4px;
    bottom: -4px;
    font-size: 0.8rem;
    background: var(--color-panel);
    border-radius: 999px;
    padding: 1px;
  }

  .channel-voice-indicator--video {
    color: #f97316;
  }

  .channel-voice-indicator--audio {
    color: #ef4444;
  }

  .channel-voice-more {
    width: 1.85rem;
    height: 1.85rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent) 16%, transparent);
    color: var(--color-accent);
    display: grid;
    place-items: center;
    font-size: 0.8rem;
    font-weight: 700;
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


  .channel-thread-unread-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--color-accent);
    display: inline-flex;
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


<svelte:window
  onpointermove={handleChannelPointerMove}
  onpointerup={handleChannelPointerUp}
  onpointercancel={handleChannelPointerUp}
/>
