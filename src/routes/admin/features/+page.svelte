<script lang="ts">
	import type { PageData } from './$types';
	import { browser } from '$app/environment';
	import { FEATURE_FLAGS, type FeatureFlagKey, type FeatureFlagMeta } from '$lib/admin/types';
	import { featureFlagsStore, updateFeatureFlag } from '$lib/admin/featureFlags';
	import { showAdminToast } from '$lib/admin/stores/toast';
	import type { ServerInvite } from '$lib/firestore/invites';
	import DomainInvitePrompt from '$lib/components/app/DomainInvitePrompt.svelte';
	import { triggerTestPush } from '$lib/notify/testPush';
	import { setTheme, resetThemeToSystem, type ThemeMode } from '$lib/stores/theme';
	import { LAST_LOCATION_STORAGE_KEY, RESUME_DM_SCROLL_KEY } from '$lib/constants/navigation';
	import { isMobileViewport } from '$lib/stores/viewport';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	const remoteFlags = featureFlagsStore();
	const flags = $derived({ ...data.featureFlags, ...$remoteFlags });
	let pending: Record<FeatureFlagKey, boolean> = $state({} as Record<FeatureFlagKey, boolean>);
	const DOMAIN_INVITE_STORAGE_KEY = 'domainAutoInviteDismissals';
	const LAST_SERVER_KEY = 'hconnect:last-server';
	const LAST_SERVER_CHANNEL_KEY = 'hconnect:last-server-channel';
	const VOICE_DEBUG_KEYS = [
		'hconnect:voice:debug-panel-open',
		'hconnect:voice:debug',
		'hconnect:voice:debug.quickstats'
	];
	let previewInvite: ServerInvite | null = $state(null);
	let testPushLoading = $state(false);

	// Mobile: active tab for feature sections
	type TabId = 'toggles' | 'testing';
	let activeTab: TabId = $state('toggles');

	// Collapsed sections on mobile
	let collapsedSections: Record<string, boolean> = $state({});

	type FeatureSectionConfig = {
		id: string;
		title: string;
		description: string;
		keys: FeatureFlagKey[];
		accent?: 'ai' | 'ops';
		icon?: string;
	};
	type FeatureSection = {
		id: string;
		title: string;
		description: string;
		flags: FeatureFlagMeta[];
		accent?: 'ai' | 'ops';
		icon?: string;
	};
	const sectionDefinitions: FeatureSectionConfig[] = [
		{
			id: 'core',
			title: 'Core Platform',
			description: 'Enable baseline access to servers, channels, and invites.',
			keys: [
				'enableServers',
				'enableChannels',
				'enableServerCreation',
				'enableInviteLinks',
				'enableDMs',
				'enablePresence'
			],
			icon: 'bx-server'
		},
		{
			id: 'engagement',
			title: 'Engagement & Media',
			description: 'Control media, reactions, and delivery polish across the app.',
			keys: [
				'enableReactions',
				'enableFileUploads',
				'enableVoice',
				'enableVideo',
				'enableNotifications',
				'enableTypingIndicators',
				'enableReadReceipts'
			],
			icon: 'bx-movie-play'
		},
		{
			id: 'messages',
			title: 'Message Controls',
			description: 'Set edit and delete abilities to match your compliance posture.',
			keys: ['enableMessageEditing', 'enableMessageDeleting'],
			icon: 'bx-message-square-edit'
		},
		{
			id: 'ai',
			title: 'AI Assist Surfaces',
			description: 'Individually disable the AI experiences in chat.',
			keys: [
				'enableAIFeatures',
				'enableAISuggestedReplies',
				'enableAIPredictions',
				'enableAISummaries',
				'enableTicketAI'
			],
			accent: 'ai',
			icon: 'bx-bot'
		},
		{
			id: 'ops',
			title: 'Ops & QA',
			description: 'Safety, lockdown, and debugging switches.',
			keys: ['readOnlyMode', 'showNotificationDebugTools'],
			accent: 'ops',
			icon: 'bx-cog'
		}
	];
	const flagMetaMap = new Map<FeatureFlagKey, FeatureFlagMeta>(
		FEATURE_FLAGS.map((flag) => [flag.key, flag])
	);
	const trackedKeys = new Set<FeatureFlagKey>();
	const sectionBlocks: FeatureSection[] = sectionDefinitions
		.map((section) => {
			section.keys.forEach((key) => trackedKeys.add(key));
			return {
				id: section.id,
				title: section.title,
				description: section.description,
				accent: section.accent,
				icon: section.icon,
				flags: section.keys
					.map((key) => flagMetaMap.get(key))
					.filter((flag): flag is FeatureFlagMeta => Boolean(flag))
			};
		})
		.filter((section) => section.flags.length);
	const leftoverFlags = FEATURE_FLAGS.filter((flag) => !trackedKeys.has(flag.key));
	const featureSections: FeatureSection[] =
		leftoverFlags.length > 0
			? [
					...sectionBlocks,
					{
						id: 'misc',
						title: 'Additional toggles',
						description: 'Flags that still need a dedicated home.',
						flags: leftoverFlags,
						icon: 'bx-dots-horizontal-rounded'
					}
				]
			: sectionBlocks;

	// Count enabled flags
	const enabledCount = $derived(FEATURE_FLAGS.filter((f) => flags[f.key]).length);

	const toggleSection = (sectionId: string) => {
		collapsedSections = { ...collapsedSections, [sectionId]: !collapsedSections[sectionId] };
	};

	const toggleFlag = async (key: FeatureFlagKey) => {
		const nextValue = !flags[key];
		pending = { ...pending, [key]: true };
		try {
			await updateFeatureFlag(key, nextValue, data.user);
			showAdminToast({
				type: 'success',
				message: `${FEATURE_FLAGS.find((item) => item.key === key)?.label ?? key} set to ${
					nextValue ? 'enabled' : 'disabled'
				}.`
			});
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Unable to update flag.'
			});
		} finally {
			pending = { ...pending, [key]: false };
		}
	};

	const handleResetDomainPrompt = () => {
		if (!browser) {
			showAdminToast({
				type: 'info',
				message: 'Open an in-browser admin session to reset the prompt here.'
			});
			return;
		}
		try {
			localStorage.removeItem(DOMAIN_INVITE_STORAGE_KEY);
			showAdminToast({ type: 'success', message: 'Domain invite prompt reset for this device.' });
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: 'Unable to reset local storage.' });
		}
	};

	const openSplashDemo = () => {
		if (!browser) {
			showAdminToast({
				type: 'info',
				message: 'Splash preview is available in browser sessions only.'
			});
			return;
		}
		window.open('/splash', '_blank', 'noopener');
	};

	const buildSampleInvite = (): ServerInvite => ({
		id: '__domain_preview__',
		toUid: data?.user?.uid ?? 'tester',
		fromUid: 'auto',
		fromDisplayName: 'Auto Invite',
		serverId: 'preview-server',
		serverName: 'QA Review Workspace',
		serverIcon: 'https://avatars.githubusercontent.com/u/9919?v=4',
		channelId: 'launch-updates',
		channelName: 'launch-updates',
		type: 'domain-auto',
		status: 'pending',
		createdAt: {
			toMillis: () => Date.now()
		} as any
	});

	const triggerDomainPromptPreview = () => {
		if (!browser) {
			showAdminToast({
				type: 'info',
				message: 'Open this page in the browser to test the invite prompt.'
			});
			return;
		}
		previewInvite = buildSampleInvite();
		showAdminToast({ type: 'success', message: 'Sample invite prompt displayed.' });
		window.dispatchEvent(
			new CustomEvent('domain-invite-test', {
				detail: previewInvite
			})
		);
	};

	const closePreviewInvite = () => {
		previewInvite = null;
	};

	const handlePreviewAccept = () => {
		showAdminToast({ type: 'success', message: 'Sample invite accepted.' });
		closePreviewInvite();
	};

	const handlePreviewDecline = () => {
		showAdminToast({ type: 'info', message: 'Sample invite declined.' });
		closePreviewInvite();
	};

	const handleSendTestPush = async () => {
		if (!browser) {
			showAdminToast({ type: 'info', message: 'Push testing requires a browser session.' });
			return;
		}
		testPushLoading = true;
		try {
			const result = await triggerTestPush();
			if (result.ok) {
				const count = result.tokens ?? 0;
				const suffix = count === 1 ? 'device' : 'devices';
				showAdminToast({
					type: 'success',
					message: count > 0 ? `Test push sent to ${count} ${suffix}.` : 'Test push sent.'
				});
			} else {
				const reason =
					result.reason === 'missing_device'
						? 'Open hConnect on this device and enable notifications first.'
						: 'Callable reported a failure.';
				showAdminToast({ type: 'warning', message: reason });
			}
		} catch (error) {
			console.error('triggerTestPush failed', error);
			showAdminToast({
				type: 'error',
				message: 'Unable to send test push notification.'
			});
		} finally {
			testPushLoading = false;
		}
	};

	const previewTheme = (mode: ThemeMode, label: string) => {
		if (!browser) {
			showAdminToast({ type: 'info', message: 'Open this page in the browser to preview themes.' });
			return;
		}
		setTheme(mode, { persist: false });
		showAdminToast({
			type: 'success',
			message: `${label} theme preview applied for this session.`
		});
	};

	const handleResetThemePreference = () => {
		if (!browser) {
			showAdminToast({
				type: 'info',
				message: 'Open this page in the browser to reset theme preferences.'
			});
			return;
		}
		resetThemeToSystem();
		showAdminToast({
			type: 'success',
			message: 'Theme preference reset to match the system default.'
		});
	};

	const resetNavigationMemory = () => {
		if (!browser) {
			showAdminToast({
				type: 'info',
				message: 'Navigation cache reset is available in-browser only.'
			});
			return;
		}
		try {
			localStorage.removeItem(LAST_SERVER_KEY);
			localStorage.removeItem(LAST_SERVER_CHANNEL_KEY);
			localStorage.removeItem(LAST_LOCATION_STORAGE_KEY);
			localStorage.removeItem(RESUME_DM_SCROLL_KEY);
			showAdminToast({ type: 'success', message: 'Server shortcuts and scroll memory cleared.' });
		} catch (error) {
			console.error('resetNavigationMemory failed', error);
			showAdminToast({ type: 'error', message: 'Unable to reset navigation cache.' });
		}
	};

	const resetVoiceDebugState = () => {
		if (!browser) {
			showAdminToast({ type: 'info', message: 'Voice debug reset is available in-browser only.' });
			return;
		}
		try {
			VOICE_DEBUG_KEYS.forEach((key) => localStorage.removeItem(key));
			showAdminToast({ type: 'success', message: 'Voice debug toggles cleared for this device.' });
		} catch (error) {
			console.error('resetVoiceDebugState failed', error);
			showAdminToast({ type: 'error', message: 'Unable to clear voice debug state.' });
		}
	};
