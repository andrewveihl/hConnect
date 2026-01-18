<!--
	Slack Integration Settings Panel
	Allows server admins to connect Slack workspaces and link channels
	Each server has its own Slack app credentials
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		serverSlackConfigStore,
		serverSlackWorkspacesStore,
		serverSlackBridgesStore,
		slackLoadingStore,
		slackErrorStore,
		loadAllServerSlackData,
		subscribeToServerSlackBridges,
		subscribeToServerSlackWorkspaces,
		subscribeToServerSlackConfig,
		toggleSlackIntegration,
		saveSlackCredentials,
		createSlackBridge,
		deleteSlackBridge,
		pauseSlackBridge,
		resumeSlackBridge,
		generateSlackOAuthUrl,
		fetchSlackChannels,
		type SlackChannelInfo
	} from '$lib/admin/integrations/slack/store';
	import type { SlackChannelBridge, SyncDirection, SlackAppCredentials } from '$lib/admin/integrations/slack/types';
	import { REQUIRED_BOT_SCOPES } from '$lib/admin/integrations/slack/types';
	import { getDb, getStorageInstance } from '$lib/firebase';
	import { doc, updateDoc } from 'firebase/firestore';
	import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

	// Props using Svelte 5 runes
	interface Props {
		serverId: string;
		serverName?: string;
		channels?: Array<{ id: string; name: string; type: string }>;
		onClose?: () => void;
	}

	let { serverId, serverName = 'Server', channels = [], onClose = () => {} }: Props = $props();

	// Local state
	let view = $state<'main' | 'setup' | 'connect' | 'link-channel' | 'manage-bridge'>('main');
	let selectedBridge = $state<SlackChannelBridge | null>(null);
	let showSecrets = $state(false);

	// Slack channel picker state
	let slackChannels = $state<SlackChannelInfo[]>([]);
	let loadingSlackChannels = $state(false);
	let slackChannelsError = $state<string | null>(null);

	// Server-level hConnect avatar override
	let hconnectAvatarUrl = $state<string>('');
	let avatarSaving = $state(false);
	let avatarError = $state<string | null>(null);
	let avatarSuccess = $state(false);
	let avatarUploading = $state(false);
	let avatarUploadProgress = $state(0);
	let avatarFileInput: HTMLInputElement | undefined = $state();

	// Credentials form
	let credentialsForm = $state<SlackAppCredentials>({
		clientId: '',
		clientSecret: '',
		signingSecret: ''
	});

	// Form state for linking
	let linkForm = $state({
		slackWorkspaceId: '',
		slackChannelId: '',
		slackChannelName: '',
		hconnectChannelId: '',
		syncDirection: 'bidirectional' as SyncDirection,
		syncReactions: true,
		syncThreads: true,
		syncAttachments: true,
		showSlackUsernames: true
	});

	// Subscriptions
	let unsubscribeBridges: (() => void) | null = null;
	let unsubscribeWorkspaces: (() => void) | null = null;
	let unsubscribeConfig: (() => void) | null = null;

	// Derived state using Svelte 5 runes
	let config = $derived($serverSlackConfigStore);
	let workspaces = $derived($serverSlackWorkspacesStore);
	let serverBridges = $derived($serverSlackBridgesStore);
	let loading = $derived($slackLoadingStore);
	let error = $derived($slackErrorStore);
	let hasWorkspaces = $derived(workspaces.length > 0);
	let hasCredentials = $derived(!!config.credentials?.clientId);

	// Generate Slack OAuth URL using per-server credentials
	let slackOAuthUrl = $derived(
		config.credentials?.clientId 
			? generateSlackOAuthUrl(serverId, config.credentials.clientId)
			: ''
	);

	onMount(async () => {
		await loadAllServerSlackData(serverId);
		unsubscribeConfig = subscribeToServerSlackConfig(serverId);
		unsubscribeBridges = subscribeToServerSlackBridges(serverId);
		unsubscribeWorkspaces = subscribeToServerSlackWorkspaces(serverId);
		
		// Pre-fill credentials form if already set
		if (config.credentials) {
			credentialsForm = { ...config.credentials };
		}

		// Load server-level avatar override
		if (config.hconnectAvatarUrl) {
			hconnectAvatarUrl = config.hconnectAvatarUrl;
		}
	});

	onDestroy(() => {
		unsubscribeConfig?.();
		unsubscribeBridges?.();
		unsubscribeWorkspaces?.();
	});

	// Keep avatar URL in sync with config changes
	$effect(() => {
		if (config.hconnectAvatarUrl !== undefined) {
			hconnectAvatarUrl = config.hconnectAvatarUrl || '';
		}
	});

	// Upload avatar to Firebase Storage
	async function handleAvatarUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		// Validate file type
		if (!file.type.startsWith('image/')) {
			avatarError = 'Please select an image file';
			return;
		}

		// Validate file size (max 2MB)
		if (file.size > 2 * 1024 * 1024) {
			avatarError = 'Image must be less than 2MB';
			return;
		}

		avatarUploading = true;
		avatarError = null;
		avatarUploadProgress = 0;

		try {
			const storage = getStorageInstance();
			const ext = file.name.split('.').pop() || 'png';
			const timestamp = Date.now();
			const storagePath = `servers/${serverId}/integrations/slack-avatar-${timestamp}.${ext}`;
			const storageRef = ref(storage, storagePath);

			// Upload the file
			await uploadBytes(storageRef, file, { contentType: file.type });
			avatarUploadProgress = 100;

			// Get the download URL
			const downloadUrl = await getDownloadURL(storageRef);
			hconnectAvatarUrl = downloadUrl;

			// Save the URL to Firestore
			await saveHConnectAvatarUrl();
		} catch (err: any) {
			console.error('Failed to upload avatar:', err);
			avatarError = err?.message || 'Failed to upload';
		} finally {
			avatarUploading = false;
			avatarUploadProgress = 0;
			// Reset the file input
			if (avatarFileInput) {
				avatarFileInput.value = '';
			}
		}
	}

	// Save server-level hConnect avatar URL
	async function saveHConnectAvatarUrl() {
		avatarSaving = true;
		avatarError = null;
		avatarSuccess = false;

		try {
			const db = getDb();
			const configRef = doc(db, `servers/${serverId}/integrations/slack`);
			await updateDoc(configRef, { 
				hconnectAvatarUrl: hconnectAvatarUrl || null 
			});
			avatarSuccess = true;
			setTimeout(() => avatarSuccess = false, 3000);
		} catch (err: any) {
			console.error('Failed to save hConnect avatar URL:', err);
			avatarError = err?.message || 'Failed to save';
		} finally {
			avatarSaving = false;
		}
	}

	// Clear/remove the avatar
	async function clearAvatar() {
		hconnectAvatarUrl = '';
		await saveHConnectAvatarUrl();
	}

	// Actions
	async function handleToggleEnabled() {
		await toggleSlackIntegration(!config.enabled);
	}

	async function handleSaveCredentials() {
		if (!credentialsForm.clientId || !credentialsForm.clientSecret || !credentialsForm.signingSecret) {
			return;
		}
		await saveSlackCredentials(serverId, credentialsForm);
		view = 'main';
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
			syncDirection: 'bidirectional',
			syncReactions: true,
			syncThreads: true,
			syncAttachments: true,
			showSlackUsernames: true
		};
		slackChannels = [];
		slackChannelsError = null;
	}

	async function handleWorkspaceChange(workspaceId: string) {
		linkForm.slackWorkspaceId = workspaceId;
		linkForm.slackChannelId = '';
		linkForm.slackChannelName = '';
		slackChannels = [];
		slackChannelsError = null;

		if (!workspaceId) return;

		loadingSlackChannels = true;
		try {
			console.log('[slack] Fetching channels for workspace:', workspaceId);
			slackChannels = await fetchSlackChannels(serverId, workspaceId);
			console.log('[slack] Fetched channels:', slackChannels.length, slackChannels);
			
			if (slackChannels.length === 0) {
				slackChannelsError = 'No channels found. Make sure the bot has "channels:read" and "groups:read" scopes, and is added to at least one channel.';
			}
		} catch (err: any) {
			console.error('Failed to load Slack channels:', err);
			const errorMsg = err?.message || err?.code || 'Unknown error';
			slackChannelsError = `Failed to load channels: ${errorMsg}. You can still enter the channel ID manually.`;
		} finally {
			loadingSlackChannels = false;
		}
	}

	function handleSlackChannelSelect(channel: SlackChannelInfo) {
		linkForm.slackChannelId = channel.id;
		linkForm.slackChannelName = channel.name;
	}

	async function refreshSlackChannels() {
		if (!linkForm.slackWorkspaceId) return;

		loadingSlackChannels = true;
		slackChannelsError = null;
		try {
			console.log('[slack] Refreshing channels for workspace:', linkForm.slackWorkspaceId);
			slackChannels = await fetchSlackChannels(serverId, linkForm.slackWorkspaceId);
			console.log('[slack] Refreshed channels:', slackChannels.length, slackChannels);
			
			if (slackChannels.length === 0) {
				slackChannelsError = 'No channels found. Make sure the bot has "channels:read" and "groups:read" scopes, and is added to at least one channel.';
			}
		} catch (err: any) {
			console.error('Failed to refresh Slack channels:', err);
			const errorMsg = err?.message || err?.code || 'Unknown error';
			slackChannelsError = `Failed to load channels: ${errorMsg}. You can still enter the channel ID manually.`;
		} finally {
			loadingSlackChannels = false;
		}
	}

	function openConnectWorkspace() {
		if (slackOAuthUrl) {
			window.open(slackOAuthUrl, '_blank', 'width=600,height=700');
		}
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

	// Copy to clipboard helper
	let copiedField = $state<string | null>(null);
	
	async function copyToClipboard(text: string, fieldName: string) {
		try {
			await navigator.clipboard.writeText(text);
			copiedField = fieldName;
			setTimeout(() => {
				if (copiedField === fieldName) copiedField = null;
			}, 2000);
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	}

	// URLs to copy (Cloud Run URLs for Firebase Functions v2)
	const OAUTH_REDIRECT_URL = 'https://slackoauth-xpac7ukbha-uc.a.run.app';
	const WEBHOOK_URL = 'https://slackwebhook-xpac7ukbha-uc.a.run.app';
</script>

<div class="slack-settings">
	<!-- Header -->
	<div class="slack-header">
		<div class="slack-header__left">
			{#if view !== 'main'}
				<button class="back-btn" aria-label="Go back" onclick={() => (view = 'main')}>
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
					{:else if view === 'setup'}
						Configure Slack App credentials
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
		<button class="close-btn" aria-label="Close" onclick={onClose}>
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
				<!-- Credentials Setup Section (always visible) -->
				<div class="section credentials-section">
					<div class="section-header">
						<h3>Slack App Configuration</h3>
						<button class="btn btn--small" onclick={() => { view = 'setup'; if (config.credentials) credentialsForm = { ...config.credentials }; }}>
							<i class="bx bx-cog"></i>
							{hasCredentials ? 'Edit' : 'Setup'}
						</button>
					</div>
					
					{#if hasCredentials}
						<div class="credentials-status credentials-status--configured">
							<i class="bx bx-check-circle"></i>
							<div>
								<span class="credentials-status__title">Slack App Configured</span>
								<span class="credentials-status__subtitle">Client ID: {config.credentials?.clientId.slice(0, 12)}...</span>
							</div>
						</div>
					{:else}
						<div class="credentials-status credentials-status--unconfigured">
							<i class="bx bx-info-circle"></i>
							<div>
								<span class="credentials-status__title">Setup Required</span>
								<span class="credentials-status__subtitle">Create a Slack app and enter your credentials to get started</span>
							</div>
							<button class="btn btn--primary btn--small" onclick={() => (view = 'setup')}>
								Setup Now
							</button>
						</div>
					{/if}
				</div>

				{#if hasCredentials}
					<!-- Enable/Disable Toggle -->
					<div class="setting-row">
						<div class="setting-info">
							<span class="setting-label">Enable Slack Integration</span>
							<span class="setting-description">Allow syncing messages with Slack channels</span>
						</div>
						<label class="toggle">
							<input type="checkbox" checked={config.enabled} onchange={handleToggleEnabled} />
							<span class="toggle__slider"></span>
						</label>
					</div>

					{#if config.enabled}
						<!-- Workspaces Section -->
						<div class="section">
							<div class="section-header">
								<h3>Connected Workspaces</h3>
								<button class="btn btn--small" onclick={openConnectWorkspace}>
									<i class="bx bx-plus"></i>
									Add Workspace
								</button>
							</div>

							{#if workspaces.length === 0}
								<div class="empty-state">
									<i class="bx bx-buildings"></i>
									<p>No Slack workspaces connected</p>
									<button class="btn btn--primary" onclick={openConnectWorkspace}>
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
										onclick={() => {
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
										onclick={() => {
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
												onclick={() => handleToggleBridge(bridge)}
											>
												<i class="bx {bridge.status === 'active' ? 'bx-pause' : 'bx-play'}"></i>
											</button>
											<button
												class="icon-btn icon-btn--danger"
												title="Remove"
												onclick={() => handleDeleteBridge(bridge.id)}
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
				{/if}

				<!-- hConnect Avatar Override Section -->
				<div class="section slack-avatar-section">
					<div class="section-header">
						<h3>hConnect Profile Picture</h3>
					</div>
					<p class="section-description">
						Set a custom avatar for all messages from hConnect users syncing to Slack. This applies to everyone in this server.
					</p>
					<div class="slack-avatar-form">
						<div class="slack-avatar-preview-container">
							<div class="slack-avatar-preview">
								{#if hconnectAvatarUrl}
									<img src={hconnectAvatarUrl} alt="hConnect avatar preview" class="avatar-preview-img" />
								{:else}
									<div class="avatar-preview-placeholder">
										<i class="bx bx-image"></i>
									</div>
								{/if}
							</div>
							<div class="avatar-preview-buttons">
								<input
									type="file"
									accept="image/*"
									bind:this={avatarFileInput}
									onchange={handleAvatarUpload}
									class="hidden-file-input"
									id="avatar-file-input"
								/>
								<button
									class="btn btn--small"
									onclick={() => avatarFileInput?.click()}
									disabled={avatarUploading}
								>
									{#if avatarUploading}
										<span class="btn-spinner"></span>
										Uploading...
									{:else}
										<i class="bx bx-upload"></i>
										Upload
									{/if}
								</button>
								{#if hconnectAvatarUrl}
									<button
										class="btn btn--small btn--danger"
										onclick={clearAvatar}
										disabled={avatarSaving}
										title="Remove avatar"
									>
										<i class="bx bx-trash"></i>
									</button>
								{/if}
							</div>
						</div>
						<div class="slack-avatar-input-group">
							<label for="hconnect-avatar-url">Or enter URL directly</label>
							<input
								id="hconnect-avatar-url"
								type="url"
								placeholder="https://example.com/hconnect-avatar.png"
								bind:value={hconnectAvatarUrl}
								class="form-input"
							/>
							<span class="input-hint">Upload an image or enter a direct URL (PNG, JPG, or GIF). Leave empty to use each user's profile picture.</span>
						</div>
						<div class="slack-avatar-actions">
							<button 
								class="btn btn--primary btn--small"
								onclick={saveHConnectAvatarUrl}
								disabled={avatarSaving || avatarUploading}
							>
								{#if avatarSaving}
									<span class="btn-spinner"></span>
									Saving...
								{:else}
									<i class="bx bx-save"></i>
									Save URL
								{/if}
							</button>
							{#if avatarSuccess}
								<span class="success-text">
									<i class="bx bx-check"></i>
									Saved!
								</span>
							{/if}
							{#if avatarError}
								<span class="error-text">
									<i class="bx bx-error"></i>
									{avatarError}
								</span>
							{/if}
						</div>
					</div>
				</div>
			</div>

		<!-- Setup Credentials View -->
		{:else if view === 'setup'}
			<div class="slack-content">
				<div class="setup-intro">
					<h3>Create Your Slack App</h3>
					<p>To connect hConnect with Slack, you'll need to create a Slack app for your workspace.</p>
					
					<div class="setup-steps">
						<div class="setup-step">
							<span class="step-number">1</span>
							<div class="step-content">
								<strong>Create a Slack App</strong>
								<p>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener">api.slack.com/apps</a> and click "Create New App" → "From scratch"</p>
							</div>
						</div>
						<div class="setup-step">
							<span class="step-number">2</span>
							<div class="step-content">
								<strong>Configure OAuth Scopes</strong>
								<p>Go to "OAuth & Permissions" and add these Bot Token Scopes:</p>
								<code class="scopes-list">channels:history, channels:read, groups:history, groups:read, chat:write, chat:write.customize, users:read, team:read, files:read, reactions:read</code>
								<p style="margin-top: 0.5rem; font-size: 0.8rem; color: var(--text-50);">
									<em>Note: <code>chat:write.customize</code> is required to show usernames in Slack</em>
								</p>
							</div>
						</div>
						<div class="setup-step">
							<span class="step-number">3</span>
							<div class="step-content">
								<strong>Set Redirect URL</strong>
								<p>In "OAuth & Permissions", add this Redirect URL:</p>
								<div class="copyable-url">
									<code>{OAUTH_REDIRECT_URL}</code>
									<button 
										type="button" 
										class="copy-btn" 
										onclick={() => copyToClipboard(OAUTH_REDIRECT_URL, 'redirect')}
										title="Copy to clipboard"
									>
										{#if copiedField === 'redirect'}
											<i class="bx bx-check"></i>
										{:else}
											<i class="bx bx-copy"></i>
										{/if}
									</button>
								</div>
							</div>
						</div>
						<div class="setup-step">
							<span class="step-number">4</span>
							<div class="step-content">
								<strong>Enable Event Subscriptions</strong>
								<p>Go to "Event Subscriptions", toggle ON, and set the Request URL to:</p>
								<div class="copyable-url">
									<code>{WEBHOOK_URL}</code>
									<button 
										type="button" 
										class="copy-btn" 
										onclick={() => copyToClipboard(WEBHOOK_URL, 'webhook')}
										title="Copy to clipboard"
									>
										{#if copiedField === 'webhook'}
											<i class="bx bx-check"></i>
										{:else}
											<i class="bx bx-copy"></i>
										{/if}
									</button>
								</div>
								<p style="margin-top: 0.75rem;"><strong>Subscribe to these bot events:</strong></p>
								<code class="scopes-list">message.channels, message.groups, reaction_added, reaction_removed</code>
								<p style="margin-top: 0.5rem; font-size: 0.8rem; color: var(--text-50);">
									<em>Important: After adding events, click "Save Changes" at the bottom of the page!</em>
								</p>
							</div>
						</div>
						<div class="setup-step">
							<span class="step-number">5</span>
							<div class="step-content">
								<strong>Copy Your Credentials</strong>
								<p>Go to "Basic Information" and copy your Client ID, Client Secret, and Signing Secret below.</p>
							</div>
						</div>
					</div>
				</div>

				<form class="credentials-form" onsubmit={(e) => { e.preventDefault(); handleSaveCredentials(); }}>
					<div class="form-group">
						<label for="clientId">Client ID</label>
						<input
							id="clientId"
							type="text"
							placeholder="e.g., 1234567890.1234567890"
							bind:value={credentialsForm.clientId}
							required
						/>
					</div>

					<div class="form-group">
						<label for="clientSecret">Client Secret</label>
						<div class="secret-input">
							<input
								id="clientSecret"
								type={showSecrets ? 'text' : 'password'}
								placeholder="Your client secret"
								bind:value={credentialsForm.clientSecret}
								required
							/>
							<button type="button" class="toggle-secret" onclick={() => (showSecrets = !showSecrets)} aria-label={showSecrets ? 'Hide secrets' : 'Show secrets'}>
								<i class="bx {showSecrets ? 'bx-hide' : 'bx-show'}"></i>
							</button>
						</div>
					</div>

					<div class="form-group">
						<label for="signingSecret">Signing Secret</label>
						<div class="secret-input">
							<input
								id="signingSecret"
								type={showSecrets ? 'text' : 'password'}
								placeholder="Your signing secret"
								bind:value={credentialsForm.signingSecret}
								required
							/>
						</div>
						<span class="form-hint">Used to verify webhook requests from Slack</span>
					</div>

					<div class="form-actions">
						<button type="button" class="btn" onclick={() => (view = 'main')}>Cancel</button>
						<button
							type="submit"
							class="btn btn--primary"
							disabled={!credentialsForm.clientId || !credentialsForm.clientSecret || !credentialsForm.signingSecret}
						>
							Save Credentials
						</button>
					</div>
				</form>
			</div>

			<!-- Link Channel View -->
		{:else if view === 'link-channel'}
			<div class="slack-content">
				<form class="link-form" onsubmit={(e) => { e.preventDefault(); handleCreateBridge(); }}>
					<!-- Workspace Selection -->
					<div class="form-group">
						<label for="workspace">Slack Workspace</label>
						<select 
							id="workspace" 
							onchange={(e) => handleWorkspaceChange(e.currentTarget.value)}
							required
						>
							<option value="">Select workspace...</option>
							{#each workspaces as workspace (workspace.id)}
								<option value={workspace.id} selected={linkForm.slackWorkspaceId === workspace.id}>
									{workspace.teamName}
								</option>
							{/each}
						</select>
					</div>

					<!-- Slack Channel Dropdown -->
					<div class="form-group">
						<div class="label-with-action">
							<label for="slackChannel">Slack Channel</label>
							{#if linkForm.slackWorkspaceId}
								<button 
									type="button" 
									class="refresh-btn" 
									onclick={refreshSlackChannels}
									disabled={loadingSlackChannels}
									title="Refresh channel list"
								>
									<i class="bx {loadingSlackChannels ? 'bx-loader-alt bx-spin' : 'bx-refresh'}"></i>
									<span>Refresh</span>
								</button>
							{/if}
						</div>
						{#if !linkForm.slackWorkspaceId}
							<select id="slackChannel" disabled>
								<option value="">Select a workspace first...</option>
							</select>
						{:else if loadingSlackChannels}
							<div class="loading-channels">
								<i class="bx bx-loader-alt bx-spin"></i>
								<span>Loading channels...</span>
							</div>
						{:else if slackChannelsError}
							<!-- Fallback to manual input on error -->
							<div class="channel-error">
								<span class="error-text">{slackChannelsError}</span>
								<input
									id="slackChannel"
									type="text"
									placeholder="C0XXXXXXXXX (enter channel ID manually)"
									bind:value={linkForm.slackChannelId}
									required
								/>
								<span class="form-hint">
									Find this in Slack: right-click channel → View channel details → scroll to bottom
								</span>
							</div>
						{:else if slackChannels.length > 0}
							<select 
								id="slackChannel" 
								onchange={(e) => {
									const channel = slackChannels.find(c => c.id === e.currentTarget.value);
									if (channel) handleSlackChannelSelect(channel);
								}}
								required
							>
								<option value="">Select a channel...</option>
								{#each slackChannels as channel (channel.id)}
									<option value={channel.id} selected={linkForm.slackChannelId === channel.id}>
										{channel.is_private ? '🔒' : '#'}{channel.name}{channel.num_members ? ` (${channel.num_members} members)` : ''}
									</option>
								{/each}
							</select>
							<span class="form-hint">
								{slackChannels.length} channels available • Make sure the bot is added to the channel
							</span>
						{:else}
							<!-- No channels found - show manual input -->
							<div class="channel-error">
								<span class="error-text">
									{slackChannelsError || 'No channels found. The bot may need additional scopes or needs to be added to channels.'}
								</span>
								<input
									id="slackChannelManual"
									type="text"
									placeholder="C0XXXXXXXXX (enter channel ID manually)"
									bind:value={linkForm.slackChannelId}
									required
								/>
								<input
									id="slackChannelNameManual"
									type="text"
									placeholder="general (channel name)"
									bind:value={linkForm.slackChannelName}
									required
								/>
								<span class="form-hint">
									Find the channel ID in Slack: right-click channel → View channel details → scroll to bottom
								</span>
							</div>
						{/if}
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
						<span class="form-group-label">Options</span>
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
								Sync reactions
							</label>
							<label class="checkbox-label">
								<input type="checkbox" bind:checked={linkForm.syncThreads} />
								Sync thread replies
							</label>
						</div>
					</div>

					<div class="form-actions">
						<button type="button" class="btn" onclick={() => (view = 'main')}>Cancel</button>
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
		background: var(--color-panel, #1e1e1e);
		color: var(--color-text-primary, #fff);
		border-radius: 0.75rem;
		overflow: hidden;
	}

	/* Header - Matches ServerSettingsModal styling */
	.slack-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		background: linear-gradient(
			to bottom,
			color-mix(in srgb, #e01e5a 8%, var(--color-panel, #1e1e1e)),
			var(--color-panel, #1e1e1e)
		);
		border-bottom: 1px solid var(--color-border-subtle, #333);
	}

	.slack-header__left {
		display: flex;
		align-items: center;
		gap: 0.875rem;
	}

	.slack-header__icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		background: linear-gradient(135deg, #e01e5a, #ecb22e);
		border-radius: 0.625rem;
		color: white;
		flex-shrink: 0;
		box-shadow: 0 4px 12px rgba(224, 30, 90, 0.3);
	}

	.slack-header__icon svg {
		width: 1.25rem;
		height: 1.25rem;
	}

	.slack-header__text {
		display: flex;
		flex-direction: column;
	}

	.slack-header__text h2 {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary, #fff);
		line-height: 1.3;
	}

	.slack-header__text p {
		margin: 0.125rem 0 0;
		font-size: 0.75rem;
		color: var(--text-70, #aaa);
	}

	.back-btn,
	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		background: transparent;
		border: none;
		border-radius: 0.5rem;
		color: var(--text-70, #aaa);
		font-size: 1.5rem;
		cursor: pointer;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.back-btn:hover,
	.close-btn:hover {
		background: var(--color-panel-muted, #333);
		color: var(--color-text-primary, #fff);
	}

	.back-btn:focus-visible,
	.close-btn:focus-visible {
		outline: 2px solid var(--color-accent, #7c5cff);
		outline-offset: 2px;
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

	.section-description {
		margin: 0 0 1rem;
		font-size: 0.875rem;
		color: var(--text-70, #aaa);
	}

	/* Slack Avatar Section */
	.slack-avatar-section {
		border-top: 1px solid var(--border, #333);
		padding-top: 1.5rem;
	}

	.slack-avatar-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.slack-avatar-preview-container {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
	}

	.slack-avatar-preview {
		flex-shrink: 0;
	}

	.avatar-preview-img {
		width: 5rem;
		height: 5rem;
		border-radius: 0.5rem;
		object-fit: cover;
		border: 1px solid var(--border, #333);
	}

	.avatar-preview-placeholder {
		width: 5rem;
		height: 5rem;
		border-radius: 0.5rem;
		background: var(--bg-tertiary, #252525);
		border: 2px dashed var(--border, #333);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-50, #666);
		font-size: 1.75rem;
	}

	.avatar-preview-buttons {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.hidden-file-input {
		display: none;
	}

	.slack-avatar-input-group {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.slack-avatar-input-group label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-70, #aaa);
	}

	.slack-avatar-input-group .form-input {
		font-size: 0.875rem;
	}

	.input-hint {
		font-size: 0.75rem;
		color: var(--text-50, #666);
	}

	.slack-avatar-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.btn--danger {
		background: var(--red, #ff453a);
		color: white;
	}

	.btn--danger:hover {
		background: color-mix(in srgb, var(--red, #ff453a) 85%, black);
	}

	.success-text {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8125rem;
		color: var(--green, #34c759);
	}

	.error-text {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8125rem;
		color: var(--red, #ff453a);
	}

	.btn-spinner {
		width: 0.875rem;
		height: 0.875rem;
		border: 2px solid transparent;
		border-top-color: currentColor;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
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

	.label-with-action {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.refresh-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		background: var(--bg-tertiary, #252525);
		border: 1px solid var(--border, #333);
		border-radius: 0.25rem;
		color: var(--text-80, #ccc);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.refresh-btn:hover:not(:disabled) {
		background: var(--bg-hover, #2a2a2a);
		border-color: var(--accent, #7c5cff);
		color: var(--accent, #7c5cff);
	}

	.refresh-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.refresh-btn i {
		font-size: 0.875rem;
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

	/* Credentials Section */
	.credentials-section {
		margin-bottom: 1.5rem;
	}

	.credentials-status {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		border-radius: 0.5rem;
	}

	.credentials-status i {
		font-size: 1.5rem;
	}

	.credentials-status__title {
		display: block;
		font-weight: 500;
	}

	.credentials-status__subtitle {
		display: block;
		font-size: 0.8125rem;
		color: var(--text-70, #aaa);
	}

	.credentials-status--configured {
		background: rgba(52, 199, 89, 0.1);
		border: 1px solid rgba(52, 199, 89, 0.3);
	}

	.credentials-status--configured i {
		color: var(--green, #34c759);
	}

	.credentials-status--unconfigured {
		background: var(--bg-tertiary, #252525);
		border: 1px dashed var(--border, #333);
		flex-wrap: wrap;
	}

	.credentials-status--unconfigured > div {
		flex: 1;
		min-width: 200px;
	}

	.credentials-status--unconfigured i {
		color: var(--yellow, #ffd60a);
	}

	/* Setup View */
	.setup-intro {
		margin-bottom: 2rem;
	}

	.setup-intro h3 {
		margin: 0 0 0.5rem;
		font-size: 1.125rem;
	}

	.setup-intro > p {
		margin: 0 0 1.5rem;
		color: var(--text-70, #aaa);
	}

	.setup-steps {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.setup-step {
		display: flex;
		gap: 1rem;
		padding: 1rem;
		background: var(--bg-tertiary, #252525);
		border-radius: 0.5rem;
	}

	.step-number {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		background: var(--accent, #7c5cff);
		border-radius: 50%;
		font-weight: 600;
		font-size: 0.875rem;
		flex-shrink: 0;
	}

	.step-content {
		flex: 1;
	}

	.step-content strong {
		display: block;
		margin-bottom: 0.25rem;
	}

	.step-content p {
		margin: 0.25rem 0;
		font-size: 0.875rem;
		color: var(--text-70, #aaa);
	}

	.step-content a {
		color: var(--accent, #7c5cff);
		text-decoration: none;
	}

	.step-content a:hover {
		text-decoration: underline;
	}

	.scopes-list {
		display: block;
		margin-top: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--bg-elevated, #333);
		border-radius: 0.25rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.8125rem;
		word-break: break-all;
	}

	/* Copyable URL with copy button */
	.copyable-url {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--bg-elevated, #333);
		border-radius: 0.25rem;
	}

	.copyable-url code {
		flex: 1;
		font-family: var(--font-mono, monospace);
		font-size: 0.8125rem;
		word-break: break-all;
		color: var(--text-100, #fff);
	}

	.copy-btn {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		background: var(--bg-100, #444);
		border: none;
		border-radius: 0.25rem;
		color: var(--text-50, #999);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.copy-btn:hover {
		background: var(--bg-200, #555);
		color: var(--text-100, #fff);
	}

	.copy-btn .bx-check {
		color: var(--green, #4ade80);
	}

	.step-content code:not(.scopes-list) {
		padding: 0.125rem 0.375rem;
		background: var(--bg-elevated, #333);
		border-radius: 0.25rem;
		font-size: 0.8125rem;
	}

	/* Credentials Form */
	.credentials-form {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.secret-input {
		position: relative;
		display: flex;
	}

	.secret-input input {
		flex: 1;
		padding-right: 2.5rem;
	}

	.toggle-secret {
		position: absolute;
		right: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		color: var(--text-50, #888);
		cursor: pointer;
		padding: 0.25rem;
	}

	.toggle-secret:hover {
		color: var(--text, #fff);
	}

	.form-group-label {
		font-size: 0.875rem;
		font-weight: 500;
		margin-bottom: 0.5rem;
		display: block;
	}

	/* Channel Loading State */
	.loading-channels {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: var(--bg-elevated, #333);
		border-radius: 0.375rem;
		color: var(--text-70, #aaa);
		font-size: 0.875rem;
	}

	.loading-channels i {
		font-size: 1rem;
		color: var(--accent, #7c5cff);
	}

	.channel-error {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.channel-error .error-text {
		font-size: 0.8125rem;
		color: var(--red, #ff5c5c);
	}

</style>
