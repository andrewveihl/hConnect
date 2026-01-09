import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import type { AnnouncementDisplay } from '$lib/components/app/AnnouncementModal.svelte';
import { user } from '$lib/stores/user';
import { superAdminEmailsStore } from '$lib/admin/superAdmin';

const DISMISSED_ANNOUNCEMENTS_KEY = 'hconnect:dismissed-announcements';

export type StoredAnnouncement = {
	id: string;
	title: string;
	message: string;
	type: 'info' | 'warning' | 'success' | 'error';
	category: 'update' | 'feature' | 'maintenance' | 'security' | 'general';
	version: string | null;
	dismissible: boolean;
	active: boolean;
	targetAudience: 'all' | 'admins' | 'users';
	scheduledAt: Date | null;
	expiresAt: Date | null;
};

// Store for all active announcements
export const announcements = writable<StoredAnnouncement[]>([]);

// Store for dismissed announcement IDs (persisted per user)
export const dismissedAnnouncementIds = writable<Set<string>>(new Set());
const seenAnnouncementCache = new Set<string>();

// Derived store for the next unread announcement to show
export const nextAnnouncement = derived(
	[announcements, dismissedAnnouncementIds],
	([$announcements, $dismissed]) => {
		const now = new Date();
		
		// Find the first active, non-dismissed announcement that's scheduled to show
		const eligible = $announcements.filter((a) => {
			if (!a.active) return false;
			if ($dismissed.has(a.id)) return false;
			if (a.scheduledAt && a.scheduledAt > now) return false;
			if (a.expiresAt && a.expiresAt < now) return false;
			return true;
		});

		// Sort by most recent first
		eligible.sort((a, b) => {
			const aTime = a.scheduledAt?.getTime() ?? 0;
			const bTime = b.scheduledAt?.getTime() ?? 0;
			return bTime - aTime;
		});

		return eligible[0] ?? null;
	}
);

// Load dismissed announcements from localStorage
export function loadDismissedAnnouncements(userId: string): void {
	if (!browser) return;
	
	try {
		const key = `${DISMISSED_ANNOUNCEMENTS_KEY}:${userId}`;
		const raw = localStorage.getItem(key);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				dismissedAnnouncementIds.set(new Set(parsed.filter((id) => typeof id === 'string')));
				return;
			}
		}
	} catch (e) {
		console.warn('Failed to load dismissed announcements:', e);
	}
	dismissedAnnouncementIds.set(new Set());
}

// Save dismissed announcements to localStorage
function saveDismissedAnnouncements(userId: string, dismissed: Set<string>): void {
	if (!browser) return;
	
	try {
		const key = `${DISMISSED_ANNOUNCEMENTS_KEY}:${userId}`;
		localStorage.setItem(key, JSON.stringify(Array.from(dismissed)));
	} catch (e) {
		console.warn('Failed to save dismissed announcements:', e);
	}
}

// Dismiss an announcement
export function dismissAnnouncement(announcementId: string, userId: string): void {
	dismissedAnnouncementIds.update((current) => {
		const next = new Set(current);
		next.add(announcementId);
		saveDismissedAnnouncements(userId, next);
		return next;
	});
}

export async function markAnnouncementSeen(params: {
	announcementId: string;
	uid: string;
	email?: string | null;
	displayName?: string | null;
	photoURL?: string | null;
}): Promise<void> {
	if (!browser) return;
	if (!params.announcementId || !params.uid) return;

	const cacheKey = `${params.announcementId}:${params.uid}`;
	if (seenAnnouncementCache.has(cacheKey)) return;

	try {
		const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
		const { ensureFirebaseReady, getDb } = await import('$lib/firebase');

		await ensureFirebaseReady();
		const db = getDb();
		const viewRef = doc(db, 'announcements', params.announcementId, 'views', params.uid);

		await setDoc(
			viewRef,
			{
				uid: params.uid,
				email: params.email ?? null,
				displayName: params.displayName ?? null,
				photoURL: params.photoURL ?? null,
				seenAt: serverTimestamp()
			},
			{ merge: true }
		);

		seenAnnouncementCache.add(cacheKey);
	} catch (e) {
		console.warn('Failed to mark announcement seen:', e);
	}
}

// Subscribe to active announcements from Firestore
let unsubscribeAnnouncements: (() => void) | null = null;

export async function startAnnouncementListener(): Promise<() => void> {
	if (!browser) return () => {};
	
	// Clean up existing subscription
	if (unsubscribeAnnouncements) {
		unsubscribeAnnouncements();
		unsubscribeAnnouncements = null;
	}
	
	try {
		const { collection, query, where, onSnapshot } = await import('firebase/firestore');
		const { ensureFirebaseReady, getDb } = await import('$lib/firebase');
		
		await ensureFirebaseReady();
		const db = getDb();

		const superAdminEmails = superAdminEmailsStore();
		let adminAllowList: string[] = [];
		let currentUserEmail: string | null = null;
		const stopSuperAdminEmails = superAdminEmails.subscribe((list) => {
			adminAllowList = Array.isArray(list)
				? list
						.filter((email) => typeof email === 'string')
						.map((email) => email.toLowerCase())
				: [];
		});
		const stopUserListener = user.subscribe((value) => {
			currentUserEmail = value?.email?.toLowerCase() ?? null;
		});
		
		// Query for active announcements (audience is filtered client-side)
		const q = query(collection(db, 'announcements'), where('active', '==', true));
		
		unsubscribeAnnouncements = onSnapshot(q, (snapshot) => {
			const results: StoredAnnouncement[] = [];
			const isSuperAdmin =
				Boolean(currentUserEmail) && adminAllowList.includes(currentUserEmail as string);
			
			snapshot.docs.forEach((doc) => {
				const data = doc.data();
				const scheduledAt = data.scheduledAt?.toDate?.() ?? null;
				const expiresAt = data.expiresAt?.toDate?.() ?? null;
				
				// Filter by target audience for this user
				const audience = data.targetAudience ?? 'all';
				if (audience === 'admins' && !isSuperAdmin) return;
				if (audience === 'users' && isSuperAdmin) return;
				
				results.push({
					id: doc.id,
					title: data.title ?? 'Untitled',
					message: data.message ?? '',
					type: data.type ?? 'info',
					category: data.category ?? 'general',
					version: data.version ?? null,
					dismissible: data.dismissible ?? true,
					active: data.active ?? false,
					targetAudience: audience,
					scheduledAt,
					expiresAt
				});
			});
			
			announcements.set(results);
		}, (error) => {
			console.error('Failed to subscribe to announcements:', error);
		});

		return () => {
			if (unsubscribeAnnouncements) {
				unsubscribeAnnouncements();
				unsubscribeAnnouncements = null;
			}
			stopSuperAdminEmails();
			stopUserListener();
		};
	} catch (e) {
		console.error('Failed to start announcement listener:', e);
		return () => {};
	}
}

// Convert stored announcement to display format
export function toDisplayAnnouncement(stored: StoredAnnouncement): AnnouncementDisplay {
	return {
		id: stored.id,
		title: stored.title,
		message: stored.message,
		type: stored.type,
		category: stored.category,
		version: stored.version,
		dismissible: stored.dismissible
	};
}