</script>

<section class="features-page">
	<!-- Summary stats on mobile -->
	{#if $isMobileViewport}
		<div class="stats-bar">
			<div class="stat">
				<i class="bx bx-toggle-right"></i>
				<span class="value">{enabledCount}</span>
				<span class="label">Enabled</span>
			</div>
			<div class="stat">
				<i class="bx bx-toggle-left"></i>
				<span class="value">{FEATURE_FLAGS.length - enabledCount}</span>
				<span class="label">Disabled</span>
			</div>
			<div class="stat">
				<i class="bx bx-layer"></i>
				<span class="value">{featureSections.length}</span>
				<span class="label">Sections</span>
			</div>
		</div>

		<!-- Tab switcher for mobile -->
		<div class="tab-bar">
			<button
				class="tab"
				class:active={activeTab === 'toggles'}
				onclick={() => (activeTab = 'toggles')}
			>
				<i class="bx bx-toggle-right"></i>
				Feature Toggles
			</button>
			<button
				class="tab"
				class:active={activeTab === 'testing'}
				onclick={() => (activeTab = 'testing')}
			>
				<i class="bx bx-test-tube"></i>
				Testing Tools
			</button>
		</div>
	{/if}

	<div class="content-grid" class:mobile={$isMobileViewport}>
		<!-- Feature Toggles Panel -->
		{#if !$isMobileViewport || activeTab === 'toggles'}
			<div class="toggles-panel">
				<div class="panel-header">
					<div class="panel-title">
						<i class="bx bx-toggle-right"></i>
						<h3>Feature Toggles</h3>
					</div>
					<p class="panel-description">Flip platform capabilities instantly.</p>
				</div>

				<div class="sections-list">
					{#each featureSections as section (section.id)}
						{@const isCollapsed = collapsedSections[section.id] && $isMobileViewport}
						{@const enabledInSection = section.flags.filter((f) => flags[f.key]).length}

						<div
							class="feature-section"
							class:ai={section.accent === 'ai'}
							class:ops={section.accent === 'ops'}
						>
							<button
								class="section-header"
								onclick={() => $isMobileViewport && toggleSection(section.id)}
								aria-expanded={!isCollapsed}
							>
								<div class="section-icon">
									<i class="bx {section.icon ?? 'bx-grid-alt'}"></i>
								</div>
								<div class="section-info">
									<div class="section-title-row">
										<h4>{section.title}</h4>
										{#if section.accent === 'ai'}
											<span class="badge ai">AI</span>
										{:else if section.accent === 'ops'}
											<span class="badge ops">OPS</span>
										{/if}
									</div>
									<p class="section-desc">{section.description}</p>
									<div class="section-meta">
										<span class="enabled-count"
											>{enabledInSection}/{section.flags.length} enabled</span
										>
									</div>
								</div>
								{#if $isMobileViewport}
									<i class="bx {isCollapsed ? 'bx-chevron-down' : 'bx-chevron-up'} chevron"></i>
								{/if}
							</button>

							{#if !isCollapsed}
								<div class="flags-grid">
									{#each section.flags as flag (flag.key)}
										<div class="flag-card" class:enabled={flags[flag.key]}>
											<div class="flag-content">
												<div class="flag-header">
													<span class="flag-label">{flag.label}</span>
													<button
														type="button"
														class="toggle-switch"
														class:on={flags[flag.key]}
														aria-pressed={flags[flag.key]}
														aria-label={`Toggle ${flag.label}`}
														onclick={() => toggleFlag(flag.key)}
														disabled={pending[flag.key]}
													>
														<span class="toggle-knob"></span>
													</button>
												</div>
												<p class="flag-desc">{flag.description}</p>
											</div>
											<div class="flag-footer">
												<span class="status-badge" class:enabled={flags[flag.key]}>
													{flags[flag.key] ? 'Enabled' : 'Disabled'}
												</span>
												{#if pending[flag.key]}
													<span class="updating">
														<i class="bx bx-loader-alt bx-spin"></i>
													</span>
												{/if}
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Testing Tools Panel -->
		{#if !$isMobileViewport || activeTab === 'testing'}
			<div class="testing-panel">
				<div class="panel-header">
					<div class="panel-title">
						<i class="bx bx-test-tube"></i>
						<h3>Feature Testing</h3>
					</div>
					<p class="panel-description">Quick shortcuts for QA routines.</p>
				</div>

				<div class="test-tools-grid">
					<!-- Domain invite prompt -->
					<article class="test-card">
						<div class="test-icon domain">
							<i class="bx bx-envelope"></i>
						</div>
						<div class="test-content">
							<h4>Domain auto-invite prompt</h4>
							<p>Clears the local dismissal flag so the new domain invite modal reappears.</p>
						</div>
						<div class="test-actions">
							<button type="button" class="btn primary" onclick={handleResetDomainPrompt}>
								<i class="bx bx-reset"></i>
								Reset prompt
							</button>
							<a class="btn secondary" href="/settings#invites" target="_blank" rel="noreferrer">
								<i class="bx bx-inbox"></i>
								Inbox
							</a>
							<button type="button" class="btn outline" onclick={triggerDomainPromptPreview}>
								<i class="bx bx-show"></i>
								Preview
							</button>
						</div>
					</article>

					<!-- Splash screen preview -->
					<article class="test-card">
						<div class="test-icon splash">
							<i class="bx bx-rocket"></i>
						</div>
						<div class="test-content">
							<h4>Splash screen preview</h4>
							<p>Opens the standalone splash page to verify animations and branding.</p>
						</div>
						<div class="test-actions">
							<button type="button" class="btn primary" onclick={openSplashDemo}>
								<i class="bx bx-window-open"></i>
								Open demo
							</button>
						</div>
					</article>

					<!-- Push delivery test -->
					<article class="test-card">
						<div class="test-icon push">
							<i class="bx bx-bell"></i>
						</div>
						<div class="test-content">
							<h4>Push delivery test</h4>
							<p>Sends a test push notification to this device to confirm wiring.</p>
						</div>
						<div class="test-actions">
							<button
								type="button"
								class="btn warning"
								onclick={handleSendTestPush}
								disabled={testPushLoading}
							>
								{#if testPushLoading}
									<i class="bx bx-loader-alt bx-spin"></i>
									Sending…
								{:else}
									<i class="bx bx-send"></i>
									Send test push
								{/if}
							</button>
						</div>
					</article>

					<!-- Theme labs -->
					<article class="test-card">
						<div class="test-icon theme">
							<i class="bx bx-palette"></i>
						</div>
						<div class="test-content">
							<h4>Theme labs</h4>
							<p>Preview alternate themes instantly or reset to system default.</p>
						</div>
						<div class="test-actions">
							<button
								type="button"
								class="btn outline"
								onclick={() => previewTheme('holiday', 'Holiday')}
							>
								<i class="bx bx-gift"></i>
								Holiday
							</button>
							<button
								type="button"
								class="btn outline"
								onclick={() => previewTheme('midnight', 'Midnight')}
							>
								<i class="bx bx-moon"></i>
								Midnight
							</button>
							<button type="button" class="btn secondary" onclick={handleResetThemePreference}>
								<i class="bx bx-reset"></i>
								Reset
							</button>
						</div>
					</article>

					<!-- Navigation cache -->
					<article class="test-card">
						<div class="test-icon nav">
							<i class="bx bx-compass"></i>
						</div>
						<div class="test-content">
							<h4>Navigation cache</h4>
							<p>Clears remembered servers, channels, and DM scroll markers.</p>
						</div>
						<div class="test-actions">
							<button type="button" class="btn outline" onclick={resetNavigationMemory}>
								<i class="bx bx-trash"></i>
								Clear cache
							</button>
						</div>
					</article>

					<!-- Voice debug state -->
					<article class="test-card">
						<div class="test-icon voice">
							<i class="bx bx-microphone"></i>
						</div>
						<div class="test-content">
							<h4>Voice debug state</h4>
							<p>Clears toggles that keep the voice debug panel pinned open.</p>
						</div>
						<div class="test-actions">
							<button type="button" class="btn outline" onclick={resetVoiceDebugState}>
								<i class="bx bx-trash"></i>
								Reset debug
							</button>
						</div>
					</article>
				</div>
			</div>
		{/if}
	</div>
</section>

<DomainInvitePrompt
	invite={previewInvite}
	busy={false}
	error={null}
	onAccept={handlePreviewAccept}
	onDecline={handlePreviewDecline}
	onDismiss={closePreviewInvite}
/>

<style>
	.features-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-height: 100%;
		padding: 1rem;
	}

	/* Stats bar */
	.stats-bar {
		display: flex;
		gap: 0.75rem;
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

	/* Tab bar */
	.tab-bar {
		display: flex;
		gap: 0.5rem;
		padding: 0.25rem;
		background: var(--surface-panel);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
	}

	.tab {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.625rem 0.75rem;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 0.8125rem;
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

	/* Content grid */
	.content-grid {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: 1.5rem;
	}

	.content-grid.mobile {
		grid-template-columns: 1fr;
		gap: 0;
	}

	/* Panels */
	.toggles-panel,
	.testing-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		background: var(--surface-panel);
		border-radius: 16px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		padding: 1.25rem;
	}

	.content-grid.mobile .toggles-panel,
	.content-grid.mobile .testing-panel {
		background: transparent;
		border: none;
		padding: 0;
		border-radius: 0;
	}

	.panel-header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.content-grid.mobile .panel-header {
		display: none;
	}

	.panel-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.panel-title i {
		font-size: 1.25rem;
		color: var(--accent-primary);
	}

	.panel-title h3 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.panel-description {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	/* Sections list */
	.sections-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.feature-section {
		background: color-mix(in srgb, var(--surface-panel) 50%, transparent);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 8%, transparent);
		overflow: hidden;
	}

	.content-grid.mobile .feature-section {
		background: var(--surface-panel);
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
	}

	.feature-section.ai {
		border-color: color-mix(in srgb, var(--accent-primary) 30%, transparent);
		background: color-mix(in srgb, var(--accent-primary) 5%, var(--surface-panel));
	}

	.feature-section.ops {
		border-color: color-mix(in srgb, #f43f5e 30%, transparent);
		background: color-mix(in srgb, #f43f5e 5%, var(--surface-panel));
	}

	.section-header {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem;
		width: 100%;
		border: none;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}

	.section-icon {
		width: 2.5rem;
		height: 2.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 10px;
		background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
		flex-shrink: 0;
	}

	.section-icon i {
		font-size: 1.25rem;
		color: var(--accent-primary);
	}

	.feature-section.ai .section-icon {
		background: linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(52, 211, 153, 0.2));
	}

	.feature-section.ai .section-icon i {
		color: #10b981;
	}

	.feature-section.ops .section-icon {
		background: color-mix(in srgb, #f43f5e 15%, transparent);
	}

	.feature-section.ops .section-icon i {
		color: #f43f5e;
	}

	.section-info {
		flex: 1;
		min-width: 0;
	}

	.section-title-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.section-title-row h4 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.badge {
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.badge.ai {
		background: linear-gradient(135deg, rgba(56, 189, 248, 0.3), rgba(52, 211, 153, 0.3));
		color: #059669;
	}

	.badge.ops {
		background: color-mix(in srgb, #f43f5e 20%, transparent);
		color: #be123c;
	}

	.section-desc {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin: 0.25rem 0 0;
		line-height: 1.4;
	}

	.section-meta {
		margin-top: 0.375rem;
	}

	.enabled-count {
		font-size: 0.6875rem;
		color: var(--accent-primary);
		font-weight: 500;
	}

	.chevron {
		font-size: 1.25rem;
		color: var(--color-text-secondary);
		transition: transform 0.2s;
	}

	/* Flags grid */
	.flags-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.75rem;
		padding: 0 1rem 1rem;
	}

	.content-grid.mobile .flags-grid {
		grid-template-columns: 1fr;
	}

	.flag-card {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		padding: 1rem;
		background: var(--surface-panel);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		min-height: 120px;
		transition: all 0.2s;
	}

	.flag-card:hover {
		border-color: color-mix(in srgb, var(--accent-primary) 40%, transparent);
	}

	.flag-card.enabled {
		border-color: color-mix(in srgb, #10b981 30%, transparent);
		background: color-mix(in srgb, #10b981 5%, var(--surface-panel));
	}

	.flag-content {
		flex: 1;
	}

	.flag-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.flag-label {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary);
		line-height: 1.3;
	}

	.flag-desc {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin: 0;
		line-height: 1.4;
	}

	.toggle-switch {
		position: relative;
		width: 2.5rem;
		height: 1.375rem;
		border-radius: 9999px;
		border: none;
		background: color-mix(in srgb, var(--color-text-primary) 20%, transparent);
		cursor: pointer;
		transition: background 0.2s;
		flex-shrink: 0;
	}

	.toggle-switch.on {
		background: #10b981;
	}

	.toggle-switch:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.toggle-knob {
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

	.toggle-switch.on .toggle-knob {
		transform: translateX(1.125rem);
	}

	.flag-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px solid color-mix(in srgb, var(--color-text-primary) 8%, transparent);
	}

	.status-badge {
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		font-size: 0.6875rem;
		font-weight: 600;
		background: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		color: var(--color-text-secondary);
	}

	.status-badge.enabled {
		background: color-mix(in srgb, #10b981 15%, transparent);
		color: #059669;
	}

	.updating {
		color: var(--accent-primary);
	}

	/* Testing tools grid */
	.test-tools-grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		overflow-y: auto;
		flex: 1;
	}

	.test-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		background: color-mix(in srgb, var(--surface-panel) 75%, transparent);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
	}

	.content-grid.mobile .test-card {
		background: var(--surface-panel);
	}

	.test-icon {
		width: 2.5rem;
		height: 2.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 10px;
		background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
	}

	.test-icon i {
		font-size: 1.25rem;
		color: var(--accent-primary);
	}

	.test-icon.domain {
		background: linear-gradient(135deg, rgba(52, 211, 153, 0.2), rgba(6, 182, 212, 0.2));
	}

	.test-icon.domain i {
		color: #10b981;
	}

	.test-icon.splash {
		background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.2));
	}

	.test-icon.splash i {
		color: #8b5cf6;
	}

	.test-icon.push {
		background: linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(249, 115, 22, 0.2));
	}

	.test-icon.push i {
		color: #f59e0b;
	}

	.test-icon.theme {
		background: linear-gradient(135deg, rgba(236, 72, 153, 0.2), rgba(168, 85, 247, 0.2));
	}

	.test-icon.theme i {
		color: #ec4899;
	}

	.test-icon.nav {
		background: color-mix(in srgb, #3b82f6 15%, transparent);
	}

	.test-icon.nav i {
		color: #3b82f6;
	}

	.test-icon.voice {
		background: color-mix(in srgb, #14b8a6 15%, transparent);
	}

	.test-icon.voice i {
		color: #14b8a6;
	}

	.test-content h4 {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.test-content p {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin: 0.25rem 0 0;
		line-height: 1.4;
	}

	.test-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.875rem;
		border-radius: 8px;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		text-decoration: none;
		border: none;
	}

	.btn i {
		font-size: 1rem;
	}

	.btn.primary {
		background: linear-gradient(
			135deg,
			var(--accent-primary),
			color-mix(in srgb, var(--accent-primary) 80%, #10b981)
		);
		color: white;
	}

	.btn.primary:hover {
		opacity: 0.9;
	}

	.btn.secondary {
		background: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		color: var(--color-text-primary);
	}

	.btn.secondary:hover {
		background: color-mix(in srgb, var(--color-text-primary) 15%, transparent);
	}

	.btn.warning {
		background: linear-gradient(135deg, #f59e0b, #f97316);
		color: white;
	}

	.btn.warning:hover {
		opacity: 0.9;
	}

	.btn.warning:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn.outline {
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 20%, transparent);
		color: var(--color-text-primary);
	}

	.btn.outline:hover {
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
		border-color: color-mix(in srgb, var(--color-text-primary) 30%, transparent);
	}

	/* Desktop tweaks */
	@media (min-width: 768px) {
		.features-page {
			padding: 1.5rem;
		}

		.toggles-panel {
			max-height: calc(100vh - 12rem);
		}

		.testing-panel {
			max-height: calc(100vh - 12rem);
		}
	}
</style>
