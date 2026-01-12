import { ensureFirebaseReady, getFirebase } from '$lib/firebase';
import { db } from '$lib/firestore/client';
import { readable, type Readable } from 'svelte/store';
import {
	doc,
	getDoc,
	onSnapshot,
	serverTimestamp,
	setDoc,
	updateDoc,
	runTransaction
} from 'firebase/firestore';
import { onAuthStateChanged, type User } from 'firebase/auth';
import type { SuperAdminMap } from './types';
import { logAdminAction } from './logs';

const DEFAULT_SUPER_ADMINS = ['andrew@healthspaces.com'];

let cachedUserPromise: Promise<User | null> | null = null;

const normalizeEmail = (value?: string | null) =>
	typeof value === 'string' ? value.trim().toLowerCase() : null;

export async function getCurrentUser(forceRefresh = false): Promise<User | null> {
	await ensureFirebaseReady();
	const { auth } = getFirebase();
	if (!auth) return null;
	if (!forceRefresh && auth.currentUser) return auth.currentUser;
	if (!forceRefresh && cachedUserPromise) return cachedUserPromise;

	cachedUserPromise = new Promise<User | null>((resolve) => {
		const unsubscribe = onAuthStateChanged(auth, (value) => {
			unsubscribe();
			cachedUserPromise = null;
			resolve(value);
		});
	});

	return cachedUserPromise;
}

async function readSuperAdminDoc(): Promise<SuperAdminMap> {
	await ensureFirebaseReady();
	const ref = doc(db(), 'appConfig', 'superAdmins');
	const snap = await getDoc(ref);
	const data = (snap.exists() ? (snap.data() as { emails?: SuperAdminMap }) : null) ?? {};
	const normalizedMap = Object.fromEntries(
		Object.entries(data.emails ?? {}).map(([email, flag]) => [
			normalizeEmail(email) ?? email,
			!!flag
		])
	);

	let mutated = false;
	for (const email of DEFAULT_SUPER_ADMINS) {
		const normalized = normalizeEmail(email);
		if (normalized && !normalizedMap[normalized]) {
			normalizedMap[normalized] = true;
			mutated = true;
		}
	}

	if (mutated) {
		await setDoc(
			ref,
			{
				emails: normalizedMap,
				updatedAt: serverTimestamp()
			},
			{ merge: true }
		);
	}

	return normalizedMap;
}

export async function fetchSuperAdminEmails(): Promise<string[]> {
	const map = await readSuperAdminDoc();
	return Object.entries(map)
		.filter(([, allowed]) => allowed)
		.map(([email]) => email);
}

export async function isSuperAdmin(user: User | null | undefined): Promise<boolean> {
	const email = normalizeEmail(user?.email);
	if (!email) return false;
	const admins = await readSuperAdminDoc();
	return Boolean(admins[email]);
}

export async function assertSuperAdmin(user?: User | null) {
	const resolvedUser = user ?? (await getCurrentUser());
	if (!(await isSuperAdmin(resolvedUser))) {
		throw new Error('Super Admin access required');
	}
}

export function superAdminEmailsStore(): Readable<string[]> {
	return readable<string[]>([], (set) => {
		let unsubscribe: (() => void) | null = null;

		const boot = async () => {
			await ensureFirebaseReady();
			try {
				set(await fetchSuperAdminEmails());
			} catch {
				set([]);
			}

			unsubscribe = onSnapshot(doc(db(), 'appConfig', 'superAdmins'), (snap) => {
				const data = (snap.exists() ? (snap.data() as { emails?: SuperAdminMap }) : null) ?? {};
				const items = Object.entries(data.emails ?? {})
					.filter(([, allowed]) => Boolean(allowed))
					.map(([email]) => email.toLowerCase());
				set(items);
			});
		};

		boot().catch(() => set([]));

		return () => {
			unsubscribe?.();
		};
	});
}

