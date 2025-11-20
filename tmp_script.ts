
  import { run, passive, preventDefault } from 'svelte/legacy';

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { user } from '$lib/stores/user';
  import { getDb } from '$lib/firebase';
  import { createChannel } from '$lib/firestore/channels';
  import { removeUserMembership } from '$lib/firestore/servers';
  import { sendServerInvite, type ServerInvite } from '$lib/firestore/invites';
  import { subscribeServerDirectory, type MentionDirectoryEntry } from '$lib/firestore/membersDirectory';

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

// routing
  let serverId: string | null = $state(null);
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
  let deleteConfirm = $state('');
  let deleteBusy = $state(false);
  let deleteError: string | null = $state(null);

  // tabs
  type Tab = 'overview' | 'members' | 'channels' | 'roles' | 'danger';
  let tab: Tab = $state('members'); // land on Members where Invite lives
  const tabItems: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: 'Members' },
    { id: 'channels', label: 'Channels' },
    { id: 'roles', label: 'Roles' },
    { id: 'danger', label: 'Danger Zone' }
  ];

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
      serverId = $page.params.serverID || ($page.params as any).serverId || null;
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
      inviteAutomationStatus = 'Settings saved.';
      inviteAutomationError = null;
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
        const result = await inviteUser(candidate.uid, { silent: auto || single });
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
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 820;
  }

  function handleTouchStart(event: TouchEvent) {
    if (!swipeEnabled() || event.touches.length === 0) return;
    const touch = event.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchStartAt = performance.now();
    touchStartTarget = event.target;
  }

  function handleTouchEnd(event: TouchEvent) {
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
  async function inviteUser(toUid: string, options: { silent?: boolean } = {}) {
    const silent = options?.silent ?? false;
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
        channelName: fallback.name || 'general'
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
