<script lang="ts">
  import { run, passive, preventDefault } from 'svelte/legacy';

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/user';
  import { getDb } from '$lib/firebase';
  import { createChannel } from '$lib/firestore/channels';
  import { ensureSystemRoles, removeUserMembership, recomputeAllMemberPermissions, recomputeMemberPermissions } from '$lib/firestore/servers';
  import { sendServerInvite, type ServerInvite } from '$lib/firestore/invites';
import { subscribeServerDirectory, type MentionDirectoryEntry } from '$lib/firestore/membersDirectory';
import LeftPane from '$lib/components/app/LeftPane.svelte';
import TicketAIModal from '$lib/components/servers/TicketAIModal.svelte';
import { bitsAsNumber, PERMISSION_KEYS, toPermissionBits } from '$lib/permissions/permissions';

import {
    collection, doc, getDoc, onSnapshot, getDocs,
    query, orderBy, setDoc, updateDoc, deleteDoc,
    limit, addDoc, serverTimestamp, arrayUnion, arrayRemove, writeBatch, where,
    deleteField,
    type Unsubscribe
  } from 'firebase/firestore';

const ICON_MAX_BYTES = 8 * 1024 * 1024;
const FIRESTORE_IMAGE_LIMIT = 900 * 1024;
const ICON_MAX_DIMENSION = 512;
const DEFAULT_ACCENT = '#33c8bf';
const DEFAULT_SIDEBAR = '#13171d';
const DEFAULT_MENTION = '#f97316';

  interface Props {
    serverId?: string | null;
    section?: string | null;
    bare?: boolean;
  }

  let { serverId = null, section = null, bare = false }: Props = $props();

  // routing
  let routedServerId: string | null = $state(null);
  let serverOwnerId: string | null = $state(null);

  // access
  let allowed = $state(false);
  let isOwner = $state(false);
  let isAdmin = $state(false);

  // server meta
  let serverName = $state('');
  let serverIcon = $state('');
  let serverIconInput: HTMLInputElement | null = $state(null);
  let serverIconError: string | null = $state(null);
  type ChatDensity = 'cozy' | 'compact';
  type BubbleShape = 'rounded' | 'pill' | 'minimal';
  let accentColor = $state(DEFAULT_ACCENT);
  let sidebarColor = $state(DEFAULT_SIDEBAR);
  let mentionColor = $state(DEFAULT_MENTION);
  let chatDensity: ChatDensity = $state('cozy');
  let chatBubbleShape: BubbleShape = $state('rounded');
  let chatHighlightMentions = $state(true);
  let chatAllowThreads = $state(true);
  let chatAllowReactions = $state(true);
  let chatShowJoinMessages = $state(true);
  let chatSlowModeSeconds = $state(0);
  let inviteAutomationEnabled = $state(false);
  let inviteDomains: string[] = $state([]);
  let inviteDomainInput = $state('');
  let inviteDefaultRoleId: string | null = $state(null);
  let inviteDefaultRoleSelection = $state('');
  let inviteAutomationStatus: string | null = $state(null);
  let inviteAutomationError: string | null = $state(null);
  let inviteAutomationBusy = $state(false);
  let inviteAutoSentUids: Record<string, boolean> = $state({});
let inviteDeclinedUids: Record<string, boolean> = $state({});
const AUTO_INVITE_INTERVAL_MS = 60000;
let autoInviteTimer: number | null = null;
let autoInviteLoopActive = false;
let inviteAutomationBaselineKey: string | null = null;
let deleteConfirm = $state('');
let deleteBusy = $state(false);
let deleteError: string | null = $state(null);
let overviewSaveTimer: ReturnType<typeof setTimeout> | null = null;

  // sections (left rail)
  type Tab =
    | 'profile'
    | 'insights'
    | 'channels'
    | 'engagement'
    | 'members'
    | 'roles'
    | 'invites'
    | 'access'
    | 'integrations'
    | 'audit-log'
    | 'bans'
    | 'welcome'
    | 'danger';

  const navItems: Array<{
    id: Tab;
    label: string;
    icon: string;
    group: string;
    badge?: string;
    soon?: boolean;
  }> = [
    { id: 'profile', label: 'Server Profile', icon: 'bx bx-id-card', group: 'Server' },
    { id: 'insights', label: 'Server Insights', icon: 'bx bx-pulse', group: 'Server', soon: true },
    { id: 'channels', label: 'Channels', icon: 'bx bx-hash', group: 'Content' },
    { id: 'engagement', label: 'Engagement', icon: 'bx bx-bulb', group: 'Content', soon: true },
    { id: 'welcome', label: 'Welcome Screen', icon: 'bx bx-party', group: 'Content', soon: true },
    { id: 'members', label: 'Members', icon: 'bx bx-group', group: 'People' },
    { id: 'roles', label: 'Roles', icon: 'bx bx-shield-quarter', group: 'People' },
    { id: 'invites', label: 'Invites', icon: 'bx bx-envelope', group: 'People' },
    { id: 'access', label: 'Access', icon: 'bx bx-lock-alt', group: 'People', soon: true },
    { id: 'bans', label: 'Bans', icon: 'bx bx-block', group: 'People' },
    { id: 'integrations', label: 'Integrations', icon: 'bx bx-plug', group: 'Automation' },
    { id: 'audit-log', label: 'Audit Log', icon: 'bx bx-list-check', group: 'Automation', soon: true },
    { id: 'danger', label: 'Danger Zone', icon: 'bx bx-error', group: 'Danger' }
  ];

  const navGroups = $derived(Array.from(new Set(navItems.map((item) => item.group))));

  let tab: Tab = $state('profile');
  $effect(() => {
    if (section && navItems.some((entry) => entry.id === section)) {
      tab = section as Tab;
    }
  });

  $effect(() => {
    if (tab !== 'members') {
      memberMenuOpenFor = null;
      memberRolePickerFor = null;
    }
    if (tab !== 'channels') {
      channelManageMode = false;
      channelHoverId = null;
      channelDragId = null;
      closeChannelDetail();
    }
  });

  type ServerMember = {
    uid: string;
    role?: string;
    roleIds?: string[];
    displayName?: string;
    nickname?: string;
    name?: string;
    email?: string;
    photoURL?: string | null;
    [key: string]: unknown;
  };

  type EnrichedMember = ServerMember & {
    displayName: string;
    photoURL?: string | null;
  };

  // live lists
