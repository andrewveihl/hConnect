import { getDb } from '$lib/firebase';
import {
	arrayUnion,
	collection,
	doc,
	getDoc,
	getDocs,
	increment,
	limit,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
	setDoc,
	writeBatch,
	type DocumentSnapshot,
	type Firestore,
	type Timestamp,
	type Unsubscribe
} from 'firebase/firestore';
import { SPECIAL_MENTION_IDS, isSpecialMentionId } from '$lib/data/specialMentions';
import {
	buildMessageDocument,
	type MessageDocument,
	type MessageInput,
	type MentionInput,
	type ReplyReferenceInput
} from './messages';

export type ThreadStatus = 'active' | 'archived';
export type ThreadVisibility = 'inherit_parent_with_exceptions';

export const THREAD_DEFAULT_TTL_HOURS = 24;
export const THREAD_MAX_MEMBER_LIMIT = 20;
const THREAD_ARCHIVE_MAX_HOURS = 7 * 24;

export type ChannelThread = {
	id: string;
	serverId: string;
	channelId: string;
	parentChannelId: string;
	createdFromMessageId: string;
	createdBy: string;
	name: string;
	preview?: string | null;
	lastMessagePreview?: string | null;
	createdAt?: Timestamp;
	lastMessageAt?: Timestamp;
	archivedAt?: Timestamp | null;
	autoArchiveAt?: number | null;
	memberUids: string[];
	memberCount: number;
	maxMembers: number;
	ttlHours: number;
	status: ThreadStatus;
	visibility?: ThreadVisibility;
	messageCount: number;
};

export type ThreadMessage = {
	id: string;
	type: 'text' | 'gif' | 'file' | 'poll' | 'form' | 'system';
	text?: string | null;
	content?: string | null;
	url?: string | null;
	file?: {
		name: string;
		url: string;
		size?: number;
		contentType?: string | null;
		storagePath?: string | null;
	};
	poll?: {
		question: string;
		options: string[];
		votesByUser?: Record<string, number>;
	};
	form?: {
		title: string;
		questions: string[];
		responses?: Record<string, any>;
	};
	authorId?: string | null;
	authorName?: string | null;
	authorDisplay?: string | null;
	uid?: string | null;
	displayName?: string | null;
	photoURL?: string | null;
	mentions?: MentionInput[];
	mentionUids?: string[];
	mentionsMap?: Record<
		string,
		{
			handle: string | null;
			label: string | null;
			color?: string | null;
			kind?: 'member' | 'role' | 'special';
		}
	>;
	replyTo?: ReplyReferenceInput | null;
	systemKind?: 'created' | 'member_added';
	createdAt?: Timestamp;
};

export type ThreadMemberSnapshot = {
	uid: string;
	joinedAt?: Timestamp;
	lastReadAt?: Timestamp | null;
	muted?: boolean;
};

export type ThreadSubscription = Unsubscribe;

type ProfileNameMap = Record<string, { displayName?: string | null } | undefined>;

type CreateThreadOptions = {
	serverId: string;
	channelId: string;
	sourceMessageId: string;
	sourceMessageText?: string | null;
	creator: { uid: string; displayName?: string | null };
	initialMentions?: string[];
	mentionProfiles?: ProfileNameMap;
	ttlHours?: number;
	maxMembers?: number;
};

type SendThreadMessageOptions = {
	serverId: string;
	channelId: string;
	threadId: string;
	message: MessageInput;
	mentionProfiles?: ProfileNameMap;
};

type ThreadReadOptions = {
	at?: Timestamp | Date | number | null;
	lastMessageId?: string | null;
};

const THREAD_VISIBILITY: ThreadVisibility = 'inherit_parent_with_exceptions';

const threadsCollection = (db: Firestore, serverId: string, channelId: string) =>
	collection(db, 'servers', serverId, 'channels', channelId, 'threads');

const threadDocRef = (db: Firestore, serverId: string, channelId: string, threadId: string) =>
	doc(db, 'servers', serverId, 'channels', channelId, 'threads', threadId);

const threadMessagesCollection = (
	db: Firestore,
	serverId: string,
	channelId: string,
	threadId: string
) => collection(db, 'servers', serverId, 'channels', channelId, 'threads', threadId, 'messages');

const threadPermissionsDoc = (
	db: Firestore,
	serverId: string,
	channelId: string,
	threadId: string,
	uid: string
) => doc(db, 'servers', serverId, 'channels', channelId, 'threads', threadId, 'permissions', uid);