export async function addSuperAdminEmail(targetEmail: string, actor: User) {
	const cleaned = normalizeEmail(targetEmail);
	if (!cleaned) throw new Error('Email required');
	await assertSuperAdmin(actor);

	await ensureFirebaseReady();
	await runTransaction(db(), async (trx) => {
		const ref = doc(db(), 'appConfig', 'superAdmins');
		const snap = await trx.get(ref);
		const emails = ((snap.exists() ? snap.data() : {}) as { emails?: SuperAdminMap }).emails ?? {};
		emails[cleaned] = true;
		trx.set(
			ref,
			{
				emails,
				updatedAt: serverTimestamp()
			},
			{ merge: true }
		);
	});

	await logAdminAction({
		type: 'adminAction',
		level: 'info',
		message: `Added Super Admin ${cleaned}`,
		data: {
			action: 'superAdmin:add',
			targetEmail: cleaned,
			actor: {
				uid: actor.uid,
				email: actor.email ?? null
			}
		},
		userId: actor.uid
	});
}

export async function removeSuperAdminEmail(targetEmail: string, actor: User) {
	const cleaned = normalizeEmail(targetEmail);
	if (!cleaned) throw new Error('Email required');
	await assertSuperAdmin(actor);

	await ensureFirebaseReady();
	await runTransaction(db(), async (trx) => {
		const ref = doc(db(), 'appConfig', 'superAdmins');
		const snap = await trx.get(ref);
		const emails = ((snap.exists() ? snap.data() : {}) as { emails?: SuperAdminMap }).emails ?? {};
		if (!emails[cleaned]) {
			throw new Error('Email not in Super Admin list');
		}

		const remaining = Object.entries(emails).filter(([email, flag]) => email !== cleaned && flag);
		const removingSelf = normalizeEmail(actor.email) === cleaned;
		if (remaining.length === 0 && removingSelf) {
			throw new Error('Cannot remove the last Super Admin');
		}

		delete emails[cleaned];
		trx.set(
			ref,
			{
				emails,
				updatedAt: serverTimestamp()
			},
			{ merge: true }
		);
	});

	await logAdminAction({
		type: 'adminAction',
		level: 'warning',
		message: `Removed Super Admin ${cleaned}`,
		data: {
			action: 'superAdmin:remove',
			targetEmail: cleaned,
			actor: {
				uid: actor.uid,
				email: actor.email ?? null
			}
		},
		userId: actor.uid
	});
}

/**
 * Super Admin utility to refresh ALL users' Google profile photos from Firebase Auth.
 * Does NOT override users who have uploaded custom photos (customPhotoURL).
 */
export async function refreshAllGooglePhotos(): Promise<{
	ok: boolean;
	total: number;
	synced: number;
	skipped: number;
	failed: number;
	noAuthPhoto: number;
	message: string;
}> {
	await ensureFirebaseReady();
	const { functions } = getFirebase();
	
	if (!functions) {
		throw new Error('Firebase Functions not available');
	}
	
	const { httpsCallable } = await import('firebase/functions');
	const callable = httpsCallable(functions, 'refreshAllGooglePhotos');
	
	const result = await callable({});
	return result.data as {
		ok: boolean;
		total: number;
		synced: number;
		skipped: number;
		failed: number;
		noAuthPhoto: number;
		message: string;
	};
}

/**
 * Refresh a single user's Google profile photo from Firebase Auth.
 * @param uid - The user ID to refresh
 * @param force - If true, will override even if user has customPhotoURL
 */
export async function refreshUserGooglePhoto(uid: string, force = false): Promise<{
	ok: boolean;
	photoURL?: string;
	reason?: string;
	message: string;
}> {
	await ensureFirebaseReady();
	const { functions } = getFirebase();
	
	if (!functions) {
		throw new Error('Firebase Functions not available');
	}
	
	const { httpsCallable } = await import('firebase/functions');
	const callable = httpsCallable(functions, 'refreshUserGooglePhoto');
	
	const result = await callable({ uid, force });
	return result.data as {
		ok: boolean;
		photoURL?: string;
		reason?: string;
		message: string;
	};
}

