// src/lib/firestore/dms.ts
import { getDb } from '$lib/firebase';
import { resolveProfilePhotoURL } from '$lib/utils/profile';
import {
	addDoc,
	collection,
	doc,
	getDoc,
	getDocs,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
	setDoc,
	updateDoc,
	where,
	limit,
	deleteField,
	runTransaction,
	type Unsubscribe
} from 'firebase/firestore';
import {
	buildMessageDocument,
	type MessageDocument,
	reactionKeyFromEmoji,
	type MessageInput
} from './messages';

/* ===========================
   Types
=========================== */
export type MinimalUser = {
	uid: string;
	displayName?: string; // from profiles.name (fallback displayName)
	name?: string | null;
	photoURL?: string | null;
	authPhotoURL?: string | null;
	email?: string | null;
};

export type DMThread = {
	key: string;
	participants: string[];
	createdAt?: any;
	updatedAt?: any;
	lastMessage?: string | null;
	lastSender?: string | null;
	// Group DM fields
	isGroup?: boolean;
	name?: string | null;
	iconURL?: string | null;
	createdBy?: string | null;
};

export type DMMessage = {
	uid: string; // author uid
	type?: 'text' | 'gif' | 'poll' | 'form';
	text?: string;
	content?: string;
	url?: string;
	poll?: {
		question: string;
		options: string[];
		votesByUser?: Record<string, number>;
	};
	form?: {
		title: string;
		questions: string[];
		responses?: Record<string, { answers: string[]; submittedAt?: any }>;
	};
	reactions?: Record<string, string[]>;
	displayName?: string | null;
	photoURL?: string | null;
	author?: {
		displayName?: string | null;
		photoURL?: string | null;
	};
	createdAt?: any;
};

/* ===========================
   Collection constants
=========================== */
const COL_DMS = 'dms';
const COL_PROFILES = 'profiles';
const SUB_MESSAGES = 'messages';
const SUB_READS = 'reads';
const SUB_DM_RAIL = 'dms'; // profiles/{uid}/dms mapping (like servers rail)

/* ===========================
   Utilities
=========================== */
export function participantsKey(uids: string[]) {
	return [...uids].sort().join('_');
}

function toSortedUnique(uids: any[]): string[] {
	return Array.from(
		new Set(
			uids
				.filter((uid): uid is string => typeof uid === 'string')
				.map((uid) => uid.trim())
				.filter((uid) => uid.length > 0)
		)
	).sort();
}

function resolveParticipantsFromDoc(data: any, fallback: string[]): string[] {
	const fromParticipants = Array.isArray(data?.participants)
		? toSortedUnique(data.participants)
		: [];
	if (fromParticipants.length >= 2) return fromParticipants;

	const fromParticipantUids = Array.isArray(data?.participantUids)
		? toSortedUnique(data.participantUids)
		: [];
	if (fromParticipantUids.length >= 2) return fromParticipantUids;

	const mapSource =
		data?.participantsMap && typeof data.participantsMap === 'object'
			? toSortedUnique(
					Object.keys(data.participantsMap).filter((uid) => data.participantsMap[uid] === true)
				)
			: [];
	if (mapSource.length >= 2) return mapSource;

	const fromKey =
		typeof data?.key === 'string' && data.key.length > 0 ? toSortedUnique(data.key.split('_')) : [];
	if (fromKey.length >= 2) return fromKey;

	return toSortedUnique(fallback);
}

function participantsMatch(existing: any, target: string[]): boolean {
	if (!Array.isArray(existing)) return false;
	const normalized = toSortedUnique(existing);
	if (normalized.length !== target.length) return false;
	for (let i = 0; i < target.length; i += 1) {
		if (normalized[i] !== target[i]) return false;
	}
	return true;
}

