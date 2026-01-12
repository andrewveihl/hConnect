<script lang="ts">
	import type { PageData } from './$types';
	import { fetchClientErrors, fetchLogs, logsToText, summarizeLogs } from '$lib/admin/logs';
	import type {
		AdminLogEntry,
		AdminLogFilter,
		AdminLogType,
		ClientErrorLogEntry
	} from '$lib/admin/types';
	import { showAdminToast } from '$lib/admin/stores/toast';
	import { isMobileViewport } from '$lib/stores/viewport';

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
	let showFilters = $state(false);

	// Mobile tabs
	type TabId = 'logs' | 'critical' | 'summary';
	let activeTab: TabId = $state('logs');

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
			showFilters = false;
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
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Unable to load errors.'
			});
		} finally {
			criticalLoading = false;
		}
	};

	const formatDate = (value: Date) => value.toLocaleString();

	const formatRelativeTime = (date: Date) => {
		const diff = Date.now() - date.getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'Just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	};

	const getLevelColor = (level: string) => {
		switch (level) {
			case 'error':
				return 'error';
			case 'warning':
				return 'warning';
			default:
				return 'info';
		}
	};
</script>

<section class="logs-page">
	<!-- Header with stats and actions -->
	<div class="logs-header">
		<div class="stats-row">
			<div class="stat">
				<i class="bx bx-file"></i>
				<span class="value">{visibleLogs.length}</span>
				<span class="label">Logs</span>
			</div>
			<div class="stat error">
				<i class="bx bx-error-circle"></i>
				<span class="value">{criticalLogs.length}</span>
				<span class="label">Critical</span>
			</div>
			<div class="stat">
				<i class="bx bx-time"></i>
				<span class="value">{summary.typeCounts.length}</span>
				<span class="label">Types</span>
			</div>
		</div>

		<div class="action-row">
			<button class="action-btn primary" onclick={() => (showFilters = !showFilters)}>
				<i class="bx bx-filter-alt"></i>
				Filters
			</button>
			<button class="action-btn" onclick={handleCopyView}>
				<i class="bx bx-copy"></i>
				Copy
			</button>
			<button class="action-btn" onclick={loadLogs} disabled={loading}>
				<i class="bx {loading ? 'bx-loader-alt bx-spin' : 'bx-refresh'}"></i>
				{loading ? '' : 'Refresh'}
			</button>
		</div>
	</div>

	<!-- Filter panel (expandable) -->
	{#if showFilters}
		<div class="filter-panel">
			<div class="filter-section">
				<h4>Quick Presets</h4>
				<div class="presets-row">
					<button class="preset-btn" onclick={() => applyPreset('notifications')}>
						<i class="bx bx-bell"></i> Notifications
					</button>
					<button class="preset-btn" onclick={() => applyPreset('voice')}>
						<i class="bx bx-microphone"></i> Voice
					</button>
					<button class="preset-btn" onclick={() => applyPreset('auth')}>
						<i class="bx bx-lock-alt"></i> Auth
					</button>
					<button class="preset-btn" onclick={() => applyPreset('permissions')}>
						<i class="bx bx-shield"></i> Permissions
					</button>
				</div>
			</div>

			<div class="filter-grid">
				<label class="filter-field">
					<span>Type</span>
					<select bind:value={filterForm.type}>
						<option value="">All types</option>
						<option value="notifications">Notifications</option>
						<option value="voice">Voice</option>
						<option value="chat">Chat</option>
						<option value="featureToggle">Features</option>
						<option value="adminAction">Admin</option>
						<option value="auth">Auth</option>
						<option value="permissions">Permissions</option>
						<option value="presence">Presence</option>
						<option value="system">System</option>
						<option value="storage">Storage</option>
					</select>
				</label>
				<label class="filter-field">
					<span>Level</span>
					<select bind:value={filterForm.level}>
						<option value="">All levels</option>
						<option value="info">Info</option>
						<option value="warning">Warning</option>
						<option value="error">Error</option>
					</select>
				</label>
				<label class="filter-field full">
					<span>Search</span>
					<input
						type="text"
						placeholder="Search message or data..."
						bind:value={filterForm.search}
					/>
				</label>
			</div>

			<details class="advanced-filters">
				<summary>Advanced Filters</summary>
				<div class="filter-grid">
					<label class="filter-field">
						<span>Server ID</span>
						<input type="text" bind:value={filterForm.serverId} />
					</label>
					<label class="filter-field">
						<span>Channel ID</span>
						<input type="text" bind:value={filterForm.channelId} />
					</label>
					<label class="filter-field">
						<span>DM ID</span>
						<input type="text" bind:value={filterForm.dmId} />
					</label>
					<label class="filter-field">
						<span>User ID</span>
						<input type="text" bind:value={filterForm.userId} />
					</label>
					<label class="filter-field">
						<span>Start Date</span>
						<input type="datetime-local" bind:value={filterForm.startDate} />
					</label>
					<label class="filter-field">
						<span>End Date</span>
						<input type="datetime-local" bind:value={filterForm.endDate} />
					</label>
				</div>
			</details>

			<div class="filter-actions">
				<button class="apply-btn" onclick={loadLogs} disabled={loading}>
					{#if loading}
						<i class="bx bx-loader-alt bx-spin"></i> Loading...
					{:else}
						<i class="bx bx-check"></i> Apply Filters
					{/if}
				</button>
				<button class="cancel-btn" onclick={() => (showFilters = false)}> Cancel </button>
			</div>
		</div>
	{/if}

	<!-- Mobile tabs -->
	{#if $isMobileViewport}
		<div class="tab-bar">
			<button class="tab" class:active={activeTab === 'logs'} onclick={() => (activeTab = 'logs')}>
				<i class="bx bx-file"></i>
				Logs
				<span class="count">{visibleLogs.length}</span>
			</button>
			<button
				class="tab"
				class:active={activeTab === 'critical'}
				onclick={() => (activeTab = 'critical')}
			>
				<i class="bx bx-error-circle"></i>
				Critical
				{#if criticalLogs.length > 0}
					<span class="count error">{criticalLogs.length}</span>
				{/if}
			</button>
			<button
				class="tab"
				class:active={activeTab === 'summary'}
				onclick={() => (activeTab = 'summary')}
			>
				<i class="bx bx-pie-chart-alt-2"></i>
				Summary
			</button>
		</div>
	{/if}

	<div class="content-area" class:mobile={$isMobileViewport}>
		<!-- Logs list -->
		{#if !$isMobileViewport || activeTab === 'logs'}
			<div class="logs-panel">
				<!-- Quick search on desktop -->
				{#if !$isMobileViewport}
					<div class="quick-search">
						<div class="search-input">
							<i class="bx bx-search"></i>
							<input
								type="text"
								placeholder="Quick filter by server..."
								bind:value={quickFilters.server}
							/>
						</div>
						<div class="search-input">
							<i class="bx bx-user"></i>
							<input
								type="text"
								placeholder="Quick filter by user..."
								bind:value={quickFilters.user}
							/>
						</div>
					</div>
				{/if}

				<div class="logs-list">
					{#if visibleLogs.length === 0}
						<div class="empty-state">
							<i class="bx bx-file-blank"></i>
							<p>{logs.length === 0 ? 'No logs for this filter' : 'No logs match quick filters'}</p>
						</div>
					{:else}
						{#each visibleLogs as log (log.id)}
							<button class="log-card" onclick={() => (selectedLog = log)}>
								<div class="log-header">
									<span class="level-badge {getLevelColor(log.level)}">{log.level}</span>
									<span class="log-type">{log.type}</span>
									<span class="log-time">{formatRelativeTime(log.createdAt)}</span>
								</div>
								<p class="log-message">{log.message}</p>
								{#if log.data && !$isMobileViewport}
									<p class="log-data">{JSON.stringify(log.data).slice(0, 100)}...</p>
								{/if}
								<div class="log-meta">
									{#if log.serverId}
										<span><i class="bx bx-server"></i> {log.serverId.slice(0, 8)}...</span>
									{/if}
									{#if log.userId}
										<span><i class="bx bx-user"></i> {log.userId.slice(0, 8)}...</span>
									{/if}
								</div>
							</button>
						{/each}
					{/if}
				</div>
			</div>
		{/if}

		<!-- Critical errors -->
		{#if !$isMobileViewport || activeTab === 'critical'}
			<div class="critical-panel">
				<div class="panel-header">
					<div class="header-content">
						<i class="bx bx-error-circle"></i>
						<div>
							<h3>Critical Alerts</h3>
							<p>User-visible crashes</p>
						</div>
					</div>
					<button
						class="refresh-btn"
						onclick={refreshClientErrors}
						disabled={criticalLoading}
						aria-label="Refresh critical errors"
					>
						<i class="bx {criticalLoading ? 'bx-loader-alt bx-spin' : 'bx-refresh'}"></i>
					</button>
				</div>

				<div class="critical-list">
					{#if criticalLogs.length === 0}
						<div class="empty-state success">
							<i class="bx bx-check-circle"></i>
							<p>No critical errors</p>
						</div>
					{:else}
						{#each criticalLogs as error (error.id)}
							<button class="critical-card" onclick={() => (selectedClientError = error)}>
								<div class="critical-header">
									<span class="severity-badge">{error.severity ?? 'error'}</span>
									<span class="critical-time">{formatRelativeTime(error.createdAt)}</span>
								</div>
								<p class="critical-message">{error.message}</p>
								{#if error.path}
									<p class="critical-path"><i class="bx bx-link"></i> {error.path}</p>
								{/if}
								<div class="critical-actions">
									<span
										class="copy-btn"
										role="button"
										tabindex="0"
										onclick={(e) => {
											e.stopPropagation();
											handleCopyClientError(error);
										}}
										onkeydown={(e) => {
											if (e.key === 'Enter') {
												e.stopPropagation();
												handleCopyClientError(error);
											}
										}}
									>
										<i class="bx bx-copy"></i> Copy
									</span>
								</div>
							</button>
						{/each}
					{/if}
				</div>
			</div>
		{/if}

		<!-- Summary -->
		{#if !$isMobileViewport || activeTab === 'summary'}
			<div class="summary-panel">
				<div class="summary-card">
					<h4><i class="bx bx-category"></i> By Type</h4>
					<div class="summary-list">
						{#each summary.typeCounts as row}
							<div class="summary-row">
								<span class="summary-label">{row.type}</span>
								<span class="summary-value">{row.count}</span>
							</div>
						{/each}
						{#if summary.typeCounts.length === 0}
							<p class="empty-hint">No logs loaded</p>
						{/if}
					</div>
				</div>

				<div class="summary-card">
					<h4><i class="bx bx-signal-5"></i> By Level</h4>
					<div class="summary-list">
						{#each summary.levelCounts as row}
							<div class="summary-row">
								<span class="summary-label">
									<span class="level-dot {getLevelColor(row.level)}"></span>
									{row.level}
								</span>
								<span class="summary-value">{row.count}</span>
							</div>
						{/each}
						{#if summary.levelCounts.length === 0}
							<p class="empty-hint">No logs loaded</p>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>
</section>

<!-- Log Detail Modal -->
{#if selectedLog}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={() => (selectedLog = null)} role="presentation">
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_interactive_supports_focus -->
		<div
			class="modal-content"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="modal-header">
				<div>
					<span class="modal-label">Log Detail</span>
					<h2>{selectedLog.message}</h2>
				</div>
				<button class="close-btn" onclick={() => (selectedLog = null)} aria-label="Close modal">
					<i class="bx bx-x"></i>
				</button>
			</div>

			<div class="modal-body">
				<div class="detail-grid">
					<div class="detail-item">
						<span class="detail-label">Type</span>
						<span class="detail-value">{selectedLog.type}</span>
					</div>
					<div class="detail-item">
						<span class="detail-label">Level</span>
						<span class="level-badge {getLevelColor(selectedLog.level)}">{selectedLog.level}</span>
					</div>
					{#if selectedLog.serverId}
						<div class="detail-item">
							<span class="detail-label">Server</span>
							<span class="detail-value mono">{selectedLog.serverId}</span>
						</div>
					{/if}
					{#if selectedLog.channelId}
						<div class="detail-item">
							<span class="detail-label">Channel</span>
							<span class="detail-value mono">{selectedLog.channelId}</span>
						</div>
					{/if}
					{#if selectedLog.dmId}
						<div class="detail-item">
							<span class="detail-label">DM</span>
							<span class="detail-value mono">{selectedLog.dmId}</span>
						</div>
					{/if}
					{#if selectedLog.userId}
						<div class="detail-item">
							<span class="detail-label">User</span>
							<span class="detail-value mono">{selectedLog.userId}</span>
						</div>
					{/if}
					<div class="detail-item full">
						<span class="detail-label">When</span>
						<span class="detail-value">{formatDate(selectedLog.createdAt)}</span>
					</div>
				</div>

				<div class="json-preview">
					<pre>{JSON.stringify(selectedLog, null, 2)}</pre>
				</div>
			</div>

			<div class="modal-footer">
				<button class="btn primary" onclick={() => handleCopyJson(selectedLog!)}>
					<i class="bx bx-copy"></i> Copy JSON
				</button>
				<button class="btn" onclick={() => (selectedLog = null)}> Close </button>
			</div>
		</div>
	</div>
{/if}

<!-- Client Error Detail Modal -->
{#if selectedClientError}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={() => (selectedClientError = null)} role="presentation">
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_interactive_supports_focus -->
		<div
			class="modal-content"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="modal-header error">
				<div>
					<span class="modal-label">Client Error</span>
					<h2>{selectedClientError.message}</h2>
				</div>
				<button
					class="close-btn"
					onclick={() => (selectedClientError = null)}
					aria-label="Close modal"
				>
					<i class="bx bx-x"></i>
				</button>
			</div>

			<div class="modal-body">
				<div class="detail-grid">
					{#if selectedClientError.path}
						<div class="detail-item full">
							<span class="detail-label">Path</span>
							<span class="detail-value mono">{selectedClientError.path}</span>
						</div>
					{/if}
					{#if selectedClientError.userId}
						<div class="detail-item">
							<span class="detail-label">User</span>
							<span class="detail-value mono">{selectedClientError.userId}</span>
						</div>
					{/if}
					{#if selectedClientError.userEmail}
						<div class="detail-item">
							<span class="detail-label">Email</span>
							<span class="detail-value">{selectedClientError.userEmail}</span>
						</div>
					{/if}
					{#if selectedClientError.source}
						<div class="detail-item">
							<span class="detail-label">Source</span>
							<span class="detail-value">{selectedClientError.source}</span>
						</div>
					{/if}
					<div class="detail-item">
						<span class="detail-label">When</span>
						<span class="detail-value">{formatDate(selectedClientError.createdAt)}</span>
					</div>
				</div>

				<div class="json-preview">
					<pre>{JSON.stringify(selectedClientError, null, 2)}</pre>
				</div>
			</div>

			<div class="modal-footer">
				<button class="btn primary" onclick={() => handleCopyClientError(selectedClientError!)}>
					<i class="bx bx-copy"></i> Copy JSON
				</button>
				<button class="btn" onclick={() => (selectedClientError = null)}> Close </button>
			</div>
		</div>
	</div>
{/if}

<style>
	.logs-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		height: 100%;
		padding: 1rem;
		overflow: hidden;
	}

	/* Header */
	.logs-header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		flex-shrink: 0;
	}

	.stats-row {
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem;
		background: var(--surface-panel);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
	}

	.stat {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.125rem;
		padding: 0.5rem;
	}

	.stat i {
		font-size: 1.25rem;
		color: var(--accent-primary);
	}

	.stat.error i {
		color: #ef4444;
	}

	.stat .value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.stat .label {
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
	}

	.action-row {
		display: flex;
		gap: 0.5rem;
	}

	.action-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.875rem;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		background: var(--surface-panel);
		color: var(--color-text-primary);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.action-btn:hover {
		background: color-mix(in srgb, var(--color-text-primary) 5%, var(--surface-panel));
	}

	.action-btn.primary {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: white;
	}

	.action-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.action-btn i {
		font-size: 1rem;
	}

	/* Filter panel */
	.filter-panel {
		background: var(--surface-panel);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		flex-shrink: 0;
	}

	.filter-section h4 {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
		margin: 0 0 0.5rem;
	}

	.presets-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.preset-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.75rem;
		border-radius: 9999px;
		border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
		background: transparent;
		color: var(--color-text-primary);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.preset-btn:hover {
		background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
	}

	.preset-btn i {
		font-size: 0.875rem;
	}

	.filter-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}

	.filter-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.filter-field.full {
		grid-column: 1 / -1;
	}

	.filter-field span {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.filter-field input,
	.filter-field select {
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		background: color-mix(in srgb, var(--surface-panel) 50%, transparent);
		color: var(--color-text-primary);
		font-size: 0.8125rem;
	}

	.advanced-filters {
		border-top: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		padding-top: 0.75rem;
	}

	.advanced-filters summary {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-secondary);
		cursor: pointer;
		margin-bottom: 0.75rem;
	}

	.filter-actions {
		display: flex;
		gap: 0.5rem;
	}

	.apply-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.625rem 1rem;
		border-radius: 8px;
		border: none;
		background: linear-gradient(
			135deg,
			var(--accent-primary),
			color-mix(in srgb, var(--accent-primary) 80%, #10b981)
		);
		color: white;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
	}

	.apply-btn:disabled {
		opacity: 0.6;
	}

	.cancel-btn {
		padding: 0.625rem 1rem;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 0.875rem;
		cursor: pointer;
	}

	/* Tab bar */
	.tab-bar {
		display: flex;
		gap: 0.25rem;
		padding: 0.25rem;
		background: var(--surface-panel);
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		flex-shrink: 0;
	}

	.tab {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.5rem;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.tab.active {
		background: var(--accent-primary);
		color: white;
	}

	.tab i {
		font-size: 1rem;
	}

	.tab .count {
		padding: 0.125rem 0.375rem;
		border-radius: 9999px;
		background: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		font-size: 0.625rem;
		font-weight: 600;
	}

	.tab.active .count {
		background: rgba(255, 255, 255, 0.2);
	}

	.tab .count.error {
		background: #ef4444;
		color: white;
	}

	/* Content area */
	.content-area {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: 1rem;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.content-area.mobile {
		grid-template-columns: 1fr;
	}

	/* Logs panel */
	.logs-panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background: var(--surface-panel);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		padding: 1rem;
		overflow: hidden;
	}

	.content-area.mobile .logs-panel {
		background: transparent;
		border: none;
		padding: 0;
	}

	.quick-search {
		display: flex;
		gap: 0.5rem;
	}

	.search-input {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
	}

	.search-input i {
		color: var(--color-text-secondary);
	}

	.search-input input {
		flex: 1;
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		font-size: 0.8125rem;
	}

	.search-input input::placeholder {
		color: var(--color-text-secondary);
	}

	.logs-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		overflow-y: auto;
		flex: 1;
	}

	.log-card {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.875rem;
		background: color-mix(in srgb, var(--surface-panel) 50%, transparent);
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 8%, transparent);
		cursor: pointer;
		text-align: left;
		transition: all 0.2s;
	}

	.content-area.mobile .log-card {
		background: var(--surface-panel);
		border-color: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
	}

	.log-card:hover {
		border-color: color-mix(in srgb, var(--accent-primary) 30%, transparent);
	}

	.log-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.level-badge {
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	.level-badge.info {
		background: color-mix(in srgb, #3b82f6 15%, transparent);
		color: #3b82f6;
	}

	.level-badge.warning {
		background: color-mix(in srgb, #f59e0b 15%, transparent);
		color: #d97706;
	}

	.level-badge.error {
		background: color-mix(in srgb, #ef4444 15%, transparent);
		color: #ef4444;
	}

	.log-type {
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
	}

	.log-time {
		margin-left: auto;
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
	}

	.log-message {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-primary);
		margin: 0;
		line-height: 1.4;
	}

	.log-data {
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
		margin: 0;
		font-family: monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.log-meta {
		display: flex;
		gap: 0.75rem;
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
	}

	.log-meta span {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.log-meta i {
		font-size: 0.75rem;
	}

	/* Critical panel */
	.critical-panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background: var(--surface-panel);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, #ef4444 20%, transparent);
		padding: 1rem;
		overflow: hidden;
	}

	.content-area.mobile .critical-panel {
		background: transparent;
		border: none;
		padding: 0;
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.header-content {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.header-content i {
		font-size: 1.5rem;
		color: #ef4444;
	}

	.header-content h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.header-content p {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	.refresh-btn {
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.refresh-btn:disabled {
		opacity: 0.5;
	}

	.critical-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		overflow-y: auto;
		flex: 1;
	}

	.critical-card {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.875rem;
		background: color-mix(in srgb, #ef4444 5%, var(--surface-panel));
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, #ef4444 15%, transparent);
		cursor: pointer;
		text-align: left;
		transition: all 0.2s;
	}

	.critical-card:hover {
		border-color: color-mix(in srgb, #ef4444 30%, transparent);
	}

	.critical-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.severity-badge {
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		background: color-mix(in srgb, #ef4444 15%, transparent);
		color: #ef4444;
	}

	.critical-time {
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
	}

	.critical-message {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-primary);
		margin: 0;
	}

	.critical-path {
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.critical-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	.copy-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.copy-btn:hover {
		color: var(--color-text-primary);
	}

	/* Summary panel */
	.summary-panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		overflow-y: auto;
	}

	.content-area:not(.mobile) .summary-panel {
		grid-column: 2;
		grid-row: 1 / 3;
	}

	.summary-card {
		background: var(--surface-panel);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		padding: 1rem;
	}

	.summary-card h4 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.75rem;
	}

	.summary-card h4 i {
		color: var(--accent-primary);
	}

	.summary-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.summary-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.summary-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-primary);
	}

	.level-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
	}

	.level-dot.info {
		background: #3b82f6;
	}

	.level-dot.warning {
		background: #f59e0b;
	}

	.level-dot.error {
		background: #ef4444;
	}

	.summary-value {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.empty-hint {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		text-align: center;
		padding: 0.5rem;
	}

	/* Empty states */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 2rem;
		color: var(--color-text-secondary);
	}

	.empty-state i {
		font-size: 2rem;
		opacity: 0.5;
	}

	.empty-state p {
		margin: 0;
		font-size: 0.8125rem;
	}

	.empty-state.success i {
		color: #10b981;
	}

	/* Modal */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		justify-content: flex-end;
		background: rgba(0, 0, 0, 0.3);
		backdrop-filter: blur(4px);
	}

	.modal-content {
		width: 100%;
		max-width: 28rem;
		height: 100%;
		background: var(--surface-panel);
		display: flex;
		flex-direction: column;
		box-shadow: -4px 0 24px rgba(0, 0, 0, 0.2);
	}

	.modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 1.25rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
	}

	.modal-header.error {
		border-bottom-color: color-mix(in srgb, #ef4444 20%, transparent);
	}

	.modal-label {
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-text-secondary);
	}

	.modal-header h2 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0.25rem 0 0;
		line-height: 1.3;
	}

	.close-btn {
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 1.25rem;
		cursor: pointer;
	}

	.modal-body {
		flex: 1;
		overflow-y: auto;
		padding: 1.25rem;
	}

	.detail-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.detail-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.detail-item.full {
		grid-column: 1 / -1;
	}

	.detail-label {
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
	}

	.detail-value {
		font-size: 0.8125rem;
		color: var(--color-text-primary);
	}

	.detail-value.mono {
		font-family: monospace;
		font-size: 0.75rem;
		word-break: break-all;
	}

	.json-preview {
		background: color-mix(in srgb, #0f172a 95%, var(--surface-panel));
		border-radius: 10px;
		padding: 1rem;
		overflow: auto;
		max-height: 16rem;
	}

	.json-preview pre {
		margin: 0;
		font-size: 0.6875rem;
		color: #a5f3fc;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.modal-footer {
		display: flex;
		gap: 0.5rem;
		padding: 1rem 1.25rem;
		border-top: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
	}

	.btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.625rem 1rem;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		background: transparent;
		color: var(--color-text-primary);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn:hover {
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
	}

	.btn.primary {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: white;
	}

	.btn.primary:hover {
		opacity: 0.9;
	}

	@media (min-width: 768px) {
		.logs-page {
			padding: 1.5rem;
		}

		.filter-grid {
			grid-template-columns: repeat(3, 1fr);
		}

		.content-area {
			grid-template-columns: 2fr 1fr;
		}
	}
</style>
