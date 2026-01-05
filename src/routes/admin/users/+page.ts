import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

export const load: PageLoad = async ({ parent }) => {
	await ensureFirebaseReady();
	const parentData = await parent();
	const db = getDb();
	
	// Fetch all profiles without ordering - Firestore orderBy excludes docs missing the field
	const snapshot = await getDocs(collection(db, 'profiles'));

	// Map and sort on the client side to include users with and without createdAt
	const users = snapshot.docs
		.map((docSnap) => {
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
		})
		.sort((a, b) => {
			// Sort by createdAt descending, nulls last
			if (a.createdAt && b.createdAt) {
				return b.createdAt.getTime() - a.createdAt.getTime();
			}
			if (a.createdAt) return -1;
			if (b.createdAt) return 1;
			// If both null, sort by email
			return (a.email || '').localeCompare(b.email || '');
		});

	return {
		users,
		user: parentData.user,
		superAdmins: parentData.superAdminEmails ?? []
	};
};