async function findThreadIdViaRail(
	actorUid: string | undefined,
	targetUid: string | undefined | null
) {
	const me = (actorUid ?? '').trim();
	const other = (targetUid ?? '').trim();
	if (!me || !other) return null;
	const db = getDb();
	try {
		const snap = await getDocs(
			query(collection(db, COL_PROFILES, me, SUB_DM_RAIL), where('otherUid', '==', other), limit(1))
		);
		if (!snap.empty) {
			const d = snap.docs[0];
			const data = d.data() as any;
			const participants = resolveParticipantsFromDoc(data, [me, other]);
			return { threadId: d.id, participants };
		}
	} catch (err) {
		console.warn('[dms] findThreadIdViaRail failed', { actorUid: me, targetUid: other }, err);
	}
	return null;
}

export async function getProfile(uid: string): Promise<MinimalUser | null> {
	const db = getDb();
	const snap = await getDoc(doc(db, COL_PROFILES, uid));
	if (!snap.exists()) return null;
	const data: any = snap.data();
	return {
		uid: snap.id,
		displayName: data.name ?? data.displayName ?? undefined,
		photoURL: resolveProfilePhotoURL(data),
		authPhotoURL: data.authPhotoURL ?? null,
		email: data.email ?? null
	};
}

// Replace your current streamProfiles with this version:
export function streamProfiles(
	cb: (people: MinimalUser[]) => void,
	opts?: { limitTo?: number }
): Unsubscribe {
	const db = getDb();
	const lim = opts?.limitTo ?? 500;

	// No orderBy — avoids index/field issues if some docs lack "name"
	const ref = collection(db, 'profiles');

	return onSnapshot(
		ref,
		(snap) => {
			let list: MinimalUser[] = snap.docs.map((d) => {
				const data: any = d.data();
				return {
					uid: d.id,
					// show Name: field if present, else displayName, else fallback
					displayName: data.name ?? data.displayName ?? undefined,
					photoURL: resolveProfilePhotoURL(data),
					authPhotoURL: data.authPhotoURL ?? null,
					cachedPhotoURL: data.cachedPhotoURL ?? null,
					email: data.email ?? null
				};
			});

			// Client-side sort by name/displayName, then email, then uid
			list.sort((a, b) => {
				const A = (a.displayName ?? a.email ?? a.uid).toLowerCase();
				const B = (b.displayName ?? b.email ?? b.uid).toLowerCase();
				return A.localeCompare(B);
			});

			// Apply limit if requested
			if (list.length > lim) list = list.slice(0, lim);

			cb(list);
		},
		(err) => {
			console.warn('profiles stream failed', err);
			cb([]);
		}
	);
}

/* ===========================
   Threads & messages
=========================== */
export async function getThread(threadId: string) {
	const db = getDb();
	const snap = await getDoc(doc(db, COL_DMS, threadId));
	return snap.exists() ? { id: snap.id, ...(snap.data() as DMThread) } : null;
}

/** Convenience: deterministic 1:1 thread key and fetch/create. */
export async function getOrCreateDMWith(aUid: string, bUid: string) {
	return getOrCreateDMThread([aUid, bUid]);
}

