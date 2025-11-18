<script lang="ts">
  import type { PageData } from './$types';
  import AdminCard from '$lib/admin/components/AdminCard.svelte';
  import AdminTable from '$lib/admin/components/AdminTable.svelte';
  import ConfirmDialog from '$lib/admin/components/ConfirmDialog.svelte';
  import type { ArchiveEntry } from '$lib/admin/archive';
  import { deleteArchiveEntry, fetchArchiveEntries, restoreArchiveEntry } from '$lib/admin/archive';
  import type { ArchiveTab } from '$lib/admin/types';
  import { showAdminToast } from '$lib/admin/stores/toast';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let activeTab: ArchiveTab = $state('servers');
  let filters: Record<ArchiveTab, { search: string }> = $state({
    servers: { search: '' },
    channels: { search: '' },
    messages: { search: '' },
    dms: { search: '' },
    attachments: { search: '' }
  });
  let archiveData: Record<ArchiveTab, ArchiveEntry[]> = $state(data.initialArchive);
  let loading = $state(false);
  let confirmAction: { tab: ArchiveTab; id: string; mode: 'restore' | 'delete'; label: string } | null = $state(null);

  const filteredEntries = $derived(
    (archiveData[activeTab] ?? []).filter((entry) => {
      const search = filters[activeTab].search.toLowerCase();
      if (!search) return true;
      const source = `${entry.entityId ?? ''} ${entry.reason ?? ''} ${entry.originalPath ?? ''}`.toLowerCase();
      return source.includes(search);
    })
  );

  const refreshTab = async () => {
    loading = true;
    try {
      archiveData = {
        ...archiveData,
        [activeTab]: await fetchArchiveEntries(activeTab)
      };
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Unable to load archive.' });
    } finally {
      loading = false;
    }
  };

  const handleConfirm = async () => {
    if (!confirmAction) return;
    loading = true;
    try {
      if (confirmAction.mode === 'restore') {
        await restoreArchiveEntry(confirmAction.tab, confirmAction.id, data.user);
        showAdminToast({ type: 'success', message: 'Entry restored.' });
      } else {
        await deleteArchiveEntry(confirmAction.tab, confirmAction.id, data.user);
        showAdminToast({ type: 'warning', message: 'Entry permanently deleted.' });
      }
      confirmAction = null;
      await refreshTab();
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Action failed.' });
    } finally {
      loading = false;
    }
  };
</script>

<section class="admin-page">
<AdminCard title="Archive" description="Soft deleted entities live here until restored or purged." padded={false}>
  <div class="flex flex-wrap gap-2 border-b border-slate-100 px-6 py-4">
    {#each Object.keys(filters) as tab}
      <button
        type="button"
        class="rounded-full px-4 py-2 text-sm font-semibold transition"
        class:bg-slate-900={tab === activeTab}
        class:text-white={tab === activeTab}
        class:bg-slate-100={tab !== activeTab}
        class:text-slate-600={tab !== activeTab}
        onclick={() => (activeTab = tab as ArchiveTab)}
      >
        {(tab as string).charAt(0).toUpperCase() + (tab as string).slice(1)}
      </button>
    {/each}
  </div>
  <div class="space-y-4 p-6">
    <div class="flex flex-wrap items-center gap-3">
      <input
        type="search"
        placeholder="Search ID, path, or reason"
        class="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm md:w-72"
        bind:value={filters[activeTab].search}
      />
      <button
        type="button"
        class="rounded-2xl bg-gradient-to-r from-teal-500 to-cyan-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        onclick={refreshTab}
        disabled={loading}
      >
        {loading ? 'Loading…' : 'Refresh'}
      </button>
    </div>

    <AdminTable headers={[{ label: 'Entity' }, { label: 'Reason' }, { label: 'Deleted By' }, { label: 'Created' }, { label: 'Actions' }]}>
      {#if filteredEntries.length === 0}
        <tr>
          <td class="px-4 py-5 text-sm text-slate-500" colspan="5">Archive is empty.</td>
        </tr>
      {:else}
        {#each filteredEntries as entry}
          <tr class="hover:bg-slate-50/80">
            <td class="px-4 py-4 text-sm text-slate-900">
              <p class="font-semibold">{entry.entityId ?? entry.id}</p>
              {#if entry.originalPath}
                <p class="text-xs text-slate-500">{entry.originalPath}</p>
              {/if}
            </td>
            <td class="px-4 py-4 text-sm text-slate-500">{entry.reason ?? '—'}</td>
            <td class="px-4 py-4 text-sm text-slate-500">{entry.deletedBy?.email ?? entry.deletedBy?.uid ?? '—'}</td>
            <td class="px-4 py-4 text-sm text-slate-500">
              {entry.createdAt ? entry.createdAt.toLocaleString() : '—'}
            </td>
            <td class="px-4 py-4 text-right space-x-2">
              <button
                type="button"
                class="rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 px-3 py-1 text-xs font-semibold text-white shadow hover:opacity-90"
                onclick={() => (confirmAction = { tab: activeTab, id: entry.id, mode: 'restore', label: entry.entityId ?? entry.id })}
              >
                Restore
              </button>
              <button
                type="button"
                class="rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600"
                onclick={() => (confirmAction = { tab: activeTab, id: entry.id, mode: 'delete', label: entry.entityId ?? entry.id })}
              >
                Delete
              </button>
            </td>
          </tr>
        {/each}
      {/if}
    </AdminTable>
  </div>
</AdminCard>
</section>

<ConfirmDialog
  open={Boolean(confirmAction)}
  title={confirmAction?.mode === 'restore' ? 'Restore entry' : 'Delete permanently'}
  body={
    confirmAction?.mode === 'restore'
      ? `Restore ${confirmAction?.label ?? ''} to the live collection?`
      : `This permanently removes ${confirmAction?.label ?? ''}. This cannot be undone.`
  }
  confirmLabel={confirmAction?.mode === 'restore' ? 'Restore' : 'Delete'}
  tone={confirmAction?.mode === 'restore' ? 'default' : 'danger'}
  busy={loading}
  on:confirm={handleConfirm}
  on:cancel={() => (confirmAction = null)}
/>