/**
 * Repair token-missing Firebase Storage URLs stored on a user's profile.
 */
export async function repairUserAvatarTokens(uid: string): Promise<{
	ok: boolean;
	updated?: Record<string, string>;
	updatedCount?: number;
	failures?: Array<{ bucket: string; path: string; reason: string }>;
	reason?: string;
	message?: string;
}> {
	await ensureFirebaseReady();
	const { functions } = getFirebase();

	if (!functions) {
		throw new Error('Firebase Functions not available');
	}

	const { httpsCallable } = await import('firebase/functions');
	const callable = httpsCallable(functions, 'repairUserAvatarTokens');

	const result = await callable({ uid });
	return result.data as {
		ok: boolean;
		updated?: Record<string, string>;
		updatedCount?: number;
		failures?: Array<{ bucket: string; path: string; reason: string }>;
		reason?: string;
		message?: string;
	};
}

/**
 * Super Admin utility to force add a user to a server.
 * This bypasses normal invite/join flows.
 */
export async function forceAddUserToServer(
	targetUid: string,
	serverId: string,
	actor: User
): Promise<{ ok: boolean; message: string }> {
	await assertSuperAdmin(actor);
	await ensureFirebaseReady();

	const serverRef = doc(db(), 'servers', serverId);
	const serverSnap = await getDoc(serverRef);
	if (!serverSnap.exists()) {
		throw new Error('Server not found');
	}
	const serverData = serverSnap.data() as { name?: string; icon?: string | null; defaultRoleId?: string; owner?: string };

	const memberRef = doc(db(), 'servers', serverId, 'members', targetUid);
	const memberSnap = await getDoc(memberRef);
	if (memberSnap.exists()) {
		return { ok: false, message: 'User is already a member of this server.' };
	}

	// Build member payload
	const roleIds: string[] = [];
	if (serverData.defaultRoleId) {
		roleIds.push(serverData.defaultRoleId);
	}

	await setDoc(memberRef, {
		uid: targetUid,
		role: 'member',
		roleIds,
		permissions: {},
		permissionBits: 0,
		perms: {},
		topRolePosition: 999,
		nickname: null,
		joinedAt: serverTimestamp(),
		muted: false,
		deafened: false
	});

	// Also add the server to the user's profile servers subcollection for rail visibility
	// Include name and icon so the server rail can display it immediately
	const profileServerRef = doc(db(), 'profiles', targetUid, 'servers', serverId);
	await setDoc(profileServerRef, {
		serverId,
		name: serverData.name ?? 'Server',
		icon: serverData.icon ?? null,
		joinedAt: serverTimestamp(),
		position: -Date.now() // Put at top of list
	});

	await logAdminAction({
		type: 'adminAction',
		level: 'info',
		message: `Force added user ${targetUid} to server ${serverData.name ?? serverId}`,
		data: {
			action: 'server:forceAddUser',
			targetUid,
			serverId,
			serverName: serverData.name ?? null,
			actor: {
				uid: actor.uid,
				email: actor.email ?? null
			}
		},
		userId: actor.uid
	});

	return { ok: true, message: `User added to ${serverData.name ?? 'server'}.` };
}

/**
 * Force remove a user from a server (super admin only).
 */
