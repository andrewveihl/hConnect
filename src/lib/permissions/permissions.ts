// Discord-like server role and permission model.
// The bitset helpers keep a single numeric source of truth while still allowing
// boolean maps for UI or Firestore consumers.

export const PERMISSION_KEYS = [
  // General server
  'VIEW_SERVER',
  'MANAGE_SERVER',
  'MANAGE_CHANNELS',
  'MANAGE_ROLES',
  'MANAGE_WEBHOOKS',
  'VIEW_AUDIT_LOG',
  'MANAGE_EMOJIS_STICKERS',
  'MANAGE_EVENTS',
  // Member management
  'KICK_MEMBERS',
  'BAN_MEMBERS',
  'TIMEOUT_MEMBERS',
  // Channel + messaging
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'SEND_MESSAGES_IN_THREADS',
  'CREATE_PUBLIC_THREADS',
  'CREATE_PRIVATE_THREADS',
  'MANAGE_THREADS',
  'MANAGE_MESSAGES',
  'READ_MESSAGE_HISTORY',
  'ADD_REACTIONS',
  'MANAGE_REACTIONS',
  'EMBED_LINKS',
  'ATTACH_FILES',
  'USE_EXTERNAL_EMOJIS',
  'MENTION_EVERYONE',
  // Voice + stage
  'CONNECT_VOICE',
  'SPEAK_VOICE',
  'STREAM_VOICE',
  'MUTE_MEMBERS',
  'DEAFEN_MEMBERS',
  'MOVE_MEMBERS',
  'PRIORITY_SPEAKER',
  // Visibility / shell
  'VIEW_MEMBER_LIST',
  'VIEW_SERVER_HOME'
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type PermissionBitset = bigint;
export type PermissionMap = Partial<Record<PermissionKey, boolean>>;

export const PERMISSION_BITS: Record<PermissionKey, PermissionBitset> = PERMISSION_KEYS.reduce(
  (acc, key, index) => {
    acc[key] = 1n << BigInt(index);
    return acc;
  },
  {} as Record<PermissionKey, PermissionBitset>
);

export const ALL_PERMISSIONS_MASK: PermissionBitset = PERMISSION_KEYS.reduce(
  (mask, key) => mask | PERMISSION_BITS[key],
  0n
);

export const DEFAULT_EVERYONE_PERMISSIONS: PermissionBitset =
  PERMISSION_BITS.VIEW_SERVER |
  PERMISSION_BITS.VIEW_CHANNEL |
  PERMISSION_BITS.READ_MESSAGE_HISTORY |
  PERMISSION_BITS.SEND_MESSAGES |
  PERMISSION_BITS.ADD_REACTIONS |
  PERMISSION_BITS.CONNECT_VOICE;

export const ROLE_LIMITS = {
  maxRolesPerServer: 250,
  maxRolesPerMember: 25
};

export interface RoleDefinition {
  id: string;
  serverId: string;
  name: string;
  color?: string | null;
  description?: string | null;
  position: number;
  isOwnerRole?: boolean;
  isEveryoneRole?: boolean;
  mentionable?: boolean;
  allowMassMentions?: boolean;
  showInMemberList?: boolean;
  permissions: PermissionBitset | number | PermissionMap;
  createdAt?: any;
  updatedAt?: any;
}

export interface PermissionOverride {
  allow?: PermissionBitset | number | PermissionMap | null;
  deny?: PermissionBitset | number | PermissionMap | null;
}

export interface ChannelPermissionOverrides {
  everyone?: PermissionOverride | null;
  roles?: Record<string, PermissionOverride | undefined>;
  members?: Record<string, PermissionOverride | undefined>;
}

export interface ResolvedPermissions {
  bits: PermissionBitset;
  map: Record<PermissionKey, boolean>;
  isOwner: boolean;
  isSuperAdmin: boolean;
  topRolePosition: number;
}

export function permissionBitsFromMap(source?: PermissionMap | null): PermissionBitset {
  if (!source) return 0n;
  return PERMISSION_KEYS.reduce((mask, key) => (source[key] ? mask | PERMISSION_BITS[key] : mask), 0n);
}

export function toPermissionBits(value?: PermissionBitset | number | PermissionMap | null): PermissionBitset {
  if (!value) return 0n;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'bigint') return value;
  return permissionBitsFromMap(value);
}

export function permissionMapFromBits(bits: PermissionBitset): Record<PermissionKey, boolean> {
  const result: Record<PermissionKey, boolean> = {} as Record<PermissionKey, boolean>;
  for (const key of PERMISSION_KEYS) {
    result[key] = (bits & PERMISSION_BITS[key]) === PERMISSION_BITS[key];
  }
  return result;
}

export function bitsAsNumber(bits: PermissionBitset): number {
  return Number(bits);
}

export function mergePermissionMaps(...sources: Array<PermissionMap | null | undefined>): PermissionMap {
  const merged: PermissionMap = {};
  for (const source of sources) {
    if (!source) continue;
    for (const key of PERMISSION_KEYS) {
      if (source[key] !== undefined) {
        merged[key] = !!source[key];
      }
    }
  }
  return merged;
}

