/**
 * Slack Integration - Cloud Functions
 * Handles incoming Slack webhooks and syncs messages to hConnect
 * Credentials are stored per-server in Firestore
 */

import { logger } from 'firebase-functions';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';
import { db } from './firebase';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as crypto from 'crypto';

// ============ Types ============

interface SlackAppCredentials {
	clientId: string;
	clientSecret: string;
	signingSecret: string;
}

interface ServerSlackConfig {
	enabled: boolean;
	credentials?: SlackAppCredentials;
}

interface SlackEventPayload {
	token: string;
	team_id: string;
	api_app_id: string;
	event: SlackEvent;
	type: 'event_callback' | 'url_verification';
	challenge?: string;
	event_id: string;
	event_time: number;
}

interface SlackEvent {
	type: string;
	channel: string;
	user: string;
	text: string;
	ts: string;
	thread_ts?: string;
	team?: string;
	subtype?: string;
	bot_id?: string;
	files?: SlackFile[];
	// Reaction events
	reaction?: string;
	item?: {
		type: string;
		channel: string;
		ts: string;
	};
	item_user?: string;
	event_ts?: string;
}

interface SlackFile {
	id: string;
	name: string;
	mimetype: string;
	url_private: string;
	size: number;
}

interface SlackChannelBridge {
	id: string;
	slackWorkspaceId: string;
	slackTeamId: string;
	slackChannelId: string;
	hconnectServerId: string;
	hconnectChannelId: string;
	syncDirection: 'slack-to-hconnect' | 'hconnect-to-slack' | 'bidirectional';
	status: 'active' | 'paused' | 'error' | 'disconnected';
	showSlackUsernames: boolean;
	syncReactions?: boolean;
	syncThreads?: boolean;
	syncAttachments?: boolean;
}

interface SlackWorkspace {
	id: string;
	serverId: string; // Which hConnect server this workspace belongs to
	teamId: string;
	accessToken: string;
	botAccessToken: string;
}

interface SlackUserCache {
	[userId: string]: {
		name: string;
		realName?: string;
		avatar?: string;
		fetchedAt: number;
	};
}

// In-memory cache for Slack users (refresh every hour)
const slackUserCache: SlackUserCache = {};
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const THREAD_DEFAULT_TTL_HOURS = 24;
const THREAD_MAX_MEMBER_LIMIT = 20;
const THREAD_ARCHIVE_MAX_HOURS = 7 * 24;
const THREAD_VISIBILITY = 'inherit_parent_with_exceptions';

const clampNumber = (value: number, min: number, max: number) =>
	Math.max(min, Math.min(max, value));

const nextAutoArchiveAt = (ttlHours: number) => {
	const ttl = clampNumber(ttlHours, 1, THREAD_ARCHIVE_MAX_HOURS);
	return Date.now() + ttl * 60 * 60 * 1000;
};

const normalizeText = (value: string | null | undefined) =>
	typeof value === 'string' ? value.trim() : '';

const compactWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const previewFromText = (value: string | null | undefined, max = 120) => {
	const cleaned = compactWhitespace(normalizeText(value));
	if (!cleaned) return '';
	return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
};

const threadNameFromText = (value: string | null | undefined) => {
	const cleaned = previewFromText(value, 48);
	return cleaned || 'Thread';
};

const isSlackUid = (value: string | null | undefined) =>
	typeof value === 'string' && value.startsWith('slack:');

const pickMessageText = (data?: Record<string, any> | null) => {
	if (!data) return '';
	return normalizeText(
		data.plainTextContent ?? data.text ?? data.content ?? data.preview ?? ''
	);
};

const pickMessageAuthorId = (data?: Record<string, any> | null): string | null => {
	if (!data) return null;
	const uid = typeof data.uid === 'string' ? data.uid : null;
	const authorId = typeof data.authorId === 'string' ? data.authorId : null;
	const picked = normalizeText(uid ?? authorId ?? '');
	return picked || null;
};

// ============ Credentials Helpers ============

/**
 * Get server config with credentials for a server
 */
async function getServerSlackConfig(serverId: string): Promise<ServerSlackConfig | null> {
	const configDoc = await db.doc(`servers/${serverId}/integrations/slack`).get();
	if (!configDoc.exists) {
		return null;
	}
	return configDoc.data() as ServerSlackConfig;
}

/**
 * Find server ID by Slack team ID (look through all workspaces)
 */
async function findServerByTeamId(teamId: string): Promise<string | null> {
	// Search across all servers for a workspace with this team ID
	const serversSnapshot = await db.collection('servers').get();
	
	for (const serverDoc of serversSnapshot.docs) {
		const workspacesSnapshot = await db
			.collection(`servers/${serverDoc.id}/integrations/slack/workspaces`)
			.where('teamId', '==', teamId)
			.limit(1)
			.get();
		
		if (!workspacesSnapshot.empty) {
			return serverDoc.id;
		}
	}
	
	return null;
}

// ============ Verification ============

/**
 * Verify Slack request signature
 */
function verifySlackSignature(
	signingSecret: string,
	signature: string | undefined,
	timestamp: string | undefined,
	body: string
): boolean {
	if (!signature || !timestamp) {
		logger.warn('[slack] Missing signature or timestamp');
		return false;
	}

	// Check timestamp is within 5 minutes
	const time = Math.floor(Date.now() / 1000);
	if (Math.abs(time - parseInt(timestamp)) > 300) {
		logger.warn('[slack] Request timestamp too old');
		return false;
	}

	// Compute expected signature
	const sigBaseString = `v0:${timestamp}:${body}`;
	const mySignature = 'v0=' + crypto
		.createHmac('sha256', signingSecret)
		.update(sigBaseString, 'utf8')
		.digest('hex');

	return crypto.timingSafeEqual(
		Buffer.from(mySignature, 'utf8'),
		Buffer.from(signature, 'utf8')
	);
}

// ============ Slack API Helpers ============

/**
 * Fetch Slack user info and cache it
 */
