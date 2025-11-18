<script lang="ts">
  import type { PageData } from './$types';
  import AdminCard from '$lib/admin/components/AdminCard.svelte';
  import AdminTable from '$lib/admin/components/AdminTable.svelte';
  import { logsToText } from '$lib/admin/logs';
  import { showAdminToast } from '$lib/admin/stores/toast';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const statLabels: Record<string, string> = {
    servers: 'Servers',
    users: 'Users',
    dms: 'DM Threads',
    logs: 'Logs (7d)'
  };

  const handleCopyLogs = async () => {
    try {
      await navigator.clipboard.writeText(logsToText(data.recentLogs));
      showAdminToast({ type: 'success', message: 'Copied current log view.' });
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: 'Unable to copy logs. Check clipboard permissions.' });
    }
  };

  const formatDate = (value: Date | string | null | undefined) => {
    if (!value) return '--';
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleString();
  };
</script>

<section class="admin-page">
  <div class="stats-grid">
    {#each Object.entries(data.stats) as [key, value]}
      <div
        class="rounded-3xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-5 text-center shadow-[0_18px_45px_rgba(5,12,30,0.25)]"
        style="background: linear-gradient(135deg, color-mix(in srgb, var(--surface-panel) 94%, transparent), color-mix(in srgb, var(--surface-panel) 86%, transparent));"
      >
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-[color:var(--text-60,#6b7280)]">
          {statLabels[key] ?? key}
        </p>
        <p class="mt-2 text-4xl font-semibold text-[color:var(--color-text-primary,#0f172a)]">{value.toLocaleString()}</p>
      </div>
    {/each}
  </div>

  <div class="overview-grid">
    <AdminCard title="Newest Servers" description="Latest created or restored servers.">
      <div class="max-h-[55vh] overflow-y-auto">
        <AdminTable headers={[{ label: 'Server' }, { label: 'Owner' }, { label: 'Status' }, { label: 'Created' }]}>
        {#if data.spotlightServers.length === 0}
          <tr>
            <td class="px-4 py-5 text-sm text-[color:var(--text-60,#6b7280)]" colspan="4">No servers yet.</td>
          </tr>
        {:else}
          {#each data.spotlightServers as server}
            <tr class="hover:bg-[color-mix(in_srgb,var(--surface-panel)85%,transparent)]">
              <td class="px-4 py-4 font-semibold text-[color:var(--color-text-primary,#0f172a)]">{server.name}</td>
              <td class="px-4 py-4 text-sm text-[color:var(--text-70,#475569)]">{server.owner}</td>
              <td class="px-4 py-4">
                <span
                  class="rounded-full px-3 py-1 text-xs font-semibold capitalize"
                  style:background={server.status === 'active'
                    ? 'color-mix(in srgb, var(--accent-success,#22c55e) 15%, transparent)'
                    : 'color-mix(in srgb, var(--accent-warning,#f59e0b) 18%, transparent)'}
                  style:color={server.status === 'active'
                    ? 'color-mix(in srgb, var(--accent-success,#15803d) 90%, white)'
                    : 'color-mix(in srgb, var(--accent-warning,#b45309) 88%, white)'}
                >
                  {server.status}
                </span>
              </td>
              <td class="px-4 py-4 text-sm text-[color:var(--text-60,#6b7280)]">{formatDate(server.createdAt)}</td>
            </tr>
          {/each}
        {/if}
      </AdminTable>
    </div>
  </AdminCard>

  <AdminCard title="Recent Logs" description="Live snapshot of the latest activity.">
    <div class="mb-4 flex flex-wrap justify-end gap-3 px-6 pt-4">
      <button
        type="button"
        class="rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 px-5 py-2 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
        onclick={handleCopyLogs}
      >
        Copy view
      </button>
    </div>
    <div class="max-h-[55vh] overflow-y-auto">
      <AdminTable headers={[{ label: 'Message' }, { label: 'Type' }, { label: 'Level' }, { label: 'Date' }]}>
        {#if data.recentLogs.length === 0}
          <tr>
            <td class="px-4 py-5 text-sm text-[color:var(--text-60,#6b7280)]" colspan="4">
              No logs yet. Flip a feature or perform an admin action to seed logs.
            </td>
          </tr>
        {:else}
          {#each data.recentLogs as log}
            <tr class="hover:bg-[color-mix(in_srgb,var(--surface-panel)85%,transparent)]">
              <td class="px-4 py-4 text-sm text-[color:var(--color-text-primary,#0f172a)]">
                <p class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">{log.message}</p>
                {#if log.data}
                  <p class="truncate text-xs text-[color:var(--text-60,#6b7280)]">{JSON.stringify(log.data)}</p>
                {/if}
              </td>
              <td class="px-4 py-4 text-xs uppercase tracking-wide text-[color:var(--text-60,#6b7280)]">{log.type}</td>
              <td class="px-4 py-4">
                <span
                  class="rounded-full px-3 py-1 text-xs font-semibold capitalize"
                  style:background={log.level === 'info'
                    ? 'color-mix(in srgb, #0ea5e9 18%, transparent)'
                    : log.level === 'warning'
                      ? 'color-mix(in srgb, #f59e0b 22%, transparent)'
                      : 'color-mix(in srgb, #f43f5e 20%, transparent)'}
                  style:color={log.level === 'info'
                    ? 'color-mix(in srgb, #bae6fd 90%, white)'
                    : log.level === 'warning'
                      ? 'color-mix(in srgb, #fde68a 90%, white)'
                      : 'color-mix(in srgb, #fecdd3 90%, white)'}
                >
                  {log.level}
                </span>
              </td>
              <td class="px-4 py-4 text-sm text-[color:var(--text-60,#6b7280)]">{formatDate(log.createdAt)}</td>
            </tr>
          {/each}
        {/if}
      </AdminTable>
    </div>
  </AdminCard>
</div>
</section>

<style>
  .stats-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .overview-grid {
    display: grid;
    gap: 1.5rem;
  }

  @media (min-width: 1024px) {
    .overview-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>