/** Find a DM thread for exactly these participants, or create it. */
export async function getOrCreateDMThread(uids: string[], actorUid?: string) {
	const normalizedUids = toSortedUnique(uids);
	if (normalizedUids.length < 2) throw new Error('DM needs at least 2 participants');
	const db = getDb();
	const key = participantsKey(normalizedUids);
	const otherUid = normalizedUids.find((uid) => uid !== actorUid) ?? null;

	const toThread = async (docSnap: any, fallbackParticipants: string[]) => {
		const raw = docSnap.data() as DMThread & Record<string, any>;
		const participants = resolveParticipantsFromDoc(raw, fallbackParticipants);
		if (!participantsMatch(raw.participants, participants)) {
			try {
				await updateDoc(docSnap.ref, { participants });
			} catch {}
		}
		const thread = { id: docSnap.id, ...raw, participants } as any;
		if (actorUid) {
			try {
				await upsertDMRailForUid(thread.id, actorUid, participants, thread.lastMessage ?? null);
			} catch {}
		}
		return thread;
	};

	// 1) Try the user's DM rail (fast path, covers legacy docs with custom ids)
	if (actorUid && otherUid) {
		const viaRail = await findThreadIdViaRail(actorUid, otherUid);
		if (viaRail?.threadId) {
			try {
				const snap = await getDoc(doc(db, COL_DMS, viaRail.threadId));
				if (snap.exists()) {
					return await toThread(snap, viaRail.participants ?? normalizedUids);
				}
			} catch (err) {
				console.warn(
					'[dms] getOrCreateDMThread: rail lookup failed',
					{ key, actorUid, otherUid },
					err
				);
			}
		}
	}

	// 2) Create deterministically at doc id == key
	const docRef = doc(db, COL_DMS, key);
	let existingSnap: any | null = null;
	try {
		const snap = await getDoc(docRef);
		if (snap.exists()) {
			existingSnap = snap;
		}
	} catch (err) {
		const code = (err as any)?.code;
		if (code && code !== 'permission-denied') {
			console.warn(
				'[dms] getOrCreateDMThread: initial getDoc failed',
				{ key, normalizedUids, actorUid },
				err
			);
		}
	}

	if (!existingSnap) {
		const payload: DMThread = {
			key,
			participants: normalizedUids,
			createdAt: serverTimestamp(),
			updatedAt: serverTimestamp(),
			lastMessage: null,
			lastSender: null
		};
		try {
			await setDoc(docRef, payload, { merge: false });
		} catch (err) {
			const code = (err as any)?.code;
			if (code && code !== 'permission-denied') {
				console.error(
					'[dms] getOrCreateDMThread: setDoc failed',
					{ key, normalizedUids, actorUid },
					err
				);
				throw err;
			}
		}
		if (!existingSnap) {
			try {
				const snap = await getDoc(docRef);
				if (snap.exists()) existingSnap = snap;
			} catch (err) {
				console.error(
					'[dms] getOrCreateDMThread: fetch after create failed',
					{ key, normalizedUids, actorUid },
					err
				);
				throw err;
			}
		}
	}

	if (existingSnap?.exists()) {
		return await toThread(existingSnap, normalizedUids);
	}

	if (!existingSnap?.exists()) {
		throw new Error('Failed to create DM thread');
	}

	return await toThread(existingSnap, normalizedUids);
}

/** Create a group DM with 3+ participants. Returns the new thread. */
export async function createGroupDM(
	uids: string[],
	creatorUid: string,
	groupName?: string
): Promise<DMThread & { id: string }> {
	const normalizedUids = toSortedUnique(uids);
	if (normalizedUids.length < 3) {
		throw new Error('Group DM requires at least 3 participants');
	}
	if (!creatorUid || !normalizedUids.includes(creatorUid)) {
		throw new Error('Creator must be a participant');
	}

	const db = getDb();
	// For groups, we generate a unique ID instead of using participant key
	const groupsCol = collection(db, COL_DMS);
	
	const payload: DMThread = {
		key: participantsKey(normalizedUids),
		participants: normalizedUids,
		createdAt: serverTimestamp(),
		updatedAt: serverTimestamp(),
		lastMessage: null,
		lastSender: null,
		isGroup: true,
		name: groupName?.trim() || null,
		iconURL: null,
		createdBy: creatorUid
	};

	const docRef = await addDoc(groupsCol, payload);
	
	// Update rail for all participants
	try {
		await upsertDMRailForParticipants(docRef.id, normalizedUids, null, { isGroup: true, name: groupName?.trim() || null });
	} catch (err) {
		console.warn('[dms] createGroupDM: failed to update rail for participants', err);
	}

	return {
		id: docRef.id,
		...payload,
		createdAt: new Date(),
		updatedAt: new Date()
	};
}