async function getSlackUser(
	userId: string,
	botToken: string
): Promise<{ name: string; realName?: string; avatar?: string } | null> {
	// Check cache first
	const cached = slackUserCache[userId];
	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
		return cached;
	}

	try {
		const response = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
			headers: {
				'Authorization': `Bearer ${botToken}`,
				'Content-Type': 'application/json'
			}
		});

		const data = await response.json() as {
			ok: boolean;
			user?: {
				name: string;
				real_name?: string;
				profile?: {
					display_name?: string;
					image_48?: string;
				};
			};
		};

		if (data.ok && data.user) {
			const userInfo = {
				name: data.user.profile?.display_name || data.user.name,
				realName: data.user.real_name,
				avatar: data.user.profile?.image_48,
				fetchedAt: Date.now()
			};
			slackUserCache[userId] = userInfo;
			return userInfo;
		}

		return null;
	} catch (err) {
		logger.error('[slack] Failed to fetch user info', { userId, error: err });
		return null;
	}
}

/**
 * Convert Slack markdown to hConnect format
 */
function convertSlackToHConnect(text: string): string {
	if (!text) return '';

	let converted = text;

	// Convert Slack user mentions <@U123ABC> to placeholder
	converted = converted.replace(/<@([A-Z0-9]+)>/g, '@slack-user');

	// Convert Slack channel mentions <#C123ABC|channel-name>
	converted = converted.replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1');

	// Convert Slack links <http://example.com|text> or <http://example.com>
	converted = converted.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '[$2]($1)');
	converted = converted.replace(/<(https?:\/\/[^>]+)>/g, '$1');

	// Convert Slack bold *text* (but not already converted markdown)
	// Slack uses single * for bold, hConnect/markdown uses **
	// Be careful not to double-convert
	converted = converted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '**$1**');

	// Slack _italic_ to *italic*
	converted = converted.replace(/(?<!_)_([^_]+)_(?!_)/g, '*$1*');

	// Slack ~strikethrough~ to ~~strikethrough~~
	converted = converted.replace(/~([^~]+)~/g, '~~$1~~');

	// Convert Slack code blocks ```code``` (already compatible)
	// Convert inline code `code` (already compatible)

	return converted;
}

// ============ Bridge Lookup ============

/**
 * Find bridge for a Slack channel (searches across all servers)
 * Returns the bridge and its server ID
 */
async function findBridgeForSlackChannel(
	teamId: string,
	channelId: string
): Promise<{ bridge: SlackChannelBridge; serverId: string } | null> {
	// Search across all servers
	const serversSnapshot = await db.collection('servers').get();
	
	for (const serverDoc of serversSnapshot.docs) {
		const bridgesSnapshot = await db
			.collection(`servers/${serverDoc.id}/integrations/slack/bridges`)
			.where('slackTeamId', '==', teamId)
			.where('slackChannelId', '==', channelId)
			.where('status', '==', 'active')
			.limit(1)
			.get();

		if (!bridgesSnapshot.empty) {
			const doc = bridgesSnapshot.docs[0];
			return {
				bridge: { id: doc.id, ...doc.data() } as SlackChannelBridge,
				serverId: serverDoc.id
			};
		}
	}

	return null;
}

/**
 * Get workspace by team ID for a specific server
 */
async function getWorkspaceByTeamId(serverId: string, teamId: string): Promise<SlackWorkspace | null> {
	const workspacesSnapshot = await db
		.collection(`servers/${serverId}/integrations/slack/workspaces`)
		.where('teamId', '==', teamId)
		.limit(1)
		.get();

	if (workspacesSnapshot.empty) {
		return null;
	}

	const doc = workspacesSnapshot.docs[0];
	return { id: doc.id, serverId, ...doc.data() } as SlackWorkspace;
}

// ============ Message Sync ============

/**
 * Create an hConnect message from a Slack message
 */
async function syncSlackMessageToHConnect(
	event: SlackEvent,
	bridge: SlackChannelBridge,
	workspace: SlackWorkspace,
	serverId: string
): Promise<void> {
	// Skip bot messages to avoid loops
	if (event.bot_id || event.subtype === 'bot_message') {
		logger.info('[slack] Skipping bot message');
		return;
	}

	// Skip message subtypes we don't handle
	const skipSubtypes = ['channel_join', 'channel_leave', 'channel_topic', 'channel_purpose'];
	if (event.subtype && skipSubtypes.includes(event.subtype)) {
		logger.info('[slack] Skipping system message', { subtype: event.subtype });
		return;
	}

	// Get Slack user info
	let authorName = 'Slack User';
	let authorAvatar: string | undefined;

	if (bridge.showSlackUsernames && event.user) {
		const userInfo = await getSlackUser(event.user, workspace.botAccessToken);
		if (userInfo) {
			authorName = userInfo.realName || userInfo.name;
			authorAvatar = userInfo.avatar;
		}
	}

	// Convert message content
	const content = convertSlackToHConnect(event.text);

	const hconnectServerId = bridge.hconnectServerId || serverId;
	const hconnectChannelId = bridge.hconnectChannelId;
	const slackUid = `slack:${event.user}`;

	// Create the message document
	let messageRef = db
		.collection(`servers/${hconnectServerId}/channels/${hconnectChannelId}/messages`)
		.doc();

	// Check if this is a thread reply and find the parent message
	let replyToId: string | null = null;
	let isThreadReply = false;
	let threadTarget: { id: string; data: Record<string, any> } | null = null;
	
	if (event.thread_ts && event.thread_ts !== event.ts) {
		isThreadReply = true;
		// Find the parent message in hConnect
		const parentMessage = await findHConnectMessageBySlackTs(
			hconnectServerId,
			hconnectChannelId,
			event.thread_ts
		);
		if (parentMessage) {
			replyToId = parentMessage.id;
			if (bridge.syncThreads !== false) {
				try {
					threadTarget = await ensureThreadForParentMessage({
						serverId: hconnectServerId,
						channelId: hconnectChannelId,
						parentMessageId: parentMessage.id,
						parentMessageData: parentMessage.data,
						fallbackCreatorId: slackUid
					});
				} catch (err) {
					logger.warn('[slack] Failed to ensure thread for Slack reply', {
						serverId: hconnectServerId,
						channelId: hconnectChannelId,
						parentMessageId: parentMessage.id,
						error: err
					});
				}
			} else {
				logger.info('[slack] Thread sync disabled for bridge, storing reply as channel message', {
					bridgeId: bridge.id,
					parentMessageId: parentMessage.id
				});
			}
		} else {
			logger.warn('[slack] Thread reply missing parent message, storing as channel message', {
				bridgeId: bridge.id,
				threadTs: event.thread_ts
			});
		}
	}

	if (threadTarget) {
		messageRef = db
			.collection(
				`servers/${hconnectServerId}/channels/${hconnectChannelId}/threads/${threadTarget.id}/messages`
			)
			.doc();
	}

	const baseMessageData = {
		// Core fields
		uid: slackUid, // Special UID format for Slack users
		authorId: slackUid,
		text: content,
		content: content,
		plainTextContent: event.text,

		// Author info (for display)
		author: {
			displayName: authorName,
			photoURL: authorAvatar || null,
			isSlackUser: true
		},
		displayName: authorName,

		// Slack metadata
		slackMeta: {
			teamId: event.team || bridge.slackTeamId,
			channelId: event.channel,
			userId: event.user,
			messageTs: event.ts,
			threadTs: event.thread_ts || null,
			bridgeId: bridge.id,
			isThreadReply
		},

		// Timestamps
		createdAt: Timestamp.now(),
		updatedAt: Timestamp.now(),

		// Flags
		isSlackMessage: true,
		type: 'text'
	};

	const messageData = threadTarget
		? {
				...baseMessageData,
				serverId: hconnectServerId,
				channelId: hconnectChannelId,
				threadId: threadTarget.id,
				...(isThreadReply && { isThreadReply: true })
			}
		: {
				...baseMessageData,
				...(replyToId && { replyTo: replyToId }),
				...(isThreadReply && { isThreadReply: true })
			};

	await messageRef.set(messageData);

	if (threadTarget) {
		const preview = previewFromText(content, 120) || 'New message';
		const ttlHours =
			typeof threadTarget.data?.ttlHours === 'number'
				? threadTarget.data.ttlHours
				: THREAD_DEFAULT_TTL_HOURS;

		await db
			.doc(`servers/${hconnectServerId}/channels/${hconnectChannelId}/threads/${threadTarget.id}`)
			.update({
				lastMessageAt: Timestamp.now(),
				lastMessagePreview: preview,
				autoArchiveAt: nextAutoArchiveAt(ttlHours),
				status: 'active',
				archivedAt: null,
				messageCount: FieldValue.increment(1)
			});
	}

	// Update bridge stats (using per-server path)
	await db.doc(`servers/${hconnectServerId}/integrations/slack/bridges/${bridge.id}`).update({
		lastSyncAt: Timestamp.now(),
		messageCount: FieldValue.increment(1)
	});

	logger.info('[slack] Message synced to hConnect', {
		bridgeId: bridge.id,
		messageId: messageRef.id,
		slackTs: event.ts
	});
}

