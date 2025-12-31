import { getDb } from '$lib/firebase';
import {
	addDoc,
	collection,
	doc,
	limit,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
	setDoc,
	updateDoc,
	runTransaction,
	deleteField,
	type Unsubscribe
} from 'firebase/firestore';
import { SPECIAL_MENTION_IDS } from '$lib/data/specialMentions';

type Nullable<T> = T | null | undefined;

export type ReplyReferenceInput = {
	messageId: string;
	authorId?: Nullable<string>;
	authorName?: Nullable<string>;
	preview?: Nullable<string>;
	text?: Nullable<string>;
	type?: Nullable<string>;
	parent?: ReplyReferenceInput | null;
};

export type BaseMessageInput = {
	uid: string;
	displayName?: Nullable<string>;
	photoURL?: Nullable<string>;
	mentions?: MentionInput[];
	replyTo?: ReplyReferenceInput;
};

export type TextMessageInput = BaseMessageInput & {
	type?: 'text';
	text: string;
};

export type GifMessageInput = BaseMessageInput & {
	type: 'gif';
	url: string;
};

export type PollMessageInput = BaseMessageInput & {
	type: 'poll';
	poll: {
		question: string;
		options: string[];
	};
};

export type FormMessageInput = BaseMessageInput & {
	type: 'form';
	form: {
		title: string;
		questions: string[];
	};
};

export type FileMessageInput = BaseMessageInput & {
	type: 'file';
	file: {
		name: string;
		url: string;
		size?: number;
		contentType?: string | null;
		storagePath?: string | null;
	};
};

export type MessageInput =
	| TextMessageInput
	| GifMessageInput
	| PollMessageInput
	| FormMessageInput
	| FileMessageInput;

export type MentionInput = {
	uid: string;
	handle?: Nullable<string>;
	label?: Nullable<string>;
	color?: Nullable<string>;
	kind?: 'member' | 'role' | 'special';
};

function trimString(value: Nullable<string>): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length ? trimmed : undefined;
}

function baseAuthorFields(payload: BaseMessageInput) {
	const displayName = trimString(payload.displayName) ?? null;
	const photoURL = trimString(payload.photoURL) ?? null;
	return {
		uid: payload.uid,
		authorId: payload.uid,
		displayName,
		photoURL,
		author: {
			displayName,
			photoURL
		}
	};
}

function encodeReactionKey(emoji: string) {
	const parts = Array.from(emoji ?? '')
		.map((char) => {
			const code = char.codePointAt(0);
			return code !== undefined ? code.toString(16) : null;
		})
		.filter((part): part is string => Boolean(part));
	return parts.length ? 'u' + parts.join('_') : 'u';
}

export function reactionKeyFromEmoji(emoji: Nullable<string>) {
	const symbol = trimString(emoji);
	if (!symbol) return 'u';
	return encodeReactionKey(symbol);
}

function compactRecord(record: Record<string, any>) {
	const output: Record<string, any> = {};
	for (const key in record) {
		if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
		const value = record[key];
		if (value !== undefined) output[key] = value;
	}
	return output;
}

function normalizeMentionList(mentions: MentionInput[] | undefined): Array<{
	uid: string;
	handle: string | null;
	label: string | null;
	color: string | null;
	kind?: 'member' | 'role' | 'special';
}> {
	if (!Array.isArray(mentions)) return [];
	const map = new Map<
		string,
		{
			uid: string;
			handle: string | null;
			label: string | null;
			color: string | null;
			kind?: 'member' | 'role' | 'special';
		}
	>();
	for (const entry of mentions) {
		const uid = trimString(entry?.uid);
		if (!uid) continue;
		const handle = trimString(entry?.handle) ?? null;
		const label = trimString(entry?.label) ?? null;
		const color = trimString(entry?.color) ?? null;
		const kind =
			entry?.kind === 'role'
				? 'role'
				: entry?.kind === 'member'
					? 'member'
					: entry?.kind === 'special'
						? 'special'
						: undefined;
		map.set(uid, { uid, handle, label, color, kind });
	}
	return Array.from(map.values());
}

