<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { collection, doc, onSnapshot, query, orderBy, type Unsubscribe } from 'firebase/firestore';
  import { db } from '$lib/firestore';
  import { getOrCreateDMThread } from '$lib/firestore/dms';
  import { resolveProfilePhotoURL } from '$lib/utils/profile';
  import { user } from '$lib/stores/user';
  import MemberProfileCard from './MemberProfileCard.svelte';

  export let serverId: string;
  export let showHeader = true;

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

  type PresenceState = 'online' | 'idle' | 'offline';

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

  let members: Record<string, MemberDoc> = {};
  let profiles: Record<string, ProfileDoc> = {};
  let presenceDocs: Record<string, PresenceDoc> = {};
  let roles: Record<string, RoleDoc> = {};
  let rows: MemberRow[] = [];
  let groupedRows: MemberGroup[] = [];
  let selectedUid: string | null = null;
  let selectedMember: MemberRow | null = null;
  let selectedProfile: ProfileDoc | null = null;
  let popoverPos = { top: 0, left: 0 };
  let cardLoading = false;
  let cardError: string | null = null;
  let isMobileView = false;
  let canMessageSelected = false;
  let mediaQuery: MediaQueryList | null = null;
  let me: any = null;
  $: me = $user;

  let membersUnsub: Unsubscribe | null = null;
  let rolesUnsub: Unsubscribe | null = null;
  const profileUnsubs: Record<string, Unsubscribe> = {};
  const presenceUnsubs: Record<string, Unsubscribe> = {};
  let currentServer: string | null = null;
  const statusOrder: PresenceState[] = ['online', 'idle', 'offline'];
  const statusLabels: Record<PresenceState, string> = {
    online: 'Online',
    idle: 'Idle',
    offline: 'Offline'
  };
  $: selectedMember = selectedUid ? rows.find((row) => row.uid === selectedUid) ?? null : null;
  $: selectedProfile = selectedUid ? profiles[selectedUid] ?? null : null;
  $: canMessageSelected = Boolean(selectedMember && me?.uid && selectedMember.uid !== me.uid);

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

  function presenceState(uid: string): PresenceState {
    const member = members[uid] as any;
    const profile = profiles[uid] as any;
    const presence = presenceDocs[uid] as any;

    const booleanState =
      typeof member?.online === 'boolean'
        ? member.online
      : typeof member?.isOnline === 'boolean'
          ? member.isOnline
          : typeof member?.active === 'boolean'
            ? member.active
      : typeof profile?.online === 'boolean'
        ? profile.online
      : typeof profile?.isOnline === 'boolean'
        ? profile.isOnline
      : typeof profile?.active === 'boolean'
        ? profile.active
      : typeof presence?.online === 'boolean'
        ? presence.online
      : typeof presence?.isOnline === 'boolean'
        ? presence.isOnline
      : typeof presence?.active === 'boolean'
        ? presence.active
        : null;
    if (booleanState !== null) {
      return booleanState ? 'online' : 'offline';
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
      const normalized = rawStatus.toLowerCase();
      if (['online', 'active', 'available', 'connected', 'here'].includes(normalized)) return 'online';
      if (['idle', 'away', 'brb', 'soon'].includes(normalized)) return 'idle';
      if (['dnd', 'busy', 'offline', 'invisible', 'do not disturb', 'off'].includes(normalized))
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
      if (isRecent(lastActive, 5 * 60 * 1000)) return 'online';
      if (isRecent(lastActive, 30 * 60 * 1000)) return 'idle';
      return 'offline';
    }

    return 'offline';
  }

  const statusClass = (state: PresenceState) => {
    switch (state) {
      case 'online':
        return 'presence-dot--online';
      case 'idle':
        return 'presence-dot--away';
      default:
        return 'presence-dot--offline';
    }
  };

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

  $: groupedRows = statusOrder.map((status) => ({
    id: status,
    label: statusLabels[status],
    members: rows.filter((row) => row.status === status)
  }));

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
    if (event.key === 'Escape' && selectedUid) {
      closeMemberProfile();
    }
  }

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

  $: if (serverId) {
    subscribeMembers(serverId);
  } else {
    membersUnsub?.();
    membersUnsub = null;
    rolesUnsub?.();
    rolesUnsub = null;
    roles = {};
    cleanupProfiles();
    currentServer = null;
  }

  onDestroy(() => {
    membersUnsub?.();
    rolesUnsub?.();
    cleanupProfiles();
  });
</script>

<svelte:window on:keydown={handleWindowKeydown} />

<div class="flex flex-col h-full w-full panel text-primary relative">
  {#if showHeader}
    <div class="flex items-center gap-3 px-3 py-3 border-b border-subtle text-soft sm:px-4">
      <span class="text-sm font-semibold sm:text-base text-primary">Members</span>
      <div class="ml-auto flex flex-1 justify-end">
        <span class="inline-flex h-7 min-w-[3.5rem] items-center justify-center rounded-full bg-white/[0.08] px-3 text-xs font-semibold text-soft sm:h-8 sm:min-w-[4rem] sm:text-sm">
          {rows.length}
        </span>
      </div>
    </div>
  {/if}
  <div class="flex flex-1 flex-col px-3 py-3 sm:px-4 sm:py-4">
    {#if rows.length}
      <div class="member-groups">
        {#each groupedRows as group (group.id)}
          {#if group.members.length}
            <section class="member-group" aria-label={`${group.label} members`}>
              <div class="member-group__header">
                <span class="member-group__count">{group.members.length}</span>
                <span class="member-group__label">{group.label}</span>
              </div>
              <ul class="member-group__list">
                {#each group.members as member (member.uid)}
                  <li>
                    <button
                      type="button"
                      class="member-row"
                      on:click={(event) => openMemberProfile(member.uid, event.currentTarget as HTMLElement)}
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
              </ul>
            </section>
          {/if}
        {/each}
      </div>
    {:else}
      <div class="text-xs text-soft px-2">No members yet.</div>
    {/if}
  </div>
</div>

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