/**
 * Find hConnect message by Slack timestamp
 */
async function findHConnectMessageBySlackTs(
	serverId: string,
	channelId: string,
	slackTs: string
): Promise<{ id: string; data: Record<string, any>; reactions?: Record<string, string[]> } | null> {
	const messagesSnapshot = await db
		.collection(`servers/${serverId}/channels/${channelId}/messages`)
		.where('slackMeta.messageTs', '==', slackTs)
		.limit(1)
		.get();

	if (messagesSnapshot.empty) {
		return null;
	}

	const doc = messagesSnapshot.docs[0];
	const data = doc.data() as Record<string, any>;
	return {
		id: doc.id,
		data,
		reactions: data.reactions || {}
	};
}

async function findThreadByParentMessageId(
	serverId: string,
	channelId: string,
	parentMessageId: string
): Promise<{ id: string; data: Record<string, any> } | null> {
	const threadsSnapshot = await db
		.collection(`servers/${serverId}/channels/${channelId}/threads`)
		.where('createdFromMessageId', '==', parentMessageId)
		.limit(1)
		.get();

	if (threadsSnapshot.empty) {
		return null;
	}

	const doc = threadsSnapshot.docs[0];
	return { id: doc.id, data: doc.data() as Record<string, any> };
}

async function createThreadForParentMessage(options: {
	serverId: string;
	channelId: string;
	parentMessageId: string;
	parentMessageData?: Record<string, any> | null;
	fallbackCreatorId: string;
}): Promise<{ id: string; data: Record<string, any> }> {
	const { serverId, channelId, parentMessageId, parentMessageData, fallbackCreatorId } = options;
	const threadRef = db.collection(`servers/${serverId}/channels/${channelId}/threads`).doc();
	const now = Timestamp.now();
	const parentText = pickMessageText(parentMessageData);
	const preview = previewFromText(parentText, 120) || 'Thread';
	const name = threadNameFromText(parentText);
	const creatorId = pickMessageAuthorId(parentMessageData) || fallbackCreatorId;
	const memberUids = creatorId && !isSlackUid(creatorId) ? [creatorId] : [];

	const payload: Record<string, any> = {
		id: threadRef.id,
		serverId,
		channelId,
		parentChannelId: channelId,
		createdBy: creatorId || null,
		createdFromMessageId: parentMessageId,
		createdAt: now,
		name,
		preview,
		rootPreview: preview,
		lastMessageAt: now,
		lastMessagePreview: preview,
		autoArchiveAt: nextAutoArchiveAt(THREAD_DEFAULT_TTL_HOURS),
		status: 'active',
		ttlHours: THREAD_DEFAULT_TTL_HOURS,
		maxMembers: THREAD_MAX_MEMBER_LIMIT,
		memberUids,
		memberCount: memberUids.length,
		visibility: THREAD_VISIBILITY,
		archivedAt: null,
		messageCount: 0
	};

	await threadRef.set(payload);
	return { id: threadRef.id, data: payload };
}

async function ensureThreadForParentMessage(options: {
	serverId: string;
	channelId: string;
	parentMessageId: string;
	parentMessageData?: Record<string, any> | null;
	fallbackCreatorId: string;
}): Promise<{ id: string; data: Record<string, any> }> {
	const existing = await findThreadByParentMessageId(
		options.serverId,
		options.channelId,
		options.parentMessageId
	);
	if (existing) return existing;
	return createThreadForParentMessage(options);
}

/**
 * Sync a Slack reaction to hConnect
 */
