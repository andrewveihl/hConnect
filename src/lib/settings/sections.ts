export type SettingsSectionId = 'account' | 'notifications' | 'appearance' | 'ai' | 'invites';

export type SettingsSection = {
  id: SettingsSectionId;
  group: string;
  label: string;
  keywords?: string[];
};

export const settingsSections: SettingsSection[] = [
  {
    id: 'account',
    group: 'User Settings',
    label: 'My Account',
    keywords: ['profile', 'name', 'photo', 'avatar', 'sign out']
  },
  {
    id: 'notifications',
    group: 'User Settings',
    label: 'Notifications',
    keywords: ['push', 'desktop', 'alerts', 'test']
  },
  {
    id: 'appearance',
    group: 'App Settings',
    label: 'Appearance',
    keywords: ['theme', 'color', 'display']
  },
  {
    id: 'ai',
    group: 'App Settings',
    label: 'AI Assist',
    keywords: ['ai', 'assist']
  },
  {
    id: 'invites',
    group: 'App Settings',
    label: 'Invites',
    keywords: ['invite', 'share', 'link']
  }
];

export const defaultSettingsSection: SettingsSectionId = 'account';

export function resolveSectionId(value: string | null | undefined): SettingsSectionId {
  if (!value) return defaultSettingsSection;
  return settingsSections.some((section) => section.id === value)
    ? (value as SettingsSectionId)
    : defaultSettingsSection;
}