let members: ServerMember[] = $state([]);
let membersReady = $state(false);
let membersWithProfiles: EnrichedMember[] = $state([]);
let memberDirectory: Record<string, MentionDirectoryEntry> = $state({});
let memberMenuOpenFor: string | null = $state(null);
let memberRolePickerFor: string | null = $state(null);
let roleAssignTarget: EnrichedMember | null = $state(null);
let roleAssignModalOpen = $state(false);
let domainModalOpen = $state(false);
let ticketAiModalOpen = $state(false);
let banSearch = $state('');
let bans: Array<{ uid: string; reason?: string; bannedAt?: any }> = $state([]);
let channels: Array<{ id: string; name: string; type: 'text' | 'voice'; position?: number; allowedRoleIds?: string[]; isPrivate?: boolean }> = $state([]);
let sortedChannels: Array<{ id: string; name: string; type: 'text' | 'voice'; position?: number; allowedRoleIds?: string[]; isPrivate?: boolean }> = $state([]);
let newChannelName = $state('');
let newChannelType: 'text' | 'voice' = $state('text');
let newChannelPrivate = $state(false);
let newChannelAllowedRoleIds: string[] = $state([]);
let channelCreateBusy = $state(false);
let channelError: string | null = $state(null);
let channelPrivacyBusy: Record<string, boolean> = $state({});
let channelPrivacyError: string | null = $state(null);
let channelModalOpen = $state(false);
let channelManageMode = $state(false);
let channelReorderBusy = $state(false);
let channelDragId: string | null = $state(null);
let channelHoverId: string | null = $state(null);
let channelDetailId: string | null = $state(null);
let channelDetailName = $state('');
let channelDetailType: 'text' | 'voice' = $state('text');
let channelDetailPrivate = $state(false);
let channelDetailRoles: string[] = $state([]);
let channelDetailBusy = $state(false);
let manageChannelsOpen = $state(false);
let channelDetailModalOpen = $state(false);
let channelDetailSection: 'overview' | 'access' = $state('overview');
let roleDetailModalOpen = $state(false);
let roleDetailId: string | null = $state(null);
let roleDetailSection: 'display' | 'permissions' | 'members' = $state('display');
let roleMemberSearch = $state('');
  const channelTypeOptions = [
    {
      id: 'text',
      label: 'Text',
      description: 'Chat-friendly spaces with threads, files, and reactions.',
      icon: 'bx bx-message-dots',
      enabled: true
    },
    {
      id: 'voice',
      label: 'Voice',
      description: 'Drop-in audio rooms with camera and screen share.',
      icon: 'bx bx-headphone',
      enabled: true
    },
    {
      id: 'forum',
      label: 'Forum',
      description: 'Topic-first posts with replies (coming soon).',
      icon: 'bx bx-collection',
      enabled: false
    },
    {
      id: 'announcement',
      label: 'Announcement',
      description: 'Broadcast channels for updates (coming soon).',
      icon: 'bx bx-megaphone',
      enabled: false
    }
  ] as const;
  type RolePermissionKey =
    | 'viewServer'
    | 'viewMemberList'
    | 'viewServerHome'
    | 'manageServer'
    | 'manageRoles'
    | 'manageChannels'
    | 'manageWebhooks'
    | 'viewAuditLog'
    | 'manageEmojisStickers'
    | 'manageEvents'
    | 'kickMembers'
    | 'banMembers'
    | 'timeoutMembers'
    | 'viewChannel'
    | 'viewChannels'
    | 'sendMessages'
    | 'sendMessagesInThreads'
    | 'createPublicThreads'
    | 'createPrivateThreads'
    | 'manageThreads'
    | 'manageMessages'
    | 'readMessageHistory'
    | 'addReactions'
    | 'manageReactions'
    | 'embedLinks'
    | 'attachFiles'
    | 'useExternalEmojis'
    | 'mentionEveryone'
    | 'reorderChannels'
    | 'connectVoice'
    | 'speakVoice'
    | 'streamVoice'
    | 'muteMembers'
    | 'deafenMembers'
    | 'moveMembers'
    | 'prioritySpeaker';
  type Role = {
    id: string;
    name: string;
    color?: string | null;
    description?: string | null;
    position?: number;
    permissions?: Partial<Record<RolePermissionKey, boolean>>;
    permissionBits?: number;
    isOwnerRole?: boolean;
    isEveryoneRole?: boolean;
    mentionable?: boolean;
    allowMassMentions?: boolean;
    showInMemberList?: boolean;
  };
  let roles: Role[] = $state([]);
  let sortedRoles: Role[] = $state([]);
  let assignableRoles: Role[] = $state([]);
  let newRoleName = $state('');
  let newRoleColor = $state('#5865f2');
  let newRoleMentionable = $state(true);
  let showRoleModal = $state(false);
  let roleCreateBusy = $state(false);
  let roleNameInputEl: HTMLInputElement | null = $state(null);
  let roleUpdateBusy: Record<string, boolean> = $state({});
  let roleError: string | null = $state(null);
  let defaultRoleError: string | null = $state(null);
  let defaultRoleSelection = $state('');
  let roleCollapsed: Record<string, boolean> = $state({});
  let roleSearch = $state('');
  let roleDetailTab: Record<string, 'display' | 'permissions' | 'members'> = $state({});

  const permCamelFrom = (key: string) =>
    key
      .toLowerCase()
      .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

  function normalizeRolePermissions(raw: Partial<Record<RolePermissionKey, boolean>>): Record<string, boolean> {
    const normalized: Record<string, boolean> = {};
    for (const perm of PERMISSION_KEYS) {
      const camel = permCamelFrom(perm);
      const plural = camel.endsWith('s') ? camel : `${camel}s`;
      const value =
        (raw as any)?.[perm] ??
        (raw as any)?.[camel] ??
        (raw as any)?.[plural] ??
        false;
      normalized[perm] = !!value;
    }
    return normalized;
  }

  function permissionPayloadFrom(perms: Partial<Record<RolePermissionKey, boolean>>) {
    const normalized = normalizeRolePermissions(perms ?? {});
    return {
      permissions: normalized,
      permissionBits: bitsAsNumber(toPermissionBits(normalized))
    };
  }

  function canonicalPermissionKey(key: RolePermissionKey | string): string {
    const keyStr = String(key);
    const match = PERMISSION_KEYS.find((perm) => {
      const camel = permCamelFrom(perm);
      return perm === keyStr || camel === keyStr || `${camel}s` === keyStr;
    });
    return match ?? keyStr;
  }

  function toMillis(value: unknown): number | null {
    if (!value) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.getTime();
    if (typeof (value as any)?.toMillis === 'function') {
      try {
        return (value as any).toMillis();
      } catch {
        // ignore
      }
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatSince(value: unknown) {
    const millis = toMillis(value);
    if (!millis) return 'â€”';
    const date = new Date(millis);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function handleGlobalClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    const insideRoleModal = target?.closest('.role-modal');
    memberMenuOpenFor = null;
    memberRolePickerFor = null;
    if (!insideRoleModal) {
      roleDetailModalOpen = false;
      roleAssignModalOpen = false;
      roleAssignTarget = null;
    }
  }

  // profiles (people who have logged in)
  type Profile = {
    uid: string;
    displayName?: string;
    name?: string;
    nameLower?: string;
    email?: string;
    photoURL?: string;
  };
  let allProfiles: Profile[] = $state([]);
  let profileIndex: Record<string, Profile> = $state({});
  let inviteProfiles: Record<string, Profile> = {};
  const inviteProfileStops = new Map<string, Unsubscribe>();
  let memberSearch = $state('');
  let memberRoleFilter: 'all' | 'owner' | 'admin' | 'custom' = $state('all');
  let filteredMembers: EnrichedMember[] = $state([]);
  let pendingInvites: ServerInvite[] = $state([]);
  let pendingInvitesByUid: Record<string, ServerInvite> = $state({});
  let inviteLoading: Record<string, boolean> = $state({});
  let inviteCancelBusy: Record<string, boolean> = $state({});
  let clearInvitesBusy = $state(false);
  let clearInvitesError: string | null = $state(null);
  let inviteError: string | null = $state(null);
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartAt = 0;
  let touchStartTarget: EventTarget | null = null;
  let offMyMember: Unsubscribe | null = null;

  function ownerFrom(data: any) {
    return data?.owner ?? data?.ownerId ?? data?.createdBy ?? null;
  }

  function automationSnapshotKey() {
    const normalizedDomains = inviteDomains
      .map((domain) => (typeof domain === 'string' ? domain.trim().toLowerCase() : ''))
      .filter((domain) => domain.length > 0)
      .sort();
    return JSON.stringify({
      enabled: !!inviteAutomationEnabled,
      domains: normalizedDomains,
      role: inviteDefaultRoleId ?? null
    });
  }

  async function gate() {
    const db = getDb();
    const snap = await getDoc(doc(db, 'servers', serverId!));
    if (!snap.exists()) return goto('/');

    const data = snap.data() as any;
    serverName = data?.name ?? 'Server';
    serverIcon = data?.icon ?? null;
    serverDefaultRoleId = typeof data?.defaultRoleId === 'string' ? data.defaultRoleId : null;
    defaultRoleSelection = serverDefaultRoleId ?? '';
    const appearance = data?.settings?.appearance ?? {};
    accentColor = typeof appearance.accentColor === 'string' ? appearance.accentColor : DEFAULT_ACCENT;
    sidebarColor = typeof appearance.sidebarColor === 'string' ? appearance.sidebarColor : DEFAULT_SIDEBAR;
    mentionColor = typeof appearance.mentionColor === 'string' ? appearance.mentionColor : DEFAULT_MENTION;
    const chatSettings = data?.settings?.chat ?? {};
    chatBubbleShape =
      chatSettings?.bubbleShape === 'pill' || chatSettings?.bubbleShape === 'minimal' ? chatSettings.bubbleShape : 'rounded';
    chatDensity = chatSettings?.density === 'compact' ? 'compact' : 'cozy';
    chatHighlightMentions = chatSettings?.highlightMentions ?? true;
    chatAllowThreads = chatSettings?.allowThreads ?? true;
    chatAllowReactions = chatSettings?.allowReactions ?? true;
    chatShowJoinMessages = chatSettings?.showJoinMessages ?? true;
    chatSlowModeSeconds = Number.isFinite(chatSettings?.slowModeSeconds) ? chatSettings.slowModeSeconds : 0;
    const automation = data?.settings?.inviteAutomation ?? {};
    inviteAutomationEnabled = automation?.enabled ?? false;
    inviteDomains = Array.isArray(automation?.domains)
      ? Array.from(
          new Set(
            automation.domains
              .map((d: unknown) => (typeof d === 'string' ? d.trim().toLowerCase() : ''))
              .filter((d: string) => d.length > 0)
          )
        )
      : typeof automation?.domain === 'string'
        ? [automation.domain]
        : [];
    inviteDefaultRoleId = typeof automation?.defaultRoleId === 'string' ? automation.defaultRoleId : null;
    inviteAutoSentUids = automation?.sentUids ?? {};
    inviteDeclinedUids = automation?.declinedUids ?? {};
    inviteAutomationBaselineKey = automationSnapshotKey();
    const owner = ownerFrom(data);
    serverOwnerId = owner ?? null;

    isOwner = !!($user?.uid && owner && $user.uid === owner);

    // admin if role is 'admin' in members or owner
    if (!isOwner && $user?.uid) {
      const memberRef = doc(db, 'servers', serverId!, 'members', $user.uid);
      const memberSnap = await getDoc(memberRef);
      const memberData = memberSnap.exists() ? (memberSnap.data() as any) : null;
      syncAdminFromMember(memberData, memberRef);
    } else {
      isAdmin = true; // owner is admin+
      allowed = true;
    }

    if (!allowed) goto(`/servers/${serverId}`);

    await ensureSystemRoles(serverId!);
  }

  function goBack() {
    if (history.length > 1) history.back();
    else goto(serverId ? `/servers/${serverId}` : '/');
  }

  function watchMembers() {
    const db = getDb();
    return onSnapshot(collection(db, 'servers', serverId!, 'members'), (snap) => {
      members = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
      membersReady = true;
    });
  }

  function watchMyMembership() {
    if (!$user?.uid) return null;
    const db = getDb();
    const ref = doc(db, 'servers', serverId!, 'members', $user.uid);
    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          if (!isOwner) {
            isAdmin = false;
            allowed = false;
          }
          return;
        }
        const data = snap.data() as any;
        syncAdminFromMember(data, ref);
      },
      (err) => console.error('[ServerSettings] watchMyMembership error', err)
    );
  }

  $effect(() => {
    if (!serverId || !$user?.uid) {
      offMyMember?.();
      offMyMember = null;
      return;
    }
    offMyMember?.();
    offMyMember = watchMyMembership();
  });

  function openRoleModal() {
    if (!(isOwner || isAdmin)) return;
    roleError = null;
    newRoleMentionable = true;
    showRoleModal = true;
    queueMicrotask(() => {
      roleNameInputEl?.focus();
    });
  }

  function closeRoleModal() {
    showRoleModal = false;
    roleCreateBusy = false;
    roleError = null;
    newRoleName = '';
    newRoleColor = '#5865f2';
    newRoleMentionable = true;
  }

  function watchBans() {
    const db = getDb();
    return onSnapshot(collection(db, 'servers', serverId!, 'bans'), (snap) => {
      bans = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
    });
  }

  function watchChannels() {
    const db = getDb();
    const qRef = query(collection(db, 'servers', serverId!, 'channels'), orderBy('position'));
    return onSnapshot(qRef, (snap) => {
      channels = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    });
  }

  function watchRoles() {
    const db = getDb();
    const qRef = query(collection(db, 'servers', serverId!, 'roles'), orderBy('position'));
    return onSnapshot(qRef, (snap) => {
      roles = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          ...data,
          showInMemberList: data?.showInMemberList !== false
        } as Role;
      });
    });
  }

  function watchPendingInvites() {
    const db = getDb();
    const qRef = query(
      collection(db, 'invites'),
      where('serverId', '==', serverId!),
      where('status', '==', 'pending')
    );
    return onSnapshot(
      qRef,
      (snap) => {
        const list: ServerInvite[] = [];
        const map: Record<string, ServerInvite> = {};
        snap.forEach((d) => {
          const data = d.data() as ServerInvite;
          const invite: ServerInvite = { id: d.id, ...data };
          list.push(invite);
          if (invite.toUid) {
            map[invite.toUid] = invite;
          }
        });
        list.sort((a, b) => {
          const aTs = ((a.createdAt as any)?.toMillis?.() ?? 0) as number;
          const bTs = ((b.createdAt as any)?.toMillis?.() ?? 0) as number;
          return bTs - aTs;
        });
        const prev = pendingInvitesByUid;
        pendingInvites = list;
        pendingInvitesByUid = map;
        syncInviteProfileWatchers(list);
        handleInviteLifecycle(prev, map);
      },
      () => {
        pendingInvites = [];
        pendingInvitesByUid = {};
        syncInviteProfileWatchers([]);
      }
    );
  }

  function resolveMemberLabel(member: ServerMember, entry?: MentionDirectoryEntry): string {
    if (entry?.label && entry.label.trim().length) return entry.label;
    const candidates = [
      typeof member.nickname === 'string' ? member.nickname : null,
      typeof member.displayName === 'string' ? member.displayName : null,
      typeof member.name === 'string' ? member.name : null,
      typeof member.email === 'string' ? member.email : null
    ];
    for (const value of candidates) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length) return trimmed;
      }
    }
    return member.uid;
  }

  function resolveMemberAvatar(member: ServerMember, entry?: MentionDirectoryEntry): string | null {
    const value = entry?.avatar ?? (typeof member.photoURL === 'string' ? member.photoURL : null);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length ? trimmed : null;
    }
    return null;
  }

  function profileForInvite(uid: string | null | undefined): Profile | null {
    if (!uid || typeof uid !== 'string') return null;
    return profileIndex[uid] ?? inviteProfiles[uid] ?? null;
  }

  function syncInviteProfileWatchers(invites: ServerInvite[]) {
    const desired = new Set(
      invites
        .map((invite) => invite.toUid)
        .filter((uid): uid is string => typeof uid === 'string' && uid.length > 0)
    );
    const db = getDb();
    desired.forEach((uid) => {
      if (profileIndex[uid] || inviteProfileStops.has(uid)) return;
      const ref = doc(db, 'profiles', uid);
      const stop = onSnapshot(
        ref,
        (snap) => {
          if (snap.exists()) {
            inviteProfiles = { ...inviteProfiles, [uid]: { uid, ...(snap.data() as any) } };
          } else if (inviteProfiles[uid]) {
            const { [uid]: _, ...rest } = inviteProfiles;
            inviteProfiles = rest;
          }
        },
        () => {
          inviteProfileStops.get(uid)?.();
          inviteProfileStops.delete(uid);
          if (inviteProfiles[uid]) {
            const { [uid]: _, ...rest } = inviteProfiles;
            inviteProfiles = rest;
          }
        }
      );
      inviteProfileStops.set(uid, stop);
    });
    inviteProfileStops.forEach((stop, uid) => {
      if (!desired.has(uid) || profileIndex[uid]) {
        stop();
        inviteProfileStops.delete(uid);
        if (inviteProfiles[uid]) {
          const { [uid]: _, ...rest } = inviteProfiles;
          inviteProfiles = rest;
        }
      }
    });
  }

  function handleInviteLifecycle(
    prev: Record<string, ServerInvite>,
    next: Record<string, ServerInvite>
  ) {
    if (!membersReady) return;
    const memberSet = new Set(members.map((m) => m.uid));
    Object.keys(prev).forEach((uid) => {
      if (!next[uid]) {
        if (memberSet.has(uid)) {
          clearDomainInviteDecline(uid);
        } else {
          markDomainInviteDeclined(uid);
        }
      }
    });
  }

  run(() => {
    membersWithProfiles = members.map((member) => {
      const entry = memberDirectory[member.uid];
      return {
        ...member,
        displayName: resolveMemberLabel(member, entry),
        photoURL: resolveMemberAvatar(member, entry)
      };
    });
  });
  run(() => {
    profileIndex = allProfiles.reduce<Record<string, Profile>>((acc, profile) => {
      acc[profile.uid] = profile;
      return acc;
    }, {});
  });
  run(() => {
    sortedChannels = [...channels].sort((a, b) => {
      const ap = typeof a.position === 'number' ? a.position : Number.MAX_SAFE_INTEGER;
      const bp = typeof b.position === 'number' ? b.position : Number.MAX_SAFE_INTEGER;
      return ap - bp;
    });
  });
  run(() => {
    if (!channelDetailId) return;
    const match = sortedChannels.find((c) => c.id === channelDetailId);
    if (!match) {
      closeChannelDetail();
      return;
    }
    channelDetailName = match.name ?? channelDetailName;
    channelDetailType = match.type;
    channelDetailPrivate = !!match.isPrivate;
    channelDetailRoles = Array.isArray(match.allowedRoleIds) ? [...match.allowedRoleIds] : channelDetailRoles;
  });
  run(() => {
    if (!channelDetailPrivate) {
      if (channelDetailRoles.length) {
        channelDetailRoles = [];
      }
      if (channelDetailSection === 'access') {
        channelDetailSection = 'overview';
      }
    }
  });
  run(() => {
    sortedRoles = [...roles].sort((a, b) => {
      const ap = typeof a.position === 'number' ? a.position : Number.MAX_SAFE_INTEGER;
      const bp = typeof b.position === 'number' ? b.position : Number.MAX_SAFE_INTEGER;
      return ap - bp;
    });
  });
  run(() => {
    assignableRoles = sortedRoles.filter((role) => {
      const lower = (role.name ?? '').toLowerCase();
      return lower !== 'admin';
    });
  });
  let everyoneRole = $derived(sortedRoles.find((r) => r.isEveryoneRole));
  let defaultRoleTarget: Role | null = $state(null);
  let serverDefaultRoleId: string | null = $state(null);
  let defaultRoleSaveBusy = $state(false);
  run(() => {
    const chosen = sortedRoles.find((r) => r.id === serverDefaultRoleId);
    if (chosen) {
      defaultRoleTarget = chosen;
      return;
    }
    const flag = sortedRoles.find((r) => r.isEveryoneRole);
    if (flag) {
      defaultRoleTarget = flag;
      return;
    }
    const byName = sortedRoles.find((r) => (r.name ?? '').trim().toLowerCase() === 'everyone');
    defaultRoleTarget = byName ?? null;
    if (defaultRoleSelection && !sortedRoles.find((r) => r.id === defaultRoleSelection)) {
      defaultRoleSelection = '';
    }
  });
  let filteredRoles = $derived(
    sortedRoles.filter((role) => {
      const term = roleSearch.trim().toLowerCase();
      if (!term) return true;
      return (role.name ?? '').toLowerCase().includes(term);
    })
  );
  let filteredBans = $derived(
    bans.filter((b) => {
      const term = banSearch.trim().toLowerCase();
      if (!term) return true;
      return b.uid.toLowerCase().includes(term) || (b.reason ?? '').toLowerCase().includes(term);
    })
  );
  run(() => {
    const availableRoleIds = new Set(sortedRoles.map((r) => r.id));
    if (newChannelAllowedRoleIds.some((id) => !availableRoleIds.has(id))) {
      newChannelAllowedRoleIds = newChannelAllowedRoleIds.filter((id) => availableRoleIds.has(id));
    }
  });
  run(() => {
    if (!newChannelPrivate && newChannelAllowedRoleIds.length) {
      newChannelAllowedRoleIds = [];
    }
  });
  run(() => {
    const ids = new Set(sortedRoles.map((r) => r.id));
    const next: Record<string, boolean> = { ...roleCollapsed };
    let changed = false;
    for (const role of sortedRoles) {
      if (!(role.id in next)) {
        next[role.id] = true;
        changed = true;
      }
    }
    for (const key in next) {
      if (!ids.has(key)) {
        delete next[key];
        changed = true;
      }
    }
    if (changed) roleCollapsed = next;
  });

  run(() => {
    const shouldRun =
      typeof window !== 'undefined' &&
      !!serverId &&
      inviteAutomationEnabled &&
      inviteDomains.length > 0 &&
      (isOwner || isAdmin);
    if (shouldRun && !autoInviteLoopActive) {
      autoInviteLoopActive = true;
      scheduleAutoInviteLoop();
    } else if (!shouldRun && autoInviteLoopActive) {
      autoInviteLoopActive = false;
      stopAutoInviteLoop();
    }
  });

  run(() => {
    if (!membersReady) return;
    const memberSet = new Set(members.map((m) => m.uid));
    Object.keys(inviteDeclinedUids).forEach((uid) => {
      if (inviteDeclinedUids[uid] && memberSet.has(uid)) {
        clearDomainInviteDecline(uid);
      }
    });
  });
  run(() => {
    filteredMembers = membersWithProfiles.filter((member) => {
      const term = memberSearch.trim().toLowerCase();
      const dirHandle = memberDirectory[member.uid]?.handle?.toLowerCase() ?? '';
      const matchesTerm =
        !term ||
        member.displayName.toLowerCase().includes(term) ||
        member.uid.toLowerCase().includes(term) ||
        (dirHandle && dirHandle.includes(term)) ||
        (Array.isArray(member.roleIds) &&
          member.roleIds.some((roleId) => {
            const target = sortedRoles.find((r) => r.id === roleId);
            return target?.name?.toLowerCase().includes(term);
          }));

      if (!matchesTerm) return false;

      if (memberRoleFilter === 'owner') {
        return serverOwnerId ? member.uid === serverOwnerId : false;
      }
      if (memberRoleFilter === 'admin') {
        return (member.role ?? '').toLowerCase() === 'admin';
      }
      if (memberRoleFilter === 'custom') {
        return Array.isArray(member.roleIds) && member.roleIds.length > 0;
      }
      return true;
    });
  });
  let canManageChannels = $derived(isOwner || isAdmin);
  run(() => {
    if (deleteError && deleteConfirm.trim().toLowerCase() === 'confirm') {
      deleteError = null;
    }
  });
  run(() => {
    const nextDefaultRole = inviteDefaultRoleId ?? '';
    if (inviteDefaultRoleSelection !== nextDefaultRole) {
      inviteDefaultRoleSelection = nextDefaultRole;
    }
  });
  const rolePermissionGroups: Array<{
    title: string;
    description?: string;
    items: Array<{ key: RolePermissionKey; label: string; description: string }>;
  }> = [
    {
      title: 'Access',
      description: 'Baseline visibility and participation.',
      items: [
        {
          key: 'viewMemberList',
          label: 'Appear in member list',
          description: 'Be visible to other members.'
        },
        {
          key: 'viewServerHome',
          label: 'Open server home',
          description: 'Open the server shell/landing page.'
        },
        {
          key: 'viewChannels',
          label: 'View channels',
          description: 'See channel list and enter public channels.'
        },
        {
          key: 'readMessageHistory',
          label: 'Read history',
          description: 'Scroll back to earlier messages.'
        }
      ]
    },
    {
      title: 'Messaging',
      description: 'What this role can do in text channels.',
      items: [
        {
          key: 'sendMessages',
          label: 'Send messages',
          description: 'Post messages and add reactions.'
        },
        {
          key: 'manageMessages',
          label: 'Manage messages',
          description: 'Delete, pin, or moderate chat content.'
        }
      ]
    },
    {
      title: 'Voice',
      description: 'Voice channel participation.',
      items: [
        {
          key: 'connectVoice',
          label: 'Connect to voice',
          description: 'Join voice channels and calls.'
        },
        {
          key: 'speakVoice',
          label: 'Speak in voice',
          description: 'Talk once connected.'
        }
      ]
    },
    {
      title: 'Member moderation',
      description: 'Tools to manage members.',
      items: [
        {
          key: 'kickMembers',
          label: 'Kick members',
          description: 'Remove members without banning.'
        },
        {
          key: 'banMembers',
          label: 'Ban members',
          description: 'Permanently ban members from the server.'
        }
      ]
    },
    {
      title: 'Admin & structure',
      description: 'Server-wide settings and structure.',
      items: [
        {
          key: 'manageServer',
          label: 'Manage server',
          description: 'Adjust server profile, appearance, and automation.'
        },
        {
          key: 'manageRoles',
          label: 'Manage roles',
          description: 'Create, edit, or delete roles and permissions.'
        },
        {
          key: 'manageChannels',
          label: 'Manage channels',
          description: 'Create, reorder, archive, or delete channels.'
        }
      ]
    }
  ];
  const rolePermissionOptions = rolePermissionGroups.flatMap((group) => group.items);

  // NEW: watch first N profiles ordered by nameLower (users who have logged in)
  function watchProfiles() {
    const db = getDb();
    const qRef = query(collection(db, 'profiles'), orderBy('nameLower'), limit(200));
    return onSnapshot(qRef, (snap) => {
      allProfiles = snap.docs.map((d) => {
        const p = d.data() as any;
        return {
          uid: d.id,
          displayName: p.displayName ?? p.name ?? '',
          nameLower: p.nameLower ?? (p.displayName || '').toLowerCase(),
          email: p.email ?? '',
          photoURL: p.photoURL ?? ''
        } as Profile;
      });
    });
  }

  onMount(() => {
    let cancelled = false;
    let offMembers: (() => void) | null = null;
    let offBans: (() => void) | null = null;
    let offChannels: (() => void) | null = null;
    let offProfiles: (() => void) | null = null;
    let offRoles: (() => void) | null = null;
    let offDirectory: (() => void) | null = null;
    let offInvites: (() => void) | null = null;

    (async () => {
      let resolvedId = serverId ?? routedServerId;
      if (!resolvedId && typeof window !== 'undefined') {
        const parts = window.location.pathname.split('/').filter(Boolean);
        const idx = parts.indexOf('servers');
        if (idx !== -1 && parts[idx + 1]) {
          resolvedId = parts[idx + 1];
        }
      }
      serverId = resolvedId;
      routedServerId = resolvedId;
      if (section && navItems.some((entry) => entry.id === section)) {
        tab = section as Tab;
      }
      if (!serverId) {
        goto('/');
        return;
      }

      await gate();
      if (cancelled) return;

      offMembers = watchMembers();
      offBans = watchBans();
      offChannels = watchChannels();
      offProfiles = watchProfiles();
      offRoles = watchRoles();
      offMyMember = watchMyMembership();
      offDirectory = subscribeServerDirectory(serverId!, (entries) => {
        const next: Record<string, MentionDirectoryEntry> = {};
        for (const entry of entries) {
          next[entry.uid] = entry;
        }
        memberDirectory = next;
      });
      offInvites = watchPendingInvites();
    })();

    return () => {
      cancelled = true;
      offMembers?.();
      offBans?.();
      offChannels?.();
      offProfiles?.();
      offRoles?.();
      offMyMember?.();
      offDirectory?.();
      offInvites?.();
      inviteProfileStops.forEach((stop) => stop());
      inviteProfileStops.clear();
      inviteProfiles = {};
      pendingInvitesByUid = {};
      stopAutoInviteLoop();
    };
  });

  // ----- actions: Overview -----
  async function saveOverview() {
    const db = getDb();
    try {
      const slowMode = Math.max(0, Math.round(Number.isFinite(chatSlowModeSeconds) ? Number(chatSlowModeSeconds) : 0));
      chatSlowModeSeconds = slowMode;
      await updateDoc(doc(db, 'servers', serverId!), {
        name: serverName,
        icon: serverIcon && serverIcon.trim().length ? serverIcon : null,
        'settings.appearance': {
          accentColor,
          sidebarColor,
          mentionColor,
          bubbleShape: chatBubbleShape
        },
        'settings.chat': {
          density: chatDensity,
          highlightMentions: chatHighlightMentions,
          allowThreads: chatAllowThreads,
          allowReactions: chatAllowReactions,
          showJoinMessages: chatShowJoinMessages,
          slowModeSeconds: slowMode
        },
        'settings.inviteAutomation': {
          enabled: inviteAutomationEnabled,
          domains: inviteDomains,
          defaultRoleId: inviteDefaultRoleId,
          sentUids: inviteAutoSentUids,
          declinedUids: inviteDeclinedUids
        }
      });
      const previousAutomationKey = inviteAutomationBaselineKey;
      const nextAutomationKey = automationSnapshotKey();
      inviteAutomationBaselineKey = nextAutomationKey;
      const shouldAutoSyncDomains =
        nextAutomationKey !== previousAutomationKey && inviteAutomationEnabled && inviteDomains.length > 0;
      inviteAutomationStatus = 'Settings saved.';
      inviteAutomationError = null;
      if (shouldAutoSyncDomains) {
        await sendAutoInvitesForDomains();
      }
    } catch (e) {
      console.error(e);
      inviteAutomationError = 'Failed to save settings.';
    }
  }

  function scheduleSaveOverview(delay = 400) {
    if (overviewSaveTimer) clearTimeout(overviewSaveTimer);
    overviewSaveTimer = setTimeout(() => {
      overviewSaveTimer = null;
      void saveOverview();
    }, delay);
  }

  function normalizeDomain(value: string) {
    return value.trim().toLowerCase().replace(/^\@+/, '');
  }

  function addInviteDomain() {
    const cleaned = normalizeDomain(inviteDomainInput);
    inviteDomainInput = '';
    if (!cleaned) {
      inviteAutomationError = 'Enter a domain to whitelist.';
      return;
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleaned)) {
      inviteAutomationError = 'That does not look like a valid domain.';
      return;
    }
    if (inviteDomains.includes(cleaned)) {
      inviteAutomationError = 'Domain already whitelisted.';
      return;
    }
    inviteDomains = [...inviteDomains, cleaned];
    scheduleSaveOverview();
    inviteAutomationError = null;
  }

  function removeInviteDomain(domain: string) {
    inviteDomains = inviteDomains.filter((d) => d !== domain);
    scheduleSaveOverview();
  }

  function recordAutoInviteSent(uid: string) {
    if (!uid || inviteAutoSentUids[uid]) return;
    inviteAutoSentUids = { ...inviteAutoSentUids, [uid]: true };
    if (!serverId) return;
    const db = getDb();
    void updateDoc(doc(db, 'servers', serverId), {
      [`settings.inviteAutomation.sentUids.${uid}`]: true
    }).catch((err) => console.error('[ServerSettings] recordAutoInviteSent error', err));
  }

  function markDomainInviteDeclined(uid: string) {
    if (!uid || inviteDeclinedUids[uid] || !inviteAutoSentUids[uid]) return;
    inviteDeclinedUids = { ...inviteDeclinedUids, [uid]: true };
    if (!serverId) return;
    const db = getDb();
    void updateDoc(doc(db, 'servers', serverId), {
      [`settings.inviteAutomation.declinedUids.${uid}`]: true
    }).catch((err) => console.error('[ServerSettings] markDomainInviteDeclined error', err));
  }

  function clearDomainInviteDecline(uid: string) {
    if (!inviteDeclinedUids[uid]) return;
    const { [uid]: _, ...rest } = inviteDeclinedUids;
    inviteDeclinedUids = rest;
    if (!serverId) return;
    const db = getDb();
    void updateDoc(doc(db, 'servers', serverId), {
      [`settings.inviteAutomation.declinedUids.${uid}`]: deleteField()
    }).catch((err) => console.error('[ServerSettings] clearDomainInviteDecline error', err));
  }

  function stopAutoInviteLoop() {
    if (autoInviteTimer) {
      clearTimeout(autoInviteTimer);
      autoInviteTimer = null;
    }
  }

  function scheduleAutoInviteLoop() {
    stopAutoInviteLoop();
    if (typeof window === 'undefined') return;
    autoInviteTimer = window.setTimeout(() => {
      void sendAutoInvitesForDomains({ single: true, auto: true });
      scheduleAutoInviteLoop();
    }, AUTO_INVITE_INTERVAL_MS);
  }

  async function sendAutoInvitesForDomains(options: { single?: boolean; auto?: boolean } = {}) {
    const { single = false, auto = false } = options;
    if (!(isOwner || isAdmin) || !inviteAutomationEnabled) return;
    if (single && inviteAutomationBusy) return;
    const domainSet = new Set(inviteDomains);
    if (!domainSet.size) {
      if (!auto) inviteAutomationError = 'Add at least one domain before syncing.';
      return;
    }
    const existingMembers = new Set(members.map((m) => m.uid));
    const pendingSet = new Set(Object.keys(pendingInvitesByUid));
    const declinedSet = new Set(
      Object.keys(inviteDeclinedUids).filter((uid) => inviteDeclinedUids[uid])
    );
    const candidates = allProfiles.filter((profile) => {
      if (!profile?.uid || !profile.email) return false;
      const [, domainRaw] = profile.email.split('@');
      if (!domainRaw) return false;
      const domain = domainRaw.toLowerCase();
      if (!domainSet.has(domain)) return false;
      if (existingMembers.has(profile.uid)) return false;
      if (pendingSet.has(profile.uid)) return false;
      if (declinedSet.has(profile.uid)) return false;
      return true;
    });
    if (candidates.length === 0) {
      if (!auto) {
        inviteAutomationStatus = 'Everyone from those domains is already a member or invited.';
        inviteAutomationError = null;
      }
      return;
    }
    const targets = single ? candidates.slice(0, 1) : candidates;
    if (!single) {
      inviteAutomationBusy = true;
      inviteAutomationStatus = `Sending invites to ${targets.length} account${targets.length === 1 ? '' : 's'}...`;
      inviteAutomationError = null;
    }
    for (const candidate of targets) {
      try {
        const result = await inviteUser(candidate.uid, {
          silent: auto || single,
          type: 'domain-auto'
        });
        if (result?.ok) {
          recordAutoInviteSent(candidate.uid);
          if (auto) {
            const label =
              candidate?.displayName ?? candidate?.name ?? candidate?.email ?? candidate.uid;
            inviteAutomationStatus = `Auto-invited ${label}`;
          }
        } else if (!auto) {
          inviteAutomationError = 'Some invites could not be delivered.';
        }
      } catch (err) {
        console.error(err);
        if (!auto) inviteAutomationError = 'Some invites could not be delivered.';
      }
      if (single) break;
    }
    if (!single) {
      inviteAutomationBusy = false;
      if (!inviteAutomationError) {
        inviteAutomationStatus = 'Domain invites sent.';
      }
    }
  }

  function dataUrlBytes(dataUrl: string): number {
    const base64 = dataUrl.split(',')[1] ?? '';
    return Math.ceil((base64.length * 3) / 4);
  }

  async function compressServerImage(file: File): Promise<string> {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = objectUrl;
      });

      const scale = Math.min(1, ICON_MAX_DIMENSION / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(img.width * scale));
      canvas.height = Math.max(1, Math.floor(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      let quality = 0.92;
      let result = canvas.toDataURL('image/webp', quality);
      while (dataUrlBytes(result) > FIRESTORE_IMAGE_LIMIT && quality > 0.4) {
        quality -= 0.1;
        result = canvas.toDataURL('image/webp', quality);
      }
      if (dataUrlBytes(result) > FIRESTORE_IMAGE_LIMIT) {
        throw new Error('Image is still too large after compression.');
      }
      return result;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function triggerServerIconUpload() {
    serverIconInput?.click();
  }

  async function onServerIconSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      serverIconError = 'Please choose an image file.';
      input.value = '';
      return;
    }
    if (file.size > ICON_MAX_BYTES) {
      serverIconError = 'Image must be smaller than 8 MB.';
      input.value = '';
      return;
    }
    try {
      const processed = await compressServerImage(file);
      serverIcon = processed;
      serverIconError = null;
      scheduleSaveOverview();
    } catch (error: any) {
      serverIconError = error?.message ?? 'Could not process the selected file.';
    }
    input.value = '';
  }

  // ----- actions: Members / Roles -----
  async function setRole(uid: string, role: 'admin' | 'member') {
    if (!isOwner && role === 'admin' && !isAdmin) return;
    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', serverId!, 'members', uid), {
        role
      });
      await recomputeMemberPermissions(serverId!, uid);
    } catch (e) {
      console.error(e);
      alert('Failed to update role.');
    }
  }

  function syncAdminFromMember(data: any, ref?: ReturnType<typeof doc>) {
    if (isOwner) {
      isAdmin = true;
      allowed = true;
      return;
    }
    const role = data?.role;
    const perms = (data?.perms ?? {}) as Partial<Record<RolePermissionKey, boolean>>;
    const hasManageServer = perms?.manageServer === true;
    isAdmin = role === 'admin' || hasManageServer;
    allowed = isOwner || isAdmin;
    if (ref && role === 'admin' && !hasManageServer) {
      void recomputeMemberPermissions(serverId!, ref.id).catch((err) => {
        console.error('[ServerSettings] failed to refresh admin permissions', err);
      });
    }
  }

  async function kick(uid: string) {
    if (!isAdmin) return;
    if (!confirm('Kick this user? They can rejoin with an invite.')) return;
    const db = getDb();
    try {
      await deleteDoc(doc(db, 'servers', serverId!, 'members', uid));
      await removeUserMembership(serverId!, uid);
    } catch (e) {
      console.error(e);
      alert('Failed to kick user.');
    }
  }

  async function ban(uid: string) {
    if (!isAdmin) return;
    const reason = prompt('Reason for ban? (optional)') || '';
    if (!confirm('Ban this user? They will be removed and prevented from rejoining.')) return;
    const db = getDb();
    try {
      await setDoc(doc(db, 'servers', serverId!, 'bans', uid), {
        reason,
        bannedAt: Date.now(),
        by: $user?.uid ?? null
      });
      await deleteDoc(doc(db, 'servers', serverId!, 'members', uid));
      await removeUserMembership(serverId!, uid);
    } catch (e) {
      console.error(e);
      alert('Failed to ban user.');
    }
  }

  async function unban(uid: string) {
    if (!isAdmin) return;
    const db = getDb();
    try {
      await deleteDoc(doc(db, 'servers', serverId!, 'bans', uid));
    } catch (e) {
      console.error(e);
      alert('Failed to unban user.');
    }
  }

  async function createRole() {
    if (!(isOwner || isAdmin) || roleCreateBusy) return;
    const name = newRoleName.trim();
    if (!name) return;
    const db = getDb();
    roleCreateBusy = true;
    try {
      const permissionPayload = permissionPayloadFrom({});
      const ref = await addDoc(collection(db, 'servers', serverId!, 'roles'), {
        name,
        color: newRoleColor || null,
        createdAt: serverTimestamp(),
        position: sortedRoles.length,
        description: null,
        isOwnerRole: false,
        isEveryoneRole: false,
        mentionable: !!newRoleMentionable,
        allowMassMentions: false,
        showInMemberList: true,
        ...permissionPayload
      });
      closeRoleModal();
      newRoleName = '';
      newRoleColor = '#5865f2';
      newRoleMentionable = true;
      roleCollapsed = { ...roleCollapsed, [ref.id]: false };
    } catch (e) {
      console.error(e);
      alert('Failed to create role.');
    } finally {
      roleCreateBusy = false;
    }
  }

  async function deleteRole(roleId: string, roleName: string) {
    if (!isOwner) return;
    const targetRole = roles.find((r) => r.id === roleId);
    if (targetRole?.isOwnerRole || targetRole?.isEveryoneRole) {
      alert('System roles cannot be deleted.');
      return;
    }
    const canonical = roleName.trim().toLowerCase();
    if (canonical === 'everyone' || canonical === 'admin') {
      alert('Built-in roles cannot be deleted.');
      return;
    }
    if (!confirm(`Delete role "${roleName}"? This will remove it from members and channels.`)) return;

    const db = getDb();
    try {
      await deleteDoc(doc(db, 'servers', serverId!, 'roles', roleId));

      const membersSnap = await getDocs(collection(db, 'servers', serverId!, 'members'));
      const affectedMembers: string[] = [];
      await Promise.all(
        membersSnap.docs.map((m) => {
          const data = m.data() as any;
          if (Array.isArray(data.roleIds) && data.roleIds.includes(roleId)) {
            affectedMembers.push(m.id);
            return updateDoc(m.ref, { roleIds: arrayRemove(roleId) });
          }
          return Promise.resolve();
        })
      );

      const channelsSnap = await getDocs(collection(db, 'servers', serverId!, 'channels'));
      await Promise.all(
        channelsSnap.docs.map((c) => {
          const data = c.data() as any;
          if (Array.isArray(data.allowedRoleIds) && data.allowedRoleIds.includes(roleId)) {
            return updateDoc(c.ref, { allowedRoleIds: arrayRemove(roleId) });
          }
          return Promise.resolve();
        })
      );

      for (const uid of affectedMembers) {
        await recomputeMemberPermissions(serverId!, uid);
      }
    } catch (e) {
      console.error(e);
      alert('Failed to delete role.');
    }
  }

  async function toggleMemberRole(uid: string, roleId: string, enabled: boolean) {
    if (!isAdmin) return;
    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', serverId!, 'members', uid), {
        roleIds: enabled ? arrayUnion(roleId) : arrayRemove(roleId)
      });
      await recomputeMemberPermissions(serverId!, uid);
    } catch (e) {
      console.error(e);
      alert('Failed to update member roles.');
    }
  }

  async function toggleChannelRole(channelId: string, roleId: string, enabled: boolean) {
    if (!isAdmin) return;
    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', serverId!, 'channels', channelId), {
        allowedRoleIds: enabled ? arrayUnion(roleId) : arrayRemove(roleId)
      });
    } catch (e) {
      console.error(e);
      alert('Failed to update channel access.');
    }
  }

  function toggleNewChannelRole(roleId: string, enabled: boolean) {
    newChannelAllowedRoleIds = enabled
      ? Array.from(new Set([...newChannelAllowedRoleIds, roleId]))
      : newChannelAllowedRoleIds.filter((id) => id !== roleId);
  }

  async function toggleRolePermission(roleId: string, key: RolePermissionKey, enabled: boolean) {
    if (!isAdmin) return;
    const db = getDb();
    roleUpdateBusy = { ...roleUpdateBusy, [roleId]: true };
    try {
      const role = roles.find((r) => r.id === roleId);
      const currentPerms = normalizeRolePermissions((role?.permissions ?? {}) as Record<string, boolean>);
      const canonicalKey = canonicalPermissionKey(key);
      const nextPerms = { ...currentPerms, [canonicalKey]: enabled };
      const payload = permissionPayloadFrom(nextPerms);
      await updateDoc(doc(db, 'servers', serverId!, 'roles', roleId), {
        ...payload
      });
      await recomputeAllMemberPermissions(serverId!);
      roleError = null;
    } catch (e) {
      console.error(e);
      roleError = 'Failed to update role permissions.';
    } finally {
      const next = { ...roleUpdateBusy };
      delete next[roleId];
      roleUpdateBusy = next;
    }
  }

  function toggleRoleCollapse(roleId: string) {
    roleCollapsed = { ...roleCollapsed, [roleId]: !roleCollapsed[roleId] };
  }

  function setRolePanel(roleId: string, panel: 'display' | 'permissions' | 'members') {
    roleDetailTab = { ...roleDetailTab, [roleId]: panel };
  }

  function currentRolePanel(roleId: string): 'display' | 'permissions' | 'members' {
    return roleDetailTab[roleId] ?? 'display';
  }

  function countEnabledPerms(role: Role): number {
    const perms = normalizeRolePermissions((role.permissions ?? {}) as Record<string, boolean>);
    return rolePermissionOptions.reduce((total, option) => {
      const key = canonicalPermissionKey(option.key);
      return perms[key] ? total + 1 : total;
    }, 0);
  }

  function roleHasPermission(role: Role, key: RolePermissionKey): boolean {
    const perms = normalizeRolePermissions((role.permissions ?? {}) as Record<string, boolean>);
    const canonical = canonicalPermissionKey(key);
    return !!perms[canonical];
  }

  function resolveMemberRoles(member: EnrichedMember): Role[] {
    if (!Array.isArray(member.roleIds) || member.roleIds.length === 0) return [];
    const resolved = member.roleIds
      .map((id) => sortedRoles.find((r) => r.id === id))
      .filter((r): r is Role => Boolean(r));
    return resolved.filter((role) => role.showInMemberList !== false);
  }

  async function updateRoleDoc(roleId: string, updates: Record<string, unknown>) {
    if (!isAdmin) return;
    const db = getDb();
    roleUpdateBusy = { ...roleUpdateBusy, [roleId]: true };
    try {
      await updateDoc(doc(db, 'servers', serverId!, 'roles', roleId), updates);
      roleError = null;
    } catch (e) {
      console.error(e);
      roleError = 'Failed to update role.';
    } finally {
      const next = { ...roleUpdateBusy };
      delete next[roleId];
      roleUpdateBusy = next;
    }
  }

  async function setRoleName(roleId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      roleError = 'Role name cannot be empty.';
      return;
    }
    const current = roles.find((r) => r.id === roleId);
    if (current && (current.name ?? '').trim() === trimmed) return;
    await updateRoleDoc(roleId, { name: trimmed });
  }

  async function setRoleColor(roleId: string, color: string) {
    const normalized = color || null;
    const current = roles.find((r) => r.id === roleId);
    if ((current?.color ?? null) === normalized) return;
    await updateRoleDoc(roleId, { color: normalized });
  }

  async function setRoleMentionable(roleId: string, enabled: boolean) {
    await updateRoleDoc(roleId, { mentionable: enabled });
  }

  async function setRoleShowInMemberList(roleId: string, enabled: boolean) {
    await updateRoleDoc(roleId, { showInMemberList: enabled });
  }

  async function moveRole(roleId: string, direction: 'up' | 'down') {
    if (!isAdmin) return;
    const current = sortedRoles;
    const index = current.findIndex((r) => r.id === roleId);
    if (index === -1) return;
    const delta = direction === 'up' ? -1 : 1;
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= current.length) return;
    const ordered = [...current];
    const [role] = ordered.splice(index, 1);
    ordered.splice(targetIndex, 0, role);
    const db = getDb();
    const batch = writeBatch(db);
    ordered.forEach((r, idx) => {
      batch.update(doc(db, 'servers', serverId!, 'roles', r.id), { position: idx });
    });
    roleUpdateBusy = { ...roleUpdateBusy, [roleId]: true };
    try {
      await batch.commit();
      await recomputeAllMemberPermissions(serverId!);
      roleError = null;
    } catch (e) {
      console.error(e);
      roleError = 'Failed to reorder roles.';
    } finally {
      const next = { ...roleUpdateBusy };
      delete next[roleId];
      roleUpdateBusy = next;
    }
  }

  async function saveDefaultRole() {
    if (!(isOwner || isAdmin) || defaultRoleSaveBusy) return;
    const chosenId = defaultRoleSelection || serverDefaultRoleId;
    const chosen = sortedRoles.find((r) => r.id === chosenId);
    if (!chosen) {
      defaultRoleError = 'Pick a role to set as default.';
      return;
    }
    if (chosen.isOwnerRole) {
      defaultRoleError = 'Owner role cannot be the default.';
      return;
    }
    defaultRoleSaveBusy = true;
    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', serverId!), { defaultRoleId: chosen.id });
      serverDefaultRoleId = chosen.id;
      defaultRoleSelection = chosen.id;
      defaultRoleTarget = chosen;
      defaultRoleError = null;
      await recomputeAllMemberPermissions(serverId!);
    } catch (err) {
      console.error(err);
      defaultRoleError = 'Failed to update default role.';
    } finally {
      defaultRoleSaveBusy = false;
    }
  }

  // ----- actions: Channels -----
  async function renameChannel(id: string, oldName: string) {
    if (!isAdmin) return;
    const name = prompt('Rename channel to:', oldName);
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === oldName.trim()) return;
    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', serverId!, 'channels', id), { name: trimmed });
    } catch (e) {
      console.error(e);
      alert('Failed to rename channel.');
    }
  }

  async function deleteChannel(id: string, name: string) {
    if (!isAdmin) return;
    if (!confirm(`Delete channel ${name}? This cannot be undone.`)) return;
    const db = getDb();
    try {
      await deleteDoc(doc(db, 'servers', serverId!, 'channels', id));
    } catch (e) {
      console.error(e);
      alert('Failed to delete channel.');
    }
  }

  async function moveChannel(channelId: string, direction: 'up' | 'down') {
    if (!canManageChannels) return;
    const ordered = sortedChannels;
    const index = ordered.findIndex((c) => c.id === channelId);
    if (index === -1) return;
    const delta = direction === 'up' ? -1 : 1;
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= ordered.length) return;
    const next = [...ordered];
    const [channel] = next.splice(index, 1);
    next.splice(targetIndex, 0, channel);
    await persistChannelOrder(next);
  }

  async function createChannelInline() {
    if (!isAdmin) return;
    const name = newChannelName.trim();
    if (!name) {
      channelError = 'Enter a channel name.';
      return;
    }
    channelCreateBusy = true;
    channelError = null;
    try {
      await createChannel(
        serverId!,
        name,
        newChannelType,
        newChannelPrivate,
        newChannelPrivate ? newChannelAllowedRoleIds : []
      );
      newChannelName = '';
      newChannelPrivate = false;
      newChannelAllowedRoleIds = [];
      channelModalOpen = false;
    } catch (e) {
      console.error(e);
      channelError = 'Failed to create channel.';
    } finally {
      channelCreateBusy = false;
    }
  }

  async function persistChannelOrder(next: typeof sortedChannels) {
    if (!canManageChannels) return;
    channelReorderBusy = true;
    const db = getDb();
    const batch = writeBatch(db);
    next.forEach((c, idx) => {
      batch.update(doc(db, 'servers', serverId!, 'channels', c.id), { position: idx });
    });
    try {
      await batch.commit();
      sortedChannels = next;
    } catch (e) {
      console.error(e);
      alert('Failed to reorder channels.');
    } finally {
      channelReorderBusy = false;
    }
  }

  async function toggleChannelPrivacy(channelId: string, nextPrivate: boolean) {
    if (!isAdmin) return;
    const db = getDb();
    channelPrivacyError = null;
    channelPrivacyBusy = { ...channelPrivacyBusy, [channelId]: true };
    const payload: Record<string, unknown> = { isPrivate: nextPrivate };
    if (!nextPrivate) {
      payload.allowedRoleIds = [];
    }
    try {
      await updateDoc(doc(db, 'servers', serverId!, 'channels', channelId), payload);
    } catch (e) {
      console.error(e);
      channelPrivacyError = nextPrivate
        ? 'Failed to make channel private.'
        : 'Failed to make channel public.';
    } finally {
      const next = { ...channelPrivacyBusy };
      delete next[channelId];
      channelPrivacyBusy = next;
    }
  }

  function openChannelDetail(channelId: string) {
    const match = sortedChannels.find((c) => c.id === channelId);
    if (!match) return;
    channelDetailId = match.id;
    channelDetailName = match.name ?? '';
    channelDetailType = match.type;
    channelDetailPrivate = !!match.isPrivate;
    channelDetailRoles = Array.isArray(match.allowedRoleIds) ? [...match.allowedRoleIds] : [];
    channelDetailSection = 'overview';
    channelDetailModalOpen = true;
    channelError = null;
  }

  function closeChannelDetail() {
    channelDetailId = null;
    channelDetailName = '';
    channelDetailRoles = [];
    channelDetailPrivate = false;
    channelDetailModalOpen = false;
  }

  function chooseChannelType(id: string) {
    if (id === 'text' || id === 'voice') {
      newChannelType = id;
      channelError = null;
      return;
    }
    channelError = 'That channel type is coming soon.';
  }

  function toggleChannelDetailRole(roleId: string, enabled: boolean) {
    if (!channelDetailPrivate) return;
    channelDetailRoles = enabled
      ? Array.from(new Set([...(channelDetailRoles ?? []), roleId]))
      : channelDetailRoles.filter((id) => id !== roleId);
  }

  async function saveChannelDetail() {
    if (!channelDetailId || !isAdmin) return;
    const name = channelDetailName.trim();
    if (!name) {
      channelError = 'Name cannot be empty.';
      return;
    }
    const payload: Record<string, unknown> = {
      name,
      isPrivate: channelDetailPrivate,
      allowedRoleIds: channelDetailPrivate ? channelDetailRoles : []
    };
    const db = getDb();
    channelDetailBusy = true;
    channelError = null;
    try {
      await updateDoc(doc(db, 'servers', serverId!, 'channels', channelDetailId), payload);
      if (!channelDetailPrivate) {
        channelDetailRoles = [];
      }
    } catch (e) {
      console.error(e);
      channelError = 'Failed to update channel.';
    } finally {
      channelDetailBusy = false;
    }
  }

  function startChannelDrag(event: DragEvent, id: string) {
    if (!manageChannelsOpen || !canManageChannels) return;
    channelDragId = id;
    channelHoverId = null;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.dropEffect = 'move';
      event.dataTransfer.setData('text/plain', id);
      event.dataTransfer.setDragImage(new Image(), 0, 0);
    }
  }

  function handleChannelDragOver(event: DragEvent, id: string) {
    if (!manageChannelsOpen || !canManageChannels) return;
    event.preventDefault();
    if (!channelDragId || channelDragId === id) return;
    channelHoverId = id;
    const current = [...sortedChannels];
    const from = current.findIndex((c) => c.id === channelDragId);
    const to = current.findIndex((c) => c.id === id);
    if (from === -1 || to === -1) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    sortedChannels = next;
  }

  async function handleChannelDrop(event: DragEvent) {
    if (!manageChannelsOpen || !canManageChannels) return;
    event.preventDefault();
    channelHoverId = null;
    const order = sortedChannels;
    channelDragId = null;
    await persistChannelOrder(order);
  }

  function handleChannelDragEnd() {
    channelHoverId = null;
    channelDragId = null;
  }

  // ----- actions: Danger Zone (owner only) -----
  async function deleteServer() {
    if (!isOwner) return;
    if (deleteConfirm.trim().toLowerCase() !== 'confirm') {
      deleteError = "Type 'confirm' to enable deletion.";
      return;
    }
    if (!confirm('This will permanently delete the server, its channels, and messages. Continue?')) return;
    deleteBusy = true;
    deleteError = null;
    const db = getDb();
    try {
      const colls = ['channels', 'members', 'bans'];
      for (const c of colls) {
        const snap = await getDocs(collection(db, 'servers', serverId!, c));
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      }
      await deleteDoc(doc(db, 'servers', serverId!));
      deleteConfirm = '';
      alert('Server deleted.');
      goto('/'); // go home
    } catch (e) {
      console.error(e);
      deleteError = 'Failed to delete server. Consider a Cloud Function for large deletes.';
    } finally {
      deleteBusy = false;
    }
  }

  function swipeEnabled() {
    if (bare) return false;
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 820;
  }

  function handleTouchStart(event: TouchEvent) {
    if (bare) return;
    if (!swipeEnabled() || event.touches.length === 0) return;
    const touch = event.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchStartAt = performance.now();
    touchStartTarget = event.target;
  }

  function handleTouchEnd(event: TouchEvent) {
    if (bare) return;
    if (!swipeEnabled() || event.changedTouches.length === 0) {
      touchStartTarget = null;
      return;
    }
    const targetEl = (touchStartTarget as HTMLElement | null);
    if (targetEl?.closest('.settings-tabbar')) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = Math.abs(touch.clientY - touchStartY);
    const elapsed = performance.now() - touchStartAt;
    if (touchStartX > 40) {
      touchStartTarget = null;
      return;
    }
    if (deltaX > 70 && deltaY < 80 && elapsed < 500) {
      goBack();
    }
    touchStartTarget = null;
  }

  const touchStartListener = (event: Event) => handleTouchStart(event as TouchEvent);
  const touchEndListener = (event: Event) => handleTouchEnd(event as TouchEvent);

  // ===== INLINE INVITE (filter in-memory; no dialogs) =====
  let search = $state('');
  let q = $derived((search || '').trim().toLowerCase());

  // Derived: filter and exclude users already in this server (optional)
  let memberSet = $derived(new Set(members.map((m) => m.uid)));
  let filtered = $derived(
    allProfiles
      .filter((profile) => {
        if (!profile?.uid) return false;
        if (memberSet.has(profile.uid)) return false;
        if (!q) return true;
        const fields = [
          profile.nameLower,
          profile.displayName,
          profile.name,
          profile.email,
          profile.uid
        ];
        return fields.some(
          (value) => typeof value === 'string' && value.toLowerCase().includes(q)
        );
      })
      .slice(0, 50)
  ); // keep list tidy

  // invite to first text channel (keeps your current accept flow)
  async function inviteUser(toUid: string, options: { silent?: boolean; type?: string | null } = {}) {
    const silent = options?.silent ?? false;
    const inviteType = options?.type ?? null;
    if (!(isOwner || isAdmin)) return { ok: false };
    if (!isOwner) {
      if (!silent) alert('Per current security rules, only channel owners can send invites.');
      return { ok: false };
    }
    const fallback = channels.find((c) => c.type === 'text') ?? channels[0];
    if (!fallback) {
      if (!silent) alert('Create a channel first.');
      return { ok: false };
    }

    if (pendingInvitesByUid[toUid]) {
      if (!silent) {
        inviteError = 'That user already has a pending invite to this server.';
        console.debug('[ServerSettings] inviteUser skipped; pending invite already exists', {
          toUid,
          invite: pendingInvitesByUid[toUid]
        });
      }
      return { ok: false };
    }

    const fromUid = $user?.uid;
    if (!fromUid) {
      if (!silent) inviteError = 'You must be signed in to send invites.';
      return { ok: false };
    }

    if (!silent) {
      inviteError = null;
      inviteLoading = { ...inviteLoading, [toUid]: true };
    }
    try {
      const fromDisplayName = (() => {
        const raw = $user?.displayName ?? $user?.email ?? null;
        return typeof raw === 'string' && raw.trim().length ? raw.trim() : null;
      })();
      const res = await sendServerInvite({
        toUid,
        fromUid,
        fromDisplayName,
        serverId: serverId!,
        serverName: serverName || serverId!,
        serverIcon,
        channelId: fallback.id,
        channelName: fallback.name || 'general',
        type: inviteType ?? undefined
      });
      if (!res.ok) {
        if (!silent) {
          inviteError = 'Failed to invite ' + toUid + ': ' + (res.error ?? 'Unknown error');
          console.debug('[ServerSettings] sendServerInvite failed', { toUid, res });
        }
        if (pendingInvitesByUid[toUid]) {
          const { [toUid]: _, ...rest } = pendingInvitesByUid;
          pendingInvitesByUid = rest;
          pendingInvites = pendingInvites.filter((invite) => invite.toUid !== toUid);
        }
        return { ok: false };
      }

      if (res.alreadyExisted) {
        if (!silent) {
          inviteError = 'User already has a pending invite.';
          console.debug('[ServerSettings] sendServerInvite already existed', { toUid, res });
        }
        return { ok: false };
      }

      const inviteId = res.inviteId ?? `${serverId!}__${toUid}`;
      const inviteStub: ServerInvite = {
        id: inviteId,
        toUid,
        fromUid,
        fromDisplayName,
        serverId: serverId!,
        serverName: serverName || serverId!,
        serverIcon: serverIcon && serverIcon.trim().length ? serverIcon : null,
        channelId: fallback.id,
        channelName: fallback.name || 'general',
        type: 'channel',
        status: 'pending',
        createdAt: null as any
      };
      pendingInvitesByUid = { ...pendingInvitesByUid, [toUid]: inviteStub };
      pendingInvites = [...pendingInvites.filter((invite) => invite.toUid !== toUid), inviteStub];
      console.debug('[ServerSettings] sendServerInvite ok', { toUid, res });
      if (!silent) (window as any)?.navigator?.vibrate?.(10);
      return { ok: true };
    } catch (e) {
      console.error('[ServerSettings] inviteUser error', e);
      if (!silent) inviteError = (e as Error)?.message ?? 'Failed to send invite.';
      return { ok: false };
    } finally {
      if (!silent) {
        inviteLoading = { ...inviteLoading, [toUid]: false };
      }
    }

  }

  async function cancelInvite(invite: ServerInvite) {
  if (!(isOwner || isAdmin)) return;
  const toUid = invite?.toUid;
  if (!toUid || !serverId) return;
  const inviteId = invite.id ?? `${serverId}__${toUid}`;
  inviteError = null;
  inviteCancelBusy = { ...inviteCancelBusy, [inviteId]: true };
  try {
    await deleteDoc(doc(getDb(), 'invites', inviteId));
    const { [toUid]: _, ...rest } = pendingInvitesByUid;
    pendingInvitesByUid = rest;
    pendingInvites = pendingInvites.filter((entry) => entry.toUid !== toUid);
    console.debug('[ServerSettings] cancelInvite ok', { inviteId });
  } catch (e) {
    console.error('[ServerSettings] cancelInvite error', e);
    inviteError = 'Failed to remove invite.';
  } finally {
    inviteCancelBusy = { ...inviteCancelBusy, [inviteId]: false };
  }
}