/** Update group DM settings (name, icon). */
export async function updateGroupDM(
	threadId: string,
	updates: { name?: string | null; iconURL?: string | null }
): Promise<void> {
	const cleanThreadId = trimValue(threadId);
	if (!cleanThreadId) throw new Error('Missing thread ID');

	const db = getDb();
	const tRef = doc(db, COL_DMS, cleanThreadId);
	
	const updateData: Record<string, any> = {
		updatedAt: serverTimestamp()
	};
	
	if ('name' in updates) {
		updateData.name = updates.name?.trim() || null;
	}
	if ('iconURL' in updates) {
		updateData.iconURL = updates.iconURL || null;
	}

	await updateDoc(tRef, updateData);
}

/** Add a participant to a group DM. */
export async function addGroupDMParticipant(
	threadId: string,
	newParticipantUid: string,
	actorUid: string
): Promise<void> {
	const cleanThreadId = trimValue(threadId);
	const cleanNewUid = trimValue(newParticipantUid);
	if (!cleanThreadId || !cleanNewUid) throw new Error('Missing identifiers');

	const db = getDb();
	const tRef = doc(db, COL_DMS, cleanThreadId);
	const tSnap = await getDoc(tRef);
	
	if (!tSnap.exists()) throw new Error('Thread not found');
	
	const data = tSnap.data() as DMThread;
	if (!data.isGroup) throw new Error('Cannot add participants to a 1:1 DM');
	
	const currentParticipants = data.participants ?? [];
	if (currentParticipants.includes(cleanNewUid)) {
		return; // Already a participant
	}
	
	const newParticipants = toSortedUnique([...currentParticipants, cleanNewUid]);
	
	await updateDoc(tRef, {
		participants: newParticipants,
		key: participantsKey(newParticipants),
		updatedAt: serverTimestamp()
	});

	// Update rail for the new participant
	try {
		await upsertDMRailForUid(cleanThreadId, cleanNewUid, newParticipants, data.lastMessage ?? null);
	} catch {}
}

/** Remove a participant from a group DM (leave group). */
export async function leaveGroupDM(
	threadId: string,
	participantUid: string
): Promise<void> {
	const cleanThreadId = trimValue(threadId);
	const cleanUid = trimValue(participantUid);
	if (!cleanThreadId || !cleanUid) throw new Error('Missing identifiers');

	const db = getDb();
	const tRef = doc(db, COL_DMS, cleanThreadId);
	const tSnap = await getDoc(tRef);
	
	if (!tSnap.exists()) throw new Error('Thread not found');
	
	const data = tSnap.data() as DMThread;
	if (!data.isGroup) throw new Error('Cannot leave a 1:1 DM');
	
	const currentParticipants = data.participants ?? [];
	const newParticipants = currentParticipants.filter(uid => uid !== cleanUid);
	
	if (newParticipants.length < 2) {
		throw new Error('Cannot leave group - at least 2 participants required');
	}
	
	await updateDoc(tRef, {
		participants: newParticipants,
		key: participantsKey(newParticipants),
		updatedAt: serverTimestamp()
	});

	// Remove from user's rail
	try {
		await deleteDMRailForUid(cleanThreadId, cleanUid);
	} catch {}
}

/** Delete a DM rail entry for a specific user */
async function deleteDMRailForUid(threadId: string, uid: string): Promise<void> {
	const db = getDb();
	const railRef = doc(db, COL_PROFILES, uid, SUB_DM_RAIL, threadId);
	try {
		await updateDoc(railRef, { deleted: true });
	} catch {}
}

/** Send a DM message into a thread (updates thread meta). */
const THREAD_SUMMARY_MAX = 120;

function trimValue(value: string | null | undefined) {
	if (typeof value !== 'string') return '';
	const next = value.trim();
	return next.length ? next : '';
}