export async function forceRemoveUserFromServer(
	targetUid: string,
	serverId: string,
	actor: User
): Promise<{ ok: boolean; message: string }> {
	await assertSuperAdmin(actor);
	await ensureFirebaseReady();

	const { deleteDoc, getDoc } = await import('firebase/firestore');

	// Check if user is actually a member
	const memberRef = doc(db(), 'servers', serverId, 'members', targetUid);
	const memberSnap = await getDoc(memberRef);
	
	if (!memberSnap.exists()) {
		return { ok: false, message: 'User is not a member of this server.' };
	}

	// Get server name for logging
	const serverRef = doc(db(), 'servers', serverId);
	const serverSnap = await getDoc(serverRef);
	const serverData = serverSnap.data() as { name?: string } | undefined;

	// Remove from server members
	await deleteDoc(memberRef);

	// Remove from user's profile servers subcollection (server rail)
	const profileServerRef = doc(db(), 'profiles', targetUid, 'servers', serverId);
	try {
		await deleteDoc(profileServerRef);
	} catch (err) {
		// Profile server doc may not exist, that's okay
		console.warn('Could not delete profile server doc:', err);
	}

	await logAdminAction({
		type: 'adminAction',
		level: 'warning',
		message: `Force removed user ${targetUid} from server ${serverData?.name ?? serverId}`,
		data: {
			action: 'server:forceRemoveUser',
			targetUid,
			serverId,
			serverName: serverData?.name ?? null,
			actor: {
				uid: actor.uid,
				email: actor.email ?? null
			}
		},
		userId: actor.uid
	});

	return { ok: true, message: `User removed from ${serverData?.name ?? 'server'}.` };
}

/**
 * Fetch all servers for admin selection (limited for performance).
 */
export async function fetchAllServers(): Promise<
	Array<{ id: string; name: string; memberCount?: number }>
> {
	await ensureFirebaseReady();
	const { collection, getDocs, query, orderBy, limit } = await import('firebase/firestore');
	const snapshot = await getDocs(
		query(collection(db(), 'servers'), orderBy('name', 'asc'), limit(200))
	);
	return snapshot.docs.map((docSnap) => {
		const data = docSnap.data() as { name?: string; memberCount?: number };
		return {
			id: docSnap.id,
			name: data.name ?? 'Untitled Server',
			memberCount: data.memberCount
		};
	});
}

/* ==================== User Groups ==================== */

export interface UserGroup {
	id: string;
	name: string;
	description: string;
	serverIds: string[];
	memberUids: string[];
	/** Maps uid -> array of server IDs that were actually added by this group */
	memberServers: Record<string, string[]>;
	createdAt?: Date;
	updatedAt?: Date;
}

/**
 * Fetch all user groups.
 */
export async function fetchUserGroups(): Promise<UserGroup[]> {
	await ensureFirebaseReady();
	const { collection, getDocs, query, orderBy } = await import('firebase/firestore');
	const snapshot = await getDocs(
		query(collection(db(), 'appConfig', 'userGroups', 'groups'), orderBy('name', 'asc'))
	);
	return snapshot.docs.map((docSnap) => {
		const data = docSnap.data() as Omit<UserGroup, 'id'> & { createdAt?: { toDate(): Date }; updatedAt?: { toDate(): Date } };
		return {
			id: docSnap.id,
			name: data.name ?? 'Untitled Group',
			description: data.description ?? '',
			serverIds: data.serverIds ?? [],
			memberUids: data.memberUids ?? [],
			memberServers: data.memberServers ?? {},
			createdAt: data.createdAt?.toDate?.() ?? undefined,
			updatedAt: data.updatedAt?.toDate?.() ?? undefined
		};
	});
}

/**
 * Fetch a single user group by ID (fresh from Firestore).
 */
export async function fetchUserGroup(groupId: string): Promise<UserGroup | null> {
	await ensureFirebaseReady();
	const { getDoc } = await import('firebase/firestore');
	const groupRef = doc(db(), 'appConfig', 'userGroups', 'groups', groupId);
	const docSnap = await getDoc(groupRef);
	
	if (!docSnap.exists()) {
		return null;
	}
	
	const data = docSnap.data() as Omit<UserGroup, 'id'> & { createdAt?: { toDate(): Date }; updatedAt?: { toDate(): Date } };
	return {
		id: docSnap.id,
		name: data.name ?? 'Untitled Group',
		description: data.description ?? '',
		serverIds: data.serverIds ?? [],
		memberUids: data.memberUids ?? [],
		memberServers: data.memberServers ?? {},
		createdAt: data.createdAt?.toDate?.() ?? undefined,
		updatedAt: data.updatedAt?.toDate?.() ?? undefined
	};
}

