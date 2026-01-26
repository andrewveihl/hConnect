<script lang="ts">
	import type { PageData } from './$types';
	import { browser } from '$app/environment';
	import { FEATURE_FLAGS, type FeatureFlagKey, type FeatureFlagMeta } from '$lib/admin/types';
	import { featureFlagsStore, updateFeatureFlag } from '$lib/admin/featureFlags';
	import { showAdminToast } from '$lib/admin/stores/toast';
	import type { ServerInvite } from '$lib/firestore/invites';
	import DomainInvitePrompt from '$lib/components/app/DomainInvitePrompt.svelte';
	import { triggerTestPush } from '$lib/notify/testPush';
	import { getDb, getFunctionsClient, getFirebase } from '$lib/firebase';
	import {
		addVoiceDebugAssignee,
		removeVoiceDebugAssignee,
		setVoiceDebugEnabled,
		voiceDebugConfigStore
	} from '$lib/admin/voiceDebug';
	import { LAST_LOCATION_STORAGE_KEY, RESUME_DM_SCROLL_KEY } from '$lib/constants/navigation';
	import { isMobileViewport } from '$lib/stores/viewport';
	import { collection, endAt, getDocs, limit as fbLimit, orderBy, query, startAt } from 'firebase/firestore';
	import { httpsCallable } from 'firebase/functions';
	import { markAllDMsAsRead, triggerDMRailBackfill } from '$lib/firestore/dms';
	import { clearAllCaches } from '$lib/perf/cacheDb';

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
	let testEmailAddress = $state('');
	let testEmailLoading = $state(false);

	// DM & Server fix state
	let dmFixLoading = $state(false);
	let serverRailBackfillLoading = $state(false);
	let fullResetLoading = $state(false);

	$effect(() => {
		testEmailAddress = data?.user?.email ?? '';
	});

	// Email logs modal state
	let emailLogsOpen = $state(false);
	let emailLogsLoading = $state(false);
	type EmailLogEntry = {
		id: string;
		to: string | null;
		subject: string | null;
		sent: boolean;
		reason: string | null;
		messageId: string | null;
		provider: string | null;
		context: { type?: string; recipientUid?: string; messageId?: string; serverId?: string; channelId?: string; dmId?: string } | null;
		durationMs: number | null;
		createdAt: string | null;
	};
	let emailLogs = $state<EmailLogEntry[]>([]);

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

	const handleSendTestEmail = async () => {
		if (!browser) {
			showAdminToast({ type: 'info', message: 'Email testing requires a browser session.' });
			return;
		}
		const email = (testEmailAddress ?? '').trim();
		if (!email || !email.includes('@')) {
			showAdminToast({ type: 'warning', message: 'Enter a valid email address first.' });
			return;
		}
		testEmailLoading = true;
		try {
			await getFunctionsClient(); // ensures Firebase is initialized
			const { auth } = getFirebase();
			const currentUser = auth?.currentUser;
			if (!currentUser) {
				showAdminToast({ type: 'warning', message: 'Sign in again to send test emails.' });
				return;
			}
			const idToken = await currentUser.getIdToken();
			const endpoint =
				'https://sendtestemailnotificationhttp-xpac7ukbha-uc.a.run.app';
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${idToken}`
				},
				body: JSON.stringify({ email })
			});
			let payload: any = null;
			let fallbackText = '';
			try {
				payload = await response.json();
			} catch (err) {
				try {
					fallbackText = await response.text();
				} catch {
					fallbackText = '';
				}
			}

			if (response.ok && payload?.ok) {
				showAdminToast({
					type: 'success',
					message: 'Test email sent. Check the inbox to confirm delivery.'
				});
			} else {
				const reason =
					payload?.reason ||
					fallbackText ||
					response.statusText ||
					`Request failed (${response.status})`;
				showAdminToast({
					type: 'warning',
					message: `Test email failed: ${reason}`
				});
			}
		} catch (error) {
			console.error('sendTestEmailNotification failed', error);
			showAdminToast({ type: 'error', message: 'Unable to send test email.' });
		} finally {
			testEmailLoading = false;
		}
	};

	const handleOpenEmailLogs = async () => {
		emailLogsOpen = true;
		emailLogsLoading = true;
		emailLogs = [];
		try {
			const functions = await getFunctionsClient();
			const getLogsFunc = httpsCallable(functions, 'getEmailNotificationLogs');
			const result = await getLogsFunc({ limit: 100 });
			const data = result.data as { ok: boolean; logs?: EmailLogEntry[] };
			if (data.ok && Array.isArray(data.logs)) {
				emailLogs = data.logs;
			} else {
				showAdminToast({ type: 'warning', message: 'No logs returned.' });
			}
		} catch (error) {
			console.error('getEmailNotificationLogs failed', error);
			showAdminToast({ type: 'error', message: 'Unable to fetch email logs.' });
		} finally {
			emailLogsLoading = false;
		}
	};

	const closeEmailLogs = () => {
		emailLogsOpen = false;
	};

	const fixDMUnreadCounts = async () => {
		if (!data?.user?.uid) {
			showAdminToast({ type: 'error', message: 'You must be signed in to fix DM counts.' });
			return;
		}
		dmFixLoading = true;
		try {
			const result = await markAllDMsAsRead(data.user.uid);
			showAdminToast({
				type: 'success',
				message: `Marked ${result.success} DM threads as read${result.failed ? ` (${result.failed} failed)` : ''}.`
			});
		} catch (error) {
			console.error('fixDMUnreadCounts failed', error);
			showAdminToast({ type: 'error', message: 'Unable to fix DM counts. Try again.' });
		} finally {
			dmFixLoading = false;
		}
	};

	const backfillServerRail = async () => {
		serverRailBackfillLoading = true;
		try {
			const functions = await getFunctionsClient();
			const backfill = httpsCallable(functions, 'backfillMyServerRail');
			const result = await backfill();
			const data = result.data as { ok: boolean; updated?: number; total?: number; message?: string };
			if (data.ok) {
				showAdminToast({
					type: 'success',
					message: data.message ?? `Server rail synced. ${data.updated ?? 0} of ${data.total ?? 0} servers updated.`
				});
			} else {
				showAdminToast({ type: 'warning', message: data.message ?? 'Backfill returned no changes.' });
			}
		} catch (error) {
			console.error('backfillServerRail failed', error);
			showAdminToast({ type: 'error', message: 'Unable to sync server rail. Try again.' });
		} finally {
			serverRailBackfillLoading = false;
		}
	};

	const fullSidebarReset = async () => {
		if (!data?.user?.uid) {
			showAdminToast({ type: 'error', message: 'You must be signed in.' });
			return;
		}
		fullResetLoading = true;
		try {
			// 1. Clear all local caches
			clearAllCaches();
			
			// 2. Clear localStorage items related to navigation/sidebar
			if (browser) {
				localStorage.removeItem(LAST_SERVER_KEY);
				localStorage.removeItem(LAST_SERVER_CHANNEL_KEY);
				localStorage.removeItem(LAST_LOCATION_STORAGE_KEY);
				localStorage.removeItem(RESUME_DM_SCROLL_KEY);
				localStorage.removeItem('hc_server_rail');
				localStorage.removeItem('hc_dm_rail');
				localStorage.removeItem('hc_server_unread');
				localStorage.removeItem('hc_channel_indicators');
			}
			
			// 3. Fix DM unread counts
			const dmResult = await markAllDMsAsRead(data.user.uid);
			
			// 4. Trigger server rail backfill
			try {
				const functions = await getFunctionsClient();
				const backfill = httpsCallable(functions, 'backfillMyServerRail');
				await backfill();
			} catch {
				// Server rail backfill is optional
			}
			
			showAdminToast({
				type: 'success',
				message: `Full reset complete! Marked ${dmResult.success} DMs as read. Refresh to see changes.`
			});
		} catch (error) {
			console.error('fullSidebarReset failed', error);
			showAdminToast({ type: 'error', message: 'Reset partially failed. Try refreshing anyway.' });
		} finally {
			fullResetLoading = false;
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
									Sending...
								{:else}
									<i class="bx bx-send"></i>
									Send test push
								{/if}
							</button>
						</div>
					</article>

					<!-- Email delivery test -->
					<article class="test-card">
						<div class="test-icon email">
							<i class="bx bx-mail-send"></i>
						</div>
						<div class="test-content">
							<h4>Email notification test</h4>
							<p>Send a one-off test email notification to verify SMTP wiring.</p>
							<label class="input-label" for="test-email-address">Destination email</label>
							<input
								id="test-email-address"
								type="email"
								placeholder="you@example.com"
								bind:value={testEmailAddress}
								class="input"
								autocomplete="email"
							/>
						</div>
						<div class="test-actions">
							<button
								type="button"
								class="btn warning"
								onclick={handleSendTestEmail}
								disabled={testEmailLoading}
							>
								{#if testEmailLoading}
									<i class="bx bx-loader-alt bx-spin"></i>
									Sending...
								{:else}
									<i class="bx bx-send"></i>
									Send test email
								{/if}
							</button>
							<button
								type="button"
								class="btn outline"
								onclick={handleOpenEmailLogs}
							>
								<i class="bx bx-list-ul"></i>
								View Logs
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

					<!-- DM/Server Sidebar Fix - PROMINENT -->
					<article class="test-card test-card--highlight">
						<div class="test-icon dm-fix">
							<i class="bx bx-error-circle"></i>
						</div>
						<div class="test-content">
							<h4>🚨 Sidebar Issues Fix</h4>
							<p>
								<strong>Use this if:</strong> DMs show as unread when they're not, servers aren't showing, 
								or sidebar is corrupted after fresh install/sign-in.
							</p>
						</div>
						<div class="test-actions test-actions--stacked">
							<button 
								type="button" 
								class="btn warning" 
								onclick={fullSidebarReset}
								disabled={fullResetLoading}
							>
								{#if fullResetLoading}
									<i class="bx bx-loader-alt bx-spin"></i>
									Fixing...
								{:else}
									<i class="bx bx-wrench"></i>
									Full Reset (Recommended)
								{/if}
							</button>
							<div class="test-actions-row">
								<button 
									type="button" 
									class="btn outline" 
									onclick={fixDMUnreadCounts}
									disabled={dmFixLoading}
								>
									{#if dmFixLoading}
										<i class="bx bx-loader-alt bx-spin"></i>
									{:else}
										<i class="bx bx-message-check"></i>
									{/if}
									Mark All DMs Read
								</button>
								<button 
									type="button" 
									class="btn outline" 
									onclick={backfillServerRail}
									disabled={serverRailBackfillLoading}
								>
									{#if serverRailBackfillLoading}
										<i class="bx bx-loader-alt bx-spin"></i>
									{:else}
										<i class="bx bx-server"></i>
									{/if}
									Sync Servers
								</button>
							</div>
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
										<li>
											<button
												type="button"
												class:selected={voiceDebugSelected?.uid === user.uid}
												onclick={() => selectVoiceDebugUser(user)}
											>
												<div class="pill-avatar">
													<i class="bx bx-user"></i>
												</div>
												<div class="result-meta">
													<p>{user.displayName ?? user.email ?? 'User'}</p>
													<small>{user.email ?? 'No email'} - {user.uid}</small>
												</div>
												{#if voiceDebugSelected?.uid === user.uid}
													<i class="bx bx-check"></i>
												{/if}
											</button>
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

<!-- Email Logs Modal -->
{#if emailLogsOpen}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="email-logs-backdrop"
		role="dialog"
		aria-modal="true"
		aria-labelledby="email-logs-title"
		onclick={(e) => { if (e.target === e.currentTarget) closeEmailLogs(); }}
		onkeydown={(e) => { if (e.key === 'Escape') closeEmailLogs(); }}
		tabindex="-1"
	>
		<div class="email-logs-modal">
			<header class="email-logs-header">
				<h2 id="email-logs-title">
					<i class="bx bx-mail-send"></i>
					Email Notification Logs
				</h2>
				<button type="button" class="close-btn" onclick={closeEmailLogs} aria-label="Close">
					<i class="bx bx-x"></i>
				</button>
			</header>
			<div class="email-logs-body">
				{#if emailLogsLoading}
					<div class="logs-loading">
						<i class="bx bx-loader-alt bx-spin"></i>
						<span>Loading logs...</span>
					</div>
				{:else if emailLogs.length === 0}
					<div class="logs-empty">
						<i class="bx bx-inbox"></i>
						<p>No email logs yet. Send a test email to see logs here.</p>
					</div>
				{:else}
					<div class="logs-list">
						{#each emailLogs as log (log.id)}
							<div class="log-entry" class:success={log.sent} class:failed={!log.sent}>
								<div class="log-status">
									{#if log.sent}
										<i class="bx bx-check-circle"></i>
									{:else}
										<i class="bx bx-x-circle"></i>
									{/if}
								</div>
								<div class="log-details">
									<div class="log-main">
										<span class="log-to">{log.to ?? 'Unknown'}</span>
										<span class="log-type">{log.context?.type ?? 'unknown'}</span>
									</div>
									<div class="log-subject">{log.subject ?? 'No subject'}</div>
									{#if !log.sent && log.reason}
										<div class="log-reason">Reason: {log.reason}</div>
									{/if}
									<div class="log-meta">
										<span>{log.provider ?? 'N/A'}</span>
										{#if log.durationMs}
											<span>{log.durationMs}ms</span>
										{/if}
										{#if log.createdAt}
											<span>{new Date(log.createdAt).toLocaleString()}</span>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
			<footer class="email-logs-footer">
				<button type="button" class="btn outline" onclick={handleOpenEmailLogs} disabled={emailLogsLoading}>
					<i class="bx bx-refresh"></i>
					Refresh
				</button>
				<button type="button" class="btn" onclick={closeEmailLogs}>
					Close
				</button>
			</footer>
		</div>
	</div>
{/if}

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

	.test-icon.email {
		background: linear-gradient(135deg, rgba(14, 165, 233, 0.2), rgba(6, 95, 212, 0.18));
	}

	.test-icon.email i {
		color: #0ea5e9;
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

	.test-icon.dm-fix {
		background: color-mix(in srgb, #f97316 20%, transparent);
	}

	.test-icon.dm-fix i {
		color: #f97316;
	}

	.test-card--highlight {
		border: 2px solid color-mix(in srgb, #f97316 40%, transparent);
		background: color-mix(in srgb, #f97316 8%, var(--card-bg));
	}

	.test-actions--stacked {
		flex-direction: column;
		align-items: stretch;
	}

	.test-actions-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.test-actions-row .btn {
		flex: 1;
		min-width: 120px;
		justify-content: center;
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
		margin: 0;
		padding: 0;
	}

	.voice-debug-results button {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.55rem 0.65rem;
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 8%, transparent);
		background: color-mix(in srgb, var(--surface-panel) 85%, transparent);
		cursor: pointer;
		transition: border-color 120ms ease, background 120ms ease;
		width: 100%;
		text-align: left;
		color: inherit;
		font: inherit;
	}

	.voice-debug-results button.selected {
		border-color: color-mix(in srgb, var(--accent-primary) 35%, transparent);
		background: color-mix(in srgb, var(--accent-primary) 10%, var(--surface-panel));
	}

	.voice-debug-results button:hover {
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

	/* Email Logs Modal */
	.email-logs-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 9999;
		background: rgba(0, 0, 0, 0.85);
		backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.email-logs-modal {
		background: var(--surface-panel, #1a1a2e);
		border-radius: 16px;
		width: 100%;
		max-width: 800px;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
		border: 1px solid rgba(255, 255, 255, 0.1);
	}

	.email-logs-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
	}

	.email-logs-header h2 {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.email-logs-header h2 i {
		color: var(--accent-primary);
	}

	.email-logs-header .close-btn {
		background: none;
		border: none;
		color: var(--color-text-secondary);
		font-size: 1.5rem;
		cursor: pointer;
		padding: 0.25rem;
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s, color 0.15s;
	}

	.email-logs-header .close-btn:hover {
		background: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		color: var(--color-text-primary);
	}

	.email-logs-body {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		min-height: 200px;
	}

	.logs-loading,
	.logs-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3rem 1rem;
		color: var(--color-text-secondary);
	}

	.logs-loading i,
	.logs-empty i {
		font-size: 2.5rem;
		opacity: 0.5;
	}

	.logs-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.log-entry {
		display: flex;
		gap: 0.75rem;
		padding: 0.75rem;
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
		border-radius: 10px;
		border-left: 3px solid var(--color-text-secondary);
	}

	.log-entry.success {
		border-left-color: #22c55e;
	}

	.log-entry.failed {
		border-left-color: #ef4444;
	}

	.log-status {
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	.log-entry.success .log-status {
		color: #22c55e;
	}

	.log-entry.failed .log-status {
		color: #ef4444;
	}

	.log-details {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.log-main {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.log-to {
		font-weight: 600;
		color: var(--color-text-primary);
		word-break: break-all;
	}

	.log-type {
		font-size: 0.6875rem;
		text-transform: uppercase;
		background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
		color: var(--accent-primary);
		padding: 0.125rem 0.5rem;
		border-radius: 4px;
		font-weight: 600;
	}

	.log-subject {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.log-reason {
		font-size: 0.8125rem;
		color: #fca5a5;
	}

	.log-meta {
		display: flex;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
		flex-wrap: wrap;
	}

	.email-logs-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 1rem 1.25rem;
		border-top: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
	}
</style>
