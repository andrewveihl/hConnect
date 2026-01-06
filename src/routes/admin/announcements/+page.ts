import type { PageLoad } from './$types';
import { ensureFirebaseReady, getDb } from '$lib/firebase';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';

export type AnnouncementCategory = 'update' | 'feature' | 'maintenance' | 'security' | 'general';

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
	scheduledAt: Date | null; // When to start showing the announcement
	createdBy: string | null;
	// New fields for app updates
	category: AnnouncementCategory;
	version: string | null; // App version this announcement relates to
	features: string[]; // List of features/changes for AI to describe
	aiGenerated: boolean; // Whether the content was AI-generated
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
				scheduledAt: data.scheduledAt?.toDate?.() ?? null,
				createdBy: data.createdBy ?? null,
				category: data.category ?? 'general',
				version: data.version ?? null,
				features: Array.isArray(data.features) ? data.features : [],
				aiGenerated: data.aiGenerated ?? false
			};
		});
	} catch (err) {
		console.error('Failed to load announcements:', err);
	}

	return {
		announcements
	};
};
