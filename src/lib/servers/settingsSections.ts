export type ServerSettingsSectionId =
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

export type ServerSettingsSection = {
	id: ServerSettingsSectionId;
	group: string;
	label: string;
	keywords?: string[];
};

export const serverSettingsSections: ServerSettingsSection[] = [
	{
		id: 'profile',
		group: 'Server',
		label: 'Server Profile',
		keywords: ['profile', 'icon', 'banner', 'branding', 'appearance']
	},
	{
		id: 'insights',
		group: 'Server',
		label: 'Server Insights',
		keywords: ['analytics', 'stats', 'growth']
	},
	{
		id: 'channels',
		group: 'Content',
		label: 'Channels',
		keywords: ['text', 'voice', 'forum', 'order', 'reorder']
	},
	{
		id: 'engagement',
		group: 'Content',
		label: 'Engagement',
		keywords: ['activity', 'events', 'metrics', 'coming soon']
	},
	{
		id: 'members',
		group: 'People',
		label: 'Members',
		keywords: ['people', 'roster', 'grid']
	},
	{
		id: 'roles',
		group: 'People',
		label: 'Roles',
		keywords: ['permissions', 'access', 'colors', 'display']
	},
	{
		id: 'invites',
		group: 'People',
		label: 'Invites',
		keywords: ['pending', 'auto', 'domain', 'send']
	},
	{
		id: 'access',
		group: 'People',
		label: 'Access',
		keywords: ['permissions', 'coming soon', 'gates']
	},
	{
		id: 'integrations',
		group: 'Automation',
		label: 'Integrations',
		keywords: ['bots', 'apps', 'webhooks', 'issues', 'domains']
	},
	{
		id: 'audit-log',
		group: 'Automation',
		label: 'Audit Log',
		keywords: ['history', 'log', 'activity']
	},
	{
		id: 'bans',
		group: 'Safety',
		label: 'Bans',
		keywords: ['moderation', 'safety', 'blocked']
	},
	{
		id: 'welcome',
		group: 'Content',
		label: 'Welcome Screen',
		keywords: ['onboarding', 'first run', 'coming soon']
	},
	{
		id: 'danger',
		group: 'Danger',
		label: 'Danger Zone',
		keywords: ['delete', 'danger', 'reset']
	}
];

export const defaultServerSettingsSection: ServerSettingsSectionId = 'profile';

const sectionAliases: Record<string, ServerSettingsSectionId> = {
	member: 'members',
	members: 'members',
	invite: 'invites',
	danger: 'danger',
	delete: 'danger',
	'delete-server': 'danger',
	perms: 'roles',
	permission: 'access',
	permissions: 'access',
	moderation: 'bans',
	mods: 'bans',
	audit: 'audit-log',
	'audit-log': 'audit-log',
	overview: 'profile'
};

export function resolveServerSettingsSection(
	value: string | null | undefined
): ServerSettingsSectionId {
	if (!value) return defaultServerSettingsSection;
	const normalized = value.toLowerCase();
	if (serverSettingsSections.some((section) => section.id === normalized)) {
		return normalized as ServerSettingsSectionId;
	}
	return sectionAliases[normalized] ?? defaultServerSettingsSection;
}

export type ServerPanelSectionId = ServerSettingsSectionId;

export function mapServerSectionToPanel(id: ServerSettingsSectionId): ServerPanelSectionId {
	return id;
}
