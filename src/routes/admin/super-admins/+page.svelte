<script lang="ts">
  import type { PageData } from './$types';
  import AdminCard from '$lib/admin/components/AdminCard.svelte';
  import AdminTable from '$lib/admin/components/AdminTable.svelte';
  import ConfirmDialog from '$lib/admin/components/ConfirmDialog.svelte';
  import { addSuperAdminEmail, removeSuperAdminEmail, superAdminEmailsStore } from '$lib/admin/superAdmin';
  import { showAdminToast } from '$lib/admin/stores/toast';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  type AdminEntry = { email: string; displayName: string | null };
  const emailStore = superAdminEmailsStore();
  const profileLookup = data.profileLookup ?? {};
  const adminEntries: AdminEntry[] = $derived((() => {
    const fallback = data.superAdmins;
    const storeEmails = $emailStore;
    const source = storeEmails?.length ? storeEmails : fallback.map((entry) => entry.email);
    return source.map((email) => ({
      email,
      displayName:
        fallback.find((entry) => entry.email === email)?.displayName ??
        profileLookup[email.toLowerCase()]?.displayName ??
        null
    }));
  })());

  let newEmail = $state('');
  let busy = $state(false);
  let pendingRemoval: string | null = $state(null);
  let removalBusy = $state(false);

  const normalize = (value: string) => value.trim().toLowerCase();

  const handleAdd = async () => {
    const target = normalize(newEmail);
    if (!target) return;
    busy = true;
    try {
      await addSuperAdminEmail(target, data.user);
      newEmail = '';
      showAdminToast({ type: 'success', message: `Added ${target} as Super Admin.` });
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Unable to add.' });
    } finally {
      busy = false;
    }
  };

  const handleRemove = async () => {
    if (!pendingRemoval) return;
    removalBusy = true;
    try {
      await removeSuperAdminEmail(pendingRemoval, data.user);
      showAdminToast({ type: 'info', message: `Removed ${pendingRemoval}.` });
      pendingRemoval = null;
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Unable to remove.' });
    } finally {
      removalBusy = false;
    }
  };

  const cannotRemove = (email: string) => {
    if (adminEntries.length > 1) return false;
    const current = normalize(data.user?.email ?? '');
    return normalize(email) === current;
  };
</script>

<section class="admin-page h-full w-full grid gap-6 lg:grid-cols-[2fr,1fr]">
  <div class="super-admin-panel">
  <AdminCard title="Super Admins" description="Allow list of emails with total control.">
    <div class="flex h-full flex-col">
      <div class="flex-1 overflow-y-auto">
        <AdminTable headers={[{ label: 'Account' }, { label: 'Actions' }]}>
          {#if adminEntries.length === 0}
            <tr>
              <td class="px-4 py-5 text-sm text-[color:var(--text-60,#6b7280)]" colspan="2">No Super Admins configured.</td>
            </tr>
          {:else}
            {#each adminEntries as entry}
              <tr class="hover:bg-[color-mix(in_srgb,var(--surface-panel)85%,transparent)]">
                <td class="px-4 py-4">
                  <p class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">{entry.displayName ?? entry.email}</p>
                  <p class="text-xs text-[color:var(--text-60,#6b7280)]">{entry.email}</p>
                </td>
                <td class="px-4 py-4 text-right">
                  <button
                    type="button"
                    class="rounded-full border border-rose-300/60 px-4 py-2 text-sm font-semibold text-rose-100 disabled:opacity-50"
                    onclick={() => (pendingRemoval = entry.email)}
                    disabled={cannotRemove(entry.email)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            {/each}
          {/if}
        </AdminTable>
      </div>
    </div>
  </AdminCard>
  </div>

  <div class="super-admin-panel">
  <AdminCard title="Add Super Admin" description="Grant full access by email.">
    <div class="space-y-4">
      <label class="block text-sm font-semibold text-[color:var(--text-70,#475569)]">
        Email
        <input
          type="email"
          placeholder="admin@company.com"
          class="mt-2 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] bg-transparent px-4 py-3 text-sm text-[color:var(--color-text-primary,#0f172a)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-[color:var(--color-text-primary,#0f172a)]"
          bind:value={newEmail}
        />
      </label>
      <button
        type="button"
        class="w-full rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-400 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-60"
        onclick={handleAdd}
        disabled={busy || !newEmail.trim()}
      >
        {#if busy}
          Adding...
        {:else}
          Add Super Admin
        {/if}
      </button>
    </div>
  </AdminCard>
  </div>
</section>

<style>
  .super-admin-panel {
    min-height: 0;
  }

  .super-admin-panel :global(section) {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .super-admin-panel :global(section > div:last-child) {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
</style>

<ConfirmDialog
  open={Boolean(pendingRemoval)}
  title="Remove Super Admin"
  body={`This will remove ${pendingRemoval ?? ''} from the Super Admin allow list.`}
  confirmLabel="Remove"
  tone="danger"
  busy={removalBusy}
  on:confirm={handleRemove}
  on:cancel={() => (pendingRemoval = null)}
/>
