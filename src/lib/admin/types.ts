export type AdminNavItem = {
  id: string;
  label: string;
  href: string;
  icon: string;
  description?: string;
  badge?: 'new' | 'beta' | null;
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { 
    id: 'overview', 
    label: 'Overview', 
    href: '/admin',
    icon: 'bx-home-circle',
    description: 'Dashboard with key metrics'
  },
  { 
    id: 'servers', 
    label: 'Servers', 
    href: '/admin/servers',
    icon: 'bx-server',
    description: 'Manage all servers'
  },
  { 
    id: 'users', 
    label: 'Users', 
    href: '/admin/users',
    icon: 'bx-group',
    description: 'User accounts & permissions'
  },
  { 
    id: 'dms', 
    label: 'DMs', 
    href: '/admin/dms',
    icon: 'bx-message-detail',
    description: 'Direct message threads'
  },
  { 
    id: 'features', 
    label: 'Features', 
    href: '/admin/features',
    icon: 'bx-toggle-right',
    description: 'Feature flags & toggles'
  },
  { 
    id: 'logs', 
    label: 'Logs', 
    href: '/admin/logs',
    icon: 'bx-list-ul',
    description: 'System activity logs'
  },
  { 
    id: 'archive', 
    label: 'Archive', 
    href: '/admin/archive',
    icon: 'bx-archive',
    description: 'Soft-deleted content'
  },
  { 
    id: 'health', 
    label: 'System', 
    href: '/admin/health',
    icon: 'bx-pulse',
    description: 'System health & metrics'
  },
  { 
    id: 'announcements', 
    label: 'Alerts', 
    href: '/admin/announcements',
    icon: 'bx-bell',
    description: 'System announcements'
  },
  { 
    id: 'appearance', 
    label: 'Appearance', 
    href: '/admin/super-admins',
    icon: 'bx-palette',
    description: 'Themes, splash, and global sounds'
  }
];

export type FeatureFlagKey =
  | 'enableServers'
  | 'enableChannels'
  | 'enableDMs'
  | 'enableVoice'
  | 'enableVideo'
  | 'enableReactions'
  | 'enableFileUploads'
  | 'enableNotifications'
  | 'enableServerCreation'
  | 'enableInviteLinks'
  | 'enablePresence'
  | 'enableAIFeatures'
  | 'enableAISuggestedReplies'
  | 'enableAIPredictions'
  | 'enableAISummaries'
  | 'enableTypingIndicators'
  | 'enableReadReceipts'
  | 'enableMessageEditing'
  | 'enableMessageDeleting'
  | 'readOnlyMode'
  | 'showNotificationDebugTools';

export type FeatureFlagMap = Record<FeatureFlagKey, boolean>;

export type FeatureFlagMeta = {
  key: FeatureFlagKey;
  label: string;
  description: string;
};

export const FEATURE_FLAGS: FeatureFlagMeta[] = [
  {
    key: 'enableServers',
    label: 'Servers',
    description: 'Toggle all server level functionality.'
  },
  {
    key: 'enableChannels',
    label: 'Channels',
    description: 'Allow channel creation and access.'
  },
  {
    key: 'enableDMs',
    label: 'Direct Messages',
    description: 'Enable DM threads.'
  },
  {
    key: 'enableVoice',
    label: 'Voice',
    description: 'Allow voice rooms and calls.'
  },
  {
    key: 'enableVideo',
    label: 'Video',
    description: 'Allow video rooms and streaming.'
  },
  {
    key: 'enableReactions',
    label: 'Reactions',
    description: 'Show and send message reactions.'
  },
  {
    key: 'enableFileUploads',
    label: 'File Uploads',
    description: 'Permit media and document uploads.'
  },
  {
    key: 'enableNotifications',
    label: 'Notifications',
    description: 'Send push and in-app alerts.'
  },
  {
    key: 'enableServerCreation',
    label: 'Server Creation',
    description: 'Allow users to create new servers.'
  },
  {
    key: 'enableInviteLinks',
    label: 'Invite Links',
    description: 'Enable invite link generation.'
  },
  {
    key: 'enablePresence',
    label: 'Presence',
    description: 'Show online/offline presence.'
  },
  {
    key: 'enableAIFeatures',
    label: 'AI Features',
    description: 'Expose AI assisted features.'
  },
  {
    key: 'enableAISuggestedReplies',
    label: 'AI Suggested Replies',
    description: 'Offer AI drafted replies in the composer coach.'
  },
  {
    key: 'enableAIPredictions',
    label: 'AI Predicted Text',
    description: 'Show inline ghost suggestions while typing.'
  },
  {
    key: 'enableAISummaries',
    label: 'Thread Summaries',
    description: 'Enable AI-powered recap panels in threads.'
  },
  {
    key: 'enableTypingIndicators',
    label: 'Typing Indicators',
    description: 'Broadcast typing states.'
  },
  {
    key: 'enableReadReceipts',
    label: 'Read Receipts',
    description: 'Track read/unread status.'
  },
  {
    key: 'enableMessageEditing',
    label: 'Message Editing',
    description: 'Allow message edits.'
  },
  {
    key: 'enableMessageDeleting',
    label: 'Message Deletion',
    description: 'Allow message delete controls.'
  },
  {
    key: 'showNotificationDebugTools',
    label: 'Notification debug tools',
    description: 'Expose in-app test push buttons and debug logs.'
  },
  {
    key: 'readOnlyMode',
    label: 'Read-only Mode',
    description: 'Lock outbound messaging globally.'
  }
];

export const DEFAULT_FEATURE_FLAGS: FeatureFlagMap = {
  enableServers: true,
  enableChannels: true,
  enableDMs: true,
  enableVoice: true,
  enableVideo: true,
  enableReactions: true,
  enableFileUploads: true,
  enableNotifications: true,
  enableServerCreation: true,
  enableInviteLinks: true,
  enablePresence: true,
  enableAIFeatures: true,
  enableAISuggestedReplies: true,
  enableAIPredictions: true,
  enableAISummaries: true,
  enableTypingIndicators: true,
  enableReadReceipts: true,
  enableMessageEditing: true,
  enableMessageDeleting: true,
  readOnlyMode: false,
  showNotificationDebugTools: true
};

export type AdminLogType =
  | 'chat'
  | 'voice'
  | 'notifications'
  | 'permissions'
  | 'auth'
  | 'presence'
  | 'featureToggle'
  | 'adminAction'
  | 'system'
  | 'storage';

export type AdminLogLevel = 'info' | 'warning' | 'error';

export type AdminLogEntry = {
  id: string;
  type: AdminLogType;
  message: string;
  data?: Record<string, unknown> | null;
  serverId?: string | null;
  channelId?: string | null;
  dmId?: string | null;
  userId?: string | null;
  level: AdminLogLevel;
  createdAt: Date;
};

export type ClientErrorLogEntry = {
  id: string;
  message: string;
  stack?: string | null;
  source?: string | null;
  context?: Record<string, unknown> | null;
  path?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  userAgent?: string | null;
  severity?: 'error' | 'warning';
  createdAt: Date;
};

export type AdminLogFilter = {
  type?: AdminLogType | null;
  level?: AdminLogLevel | null;
  serverId?: string | null;
  channelId?: string | null;
  dmId?: string | null;
  userId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  limit?: number;
  search?: string;
};

export type ArchiveTab = 'servers' | 'channels' | 'messages' | 'dms' | 'attachments';

export type SuperAdminMap = Record<string, boolean>;
