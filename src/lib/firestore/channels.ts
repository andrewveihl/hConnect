// src/lib/firestore/channels.ts
import { getDb } from '$lib/firebase';
import { collection, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';

export async function createChannel(
	serverId: string,
	name: string,
	type: 'text' | 'voice' = 'text',
	isPrivate = false,
	allowedRoleIds: string[] = []
) {
	const db = getDb();
	const channelsCol = collection(db, 'servers', serverId, 'channels');

	// compute next position
	const snap = await getDocs(channelsCol);
	let maxPos = -1;
	snap.forEach((d) => {
		const p = (d.data() as any).position ?? 0;
		if (typeof p === 'number' && p > maxPos) maxPos = p;
	});
	const position = maxPos + 1;

	const chRef = doc(channelsCol);
	const uniqueAllowed = Array.from(
		new Set(
			Array.isArray(allowedRoleIds)
				? allowedRoleIds.filter(
						(value): value is string => typeof value === 'string' && value.trim().length > 0
					)
				: []
		)
	);

	const payload =
		type === 'text'
			? {
					id: chRef.id,
					type: 'text',
					name,
					position,
					topic: null,
					isPrivate,
					allowedRoleIds: isPrivate ? uniqueAllowed : [],
					createdAt: serverTimestamp()
				}
			: {
					id: chRef.id,
					type: 'voice',
					name,
					position,
					bitrate: 64000,
					userLimit: null,
					isPrivate,
					allowedRoleIds: isPrivate ? uniqueAllowed : [],
					createdAt: serverTimestamp()
				};

	await setDoc(chRef, payload);
	return chRef.id;
}