async function syncSlackReactionToHConnect(
	event: SlackEvent,
	bridge: SlackChannelBridge,
	workspace: SlackWorkspace,
	serverId: string,
	isAdd: boolean
): Promise<void> {
	if (!event.item || !event.reaction) {
		logger.warn('[slack] Missing item or reaction in reaction event');
		return;
	}

	// Only handle reactions on messages
	if (event.item.type !== 'message') {
		logger.info('[slack] Ignoring reaction on non-message item', { type: event.item.type });
		return;
	}

	// Find the corresponding hConnect message
	const message = await findHConnectMessageBySlackTs(
		serverId,
		bridge.hconnectChannelId,
		event.item.ts
	);

	if (!message) {
		logger.info('[slack] No matching hConnect message for reaction', { slackTs: event.item.ts });
		return;
	}

	// Convert Slack emoji name to a simpler format
	// Slack uses names like "thumbsup" while we might use "👍"
	const emoji = `:${event.reaction}:`;
	const slackUserId = `slack:${event.user}`;

	// Get current reactions on the message
	const messageRef = db.doc(
		`servers/${serverId}/channels/${bridge.hconnectChannelId}/messages/${message.id}`
	);

	if (isAdd) {
		// Add reaction
		await messageRef.update({
			[`reactions.${event.reaction}`]: FieldValue.arrayUnion(slackUserId),
			updatedAt: Timestamp.now()
		});
		logger.info('[slack] Reaction added to hConnect message', {
			messageId: message.id,
			emoji,
			user: slackUserId
		});
	} else {
		// Remove reaction
		await messageRef.update({
			[`reactions.${event.reaction}`]: FieldValue.arrayRemove(slackUserId),
			updatedAt: Timestamp.now()
		});
		logger.info('[slack] Reaction removed from hConnect message', {
			messageId: message.id,
			emoji,
			user: slackUserId
		});
	}
}

// ============ Main Webhook Handler ============

/**
 * Main Slack Events API webhook handler
 * Receives events from Slack and syncs to hConnect
 * Credentials are loaded from per-server Firestore config
 */
export const slackWebhook = onRequest(
	{
		region: 'us-central1',
		cors: false
	},
	async (req: Request, res: Response) => {
		// Log all incoming requests for debugging
		logger.info('[slack] Webhook received', { 
			method: req.method,
			payloadType: req.body?.type,
			hasSignature: !!req.headers['x-slack-signature'],
			hasTimestamp: !!req.headers['x-slack-request-timestamp']
		});

		// Only accept POST requests
		if (req.method !== 'POST') {
			res.status(405).send('Method not allowed');
			return;
		}

		const rawBody = JSON.stringify(req.body);
		const timestamp = req.headers['x-slack-request-timestamp'] as string;
		const signature = req.headers['x-slack-signature'] as string;
		const payload = req.body as SlackEventPayload;

		logger.info('[slack] Processing payload', { 
			type: payload.type, 
			teamId: payload.team_id,
			eventType: payload.event?.type,
			eventChannel: payload.event?.channel,
			eventUser: payload.event?.user
		});

		// Handle URL verification challenge (no signature verification needed for this)
		// Slack sends this when you first configure the Events URL
		if (payload.type === 'url_verification') {
			logger.info('[slack] URL verification challenge received', { challenge: payload.challenge });
			// Respond with just the challenge value as plain text
			res.setHeader('Content-Type', 'text/plain');
			res.status(200).send(payload.challenge);
			return;
		}

		// For events, we need to find the server to get signing secret
		const teamId = payload.team_id;
		if (!teamId) {
			logger.warn('[slack] No team_id in payload');
			res.status(400).send('Missing team_id');
			return;
		}

		// Find which server this team belongs to
		const serverId = await findServerByTeamId(teamId);
		if (!serverId) {
			logger.warn('[slack] No server found for team', { teamId });
			res.status(404).send('No server configured for this Slack team');
			return;
		}

		// Get server's Slack config with signing secret
		const config = await getServerSlackConfig(serverId);
		if (!config?.credentials?.signingSecret) {
			logger.warn('[slack] No signing secret configured for server', { serverId });
			res.status(500).send('Server not properly configured');
			return;
		}

		// Verify signature using server's signing secret
		if (!verifySlackSignature(config.credentials.signingSecret, signature, timestamp, rawBody)) {
			logger.warn('[slack] Invalid signature', {
				signingSecretPrefix: config.credentials.signingSecret?.substring(0, 8),
				signaturePrefix: signature?.substring(0, 20),
				bodyLength: rawBody?.length
			});
			res.status(401).send('Invalid signature');
			return;
		}

		// Handle event callback
		if (payload.type === 'event_callback') {
			const event = payload.event;

			// Handle different event types
			const eventType = event.type;
			logger.info('[slack] Processing event', { type: eventType, subtype: event.subtype });

			try {
				// Handle reaction events
				if (eventType === 'reaction_added' || eventType === 'reaction_removed') {
					const channelId = event.item?.channel || event.channel;
					
					// Find bridge for this channel
					const bridgeResult = await findBridgeForSlackChannel(payload.team_id, channelId);
					if (!bridgeResult) {
						logger.info('[slack] No active bridge for reaction channel', { channelId });
						res.status(200).send('OK');
						return;
					}

					const { bridge } = bridgeResult;

					// Check if reactions sync is enabled (via bridge settings)
					// For now, always sync if bridge exists and is bidirectional or slack-to-hconnect
					if (bridge.syncDirection === 'hconnect-to-slack') {
						logger.info('[slack] Bridge is outbound only, skipping reaction');
						res.status(200).send('OK');
						return;
					}

					const workspace = await getWorkspaceByTeamId(serverId, payload.team_id);
					if (!workspace) {
						logger.error('[slack] Workspace not found for reaction', { teamId: payload.team_id });
						res.status(200).send('OK');
						return;
					}

					await syncSlackReactionToHConnect(
						event,
						bridge,
						workspace,
						serverId,
						eventType === 'reaction_added'
					);

					res.status(200).send('OK');
					return;
				}

				// Handle message events
				if (eventType !== 'message') {
					res.status(200).send('OK');
					return;
				}

				// Find bridge for this channel
				const bridgeResult = await findBridgeForSlackChannel(payload.team_id, event.channel);

				if (!bridgeResult) {
					logger.info('[slack] No active bridge for channel', {
						teamId: payload.team_id,
						channelId: event.channel
					});
					res.status(200).send('OK');
					return;
				}

				const { bridge } = bridgeResult;

				// Check sync direction
				if (bridge.syncDirection === 'hconnect-to-slack') {
					logger.info('[slack] Bridge is outbound only, skipping inbound message');
					res.status(200).send('OK');
					return;
				}

				// Get workspace for API calls
				const workspace = await getWorkspaceByTeamId(serverId, payload.team_id);
				if (!workspace) {
					logger.error('[slack] Workspace not found', { teamId: payload.team_id, serverId });
					res.status(200).send('OK');
					return;
				}

				// Sync the message
				await syncSlackMessageToHConnect(event, bridge, workspace, serverId);

				res.status(200).send('OK');
			} catch (err) {
				logger.error('[slack] Error processing event', { error: err, event });
				// Return 200 anyway to prevent Slack from retrying
				res.status(200).send('OK');
			}

			return;
		}

		res.status(200).send('OK');
	}
);

