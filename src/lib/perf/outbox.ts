// src/lib/perf/outbox.ts
// Local-echo message queue with optimistic UI and background sync
// Messages render immediately as pending, then confirm in background

import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';

/* ===========================
   Configuration
=========================== */
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 10000]; // Exponential backoff
const MAX_QUEUE_SIZE = 50;
const PENDING_MESSAGE_TTL = 5 * 60 * 1000; // 5 minutes

/* ===========================
   Types
=========================== */
export type MessageStatus = 'pending' | 'sending' | 'sent' | 'failed';

export type OutboxMessage = {
	clientId: string;
	type: 'channel' | 'dm' | 'thread';
	targetId: string; // channelId, threadId, or dmId
	serverId?: string; // for channel messages
	parentThreadId?: string; // for thread messages
	payload: {
		uid: string;
		text?: string;
		type?: string;
		displayName?: string | null;
		photoURL?: string | null;
		mentions?: unknown[];
		replyTo?: unknown;
		file?: unknown;
		poll?: unknown;
		form?: unknown;
		url?: string; // for GIF
	};
	status: MessageStatus;
	error?: string;
	retryCount: number;
	createdAt: number;
	sentAt?: number;
	firestoreId?: string;
};

export type PendingMessage = {
	id: string; // clientId
	uid: string;
	text?: string;
	content?: string;
	type?: string;
	displayName?: string | null;
	photoURL?: string | null;
	createdAt: number;
	pending: true;
	status: MessageStatus;
	error?: string;
	mentions?: unknown[];
	replyTo?: unknown;
	attachments?: unknown[];
	file?: unknown;
	poll?: unknown;
	form?: unknown;
};

/* ===========================
   Stores
=========================== */
// Queue of messages waiting to be sent
const outboxQueue = writable<OutboxMessage[]>([]);

// Map of pending messages by target (for merging with live messages)
// Key: targetId (channelId, threadId, or dmId)
const pendingByTarget = writable<Map<string, PendingMessage[]>>(new Map());

/* ===========================
   ID Generation
=========================== */
let clientIdCounter = 0;

