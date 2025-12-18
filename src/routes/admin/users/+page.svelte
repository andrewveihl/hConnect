<script lang="ts">
	import type { PageData } from './$types';
	import AdminCard from '$lib/admin/components/AdminCard.svelte';
	import Avatar from '$lib/components/app/Avatar.svelte';
	import { 
		addSuperAdminEmail, 
		removeSuperAdminEmail, 
		refreshAllGooglePhotos, 
		refreshUserGooglePhoto, 
		forceAddUserToServer, 
		fetchAllServers,
		fetchUserGroups,
		fetchUserGroup,
		createUserGroup,
		updateUserGroup,
		deleteUserGroup,
		addUserToGroup,
		removeUserFromGroup,
		syncGroupServers,
		type UserGroup
	} from '$lib/admin/superAdmin';
	import { showAdminToast } from '$lib/admin/stores/toast';
	import { adminNav } from '$lib/admin/stores/adminNav';
	import { ensureFirebaseReady, getDb, reauthenticateWithGoogleForPhoto } from '$lib/firebase';
	import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
	import { logAdminAction } from '$lib/admin/logs';
	import { goto } from '$app/navigation';
	import { isMobileViewport } from '$lib/stores/viewport';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	let users = $state([...data.users]);
	let superAdminSet = $state(new Set((data.superAdmins ?? []).map((email) => email.toLowerCase())));
	let search = $state('');
	let onlyBanned = $state(false);
	let selectedUser: (typeof data.users)[number] | null = $state(null);
	let actionLoading = $state(false);
	let refreshingPhotos = $state(false);
	let refreshingUserPhoto = $state<string | null>(null);

	// Force add to server state
	let showServerPicker = $state(false);
	let serverSearch = $state('');
	let allServers = $state<Array<{ id: string; name: string; memberCount?: number }>>([]);
	let loadingServers = $state(false);
	let addingToServer = $state(false);

	// User Groups state
	let showGroupPicker = $state(false);
	let showGroupEditor = $state(false);
	let userGroups = $state<UserGroup[]>([]);
	let loadingGroups = $state(false);
	let addingToGroup = $state(false);
	let editingGroup = $state<UserGroup | null>(null);
	let groupEditorName = $state('');
	let groupEditorDescription = $state('');
	let groupEditorServerIds = $state<string[]>([]);
	let groupServerSearch = $state('');
	let savingGroup = $state(false);

	const mobileViewport = $derived($isMobileViewport);

	const filteredUsers = $derived(
		users.filter((user) => {
			if (onlyBanned && !user.banned) return false;
			if (!search) return true;
			const q = search.toLowerCase();
			return (
				user.displayName.toLowerCase().includes(q) ||
				user.email.toLowerCase().includes(q) ||
				user.uid.toLowerCase().includes(q)
			);
		})
	);

	const filteredServers = $derived(
		allServers.filter((server) => {
			if (!serverSearch) return true;
			const q = serverSearch.toLowerCase();
			return server.name.toLowerCase().includes(q) || server.id.toLowerCase().includes(q);
		})
	);

	const filteredServersForGroupEditor = $derived(
		allServers.filter((server) => {
			if (!groupServerSearch) return true;
			const q = groupServerSearch.toLowerCase();
			return server.name.toLowerCase().includes(q) || server.id.toLowerCase().includes(q);
		})
	);

	const openServerPicker = async () => {
		showServerPicker = true;
		serverSearch = '';
		if (allServers.length === 0) {
			loadingServers = true;
			try {
				allServers = await fetchAllServers();
			} catch (err) {
				console.error('Failed to load servers:', err);
				showAdminToast({ type: 'error', message: 'Failed to load servers.' });
			} finally {
				loadingServers = false;
			}
		}
	};

	const closeServerPicker = () => {
		showServerPicker = false;
		serverSearch = '';
	};

	const handleForceAddToServer = async (serverId: string, serverName: string) => {
		if (!selectedUser) return;
		addingToServer = true;
		try {
			const result = await forceAddUserToServer(selectedUser.uid, serverId, data.user);
			if (result.ok) {
				showAdminToast({ type: 'success', message: result.message });
				closeServerPicker();
			} else {
				showAdminToast({ type: 'warning', message: result.message });
			}
		} catch (err) {
			console.error('Force add failed:', err);
			showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Failed to add user to server.' });
		} finally {
			addingToServer = false;
		}
	};

	// User Groups functions
	const loadServersIfNeeded = async () => {
		if (allServers.length === 0) {
			loadingServers = true;
			try {
				allServers = await fetchAllServers();
			} catch (err) {
				console.error('Failed to load servers:', err);
			} finally {
				loadingServers = false;
			}
		}
	};

	const openGroupPicker = async () => {
		showGroupPicker = true;
		if (userGroups.length === 0) {
			loadingGroups = true;
			try {
				userGroups = await fetchUserGroups();
			} catch (err) {
				console.error('Failed to load groups:', err);
				showAdminToast({ type: 'error', message: 'Failed to load user groups.' });
			} finally {
				loadingGroups = false;
			}
		}
	};

	const closeGroupPicker = () => {
		showGroupPicker = false;
	};

	const handleAddUserToGroup = async (group: UserGroup) => {
		if (!selectedUser) return;
		addingToGroup = true;
		try {
			const result = await addUserToGroup(selectedUser.uid, group, data.user);
			if (result.ok) {
				showAdminToast({ type: 'success', message: `Added to "${group.name}": ${result.message}` });
				closeGroupPicker();
			} else {
				showAdminToast({ type: 'warning', message: result.message });
			}
		} catch (err) {
			console.error('Add to group failed:', err);
			showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Failed to add user to group.' });
		} finally {
			addingToGroup = false;
		}
	};

	const openGroupEditor = async (group?: UserGroup) => {
		await loadServersIfNeeded();
		// Get the latest version of this group from state
		const latestGroup = group ? userGroups.find(g => g.id === group.id) ?? group : null;
		editingGroup = latestGroup;
		groupEditorName = latestGroup?.name ?? '';
		groupEditorDescription = latestGroup?.description ?? '';
		groupEditorServerIds = latestGroup?.serverIds ? [...latestGroup.serverIds] : [];
		groupServerSearch = '';
		showGroupEditor = true;
		console.log('[openGroupEditor] Group:', latestGroup?.name, 'Members:', latestGroup?.memberUids?.length, 'MemberServers:', Object.keys(latestGroup?.memberServers ?? {}));
	};

	const closeGroupEditor = () => {
		showGroupEditor = false;
		editingGroup = null;
		groupEditorName = '';
		groupEditorDescription = '';
		groupEditorServerIds = [];
		groupServerSearch = '';
	};

	const toggleServerInGroup = (serverId: string) => {
		if (groupEditorServerIds.includes(serverId)) {
			groupEditorServerIds = groupEditorServerIds.filter((id) => id !== serverId);
		} else {
			groupEditorServerIds = [...groupEditorServerIds, serverId];
		}
	};

	const handleSaveGroup = async () => {
		if (!groupEditorName.trim()) {
			showAdminToast({ type: 'error', message: 'Group name is required.' });
			return;
		}
		savingGroup = true;
		try {
			if (editingGroup) {
				const oldServerIds = editingGroup.serverIds;
				const newServerIds = groupEditorServerIds;
				const serversChanged = 
					oldServerIds.length !== newServerIds.length ||
					oldServerIds.some(id => !newServerIds.includes(id)) ||
					newServerIds.some(id => !oldServerIds.includes(id));

				// First update the group metadata
				await updateUserGroup(editingGroup.id, {
					name: groupEditorName.trim(),
					description: groupEditorDescription.trim(),
					serverIds: groupEditorServerIds
				}, data.user);

				let updatedMemberServers = editingGroup.memberServers;
				let syncMessage = '';

				// If servers changed, fetch fresh group data from Firestore and sync members
				if (serversChanged) {
					// Fetch fresh group data to get the latest memberUids
					const freshGroup = await fetchUserGroup(editingGroup.id);
					console.log('[handleSaveGroup] Fresh group from Firestore:', freshGroup?.memberUids?.length, 'members');
					
					if (freshGroup && freshGroup.memberUids.length > 0) {
						console.log('[handleSaveGroup] Syncing servers. Old:', oldServerIds, 'New:', newServerIds, 'Members:', freshGroup.memberUids);
						const syncResult = await syncGroupServers(
							freshGroup,
							oldServerIds,
							newServerIds,
							data.user
						);
						updatedMemberServers = syncResult.updatedMemberServers;
						if (syncResult.addedToServers > 0 || syncResult.removedFromServers > 0) {
							syncMessage = ` Members synced: ${syncResult.message}`;
						}
					}
				}

				// Refetch group to get the latest state after all updates
				const finalGroup = await fetchUserGroup(editingGroup.id);
				userGroups = userGroups.map((g) =>
					g.id === editingGroup!.id
						? { 
								...g, 
								name: groupEditorName.trim(), 
								description: groupEditorDescription.trim(), 
								serverIds: groupEditorServerIds,
								memberUids: finalGroup?.memberUids ?? editingGroup!.memberUids,
								memberServers: finalGroup?.memberServers ?? updatedMemberServers
							}
						: g
				);
				showAdminToast({ type: 'success', message: `Group updated.${syncMessage}` });
			} else {
				const result = await createUserGroup({
					name: groupEditorName.trim(),
					description: groupEditorDescription.trim(),
					serverIds: groupEditorServerIds
				}, data.user);
				userGroups = [...userGroups, {
					id: result.groupId,
					name: groupEditorName.trim(),
					description: groupEditorDescription.trim(),
					serverIds: groupEditorServerIds,
					memberUids: [],
					memberServers: {}
				}];
				showAdminToast({ type: 'success', message: result.message });
			}
			closeGroupEditor();
		} catch (err) {
			console.error('Save group failed:', err);
			showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Failed to save group.' });
		} finally {
			savingGroup = false;
		}
	};

	const handleDeleteGroup = async (group: UserGroup) => {
		if (!confirm(`Delete group "${group.name}"? This cannot be undone.`)) return;
		try {
			await deleteUserGroup(group.id, group.name, data.user);
			userGroups = userGroups.filter((g) => g.id !== group.id);
			showAdminToast({ type: 'success', message: `Group "${group.name}" deleted.` });
		} catch (err) {
			console.error('Delete group failed:', err);
			showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Failed to delete group.' });
		}
	};

	// Group Manager (standalone access)
	let showGroupManager = $state(false);
	let expandedGroupId = $state<string | null>(null);
	let viewingServersGroupId = $state<string | null>(null);
	let viewingMembersGroupId = $state<string | null>(null);
	let groupUserSearch = $state('');
	let selectedUsersForGroup = $state<Set<string>>(new Set());
	let addingUsersToGroup = $state(false);
	let removingUserFromGroup = $state<string | null>(null);

	// Helper to get user info from UID
	const getUserInfo = (uid: string) => {
		return users.find(u => u.uid === uid);
	};

	// Toggle viewing members for a group
	const toggleViewMembers = (groupId: string) => {
		if (viewingMembersGroupId === groupId) {
			viewingMembersGroupId = null;
		} else {
			viewingMembersGroupId = groupId;
		}
	};

	// Remove user from group
	const handleRemoveUserFromGroup = async (uid: string, group: UserGroup) => {
		const serversToRemove = group.memberServers?.[uid] ?? [];
		const serverCount = serversToRemove.length;
		const confirmMsg = serverCount > 0
			? `Remove this user from "${group.name}"?\n\nThis will remove them from ${serverCount} server(s) that were added by this group.`
			: `Remove this user from "${group.name}"?\n\nNo servers were tracked for this user.`;
		if (!confirm(confirmMsg)) return;
		removingUserFromGroup = uid;
		try {
			const result = await removeUserFromGroup(uid, group, data.user);
			// Update local state - remove from memberUids and memberServers
			userGroups = userGroups.map(g => {
				if (g.id !== group.id) return g;
				const newMemberServers = { ...g.memberServers };
				delete newMemberServers[uid];
				return {
					...g,
					memberUids: g.memberUids.filter(id => id !== uid),
					memberServers: newMemberServers
				};
			});
			showAdminToast({ 
				type: result.failed === 0 ? 'success' : 'warning', 
				message: `Removed from "${group.name}": ${result.message}` 
			});
		} catch (err) {
			console.error('Remove user from group failed:', err);
			showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Failed to remove user.' });
		} finally {
			removingUserFromGroup = null;
		}
	};

	// Helper to get server names from IDs
	const getServerNamesForGroup = (serverIds: string[]) => {
		return serverIds.map(id => {
			const server = allServers.find(s => s.id === id);
			return server ? server.name : id;
		});
	};

	const toggleViewServers = async (groupId: string) => {
		if (viewingServersGroupId === groupId) {
			viewingServersGroupId = null;
		} else {
			// Load servers if needed
			if (allServers.length === 0) {
				loadingServers = true;
				try {
					allServers = await fetchAllServers();
				} catch (err) {
					console.error('Failed to load servers:', err);
				} finally {
					loadingServers = false;
				}
			}
			viewingServersGroupId = groupId;
		}
	};

	const filteredUsersForGroup = $derived(
		users.filter((user) => {
			if (!groupUserSearch) return true;
			const q = groupUserSearch.toLowerCase();
			return (
				user.displayName.toLowerCase().includes(q) ||
				user.email.toLowerCase().includes(q)
			);
		})
	);

	const openGroupManager = async () => {
		showGroupManager = true;
		// Always refetch groups to get fresh memberUids/memberServers data
		loadingGroups = true;
		try {
			userGroups = await fetchUserGroups();
		} catch (err) {
			console.error('Failed to load groups:', err);
			showAdminToast({ type: 'error', message: 'Failed to load user groups.' });
		} finally {
			loadingGroups = false;
		}
	};

	const closeGroupManager = () => {
		showGroupManager = false;
		expandedGroupId = null;
		viewingServersGroupId = null;
		viewingMembersGroupId = null;
		groupUserSearch = '';
		selectedUsersForGroup = new Set();
	};

	const toggleGroupExpanded = (groupId: string) => {
		if (expandedGroupId === groupId) {
			expandedGroupId = null;
			groupUserSearch = '';
			selectedUsersForGroup = new Set();
		} else {
			expandedGroupId = groupId;
			groupUserSearch = '';
			selectedUsersForGroup = new Set();
		}
	};

	const toggleUserForGroup = (uid: string) => {
		const newSet = new Set(selectedUsersForGroup);
		if (newSet.has(uid)) {
			newSet.delete(uid);
		} else {
			newSet.add(uid);
		}
		selectedUsersForGroup = newSet;
	};

	const selectAllFilteredUsers = () => {
		const newSet = new Set(selectedUsersForGroup);
		for (const user of filteredUsersForGroup) {
			newSet.add(user.uid);
		}
		selectedUsersForGroup = newSet;
	};

	const clearSelectedUsers = () => {
		selectedUsersForGroup = new Set();
	};

	const handleAddSelectedUsersToGroup = async (group: UserGroup) => {
		if (selectedUsersForGroup.size === 0) {
			showAdminToast({ type: 'warning', message: 'No users selected.' });
			return;
		}
		addingUsersToGroup = true;
		let totalAdded = 0;
		let totalSkipped = 0;
		let totalFailed = 0;
		const addedUids: string[] = [];
		const newMemberServers: Record<string, string[]> = { ...group.memberServers };
		try {
			for (const uid of selectedUsersForGroup) {
				try {
					const result = await addUserToGroup(uid, group, data.user);
					totalAdded += result.added;
					totalSkipped += result.skipped;
					totalFailed += result.failed;
					addedUids.push(uid);
					newMemberServers[uid] = result.serversAdded;
				} catch (err) {
					console.error(`Failed to add user ${uid} to group:`, err);
					totalFailed++;
				}
			}
			// Refetch groups to get authoritative memberUids/memberServers from Firestore
			try {
				userGroups = await fetchUserGroups();
			} catch {
				// Fallback to local update if refetch fails
				userGroups = userGroups.map(g => 
					g.id === group.id 
						? { ...g, memberUids: [...new Set([...g.memberUids, ...addedUids])], memberServers: newMemberServers }
						: g
				);
			}
			const parts: string[] = [];
			if (totalAdded > 0) parts.push(`${totalAdded} added`);
			if (totalSkipped > 0) parts.push(`${totalSkipped} already members`);
			if (totalFailed > 0) parts.push(`${totalFailed} failed`);
			showAdminToast({ 
				type: totalFailed === 0 ? 'success' : 'warning', 
				message: `${selectedUsersForGroup.size} user(s) → "${group.name}": ${parts.join(', ') || 'Done'}` 
			});
			selectedUsersForGroup = new Set();
			groupUserSearch = '';
			expandedGroupId = null;
			// Auto-expand members view to show the updated list
			viewingMembersGroupId = group.id;
		} catch (err) {
			console.error('Add users to group failed:', err);
			showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Failed to add users to group.' });
		} finally {
			addingUsersToGroup = false;
		}
	};

	const selectUser = (user: (typeof data.users)[number]) => {
		selectedUser = user;
		if (mobileViewport) {
			adminNav.showDetail(user.uid);
		}
	};

	const toggleBan = async (uid: string, banned: boolean) => {
		actionLoading = true;
		try {
			await ensureFirebaseReady();
			const db = getDb();
			await updateDoc(doc(db, 'profiles', uid), {
				'status.banned': !banned,
				'status.updatedAt': serverTimestamp()
			});
			users = users.map((user) => (user.uid === uid ? { ...user, banned: !banned } : user));
			if (selectedUser?.uid === uid) {
				selectedUser = { ...selectedUser, banned: !banned };
			}
			await logAdminAction({
				type: 'permissions',
				level: 'warning',
				message: `${!banned ? 'Banned' : 'Unbanned'} user ${uid}`,
				data: {
					action: !banned ? 'user:ban' : 'user:unban',
					targetUid: uid
				},
				userId: data.user.uid
			});
			showAdminToast({ type: 'success', message: !banned ? 'User banned.' : 'User unbanned.' });
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Unable to update user.'
			});
		} finally {
			actionLoading = false;
		}
	};

	const toggleSuperAdmin = async (email: string, makeAdmin: boolean) => {
		if (!email) {
			showAdminToast({ type: 'error', message: 'User email required for Super Admin.' });
			return;
		}
		actionLoading = true;
		try {
			if (makeAdmin) {
				await addSuperAdminEmail(email, data.user);
				showAdminToast({ type: 'success', message: 'Super Admin granted.' });
				superAdminSet.add(email.toLowerCase());
			} else {
				await removeSuperAdminEmail(email, data.user);
				showAdminToast({ type: 'warning', message: 'Super Admin removed.' });
				superAdminSet.delete(email.toLowerCase());
			}
			superAdminSet = new Set(superAdminSet);
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Unable to update Super Admin.'
			});
		} finally {
			actionLoading = false;
		}
	};

	const formatDate = (value: Date | null | undefined) =>
		value ? value.toLocaleDateString() : '--';
	const formatDateTime = (value: Date | null | undefined) =>
		value ? value.toLocaleString() : '--';

	const isSuperAdmin = (email: string) => superAdminSet.has(email.toLowerCase());

	const handleRefreshGooglePhotos = async () => {
		if (refreshingPhotos) return;
		
		if (!confirm('This will refresh Google profile photos for ALL users.\n\nUsers with custom uploaded photos will NOT be affected.\n\nThis may take a few minutes. Continue?')) {
			return;
		}
		
		refreshingPhotos = true;
		showAdminToast({ type: 'info', message: 'Refreshing Google photos... This may take a few minutes.' });
		
		try {
			const result = await refreshAllGooglePhotos();
			
			if (result.ok) {
				showAdminToast({ 
					type: 'success', 
					message: result.message 
				});
				
				await logAdminAction({
					type: 'adminAction',
					level: 'info',
					message: `Refreshed Google profile photos for ${result.synced} users`,
					data: {
						action: 'photos:refreshAll',
						result: {
							total: result.total,
							synced: result.synced,
							skipped: result.skipped,
							failed: result.failed,
							noAuthPhoto: result.noAuthPhoto
						}
					},
					userId: data.user.uid
				});
			} else {
				showAdminToast({ type: 'error', message: 'Failed to refresh photos.' });
			}
		} catch (err) {
			console.error('Error refreshing Google photos:', err);
			showAdminToast({ 
				type: 'error', 
				message: (err as Error)?.message ?? 'Failed to refresh Google photos.' 
			});
		} finally {
			refreshingPhotos = false;
		}
	};

	const handleRefreshUserPhoto = async (uid: string, force = false) => {
		if (refreshingUserPhoto) return;
		
		refreshingUserPhoto = uid;
		
		try {
			const result = await refreshUserGooglePhoto(uid, force);
			console.log('[handleRefreshUserPhoto] Result:', result);
			
			if (result.ok && result.photoURL) {
				// Test if the image is actually loadable
				const testImg = new Image();
				testImg.onload = () => {
					console.log('[handleRefreshUserPhoto] Image test PASSED - URL is loadable:', result.photoURL?.substring(0, 80));
				};
				testImg.onerror = () => {
					console.error('[handleRefreshUserPhoto] Image test FAILED - URL not loadable:', result.photoURL);
				};
				testImg.src = result.photoURL;
				
				// Copy URL to clipboard
				try {
					await navigator.clipboard.writeText(result.photoURL);
					showAdminToast({ type: 'success', message: `Photo refreshed! URL copied to clipboard.` });
				} catch {
					showAdminToast({ type: 'success', message: `Photo refreshed!` });
				}
				
				// Log full URL for debugging - use prompt() so user can copy
				console.log('[handleRefreshUserPhoto] Full photo URL:', result.photoURL);
				console.log('[handleRefreshUserPhoto] Original Google URL:', (result as any).googleURL);
				const debugInfo = `Cached URL (in Storage):\n${result.photoURL}\n\nOriginal Google URL:\n${(result as any).googleURL || 'N/A'}`;
				prompt('Cached Photo URL (Ctrl+C to copy):', result.photoURL);
				alert(debugInfo);
				
				// Update local state with new photo URL
				const newPhotoURL = result.photoURL;
				users = users.map(u => u.uid === uid ? { ...u, photoURL: newPhotoURL } : u);
				if (selectedUser?.uid === uid) {
					selectedUser = { ...selectedUser, photoURL: newPhotoURL };
				}
				console.log('[handleRefreshUserPhoto] Updated local state with:', newPhotoURL);
			} else if (result.ok) {
				// ok but no photoURL returned - shouldn't happen but handle it
				showAdminToast({ type: 'warning', message: result.message || 'Photo updated but no URL returned.' });
			} else {
				// Check if this is a default avatar issue and it's the current user
				if (result.reason === 'default_avatar' && uid === data.user.uid) {
					const doReauth = confirm(
						'This user has a default Google avatar. Since this is YOUR account, would you like to re-sign in with Google to fetch fresh profile data?\n\nThis will open a Google sign-in popup.'
					);
					if (doReauth) {
						await handleReauthWithGoogle();
						return;
					}
				}
				
				showAdminToast({ 
					type: result.reason === 'has_custom_photo' ? 'warning' : 'error', 
					message: result.message 
				});
			}
		} catch (err) {
			console.error('Error refreshing user photo:', err);
			showAdminToast({ 
				type: 'error', 
				message: (err as Error)?.message ?? 'Failed to refresh photo.' 
			});
		} finally {
			refreshingUserPhoto = null;
		}
	};
	
	const handleReauthWithGoogle = async () => {
		refreshingUserPhoto = data.user.uid;
		
		try {
			showAdminToast({ type: 'info', message: 'Opening Google sign-in...' });
			const result = await reauthenticateWithGoogleForPhoto();
			
			if (result.success && result.photoURL) {
				showAdminToast({ type: 'success', message: 'Photo refreshed from Google!' });
				
				// Update local state
				users = users.map(u => u.uid === data.user.uid ? { ...u, photoURL: result.photoURL! } : u);
				if (selectedUser?.uid === data.user.uid) {
					selectedUser = { ...selectedUser, photoURL: result.photoURL! };
				}
				
				prompt('New Photo URL:', result.photoURL);
			} else if (result.success) {
				showAdminToast({ type: 'warning', message: 'Re-authenticated but no photo found in Google account.' });
			} else {
				showAdminToast({ type: 'error', message: result.error || 'Re-authentication failed.' });
			}
		} catch (err) {
			console.error('Error re-authenticating:', err);
			showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Failed to re-authenticate.' });
		} finally {
			refreshingUserPhoto = null;
		}
	};