/**
 * OAuth callback handler for Slack app installation
 * State parameter format: JSON with { returnUrl, serverId }
 */
export const slackOAuth = onRequest(
	{
		region: 'us-central1',
		cors: true
	},
	async (req: Request, res: Response) => {
		const { code, state, error: oauthError } = req.query;

		// Parse state to get serverId and returnUrl
		let stateData: { returnUrl?: string; serverId?: string } = {};
		let returnUrl = 'https://hconnect-6212b.web.app';
		let serverId: string | undefined;

		if (state) {
			try {
				stateData = JSON.parse(decodeURIComponent(String(state)));
				returnUrl = stateData.returnUrl || returnUrl;
				serverId = stateData.serverId;
			} catch {
				// State might be just a URL for backward compatibility
				returnUrl = String(state);
			}
		}

		// Handle OAuth errors
		if (oauthError) {
			logger.error('[slack] OAuth error from Slack', { error: oauthError });
			res.redirect(302, `${returnUrl}?slack_error=${encodeURIComponent(String(oauthError))}`);
			return;
		}

		if (!code) {
			res.status(400).send('Missing authorization code');
			return;
		}

		if (!serverId) {
			logger.error('[slack] No serverId in OAuth state');
			res.redirect(302, `${returnUrl}?slack_error=missing_server_id`);
			return;
		}

		logger.info('[slack] OAuth callback received', { serverId, returnUrl });

		// Get server's Slack credentials
		const config = await getServerSlackConfig(serverId);
		if (!config?.credentials?.clientId || !config?.credentials?.clientSecret) {
			logger.error('[slack] Server missing Slack credentials', { serverId });
			res.redirect(302, `${returnUrl}?slack_error=missing_credentials`);
			return;
		}

		try {
			// Exchange code for access token
			const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded'
				},
				body: new URLSearchParams({
					client_id: config.credentials.clientId,
					client_secret: config.credentials.clientSecret,
					code: String(code),
					redirect_uri: 'https://slackoauth-xpac7ukbha-uc.a.run.app'
				})
			});

			const tokenData = await tokenResponse.json() as {
				ok: boolean;
				error?: string;
				access_token?: string;
				token_type?: string;
				scope?: string;
				bot_user_id?: string;
				app_id?: string;
				team?: {
					id: string;
					name: string;
				};
				authed_user?: {
					id: string;
					access_token?: string;
				};
			};

			if (!tokenData.ok || !tokenData.access_token) {
				logger.error('[slack] Token exchange failed', { error: tokenData.error });
				res.redirect(302, `${returnUrl}?slack_error=${encodeURIComponent(tokenData.error || 'token_exchange_failed')}`);
				return;
			}

			// Fetch team info for more details
			const teamInfoResponse = await fetch('https://slack.com/api/team.info', {
				headers: {
					'Authorization': `Bearer ${tokenData.access_token}`,
					'Content-Type': 'application/json'
				}
			});

			const teamInfo = await teamInfoResponse.json() as {
				ok: boolean;
				team?: {
					id: string;
					name: string;
					domain: string;
					icon?: {
						image_44?: string;
						image_68?: string;
					};
				};
			};

			// Store the workspace in Firestore under the server's path
			const workspaceRef = db.collection(`servers/${serverId}/integrations/slack/workspaces`).doc();
			
			await workspaceRef.set({
				serverId,
				teamId: tokenData.team?.id || '',
				teamName: tokenData.team?.name || teamInfo.team?.name || 'Unknown Workspace',
				teamDomain: teamInfo.team?.domain || '',
				teamIcon: teamInfo.team?.icon?.image_68 || teamInfo.team?.icon?.image_44 || null,
				accessToken: tokenData.access_token, // TODO: Encrypt this in production
				botAccessToken: tokenData.access_token,
				botUserId: tokenData.bot_user_id || '',
				installedBy: tokenData.authed_user?.id || '',
				installedAt: Timestamp.now(),
				scopes: (tokenData.scope || '').split(',')
			});

			logger.info('[slack] Workspace connected successfully', {
				serverId,
				teamId: tokenData.team?.id,
				teamName: tokenData.team?.name,
				workspaceId: workspaceRef.id
			});

			// Redirect back to hConnect with success
			res.redirect(302, `${returnUrl}?slack_connected=true&workspace=${encodeURIComponent(tokenData.team?.name || '')}`);
		} catch (err) {
			logger.error('[slack] OAuth error', { error: err });
			res.redirect(302, `${returnUrl}?slack_error=server_error`);
		}
	}
);

// ============ Outbound Sync (hConnect → Slack) ============

/**
 * Convert hConnect markdown to Slack mrkdwn format
 */
function convertHConnectToSlack(text: string): string {
	if (!text) return '';

	let converted = text;

	// Convert markdown bold **text** to Slack *text*
	converted = converted.replace(/\*\*([^*]+)\*\*/g, '*$1*');

	// Convert markdown italic *text* to Slack _text_
	// Be careful not to convert already-converted bold
	converted = converted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '_$1_');

	// Convert markdown strikethrough ~~text~~ to Slack ~text~
	converted = converted.replace(/~~([^~]+)~~/g, '~$1~');

	// Convert markdown links [text](url) to Slack <url|text>
	converted = converted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

	// Keep code blocks and inline code as-is (compatible)

	return converted;
}

/**
 * Post a message to Slack channel
 */
