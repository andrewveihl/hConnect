<script lang="ts">
	import type { PageData } from './$types';
	import AdminCard from '$lib/admin/components/AdminCard.svelte';
	import Avatar from '$lib/components/app/Avatar.svelte';
	import { addSuperAdminEmail, removeSuperAdminEmail, refreshAllGooglePhotos, refreshUserGooglePhoto } from '$lib/admin/superAdmin';
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
