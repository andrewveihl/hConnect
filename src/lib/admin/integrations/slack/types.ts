/**
 * Slack Integration Types
 * Defines data structures for Slack <-> hConnect channel bridging
 */

export type SlackConnectionStatus = 'pending' | 'active' | 'paused' | 'error' | 'disconnected';
export type SyncDirection = 'slack-to-hconnect' | 'hconnect-to-slack' | 'bidirectional';

export interface SlackWorkspace {
	id: string;
	teamId: string;
	teamName: string;
	teamDomain: string;
	teamIcon?: string;
	accessToken: string; // encrypted
	botUserId: string;
	botAccessToken: string; // encrypted
	installedBy: string;
	installedAt: number;
	scopes: string[];
}

export interface SlackChannelInfo {
	id: string;
	name: string;
	isPrivate: boolean;
	topic?: string;
	memberCount?: number;
}

export interface SlackChannelBridge {
	id: string;
	// Slack side
	slackWorkspaceId: string;
	slackTeamId: string;
	slackTeamName: string;
	slackChannelId: string;
	slackChannelName: string;
	// hConnect side
	hconnectServerId: string;
	hconnectServerName: string;
	hconnectChannelId: string;
	hconnectChannelName: string;
	// Sync config
	syncDirection: SyncDirection;
	status: SlackConnectionStatus;
	// Options
	syncReactions: boolean;
	syncThreads: boolean;
	syncAttachments: boolean;
	showSlackUsernames: boolean; // Show "via Slack: @username" or just "Slack User"
	// Metadata
	createdBy: string;
	createdAt: number;
	updatedAt: number;
	lastSyncAt?: number;
	lastError?: string;
	messageCount?: number;
}

export interface SlackIntegrationConfig {
	enabled: boolean;
	workspaces: SlackWorkspace[];
	bridges: SlackChannelBridge[];
	globalSettings: {
		defaultSyncDirection: SyncDirection;
		defaultSyncReactions: boolean;
		defaultSyncThreads: boolean;
		defaultSyncAttachments: boolean;
		rateLimitPerMinute: number;
		webhookSecret?: string;
	};
}

export interface SlackIncomingMessage {
	type: 'message';
	subtype?: string;
	channel: string;
	user: string;
	text: string;
	ts: string;
	thread_ts?: string;
	team: string;
	files?: SlackFile[];
	reactions?: SlackReaction[];
}

export interface SlackFile {
	id: string;
	name: string;
	mimetype: string;
	url_private: string;
	size: number;
}

export interface SlackReaction {
	name: string;
	users: string[];
	count: number;
}

export interface SlackUser {
	id: string;
	name: string;
	real_name?: string;
	profile?: {
		display_name?: string;
		image_48?: string;
		image_72?: string;
	};
}

// Firestore document paths
export const SLACK_COLLECTION = 'integrations/slack';
export const SLACK_WORKSPACES_COLLECTION = 'integrations/slack/workspaces';
export const SLACK_BRIDGES_COLLECTION = 'integrations/slack/bridges';

// OAuth scopes needed for full integration
export const REQUIRED_BOT_SCOPES = [
	'channels:history',
	'channels:read',
	'chat:write',
	'groups:history',
	'groups:read',
	'im:history',
	'im:read',
	'reactions:read',
	'reactions:write',
	'users:read',
	'files:read',
	'team:read'
];

// Scopes for user token (optional, for richer integration)
export const OPTIONAL_USER_SCOPES = [
	'channels:write',
	'groups:write'
];
