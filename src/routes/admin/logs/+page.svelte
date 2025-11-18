<script lang="ts">
  import type { PageData } from './$types';
  import AdminCard from '$lib/admin/components/AdminCard.svelte';
  import AdminTable from '$lib/admin/components/AdminTable.svelte';
  import { fetchClientErrors, fetchLogs, logsToText, summarizeLogs } from '$lib/admin/logs';
  import type {
    AdminLogEntry,
    AdminLogFilter,
    AdminLogType,
    ClientErrorLogEntry
  } from '$lib/admin/types';
  import { showAdminToast } from '$lib/admin/stores/toast';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let logs: AdminLogEntry[] = $state(data.initialLogs);
  let clientErrors: ClientErrorLogEntry[] = $state(data.initialClientErrors ?? []);
  let loading = $state(false);
  let criticalLoading = $state(false);
  let selectedLog: AdminLogEntry | null = $state(null);
  let selectedClientError: ClientErrorLogEntry | null = $state(null);
  let filterForm: {
    type: AdminLogType | '' | null;
    level: 'info' | 'warning' | 'error' | '' | null;
    search: string;
    serverId: string;
    channelId: string;
    dmId: string;
    userId: string;
    startDate: string;
    endDate: string;
  } = $state({
    type: null,
    level: null,
    search: '',
    serverId: '',
    channelId: '',
    dmId: '',
    userId: '',
    startDate: '',
    endDate: ''
  });
  let quickFilters = $state({ server: '', user: '' });

  const visibleLogs = $derived(
    logs.filter((log) => {
      const serverSearch = quickFilters.server.trim().toLowerCase();
      const userSearch = quickFilters.user.trim().toLowerCase();
      const serverMatch = serverSearch
        ? (log.serverId ?? '').toLowerCase().includes(serverSearch)
        : true;
      const userMatch = userSearch ? (log.userId ?? '').toLowerCase().includes(userSearch) : true;
      return serverMatch && userMatch;
    })
  );

  const summary = $derived(summarizeLogs(visibleLogs));
  const criticalLogs = $derived(clientErrors);

  const buildFilter = (): AdminLogFilter => {
    const clean = (value: string) => {
      const trimmed = value.trim();
      return trimmed.length ? trimmed : null;
    };

    const filter: AdminLogFilter = {
      type: filterForm.type ? filterForm.type : null,
      level: filterForm.level ? filterForm.level : null,
      serverId: clean(filterForm.serverId),
      channelId: clean(filterForm.channelId),
      dmId: clean(filterForm.dmId),
      userId: clean(filterForm.userId),
      startDate: filterForm.startDate ? new Date(filterForm.startDate) : null,
      endDate: filterForm.endDate ? new Date(filterForm.endDate) : null,
      limit: 150
    };

    const searchValue = clean(filterForm.search);
    if (searchValue) filter.search = searchValue;

    return filter;
  };

  const loadLogs = async () => {
    loading = true;
    try {
      logs = await fetchLogs(buildFilter());
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Unable to load logs.' });
    } finally {
      loading = false;
    }
  };

  const applyPreset = (type: AdminLogType) => {
    filterForm = { ...filterForm, type };
    void loadLogs();
  };

  const handleCopyView = async () => {
    try {
      await navigator.clipboard.writeText(logsToText(visibleLogs));
      showAdminToast({ type: 'success', message: 'Copied current log list.' });
    } catch {
      showAdminToast({ type: 'error', message: 'Clipboard copy blocked.' });
    }
  };

  const handleCopyJson = async (entry: AdminLogEntry) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
      showAdminToast({ type: 'success', message: 'Copied log JSON.' });
    } catch {
      showAdminToast({ type: 'error', message: 'Clipboard copy blocked.' });
    }
  };

  const handleCopyClientError = async (entry: ClientErrorLogEntry) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
      showAdminToast({ type: 'success', message: 'Copied client error.' });
    } catch {
      showAdminToast({ type: 'error', message: 'Clipboard copy blocked.' });
    }
  };

  const refreshClientErrors = async () => {
    criticalLoading = true;
    try {
      clientErrors = await fetchClientErrors(50);
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Unable to load errors.' });
    } finally {
      criticalLoading = false;
    }
  };

  const handleCriticalCardKeydown = (event: KeyboardEvent, log: ClientErrorLogEntry) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectedClientError = log;
    }
  };

  const formatDate = (value: Date) => value.toLocaleString();