async function postToSlack(
	botToken: string,
	channelId: string,
	text: string,
	username?: string,
	iconUrl?: string,
	threadTs?: string
): Promise<{ ok: boolean; ts?: string; error?: string }> {
	const payload: Record<string, unknown> = {
		channel: channelId,
		text: text,
		unfurl_links: false,
		unfurl_media: true
	};

	// Add username display if provided
	if (username) {
		payload.username = username;
	}
	if (iconUrl) {
		payload.icon_url = iconUrl;
	}
	// Add thread_ts for thread replies
	if (threadTs) {
		payload.thread_ts = threadTs;
	}

	const response = await fetch('https://slack.com/api/chat.postMessage', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${botToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(payload)
	});

	return response.json() as Promise<{ ok: boolean; ts?: string; error?: string }>;
}

/**
 * Find bridges for an hConnect channel that sync outbound
 */
async function findBridgesForHConnectChannel(
	serverId: string,
	channelId: string
): Promise<SlackChannelBridge[]> {
	const bridgesSnapshot = await db
		.collection(`servers/${serverId}/integrations/slack/bridges`)
		.where('hconnectServerId', '==', serverId)
		.where('hconnectChannelId', '==', channelId)
		.where('status', '==', 'active')
		.get();

	if (bridgesSnapshot.empty) {
		return [];
	}

	return bridgesSnapshot.docs.map(doc => ({
		id: doc.id,
		...doc.data()
	})) as SlackChannelBridge[];
}

/**
 * Sync an hConnect message to Slack
 * Called from Firestore trigger in index.ts
 */
export async function syncHConnectMessageToSlack(
	serverId: string,
	channelId: string,
	messageId: string,
	messageData: {
		uid: string;
		text?: string;
		content?: string;
		displayName?: string;
		authorId?: string;
		isSlackMessage?: boolean;
		slackMeta?: { messageTs?: string };
		photoURL?: string;
		replyTo?: string | { messageId?: string }; // Parent message ID or reply reference object
	}
): Promise<void> {
	logger.info('[slack-outbound] syncHConnectMessageToSlack called', { 
		serverId, 
		channelId, 
		messageId,
		isSlackMessage: !!messageData.isSlackMessage,
		hasSlackMeta: !!messageData.slackMeta?.messageTs
	});

	// Skip if this message came from Slack (prevent loops)
	if (messageData.isSlackMessage || messageData.slackMeta?.messageTs) {
		logger.info('[slack-outbound] Skipping message from Slack', { messageId });
		return;
	}

	// Find active bridges for this channel that sync outbound
	const bridges = await findBridgesForHConnectChannel(serverId, channelId);
	logger.info('[slack-outbound] Found bridges', { 
		channelId, 
		bridgeCount: bridges.length,
		bridges: bridges.map(b => ({ id: b.id, direction: b.syncDirection, status: b.status }))
	});
	
	const outboundBridges = bridges.filter(b => 
		b.syncDirection === 'hconnect-to-slack' || b.syncDirection === 'bidirectional'
	);

	if (outboundBridges.length === 0) {
		logger.info('[slack-outbound] No outbound bridges configured', { channelId });
		return; // No outbound bridges configured
	}

	const text = messageData.text || messageData.content || '';
	if (!text.trim()) {
		return; // Skip empty messages
	}

	const slackText = convertHConnectToSlack(text);

	// Get server-level Slack config for avatar override
	let avatarUrl = messageData.photoURL;
	try {
		const configDoc = await db.doc(`servers/${serverId}/integrations/slack`).get();
		if (configDoc.exists) {
			const config = configDoc.data();
			// Use server-level avatar override if set
			if (config?.hconnectAvatarUrl) {
				avatarUrl = config.hconnectAvatarUrl;
			}
		}
	} catch (err) {
		logger.warn('[slack-outbound] Could not read server Slack config for avatar', { serverId });
	}

	// Check if this is a thread reply and find parent's Slack timestamp
	// replyTo can be an object { messageId: string, ... } or just a string
	let parentSlackTs: string | undefined;
	const replyToId = typeof messageData.replyTo === 'object' 
		? messageData.replyTo?.messageId 
		: messageData.replyTo;
	
	if (replyToId) {
		try {
			const parentDoc = await db
				.doc(`servers/${serverId}/channels/${channelId}/messages/${replyToId}`)
				.get();
			if (parentDoc.exists) {
				const parentData = parentDoc.data();
				// Check if parent has a Slack timestamp (either from original sync or from slackMeta)
				if (parentData?.slackMeta?.messageTs) {
					parentSlackTs = parentData.slackMeta.messageTs;
				} else if (parentData?.slackTs) {
					parentSlackTs = parentData.slackTs;
				}
				logger.info('[slack-outbound] Found parent message for thread', {
					messageId,
					replyToId,
					parentSlackTs: parentSlackTs || 'not found'
				});
			}
		} catch (err) {
			logger.warn('[slack-outbound] Could not find parent message for thread', { 
				messageId, 
				replyToId 
			});
		}
	}

	for (const bridge of outboundBridges) {
		try {
			// Skip thread sync if bridge explicitly has it disabled
			if (replyToId && bridge.syncThreads === false) {
				logger.info('[slack-outbound] Skipping thread reply - syncThreads disabled', {
					bridgeId: bridge.id,
					messageId
				});
				continue;
			}

			// Get workspace for bot token (now from per-server path)
			const workspace = await getWorkspaceByTeamId(serverId, bridge.slackTeamId);
			if (!workspace) {
				logger.warn('[slack-outbound] Workspace not found', {
					bridgeId: bridge.id,
					teamId: bridge.slackTeamId,
					serverId
				});
				continue;
			}

			// Post to Slack - always show the hConnect user's display name
			// Pass parentSlackTs for thread replies
			const result = await postToSlack(
				workspace.botAccessToken,
				bridge.slackChannelId,
				slackText,
				messageData.displayName || 'hConnect User',
				avatarUrl,
				parentSlackTs
			);

			if (!result.ok) {
				logger.error('[slack-outbound] Failed to post to Slack', {
					bridgeId: bridge.id,
					error: result.error
				});
				
				// Update bridge status on persistent errors (using per-server path)
				if (result.error === 'channel_not_found' || result.error === 'not_in_channel') {
					await db.doc(`servers/${serverId}/integrations/slack/bridges/${bridge.id}`).update({
						status: 'error',
						lastError: result.error,
						updatedAt: Timestamp.now()
					});
				}
				continue;
			}

			// Store the Slack timestamp on the hConnect message for future thread replies
			if (result.ts) {
				try {
					await db.doc(`servers/${serverId}/channels/${channelId}/messages/${messageId}`).update({
						slackTs: result.ts,
						'slackMeta.messageTs': result.ts,
						'slackMeta.channelId': bridge.slackChannelId,
						'slackMeta.teamId': bridge.slackTeamId
					});
				} catch (err) {
					logger.warn('[slack-outbound] Could not store Slack timestamp on message', { messageId });
				}
			}

			// Update bridge stats (using per-server path)
			await db.doc(`servers/${serverId}/integrations/slack/bridges/${bridge.id}`).update({
				lastSyncAt: Timestamp.now(),
				messageCount: FieldValue.increment(1)
			});

			logger.info('[slack-outbound] Message synced to Slack', {
				bridgeId: bridge.id,
				slackTs: result.ts,
				isThreadReply: !!parentSlackTs
			});
		} catch (err) {
			logger.error('[slack-outbound] Error syncing to Slack', {
				bridgeId: bridge.id,
				error: err
			});
		}
	}
}