const membershipDoc = (db: Firestore, uid: string, threadId: string) =>
	doc(db, 'profiles', uid, 'threadMembership', threadId);

const clampNumber = (value: number, min: number, max: number) =>
	Math.max(min, Math.min(max, value));

const normalizeText = (value: string | null | undefined) =>
	typeof value === 'string' ? value.trim() : '';

const normalizeUid = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length ? trimmed : null;
};

const uniqueUids = (values: unknown[], limitTo: number) => {
	const seen = new Set<string>();
	const list: string[] = [];
	for (const entry of values) {
		const uid = normalizeUid(entry);
		if (!uid || seen.has(uid)) continue;
		seen.add(uid);
		list.push(uid);
		if (list.length >= limitTo) break;
	}
	return list;
};

const threadNameFromSource = (text?: string | null) => {
	const cleaned = normalizeText(text).replace(/\s+/g, ' ');
	if (!cleaned) return 'Thread';
	return cleaned.length > 48 ? cleaned.slice(0, 48).trim() : cleaned;
};

const describeNames = (uids: string[], profiles?: ProfileNameMap) => {
	return uids.map((uid) => normalizeText(profiles?.[uid]?.displayName) || uid);
};

const defaultDisplayName = (name?: string | null) => normalizeText(name) || 'Someone';

const nextAutoArchiveAt = (ttlHours: number) => {
	const ttl = clampNumber(ttlHours, 1, THREAD_ARCHIVE_MAX_HOURS);
	return Date.now() + ttl * 60 * 60 * 1000;
};

const sanitizeMentions = (mentions?: MentionInput[]): MentionInput[] => {
	if (!Array.isArray(mentions) || !mentions.length) return [];
	const cleaned: MentionInput[] = [];
	for (const mention of mentions) {
		const uid = normalizeUid(mention?.uid);
		if (!uid) continue;
		cleaned.push({
			uid,
			handle: normalizeText(mention.handle) || null,
			label: normalizeText(mention.label) || null,
			color: normalizeText(mention.color) || null,
			kind: mention.kind
		});
	}
	return cleaned;
};

const mentionUidList = (mentions?: MentionInput[]) =>
	sanitizeMentions(mentions)
		.map((mention) => mention.uid)
		.filter((uid): uid is string => Boolean(uid) && !isSpecialMentionId(uid));

const systemMessage = (
	text: string,
	overrides: Partial<ThreadMessage> = {}
): Omit<ThreadMessage, 'id'> => ({
	type: 'system',
	text,
	systemKind: overrides.systemKind ?? 'created',
	authorId: overrides.authorId ?? null,
	authorName: overrides.authorName ?? null,
	authorDisplay: overrides.authorDisplay ?? overrides.authorName ?? null,
	uid: overrides.authorId ?? null,
	displayName: overrides.authorName ?? null
});

const toThread = (snap: DocumentSnapshot<any>): ChannelThread => {
	const data = snap.data() ?? {};
	return {
		id: snap.id,
		serverId: data.serverId,
		channelId: data.channelId ?? data.parentChannelId,
		parentChannelId: data.parentChannelId ?? data.channelId,
		createdBy: data.createdBy,
		createdFromMessageId: data.createdFromMessageId,
		name: data.name,
		preview: data.preview ?? data.rootPreview ?? null,
		lastMessagePreview: data.lastMessagePreview ?? null,
		createdAt: data.createdAt,
		lastMessageAt: data.lastMessageAt,
		archivedAt: data.archivedAt ?? null,
		autoArchiveAt: data.autoArchiveAt ?? null,
		memberUids: Array.isArray(data.memberUids) ? data.memberUids : [],
		memberCount: Number(data.memberCount) || 0,
		maxMembers: Number(data.maxMembers) || THREAD_MAX_MEMBER_LIMIT,
		ttlHours: Number(data.ttlHours) || THREAD_DEFAULT_TTL_HOURS,
		status: data.status ?? 'active',
		visibility: data.visibility ?? THREAD_VISIBILITY,
		messageCount: Number(data.messageCount) || 0
	};
};