function normalizeReplyReference(
	reply: ReplyReferenceInput | undefined
): ReplyReferenceInput | undefined {
	if (!reply) return undefined;
	const messageId = trimString(reply.messageId);
	if (!messageId) return undefined;
	const normalizedParent = normalizeReplyReference(reply.parent ?? undefined);
	const result = {
		messageId,
		authorId: trimString(reply.authorId) ?? null,
		authorName: trimString(reply.authorName) ?? null,
		preview: trimString(reply.preview) ?? null,
		text: trimString(reply.text) ?? null,
		type: trimString(reply.type) ?? null
	};
	if (normalizedParent) {
		(result as ReplyReferenceInput).parent = normalizedParent;
	}
	return result;
}

export function buildMessageDocument(payload: MessageInput) {
	if (!payload?.uid) {
		throw new Error('Cannot write message without uid.');
	}

	const type = payload.type ?? 'text';
	const base = baseAuthorFields(payload);
	let extras: Record<string, any> = {};
	const mentions = normalizeMentionList((payload as any)?.mentions);
	const mentionUidSet = new Set(mentions.map((mention) => mention.uid));
	const mentionsEveryone = mentionUidSet.has(SPECIAL_MENTION_IDS.EVERYONE);
	const mentionsHere = mentionUidSet.has(SPECIAL_MENTION_IDS.HERE);
	const replyTo = normalizeReplyReference((payload as BaseMessageInput)?.replyTo);

	switch (type) {
		case 'text': {
			const text = trimString((payload as TextMessageInput).text);
			if (!text) throw new Error('Message text cannot be empty.');
			extras = {
				type: 'text',
				text,
				content: text,
				plainTextContent: text
			};
			break;
		}
		case 'gif': {
			const url = trimString((payload as GifMessageInput).url);
			if (!url) throw new Error('GIF message requires a URL.');
			extras = {
				type: 'gif',
				url,
				plainTextContent: 'Shared a GIF'
			};
			break;
		}
		case 'file': {
			const filePayload = (payload as FileMessageInput).file;
			const url = trimString(filePayload?.url);
			if (!url) throw new Error('File message requires a download URL.');
			const name = trimString(filePayload?.name) ?? 'File';
			const size =
				typeof filePayload?.size === 'number' && Number.isFinite(filePayload.size)
					? Math.max(0, filePayload.size)
					: undefined;
			const contentType = trimString(filePayload?.contentType) ?? null;
			const storagePath = trimString(filePayload?.storagePath) ?? null;
			extras = {
				type: 'file',
				file: compactRecord({
					name,
					url,
					size,
					contentType,
					storagePath
				}),
				plainTextContent: `Shared ${name}`
			};
			break;
		}
		case 'poll': {
			const pollPayload = (payload as PollMessageInput).poll;
			const question = trimString(pollPayload?.question);
			const options = (pollPayload?.options ?? [])
				.map((opt) => trimString(opt))
				.filter((opt): opt is string => Boolean(opt));
			if (!question || options.length < 2) {
				throw new Error('Poll requires a question and at least two options.');
			}
			extras = {
				type: 'poll',
				poll: {
					question,
					options,
					votesByUser: {}
				},
				plainTextContent: `Poll: ${question}`
			};
			break;
		}
		case 'form': {
			const formPayload = (payload as FormMessageInput).form;
			const title = trimString(formPayload?.title);
			const questions = (formPayload?.questions ?? [])
				.map((q) => trimString(q))
				.filter((q): q is string => Boolean(q));
			if (!title || questions.length === 0) {
				throw new Error('Form requires a title and at least one question.');
			}
			extras = {
				type: 'form',
				form: {
					title,
					questions,
					responses: {}
				},
				plainTextContent: `Form: ${title}`
			};
			break;
		}
		default: {
			throw new Error(`Unsupported message type: ${String(type)}`);
		}
	}

	if (mentions.length) {
		extras = {
			...extras,
			mentions,
			mentionsMap: mentions.reduce<
				Record<
					string,
					{
						handle: string | null;
						label: string | null;
						color?: string | null;
						kind?: 'member' | 'role' | 'special';
					}
				>
			>((acc, entry) => {
				acc[entry.uid] = {
					handle: entry.handle ?? null,
					label: entry.label ?? null,
					color: entry.color ?? null,
					kind: entry.kind
				};
				return acc;
			}, {}),
			...(mentionsEveryone ? { mentionsEveryone: true } : {}),
			...(mentionsHere ? { mentionsHere: true } : {})
		};
	}

	const plainTextContent =
		typeof extras.plainTextContent === 'string'
			? extras.plainTextContent
			: typeof extras.text === 'string'
				? extras.text
				: typeof extras.content === 'string'
					? extras.content
					: null;

	return {
		...compactRecord(base),
		...compactRecord(extras),
		plainTextContent: plainTextContent ?? null,
		...(replyTo ? { replyTo } : {}),
		createdAt: serverTimestamp()
	} as MessageDocument;
}

