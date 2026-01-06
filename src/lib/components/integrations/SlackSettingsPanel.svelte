<!--
	Slack Integration Settings Panel
	Allows server admins to connect Slack workspaces and link channels
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		slackConfigStore,
		slackWorkspacesStore,
		slackBridgesStore,
		slackLoadingStore,
		slackErrorStore,
		loadAllSlackData,
		subscribeToSlackBridges,
		toggleSlackIntegration,
		createSlackBridge,
		deleteSlackBridge,
		pauseSlackBridge,
		resumeSlackBridge,
		getBridgesForServer
	} from '$lib/admin/integrations/slack/store';
	import type { SlackChannelBridge, SyncDirection } from '$lib/admin/integrations/slack/types';
	import { REQUIRED_BOT_SCOPES } from '$lib/admin/integrations/slack/types';

	// Props using Svelte 5 runes
	interface Props {
		serverId: string;
		serverName?: string;
		channels?: Array<{ id: string; name: string; type: string }>;
		onClose?: () => void;
	}

	let { serverId, serverName = 'Server', channels = [], onClose = () => {} }: Props = $props();

	// Local state
	let view = $state<'main' | 'connect' | 'link-channel' | 'manage-bridge'>('main');
	let selectedBridge = $state<SlackChannelBridge | null>(null);

	// Form state for linking
	let linkForm = $state({
		slackWorkspaceId: '',
		slackChannelId: '',
		slackChannelName: '',
		hconnectChannelId: '',
		syncDirection: 'slack-to-hconnect' as SyncDirection,
		syncReactions: true,
		syncThreads: false,
		syncAttachments: true,
		showSlackUsernames: true
	});

	// Subscriptions
	let unsubscribeBridges: (() => void) | null = null;

	// Derived state using Svelte 5 runes
	let config = $derived($slackConfigStore);
	let workspaces = $derived($slackWorkspacesStore);
	let allBridges = $derived($slackBridgesStore);
	let serverBridges = $derived(allBridges.filter((b) => b.hconnectServerId === serverId));
	let loading = $derived($slackLoadingStore);
	let error = $derived($slackErrorStore);
	let hasWorkspaces = $derived(workspaces.length > 0);

	// Generate Slack OAuth URL
	let slackOAuthUrl = $derived(generateSlackOAuthUrl());

	function generateSlackOAuthUrl(): string {
		const clientId = import.meta.env.VITE_SLACK_CLIENT_ID || '';
		const redirectUri = encodeURIComponent(
			import.meta.env.VITE_SLACK_REDIRECT_URI ||
				'https://us-central1-hconnect-6212b.cloudfunctions.net/slackOAuth'
		);
		const scopes = encodeURIComponent(REQUIRED_BOT_SCOPES.join(','));
		const state = encodeURIComponent(window.location.href);

		return `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;
	}

	onMount(async () => {
		await loadAllSlackData();
		unsubscribeBridges = subscribeToSlackBridges();
	});

	onDestroy(() => {
		unsubscribeBridges?.();
	});

	// Actions
	async function handleToggleEnabled() {
		await toggleSlackIntegration(!config.enabled);
	}

	async function handleCreateBridge() {
		if (!linkForm.slackWorkspaceId || !linkForm.hconnectChannelId) {
			return;
		}

		const workspace = workspaces.find((w) => w.id === linkForm.slackWorkspaceId);
		if (!workspace) return;

		const hconnectChannel = channels.find((c) => c.id === linkForm.hconnectChannelId);
		if (!hconnectChannel) return;

		await createSlackBridge({
			slackWorkspaceId: workspace.id,
			slackTeamId: workspace.teamId,
			slackTeamName: workspace.teamName,
			slackChannelId: linkForm.slackChannelId,
			slackChannelName: linkForm.slackChannelName || 'Slack Channel',
			hconnectServerId: serverId,
			hconnectServerName: serverName,
			hconnectChannelId: hconnectChannel.id,
			hconnectChannelName: hconnectChannel.name,
			syncDirection: linkForm.syncDirection,
			status: 'active',
			syncReactions: linkForm.syncReactions,
			syncThreads: linkForm.syncThreads,
			syncAttachments: linkForm.syncAttachments,
			showSlackUsernames: linkForm.showSlackUsernames,
			createdBy: '' // Will be filled by auth context
		});

		// Reset and go back
		resetLinkForm();
		view = 'main';
	}

	async function handleDeleteBridge(bridgeId: string) {
		if (confirm('Are you sure you want to remove this channel link?')) {
			await deleteSlackBridge(bridgeId);
		}
	}

	async function handleToggleBridge(bridge: SlackChannelBridge) {
		if (bridge.status === 'active') {
			await pauseSlackBridge(bridge.id);
		} else if (bridge.status === 'paused') {
			await resumeSlackBridge(bridge.id);
		}
	}

	function resetLinkForm() {
		linkForm = {
			slackWorkspaceId: workspaces[0]?.id || '',
			slackChannelId: '',
			slackChannelName: '',
			hconnectChannelId: '',
			syncDirection: 'slack-to-hconnect',
			syncReactions: true,
			syncThreads: false,
			syncAttachments: true,
			showSlackUsernames: true
		};
	}

	function openConnectWorkspace() {
		window.open(slackOAuthUrl, '_blank', 'width=600,height=700');
	}

	function getStatusColor(status: string): string {
		switch (status) {
			case 'active':
				return 'var(--green)';
			case 'paused':
				return 'var(--yellow)';
			case 'error':
				return 'var(--red)';
			default:
				return 'var(--text-50)';
		}
	}

	function getSyncDirectionLabel(direction: SyncDirection): string {
		switch (direction) {
			case 'slack-to-hconnect':
				return 'Slack → hConnect';
			case 'hconnect-to-slack':
				return 'hConnect → Slack';
			case 'bidirectional':
				return 'Both ways';
			default:
				return direction;
		}
	}
</script>

<div class="slack-settings">
	<!-- Header -->
	<div class="slack-header">
		<div class="slack-header__left">
			{#if view !== 'main'}
				<button class="back-btn" on:click={() => (view = 'main')}>
					<i class="bx bx-arrow-back"></i>
				</button>
			{/if}
			<div class="slack-header__icon">
				<svg viewBox="0 0 24 24" width="28" height="28">
					<path
						fill="currentColor"
						d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.52-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.271 0a2.528 2.528 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zm-2.521 10.124a2.528 2.528 0 0 1 2.521 2.52A2.528 2.528 0 0 1 15.166 24a2.528 2.528 0 0 1-2.521-2.522v-2.52h2.521zm0-1.271a2.528 2.528 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.313A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.313z"
					/>
				</svg>
			</div>
			<div class="slack-header__text">
				<h2>Slack Integration</h2>
				<p>
					{#if view === 'main'}
						Bridge Slack channels to hConnect
					{:else if view === 'connect'}
						Connect a Slack workspace
					{:else if view === 'link-channel'}
						Link a channel
					{:else if view === 'manage-bridge'}
						Manage channel link
					{/if}
				</p>
			</div>
		</div>
		<button class="close-btn" on:click={onClose}>
			<i class="bx bx-x"></i>
		</button>
	</div>

	<!-- Loading state -->
	{#if loading}
		<div class="slack-loading">
			<div class="spinner"></div>
			<span>Loading...</span>
		</div>
	{:else}
		<!-- Main View -->
		{#if view === 'main'}
			<div class="slack-content">
				<!-- Enable/Disable Toggle -->
				<div class="setting-row">
					<div class="setting-info">
						<span class="setting-label">Enable Slack Integration</span>
						<span class="setting-description">Allow syncing messages with Slack channels</span>
					</div>
					<label class="toggle">
						<input type="checkbox" checked={config.enabled} on:change={handleToggleEnabled} />
						<span class="toggle__slider"></span>
					</label>
				</div>

				{#if config.enabled}
					<!-- Workspaces Section -->
					<div class="section">
						<div class="section-header">
							<h3>Connected Workspaces</h3>
							<button class="btn btn--small" on:click={openConnectWorkspace}>
								<i class="bx bx-plus"></i>
								Add Workspace
							</button>
						</div>

						{#if workspaces.length === 0}
							<div class="empty-state">
								<i class="bx bx-buildings"></i>
								<p>No Slack workspaces connected</p>
								<button class="btn btn--primary" on:click={openConnectWorkspace}>
									Connect Slack Workspace
								</button>
							</div>
						{:else}
							<div class="workspace-list">
								{#each workspaces as workspace (workspace.id)}
									<div class="workspace-card">
										<div class="workspace-icon">
											{#if workspace.teamIcon}
												<img src={workspace.teamIcon} alt={workspace.teamName} />
											{:else}
												<i class="bx bx-buildings"></i>
											{/if}
										</div>
										<div class="workspace-info">
											<span class="workspace-name">{workspace.teamName}</span>
											<span class="workspace-domain">{workspace.teamDomain}.slack.com</span>
										</div>
										<span class="workspace-status">Connected</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Channel Links Section -->
					<div class="section">
						<div class="section-header">
							<h3>Channel Links</h3>
							{#if hasWorkspaces}
								<button
									class="btn btn--small"
									on:click={() => {
										resetLinkForm();
										view = 'link-channel';
									}}
								>
									<i class="bx bx-link"></i>
									Link Channel
								</button>
							{/if}
						</div>

						{#if serverBridges.length === 0}
							<div class="empty-state">
								<i class="bx bx-link-alt"></i>
								<p>No channels linked yet</p>
								{#if hasWorkspaces}
									<button
										class="btn btn--primary"
										on:click={() => {
											resetLinkForm();
											view = 'link-channel';
										}}
									>
										Link Your First Channel
									</button>
								{:else}
									<p class="empty-hint">Connect a Slack workspace first</p>
								{/if}
							</div>
						{:else}
							<div class="bridge-list">
								{#each serverBridges as bridge (bridge.id)}
									<div class="bridge-card">
										<div class="bridge-channels">
											<div class="bridge-channel">
												<span class="bridge-label">Slack</span>
												<span class="bridge-name">#{bridge.slackChannelName}</span>
											</div>
											<div class="bridge-arrow">
												{#if bridge.syncDirection === 'bidirectional'}
													<i class="bx bx-transfer-alt"></i>
												{:else if bridge.syncDirection === 'slack-to-hconnect'}
													<i class="bx bx-right-arrow-alt"></i>
												{:else}
													<i class="bx bx-left-arrow-alt"></i>
												{/if}
											</div>
											<div class="bridge-channel">
												<span class="bridge-label">hConnect</span>
												<span class="bridge-name">#{bridge.hconnectChannelName}</span>
											</div>
										</div>
										<div class="bridge-meta">
											<span
												class="bridge-status"
												style="--status-color: {getStatusColor(bridge.status)}"
											>
												<span class="status-dot"></span>
												{bridge.status}
											</span>
											<span class="bridge-direction">
												{getSyncDirectionLabel(bridge.syncDirection)}
											</span>
											{#if bridge.messageCount}
												<span class="bridge-count">
													{bridge.messageCount} messages synced
												</span>
											{/if}
										</div>
										<div class="bridge-actions">
											<button
												class="icon-btn"
												title={bridge.status === 'active' ? 'Pause' : 'Resume'}
												on:click={() => handleToggleBridge(bridge)}
											>
												<i class="bx {bridge.status === 'active' ? 'bx-pause' : 'bx-play'}"></i>
											</button>
											<button
												class="icon-btn icon-btn--danger"
												title="Remove"
												on:click={() => handleDeleteBridge(bridge.id)}
											>
												<i class="bx bx-trash"></i>
											</button>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{:else}
					<div class="disabled-notice">
						<i class="bx bx-info-circle"></i>
						<p>Enable Slack integration to connect channels</p>
					</div>
				{/if}
			</div>

			<!-- Link Channel View -->
		{:else if view === 'link-channel'}
			<div class="slack-content">
				<form class="link-form" on:submit|preventDefault={handleCreateBridge}>
					<!-- Workspace Selection -->
					<div class="form-group">
						<label for="workspace">Slack Workspace</label>
						<select id="workspace" bind:value={linkForm.slackWorkspaceId} required>
							<option value="">Select workspace...</option>
							{#each workspaces as workspace (workspace.id)}
								<option value={workspace.id}>{workspace.teamName}</option>
							{/each}
						</select>
					</div>

					<!-- Slack Channel (manual input for now) -->
					<div class="form-group">
						<label for="slackChannel">Slack Channel ID</label>
						<input
							id="slackChannel"
							type="text"
							placeholder="C0XXXXXXXXX"
							bind:value={linkForm.slackChannelId}
							required
						/>
						<span class="form-hint">
							Find this in Slack: right-click channel → View channel details → scroll to bottom
						</span>
					</div>

					<div class="form-group">
						<label for="slackChannelName">Slack Channel Name</label>
						<input
							id="slackChannelName"
							type="text"
							placeholder="general"
							bind:value={linkForm.slackChannelName}
							required
						/>
					</div>

					<!-- hConnect Channel -->
					<div class="form-group">
						<label for="hconnectChannel">hConnect Channel</label>
						<select id="hconnectChannel" bind:value={linkForm.hconnectChannelId} required>
							<option value="">Select channel...</option>
							{#each channels.filter((c) => c.type === 'text') as channel (channel.id)}
								<option value={channel.id}>#{channel.name}</option>
							{/each}
						</select>
					</div>

					<!-- Sync Direction -->
					<div class="form-group">
						<label for="syncDirection">Sync Direction</label>
						<select id="syncDirection" bind:value={linkForm.syncDirection}>
							<option value="slack-to-hconnect">Slack → hConnect (one-way)</option>
							<option value="hconnect-to-slack">hConnect → Slack (one-way)</option>
							<option value="bidirectional">Both ways (bidirectional)</option>
						</select>
					</div>

					<!-- Options -->
					<div class="form-group">
						<label>Options</label>
						<div class="checkbox-group">
							<label class="checkbox-label">
								<input type="checkbox" bind:checked={linkForm.showSlackUsernames} />
								Show Slack usernames in messages
							</label>
							<label class="checkbox-label">
								<input type="checkbox" bind:checked={linkForm.syncAttachments} />
								Sync file attachments
							</label>
							<label class="checkbox-label">
								<input type="checkbox" bind:checked={linkForm.syncReactions} />
								Sync reactions (coming soon)
							</label>
							<label class="checkbox-label">
								<input type="checkbox" bind:checked={linkForm.syncThreads} disabled />
								Sync thread replies (coming soon)
							</label>
						</div>
					</div>

					<div class="form-actions">
						<button type="button" class="btn" on:click={() => (view = 'main')}>Cancel</button>
						<button
							type="submit"
							class="btn btn--primary"
							disabled={!linkForm.slackWorkspaceId ||
								!linkForm.slackChannelId ||
								!linkForm.hconnectChannelId}
						>
							Create Link
						</button>
					</div>
				</form>
			</div>
		{/if}
	{/if}

	<!-- Error Toast -->
	{#if error}
		<div class="error-toast">
			<i class="bx bx-error-circle"></i>
			<span>{error}</span>
		</div>
	{/if}
</div>

<style>
	.slack-settings {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--bg-secondary, #1e1e1e);
		color: var(--text, #fff);
	}

	/* Header */
	.slack-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--border, #333);
		background: var(--bg-tertiary, #252525);
	}

	.slack-header__left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.slack-header__icon {
		color: #e01e5a;
	}

	.slack-header__text h2 {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
	}

	.slack-header__text p {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--text-70, #aaa);
	}

	.back-btn,
	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		background: none;
		border: none;
		color: var(--text-70, #aaa);
		border-radius: 0.375rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.back-btn:hover,
	.close-btn:hover {
		background: var(--bg-hover, #333);
		color: var(--text, #fff);
	}

	/* Content */
	.slack-content {
		flex: 1;
		overflow-y: auto;
		padding: 1.5rem;
	}

	/* Loading */
	.slack-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3rem;
		color: var(--text-70, #aaa);
	}

	.spinner {
		width: 1.5rem;
		height: 1.5rem;
		border: 2px solid var(--border, #333);
		border-top-color: var(--accent, #7c5cff);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Settings Row */
	.setting-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem;
		background: var(--bg-tertiary, #252525);
		border-radius: 0.5rem;
		margin-bottom: 1.5rem;
	}

	.setting-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.setting-label {
		font-weight: 500;
	}

	.setting-description {
		font-size: 0.8125rem;
		color: var(--text-70, #aaa);
	}

	/* Toggle */
	.toggle {
		position: relative;
		display: inline-block;
		width: 44px;
		height: 24px;
	}

	.toggle input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.toggle__slider {
		position: absolute;
		cursor: pointer;
		inset: 0;
		background: var(--bg-elevated, #333);
		border-radius: 24px;
		transition: 0.2s;
	}

	.toggle__slider::before {
		position: absolute;
		content: '';
		height: 18px;
		width: 18px;
		left: 3px;
		bottom: 3px;
		background: #fff;
		border-radius: 50%;
		transition: 0.2s;
	}

	.toggle input:checked + .toggle__slider {
		background: var(--green, #34c759);
	}

	.toggle input:checked + .toggle__slider::before {
		transform: translateX(20px);
	}

	/* Sections */
	.section {
		margin-bottom: 2rem;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.section-header h3 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-70, #aaa);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	/* Empty State */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2rem;
		text-align: center;
		background: var(--bg-tertiary, #252525);
		border-radius: 0.5rem;
		border: 1px dashed var(--border, #333);
	}

	.empty-state i {
		font-size: 2.5rem;
		color: var(--text-50, #888);
		margin-bottom: 0.75rem;
	}

	.empty-state p {
		margin: 0 0 1rem;
		color: var(--text-70, #aaa);
	}

	.empty-hint {
		font-size: 0.8125rem;
		color: var(--text-50, #888);
	}

	/* Workspace List */
	.workspace-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.workspace-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--bg-tertiary, #252525);
		border-radius: 0.5rem;
	}

	.workspace-icon {
		width: 2.5rem;
		height: 2.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-elevated, #333);
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.workspace-icon img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.workspace-icon i {
		font-size: 1.25rem;
		color: var(--text-50, #888);
	}

	.workspace-info {
		flex: 1;
		display: flex;
		flex-direction: column;
	}

	.workspace-name {
		font-weight: 500;
	}

	.workspace-domain {
		font-size: 0.8125rem;
		color: var(--text-50, #888);
	}

	.workspace-status {
		font-size: 0.75rem;
		color: var(--green, #34c759);
		padding: 0.25rem 0.5rem;
		background: rgba(52, 199, 89, 0.15);
		border-radius: 0.25rem;
	}

	/* Bridge List */
	.bridge-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.bridge-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--bg-tertiary, #252525);
		border-radius: 0.5rem;
	}

	.bridge-channels {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.bridge-channel {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.bridge-label {
		font-size: 0.6875rem;
		text-transform: uppercase;
		color: var(--text-50, #888);
		letter-spacing: 0.05em;
	}

	.bridge-name {
		font-weight: 500;
		font-family: var(--font-mono, monospace);
	}

	.bridge-arrow {
		color: var(--text-50, #888);
		font-size: 1.25rem;
	}

	.bridge-meta {
		display: flex;
		align-items: center;
		gap: 1rem;
		font-size: 0.8125rem;
		color: var(--text-70, #aaa);
	}

	.bridge-status {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		text-transform: capitalize;
	}

	.status-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--status-color);
	}

	.bridge-actions {
		display: flex;
		gap: 0.5rem;
		margin-left: auto;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		background: var(--bg-elevated, #333);
		border: none;
		border-radius: 0.375rem;
		color: var(--text-70, #aaa);
		cursor: pointer;
		transition: all 0.15s;
	}

	.icon-btn:hover {
		background: var(--bg-hover, #444);
		color: var(--text, #fff);
	}

	.icon-btn--danger:hover {
		background: rgba(255, 69, 58, 0.2);
		color: var(--red, #ff453a);
	}

	/* Disabled Notice */
	.disabled-notice {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--bg-tertiary, #252525);
		border-radius: 0.5rem;
		color: var(--text-70, #aaa);
	}

	.disabled-notice i {
		font-size: 1.25rem;
	}

	/* Form */
	.link-form {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.form-group label {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.form-group input,
	.form-group select {
		padding: 0.625rem 0.75rem;
		background: var(--bg-tertiary, #252525);
		border: 1px solid var(--border, #333);
		border-radius: 0.375rem;
		color: var(--text, #fff);
		font-size: 0.9375rem;
	}

	.form-group input:focus,
	.form-group select:focus {
		outline: none;
		border-color: var(--accent, #7c5cff);
	}

	.form-hint {
		font-size: 0.75rem;
		color: var(--text-50, #888);
	}

	.checkbox-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		font-weight: normal;
		cursor: pointer;
	}

	.checkbox-label input[type='checkbox'] {
		width: 1rem;
		height: 1rem;
		accent-color: var(--accent, #7c5cff);
	}

	.checkbox-label input[type='checkbox']:disabled {
		opacity: 0.5;
	}

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		background: var(--bg-elevated, #333);
		border: none;
		border-radius: 0.375rem;
		color: var(--text, #fff);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.btn:hover {
		background: var(--bg-hover, #444);
	}

	.btn--small {
		padding: 0.375rem 0.75rem;
		font-size: 0.8125rem;
	}

	.btn--primary {
		background: var(--accent, #7c5cff);
	}

	.btn--primary:hover {
		background: var(--accent-hover, #6b4ce0);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Error Toast */
	.error-toast {
		position: absolute;
		bottom: 1rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: rgba(255, 69, 58, 0.9);
		border-radius: 0.5rem;
		color: #fff;
		font-size: 0.875rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}
</style>