async function clearPendingInvites() {
  if (!(isOwner || isAdmin) || clearInvitesBusy || !pendingInvites.length || !serverId) return;
  if (!confirm('Remove all pending invites for this server?')) return;
  clearInvitesBusy = true;
  clearInvitesError = null;
  const db = getDb();
  try {
    const batch = writeBatch(db);
    for (const invite of pendingInvites) {
      const inviteId = invite.id ?? `${serverId}__${invite.toUid}`;
      batch.delete(doc(db, 'invites', inviteId));
    }
    await batch.commit();
    pendingInvites = [];
    pendingInvitesByUid = {};
    inviteProfiles = {};
    inviteProfileStops.forEach((stop) => stop());
    inviteProfileStops.clear();
    console.debug('[ServerSettings] clearPendingInvites ok');
  } catch (e) {
    console.error('[ServerSettings] clearPendingInvites error', e);
    clearInvitesError = 'Failed to clear invites.';
  } finally {
    clearInvitesBusy = false;
  }
}
</script>

<svelte:head>
  <title>Server Settings</title>
</svelte:head>

<svelte:window on:click={handleGlobalClick} />

{#if allowed}
  <div class={bare ? 'flex min-h-0 flex-col text-primary' : 'settings-workspace flex h-dvh app-bg text-primary overflow-hidden'}>
    {#if !bare}
      <div class="hidden md:flex md:shrink-0">
        <LeftPane activeServerId={serverId} padForDock={false} />
      </div>
    {/if}
    <div
      class={`settings-shell flex-1 ${bare ? 'min-h-0 overflow-visible pb-0' : ''}`}
      style={`--server-accent:${accentColor}; --server-sidebar:${sidebarColor}; --server-mention:${mentionColor};${bare ? 'min-height:auto;height:auto;padding-bottom:0;overflow:visible;' : ''}`}
      use:passive={['touchstart', () => touchStartListener]}
      use:passive={['touchend', () => touchEndListener]}
    >
      <div class="settings-container">

        {#if !bare}
          <div class="settings-header-alt">
            <div class="settings-header-alt__left">
              <button
                type="button"
                class="settings-back"
                aria-label="Go back"
                title="Back"
                onclick={goBack}
              >
                <i class="bx bx-left-arrow-alt text-xl leading-none"></i>
              </button>
              <div>
                <p class="settings-eyebrow">Server Settings</p>
                <h1>{serverName || 'Server'}</h1>
                <p>Overhauled management panel with clearer sections.</p>
              </div>
            </div>
            <div class="settings-header-alt__badge">Matches teal themes + mobile-first</div>
          </div>
        {/if}

        <div class={`settings-body ${bare ? '' : 'lg:grid lg:grid-cols-[260px,1fr] lg:gap-5'}`}>
          {#if !bare}
            <aside class="settings-rail">
              {#each navGroups as group}
                <div class="settings-rail__group">
                  <p class="settings-rail__label">{group}</p>
                  <div class="settings-rail__items">
                    {#each navItems.filter((item) => item.group === group) as item (item.id)}
                      <button
                        type="button"
                        class={`settings-rail__item ${tab === item.id ? 'is-active' : ''}`}
                        onclick={() => (tab = item.id)}
                      >
                        <span class="settings-rail__item-left">
                          <span class="settings-rail__icon"><i class={`${item.icon}`} aria-hidden="true"></i></span>
                          <span class="truncate">{item.label}</span>
                        </span>
                        <span class="settings-rail__item-meta">
                          {#if item.soon}
                            <span class="settings-rail__soon">Soon</span>
                          {/if}
                          {#if tab === item.id}
                            <span class="settings-rail__dot" aria-hidden="true"></span>
                          {/if}
                        </span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/each}
            </aside>
          {/if}

          <div class="settings-main space-y-6">
      <!-- profile -->
      {#if tab === 'profile'}
        <div class="settings-stack">
        <div class="settings-card">
          <div>
            <div class="settings-card__title">Server profile</div>
            <div class="settings-card__subtitle">Update the basics everyone sees in the sidebar.</div>
          </div>
          <div class="settings-grid settings-grid--two">
            <div>
              <label class="settings-label" for="server-name">Server name</label>
              <input
                id="server-name"
                class="input"
                bind:value={serverName}
                aria-label="Server name"
                oninput={() => scheduleSaveOverview()}
              />
            </div>
            <div>
              <label class="settings-label" for="server-icon-upload">Server icon</label>
              <div class="flex items-center gap-3">
                {#if serverIcon}
                  <img src={serverIcon} alt="Server icon preview" class="h-14 w-14 rounded-full border border-subtle object-cover" />
                {:else}
                  <div class="h-14 w-14 rounded-full border border-dashed border-subtle bg-white/5"></div>
                {/if}
                <div class="flex flex-col gap-2">
                  <button type="button" class="btn btn-ghost btn-sm w-fit" onclick={triggerServerIconUpload}>
                    Upload image
                  </button>
                  <input class="hidden" id="server-icon-upload" type="file" accept="image/*" bind:this={serverIconInput} onchange={onServerIconSelected} />
                  {#if serverIconError}
                    <p class="text-xs text-red-300">{serverIconError}</p>
                  {:else}
                    <p class="text-xs text-soft">JPG, PNG, GIF up to 8MB. Larger images compress automatically.</p>
                  {/if}
                </div>
              </div>
            </div>
          </div>
        </div>

          <div class="settings-card">
            <div>
              <div class="settings-card__title">Appearance &amp; colors</div>
              <div class="settings-card__subtitle">Tweak chat accents just for this server.</div>
            </div>
            <div class="settings-grid settings-grid--three">
              <div class="settings-color-field">
                <label class="settings-label" for="accent-color">Accent color</label>
                <div class="settings-color-input">
                  <input id="accent-color" type="color" bind:value={accentColor} aria-label="Server accent color" oninput={() => scheduleSaveOverview()} />
                  <input
                    class="input input--compact"
                    value={accentColor}
                    oninput={(e) => {
                      accentColor = (e.currentTarget as HTMLInputElement).value;
                      scheduleSaveOverview();
                    }}
                  />
                </div>
              </div>
              <div class="settings-color-field">
                <label class="settings-label" for="sidebar-color">Sidebar background</label>
                <div class="settings-color-input">
                  <input id="sidebar-color" type="color" bind:value={sidebarColor} aria-label="Sidebar background color" oninput={() => scheduleSaveOverview()} />
                  <input
                    class="input input--compact"
                    value={sidebarColor}
                    oninput={(e) => {
                      sidebarColor = (e.currentTarget as HTMLInputElement).value;
                      scheduleSaveOverview();
                    }}
                  />
                </div>
              </div>
              <div class="settings-color-field">
                <label class="settings-label" for="mention-color">Mention highlight</label>
                <div class="settings-color-input">
                  <input id="mention-color" type="color" bind:value={mentionColor} aria-label="Mention highlight color" oninput={() => scheduleSaveOverview()} />
                  <input
                    class="input input--compact"
                    value={mentionColor}
                    oninput={(e) => {
                      mentionColor = (e.currentTarget as HTMLInputElement).value;
                      scheduleSaveOverview();
                    }}
                  />
                </div>
              </div>
            </div>
            <div
              class="settings-theme-preview"
              style={`--preview-accent:${accentColor}; --preview-sidebar:${sidebarColor}; --preview-mention:${mentionColor};`}
            >
              <div class="settings-theme-preview__sidebar">
                <span class="dot" style={`background:${accentColor};`}></span>
                <span class="line"></span>
              </div>
              <div class="settings-theme-preview__chat">
                <div class={`bubble bubble--${chatBubbleShape}`}>
                  <span class="name">You</span>
                  <span class="message">Looks good!</span>
                </div>
                <div class="bubble bubble--mention">
                  <span class="name">Maya</span>
                  <span class="message">@you let's ship it!</span>
                </div>
              </div>
            </div>
            <div class="settings-actions">
              <button type="button" class="btn btn-primary h-10 px-5" onclick={saveOverview}>Save changes</button>
            </div>
          </div>

          <div class="settings-card">
            <div>
              <div class="settings-card__title">Chat behavior</div>
              <div class="settings-card__subtitle">Control pacing, mentions, and reactions.</div>
            </div>
            <div class="settings-grid settings-grid--two">
              <div class="settings-toggle">
                <label class="settings-switch">
                  <input type="checkbox" bind:checked={chatHighlightMentions} onchange={() => scheduleSaveOverview()} />
                  <span>Highlight @mentions</span>
                </label>
                <p class="settings-caption">Adds a high contrast badge using your mention color.</p>
              </div>
              <div class="settings-toggle">
                <label class="settings-switch">
                  <input type="checkbox" bind:checked={chatAllowReactions} onchange={() => scheduleSaveOverview()} />
                  <span>Allow message reactions</span>
                </label>
                <p class="settings-caption">Give members emoji reactions to keep threads tidy.</p>
              </div>
              <div class="settings-toggle">
                <label class="settings-switch">
                  <input type="checkbox" bind:checked={chatAllowThreads} onchange={() => scheduleSaveOverview()} />
                  <span>Enable threaded replies</span>
                </label>
                <p class="settings-caption">Let side conversations live in thread bubbles.</p>
              </div>
              <div class="settings-toggle">
                <label class="settings-switch">
                  <input type="checkbox" bind:checked={chatShowJoinMessages} onchange={() => scheduleSaveOverview()} />
                  <span>Show join / leave notices</span>
                </label>
                <p class="settings-caption">Drop a lightweight banner when teammates come and go.</p>
              </div>
              <div>
                <label class="settings-label" for="chat-density">Chat density</label>
                <div class="settings-chip-row">
                  <button
                    type="button"
                    class:active-chip={chatDensity === 'cozy'}
                    onclick={() => {
                      chatDensity = 'cozy';
                      scheduleSaveOverview();
                    }}
                  >
                    Cozy
                  </button>
                  <button
                    type="button"
                    class:active-chip={chatDensity === 'compact'}
                    onclick={() => {
                      chatDensity = 'compact';
                      scheduleSaveOverview();
                    }}
                  >
                    Compact
                  </button>
                </div>
                <p class="settings-caption">Compact mode tightens up message spacing.</p>
              </div>
              <div>
                <label class="settings-label" for="slow-mode">Slow mode (seconds)</label>
                <div class="settings-slowmode">
                  <input
                    id="slow-mode"
                    type="range"
                    min="0"
                    max="300"
                    step="5"
                    value={chatSlowModeSeconds}
                    oninput={(e) => {
                      chatSlowModeSeconds = Number((e.currentTarget as HTMLInputElement).value);
                      scheduleSaveOverview();
                    }}
                  />
                  <input
                    class="input input--compact w-20"
                    type="number"
                    min="0"
                    max="300"
                    step="5"
                    bind:value={chatSlowModeSeconds}
                    oninput={() => scheduleSaveOverview()}
                  />
                </div>
                <p class="settings-caption">
                  {chatSlowModeSeconds === 0 ? 'Off' : `Members can post every ${chatSlowModeSeconds}s`}
                </p>
              </div>
            </div>
          </div>
        </div>
    {/if}

    {#if tab === 'insights'}
      <div class="settings-card settings-card--muted">
        <div>
          <div class="settings-card__title">Server Insights</div>
          <div class="settings-card__subtitle">Engagement, retention, and growth dashboards are on the way.</div>
        </div>
        <div class="mt-3 rounded-xl border border-dashed border-[color:var(--color-border-subtle)] bg-white/5 p-4 text-white/70">
          Coming soon - we are building a single view for online presence, active channels, and message velocity.
</div>
      </div>
    {/if}

    {#if tab === 'engagement'}
      <div class="settings-card settings-card--muted">
        <div>
          <div class="settings-card__title">Engagement</div>
          <div class="settings-card__subtitle">Plan campaigns, spot drop-offs, and celebrate streaks.</div>
        </div>
        <div class="mt-3 rounded-xl border border-dashed border-[color:var(--color-border-subtle)] bg-white/5 p-4 text-white/70">
          Coming soon - polls, event nudges, and channel health scoring will live here.
</div>
      </div>
    {/if}
      <!-- members -->
            {#if tab === 'members'}
                <!-- current members list -->
        <div class="settings-card space-y-4">
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div class="flex flex-1 flex-wrap gap-2">
              <input
                class="input input--compact flex-1 min-w-[220px]"
                placeholder="Search members by name or email"
                bind:value={memberSearch}
              />
              <div class="settings-toolbar__filters">
                <button type="button" class:active-filter={memberRoleFilter === 'all'} onclick={() => (memberRoleFilter = 'all')}>
                  All
                </button>
                <button type="button" class:active-filter={memberRoleFilter === 'owner'} onclick={() => (memberRoleFilter = 'owner')}>
                  Owners
                </button>
                <button type="button" class:active-filter={memberRoleFilter === 'admin'} onclick={() => (memberRoleFilter = 'admin')}>
                  Admins
                </button>
                <button type="button" class:active-filter={memberRoleFilter === 'custom'} onclick={() => (memberRoleFilter = 'custom')}>
                  With roles
                </button>
              </div>
            </div>
            <div class="text-xs text-white/60">Hover the last column for actions.</div>
          </div>

          {#if !membersReady}
            <div class="text-white/60">Loading members...</div>
          {:else if filteredMembers.length === 0}
            <div class="text-white/60">
              {#if members.length === 0}
                No members yet.
              {:else}
                No members match the current filters.
              {/if}
            </div>
          {:else}
            <div class="w-full overflow-visible">
              <div class="space-y-2">
                <div class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(110px,0.7fr)] gap-2 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">
                  <span>Member</span>
                  <span>Member since</span>
                  <span>Roles</span>
                  <span class="text-right pr-3">Actions</span>
                </div>
                {#each filteredMembers as m (m.uid)}
                    <div class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(110px,0.7fr)] items-center gap-2 rounded-lg px-2 py-2 hover:bg-white/5 relative">
                    <div class="flex items-center gap-3 min-w-0">
                      <img
                        src={m.photoURL || ''}
                        alt=""
                        class="h-9 w-9 rounded-full bg-white/10"
                        onerror={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                      />
                      <div class="min-w-0">
                        <div class="truncate font-medium">{m.displayName || m.uid}</div>
                        {#if m.email}<div class="text-xs text-white/50 truncate">{m.email}</div>{/if}
                      </div>
                    </div>
                    <div class="text-sm text-white/70">{formatSince(m.createdAt ?? m.joinedAt ?? m.addedAt)}</div>
                    <div class="flex flex-nowrap items-center gap-2 text-xs overflow-x-auto">
                      {#if Array.isArray(m.roleIds) && m.roleIds.length}
                        {@const roles = resolveMemberRoles(m)}
                        {#if roles.length === 0}
                          <span class="rounded-full bg-white/5 px-2 py-1 text-white/60">Default</span>
                        {:else}
                          {#each roles.slice(0, 2) as role (role.id)}
                            <span class="rounded-full bg-white/10 px-2 py-1 text-white/80 whitespace-nowrap shrink-0">{role.name}</span>
                          {/each}
                          {#if roles.length > 2}
                            <span class="rounded-full bg-white/10 px-2 py-1 text-white/70 whitespace-nowrap shrink-0">+{roles.length - 2}</span>
                          {/if}
                        {/if}
                      {:else}
                        <span class="rounded-full bg-white/5 px-2 py-1 text-white/60">Default</span>
                      {/if}
                    </div>
                    <div class="flex items-center justify-end gap-2">
                      {#if assignableRoles.length > 0 && isAdmin}
                        <button
                          class="settings-chip-btn"
                          aria-label="Add roles"
                          onclick={(event) => {
                            event.stopPropagation();
                            roleAssignTarget = m;
                            roleAssignModalOpen = true;
                          }}
                        >
                          <i class="bx bx-plus" aria-hidden="true"></i>
                        </button>
                      {/if}
                      <div class="relative">
                        <button
                          class="settings-chip-btn"
                          aria-label="Member actions"
                          onclick={(event) => {
                            event.stopPropagation();
                            memberMenuOpenFor = memberMenuOpenFor === m.uid ? null : m.uid;
                          }}
                        >
                          <i class="bx bx-dots-horizontal-rounded" aria-hidden="true"></i>
                        </button>
                        {#if memberMenuOpenFor === m.uid}
                          <div
                            class="settings-popover"
                            role="menu"
                            tabindex="-1"
                            onclick={(event) => event.stopPropagation()}
                            onkeydown={(event) => event.stopPropagation()}
                          >
                            <button type="button" class="settings-popover__item" disabled>Profile (soon)</button>
                            <button type="button" class="settings-popover__item" disabled>Message (soon)</button>
                            <button
                              type="button"
                              class="settings-popover__item"
                              onclick={() => kick(m.uid)}
                              disabled={!isAdmin}
                            >
                              Kick
                            </button>
                            <button
                              type="button"
                              class="settings-popover__item text-red-300 hover:bg-red-900/30"
                              onclick={() => ban(m.uid)}
                              disabled={!isAdmin}
                            >
                              Ban
                            </button>
                            <button type="button" class="settings-popover__item" disabled>Transfer ownership (soon)</button>
                          </div>
                        {/if}
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/if}
      <!-- channels -->
            {#if tab === 'channels'}
        <div class="settings-card flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div class="settings-card__title">Channels</div>
            <div class="settings-card__subtitle">Create, reorder, and edit channel permissions.</div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-primary"
              disabled={!isAdmin}
              onclick={() => {
                channelModalOpen = true;
                newChannelType = 'text';
                newChannelName = '';
                newChannelPrivate = false;
                newChannelAllowedRoleIds = [];
                channelError = null;
              }}
            >
              Create channel
            </button>
            <button
              type="button"
              class="btn btn-ghost"
              disabled={!canManageChannels}
              onclick={() => {
                manageChannelsOpen = true;
                channelDragId = null;
                channelHoverId = null;
              }}
            >
              Manage channels
            </button>
          </div>
        </div>

      {/if}      {#if tab === 'roles'}
        <div class="settings-card flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div class="settings-card__subtitle">Default permissions, display, and member assignment.</div>
          <div class="flex w-full items-center gap-2 lg:flex-1">
            <input
              class="input input--compact flex-1 min-w-[220px]"
              placeholder="Search roles"
              bind:value={roleSearch}
            />
            <button
              type="button"
              class="btn btn-primary btn-sm whitespace-nowrap"
              disabled={!(isOwner || isAdmin)}
              onclick={openRoleModal}
            >
              New role
            </button>
          </div>
        </div>

        <div
          class="settings-card settings-card--muted space-y-2 p-4 cursor-pointer"
          role="button"
          tabindex="0"
          onclick={(event) => {
            event.stopPropagation();
            if (!defaultRoleTarget) return;
            roleDetailId = defaultRoleTarget.id;
            roleDetailSection = 'permissions';
            roleDetailModalOpen = true;
          }}
          onkeydown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && defaultRoleTarget) {
              e.preventDefault();
              roleDetailId = defaultRoleTarget.id;
              roleDetailSection = 'permissions';
              roleDetailModalOpen = true;
            }
          }}
        >
          <div class="settings-card__title text-sm">Default permissions</div>
          <p class="settings-card__subtitle text-xs">Everyone inherits this baseline role.</p>
          <div class="flex flex-wrap items-center gap-3 text-sm text-white/70">
            <span class="rounded-full bg-white/10 px-3 py-1">{defaultRoleTarget?.name ?? 'Everyone'}</span>
            <span>{countEnabledPerms((defaultRoleTarget ?? { permissions: {} }) as Role)} permissions</span>
            <span class="text-xs text-white/60">Click to edit</span>
          </div>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <select
              class="input input--compact flex-1 min-w-[180px]"
              bind:value={defaultRoleSelection}
              disabled={!(isOwner || isAdmin) || defaultRoleSaveBusy}
              onclick={(event) => event.stopPropagation()}
              onchange={() => (defaultRoleError = null)}
            >
              <option value="">Select a role</option>
              {#each sortedRoles.filter((r) => !r.isOwnerRole) as role}
                <option value={role.id} selected={role.id === serverDefaultRoleId}>
                  {role.name}{role.id === serverDefaultRoleId ? ' (current)' : ''}
                </option>
              {/each}
            </select>
            <button
              type="button"
              class="btn btn-secondary btn-sm whitespace-nowrap"
              disabled={!(isOwner || isAdmin) || defaultRoleSaveBusy || !defaultRoleSelection}
              onclick={(event) => {
                event.stopPropagation();
                void saveDefaultRole();
              }}
            >
              {defaultRoleSaveBusy ? 'Saving…' : 'Set default role'}
            </button>
          </div>
          {#if defaultRoleError}
            <p class="text-xs text-red-300">{defaultRoleError}</p>
          {/if}
        </div>

        {#if roleError}
          <p class="settings-status settings-status--error">{roleError}</p>
        {/if}

        {#if filteredRoles.length === 0}
          <div class="settings-card text-white/60">No roles match your search.</div>
        {:else}
          <div class="space-y-2">
            {#each filteredRoles as role, index (role.id)}
              <div class="settings-role-card">
                <button
                  type="button"
                  class="settings-role-summary"
                  aria-expanded="false"
                  onclick={(event) => {
                    event.stopPropagation();
                    roleDetailId = role.id;
                    roleDetailSection = 'display';
                    roleDetailModalOpen = true;
                  }}
                >
                  <span class="settings-role-summary__left">
                    <span
                      class="settings-role-summary__swatch"
                      style={`background:${role.color ?? '#5865f2'}`}
                    ></span>
                    <span class="settings-role-summary__name">{role.name}</span>
                  </span>
                  <span class="settings-role-summary__meta">
                    {countEnabledPerms(role)} / {rolePermissionOptions.length} permissions
                  </span>
                </button>
              </div>
            {/each}
          </div>
        {/if}
      {/if}{#if tab === 'invites'}
        <div class="settings-card settings-invite relative">
          <div class="settings-invite__row">
            <div class="settings-invite__icon">
              <i class="bx bx-user-plus text-xl" aria-hidden="true"></i>
            </div>
            <input
              class="input input--compact settings-invite__input"
              placeholder="Invite people by name, email, or UID"
              bind:value={search}
            />
          </div>

          {#if q}
            <div class="settings-invite__results settings-invite__results--overlay">
              {#if filtered.length === 0}
                <div class="settings-invite__empty">No users match your search.</div>
              {:else}
                {#each filtered as r (r.uid)}
                  <div class="settings-invite__results-row">
                    <img
                      src={r.photoURL || ''}
                      alt=""
                      class="settings-invite__avatar"
                      onerror={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                    />
                    <div class="flex-1 min-w-0">
                      <div class="truncate">{r.displayName || r.email || r.uid}</div>
                      {#if r.email}<div class="text-xs text-soft truncate">{r.email}</div>{/if}
                    </div>
                    {#if isOwner || isAdmin}
                      <button
                        class="btn btn-primary btn-sm"
                        disabled={
                          !isOwner || !!pendingInvitesByUid[r.uid] || !!inviteLoading[r.uid]
                        }
                        title={pendingInvitesByUid[r.uid] ? 'Invite already pending' : undefined}
                        onclick={() => inviteUser(r.uid)}
                      >
                        {#if pendingInvitesByUid[r.uid]}
                          Pending
                        {:else if inviteLoading[r.uid]}
                          Sending...
                        {:else}
                          Invite
                        {/if}
                      </button>
                    {/if}
                  </div>
                {/each}
              {/if}
            </div>
          {/if}

          {#if inviteError}
            <div class="settings-alert settings-alert--error">{inviteError}</div>
          {/if}

          {#if (isOwner || isAdmin) && !isOwner}
            <div class="settings-caption">Only the channel owner can send invites under current rules.</div>
          {/if}
        </div>

        <div class="settings-card space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="settings-card__title">Pending invites</div>
              <div class="settings-card__subtitle">Members who have not accepted yet.</div>
            </div>
            <div class="flex items-center gap-2 text-sm text-white/70">
              <span>{pendingInvites.length} pending</span>
              {#if (isOwner || isAdmin) && pendingInvites.length}
                <button
                  class="btn btn-danger btn-sm"
                  disabled={clearInvitesBusy}
                  onclick={clearPendingInvites}
                >
                  {clearInvitesBusy ? 'Clearing...' : 'Clear invites'}
                </button>
              {/if}
            </div>
          </div>

          {#if pendingInvites.length === 0}
            <div class="text-white/60">No pending invites.</div>
          {:else}
            <ul class="space-y-2">
              {#each pendingInvites as invite (invite.id ?? invite.toUid)}
                {@const profile = profileForInvite(invite.toUid)}
                <li class="p-2 rounded bg-white/5">
                  <div class="settings-member-row">
                    <img
                      src={profile?.photoURL || ''}
                      alt=""
                      class="h-10 w-10 rounded-full bg-white/10"
                      onerror={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                    />
                    <div class="flex-1 min-w-0">
                      <div class="truncate font-medium">
                        {profile?.displayName || profile?.email || invite.toUid}
                      </div>
                      <div class="text-xs text-white/60 truncate">
                        {#if profile?.email}{profile.email}{:else}No email on file{/if}
                        {#if invite.fromDisplayName}
                          &nbsp;- Invited by {invite.fromDisplayName}
                        {:else if invite.fromUid}
                          &nbsp;- Invited by {invite.fromUid}
                        {/if}
                      </div>
                    </div>
                    {#if isOwner || isAdmin}
                      <button
                        class="btn btn-danger btn-sm"
                        disabled={inviteCancelBusy[invite.id ?? `${serverId}__${invite.toUid}`]}
                        onclick={() => cancelInvite(invite)}
                      >
                        {inviteCancelBusy[invite.id ?? `${serverId}__${invite.toUid}`] ? 'Removing...' : 'Remove invite'}
                      </button>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
          {#if clearInvitesError}
            <div class="settings-alert settings-alert--error">{clearInvitesError}</div>
          {/if}
        </div>
      {/if}

      {#if tab === 'access'}
        <div class="settings-card settings-card--muted">
          <div>
            <div class="settings-card__title">Access</div>
            <div class="settings-card__subtitle">Role-based gates and per-surface overrides are coming soon.</div>
          </div>
          <div class="mt-3 rounded-xl border border-dashed border-[color:var(--color-border-subtle)] bg-white/5 p-4 text-white/70">
            We will centralize server-level permissions here so you can snapshot configs and roll back safely.
          </div>
        </div>
      {/if}

      {#if tab === 'integrations'}
        <div class="grid gap-4 lg:grid-cols-2">
          <div class="settings-card settings-card--muted">
            <div class="settings-card__title">Webhooks</div>
            <p class="settings-card__subtitle">Automate updates from your tools. Coming soon.</p>
          </div>
          <div class="settings-card settings-card--muted">
            <div class="settings-card__title">Bots</div>
            <p class="settings-card__subtitle">Bring assistants and helpers into channels. Coming soon.</p>
          </div>
          <button
            type="button"
            class="settings-card settings-card--muted text-left hover:border-[color:var(--color-accent)] transition"
            onclick={() => (ticketAiModalOpen = true)}
          >
            <div class="flex items-center justify-between">
              <div>
                <div class="settings-card__title">Ticket AI (Issue analytics)</div>
                <p class="settings-card__subtitle">Monitor issue threads and export response metrics.</p>
              </div>
              <span class="text-xs uppercase tracking-[0.2em] text-emerald-300">New</span>
            </div>
          </button>
          <button
            type="button"
            class="settings-card settings-card--muted text-left hover:border-[color:var(--color-accent)] transition"
            onclick={() => (domainModalOpen = true)}
          >
            <div class="flex items-center justify-between">
              <div>
                <div class="settings-card__title">Domain auto invites</div>
                <p class="settings-card__subtitle">Automatically welcome matching emails.</p>
              </div>
              <span class={`text-sm ${inviteAutomationEnabled ? 'text-emerald-400' : 'text-white/60'}`}>
                {inviteAutomationEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </button>
        </div>
      {/if}

      {#if tab === 'audit-log'}
        <div class="settings-card settings-card--muted">
          <div class="settings-card__title">Audit log</div>
          <p class="settings-card__subtitle">A searchable timeline of actions is coming soon.</p>
        </div>
      {/if}

      {#if tab === 'bans'}
        <div class="settings-card settings-card--muted space-y-3">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div class="settings-card__title">Bans</div>
              <div class="settings-card__subtitle">Manage banned members.</div>
            </div>
            <div class="flex items-center gap-2">
              <input
                class="input input--compact w-48"
                placeholder="Search bans"
                bind:value={banSearch}
              />
            </div>
          </div>
          {#if filteredBans.length === 0}
            <div class="text-white/60">No banned users.</div>
          {/if}
          {#each filteredBans as b (b.uid)}
            <div class="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-white/10">
              <div>
                <div class="font-medium">{b.uid}</div>
                {#if b.reason}<div class="text-xs text-white/60">Reason: {b.reason}</div>{/if}
              </div>
              {#if isOwner || isAdmin}
                <button class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                  onclick={() => unban(b.uid)}>Unban</button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

{#if tab === 'welcome'}
        <div class="settings-card settings-card--muted">
          <div class="settings-card__title">Welcome screen</div>
          <p class="settings-card__subtitle">Configure first-touch experiences for newcomers. Coming soon.</p>
        </div>
      {/if}
      <!-- danger -->
      {#if tab === 'danger'}
        <div class="settings-card settings-card--danger">
          <div>
            <div class="settings-card__title text-red-200">Danger Zone</div>
            <p class="settings-card__subtitle text-red-200/80">
              Deleting the server will remove channels, members, and bans. This cannot be undone.
            </p>
          </div>
          <div class="settings-danger-confirm">
            <label class="settings-label" for="delete-confirm">Type <code>Confirm</code> to authorize deletion</label>
            <input
              id="delete-confirm"
              class="input input--danger"
              placeholder="Confirm"
              bind:value={deleteConfirm}
            />
          </div>
          {#if deleteError}
            <p class="settings-status settings-status--error">{deleteError}</p>
          {/if}
          <div class="settings-actions justify-start">
            <button
              class="btn btn-sm btn-danger"
              disabled={!isOwner || deleteBusy}
              onclick={deleteServer}
            >
              {deleteBusy ? 'Deleting...' : 'Delete Server'}
            </button>
            {#if !isOwner}
              <span class="settings-caption text-red-200/85">Only the owner can delete the server.</span>
            {/if}
          </div>
        </div>
      {/if}
          </div> <!-- settings-main -->
        </div> <!-- settings-body -->
      </div> <!-- settings-container -->
    </div> <!-- settings-shell -->
  </div> <!-- workspace -->
{/if}

<style>
  .settings-shell {
    min-height: 100dvh;
    height: 100dvh;
    background: var(--color-app-bg);
    color: var(--color-text-primary);
    padding-bottom: max(env(safe-area-inset-bottom), 4rem);
    --preview-accent: var(--server-accent, var(--color-accent));
    --preview-sidebar: var(--server-sidebar, var(--color-panel));
    --preview-mention: var(--server-mention, #f97316);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .settings-container {
    width: min(100%, 1100px);
    margin: 0 auto;
    padding: clamp(1.25rem, 4vw, 2.5rem) clamp(1rem, 6vw, 3rem);
    display: flex;
    flex-direction: column;
    gap: clamp(1rem, 2.5vw, 1.75rem);
  }

  .settings-header-alt {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
    box-shadow: var(--shadow-elevated);
    flex-wrap: wrap;
  }

  .settings-header-alt__left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .settings-header-alt__badge {
    font-size: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: color-mix(in srgb, var(--color-accent) 95%, white);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
  }

  .settings-header-alt .settings-back {
    position: static;
  }

  .settings-eyebrow {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    font-size: 0.7rem;
    color: var(--text-70);
  }

  .settings-body {
    display: grid;
    gap: 1.5rem;
    align-items: start;
    min-height: 0;
  }

  .settings-rail {
    position: sticky;
    top: clamp(0.75rem, 3vw, 1.25rem);
    align-self: start;
    background: color-mix(in srgb, var(--color-panel) 95%, transparent);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    padding: 0.75rem;
    box-shadow: var(--shadow-elevated);
  }

  .settings-rail__group {
    padding: 0.25rem 0 0.75rem;
  }

  .settings-rail__label {
    margin: 0 0 0.35rem;
    padding: 0 0.35rem;
    font-size: 0.68rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--text-70);
  }

  .settings-rail__items {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .settings-rail__item {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    border-radius: var(--radius-md);
    padding: 0.55rem 0.65rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    background: transparent;
    color: var(--color-text-secondary);
    transition: background 140ms ease, border 140ms ease, transform 140ms ease;
  }

  .settings-rail__item:hover {
    background: color-mix(in srgb, var(--color-panel-muted) 65%, transparent);
    color: var(--color-text-primary);
    border-color: color-mix(in srgb, var(--color-border-subtle) 85%, transparent);
  }

  .settings-rail__item.is-active {
    color: var(--color-text-primary);
    border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 8px 20px rgba(0, 0, 0, 0.25);
    background: color-mix(in srgb, var(--color-panel-muted) 85%, transparent);
  }

  .settings-rail__item-left {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    flex: 1;
  }

  .settings-rail__item-meta {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .settings-rail__icon {
    width: 36px;
    height: 36px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-panel-muted) 80%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .settings-rail__dot {
    width: 9px;
    height: 9px;
    border-radius: 999px;
    background: var(--color-accent);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 30%, transparent);
  }

  .settings-rail__soon {
    font-size: 0.68rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    padding: 0.25rem 0.45rem;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--color-border-subtle) 20%, transparent);
    color: var(--text-70);
  }

  .settings-chip-btn {
    width: 34px;
    height: 34px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    background: color-mix(in srgb, var(--color-panel) 80%, transparent);
    color: var(--color-text-primary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .settings-chip-btn:hover {
    background: color-mix(in srgb, var(--color-panel-muted) 85%, transparent);
    border-color: color-mix(in srgb, var(--color-border-subtle) 85%, transparent);
  }

  .settings-chip-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .settings-popover {
    position: absolute;
    right: 0;
    margin-top: 0.35rem;
    background: color-mix(in srgb, var(--color-panel) 98%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
    border-radius: var(--radius-lg);
    min-width: 190px;
    box-shadow: var(--shadow-elevated);
    padding: 4px;
    z-index: 50;
  }

  .settings-popover__item {
    width: 100%;
    text-align: left;
    padding: 0.55rem 0.65rem;
    border-radius: var(--radius-md);
    border: none;
    background: transparent;
    color: var(--color-text-primary);
  }

  .settings-popover__item:hover:enabled,
  .settings-popover__item:focus-visible {
    background: color-mix(in srgb, var(--color-panel-muted) 75%, transparent);
    outline: none;
  }

  .settings-role-popover {
    grid-column: 1 / -1;
    position: absolute;
    right: 0;
    top: 100%;
    margin-top: 0.35rem;
    padding: 0.65rem;
    border-radius: var(--radius-lg);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    box-shadow: var(--shadow-elevated);
  }

  .settings-chip--full {
    width: 100%;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .settings-channel-type {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.6rem 0.7rem;
    border-radius: var(--radius-md);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    background: color-mix(in srgb, var(--color-panel-muted) 65%, transparent);
  }

  .settings-channel-type.is-active {
    border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
  }

  .settings-channel-type.is-disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .settings-role-member-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-panel-muted) 80%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
  }

  .settings-role-member-chip button {
    border: none;
    background: transparent;
    color: inherit;
    display: inline-flex;
    align-items: center;
  }

  .settings-role-member-chip--more {
    color: rgba(255, 255, 255, 0.75);
  }

  .settings-header {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: center;
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-panel) 94%, transparent);
    border: 1px solid var(--color-border-subtle);
    box-shadow: var(--shadow-elevated);
    padding: clamp(1.25rem, 2.8vw, 1.75rem);
    position: relative;
  }

  .settings-heading {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.35rem;
  }

  @media (min-width: 640px) {
    .settings-header {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
  }

  .settings-back {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 78%, transparent);
    color: var(--color-text-primary);
    display: grid;
    place-items: center;
    transition: background 150ms ease, border 150ms ease, transform 150ms ease;
    position: absolute;
    left: clamp(0.6rem, 1.5vw, 1rem);
    top: clamp(0.6rem, 1.5vw, 1rem);
  }

  .settings-back:hover {
    background: color-mix(in srgb, var(--color-panel) 86%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
    transform: translateY(-1px);
  }

  .settings-heading h1 {
    margin: 0;
    font-size: clamp(1.6rem, 3vw, 2.2rem);
    font-weight: 600;
  }

  .settings-heading p {
    margin: 0.3rem 0 0;
    font-size: 0.95rem;
    color: var(--text-60);
    max-width: 48ch;
    text-align: center;
  }

  .settings-tabbar {
    display: flex;
    gap: 0.45rem;
    overflow-x: auto;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--color-panel) 84%, transparent);
    border: 1px solid var(--color-border-subtle);
    padding: 0.3rem;
    scroll-snap-type: x proximity;
    -webkit-overflow-scrolling: touch;
    margin: 0 auto;
    justify-content: flex-start;
    width: 100%;
    max-width: 100%;
    touch-action: pan-x;
  }

  .settings-tabbar::-webkit-scrollbar {
    display: none;
  }

  .settings-tabbar {
    scrollbar-width: none;
  }

  @media (min-width: 768px) {
    .settings-tabbar {
      justify-content: center;
    }
  }

  .settings-tab {
    border: 1px solid transparent;
    border-radius: var(--radius-pill);
    padding: 0.45rem 1.1rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-70);
    background: transparent;
    transition: background 150ms ease, color 150ms ease, border 150ms ease, box-shadow 150ms ease;
    white-space: nowrap;
    scroll-snap-align: start;
  }

  .settings-tab:is(:global(:hover, :focus-visible)) {
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
    color: var(--color-text-primary);
  }

  .settings-tab.is-active {
    background: var(--color-accent-soft);
    color: var(--color-accent-strong);
    border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
    box-shadow: 0 12px 24px rgba(51, 200, 191, 0.22);
  }

  .settings-stack {
    display: flex;
    flex-direction: column;
    gap: clamp(1rem, 2vw, 1.5rem);
  }

  .settings-card {
    background: color-mix(in srgb, var(--color-panel) 95%, transparent);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-elevated);
    padding: clamp(1.1rem, 2.4vw, 1.6rem);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .settings-card--muted {
    background: color-mix(in srgb, var(--color-panel-muted) 92%, transparent);
  }

  .settings-card--danger {
    background: color-mix(in srgb, var(--color-danger) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-danger) 45%, transparent);
    box-shadow: 0 18px 30px rgba(223, 95, 95, 0.25);
  }

  .settings-card__title {
    font-size: 0.95rem;
    font-weight: 600;
  }

  .settings-card__subtitle {
    font-size: 0.85rem;
    color: var(--text-60);
    margin-top: 0.2rem;
  }

  .settings-grid {
    display: grid;
    gap: clamp(1rem, 2vw, 1.5rem);
  }

  .settings-grid--two {
    grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
  }

  .settings-label {
    display: block;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-70);
    margin-bottom: 0.35rem;
  }

  .settings-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .settings-actions.justify-start {
    justify-content: flex-start;
  }

  .settings-invite {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .settings-invite__row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .settings-invite__icon {
    width: 2.6rem;
    height: 2.6rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 78%, transparent);
    color: var(--color-accent-strong);
    display: grid;
    place-items: center;
  }

  .settings-invite__input {
    flex: 1;
    min-width: 220px;
  }

  .settings-invite__results {
    max-height: 18rem;
    overflow-y: auto;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-panel) 90%, transparent);
  }

  .settings-invite__results--overlay {
    position: absolute;
    left: 0;
    right: 0;
    top: 84px;
    z-index: 10;
    box-shadow: var(--shadow-elevated);
  }

  .settings-invite__results::-webkit-scrollbar {
    width: 6px;
  }

  .settings-invite__results::-webkit-scrollbar-track {
    background: transparent;
  }

  .settings-invite__results::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
    border-radius: 9999px;
  }

  .settings-invite__results-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.85rem;
    transition: background 150ms ease;
  }

  .settings-invite__results-row:hover {
    background: color-mix(in srgb, var(--color-panel) 85%, transparent);
  }

  .settings-invite__avatar {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--radius-pill);
    object-fit: cover;
    background: color-mix(in srgb, var(--color-panel-muted) 80%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 75%, transparent);
  }

  .settings-invite__empty {
    padding: 0.75rem 0.85rem;
    font-size: 0.85rem;
    color: var(--text-60);
  }

  .settings-alert {
    border-radius: var(--radius-md);
    padding: 0.65rem 0.85rem;
    font-size: 0.8rem;
  }

  .settings-alert--error {
    background: color-mix(in srgb, var(--color-danger) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-danger) 45%, transparent);
    color: color-mix(in srgb, var(--color-danger) 75%, white);
  }

  .settings-caption {
    font-size: 0.72rem;
    color: var(--text-60);
  }

  .settings-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 85%, transparent);
    background: color-mix(in srgb, var(--color-panel) 88%, transparent);
    padding: 0.45rem 0.8rem;
    font-size: 0.75rem;
    color: var(--text-70);
  }

  .btn-sm {
    padding: 0.45rem 0.85rem;
    font-size: 0.8rem;
    border-radius: var(--radius-pill);
    line-height: 1;
    min-height: 0;
  }

  .settings-card--danger .btn-sm {
    background: var(--color-danger);
    border-color: color-mix(in srgb, var(--color-danger) 60%, transparent);
    color: var(--color-text-inverse);
  }

  .settings-card--danger .btn-sm:hover {
    background: color-mix(in srgb, var(--color-danger) 85%, transparent);
    color: var(--color-text-inverse);
  }

  .settings-member-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .settings-member-row__actions,
  .settings-member-row__moderation {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .settings-channel-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .settings-channel-row__actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .settings-channel-lock {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3rem;
    height: 1.3rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.09);
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.7rem;
  }

  .settings-color-field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .settings-color-input {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .settings-color-input .input--compact,
  .settings-color-input .input {
    width: 7rem;
  }

  .settings-theme-preview {
    display: flex;
    gap: 1.4rem;
    align-items: center;
    border-radius: var(--radius-lg);
    border: 1px dashed var(--color-border-subtle);
    padding: 1rem;
    background: color-mix(in srgb, var(--preview-sidebar, #13171d) 72%, transparent);
  }

  .settings-theme-preview__sidebar {
    width: min(44%, 160px);
    min-height: 92px;
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--preview-sidebar, #13171d) 92%, transparent);
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .settings-theme-preview__sidebar .dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: var(--preview-accent, #33c8bf);
  }

  .settings-theme-preview__sidebar .line {
    height: 6px;
    width: 70%;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.3);
  }

  .settings-theme-preview__chat {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex: 1;
  }

  .bubble {
    display: inline-flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.6rem 0.85rem;
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--preview-accent, #33c8bf) 24%, transparent);
    color: white;
    width: fit-content;
    max-width: 220px;
  }

  .bubble--pill {
    border-radius: 999px;
  }

  .bubble--minimal {
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--preview-accent, #33c8bf) 12%, transparent);
  }

  .bubble--mention {
    background: color-mix(in srgb, var(--preview-mention, #f97316) 30%, transparent);
  }

  .bubble .name {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.75;
  }

  .bubble .message {
    font-size: 0.85rem;
    font-weight: 500;
  }

  .settings-domain-grid {
    display: grid;
    gap: 1.25rem;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .settings-domain-input {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .settings-domain-input .btn {
    white-space: nowrap;
  }

  .settings-domain-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.4rem;
  }

  .settings-domain-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.7rem;
    border-radius: 999px;
    font-size: 0.75rem;
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
    color: color-mix(in srgb, var(--color-accent) 85%, white);
  }

  .settings-domain-pill button {
    border: none;
    background: transparent;
    color: inherit;
    display: grid;
    place-items: center;
    padding: 0;
    cursor: pointer;
  }

  .settings-status {
    font-size: 0.8rem;
    border-radius: var(--radius-md);
    padding: 0.55rem 0.75rem;
    border: 1px solid transparent;
  }

  .settings-status--success {
    color: color-mix(in srgb, var(--color-accent) 90%, white);
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
  }

  .settings-status--error {
    color: rgba(248, 113, 113, 0.92);
    background: rgba(248, 113, 113, 0.12);
    border-color: rgba(248, 113, 113, 0.35);
  }

  .settings-actions--stack {
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .settings-actions--stack .btn {
    min-width: 160px;
  }

  .settings-chip-row {
    display: inline-flex;
    gap: 0.25rem;
    padding: 0.25rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 90%, transparent);
  }

  .settings-chip-row button {
    border: none;
    background: transparent;
    padding: 0.4rem 0.9rem;
    border-radius: var(--radius-pill);
    font-size: 0.85rem;
    color: var(--text-70);
  }

  .settings-chip-row button:hover {
    background: color-mix(in srgb, var(--color-panel) 82%, transparent);
  }

  .settings-chip-row button.active-chip {
    background: var(--color-accent-soft);
    color: var(--color-accent-strong);
  }

  .settings-slowmode {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .settings-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
  }

  .settings-toolbar__filters {
    display: inline-flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .settings-toolbar__filters button {
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
    color: var(--text-70);
    border-radius: var(--radius-pill);
    padding: 0.35rem 0.9rem;
    font-size: 0.8rem;
  }

  .settings-toolbar__filters button:hover {
    background: color-mix(in srgb, var(--color-panel) 86%, transparent);
  }

  .settings-toolbar__filters button.active-filter {
    border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
    background: var(--color-accent-soft);
    color: var(--color-accent-strong);
  }

  .settings-channel-create {
    gap: 0.75rem;
  }

  .settings-channel-form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .settings-channel-form__row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
  }

  .settings-channel-form__roles {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0 0.25rem 0.25rem;
  }

  .settings-channel-form__roles-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .settings-switch--inline {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 90%, transparent);
    font-size: 0.85rem;
  }

  .settings-switch--inline input {
    accent-color: var(--color-accent);
  }

  .settings-icon-btn {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 90%, transparent);
    color: var(--text-70);
    display: grid;
    place-items: center;
    transition: background 150ms ease, color 150ms ease, border 150ms ease;
  }

  .settings-icon-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-panel) 80%, transparent);
    color: var(--color-text-primary);
  }

  .settings-icon-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .settings-channel-row__reorder {
    display: flex;
    gap: 0.35rem;
  }

  .settings-role-card {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 90%, transparent);
    padding: 0.9rem clamp(0.9rem, 2vw, 1.1rem);
  }

  .settings-role-summary {
    border: none;
    background: transparent;
    color: inherit;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    justify-content: space-between;
    font-weight: 600;
    font-size: 0.95rem;
    padding: 0;
    cursor: pointer;
  }

  .settings-role-summary:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 3px;
  }

  .settings-role-summary__left {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }

  .settings-role-summary__swatch {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 999px;
    border: 2px solid rgba(255, 255, 255, 0.35);
  }

  .settings-role-summary__name {
    min-width: 0;
    max-width: 180px;
    text-align: left;
    display: inline-block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .settings-role-summary__meta {
    font-size: 0.75rem;
    color: var(--text-60);
    margin-left: auto;
    margin-right: 0.5rem;
    white-space: nowrap;
  }

  .settings-role-summary i {
    transition: transform 160ms ease;
    font-size: 1.1rem;
  }

  .settings-role-summary i.is-open {
    transform: rotate(180deg);
  }

  .settings-role-body {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .settings-role-header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    justify-content: space-between;
    align-items: center;
  }

  .settings-role-header__meta {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    min-width: 0;
  }

  .settings-role-name {
    font-size: 0.95rem;
    font-weight: 600;
    background: color-mix(in srgb, var(--color-panel) 88%, transparent);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    padding: 0.35rem 0.6rem;
    color: inherit;
    min-width: 140px;
  }

  .settings-role-name:disabled {
    opacity: 0.8;
  }

  .settings-role-color {
    width: 48px;
    height: 32px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: transparent;
  }

  .settings-role-header__actions {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }

  .settings-role-permissions {
    display: grid;
    gap: 0.6rem;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  }

  .settings-permission-groups {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .settings-permission-group {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    padding: 0.9rem;
    background: color-mix(in srgb, var(--color-panel) 88%, transparent);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.24);
  }

  .settings-permission-group__header {
    margin-bottom: 0.6rem;
  }

  .settings-permission-group__title {
    font-weight: 700;
    font-size: 0.95rem;
  }

  .settings-permission-group__description {
    font-size: 0.82rem;
    color: var(--text-70);
    margin: 0.15rem 0 0;
  }

  .settings-permission {
    display: flex;
    gap: 0.55rem;
    align-items: flex-start;
    font-size: 0.85rem;
    background: color-mix(in srgb, var(--color-panel) 88%, transparent);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    padding: 0.6rem 0.8rem;
  }

  .settings-permission input {
    margin-top: 0.2rem;
  }

  .settings-permission strong {
    display: block;
    font-size: 0.85rem;
    color: var(--color-text-primary);
  }

  .settings-permission small {
    display: block;
    font-size: 0.75rem;
    color: var(--text-60);
  }

  .settings-role-permissions__hint {
    font-size: 0.8rem;
    color: var(--text-60);
    margin-top: 0.25rem;
  }

  .settings-role-header__tagline {
    font-size: 0.75rem;
    color: var(--text-60);
  }

  .settings-role-create {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    justify-content: flex-end;
    width: 100%;
  }

  .role-modal-backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--color-app-overlay, rgba(0, 0, 0, 0.55)) 80%, transparent);
    display: grid;
    place-items: center;
    z-index: 60;
    padding: 16px;
  }

  .role-modal {
    background: var(--color-panel);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    padding: 20px clamp(18px, 2vw, 22px);
    width: min(480px, 100%);
    box-shadow: var(--shadow-elevated, 0 20px 80px rgba(0, 0, 0, 0.45));
    animation: pop 140ms ease-out;
    display: grid;
    gap: 14px;
  }

  .role-modal--wide {
    width: min(720px, 100%);
    max-height: 85vh;
    display: flex;
    flex-direction: column;
  }
  .role-modal--mid {
    width: min(460px, 92vw);
    max-height: min(80vh, 720px);
    overflow-y: auto;
  }

  .role-modal__scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
    display: grid;
    gap: 14px;
  }

  @keyframes pop {
    0% {
      transform: scale(0.94) translateY(8px);
      opacity: 0;
    }
    100% {
      transform: scale(1) translateY(0);
      opacity: 1;
    }
  }

  .role-modal__header h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .role-modal__field {
    display: grid;
    gap: 6px;
    color: var(--color-text-primary);
  }

  .role-modal__field span {
    font-size: 13px;
    color: var(--text-70);
  }

  .role-modal__field--inline {
    grid-template-columns: auto 80px;
    align-items: center;
    gap: 10px;
  }

  .role-modal__input {
    width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    color: var(--color-text-primary);
  }

  .role-modal__color {
    width: 100%;
    height: 40px;
    border-radius: 8px;
    background: var(--input-bg);
    border: 1px solid var(--input-border);
  }

  .role-modal__actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 6px;
  }

  .btn.primary {
    background: var(--button-primary-bg, #5865f2);
    color: var(--button-primary-text, #ffffff);
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--button-primary-hover, #4955d4);
  }

  .btn.ghost {
    background: var(--button-ghost-bg, rgba(255, 255, 255, 0.08));
    border: 1px solid var(--button-ghost-border, rgba(255, 255, 255, 0.12));
    color: var(--button-ghost-text, var(--color-text-primary));
  }

  .btn-danger {
    background: rgba(248, 113, 113, 0.18);
    border: 1px solid rgba(248, 113, 113, 0.45);
    color: #f87171;
  }

  .btn-danger:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.28);
    border-color: rgba(248, 113, 113, 0.55);
  }

  .input--danger {
    border: 1px solid rgba(248, 113, 113, 0.45);
    background: rgba(248, 113, 113, 0.08);
  }

  .settings-danger-confirm {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .settings-danger-confirm code {
    background: rgba(248, 113, 113, 0.16);
    color: #fca5a5;
    padding: 0.15rem 0.35rem;
    border-radius: var(--radius-sm);
  }

  @media (max-width: 560px) {
    .settings-container {
      padding: 1.25rem clamp(0.85rem, 6vw, 1.4rem);
    }

    .settings-header {
      padding: 1.1rem;
      border-radius: var(--radius-md);
    }

    .settings-heading {
      text-align: center;
    }

    .settings-heading h1 {
      font-size: 1.45rem;
    }

    .settings-heading p {
      font-size: 0.85rem;
    }

    .settings-tab {
      padding: 0.4rem 0.85rem;
      font-size: 0.82rem;
    }

    .settings-card {
      padding: 1.05rem;
      border-radius: var(--radius-md);
    }

    .settings-invite__row {
      align-items: stretch;
    }

    .settings-invite__input {
      min-width: 100%;
    }

    .settings-member-row {
      align-items: flex-start;
      gap: 0.9rem;
    }

    .settings-toolbar {
      gap: 0.6rem;
    }

    .settings-toolbar__filters {
      width: 100%;
    }

    .settings-toolbar__filters button {
      flex: 1 1 45%;
      justify-content: center;
    }

    .settings-chip-row {
      width: 100%;
      justify-content: space-between;
    }

    .settings-member-row__actions,
    .settings-member-row__moderation,
    .settings-channel-row__actions {
      width: 100%;
      justify-content: flex-start;
    }

    .settings-channel-row {
      align-items: flex-start;
      gap: 0.9rem;
    }

    .settings-theme-preview {
      flex-direction: column;
      align-items: stretch;
    }

    .settings-channel-form__row {
      flex-direction: column;
      align-items: stretch;
    }

    .settings-channel-form__row .btn {
      width: 100%;
    }

    .settings-role-card {
      border-radius: var(--radius-md);
    }

    .settings-actions {
      justify-content: center;
    }

    .settings-actions--stack .btn {
      width: 100%;
    }

.settings-role-header {
    align-items: flex-start;
  }
}
</style>

{#if ticketAiModalOpen && serverId}
  <TicketAIModal
    open={ticketAiModalOpen}
    serverId={serverId}
    serverName={serverName}
    channels={channels}
    roles={roles}
    currentUserId={$user?.uid ?? null}
    members={membersWithProfiles}
    on:close={() => (ticketAiModalOpen = false)}
  />
{/if}

{#if channelModalOpen}
  <div
    class="role-modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="0"
    onclick={(event) => {
      if (event.target === event.currentTarget) channelModalOpen = false;
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        channelModalOpen = false;
      }
    }}
  >
    <form
      class="role-modal"
      aria-label="Create channel"
      onsubmit={preventDefault(createChannelInline)}
    >
      <div class="role-modal__header">
        <h3>Create a channel</h3>
        <button type="button" class="settings-chip-btn" aria-label="Close" onclick={() => (channelModalOpen = false)}>
          <i class="bx bx-x"></i>
        </button>
      </div>
      <div class="grid gap-2">
        {#each channelTypeOptions as option}
          <button
            type="button"
            class={`settings-channel-type ${newChannelType === option.id ? 'is-active' : ''} ${option.enabled ? '' : 'is-disabled'}`}
            disabled={!option.enabled}
            onclick={() => chooseChannelType(option.id)}
          >
            <div class="flex items-center gap-3 text-left">
              <span class="settings-rail__icon">
                <i class={`${option.icon}`} aria-hidden="true"></i>
              </span>
              <div class="min-w-0">
                <div class="font-semibold text-white truncate">{option.label}</div>
                <div class="text-xs text-white/60 truncate">{option.description}</div>
              </div>
            </div>
            {#if !option.enabled}<span class="settings-rail__soon">Soon</span>{/if}
          </button>
        {/each}
      </div>
      <label class="role-modal__field">
        <span>Channel name</span>
        <input class="role-modal__input" placeholder="general" bind:value={newChannelName} />
      </label>
      <label class="settings-switch settings-switch--inline">
        <input type="checkbox" bind:checked={newChannelPrivate} />
        <span>Make channel private</span>
      </label>
      {#if newChannelPrivate}
        <div class="space-y-2">
          <p class="text-xs text-white/70">Allowed roles</p>
          <div class="flex flex-wrap gap-2">
            {#each sortedRoles as role}
              <label class="settings-chip">
                <input
                  type="checkbox"
                  checked={newChannelAllowedRoleIds.includes(role.id)}
                  onchange={(event) => toggleNewChannelRole(role.id, (event.currentTarget as HTMLInputElement).checked)}
                />
                <span>{role.name}</span>
              </label>
            {/each}
          </div>
        </div>
      {/if}
      {#if channelError}
        <p class="settings-status settings-status--error">{channelError}</p>
      {/if}
      <div class="role-modal__actions">
        <button type="button" class="btn btn-ghost" onclick={() => (channelModalOpen = false)}>Cancel</button>
        <button
          type="submit"
          class="btn btn-primary"
          disabled={!newChannelName.trim() || channelCreateBusy}
        >
          {channelCreateBusy ? 'Creating...' : 'Create channel'}
        </button>
      </div>
    </form>
  </div>
{/if}

{#if manageChannelsOpen}
  <div
    class="role-modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="0"
    onclick={(event) => {
      if (event.target === event.currentTarget) {
        manageChannelsOpen = false;
        channelHoverId = null;
        channelDragId = null;
        closeChannelDetail();
      }
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        manageChannelsOpen = false;
        channelHoverId = null;
        channelDragId = null;
        closeChannelDetail();
      }
    }}
  >
    <div class="role-modal role-modal--mid">
      <div class="role-modal__header">
        <h3>Manage channels</h3>
        <button type="button" class="settings-chip-btn" aria-label="Close" onclick={() => (manageChannelsOpen = false)}>
          <i class="bx bx-x"></i>
        </button>
      </div>
      <p class="text-sm text-white/70">Drag to reorder, edit with the pencil, or delete.</p>
      <div class="space-y-2" role="list">
        {#each sortedChannels as c (c.id)}
          <div
            class={`flex items-center justify-between gap-3 rounded-lg border border-[color:var(--color-border-subtle)]/80 bg-white/5 px-3 py-2 transition duration-200 ease-out hover:-translate-y-0.5 hover:border-[color:var(--color-accent)] ${
              channelHoverId === c.id ? 'ring-1 ring-[color:var(--color-accent)] scale-[1.01] shadow-lg shadow-black/40' : ''
            } ${channelDragId === c.id ? 'ring-2 ring-[color:var(--color-accent)] scale-[1.02] shadow-xl shadow-black/50' : ''}`}
            draggable={canManageChannels}
            role="listitem"
            ondragstart={(event) => startChannelDrag(event, c.id)}
            ondragover={(event) => handleChannelDragOver(event, c.id)}
            ondrop={handleChannelDrop}
            ondragend={handleChannelDragEnd}
          >
            <div class="flex items-center gap-3 min-w-0">
              <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-lg">
                {#if c.type === 'text'}<i class="bx bx-hash"></i>{:else}<i class="bx bx-headphone"></i>{/if}
              </span>
              <div class="min-w-0">
                <div class="flex items-center gap-2 font-semibold truncate">
                  <span class="truncate">{c.name}</span>
                  {#if c.isPrivate}
                    <span class="settings-channel-lock" title="Private channel"><i class="bx bx-lock-alt"></i></span>
                  {/if}
                </div>
                <div class="text-xs text-white/60">
                  {c.type === 'text' ? 'Text' : 'Voice'} channel {#if c.isPrivate}· Private{/if}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] uppercase tracking-[0.18em] text-white/40">Drag</span>
              <button class="settings-chip-btn" aria-label="Edit channel" disabled={!canManageChannels} onclick={() => openChannelDetail(c.id)}>
                <i class="bx bx-pencil"></i>
              </button>
              <button
                class="settings-chip-btn text-red-300 hover:bg-red-900/30"
                disabled={!canManageChannels}
                onclick={() => deleteChannel(c.id, c.name)}
                aria-label={`Delete ${c.name}`}
              >
                <i class="bx bx-trash"></i>
              </button>
            </div>
          </div>
        {/each}
      </div>
      {#if channelReorderBusy}
        <div class="text-xs text-white/60 mt-2">Saving order...</div>
      {/if}
    </div>
  </div>
{/if}

{#if channelDetailModalOpen && channelDetailId}
  <div
    class="role-modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="0"
    onclick={(event) => {
      if (event.target === event.currentTarget) closeChannelDetail();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeChannelDetail();
      }
    }}
  >
    <form class="role-modal role-modal--mid" aria-label="Channel settings" onsubmit={preventDefault(saveChannelDetail)}>
      <div class="role-modal__header">
        <h3>Edit channel</h3>
        <button type="button" class="settings-chip-btn" aria-label="Close" onclick={closeChannelDetail}>
          <i class="bx bx-x"></i>
        </button>
      </div>
      <div class="settings-chip-row mb-2">
        <button class:active-chip={channelDetailSection === 'overview'} type="button" onclick={() => (channelDetailSection = 'overview')}>
          Overview
        </button>
        {#if channelDetailPrivate}
          <button
            class:active-chip={channelDetailSection === 'access'}
            type="button"
            onclick={() => (channelDetailSection = 'access')}
          >
            Access
          </button>
        {/if}
      </div>

      {#if channelDetailSection === 'overview'}
        <label class="role-modal__field">
          <span>Name</span>
          <input class="role-modal__input" bind:value={channelDetailName} oninput={() => (channelError = null)} />
        </label>
        <p class="text-xs text-white/60">Type: {channelDetailType === 'voice' ? 'Voice' : 'Text'} (fixed)</p>
        <label class="settings-switch settings-switch--inline">
          <input type="checkbox" bind:checked={channelDetailPrivate} />
          <span>Private channel</span>
        </label>
      {:else}
        {#if !channelDetailPrivate}
          <p class="text-xs text-white/70">This channel is public. Turn on "Private channel" in Overview to restrict access by role.</p>
        {:else}
          <p class="text-xs text-white/70">Choose who can view this channel when it is private.</p>
          <div class="flex flex-wrap gap-2">
            {#each sortedRoles as role}
              <label class="settings-chip">
                <input
                  type="checkbox"
                  checked={channelDetailRoles.includes(role.id)}
                  onchange={(e) => toggleChannelDetailRole(role.id, (e.currentTarget as HTMLInputElement).checked)}
                />
                <span>{role.name}</span>
              </label>
            {/each}
          </div>
          {#if !channelDetailRoles.length}
            <p class="settings-status text-[11px] text-white/60">Only admins can see this private channel until you add at least one allowed role.</p>
          {/if}
        {/if}
      {/if}

      {#if channelError}
        <p class="settings-status settings-status--error">{channelError}</p>
      {/if}
      <div class="role-modal__actions">
        <button type="button" class="btn btn-ghost" onclick={closeChannelDetail} disabled={channelDetailBusy}>Cancel</button>
        <button type="submit" class="btn btn-primary" disabled={channelDetailBusy}>
          {channelDetailBusy ? 'Saving...' : 'Save channel'}
        </button>
      </div>
    </form>
  </div>
{/if}

{#if roleDetailModalOpen && roleDetailId}
  {@const activeRole = sortedRoles.find((r) => r.id === roleDetailId)}
  <div
    class="role-modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="0"
    onclick={(event) => {
      if (event.target === event.currentTarget) {
        roleDetailModalOpen = false;
      }
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        roleDetailModalOpen = false;
      }
    }}
  >
    <div class="role-modal role-modal--wide" role="document">
      <div class="role-modal__header">
        <div>
          <h3>{activeRole?.name ?? 'Role'}</h3>
          <p class="text-xs text-white/60">Manage display, permissions, and members.</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="settings-icon-btn"
            onclick={() => moveRole(roleDetailId!, 'up')}
            disabled={sortedRoles.findIndex((r) => r.id === roleDetailId) <= 0 || roleUpdateBusy[roleDetailId!]}
            aria-label="Move role up"
          >
            <i class="bx bx-chevron-up" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="settings-icon-btn"
            onclick={() => moveRole(roleDetailId!, 'down')}
            disabled={sortedRoles.findIndex((r) => r.id === roleDetailId) === sortedRoles.length - 1 || roleUpdateBusy[roleDetailId!]}
            aria-label="Move role down"
          >
            <i class="bx bx-chevron-down" aria-hidden="true"></i>
          </button>
          {#if isOwner}
            <button
              type="button"
              class="settings-icon-btn text-red-300 hover:bg-red-900/40"
              onclick={() => deleteRole(roleDetailId!, activeRole?.name ?? 'Role')}
              disabled={roleUpdateBusy[roleDetailId!]}
              aria-label="Delete role"
            >
              <i class="bx bx-trash" aria-hidden="true"></i>
            </button>
          {/if}
          <button type="button" class="settings-chip-btn" aria-label="Close" onclick={() => (roleDetailModalOpen = false)}>
            <i class="bx bx-x"></i>
          </button>
        </div>
      </div>
      <div class="role-modal__scroll">
        <div class="settings-chip-row mb-2">
          <button class:active-chip={roleDetailSection === 'display'} type="button" onclick={() => (roleDetailSection = 'display')}>
            Display
          </button>
          <button class:active-chip={roleDetailSection === 'permissions'} type="button" onclick={() => (roleDetailSection = 'permissions')}>
            Permissions
          </button>
          <button class:active-chip={roleDetailSection === 'members'} type="button" onclick={() => (roleDetailSection = 'members')}>
            Members
          </button>
        </div>

        {#if activeRole}
          {#if roleDetailSection === 'display'}
            <div class="settings-role-header">
              <div class="settings-role-header__meta">
                <input
                  class="settings-role-name"
                  value={activeRole.name}
                  aria-label="Role name"
                  onblur={(e) => setRoleName(activeRole.id, (e.currentTarget as HTMLInputElement).value)}
                  disabled={!isAdmin || roleUpdateBusy[activeRole.id]}
                />
                <input
                  class="settings-role-color"
                  type="color"
                  aria-label="Role color"
                  value={activeRole.color ?? '#5865f2'}
                  oninput={(e) => setRoleColor(activeRole.id, (e.currentTarget as HTMLInputElement).value)}
                  disabled={!isAdmin || roleUpdateBusy[activeRole.id]}
                  title="Role color"
                />
              </div>
              <div class="settings-role-header__actions">
                <label class="settings-switch settings-switch--inline">
                  <input
                    type="checkbox"
                    checked={activeRole.mentionable !== false}
                    onchange={(e) => setRoleMentionable(activeRole.id, (e.currentTarget as HTMLInputElement).checked)}
                    disabled={!isAdmin || roleUpdateBusy[activeRole.id]}
                  />
                  <span>Allow mentions</span>
                </label>
                <label class="settings-switch settings-switch--inline">
                  <input
                    type="checkbox"
                    checked={activeRole.showInMemberList !== false}
                    onchange={(e) => setRoleShowInMemberList(activeRole.id, (e.currentTarget as HTMLInputElement).checked)}
                    disabled={!isAdmin || roleUpdateBusy[activeRole.id]}
                  />
                  <span>Show on members bar</span>
                </label>
              </div>
            </div>
          {:else if roleDetailSection === 'permissions'}
            <div class="settings-permission-groups">
              {#each rolePermissionGroups as group}
                <div class="settings-permission-group">
                  <div class="settings-permission-group__header">
                    <div class="settings-permission-group__title">{group.title}</div>
                    {#if group.description}
                      <p class="settings-permission-group__description">{group.description}</p>
                    {/if}
                  </div>
                  <div class="settings-role-permissions">
                    {#each group.items as option}
                      <label class="settings-permission">
                        <input
                          type="checkbox"
                          checked={roleHasPermission(activeRole, option.key)}
                          disabled={!isAdmin || roleUpdateBusy[activeRole.id]}
                          onchange={(e) =>
                            toggleRolePermission(
                              activeRole.id,
                              option.key,
                              (e.currentTarget as HTMLInputElement).checked
                            )}
                        />
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </span>
                      </label>
                    {/each}
                  </div>
                </div>
              {/each}
              <p class="settings-role-permissions__hint">
                Private channels still require an allowed role on the channel to be visible.
              </p>
            </div>
          {:else}
            {@const roleMembers = membersWithProfiles.filter((m) => Array.isArray(m.roleIds) && m.roleIds.includes(activeRole.id))}
            {@const roleMemberTerm = roleMemberSearch.trim().toLowerCase()}
            {@const filteredRoleMembers = roleMembers.filter((m) => {
              if (!roleMemberTerm) return true;
              return (m.displayName ?? '').toLowerCase().includes(roleMemberTerm) || m.uid.toLowerCase().includes(roleMemberTerm);
            })}
            {@const maxRoleMembersToShow = 12}
            {@const visibleRoleMembers = filteredRoleMembers.slice(0, maxRoleMembersToShow)}
            {@const remainingRoleMembers = Math.max(filteredRoleMembers.length - visibleRoleMembers.length, 0)}
            <div class="flex items-center gap-2 mb-2">
              <input
                class="input input--compact flex-1"
                placeholder="Search members"
                bind:value={roleMemberSearch}
              />
              <span class="text-xs text-white/60">{roleMembers.length} members</span>
            </div>
            {#if roleMembers.length === 0}
              <div class="text-white/60 text-sm">No members assigned.</div>
            {:else}
              <div class="flex flex-wrap gap-2">
                {#each visibleRoleMembers as member}
                  <span class="settings-role-member-chip">
                    {member.displayName || member.uid}
                    {#if isAdmin}
                      <button type="button" aria-label="Remove role" onclick={() => toggleMemberRole(member.uid, activeRole.id, false)}>
                        <i class="bx bx-x"></i>
                      </button>
                    {/if}
                  </span>
                {/each}
                {#if remainingRoleMembers > 0}
                  <span class="settings-role-member-chip settings-role-member-chip--more">+{remainingRoleMembers} more</span>
                {/if}
              </div>
            {/if}
          {/if}
        {:else}
          <div class="text-white/60">Role not found.</div>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if roleAssignModalOpen && roleAssignTarget}
  <div
    class="role-modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="0"
    onclick={(event) => {
      if (event.target === event.currentTarget) {
        roleAssignModalOpen = false;
        roleAssignTarget = null;
      }
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        roleAssignModalOpen = false;
        roleAssignTarget = null;
      }
    }}
  >
    <div class="role-modal role-modal--mid" role="document">
      <div class="role-modal__header">
        <div>
          <h3>Assign roles</h3>
          <p class="text-xs text-white/60 truncate">For {roleAssignTarget.displayName || roleAssignTarget.uid}</p>
        </div>
        <button type="button" class="settings-chip-btn" aria-label="Close" onclick={() => { roleAssignModalOpen = false; roleAssignTarget = null; }}>
          <i class="bx bx-x"></i>
        </button>
      </div>
      {#if assignableRoles.length === 0}
        <div class="text-white/60 text-sm">No custom roles available.</div>
      {:else}
        <div class="space-y-2">
          {#each assignableRoles as role}
            <label class="settings-chip settings-chip--full">
              <span class="flex items-center gap-2">
                <span class="settings-role-summary__swatch" style={`background:${role.color ?? '#5865f2'}`}></span>
                <span>{role.name}</span>
              </span>
              <input
                type="checkbox"
                checked={roleAssignTarget && Array.isArray(roleAssignTarget.roleIds) && roleAssignTarget.roleIds.includes(role.id)}
                disabled={!isAdmin}
                onchange={(e) => roleAssignTarget && toggleMemberRole(roleAssignTarget.uid, role.id, (e.currentTarget as HTMLInputElement).checked)}
              />
            </label>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if showRoleModal}
  <div
    class="role-modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="0"
    onkeydown={(e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!roleCreateBusy) closeRoleModal();
      }
    }}
    onclick={(event) => {
      if (event.target === event.currentTarget && !roleCreateBusy) closeRoleModal();
    }}
  >
    <form
      class="role-modal"
      aria-label="Create role"
      onsubmit={preventDefault(createRole)}
    >
      <div class="role-modal__header">
        <h3>Create a role</h3>
      </div>
      <label class="role-modal__field">
        <span>Role name</span>
        <input
          bind:this={roleNameInputEl}
          class="role-modal__input"
          placeholder="Role name"
          bind:value={newRoleName}
          required
        />
      </label>
      <label class="role-modal__field role-modal__field--inline">
        <span>Color</span>
        <input
          class="role-modal__color"
          type="color"
          bind:value={newRoleColor}
          title="Role color"
        />
      </label>
      <label class="role-modal__field role-modal__field--inline">
        <span>Mentionable</span>
        <input
          type="checkbox"
          checked={newRoleMentionable}
          onchange={(e) => (newRoleMentionable = (e.currentTarget as HTMLInputElement).checked)}
        />
      </label>
      {#if roleError}
        <p class="settings-status settings-status--error">{roleError}</p>
      {/if}
      <div class="role-modal__actions">
        <button type="button" class="btn btn-ghost" onclick={closeRoleModal} disabled={roleCreateBusy}>
          Cancel
        </button>
        <button
          type="submit"
          class="btn btn-primary"
          disabled={roleCreateBusy || !newRoleName.trim() || !(isOwner || isAdmin)}
        >
          {roleCreateBusy ? 'Creating...' : 'Create role'}
        </button>
      </div>
    </form>
  </div>
{/if}

{#if domainModalOpen}
  <div
    class="role-modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="0"
    onclick={(event) => {
      if (event.target === event.currentTarget) domainModalOpen = false;
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        domainModalOpen = false;
      }
    }}
  >
    <div class="role-modal role-modal--wide">
      <div class="role-modal__header">
        <h3>Domain auto invites</h3>
        <button type="button" class="settings-chip-btn" aria-label="Close" onclick={() => (domainModalOpen = false)}>
          <i class="bx bx-x"></i>
        </button>
      </div>
      <div class="settings-domain-grid">
        <div class="settings-toggle">
          <label class="settings-switch">
            <input type="checkbox" bind:checked={inviteAutomationEnabled} onchange={() => scheduleSaveOverview()} />
            <span>Auto invite matching domains</span>
          </label>
          <p class="settings-caption">Invites are queued the moment someone signs in with a whitelisted email.</p>
        </div>
        <div>
          <label class="settings-label" for="domain-input">Allowed domains</label>
          <div class="settings-domain-input">
            <input
              id="domain-input"
              class="input input--compact flex-1"
              placeholder="example.com"
              value={inviteDomainInput}
              oninput={(e) => (inviteDomainInput = (e.currentTarget as HTMLInputElement).value)}
            />
            <button type="button" class="btn btn-ghost" onclick={addInviteDomain}>Add</button>
          </div>
          {#if inviteDomains.length === 0}
            <p class="settings-caption">No domains yet. Add one like <code>company.com</code>.</p>
          {:else}
            <div class="settings-domain-list">
              {#each inviteDomains as domain (domain)}
                <span class="settings-domain-pill">
                  {domain}
                  <button
                    type="button"
                    aria-label={`Remove ${domain}`}
                    onclick={() => removeInviteDomain(domain)}
                  >
                    <i class="bx bx-x" aria-hidden="true"></i>
                  </button>
                </span>
              {/each}
            </div>
          {/if}
        </div>
        <div>
          <label class="settings-label" for="auto-role">Default role</label>
          <select
            id="auto-role"
            class="input"
            bind:value={inviteDefaultRoleSelection}
            onchange={() => {
              inviteDefaultRoleId = inviteDefaultRoleSelection ? inviteDefaultRoleSelection : null;
              scheduleSaveOverview();
            }}
          >
            <option value="">Use server default</option>
            {#each sortedRoles as role (role.id)}
              <option value={role.id}>{role.name}</option>
            {/each}
          </select>
          <p class="settings-caption">hConnect applies this role automatically after members accept.</p>
        </div>
      </div>
      {#if inviteAutomationStatus}
        <p class="settings-status settings-status--success">{inviteAutomationStatus}</p>
      {/if}
      {#if inviteAutomationError}
        <p class="settings-status settings-status--error">{inviteAutomationError}</p>
      {/if}
      <div class="role-modal__actions">
        <button
          type="button"
          class="btn btn-ghost"
          disabled={!inviteAutomationEnabled || inviteAutomationBusy}
          onclick={() => sendAutoInvitesForDomains()}
        >
          {inviteAutomationBusy ? 'Syncing...' : 'Run domain sync'}
        </button>
        <button type="button" class="btn btn-primary" onclick={() => (domainModalOpen = false)}>Close</button>
      </div>
    </div>
  </div>
{/if}
























