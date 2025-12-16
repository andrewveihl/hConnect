// src/lib/db/servers.ts
// Purpose: server creation, membership helpers, rail mapping (LeftPane), subscriptions
// Debugging is loud: set window.__DEBUG = true to see extra logs

import { getDb } from '$lib/firebase';
import {
	addDoc,
	collection,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
	setDoc,
	updateDoc,
	writeBatch,
	type DocumentData,
	type Firestore,
	type Unsubscribe
} from 'firebase/firestore';
import {
	ALL_PERMISSIONS_MASK,
	DEFAULT_EVERYONE_PERMISSIONS,
	bitsAsNumber,
	PERMISSION_KEYS,
	permissionMapFromBits,
	resolveEffectivePermissions,
	toPermissionBits,
	type PermissionMap,
	type RoleDefinition
} from '$lib/permissions/permissions';

export type RoleName = 'owner' | 'admin' | 'member';

export type ServerDoc = {
	id?: string;
	name: string;
	icon?: string | null;
	emoji?: string | null;
	owner: string;
	isPublic?: boolean;
	createdAt: any;
	systemChannelId?: string | null;
	defaultRoleId?: string | null;
	ownerRoleId?: string | null;
	everyoneRoleId?: string | null;
};

type RoleDoc = RoleDefinition & {
	permissions: PermissionMap;
	permissionBits: number;
};

function dlog(...args: any[]) {
	if (typeof window !== 'undefined' && (window as any).__DEBUG) {
		console.debug('[servers.ts]', ...args);
	}
}

type LegacyPermissions = {
	manageServer: boolean;
	manageRoles: boolean;
	manageChannels: boolean;
	reorderChannels: boolean;
	viewChannels: boolean;
	sendMessages: boolean;
	manageMessages: boolean;
	kickMembers: boolean;
	banMembers: boolean;
	connectVoice: boolean;
	speakVoice: boolean;
};

const LEGACY_PERMISSION_KEYS: Record<keyof LegacyPermissions, string> = {
	manageServer: 'MANAGE_SERVER',
	manageRoles: 'MANAGE_ROLES',
	manageChannels: 'MANAGE_CHANNELS',
	reorderChannels: 'MANAGE_CHANNELS',
	viewChannels: 'VIEW_CHANNEL',
	sendMessages: 'SEND_MESSAGES',
	manageMessages: 'MANAGE_MESSAGES',
	kickMembers: 'KICK_MEMBERS',
	banMembers: 'BAN_MEMBERS',
	connectVoice: 'CONNECT_VOICE',
	speakVoice: 'SPEAK_VOICE'
};

function legacyPermsFrom(map: Record<string, boolean>): LegacyPermissions {
	const legacy: Record<string, boolean> = {};
	for (const key in LEGACY_PERMISSION_KEYS) {
		const permKey = LEGACY_PERMISSION_KEYS[key as keyof LegacyPermissions];
		legacy[key] = !!map[permKey];
	}
	return legacy as LegacyPermissions;
}

function roleTagFrom(perms: LegacyPermissions, isOwner: boolean): RoleName {
	if (isOwner) return 'owner';
	if (perms.manageServer || perms.manageRoles) return 'admin';
	return 'member';
}

