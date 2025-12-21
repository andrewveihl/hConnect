<script lang="ts">
	import type { PageData } from './$types';
	import { browser } from '$app/environment';
import { FEATURE_FLAGS, type FeatureFlagKey, type FeatureFlagMeta } from '$lib/admin/types';
import { featureFlagsStore, updateFeatureFlag } from '$lib/admin/featureFlags';
import { showAdminToast } from '$lib/admin/stores/toast';
import type { ServerInvite } from '$lib/firestore/invites';
import DomainInvitePrompt from '$lib/components/app/DomainInvitePrompt.svelte';
import { triggerTestPush } from '$lib/notify/testPush';
import { getDb } from '$lib/firebase';
import {
	addVoiceDebugAssignee,
	removeVoiceDebugAssignee,
	setVoiceDebugEnabled,
	voiceDebugConfigStore
} from '$lib/admin/voiceDebug';
import { LAST_LOCATION_STORAGE_KEY, RESUME_DM_SCROLL_KEY } from '$lib/constants/navigation';
import { isMobileViewport } from '$lib/stores/viewport';
import { collection, endAt, getDocs, limit as fbLimit, orderBy, query, startAt } from 'firebase/firestore';

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
	const voiceDebugConfig = voiceDebugConfigStore();
	const voiceDebugEnabled = $derived(Boolean($voiceDebugConfig?.enabled));
	const voiceDebugAssignees = $derived(
		Object.values($voiceDebugConfig?.assignedEmails ?? {}).sort((a, b) =>
			(a.email ?? '').localeCompare(b.email ?? '')
		)
	);
	type VoiceDebugSearchResult = {
		uid: string;
		email: string | null;
		displayName: string | null;
		photoURL: string | null;
	};
	let voiceDebugEmail = $state('');
	let voiceDebugNote = $state('');
	let voiceDebugBusy = $state(false);
	let voiceDebugToggleBusy = $state(false);
	let removingVoiceEmail = $state<string | null>(null);
	let voiceDebugQuery = $state('');
	let voiceDebugResults = $state<VoiceDebugSearchResult[]>([]);
	let voiceDebugSelected: VoiceDebugSearchResult | null = $state(null);
	let voiceDebugSearching = $state(false);
	let voiceDebugSearchTimer: ReturnType<typeof setTimeout> | null = null;
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
			keys: ['readOnlyMode', 'showNotificationDebugTools', 'disableFabSnapping'],
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

	const selectVoiceDebugUser = (user: VoiceDebugSearchResult) => {
		voiceDebugSelected = user;
		voiceDebugEmail = user.email ?? '';
		voiceDebugQuery = user.displayName ?? user.email ?? user.uid;
	};

	const searchVoiceDebugUsers = async (term: string) => {
		const value = term.trim();
		if (!value) {
			voiceDebugResults = [];
			voiceDebugSelected = null;
			return;
		}
		if (!browser) {
			showAdminToast({
				type: 'info',
				message: 'Voice user search is available in-browser only.'
			});
			return;
		}
		voiceDebugSearching = true;
		try {
			const db = getDb();
			const results: VoiceDebugSearchResult[] = [];
			const seen = new Set<string>();
			const limitCount = 12;
			const lower = value.toLowerCase();

			const runQuery = async (field: 'email' | 'displayName') => {
				const snap = await getDocs(
					query(
						collection(db, 'profiles'),
						orderBy(field),
						startAt(field === 'email' ? lower : value),
						endAt((field === 'email' ? lower : value) + '\uf8ff'),
						fbLimit(limitCount)
					)
				);
				snap.forEach((docSnap) => {
					if (seen.has(docSnap.id)) return;
					const data = docSnap.data() as Record<string, any>;
					results.push({
						uid: docSnap.id,
						email: data.email ?? null,
						displayName: data.displayName ?? data.name ?? null,
						photoURL: data.photoURL ?? data.cachedPhotoURL ?? data.authPhotoURL ?? null
					});
					seen.add(docSnap.id);
				});
			};

			await runQuery('email');
			if (results.length < 8) {
				await runQuery('displayName');
			}
			voiceDebugResults = results;
		} catch (err) {
			console.error('searchVoiceDebugUsers failed', err);
			showAdminToast({
				type: 'error',
				message: 'Unable to search users. Try an exact email.'
			});
		} finally {
			voiceDebugSearching = false;
		}
	};

	const handleVoiceDebugQueryInput = (value: string) => {
		voiceDebugQuery = value;
		voiceDebugSelected = null;
		if (voiceDebugSearchTimer) clearTimeout(voiceDebugSearchTimer);
		if (!value.trim()) {
			voiceDebugResults = [];
			return;
		}
		voiceDebugSearchTimer = setTimeout(() => {
			void searchVoiceDebugUsers(value);
		}, 220);
	};

	const toggleVoiceDebugBubble = async () => {
		const next = !voiceDebugEnabled;
		voiceDebugToggleBusy = true;
		try {
			await setVoiceDebugEnabled(next, data.user);
			showAdminToast({
				type: 'success',
				message: `Voice debug bubble ${next ? 'enabled' : 'disabled'}.`
			});
		} catch (err) {
			console.error('toggleVoiceDebugBubble failed', err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Unable to update voice debug bubble.'
			});
		} finally {
			voiceDebugToggleBusy = false;
		}
	};

	const addVoiceDebugUser = async () => {
		const targetEmail = (voiceDebugSelected?.email ?? voiceDebugEmail ?? voiceDebugQuery).trim();
		if (!targetEmail) {
			showAdminToast({ type: 'warning', message: 'Search or enter a user email to assign the bubble.' });
			return;
		}
		voiceDebugBusy = true;
		try {
			await addVoiceDebugAssignee(targetEmail, data.user, voiceDebugNote || null);
			showAdminToast({
				type: 'success',
				message: `Assigned voice debug bubble to ${targetEmail}.`
			});
			voiceDebugEmail = '';
			voiceDebugNote = '';
			voiceDebugQuery = '';
			voiceDebugSelected = null;
			voiceDebugResults = [];
		} catch (err) {
			console.error('addVoiceDebugUser failed', err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Unable to assign bubble.'
			});
		} finally {
			voiceDebugBusy = false;
		}
	};

	const removeVoiceDebugUser = async (email: string) => {
		removingVoiceEmail = email;
		try {
			await removeVoiceDebugAssignee(email, data.user);
			showAdminToast({
				type: 'success',
				message: `Removed ${email} from voice debug bubble access.`
			});
		} catch (err) {
			console.error('removeVoiceDebugUser failed', err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Unable to remove assignment.'
			});
		} finally {
			removingVoiceEmail = null;
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

					<!-- Voice debug bubble assignment -->
					<article class="test-card voice-debug-card">
						<div class="test-icon voice">
							<i class="bx bx-podcast"></i>
						</div>
						<div class="test-content">
							<h4>Voice debug bubble</h4>
							<p>
								Show the floating voice debug bubble for specific users to surface call stats and
								copyable diagnostics.
							</p>
							<div class="voice-debug-status">
								<span class:enabled={voiceDebugEnabled}>
									{voiceDebugEnabled ? 'Enabled' : 'Disabled'}
								</span>
								<button
									type="button"
									class="btn outline"
									onclick={toggleVoiceDebugBubble}
									disabled={voiceDebugToggleBusy}
								>
									{#if voiceDebugToggleBusy}
										<i class="bx bx-loader-alt bx-spin"></i>
										Saving...
									{:else}
										<i class="bx {voiceDebugEnabled ? 'bx-toggle-right' : 'bx-toggle-left'}"></i>
										{voiceDebugEnabled ? 'Disable bubble' : 'Enable bubble'}
									{/if}
								</button>
							</div>
						</div>

						<div class="voice-debug-form">
							<label for="voice-debug-search">Assign bubble to user</label>
							<div class="voice-debug-search">
								<i class="bx bx-search"></i>
								<input
									id="voice-debug-search"
									type="search"
									placeholder="Search by name or email"
									bind:value={voiceDebugQuery}
									oninput={(event) => handleVoiceDebugQueryInput(event.currentTarget.value)}
								/>
								{#if voiceDebugSearching}
									<i class="bx bx-loader-alt bx-spin loader"></i>
								{/if}
							</div>
							{#if voiceDebugResults.length}
								<ul class="voice-debug-results">
									{#each voiceDebugResults as user (user.uid)}
										<li
											class:selected={voiceDebugSelected?.uid === user.uid}
											onclick={() => selectVoiceDebugUser(user)}
										>
											<div class="pill-avatar">
												<i class="bx bx-user"></i>
											</div>
											<div class="result-meta">
												<p>{user.displayName ?? user.email ?? 'User'}</p>
												<small>{user.email ?? 'No email'} · {user.uid}</small>
											</div>
											{#if voiceDebugSelected?.uid === user.uid}
												<i class="bx bx-check"></i>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
							<div class="voice-debug-inputs">
								<input
									id="voice-debug-email"
									type="email"
									placeholder="Or enter email manually"
									bind:value={voiceDebugEmail}
								/>
								<input
									id="voice-debug-note"
									type="text"
									placeholder="Optional note (region, device, etc.)"
									bind:value={voiceDebugNote}
								/>
								<button
									type="button"
									class="btn primary"
									onclick={addVoiceDebugUser}
									disabled={voiceDebugBusy}
								>
									{#if voiceDebugBusy}
										<i class="bx bx-loader-alt bx-spin"></i>
										Adding...
									{:else}
										<i class="bx bx-plus"></i>
										Assign
									{/if}
								</button>
							</div>
							<p class="helper-text">
								Search for anyone who has logged in (profiles collection) or paste an email directly,
								then assign the bubble so it auto-opens for them.
							</p>
						</div>

						{#if voiceDebugAssignees.length}
							<div class="voice-debug-list">
								<p class="list-title">Assigned users</p>
								<ul>
									{#each voiceDebugAssignees as assignee (assignee.email)}
										<li>
											<div>
												<p>{assignee.email}</p>
												{#if assignee.note}
													<small>{assignee.note}</small>
												{/if}
											</div>
											<button
												type="button"
												class="remove-btn"
												onclick={() => removeVoiceDebugUser(assignee.email)}
												disabled={removingVoiceEmail === assignee.email}
											>
												{#if removingVoiceEmail === assignee.email}
													<i class="bx bx-loader-alt bx-spin"></i>
												{:else}
													Remove
												{/if}
											</button>
										</li>
									{/each}
								</ul>
							</div>
						{:else}
							<p class="helper-text">No users assigned yet.</p>
						{/if}
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
		min-height: 0;
		padding: 0;
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
		grid-template-columns: 3fr 2fr;
		gap: 1.5rem;
	}

	.content-grid.mobile {
		grid-template-columns: 1fr;
		gap: 1rem;
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

	.sections-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.test-tools-grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
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

	.test-icon.push {
		background: linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(249, 115, 22, 0.2));
	}

	.test-icon.push i {
		color: #f59e0b;
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

	/* Voice debug bubble */
	.voice-debug-card {
		gap: 1rem;
	}

	.voice-debug-status {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	.voice-debug-status span {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.3rem 0.6rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.voice-debug-status span.enabled {
		background: color-mix(in srgb, #10b981 16%, transparent);
		color: #059669;
	}

	.voice-debug-form {
		display: grid;
		gap: 0.45rem;
	}

	.voice-debug-form label {
		font-size: 0.78rem;
		color: var(--color-text-secondary);
		font-weight: 600;
	}

	.voice-debug-inputs {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.5rem;
		align-items: center;
	}

	.voice-debug-inputs input {
		width: 100%;
		height: 38px;
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		background: color-mix(in srgb, var(--surface-panel) 90%, transparent);
		color: var(--color-text-primary);
		padding: 0 0.65rem;
		font-size: 0.85rem;
	}

	.voice-debug-list {
		display: grid;
		gap: 0.4rem;
	}

	.voice-debug-search {
		position: relative;
		display: flex;
		align-items: center;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 12%, transparent);
		border-radius: 10px;
		background: color-mix(in srgb, var(--surface-panel) 90%, transparent);
		padding: 0 0.65rem;
		gap: 0.45rem;
	}

	.voice-debug-search i {
		color: var(--color-text-secondary);
	}

	.voice-debug-search .loader {
		margin-left: auto;
	}

	.voice-debug-search input {
		flex: 1;
		height: 40px;
		background: transparent;
		border: none;
		color: var(--color-text-primary);
		font-size: 0.9rem;
		outline: none;
	}

	.voice-debug-results {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
		max-height: 180px;
		overflow-y: auto;
	}

	.voice-debug-results li {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.55rem 0.65rem;
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 8%, transparent);
		background: color-mix(in srgb, var(--surface-panel) 85%, transparent);
		cursor: pointer;
		transition: border-color 120ms ease, background 120ms ease;
	}

	.voice-debug-results li.selected {
		border-color: color-mix(in srgb, var(--accent-primary) 35%, transparent);
		background: color-mix(in srgb, var(--accent-primary) 10%, var(--surface-panel));
	}

	.voice-debug-results li:hover {
		border-color: color-mix(in srgb, var(--accent-primary) 25%, transparent);
	}

	.pill-avatar {
		width: 32px;
		height: 32px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--color-text-primary) 12%, transparent);
		display: grid;
		place-items: center;
		color: var(--color-text-primary);
	}

	.result-meta p {
		margin: 0;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.result-meta small {
		display: block;
		color: var(--color-text-secondary);
	}

	.voice-debug-list .list-title {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.voice-debug-list ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.4rem;
	}

	.voice-debug-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.6rem 0.75rem;
		border-radius: 10px;
		background: color-mix(in srgb, var(--surface-panel) 80%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 8%, transparent);
	}

	.voice-debug-list p {
		margin: 0;
		color: var(--color-text-primary);
		font-weight: 600;
	}

	.voice-debug-list small {
		display: block;
		margin-top: 0.1rem;
		color: var(--color-text-secondary);
	}

	.voice-debug-list .remove-btn {
		border: none;
		background: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		color: var(--color-text-primary);
		padding: 0.35rem 0.75rem;
		border-radius: 8px;
		cursor: pointer;
		font-weight: 600;
		transition: background 0.2s ease, color 0.2s ease;
	}

	.voice-debug-list .remove-btn:hover:not(:disabled) {
		background: color-mix(in srgb, #ef4444 20%, transparent);
		color: #fca5a5;
	}

	.voice-debug-list .remove-btn:disabled {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.helper-text {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}
</style>