const toThreadMessage = (snap: DocumentSnapshot<any>): ThreadMessage => {
	const data = snap.data() ?? {};
	return {
		id: snap.id,
		type: data.type ?? (data.systemKind ? 'system' : 'text'),
		text: data.text ?? null,
		content: data.content ?? null,
		url: data.url ?? null,
		file: data.file ?? null,
		poll: data.poll ?? null,
		form: data.form ?? null,
		authorId: data.authorId ?? data.uid ?? null,
		authorName: data.authorName ?? data.displayName ?? null,
		authorDisplay: data.authorDisplay ?? data.authorName ?? data.displayName ?? null,
		uid: data.uid ?? data.authorId ?? null,
		displayName: data.displayName ?? data.authorName ?? null,
		photoURL: data.photoURL ?? null,
		mentions: Array.isArray(data.mentions) ? data.mentions : [],
		mentionUids: Array.isArray(data.mentionUids) ? data.mentionUids : [],
		mentionsMap: data.mentionsMap ?? null,
		replyTo: data.replyTo ?? null,
		systemKind: data.systemKind ?? null,
		createdAt: data.createdAt
	};
};

export async function createChannelThread(options: CreateThreadOptions): Promise<string> {
	const db = getDb();
	const serverId = normalizeText(options.serverId);
	const channelId = normalizeText(options.channelId);
	const sourceMessageId = normalizeText(options.sourceMessageId);
	const creatorUid = normalizeUid(options.creator?.uid);
	if (!serverId || !channelId || !sourceMessageId || !creatorUid) {
		throw new Error('Missing thread creation identifiers.');
	}

	console.log('[createChannelThread] Starting thread creation', {
		serverId,
		channelId,
		sourceMessageId,
		creatorUid
	});

	const ttlHours = clampNumber(
		Number(options.ttlHours) || THREAD_DEFAULT_TTL_HOURS,
		1,
		THREAD_ARCHIVE_MAX_HOURS
	);
	const maxMembers = clampNumber(
		Number(options.maxMembers) || THREAD_MAX_MEMBER_LIMIT,
		2,
		THREAD_MAX_MEMBER_LIMIT
	);

	const memberUids = uniqueUids([creatorUid, ...(options.initialMentions ?? [])], maxMembers);
	if (!memberUids.length) {
		memberUids.push(creatorUid);
	}

	const creatorName = defaultDisplayName(options.creator?.displayName);
	const otherNames = describeNames(
		memberUids.filter((uid) => uid !== creatorUid),
		options.mentionProfiles
	);
	const introText =
		otherNames.length > 0
			? `${creatorName} started a thread with ${otherNames.join(', ')}.`
			: `${creatorName} started a thread.`;

	const threadName = threadNameFromSource(options.sourceMessageText);
	const threadRef = doc(threadsCollection(db, serverId, channelId));
	const now = serverTimestamp();
	const autoArchiveAt = nextAutoArchiveAt(ttlHours);
	const preview = normalizeText(options.sourceMessageText) || introText;

	// Step 1: Create thread document
	console.log('[createChannelThread] Step 1: Creating thread document', threadRef.path);
	try {
		await setDoc(threadRef, {
			id: threadRef.id,
			serverId,
			channelId,
			parentChannelId: channelId,
			createdBy: creatorUid,
			createdFromMessageId: sourceMessageId,
			createdAt: now,
			name: threadName,
			preview,
			rootPreview: preview,
			lastMessageAt: now,
			lastMessagePreview: introText,
			autoArchiveAt,
			status: 'active',
			ttlHours,
			maxMembers,
			memberUids,
			memberCount: memberUids.length,
			visibility: THREAD_VISIBILITY,
			archivedAt: null,
			messageCount: 0
		});
		console.log('[createChannelThread] Step 1: SUCCESS - Thread document created');
	} catch (err) {
		console.error('[createChannelThread] Step 1: FAILED - Thread document creation', err);
		throw new Error(`Thread creation failed at step 1 (thread doc): ${err instanceof Error ? err.message : err}`);
	}

	// Step 2: Create system message
	const systemRef = doc(threadMessagesCollection(db, serverId, channelId, threadRef.id));
	console.log('[createChannelThread] Step 2: Creating system message', systemRef.path);
	try {
		await setDoc(systemRef, {
			type: 'system',
			systemKind: 'created',
			text: introText,
			authorId: creatorUid,
			authorName: creatorName,
			authorDisplay: creatorName,
			createdAt: now
		});
		console.log('[createChannelThread] Step 2: SUCCESS - System message created');
	} catch (err) {
		console.error('[createChannelThread] Step 2: FAILED - System message creation', err);
		throw new Error(`Thread creation failed at step 2 (system message): ${err instanceof Error ? err.message : err}`);
	}

	// Step 3: Create permission documents
	console.log('[createChannelThread] Step 3: Creating permission docs for', memberUids);
	try {
		await Promise.all(
			memberUids.map(async (uid) => {
				const permRef = threadPermissionsDoc(db, serverId, channelId, threadRef.id, uid);
				console.log('[createChannelThread] Step 3: Writing permission for', uid, permRef.path);
				try {
					await setDoc(
						permRef,
						{
							canRead: true,
							canPost: true,
							grantedBy: creatorUid,
							grantedAt: now
						},
						{ merge: true }
					);
					console.log('[createChannelThread] Step 3: SUCCESS - Permission for', uid);
				} catch (permErr) {
					console.error('[createChannelThread] Step 3: FAILED - Permission for', uid, permErr);
					throw permErr;
				}
			})
		);
		console.log('[createChannelThread] Step 3: SUCCESS - All permissions created');
	} catch (err) {
		console.error('[createChannelThread] Step 3: FAILED - Permission creation', err);
		throw new Error(`Thread creation failed at step 3 (permissions): ${err instanceof Error ? err.message : err}`);
	}

	console.log('[createChannelThread] Thread creation complete, id:', threadRef.id);
	return threadRef.id;
}