function summarizeMessageForThread(payload: MessageInput): string {
	const type = payload.type ?? 'text';

	if (type === 'gif') {
		return 'sent a GIF';
	}

	if (type === 'file' && 'file' in payload) {
		const name = trimValue(payload.file?.name ?? payload.file?.url);
		return name ? `shared a file: ${name}` : 'shared a file';
	}

	if (type === 'poll' && 'poll' in payload) {
		const question = trimValue(payload.poll?.question);
		return question ? `created a poll: ${question}` : 'created a poll';
	}

	if (type === 'form' && 'form' in payload) {
		const title = trimValue(payload.form?.title);
		return title ? `shared a form: ${title}` : 'shared a form';
	}

	const text = trimValue('text' in payload ? payload.text : undefined);
	if (!text) return 'sent a message';
	return text.length > THREAD_SUMMARY_MAX ? `${text.slice(0, THREAD_SUMMARY_MAX - 1)}…` : text;
}

export async function sendDMMessage(threadId: string, payload: MessageInput) {
	const cleanThreadId = trimValue(threadId);
	if (!cleanThreadId) throw new Error('Missing DM thread id.');

	const db = getDb();
	const messagesCol = collection(db, COL_DMS, cleanThreadId, SUB_MESSAGES);
	const baseDoc = buildMessageDocument(payload);
	const docData: MessageDocument & { dmId: string } = {
		...baseDoc,
		dmId: cleanThreadId
	};

	await addDoc(messagesCol, docData);

	const summary = summarizeMessageForThread(payload);

	// bump thread meta
	const tRef = doc(db, COL_DMS, cleanThreadId);
	const tSnap = await getDoc(tRef);
	const threadData: any = tSnap.exists() ? tSnap.data() : null;
	const participants: string[] = threadData?.participants ?? [];
	const resets: Record<string, any> = {};
	for (const participant of participants) {
		resets[`deletedFor.${participant}`] = deleteField();
	}

	await updateDoc(tRef, {
		updatedAt: serverTimestamp(),
		lastMessage: summary,
		lastType: payload.type ?? 'text',
		lastSender: payload.uid,
		...resets
	});

	// Update rail mapping for all participants so new DMs appear (and refresh metadata)
	try {
		const threadMeta = threadData ? { isGroup: threadData.isGroup ?? false, name: threadData.name ?? null } : undefined;
		await upsertDMRailForParticipants(cleanThreadId, participants, summary, threadMeta);
	} catch {}
}

