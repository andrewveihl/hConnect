<script lang="ts">
  import type { PageData } from './$types';
  import AdminCard from '$lib/admin/components/AdminCard.svelte';
  import { addSuperAdminEmail, removeSuperAdminEmail } from '$lib/admin/superAdmin';
  import { showAdminToast } from '$lib/admin/stores/toast';
  import { adminNav } from '$lib/admin/stores/adminNav';
  import { ensureFirebaseReady, getDb } from '$lib/firebase';
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
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Unable to update user.' });
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
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Unable to update Super Admin.' });
    } finally {
      actionLoading = false;
    }
  };

  const formatDate = (value: Date | null | undefined) => (value ? value.toLocaleDateString() : '--');
  const formatDateTime = (value: Date | null | undefined) => (value ? value.toLocaleString() : '--');

  const isSuperAdmin = (email: string) => superAdminSet.has(email.toLowerCase());
</script>

<div class="admin-page">
  <div class="flex flex-col gap-4 lg:flex-row">
    <!-- Users List -->
    <div class="flex-1 lg:max-w-lg">
      <AdminCard title="Users" description="Manage user accounts and permissions." padded={false}>
        <div class="flex flex-col">
          <!-- Search & Filters -->
          <div class="space-y-3 border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4">
            <div class="relative">
              <i class="bx bx-search absolute left-3 top-1/2 -translate-y-1/2 text-lg text-[color:var(--text-50,#94a3b8)]"></i>
              <input
                type="search"
                placeholder="Search name, email, or UID..."
                class="w-full rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent py-2.5 pl-10 pr-4 text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-[color:var(--accent-primary,#14b8a6)] focus:outline-none"
                bind:value={search}
              />
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <label class="flex cursor-pointer items-center gap-2 text-sm text-[color:var(--text-70,#475569)]">
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
                {filteredUsers.length} {filteredUsers.length === 1 ? 'user' : 'users'}
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
                    class:border-[color:var(--accent-primary,#14b8a6)]={selectedUser?.uid === user.uid}
                    class:bg-[color-mix(in_srgb,var(--accent-primary,#14b8a6)8%,transparent)]={selectedUser?.uid === user.uid}
                    class:border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)]={selectedUser?.uid !== user.uid}
                    onclick={() => selectUser(user)}
                  >
                    <div 
                      class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
                      style="background: linear-gradient(135deg, #6366f1, #8b5cf6);"
                    >
                      <span class="text-sm font-bold">
                        {(user.displayName || user.email || '?').charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <p class="truncate font-semibold text-[color:var(--color-text-primary)]">
                          {user.displayName || 'Unnamed'}
                        </p>
                        {#if isSuperAdmin(user.email)}
                          <span class="rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                            Admin
                          </span>
                        {/if}
                      </div>
                      <p class="truncate text-xs text-[color:var(--text-60,#6b7280)]">{user.email || '--'}</p>
                    </div>
                    <span
                      class={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        user.banned ? 'bg-rose-500/20 text-rose-600' : 'bg-emerald-500/20 text-emerald-600'
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
          <div class="border-t border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4">
            <button
              type="button"
              class="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
              onclick={() => goto('/admin/super-admins')}
            >
              <i class="bx bx-shield-quarter"></i>
              Manage Super Admins
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
              <div 
                class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-white"
                style="background: linear-gradient(135deg, #6366f1, #8b5cf6);"
              >
                <span class="text-2xl font-bold">
                  {(selectedUser.displayName || selectedUser.email || '?').charAt(0).toUpperCase()}
                </span>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="text-lg font-bold text-[color:var(--color-text-primary)]">
                    {selectedUser.displayName || 'Unnamed User'}
                  </h3>
                  {#if isSuperAdmin(selectedUser.email)}
                    <span class="rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
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
              <div class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-3">
                <p class="text-xs font-medium uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]">User ID</p>
                <p class="mt-1 truncate font-mono text-xs text-[color:var(--color-text-primary)]">{selectedUser.uid}</p>
              </div>
              <div class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-3">
                <p class="text-xs font-medium uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]">Status</p>
                <p class="mt-1">
                  <span
                    class={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      selectedUser.banned ? 'bg-rose-500/20 text-rose-600' : 'bg-emerald-500/20 text-emerald-600'
                    }`}
                  >
                    {selectedUser.banned ? 'Banned' : 'Active'}
                  </span>
                </p>
              </div>
              <div class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-3">
                <p class="text-xs font-medium uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]">Created</p>
                <p class="mt-1 text-sm text-[color:var(--color-text-primary)]">{formatDate(selectedUser.createdAt)}</p>
              </div>
              <div class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-3">
                <p class="text-xs font-medium uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]">Last Seen</p>
                <p class="mt-1 text-sm text-[color:var(--color-text-primary)]">{formatDateTime(selectedUser.lastSeen)}</p>
              </div>
            </div>

            <!-- Actions -->
            <div class="space-y-3">
              <p class="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]">Actions</p>
              
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
                      {selectedUser.banned ? 'Restore access to the platform' : 'Prevent user from accessing the platform'}
                    </p>
                  </div>
                </div>
                {#if actionLoading}
                  <i class="bx bx-loader-alt animate-spin text-xl text-[color:var(--text-50,#94a3b8)]"></i>
                {:else}
                  <i class="bx bx-chevron-right text-xl text-[color:var(--text-50,#94a3b8)]"></i>
                {/if}
              </button>

              <!-- Super Admin Toggle -->
              {#if selectedUser.email}
                <button
                  type="button"
                  class="flex w-full items-center justify-between rounded-xl border border-amber-500/30 p-4 transition hover:bg-amber-500/5"
                  onclick={() => toggleSuperAdmin(selectedUser!.email, !isSuperAdmin(selectedUser!.email))}
                  disabled={actionLoading}
                >
                  <div class="flex items-center gap-3">
                    <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/20">
                      <i class="bx bx-shield-quarter text-lg text-amber-500"></i>
                    </div>
                    <div>
                      <p class="font-medium text-[color:var(--color-text-primary)]">
                        {isSuperAdmin(selectedUser.email) ? 'Remove Super Admin' : 'Grant Super Admin'}
                      </p>
                      <p class="text-xs text-[color:var(--text-60,#6b7280)]">
                        {isSuperAdmin(selectedUser.email) ? 'Revoke administrative privileges' : 'Grant full administrative access'}
                      </p>
                    </div>
                  </div>
                  {#if actionLoading}
                    <i class="bx bx-loader-alt animate-spin text-xl text-[color:var(--text-50,#94a3b8)]"></i>
                  {:else}
                    <i class="bx bx-chevron-right text-xl text-[color:var(--text-50,#94a3b8)]"></i>
                  {/if}
                </button>
              {/if}
            </div>
          </div>
        </AdminCard>
      {:else}
        <div class="flex h-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] p-8 text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)]">
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