/**
 * Sync an hConnect thread message to Slack
 * Called from Firestore trigger for thread messages
 * Thread messages are stored at: servers/{serverId}/channels/{channelId}/threads/{threadId}/messages/{messageId}
 * The threadId is the thread document ID in hConnect
 */
export async function syncHConnectThreadMessageToSlack(
	serverId: string,
	channelId: string,
	threadId: string, // This is the thread document ID in hConnect
	messageId: string,
	messageData: {
		uid: string;
		text?: string;
		content?: string;
		displayName?: string;
		authorId?: string;
		isSlackMessage?: boolean;
		slackMeta?: { messageTs?: string };
		photoURL?: string;
	}
): Promise<void> {
	logger.info('[slack-outbound-thread] syncHConnectThreadMessageToSlack called', {
		serverId,
		channelId,
		threadId,
		messageId,
		isSlackMessage: !!messageData.isSlackMessage,
		hasSlackMeta: !!messageData.slackMeta?.messageTs
	});

	// Skip if this message came from Slack (prevent loops)
	if (messageData.isSlackMessage || messageData.slackMeta?.messageTs) {
		logger.info('[slack-outbound-thread] Skipping message from Slack', { messageId, threadId });
		return;
	}

	// Find active bridges for this channel that sync outbound
	const bridges = await findBridgesForHConnectChannel(serverId, channelId);
	logger.info('[slack-outbound-thread] Found bridges', {
		channelId,
		threadId,
		bridgeCount: bridges.length,
		bridges: bridges.map(b => ({ id: b.id, direction: b.syncDirection, status: b.status, syncThreads: b.syncThreads }))
	});
	
	const outboundBridges = bridges.filter(b => 
		(b.syncDirection === 'hconnect-to-slack' || b.syncDirection === 'bidirectional') &&
		b.syncThreads !== false // Default to true if not specified
	);

	if (outboundBridges.length === 0) {
		logger.info('[slack-outbound-thread] No outbound bridges with thread sync enabled', { 
			channelId, 
			threadId 
		});
		return;
	}

	const text = messageData.text || messageData.content || '';
	if (!text.trim()) {
		return; // Skip empty messages
	}

	const slackText = convertHConnectToSlack(text);

	// Get server-level Slack config for avatar override
	let avatarUrl = messageData.photoURL;
	try {
		const configDoc = await db.doc(`servers/${serverId}/integrations/slack`).get();
		if (configDoc.exists) {
			const config = configDoc.data();
			if (config?.hconnectAvatarUrl) {
				avatarUrl = config.hconnectAvatarUrl;
			}
		}
	} catch (err) {
		logger.warn('[slack-outbound-thread] Could not read server Slack config for avatar', { serverId });
	}

	// Resolve the parent channel message from the thread document
	let parentSlackTs: string | undefined;
	let parentMessageId: string | null = null;
	let parentMessageData: Record<string, any> | null = null;
	try {
		const threadDoc = await db
			.doc(`servers/${serverId}/channels/${channelId}/threads/${threadId}`)
			.get();
		if (!threadDoc.exists) {
			logger.warn('[slack-outbound-thread] Thread not found', { threadId });
			return;
		}
		const threadData = threadDoc.data() as Record<string, any>;
		parentMessageId =
			typeof threadData?.createdFromMessageId === 'string'
				? threadData.createdFromMessageId
				: null;

		if (!parentMessageId) {
			logger.warn('[slack-outbound-thread] Thread missing parent message id', { threadId });
			return;
		}

		const parentDoc = await db
			.doc(`servers/${serverId}/channels/${channelId}/messages/${parentMessageId}`)
			.get();
		if (parentDoc.exists) {
			parentMessageData = parentDoc.data() as Record<string, any>;
			if (parentMessageData?.slackMeta?.messageTs) {
				parentSlackTs = parentMessageData.slackMeta.messageTs;
			} else if (parentMessageData?.slackTs) {
				parentSlackTs = parentMessageData.slackTs;
			}
			logger.info('[slack-outbound-thread] Found parent message', {
				threadId,
				parentMessageId,
				parentSlackTs: parentSlackTs || 'not found'
			});
		} else {
			logger.warn('[slack-outbound-thread] Parent message not found', {
				threadId,
				parentMessageId
			});
		}
	} catch (err) {
		logger.warn('[slack-outbound-thread] Could not find parent message', { 
			threadId,
			error: err
		});
	}

	if (!parentSlackTs && parentMessageId && parentMessageData) {
		const hasSlackMeta = Boolean(
			parentMessageData?.slackMeta?.messageTs || parentMessageData?.slackTs
		);
		if (!hasSlackMeta && !parentMessageData.isSlackMessage) {
			logger.info('[slack-outbound-thread] Syncing parent message to Slack for thread', {
				threadId,
				parentMessageId
			});
			try {
				await syncHConnectMessageToSlack(
					serverId,
					channelId,
					parentMessageId,
					parentMessageData as any
				);
				const refreshed = await db
					.doc(`servers/${serverId}/channels/${channelId}/messages/${parentMessageId}`)
					.get();
				if (refreshed.exists) {
					const refreshedData = refreshed.data() as Record<string, any>;
					parentSlackTs =
						refreshedData?.slackMeta?.messageTs ??
						refreshedData?.slackTs ??
						parentSlackTs;
				}
			} catch (err) {
				logger.warn('[slack-outbound-thread] Failed to sync parent message', {
					threadId,
					parentMessageId,
					error: err
				});
			}
		}
	}

	if (!parentSlackTs) {
		logger.warn('[slack-outbound-thread] Cannot sync thread - parent has no Slack timestamp', {
			threadId,
			messageId
		});
		return;
	}

	for (const bridge of outboundBridges) {
		try {
			const workspace = await getWorkspaceByTeamId(serverId, bridge.slackTeamId);
			if (!workspace) {
				logger.warn('[slack-outbound-thread] Workspace not found', {
					bridgeId: bridge.id,
					teamId: bridge.slackTeamId,
					serverId
				});
				continue;
			}

			// Post to Slack as a thread reply
			const result = await postToSlack(
				workspace.botAccessToken,
				bridge.slackChannelId,
				slackText,
				messageData.displayName || 'hConnect User',
				avatarUrl,
				parentSlackTs // This makes it a thread reply
			);

			if (!result.ok) {
				logger.error('[slack-outbound-thread] Failed to post to Slack', {
					bridgeId: bridge.id,
					error: result.error
				});
				continue;
			}

			// Store the Slack timestamp on the thread message
			if (result.ts) {
				try {
					await db.doc(`servers/${serverId}/channels/${channelId}/threads/${threadId}/messages/${messageId}`).update({
						slackTs: result.ts,
						'slackMeta.messageTs': result.ts,
						'slackMeta.channelId': bridge.slackChannelId,
						'slackMeta.teamId': bridge.slackTeamId,
						'slackMeta.threadTs': parentSlackTs
					});
				} catch (err) {
					logger.warn('[slack-outbound-thread] Could not store Slack timestamp', { messageId });
				}
			}

			// Update bridge stats
			await db.doc(`servers/${serverId}/integrations/slack/bridges/${bridge.id}`).update({
				lastSyncAt: Timestamp.now(),
				messageCount: FieldValue.increment(1)
			});

			logger.info('[slack-outbound-thread] Thread message synced to Slack', {
				bridgeId: bridge.id,
				slackTs: result.ts,
				parentSlackTs
			});
		} catch (err) {
			logger.error('[slack-outbound-thread] Error syncing to Slack', {
				bridgeId: bridge.id,
				error: err
			});
		}
	}
}

