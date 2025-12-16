<!-- src/routes/(app)/+layout.svelte -->
<script lang="ts">
	import '$lib/stores/theme';
	import '$lib/stores/notifications'; // Ensure notification watchers start early
	import { onDestroy, onMount } from 'svelte';
	import { run } from 'svelte/legacy';
	import { startAuthListener } from '$lib/firebase';
	import { startPresenceService } from '$lib/firebase/presence';
	import { browser } from '$app/environment';
	import { afterNavigate, goto } from '$app/navigation';
	import { registerFirebaseMessagingSW } from '$lib/notify/push';
	import {
		clearDeepLinkParams,
		extractDeepLinkFromURL,
		handleDeepLinkPayload,
		startDeepLinkListener
	} from '$lib/notify/deepLink';
	import { LAST_LOCATION_STORAGE_KEY, RESUME_DM_SCROLL_KEY } from '$lib/constants/navigation';
	import { page } from '$app/stores';
	import { isMobileViewport } from '$lib/stores/viewport';
	import { settingsUI, closeSettings, setSettingsSection } from '$lib/stores/settingsUI';
	import {
		serverSettingsUI,
		closeServerSettings,
		setServerSettingsSection
	} from '$lib/stores/serverSettingsUI';
	import VoiceMiniPanel from '$lib/components/voice/VoiceMiniPanel.svelte';
	import MobileNavBar from '$lib/components/app/MobileNavBar.svelte';
	import DomainInvitePrompt from '$lib/components/app/DomainInvitePrompt.svelte';
	import SettingsMobileShell from '$lib/components/settings/SettingsMobileShell.svelte';
	import SettingsModal from '$lib/components/settings/SettingsModal.svelte';
	import ServerSettingsMobileShell from '$lib/components/servers/ServerSettingsMobileShell.svelte';
	import ServerSettingsModal from '$lib/components/servers/ServerSettingsModal.svelte';
	import { voiceSession } from '$lib/stores/voice';
	import { mobileDockSuppressed } from '$lib/stores/ui';
	import { user, startProfileListener } from '$lib/stores/user';
	import {
		acceptInvite,
		declineInvite,
		subscribeInbox,
		type ServerInvite
	} from '$lib/firestore/invites';
	import { requestDomainAutoInvites } from '$lib/servers/domainAutoInvite';
	import type { SettingsSectionId } from '$lib/settings/sections';
	import type { VoiceSession } from '$lib/stores/voice';
	import { setupSwipeGestures } from '$lib/utils/swipeGestures';
	import { primeSoundPlayback } from '$lib/utils/sounds';
	interface Props {
		children?: import('svelte').Snippet;
	}

	let { children }: Props = $props();

	// App name used everywhere (tab title, social tags)
	const APP_TITLE = 'hConnect';
	const settingsState = $derived($settingsUI);
	const serverSettingsState = $derived($serverSettingsUI);
	const mobileViewport = $derived($isMobileViewport);
	const currentPath = $derived($page?.url?.pathname ?? '/');

	let activeVoice: VoiceSession | null = $state(null);
	const stopVoice = voiceSession.subscribe((value) => {
		activeVoice = value;
	});

	let hasAttemptedRestore = false;
	let pendingInitialUrl: URL | null = null;
	let skipResumeRestore = false;
	let stopDeepLinkListener: (() => void) | null = null;
	const DOMAIN_INVITE_DISMISS_KEY = 'domainAutoInviteDismissals';

	let domainInviteCandidate: ServerInvite | null = $state(null);
	let domainInviteBusy = $state(false);
	let domainInviteError: string | null = $state(null);
	let domainInviteInboxStop: (() => void) | null = null;
	let domainInviteInboxUid: string | null = null;
	let dismissedDomainInviteIds = new Set<string>();
	let detachDomainInviteTestListener: (() => void) | null = null;

	if (browser) {
		try {
			const raw = localStorage.getItem(DOMAIN_INVITE_DISMISS_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					parsed.forEach((entry) => {
						if (typeof entry === 'string' && entry.trim().length) {
							dismissedDomainInviteIds.add(entry);
						}
					});
				}
			}
		} catch {
			dismissedDomainInviteIds = new Set();
		}

		const handleTestInvite = ((event: Event) => {
			const detail = (event as CustomEvent<Partial<ServerInvite> | undefined>)?.detail;
			const sample = buildTestInvite(detail ?? {});
			domainInviteCandidate = sample;
			domainInviteBusy = false;
			domainInviteError = null;
			if (sample.id) {
				dismissedDomainInviteIds.delete(sample.id);
			}
		}) as EventListener;
		window.addEventListener('domain-invite-test', handleTestInvite);
		detachDomainInviteTestListener = () =>
			window.removeEventListener('domain-invite-test', handleTestInvite);
	}

	const persistDismissedDomainInvites = () => {
		if (!browser) return;
		try {
			localStorage.setItem(
				DOMAIN_INVITE_DISMISS_KEY,
				JSON.stringify(Array.from(dismissedDomainInviteIds.values()))
			);
		} catch {
			// Ignore storage quota issues
		}
	};

	const dismissDomainInvite = (inviteId: string | null | undefined) => {
		if (inviteId && !dismissedDomainInviteIds.has(inviteId)) {
			dismissedDomainInviteIds.add(inviteId);
			persistDismissedDomainInvites();
		}
		domainInviteCandidate = null;
		domainInviteBusy = false;
		domainInviteError = null;
	};

	const pruneDismissedDomainInvites = (activeIds: Set<string>) => {
		let changed = false;
		dismissedDomainInviteIds.forEach((id) => {
			if (!activeIds.has(id)) {
				dismissedDomainInviteIds.delete(id);
				changed = true;
			}
		});
		if (changed) persistDismissedDomainInvites();
	};

	const inviteTimestamp = (invite: ServerInvite): number => {
		const ts = (invite?.createdAt as any)?.toMillis?.();
		if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
		if (typeof invite?.createdAt === 'number' && Number.isFinite(invite.createdAt))
			return invite.createdAt;
		return 0;
	};

	const handleDomainInboxSnapshot = (rows: ServerInvite[]) => {
		const domainInvites = rows
			.filter((row) => (row?.type ?? 'channel') === 'domain-auto')
			.sort((a, b) => inviteTimestamp(b) - inviteTimestamp(a));
		const activeIds = new Set(
			domainInvites
				.map((invite) => invite.id)
				.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
		);
		pruneDismissedDomainInvites(activeIds);
		const next = domainInvites.find(
			(invite) => invite.id && !dismissedDomainInviteIds.has(invite.id)
		);
		domainInviteCandidate = next ?? null;
		if (!next) {
			domainInviteError = null;
		}
	};

	run(() => {
		if (!browser) return;
		const uid = $user?.uid ?? null;
		if (uid === domainInviteInboxUid) return;
		domainInviteInboxUid = uid;
		domainInviteCandidate = null;
		domainInviteError = null;
		domainInviteBusy = false;
		domainInviteInboxStop?.();
		if (!uid) {
			domainInviteInboxStop = null;
			return;
		}
		domainInviteInboxStop = subscribeInbox(uid, handleDomainInboxSnapshot);
		void requestDomainAutoInvites();
	});

	async function acceptDomainInvite() {
		const invite = domainInviteCandidate;
		const me = $user?.uid ?? null;
		if (!invite?.id) {
			dismissDomainInvite(null);
			return;
		}
		if (!me) {
			domainInviteError = 'Sign in to accept invites.';
			return;
		}
		domainInviteBusy = true;
		domainInviteError = null;
		try {
			const res = await acceptInvite(invite.id, me);
			if (!res.ok) {
				domainInviteError = res.error ?? 'Unable to join this server.';
				return;
			}
			dismissDomainInvite(invite.id);
		} catch (error: any) {
			domainInviteError = error?.message ?? 'Unable to join this server.';
		} finally {
			domainInviteBusy = false;
		}
	}

	async function declineDomainInvite() {
		const invite = domainInviteCandidate;
		const me = $user?.uid ?? null;
		if (!invite?.id) {
			dismissDomainInvite(null);
			return;
		}
		if (!me) {
			domainInviteError = 'Sign in to decline invites.';
			return;
		}
		domainInviteBusy = true;
		domainInviteError = null;
		try {
			const res = await declineInvite(invite.id, me);
			if (!res.ok) {
				domainInviteError = res.error ?? 'Unable to decline this invite.';
				return;
			}
			dismissDomainInvite(invite.id);
		} catch (error: any) {
			domainInviteError = error?.message ?? 'Unable to decline this invite.';
		} finally {
			domainInviteBusy = false;
		}
	}

	const dismissCurrentDomainInvite = () => dismissDomainInvite(domainInviteCandidate?.id ?? null);

	function buildTestInvite(detail?: Partial<ServerInvite>): ServerInvite {
		const now = Date.now();
		const base: ServerInvite = {
			id: detail?.id ?? '__domain_test_invite__',
			toUid: detail?.toUid ?? $user?.uid ?? 'tester',
			fromUid: detail?.fromUid ?? 'auto',
			fromDisplayName: detail?.fromDisplayName ?? 'Auto Invite',
			serverId: detail?.serverId ?? 'test-server',
			serverName: detail?.serverName ?? 'Sample Workspace',
			serverIcon: detail?.serverIcon ?? null,
			channelId: detail?.channelId ?? 'general',
			channelName: detail?.channelName ?? 'general',
			type: 'domain-auto',
			status: 'pending',
			createdAt: {
				toMillis: () => now
			} as any
		};
		return { ...base, ...detail };
	}

	const persistLastLocation = (url: URL | null | undefined) => {
		if (!browser || !url) return;
		try {
			const payload = {
				pathname: url.pathname,
				search: url.search,
				hash: url.hash ?? '',
				timestamp: Date.now()
			};
			localStorage.setItem(LAST_LOCATION_STORAGE_KEY, JSON.stringify(payload));
		} catch {
			// Ignore storage errors (privacy / safari)
		}
	};

	const readStoredLocation = () => {
		if (!browser) return null;
		try {
			const raw = localStorage.getItem(LAST_LOCATION_STORAGE_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			return typeof parsed?.pathname === 'string' ? parsed : null;
		} catch {
			return null;
		}
	};

	const fullPath = (loc: { pathname: string; search?: string; hash?: string }) =>
		`${loc.pathname}${loc.search ?? ''}${loc.hash ?? ''}`;

	function handleSettingsClose() {
		const destination = settingsState.returnTo;
		closeSettings();
		if (destination && currentPath === '/settings') {
			goto(destination, { replaceState: true, keepFocus: true });
		}
	}

	function handleSettingsSection(event: CustomEvent<SettingsSectionId>) {
		setSettingsSection(event.detail);
	}

	function handleServerSettingsClose() {
		const destination =
			serverSettingsState.returnTo ??
			(serverSettingsState.serverId ? `/servers/${serverSettingsState.serverId}` : null);
		closeServerSettings();
		const routePath = serverSettingsState.serverId
			? `/servers/${serverSettingsState.serverId}/settings`
			: null;
		if (destination && routePath && currentPath === routePath) {
			goto(destination, { replaceState: true, keepFocus: true });
		}
	}

	function handleServerSettingsSection(
		event: CustomEvent<import('$lib/servers/settingsSections').ServerSettingsSectionId>
	) {
		setServerSettingsSection(event.detail);
	}

	async function resumeLastLocation() {
		if (!browser || skipResumeRestore) return;
		const stored = readStoredLocation();
		if (!stored?.pathname) return;
		const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
		const target = fullPath(stored);
		if (window.location.pathname !== '/' || !target || target === current) {
			sessionStorage.removeItem(RESUME_DM_SCROLL_KEY);
			return;
		}
		const isDm = stored.pathname.startsWith('/dms/');
		if (isDm) {
			sessionStorage.setItem(RESUME_DM_SCROLL_KEY, '1');
		} else {
			sessionStorage.removeItem(RESUME_DM_SCROLL_KEY);
		}
		await goto(target, { replaceState: true, noScroll: true, keepFocus: true });
	}

	// Re-assert after every route change (overrides page-level titles) and persist location
	afterNavigate(({ to }) => {
		if (typeof document !== 'undefined') document.title = APP_TITLE;
		if (!browser || !to?.url) return;
		if (!hasAttemptedRestore) {
			pendingInitialUrl = to.url;
			return;
		}
		persistLastLocation(to.url);
	});

	onMount(() => {
		const stopAuth = startAuthListener();
		const stopPresence = startPresenceService();
		let stopProfileListener: (() => void) | null = null;
		let detachGestureGuards: (() => void) | null = null;
		let detachSwipeGestures: (() => void) | null = null;

		// Start listening to the current user's Firestore profile for cached avatars
		startProfileListener().then((unsub) => {
			stopProfileListener = unsub ?? null;
		});

		stopDeepLinkListener = startDeepLinkListener((payload) => {
			skipResumeRestore = true;
			handleDeepLinkPayload(payload).catch(() => {});
		});

		if (browser) {
			(window as any).__DEBUG = true;
			// Set once on first client paint
			document.title = APP_TITLE;
			// Best-effort register SW for push/notifications (no permission prompt here)
			registerFirebaseMessagingSW().catch(() => {});
			primeSoundPlayback();

			// Setup swipe gestures for mobile navigation
			if (mobileViewport && typeof window !== 'undefined') {
				detachSwipeGestures = setupSwipeGestures(
					window,
					{
						onSwipeRight: () => {
							// Swipe right opens server/channel list
							const openedOverlay = document.querySelector(
								'[data-overlay="server-rail"], [data-overlay="channel-list"]'
							);
							if (openedOverlay) {
								openedOverlay.classList.remove('open');
							}
						},
						onSwipeLeft: () => {
							// Swipe left closes overlays
							const openedOverlay = document.querySelector('[data-overlay].open');
							if (openedOverlay) {
								openedOverlay.classList.remove('open');
							}
						}
					},
					{ minDistance: 40, maxDuration: 600 }
				);
			}

			const preventGesture = (event: Event) => {
				event.preventDefault();
			};
			window.addEventListener('gesturestart', preventGesture);
			window.addEventListener('gesturechange', preventGesture);
			window.addEventListener('gestureend', preventGesture);
			detachGestureGuards = () => {
				window.removeEventListener('gesturestart', preventGesture);
				window.removeEventListener('gesturechange', preventGesture);
				window.removeEventListener('gestureend', preventGesture);
			};

			const currentUrl = new URL(window.location.href);
			const initialDeepLink = extractDeepLinkFromURL(currentUrl);
			if (initialDeepLink) {
				skipResumeRestore = true;
				clearDeepLinkParams(currentUrl);
				handleDeepLinkPayload(initialDeepLink)
					.catch(() => {})
					.finally(() => {
						hasAttemptedRestore = true;
						if (pendingInitialUrl) {
							persistLastLocation(pendingInitialUrl);
							pendingInitialUrl = null;
						}
					});
			} else {
				resumeLastLocation()
					.catch(() => {})
					.finally(() => {
						hasAttemptedRestore = true;
						if (pendingInitialUrl) {
							persistLastLocation(pendingInitialUrl);
							pendingInitialUrl = null;
						}
					});
			}
		} else {
			hasAttemptedRestore = true;
		}

		return () => {
			stopPresence?.();
			stopAuth?.();
			stopProfileListener?.();
			detachGestureGuards?.();
			detachSwipeGestures?.();
			stopDeepLinkListener?.();
		};
	});

	onDestroy(() => {
		stopVoice?.();
		domainInviteInboxStop?.();
		detachDomainInviteTestListener?.();
	});
</script>

<svelte:head>
	<!-- Default title for initial SSR + hydration -->
	<title>{APP_TITLE}</title>
	<!-- Optional: keep social/SEO cards consistent -->
	<meta property="og:title" content={APP_TITLE} />
	<meta name="twitter:title" content={APP_TITLE} />
</svelte:head>

<!-- Full-screen app surface -->
<div
	class="app-shell has-mobile-dock app-bg"
	class:has-mobile-dock--suppressed={$mobileDockSuppressed}
>
	<div class="app-shell__body">
		{@render children?.()}
	</div>

	<MobileNavBar />

	{#if settingsState.open}
		{#if mobileViewport}
			<SettingsMobileShell
				open={settingsState.open}
				activeSection={settingsState.activeSection}
				serverId={null}
				startInSection={settingsState.source === 'route'}
				on:close={handleSettingsClose}
				on:section={handleSettingsSection}
			/>
		{:else}
			<SettingsModal
				open={settingsState.open}
				activeSection={settingsState.activeSection}
				serverId={null}
				on:close={handleSettingsClose}
				on:section={handleSettingsSection}
			/>
		{/if}
	{/if}

	{#if serverSettingsState.open}
		{#if mobileViewport}
			<ServerSettingsMobileShell
				open={serverSettingsState.open}
				activeSection={serverSettingsState.activeSection}
				serverId={serverSettingsState.serverId}
				featureModal={serverSettingsState.featureModal}
				startInSection={serverSettingsState.source === 'route'}
				on:close={handleServerSettingsClose}
				on:section={handleServerSettingsSection}
			/>
		{:else}
			<ServerSettingsModal
				open={serverSettingsState.open}
				activeSection={serverSettingsState.activeSection}
				serverId={serverSettingsState.serverId}
				featureModal={serverSettingsState.featureModal}
				on:close={handleServerSettingsClose}
				on:section={handleServerSettingsSection}
			/>
		{/if}
	{/if}

	{#if activeVoice && !activeVoice.visible}
		<div class="voice-mini-fab pointer-events-none fixed inset-0 z-[9999]">
			<div
				class="pointer-events-auto absolute"
				style:bottom="calc(var(--mobile-dock-height, 0px) + 1rem)"
				style:left="50%"
				style:transform="translateX(-50%)"
			>
				<VoiceMiniPanel serverId={activeVoice.serverId} session={activeVoice} draggable={true} />
			</div>
		</div>
	{/if}

	<DomainInvitePrompt
		invite={domainInviteCandidate}
		busy={domainInviteBusy}
		error={domainInviteError}
		onAccept={acceptDomainInvite}
		onDecline={declineDomainInvite}
		onDismiss={dismissCurrentDomainInvite}
	/>
</div>