function applyOverride(base: PermissionBitset, override?: PermissionOverride | null): PermissionBitset {
  if (!override) return base;
  const allow = toPermissionBits(override.allow);
  const deny = toPermissionBits(override.deny);
  // Deny beats allow; allow can only grant if not denied.
  const withAllow = base | allow;
  return withAllow & ~deny;
}

export function resolveBasePermissions(args: {
  rolesById: Record<string, RoleDefinition | undefined>;
  memberRoleIds: string[];
  ownerRoleIds?: string[];
  isServerOwner?: boolean;
}): { bits: PermissionBitset; isOwner: boolean; topRolePosition: number } {
  const ownerIds = new Set((args.ownerRoleIds ?? []).filter(Boolean));
  let bits = 0n;
  let topRolePosition = 0;
  let isOwner = !!args.isServerOwner;

  for (const roleId of args.memberRoleIds) {
    const role = args.rolesById[roleId];
    if (!role) continue;
    const roleBits = toPermissionBits(role.permissions);
    bits |= roleBits;
    if (typeof role.position === 'number' && role.position > topRolePosition) {
      topRolePosition = role.position;
    }
    if (role.isOwnerRole || ownerIds.has(role.id)) {
      isOwner = true;
    }
  }

  return { bits, isOwner, topRolePosition };
}

export function resolveEffectivePermissions(args: {
  rolesById: Record<string, RoleDefinition | undefined>;
  memberRoleIds: string[];
  isServerOwner: boolean;
  isSuperAdmin: boolean;
  channelOverrides?: ChannelPermissionOverrides | null;
  userId?: string | null;
  ownerRoleIds?: string[] | null;
}): ResolvedPermissions {
  if (args.isSuperAdmin) {
    return {
      bits: ALL_PERMISSIONS_MASK,
      map: permissionMapFromBits(ALL_PERMISSIONS_MASK),
      isOwner: true,
      isSuperAdmin: true,
      topRolePosition: Number.MAX_SAFE_INTEGER
    };
  }

  const base = resolveBasePermissions({
    rolesById: args.rolesById,
    memberRoleIds: args.memberRoleIds,
    ownerRoleIds: args.ownerRoleIds ?? undefined,
    isServerOwner: args.isServerOwner
  });

  if (base.isOwner) {
    return {
      bits: ALL_PERMISSIONS_MASK,
      map: permissionMapFromBits(ALL_PERMISSIONS_MASK),
      isOwner: true,
      isSuperAdmin: false,
      topRolePosition: base.topRolePosition
    };
  }

  let bits = base.bits;
  const overrides = args.channelOverrides ?? {};
  const roleOverrides: PermissionOverride[] = [];
  if (overrides.roles) {
    for (const roleId of args.memberRoleIds) {
      const override = overrides.roles[roleId];
      if (override) {
        roleOverrides.push(override);
      }
    }
  }

  if (roleOverrides.length) {
    let allowMask = 0n;
    let denyMask = 0n;
    for (const override of roleOverrides) {
      allowMask |= toPermissionBits(override.allow);
      denyMask |= toPermissionBits(override.deny);
    }
    bits = (bits | allowMask) & ~denyMask;
  }

  if (overrides.everyone) {
    bits = applyOverride(bits, overrides.everyone);
  }

  const memberOverride =
    (args.userId && overrides.members && overrides.members[args.userId]) ?? null;
  if (memberOverride) {
    const allow = toPermissionBits(memberOverride.allow);
    const deny = toPermissionBits(memberOverride.deny);
    bits = (bits | allow) & ~deny;
  }

  return {
    bits,
    map: permissionMapFromBits(bits),
    isOwner: false,
    isSuperAdmin: false,
    topRolePosition: base.topRolePosition
  };
}

export function roleSort(a: RoleDefinition, b: RoleDefinition): number {
  if (a.position !== b.position) {
    return (b.position ?? 0) - (a.position ?? 0);
  }
  return a.name.localeCompare(b.name);
}

export function coerceRole(role: Partial<RoleDefinition> & { id: string; serverId: string }): RoleDefinition {
  const name = (role.name ?? '').toString().trim() || 'Role';
  const position = typeof role.position === 'number' ? role.position : 0;
  const color = typeof role.color === 'string' ? role.color : null;
  const description =
    typeof role.description === 'string' && role.description.trim().length
      ? role.description.trim()
      : null;

  return {
    id: role.id,
    serverId: role.serverId,
    name,
    color,
    description,
    position,
    isOwnerRole: !!role.isOwnerRole,
    isEveryoneRole: !!role.isEveryoneRole,
    mentionable: role.mentionable ?? false,
    allowMassMentions: role.allowMassMentions ?? false,
    showInMemberList: role.showInMemberList ?? true,
    permissions: toPermissionBits(role.permissions ?? 0n)
  };
}