function camelFromKey(key: string): string {
	return key.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function normalizePermissionMap(raw: any): PermissionMap {
	const normalized: PermissionMap = {};
	for (const perm of PERMISSION_KEYS) {
		const camel = camelFromKey(perm);
		const plural = camel.endsWith('s') ? camel : `${camel}s`;
		if (raw && typeof raw === 'object' && raw[perm] !== undefined) {
			normalized[perm] = !!raw[perm];
		} else if (raw && typeof raw === 'object' && raw[camel] !== undefined) {
			normalized[perm] = !!raw[camel];
		} else if (raw && typeof raw === 'object' && raw[plural] !== undefined) {
			normalized[perm] = !!raw[plural];
		}
	}
	return normalized;
}

function normalizeRoleDoc(serverId: string, id: string, data: DocumentData | undefined): RoleDoc {
	const permissionsRaw = (data?.permissions ?? {}) as PermissionMap | number;
	const bitsRaw =
		typeof data?.permissionBits === 'number'
			? BigInt(data.permissionBits)
			: typeof permissionsRaw === 'number'
				? BigInt(permissionsRaw)
				: null;
	const bits = bitsRaw ?? toPermissionBits(permissionsRaw ?? 0);
	const map =
		permissionsRaw && typeof permissionsRaw === 'object' && !Array.isArray(permissionsRaw)
			? normalizePermissionMap(permissionsRaw)
			: permissionMapFromBits(bits);

	return {
		id,
		serverId,
		name: typeof data?.name === 'string' ? data.name : 'Role',
		color: typeof data?.color === 'string' ? data.color : null,
		description: typeof data?.description === 'string' ? data.description : null,
		position: typeof data?.position === 'number' ? data.position : 0,
		isOwnerRole: !!data?.isOwnerRole,
		isEveryoneRole: !!data?.isEveryoneRole,
		mentionable: !!data?.mentionable,
		allowMassMentions: !!data?.allowMassMentions,
		showInMemberList: data?.showInMemberList !== false,
		permissions: map,
		permissionBits: bitsAsNumber(bits)
	};
}

async function loadRolesMap(db: Firestore, serverId: string): Promise<Record<string, RoleDoc>> {
	const snap = await getDocs(collection(db, 'servers', serverId, 'roles'));
	const map: Record<string, RoleDoc> = {};
	snap.forEach((docSnap) => {
		map[docSnap.id] = normalizeRoleDoc(serverId, docSnap.id, docSnap.data());
	});
	return map;
}

function normalizedRoleIds(ids: Array<string | null | undefined>): string[] {
	const set = new Set<string>();
	ids.forEach((id) => {
		if (typeof id === 'string' && id.trim().length) {
			set.add(id);
		}
	});
	return Array.from(set);
}

function permissionSnapshot(args: {
	rolesById: Record<string, RoleDoc | undefined>;
	memberRoleIds: string[];
	isServerOwner: boolean;
	ownerRoleIds?: string[] | null;
}) {
	const resolved = resolveEffectivePermissions({
		rolesById: args.rolesById,
		memberRoleIds: args.memberRoleIds,
		isServerOwner: args.isServerOwner,
		isSuperAdmin: false,
		ownerRoleIds: args.ownerRoleIds ?? null
	});
	const legacyPerms = legacyPermsFrom(resolved.map);

	return {
		permissions: resolved.map,
		permissionBits: bitsAsNumber(resolved.bits),
		legacyPerms,
		topRolePosition: resolved.topRolePosition,
		roleTag: roleTagFrom(legacyPerms, resolved.isOwner)
	};
}

export async function ensureSystemRoles(serverId: string) {
	const db = getDb();
	const serverRef = doc(db, 'servers', serverId);
	const serverSnap = await getDoc(serverRef);
	if (!serverSnap.exists()) return null;

	const serverData = serverSnap.data() as ServerDoc;
	const rolesCol = collection(db, 'servers', serverId, 'roles');
	const rolesById = await loadRolesMap(db, serverId);

	let everyoneRole =
		Object.values(rolesById).find((role) => role.isEveryoneRole) ??
		(serverData.defaultRoleId ? rolesById[serverData.defaultRoleId] : undefined);
	let ownerRole = Object.values(rolesById).find((role) => role.isOwnerRole);

	const writes: Promise<unknown>[] = [];
	const createdAt = serverTimestamp();

	if (!everyoneRole) {
		const everyoneRef = doc(rolesCol);
		const bits = DEFAULT_EVERYONE_PERMISSIONS;
		const payload: RoleDoc = {
			id: everyoneRef.id,
			serverId,
			name: '@everyone',
			color: null,
			description: 'Default role for all members',
			position: 0,
			isOwnerRole: false,
			isEveryoneRole: true,
			mentionable: false,
			allowMassMentions: false,
			permissions: permissionMapFromBits(bits),
			permissionBits: bitsAsNumber(bits)
		};
		everyoneRole = payload;
		rolesById[everyoneRef.id] = payload;
		writes.push(setDoc(everyoneRef, { ...payload, createdAt, updatedAt: createdAt }));
	}

	if (!ownerRole) {
		const ownerRef = doc(rolesCol);
		const bits = ALL_PERMISSIONS_MASK;
		const payload: RoleDoc = {
			id: ownerRef.id,
			serverId,
			name: 'Owner',
			color: null,
			description: 'Server owner with full permissions',
			position: 1000,
			isOwnerRole: true,
			isEveryoneRole: false,
			mentionable: false,
			allowMassMentions: true,
			permissions: permissionMapFromBits(bits),
			permissionBits: bitsAsNumber(bits)
		};
		ownerRole = payload;
		rolesById[ownerRef.id] = payload;
		writes.push(setDoc(ownerRef, { ...payload, createdAt, updatedAt: createdAt }));
	}

	const serverUpdates: Record<string, unknown> = {};
	if (everyoneRole && serverData.everyoneRoleId !== everyoneRole.id) {
		serverUpdates.everyoneRoleId = everyoneRole.id;
	}
	if (ownerRole && serverData.ownerRoleId !== ownerRole.id) {
		serverUpdates.ownerRoleId = ownerRole.id;
	}
	const defaultRoleMissing = serverData.defaultRoleId && !rolesById[serverData.defaultRoleId];
	if (everyoneRole && (!serverData.defaultRoleId || defaultRoleMissing)) {
		serverUpdates.defaultRoleId = everyoneRole.id;
	}
	if (Object.keys(serverUpdates).length) {
		writes.push(updateDoc(serverRef, serverUpdates));
	}

	if (writes.length) {
		await Promise.all(writes);
	}

	if (everyoneRole) {
		const memberSnap = await getDocs(collection(db, 'servers', serverId, 'members'));
		for (const member of memberSnap.docs) {
			const data = member.data() as any;
			const roleIds = normalizedRoleIds([
				...(Array.isArray(data.roleIds) ? (data.roleIds as string[]) : []),
				everyoneRole.id,
				ownerRole && (data.role === 'owner' || member.id === serverData.owner) ? ownerRole.id : null
			]);
			await updateDoc(member.ref, { roleIds });
			await recomputeMemberPermissions(serverId, member.id);
		}
	}

	return {
		ownerRoleId: ownerRole?.id ?? null,
		everyoneRoleId: everyoneRole?.id ?? null,
		rolesById
	};
}

/**
 * Rail mapping so the server appears in the user’s LeftPane.
 */
export async function upsertUserMembership(
	serverId: string,
	uid: string,
	data: { name: string; icon?: string | null; position?: number }
) {
	const db = getDb();
	dlog('upsertUserMembership', { serverId, uid, data });
	await setDoc(
		doc(db, 'profiles', uid, 'servers', serverId),
		{
			serverId,
			name: data.name,
			icon: data.icon ?? null,
			joinedAt: serverTimestamp(),
			position: typeof data.position === 'number' ? data.position : -Date.now()
		},
		{ merge: true }
	);
}

export async function removeUserMembership(serverId: string, uid: string) {
	const db = getDb();
	dlog('removeUserMembership', { serverId, uid });
	try {
		await deleteDoc(doc(db, 'profiles', uid, 'servers', serverId));
	} catch (err) {
		console.warn('[servers.ts] removeUserMembership failed', err);
	}
}

/**
 * Idempotently add a user to a server’s members subcollection.
 */
export async function addMemberToServer(
	serverId: string,
	uid: string,
	extra: { role?: RoleName; roleIds?: string[]; skipEnsureRoles?: boolean } = {}
) {
	const db = getDb();
	const memRef = doc(db, 'servers', serverId, 'members', uid);
	console.log('[servers.ts] addMemberToServer: START', { serverId, uid, memRefPath: memRef.path });
	
	try {
		// Read server doc first
		console.log('[servers.ts] addMemberToServer: reading server doc');
		const serverSnap = await getDoc(doc(db, 'servers', serverId));
		console.log('[servers.ts] addMemberToServer: server doc read OK', { exists: serverSnap.exists() });
		
		if (!serverSnap.exists()) {
			throw new Error('Server not found');
		}

		// Now try to read member doc (may not exist yet)
		console.log('[servers.ts] addMemberToServer: reading member doc at', memRef.path);
		let memberSnap;
		try {
			memberSnap = await getDoc(memRef);
			console.log('[servers.ts] addMemberToServer: member doc read OK', { exists: memberSnap.exists() });
		} catch (memErr: any) {
			console.error('[servers.ts] addMemberToServer: member doc read FAILED', memErr?.code, memErr?.message);
			// If we can't read the member doc, assume it doesn't exist
			memberSnap = null;
		}

		const serverData = serverSnap.data() as ServerDoc;
		// Only call ensureSystemRoles for admins - regular users joining via invite
		// won't have permission to create/update roles or server doc
		const ensured = extra.skipEnsureRoles ? null : await ensureSystemRoles(serverId).catch(() => null);
		const everyoneRoleId =
			ensured?.everyoneRoleId ?? serverData.everyoneRoleId ?? serverData.defaultRoleId ?? null;
		const ownerRoleId = ensured?.ownerRoleId ?? serverData.ownerRoleId ?? null;
		const existingRoles =
			memberSnap?.exists() && Array.isArray((memberSnap.data() as any)?.roleIds)
				? ((memberSnap.data() as any).roleIds as string[])
				: [];
		const roleIds = normalizedRoleIds([
			...existingRoles,
			...(extra.roleIds ?? []),
			everyoneRoleId,
			extra.role === 'owner' || serverData.owner === uid ? ownerRoleId : null
		]);
		console.log('[servers.ts] addMemberToServer: loading roles map');
		const rolesById = ensured?.rolesById ?? (await loadRolesMap(db, serverId));
		console.log('[servers.ts] addMemberToServer: roles map loaded, roleIds:', roleIds);
		
		const snapshot = permissionSnapshot({
			rolesById,
			memberRoleIds: roleIds,
			isServerOwner: serverData.owner === uid,
			ownerRoleIds: ownerRoleId ? [ownerRoleId] : null
		});

		dlog('addMemberToServer', { serverId, uid, roleIds, roleTag: snapshot.roleTag });

		const payload: Record<string, unknown> = {
			uid,
			role: snapshot.roleTag,
			roleIds,
			permissions: snapshot.permissions,
			permissionBits: snapshot.permissionBits,
			perms: snapshot.legacyPerms,
			topRolePosition: snapshot.topRolePosition
		};

		if (!memberSnap?.exists()) {
			payload.nickname = null;
			payload.joinedAt = serverTimestamp();
			payload.muted = false;
			payload.deafened = false;
		}

		console.log('[servers.ts] addMemberToServer: writing member doc to', memRef.path);
		await setDoc(memRef, payload, { merge: true });
		console.log('[servers.ts] addMemberToServer: SUCCESS - member doc written');
	} catch (err: any) {
		console.error('[servers.ts] addMemberToServer: FAILED', err?.code, err?.message, err);
		throw err;
	}
}

/**
 * Convenience wrapper to add the member AND rail-map them.
 * Used when a user joins a server via invite - skips admin-level role operations.
 */
export async function joinServer(serverId: string, uid: string) {
	console.log('[servers.ts] joinServer: START', { serverId, uid });
	try {
		const db = getDb();
		const serverRef = doc(db, 'servers', serverId);
		console.log('[servers.ts] joinServer: reading server doc at', serverRef.path);
		const serverSnap = await getDoc(serverRef);
		if (!serverSnap.exists()) throw new Error('Server not found');
		console.log('[servers.ts] joinServer: server doc read SUCCESS');

		const data = serverSnap.data() as ServerDoc;
		console.log('[servers.ts] joinServer: server data', { name: data.name, defaultRoleId: data.defaultRoleId });
		dlog('joinServer', { serverId, uid, serverName: data.name });

		// skipEnsureRoles: true because regular users don't have permission to create/update roles
		console.log('[servers.ts] joinServer: calling addMemberToServer');
		await addMemberToServer(serverId, uid, {
			role: 'member',
			roleIds: data.defaultRoleId ? [data.defaultRoleId] : [],
			skipEnsureRoles: true
		});
		console.log('[servers.ts] joinServer: addMemberToServer complete');
		
		console.log('[servers.ts] joinServer: calling upsertUserMembership');
		await upsertUserMembership(serverId, uid, { name: data.name, icon: (data as any).icon ?? null });
		console.log('[servers.ts] joinServer: SUCCESS - complete');
	} catch (err: any) {
		console.error('[servers.ts] joinServer: FAILED', err?.code, err?.message, err);
		throw err;
	}
}

export async function recomputeMemberPermissions(serverId: string, uid: string) {
	const db = getDb();
	const [serverSnap, memberSnap, rolesById] = await Promise.all([
		getDoc(doc(db, 'servers', serverId)),
		getDoc(doc(db, 'servers', serverId, 'members', uid)),
		loadRolesMap(db, serverId)
	]);

	if (!serverSnap.exists() || !memberSnap.exists()) return;

	const serverData = serverSnap.data() as ServerDoc;
	const memberData = memberSnap.data() as any;
	const ownerRoleId = serverData.ownerRoleId ?? null;
	const roleIds = normalizedRoleIds([
		...(Array.isArray(memberData.roleIds) ? (memberData.roleIds as string[]) : []),
		serverData.everyoneRoleId ?? serverData.defaultRoleId ?? null
	]);

	const snapshot = permissionSnapshot({
		rolesById,
		memberRoleIds: roleIds,
		isServerOwner: serverData.owner === uid,
		ownerRoleIds: ownerRoleId ? [ownerRoleId] : null
	});

	await updateDoc(memberSnap.ref, {
		role: snapshot.roleTag,
		roleIds,
		permissions: snapshot.permissions,
		permissionBits: snapshot.permissionBits,
		perms: snapshot.legacyPerms,
		topRolePosition: snapshot.topRolePosition
	});
}

export async function recomputeAllMemberPermissions(serverId: string) {
	const db = getDb();
	await ensureSystemRoles(serverId);
	const snap = await getDocs(collection(db, 'servers', serverId, 'members'));
	for (const docSnap of snap.docs) {
		await recomputeMemberPermissions(serverId, docSnap.id);
	}
}

/**
 * Create server: default roles, default channels, owner membership, rail map
 */
export async function createServer(
	uid: string,
	data: { name: string; emoji?: string | null; icon?: string | null; isPublic?: boolean }
) {
	const db = getDb();

	const serverRef = doc(collection(db, 'servers'));
	const createdAt = serverTimestamp();
	await setDoc(serverRef, {
		name: data.name,
		emoji: data.emoji ?? null,
		icon: data.icon ?? null,
		owner: uid,
		isPublic: !!data.isPublic,
		createdAt,
		systemChannelId: null,
		defaultRoleId: null,
		ownerRoleId: null,
		everyoneRoleId: null
	});

	// Roles
	const rolesCol = collection(db, 'servers', serverRef.id, 'roles');
	const everyoneRef = doc(rolesCol);
	const ownerRef = doc(rolesCol);

	const everyoneBits = DEFAULT_EVERYONE_PERMISSIONS;
	const ownerBits = ALL_PERMISSIONS_MASK;

	const everyoneRole: RoleDoc = {
		id: everyoneRef.id,
		serverId: serverRef.id,
		name: '@everyone',
		color: null,
		description: 'Default role for all members',
		position: 0,
		isOwnerRole: false,
		isEveryoneRole: true,
		mentionable: false,
		allowMassMentions: false,
		permissions: permissionMapFromBits(everyoneBits),
		permissionBits: bitsAsNumber(everyoneBits)
	};

	const ownerRole: RoleDoc = {
		id: ownerRef.id,
		serverId: serverRef.id,
		name: 'Owner',
		color: null,
		description: 'Server owner with full permissions',
		position: 1000,
		isOwnerRole: true,
		isEveryoneRole: false,
		mentionable: false,
		allowMassMentions: true,
		permissions: permissionMapFromBits(ownerBits),
		permissionBits: bitsAsNumber(ownerBits)
	};

	await Promise.all([
		setDoc(everyoneRef, { ...everyoneRole, createdAt, updatedAt: createdAt }),
		setDoc(ownerRef, { ...ownerRole, createdAt, updatedAt: createdAt })
	]);

	// Owner as member with full perms
	const ownerRoles = [ownerRole.id, everyoneRole.id];
	const ownerSnapshot = permissionSnapshot({
		rolesById: { [ownerRole.id]: ownerRole, [everyoneRole.id]: everyoneRole },
		memberRoleIds: ownerRoles,
		isServerOwner: true,
		ownerRoleIds: [ownerRole.id]
	});

	await setDoc(doc(db, 'servers', serverRef.id, 'members', uid), {
		uid,
		role: ownerSnapshot.roleTag,
		roleIds: ownerRoles,
		nickname: null,
		joinedAt: createdAt,
		muted: false,
		deafened: false,
		permissions: ownerSnapshot.permissions,
		permissionBits: ownerSnapshot.permissionBits,
		perms: ownerSnapshot.legacyPerms,
		topRolePosition: ownerSnapshot.topRolePosition
	});

	// Default channels
	const channelsCol = collection(db, 'servers', serverRef.id, 'channels');
	const generalRef = doc(channelsCol);
	await setDoc(generalRef, {
		id: generalRef.id,
		type: 'text',
		name: 'general',
		position: 0,
		topic: 'Welcome!',
		createdAt: serverTimestamp()
	});
	const voiceRef = doc(channelsCol);
	await setDoc(voiceRef, {
		id: voiceRef.id,
		type: 'voice',
		name: 'General',
		position: 1,
		bitrate: 64000,
		userLimit: null,
		createdAt
	});

	await updateDoc(serverRef, {
		systemChannelId: generalRef.id,
		defaultRoleId: everyoneRole.id,
		everyoneRoleId: everyoneRole.id,
		ownerRoleId: ownerRole.id
	});

	// Rail mapping
	await upsertUserMembership(serverRef.id, uid, { name: data.name, icon: data.icon ?? null });

	dlog('createServer complete', { serverId: serverRef.id });
	return serverRef.id;
}

/**
 * Hard delete server (shallow – use CF for full cascade in prod)
 */
export async function deleteServer(serverId: string, ownerId: string) {
	const db = getDb();

	const chSnap = await getDocs(collection(db, 'servers', serverId, 'channels'));
	for (const ch of chSnap.docs) {
		const msgs = await getDocs(collection(db, 'servers', serverId, 'channels', ch.id, 'messages'));
		for (const m of msgs.docs) await deleteDoc(m.ref);
		await deleteDoc(ch.ref);
	}

	const memSnap = await getDocs(collection(db, 'servers', serverId, 'members'));
	for (const m of memSnap.docs) await deleteDoc(m.ref);

	const rolesSnap = await getDocs(collection(db, 'servers', serverId, 'roles'));
	for (const r of rolesSnap.docs) await deleteDoc(r.ref);

	await deleteDoc(doc(db, 'servers', serverId));
	await deleteDoc(doc(db, 'profiles', ownerId, 'servers', serverId));

	dlog('deleteServer complete', { serverId });
}

/**
 * Left rail: subscribe to “profiles/{uid}/servers” mapping
 */
export function subscribeUserServers(
	uid: string,
	cb: (
		rows: {
			id: string;
			name: string;
			icon?: string | null;
			position?: number | null;
			joinedAt?: number | null;
		}[]
	) => void
): Unsubscribe {
	const db = getDb();
	const q = query(collection(db, 'profiles', uid, 'servers'), orderBy('joinedAt', 'desc'));

	let current: Record<
		string,
		{
			id: string;
			name: string;
			icon?: string | null;
			position: number | null;
			joinedAt: number | null;
		}
	> = {};
	let serverUnsubs: Record<string, () => void> = {};
	let membershipUnsubs: Record<string, () => void> = {};
	let initializingPositions = false;
	const sortServers = (
		a: { position: number | null; joinedAt: number | null },
		b: { position: number | null; joinedAt: number | null }
	) => {
		if (a.position != null && b.position != null && a.position !== b.position) {
			return a.position - b.position;
		}
		if (a.position != null && b.position == null) return -1;
		if (b.position != null && a.position == null) return 1;
		const aJoin = a.joinedAt ?? 0;
		const bJoin = b.joinedAt ?? 0;
		return bJoin - aJoin;
	};
	const emit = () => {
		const values = Object.values(current).sort(sortServers);
		cb(values);
	};

	const toMillis = (value: any): number | null => {
		if (!value) return null;
		if (typeof value === 'number') return value;
		if (typeof value === 'string') {
			const parsed = Date.parse(value);
			return Number.isFinite(parsed) ? parsed : null;
		}
		if (typeof value?.toMillis === 'function') {
			return value.toMillis();
		}
		if (value instanceof Date) return value.getTime();
		return null;
	};

	async function backfillPositions() {
		if (initializingPositions) return;
		initializingPositions = true;
		try {
			const ordered = Object.values(current)
				.sort((a, b) => (b.joinedAt ?? 0) - (a.joinedAt ?? 0))
				.map((row, index) => ({ id: row.id, position: index * 10 }));
			if (!ordered.length) return;
			const batch = writeBatch(db);
			ordered.forEach((row) => {
				batch.update(doc(db, 'profiles', uid, 'servers', row.id), { position: row.position });
				current[row.id] = { ...current[row.id], position: row.position };
			});
			await batch.commit();
		} catch (err) {
			dlog('backfillPositions error', err);
		} finally {
			initializingPositions = false;
		}
	}

	async function verifyAndMaybePurge(serverId: string) {
		let membershipChecked = false;
		let membershipExists = false;
		try {
			const membership = await getDoc(doc(db, 'servers', serverId, 'members', uid));
			membershipChecked = true;
			membershipExists = membership.exists();
			if (membershipExists) return true;
		} catch (err) {
			dlog('verifyAndMaybePurge membership check failed', { serverId, err });
		}

		let serverExists = false;
		try {
			const serverSnap = await getDoc(doc(db, 'servers', serverId));
			serverExists = serverSnap.exists();
		} catch (err) {
			dlog('verifyAndMaybePurge server check failed', { serverId, err });
		}

		if (!serverExists || membershipChecked) {
			await cleanupServerEntry(serverId);
			return false;
		}

		return true;
	}

	async function cleanupServerEntry(serverId: string) {
		try {
			membershipUnsubs[serverId]?.();
			delete membershipUnsubs[serverId];
		} catch {}
		try {
			serverUnsubs[serverId]?.();
			delete serverUnsubs[serverId];
		} catch {}
		try {
			await deleteDoc(doc(db, 'profiles', uid, 'servers', serverId));
		} catch (err) {
			dlog('cleanupServerEntry delete doc failed', { serverId, err });
		}
		delete current[serverId];
		emit();
	}

	const stop = onSnapshot(q, (snap) => {
		const seen: Record<string, true> = {};
		let needsPositionBackfill = false;
		for (const d of snap.docs) {
			const id = d.id;
			seen[id] = true;
			const data = d.data() as any;
			const existing = current[id];
			const position =
				typeof data.position === 'number' ? data.position : data.position === null ? null : null;
			if (position === null) needsPositionBackfill = true;
			const joinedAt = toMillis(data.joinedAt) ?? null;
			const name =
				(typeof data.name === 'string' && data.name.trim().length ? data.name.trim() : undefined) ??
				existing?.name ??
				'Server';
			const icon =
				(typeof data.icon === 'string' && data.icon.trim().length ? data.icon.trim() : undefined) ??
				existing?.icon ??
				null;
			current[id] = {
				...existing,
				id,
				position,
				joinedAt,
				// Preserve better server doc values if they were already merged in.
				name: existing?.name ?? name,
				icon: existing?.icon ?? icon
			};

			if (!serverUnsubs[id]) {
				const serverRef = doc(db, 'servers', id);
				serverUnsubs[id] = onSnapshot(
					serverRef,
					(sv) => {
						if (!sv.exists()) {
							void verifyAndMaybePurge(id);
							return;
						}
						const payload = sv.data() as any;
						const existing = current[id] ?? {
							id,
							name: payload?.name ?? 'Server',
							icon: null,
							position: null,
							joinedAt: null
						};
						current[id] = {
							...existing,
							name: payload?.name ?? existing.name,
							icon: payload?.icon ?? existing.icon ?? null
						};
						emit();
					},
					() => {
						void verifyAndMaybePurge(id);
					}
				);
				void verifyAndMaybePurge(id);

				const membershipRef = doc(db, 'servers', id, 'members', uid);
				membershipUnsubs[id] = onSnapshot(
					membershipRef,
					(mem) => {
						if (!mem.exists()) {
							void verifyAndMaybePurge(id);
						}
					},
					() => {
						void verifyAndMaybePurge(id);
					}
				);
			}
		}
		for (const id in serverUnsubs) {
			if (!seen[id]) {
				serverUnsubs[id]!();
				delete serverUnsubs[id];
				membershipUnsubs[id]?.();
				delete membershipUnsubs[id];
				delete current[id];
			}
		}
		emit();
		if (needsPositionBackfill) {
			void backfillPositions();
		}
	});

	return () => {
		stop();
		for (const k in serverUnsubs) serverUnsubs[k]!();
		for (const k in membershipUnsubs) membershipUnsubs[k]!();
	};
}

export async function saveServerOrder(uid: string, serverIds: string[]) {
	const db = getDb();
	const batch = writeBatch(db);
	serverIds.forEach((serverId, index) => {
		batch.update(doc(db, 'profiles', uid, 'servers', serverId), { position: index * 10 });
	});
	await batch.commit();
}
