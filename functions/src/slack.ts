/**
 * Slack Integration - Cloud Functions
 * Handles incoming Slack webhooks and syncs messages to hConnect
 */

import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import type { Request, Response } from 'express';
import { db } from './firebase';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as crypto from 'crypto';

// Define secrets
const slackSigningSecret = defineSecret('SLACK_SIGNING_SECRET');

// ============ Types ============

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
}

interface SlackWorkspace {
	id: string;
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
 * Find bridge for a Slack channel
 */
async function findBridgeForSlackChannel(
	teamId: string,
	channelId: string
): Promise<SlackChannelBridge | null> {
	const bridgesSnapshot = await db
		.collection('integrations/slack/bridges')
		.where('slackTeamId', '==', teamId)
		.where('slackChannelId', '==', channelId)
		.where('status', '==', 'active')
		.get();

	if (bridgesSnapshot.empty) {
		return null;
	}

	const doc = bridgesSnapshot.docs[0];
	return { id: doc.id, ...doc.data() } as SlackChannelBridge;
}

/**
 * Get workspace by team ID
 */
async function getWorkspaceByTeamId(teamId: string): Promise<SlackWorkspace | null> {
	const workspacesSnapshot = await db
		.collection('integrations/slack/workspaces')
		.where('teamId', '==', teamId)
		.limit(1)
		.get();

	if (workspacesSnapshot.empty) {
		return null;
	}

	const doc = workspacesSnapshot.docs[0];
	return { id: doc.id, ...doc.data() } as SlackWorkspace;
}

// ============ Message Sync ============

/**
 * Create an hConnect message from a Slack message
 */
async function syncSlackMessageToHConnect(
	event: SlackEvent,
	bridge: SlackChannelBridge,
	workspace: SlackWorkspace
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

	// Create the message document
	const messageRef = db
		.collection(`servers/${bridge.hconnectServerId}/channels/${bridge.hconnectChannelId}/messages`)
		.doc();

	const messageData = {
		// Core fields
		uid: `slack:${event.user}`, // Special UID format for Slack users
		authorId: `slack:${event.user}`,
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
			bridgeId: bridge.id
		},

		// Timestamps
		createdAt: Timestamp.now(),
		updatedAt: Timestamp.now(),

		// Flags
		isSlackMessage: true,
		type: 'text'
	};

	await messageRef.set(messageData);

	// Update bridge stats
	await db.doc(`integrations/slack/bridges/${bridge.id}`).update({
		lastSyncAt: Timestamp.now(),
		messageCount: FieldValue.increment(1)
	});

	logger.info('[slack] Message synced to hConnect', {
		bridgeId: bridge.id,
		messageId: messageRef.id,
		slackTs: event.ts
	});
}

// ============ Main Webhook Handler ============

/**
 * Main Slack Events API webhook handler
 * Receives events from Slack and syncs to hConnect
 */
export const slackWebhook = onRequest(
	{
		region: 'us-central1',
		cors: false,
		secrets: [slackSigningSecret]
	},
	async (req: Request, res: Response) => {
		// Only accept POST requests
		if (req.method !== 'POST') {
			res.status(405).send('Method not allowed');
			return;
		}

		const rawBody = JSON.stringify(req.body);
		const timestamp = req.headers['x-slack-request-timestamp'] as string;
		const signature = req.headers['x-slack-signature'] as string;

		// Verify signature
		if (!verifySlackSignature(slackSigningSecret.value(), signature, timestamp, rawBody)) {
			logger.warn('[slack] Invalid signature');
			res.status(401).send('Invalid signature');
			return;
		}

		const payload = req.body as SlackEventPayload;

		// Handle URL verification challenge
		if (payload.type === 'url_verification') {
			logger.info('[slack] URL verification challenge');
			res.status(200).send({ challenge: payload.challenge });
			return;
		}

		// Handle event callback
		if (payload.type === 'event_callback') {
			const event = payload.event;

			// Only handle message events for now
			if (event.type !== 'message') {
				res.status(200).send('OK');
				return;
			}

			try {
				// Find bridge for this channel
				const bridge = await findBridgeForSlackChannel(payload.team_id, event.channel);

				if (!bridge) {
					logger.info('[slack] No active bridge for channel', {
						teamId: payload.team_id,
						channelId: event.channel
					});
					res.status(200).send('OK');
					return;
				}

				// Check sync direction
				if (bridge.syncDirection === 'hconnect-to-slack') {
					logger.info('[slack] Bridge is outbound only, skipping inbound message');
					res.status(200).send('OK');
					return;
				}

				// Get workspace for API calls
				const workspace = await getWorkspaceByTeamId(payload.team_id);
				if (!workspace) {
					logger.error('[slack] Workspace not found', { teamId: payload.team_id });
					res.status(200).send('OK');
					return;
				}

				// Sync the message
				await syncSlackMessageToHConnect(event, bridge, workspace);

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
 */
export const slackOAuth = onRequest(
	{
		region: 'us-central1',
		cors: true
	},
	async (req: Request, res: Response) => {
		const { code, state } = req.query;

		if (!code) {
			res.status(400).send('Missing authorization code');
			return;
		}

		// TODO: Exchange code for access token
		// For now, redirect to app with instructions

		logger.info('[slack] OAuth callback received', { state });

		// Redirect back to hConnect with success
		const redirectUrl = state
			? `${state}?slack_connected=true`
			: 'https://hconnect-6212b.web.app?slack_connected=true';

		res.redirect(302, redirectUrl);
	}
);