async function fetchThreadData(
	db: Firestore,
	serverId: string,
	channelId: string,
	threadId: string
) {
	const ref = threadDocRef(db, serverId, channelId, threadId);
	const snap = await getDoc(ref);
	if (!snap.exists()) {
		throw new Error('Thread not found.');
	}
	return { ref, data: snap.data() as any };
}

async function fetchServerMemberIds(db: Firestore, serverId: string): Promise<string[]> {
	const membersRef = collection(db, 'servers', serverId, 'members');
	const snap = await getDocs(membersRef);
	return snap.docs
		.map((docSnap) => docSnap.id)
		.filter((uid): uid is string => typeof uid === 'string' && uid.trim().length > 0);
}

export async function sendThreadMessage(options: SendThreadMessageOptions) {
	const db = getDb();
	const serverId = normalizeText(options.serverId);
	const channelId = normalizeText(options.channelId);
	const threadId = normalizeText(options.threadId);

	if (!serverId || !channelId || !threadId) {
		throw new Error('Missing thread message fields.');
	}

	const { ref, data } = await fetchThreadData(db, serverId, channelId, threadId);
	const maxMembers = Number(data.maxMembers) || THREAD_MAX_MEMBER_LIMIT;
	const ttlHours = Number(data.ttlHours) || THREAD_DEFAULT_TTL_HOURS;
	const memberUids: string[] = Array.isArray(data.memberUids) ? data.memberUids : [];

	const baseDoc = buildMessageDocument(options.message);
	const docData: MessageDocument & {
		serverId: string;
		channelId: string;
		threadId: string;
	} = {
		...baseDoc,
		serverId,
		channelId,
		threadId
	};
	const authorId = normalizeUid(docData.uid);
	if (!authorId) {
		throw new Error('Thread message must include a sender.');
	}

	const mentions = sanitizeMentions(docData.mentions);
	const mentionUids = mentionUidList(mentions);
	const mentionedIds = new Set(mentions.map((mention) => mention.uid));
	const hasEveryoneMention = mentionedIds.has(SPECIAL_MENTION_IDS.EVERYONE);
	const pendingAdds: string[] = [];

	const missingAuthor = !memberUids.includes(authorId);
	if (missingAuthor && memberUids.length < maxMembers) {
		pendingAdds.push(authorId);
	}

	for (const uid of mentionUids) {
		if (memberUids.includes(uid) || pendingAdds.includes(uid)) continue;
		if (memberUids.length + pendingAdds.length >= maxMembers) break;
		pendingAdds.push(uid);
	}

	if (hasEveryoneMention && memberUids.length + pendingAdds.length < maxMembers) {
		try {
			const serverMemberIds = await fetchServerMemberIds(db, serverId);
			for (const uid of serverMemberIds) {
				if (
					!uid ||
					memberUids.includes(uid) ||
					pendingAdds.includes(uid) ||
					memberUids.length + pendingAdds.length >= maxMembers
				) {
					continue;
				}
				pendingAdds.push(uid);
			}
		} catch (err) {
			console.warn('[threads] failed to extend thread membership for @everyone mention', err);
		}
	}

	const now = serverTimestamp();
	const autoArchiveAt = nextAutoArchiveAt(ttlHours);
	const messageRef = doc(threadMessagesCollection(db, serverId, channelId, threadId));

	const payload: Record<string, any> = {
		...docData,
		type: docData.type ?? 'text',
		authorId,
		authorName: docData.displayName ?? docData.authorName ?? null,
		authorDisplay: docData.displayName ?? docData.authorName ?? null,
		mentions,
		mentionUids,
		createdAt: now
	};

	const batch = writeBatch(db);
	batch.set(messageRef, payload);

	const updatePayload: Record<string, unknown> = {
		lastMessageAt: now,
		lastMessagePreview: deriveThreadPreview(payload),
		autoArchiveAt,
		status: 'active',
		archivedAt: null,
		messageCount: increment(1)
	};

	if (pendingAdds.length) {
		updatePayload.memberUids = arrayUnion(...pendingAdds);
		updatePayload.memberCount = increment(pendingAdds.length);
	}

	batch.update(ref, updatePayload);

	if (pendingAdds.length) {
		const names = describeNames(pendingAdds, options.mentionProfiles);
		const authorDisplay = defaultDisplayName(
			payload.displayName ?? payload.authorName ?? data.memberDisplay?.[authorId]
		);
		const addText =
			names.length === 1
				? `${authorDisplay} added ${names[0]} to the thread.`
				: `${authorDisplay} added ${names.join(', ')} to the thread.`;
		const systemRef = doc(threadMessagesCollection(db, serverId, channelId, threadId));
		batch.set(systemRef, {
			...systemMessage(addText, {
				systemKind: 'member_added',
				authorId,
				authorName: authorDisplay
			}),
			createdAt: now
		});

		for (const uid of pendingAdds) {
			batch.set(
				threadPermissionsDoc(db, serverId, channelId, threadId, uid),
				{
					canRead: true,
					canPost: true,
					grantedBy: authorId,
					grantedAt: now
				},
				{ merge: true }
			);
		}
	}

	await batch.commit();
}

