import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import {
	collection,
	doc,
	getCountFromServer,
	getDoc,
	getDocs,
	limit,
	orderBy,
	query
} from 'firebase/firestore';

export const load: PageLoad = async () => {
	await ensureFirebaseReady();
	const db = getDb();
	const snapshot = await getDocs(
		query(collection(db, 'servers'), orderBy('createdAt', 'desc'), limit(50))
	);

	const servers = snapshot.docs.map((docSnap) => {
		const data = docSnap.data() as Record<string, any>;
		return {
			id: docSnap.id,
			name: data.name ?? 'Untitled',
			ownerId: data.ownerId ?? data.owner ?? null,
			ownerFallback: data.owner ?? 'unknown',
			createdAt: data.createdAt?.toDate?.() ?? null,
			status: data.archived ? 'archived' : 'active',
			defaultRoleId: data.defaultRoleId ?? null,
			systemChannelId: data.systemChannelId ?? null,
			isPublic: data.isPublic ?? false,
			description: data.description ?? null
		};
	});

	const ownerIds = Array.from(
		new Set(
			servers
				.map((server) => (typeof server.ownerId === 'string' ? server.ownerId : null))
				.filter(Boolean)
		)
	) as string[];

	const ownerProfiles = await Promise.all(
		ownerIds.map(async (ownerId) => {
			const snap = await getDoc(doc(db, 'profiles', ownerId));
			const payload = snap.exists() ? (snap.data() as Record<string, any>) : null;
			return {
				ownerId,
				displayName: payload?.displayName ?? payload?.name ?? null
			};
		})
	);
	const ownerLookup = ownerProfiles.reduce<Record<string, string>>((acc, entry) => {
		if (entry.displayName) acc[entry.ownerId] = entry.displayName;
		return acc;
	}, {});

	const enriched = await Promise.all(
		servers.map(async (server) => {
			const countSnap = await getCountFromServer(collection(db, 'servers', server.id, 'members'));
			return {
				id: server.id,
				name: server.name,
				ownerName: ownerLookup[server.ownerId ?? ''] ?? server.ownerFallback,
				memberCount: countSnap.data().count ?? 0,
				createdAt: server.createdAt,
				status: server.status,
				defaultRoleId: server.defaultRoleId,
				systemChannelId: server.systemChannelId,
				isPublic: server.isPublic,
				description: server.description
			};
		})
	);

	return {
		servers: enriched
	};
};
