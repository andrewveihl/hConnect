<script lang="ts">
  import type { PageData } from './$types';
  import { browser } from '$app/environment';
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
  const DOMAIN_INVITE_STORAGE_KEY = 'domainAutoInviteDismissals';

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

  const handleResetDomainPrompt = () => {
    if (!browser) {
      showAdminToast({ type: 'info', message: 'Open this page in a browser session to run the reset.' });
      return;
    }
    try {
      localStorage.removeItem(DOMAIN_INVITE_STORAGE_KEY);
      showAdminToast({
        type: 'success',
        message: 'Cleared the domain invite prompt dismissal flag for this device.'
      });
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: 'Unable to reset local storage for this browser.' });
    }
  };

  const openSplashDemo = () => {
    if (!browser) {
      showAdminToast({ type: 'info', message: 'Splash demo is only available in-browser.' });
      return;
    }
    window.open('/splash', '_blank', 'noopener');
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

  <div class="super-admin-panel lg:col-span-2">
  <AdminCard title="Feature Testing" description="Shortcuts to QA the newest experiences.">
    <div class="feature-test-grid">
      <article class="feature-test-card">
        <div>
          <h4 class="feature-test-card__title">Domain auto-invite prompt</h4>
          <p class="feature-test-card__copy">
            Reset the local dismissal so the new join modal can reappear the next time you have a pending domain invite.
          </p>
        </div>
        <div class="feature-test-actions">
          <button type="button" class="feature-test-button" onclick={handleResetDomainPrompt}>
            Reset prompt dismissal
          </button>
          <a class="feature-test-link" href="/settings#invites" target="_blank" rel="noreferrer">
            Open invite inbox
          </a>
        </div>
      </article>
      <article class="feature-test-card">
        <div>
          <h4 class="feature-test-card__title">Splash screen demo</h4>
          <p class="feature-test-card__copy">
            Launch the standalone splash route in a fresh tab to verify branding and animation tweaks.
          </p>
        </div>
        <div class="feature-test-actions">
          <button type="button" class="feature-test-button" onclick={openSplashDemo}>Open splash page</button>
        </div>
      </article>
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

  .feature-test-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1rem;
  }

  .feature-test-card {
    border-radius: 1.25rem;
    border: 1px solid color-mix(in srgb, var(--surface-panel) 35%, transparent);
    background: color-mix(in srgb, var(--surface-panel) 75%, transparent);
    padding: 1.25rem;
    display: grid;
    gap: 0.75rem;
  }

  .feature-test-card__title {
    margin: 0 0 0.2rem;
    font-size: 1rem;
    font-weight: 600;
  }

  .feature-test-card__copy {
    margin: 0;
    color: color-mix(in srgb, var(--text-70,#475569) 90%, transparent);
    font-size: 0.9rem;
    line-height: 1.35;
  }

  .feature-test-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
  }

  .feature-test-button {
    border: none;
    border-radius: 999px;
    padding: 0.5rem 1.2rem;
    font-weight: 600;
    font-size: 0.9rem;
    color: #041014;
    background: linear-gradient(
      130deg,
      color-mix(in srgb, var(--color-accent) 65%, transparent),
      color-mix(in srgb, var(--color-highlight,#22d3ee) 65%, transparent)
    );
    cursor: pointer;
  }

  .feature-test-link {
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--surface-panel) 40%, transparent);
    padding: 0.45rem 1.1rem;
    font-size: 0.9rem;
    color: inherit;
    text-decoration: none;
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