/**
 * Create a new user group.
 */
export async function createUserGroup(
	group: Omit<UserGroup, 'id' | 'createdAt' | 'updatedAt'>,
	actor: User
): Promise<{ ok: boolean; groupId: string; message: string }> {
	await assertSuperAdmin(actor);
	await ensureFirebaseReady();
	
	const { collection, addDoc } = await import('firebase/firestore');
	const groupsRef = collection(db(), 'appConfig', 'userGroups', 'groups');
	
	const docRef = await addDoc(groupsRef, {
		name: group.name,
		description: group.description,
		serverIds: group.serverIds,
		memberUids: [],
		memberServers: {},
		createdAt: serverTimestamp(),
		updatedAt: serverTimestamp()
	});

	await logAdminAction({
		type: 'adminAction',
		level: 'info',
		message: `Created user group "${group.name}"`,
		data: {
			action: 'userGroup:create',
			groupId: docRef.id,
			groupName: group.name,
			serverCount: group.serverIds.length,
			actor: { uid: actor.uid, email: actor.email ?? null }
		},
		userId: actor.uid
	});

	return { ok: true, groupId: docRef.id, message: `Group "${group.name}" created.` };
}

/**
 * Update an existing user group.
 */
export async function updateUserGroup(
	groupId: string,
	updates: Partial<Omit<UserGroup, 'id' | 'createdAt' | 'updatedAt'>>,
	actor: User
): Promise<{ ok: boolean; message: string }> {
	await assertSuperAdmin(actor);
	await ensureFirebaseReady();

	const groupRef = doc(db(), 'appConfig', 'userGroups', 'groups', groupId);
	await updateDoc(groupRef, {
		...updates,
		updatedAt: serverTimestamp()
	});

	await logAdminAction({
		type: 'adminAction',
		level: 'info',
		message: `Updated user group "${updates.name ?? groupId}"`,
		data: {
			action: 'userGroup:update',
			groupId,
			updates,
			actor: { uid: actor.uid, email: actor.email ?? null }
		},
		userId: actor.uid
	});

	return { ok: true, message: 'Group updated.' };
}

/**
 * Sync group members when servers are added/removed from a group.
 * - For removed servers: Remove all members from those servers
 * - For added servers: Add all members to those servers
 */
