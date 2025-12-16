import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';

export const load: PageLoad = async ({ parent }) => {
	await ensureFirebaseReady();
	const parentData = await parent();
	const db = getDb();
	const snapshot = await getDocs(
		query(collection(db, 'profiles'), orderBy('createdAt', 'desc'), limit(120))
	);

	return {
		users: snapshot.docs.map((docSnap) => {
			const data = docSnap.data() as Record<string, any>;
			return {
				uid: docSnap.id,
				displayName: data.name ?? data.displayName ?? '',
				email: data.email ?? '',
				photoURL: data.customPhotoURL ?? data.authPhotoURL ?? data.photoURL ?? null,
				hasCustomPhoto: !!data.customPhotoURL,
				createdAt: data.createdAt?.toDate?.() ?? null,
				lastSeen: data.updatedAt?.toDate?.() ?? null,
				roles: data.roles ?? [],
				banned: data.status?.banned ?? false
			};
		}),
		user: parentData.user,
		superAdmins: parentData.superAdminEmails ?? []
	};
};