export type MessageDocument = Record<string, any>;

export async function sendChannelMessage(
	serverId: string,
	channelId: string,
	payload: MessageInput
) {
	const cleanServer = trimString(serverId);
	const cleanChannel = trimString(channelId);
	if (!cleanServer) throw new Error('Missing server id.');
	if (!cleanChannel) throw new Error('Missing channel id.');

	const db = getDb();
	const baseDoc = buildMessageDocument(payload);
	const docData: MessageDocument & {
		serverId: string;
		channelId: string;
		threadId: string | null;
	} = {
		...baseDoc,
		serverId: cleanServer,
		channelId: cleanChannel,
		threadId: null
	};

	await addDoc(
		collection(db, 'servers', cleanServer, 'channels', cleanChannel, 'messages'),
		docData
	);
}

export async function toggleChannelReaction(
	serverId: string,
	channelId: string,
	messageId: string,
	uid: string,
	emoji: string
) {
	const cleanServer = trimString(serverId);
	const cleanChannel = trimString(channelId);
	const cleanMessage = trimString(messageId);
	const cleanUid = trimString(uid);
	const symbol = trimString(emoji);
	if (!cleanServer || !cleanChannel || !cleanMessage || !cleanUid || !symbol) {
		throw new Error('Missing reaction identifiers.');
	}

	const key = reactionKeyFromEmoji(symbol);
	const db = getDb();
	const messageRef = doc(
		db,
		'servers',
		cleanServer,
		'channels',
		cleanChannel,
		'messages',
		cleanMessage
	);

	await runTransaction(db, async (tx) => {
		const snap = await tx.get(messageRef);
		if (!snap.exists()) throw new Error('Message not found.');
		const data: any = snap.data() ?? {};
		const reactions: Record<string, any> = data.reactions ?? {};
		const entry = reactions[key] ?? { emoji: symbol, users: {} };
		const users: Record<string, boolean> = { ...(entry.users ?? {}) };
		const has = Boolean(users[cleanUid]);

		if (has) {
			delete users[cleanUid];
			if (Object.keys(users).length === 0) {
				tx.update(messageRef, {
					[`reactions.${key}`]: deleteField()
				});
			} else {
				tx.update(messageRef, {
					[`reactions.${key}.users`]: users
				});
			}
		} else {
			users[cleanUid] = true;
			tx.update(messageRef, {
				[`reactions.${key}.emoji`]: symbol,
				[`reactions.${key}.users`]: users
			});
		}
	});
}

/**
 * Edit a channel message (text only). Only the original author can edit.
 */