export async function syncGroupServers(
	group: UserGroup,
	oldServerIds: string[],
	newServerIds: string[],
	actor: User
): Promise<{
	ok: boolean;
	addedToServers: number;
	removedFromServers: number;
	updatedMemberServers: Record<string, string[]>;
	message: string;
}> {
	await assertSuperAdmin(actor);
	await ensureFirebaseReady();

	const addedServers = newServerIds.filter(id => !oldServerIds.includes(id));
	const removedServers = oldServerIds.filter(id => !newServerIds.includes(id));
	
	let addedToServers = 0;
	let removedFromServers = 0;
	
	// Deep copy memberServers to track updates
	const updatedMemberServers: Record<string, string[]> = {};
	for (const [uid, servers] of Object.entries(group.memberServers || {})) {
		updatedMemberServers[uid] = [...servers];
	}

	// For each member in the group
	for (const memberUid of group.memberUids) {
		// Add to newly added servers
		for (const serverId of addedServers) {
			try {
				console.log(`[syncGroupServers] Adding ${memberUid} to server ${serverId}`);
				const result = await forceAddUserToServer(memberUid, serverId, actor);
				console.log(`[syncGroupServers] Result:`, result);
				if (result.ok) {
					addedToServers++;
					// Track this server for the member
					if (!updatedMemberServers[memberUid]) {
						updatedMemberServers[memberUid] = [];
					}
					updatedMemberServers[memberUid].push(serverId);
				} else {
					// User was already a member - still track it if not already tracked
					if (!updatedMemberServers[memberUid]) {
						updatedMemberServers[memberUid] = [];
					}
					// Don't add to tracking since we didn't add them (they were already there)
					console.log(`[syncGroupServers] User ${memberUid} already in server ${serverId}`);
				}
			} catch (err) {
				console.error(`[syncGroupServers] Failed to add ${memberUid} to server ${serverId}:`, err);
			}
		}

		// Remove from removed servers (only if we added them via this group)
		for (const serverId of removedServers) {
			const memberServerList = group.memberServers?.[memberUid] || [];
			if (memberServerList.includes(serverId)) {
				try {
					const result = await forceRemoveUserFromServer(memberUid, serverId, actor);
					if (result.ok) {
						removedFromServers++;
						// Remove this server from tracking
						if (updatedMemberServers[memberUid]) {
							updatedMemberServers[memberUid] = updatedMemberServers[memberUid].filter(id => id !== serverId);
						}
					}
				} catch (err) {
					console.error(`Failed to remove ${memberUid} from server ${serverId}:`, err);
				}
			}
		}
	}

	// Update the group's memberServers in Firestore
	if (Object.keys(updatedMemberServers).length > 0) {
		const groupRef = doc(db(), 'appConfig', 'userGroups', 'groups', group.id);
		await updateDoc(groupRef, {
			memberServers: updatedMemberServers,
			updatedAt: serverTimestamp()
		});
	}

	await logAdminAction({
		type: 'adminAction',
		level: 'info',
		message: `Synced group "${group.name}" servers: ${addedServers.length} added, ${removedServers.length} removed`,
		data: {
			action: 'userGroup:syncServers',
			groupId: group.id,
			groupName: group.name,
			addedServers,
			removedServers,
			memberCount: group.memberUids.length,
			results: { addedToServers, removedFromServers },
			actor: { uid: actor.uid, email: actor.email ?? null }
		},
		userId: actor.uid
	});

	const parts: string[] = [];
	if (addedToServers > 0) parts.push(`${addedToServers} added`);
	if (removedFromServers > 0) parts.push(`${removedFromServers} removed`);

	return {
		ok: true,
		addedToServers,
		removedFromServers,
		updatedMemberServers,
		message: parts.join(', ') || 'No changes needed.'
	};
}

/**
 * Delete a user group.
 */
export async function deleteUserGroup(
	groupId: string,
	groupName: string,
	actor: User
): Promise<{ ok: boolean; message: string }> {
	await assertSuperAdmin(actor);
	await ensureFirebaseReady();

	const { deleteDoc } = await import('firebase/firestore');
	const groupRef = doc(db(), 'appConfig', 'userGroups', 'groups', groupId);
	await deleteDoc(groupRef);

	await logAdminAction({
		type: 'adminAction',
		level: 'warning',
		message: `Deleted user group "${groupName}"`,
		data: {
			action: 'userGroup:delete',
			groupId,
			groupName,
			actor: { uid: actor.uid, email: actor.email ?? null }
		},
		userId: actor.uid
	});

	return { ok: true, message: `Group "${groupName}" deleted.` };
}

/**
 * Add a user to all servers in a group.
 */
