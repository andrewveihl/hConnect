<script lang="ts">
  import { run } from 'svelte/legacy';

  import { onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { collection, doc, onSnapshot, query, orderBy, type Unsubscribe } from 'firebase/firestore';
  import { db } from '$lib/firestore';
  import { getOrCreateDMThread } from '$lib/firestore/dms';
  import { resolveProfilePhotoURL } from '$lib/utils/profile';
  import { user } from '$lib/stores/user';
  import InvitePanel from '$lib/components/app/InvitePanel.svelte';
  import MemberProfileCard from './MemberProfileCard.svelte';

  interface Props {
    serverId: string;
    showHeader?: boolean;
    onHide?: (() => void) | null;
  }

  let { serverId, showHeader = true, onHide = null }: Props = $props();

  type MemberDoc = {
    uid: string;
    nickname?: string | null;
    displayName?: string | null;
    name?: string | null;
    email?: string | null;
    photoURL?: string | null;
    [key: string]: unknown;
  };

  type ProfileDoc = {
    displayName?: string | null;
    name?: string | null;
    email?: string | null;
    photoURL?: string | null;
    [key: string]: unknown;
  };

  type RoleDoc = {
    id: string;
    name: string;
    color?: string | null;
    position?: number;
  };

  type PresenceState = 'online' | 'busy' | 'idle' | 'offline';

  type MemberRow = {
    uid: string;
    label: string;
    avatar: string | null;
    status: PresenceState;
    tooltip: string;
    baseRole: 'owner' | 'admin' | 'member' | null;
    roles: RoleDoc[];
  };

  type MemberGroup = {
    id: PresenceState;
    label: string;
    members: MemberRow[];
  };

  type PresenceDoc = {
    state?: string | null;
    status?: string | null;
    online?: boolean | null;
    isOnline?: boolean | null;
    active?: boolean | null;
    lastActive?: any;
    lastSeen?: any;
    updatedAt?: any;
    [key: string]: unknown;
  };

  let members: Record<string, MemberDoc> = $state({});
  let profiles: Record<string, ProfileDoc> = $state({});
  let presenceDocs: Record<string, PresenceDoc> = {};
  let roles: Record<string, RoleDoc> = $state({});
  let rows: MemberRow[] = $state([]);
  let groupedRows: MemberGroup[] = $state([]);
  let selectedUid: string | null = $state(null);
  let selectedMember: MemberRow | null = $state(null);
  let selectedProfile: ProfileDoc | null = $state(null);
  let popoverPos = $state({ top: 0, left: 0 });
  let cardLoading = $state(false);
  let cardError: string | null = $state(null);
  let isMobileView = $state(false);
  let canMessageSelected = $state(false);
  let mediaQuery: MediaQueryList | null = null;
  let me: any = $state(null);
  let myMember: MemberDoc | null = $state(null);
  let myBaseRole: 'owner' | 'admin' | 'member' | null = $state(null);
  let canInviteMembers = $state(false);
  const INITIAL_MEMBER_BATCH = 60;
  const MEMBER_BATCH_SIZE = 40;
  const LAZY_LOAD_THRESHOLD = 20;
  let visibleMemberCount = $state(INITIAL_MEMBER_BATCH);
  let shouldLazyLoad = $state(false);
  let statusBuckets: Record<PresenceState, MemberRow[]> = $state({
    online: [],
    busy: [],
    idle: [],
    offline: []
  });
  let visibleGroupMap: Record<PresenceState, MemberRow[]> = $state({
    online: [],
    busy: [],
    idle: [],
    offline: []
  });
  let allMembersVisible = $state(true);
  let loadMoreSentinel: HTMLDivElement | null = $state(null);
  let memberScrollContainer: HTMLDivElement | null = $state(null);
  let loadObserver: IntersectionObserver | null = null;
  let showInviteDialog = $state(false);
  run(() => {
    me = $user;
  });

  let membersUnsub: Unsubscribe | null = $state(null);
  let rolesUnsub: Unsubscribe | null = $state(null);
  const profileUnsubs: Record<string, Unsubscribe> = {};
  const presenceUnsubs: Record<string, Unsubscribe> = {};
  let currentServer: string | null = $state(null);
  const statusOrder: PresenceState[] = ['online', 'busy', 'idle', 'offline'];
  const statusLabels: Record<PresenceState, string> = {
    online: 'Online',
    busy: 'Busy',
    idle: 'Idle',
    offline: 'Offline'
  };
  run(() => {
    selectedMember = selectedUid ? rows.find((row) => row.uid === selectedUid) ?? null : null;
  });
  run(() => {
    selectedProfile = selectedUid ? profiles[selectedUid] ?? null : null;
  });
  run(() => {
    canMessageSelected = Boolean(selectedMember && me?.uid && selectedMember.uid !== me.uid);
  });
  run(() => {
    myMember = me?.uid ? (members[me.uid] as MemberDoc | undefined) ?? null : null;
  });
  run(() => {
    myBaseRole =
      typeof (myMember as any)?.role === 'string'
        ? ((myMember as any).role as 'owner' | 'admin' | 'member')
        : null;
  });
  run(() => {
    canInviteMembers = myBaseRole === 'owner' || myBaseRole === 'admin';
  });
  run(() => {
    if (!canInviteMembers && showInviteDialog) {
      showInviteDialog = false;
    }
  });
  run(() => {
    const total = rows.length;
    shouldLazyLoad = total > LAZY_LOAD_THRESHOLD;

    if (!shouldLazyLoad) {
      visibleMemberCount = total;
      allMembersVisible = true;
      return;
    }

    if (visibleMemberCount < INITIAL_MEMBER_BATCH) {
      visibleMemberCount = Math.min(INITIAL_MEMBER_BATCH, total);
    } else if (visibleMemberCount > total) {
      visibleMemberCount = total;
    }

    allMembersVisible = visibleMemberCount >= total;
  });

  function pickString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length) return trimmed;
    }
    return undefined;
  }

  function labelFor(uid: string) {
    const member = members[uid] ?? {};
    const profile = profiles[uid] ?? {};
    return (
      pickString(member.nickname) ??
      pickString(profile.displayName) ??
      pickString(profile.name) ??
      pickString(profile.email) ??
      pickString(member.displayName) ??
      pickString(member.email) ??
      'Member'
    );
  }

  const avatarUrl = (uid: string) => {
    const member = members[uid] ?? {};
    const profile = profiles[uid] ?? {};
    const fallback = pickString(member.photoURL) ?? null;
    return resolveProfilePhotoURL(profile, fallback);
  };

  const ONLINE_WINDOW_MS = 10 * 60 * 1000;
  const IDLE_WINDOW_MS = 60 * 60 * 1000;

  const isRecent = (value: unknown, ms = ONLINE_WINDOW_MS) => {
    if (!value) return false;
    try {
      if (typeof value === 'number') {
        return Date.now() - value <= ms;
      }
      if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) && Date.now() - parsed <= ms;
      }
      if (typeof value === 'object' && value !== null) {
        const maybeTs = value as { toMillis?: () => number };
        if (typeof maybeTs.toMillis === 'function') {
          const ts = maybeTs.toMillis();
          return Number.isFinite(ts) && Date.now() - ts <= ms;
        }
      }
    } catch {
      return false;
    }
    return false;
  };

  const toMillis = (value: unknown): number | null => {
    try {
      if (!value) return null;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      if (value instanceof Date) return value.getTime();
      if (typeof value === 'object' && value !== null) {
        const maybeTs = value as { toMillis?: () => number };
        if (typeof maybeTs.toMillis === 'function') {
          const ts = maybeTs.toMillis();
          return Number.isFinite(ts) ? ts : null;
        }
      }
    } catch {
      return null;
    }
    return null;
  };

  const normalizePresence = (raw?: string | null): PresenceState | null => {
    if (!raw) return null;
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return null;
    if (['online', 'active', 'available', 'connected', 'here'].includes(normalized)) return 'online';
    if (['busy', 'dnd', 'do not disturb', 'occupied', 'focus'].includes(normalized)) return 'busy';
    if (['idle', 'away', 'brb', 'soon'].includes(normalized)) return 'idle';
    if (['offline', 'invisible', 'off'].includes(normalized)) return 'offline';
    return null;
  };

  const manualPresenceFrom = (...sources: any[]): PresenceState | null => {
    for (const source of sources) {
      if (!source) continue;
      const raw =
        pickString(source.manualState) ??
        pickString((source.manual as any)?.state);
      if (!raw) continue;
      const normalized = normalizePresence(raw);
      if (!normalized) continue;
      const expiresAt =
        toMillis(source.manualExpiresAt) ??
        toMillis((source.manual as any)?.expiresAt);
      if (expiresAt && Date.now() > expiresAt) continue;
      return normalized;
    }
    return null;
  };

  function presenceState(uid: string): PresenceState {
    const member = members[uid] as any;
    const profile = profiles[uid] as any;
    const presence = presenceDocs[uid] as any;

    const manual = manualPresenceFrom(presence, profile, member);
    if (manual) return manual;

    const booleanCandidates = [
      member?.online,
      member?.isOnline,
      member?.active,
      profile?.online,
      profile?.isOnline,
      profile?.active,
      presence?.online,
      presence?.isOnline,
      presence?.active
    ];

    let sawBoolean = false;

    for (const candidate of booleanCandidates) {
      if (typeof candidate !== 'boolean') continue;
      sawBoolean = true;
      if (candidate) {
        return 'online';
      }
    }

    const rawStatus =
      pickString(member?.status) ??
      pickString((member?.status as any)?.state) ??
      pickString(member?.presence) ??
      pickString((member?.presence as any)?.state) ??
      pickString(profile?.status) ??
      pickString((profile?.status as any)?.state) ??
      pickString(profile?.presence?.state) ??
      pickString(profile?.presenceState) ??
      pickString(profile?.availability) ??
      pickString(presence?.state) ??
      pickString(presence?.status);

    if (rawStatus) {
      const normalized = normalizePresence(rawStatus);
      if (normalized === 'busy') return 'busy';
      if (normalized === 'online') return 'online';
      if (normalized === 'idle') return 'idle';
      if (normalized === 'offline') return 'offline';
    }

    if (sawBoolean) {
      return 'offline';
    }

    const lastActive =
      member?.lastActive ??
      member?.lastSeen ??
      member?.updatedAt ??
      profile?.lastActive ??
      profile?.lastSeen ??
      profile?.updatedAt ??
      presence?.lastActive ??
      presence?.lastSeen ??
      presence?.updatedAt ??
      (presence?.timestamp as any);

    if (lastActive) {
      const seenOnline = isRecent(lastActive, ONLINE_WINDOW_MS);
      const seenIdle = isRecent(lastActive, IDLE_WINDOW_MS);

      if (seenOnline) return 'online';
      if (seenIdle) return 'idle';
      return 'offline';
    }

    return 'offline';
  }

  const statusClass = (state: PresenceState) => {
    switch (state) {
      case 'online':
        return 'presence-dot--online';
      case 'busy':
        return 'presence-dot--busy';
      case 'idle':
        return 'presence-dot--idle';
      default:
        return 'presence-dot--offline';
    }
  };

  function createBucketMap(): Record<PresenceState, MemberRow[]> {
    return {
      online: [],
      busy: [],
      idle: [],
      offline: []
    };
  }

  function getUidFromMemberDoc(d: any, data?: any) {
    const docData = (data ?? d?.data?.() ?? {}) as any;
    return docData.uid ?? docData.userId ?? docData.memberUid ?? d?.id;
  }

  function updateRows() {
    const computed: MemberRow[] = Object.values(members).map((member) => {
      const label = labelFor(member.uid);
      const status = presenceState(member.uid);
      const tooltip = label;
      const baseRole = typeof (member as any)?.role === 'string' ? ((member as any).role as 'owner' | 'admin' | 'member') : null;
      const roleIds = Array.isArray((member as any)?.roleIds) ? ((member as any).roleIds as string[]) : [];
      const resolvedRoles = roleIds
        .map((id) => roles[id])
        .filter((role): role is RoleDoc => !!role)
        .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
      return {
        uid: member.uid,
        label,
        avatar: avatarUrl(member.uid),
        status,
        tooltip,
        baseRole,
        roles: resolvedRoles
      };
    });

    rows = computed.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    );
  }

  run(() => {
    const buckets = createBucketMap();
    for (const row of rows) {
      const bucket = buckets[row.status] ?? buckets.offline;
      bucket.push(row);
    }
    statusBuckets = buckets;
    groupedRows = statusOrder.map((status) => ({
      id: status,
      label: statusLabels[status],
      members: buckets[status]
    }));
  });

  run(() => {
    const buckets = statusBuckets;
    if (!shouldLazyLoad) {
      const clone = createBucketMap();
      for (const status of statusOrder) {
        clone[status] = buckets[status] ?? [];
      }
      visibleGroupMap = clone;
      return;
    }

    let remaining = Math.max(0, visibleMemberCount);
    if (remaining === 0) {
      visibleGroupMap = createBucketMap();
      return;
    }

    const limited = createBucketMap();
    for (const status of statusOrder) {
      if (remaining <= 0) break;
      const list = buckets[status] ?? [];
      if (!list.length) continue;
      const slice = list.slice(0, remaining);
      limited[status] = slice;
      remaining -= slice.length;
    }

    visibleGroupMap = limited;
  });

  onMount(() => {
    if (!browser) return;
    mediaQuery = window.matchMedia('(max-width: 640px)');
    const update = () => {
      isMobileView = mediaQuery?.matches ?? false;
    };
    update();
    mediaQuery.addEventListener('change', update);
    return () => {
      mediaQuery?.removeEventListener('change', update);
    };
  });

  function unsubscribePresence(uid: string) {
    if (presenceUnsubs[uid]) {
      presenceUnsubs[uid]!();
      delete presenceUnsubs[uid];
      const { [uid]: _drop, ...rest } = presenceDocs;
      presenceDocs = rest;
    }
  }

  function cleanupProfiles() {
    for (const key in profileUnsubs) {
      profileUnsubs[key]?.();
      delete profileUnsubs[key];
    }
    for (const key in presenceUnsubs) {
      presenceUnsubs[key]?.();
      delete presenceUnsubs[key];
    }
    profiles = {};
    members = {};
    presenceDocs = {};
    roles = {};
    rows = [];
  }

  function openMemberProfile(uid: string, anchorEl?: HTMLElement | null) {
    selectedUid = uid;
    cardError = null;
    cardLoading = false;
    if (anchorEl) {
      const anchorRect = anchorEl.getBoundingClientRect();
      const viewportHeight = browser ? window.innerHeight : 0;
      const center = anchorRect.top + anchorRect.height / 2;
      const clamped =
        viewportHeight > 0 ? Math.min(Math.max(center, 64), viewportHeight - 64) : center;
      popoverPos = {
        top: clamped,
        left: anchorRect.left
      };
    } else {
      popoverPos = { top: 0, left: 0 };
    }
  }

  function closeMemberProfile() {
    selectedUid = null;
    cardError = null;
    cardLoading = false;
  }

  async function startDirectMessage(uid: string) {
    if (!me?.uid || uid === me.uid) return;
    cardError = null;
    cardLoading = true;
    try {
      const thread = await getOrCreateDMThread([me.uid, uid], me.uid);
      if (thread?.id) {
        closeMemberProfile();
        await goto(`/dms/${thread.id}`);
      } else {
        throw new Error('Unable to open direct message.');
      }
    } catch (err: any) {
      cardError = err?.message ?? 'Failed to start DM. Please try again.';
    } finally {
      cardLoading = false;
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (showInviteDialog) {
        showInviteDialog = false;
        return;
      }
      if (selectedUid) {
        closeMemberProfile();
      }
    }
  }

  function openInviteDialog() {
    if (!canInviteMembers) return;
    showInviteDialog = true;
  }

  function closeInviteDialog() {
    showInviteDialog = false;
  }

  function loadMoreMembers() {
    if (!shouldLazyLoad || allMembersVisible) return;
    const next = Math.min(rows.length, visibleMemberCount + MEMBER_BATCH_SIZE);
    if (next !== visibleMemberCount) {
      visibleMemberCount = next;
    }
  }

  function teardownLoadObserver() {
    loadObserver?.disconnect();
    loadObserver = null;
  }

  function setupLoadObserver() {
    if (!loadMoreSentinel || !shouldLazyLoad) return;
    loadObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreMembers();
        }
      },
      {
        root: memberScrollContainer ?? null,
        rootMargin: '0px 0px 200px 0px',
        threshold: 0.1
      }
    );
    loadObserver.observe(loadMoreSentinel);
  }

  function refreshLoadObserver() {
    if (!browser) return;
    teardownLoadObserver();
    if (loadMoreSentinel && shouldLazyLoad) {
      setupLoadObserver();
    }
  }

  run(() => {
    loadMoreSentinel;
    memberScrollContainer;
    shouldLazyLoad;
    refreshLoadObserver();
  });

  function subscribePresence(database: ReturnType<typeof db>, uid: string) {
    if (presenceUnsubs[uid]) return;
    const ref = doc(database, 'profiles', uid, 'presence', 'status');
    presenceUnsubs[uid] = onSnapshot(
      ref,
      (snap) => {
        presenceDocs = { ...presenceDocs, [uid]: (snap.data() as PresenceDoc) ?? {} };
        updateRows();
      },
      () => {
        unsubscribePresence(uid);
        updateRows();
      }
    );
  }

  function subscribeRoles(server: string) {
    rolesUnsub?.();
    const database = db();
    const rolesRef = query(collection(database, 'servers', server, 'roles'), orderBy('position', 'desc'));
    rolesUnsub = onSnapshot(
      rolesRef,
      (snap) => {
        const next: Record<string, RoleDoc> = {};
        snap.forEach((roleSnap) => {
          const data = roleSnap.data() as any;
          next[roleSnap.id] = {
            id: roleSnap.id,
            name: data?.name ?? 'Role',
            color: data?.color ?? null,
            position: data?.position ?? 0
          };
        });
        roles = next;
        updateRows();
      },
      () => {
        roles = {};
        updateRows();
      }
    );
  }

  function subscribeMembers(server: string) {
    if (currentServer === server) return;
    currentServer = server;
    visibleMemberCount = INITIAL_MEMBER_BATCH;

    membersUnsub?.();
    cleanupProfiles();
    subscribeRoles(server);

    const database = db();
    membersUnsub = onSnapshot(collection(database, 'servers', server, 'members'), (snap) => {
      const uids: string[] = [];
      const nextMembers: Record<string, MemberDoc> = {};

      for (const docSnap of snap.docs) {
        const data = (docSnap.data?.() ?? {}) as any;
        const uid = getUidFromMemberDoc(docSnap, data);
        uids.push(uid);
        nextMembers[uid] = { uid, ...data };
      }

      members = nextMembers;
      updateRows();

      for (const uid in profileUnsubs) {
        if (!uids.includes(uid)) {
          profileUnsubs[uid]?.();
          delete profileUnsubs[uid];
          const { [uid]: _drop, ...rest } = profiles;
          profiles = rest;
          unsubscribePresence(uid);
        }
      }

      uids.forEach((uid) => {
        if (!profileUnsubs[uid]) {
          profileUnsubs[uid] = onSnapshot(doc(database, 'profiles', uid), (ps) => {
            profiles = { ...profiles, [uid]: ps.data() ?? {} };
            updateRows();
          });
        }
        subscribePresence(database, uid);
      });
    });
  }

  run(() => {
    if (serverId) {
      subscribeMembers(serverId);
    } else {
      membersUnsub?.();
      membersUnsub = null;
      rolesUnsub?.();
      rolesUnsub = null;
      roles = {};
      cleanupProfiles();
      currentServer = null;
      visibleMemberCount = INITIAL_MEMBER_BATCH;
    }
  });

  onDestroy(() => {
    membersUnsub?.();
    rolesUnsub?.();
    cleanupProfiles();
    teardownLoadObserver();
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="members-pane flex flex-col h-full w-full panel text-primary relative">
  {#if showHeader}
    <div class="members-pane__header flex items-center gap-3 px-3 py-3 border-b border-subtle text-soft sm:px-4">
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold sm:text-base text-primary">Members</span>
      </div>
      <div class="ml-auto flex flex-1 items-center justify-end gap-2">
        {#if canInviteMembers}
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-white/60 focus-visible:ring-offset-transparent sm:text-sm"
            onclick={openInviteDialog}
            aria-label="Invite members"
          >
            <i class="bx bx-plus text-sm"></i>
            <span class="hidden sm:inline">Invite</span>
          </button>
        {/if}
        <span class="inline-flex h-7 min-w-[3.5rem] items-center justify-center rounded-full bg-white/[0.08] px-3 text-xs font-semibold text-soft sm:h-8 sm:min-w-[4rem] sm:text-sm">
          {rows.length}
        </span>
        {#if onHide}
          <button
            type="button"
            class="members-pane__collapse"
            aria-label="Hide members panel"
            onclick={() => onHide?.()}
          >
            <i class="bx bx-chevron-right text-base" aria-hidden="true"></i>
          </button>
        {/if}
      </div>
    </div>
  {/if}
    <div
    class="members-pane__scroll flex flex-1 flex-col overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 touch-pan-y"
    bind:this={memberScrollContainer}
  >
    {#if rows.length}
      <div class="member-groups">
        {#each groupedRows as group (group.id)}
          {#if group.members.length}
            {@const groupMembers = visibleGroupMap[group.id] ?? []}
            <section class="member-group" aria-label={`${group.label} members`}>
              <div class="member-group__header">
                <span class="member-group__count">{group.members.length}</span>
                <span class="member-group__label">{group.label}</span>
              </div>
              <ul class="member-group__list">
                {#if groupMembers.length}
                  {#each groupMembers as member (member.uid)}
                    <li>
                      <button
                        type="button"
                        class="member-row"
                        onclick={(event) => openMemberProfile(member.uid, event.currentTarget as HTMLElement)}
                      >
                        <div class="member-row__avatar">
                          {#if member.avatar}
                            <img
                              src={member.avatar}
                              alt={member.label}
                              class="h-full w-full object-cover"
                              loading="lazy"
                            />
                          {:else}
                            <i class="bx bx-user text-soft"></i>
                          {/if}
                          <span
                            class={`presence-dot ${statusClass(member.status)}`}
                            aria-label={member.status}
                          ></span>
                        </div>
                        <div class="member-row__body">
                          <div class="member-row__top">
                            <span class="member-row__name" title={member.tooltip}>
                              {member.label}
                            </span>
                          </div>
                          {#if (member.baseRole && member.baseRole !== 'member') || member.roles.length}
                            <div class="member-roles member-row__roles">
                              {#if member.baseRole === 'owner'}
                                <span class="member-role" data-tone="owner">Owner</span>
                              {:else if member.baseRole === 'admin'}
                                <span class="member-role" data-tone="admin">Admin</span>
                              {/if}
                              {#each member.roles as role}
                                <span
                                  class="member-role"
                                  style={role.color ? `--member-role-color: ${role.color}` : undefined}
                                >
                                  {role.name}
                                </span>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      </button>
                    </li>
                  {/each}
                {:else if !allMembersVisible}
                  <li>
                    <div class="member-row member-row--placeholder">
                      Scroll to load {group.label.toLowerCase()} members...
                    </div>
                  </li>
                {/if}
              </ul>
            </section>
          {/if}
        {/each}
        {#if shouldLazyLoad}
          <div class="members-pane__sentinel" bind:this={loadMoreSentinel} aria-hidden="true">
            {#if allMembersVisible}
              <span class="text-xs text-soft">Showing all {rows.length} members</span>
            {:else}
              <span class="text-xs text-soft">Showing {visibleMemberCount} of {rows.length} members...</span>
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <div class="text-xs text-soft px-2">No members yet.</div>
    {/if}
  </div>
</div>

{#if showInviteDialog && canInviteMembers}
  <div class="members-pane__invite-overlay" role="dialog" aria-modal="true" aria-label="Invite members">
    <button
      type="button"
      class="members-pane__invite-backdrop"
      aria-label="Close invite dialog"
      onclick={closeInviteDialog}
    ></button>
    <div class="members-pane__invite-card" role="document">
      <div class="members-pane__invite-header">
        <div>
          <h3 class="members-pane__invite-title">Invite members</h3>
          <p class="members-pane__invite-subtitle">Share access with teammates you trust.</p>
        </div>
        <button
          type="button"
          class="members-pane__invite-close"
          aria-label="Close invite dialog"
          onclick={closeInviteDialog}
        >
          <i class="bx bx-x text-xl"></i>
        </button>
      </div>
      <div class="members-pane__invite-body touch-pan-y">
        <InvitePanel {serverId} embedded />
      </div>
    </div>
  </div>
{/if}

<MemberProfileCard
  open={!!selectedMember}
  member={selectedMember}
  profile={selectedProfile}
  statusClassName={statusClass(selectedMember?.status ?? 'offline')}
  isMobile={isMobileView}
  anchorTop={popoverPos.top}
  anchorLeft={popoverPos.left}
  loading={cardLoading}
  error={cardError}
  canMessage={canMessageSelected}
  on:close={closeMemberProfile}
  on:dm={() => selectedMember && startDirectMessage(selectedMember.uid)}
/>

<style>
  .members-pane__scroll {
    min-height: 0;
  }

  .members-pane {
    border-radius: 0;
  }

  .members-pane__header {
    min-height: 3rem;
    padding: 0 1rem;
  }

  .members-pane__collapse {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    background: color-mix(in srgb, var(--color-panel-muted) 70%, transparent);
    color: var(--color-text-primary);
    transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 160ms ease;
  }

  .members-pane__collapse:hover,
  .members-pane__collapse:focus-visible {
    background: color-mix(in srgb, var(--color-panel-muted) 85%, transparent);
    border-color: color-mix(in srgb, var(--color-border-subtle) 85%, transparent);
    outline: none;
  }

  .members-pane__collapse:active {
    transform: scale(0.92);
  }

  .member-row--placeholder {
    cursor: default;
    justify-content: center;
    font-size: 0.85rem;
    font-style: italic;
    color: var(--text-60);
  }

  .members-pane__sentinel {
    text-align: center;
    padding: 0.5rem 0 0.25rem;
    color: var(--text-60);
  }

  .members-pane__invite-overlay {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: clamp(1rem, 3vw, 2.5rem);
  }

  .members-pane__invite-backdrop {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--color-app-overlay, rgba(0, 0, 0, 0.55)) 85%, transparent);
    backdrop-filter: blur(4px);
  }

  .members-pane__invite-card {
    position: relative;
    width: min(640px, 100%);
    max-height: 90vh;
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    border: 1px solid var(--color-border-subtle);
    box-shadow: var(--shadow-elevated);
    padding: 1rem 1.25rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .members-pane__invite-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .members-pane__invite-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .members-pane__invite-subtitle {
    margin: 0.3rem 0 0;
    font-size: 0.9rem;
    color: var(--text-70);
  }

  .members-pane__invite-close {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-panel) 70%, transparent);
    color: inherit;
    cursor: pointer;
    transition: background 120ms ease, transform 120ms ease;
  }

  .members-pane__invite-close:hover {
    background: color-mix(in srgb, var(--color-panel) 85%, white 8%);
  }

  .members-pane__invite-close:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 45%, transparent);
  }

  .members-pane__invite-body {
    overflow: auto;
    padding-right: 0.25rem;
  }

  @media (max-width: 640px) {
    .members-pane__invite-card {
      padding: 0.9rem;
      border-radius: var(--radius-md);
    }
  }
</style>