/** Live messages for a thread (ascending). */
export async function toggleDMReaction(
	threadId: string,
	messageId: string,
	uid: string,
	emoji: string
) {
	const cleanThreadId = trimValue(threadId);
	const cleanMessage = trimValue(messageId);
	const cleanUid = trimValue(uid);
	const symbol = trimValue(emoji);
	if (!cleanThreadId || !cleanMessage || !cleanUid || !symbol) {
		throw new Error('Missing reaction identifiers.');
	}

	const key = reactionKeyFromEmoji(symbol);
	const db = getDb();
	const messageRef = doc(db, COL_DMS, cleanThreadId, SUB_MESSAGES, cleanMessage);

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

export async function voteOnDMPoll(
	threadId: string,
	messageId: string,
	uid: string,
	optionIndex: number
) {
	const cleanThreadId = trimValue(threadId);
	const cleanMessage = trimValue(messageId);
	const cleanUid = trimValue(uid);
	if (!cleanThreadId || !cleanMessage || !cleanUid) {
		throw new Error('Missing poll vote identifiers.');
	}
	const choice = Number(optionIndex);
	if (!Number.isFinite(choice) || choice < 0) {
		throw new Error('Invalid poll option index.');
	}
	const db = getDb();
	await updateDoc(doc(db, COL_DMS, cleanThreadId, SUB_MESSAGES, cleanMessage), {
		[`poll.votesByUser.${cleanUid}`]: Math.floor(choice)
	});
}

export async function submitDMForm(
	threadId: string,
	messageId: string,
	uid: string,
	answers: string[]
) {
	const cleanThreadId = trimValue(threadId);
	const cleanMessage = trimValue(messageId);
	const cleanUid = trimValue(uid);
	if (!cleanThreadId || !cleanMessage || !cleanUid) {
		throw new Error('Missing form submission identifiers.');
	}
	const sanitized = (answers ?? []).map((ans) => trimValue(ans));
	const db = getDb();
	await updateDoc(doc(db, COL_DMS, cleanThreadId, SUB_MESSAGES, cleanMessage), {
		[`form.responses.${cleanUid}`]: {
			answers: sanitized,
			submittedAt: serverTimestamp()
		}
	});
}

export function streamDMMessages(threadId: string, cb: (msgs: any[]) => void): Unsubscribe {
	const db = getDb();
	const q1 = query(collection(db, COL_DMS, threadId, SUB_MESSAGES), orderBy('createdAt', 'asc'));
	return onSnapshot(q1, (snap) => {
		cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
	});
}

/** Live list of my threads (most recent first). */
export function streamMyThreads(uid: string, cb: (threads: any[]) => void): Unsubscribe {
	const db = getDb();
	const q1 = query(
		collection(db, COL_DMS),
		where('participants', 'array-contains', uid),
		orderBy('updatedAt', 'desc')
	);
	return onSnapshot(q1, (snap) => {
		const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
		cb(rows.filter((row) => !row?.deletedFor?.[uid]));
	});
}

export async function deleteThreadForUser(threadId: string, uid: string) {
	const db = getDb();
	const ref = doc(db, COL_DMS, threadId);
	await updateDoc(ref, { [`deletedFor.${uid}`]: serverTimestamp() });
	// Remove from user rail list
	try {
		await setDoc(
			doc(db, COL_PROFILES, uid, SUB_DM_RAIL, threadId),
			{ hidden: true, updatedAt: serverTimestamp() },
			{ merge: true }
		);
	} catch {}
}

/* ===========================
   Unread / notifications
=========================== */
export async function markThreadRead(
	threadId: string,
	uid: string,
	opts?: { at?: any; lastMessageId?: string | null }
) {
	const db = getDb();
	const rRef = doc(db, COL_DMS, threadId, SUB_READS, uid);
	await setDoc(
		rRef,
		{
			lastReadAt: opts?.at ?? serverTimestamp(),
			lastReadMessageId: opts?.lastMessageId ?? null
		},
		{ merge: true }
	);
}

/**
 * Live unread count for a thread for a given user.
 * Counts messages where createdAt > lastReadAt.
 * If there's no read doc, counts all messages.
 *
 * NOTE: use orderBy('createdAt') with the inequality filter for correctness.
 */
export function streamUnreadCount(
	threadId: string,
	uid: string,
	cb: (n: number) => void
): Unsubscribe {
	const db = getDb();
	const readDocRef = doc(db, COL_DMS, threadId, SUB_READS, uid);

	let stopMsgs: Unsubscribe | undefined;
	let lastEmittedCount: number | null = null;

	const isOtherMessage = (data: any) => {
		const author =
			(typeof data?.uid === 'string' && data.uid.trim()) ||
			(typeof data?.authorId === 'string' && data.authorId.trim()) ||
			null;
		return !author || author !== uid;
	};

	const stopRead = onSnapshot(readDocRef, (readSnap) => {
		const lastReadAt = readSnap.exists() ? ((readSnap.data() as any)?.lastReadAt ?? null) : null;

		// re-wire messages listener
		stopMsgs?.();
		const base = collection(db, COL_DMS, threadId, SUB_MESSAGES);

		if (lastReadAt) {
			const qNew = query(base, where('createdAt', '>', lastReadAt), orderBy('createdAt', 'asc'));
			stopMsgs = onSnapshot(qNew, (s) => {
				let count = 0;
				s.forEach((docSnap) => {
					if (isOtherMessage(docSnap.data())) count += 1;
				});
				// Only emit if count changed
				if (lastEmittedCount !== count) {
					lastEmittedCount = count;
					cb(count);
				}
			});
		} else {
			const qAll = query(base); // first-time: "all unread"
			stopMsgs = onSnapshot(qAll, (s) => {
				let count = 0;
				s.forEach((docSnap) => {
					if (isOtherMessage(docSnap.data())) count += 1;
				});
				// Only emit if count changed
				if (lastEmittedCount !== count) {
					lastEmittedCount = count;
					cb(count);
				}
			});
		}
	});

	return () => {
		stopRead?.();
		stopMsgs?.();
	};
}

/* ===========================
   DM rail mapping (per-user list)
=========================== */

async function upsertDMRailForParticipants(
	threadId: string,
	participants: string[],
	lastMessage: string | null,
	threadMeta?: { isGroup?: boolean; name?: string | null }
) {
	await Promise.all(
		participants.map((uid) => upsertDMRailForUid(threadId, uid, participants, lastMessage, threadMeta))
	);
}

// Safer variant: only write mapping for a single user (avoids cross-user writes blocked by rules)
async function upsertDMRailForUid(
	threadId: string,
	uid: string,
	participants: string[],
	lastMessage: string | null,
	threadMeta?: { isGroup?: boolean; name?: string | null }
) {
	const db = getDb();
	const now = serverTimestamp();
	const others = participants.filter((p) => p !== uid);
	const otherUid = others.length === 1 ? others[0] : null;
	const isGroup = threadMeta?.isGroup ?? participants.length > 2;
	const payload: Record<string, any> = {
		threadId,
		otherUid,
		participants,
		lastMessage: lastMessage ?? null,
		hidden: false,
		updatedAt: now,
		isGroup,
		groupName: isGroup ? (threadMeta?.name ?? null) : null
	};
	if (otherUid && !isGroup) {
		try {
			const profSnap = await getDoc(doc(db, COL_PROFILES, otherUid));
			if (profSnap.exists()) {
				const data: any = profSnap.data() ?? {};
				const name = data.name ?? data.displayName ?? null;
				const email = data.email ?? null;
				const photoURL = resolveProfilePhotoURL(data);
				if (name) payload.otherDisplayName = name;
				if (email) payload.otherEmail = email;
				if (photoURL !== undefined) payload.otherPhotoURL = photoURL;
			}
		} catch {}
	}
	await setDoc(doc(db, COL_PROFILES, uid, SUB_DM_RAIL, threadId), payload, { merge: true });
}

/**
 * Subscribe to my DM rail list (profiles/{uid}/dms), ordered by updatedAt desc.
 */
export function streamMyDMs(
	uid: string,
	cb: (
		rows: Array<{
			id: string;
			participants: string[];
			otherUid: string | null;
			lastMessage?: string | null;
			updatedAt?: any;
			hidden?: boolean;
			isGroup?: boolean;
			groupName?: string | null;
		}>
	) => void
): Unsubscribe {
	const db = getDb();
	const q1 = query(collection(db, COL_PROFILES, uid, SUB_DM_RAIL), orderBy('updatedAt', 'desc'));
	return onSnapshot(q1, (snap) => {
		const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
		cb(rows.filter((r) => !r.hidden));
	});
}

export function streamThreadMeta(
	threadId: string,
	cb: (meta: {
		lastMessage: string | null;
		lastSender: string | null;
		updatedAt: any | null;
	}) => void
): Unsubscribe {
	const db = getDb();
	const ref = doc(db, COL_DMS, threadId);
	return onSnapshot(ref, (snap) => {
		if (!snap.exists()) {
			cb({ lastMessage: null, lastSender: null, updatedAt: null });
			return;
		}
		const data: any = snap.data() ?? {};
		cb({
			lastMessage: data.lastMessage ?? null,
			lastSender: data.lastSender ?? null,
			updatedAt: data.updatedAt ?? null
		});
	});
}

/** Best-effort backfill to ensure existing threads appear in the rail. */
export async function seedDMRailFromThreads(uid: string, { limitTo = 50 } = {}) {
	const db = getDb();
	try {
		// Avoid composite index by not ordering; sort client-side
		const q1 = query(
			collection(db, COL_DMS),
			where('participants', 'array-contains', uid),
			limit(limitTo)
		);
		const snap = await getDocs(q1);
		for (const d of snap.docs) {
			const data = d.data() as any;
			const threadMeta = { isGroup: data.isGroup ?? false, name: data.name ?? null };
			await upsertDMRailForParticipants(d.id, data.participants ?? [], data.lastMessage ?? null, threadMeta);
		}
	} catch {
		// ignore (index may be missing; optional convenience)
	}
}

/**
 * Fallback live stream of my DMs without orderBy to avoid index requirements.
 * Client-sorts by updatedAt and filters deletedFor.
 */
export function streamMyThreadsLoose(uid: string, cb: (threads: any[]) => void): Unsubscribe {
	const db = getDb();
	const q1 = query(collection(db, COL_DMS), where('participants', 'array-contains', uid));
	return onSnapshot(q1, (snap) => {
		const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
		const filtered = rows.filter((row) => !row?.deletedFor?.[uid]);
		filtered.sort((a, b) => {
			const A =
				(a.updatedAt?.toMillis?.() ? a.updatedAt.toMillis() : +new Date(a.updatedAt ?? 0)) || 0;
			const B =
				(b.updatedAt?.toMillis?.() ? b.updatedAt.toMillis() : +new Date(b.updatedAt ?? 0)) || 0;
			return B - A;
		});
		cb(filtered);
	});
}

/* ===========================
   People search (profiles)
=========================== */
/**
 * Search people by name in `profiles`.
 * Prefers `nameLower` prefix if present, then exact `name`,
 * then exact `displayName`, finally optional prefix on `name`.
 */
export async function searchUsersByName(term: string, { limitTo = 25 } = {}) {
	const db = getDb();
	const results: MinimalUser[] = [];
	const seen = new Set<string>();
	const termLower = term.toLowerCase();

	const push = (id: string, data: any) => {
		if (seen.has(id)) return;
		seen.add(id);
		results.push({
			uid: id,
			displayName: data.name ?? data.displayName ?? undefined,
			photoURL: resolveProfilePhotoURL(data),
			authPhotoURL: data.authPhotoURL ?? null,
			email: data.email ?? null
		});
	};

	const base = collection(db, COL_PROFILES);

	// 1) nameLower prefix (best)
	try {
		const qLower = query(
			base,
			where('nameLower', '>=', termLower),
			where('nameLower', '<=', termLower + '\uf8ff'),
			limit(limitTo)
		);
		const sLower = await getDocs(qLower);
		sLower.forEach((d) => push(d.id, d.data()));
		if (results.length) return results;
	} catch {}

	// 2) exact name
	try {
		const qEqName = query(base, where('name', '==', term), limit(limitTo));
		const sEqName = await getDocs(qEqName);
		sEqName.forEach((d) => push(d.id, d.data()));
		if (results.length) return results;
	} catch {}

	// 3) exact displayName (legacy)
	try {
		const qEqDisplay = query(base, where('displayName', '==', term), limit(limitTo));
		const sEqDisplay = await getDocs(qEqDisplay);
		sEqDisplay.forEach((d) => push(d.id, d.data()));
		if (results.length) return results;
	} catch {}

	// 4) optional prefix on name (requires index)
	try {
		const qRange = query(
			base,
			where('name', '>=', term),
			where('name', '<=', term + '\uf8ff'),
			limit(limitTo)
		);
		const sRange = await getDocs(qRange);
		sRange.forEach((d) => push(d.id, d.data()));
	} catch {}

	return results;
}

/**
 * Trigger a server-side backfill of the user's DM rail.
 * This is a cloud function that will find all DM threads the user
 * participates in and ensure they appear in their sidebar.
 * Useful for recovering "missing" conversations.
 */
export async function triggerDMRailBackfill(): Promise<{ ok: boolean; updated: number; total: number }> {
	const { getFunctions, httpsCallable } = await import('firebase/functions');
	const functions = getFunctions();
	const backfill = httpsCallable(functions, 'backfillMyDMRail');
	const result = await backfill();
	return result.data as { ok: boolean; updated: number; total: number };
}
