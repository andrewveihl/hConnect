// src/lib/firestore/channels.ts
import { getDb } from '$lib/firebase';
import { collection, doc, getDocs, serverTimestamp, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';

// ============ CHANNEL CATEGORIES ============

export interface ChannelCategory {
	id: string;
	name: string;
	position: number;
	collapsed?: boolean;
	createdAt?: any;
	updatedAt?: any;
}

export async function createCategory(
	serverId: string,
	name: string
): Promise<string> {
	const db = getDb();
	const categoriesCol = collection(db, 'servers', serverId, 'categories');

	// compute next position
	const snap = await getDocs(categoriesCol);
	let maxPos = -1;
	snap.forEach((d) => {
		const p = (d.data() as any).position ?? 0;
		if (typeof p === 'number' && p > maxPos) maxPos = p;
	});
	const position = maxPos + 1;

	const catRef = doc(categoriesCol);
	await setDoc(catRef, {
		id: catRef.id,
		name,
		position,
		collapsed: false,
		createdAt: serverTimestamp()
	});
	return catRef.id;
}

export async function updateCategory(
	serverId: string,
	categoryId: string,
	updates: Partial<{ name: string; position: number; collapsed: boolean }>
): Promise<void> {
	const db = getDb();
	await updateDoc(doc(db, 'servers', serverId, 'categories', categoryId), {
		...updates,
		updatedAt: serverTimestamp()
	});
}

export async function deleteCategory(
	serverId: string,
	categoryId: string,
	removeChannelsFromCategory = true
): Promise<void> {
	const db = getDb();
	const batch = writeBatch(db);

	// Remove categoryId from all channels in this category
	if (removeChannelsFromCategory) {
		const channelsSnap = await getDocs(collection(db, 'servers', serverId, 'channels'));
		channelsSnap.forEach((docSnap) => {
			const data = docSnap.data();
			if (data.categoryId === categoryId) {
				batch.update(doc(db, 'servers', serverId, 'channels', docSnap.id), {
					categoryId: null
				});
			}
		});
	}

	// Delete the category
	batch.delete(doc(db, 'servers', serverId, 'categories', categoryId));
	await batch.commit();
}

export async function reorderCategories(
	serverId: string,
	orderedCategoryIds: string[]
): Promise<void> {
	const db = getDb();
	const batch = writeBatch(db);
	orderedCategoryIds.forEach((id, index) => {
		batch.update(doc(db, 'servers', serverId, 'categories', id), {
			position: index
		});
	});
	await batch.commit();
}

// ============ CHANNELS ============

export async function createChannel(
	serverId: string,
	name: string,
	type: 'text' | 'voice' = 'text',
	isPrivate = false,
	allowedRoleIds: string[] = [],
	categoryId: string | null = null
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
					categoryId: categoryId || null,
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
					categoryId: categoryId || null,
					createdAt: serverTimestamp()
				};

	await setDoc(chRef, payload);
	return chRef.id;
}

export async function updateChannelCategory(
	serverId: string,
	channelId: string,
	categoryId: string | null
): Promise<void> {
	const db = getDb();
	await updateDoc(doc(db, 'servers', serverId, 'channels', channelId), {
		categoryId: categoryId || null
	});
}
