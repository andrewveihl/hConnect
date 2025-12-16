import { ensureFirebaseReady, getDb } from '$lib/firebase';
import {
	collection,
	deleteDoc,
	doc,
	getDocs,
	limit,
	orderBy,
	query,
	runTransaction,
	serverTimestamp
} from 'firebase/firestore';
import type { ArchiveTab } from './types';
import { logAdminAction } from './logs';
import type { User } from 'firebase/auth';

const COLLECTION_MAP: Record<ArchiveTab, string> = {
	servers: 'archivedServers',
	channels: 'archivedChannels',
	messages: 'archivedMessages',
	dms: 'archivedDMs',
	attachments: 'archivedAttachments'
};

export type ArchiveEntry = {
	id: string;
	entityId?: string;
	originalPath?: string;
	snapshot?: Record<string, unknown>;
	reason?: string | null;
	createdAt?: Date | null;
	deletedBy?: { uid?: string; email?: string | null } | null;
};

const toArchiveEntry = (docSnap: any): ArchiveEntry => {
	const data = docSnap.data() ?? {};
	return {
		id: docSnap.id,
		entityId: data.entityId ?? data.originalId ?? null,
		originalPath: data.originalPath ?? null,
		snapshot: data.snapshot ?? data.payload ?? null,
		reason: data.reason ?? null,
		createdAt: data.createdAt?.toDate?.() ?? null,
		deletedBy: data.deletedBy ?? null
	};
};

export async function fetchArchiveEntries(tab: ArchiveTab, limitSize = 50) {
	await ensureFirebaseReady();
	const db = getDb();
	const snapshot = await getDocs(
		query(collection(db, COLLECTION_MAP[tab]), orderBy('createdAt', 'desc'), limit(limitSize))
	);
	return snapshot.docs.map(toArchiveEntry);
}

export async function restoreArchiveEntry(tab: ArchiveTab, id: string, actor: User) {
	await ensureFirebaseReady();
	const db = getDb();

	await runTransaction(db, async (trx) => {
		const archiveRef = doc(db, COLLECTION_MAP[tab], id);
		const archiveSnap = await trx.get(archiveRef);
		if (!archiveSnap.exists()) throw new Error('Archive entry not found');
		const data = archiveSnap.data() ?? {};
		const targetPath: string | undefined = data.originalPath;
		if (!targetPath) throw new Error('Archived entry missing originalPath');
		const payload = data.snapshot ?? data.payload ?? {};

		const segments = targetPath.split('/').filter(Boolean);
		if (segments.length % 2 !== 0) throw new Error('Invalid originalPath segment count');

		const targetRef = doc(db, segments.join('/'));
		trx.set(
			targetRef,
			{
				...payload,
				restoredAt: serverTimestamp(),
				deletedAt: null
			},
			{ merge: true }
		);
		trx.delete(archiveRef);
	});

	await logAdminAction({
		type: 'adminAction',
		level: 'info',
		message: `Restored archived ${tab} ${id}`,
		data: {
			action: 'archive:restore',
			tab,
			entryId: id,
			actor: {
				uid: actor.uid,
				email: actor.email ?? null
			}
		},
		userId: actor.uid
	});
}

export async function deleteArchiveEntry(tab: ArchiveTab, id: string, actor: User) {
	await ensureFirebaseReady();
	const db = getDb();
	await deleteDoc(doc(db, COLLECTION_MAP[tab], id));

	await logAdminAction({
		type: 'adminAction',
		level: 'warning',
		message: `Hard deleted archived ${tab} ${id}`,
		data: {
			action: 'archive:delete',
			tab,
			entryId: id,
			actor: {
				uid: actor.uid,
				email: actor.email ?? null
			}
		},
		userId: actor.uid
	});
}

type SoftDeleteOptions = {
	tab: ArchiveTab;
	docPath: string;
	reason?: string;
	metadata?: Record<string, unknown>;
};

export async function softDeleteDocument(options: SoftDeleteOptions, actor: User) {
	await ensureFirebaseReady();
	const db = getDb();
	const segments = options.docPath.split('/').filter(Boolean);
	if (segments.length % 2 !== 0) throw new Error('Document path must reference a document');
	const targetRef = doc(db, segments.join('/'));
	await runTransaction(db, async (trx) => {
		const liveSnap = await trx.get(targetRef);
		if (!liveSnap.exists()) throw new Error('Document not found');
		const payload = liveSnap.data();
		const archiveRef = doc(db, COLLECTION_MAP[options.tab], liveSnap.id);
		trx.set(archiveRef, {
			entityId: liveSnap.id,
			originalPath: options.docPath,
			snapshot: payload,
			reason: options.reason ?? 'Manual admin archive',
			metadata: options.metadata ?? {},
			deletedBy: {
				uid: actor.uid,
				email: actor.email ?? null
			},
			createdAt: serverTimestamp()
		});
		trx.delete(targetRef);
	});

	await logAdminAction({
		type: 'adminAction',
		level: 'warning',
		message: `Archived document ${options.docPath}`,
		data: {
			action: 'archive:create',
			tab: options.tab,
			path: options.docPath,
			reason: options.reason ?? null,
			actor: {
				uid: actor.uid,
				email: actor.email ?? null
			}
		},
		userId: actor.uid
	});
}

export async function hardDeleteDocument(
	docPath: string,
	actor: User,
	context?: { reason?: string; scope?: string }
) {
	await ensureFirebaseReady();
	const db = getDb();
	const segments = docPath.split('/').filter(Boolean);
	if (segments.length % 2 !== 0) throw new Error('Document path must reference a document');
	await deleteDoc(doc(db, segments.join('/')));

	await logAdminAction({
		type: 'adminAction',
		level: 'warning',
		message: `Hard deleted ${docPath}`,
		data: {
			action: 'entity:delete',
			path: docPath,
			reason: context?.reason ?? null,
			scope: context?.scope ?? null,
			actor: {
				uid: actor.uid,
				email: actor.email ?? null
			}
		},
		userId: actor.uid
	});
}