export async function editChannelMessage(
	serverId: string,
	channelId: string,
	messageId: string,
	newText: string
) {
	const cleanServer = trimString(serverId);
	const cleanChannel = trimString(channelId);
	const cleanMessage = trimString(messageId);
	const text = trimString(newText);
	if (!cleanServer || !cleanChannel || !cleanMessage || !text) {
		throw new Error('Missing required fields for message edit.');
	}

	const db = getDb();
	await updateDoc(
		doc(db, 'servers', cleanServer, 'channels', cleanChannel, 'messages', cleanMessage),
		{
			text,
			content: text,
			plainTextContent: text,
			editedAt: serverTimestamp()
		}
	);
}

/**
 * Delete a channel message. Only the original author or users with manageMessages permission can delete.
 */
export async function deleteChannelMessage(
	serverId: string,
	channelId: string,
	messageId: string
) {
	const cleanServer = trimString(serverId);
	const cleanChannel = trimString(channelId);
	const cleanMessage = trimString(messageId);
	if (!cleanServer || !cleanChannel || !cleanMessage) {
		throw new Error('Missing required fields for message deletion.');
	}

	const db = getDb();
	const { deleteDoc } = await import('firebase/firestore');
	await deleteDoc(
		doc(db, 'servers', cleanServer, 'channels', cleanChannel, 'messages', cleanMessage)
	);
}

export async function voteOnChannelPoll(
	serverId: string,
	channelId: string,
	messageId: string,
	uid: string,
	optionIndex: number
) {
	const cleanServer = trimString(serverId);
	const cleanChannel = trimString(channelId);
	const cleanMessage = trimString(messageId);
	const cleanUid = trimString(uid);
	if (!cleanServer || !cleanChannel || !cleanMessage || !cleanUid) {
		throw new Error('Missing poll vote identifiers.');
	}
	const choice = Number(optionIndex);
	if (!Number.isFinite(choice) || choice < 0) {
		throw new Error('Invalid poll option index.');
	}

	const db = getDb();
	await updateDoc(
		doc(db, 'servers', cleanServer, 'channels', cleanChannel, 'messages', cleanMessage),
		{
			[`poll.votesByUser.${cleanUid}`]: Math.floor(choice)
		}
	);
}

export async function submitChannelForm(
	serverId: string,
	channelId: string,
	messageId: string,
	uid: string,
	answers: string[]
) {
	const cleanServer = trimString(serverId);
	const cleanChannel = trimString(channelId);
	const cleanMessage = trimString(messageId);
	const cleanUid = trimString(uid);
	if (!cleanServer || !cleanChannel || !cleanMessage || !cleanUid) {
		throw new Error('Missing form submission identifiers.');
	}

	const cleanedAnswers = (answers ?? []).map((answer) => trimString(answer) ?? '');

	const db = getDb();
	await updateDoc(
		doc(db, 'servers', cleanServer, 'channels', cleanChannel, 'messages', cleanMessage),
		{
			[`form.responses.${cleanUid}`]: {
				answers: cleanedAnswers,
				submittedAt: serverTimestamp()
			}
		}
	);
}

export type PinnedMessage = {
	id: string;
	messageId: string;
	channelId: string;
	serverId: string;
	pinnedBy: string | null;
	pinnedAt: number | null;
	authorId: string | null;
	authorName: string | null;
	title: string;
	preview: string | null;
	linkUrl: string | null;
	linkKind: string | null;
	messageType: string | null;
	fileName?: string | null;
	fileUrl?: string | null;
	fileContentType?: string | null;
	description?: string | null;
};

