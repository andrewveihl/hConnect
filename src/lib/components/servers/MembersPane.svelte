<script lang="ts">
	import { run } from 'svelte/legacy';

	import { onDestroy, onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import {
		collection,
		doc,
		onSnapshot,
		query,
		orderBy,
		setDoc,
		serverTimestamp,
		type Unsubscribe
	} from 'firebase/firestore';
	import { db } from '$lib/firestore/client';
	import { getOrCreateDMThread } from '$lib/firestore/dms';
	import { resolveProfilePhotoURL, needsPhotoCaching } from '$lib/utils/profile';
	import { user } from '$lib/stores/user';
	import { presenceFromSources, presenceLabels, type PresenceState } from '$lib/presence/state';
	import InvitePanel from '$lib/components/app/InvitePanel.svelte';
	import MemberProfileCard from './MemberProfileCard.svelte';
	import Avatar from '$lib/components/app/Avatar.svelte';

	interface Props {
		serverId: string;
		showHeader?: boolean;
		onHide?: (() => void) | null;
	}

	let { serverId, showHeader = true, onHide = null }: Props = $props();

	type MemberDoc = {
		uid: string;
		nickname?: string | null;
		displayName?: string | null;
		name?: string | null;
		email?: string | null;
		photoURL?: string | null;
		[key: string]: unknown;
	};

	type ProfileDoc = {
		displayName?: string | null;
		name?: string | null;
		email?: string | null;
		photoURL?: string | null;
		[key: string]: unknown;
	};

	type RoleDoc = {
		id: string;
		name: string;
		color?: string | null;
		position?: number;
		showInMemberList?: boolean;
	};

	type MemberRow = {
		uid: string;
		label: string;
		avatar: string | null;
		status: PresenceState;
		tooltip: string;
		baseRole: 'owner' | 'admin' | 'member' | null;
		roles: RoleDoc[];
	};

	type MemberGroup = {
		id: PresenceState;
		label: string;
		members: MemberRow[];
	};

	type PresenceDoc = {
		state?: string | null;
		status?: string | null;
		online?: boolean | null;
		isOnline?: boolean | null;
		active?: boolean | null;
		lastActive?: any;
		lastSeen?: any;
		updatedAt?: any;
		[key: string]: unknown;
	};

	let members: Record<string, MemberDoc> = $state({});
	let profiles: Record<string, ProfileDoc> = $state({});
	let presenceDocs: Record<string, PresenceDoc> = {};
	let roles: Record<string, RoleDoc> = $state({});
	let rows: MemberRow[] = $state([]);
	let groupedRows: MemberGroup[] = $state([]);
	let selectedUid: string | null = $state(null);
	const selectedMember = $derived.by(() =>
		selectedUid ? (rows.find((row) => row.uid === selectedUid) ?? null) : null
	);
	const selectedProfile = $derived.by(() => (selectedUid ? (profiles[selectedUid] ?? null) : null));
	let popoverPos = $state({ top: 0, left: 0 });
	let cardLoading = $state(false);
	let cardError: string | null = $state(null);
	let isMobileView = $state(false);
	const canMessageSelected = $derived.by(() =>
		Boolean(selectedMember && me?.uid && selectedMember.uid !== me?.uid)
	);
	let mediaQuery: MediaQueryList | null = null;
	const me = $derived.by(() => $user);
	const myMember = $derived.by(() =>
		me?.uid ? ((members[me.uid] as MemberDoc | undefined) ?? null) : null
	);
	const myBaseRole = $derived.by(() =>
		typeof (myMember as any)?.role === 'string'
			? ((myMember as any).role as 'owner' | 'admin' | 'member')
			: null
	);
	const canInviteMembers = $derived.by(() => myBaseRole === 'owner');

	const INITIAL_MEMBER_BATCH = 60;
	const MEMBER_BATCH_SIZE = 40;
	const LAZY_LOAD_THRESHOLD = 20;
	let visibleMemberCount = $state(INITIAL_MEMBER_BATCH);
	let shouldLazyLoad = $state(false);
	let hideScrollbarForWheel = $state(false);
	let wheelHideTimer: ReturnType<typeof setTimeout> | null = null;
	let statusBuckets: Record<PresenceState, MemberRow[]> = $state({
		online: [],
		busy: [],
		idle: [],
		offline: []
	});
	let visibleGroupMap: Record<PresenceState, MemberRow[]> = $state({
		online: [],
		busy: [],
		idle: [],
		offline: []
	});
	let allMembersVisible = $state(true);
	let loadMoreSentinel: HTMLDivElement | null = $state(null);
	let memberScrollContainer: HTMLDivElement | null = $state(null);
	let loadObserver: IntersectionObserver | null = null;
	let showInviteDialog = $state(false);

	let membersUnsub: Unsubscribe | null = null;
	let rolesUnsub: Unsubscribe | null = null;
	const profileUnsubs: Record<string, Unsubscribe> = {};
	const presenceUnsubs: Record<string, Unsubscribe> = {};
	const photoCachingInProgress = new Set<string>(); // Track UIDs being cached
	const statusOrder: PresenceState[] = ['online', 'busy', 'idle', 'offline'];
	const statusLabels: Record<PresenceState, string> = presenceLabels;
	const MAX_VISIBLE_MEMBER_ROLES = 2;
	const WHEEL_SCROLLBAR_HIDE_MS = 700;
	// derived above

	/**
	 * Cache a user's Google photo to Firebase Storage if needed.
	 * This runs in the background and updates the profile document when done.
	 * Note: Due to storage rules, we can only cache the current user's own photo.
	 */
	async function maybeCacheGooglePhoto(uid: string, profileData: Record<string, unknown>) {
		// Only cache the current user's photo (storage rules prevent writing to others' paths)
		const currentUid = $user?.uid;
		if (!currentUid || uid !== currentUid) return;

		// Don't cache if already in progress or if not a Google photo
		if (photoCachingInProgress.has(uid)) return;

		const googleUrl = needsPhotoCaching(profileData);
		if (!googleUrl) return;

		// Mark as in progress
		photoCachingInProgress.add(uid);

		try {
			// Dynamically import to avoid circular dependencies
			const { cacheExternalPhoto } = await import('$lib/firebase/storage');
			const { db: getDb } = await import('$lib/firestore/client');

			const cachedUrl = await cacheExternalPhoto({ url: googleUrl, uid });
			if (cachedUrl) {
				// Update the profile with the cached URL
				const database = getDb();
				await setDoc(
					doc(database, 'profiles', uid),
					{
						cachedPhotoURL: cachedUrl,
						photoURL: cachedUrl,
						authPhotoURL: googleUrl,
						updatedAt: serverTimestamp()
					},
					{ merge: true }
				);
			}
		} catch (error) {
			console.warn(`[MembersPane] Failed to cache photo for ${uid}:`, error);
		} finally {
			photoCachingInProgress.delete(uid);
		}
	}

	function clearRolesIfAny() {
		const hasRoles = Object.keys(roles).length > 0;
		if (hasRoles) {
			roles = {};
		}
	}

	function resetMemberVisibility() {
		visibleMemberCount = INITIAL_MEMBER_BATCH;
		syncVisibilityState(0);
	}

	function syncVisibilityState(total: number) {
		const lazy = total > LAZY_LOAD_THRESHOLD;
		shouldLazyLoad = lazy;

		let nextVisible = visibleMemberCount;
		if (!lazy) {
			nextVisible = total;
		} else if (nextVisible < INITIAL_MEMBER_BATCH) {
			nextVisible = Math.min(INITIAL_MEMBER_BATCH, total);
		} else if (nextVisible > total) {
			nextVisible = total;
		}

		if (nextVisible !== visibleMemberCount) {
			visibleMemberCount = nextVisible;
		}
		allMembersVisible = nextVisible >= total;
	}

	function pickString(value: unknown): string | undefined {
		if (typeof value === 'string') {
			const trimmed = value.trim();
			if (trimmed.length) return trimmed;
		}
		return undefined;
	}

	function labelFor(uid: string) {
		const member = members[uid] ?? {};
		const profile = profiles[uid] ?? {};
		return (
			pickString(member.nickname) ??
			pickString(profile.displayName) ??
			pickString(profile.name) ??
			pickString(profile.email) ??
			pickString(member.displayName) ??
			pickString(member.email) ??
			'Member'
		);
	}

	const avatarUrl = (uid: string) => {
		const member = members[uid] ?? {};
		const profile = profiles[uid] ?? {};
		const fallback = pickString(member.photoURL) ?? null;
		// Pass the full profile object which may contain cachedPhotoURL, customPhotoURL, authPhotoURL
		return resolveProfilePhotoURL({ ...member, ...profile }, fallback);
	};

	function presenceState(uid: string): PresenceState {
		return presenceFromSources([presenceDocs[uid], profiles[uid], members[uid]]);
	}

	const statusClass = (state: PresenceState) => {
		switch (state) {
			case 'online':
				return 'presence-dot--online';
			case 'busy':
				return 'presence-dot--busy';
			case 'idle':
				return 'presence-dot--idle';
			default:
				return 'presence-dot--offline';
		}
	};

	function createBucketMap(): Record<PresenceState, MemberRow[]> {
		return {
			online: [],
			busy: [],
			idle: [],
			offline: []
		};
	}

	function getUidFromMemberDoc(d: any, data?: any) {
		const docData = (data ?? d?.data?.() ?? {}) as any;
		return docData.uid ?? docData.userId ?? docData.memberUid ?? d?.id;
	}

	function updateRows() {
		const computed: MemberRow[] = Object.values(members).map((member) => {
			const label = labelFor(member.uid);
			const status = presenceState(member.uid);
			const tooltip = label;
			const baseRole =
				typeof (member as any)?.role === 'string'
					? ((member as any).role as 'owner' | 'admin' | 'member')
					: null;
			const roleIds = Array.isArray((member as any)?.roleIds)
				? ((member as any).roleIds as string[])
				: [];
			const resolvedRoles = roleIds
				.map((id) => roles[id])
				.filter((role): role is RoleDoc => !!role && role.showInMemberList !== false)
				.sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
			return {
				uid: member.uid,
				label,
				avatar: avatarUrl(member.uid),
				status,
				tooltip,
				baseRole,
				roles: resolvedRoles
			};
		});

		rows = computed.sort((a, b) =>
			a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
		);
		syncVisibilityState(rows.length);
		recomputeBuckets();
		recomputeVisibleGroups();
	}

	function recomputeBuckets() {
		const buckets = createBucketMap();
		for (const row of rows) {
			const bucket = buckets[row.status] ?? buckets.offline;
			bucket.push(row);
		}
		statusBuckets = buckets;
		groupedRows = statusOrder.map((status) => ({
			id: status,
			label: statusLabels[status],
			members: buckets[status]
		}));
	}

	function recomputeVisibleGroups() {
		const buckets = statusBuckets;
		if (!shouldLazyLoad) {
			const clone = createBucketMap();
			for (const status of statusOrder) {
				clone[status] = buckets[status] ?? [];
			}
			visibleGroupMap = clone;
			return;
		}

		let remaining = Math.max(0, visibleMemberCount);
		if (remaining === 0) {
			visibleGroupMap = createBucketMap();
			return;
		}

		const limited = createBucketMap();
		for (const status of statusOrder) {
			if (remaining <= 0) break;
			const list = buckets[status] ?? [];
			if (!list.length) continue;
			const slice = list.slice(0, remaining);
			limited[status] = slice;
			remaining -= slice.length;
		}

		visibleGroupMap = limited;
	}

	onMount(() => {
		if (!browser) return;
		mediaQuery = window.matchMedia('(max-width: 640px)');
		const update = () => {
			isMobileView = mediaQuery?.matches ?? false;
		};
		update();
		mediaQuery.addEventListener('change', update);
		return () => {
			mediaQuery?.removeEventListener('change', update);
		};
	});

	function unsubscribePresence(uid: string) {
		if (presenceUnsubs[uid]) {
			presenceUnsubs[uid]!();
			delete presenceUnsubs[uid];
			const { [uid]: _drop, ...rest } = presenceDocs;
			presenceDocs = rest;
		}
	}

	function cleanupProfiles() {
		for (const key in profileUnsubs) {
			profileUnsubs[key]?.();
			delete profileUnsubs[key];
		}
		for (const key in presenceUnsubs) {
			presenceUnsubs[key]?.();
			delete presenceUnsubs[key];
		}
		profiles = {};
		members = {};
		presenceDocs = {};
		roles = {};
		rows = [];
	}

	function openMemberProfile(uid: string, anchorEl?: HTMLElement | null) {
		selectedUid = uid;
		cardError = null;
		cardLoading = false;
		if (anchorEl) {
			const anchorRect = anchorEl.getBoundingClientRect();
			const viewportHeight = browser ? window.innerHeight : 0;
			const center = anchorRect.top + anchorRect.height / 2;
			const clamped =
				viewportHeight > 0 ? Math.min(Math.max(center, 64), viewportHeight - 64) : center;
			popoverPos = {
				top: clamped,
				left: anchorRect.left
			};
		} else {
			popoverPos = { top: 0, left: 0 };
		}
	}

	function closeMemberProfile() {
		selectedUid = null;
		cardError = null;
		cardLoading = false;
	}

	async function startDirectMessage(uid: string) {
		if (!me?.uid || uid === me.uid) return;
		cardError = null;
		cardLoading = true;
		try {
			const thread = await getOrCreateDMThread([me.uid, uid], me.uid);
			if (thread?.id) {
				closeMemberProfile();
				await goto(`/dms/${thread.id}`);
			} else {
				throw new Error('Unable to open direct message.');
			}
		} catch (err: any) {
			cardError = err?.message ?? 'Failed to start DM. Please try again.';
		} finally {
			cardLoading = false;
		}
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (showInviteDialog) {
				showInviteDialog = false;
				return;
			}
			if (selectedUid) {
				closeMemberProfile();
			}
		}
	}

	function openInviteDialog() {
		if (!canInviteMembers) return;
		showInviteDialog = true;
	}

	function closeInviteDialog() {
		showInviteDialog = false;
	}

	function loadMoreMembers() {
		if (!shouldLazyLoad || allMembersVisible) return;
		const next = Math.min(rows.length, visibleMemberCount + MEMBER_BATCH_SIZE);
		if (next !== visibleMemberCount) {
			visibleMemberCount = next;
			syncVisibilityState(rows.length);
		}
	}

	function teardownLoadObserver() {
		loadObserver?.disconnect();
		loadObserver = null;
	}

	function setupLoadObserver() {
		if (!loadMoreSentinel || !shouldLazyLoad) return;
		loadObserver = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					loadMoreMembers();
				}
			},
			{
				root: memberScrollContainer ?? null,
				rootMargin: '0px 0px 200px 0px',
				threshold: 0.1
			}
		);
		loadObserver.observe(loadMoreSentinel);
	}

	function refreshLoadObserver() {
		if (!browser) return;
		teardownLoadObserver();
		if (loadMoreSentinel && shouldLazyLoad) {
			setupLoadObserver();
		}
	}

	function handleMembersWheelScroll() {
		hideScrollbarForWheel = true;
		if (wheelHideTimer) clearTimeout(wheelHideTimer);
		wheelHideTimer = setTimeout(() => {
			hideScrollbarForWheel = false;
			wheelHideTimer = null;
		}, WHEEL_SCROLLBAR_HIDE_MS);
	}

	function resetWheelScrollbarHide() {
		if (wheelHideTimer) {
			clearTimeout(wheelHideTimer);
			wheelHideTimer = null;
		}
		hideScrollbarForWheel = false;
	}

	run(() => {
		loadMoreSentinel;
		memberScrollContainer;
		shouldLazyLoad;
		refreshLoadObserver();
	});

	function subscribePresence(database: ReturnType<typeof db>, uid: string) {
		if (presenceUnsubs[uid]) return;
		const ref = doc(database, 'profiles', uid, 'presence', 'status');
		presenceUnsubs[uid] = onSnapshot(
			ref,
			(snap) => {
				presenceDocs = { ...presenceDocs, [uid]: (snap.data() as PresenceDoc) ?? {} };
				updateRows();
			},
			() => {
				unsubscribePresence(uid);
				updateRows();
			}
		);
	}

	function subscribeRoles(server: string) {
		rolesUnsub?.();
		const database = db();
		const rolesRef = query(
			collection(database, 'servers', server, 'roles'),
			orderBy('position', 'desc')
		);
		rolesUnsub = onSnapshot(
			rolesRef,
			(snap) => {
				const next: Record<string, RoleDoc> = {};
				snap.forEach((roleSnap) => {
					const data = roleSnap.data() as any;
					next[roleSnap.id] = {
						id: roleSnap.id,
						name: data?.name ?? 'Role',
						color: data?.color ?? null,
						position: data?.position ?? 0,
						showInMemberList: data?.showInMemberList !== false
					};
				});
				roles = next;
				updateRows();
			},
			() => {
				roles = {};
				updateRows();
			}
		);
	}

	function subscribeMembers(server: string) {
		visibleMemberCount = INITIAL_MEMBER_BATCH;

		const prevMembersUnsub = untrack(() => membersUnsub);
		prevMembersUnsub?.();
		cleanupProfiles();
		subscribeRoles(server);

		const database = db();
		membersUnsub = onSnapshot(
			collection(database, 'servers', server, 'members'),
			(snap) => {
				const uids: string[] = [];
				const nextMembers: Record<string, MemberDoc> = {};

				for (const docSnap of snap.docs) {
					const data = (docSnap.data?.() ?? {}) as any;
					const uid = getUidFromMemberDoc(docSnap, data);
					uids.push(uid);
					nextMembers[uid] = { uid, ...data };
				}

				members = nextMembers;
				updateRows();

				for (const uid in profileUnsubs) {
					if (!uids.includes(uid)) {
						profileUnsubs[uid]?.();
						delete profileUnsubs[uid];
						const { [uid]: _drop, ...rest } = profiles;
						profiles = rest;
						unsubscribePresence(uid);
					}
				}

				uids.forEach((uid) => {
					if (!profileUnsubs[uid]) {
						profileUnsubs[uid] = onSnapshot(doc(database, 'profiles', uid), (ps) => {
							const profileData = ps.data() ?? {};
							profiles = { ...profiles, [uid]: profileData };
							updateRows();

							// Cache Google photos in the background
							maybeCacheGooglePhoto(uid, profileData as Record<string, unknown>);
						});
					}
					subscribePresence(database, uid);
				});
			},
			(error) => {
				console.warn('[members] failed to subscribe to server members', error);
				members = {};
				profiles = {};
				cleanupProfiles();
				syncVisibilityState(0);
			}
		);
	}

	run(() => {
		if (serverId && $user?.uid) {
			subscribeMembers(serverId);
		} else {
			const prevMembersUnsub = untrack(() => membersUnsub);
			prevMembersUnsub?.();
			membersUnsub = null;
			const prevRolesUnsub = untrack(() => rolesUnsub);
			prevRolesUnsub?.();
			rolesUnsub = null;
			clearRolesIfAny();
			cleanupProfiles();
			resetMemberVisibility();
		}
	});

	onDestroy(() => {
		membersUnsub?.();
		rolesUnsub?.();
		cleanupProfiles();
		teardownLoadObserver();
		if (wheelHideTimer) clearTimeout(wheelHideTimer);
	});
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="members-pane flex flex-col h-full w-full panel text-primary relative">
	{#if showHeader}
		<div
			class="members-pane__header flex items-center gap-3 px-3 py-3 border-b border-subtle text-soft sm:px-4"
		>
			<div class="flex items-center gap-2">
				<span class="text-sm font-semibold sm:text-base text-primary">Members</span>
			</div>
			<div class="ml-auto flex flex-1 items-center justify-end gap-2">
				<span
					class="inline-flex h-7 min-w-[3.5rem] items-center justify-center rounded-full bg-white/[0.08] px-3 text-xs font-semibold text-soft sm:h-8 sm:min-w-[4rem] sm:text-sm"
				>
					{rows.length}
				</span>
			</div>
		</div>
	{/if}
	<div
		class="members-pane__scroll flex flex-1 flex-col overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 touch-pan-y"
		class:members-pane__scroll--wheel={hideScrollbarForWheel}
		bind:this={memberScrollContainer}
		role="region"
		aria-label="Members list"
		onwheel={handleMembersWheelScroll}
		onmouseleave={resetWheelScrollbarHide}
	>
		{#if rows.length}
			<div class="member-groups">
				{#each groupedRows as group (group.id)}
					{#if group.members.length}
						{@const groupMembers = visibleGroupMap[group.id] ?? []}
						<section class="member-group" aria-label={`${group.label} members`}>
							<div class="member-group__header">
								<span class="member-group__count">{group.members.length}</span>
								<span class="member-group__label">{group.label}</span>
							</div>
							<ul class="member-group__list">
								{#if groupMembers.length}
									{#each groupMembers as member (member.uid)}
										{@const isSelfMember = member.uid === me?.uid}
										{@const memberProfile = profiles[member.uid]}
										{@const memberUserObj = isSelfMember
											? { ...members[member.uid], ...memberProfile, authPhotoURL: me?.photoURL }
											: { ...members[member.uid], ...memberProfile }}
										<li>
											<button
												type="button"
												class="member-row"
												onclick={(event) =>
													openMemberProfile(member.uid, event.currentTarget as HTMLElement)}
											>
												<div class="member-row__avatar">
													<Avatar
														src={member.avatar}
														name={member.label}
														user={memberUserObj}
														size="sm"
														showPresence={true}
														presence={member.status}
														isSelf={isSelfMember}
													/>
												</div>
												<div class="member-row__body">
													<div class="member-row__top">
														<span class="member-row__name" title={member.tooltip}>
															{member.label}
														</span>
													</div>
													{#if (member.baseRole && member.baseRole !== 'member') || member.roles.length}
														{@const rolePreview = member.roles.slice(0, MAX_VISIBLE_MEMBER_ROLES)}
														{@const extraRoleCount = Math.max(
															0,
															member.roles.length - rolePreview.length
														)}
														<div class="member-roles member-row__roles">
															{#if member.baseRole === 'owner'}
																<span class="member-role" data-tone="owner">Owner</span>
															{:else if member.baseRole === 'admin'}
																<span class="member-role" data-tone="admin">Admin</span>
															{/if}
															{#each rolePreview as role}
																<span
																	class="member-role"
																	style={role.color
																		? `--member-role-color: ${role.color}`
																		: undefined}
																>
																	{role.name}
																</span>
															{/each}
															{#if extraRoleCount > 0}
																<span class="member-role member-role--more">+{extraRoleCount}</span>
															{/if}
														</div>
													{/if}
												</div>
											</button>
										</li>
									{/each}
								{:else if !allMembersVisible}
									<li>
										<div class="member-row member-row--placeholder">
											Scroll to load {group.label.toLowerCase()} members...
										</div>
									</li>
								{/if}
							</ul>
						</section>
					{/if}
				{/each}
				{#if shouldLazyLoad}
					<div class="members-pane__sentinel" bind:this={loadMoreSentinel} aria-hidden="true">
						{#if allMembersVisible}
							<span class="text-xs text-soft">Showing all {rows.length} members</span>
						{:else}
							<span class="text-xs text-soft"
								>Showing {visibleMemberCount} of {rows.length} members...</span
							>
						{/if}
					</div>
				{/if}
			</div>
		{:else}
			<div class="text-xs text-soft px-2">No members yet.</div>
		{/if}
	</div>
</div>

{#if showInviteDialog && canInviteMembers}
	<div
		class="members-pane__invite-overlay"
		role="dialog"
		aria-modal="true"
		aria-label="Invite members"
	>
		<button
			type="button"
			class="members-pane__invite-backdrop"
			aria-label="Close invite dialog"
			onclick={closeInviteDialog}
		></button>
		<div class="members-pane__invite-card" role="document">
			<div class="members-pane__invite-header">
				<div>
					<h3 class="members-pane__invite-title">Invite members</h3>
					<p class="members-pane__invite-subtitle">Share access with teammates you trust.</p>
				</div>
				<button
					type="button"
					class="members-pane__invite-close"
					aria-label="Close invite dialog"
					onclick={closeInviteDialog}
				>
					<i class="bx bx-x text-xl"></i>
				</button>
			</div>
			<div class="members-pane__invite-body touch-pan-y">
				<InvitePanel {serverId} embedded />
			</div>
		</div>
	</div>
{/if}

<MemberProfileCard
	open={!!selectedMember}
	member={selectedMember}
	profile={selectedProfile}
	statusClassName={statusClass(selectedMember?.status ?? 'offline')}
	isMobile={isMobileView}
	anchorTop={popoverPos.top}
	anchorLeft={popoverPos.left}
	loading={cardLoading}
	error={cardError}
	canMessage={canMessageSelected}
	on:close={closeMemberProfile}
	on:dm={() => selectedMember && startDirectMessage(selectedMember.uid)}
/>

<style>
	.members-pane__scroll {
		scrollbar-gutter: stable;
		scrollbar-width: thin;
		scrollbar-color: color-mix(in srgb, var(--color-text-primary) 15%, transparent) transparent;
	}

	.members-pane__scroll::-webkit-scrollbar {
		width: 8px;
	}

	.members-pane__scroll::-webkit-scrollbar-track {
		background: transparent;
	}

	.members-pane__scroll::-webkit-scrollbar-thumb {
		background: color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		border-radius: 4px;
	}

	.members-pane__scroll::-webkit-scrollbar-thumb:hover {
		background: color-mix(in srgb, var(--color-text-primary) 25%, transparent);
	}

	:global(.members-pane__scroll--wheel) {
		scrollbar-width: none !important;
		-ms-overflow-style: none;
		scrollbar-color: transparent transparent !important;
	}

	:global(.members-pane__scroll--wheel::-webkit-scrollbar) {
		width: 0 !important;
		height: 0 !important;
		background: transparent;
		display: none;
	}

	:global(.members-pane__scroll--wheel::-webkit-scrollbar-thumb),
	:global(.members-pane__scroll--wheel::-webkit-scrollbar-track) {
		display: none;
		background: transparent;
	}
</style>
