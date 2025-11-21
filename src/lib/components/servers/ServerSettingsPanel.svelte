<script lang="ts">
  import { run, passive, preventDefault } from 'svelte/legacy';

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/user';
  import { getDb } from '$lib/firebase';
  import { createChannel } from '$lib/firestore/channels';
  import { removeUserMembership } from '$lib/firestore/servers';
  import { sendServerInvite, type ServerInvite } from '$lib/firestore/invites';
import { subscribeServerDirectory, type MentionDirectoryEntry } from '$lib/firestore/membersDirectory';
import LeftPane from '$lib/components/app/LeftPane.svelte';

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

  // tabs
  type Tab = 'overview' | 'members' | 'channels' | 'roles' | 'danger';
  const tabItems: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: 'Members' },
    { id: 'channels', label: 'Channels' },
    { id: 'roles', label: 'Roles' },
    { id: 'danger', label: 'Danger Zone' }
  ];
  let tab: Tab = $state('members'); // land on Members where Invite lives
  $effect(() => {
    if (section && tabItems.some((entry) => entry.id === section)) {
      tab = section as Tab;
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
  let bans: Array<{ uid: string; reason?: string; bannedAt?: any }> = $state([]);
let channels: Array<{ id: string; name: string; type: 'text' | 'voice'; position?: number; allowedRoleIds?: string[]; isPrivate?: boolean }> = $state([]);
let sortedChannels: Array<{ id: string; name: string; type: 'text' | 'voice'; position?: number; allowedRoleIds?: string[]; isPrivate?: boolean }> = $state([]);
  let newChannelName = $state('');
  let newChannelType: 'text' | 'voice' = $state('text');
  let newChannelPrivate = $state(false);
  let newChannelAllowedRoleIds: string[] = $state([]);
  let channelCreateBusy = $state(false);
  let channelError: string | null = $state(null);
  type RolePermissionKey =
    | 'manageServer'
    | 'manageRoles'
    | 'manageChannels'
    | 'kickMembers'
    | 'banMembers'
    | 'reorderChannels'
    | 'viewChannels'
    | 'sendMessages'
    | 'manageMessages'
    | 'connectVoice'
    | 'speakVoice';
  type Role = {
    id: string;
    name: string;
    color?: string | null;
    position?: number;
    permissions?: Partial<Record<RolePermissionKey, boolean>>;
  };
  let roles: Role[] = $state([]);
  let sortedRoles: Role[] = $state([]);
  let assignableRoles: Role[] = $state([]);
  let newRoleName = $state('');
  let newRoleColor = $state('#5865f2');
  let roleUpdateBusy: Record<string, boolean> = $state({});
  let roleError: string | null = $state(null);
  let roleCollapsed: Record<string, boolean> = $state({});

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
      const memberSnap = await getDoc(doc(db, 'servers', serverId!, 'members', $user.uid));
      const role = memberSnap.exists() ? (memberSnap.data() as any).role : null;
      isAdmin = role === 'admin';
    } else {
      isAdmin = true; // owner is admin+
    }

    allowed = isOwner || isAdmin;
    if (!allowed) goto(`/servers/${serverId}`);
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
      roles = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Role));
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
    sortedRoles = [...roles].sort((a, b) => {
      const ap = typeof a.position === 'number' ? a.position : Number.MAX_SAFE_INTEGER;
      const bp = typeof b.position === 'number' ? b.position : Number.MAX_SAFE_INTEGER;
      return ap - bp;
    });
  });
  run(() => {
    assignableRoles = sortedRoles.filter((role) => {
      const lower = (role.name ?? '').toLowerCase();
      return lower !== 'everyone' && lower !== 'admin';
    });
  });
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
  const rolePermissionOptions: Array<{ key: RolePermissionKey; label: string; description: string }> = [
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
      description: 'Create, edit, archive, or delete channels.'
    },
    {
      key: 'reorderChannels',
      label: 'Reorder channels',
      description: 'Move channels up or down within sections.'
    },
    {
      key: 'manageMessages',
      label: 'Manage messages',
      description: 'Delete, pin, or moderate chat content.'
    },
    {
      key: 'sendMessages',
      label: 'Send messages',
      description: 'Post text messages and reactions.'
    },
    {
      key: 'viewChannels',
      label: 'View channels',
      description: 'Access text and voice channels.'
    },
    {
      key: 'kickMembers',
      label: 'Kick members',
      description: 'Remove members without banning.'
    },
    {
      key: 'banMembers',
      label: 'Ban members',
      description: 'Permanently ban members from the server.'
    },
    {
      key: 'connectVoice',
      label: 'Connect to voice',
      description: 'Join voice channels.'
    },
    {
      key: 'speakVoice',
      label: 'Speak in voice',
      description: 'Talk in voice channels once connected.'
    }
  ];

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
      if (section && tabItems.some((entry) => entry.id === section)) {
        tab = section as any;
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
    inviteAutomationError = null;
  }

  function removeInviteDomain(domain: string) {
    inviteDomains = inviteDomains.filter((d) => d !== domain);
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
      await updateDoc(doc(db, 'servers', serverId!, 'members', uid), { role });
    } catch (e) {
      console.error(e);
      alert('Failed to update role.');
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
    if (!isAdmin) return;
    const name = newRoleName.trim();
    if (!name) return;
    const db = getDb();
    try {
      const ref = await addDoc(collection(db, 'servers', serverId!, 'roles'), {
        name,
        color: newRoleColor || null,
        createdAt: serverTimestamp(),
        position: sortedRoles.length,
        permissions: {}
      });
      newRoleName = '';
      newRoleColor = '#5865f2';
      roleCollapsed = { ...roleCollapsed, [ref.id]: false };
    } catch (e) {
      console.error(e);
      alert('Failed to create role.');
    }
  }

  async function deleteRole(roleId: string, roleName: string) {
    if (!isOwner) return;
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
      await Promise.all(
        membersSnap.docs.map((m) => {
          const data = m.data() as any;
          if (Array.isArray(data.roleIds) && data.roleIds.includes(roleId)) {
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
      await updateDoc(doc(db, 'servers', serverId!, 'roles', roleId), {
        [`permissions.${String(key)}`]: enabled
      });
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

  function countEnabledPerms(role: Role): number {
    const perms = role.permissions ?? {};
    let total = 0;
    for (const value of Object.values(perms)) {
      if (value) total += 1;
    }
    return total;
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
    const db = getDb();
    const batch = writeBatch(db);
    next.forEach((c, idx) => {
      batch.update(doc(db, 'servers', serverId!, 'channels', c.id), { position: idx });
    });
    try {
      await batch.commit();
    } catch (e) {
      console.error(e);
      alert('Failed to reorder channels.');
    }
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
    } catch (e) {
      console.error(e);
      channelError = 'Failed to create channel.';
    } finally {
      channelCreateBusy = false;
    }
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
          <div class="settings-header">
            <button
              type="button"
              class="settings-back"
              aria-label="Go back"
              title="Back"
              onclick={goBack}
            >
              <i class="bx bx-left-arrow-alt text-xl leading-none"></i>
            </button>

            <div class="settings-heading">
              <h1>Server Settings</h1>
              <p>Manage roles, members, channels, and dangerous actions.</p>
            </div>
          </div>

          <div class="settings-tabbar" role="tablist" aria-label="Server settings sections">
            {#each tabItems as item}
              <button
                type="button"
                role="tab"
                class="settings-tab"
                class:is-active={tab === item.id}
                aria-selected={tab === item.id}
                onclick={() => (tab = item.id)}
              >
                {item.label}
              </button>
            {/each}
          </div>
        {/if}

      <!-- overview -->
      {#if tab === 'overview'}
        <div class="settings-stack">
          <div class="settings-card">
            <div>
              <div class="settings-card__title">Server profile</div>
              <div class="settings-card__subtitle">Update the basics everyone sees in the sidebar.</div>
            </div>
            <div class="settings-grid settings-grid--two">
              <div>
                <label class="settings-label" for="server-name">Server name</label>
                <input id="server-name" class="input" bind:value={serverName} aria-label="Server name" />
              </div>
              <div>
                <label class="settings-label" for="server-icon-url">Server icon (URL or upload)</label>
                <div class="flex flex-col gap-2">
                  <input
                    id="server-icon-url"
                    class="input"
                    type="url"
                    bind:value={serverIcon}
                    placeholder="https://example.com/icon.png"
                    inputmode="url"
                    aria-label="Server icon URL"
                  />
                  <div class="flex flex-wrap gap-2">
                    <button type="button" class="btn btn-ghost btn-sm" onclick={triggerServerIconUpload}>
                      Upload image
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      onclick={() => {
                        serverIcon = '';
                        serverIconError = null;
                      }}
                      disabled={!serverIcon}
                    >
                      Clear icon
                    </button>
                  </div>
                  <input class="hidden" type="file" accept="image/*" bind:this={serverIconInput} onchange={onServerIconSelected} />
                  {#if serverIconError}
                    <p class="text-xs text-red-300">{serverIconError}</p>
                  {/if}
                  {#if serverIcon}
                    <div class="mt-1 flex items-center gap-3">
                      <img src={serverIcon} alt="Server icon preview" class="h-14 w-14 rounded-full border border-subtle object-cover" />
                      <span class="text-xs text-soft">Tap save to apply changes.</span>
                    </div>
                  {:else}
                    <p class="text-xs text-soft">
                      Supported formats: JPG, PNG, GIF up to 8&nbsp;MB. Larger images are compressed automatically.
                    </p>
                  {/if}
                </div>
              </div>
            </div>
            <div class="settings-actions">
              <button type="button" class="btn btn-primary h-10 px-5" onclick={saveOverview}>Save changes</button>
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
                  <input id="accent-color" type="color" bind:value={accentColor} aria-label="Server accent color" />
                  <input
                    class="input input--compact"
                    value={accentColor}
                    oninput={(e) => (accentColor = (e.currentTarget as HTMLInputElement).value)}
                  />
                </div>
              </div>
              <div class="settings-color-field">
                <label class="settings-label" for="sidebar-color">Sidebar background</label>
                <div class="settings-color-input">
                  <input id="sidebar-color" type="color" bind:value={sidebarColor} aria-label="Sidebar background color" />
                  <input
                    class="input input--compact"
                    value={sidebarColor}
                    oninput={(e) => (sidebarColor = (e.currentTarget as HTMLInputElement).value)}
                  />
                </div>
              </div>
              <div class="settings-color-field">
                <label class="settings-label" for="mention-color">Mention highlight</label>
                <div class="settings-color-input">
                  <input id="mention-color" type="color" bind:value={mentionColor} aria-label="Mention highlight color" />
                  <input
                    class="input input--compact"
                    value={mentionColor}
                    oninput={(e) => (mentionColor = (e.currentTarget as HTMLInputElement).value)}
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
                  <input type="checkbox" bind:checked={chatHighlightMentions} />
                  <span>Highlight @mentions</span>
                </label>
                <p class="settings-caption">Adds a high contrast badge using your mention color.</p>
              </div>
              <div class="settings-toggle">
                <label class="settings-switch">
                  <input type="checkbox" bind:checked={chatAllowReactions} />
                  <span>Allow message reactions</span>
                </label>
                <p class="settings-caption">Give members emoji reactions to keep threads tidy.</p>
              </div>
              <div class="settings-toggle">
                <label class="settings-switch">
                  <input type="checkbox" bind:checked={chatAllowThreads} />
                  <span>Enable threaded replies</span>
                </label>
                <p class="settings-caption">Let side conversations live in thread bubbles.</p>
              </div>
              <div class="settings-toggle">
                <label class="settings-switch">
                  <input type="checkbox" bind:checked={chatShowJoinMessages} />
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
                    onclick={() => (chatDensity = 'cozy')}
                  >
                    Cozy
                  </button>
                  <button
                    type="button"
                    class:active-chip={chatDensity === 'compact'}
                    onclick={() => (chatDensity = 'compact')}
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
                    oninput={(e) => (chatSlowModeSeconds = Number((e.currentTarget as HTMLInputElement).value))}
                  />
                  <input
                    class="input input--compact w-20"
                    type="number"
                    min="0"
                    max="300"
                    step="5"
                    bind:value={chatSlowModeSeconds}
                  />
                </div>
                <p class="settings-caption">
                  {chatSlowModeSeconds === 0 ? 'Off' : `Members can post every ${chatSlowModeSeconds}s`}
                </p>
              </div>
            </div>
            <div class="settings-actions">
              <button type="button" class="btn btn-primary h-10 px-5" onclick={saveOverview}>Save changes</button>
            </div>
          </div>

          <div class="settings-card settings-card--invite">
            <div>
              <div class="settings-card__title">Domain auto-invites</div>
              <div class="settings-card__subtitle">Automatically welcome teammates from trusted email domains.</div>
            </div>
            <div class="settings-domain-grid">
              <div class="settings-toggle">
                <label class="settings-switch">
                  <input type="checkbox" bind:checked={inviteAutomationEnabled} />
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
            <div class="settings-actions settings-actions--stack">
              <button
                type="button"
                class="btn btn-ghost"
                disabled={!inviteAutomationEnabled || inviteAutomationBusy}
                onclick={() => sendAutoInvitesForDomains()}
              >
                {inviteAutomationBusy ? 'Syncing...' : 'Run domain sync'}
              </button>
              <button
                type="button"
                class="btn btn-primary h-10 px-5"
                onclick={saveOverview}
                disabled={inviteAutomationBusy}
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      {/if}
      <!-- members -->
      {#if tab === 'members'}
        <div class="settings-card settings-invite">
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

          <div class="settings-invite__results">
            {#if !q}
              <div class="settings-invite__empty">Type to filter users who have logged in.</div>
            {:else if filtered.length === 0}
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
                          &nbsp;•&nbsp;Invited by {invite.fromDisplayName}
                        {:else if invite.fromUid}
                          &nbsp;•&nbsp;Invited by {invite.fromUid}
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

        <!-- current members list -->
        <div class="settings-card space-y-4">
          <div class="settings-toolbar">
            <input
              class="input input--compact flex-1"
              placeholder="Search members by name or email"
              bind:value={memberSearch}
            />
            <div class="settings-toolbar__filters">
              <button
                type="button"
                class:active-filter={memberRoleFilter === 'all'}
                onclick={() => (memberRoleFilter = 'all')}
              >
                All
              </button>
              <button
                type="button"
                class:active-filter={memberRoleFilter === 'owner'}
                onclick={() => (memberRoleFilter = 'owner')}
              >
                Owners
              </button>
              <button
                type="button"
                class:active-filter={memberRoleFilter === 'admin'}
                onclick={() => (memberRoleFilter = 'admin')}
              >
                Admins
              </button>
              <button
                type="button"
                class:active-filter={memberRoleFilter === 'custom'}
                onclick={() => (memberRoleFilter = 'custom')}
              >
                Has custom roles
              </button>
            </div>
          </div>

          {#if filteredMembers.length === 0}
            <div class="text-white/60">
              {#if members.length === 0}
                No members yet.
              {:else}
                No members match the current filters.
              {/if}
            </div>
          {/if}

          {#each filteredMembers as m (m.uid)}
            <div class="p-2 rounded hover:bg-white/10 space-y-2">
              <div class="settings-member-row">
                <img
                  src={m.photoURL || ''}
                  alt=""
                  class="h-9 w-9 rounded-full bg-white/10"
                  onerror={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                />
                <div class="flex-1 min-w-0">
                  <div class="truncate">{m.displayName || m.uid}</div>
                  <div class="text-xs text-white/50">{m.role || 'member'}</div>
                </div>

                {#if isOwner || isAdmin}
                  <div class="settings-member-row__actions">
                    <button
                      class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                      disabled={!isOwner && m.role === 'admin'}
                      onclick={() => setRole(m.uid, 'member')}
                    >
                      Member
                    </button>
                    <button
                      class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                      onclick={() => setRole(m.uid, 'admin')}
                    >
                      Admin
                    </button>
                  </div>
                {/if}

                {#if isOwner || isAdmin}
                  <div class="settings-member-row__moderation">
                    <button class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15" onclick={() => kick(m.uid)}>
                      Kick
                    </button>
                    <button
                      class="px-2 py-1 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60"
                      onclick={() => ban(m.uid)}
                    >
                      Ban
                    </button>
                  </div>
                {/if}
              </div>

              {#if assignableRoles.length > 0}
                <div class="pl-12 flex flex-wrap gap-2 text-[12px] text-white/70">
                  {#each assignableRoles as role}
                    <label class="settings-chip">
                      <input
                        type="checkbox"
                        checked={Array.isArray(m.roleIds) && m.roleIds.includes(role.id)}
                        disabled={!isAdmin}
                        onchange={(e) =>
                          toggleMemberRole(m.uid, role.id, (e.currentTarget as HTMLInputElement).checked)}
                      />
                      <span>{role.name}</span>
                    </label>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>

        <div class="settings-card settings-card--muted mt-6 space-y-2">
          <div class="text-sm text-white/70 mb-2">Bans</div>
          {#if bans.length === 0}
            <div class="text-white/60">No banned users.</div>
          {/if}
          {#each bans as b (b.uid)}
            <div class="flex items-center justify-between p-2 rounded hover:bg-white/10">
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

      <!-- channels -->
      {#if tab === 'channels'}
        <div class="settings-card settings-channel-create">
          <form class="settings-channel-form" onsubmit={preventDefault(createChannelInline)}>
            <div class="settings-channel-form__row">
              <input
                class="input flex-1"
                placeholder="Channel name (e.g. general)"
                bind:value={newChannelName}
              />
              <select class="input w-32" bind:value={newChannelType}>
                <option value="text">Text</option>
                <option value="voice">Voice</option>
              </select>
              <label class="settings-switch settings-switch--inline">
                <input type="checkbox" bind:checked={newChannelPrivate} />
                <span>Private</span>
              </label>
              <button
                type="submit"
                class="btn btn-primary"
                disabled={!newChannelName.trim() || channelCreateBusy}
              >
                {channelCreateBusy ? 'Creating...' : 'Create'}
              </button>
            </div>
            {#if newChannelPrivate}
              <div class="settings-channel-form__roles">
                {#if sortedRoles.length === 0}
                  <p class="text-xs text-white/50">Create a role first in the Roles tab to limit who can join this private channel.</p>
                {:else}
                  <p class="text-xs text-white/60">Allow these roles to join:</p>
                  <div class="settings-channel-form__roles-grid">
                    {#each sortedRoles as role}
                      <label class="settings-chip">
                        <input
                          type="checkbox"
                          checked={newChannelAllowedRoleIds.includes(role.id)}
                          onchange={(event) =>
                            toggleNewChannelRole(role.id, (event.currentTarget as HTMLInputElement).checked)}
                        />
                        <span>{role.name}</span>
                      </label>
                    {/each}
                  </div>
                  {#if !newChannelAllowedRoleIds.length}
                    <p class="text-[11px] text-white/45">
                      No roles selected: everyone will still see this private channel until you add a role.
                    </p>
                  {/if}
                {/if}
              </div>
            {/if}
            {#if channelError}
              <p class="settings-status settings-status--error">{channelError}</p>
            {/if}
          </form>
        </div>

        <div class="settings-card space-y-3">
          {#if sortedChannels.length === 0}
            <div class="text-white/60">No channels yet.</div>
          {/if}
          {#each sortedChannels as c, index (c.id)}
            <div class="flex flex-col gap-2 p-2 rounded hover:bg-white/10">
              <div class="settings-channel-row">
                <div class="w-6 text-center">
                  {#if c.type === 'text'}<i class="bx bx-hash" aria-hidden="true"></i>{:else}<i class="bx bx-headphone" aria-hidden="true"></i>{/if}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="truncate font-medium">{c.name}</div>
                  <div class="text-xs text-white/40">
                    {c.type === 'text' ? 'Text channel' : 'Voice channel'}{#if c.isPrivate} • Private{/if}
                  </div>
                </div>
                {#if canManageChannels}
                  <div class="settings-channel-row__reorder">
                    <button
                      type="button"
                      class="settings-icon-btn"
                      onclick={() => moveChannel(c.id, 'up')}
                      disabled={index === 0}
                      aria-label="Move channel up"
                    >
                      <i class="bx bx-chevron-up" aria-hidden="true"></i>
                    </button>
                    <button
                      type="button"
                      class="settings-icon-btn"
                      onclick={() => moveChannel(c.id, 'down')}
                      disabled={index === sortedChannels.length - 1}
                      aria-label="Move channel down"
                    >
                      <i class="bx bx-chevron-down" aria-hidden="true"></i>
                    </button>
                  </div>
                  <div class="settings-channel-row__actions">
                    <button
                      class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                      onclick={() => renameChannel(c.id, c.name)}
                    >
                      Rename
                    </button>
                    <button
                      class="px-2 py-1 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60"
                      onclick={() => deleteChannel(c.id, c.name)}
                    >
                      Delete
                    </button>
                  </div>
                {/if}
              </div>
              {#if roles.length > 0 && c.isPrivate}
                <div class="pl-6 pr-3 pb-2 text-[12px] text-white/60 flex flex-wrap items-center gap-2">
                  <span class="opacity-70">Allowed roles:</span>
                  <div class="flex flex-wrap gap-2">
                    {#each roles as role}
                      <label class="settings-chip">
                        <input
                          type="checkbox"
                          checked={Array.isArray(c.allowedRoleIds) && c.allowedRoleIds.includes(role.id)}
                          disabled={!canManageChannels}
                          onchange={(e) =>
                            toggleChannelRole(c.id, role.id, (e.currentTarget as HTMLInputElement).checked)}
                        />
                        <span>{role.name}</span>
                      </label>
                    {/each}
                  </div>
                  {#if !c.allowedRoleIds || c.allowedRoleIds.length === 0}
                    <span class="text-white/40">Everyone</span>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if tab === 'roles'}
        <div class="settings-card space-y-4">
          <form class="settings-role-create" onsubmit={preventDefault(createRole)}>
            <input
              class="flex-1 rounded bg-white/10 px-3 py-2"
              placeholder="Role name (e.g. Moderator)"
              bind:value={newRoleName}
            />
            <input
              class="h-10 w-20 rounded bg-white/10 border border-white/10"
              type="color"
              bind:value={newRoleColor}
              title="Role color"
            />
            <button
              type="submit"
              class="px-4 py-2 rounded bg-[#5865f2] hover:bg-[#4955d4] disabled:opacity-60"
              disabled={!newRoleName.trim() || !isAdmin}
            >
              Create
            </button>
          </form>

          {#if roleError}
            <p class="settings-status settings-status--error">{roleError}</p>
          {/if}

          {#if sortedRoles.length === 0}
            <div class="text-white/60 text-sm">No custom roles yet. Use the form above to add one.</div>
          {:else}
            <div class="space-y-2">
              {#each sortedRoles as role, index (role.id)}
                <div class="settings-role-card">
                  <button
                    type="button"
                    class="settings-role-summary"
                    aria-expanded={!roleCollapsed[role.id]}
                    onclick={() => toggleRoleCollapse(role.id)}
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
                    <i
                      class="bx bx-chevron-down"
                      class:is-open={!roleCollapsed[role.id]}
                      aria-hidden="true"
                    ></i>
                  </button>
                  {#if !roleCollapsed[role.id]}
                    <div class="settings-role-body">
                      <div class="settings-role-header">
                        <div class="settings-role-header__meta">
                          <input
                            class="settings-role-name"
                            value={role.name}
                            aria-label="Role name"
                            onblur={(e) => setRoleName(role.id, (e.currentTarget as HTMLInputElement).value)}
                            disabled={!isAdmin || roleUpdateBusy[role.id]}
                          />
                          <input
                            class="settings-role-color"
                            type="color"
                            aria-label="Role color"
                            value={role.color ?? '#5865f2'}
                            oninput={(e) => setRoleColor(role.id, (e.currentTarget as HTMLInputElement).value)}
                            disabled={!isAdmin || roleUpdateBusy[role.id]}
                            title="Role color"
                          />
                        </div>
                        <div class="settings-role-header__actions">
                          <button
                            type="button"
                            class="settings-icon-btn"
                            onclick={() => moveRole(role.id, 'up')}
                            disabled={index === 0 || roleUpdateBusy[role.id]}
                            aria-label="Move role up"
                          >
                            <i class="bx bx-chevron-up" aria-hidden="true"></i>
                          </button>
                          <button
                            type="button"
                            class="settings-icon-btn"
                            onclick={() => moveRole(role.id, 'down')}
                            disabled={index === sortedRoles.length - 1 || roleUpdateBusy[role.id]}
                            aria-label="Move role down"
                          >
                            <i class="bx bx-chevron-down" aria-hidden="true"></i>
                          </button>
                          <button
                            class="px-3 py-1 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60 disabled:opacity-50"
                            onclick={() => deleteRole(role.id, role.name)}
                            disabled={!isOwner || roleUpdateBusy[role.id]}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <div class="settings-role-header__tagline">
                        <span class="text-xs text-white/40">ID: {role.id}</span>
                      </div>
                      <div class="settings-role-permissions">
                        {#each rolePermissionOptions as option}
                          <label class="settings-permission">
                            <input
                              type="checkbox"
                              checked={!!role.permissions?.[option.key]}
                              disabled={!isAdmin || roleUpdateBusy[role.id]}
                              onchange={(e) =>
                                toggleRolePermission(
                                  role.id,
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
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
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
            <label class="settings-label" for="delete-confirm">Type <code>confirm</code> to authorize deletion</label>
            <input
              id="delete-confirm"
              class="input input--danger"
              placeholder="confirm"
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
      </div>
    </div>
  </div>
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
    width: min(100%, 960px);
    margin: 0 auto;
    padding: clamp(1.25rem, 4vw, 2.5rem) clamp(1rem, 6vw, 3rem);
    display: flex;
    flex-direction: column;
    gap: clamp(1rem, 2.5vw, 1.75rem);
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

  .settings-role-header__tagline {
    font-size: 0.75rem;
    color: var(--text-60);
  }

  .settings-role-create {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
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
