function firstUrlFromText(text: Nullable<string>): string | null {
	const value = typeof text === 'string' ? text : '';
	if (!value) return null;
	const match = value.match(/https?:\/\/[^\s<>"')]+/i);
	return match ? match[0].replace(/[),.;]+$/, '') : null;
}

function classifyLinkKind(options: {
	url?: Nullable<string>;
	fileName?: Nullable<string>;
	contentType?: Nullable<string>;
	messageType?: Nullable<string>;
}): string | null {
	const url = trimString(options.url) ?? '';
	const fileName = trimString(options.fileName) ?? '';
	const contentType = trimString(options.contentType) ?? '';
	const type = (options.messageType ?? '').toLowerCase();
	const lowerUrl = url.toLowerCase();
	const lowerName = fileName.toLowerCase();

	if (lowerUrl.includes('meet.google.com')) return 'google_meet';
	if (lowerUrl.includes('zoom.us/')) return 'video_meeting';
	if (lowerUrl.includes('docs.google.com/document')) return 'google_doc';
	if (lowerUrl.includes('docs.google.com/spreadsheets')) return 'google_sheet';
	if (lowerUrl.includes('docs.google.com/presentation')) return 'google_slides';
	if (lowerUrl.includes('docs.google.com/forms') || lowerUrl.includes('forms.gle')) return 'google_form';
	if (lowerUrl.includes('drive.google.com')) return 'google_drive';
	if (lowerUrl.includes('notion.so') || lowerUrl.includes('notion.site')) return 'notion';
	if (lowerUrl.includes('figma.com')) return 'figma';
	if (lowerUrl.includes('microsoft.com') || lowerUrl.includes('office.com') || lowerUrl.includes('sharepoint.com'))
		return 'office';
	if (lowerName.endsWith('.doc') || lowerName.endsWith('.docx')) return 'word_doc';
	if (lowerName.endsWith('.ppt') || lowerName.endsWith('.pptx')) return 'slides';
	if (lowerName.endsWith('.xls') || lowerName.endsWith('.xlsx')) return 'sheet';
	if (lowerName.endsWith('.pdf') || contentType.includes('pdf')) return 'pdf';
	if (lowerName) return 'file';
	if (type === 'gif') return 'gif';
	if (url) return 'link';
	return null;
}

function millisFrom(value: any): number | null {
	if (!value) return null;
	if (typeof value === 'number') return value;
	if (value instanceof Date) return value.getTime();
	if (typeof value?.toMillis === 'function') {
		try {
			return value.toMillis();
		} catch {
			return null;
		}
	}
	return null;
}

function normalizePinnedSnapshot(id: string, raw: Record<string, any>): PinnedMessage {
	const title =
		trimString(raw?.title) ??
		trimString(raw?.preview) ??
		trimString(raw?.text) ??
		trimString(raw?.fileName) ??
		'Pinned message';
	return {
		id,
		messageId: raw?.messageId ?? id,
		channelId: raw?.channelId ?? '',
		serverId: raw?.serverId ?? '',
		pinnedBy: raw?.pinnedBy ?? null,
		pinnedAt: millisFrom(raw?.pinnedAt),
		authorId: raw?.authorId ?? null,
		authorName: raw?.authorName ?? null,
		title,
		preview: trimString(raw?.preview) ?? null,
		linkUrl: trimString(raw?.linkUrl) ?? null,
		linkKind: trimString(raw?.linkKind) ?? null,
		messageType: trimString(raw?.messageType) ?? null,
		fileName: trimString(raw?.fileName) ?? null,
		fileUrl: trimString(raw?.fileUrl) ?? null,
		fileContentType: trimString(raw?.fileContentType) ?? null,
		description: trimString(raw?.description) ?? null
	};
}

export async function pinChannelMessage(
	serverId: string,
	channelId: string,
	message: any,
	uid: string
) {
	const cleanServer = trimString(serverId);
	const cleanChannel = trimString(channelId);
	const cleanMessage = trimString(message?.id ?? message?.messageId ?? message?.mid ?? null);
	const cleanUid = trimString(uid);

	if (!cleanServer || !cleanChannel || !cleanMessage || !cleanUid) {
		throw new Error('Missing identifiers for pinning a message.');
	}

	const text = trimString(message?.text ?? message?.content ?? null) ?? null;
	const file = (message as any)?.file ?? null;
	const fileName = trimString(file?.name) ?? null;
	const fileUrl = trimString(file?.url) ?? null;
	const fileContentType = trimString(file?.contentType) ?? null;
	const primaryUrl = firstUrlFromText(text) ?? trimString(message?.url) ?? fileUrl;

	const authorId = trimString(message?.uid ?? message?.authorId ?? null) ?? null;
	const authorName =
		trimString(message?.displayName) ??
		trimString(message?.authorName) ??
		trimString(message?.author?.displayName) ??
		null;
	const messageType = trimString(message?.type ?? null) ?? 'text';

	const db = getDb();
	await setDoc(
		doc(db, 'servers', cleanServer, 'channels', cleanChannel, 'pinned', cleanMessage),
		{
			messageId: cleanMessage,
			channelId: cleanChannel,
			serverId: cleanServer,
			pinnedBy: cleanUid,
			pinnedAt: serverTimestamp(),
			authorId,
			authorName,
			title: (text ?? fileName ?? 'Pinned message').slice(0, 140),
			preview: (text ?? fileName ?? null)?.slice(0, 280) ?? null,
			linkUrl: primaryUrl ?? null,
			linkKind: classifyLinkKind({
				url: primaryUrl,
				fileName,
				contentType: fileContentType,
				messageType
			}),
			messageType,
			fileName,
			fileUrl,
			fileContentType
		},
		{ merge: true }
	);
}

export async function pinChannelLink(
	serverId: string,
	channelId: string,
	payload: { title?: string; url: string; description?: string | null; uid: string; authorName?: string | null }
) {
	const cleanServer = trimString(serverId);
	const cleanChannel = trimString(channelId);
	const cleanUrl = trimString(payload?.url ?? '');
	const cleanTitle = trimString(payload?.title ?? '') ?? 'Pinned link';
	const cleanUid = trimString(payload?.uid ?? '');
	if (!cleanServer || !cleanChannel || !cleanUrl || !cleanUid) {
		throw new Error('Missing identifiers for pinning a link.');
	}

	const id =
		(typeof crypto !== 'undefined' && (crypto as any)?.randomUUID?.()) ?? `pin_${Date.now()}`;
	const db = getDb();
	await setDoc(
		doc(db, 'servers', cleanServer, 'channels', cleanChannel, 'pinned', id),
		{
			messageId: id,
			channelId: cleanChannel,
			serverId: cleanServer,
			pinnedBy: cleanUid,
			pinnedAt: serverTimestamp(),
			authorId: cleanUid,
			authorName: trimString(payload?.authorName ?? '') ?? null,
			title: cleanTitle.slice(0, 140),
			preview: trimString(payload?.description ?? '')?.slice(0, 280) ?? null,
			linkUrl: cleanUrl,
			linkKind: classifyLinkKind({ url: cleanUrl }),
			messageType: 'link',
			fileName: null,
			fileUrl: null,
			fileContentType: null
		},
		{ merge: true }
	);
}

export async function unpinChannelMessage(serverId: string, channelId: string, messageId: string) {
	const cleanServer = trimString(serverId);
	const cleanChannel = trimString(channelId);
	const cleanMessage = trimString(messageId);
	if (!cleanServer || !cleanChannel || !cleanMessage) {
		throw new Error('Missing identifiers for unpinning a message.');
	}
	const db = getDb();
	const { deleteDoc } = await import('firebase/firestore');
	await deleteDoc(doc(db, 'servers', cleanServer, 'channels', cleanChannel, 'pinned', cleanMessage));
}

export function subscribePinnedMessages(
	serverId: string,
	channelId: string,
	cb: (pins: PinnedMessage[]) => void
): Unsubscribe | null {
	const cleanServer = trimString(serverId);
	const cleanChannel = trimString(channelId);
	if (!cleanServer || !cleanChannel) return null;
	const database = getDb();
	const q = query(
		collection(database, 'servers', cleanServer, 'channels', cleanChannel, 'pinned'),
		orderBy('pinnedAt', 'desc'),
		limit(20)
	);
	return onSnapshot(
		q,
		(snap) => {
			const pins: PinnedMessage[] = [];
			snap.forEach((docSnap) => {
				pins.push(normalizePinnedSnapshot(docSnap.id, docSnap.data() ?? {}));
			});
			cb(pins);
		},
		() => cb([])
	);
}
