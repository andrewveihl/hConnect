<script lang="ts">
	import type { PageData } from './$types';
	import ConfirmDialog from '$lib/admin/components/ConfirmDialog.svelte';
	import { hardDeleteDocument, softDeleteDocument } from '$lib/admin/archive';
	import { showAdminToast } from '$lib/admin/stores/toast';
	import { ensureFirebaseReady, getDb } from '$lib/firebase';
	import { doc, updateDoc } from 'firebase/firestore';
	import { goto } from '$app/navigation';
	import { isMobileViewport } from '$lib/stores/viewport';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	let servers = $state([...data.servers]);
	let search = $state('');
	let pendingAction: { serverId: string; mode: 'archive' | 'delete'; label: string } | null =
		$state(null);
	let busy = $state(false);
	let selectedServer: (typeof data.servers)[number] | null = $state(null);
	let settingsBusy = $state(false);
	let showDetailPanel = $state(false);

	let settingsForm = $state({
		isPublic: false,
		defaultRoleId: '',
		systemChannelId: '',
		description: ''
	});

	const filteredServers = $derived(
		servers.filter((server) => {
			if (!search) return true;
			const q = search.toLowerCase();
			return (
				server.name.toLowerCase().includes(q) ||
				server.id.toLowerCase().includes(q) ||
				server.ownerName.toLowerCase().includes(q)
			);
		})
	);

	$effect(() => {
		if (!selectedServer) return;
		settingsForm = {
			isPublic: Boolean(selectedServer.isPublic),
			defaultRoleId: selectedServer.defaultRoleId ?? '',
			systemChannelId: selectedServer.systemChannelId ?? '',
			description: selectedServer.description ?? ''
		};
	});

	const formatDate = (value: Date | null | undefined) =>
		value ? value.toLocaleDateString() : '--';

	const formatRelativeTime = (date: Date | null | undefined) => {
		if (!date) return '--';
		const diff = Date.now() - date.getTime();
		const days = Math.floor(diff / (1000 * 60 * 60 * 24));
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		if (days < 30) return `${days}d ago`;
		return `${Math.floor(days / 30)}mo ago`;
	};

	const selectServer = (server: (typeof data.servers)[number]) => {
		selectedServer = server;
		if ($isMobileViewport) {
			showDetailPanel = true;
		}
	};

	const closeDetail = () => {
		showDetailPanel = false;
	};

	const queueServerAction = (mode: 'archive' | 'delete') => {
		if (!selectedServer) return;
		pendingAction = {
			serverId: selectedServer.id,
			mode,
			label: selectedServer.name
		};
	};

	const confirmAction = async () => {
		if (!pendingAction) return;
		const currentAction = pendingAction;
		busy = true;
		try {
			const path = `servers/${currentAction.serverId}`;
			if (currentAction.mode === 'archive') {
				await softDeleteDocument(
					{ tab: 'servers', docPath: path, reason: 'Manual admin archive' },
					data.user
				);
				showAdminToast({ type: 'warning', message: 'Server archived.' });
			} else {
				await hardDeleteDocument(path, data.user, {
					reason: 'Manual admin delete',
					scope: 'servers'
				});
				showAdminToast({ type: 'error', message: 'Server hard deleted.' });
			}
			servers = servers.filter((server) => server.id !== currentAction.serverId);
			if (selectedServer?.id === currentAction.serverId) {
				selectedServer = servers[0] ?? null;
				showDetailPanel = false;
			}
			pendingAction = null;
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Action failed.' });
		} finally {
			busy = false;
		}
	};

	const saveServerSettings = async () => {
		if (!selectedServer) return;
		settingsBusy = true;
		try {
			await ensureFirebaseReady();
			const db = getDb();
			const payload = {
				isPublic: settingsForm.isPublic,
				defaultRoleId: settingsForm.defaultRoleId || null,
				systemChannelId: settingsForm.systemChannelId || null,
				description: settingsForm.description || null
			};
			await updateDoc(doc(db, 'servers', selectedServer.id), payload);
			servers = servers.map((server) =>
				server.id === selectedServer?.id ? { ...server, ...payload } : server
			);
			selectedServer = servers.find((server) => server.id === selectedServer?.id) ?? selectedServer;
			showAdminToast({ type: 'success', message: 'Server settings updated.' });
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Unable to update server.'
			});
		} finally {
			settingsBusy = false;
		}
	};

	const goToChannels = () => {
		if (!selectedServer) return;
		goto(`/admin/channels?serverId=${selectedServer.id}`);
	};

	const goToMessages = () => {
		if (!selectedServer) return;
		goto(`/admin/messages?serverId=${selectedServer.id}`);
	};