// ============ Channel List API ============

interface SlackChannel {
	id: string;
	name: string;
	is_private: boolean;
	is_member: boolean;
	num_members?: number;
	topic?: string;
	purpose?: string;
}

/**
 * Fetch list of Slack channels for a workspace
 * Called from frontend to populate channel picker
 */
export const getSlackChannels = onCall(
	{
		region: 'us-central1'
	},
	async (request) => {
		// Require authentication
		if (!request.auth) {
			throw new HttpsError('unauthenticated', 'Must be logged in');
		}

		const { serverId, workspaceId } = request.data as { serverId: string; workspaceId: string };

		if (!serverId || !workspaceId) {
			throw new HttpsError('invalid-argument', 'Missing serverId or workspaceId');
		}

		logger.info('[slack] Fetching channels', { serverId, workspaceId });

		try {
			// Get workspace to get the bot token
			const workspaceDoc = await db
				.doc(`servers/${serverId}/integrations/slack/workspaces/${workspaceId}`)
				.get();

			if (!workspaceDoc.exists) {
				throw new HttpsError('not-found', 'Workspace not found');
			}

			const workspace = workspaceDoc.data() as SlackWorkspace;
			const botToken = workspace.botAccessToken || workspace.accessToken;

			if (!botToken) {
				throw new HttpsError('failed-precondition', 'No bot token available');
			}

			// Fetch public channels
			const publicChannels = await fetchSlackChannelList(botToken, false);
			
			// Fetch private channels the bot is in
			const privateChannels = await fetchSlackChannelList(botToken, true);

			const allChannels = [...publicChannels, ...privateChannels];

			// Sort by name
			allChannels.sort((a, b) => a.name.localeCompare(b.name));

			logger.info('[slack] Fetched channels', { 
				count: allChannels.length,
				public: publicChannels.length,
				private: privateChannels.length
			});

			return { channels: allChannels };
		} catch (err) {
			logger.error('[slack] Failed to fetch channels', { error: err });
			if (err instanceof HttpsError) throw err;
			throw new HttpsError('internal', 'Failed to fetch Slack channels');
		}
	}
);

/**
 * Fetch channel list from Slack API
 */
async function fetchSlackChannelList(
	botToken: string,
	isPrivate: boolean
): Promise<SlackChannel[]> {
	const channels: SlackChannel[] = [];
	let cursor: string | undefined;

	do {
		const params = new URLSearchParams({
			types: isPrivate ? 'private_channel' : 'public_channel',
			exclude_archived: 'true',
			limit: '200'
		});
		if (cursor) params.append('cursor', cursor);

		logger.info('[slack] Calling conversations.list', { isPrivate, cursor: cursor || 'none' });

		const response = await fetch(
			`https://slack.com/api/conversations.list?${params.toString()}`,
			{
				headers: {
					'Authorization': `Bearer ${botToken}`,
					'Content-Type': 'application/json'
				}
			}
		);

		const data = await response.json() as {
			ok: boolean;
			error?: string;
			channels?: Array<{
				id: string;
				name: string;
				is_private: boolean;
				is_member: boolean;
				num_members?: number;
				topic?: { value: string };
				purpose?: { value: string };
			}>;
			response_metadata?: {
				next_cursor?: string;
			};
		};

		logger.info('[slack] conversations.list response', { 
			ok: data.ok, 
			error: data.error,
			channelCount: data.channels?.length || 0,
			isPrivate 
		});

		if (!data.ok) {
			logger.warn('[slack] conversations.list failed', { error: data.error, isPrivate });
			break;
		}

		if (data.channels) {
			for (const ch of data.channels) {
				channels.push({
					id: ch.id,
					name: ch.name,
					is_private: ch.is_private,
					is_member: ch.is_member,
					num_members: ch.num_members,
					topic: ch.topic?.value,
					purpose: ch.purpose?.value
				});
			}
		}

		cursor = data.response_metadata?.next_cursor;
	} while (cursor);

	return channels;
}