export function generateClientId(): string {
	return `pending_${Date.now()}_${++clientIdCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ===========================
   Pending Message Helpers
=========================== */
function createPendingMessage(msg: OutboxMessage): PendingMessage {
	return {
		id: msg.clientId,
		uid: msg.payload.uid,
		text: msg.payload.text,
		content: msg.payload.text,
		type: msg.payload.type ?? 'text',
		displayName: msg.payload.displayName,
		photoURL: msg.payload.photoURL,
		createdAt: msg.createdAt,
		pending: true,
		status: msg.status,
		error: msg.error,
		mentions: msg.payload.mentions,
		replyTo: msg.payload.replyTo,
		file: msg.payload.file,
		poll: msg.payload.poll,
		form: msg.payload.form
	};
}

function updatePendingMessages(targetId: string, updater: (msgs: PendingMessage[]) => PendingMessage[]): void {
	pendingByTarget.update((map) => {
		const current = map.get(targetId) ?? [];
		const updated = updater(current);
		if (updated.length > 0) {
			map.set(targetId, updated);
		} else {
			map.delete(targetId);
		}
		return map;
	});
}

/* ===========================
   Queue Operations
=========================== */
type SendFunction = (msg: OutboxMessage) => Promise<string>; // Returns Firestore doc ID

let channelSendFn: SendFunction | null = null;
let dmSendFn: SendFunction | null = null;
let threadSendFn: SendFunction | null = null;

/**
 * Register send functions for different message types
 * Call this during app initialization
 */
export function registerSendFunctions(
	channel: SendFunction,
	dm: SendFunction,
	thread: SendFunction
): void {
	channelSendFn = channel;
	dmSendFn = dm;
	threadSendFn = thread;
}

/**
 * Add a message to the outbox and render it immediately as pending
 * Returns the clientId for tracking
 */
export function queueMessage(
	type: OutboxMessage['type'],
	targetId: string,
	payload: OutboxMessage['payload'],
	serverId?: string,
	parentThreadId?: string
): string {
	const clientId = generateClientId();
	const now = Date.now();

	const msg: OutboxMessage = {
		clientId,
		type,
		targetId,
		serverId,
		parentThreadId,
		payload,
		status: 'pending',
		retryCount: 0,
		createdAt: now
	};

	// Add to queue
	outboxQueue.update((queue) => {
		const newQueue = [...queue, msg];
		// Trim old messages if over limit
		if (newQueue.length > MAX_QUEUE_SIZE) {
			return newQueue.slice(-MAX_QUEUE_SIZE);
		}
		return newQueue;
	});

	// Add to pending messages for this target
	const pending = createPendingMessage(msg);
	updatePendingMessages(targetId, (msgs) => [...msgs, pending]);

	// Start processing queue
	processQueue();

	return clientId;
}

/**
 * Queue a channel message
 */
export function queueChannelMessage(
	serverId: string,
	channelId: string,
	payload: OutboxMessage['payload']
): string {
	return queueMessage('channel', channelId, payload, serverId);
}

/**
 * Queue a DM message
 */
export function queueDMMessage(
	threadId: string,
	payload: OutboxMessage['payload']
): string {
	return queueMessage('dm', threadId, payload);
}

/**
 * Queue a thread message
 */
export function queueThreadMessage(
	serverId: string,
	channelId: string,
	threadId: string,
	payload: OutboxMessage['payload']
): string {
	return queueMessage('thread', threadId, payload, serverId, channelId);
}

/* ===========================
   Queue Processing
=========================== */
let processingQueue = false;

async function processQueue(): Promise<void> {
	if (processingQueue) return;
	processingQueue = true;

	try {
		while (true) {
			const queue = get(outboxQueue);
			const nextMsg = queue.find((m) => m.status === 'pending');

			if (!nextMsg) break;

			await processMessage(nextMsg);
		}
	} finally {
		processingQueue = false;
	}
}

async function processMessage(msg: OutboxMessage): Promise<void> {
	// Update status to sending
	updateMessageStatus(msg.clientId, 'sending');

	const sendFn = msg.type === 'channel' ? channelSendFn
		: msg.type === 'dm' ? dmSendFn
		: msg.type === 'thread' ? threadSendFn
		: null;

	if (!sendFn) {
		updateMessageStatus(msg.clientId, 'failed', 'Send function not registered');
		return;
	}

	try {
		const firestoreId = await sendFn(msg);
		
		// Success - update status and store Firestore ID
		outboxQueue.update((queue) =>
			queue.map((m) =>
				m.clientId === msg.clientId
					? { ...m, status: 'sent' as const, sentAt: Date.now(), firestoreId }
					: m
			)
		);

		// Remove from pending messages
		updatePendingMessages(msg.targetId, (msgs) =>
			msgs.filter((m) => m.id !== msg.clientId)
		);

		// Clean up sent message from queue after a short delay
		setTimeout(() => {
			outboxQueue.update((queue) =>
				queue.filter((m) => m.clientId !== msg.clientId)
			);
		}, 2000);
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : 'Unknown error';
		
		msg.retryCount++;
		
		if (msg.retryCount >= MAX_RETRIES) {
			updateMessageStatus(msg.clientId, 'failed', errorMsg);
		} else {
			// Schedule retry
			const delay = RETRY_DELAYS[msg.retryCount - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
			updateMessageStatus(msg.clientId, 'pending');
			
			setTimeout(() => {
				processQueue();
			}, delay);
		}
	}
}

function updateMessageStatus(clientId: string, status: MessageStatus, error?: string): void {
	outboxQueue.update((queue) =>
		queue.map((m) =>
			m.clientId === clientId
				? { ...m, status, error }
				: m
		)
	);

	// Update pending message status
	const queue = get(outboxQueue);
	const msg = queue.find((m) => m.clientId === clientId);
	if (msg) {
		updatePendingMessages(msg.targetId, (msgs) =>
			msgs.map((m) =>
				m.id === clientId
					? { ...m, status, error }
					: m
			)
		);
	}
}

/* ===========================
   Retry and Cancel
=========================== */
export function retryMessage(clientId: string): void {
	outboxQueue.update((queue) =>
		queue.map((m) =>
			m.clientId === clientId && m.status === 'failed'
				? { ...m, status: 'pending' as const, retryCount: 0, error: undefined }
				: m
		)
	);

	const queue = get(outboxQueue);
	const msg = queue.find((m) => m.clientId === clientId);
	if (msg) {
		updatePendingMessages(msg.targetId, (msgs) =>
			msgs.map((m) =>
				m.id === clientId
					? { ...m, status: 'pending' as const, error: undefined }
					: m
			)
		);
	}

	processQueue();
}

export function cancelMessage(clientId: string): void {
	const queue = get(outboxQueue);
	const msg = queue.find((m) => m.clientId === clientId);

	if (msg) {
		// Remove from pending messages
		updatePendingMessages(msg.targetId, (msgs) =>
			msgs.filter((m) => m.id !== clientId)
		);
	}

	// Remove from queue
	outboxQueue.update((queue) =>
		queue.filter((m) => m.clientId !== clientId)
	);
}

/* ===========================
   Query Functions
=========================== */
export function getPendingMessages(targetId: string): PendingMessage[] {
	const map = get(pendingByTarget);
	return map.get(targetId) ?? [];
}

export function hasPendingMessages(targetId: string): boolean {
	const map = get(pendingByTarget);
	const msgs = map.get(targetId);
	return msgs !== undefined && msgs.length > 0;
}

export function getQueueLength(): number {
	return get(outboxQueue).length;
}

export function getFailedMessages(): OutboxMessage[] {
	return get(outboxQueue).filter((m) => m.status === 'failed');
}

/**
 * Subscribe to pending messages for a target
 * Returns an unsubscribe function
 */
export function subscribePendingMessages(
	targetId: string,
	callback: (msgs: PendingMessage[]) => void
): () => void {
	let lastValue: PendingMessage[] = [];

	const unsubscribe = pendingByTarget.subscribe((map) => {
		const msgs = map.get(targetId) ?? [];
		// Only call callback if value changed
		if (msgs !== lastValue) {
			lastValue = msgs;
			callback(msgs);
		}
	});

	return unsubscribe;
}

/**
 * Merge pending messages with live messages
 * Returns combined array with pending messages at the end
 */
export function mergeWithPending<T extends { id: string; createdAt?: unknown }>(
	liveMessages: T[],
	targetId: string
): (T | PendingMessage)[] {
	const pending = getPendingMessages(targetId);
	if (pending.length === 0) return liveMessages;

	// Filter out any pending messages that now have Firestore IDs in live messages
	const liveIds = new Set(liveMessages.map((m) => m.id));
	const queue = get(outboxQueue);
	const sentClientIds = new Set(
		queue
			.filter((m) => m.status === 'sent' && m.firestoreId && liveIds.has(m.firestoreId))
			.map((m) => m.clientId)
	);

	const filteredPending = pending.filter((m) => !sentClientIds.has(m.id));

	return [...liveMessages, ...filteredPending];
}

/* ===========================
   Cleanup
=========================== */
export function clearQueue(): void {
	outboxQueue.set([]);
	pendingByTarget.set(new Map());
}

export function clearFailedMessages(): void {
	const queue = get(outboxQueue);
	const failed = queue.filter((m) => m.status === 'failed');

	for (const msg of failed) {
		updatePendingMessages(msg.targetId, (msgs) =>
			msgs.filter((m) => m.id !== msg.clientId)
		);
	}

	outboxQueue.update((queue) =>
		queue.filter((m) => m.status !== 'failed')
	);
}

// Clean up old pending messages periodically
if (browser) {
	setInterval(() => {
		const now = Date.now();
		const queue = get(outboxQueue);
		const expired = queue.filter(
			(m) => m.status === 'failed' && now - m.createdAt > PENDING_MESSAGE_TTL
		);

		for (const msg of expired) {
			cancelMessage(msg.clientId);
		}
	}, 60 * 1000); // Check every minute
}

/* ===========================
   Debug interface
=========================== */
export function getOutboxStats() {
	const queue = get(outboxQueue);
	const map = get(pendingByTarget);

	return {
		queueLength: queue.length,
		pending: queue.filter((m) => m.status === 'pending').length,
		sending: queue.filter((m) => m.status === 'sending').length,
		sent: queue.filter((m) => m.status === 'sent').length,
		failed: queue.filter((m) => m.status === 'failed').length,
		targetCount: map.size,
		queue: queue.map((m) => ({
			clientId: m.clientId,
			type: m.type,
			targetId: m.targetId,
			status: m.status,
			retryCount: m.retryCount,
			age: Date.now() - m.createdAt
		}))
	};
}

// Expose debug commands on window
if (browser && typeof window !== 'undefined') {
	(window as any).__outbox = {
		getStats: getOutboxStats,
		getQueue: () => get(outboxQueue),
		getPending: (targetId: string) => getPendingMessages(targetId),
		retryMessage,
		cancelMessage,
		clearQueue,
		clearFailed: clearFailedMessages
	};
}

// Export stores for reactive subscriptions
export { outboxQueue, pendingByTarget };
