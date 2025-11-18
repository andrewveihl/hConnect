<script lang="ts">
  import type { PageData } from './$types';
  import AdminCard from '$lib/admin/components/AdminCard.svelte';
  import AdminTable from '$lib/admin/components/AdminTable.svelte';
  import { addSuperAdminEmail, removeSuperAdminEmail } from '$lib/admin/superAdmin';
  import { showAdminToast } from '$lib/admin/stores/toast';
  import { ensureFirebaseReady, getDb } from '$lib/firebase';
  import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
  import { logAdminAction } from '$lib/admin/logs';
  import { goto } from '$app/navigation';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let users = $state([...data.users]);
  let superAdminSet = $state(new Set((data.superAdmins ?? []).map((email) => email.toLowerCase())));
  let search = $state('');
  let onlyBanned = $state(false);

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

  const toggleBan = async (uid: string, banned: boolean) => {
    try {
      await ensureFirebaseReady();
      const db = getDb();
      await updateDoc(doc(db, 'profiles', uid), {
        'status.banned': !banned,
        'status.updatedAt': serverTimestamp()
      });
      users = users.map((user) => (user.uid === uid ? { ...user, banned: !banned } : user));
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
    }
  };

  const toggleSuperAdmin = async (email: string, makeAdmin: boolean) => {
    if (!email) {
      showAdminToast({ type: 'error', message: 'User email required for Super Admin.' });
      return;
    }
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
    }
  };

  const formatDate = (value: Date | null | undefined) => (value ? value.toLocaleString() : '--');
</script>

<section class="admin-page">
<AdminCard title="Users" description="Search, ban, and elevate accounts." padded={false}>
  <div class="flex flex-wrap items-center gap-3 border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-6 py-4">
    <input
      type="search"
      placeholder="Search display name, email, or UID"
      class="w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-4 py-2 text-sm text-[color:var(--color-text-primary,#0f172a)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-[color:var(--color-text-primary,#0f172a)] md:w-96"
      bind:value={search}
    />
    <label class="flex items-center gap-2 text-sm text-[color:var(--text-70,#475569)]">
      <input type="checkbox" bind:checked={onlyBanned} class="accent-teal-500" />
      Show banned only
    </label>
    <button
      type="button"
      class="rounded-2xl bg-gradient-to-r from-teal-500 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
      onclick={() => goto('/admin/super-admins')}
    >
      Manage Super Admins
    </button>
  </div>
  <div class="p-6">
    <div class="max-h-[65vh] overflow-y-auto pr-1">
      <AdminTable headers={[{ label: 'User' }, { label: 'Email' }, { label: 'Created' }, { label: 'Last seen' }, { label: 'Status' }, { label: 'Actions' }]}>
        {#if filteredUsers.length === 0}
          <tr>
            <td class="px-4 py-5 text-sm text-[color:var(--text-60,#6b7280)]" colspan="6">No users found.</td>
          </tr>
        {:else}
          {#each filteredUsers as user}
            <tr class="hover:bg-[color-mix(in_srgb,var(--surface-panel)85%,transparent)]">
              <td class="px-4 py-4">
                <p class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">{user.displayName || 'Unnamed'}</p>
                <p class="text-xs text-[color:var(--text-60,#6b7280)]">{user.uid}</p>
              </td>
              <td class="px-4 py-4 text-sm text-[color:var(--text-70,#475569)]">{user.email || '--'}</td>
              <td class="px-4 py-4 text-sm text-[color:var(--text-70,#475569)]">{formatDate(user.createdAt ?? null)}</td>
              <td class="px-4 py-4 text-sm text-[color:var(--text-70,#475569)]">{formatDate(user.lastSeen ?? null)}</td>
              <td class="px-4 py-4 text-sm">
                <span
                  class={`rounded-full px-3 py-1 text-xs font-semibold ${
                    user.banned
                      ? 'bg-rose-400/20 text-rose-100'
                      : 'bg-[color-mix(in_srgb,#14b8a6_20%,transparent)] text-[#0f766e]'
                  }`}
                >
                  {user.banned ? 'Banned' : 'Active'}
                </span>
              </td>
              <td class="px-4 py-4 text-right space-x-2">
                <button
                  type="button"
                  class="rounded-full border border-amber-300/60 px-3 py-1 text-xs font-semibold text-amber-100"
                  onclick={() => toggleBan(user.uid, user.banned)}
                >
                  {user.banned ? 'Unban' : 'Ban'}
                </button>
                {#if user.email}
                  <button
                    type="button"
                    class="rounded-full border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-3 py-1 text-xs font-semibold text-[color:var(--color-text-primary,#0f172a)]"
                    onclick={() =>
                      toggleSuperAdmin(
                        user.email,
                        !superAdminSet.has(user.email.toLowerCase())
                      )}
                  >
                    {superAdminSet.has(user.email.toLowerCase()) ? 'Remove Super Admin' : 'Grant Super Admin'}
                  </button>
                {:else}
                  <button
                    type="button"
                    class="rounded-full border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] px-3 py-1 text-xs font-semibold text-[color:var(--text-40,#94a3b8)]"
                    disabled
                  >
                    Email required
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        {/if}
      </AdminTable>
    </div>
  </div>
</AdminCard>
</section>