export async function addUserToGroup(
	targetUid: string,
	group: UserGroup,
	actor: User
): Promise<{ ok: boolean; added: number; skipped: number; failed: number; serversAdded: string[]; message: string }> {
	await assertSuperAdmin(actor);
	await ensureFirebaseReady();

	const { arrayUnion } = await import('firebase/firestore');

	let added = 0;
	let skipped = 0;
	let failed = 0;
	const serversAdded: string[] = [];

	for (const serverId of group.serverIds) {
		try {
			const result = await forceAddUserToServer(targetUid, serverId, actor);
			if (result.ok) {
				added++;
				serversAdded.push(serverId);
			} else {
				skipped++; // Already a member
			}
		} catch (err) {
			console.error(`Failed to add user to server ${serverId}:`, err);
			failed++;
		}
	}

	// Track membership in the group - store which servers were actually added
	const groupRef = doc(db(), 'appConfig', 'userGroups', 'groups', group.id);
	await updateDoc(groupRef, {
		memberUids: arrayUnion(targetUid),
		[`memberServers.${targetUid}`]: serversAdded,
		updatedAt: serverTimestamp()
	});

	await logAdminAction({
		type: 'adminAction',
		level: 'info',
		message: `Added user ${targetUid} to group "${group.name}" (${added} servers)`,
		data: {
			action: 'userGroup:addUser',
			targetUid,
			groupId: group.id,
			groupName: group.name,
			results: { added, skipped, failed },
			actor: { uid: actor.uid, email: actor.email ?? null }
		},
		userId: actor.uid
	});

	const parts: string[] = [];
	if (added > 0) parts.push(`${added} added`);
	if (skipped > 0) parts.push(`${skipped} already member`);
	if (failed > 0) parts.push(`${failed} failed`);

	return {
		ok: failed === 0,
		added,
		skipped,
		failed,
		serversAdded,
		message: parts.join(', ') || 'No servers in group.'
	};
}

/**
 * Remove a user from a group - removes them ONLY from servers that this group
 * actually added them to, not servers they were already in.
 */
export async function removeUserFromGroup(
	targetUid: string,
	group: UserGroup,
	actor: User
): Promise<{ ok: boolean; removed: number; skipped: number; failed: number; message: string }> {
	await assertSuperAdmin(actor);
	await ensureFirebaseReady();

	const { arrayRemove, deleteField } = await import('firebase/firestore');

	let removed = 0;
	let skipped = 0;
	let failed = 0;

	// Only remove from servers that this group actually added the user to
	const serversToRemove = group.memberServers?.[targetUid] ?? [];

	if (serversToRemove.length === 0) {
		// No tracked servers - just remove from group tracking
		const groupRef = doc(db(), 'appConfig', 'userGroups', 'groups', group.id);
		await updateDoc(groupRef, {
			memberUids: arrayRemove(targetUid),
			[`memberServers.${targetUid}`]: deleteField(),
			updatedAt: serverTimestamp()
		});
		return { ok: true, removed: 0, skipped: 0, failed: 0, message: 'User removed from group (no servers to remove).' };
	}

	// Remove user from each server that this group added them to
	for (const serverId of serversToRemove) {
		try {
			const result = await forceRemoveUserFromServer(targetUid, serverId, actor);
			if (result.ok) {
				removed++;
			} else {
				skipped++; // Not a member (maybe removed manually)
			}
		} catch (err) {
			console.error(`Failed to remove user from server ${serverId}:`, err);
			failed++;
		}
	}
	
	// Remove from group tracking
	const groupRef = doc(db(), 'appConfig', 'userGroups', 'groups', group.id);
	await updateDoc(groupRef, {
		memberUids: arrayRemove(targetUid),
		[`memberServers.${targetUid}`]: deleteField(),
		updatedAt: serverTimestamp()
	});

	await logAdminAction({
		type: 'adminAction',
		level: 'warning',
		message: `Removed user ${targetUid} from group "${group.name}" (${removed} servers)`,
		data: {
			action: 'userGroup:removeUser',
			targetUid,
			groupId: group.id,
			groupName: group.name,
			results: { removed, skipped, failed },
			actor: { uid: actor.uid, email: actor.email ?? null }
		},
		userId: actor.uid
	});

	const parts: string[] = [];
	if (removed > 0) parts.push(`${removed} removed`);
	if (skipped > 0) parts.push(`${skipped} not member`);
	if (failed > 0) parts.push(`${failed} failed`);

	return {
		ok: failed === 0,
		removed,
		skipped,
		failed,
		message: parts.join(', ') || 'No servers in group.'
	};
}
