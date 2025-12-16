import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';

export const load: PageLoad = async ({ parent, url }) => {
	await ensureFirebaseReady();
	const parentData = await parent();
	const db = getDb();
	const serversSnap = await getDocs(query(collection(db, 'servers'), orderBy('name')));

	return {
		servers: serversSnap.docs.map((docSnap) => {
			const data = docSnap.data() as Record<string, any>;
			return {
				id: docSnap.id,
				name: data.name ?? 'Untitled server'
			};
		}),
		user: parentData.user,
		initialServerId: url.searchParams.get('serverId') ?? null
	};
};