</script>

<div class="admin-page">
	<div class="flex flex-col gap-4 lg:flex-row">
		<!-- Users List -->
		<div class="flex-1 lg:max-w-lg">
			<AdminCard title="Users" description="Manage user accounts and permissions." padded={false}>
				<div class="flex flex-col">
					<!-- Search & Filters -->
					<div
						class="space-y-3 border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
					>
						<div class="relative">
							<i
								class="bx bx-search absolute left-3 top-1/2 -translate-y-1/2 text-lg text-[color:var(--text-50,#94a3b8)]"
							></i>
							<input
								type="search"
								placeholder="Search name, email, or UID..."
								class="w-full rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent py-2.5 pl-10 pr-4 text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-[color:var(--accent-primary,#14b8a6)] focus:outline-none"
								bind:value={search}
							/>
						</div>
						<div class="flex flex-wrap items-center gap-3">
							<label
								class="flex cursor-pointer items-center gap-2 text-sm text-[color:var(--text-70,#475569)]"
							>
								<input type="checkbox" bind:checked={onlyBanned} class="sr-only" />
								<div
									class="flex h-5 w-9 items-center rounded-full p-0.5 transition-colors"
									class:bg-rose-500={onlyBanned}
									class:bg-slate-300={!onlyBanned}
								>
									<div
										class="h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
										class:translate-x-4={onlyBanned}
									></div>
								</div>
								Banned only
							</label>
							<span class="text-xs text-[color:var(--text-50,#94a3b8)]">
								{filteredUsers.length}
								{filteredUsers.length === 1 ? 'user' : 'users'}
							</span>
						</div>
					</div>

					<!-- User List -->
					<div class="max-h-[60vh] overflow-y-auto p-4" style="-webkit-overflow-scrolling: touch;">
						{#if filteredUsers.length === 0}
							<div class="flex flex-col items-center justify-center py-8 text-center">
								<i class="bx bx-user-x text-4xl text-[color:var(--text-40,#94a3b8)]"></i>
								<p class="mt-2 text-sm text-[color:var(--text-60,#6b7280)]">No users found.</p>
							</div>
						{:else}
							<div class="space-y-2">
								{#each filteredUsers as user}
									<button
										type="button"
										class="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition"
										class:border-[color:var(--accent-primary,#14b8a6)]={selectedUser?.uid ===
											user.uid}
										class:bg-[color-mix(in_srgb,var(--accent-primary,#14b8a6)8%,transparent)]={selectedUser?.uid ===
											user.uid}
										class:border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)]={selectedUser?.uid !==
											user.uid}
										onclick={() => selectUser(user)}
									>
									<Avatar
										name={user.displayName || user.email || '?'}
										src={user.photoURL}
										size="md"
									/>
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-2">
												<p class="truncate font-semibold text-[color:var(--color-text-primary)]">
													{user.displayName || 'Unnamed'}
												</p>
												{#if isSuperAdmin(user.email)}
													<span
														class="rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white"
													>
														Admin
													</span>
												{/if}
											</div>
											<p class="truncate text-xs text-[color:var(--text-60,#6b7280)]">
												{user.email || '--'}
											</p>
										</div>
										<span
											class={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
												user.banned
													? 'bg-rose-500/20 text-rose-600'
													: 'bg-emerald-500/20 text-emerald-600'
											}`}
										>
											{user.banned ? 'Banned' : 'Active'}
										</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Quick Actions -->
					<div
						class="border-t border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4 space-y-2"
					>
						<button
							type="button"
							class="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
							onclick={openGroupManager}
						>
							<i class="bx bx-group"></i>
							Manage User Groups
						</button>
						<button
							type="button"
							class="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
							onclick={() => goto('/admin/super-admins')}
						>
							<i class="bx bx-shield-quarter"></i>
							Manage Super Admins
						</button>
						<button
							type="button"
							class="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
							onclick={handleRefreshGooglePhotos}
							disabled={refreshingPhotos}
						>
							{#if refreshingPhotos}
								<i class="bx bx-loader-alt animate-spin"></i>
								Refreshing Photos...
							{:else}
								<i class="bx bx-refresh"></i>
								Refresh Google Photos
							{/if}
						</button>
					</div>
				</div>
			</AdminCard>
		</div>

		<!-- User Detail Panel -->
		<div class="flex-1">
			{#if selectedUser}
				<AdminCard title="User Details" description="View and manage user information.">
					<div class="space-y-6">
						<!-- User Header -->
						<div class="flex items-center gap-4">
							<Avatar
								name={selectedUser.displayName || selectedUser.email || '?'}
								src={selectedUser.photoURL}
								size="xl"
							/>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<h3 class="text-lg font-bold text-[color:var(--color-text-primary)]">
										{selectedUser.displayName || 'Unnamed User'}
									</h3>
									{#if isSuperAdmin(selectedUser.email)}
										<span
											class="rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white"
										>
											Super Admin
										</span>
									{/if}
								</div>
								<p class="mt-0.5 truncate text-sm text-[color:var(--text-60,#6b7280)]">
									{selectedUser.email || 'No email'}
								</p>
							</div>
						</div>

						<!-- Info Grid -->
						<div class="grid gap-3 sm:grid-cols-2">
							<div
								class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-3"
							>
								<p
									class="text-xs font-medium uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]"
								>
									User ID
								</p>
								<p class="mt-1 truncate font-mono text-xs text-[color:var(--color-text-primary)]">
									{selectedUser.uid}
								</p>
							</div>
							<div
								class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-3"
							>
								<p
									class="text-xs font-medium uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]"
								>
									Status
								</p>
								<p class="mt-1">
									<span
										class={`rounded-full px-2 py-0.5 text-xs font-semibold ${
											selectedUser.banned
												? 'bg-rose-500/20 text-rose-600'
												: 'bg-emerald-500/20 text-emerald-600'
										}`}
									>
										{selectedUser.banned ? 'Banned' : 'Active'}
									</span>
								</p>
							</div>
							<div
								class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-3"
							>
								<p
									class="text-xs font-medium uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]"
								>
									Created
								</p>
								<p class="mt-1 text-sm text-[color:var(--color-text-primary)]">
									{formatDate(selectedUser.createdAt)}
								</p>
							</div>
							<div
								class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-3"
							>
								<p
									class="text-xs font-medium uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]"
								>
									Last Seen
								</p>
								<p class="mt-1 text-sm text-[color:var(--color-text-primary)]">
									{formatDateTime(selectedUser.lastSeen)}
								</p>
							</div>
						</div>

						<!-- Actions -->
						<div class="space-y-3">
							<p
								class="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]"
							>
								Actions
							</p>

							<!-- Ban/Unban -->
							<button
								type="button"
								class={`flex w-full items-center justify-between rounded-xl border p-4 transition ${
									selectedUser.banned
										? 'border-emerald-500/30 hover:bg-emerald-500/5'
										: 'border-rose-500/30 hover:bg-rose-500/5'
								}`}
								onclick={() => toggleBan(selectedUser!.uid, selectedUser!.banned)}
								disabled={actionLoading}
							>
								<div class="flex items-center gap-3">
									<div
										class={`flex h-10 w-10 items-center justify-center rounded-lg ${
											selectedUser.banned ? 'bg-emerald-500/20' : 'bg-rose-500/20'
										}`}
									>
										<i
											class="bx text-lg"
											class:bx-block={!selectedUser.banned}
											class:text-rose-500={!selectedUser.banned}
											class:bx-check={selectedUser.banned}
											class:text-emerald-500={selectedUser.banned}
										></i>
									</div>
									<div>
										<p class="font-medium text-[color:var(--color-text-primary)]">
											{selectedUser.banned ? 'Unban User' : 'Ban User'}
										</p>
										<p class="text-xs text-[color:var(--text-60,#6b7280)]">
											{selectedUser.banned
												? 'Restore access to the platform'
												: 'Prevent user from accessing the platform'}
										</p>
									</div>
								</div>
								{#if actionLoading}
									<i
										class="bx bx-loader-alt animate-spin text-xl text-[color:var(--text-50,#94a3b8)]"
									></i>
								{:else}
									<i class="bx bx-chevron-right text-xl text-[color:var(--text-50,#94a3b8)]"></i>
								{/if}
							</button>

							<!-- Super Admin Toggle -->
							{#if selectedUser.email}
								<button
									type="button"
									class="flex w-full items-center justify-between rounded-xl border border-amber-500/30 p-4 transition hover:bg-amber-500/5"
									onclick={() =>
										toggleSuperAdmin(selectedUser!.email, !isSuperAdmin(selectedUser!.email))}
									disabled={actionLoading}
								>
									<div class="flex items-center gap-3">
										<div
											class="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/20"
										>
											<i class="bx bx-shield-quarter text-lg text-amber-500"></i>
										</div>
										<div>
											<p class="font-medium text-[color:var(--color-text-primary)]">
												{isSuperAdmin(selectedUser.email)
													? 'Remove Super Admin'
													: 'Grant Super Admin'}
											</p>
											<p class="text-xs text-[color:var(--text-60,#6b7280)]">
												{isSuperAdmin(selectedUser.email)
													? 'Revoke administrative privileges'
													: 'Grant full administrative access'}
											</p>
										</div>
									</div>
									{#if actionLoading}
										<i
											class="bx bx-loader-alt animate-spin text-xl text-[color:var(--text-50,#94a3b8)]"
										></i>
									{:else}
										<i class="bx bx-chevron-right text-xl text-[color:var(--text-50,#94a3b8)]"></i>
									{/if}
								</button>
							{/if}

							<!-- Refresh Google Photo -->
							<button
								type="button"
								class="flex w-full items-center justify-between rounded-xl border border-blue-500/30 p-4 transition hover:bg-blue-500/5"
								onclick={() => handleRefreshUserPhoto(selectedUser!.uid, selectedUser!.hasCustomPhoto)}
								disabled={refreshingUserPhoto === selectedUser.uid}
							>
								<div class="flex items-center gap-3">
									<div
										class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/20"
									>
										<i class="bx bx-refresh text-lg text-blue-500"></i>
									</div>
									<div>
										<p class="font-medium text-[color:var(--color-text-primary)]">
											Refresh Google Photo
										</p>
										<p class="text-xs text-[color:var(--text-60,#6b7280)]">
											{selectedUser.hasCustomPhoto 
												? 'Has custom photo - will force refresh' 
												: 'Pull latest photo from Google account'}
										</p>
									</div>
								</div>
								{#if refreshingUserPhoto === selectedUser.uid}
									<i
										class="bx bx-loader-alt animate-spin text-xl text-[color:var(--text-50,#94a3b8)]"
									></i>
								{:else}
									<i class="bx bx-chevron-right text-xl text-[color:var(--text-50,#94a3b8)]"></i>
								{/if}
							</button>
							
							<!-- Re-authenticate with Google (only for current user) -->
							{#if selectedUser.uid === data.user.uid}
								<button
									type="button"
									class="flex w-full items-center justify-between rounded-xl border border-green-500/30 p-4 transition hover:bg-green-500/5"
									onclick={() => handleReauthWithGoogle()}
									disabled={!!refreshingUserPhoto}
								>
									<div class="flex items-center gap-3">
										<div
											class="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/20"
										>
											<i class="bx bxl-google text-lg text-green-500"></i>
										</div>
										<div>
											<p class="font-medium text-[color:var(--color-text-primary)]">
												Re-sign in with Google
											</p>
											<p class="text-xs text-[color:var(--text-60,#6b7280)]">
												Fetch fresh profile data directly from Google
											</p>
										</div>
									</div>
									{#if refreshingUserPhoto === data.user.uid}
										<i
											class="bx bx-loader-alt animate-spin text-xl text-[color:var(--text-50,#94a3b8)]"
										></i>
									{:else}
										<i class="bx bx-chevron-right text-xl text-[color:var(--text-50,#94a3b8)]"></i>
									{/if}
								</button>
							{/if}

							<!-- Force Add to Server -->
							<button
								type="button"
								class="flex w-full items-center justify-between rounded-xl border border-purple-500/30 p-4 transition hover:bg-purple-500/5"
								onclick={openServerPicker}
								disabled={addingToServer}
							>
								<div class="flex items-center gap-3">
									<div
										class="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/20"
									>
										<i class="bx bx-server text-lg text-purple-500"></i>
									</div>
									<div>
										<p class="font-medium text-[color:var(--color-text-primary)]">
											Force Add to Server
										</p>
										<p class="text-xs text-[color:var(--text-60,#6b7280)]">
											Bypass invite flow and add user directly to a server
										</p>
									</div>
								</div>
								{#if addingToServer}
									<i
										class="bx bx-loader-alt animate-spin text-xl text-[color:var(--text-50,#94a3b8)]"
									></i>
								{:else}
									<i class="bx bx-chevron-right text-xl text-[color:var(--text-50,#94a3b8)]"></i>
								{/if}
							</button>

							<!-- Add to User Group -->
							<button
								type="button"
								class="flex w-full items-center justify-between rounded-xl border border-indigo-500/30 p-4 transition hover:bg-indigo-500/5"
								onclick={openGroupPicker}
								disabled={addingToGroup}
							>
								<div class="flex items-center gap-3">
									<div
										class="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/20"
									>
										<i class="bx bx-group text-lg text-indigo-500"></i>
									</div>
									<div>
										<p class="font-medium text-[color:var(--color-text-primary)]">
											Add to User Group
										</p>
										<p class="text-xs text-[color:var(--text-60,#6b7280)]">
											Add user to multiple servers at once via predefined groups
										</p>
									</div>
								</div>
								{#if addingToGroup}
									<i
										class="bx bx-loader-alt animate-spin text-xl text-[color:var(--text-50,#94a3b8)]"
									></i>
								{:else}
									<i class="bx bx-chevron-right text-xl text-[color:var(--text-50,#94a3b8)]"></i>
								{/if}
							</button>
						</div>
					</div>
				</AdminCard>
			{:else}
				<div
					class="flex h-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] p-8 text-center"
				>
					<div
						class="flex h-16 w-16 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)]"
					>
						<i class="bx bx-user text-3xl text-[color:var(--text-50,#94a3b8)]"></i>
					</div>
					<p class="mt-4 font-semibold text-[color:var(--color-text-primary)]">No User Selected</p>
					<p class="mt-1 text-sm text-[color:var(--text-60,#6b7280)]">
						Select a user from the list to view details and manage their account.
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Server Picker Modal -->
{#if showServerPicker && selectedUser}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={closeServerPicker}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="relative mx-4 flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-[color:var(--surface-panel,#1e293b)] shadow-2xl"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-4">
				<div>
					<h3 class="text-lg font-bold text-[color:var(--color-text-primary)]">
						Add to Server
					</h3>
					<p class="text-xs text-[color:var(--text-60,#6b7280)]">
						Adding: {selectedUser.displayName || selectedUser.email}
					</p>
				</div>
				<button
					type="button"
					class="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--text-60,#6b7280)] transition hover:bg-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] hover:text-[color:var(--color-text-primary)]"
					onclick={closeServerPicker}
					aria-label="Close server picker"
				>
					<i class="bx bx-x text-xl"></i>
				</button>
			</div>

			<!-- Search -->
			<div class="border-b border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-4">
				<div class="relative">
					<i
						class="bx bx-search absolute left-3 top-1/2 -translate-y-1/2 text-lg text-[color:var(--text-50,#94a3b8)]"
					></i>
					<input
						type="search"
						placeholder="Search servers..."
						class="w-full rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent py-2.5 pl-10 pr-4 text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-[color:var(--accent-primary,#14b8a6)] focus:outline-none"
						bind:value={serverSearch}
					/>
				</div>
			</div>

			<!-- Server List -->
			<div class="flex-1 overflow-y-auto p-4" style="-webkit-overflow-scrolling: touch;">
				{#if loadingServers}
					<div class="flex flex-col items-center justify-center py-8">
						<i class="bx bx-loader-alt animate-spin text-3xl text-[color:var(--text-50,#94a3b8)]"></i>
						<p class="mt-2 text-sm text-[color:var(--text-60,#6b7280)]">Loading servers...</p>
					</div>
				{:else if filteredServers.length === 0}
					<div class="flex flex-col items-center justify-center py-8">
						<i class="bx bx-server text-3xl text-[color:var(--text-40,#94a3b8)]"></i>
						<p class="mt-2 text-sm text-[color:var(--text-60,#6b7280)]">
							{serverSearch ? 'No servers match your search.' : 'No servers found.'}
						</p>
					</div>
				{:else}
					<div class="space-y-2">
						{#each filteredServers as server (server.id)}
							<button
								type="button"
								class="flex w-full items-center justify-between rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-3 text-left transition hover:border-purple-500/30 hover:bg-purple-500/5"
								onclick={() => handleForceAddToServer(server.id, server.name)}
								disabled={addingToServer}
							>
								<div class="flex items-center gap-3">
									<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/20">
										<i class="bx bx-server text-lg text-purple-500"></i>
									</div>
									<div class="min-w-0 flex-1">
										<p class="truncate font-medium text-[color:var(--color-text-primary)]">
											{server.name}
										</p>
										<p class="truncate text-xs text-[color:var(--text-60,#6b7280)]">
											{server.id}
										</p>
									</div>
								</div>
								{#if addingToServer}
									<i class="bx bx-loader-alt animate-spin text-lg text-purple-500"></i>
								{:else}
									<i class="bx bx-plus text-lg text-[color:var(--text-50,#94a3b8)]"></i>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="border-t border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-4">
				<p class="text-center text-xs text-[color:var(--text-50,#94a3b8)]">
					{filteredServers.length} of {allServers.length} servers
				</p>
			</div>
		</div>
	</div>
{/if}

<!-- User Group Picker Modal -->
{#if showGroupPicker && selectedUser}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={closeGroupPicker}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="relative mx-4 flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-[color:var(--surface-panel,#1e293b)] shadow-2xl"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-4">
				<div>
					<h3 class="text-lg font-bold text-[color:var(--color-text-primary)]">
						Add to User Group
					</h3>
					<p class="text-xs text-[color:var(--text-60,#6b7280)]">
						Adding: {selectedUser.displayName || selectedUser.email}
					</p>
				</div>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="flex h-8 items-center gap-1.5 rounded-lg bg-indigo-500/20 px-3 text-xs font-medium text-indigo-400 transition hover:bg-indigo-500/30"
						onclick={() => { closeGroupPicker(); openGroupEditor(); }}
					>
						<i class="bx bx-plus"></i>
						New Group
					</button>
					<button
						type="button"
						class="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--text-60,#6b7280)] transition hover:bg-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] hover:text-[color:var(--color-text-primary)]"
						onclick={closeGroupPicker}
						aria-label="Close group picker"
					>
						<i class="bx bx-x text-xl"></i>
					</button>
				</div>
			</div>

			<!-- Group List -->
			<div class="flex-1 overflow-y-auto p-4" style="-webkit-overflow-scrolling: touch;">
				{#if loadingGroups}
					<div class="flex flex-col items-center justify-center py-8">
						<i class="bx bx-loader-alt animate-spin text-3xl text-[color:var(--text-50,#94a3b8)]"></i>
						<p class="mt-2 text-sm text-[color:var(--text-60,#6b7280)]">Loading groups...</p>
					</div>
				{:else if userGroups.length === 0}
					<div class="flex flex-col items-center justify-center py-8">
						<i class="bx bx-group text-3xl text-[color:var(--text-40,#94a3b8)]"></i>
						<p class="mt-2 text-sm text-[color:var(--text-60,#6b7280)]">
							No user groups yet.
						</p>
						<button
							type="button"
							class="mt-3 flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600"
							onclick={() => { closeGroupPicker(); openGroupEditor(); }}
						>
							<i class="bx bx-plus"></i>
							Create First Group
						</button>
					</div>
				{:else}
					<div class="space-y-2">
						{#each userGroups as group (group.id)}
							<div class="flex items-stretch gap-2">
								<button
									type="button"
									class="flex flex-1 items-center justify-between rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-3 text-left transition hover:border-indigo-500/30 hover:bg-indigo-500/5"
									onclick={() => handleAddUserToGroup(group)}
									disabled={addingToGroup}
								>
									<div class="flex items-center gap-3">
										<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/20">
											<i class="bx bx-group text-lg text-indigo-500"></i>
										</div>
										<div class="min-w-0 flex-1">
											<p class="truncate font-medium text-[color:var(--color-text-primary)]">
												{group.name}
											</p>
											<p class="truncate text-xs text-[color:var(--text-60,#6b7280)]">
												{group.serverIds.length} server{group.serverIds.length === 1 ? '' : 's'}
												{#if group.description}
													• {group.description}
												{/if}
											</p>
										</div>
									</div>
									{#if addingToGroup}
										<i class="bx bx-loader-alt animate-spin text-lg text-indigo-500"></i>
									{:else}
										<i class="bx bx-plus text-lg text-[color:var(--text-50,#94a3b8)]"></i>
									{/if}
								</button>
								<button
									type="button"
									class="flex w-10 items-center justify-center rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] text-[color:var(--text-50,#94a3b8)] transition hover:border-amber-500/30 hover:bg-amber-500/5 hover:text-amber-500"
									onclick={() => { closeGroupPicker(); openGroupEditor(group); }}
									aria-label="Edit group"
								>
									<i class="bx bx-edit text-lg"></i>
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- User Group Editor Modal -->
{#if showGroupEditor}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={closeGroupEditor}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="relative mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-[color:var(--surface-panel,#1e293b)] shadow-2xl"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-4">
				<div>
					<h3 class="text-lg font-bold text-[color:var(--color-text-primary)]">
						{editingGroup ? 'Edit User Group' : 'Create User Group'}
					</h3>
					<p class="text-xs text-[color:var(--text-60,#6b7280)]">
						Define a group with servers to quickly add users
					</p>
				</div>
				<button
					type="button"
					class="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--text-60,#6b7280)] transition hover:bg-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] hover:text-[color:var(--color-text-primary)]"
					onclick={closeGroupEditor}
					aria-label="Close group editor"
				>
					<i class="bx bx-x text-xl"></i>
				</button>
			</div>

			<!-- Form -->
			<div class="flex-1 overflow-y-auto p-4" style="-webkit-overflow-scrolling: touch;">
				<div class="space-y-4">
					<!-- Group Name -->
					<div>
						<label class="block text-sm font-medium text-[color:var(--color-text-primary)] mb-1.5">
							Group Name
						</label>
						<input
							type="text"
							placeholder="e.g., New Employee Servers"
							class="w-full rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-4 py-2.5 text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-[color:var(--accent-primary,#14b8a6)] focus:outline-none"
							bind:value={groupEditorName}
						/>
					</div>

					<!-- Description -->
					<div>
						<label class="block text-sm font-medium text-[color:var(--color-text-primary)] mb-1.5">
							Description (optional)
						</label>
						<input
							type="text"
							placeholder="Brief description of this group"
							class="w-full rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-4 py-2.5 text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-[color:var(--accent-primary,#14b8a6)] focus:outline-none"
							bind:value={groupEditorDescription}
						/>
					</div>

					<!-- Server Selection -->
					<div>
						<label class="block text-sm font-medium text-[color:var(--color-text-primary)] mb-1.5">
							Servers ({groupEditorServerIds.length} selected)
						</label>
						
						<!-- Search -->
						<div class="relative mb-3">
							<i
								class="bx bx-search absolute left-3 top-1/2 -translate-y-1/2 text-lg text-[color:var(--text-50,#94a3b8)]"
							></i>
							<input
								type="search"
								placeholder="Search servers..."
								class="w-full rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent py-2.5 pl-10 pr-4 text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-[color:var(--accent-primary,#14b8a6)] focus:outline-none"
								bind:value={groupServerSearch}
							/>
						</div>

						<!-- Server List -->
						<div class="max-h-64 overflow-y-auto rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-2 space-y-1">
							{#if loadingServers}
								<div class="flex items-center justify-center py-4">
									<i class="bx bx-loader-alt animate-spin text-xl text-[color:var(--text-50,#94a3b8)]"></i>
								</div>
							{:else if filteredServersForGroupEditor.length === 0}
								<p class="py-4 text-center text-sm text-[color:var(--text-60,#6b7280)]">
									{groupServerSearch ? 'No servers match your search.' : 'No servers available.'}
								</p>
							{:else}
								{#each filteredServersForGroupEditor as server (server.id)}
									{@const isSelected = groupEditorServerIds.includes(server.id)}
									<button
										type="button"
										class="flex w-full items-center gap-3 rounded-lg p-2 text-left transition {isSelected ? 'bg-indigo-500/10' : 'hover:bg-[color:color-mix(in_srgb,var(--color-text-primary)5%,transparent)]'}"
										onclick={() => toggleServerInGroup(server.id)}
									>
										<div
											class="flex h-5 w-5 items-center justify-center rounded border transition {isSelected ? 'border-indigo-500 bg-indigo-500' : 'border-[color:color-mix(in_srgb,var(--color-text-primary)20%,transparent)]'}"
										>
											{#if isSelected}
												<i class="bx bx-check text-sm text-white"></i>
											{/if}
										</div>
										<span class="flex-1 truncate text-sm text-[color:var(--color-text-primary)]">
											{server.name}
										</span>
									</button>
								{/each}
							{/if}
						</div>
					</div>
				</div>
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-between border-t border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-4">
				{#if editingGroup}
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-rose-500 transition hover:bg-rose-500/10"
						onclick={() => { handleDeleteGroup(editingGroup!); closeGroupEditor(); }}
					>
						<i class="bx bx-trash"></i>
						Delete
					</button>
				{:else}
					<div></div>
				{/if}
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="rounded-lg px-4 py-2 text-sm font-medium text-[color:var(--text-60,#6b7280)] transition hover:text-[color:var(--color-text-primary)]"
						onclick={closeGroupEditor}
					>
						Cancel
					</button>
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-50"
						onclick={handleSaveGroup}
						disabled={savingGroup || !groupEditorName.trim()}
					>
						{#if savingGroup}
							<i class="bx bx-loader-alt animate-spin"></i>
						{:else}
							<i class="bx bx-check"></i>
						{/if}
						{editingGroup ? 'Save Changes' : 'Create Group'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Group Manager Modal (standalone) -->
{#if showGroupManager}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={closeGroupManager}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="relative mx-4 flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-[color:var(--surface-panel,#1e293b)] shadow-2xl"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-4">
				<div>
					<h3 class="text-lg font-bold text-[color:var(--color-text-primary)]">
						Manage User Groups
					</h3>
					<p class="text-xs text-[color:var(--text-60,#6b7280)]">
						Create and edit groups for bulk server assignments
					</p>
				</div>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="flex h-8 items-center gap-1.5 rounded-lg bg-indigo-500 px-3 text-xs font-medium text-white transition hover:bg-indigo-600"
						onclick={() => { closeGroupManager(); openGroupEditor(); }}
					>
						<i class="bx bx-plus"></i>
						New Group
					</button>
					<button
						type="button"
						class="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--text-60,#6b7280)] transition hover:bg-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] hover:text-[color:var(--color-text-primary)]"
						onclick={closeGroupManager}
						aria-label="Close group manager"
					>
						<i class="bx bx-x text-xl"></i>
					</button>
				</div>
			</div>

			<!-- Group List -->
			<div class="flex-1 overflow-y-auto p-4" style="-webkit-overflow-scrolling: touch;">
				{#if loadingGroups}
					<div class="flex flex-col items-center justify-center py-8">
						<i class="bx bx-loader-alt animate-spin text-3xl text-[color:var(--text-50,#94a3b8)]"></i>
						<p class="mt-2 text-sm text-[color:var(--text-60,#6b7280)]">Loading groups...</p>
					</div>
				{:else if userGroups.length === 0}
					<div class="flex flex-col items-center justify-center py-8">
						<i class="bx bx-group text-4xl text-[color:var(--text-40,#94a3b8)]"></i>
						<p class="mt-2 text-sm text-[color:var(--text-60,#6b7280)]">
							No user groups yet.
						</p>
						<p class="mt-1 text-xs text-[color:var(--text-50,#94a3b8)]">
							Create a group to quickly add users to multiple servers at once.
						</p>
						<button
							type="button"
							class="mt-4 flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600"
							onclick={() => { closeGroupManager(); openGroupEditor(); }}
						>
							<i class="bx bx-plus"></i>
							Create First Group
						</button>
					</div>
				{:else}
					<div class="space-y-3">
						{#each userGroups as group (group.id)}
							<div class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] overflow-hidden {expandedGroupId === group.id ? 'ring-2 ring-indigo-500/50' : ''}">
								<!-- Group Header -->
								<div class="p-4">
									<div class="flex items-start justify-between gap-3">
										<div class="flex items-start gap-3">
											<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20">
												<i class="bx bx-group text-lg text-indigo-500"></i>
											</div>
											<div class="min-w-0">
												<h4 class="font-semibold text-[color:var(--color-text-primary)]">
													{group.name}
												</h4>
												{#if group.description}
													<p class="mt-0.5 text-xs text-[color:var(--text-60,#6b7280)]">
														{group.description}
													</p>
												{/if}
												<button
													type="button"
													class="mt-1 flex items-center gap-1 text-xs text-[color:var(--text-50,#94a3b8)] transition hover:text-indigo-400"
													onclick={() => toggleViewServers(group.id)}
												>
													<i class="bx {viewingServersGroupId === group.id ? 'bx-chevron-down' : 'bx-chevron-right'} text-sm"></i>
													{group.serverIds.length} server{group.serverIds.length === 1 ? '' : 's'}
												</button>
												<!-- Server list -->
												{#if viewingServersGroupId === group.id}
													<div class="mt-2 flex flex-wrap gap-1.5">
														{#if loadingServers}
															<span class="text-xs text-[color:var(--text-50,#94a3b8)]">
																<i class="bx bx-loader-alt animate-spin"></i> Loading...
															</span>
														{:else if group.serverIds.length === 0}
															<span class="text-xs italic text-[color:var(--text-50,#94a3b8)]">
																No servers in this group
															</span>
														{:else}
															{#each getServerNamesForGroup(group.serverIds) as serverName}
																<span class="inline-flex items-center rounded-md bg-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-2 py-0.5 text-xs text-[color:var(--color-text-primary)]">
																	<i class="bx bx-server mr-1 text-[color:var(--text-50,#94a3b8)]"></i>
																	{serverName}
																</span>
															{/each}
														{/if}
													</div>
												{/if}
												<!-- Member count button -->
												<button
													type="button"
													class="mt-1 flex items-center gap-1 text-xs text-[color:var(--text-50,#94a3b8)] transition hover:text-emerald-400"
													onclick={() => toggleViewMembers(group.id)}
												>
													<i class="bx {viewingMembersGroupId === group.id ? 'bx-chevron-down' : 'bx-chevron-right'} text-sm"></i>
													<i class="bx bx-user text-sm"></i>
													{group.memberUids.length} member{group.memberUids.length === 1 ? '' : 's'}
												</button>
												<!-- Member list -->
												{#if viewingMembersGroupId === group.id}
													<div class="mt-2 space-y-1.5">
														{#if group.memberUids.length === 0}
															<span class="text-xs italic text-[color:var(--text-50,#94a3b8)]">
																No members tracked yet. Add users using the button above.
															</span>
														{:else}
															{#each group.memberUids as memberUid (memberUid)}
																{@const memberInfo = getUserInfo(memberUid)}
																<div class="flex items-center justify-between gap-2 rounded-lg bg-[color:color-mix(in_srgb,var(--color-text-primary)5%,transparent)] px-2 py-1.5">
																	<div class="flex items-center gap-2 min-w-0">
																		{#if memberInfo}
																			<Avatar
																				uid={memberInfo.uid}
																				photoURL={memberInfo.photoURL}
																				displayName={memberInfo.displayName}
																				size="xs"
																			/>
																			<div class="min-w-0">
																				<p class="truncate text-xs font-medium text-[color:var(--color-text-primary)]">
																					{memberInfo.displayName}
																				</p>
																				<p class="truncate text-[10px] text-[color:var(--text-50,#94a3b8)]">
																					{memberInfo.email}
																				</p>
																			</div>
																		{:else}
																			<div class="flex h-6 w-6 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)]">
																				<i class="bx bx-user text-xs text-[color:var(--text-50,#94a3b8)]"></i>
																			</div>
																			<span class="text-xs text-[color:var(--text-50,#94a3b8)]">
																				{memberUid.slice(0, 8)}...
																			</span>
																		{/if}
																	</div>
																	<button
																		type="button"
																		class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[color:var(--text-50,#94a3b8)] transition hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50"
																		onclick={() => handleRemoveUserFromGroup(memberUid, group)}
																		disabled={removingUserFromGroup === memberUid}
																		aria-label="Remove from group"
																	>
																		{#if removingUserFromGroup === memberUid}
																			<i class="bx bx-loader-alt animate-spin text-sm"></i>
																		{:else}
																			<i class="bx bx-x text-sm"></i>
																		{/if}
																	</button>
																</div>
															{/each}
														{/if}
													</div>
												{/if}
											</div>
										</div>
										<div class="flex items-center gap-1">
											<button
												type="button"
												class="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition {expandedGroupId === group.id ? 'bg-indigo-500 text-white' : 'text-indigo-400 hover:bg-indigo-500/10'}"
												onclick={() => toggleGroupExpanded(group.id)}
												aria-label="Add users to group"
											>
												<i class="bx bx-user-plus text-base"></i>
												Add Users
											</button>
											<button
												type="button"
												class="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--text-50,#94a3b8)] transition hover:bg-amber-500/10 hover:text-amber-500"
												onclick={() => { closeGroupManager(); openGroupEditor(group); }}
												aria-label="Edit group"
											>
												<i class="bx bx-edit text-lg"></i>
											</button>
											<button
												type="button"
												class="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--text-50,#94a3b8)] transition hover:bg-rose-500/10 hover:text-rose-500"
												onclick={() => handleDeleteGroup(group)}
												aria-label="Delete group"
											>
												<i class="bx bx-trash text-lg"></i>
											</button>
										</div>
									</div>
								</div>

								<!-- Expanded User Picker -->
								{#if expandedGroupId === group.id}
									<div class="border-t border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] bg-[color:color-mix(in_srgb,var(--color-text-primary)3%,transparent)]">
										<!-- Search and selection bar -->
										<div class="flex items-center gap-2 border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-3">
											<div class="relative flex-1">
												<i class="bx bx-search absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--text-50,#94a3b8)]"></i>
												<input
													type="text"
													placeholder="Search users..."
													bind:value={groupUserSearch}
													class="h-8 w-full rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-[color:var(--surface-panel,#1e293b)] pl-8 pr-3 text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-indigo-500 focus:outline-none"
												/>
											</div>
											{#if selectedUsersForGroup.size > 0}
												<span class="text-xs font-medium text-indigo-400">
													{selectedUsersForGroup.size} selected
												</span>
												<button
													type="button"
													class="text-xs text-[color:var(--text-50,#94a3b8)] hover:text-[color:var(--color-text-primary)]"
													onclick={clearSelectedUsers}
												>
													Clear
												</button>
											{:else}
												<button
													type="button"
													class="text-xs text-indigo-400 hover:text-indigo-300"
													onclick={selectAllFilteredUsers}
												>
													Select All
												</button>
											{/if}
										</div>

										<!-- User List -->
										<div class="max-h-48 overflow-y-auto p-2" style="-webkit-overflow-scrolling: touch;">
											{#if filteredUsersForGroup.length === 0}
												<p class="py-4 text-center text-xs text-[color:var(--text-50,#94a3b8)]">
													No users found.
												</p>
											{:else}
												<div class="grid grid-cols-1 gap-1 sm:grid-cols-2">
													{#each filteredUsersForGroup.slice(0, 50) as user (user.uid)}
														<button
															type="button"
															class="flex items-center gap-2 rounded-lg p-2 text-left transition {selectedUsersForGroup.has(user.uid) ? 'bg-indigo-500/20 ring-1 ring-indigo-500/50' : 'hover:bg-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)]'}"
															onclick={() => toggleUserForGroup(user.uid)}
														>
															<div class="relative">
																<Avatar
																	uid={user.uid}
																	photoURL={user.photoURL}
																	displayName={user.displayName}
																	size="xs"
																/>
																{#if selectedUsersForGroup.has(user.uid)}
																	<div class="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-indigo-500">
																		<i class="bx bx-check text-[10px] text-white"></i>
																	</div>
																{/if}
															</div>
															<div class="min-w-0 flex-1">
																<p class="truncate text-xs font-medium text-[color:var(--color-text-primary)]">
																	{user.displayName}
																</p>
																<p class="truncate text-[10px] text-[color:var(--text-50,#94a3b8)]">
																	{user.email}
																</p>
															</div>
														</button>
													{/each}
												</div>
												{#if filteredUsersForGroup.length > 50}
													<p class="mt-2 text-center text-xs text-[color:var(--text-50,#94a3b8)]">
														Showing 50 of {filteredUsersForGroup.length} users. Use search to narrow results.
													</p>
												{/if}
											{/if}
										</div>

										<!-- Add button -->
										{#if selectedUsersForGroup.size > 0}
											<div class="border-t border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-3">
												<button
													type="button"
													class="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-50"
													onclick={() => handleAddSelectedUsersToGroup(group)}
													disabled={addingUsersToGroup}
												>
													{#if addingUsersToGroup}
														<i class="bx bx-loader-alt animate-spin"></i>
														Adding {selectedUsersForGroup.size} user(s)...
													{:else}
														<i class="bx bx-user-plus"></i>
														Add {selectedUsersForGroup.size} user(s) to "{group.name}"
													{/if}
												</button>
											</div>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="border-t border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-4">
				<p class="text-center text-xs text-[color:var(--text-50,#94a3b8)]">
					{userGroups.length} group{userGroups.length === 1 ? '' : 's'} • Click "Add Users" on a group to add members
				</p>
			</div>
		</div>
	</div>
{/if}
