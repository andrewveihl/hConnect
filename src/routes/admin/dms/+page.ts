import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';

const resolveParticipants = (data: Record<string, any>): string[] => {
	if (Array.isArray(data.participants) && data.participants.length > 0) return data.participants;
	if (Array.isArray(data.participantUids) && data.participantUids.length > 0)
		return data.participantUids;
	if (data.key) return String(data.key).split('_');
	return [];
};

export const load: PageLoad = async ({ parent }) => {
	await ensureFirebaseReady();
	const parentData = await parent();
	const db = getDb();
	const snapshot = await getDocs(
		query(collection(db, 'dms'), orderBy('updatedAt', 'desc'), limit(50))
	);

	const rawThreads = snapshot.docs.map((docSnap) => {
		const payload = docSnap.data() as Record<string, any>;
		return {
			id: docSnap.id,
			participants: resolveParticipants(payload),
			lastMessage: payload.lastMessage ?? '',
			lastSender: payload.lastSender ?? null,
			updatedAt: payload.updatedAt?.toDate?.() ?? payload.createdAt?.toDate?.() ?? null,
			messageCount: payload.messageCount ?? null
		};
	});

	const participantIds = Array.from(new Set(rawThreads.flatMap((thread) => thread.participants)));

	const profiles = await Promise.all(
		participantIds.map(async (uid) => {
			const snap = await getDoc(doc(db, 'profiles', uid));
			const payload = snap.exists() ? (snap.data() as Record<string, any>) : null;
			return { uid, displayName: payload?.displayName ?? payload?.name ?? null };
		})
	);

	const profileLookup = profiles.reduce<Record<string, string>>((acc, profile) => {
		if (profile.displayName) acc[profile.uid] = profile.displayName;
		return acc;
	}, {});
	const friendlyLabel = (uid: string) => profileLookup[uid] ?? `User ${uid.slice(0, 6)}…`;

	return {
		threads: rawThreads.map((thread) => ({
			...thread,
			participantLabels: thread.participants.map((uid) => friendlyLabel(uid))
		})),
		user: parentData.user,
		profileLookup
	};
};
