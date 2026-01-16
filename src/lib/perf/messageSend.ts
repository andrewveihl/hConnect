// src/lib/perf/messageSend.ts
// Optimized message sending with local echo and background sync
// Messages appear instantly as pending, then confirm in background

import { browser } from '$app/environment';
import { getDb } from '$lib/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import {
	queueChannelMessage,
	queueDMMessage,
	queueThreadMessage,
	registerSendFunctions,
	type OutboxMessage
} from './outbox';
import { timeMessageSend, recordMetric } from './metrics';

/* ===========================
   Message Document Builder
=========================== */
function buildMessageDoc(payload: OutboxMessage['payload']) {
	const base: Record<string, unknown> = {
		uid: payload.uid,
		authorId: payload.uid,
		displayName: payload.displayName ?? null,
		photoURL: payload.photoURL ?? null,
		author: {
			displayName: payload.displayName ?? null,
			photoURL: payload.photoURL ?? null
		},
		createdAt: serverTimestamp()
	};

	// Handle different message types
	const type = payload.type ?? 'text';

	switch (type) {
		case 'text':
			return {
				...base,
				type: 'text',
				text: payload.text,
				content: payload.text,
				plainTextContent: payload.text,
				mentions: payload.mentions ?? [],
				replyTo: payload.replyTo ?? null
			};

		case 'gif':
			return {
				...base,
				type: 'gif',
				url: payload.url,
				plainTextContent: 'Shared a GIF',
				replyTo: payload.replyTo ?? null
			};

		case 'file':
			return {
				...base,
				type: 'file',
				file: payload.file,
				plainTextContent: `Shared ${(payload.file as any)?.name ?? 'a file'}`,
				replyTo: payload.replyTo ?? null
			};

		case 'poll':
			return {
				...base,
				type: 'poll',
				poll: {
					...(payload.poll as object),
					votesByUser: {}
				},
				plainTextContent: `Poll: ${(payload.poll as any)?.question ?? ''}`
			};

		case 'form':
			return {
				...base,
				type: 'form',
				form: {
					...(payload.form as object),
					responses: {}
				},
				plainTextContent: `Form: ${(payload.form as any)?.title ?? ''}`
			};

		default:
			return {
				...base,
				type: 'text',
				text: payload.text ?? '',
				content: payload.text ?? '',
				plainTextContent: payload.text ?? ''
			};
	}
}

/* ===========================
   Firestore Send Functions
=========================== */
async function sendChannelMessageToFirestore(msg: OutboxMessage): Promise<string> {
	if (!msg.serverId) throw new Error('Missing serverId for channel message');

	const db = getDb();
	const docData = buildMessageDoc(msg.payload);

	const docRef = await addDoc(
		collection(db, 'servers', msg.serverId, 'channels', msg.targetId, 'messages'),
		{
			...docData,
			serverId: msg.serverId,
			channelId: msg.targetId,
			threadId: null
		}
	);

	return docRef.id;
}

async function sendDMMessageToFirestore(msg: OutboxMessage): Promise<string> {
	const db = getDb();
	const docData = buildMessageDoc(msg.payload);

	const docRef = await addDoc(
		collection(db, 'dms', msg.targetId, 'messages'),
		{
			...docData,
			dmId: msg.targetId
		}
	);

	return docRef.id;
}

async function sendThreadMessageToFirestore(msg: OutboxMessage): Promise<string> {
	if (!msg.serverId || !msg.parentThreadId) {
		throw new Error('Missing serverId or channelId for thread message');
	}

	const db = getDb();
	const docData = buildMessageDoc(msg.payload);

	const docRef = await addDoc(
		collection(
			db,
			'servers',
			msg.serverId,
			'channels',
			msg.parentThreadId,
			'threads',
			msg.targetId,
			'messages'
		),
		{
			...docData,
			serverId: msg.serverId,
			channelId: msg.parentThreadId,
			threadId: msg.targetId
		}
	);

	return docRef.id;
}

/* ===========================
   Initialize Outbox
=========================== */
let initialized = false;

export function initializeOutbox(): void {
	if (initialized) return;
	initialized = true;

	registerSendFunctions(
		sendChannelMessageToFirestore,
		sendDMMessageToFirestore,
		sendThreadMessageToFirestore
	);
}

// Auto-initialize on import in browser
if (browser) {
	initializeOutbox();
}

/* ===========================
   Optimized Send Functions
=========================== */
export type MessagePayload = {
	uid: string;
	text?: string;
	type?: 'text' | 'gif' | 'file' | 'poll' | 'form';
	displayName?: string | null;
	photoURL?: string | null;
	mentions?: unknown[];
	replyTo?: unknown;
	file?: unknown;
	poll?: unknown;
	form?: unknown;
	url?: string;
};

/**
 * Send a channel message with local echo
 * Returns immediately after adding to outbox
 * Message appears as pending, then confirms in background
 */
export function sendChannelMessageOptimized(
	serverId: string,
	channelId: string,
	payload: MessagePayload
): string {
	const endTimer = timeMessageSend();

	const clientId = queueChannelMessage(serverId, channelId, {
		uid: payload.uid,
		text: payload.text,
		type: payload.type,
		displayName: payload.displayName,
		photoURL: payload.photoURL,
		mentions: payload.mentions,
		replyTo: payload.replyTo,
		file: payload.file,
		poll: payload.poll,
		form: payload.form,
		url: payload.url
	});

	// End timer immediately - we rendered the pending message
	endTimer();

	return clientId;
}

/**
 * Send a DM message with local echo
 */
export function sendDMMessageOptimized(
	threadId: string,
	payload: MessagePayload
): string {
	const endTimer = timeMessageSend();

	const clientId = queueDMMessage(threadId, {
		uid: payload.uid,
		text: payload.text,
		type: payload.type,
		displayName: payload.displayName,
		photoURL: payload.photoURL,
		mentions: payload.mentions,
		replyTo: payload.replyTo,
		file: payload.file,
		url: payload.url // for GIF messages
	});

	endTimer();

	return clientId;
}

/**
 * Send a thread message with local echo
 */
export function sendThreadMessageOptimized(
	serverId: string,
	channelId: string,
	threadId: string,
	payload: MessagePayload
): string {
	const endTimer = timeMessageSend();

	const clientId = queueThreadMessage(serverId, channelId, threadId, {
		uid: payload.uid,
		text: payload.text,
		type: payload.type,
		displayName: payload.displayName,
		photoURL: payload.photoURL,
		mentions: payload.mentions,
		replyTo: payload.replyTo,
		file: payload.file
	});

	endTimer();

	return clientId;
}

/* ===========================
   GIF Sending (no local echo needed - fast)
=========================== */
export function sendGifOptimized(
	type: 'channel' | 'dm',
	targetId: string,
	gifUrl: string,
	payload: Omit<MessagePayload, 'text' | 'type' | 'url'>,
	serverId?: string
): string {
	if (type === 'channel' && serverId) {
		return sendChannelMessageOptimized(serverId, targetId, {
			...payload,
			type: 'gif',
			url: gifUrl
		});
	} else {
		return sendDMMessageOptimized(targetId, {
			...payload,
			type: 'gif',
			url: gifUrl
		});
	}
}