</script>

<section class="admin-page h-full w-full gap-6">
  <div class="log-panel">
  <AdminCard title="Filters" description="Stack filters and presets for the logs view." padded={false}>
    <div class="flex h-full flex-col overflow-y-auto">
    <div class="grid gap-4 border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-6 md:grid-cols-3">
      <label class="text-sm font-semibold text-[color:var(--text-70,#475569)]">
        Type
        <select
          class="logs-field mt-2 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-3 py-2 text-sm"
          bind:value={filterForm.type}
        >
          <option value="">All</option>
          <option value="notifications">Notifications</option>
          <option value="voice">Voice</option>
          <option value="chat">Chat</option>
          <option value="featureToggle">Feature Toggles</option>
          <option value="adminAction">Admin Actions</option>
          <option value="auth">Auth</option>
          <option value="permissions">Permissions</option>
          <option value="presence">Presence</option>
          <option value="system">System</option>
          <option value="storage">Storage</option>
        </select>
      </label>
      <label class="text-sm font-semibold text-[color:var(--text-70,#475569)]">
        Level
        <select
          class="logs-field mt-2 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-3 py-2 text-sm"
          bind:value={filterForm.level}
        >
          <option value="">All</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
        </select>
      </label>
      <label class="text-sm font-semibold text-[color:var(--text-70,#475569)]">
        Text search
        <input
          type="text"
          placeholder="Search message or data"
          class="logs-field mt-2 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-3 py-2 text-sm"
          bind:value={filterForm.search}
        />
      </label>
    </div>
    <div class="grid gap-4 border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-6 md:grid-cols-4">
      <label class="text-sm font-semibold text-[color:var(--text-70,#475569)]">
        Server ID
        <input class="logs-field mt-2 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-3 py-2 text-sm" bind:value={filterForm.serverId} />
      </label>
      <label class="text-sm font-semibold text-[color:var(--text-70,#475569)]">
        Channel ID
        <input class="logs-field mt-2 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-3 py-2 text-sm" bind:value={filterForm.channelId} />
      </label>
      <label class="text-sm font-semibold text-[color:var(--text-70,#475569)]">
        DM ID
        <input class="logs-field mt-2 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-3 py-2 text-sm" bind:value={filterForm.dmId} />
      </label>
      <label class="text-sm font-semibold text-[color:var(--text-70,#475569)]">
        User ID
        <input class="logs-field mt-2 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-3 py-2 text-sm" bind:value={filterForm.userId} />
      </label>
    </div>
    <div class="grid gap-4 p-6 md:grid-cols-2">
      <label class="text-sm font-semibold text-[color:var(--text-70,#475569)]">
        Start date
        <input type="datetime-local" class="logs-field mt-2 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-3 py-2 text-sm" bind:value={filterForm.startDate} />
      </label>
      <label class="text-sm font-semibold text-[color:var(--text-70,#475569)]">
        End date
        <input type="datetime-local" class="logs-field mt-2 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-3 py-2 text-sm" bind:value={filterForm.endDate} />
      </label>
      <div class="md:col-span-2 flex flex-wrap gap-3">
        <button
          type="button"
          class="rounded-full border border-[color:color-mix(in_srgb,#14b8a6_30%,transparent)] px-4 py-2 text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)] hover:bg-[color-mix(in_srgb,#14b8a6_10%,transparent)]"
          onclick={() => applyPreset('notifications')}
        >
          Notifications
        </button>
        <button
          type="button"
          class="rounded-full border border-[color:color-mix(in_srgb,#14b8a6_30%,transparent)] px-4 py-2 text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)] hover:bg-[color-mix(in_srgb,#14b8a6_10%,transparent)]"
          onclick={() => applyPreset('voice')}
        >
          Voice & Video
        </button>
        <button
          type="button"
          class="rounded-full border border-[color:color-mix(in_srgb,#14b8a6_30%,transparent)] px-4 py-2 text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)] hover:bg-[color-mix(in_srgb,#14b8a6_10%,transparent)]"
          onclick={() => applyPreset('permissions')}
        >
          Permission changes
        </button>
        <button
          type="button"
          class="rounded-full border border-[color:color-mix(in_srgb,#14b8a6_30%,transparent)] px-4 py-2 text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)] hover:bg-[color-mix(in_srgb,#14b8a6_10%,transparent)]"
          onclick={() => applyPreset('auth')}
        >
          Auth events
        </button>
      </div>
      <div class="md:col-span-2 flex flex-wrap gap-3">
        <button
          type="button"
          class="rounded-2xl bg-gradient-to-r from-teal-500 to-cyan-500 px-5 py-2 text-sm font-semibold text-white shadow disabled:opacity-50"
          onclick={loadLogs}
          disabled={loading}
        >
          {#if loading}
            Loading…
          {:else}
            Apply filters
          {/if}
        </button>
        <button
          type="button"
          class="rounded-2xl border-2 border-[color:color-mix(in_srgb,#14b8a6_60%,transparent)] px-5 py-2 text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)] hover:bg-[color-mix(in_srgb,#14b8a6_12%,transparent)]"
          onclick={handleCopyView}
        >
          Copy view
        </button>
      </div>
    </div>
    </div>
  </AdminCard>
  </div>

  {#if criticalLogs.length}
    <div class="critical-panel">
      <AdminCard title="Critical Alerts" description="Latest user-impacting errors" padded={false}>
        <div class="critical-panel__inner">
          <div class="critical-panel__header">
            <div>
              <p class="critical-grid__eyebrow">Realtime capture</p>
              <h3 class="critical-grid__title">User-visible crashes</h3>
            </div>
            <button
              type="button"
              class="critical-grid__copy"
              onclick={refreshClientErrors}
              disabled={criticalLoading}
            >
              {criticalLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <div class="critical-grid">
            {#each criticalLogs as log (log.id)}
              <article
                class="critical-card"
                role="button"
                tabindex="0"
                onclick={() => (selectedClientError = log)}
                onkeydown={(event) => handleCriticalCardKeydown(event, log)}
              >
                <div class="critical-card__meta">
                  <span class="critical-card__pill">{log.severity ?? 'error'}</span>
                  <time>{formatDate(log.createdAt)}</time>
                </div>
                <h4>{log.message}</h4>
                {#if log.path}
                  <p class="critical-card__context">Path: {log.path}</p>
                {/if}
                {#if log.userId}
                  <p class="critical-card__context">User: {log.userId}</p>
                {/if}
                <div class="critical-card__actions">
                  <button
                    type="button"
                    onclick={(event) => {
                      event.stopPropagation();
                      void handleCopyClientError(log);
                    }}
                  >
                    Copy log
                  </button>
                  <button
                    type="button"
                    onclick={(event) => {
                      event.stopPropagation();
                      selectedClientError = log;
                    }}
                  >
                    View details
                  </button>
                </div>
              </article>
            {/each}
          </div>
        </div>
      </AdminCard>
    </div>
  {/if}

  <div class="log-panel">
  <AdminCard title="Summary" description="Counts based on current filter set.">
    <p class="px-2 text-xs text-[color:var(--text-60,#6b7280)]">
      Showing {visibleLogs.length} log{visibleLogs.length === 1 ? '' : 's'}.
    </p>
    <div class="grid gap-4 md:grid-cols-2">
      <div class="rounded-3xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)94%,transparent)] p-4">
        <p class="text-xs uppercase tracking-[0.3em] text-[color:var(--text-60,#6b7280)]">By Type</p>
        <div class="mt-2 space-y-1 text-sm text-[color:var(--color-text-primary,#0f172a)]">
          {#each summary.typeCounts as row}
            <div class="flex items-center justify-between">
              <span class="font-semibold">{row.type}</span>
              <span>{row.count}</span>
            </div>
          {/each}
        </div>
      </div>
      <div class="rounded-3xl border border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)94%,transparent)] p-4">
        <p class="text-xs uppercase tracking-[0.3em] text-[color:var(--text-60,#6b7280)]">By Level</p>
        <div class="mt-2 space-y-1 text-sm text-[color:var(--color-text-primary,#0f172a)]">
          {#each summary.levelCounts as row}
            <div class="flex items-center justify-between">
              <span class="font-semibold">{row.level}</span>
              <span>{row.count}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </AdminCard>
  </div>

  <div class="log-panel">
  <AdminCard title="Logs" description="Select a row for raw JSON.">
    <div class="flex h-full flex-col">
    <div class="flex-1 overflow-y-auto">
      <AdminTable headers={[{ label: 'Message' }, { label: 'Type' }, { label: 'Level' }, { label: 'Date' }]}>
        {#if visibleLogs.length === 0}
          <tr>
            <td class="px-4 py-5 text-sm text-[color:var(--text-60,#6b7280)]" colspan="4">
              {logs.length === 0 ? 'No logs for this filter.' : 'No logs match the quick filters.'}
            </td>
          </tr>
        {:else}
          {#each visibleLogs as log}
            <tr class="cursor-pointer hover:bg-[color-mix(in_srgb,var(--surface-panel)95%,transparent)]/80" onclick={() => (selectedLog = log)}>
              <td class="px-4 py-4 text-sm">
                <p class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">{log.message}</p>
                {#if log.data}
                  <p class="text-xs text-[color:var(--text-60,#6b7280)] truncate">{JSON.stringify(log.data)}</p>
                {/if}
              </td>
              <td class="px-4 py-4 text-xs uppercase tracking-wide text-[color:var(--text-60,#6b7280)]">{log.type}</td>
              <td class="px-4 py-4">
                <span
                  class="rounded-full px-3 py-1 text-xs font-semibold"
                  class:bg-sky-50={log.level === 'info'}
                  class:text-sky-600={log.level === 'info'}
                  class:bg-amber-50={log.level === 'warning'}
                  class:text-amber-600={log.level === 'warning'}
                  class:bg-rose-50={log.level === 'error'}
                  class:text-rose-600={log.level === 'error'}
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
    <div class="grid shrink-0 gap-4 border-t border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-6 py-4 md:grid-cols-2">
      <label class="text-sm font-semibold text-[color:var(--text-70,#475569)]">
        Quick server search
        <input
          type="text"
          placeholder="Filter current results by server"
          class="logs-field mt-2 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-3 py-2 text-sm"
          bind:value={quickFilters.server}
        />
      </label>
      <label class="text-sm font-semibold text-[color:var(--text-70,#475569)]">
        Quick user search
        <input
          type="text"
          placeholder="Filter by user ID"
          class="logs-field mt-2 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-3 py-2 text-sm"
          bind:value={quickFilters.user}
        />
      </label>
      <p class="md:col-span-2 text-xs text-[color:var(--text-60,#6b7280)]">
        Quick filters apply instantly without refetching data, perfect for scanning the current result set.
      </p>
    </div>
    </div>
  </AdminCard>
  </div>
</section>

<style>
  .logs-field {
    border-radius: 9999px;
  }

  .log-panel {
    min-height: 0;
  }

  .log-panel :global(section) {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .log-panel :global(section > div:last-child) {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .critical-panel {
    width: 100%;
  }

  .critical-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1rem;
    padding: 1.5rem;
  }

  .critical-card {
    border-radius: 1.25rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    background: color-mix(in srgb, var(--surface-panel) 94%, transparent);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    cursor: pointer;
  }

  .critical-card__meta {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: var(--text-60);
  }

  .critical-card__pill {
    padding: 0.15rem 0.75rem;
    border-radius: 999px;
    background: color-mix(in srgb, #ef4444 15%, transparent);
    color: #ef4444;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.72rem;
  }

  .critical-card h4 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .critical-card__context {
    font-size: 0.85rem;
    color: var(--text-65);
  }

  .critical-card__actions {
    margin-top: auto;
    display: flex;
    gap: 0.5rem;
  }

  .critical-card__actions button {
    flex: 1;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    padding: 0.35rem 0.6rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }
</style>

{#if selectedLog}
  <div class="fixed inset-0 z-40 flex justify-end bg-slate-900/30 backdrop-blur">
    <div class="h-full w-full max-w-lg bg-white p-6 shadow-2xl">
      <div class="flex items-start justify-between">
        <div>
          <p class="text-xs uppercase tracking-[0.3em] text-[color:var(--text-60,#6b7280)]">Log detail</p>
          <h2 class="text-2xl font-semibold text-[color:var(--color-text-primary,#0f172a)]">{selectedLog.message}</h2>
        </div>
        <button
          type="button"
          class="rounded-full border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] p-2 text-[color:var(--text-60,#6b7280)]"
          onclick={() => (selectedLog = null)}
        >
          &times;
        </button>
      </div>
      <div class="mt-4 space-y-2 text-sm text-[color:var(--text-70,#475569)]">
        <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">Type:</span> {selectedLog.type}</p>
        <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">Level:</span> {selectedLog.level}</p>
        {#if selectedLog.serverId}
          <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">Server:</span> {selectedLog.serverId}</p>
        {/if}
        {#if selectedLog.channelId}
          <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">Channel:</span> {selectedLog.channelId}</p>
        {/if}
        {#if selectedLog.dmId}
          <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">DM:</span> {selectedLog.dmId}</p>
        {/if}
        {#if selectedLog.userId}
          <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">User:</span> {selectedLog.userId}</p>
        {/if}
        <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">When:</span> {formatDate(selectedLog.createdAt)}</p>
      </div>
      <pre class="mt-4 h-72 overflow-y-auto rounded-2xl bg-slate-900/90 p-4 text-xs text-emerald-200">
{JSON.stringify(selectedLog, null, 2)}
</pre>
      <div class="mt-4 flex gap-3">
        <button
          type="button"
          class="rounded-2xl border-2 border-[color:color-mix(in_srgb,#14b8a6_60%,transparent)] px-4 py-2 text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)] hover:bg-[color-mix(in_srgb,#14b8a6_10%,transparent)]"
          onclick={() => handleCopyJson(selectedLog!)}
        >
          Copy JSON
        </button>
        <button
          type="button"
          class="rounded-2xl border-2 border-[color:color-mix(in_srgb,#14b8a6_60%,transparent)] px-4 py-2 text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)] hover:bg-[color-mix(in_srgb,#14b8a6_10%,transparent)]"
          onclick={() => (selectedLog = null)}
        >
          Close
        </button>
      </div>
    </div>
  </div>
{/if}

{#if selectedClientError}
  <div class="fixed inset-0 z-40 flex justify-end bg-slate-900/30 backdrop-blur">
    <div class="h-full w-full max-w-lg bg-white p-6 shadow-2xl">
      <div class="flex items-start justify-between">
        <div>
          <p class="text-xs uppercase tracking-[0.3em] text-[color:var(--text-60,#6b7280)]">Client error</p>
          <h2 class="text-2xl font-semibold text-[color:var(--color-text-primary,#0f172a)]">{selectedClientError.message}</h2>
        </div>
        <button
          type="button"
          class="rounded-full border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] p-2 text-[color:var(--text-60,#6b7280)]"
          onclick={() => (selectedClientError = null)}
        >
          &times;
        </button>
      </div>
      <div class="mt-4 space-y-2 text-sm text-[color:var(--text-70,#475569)]">
        {#if selectedClientError.path}
          <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">Path:</span> {selectedClientError.path}</p>
        {/if}
        {#if selectedClientError.userId}
          <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">User:</span> {selectedClientError.userId}</p>
        {/if}
        {#if selectedClientError.userEmail}
          <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">Email:</span> {selectedClientError.userEmail}</p>
        {/if}
        {#if selectedClientError.source}
          <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">Source:</span> {selectedClientError.source}</p>
        {/if}
        <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">When:</span> {formatDate(selectedClientError.createdAt)}</p>
      </div>
      <pre class="mt-4 h-72 overflow-y-auto rounded-2xl bg-slate-900/90 p-4 text-xs text-emerald-200">
{JSON.stringify(selectedClientError, null, 2)}
</pre>
      <div class="mt-4 flex gap-3">
        <button
          type="button"
          class="rounded-2xl border-2 border-[color:color-mix(in_srgb,#14b8a6_60%,transparent)] px-4 py-2 text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)] hover:bg-[color-mix(in_srgb,#14b8a6_10%,transparent)]"
          onclick={() => handleCopyClientError(selectedClientError!)}
        >
          Copy JSON
        </button>
        <button
          type="button"
          class="rounded-2xl border-2 border-[color:color-mix(in_srgb,#14b8a6_60%,transparent)] px-4 py-2 text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)] hover:bg-[color-mix(in_srgb,#14b8a6_10%,transparent)]"
          onclick={() => (selectedClientError = null)}
        >
          Close
        </button>
      </div>
    </div>
  </div>
{/if}













