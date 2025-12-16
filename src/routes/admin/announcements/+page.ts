import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';

export type Announcement = {
	id: string;
	title: string;
	message: string;
	type: 'info' | 'warning' | 'success' | 'error';
	active: boolean;
	dismissible: boolean;
	targetAudience: 'all' | 'admins' | 'users';
	createdAt: Date | null;
	updatedAt: Date | null;
	expiresAt: Date | null;
	createdBy: string | null;
};

export const load: PageLoad = async () => {
	await ensureFirebaseReady();
	const database = getDb();

	let announcements: Announcement[] = [];

	try {
		const snap = await getDocs(
			query(collection(database, 'announcements'), orderBy('createdAt', 'desc'), limit(50))
		);

		announcements = snap.docs.map((doc) => {
			const data = doc.data();
			return {
				id: doc.id,
				title: data.title ?? 'Untitled',
				message: data.message ?? '',
				type: data.type ?? 'info',
				active: data.active ?? false,
				dismissible: data.dismissible ?? true,
				targetAudience: data.targetAudience ?? 'all',
				createdAt: data.createdAt?.toDate?.() ?? null,
				updatedAt: data.updatedAt?.toDate?.() ?? null,
				expiresAt: data.expiresAt?.toDate?.() ?? null,
				createdBy: data.createdBy ?? null
			};
		});
	} catch (err) {
		console.error('Failed to load announcements:', err);
	}

	return {
		announcements
	};
};
