export type ServerSettingsSectionId =
  | 'overview'
  | 'roles'
  | 'channels'
  | 'permissions'
  | 'invites'
  | 'moderation'
  | 'integrations'
  | 'audit-log'
  | 'danger';

export type ServerSettingsSection = {
  id: ServerSettingsSectionId;
  group: string;
  label: string;
  keywords?: string[];
};

export const serverSettingsSections: ServerSettingsSection[] = [
  {
    id: 'overview',
    group: 'Server Overview',
    label: 'Overview',
    keywords: ['profile', 'icon', 'appearance', 'branding']
  },
  {
    id: 'roles',
    group: 'Access',
    label: 'Roles',
    keywords: ['permissions', 'access', 'colors']
  },
  {
    id: 'channels',
    group: 'Access',
    label: 'Channels',
    keywords: ['text', 'voice', 'order', 'reorder']
  },
  {
    id: 'permissions',
    group: 'Access',
    label: 'Permissions',
    keywords: ['manage', 'channel', 'role']
  },
  {
    id: 'invites',
    group: 'Members',
    label: 'Invites',
    keywords: ['members', 'people', 'domain', 'auto']
  },
  {
    id: 'moderation',
    group: 'Members',
    label: 'Moderation',
    keywords: ['ban', 'kick', 'safety']
  },
  {
    id: 'integrations',
    group: 'Automation',
    label: 'Integrations',
    keywords: ['bots', 'apps', 'webhooks']
  },
  {
    id: 'audit-log',
    group: 'Automation',
    label: 'Audit Log',
    keywords: ['history', 'log', 'activity']
  },
  {
    id: 'danger',
    group: 'Danger Zone',
    label: 'Delete Server',
    keywords: ['delete', 'danger', 'reset']
  }
];

export const defaultServerSettingsSection: ServerSettingsSectionId = 'overview';

const sectionAliases: Record<string, ServerSettingsSectionId> = {
  member: 'invites',
  members: 'invites',
  invite: 'invites',
  danger: 'danger',
  delete: 'danger',
  'delete-server': 'danger',
  perms: 'permissions',
  permission: 'permissions',
  moderation: 'moderation',
  mods: 'moderation',
  audit: 'audit-log',
  'audit-log': 'audit-log'
};

export function resolveServerSettingsSection(value: string | null | undefined): ServerSettingsSectionId {
  if (!value) return defaultServerSettingsSection;
  const normalized = value.toLowerCase();
  if (serverSettingsSections.some((section) => section.id === normalized)) {
    return normalized as ServerSettingsSectionId;
  }
  return sectionAliases[normalized] ?? defaultServerSettingsSection;
}

export type ServerPanelSectionId = 'overview' | 'members' | 'channels' | 'roles' | 'danger';

export function mapServerSectionToPanel(id: ServerSettingsSectionId): ServerPanelSectionId {
  switch (id) {
    case 'roles':
    case 'permissions':
      return 'roles';
    case 'channels':
      return 'channels';
    case 'invites':
    case 'moderation':
      return 'members';
    case 'danger':
      return 'danger';
    default:
      return 'overview';
  }
}