</script>

<section class="servers-page" class:show-detail={showDetailPanel && $isMobileViewport}>
	<!-- Stats header -->
	<div class="stats-bar">
		<div class="stat">
			<i class="bx bx-server"></i>
			<span class="value">{servers.length}</span>
			<span class="label">Total</span>
		</div>
		<div class="stat">
			<i class="bx bx-check-circle"></i>
			<span class="value">{servers.filter((s) => s.status === 'active').length}</span>
			<span class="label">Active</span>
		</div>
		<div class="stat">
			<i class="bx bx-globe"></i>
			<span class="value">{servers.filter((s) => s.isPublic).length}</span>
			<span class="label">Public</span>
		</div>
	</div>

	<div class="content-grid">
		<!-- Server list panel -->
		<div class="list-panel">
			<div class="search-bar">
				<i class="bx bx-search"></i>
				<input type="search" placeholder="Search servers..." bind:value={search} />
				{#if search}
					<button class="clear-btn" onclick={() => (search = '')} aria-label="Clear search">
						<i class="bx bx-x"></i>
					</button>
				{/if}
			</div>

			<div class="results-info">
				<span>{filteredServers.length} server{filteredServers.length === 1 ? '' : 's'}</span>
			</div>

			<div class="servers-list">
				{#if filteredServers.length === 0}
					<div class="empty-state">
						<i class="bx bx-server"></i>
						<p>No servers match your search</p>
					</div>
				{:else}
					{#each filteredServers as server (server.id)}
						<button
							class="server-card"
							class:selected={selectedServer?.id === server.id}
							onclick={() => selectServer(server)}
						>
							<div class="server-icon">
								<span>{server.name.charAt(0).toUpperCase()}</span>
							</div>
							<div class="server-info">
								<div class="server-name-row">
									<span class="server-name">{server.name}</span>
									<span class="status-badge" class:active={server.status === 'active'}>
										{server.status}
									</span>
								</div>
								<div class="server-meta">
									<span><i class="bx bx-user"></i> {server.ownerName}</span>
									<span><i class="bx bx-group"></i> {server.memberCount ?? 0}</span>
								</div>
								<span class="server-date">{formatRelativeTime(server.createdAt)}</span>
							</div>
							<i class="bx bx-chevron-right chevron"></i>
						</button>
					{/each}
				{/if}
			</div>
		</div>

		<!-- Detail panel -->
		<div class="detail-panel" class:visible={showDetailPanel || !$isMobileViewport}>
			{#if $isMobileViewport && showDetailPanel}
				<button class="back-btn" onclick={closeDetail}>
					<i class="bx bx-arrow-left"></i>
					Back to servers
				</button>
			{/if}

			{#if !selectedServer}
				<div class="empty-state">
					<i class="bx bx-info-circle"></i>
					<p>Select a server to view details</p>
				</div>
			{:else}
				<div class="detail-content">
					<!-- Server header -->
					<div class="detail-header">
						<div class="header-icon">
							<span>{selectedServer.name.charAt(0).toUpperCase()}</span>
						</div>
						<div class="header-info">
							<h2>{selectedServer.name}</h2>
							<p class="server-id">{selectedServer.id}</p>
						</div>
					</div>

					<!-- Quick stats -->
					<div class="quick-stats">
						<div class="quick-stat">
							<span class="stat-label">Owner</span>
							<span class="stat-value">{selectedServer.ownerName}</span>
						</div>
						<div class="quick-stat">
							<span class="stat-label">Members</span>
							<span class="stat-value">{selectedServer.memberCount ?? 0}</span>
						</div>
						<div class="quick-stat">
							<span class="stat-label">Created</span>
							<span class="stat-value">{formatDate(selectedServer.createdAt)}</span>
						</div>
						<div class="quick-stat">
							<span class="stat-label">Status</span>
							<span class="stat-value status" class:active={selectedServer.status === 'active'}>
								{selectedServer.status}
							</span>
						</div>
					</div>

					<!-- Settings form -->
					<div class="settings-section">
						<h3><i class="bx bx-cog"></i> Settings</h3>

						<div class="setting-row toggle">
							<div class="setting-info">
								<span class="setting-label">Public Server</span>
								<span class="setting-desc">Visible in server browser</span>
							</div>
							<label class="toggle-switch">
								<input type="checkbox" bind:checked={settingsForm.isPublic} />
								<span class="toggle-track"></span>
							</label>
						</div>

						<label class="setting-field">
							<span>Default Role ID</span>
							<input type="text" bind:value={settingsForm.defaultRoleId} placeholder="role-id" />
						</label>

						<label class="setting-field">
							<span>System Channel ID</span>
							<input
								type="text"
								bind:value={settingsForm.systemChannelId}
								placeholder="channel-id"
							/>
						</label>

						<label class="setting-field">
							<span>Description</span>
							<textarea
								rows={2}
								bind:value={settingsForm.description}
								placeholder="Optional description"
							></textarea>
						</label>

						<button class="save-btn" onclick={saveServerSettings} disabled={settingsBusy}>
							{#if settingsBusy}
								<i class="bx bx-loader-alt bx-spin"></i> Saving...
							{:else}
								<i class="bx bx-check"></i> Save Settings
							{/if}
						</button>
					</div>

					<!-- Admin tools -->
					<div class="tools-section">
						<h3><i class="bx bx-wrench"></i> Admin Tools</h3>
						<div class="tools-grid">
							<button class="tool-btn primary" onclick={goToChannels}>
								<i class="bx bx-hash"></i>
								<span>Manage Channels</span>
							</button>
							<button class="tool-btn" onclick={goToMessages}>
								<i class="bx bx-message-square-detail"></i>
								<span>Review Messages</span>
							</button>
						</div>
					</div>

					<!-- Danger zone -->
					<div class="danger-section">
						<h3><i class="bx bx-error"></i> Danger Zone</h3>
						<div class="danger-actions">
							<button class="danger-btn warning" onclick={() => queueServerAction('archive')}>
								<i class="bx bx-archive-in"></i>
								Archive Server
							</button>
							<button class="danger-btn error" onclick={() => queueServerAction('delete')}>
								<i class="bx bx-trash"></i>
								Hard Delete
							</button>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
</section>

<ConfirmDialog
	open={Boolean(pendingAction)}
	title={pendingAction?.mode === 'archive' ? 'Archive server' : 'Hard delete server'}
	body={pendingAction?.mode === 'archive'
		? `Server ${pendingAction?.label ?? ''} will be moved into the archive.`
		: `Server ${pendingAction?.label ?? ''} will be permanently deleted.`}
	confirmLabel={pendingAction?.mode === 'archive' ? 'Archive' : 'Delete'}
	tone={pendingAction?.mode === 'archive' ? 'default' : 'danger'}
	{busy}
	on:confirm={confirmAction}
	on:cancel={() => (pendingAction = null)}
/>

<style>
	.servers-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		height: 100%;
		padding: 1rem;
		overflow: hidden;
	}

	/* Stats bar */
	.stats-bar {
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem;
		background: var(--surface-panel);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		flex-shrink: 0;
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

	/* Content grid */
	.content-grid {
		display: grid;
		grid-template-columns: 1fr 1.5fr;
		gap: 1rem;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	/* List panel */
	.list-panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background: var(--surface-panel);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		padding: 1rem;
		overflow: hidden;
	}

	.search-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
		border-radius: 8px;
	}

	.search-bar i {
		color: var(--color-text-secondary);
	}

	.search-bar input {
		flex: 1;
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		font-size: 0.875rem;
	}

	.search-bar input::placeholder {
		color: var(--color-text-secondary);
	}

	.clear-btn {
		width: 1.5rem;
		height: 1.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.results-info {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.servers-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		overflow-y: auto;
		flex: 1;
	}

	.server-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		border-radius: 10px;
		cursor: pointer;
		text-align: left;
		transition: all 0.2s;
	}

	.server-card:hover {
		border-color: color-mix(in srgb, var(--accent-primary) 30%, transparent);
	}

	.server-card.selected {
		background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
		border-color: var(--accent-primary);
	}

	.server-icon {
		width: 2.5rem;
		height: 2.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 10px;
		background: linear-gradient(
			135deg,
			var(--accent-primary),
			color-mix(in srgb, var(--accent-primary) 70%, #8b5cf6)
		);
		flex-shrink: 0;
		overflow: hidden;
	}

	.server-icon span {
		font-size: 1rem;
		font-weight: 700;
		color: white;
	}

	.server-info {
		flex: 1;
		min-width: 0;
	}

	.server-name-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.server-name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.status-badge {
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		background: color-mix(in srgb, #f59e0b 15%, transparent);
		color: #b45309;
	}

	.status-badge.active {
		background: color-mix(in srgb, #10b981 15%, transparent);
		color: #059669;
	}

	.server-meta {
		display: flex;
		gap: 0.75rem;
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
		margin-top: 0.25rem;
	}

	.server-meta span {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.server-date {
		font-size: 0.625rem;
		color: var(--color-text-secondary);
	}

	.chevron {
		color: var(--color-text-secondary);
	}

	/* Detail panel */
	.detail-panel {
		display: flex;
		flex-direction: column;
		background: var(--surface-panel);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		overflow: hidden;
	}

	.back-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border: none;
		border-bottom: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		background: transparent;
		color: var(--accent-primary);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
	}

	.detail-content {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		overflow-y: auto;
		flex: 1;
	}

	.detail-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
	}

	.header-icon {
		width: 3.5rem;
		height: 3.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 12px;
		background: linear-gradient(
			135deg,
			var(--accent-primary),
			color-mix(in srgb, var(--accent-primary) 70%, #8b5cf6)
		);
		flex-shrink: 0;
		overflow: hidden;
	}

	.header-icon span {
		font-size: 1.5rem;
		font-weight: 700;
		color: white;
	}

	.header-info h2 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.server-id {
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
		font-family: monospace;
		margin-top: 0.25rem;
	}

	/* Quick stats */
	.quick-stats {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}

	.quick-stat {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.75rem;
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
		border-radius: 8px;
	}

	.stat-label {
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
	}

	.stat-value {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.stat-value.status {
		text-transform: capitalize;
	}

	.stat-value.status.active {
		color: #10b981;
	}

	/* Settings section */
	.settings-section,
	.tools-section,
	.danger-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.settings-section h3,
	.tools-section h3,
	.danger-section h3 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.settings-section h3 i,
	.tools-section h3 i {
		color: var(--accent-primary);
	}

	.danger-section h3 i {
		color: #ef4444;
	}

	.setting-row.toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem;
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
		border-radius: 8px;
	}

	.setting-info {
		display: flex;
		flex-direction: column;
	}

	.setting-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.setting-desc {
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
	}

	.toggle-switch {
		position: relative;
		width: 2.5rem;
		height: 1.375rem;
	}

	.toggle-switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle-track {
		position: absolute;
		inset: 0;
		border-radius: 9999px;
		background: color-mix(in srgb, var(--color-text-primary) 20%, transparent);
		cursor: pointer;
		transition: background 0.2s;
	}

	.toggle-track::before {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 50%;
		background: white;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
		transition: transform 0.2s;
	}

	.toggle-switch input:checked + .toggle-track {
		background: #10b981;
	}

	.toggle-switch input:checked + .toggle-track::before {
		transform: translateX(1.125rem);
	}

	.setting-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.setting-field span {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.setting-field input,
	.setting-field textarea {
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		background: transparent;
		color: var(--color-text-primary);
		font-size: 0.8125rem;
		resize: none;
	}

	.save-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
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
		transition: opacity 0.2s;
	}

	.save-btn:hover {
		opacity: 0.9;
	}

	.save-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* Tools */
	.tools-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;
	}

	.tool-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
		padding: 0.875rem;
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		background: transparent;
		color: var(--color-text-primary);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.tool-btn:hover {
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
	}

	.tool-btn.primary {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: white;
	}

	.tool-btn i {
		font-size: 1.25rem;
	}

	/* Danger zone */
	.danger-actions {
		display: flex;
		gap: 0.5rem;
	}

	.danger-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.625rem;
		border-radius: 8px;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.danger-btn.warning {
		border: 1px solid color-mix(in srgb, #f59e0b 40%, transparent);
		background: color-mix(in srgb, #f59e0b 10%, transparent);
		color: #b45309;
	}

	.danger-btn.warning:hover {
		background: color-mix(in srgb, #f59e0b 20%, transparent);
	}

	.danger-btn.error {
		border: 1px solid color-mix(in srgb, #ef4444 40%, transparent);
		background: color-mix(in srgb, #ef4444 10%, transparent);
		color: #dc2626;
	}

	.danger-btn.error:hover {
		background: color-mix(in srgb, #ef4444 20%, transparent);
	}

	/* Empty state */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 2rem;
		color: var(--color-text-secondary);
		flex: 1;
	}

	.empty-state i {
		font-size: 2rem;
		opacity: 0.5;
	}

	.empty-state p {
		margin: 0;
		font-size: 0.8125rem;
	}

	/* Mobile responsiveness */
	@media (max-width: 768px) {
		.content-grid {
			grid-template-columns: 1fr;
		}

		.detail-panel {
			position: fixed;
			inset: 0;
			z-index: 40;
			border-radius: 0;
			transform: translateX(100%);
			transition: transform 0.3s ease;
		}

		.detail-panel.visible {
			transform: translateX(0);
		}

		.servers-page.show-detail .list-panel {
			display: none;
		}
	}

	@media (min-width: 768px) {
		.servers-page {
			padding: 1.5rem;
		}

		.back-btn {
			display: none;
		}
	}
</style>