function deriveThreadPreview(payload: Record<string, any>): string {
	switch (payload.type) {
		case 'gif':
			return 'Shared a GIF';
		case 'file':
			return payload.file?.name ? `Shared ${payload.file.name}` : 'Shared a file';
		case 'poll':
			return payload.poll?.question ? `Poll: ${payload.poll.question}` : 'Shared a poll';
		case 'form':
			return payload.form?.title ? `Form: ${payload.form.title}` : 'Shared a form';
		case 'system':
			return payload.text ?? 'System update';
		case 'text':
		default:
			return (payload.text ?? payload.content ?? '').slice(0, 120);
	}
}

export function streamChannelThreads(
	serverId: string,
	channelId: string,
	cb: (threads: ChannelThread[]) => void,
	{ limitTo, onError }: { limitTo?: number; onError?: (err: unknown) => void } = {}
): ThreadSubscription {
	const db = getDb();
	const q = query(
		threadsCollection(db, serverId, channelId),
		orderBy('lastMessageAt', 'desc'),
		...(limitTo ? [limit(limitTo)] : [])
	);
	return onSnapshot(
		q,
		(snap) => {
			cb(snap.docs.map(toThread));
		},
		(err) => {
			if (onError) onError(err);
		}
	);
}

export function streamThreadMessages(
	serverId: string,
	channelId: string,
	threadId: string,
	cb: (messages: ThreadMessage[]) => void,
	{ onError }: { onError?: (err: unknown) => void } = {}
): ThreadSubscription {
	const db = getDb();
	const q = query(
		threadMessagesCollection(db, serverId, channelId, threadId),
		orderBy('createdAt', 'asc')
	);
	return onSnapshot(
		q,
		(snap) => {
			cb(snap.docs.map(toThreadMessage));
		},
		(err) => {
			if (onError) onError(err);
		}
	);
}

export async function markThreadRead(
	uid: string,
	serverId: string,
	channelId: string,
	threadId: string,
	opts: ThreadReadOptions = {}
) {
	const db = getDb();
	await setDoc(
		membershipDoc(db, uid, threadId),
		{
			threadId,
			serverId,
			channelId,
			lastReadAt: opts.at ?? serverTimestamp(),
			lastReadMessageId: opts.lastMessageId ?? null
		},
		{ merge: true }
	);
}

export async function toggleThreadMute(uid: string, threadId: string, muted: boolean) {
	const db = getDb();
	await setDoc(
		membershipDoc(db, uid, threadId),
		{
			muted,
			mutedAt: serverTimestamp()
		},
		{ merge: true }
	);
}
