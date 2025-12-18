<script lang="ts">
	import { run, stopPropagation } from 'svelte/legacy';

	import { createEventDispatcher, onDestroy, onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { get } from 'svelte/store';
	import { getDb } from '$lib/firebase';
	import { user, userProfile } from '$lib/stores/user';
	import {
		appendVoiceDebugEvent,
		removeVoiceDebugSection,
		setVoiceDebugSection,
		formatVoiceDebugContext
	} from '$lib/utils/voiceDebugContext';
	import { copyTextToClipboard } from '$lib/utils/clipboard';
	import { playSound } from '$lib/utils/sounds';
	import { resolveProfilePhotoURL } from '$lib/utils/profile';
	import { voiceSession } from '$lib/stores/voice';
	import type { VoiceSession } from '$lib/stores/voice';
	import { voiceActivity } from '$lib/stores/voiceActivity';
	import Avatar from '$lib/components/app/Avatar.svelte';
	import {
		loadVoicePreferences,
		voicePreferences,
		type VoicePreferences as UserVoicePreferences
	} from '$lib/stores/voicePreferences';
	import {
		resetVoiceClientState,
		setVoiceClientControls,
		updateVoiceClientState
	} from '$lib/stores/voiceClient';
	import { openSettings } from '$lib/stores/settingsUI';
	import MediaStage from '$lib/components/voice/MediaStage.svelte';
	const MediaStageAny = MediaStage as any;
	import {
		PUBLIC_ENABLE_TURN_FALLBACK,
		PUBLIC_TURN_URLS,
		PUBLIC_TURN_USERNAME,
		PUBLIC_TURN_CREDENTIAL
	} from '$env/static/public';
	import {
		addDoc,
		collection,
		deleteDoc,
		deleteField,
		doc,
		getDoc,
		getDocs,
		onSnapshot,
		runTransaction,
		serverTimestamp,
		setDoc,
		updateDoc,
		writeBatch,
		type CollectionReference,
		type DocumentReference,
		type Unsubscribe
	} from 'firebase/firestore';

	const CALL_DOC_ID = 'live';
	const CALL_DOC_SDP_RESET_THRESHOLD = 800_000;
	const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
	let serverId = $state<string | null>(null);
	let channelId = $state<string | null>(null);
	let sessionChannelName = $state('');
	let sessionServerName = $state('');
	let sessionVisible = $state(false);

	type ParticipantState = {
		uid: string;
		displayName: string;
		photoURL: string | null;
		authPhotoURL?: string | null;
		hasAudio: boolean;
		hasVideo: boolean;
		screenSharing?: boolean;
		status?: 'active' | 'left' | 'removed';
		joinedAt?: any;
		updatedAt?: any;
		streamId?: string | null;
		kickedBy?: string | null;
		removedAt?: any;
		renegotiationRequestId?: string | null;
		renegotiationRequestReason?: string | null;
		renegotiationRequestedAt?: any;
		renegotiationResolvedAt?: any;
	};

	type ParticipantMedia = {
		uid: string;
		isSelf: boolean;
		streamId: string | null;
		stream: MediaStream | null;
		hasAudio: boolean;
		hasVideo: boolean;
	};

	type ParticipantControls = {
		volume: number;
		muted: boolean;
	};

	type ParticipantTile = ParticipantMedia & {
		displayName: string;
		photoURL: string | null;
		controls: ParticipantControls;
		screenSharing: boolean;
		isSpeaking: boolean;
	};

	type TrackDiagnostics = {
		id: string;
		kind: string;
		readyState: MediaStreamTrackState;
		enabled: boolean;
		muted: boolean;
		label: string;
		width?: number | null;
		height?: number | null;
		frameRate?: number | null;
	};

	type TransceiverDiagnostics = {
		mid: string | null;
		currentDirection: RTCRtpTransceiverDirection | null;
		preferredDirection: RTCRtpTransceiverDirection | null;
		isStopped: boolean;
		senderTrack: TrackDiagnostics | null;
		receiverTrack: TrackDiagnostics | null;
	};

	type SenderDiagnostics = {
		track: TrackDiagnostics | null;
		streams: string[];
		transportState: string | null;
	};

	type ReceiverDiagnostics = {
		track: TrackDiagnostics | null;
		streams: string[];
	};

	type RemoteStreamDiagnostics = {
		id: string;
		audioTracks: TrackDiagnostics[];
		videoTracks: TrackDiagnostics[];
	};

	type PeerDiagnostics = {
		transceivers: TransceiverDiagnostics[];
		senders: SenderDiagnostics[];
		receivers: ReceiverDiagnostics[];
		remoteStreams: RemoteStreamDiagnostics[];
	};

	function pickString(value: unknown): string | undefined {
		if (typeof value !== 'string') return undefined;
		const trimmed = value.trim();
		return trimmed.length ? trimmed : undefined;
	}

	let localVideoEl = $state<HTMLVideoElement | null>(null);
	let localStream = $state<MediaStream | null>(null);

	let remoteStreams = $state(new Map<string, MediaStream>());
	let audioRefs = new Map<string, HTMLAudioElement>();
	let videoRefs = new Map<string, HTMLVideoElement>();
	let participantControls = $state(new Map<string, ParticipantControls>());
	let participantModeration = $state(
		new Map<string, { serverMuted: boolean; serverDeafened: boolean }>()
	);
	// Non-reactive getter so we can read/clean up without creating self-dependencies.
	const getParticipantModerationCache = () => participantModeration;
	let speakingLevels = $state(new Map<string, number>());
	let chatMessages = $state<{ id: string; text: string; ts: number; author: string }[]>([
		{ id: 'seed-1', text: 'Welcome to call chat. Say hi!', ts: Date.now(), author: 'System' }
	]);
	let chatDraft = $state('');
	let sideChatWidth = $state(360);
	let chatResizeActive = $state(false);
	let chatResizeStartX = 0;
	let chatResizeStartWidth = 360;
	let menuOpenFor = $state<string | null>(null);
	let volumeMenu: { uid: string; x: number; y: number } | null = $state(null);
	let longPressTimers = new Map<string, ReturnType<typeof setTimeout>>();
	let isTouchDevice = false;

	let serverMetaUnsub = $state<Unsubscribe | null>(null);
	let memberUnsub = $state<Unsubscribe | null>(null);
	let serverOwnerId = $state<string | null>(null);
	let myPerms = $state<Record<string, any> | null>(null);
	let watchedServerId = $state<string | null>(null);
	let watchedMemberKey = $state<string | null>(null);
	let canKickMembers = $state(false);

	let pc: RTCPeerConnection | null = $state(null);
	let audioSender: RTCRtpSender | null = null;
	let videoSender: RTCRtpSender | null = null;
	let audioTransceiverRef: RTCRtpTransceiver | null = null;
	let videoTransceiverRef: RTCRtpTransceiver | null = null;

	let callRef = $state<DocumentReference | null>(null);
	let offerCandidatesRef: CollectionReference | null = null;
	let answerCandidatesRef: CollectionReference | null = null;
	let localCandidatesRef: CollectionReference | null = null;
	let participantsCollectionRef: CollectionReference | null = null;
	let callDescriptionsRef: CollectionReference | null = null;
	let offerDescriptionRef: DocumentReference | null = null;
	let answerDescriptionRef: DocumentReference | null = null;

	let callUnsub: Unsubscribe | null = null;
	let offerCandidatesUnsub: Unsubscribe | null = null;
	let answerCandidatesUnsub: Unsubscribe | null = null;
	let participantsUnsub: Unsubscribe | null = null;
	let offerDescriptionUnsub: Unsubscribe | null = null;
	let answerDescriptionUnsub: Unsubscribe | null = null;

	let participantDocRef = $state<DocumentReference | null>(null);
	let myProfile: Record<string, any> | null = null;
	let myProfileUnsub: Unsubscribe | null = null;
	let latestOfferDescription: { revision: number; sdp: string; type: RTCSdpType } | null = null;
	let latestAnswerDescription: { revision: number; sdp: string; type: RTCSdpType } | null = null;
	let descriptionStorageEnabled = true;

	let participants = $state<ParticipantState[]>([]);
	let participantMedia = $state<ParticipantMedia[]>([]);
	let participantTiles = $state<ParticipantTile[]>([]);
	let speakingNow = $derived(new Set(speakingLevels.keys()));
	let session: VoiceSession | null = null;
	let activeSessionKey = $state<string | null>(null);
	let sessionQueue: Promise<void> = Promise.resolve();
	let voiceUnsubscribe: (() => void) | null = null;
	let peerDiagnostics = $state<PeerDiagnostics>({
		transceivers: [],
		senders: [],
		receivers: [],
		remoteStreams: []
	});
	let isJoined = $state(false);
	let isConnecting = $state(false);
	const initialVoicePrefs = loadVoicePreferences();
	let currentPrefs: UserVoicePreferences = initialVoicePrefs;
	let lastPrefs: UserVoicePreferences = initialVoicePrefs;
	let prefsStop = voicePreferences.subscribe((prefs) => {
		lastPrefs = currentPrefs;
		currentPrefs = prefs;
		applyPreferenceChanges(lastPrefs, currentPrefs);
	});
	let isMicMuted = $state(initialVoicePrefs.muteOnJoin);
	let isCameraOff = $state(initialVoicePrefs.videoOffOnJoin);
	let isMicToggling = $state(false);
	let isCameraToggling = $state(false);
	// Counter to force reactivity when track states change (since track.enabled doesn't trigger Svelte reactivity)
	let trackStateVersion = $state(0);
	let remoteConnected = $state(false);
	let screenStream: MediaStream | null = null;
	let isScreenSharing = $state(false);
	let isScreenSharePending = $state(false);
	let shouldRestoreCameraOnShareEnd = false;
	let audioNeedsUnlock = $state(false);
	let isPlaybackMuted = $state(false);
	let inactivityTimer: number | null = null;
	let inactivityHeartbeat: ReturnType<typeof setInterval> | null = null;
	let thumbnailInterval: ReturnType<typeof setInterval> | null = null;
	const THUMBNAIL_INTERVAL_MS = 2500; // Capture thumbnail every 2.5 seconds
	const THUMBNAIL_QUALITY = 0.55; // JPEG quality
	const THUMBNAIL_MAX_SIZE = 140; // Max width/height in pixels
	let voiceActivityUnsub: (() => void) | null = null;
	let visibilityUnsub: (() => void) | null = null;
	interface Props {
		layout?: 'standalone' | 'embedded';
		sidePanelOpen?: boolean;
		sidePanelTab?: 'chat' | 'members';
		stageOnly?: boolean;
		showChatToggle?: boolean;
	}

	let {
		layout = 'standalone',
		sidePanelOpen = false,
		sidePanelTab = 'chat',
		stageOnly = false,
		showChatToggle = true
	}: Props = $props();
	const UI_PREFS_STORAGE_KEY = 'hconnect:voice:ui-prefs';
	type VoiceUiPrefs = {
		gridMode: 'equal' | 'focus';
		showSelfInGrid: boolean;
	};
	let gridMode = $state<VoiceUiPrefs['gridMode']>('equal');
	let showSelfInGrid = $state(true);
	let lastActiveSpeaker = $state<string | null>(null);
	let controlsVisible = $state(true);
	let controlHideTimer: ReturnType<typeof setTimeout> | null = null;
	const CONTROL_HIDE_DELAY_MS = 2500;
	let callShellEl = $state<HTMLElement | null>(null);
	let callStageEl = $state<HTMLElement | null>(null);
	let isFullscreen = $state(false);
	let popoutMode = $state(false);
	let moreMenuOpen = $state(false);
	let selfPreviewEl = $state<HTMLVideoElement | null>(null);
	const showChrome = $derived(true);
	let compactMediaQuery: MediaQueryList | null = null;
	let compactMatch = $state(false);
	let isCompact = $state(false);
	let handleCompactChange: ((event: MediaQueryListEvent) => void) | null = null;
	let isRestartingCall = $state(false);
	let reconnectAttemptCount = 0;
	let signalingState = $state('closed');
	let connectionState = $state('new');
	let iceConnectionState = $state('new');
	let iceGatheringState = $state('new');
	let publishedCandidateCount = $state(0);
	let appliedCandidateCount = $state(0);

	// ICE restart debouncing and state tracking
	let iceRestartPending = false;
	let iceRestartTimer: ReturnType<typeof setTimeout> | null = null;
	let lastIceRestartTime = 0;
	const ICE_RESTART_DEBOUNCE_MS = 2000; // Minimum time between ICE restarts
	const ICE_RESTART_COOLDOWN_MS = 5000; // Cooldown after successful connection
	let connectionHealthCheckInterval: ReturnType<typeof setInterval> | null = null;
	const CONNECTION_HEALTH_CHECK_INTERVAL_MS = 5000; // Check connection health every 5 seconds
	let lastSuccessfulConnectionTime = 0;
	let consecutiveHealthCheckFailures = 0;
	const MAX_HEALTH_CHECK_FAILURES = 3;
	const MEDIA_RECOVERY_DELAY_MS = 6000;
	const MEDIA_RECOVERY_COOLDOWN_MS = 12000;
	const MAX_MEDIA_RECOVERY_ATTEMPTS = 2;
	let mediaRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
	let mediaRecoveryAttempts = 0;
	let lastMediaRecoveryAt = 0;

	function readUiPrefs(): VoiceUiPrefs {
		if (!browser) return { gridMode: 'equal', showSelfInGrid: true };
		try {
			const raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
			if (!raw) return { gridMode: 'equal', showSelfInGrid: true };
			const parsed = JSON.parse(raw);
			const gridMode = parsed?.gridMode === 'focus' ? 'focus' : 'equal';
			const showSelfInGrid = parsed?.showSelfInGrid !== false;
			return { gridMode, showSelfInGrid };
		} catch {
			return { gridMode: 'equal', showSelfInGrid: true };
		}
	}

	function persistUiPrefs(prefs: VoiceUiPrefs) {
		if (!browser) return;
		try {
			localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(prefs));
		} catch {
			/* ignore storage failures */
		}
	}

	run(() => {
		const prefs = readUiPrefs();
		gridMode = prefs.gridMode;
		showSelfInGrid = prefs.showSelfInGrid;
	});

	run(() => {
		persistUiPrefs({ gridMode, showSelfInGrid });
	});

	type AudioMonitor = {
		stream: MediaStream;
		source: MediaStreamAudioSourceNode;
		analyser: AnalyserNode;
		data: Uint8Array;
		raf: number | null;
		lastSpoke: number;
	};

	let audioContext: AudioContext | null = null;
	let audioMonitors = new Map<string, AudioMonitor>();
	type AudioPlaybackNode = {
		stream: MediaStream;
		source: MediaStreamAudioSourceNode;
		gain: GainNode;
	};
	let audioPlayback = new Map<string, AudioPlaybackNode>();
	let speakingParticipants = $state(new Set<string>());
	let permissionPreflight: Promise<void> | null = null;
	let permissionWarningShown = false;
	let callSnapshotDebug = $state('');
	type VoiceLogEntry = {
		id: string;
		timestamp: string;
		message: string;
		details?: string;
		severity: 'info' | 'warn' | 'error';
	};
	let voiceLogs: VoiceLogEntry[] = $state([]);
	let voiceLogSequence = 0;
	let voiceErrorCount = $state(0);
	let voiceWarnCount = $state(0);
	const remoteCandidateKeys = new Set<string>();
	type QueuedRemoteCandidate = {
		candidate: RTCIceCandidateInit & { candidate?: string | null; revision?: number };
		role: 'offerer' | 'answerer';
		fallback?: boolean;
		revision: number;
	};
	const pendingRemoteCandidateKeys = new Set<string>();
	let pendingRemoteIceCandidates: QueuedRemoteCandidate[] = [];
	const DEBUG_STORAGE_KEY = 'hconnect:voice:debug';
	const DEBUG_PANEL_STORAGE_KEY = 'hconnect:voice:debug-panel-open';
	const QUICK_STATS_STORAGE_KEY = 'hconnect:voice:debug.quickstats';
	const DEBUG_PANEL_DRAG_MARGIN = 12;
	let debugPanelVisible = $state(false);
	let hasDebugAlerts = $state(false);
	let mostRecentAlertId: string | null = null;
	let debugPanelPosition: { x: number; y: number } | null = $state(null);
	type DebugPanelDragState = {
		pointerId: number;
		offsetX: number;
		offsetY: number;
		width: number;
		height: number;
		handle: HTMLElement;
	};
	let debugPanelDrag: DebugPanelDragState | null = null;
	let isDebugPanelDragging = $state(false);
	let debugPanelDrawerEl: HTMLElement | null = $state(null);
	const dispatch = createEventDispatcher<{
		openMobileChat: void;
		toggleSideChat: void;
		toggleSideMembers: void;
		openChannelChat: void;
	}>();

	const DEFAULT_STUN_SERVERS = [
		'stun:stun.l.google.com:19302',
		'stun:stun1.l.google.com:19302',
		'stun:stun2.l.google.com:19302',
		'stun:stun3.l.google.com:19302'
	];
	const FALLBACK_TURN_SERVER = {
		urls: [
			'turn:openrelay.metered.ca:80',
			'turn:openrelay.metered.ca:443',
			'turn:openrelay.metered.ca:3478'
		],
		username: 'openrelayproject',
		credential: 'openrelayproject'
	} as const;

	function parseBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
		if (value === undefined) return defaultValue;
		const normalized = value.trim().toLowerCase();
		if (!normalized) return defaultValue;
		if (['0', 'false', 'off', 'no', 'disabled'].includes(normalized)) return false;
		if (['1', 'true', 'on', 'yes', 'enabled'].includes(normalized)) return true;
		return defaultValue;
	}

	const allowTurnFallback = parseBooleanFlag(PUBLIC_ENABLE_TURN_FALLBACK, true);
	let fallbackTurnActivated = $state(false);
	let fallbackTurnActivationReason: string | null = null;
	let hasTurnServers = false;
	let usingFallbackTurnServers = $state(false);
	let forceRelayIceTransport = $state(false);
	let consecutiveIceErrors = 0;
	let connectionFailureCount = 0;
	let lastIceErrorTimestamp = 0;
	let lastTurnConfigSignature: string | null = null;
	let debugLoggingEnabled = $state(false);
	let isOfferer = $state(false);
	let lastOfferRevision = 0;
	let lastAnswerRevision = 0;
	let negotiationInFlight: Promise<void> | null = null;
	let renegotiationTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingRenegotiationReasons: string[] = [];
	const RENEGOTIATION_DEBOUNCE_MS = 250;
	let renegotiationAwaitingStable = false;
	let renegotiationNeedsPromotion = false;
	let processedRenegotiationSignals = new Map<string, string>();
	let lastRenegotiationSignalId: string | null = null;
	let renegotiationSignalClearTimer: ReturnType<typeof setTimeout> | null = null;
	let consumedOfferCandidateIds = new Set<string>();
	let consumedAnswerCandidateIds = new Set<string>();
	let activeCandidateRevision = 0;
	const MAX_REMOTE_ICE_LOGS = 25;
	let remoteIceLogCountOfferer = 0;
	let remoteIceLogCountAnswerer = 0;
	function flushRenegotiationQueue() {
		if (!pc || !callRef) {
			voiceDebug('flushRenegotiationQueue skipped (missing pc or call)');
			return;
		}
		if (negotiationInFlight) {
			voiceDebug('flushRenegotiationQueue skipped (negotiation in flight)');
			return;
		}
		if (pc.signalingState !== 'stable') {
			renegotiationAwaitingStable = true;
			voiceDebug('flushRenegotiationQueue deferred (signaling not stable)', pc.signalingState);
			return;
		}
		if (renegotiationNeedsPromotion && !isOfferer) {
			voiceDebug('flushRenegotiationQueue promoting to offerer', {
				lastOfferRevision,
				lastAnswerRevision,
				pendingReasons: [...pendingRenegotiationReasons]
			});
			isOfferer = true;
			setActiveOfferRevision(
				Math.max(lastOfferRevision, lastAnswerRevision),
				'renegotiation-promote'
			);
			attachOffererIceHandlers(pc);
		}
		renegotiationNeedsPromotion = false;
		if (!pendingRenegotiationReasons.length) {
			voiceDebug('flushRenegotiationQueue no pending reasons, aborting');
			return;
		}
		const reasons = [...pendingRenegotiationReasons];
		pendingRenegotiationReasons = [];
		voiceDebug('flushRenegotiationQueue triggering renegotiation', { reasons });
		performRenegotiation(reasons).catch((err) => {
			console.warn('Failed to execute pending renegotiation', err);
			voiceDebug('Failed to execute pending renegotiation', err);
		});
	}

	function toDisplayString(value: unknown): string {
		if (typeof value === 'string') return value;
		if (value instanceof Error) {
			const message = value.message ?? value.name ?? 'Error';
			return value.stack ? `${message}\n${value.stack}` : message;
		}
		if (value === null || value === undefined) {
			return String(value);
		}
		if (Array.isArray(value)) {
			try {
				return JSON.stringify(value, null, 2);
			} catch {
				return value.map((entry) => String(entry)).join(', ');
			}
		}
		if (typeof value === 'object') {
			try {
				return JSON.stringify(
					value,
					(_key, val) => {
						if (val && typeof val === 'object') {
							if (
								typeof (val as any).toDate === 'function' &&
								typeof (val as any).seconds === 'number'
							) {
								const ts = val as { seconds: number; nanoseconds: number; toDate: () => Date };
								return {
									seconds: ts.seconds,
									nanoseconds: ts.nanoseconds,
									iso: ts.toDate().toISOString()
								};
							}
						}
						return val;
					},
					2
				);
			} catch {
				return Object.prototype.toString.call(value);
			}
		}
		return String(value);
	}

	function classifyVoiceLogSeverity(message: string, details?: string): 'info' | 'warn' | 'error' {
		const combined = `${message} ${details ?? ''}`.toLowerCase();
		if (/\b(error|fail|failed|denied|timeout|unreachable|disconnected|critical)\b/.test(combined)) {
			return 'error';
		}
		if (/\b(warn|warning|retry|reconnect|unstable|degraded)\b/.test(combined)) {
			return 'warn';
		}
		return 'info';
	}

	function updateVoiceLogCounters(entries: VoiceLogEntry[]) {
		let errors = 0;
		let warnings = 0;
		for (const entry of entries) {
			if (entry.severity === 'error') {
				errors += 1;
			} else if (entry.severity === 'warn') {
				warnings += 1;
			}
		}
		voiceErrorCount = errors;
		voiceWarnCount = warnings;
	}

	function recordVoiceLog(message: unknown, details?: unknown) {
		const timestamp = new Date().toLocaleTimeString();
		const entryMessage = toDisplayString(message);
		let entryDetails: string | undefined;
		if (details !== undefined) {
			entryDetails = toDisplayString(details);
		}
		const id = `${Date.now()}-${voiceLogSequence++}`;
		const severity = classifyVoiceLogSeverity(entryMessage, entryDetails);
		const nextLogs = [
			{ id, timestamp, message: entryMessage, details: entryDetails, severity },
			...voiceLogs
		].slice(0, 250);
		voiceLogs = nextLogs;
		updateVoiceLogCounters(nextLogs);
		appendVoiceDebugEvent('video-call', entryMessage, entryDetails, severity);
		if (!debugPanelVisible && severity !== 'info' && mostRecentAlertId !== id) {
			mostRecentAlertId = id;
			hasDebugAlerts = true;
		} else if (debugPanelVisible) {
			mostRecentAlertId = id;
			hasDebugAlerts = false;
		}
	}

	function voiceDebug(...args: unknown[]) {
		if (args.length > 0) {
			const [message, ...rest] = args;
			const details = rest.length === 0 ? undefined : rest.length === 1 ? rest[0] : rest;
			recordVoiceLog(message, details);
		}
		if (!debugLoggingEnabled) return;
		console.log('[voice]', ...args);
	}

	function acknowledgeDebugAlerts() {
		hasDebugAlerts = false;
	}

	function clampDebugPanelPosition(x: number, y: number, width: number, height: number) {
		if (!browser) return { x, y };
		const margin = DEBUG_PANEL_DRAG_MARGIN;
		const maxX = Math.max(margin, window.innerWidth - width - margin);
		const maxY = Math.max(margin, window.innerHeight - height - margin);
		return {
			x: Math.min(Math.max(margin, x), maxX),
			y: Math.min(Math.max(margin, y), maxY)
		};
	}

	function stopDebugPanelDrag(applyClamp = true) {
		if (!debugPanelDrag) return;
		if (browser) {
			window.removeEventListener('pointermove', handleDebugPanelPointerMove);
			window.removeEventListener('pointerup', handleDebugPanelPointerEnd);
			window.removeEventListener('pointercancel', handleDebugPanelPointerEnd);
		}
		const { handle, pointerId } = debugPanelDrag;
		if (handle && handle.hasPointerCapture(pointerId)) {
			try {
				handle.releasePointerCapture(pointerId);
			} catch {
				/* ignore release errors */
			}
		}
		debugPanelDrag = null;
		isDebugPanelDragging = false;
		if (applyClamp && debugPanelPosition && debugPanelDrawerEl) {
			const rect = debugPanelDrawerEl.getBoundingClientRect();
			debugPanelPosition = clampDebugPanelPosition(
				debugPanelPosition.x,
				debugPanelPosition.y,
				rect.width,
				rect.height
			);
		}
	}

	function openMobileChatPanel() {
		dispatch('openMobileChat');
	}

	function cancelDebugPanelDrag() {
		if (!debugPanelDrag) return;
		stopDebugPanelDrag();
	}

	function handleDebugPanelPointerDown(event: PointerEvent) {
		if (!browser || !debugPanelVisible) return;
		if (!event.isPrimary || event.button !== 0) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('button, a, input, textarea, select, [data-debug-panel-no-drag]')) {
			return;
		}
		if (!debugPanelDrawerEl) return;
		if (debugPanelDrag) {
			stopDebugPanelDrag(false);
		}
		const rect = debugPanelDrawerEl.getBoundingClientRect();
		const handle = event.currentTarget as HTMLElement;
		debugPanelDrag = {
			pointerId: event.pointerId,
			offsetX: event.clientX - rect.left,
			offsetY: event.clientY - rect.top,
			width: rect.width,
			height: rect.height,
			handle
		};
		debugPanelPosition = clampDebugPanelPosition(rect.left, rect.top, rect.width, rect.height);
		isDebugPanelDragging = true;
		try {
			handle.setPointerCapture(event.pointerId);
		} catch {
			/* ignore pointer capture failures */
		}
		window.addEventListener('pointermove', handleDebugPanelPointerMove);
		window.addEventListener('pointerup', handleDebugPanelPointerEnd);
		window.addEventListener('pointercancel', handleDebugPanelPointerEnd);
		event.preventDefault();
		event.stopPropagation();
	}

	function handleDebugPanelPointerMove(event: PointerEvent) {
		if (!browser || !debugPanelDrag || event.pointerId !== debugPanelDrag.pointerId) return;
		const { offsetX, offsetY, width, height } = debugPanelDrag;
		const nextX = event.clientX - offsetX;
		const nextY = event.clientY - offsetY;
		debugPanelPosition = clampDebugPanelPosition(nextX, nextY, width, height);
		event.preventDefault();
	}

	function handleDebugPanelPointerEnd(event: PointerEvent) {
		if (!debugPanelDrag || event.pointerId !== debugPanelDrag.pointerId) return;
		stopDebugPanelDrag();
		event.preventDefault();
	}

	function setDebugPanelVisibility(open: boolean) {
		debugPanelVisible = open;
		if (open) {
			acknowledgeDebugAlerts();
			if (debugPanelPosition && debugPanelDrawerEl) {
				const rect = debugPanelDrawerEl.getBoundingClientRect();
				debugPanelPosition = clampDebugPanelPosition(
					debugPanelPosition.x,
					debugPanelPosition.y,
					rect.width,
					rect.height
				);
			}
		} else {
			cancelDebugPanelDrag();
		}
		voiceDebug('Debug panel visibility', { open });
		if (!browser || typeof localStorage === 'undefined') return;
		try {
			if (open) {
				localStorage.setItem(DEBUG_PANEL_STORAGE_KEY, '1');
			} else {
				localStorage.removeItem(DEBUG_PANEL_STORAGE_KEY);
			}
		} catch {
			/* ignore storage errors */
		}
	}

	function toggleDebugPanel(force?: boolean) {
		const desired = typeof force === 'boolean' ? force : !debugPanelVisible;
		setDebugPanelVisibility(desired);
	}

	function logRemoteCandidate(
		role: 'offerer' | 'answerer',
		info: ReturnType<typeof describeIceCandidate>,
		options: { fallback?: boolean } = {}
	) {
		const { fallback = false } = options;
		const count = role === 'offerer' ? remoteIceLogCountOfferer : remoteIceLogCountAnswerer;
		const label = fallback
			? 'Consuming remote ICE candidate (fallback)'
			: 'Consuming remote ICE candidate';
		if (count < MAX_REMOTE_ICE_LOGS) {
			voiceDebug(label, { role, ...info });
		} else if (count === MAX_REMOTE_ICE_LOGS) {
			voiceDebug(`${label} (muted additional logs)`, { role });
		}
		if (role === 'offerer') {
			remoteIceLogCountOfferer += 1;
		} else {
			remoteIceLogCountAnswerer += 1;
		}
	}

	function setVoiceDebug(enabled: boolean) {
		debugLoggingEnabled = enabled;
		if (!enabled) {
			setDebugPanelVisibility(false);
			hasDebugAlerts = false;
		}
		if (!browser || typeof localStorage === 'undefined') return;
		if (enabled) {
			localStorage.setItem(DEBUG_STORAGE_KEY, '1');
		} else {
			localStorage.removeItem(DEBUG_STORAGE_KEY);
		}
	}

	function buildIceServers(): RTCIceServer[] {
		const servers: RTCIceServer[] = [
			{ urls: DEFAULT_STUN_SERVERS.slice(0, 2) },
			{ urls: DEFAULT_STUN_SERVERS.slice(2) }
		];
		const rawTurnUrls = PUBLIC_TURN_URLS ?? '';
		const configuredTurn =
			rawTurnUrls
				.split(',')
				.map((value) => value.trim())
				.filter(Boolean) ?? [];
		let turnServer: RTCIceServer | null = null;
		let turnState: 'configured' | 'fallback' | 'none' = 'none';
		if (!configuredTurn.length) {
			if (rawTurnUrls.trim().length) {
				voiceDebug('TURN configuration ignored (no valid URLs parsed)', {
					raw: rawTurnUrls
				});
			}
		} else {
			turnServer = { urls: configuredTurn };
			const turnUsername = PUBLIC_TURN_USERNAME ?? '';
			const turnCredential = PUBLIC_TURN_CREDENTIAL ?? '';
			if (turnUsername) {
				turnServer.username = turnUsername;
			}
			if (turnCredential) {
				turnServer.credential = turnCredential;
			}
			turnState = 'configured';
		}
		if (!turnServer && allowTurnFallback && fallbackTurnActivated) {
			turnServer = {
				urls: [...FALLBACK_TURN_SERVER.urls],
				username: FALLBACK_TURN_SERVER.username,
				credential: FALLBACK_TURN_SERVER.credential
			};
			turnState = 'fallback';
		}
		hasTurnServers = !!turnServer;
		usingFallbackTurnServers = turnState === 'fallback';
		if (!hasTurnServers) {
			usingFallbackTurnServers = false;
			forceRelayIceTransport = false;
		}
		if (turnServer) {
			servers.push(turnServer);
		}
		const signature = JSON.stringify({
			turnState,
			urls: servers.map((entry) => entry.urls)
		});
		if (lastTurnConfigSignature !== signature) {
			if (turnState === 'configured' && turnServer) {
				const urls = Array.isArray(turnServer.urls)
					? turnServer.urls
					: turnServer.urls
						? [turnServer.urls]
						: [];
				voiceDebug('TURN servers configured', {
					urls,
					hasAuth: !!(turnServer.username || turnServer.credential)
				});
			} else if (turnState === 'fallback') {
				voiceDebug('Fallback TURN relay enabled', {
					provider: 'openrelay.metered.ca',
					allowTurnFallback,
					reason: fallbackTurnActivationReason ?? 'stun-host-error'
				});
			} else if (!configuredTurn.length) {
				voiceDebug('TURN servers not configured; relying on STUN only');
			}
			lastTurnConfigSignature = signature;
		}
		return servers;
	}

	function describeIceCandidate(raw: string | undefined | null) {
		if (!raw) {
			return {
				candidateType: 'none',
				protocol: '',
				address: '',
				port: '',
				raw: raw ?? ''
			};
		}
		const parts = raw.split(' ');
		const find = (label: string) => {
			const idx = parts.indexOf(label);
			return idx >= 0 ? (parts[idx + 1] ?? '') : '';
		};
		return {
			candidateType: find('typ') || 'unknown',
			protocol: parts[2] ?? '',
			address: parts[4] ?? '',
			port: parts[5] ?? '',
			raw
		};
	}

	function extractMediaSections(sdp: string): string[] {
		return sdp
			.split(/\r?\n/)
			.filter((line) => line.startsWith('m='))
			.map((line) => line.trim());
	}

	function summarizeParticipantsForDebug(
		source: ParticipantState[]
	): Array<Record<string, unknown>> {
		return source.map((participant) => ({
			uid: participant.uid,
			status: participant.status ?? 'active',
			hasAudio: participant.hasAudio ?? false,
			hasVideo: participant.hasVideo ?? false,
			screenSharing: participant.screenSharing ?? false,
			streamId: participant.streamId ?? null
		}));
	}

	function describeStreamTracks(stream: MediaStream): Record<string, unknown> {
		const describeTrack = (track: MediaStreamTrack) => ({
			id: track.id,
			kind: track.kind,
			muted: track.muted,
			enabled: track.enabled,
			readyState: track.readyState,
			label: track.label
		});
		return {
			id: stream.id,
			audioTracks: stream.getAudioTracks().map(describeTrack),
			videoTracks: stream.getVideoTracks().map(describeTrack)
		};
	}

	function summarizeRemoteStreamsForDebug(
		streamMap: Map<string, MediaStream>
	): Array<Record<string, unknown>> {
		return Array.from(streamMap.entries()).map(([id, stream]) => {
			const summary = describeStreamTracks(stream);
			return { streamKey: id, ...summary };
		});
	}

	function summarizeLocalStreamForDebug(
		stream: MediaStream | null
	): Record<string, unknown> | null {
		if (!stream) return null;
		const summary = describeStreamTracks(stream);
		return summary;
	}

	type PeerConnectionStatsSnapshot = {
		inboundAudio: Array<Record<string, unknown>>;
		outboundAudio: Array<Record<string, unknown>>;
		inboundVideo: Array<Record<string, unknown>>;
		outboundVideo: Array<Record<string, unknown>>;
		candidatePairs: Array<Record<string, unknown>>;
		transports: Array<Record<string, unknown>>;
	};

	async function collectPeerConnectionStatsSnapshot(
		connection: RTCPeerConnection
	): Promise<PeerConnectionStatsSnapshot | null> {
		if (!connection || typeof connection.getStats !== 'function') return null;
		try {
			const report = await connection.getStats();
			const snapshot: PeerConnectionStatsSnapshot = {
				inboundAudio: [],
				outboundAudio: [],
				inboundVideo: [],
				outboundVideo: [],
				candidatePairs: [],
				transports: []
			};

			const inboundFields = [
				'trackIdentifier',
				'mid',
				'kind',
				'ssrc',
				'packetsReceived',
				'packetsLost',
				'bytesReceived',
				'jitter',
				'jitterBufferDelay',
				'jitterBufferEmittedCount',
				'totalSamplesReceived',
				'totalSamplesDuration',
				'totalAudioEnergy',
				'audioLevel',
				'framesDecoded',
				'frameWidth',
				'frameHeight',
				'framesPerSecond',
				'lastPacketReceivedTimestamp'
			];
			const outboundFields = [
				'trackIdentifier',
				'mid',
				'kind',
				'ssrc',
				'packetsSent',
				'packetsLost',
				'bytesSent',
				'framesEncoded',
				'frameWidth',
				'frameHeight',
				'framesPerSecond',
				'qualityLimitationReason',
				'totalEncodeTime',
				'nackCount',
				'pliCount',
				'firCount',
				'roundTripTime',
				'totalRoundTripTime',
				'retransmittedPacketsSent'
			];
			const candidatePairFields = [
				'state',
				'nominated',
				'writable',
				'readable',
				'currentRoundTripTime',
				'availableOutgoingBitrate',
				'availableIncomingBitrate',
				'requestsReceived',
				'requestsSent',
				'responsesReceived',
				'responsesSent',
				'consentRequestsSent',
				'bytesSent',
				'bytesReceived',
				'totalRoundTripTime',
				'priority',
				'localCandidateId',
				'remoteCandidateId'
			];
			const transportFields = [
				'dtlsState',
				'selectedCandidatePairId',
				'bytesSent',
				'bytesReceived',
				'packetsSent',
				'packetsReceived',
				'iceRole',
				'iceState',
				'dtlsCipher',
				'srtpCipher'
			];

			const pick = (source: Record<string, any>, fields: string[]) => {
				const result: Record<string, unknown> = {};
				for (const field of fields) {
					const value = source[field];
					result[field] = value === undefined ? null : value;
				}
				return result;
			};

			report.forEach((stat) => {
				const anyStat = stat as any;
				switch (stat.type) {
					case 'inbound-rtp': {
						const summary = {
							id: anyStat.id ?? null,
							timestamp: anyStat.timestamp ?? null,
							...pick(anyStat, inboundFields)
						};
						if (anyStat.kind === 'audio') {
							snapshot.inboundAudio.push(summary);
						} else if (anyStat.kind === 'video') {
							snapshot.inboundVideo.push(summary);
						}
						break;
					}
					case 'outbound-rtp': {
						const summary = {
							id: anyStat.id ?? null,
							timestamp: anyStat.timestamp ?? null,
							...pick(anyStat, outboundFields)
						};
						if (anyStat.kind === 'audio') {
							snapshot.outboundAudio.push(summary);
						} else if (anyStat.kind === 'video') {
							snapshot.outboundVideo.push(summary);
						}
						break;
					}
					case 'candidate-pair': {
						const summary = {
							id: anyStat.id ?? null,
							timestamp: anyStat.timestamp ?? null,
							...pick(anyStat, candidatePairFields)
						};
						snapshot.candidatePairs.push(summary);
						break;
					}
					case 'transport': {
						const summary = {
							id: anyStat.id ?? null,
							timestamp: anyStat.timestamp ?? null,
							...pick(anyStat, transportFields)
						};
						snapshot.transports.push(summary);
						break;
					}
					default:
						break;
				}
			});

			return snapshot;
		} catch (err) {
			voiceDebug('collectPeerConnectionStatsSnapshot failed', err);
			appendVoiceDebugEvent('video-call', 'collectPeerConnectionStatsSnapshot failure', {
				error: err instanceof Error ? err.message : String(err)
			});
			return null;
		}
	}

	function describeTransceiverOrder(connection: RTCPeerConnection | null) {
		if (!connection || typeof connection.getTransceivers !== 'function') return [];
		return connection
			.getTransceivers()
			.map((trx, index) => {
				const trxAny = trx as any;
				return {
					index,
					mid: trx.mid ?? null,
					direction: trx.direction ?? null,
					currentDirection: trxAny?.currentDirection ?? null,
					senderKind: trx.sender?.track?.kind ?? null,
					receiverKind: trx.receiver?.track?.kind ?? null,
					stopped: trxAny?.stopped ?? false
				};
			})
			.filter(Boolean);
	}

	async function collectVoiceDebugBundle(
		options: { includeLogs?: number; includeEvents?: number } = {}
	): Promise<string> {
		const now = new Date();
		const currentUser = get(user);
		const maxLogs = options.includeLogs ?? 20;
		const logs = voiceLogs.slice(0, maxLogs);
		const transceiverSnapshot = describeTransceiverOrder(pc);
		const senderSnapshot =
			pc?.getSenders?.().map((sender) => {
				const senderAny = sender as any;
				const streams = Array.isArray(senderAny?.streams)
					? senderAny.streams.map((stream: MediaStream) => stream.id)
					: [];
				return {
					trackKind: sender.track?.kind ?? null,
					streams,
					transportState: (sender as any)?.transport?.state ?? null
				};
			}) ?? [];
		const localStreamSummary = summarizeLocalStreamForDebug(localStream);
		const remoteStreamSummary = summarizeRemoteStreamsForDebug(remoteStreams);
		let statsSnapshot: PeerConnectionStatsSnapshot | null = null;
		if (pc && typeof pc.getStats === 'function') {
			statsSnapshot = await collectPeerConnectionStatsSnapshot(pc);
		}
		if (statsSnapshot) {
			setVoiceDebugSection('call.stats', statsSnapshot);
		} else {
			removeVoiceDebugSection('call.stats');
		}
		setVoiceDebugSection('call.lastBundle', {
			capturedAt: now.toISOString(),
			includeLogs: maxLogs,
			includeEvents: options.includeEvents ?? null,
			hasStats: !!statsSnapshot
		});
		appendVoiceDebugEvent('video-call', 'collectVoiceDebugBundle snapshot', {
			includeLogs: maxLogs,
			includeEvents: options.includeEvents ?? null,
			hasStats: !!statsSnapshot
		});

		const lines: string[] = [
			'=== hConnect Voice Debug ===',
			`captured_at: ${now.toISOString()}`,
			`user: ${currentUser?.uid ?? 'unknown'} (${currentUser?.email ?? 'n/a'})`,
			`session: server=${serverId ?? 'n/a'} channel=${channelId ?? 'n/a'}`,
			`call_ref: ${callRef?.path ?? 'none'}`,
			`role: ${isJoined ? (isOfferer ? 'offerer' : 'answerer') : 'idle'}`,
			`connection: signaling=${signalingState} connection=${connectionState} ice_connection=${iceConnectionState} ice_gathering=${iceGatheringState}`,
			`ice_strategy: has_turn=${hasTurnServers} fallback_turn=${fallbackTurnActivated} using_fallback=${usingFallbackTurnServers} force_relay=${forceRelayIceTransport}`,
			`renegotiation: pending=${JSON.stringify(pendingRenegotiationReasons)} awaiting_stable=${renegotiationAwaitingStable} needs_promotion=${renegotiationNeedsPromotion}`,
			`revisions: offer=${lastOfferRevision} answer=${lastAnswerRevision}`,
			`participants: ${JSON.stringify(summarizeParticipantsForDebug(participants), null, 2)}`,
			`local_stream: ${JSON.stringify(localStreamSummary, null, 2)}`,
			`transceivers: ${JSON.stringify(transceiverSnapshot, null, 2)}`,
			`senders: ${JSON.stringify(senderSnapshot, null, 2)}`,
			`remote_streams: ${JSON.stringify(remoteStreamSummary, null, 2)}`,
			`status_message: ${statusMessage || 'n/a'}`,
			`error_message: ${errorMessage || 'n/a'}`,
			'',
			'recent_logs:'
		];

		if (!logs.length) {
			lines.push('  (none)');
		} else {
			for (const entry of logs) {
				const payload = entry.details ? ` | ${entry.details}` : '';
				lines.push(
					`  - [${entry.timestamp}] ${entry.severity.toUpperCase()} ${entry.message}${payload}`
				);
			}
		}

		if (statsSnapshot) {
			lines.push('', 'webrtc_stats:');
			lines.push(`  inbound_audio: ${JSON.stringify(statsSnapshot.inboundAudio, null, 2)}`);
			lines.push(`  outbound_audio: ${JSON.stringify(statsSnapshot.outboundAudio, null, 2)}`);
			lines.push(`  inbound_video: ${JSON.stringify(statsSnapshot.inboundVideo, null, 2)}`);
			lines.push(`  outbound_video: ${JSON.stringify(statsSnapshot.outboundVideo, null, 2)}`);
			lines.push(`  candidate_pairs: ${JSON.stringify(statsSnapshot.candidatePairs, null, 2)}`);
			lines.push(`  transports: ${JSON.stringify(statsSnapshot.transports, null, 2)}`);
		} else {
			lines.push('', 'webrtc_stats:', '  (unavailable)');
		}

		lines.push('', formatVoiceDebugContext({ maxEvents: options.includeEvents ?? 60 }));

		return lines.join('\n');
	}

	async function copyVoiceDebugBundle(
		options: { includeLogs?: number; includeEvents?: number } = {}
	): Promise<{
		status: 'copied' | 'logged' | 'failed';
		length: number;
		includeLogs: number;
		includeEvents: number;
		lineCount: number;
		logCountCaptured: number;
		durationMs: number;
	}> {
		const includeLogs = options.includeLogs ?? 20;
		const includeEvents = options.includeEvents ?? 60;
		const startedAt = now();
		appendVoiceDebugEvent('video-call', 'copyVoiceDebugBundle requested', {
			includeLogs,
			includeEvents
		});
		const bundle = await collectVoiceDebugBundle({ includeLogs, includeEvents });
		const lineCount = bundle.split('\n').length;
		const logCountCaptured = Math.min(voiceLogs.length, includeLogs);

		try {
			const copyResult = await copyTextToClipboard(bundle);
			const durationMs = Math.round(now() - startedAt);

			if (copyResult.success) {
				statusMessage = 'Debug info copied to clipboard.';
				appendVoiceDebugEvent('video-call', 'copyVoiceDebugBundle success', {
					includeLogs,
					includeEvents,
					bundleLength: bundle.length,
					lineCount,
					logCountCaptured,
					durationMs,
					method: copyResult.method
				});
				return {
					status: 'copied',
					length: bundle.length,
					includeLogs,
					includeEvents,
					lineCount,
					logCountCaptured,
					durationMs
				};
			}

			if (copyResult.reason === 'unsupported') {
				console.info('[voice] debug bundle\n', bundle);
				statusMessage = 'Clipboard unavailable; bundle logged to console.';
				appendVoiceDebugEvent('video-call', 'copyVoiceDebugBundle fallback', {
					reason: 'clipboard-unavailable',
					includeLogs,
					includeEvents,
					bundleLength: bundle.length,
					lineCount,
					logCountCaptured,
					durationMs,
					error: copyResult.error ?? null
				});
				return {
					status: 'logged',
					length: bundle.length,
					includeLogs,
					includeEvents,
					lineCount,
					logCountCaptured,
					durationMs
				};
			}

			console.warn('Failed to copy debug bundle', copyResult.error);
			statusMessage = 'Unable to copy debug info; check console output.';
			console.info('[voice] debug bundle\n', bundle);
			appendVoiceDebugEvent('video-call', 'copyVoiceDebugBundle failure', {
				includeLogs,
				includeEvents,
				bundleLength: bundle.length,
				lineCount,
				logCountCaptured,
				durationMs,
				error: copyResult.error ?? 'unknown-error'
			});
			return {
				status: 'failed',
				length: bundle.length,
				includeLogs,
				includeEvents,
				lineCount,
				logCountCaptured,
				durationMs
			};
		} catch (err) {
			console.warn('Failed to copy debug bundle', err);
			statusMessage = 'Unable to copy debug info; check console output.';
			console.info('[voice] debug bundle\n', bundle);
			const durationMs = Math.round(now() - startedAt);
			appendVoiceDebugEvent('video-call', 'copyVoiceDebugBundle failure', {
				includeLogs,
				includeEvents,
				bundleLength: bundle.length,
				lineCount,
				logCountCaptured,
				durationMs,
				error: err instanceof Error ? err.message : String(err)
			});
			return {
				status: 'failed',
				length: bundle.length,
				includeLogs,
				includeEvents,
				lineCount,
				logCountCaptured,
				durationMs
			};
		}
	}

	function resetPeerDiagnostics() {
		signalingState = 'closed';
		connectionState = 'new';
		iceConnectionState = 'new';
		iceGatheringState = 'new';
		publishedCandidateCount = 0;
		appliedCandidateCount = 0;
		remoteCandidateKeys.clear();
		clearPendingRemoteCandidates();
		peerDiagnostics = {
			transceivers: [],
			senders: [],
			receivers: [],
			remoteStreams: []
		};
	}

	function remoteCandidateKey(candidate: RTCIceCandidateInit & { candidate?: string | null }) {
		return `${candidate.sdpMid ?? ''}|${candidate.sdpMLineIndex ?? ''}|${candidate.candidate ?? ''}`;
	}

	function candidateRevisionValue(candidateData: { revision?: number | null }) {
		return typeof candidateData.revision === 'number' ? candidateData.revision : 0;
	}

	function setCandidateRefsForRevision(revision: number, reason: string) {
		if (!callRef || revision <= 0) {
			if (activeCandidateRevision !== 0) {
				voiceDebug('Clearing candidate references (no active revision)', {
					revision,
					reason
				});
			}
			activeCandidateRevision = 0;
			offerCandidatesRef = null;
			answerCandidatesRef = null;
			return;
		}
		const revisionRef = doc(callRef, 'revisions', String(revision));
		offerCandidatesRef = collection(revisionRef, 'offerCandidates');
		answerCandidatesRef = collection(revisionRef, 'answerCandidates');
		if (activeCandidateRevision !== revision) {
			voiceDebug('Active candidate revision updated', {
				from: activeCandidateRevision,
				to: revision,
				reason
			});
		}
		activeCandidateRevision = revision;
	}

	function resetCandidateState(reason: string) {
		clearPendingRemoteCandidates();
		remoteCandidateKeys.clear();
		consumedOfferCandidateIds.clear();
		consumedAnswerCandidateIds.clear();
		voiceDebug('Candidate state reset', {
			reason,
			activeRevision: lastOfferRevision
		});
	}

	function setActiveOfferRevision(
		revision: number,
		reason: string,
		options: { resetCandidates?: boolean } = {}
	) {
		const { resetCandidates = true } = options;
		const previous = lastOfferRevision;
		lastOfferRevision = revision;
		if (previous !== revision) {
			voiceDebug('Active offer revision updated', { from: previous, to: revision, reason });
		}
		setCandidateRefsForRevision(revision, reason);
		if (resetCandidates) {
			resetCandidateState(`offer-revision:${reason}`);
		}
	}

	function updatePeerConnectionStateSnapshot(connection: RTCPeerConnection | null = pc) {
		if (!connection) {
			resetPeerDiagnostics();
			capturePeerDiagnostics(null, 'state-snapshot');
			return;
		}
		signalingState = connection.signalingState ?? 'closed';
		connectionState = connection.connectionState ?? 'new';
		iceConnectionState = connection.iceConnectionState ?? 'new';
		iceGatheringState = connection.iceGatheringState ?? 'new';
		capturePeerDiagnostics(connection, 'state-snapshot');
	}

	const SPEAKING_THRESHOLD = 13;
	const SPEAKING_FALLOFF_MS = 240;

	function getAudioContextCtor(): typeof AudioContext | null {
		if (!browser || typeof window === 'undefined') return null;
		const maybeWindow = window as unknown as {
			AudioContext?: typeof AudioContext;
			webkitAudioContext?: typeof AudioContext;
		};
		return maybeWindow.AudioContext ?? maybeWindow.webkitAudioContext ?? null;
	}

	function ensureAudioContext(): AudioContext | null {
		if (audioContext) return audioContext;
		const Ctor = getAudioContextCtor();
		if (!Ctor) return null;
		try {
			audioContext = new Ctor();
		} catch (err) {
			console.warn('Unable to create audio context', err);
			audioContext = null;
			return null;
		}
		return audioContext;
	}

	function clearInactivityTimer() {
		if (inactivityTimer) {
			clearTimeout(inactivityTimer);
			inactivityTimer = null;
		}
	}

	function stopInactivityHeartbeat() {
		if (inactivityHeartbeat) {
			voiceDebug('Stopping inactivity heartbeat');
			clearInterval(inactivityHeartbeat);
			inactivityHeartbeat = null;
		}
	}

	function startInactivityHeartbeat() {
		stopInactivityHeartbeat();
		if (!isJoined || !serverId || !channelId) return;
		voiceDebug('Starting inactivity heartbeat', { serverId, channelId });
		inactivityHeartbeat = setInterval(() => emitVoiceActivity('heartbeat'), 60_000);
	}

	function scheduleInactivityTimeout(reason: string) {
		if (!isJoined || !serverId || !channelId) return;
		clearInactivityTimer();
		inactivityTimer = window.setTimeout(() => {
			voiceDebug('voice inactivity timeout', { reason, limit: INACTIVITY_TIMEOUT_MS });
			statusMessage = 'Disconnected after 5 minutes without activity.';
			voiceSession.leave();
		}, INACTIVITY_TIMEOUT_MS);
		// Heartbeat is now managed by the reactive run() block, don't start it here
	}

	function emitVoiceActivity(reason: string) {
		if (!serverId || !channelId) return;
		voiceActivity.ping(serverId, channelId, reason);
		// Only reschedule the timeout, not the heartbeat (heartbeat is managed by reactive block)
		clearInactivityTimer();
		if (isJoined) {
			inactivityTimer = window.setTimeout(() => {
				voiceDebug('voice inactivity timeout', { reason, limit: INACTIVITY_TIMEOUT_MS });
				statusMessage = 'Disconnected after 5 minutes without activity.';
				voiceSession.leave();
			}, INACTIVITY_TIMEOUT_MS);
		}
	}

	function trackUserActivity(reason: string) {
		if (!isJoined) return;
		emitVoiceActivity(reason);
	}

	function setParticipantSpeaking(uid: string, speaking: boolean) {
		const wasSpeaking = speakingParticipants.has(uid);
		if (wasSpeaking === speaking) return;
		const next = new Set(speakingParticipants);
		if (speaking) {
			next.add(uid);
			lastActiveSpeaker = uid;
			speakingLevels = new Map(speakingLevels).set(uid, Date.now());
		} else {
			next.delete(uid);
		}
		speakingParticipants = next;
	}

	function setTransceiverDirection(
		transceiver: RTCRtpTransceiver | null,
		desired: RTCRtpTransceiverDirection,
		context: 'audio' | 'video',
		details: Record<string, unknown> = {}
	) {
		if (!transceiver) return;
		const current = transceiver.direction;
		if (current === desired) return;
		voiceDebug(`${context} transceiver direction update`, {
			from: current,
			to: desired,
			...details
		});
		try {
			const trxAny = transceiver as any;
			if (typeof trxAny?.setDirection === 'function') {
				trxAny.setDirection(desired);
			} else {
				trxAny.direction = desired;
			}
		} catch (err) {
			console.warn(`Failed to set ${context} transceiver direction`, err);
			voiceDebug(`Failed to set ${context} transceiver direction`, err);
			try {
				(transceiver as any).direction = desired;
			} catch (assignErr) {
				console.warn(`Failed to assign ${context} transceiver direction`, assignErr);
				voiceDebug(`Failed to assign ${context} transceiver direction`, assignErr);
			}
		}
	}

	function describeTrack(track: MediaStreamTrack | null): TrackDiagnostics | null {
		if (!track) return null;
		const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
		return {
			id: track.id,
			kind: track.kind,
			readyState: track.readyState,
			enabled: track.enabled,
			muted: (track as any)?.muted ?? false,
			label: track.label ?? '',
			width: typeof settings.width === 'number' ? settings.width : null,
			height: typeof settings.height === 'number' ? settings.height : null,
			frameRate: typeof settings.frameRate === 'number' ? settings.frameRate : null
		};
	}

	let lastPeerDiagnosticsSignature = '';

	function capturePeerDiagnostics(connection: RTCPeerConnection | null = pc, reason = 'snapshot') {
		if (!connection) {
			peerDiagnostics = {
				transceivers: [],
				senders: [],
				receivers: [],
				remoteStreams: []
			};
			const emptySignature = 'null';
			if (lastPeerDiagnosticsSignature !== emptySignature) {
				lastPeerDiagnosticsSignature = emptySignature;
				voiceDebug('Peer diagnostics cleared', { reason });
			}
			return;
		}

		const transceivers =
			typeof connection.getTransceivers === 'function'
				? connection.getTransceivers().map((transceiver) => {
						const trxAny = transceiver as any;
						return {
							mid: transceiver.mid ?? null,
							currentDirection: trxAny?.currentDirection ?? transceiver.direction ?? null,
							preferredDirection: transceiver.direction ?? null,
							isStopped: trxAny?.stopped ?? false,
							senderTrack: describeTrack(transceiver.sender?.track ?? null),
							receiverTrack: describeTrack(transceiver.receiver?.track ?? null)
						};
					})
				: [];

		const senders =
			typeof connection.getSenders === 'function'
				? connection.getSenders().map((sender) => {
						const senderAny = sender as any;
						const rawTransport = senderAny?.transport ?? null;
						const transportState =
							rawTransport && typeof rawTransport.state === 'string'
								? (rawTransport.state as string)
								: null;
						const streamList =
							typeof senderAny?.getStreams === 'function'
								? senderAny.getStreams().map((stream: MediaStream) => stream.id)
								: Array.isArray(senderAny?.streams)
									? senderAny.streams.map((stream: MediaStream) => stream.id)
									: [];
						return {
							track: describeTrack(sender.track ?? null),
							streams: streamList,
							transportState
						};
					})
				: [];

		const receivers =
			typeof connection.getReceivers === 'function'
				? connection.getReceivers().map((receiver) => {
						const receiverAny = receiver as any;
						const streamList =
							typeof receiverAny?.getStreams === 'function'
								? receiverAny.getStreams().map((stream: MediaStream) => stream.id)
								: Array.isArray(receiverAny?.streams)
									? receiverAny.streams.map((stream: MediaStream) => stream.id)
									: [];
						return {
							track: describeTrack(receiver.track ?? null),
							streams: streamList
						};
					})
				: [];

		const remoteStreamsDiagnostics: RemoteStreamDiagnostics[] = Array.from(
			remoteStreams.values()
		).map((stream) => ({
			id: stream.id,
			audioTracks: stream
				.getAudioTracks()
				.map((track) => describeTrack(track))
				.filter(Boolean) as TrackDiagnostics[],
			videoTracks: stream
				.getVideoTracks()
				.map((track) => describeTrack(track))
				.filter(Boolean) as TrackDiagnostics[]
		}));

		const nextDiagnostics: PeerDiagnostics = {
			transceivers,
			senders,
			receivers,
			remoteStreams: remoteStreamsDiagnostics
		};

		const signature = JSON.stringify(
			nextDiagnostics.transceivers.map((trx) => ({
				mid: trx.mid,
				currentDirection: trx.currentDirection,
				preferredDirection: trx.preferredDirection,
				sender: trx.senderTrack?.readyState ?? null,
				receiver: trx.receiverTrack?.readyState ?? null
			}))
		);
		peerDiagnostics = nextDiagnostics;
		if (signature !== lastPeerDiagnosticsSignature) {
			lastPeerDiagnosticsSignature = signature;
			voiceDebug('Peer diagnostics updated', {
				reason,
				transceivers: nextDiagnostics.transceivers.map((trx) => ({
					mid: trx.mid,
					current: trx.currentDirection,
					preferred: trx.preferredDirection,
					stopped: trx.isStopped,
					sender: trx.senderTrack ? `${trx.senderTrack.kind}:${trx.senderTrack.readyState}` : null,
					receiver: trx.receiverTrack
						? `${trx.receiverTrack.kind}:${trx.receiverTrack.readyState}`
						: null
				})),
				senders: nextDiagnostics.senders.map((sender) => ({
					track: sender.track ? `${sender.track.kind}:${sender.track.readyState}` : null,
					transport: sender.transportState ?? null
				})),
				remoteStreams: nextDiagnostics.remoteStreams.map((stream) => ({
					id: stream.id,
					audio: stream.audioTracks.map(
						(track) => `${track.readyState}${track.enabled ? '' : '(disabled)'}`
					),
					video: stream.videoTracks.map(
						(track) => `${track.readyState}${track.enabled ? '' : '(disabled)'}`
					)
				}))
			});
		}
	}

	function formatTrackDiagnostics(track: TrackDiagnostics | null): string {
		if (!track) return 'none';
		const bits = [`${track.kind}`, track.readyState];
		bits.push(track.enabled ? 'enabled' : 'disabled');
		if (track.muted) bits.push('muted');
		if (track.label) bits.push(`label:${track.label}`);
		if (track.width && track.height) {
			bits.push(`${track.width}x${track.height}`);
		}
		if (track.frameRate) {
			bits.push(`${track.frameRate}fps`);
		}
		return bits.join(' | ');
	}

	async function ensureMediaPermissions() {
		if (!browser || typeof navigator === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
			return;
		}
		if (permissionPreflight) {
			try {
				await permissionPreflight;
			} catch {
				/* already logged within the preflight */
			}
			return;
		}

		permissionPreflight = (async () => {
			let grantedAny = false;
			const attempts: MediaStreamConstraints[] = [
				{ audio: true, video: false },
				{ audio: false, video: true }
			];
			for (const constraints of attempts) {
				try {
					const probe = await navigator.mediaDevices.getUserMedia(constraints);
					probe.getTracks().forEach((track) => {
						track.stop();
						probe.removeTrack(track);
					});
					grantedAny = true;
					voiceDebug('Media permission granted', constraints);
				} catch (err) {
					console.warn('Media permission preflight failed', err);
					voiceDebug('Media permission request failed', constraints, err);
				}
			}
			if (!grantedAny && !permissionWarningShown) {
				permissionWarningShown = true;
				statusMessage = 'Allow camera and microphone access to enable video.';
			}
		})();

		try {
			await permissionPreflight;
		} catch {
			/* swallow errors after logging above */
		}
	}

	function stopAudioMonitor(uid: string) {
		const existing = audioMonitors.get(uid);
		if (existing) {
			if (existing.raf) {
				cancelAnimationFrame(existing.raf);
			}
			try {
				existing.source.disconnect();
			} catch {
				/* ignore disconnect errors */
			}
			try {
				existing.analyser.disconnect();
			} catch {
				/* ignore disconnect errors */
			}
			audioMonitors.delete(uid);
		}
		setParticipantSpeaking(uid, false);
	}

	function monitorStreamAudio(uid: string, stream: MediaStream | null) {
		if (!browser) return;
		const hasLiveAudio =
			!!stream &&
			stream.getAudioTracks().some((track) => track.enabled && track.readyState === 'live');
		if (!hasLiveAudio) {
			stopAudioMonitor(uid);
			return;
		}

		const existing = audioMonitors.get(uid);
		if (existing?.stream === stream) {
			return;
		}

		stopAudioMonitor(uid);

		const ctx = ensureAudioContext();
		if (!ctx) return;

		try {
			const source = ctx.createMediaStreamSource(stream);
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 1024;
			analyser.smoothingTimeConstant = 0.75;
			const data = new Uint8Array(analyser.fftSize);
			source.connect(analyser);

			const monitor: AudioMonitor = {
				stream,
				source,
				analyser,
				data,
				raf: null,
				lastSpoke: 0
			};

			const sample = () => {
				analyser.getByteTimeDomainData(data);
				let sumSquares = 0;
				for (let i = 0; i < data.length; i += 1) {
					const deviation = data[i] - 128;
					sumSquares += deviation * deviation;
				}
				const rms = Math.sqrt(sumSquares / data.length);
				const speaking = rms > SPEAKING_THRESHOLD;
				const now =
					typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
				if (speaking) {
					monitor.lastSpoke = now;
				}
				const stillSpeaking = speaking || now - monitor.lastSpoke < SPEAKING_FALLOFF_MS;
				setParticipantSpeaking(uid, stillSpeaking);
				monitor.raf = requestAnimationFrame(sample);
			};

			monitor.raf = requestAnimationFrame(sample);
			audioMonitors.set(uid, monitor);

			if (ctx.state === 'suspended') {
				ctx.resume().catch(() => {});
			}
		} catch (err) {
			console.warn('Failed to monitor audio level', err);
		}
	}

	function resetAudioMonitoring() {
		const keys = Array.from(audioMonitors.keys());
		keys.forEach((uid) => stopAudioMonitor(uid));
		speakingParticipants = new Set();
		lastActiveSpeaker = null;
		if (audioContext && audioMonitors.size === 0) {
			audioContext.suspend?.().catch(() => {});
		}
	}

	let statusMessage = $state('');
	let errorMessage = $state('');
	let copyErrorInFlight = $state(false);
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let callStartedAt: number | null = null;
	let callDuration = $state('00:00');
	let callTimer: ReturnType<typeof setInterval> | null = null;
	const RECONNECT_DELAY_MS = 3500;
	let lastPresencePayload: Record<string, unknown> | null = null;
	let presenceDebounce: ReturnType<typeof setTimeout> | null = null;
	let lastParticipantsSnapshot: ParticipantState[] | null = $state(null);
	let debugParticipants: ParticipantState[] = $state([]);

	voiceUnsubscribe = voiceSession.subscribe((next) => {
		// Skip the initial subscription callback if we haven't mounted yet
		// The onMount will handle initial state
		sessionQueue = sessionQueue.then(() => handleSessionChange(next));
	});

	function buildRtcConfiguration(): RTCConfiguration {
		const iceServers = buildIceServers();
		const config: RTCConfiguration = {
			iceServers,
			iceCandidatePoolSize: 10
		};
		if (forceRelayIceTransport && hasTurnServers) {
			config.iceTransportPolicy = 'relay';
		}
		return config;
	}

	function isPeerConnectionUsable(
		connection: RTCPeerConnection | null
	): connection is RTCPeerConnection {
		if (!connection) return false;
		if (connection.signalingState === 'closed') return false;
		if (connection.connectionState === 'closed') return false;
		return true;
	}

	const DEFAULT_VOLUME = 1;
	const STORAGE_PREFIX = 'hconnect:voice:controls:';

	type QuickStatItem = {
		key: string;
		label: string;
		value: string;
		tooltip?: string;
	};

	const now = () =>
		typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

	function toDisplayLabel(value: string | null | undefined, fallback = 'unknown'): string {
		if (!value) return fallback;
		return value;
	}

	function describeIcePolicyStatus(): string {
		if (!hasTurnServers) return 'stun-only';
		return forceRelayIceTransport ? 'relay-only' : 'all';
	}

	function describeTurnStatus(): string {
		if (hasTurnServers) {
			return usingFallbackTurnServers ? 'fallback (openrelay)' : 'configured';
		}
		return allowTurnFallback ? 'none' : 'none (disabled)';
	}

	function compactIdentifier(
		value: string | null,
		maxLength = 44
	): { display: string; tooltip: string } {
		if (!value || value === 'none') {
			return { display: 'none', tooltip: 'none' };
		}
		const tooltip = value;
		if (value.length <= maxLength) {
			return { display: value, tooltip };
		}
		const segments = value.split('/');
		if (segments.length > 4) {
			const compact = `${segments[0]}/${segments[1]}/…/${segments[segments.length - 1]}`;
			return { display: compact, tooltip };
		}
		const head = value.slice(0, Math.ceil(maxLength / 2) - 1);
		const tail = value.slice(-Math.floor(maxLength / 2) + 1);
		return { display: `${head}…${tail}`, tooltip };
	}

	function abbreviate(value: string | null | undefined, limit = 10): string {
		const text = toDisplayLabel(value).replace(/\s+/g, '-');
		return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
	}

	let quickStatsExpanded = $state(false);
	let copyInFlight = $state(false);

	function toggleQuickStats(expand?: boolean) {
		const target = typeof expand === 'boolean' ? expand : !quickStatsExpanded;
		if (target === quickStatsExpanded) return quickStatsExpanded;
		quickStatsExpanded = target;
		voiceDebug('Quick stats expanded changed', { expanded: quickStatsExpanded });
		appendVoiceDebugEvent('video-call', 'quickStats toggle', { expanded: quickStatsExpanded });
		if (browser && typeof localStorage !== 'undefined') {
			try {
				if (quickStatsExpanded) {
					localStorage.setItem(QUICK_STATS_STORAGE_KEY, '1');
				} else {
					localStorage.removeItem(QUICK_STATS_STORAGE_KEY);
				}
			} catch {
				/* ignore storage errors */
			}
		}
		return quickStatsExpanded;
	}

	// Only used as an internal cache to skip redundant presence writes; keep it non-reactive.
	let lastPresenceSignature: string | null = null;

	onMount(() => {
		const onUnload = () => {
			voiceSession.leave();
			hangUp({ cleanupDoc: true }).catch(() => {});
		};
		const onPageHide = () => {
			voiceSession.leave();
			hangUp({ cleanupDoc: true }).catch(() => {});
		};
		const onPointerDown = (event: PointerEvent) => {
			trackUserActivity('pointer');
			if (!(event.target instanceof HTMLElement)) {
				menuOpenFor = null;
				moreMenuOpen = false;
				return;
			}
			if (!event.target.closest('[data-voice-menu]')) {
				menuOpenFor = null;
				moreMenuOpen = false;
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			trackUserActivity('key');
			if (event.key === 'Escape') {
				menuOpenFor = null;
				moreMenuOpen = false;
				if (debugPanelVisible) {
					toggleDebugPanel(false);
					event.preventDefault();
				}
			}
		};
		const onResize = () => {
			if (debugPanelPosition && debugPanelDrawerEl) {
				const rect = debugPanelDrawerEl.getBoundingClientRect();
				debugPanelPosition = clampDebugPanelPosition(
					debugPanelPosition.x,
					debugPanelPosition.y,
					rect.width,
					rect.height
				);
			}
		};
		const onVisibilityChange = () => {
			if (!browser || typeof document === 'undefined') return;
			if (!isJoined) return;
			if (document.hidden) {
				scheduleInactivityTimeout('document-hidden');
			} else {
				emitVoiceActivity('document-visible');
			}
		};
		let onFullscreenChange: (() => void) | null = null;

		if (browser && typeof window !== 'undefined') {
			let storedDebug = false;
			let storedPanelOpen = false;
			let storedQuickStats = false;
			try {
				storedDebug = localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
				storedPanelOpen = localStorage.getItem(DEBUG_PANEL_STORAGE_KEY) === '1';
				storedQuickStats = localStorage.getItem(QUICK_STATS_STORAGE_KEY) === '1';
			} catch {
				storedDebug = false;
				storedPanelOpen = false;
				storedQuickStats = false;
			}
			if (storedDebug) {
				debugLoggingEnabled = true;
			}
			if (storedPanelOpen) {
				setDebugPanelVisibility(true);
			}
			quickStatsExpanded = storedQuickStats;
			(window as any).hConnectVoiceDebug = (enable: boolean | undefined) => {
				setVoiceDebug(enable !== false);
				console.info('[voice] debug logging', enable === false ? 'disabled' : 'enabled');
			};
			(window as any).hConnectVoiceTogglePanel = (open?: boolean) => {
				toggleDebugPanel(open);
				return debugPanelVisible;
			};
			(window as any).hConnectVoiceDump = (options?: {
				includeLogs?: number;
				includeEvents?: number;
			}) => collectVoiceDebugBundle(options ?? {});
			(window as any).hConnectVoiceCopyDebug = (options?: {
				includeLogs?: number;
				includeEvents?: number;
			}) => copyVoiceDebugBundle(options ?? {});
			voiceDebug('Voice component mounted');
			isTouchDevice = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
			window.addEventListener('beforeunload', onUnload);
			window.addEventListener('pagehide', onPageHide);
			window.addEventListener('unload', onPageHide);
			window.addEventListener('pointerdown', onPointerDown);
			window.addEventListener('keydown', onKeyDown);
			window.addEventListener('resize', onResize);
			onFullscreenChange = () => {
				isFullscreen = !!document.fullscreenElement;
				if (!isFullscreen) {
					showControlsBar();
				}
			};
			if (typeof document !== 'undefined') {
				document.addEventListener('visibilitychange', onVisibilityChange);
				document.addEventListener('fullscreenchange', onFullscreenChange);
				visibilityUnsub = () =>
					document.removeEventListener('visibilitychange', onVisibilityChange);
			}
			compactMediaQuery = window.matchMedia('(max-width: 780px)');
			handleCompactChange = (event: MediaQueryListEvent) => {
				compactMatch = event.matches;
			};
			compactMatch = compactMediaQuery.matches;
			compactMediaQuery.addEventListener('change', handleCompactChange);
		}
		return () => {
			if (browser && typeof window !== 'undefined') {
				window.removeEventListener('beforeunload', onUnload);
				window.removeEventListener('pagehide', onPageHide);
				window.removeEventListener('unload', onPageHide);
				window.removeEventListener('pointerdown', onPointerDown);
				window.removeEventListener('keydown', onKeyDown);
				window.removeEventListener('resize', onResize);
				visibilityUnsub?.();
				visibilityUnsub = null;
				if (typeof document !== 'undefined') {
					if (onFullscreenChange) {
						try {
							document.removeEventListener('fullscreenchange', onFullscreenChange);
						} catch {
							/* ignore cleanup errors */
						}
					}
				}
				if (compactMediaQuery && handleCompactChange) {
					compactMediaQuery.removeEventListener('change', handleCompactChange);
					compactMediaQuery = null;
					handleCompactChange = null;
				}
				try {
					delete (window as any).hConnectVoiceDebug;
				} catch {
					/* ignore cleanup errors */
				}
				try {
					delete (window as any).hConnectVoiceTogglePanel;
				} catch {
					/* ignore cleanup errors */
				}
				try {
					delete (window as any).hConnectVoiceDump;
				} catch {
					/* ignore cleanup errors */
				}
				try {
					delete (window as any).hConnectVoiceCopyDebug;
				} catch {
					/* ignore cleanup errors */
				}
			}
		};
	});

	onDestroy(() => {
		cancelDebugPanelDrag();
		voiceUnsubscribe?.();
		serverMetaUnsub?.();
		memberUnsub?.();
		prefsStop?.();
		resetVoiceClientState();
		// Clean up ICE restart and health check timers
		clearIceRestartTimer();
		stopConnectionHealthCheck();
		hangUp().catch(() => {});
		removeVoiceDebugSection('call.session');
		removeVoiceDebugSection('call.participants');
		removeVoiceDebugSection('call.remoteStreams');
		removeVoiceDebugSection('call.localStream');
		removeVoiceDebugSection('call.status');
		removeVoiceDebugSection('call.stats');
		removeVoiceDebugSection('call.lastBundle');
	});

	function avatarInitial(name: string | undefined): string {
		if (!name) return '?';
		return name.trim().charAt(0).toUpperCase() || '?';
	}

	function resolveGridColumns(count: number): number {
		if (count <= 1) return 1;
		if (count === 2) return 2;
		if (count <= 4) return 2;
		if (count <= 9) return 3;
		return typeof window !== 'undefined' && window.innerWidth < 1280 ? 3 : 4;
	}

	function storageKeyForControls(uid: string): string {
		const self = currentUserId ?? 'anon';
		return `${STORAGE_PREFIX}${self}:${uid}`;
	}

	function readParticipantControls(uid: string): ParticipantControls {
		if (!browser) return { volume: DEFAULT_VOLUME, muted: false };
		try {
			const raw = localStorage.getItem(storageKeyForControls(uid));
			if (!raw) return { volume: DEFAULT_VOLUME, muted: false };
			const parsed = JSON.parse(raw) as Partial<ParticipantControls>;
			const volume =
				typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
					? Math.min(Math.max(parsed.volume, 0), 2)
					: DEFAULT_VOLUME;
			const muted = typeof parsed.muted === 'boolean' ? parsed.muted : false;
			return { volume, muted };
		} catch {
			return { volume: DEFAULT_VOLUME, muted: false };
		}
	}

	function persistParticipantControls(uid: string, controls: ParticipantControls) {
		if (!browser) return;
		try {
			localStorage.setItem(storageKeyForControls(uid), JSON.stringify(controls));
		} catch {
			/* ignore storage failures */
		}
	}

	function ensureParticipantControls(uid: string) {
		if (participantControls.has(uid)) return;
		const controls = readParticipantControls(uid);
		const next = new Map(participantControls);
		next.set(uid, controls);
		participantControls = next;
	}

	function getParticipantControls(uid: string): ParticipantControls {
		ensureParticipantControls(uid);
		return participantControls.get(uid) ?? { volume: DEFAULT_VOLUME, muted: false };
	}

	function applyParticipantControls(uid: string) {
		const controls = participantControls.get(uid);
		if (!controls) return;
		const moderation = participantModeration.get(uid);
		const forcedMute = !!(moderation?.serverMuted || moderation?.serverDeafened);
		const audio = audioRefs.get(uid);
		if (audio) {
			const clampedVolume = Math.min(Math.max(controls.volume, 0), 2);
			const shouldMute = controls.muted || isPlaybackMuted || forcedMute;
			const hasPlaybackNode = audioPlayback.has(uid);
			const fallbackVolume = shouldMute ? 0 : Math.min(clampedVolume, 1);
			const stream = uid === currentUserId ? null : (remoteStreams.get(uid) ?? null);
			ensureAudioPlayback(uid, stream, shouldMute, shouldMute ? 0 : clampedVolume);
			audio.volume = hasPlaybackNode ? 0 : fallbackVolume;
			audio.muted = shouldMute || hasPlaybackNode;
			if (!shouldMute && !hasPlaybackNode) {
				audio.play?.().catch(() => {});
			}
		}
		if (uid !== currentUserId) {
			const video = videoRefs.get(uid);
			if (video) {
				video.muted = true;
			}
		}
	}

	function setParticipantVolume(uid: string, volume: number) {
		ensureParticipantControls(uid);
		const current = participantControls.get(uid);
		if (!current) return;
		const controls = { ...current, volume };
		participantControls = new Map(participantControls).set(uid, controls);
		persistParticipantControls(uid, controls);
		applyParticipantControls(uid);
	}

	function toggleParticipantMute(uid: string) {
		ensureParticipantControls(uid);
		const current = participantControls.get(uid);
		if (!current) return;
		const controls = { ...current, muted: !current.muted };
		participantControls = new Map(participantControls).set(uid, controls);
		persistParticipantControls(uid, controls);
		applyParticipantControls(uid);
	}

	function moderationState(uid: string) {
		return participantModeration.get(uid) ?? { serverMuted: false, serverDeafened: false };
	}

	function setParticipantModerationMap(
		next: Map<string, { serverMuted: boolean; serverDeafened: boolean }>
	) {
		participantModeration = next;
	}

	function toggleServerMute(uid: string) {
		const current = moderationState(uid);
		const next = { ...current, serverMuted: !current.serverMuted };
		setParticipantModerationMap(new Map(participantModeration).set(uid, next));
		applyParticipantControls(uid);
	}

	function toggleServerDeafen(uid: string) {
		const current = moderationState(uid);
		const next = {
			...current,
			serverMuted: true,
			serverDeafened: !current.serverDeafened
		};
		setParticipantModerationMap(new Map(participantModeration).set(uid, next));
		applyParticipantControls(uid);
	}

	function destroyAudioPlayback(uid: string) {
		const existing = audioPlayback.get(uid);
		if (!existing) return;
		try {
			existing.source.disconnect();
		} catch {
			/* ignore disconnect errors */
		}
		try {
			existing.gain.disconnect();
		} catch {
			/* ignore disconnect errors */
		}
		audioPlayback.delete(uid);
	}

	function ensureAudioPlayback(
		uid: string,
		stream: MediaStream | null,
		muted: boolean,
		volume: number
	) {
		if (!browser || uid === currentUserId || !stream) {
			destroyAudioPlayback(uid);
			return;
		}
		
		// Check if stream has active audio tracks
		const audioTracks = stream.getAudioTracks();
		if (audioTracks.length === 0) {
			voiceDebug('ensureAudioPlayback: stream has no audio tracks', { uid, streamId: stream.id });
			destroyAudioPlayback(uid);
			return;
		}
		
		const existing = audioPlayback.get(uid);
		
		// Check if we need to recreate the audio node
		// This can happen if the stream changed, or if the audio track changed
		const firstAudioTrack = audioTracks[0];
		const needsRecreate = !existing || 
			existing.stream !== stream || 
			existing.stream.getAudioTracks()[0]?.id !== firstAudioTrack?.id;
		
		if (!needsRecreate) {
			// Just update the volume
			existing.gain.gain.value = muted ? 0 : volume;
			return;
		}
		
		voiceDebug('ensureAudioPlayback: creating audio playback node', { 
			uid, 
			streamId: stream.id, 
			trackId: firstAudioTrack?.id,
			trackEnabled: firstAudioTrack?.enabled,
			trackMuted: firstAudioTrack?.muted,
			trackReadyState: firstAudioTrack?.readyState
		});
		
		destroyAudioPlayback(uid);
		const ctx = ensureAudioContext();
		if (!ctx) return;
		try {
			const source = ctx.createMediaStreamSource(stream);
			const gain = ctx.createGain();
			gain.gain.value = muted ? 0 : volume;
			source.connect(gain);
			gain.connect(ctx.destination);
			audioPlayback.set(uid, { stream, source, gain });
			if (ctx.state === 'suspended') {
				ctx.resume().catch(() => {});
			}
			voiceDebug('ensureAudioPlayback: audio node created successfully', { uid, ctxState: ctx.state });
		} catch (err) {
			console.warn('Failed to create audio playback node', err);
			voiceDebug('ensureAudioPlayback: failed to create audio node', { uid, error: String(err) });
		}
	}

	function orphanAudioUid(streamId: string) {
		return `stream:${streamId}`;
	}

	function applyOutputDeviceAll() {
		if (!currentPrefs.outputDeviceId) return;
		audioRefs.forEach((audio) => {
			const sink = (audio as any)?.setSinkId;
			if (typeof sink === 'function') {
				sink.call(audio, currentPrefs.outputDeviceId).catch(() => {});
			}
		});
	}

	function attachStreamToRefs(uid: string, stream: MediaStream | null) {
		if (!stream) {
			destroyAudioPlayback(uid);
		}
		const audio = audioRefs.get(uid);
		if (audio && audio.srcObject !== stream) {
			audio.srcObject = stream;
			if (stream) {
				try {
					const maybePromise = audio.play?.();
					if (maybePromise && typeof maybePromise.then === 'function') {
						maybePromise
							.then(() => {
								audioNeedsUnlock = false;
							})
							.catch((err: any) => {
								if (err?.name === 'NotAllowedError') {
									audioNeedsUnlock = true;
									statusMessage = 'Tap enable audio to hear others.';
								}
							});
					} else {
						audioNeedsUnlock = false;
					}
					const sink = (audio as any)?.setSinkId;
					if (typeof sink === 'function' && currentPrefs.outputDeviceId) {
						sink.call(audio, currentPrefs.outputDeviceId).catch(() => {});
					}
				} catch (err: any) {
					if (err?.name === 'NotAllowedError') {
						audioNeedsUnlock = true;
						statusMessage = 'Tap enable audio to hear others.';
					}
				}
			} else {
				audio.pause?.();
			}
		}
		let video: HTMLVideoElement | null = null;
		if (uid === currentUserId) {
			video = localVideoEl;
		} else {
			video = videoRefs.get(uid) ?? null;
		}
		if (video && video.srcObject !== stream) {
			video.srcObject = stream;
			if (stream) {
				const playResult = video.play?.();
				if (playResult && typeof playResult.then === 'function') {
					playResult.catch((err: unknown) => {
						if ((err as any)?.name === 'NotAllowedError') {
							voiceDebug('Video playback blocked until user gesture', { uid, streamId: stream.id });
						}
					});
				}
			} else {
				video.pause?.();
			}
			if (uid !== currentUserId) {
				video.muted = true;
			}
		}
	}

	/**
	 * Force refresh media elements for a given stream ID.
	 * This is called after remote streams are updated to ensure audio/video plays correctly.
	 */
	function refreshRemoteMediaElements(streamId: string) {
		const stream = remoteStreams.get(streamId);
		if (!stream) return;

		// Find which participant this stream belongs to
		const participant =
			participants.find((p) => p.streamId === streamId) ??
			participantMedia.find(
				(tile) => tile.stream?.id === streamId || tile.streamId === streamId
			);
		if (!participant) {
			voiceDebug('refreshRemoteMediaElements: no participant found for stream', { streamId });
			return;
		}

		const uid = participant.uid;
		if (uid === currentUserId) return; // Don't refresh self

		voiceDebug('refreshRemoteMediaElements', {
			uid,
			streamId,
			audioTracks: stream.getAudioTracks().length,
			videoTracks: stream.getVideoTracks().length
		});

		// Refresh audio element
		const audio = audioRefs.get(uid);
		if (audio) {
			// Force re-attach if srcObject doesn't match
			if (audio.srcObject !== stream) {
				audio.srcObject = stream;
			}
			// Try to play audio
			const playPromise = audio.play?.();
			if (playPromise && typeof playPromise.then === 'function') {
				playPromise
					.then(() => {
						audioNeedsUnlock = false;
					})
					.catch((err: any) => {
						if (err?.name === 'NotAllowedError') {
							audioNeedsUnlock = true;
						}
					});
			}
		}

		// Refresh video element
		const video = videoRefs.get(uid);
		if (video) {
			if (video.srcObject !== stream) {
				video.srcObject = stream;
			}
			video.play?.().catch(() => {});
		}

		// Ensure audio playback via Web Audio API
		const controls = participantControls.get(uid);
		const moderation = participantModeration.get(uid);
		const shouldMute = !!(controls?.muted || isPlaybackMuted || moderation?.serverMuted || moderation?.serverDeafened);
		const volume = controls?.volume ?? DEFAULT_VOLUME;
		ensureAudioPlayback(uid, stream, shouldMute, shouldMute ? 0 : volume);
	}

	/**
	 * Refresh audio playback for a participant by UID.
	 * This uses participantMedia to find the stream, handling cases where
	 * the stream ID might not match what's in the participant doc.
	 */
	function refreshAudioForParticipant(uid: string) {
		if (uid === currentUserId) return;
		
		const tile = participantMedia.find((t) => t.uid === uid);
		if (!tile || !tile.stream) {
			voiceDebug('refreshAudioForParticipant: no stream found for participant', { uid });
			return;
		}
		
		voiceDebug('refreshAudioForParticipant', {
			uid,
			streamId: tile.streamId,
			audioTracks: tile.stream.getAudioTracks().length,
			videoTracks: tile.stream.getVideoTracks().length
		});
		
		// Ensure audio playback via Web Audio API
		const controls = participantControls.get(uid);
		const moderation = participantModeration.get(uid);
		const shouldMute = !!(controls?.muted || isPlaybackMuted || moderation?.serverMuted || moderation?.serverDeafened);
		const volume = controls?.volume ?? DEFAULT_VOLUME;
		ensureAudioPlayback(uid, tile.stream, shouldMute, shouldMute ? 0 : volume);
		
		// Also refresh the audio element
		const audio = audioRefs.get(uid);
		if (audio) {
			if (audio.srcObject !== tile.stream) {
				audio.srcObject = tile.stream;
			}
			if (audio.paused) {
				audio.play?.().catch(() => {});
			}
		}
	}

	function registerAudioRef(uid: string, node: HTMLAudioElement | null) {
		if (node) {
			audioRefs.set(uid, node);
			const target = participantMedia.find((tile) => tile.uid === uid);
			attachStreamToRefs(uid, target?.stream ?? null);
			applyParticipantControls(uid);
		} else {
			const existing = audioRefs.get(uid);
			if (existing) {
				existing.pause?.();
				existing.srcObject = null;
			}
			audioRefs.delete(uid);
		}
	}

	function audioSink(node: HTMLAudioElement, uid: string) {
		registerAudioRef(uid, node);
		return {
			update(nextUid: string) {
				if (nextUid === uid) return;
				registerAudioRef(uid, null);
				uid = nextUid;
				registerAudioRef(uid, node);
			},
			destroy() {
				registerAudioRef(uid, null);
			}
		};
	}

	async function unlockAudioPlayback() {
		if (!audioRefs.size) {
			audioNeedsUnlock = false;
			return;
		}
		const attempts = Array.from(audioRefs.values()).map((node) => {
			try {
				const result = node.play?.();
				if (result && typeof result.then === 'function') {
					return result.catch(() => {});
				}
			} catch (err) {
				// ignore
			}
			return Promise.resolve();
		});
		await Promise.allSettled(attempts);
		const stillBlocked = Array.from(audioRefs.values()).some((node) => node.paused);
		audioNeedsUnlock = stillBlocked;
		if (!stillBlocked && remoteConnected) {
			statusMessage =
				statusMessage && statusMessage.includes('enable audio') ? 'Connected.' : statusMessage;
		}
	}

	function registerVideoRef(uid: string, node: HTMLVideoElement | null) {
		if (uid === currentUserId) {
			if (localVideoEl && localVideoEl !== node) {
				localVideoEl.pause?.();
				localVideoEl.srcObject = null;
			}
			localVideoEl = node;
		} else if (node) {
			videoRefs.set(uid, node);
		} else {
			const existing = videoRefs.get(uid);
			if (existing) {
				existing.pause?.();
				existing.srcObject = null;
			}
			videoRefs.delete(uid);
		}
		const target = participantMedia.find((tile) => tile.uid === uid);
		attachStreamToRefs(uid, target?.stream ?? null);
	}

	function streamHasLiveVideo(stream: MediaStream | null): boolean {
		if (!stream) return false;
		const videoTracks = stream.getVideoTracks();
		if (!videoTracks.length) return false;
		return videoTracks.some((track) => {
			if (track.readyState === 'ended') return false;
			if (track.readyState === 'live') return true;
			if (track.readyState === 'new') return true;
			return track.enabled;
		});
	}

	function videoSink(node: HTMLVideoElement, uid: string) {
		registerVideoRef(uid, node);
		return {
			update(nextUid: string) {
				if (nextUid === uid) return;
				registerVideoRef(uid, null);
				uid = nextUid;
				registerVideoRef(uid, node);
			},
			destroy() {
				registerVideoRef(uid, null);
			}
		};
	}

	function describeRemoteStreamForLog(stream: MediaStream) {
		return {
			id: stream.id,
			audio: stream.getAudioTracks().map((track) => ({
				id: track.id,
				state: track.readyState,
				enabled: track.enabled
			})),
			video: stream.getVideoTracks().map((track) => ({
				id: track.id,
				state: track.readyState,
				enabled: track.enabled
			}))
		};
	}

	function hasLiveRemoteMedia(): boolean {
		for (const stream of remoteStreams.values()) {
			const tracks = stream.getTracks();
			if (tracks.some((track) => track.readyState === 'live' || track.readyState === 'new')) {
				return true;
			}
		}
		return false;
	}

	function clearMediaRecoveryTimer() {
		if (mediaRecoveryTimer) {
			clearTimeout(mediaRecoveryTimer);
			mediaRecoveryTimer = null;
		}
	}

	function resetMediaRecovery(reason: string) {
		if (mediaRecoveryAttempts || mediaRecoveryTimer) {
			voiceDebug('Media recovery reset', {
				reason,
				attempts: mediaRecoveryAttempts
			});
		}
		mediaRecoveryAttempts = 0;
		lastMediaRecoveryAt = 0;
		clearMediaRecoveryTimer();
	}

	function scheduleMediaRecovery(reason: string) {
		if (!browser || !isJoined || isConnecting) return;
		if (!pc || pc.signalingState === 'closed') return;
		if (mediaRecoveryAttempts >= MAX_MEDIA_RECOVERY_ATTEMPTS) return;
		if (mediaRecoveryTimer) return;

		mediaRecoveryTimer = setTimeout(() => {
			mediaRecoveryTimer = null;
			if (!isJoined || isConnecting) return;
			if (!pc || pc.signalingState === 'closed') return;

			const currentUid = get(user)?.uid ?? null;
			const hasRemoteParticipants = participants.some((p) => p.uid !== currentUid);
			if (!hasRemoteParticipants) {
				resetMediaRecovery('no-remote-participants');
				return;
			}

			if (hasLiveRemoteMedia()) {
				resetMediaRecovery('remote-media-present');
				return;
			}

			const now = Date.now();
			if (now - lastMediaRecoveryAt < MEDIA_RECOVERY_COOLDOWN_MS) {
				return;
			}

			mediaRecoveryAttempts += 1;
			lastMediaRecoveryAt = now;
			voiceDebug('Media recovery triggered', {
				reason,
				attempt: mediaRecoveryAttempts,
				isOfferer,
				signalingState: pc.signalingState,
				remoteStreams: remoteStreams.size,
				participants: participants.length
			});
			scheduleRenegotiation(`media-recovery:${reason}`, { requireOfferer: true });
		}, MEDIA_RECOVERY_DELAY_MS);
	}

	function updateRemoteStreams(
		mutator: (draft: Map<string, MediaStream>) => void,
		reason = 'remote-streams'
	) {
		const previous = Array.from(remoteStreams.keys());
		const draft = new Map(remoteStreams);
		mutator(draft);
		remoteStreams = draft;
		if (hasLiveRemoteMedia()) {
			resetMediaRecovery('remote-streams-updated');
		}
		const next = Array.from(remoteStreams.keys());
		voiceDebug('Remote streams updated', {
			reason,
			previous,
			next,
			details: next.map((id) => {
				const stream = remoteStreams.get(id);
				return stream ? describeRemoteStreamForLog(stream) : { id, missing: true };
			})
		});
		capturePeerDiagnostics(pc, 'remote-streams');
	}

	function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
		const keysA = Object.keys(a);
		const keysB = Object.keys(b);
		if (keysA.length !== keysB.length) return false;
		for (const key of keysA) {
			if (a[key] !== b[key]) return false;
		}
		return true;
	}

	function participantsEqual(a: ParticipantState[], b: ParticipantState[]): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i += 1) {
			const left = a[i];
			const right = b[i];
			if (
				left.uid !== right.uid ||
				left.displayName !== right.displayName ||
				left.photoURL !== right.photoURL ||
				left.hasAudio !== right.hasAudio ||
				left.hasVideo !== right.hasVideo ||
				left.streamId !== right.streamId ||
				(left.status ?? 'active') !== (right.status ?? 'active')
			) {
				return false;
			}
		}
		return true;
	}

	function openMenu(uid: string) {
		menuOpenFor = uid;
	}

	function closeMenu() {
		menuOpenFor = null;
	}

	function handleLongPressStart(uid: string) {
		if (!isTouchDevice) return;
		const timer = setTimeout(() => {
			menuOpenFor = uid;
		}, 450);
		longPressTimers.set(uid, timer);
	}

	function handleLongPressEnd(uid: string) {
		const timer = longPressTimers.get(uid);
		if (timer) {
			clearTimeout(timer);
			longPressTimers.delete(uid);
		}
	}

	async function kickParticipant(target: ParticipantState) {
		if (!participantsCollectionRef || !canKickMembers) return;
		if (target.uid === currentUserId) return;
		try {
			const ref = doc(participantsCollectionRef, target.uid);
			await setDoc(
				ref,
				{
					status: 'removed',
					kickedBy: currentUserId ?? null,
					removedAt: serverTimestamp(),
					updatedAt: serverTimestamp()
				},
				{ merge: true }
			);
		} catch (err) {
			console.warn('Failed to kick participant', err);
			errorMessage = 'Unable to remove that participant.';
		}
	}

	function watchServerMeta(server: string) {
		serverMetaUnsub?.();
		const db = getDb();
		serverMetaUnsub = onSnapshot(
			doc(db, 'servers', server),
			(snap) => {
				const data = snap.data() as any;
				serverOwnerId = data?.ownerId ?? data?.owner ?? data?.createdBy ?? null;
			},
			() => {
				serverOwnerId = null;
			}
		);
	}

	function watchMemberDoc(server: string, uid: string) {
		memberUnsub?.();
		const db = getDb();
		memberUnsub = onSnapshot(
			doc(db, 'servers', server, 'members', uid),
			(snap) => {
				const data = snap.exists() ? (snap.data() as any) : {};
				myPerms = data?.perms ?? null;
			},
			() => {
				myPerms = null;
			}
		);
	}

	async function handleSessionChange(next: VoiceSession | null) {
		appendVoiceDebugEvent(
			'video-call',
			'handleSessionChange',
			next
				? {
						serverId: next.serverId,
						channelId: next.channelId,
						visible: next.visible,
						activeSessionKey
					}
				: { session: null, activeSessionKey }
		);
		voiceDebug('handleSessionChange called', {
			next: next
				? { serverId: next.serverId, channelId: next.channelId, visible: next.visible }
				: null,
			activeSessionKey,
			isJoined,
			isConnecting
		});
		if (!next) {
			session = null;
			sessionVisible = false;
			sessionChannelName = '';
			sessionServerName = '';
			const hadSession = activeSessionKey !== null;
			activeSessionKey = null;
			serverId = null;
			channelId = null;
			menuOpenFor = null;
			serverMetaUnsub?.();
			serverMetaUnsub = null;
			memberUnsub?.();
			memberUnsub = null;
			watchedServerId = null;
			watchedMemberKey = null;
			serverOwnerId = null;
			myPerms = null;
			resetVoiceClientState();
			if (hadSession || isJoined || isConnecting) {
				await hangUp();
			}
			return;
		}

		const nextKey = `${next.serverId}:${next.channelId}`;
		const sameSession = activeSessionKey === nextKey;

		voiceDebug('handleSessionChange session check', {
			activeSessionKey,
			nextKey,
			sameSession,
			isJoined,
			isConnecting
		});

		// Only update state if values actually changed to avoid triggering unnecessary reactivity
		if (session !== next) session = next;
		if (sessionVisible !== next.visible) sessionVisible = next.visible;
		if (sessionChannelName !== next.channelName) sessionChannelName = next.channelName;
		const nextServerName = next.serverName ?? '';
		if (sessionServerName !== nextServerName) sessionServerName = nextServerName;
		if (serverId !== next.serverId) serverId = next.serverId;
		if (channelId !== next.channelId) channelId = next.channelId;

		if (sameSession) {
			// Same session, just visibility or metadata changed - no need to rejoin
			if (!isJoined && !isConnecting) {
				voiceDebug('sameSession but NOT joined, calling joinChannel');
				await joinChannel();
			}
			return;
		}

		// When switching to a different channel, preserve current media state if already in a call
		// Otherwise use the join preferences from the new session
		const wasInCall = isJoined || isConnecting;
		const preservedMicMuted = wasInCall ? isMicMuted : (next.joinMuted ?? currentPrefs.muteOnJoin);
		const preservedCameraOff = wasInCall
			? isCameraOff
			: (next.joinVideoOff ?? currentPrefs.videoOffOnJoin);
		const preservedScreenSharing = wasInCall ? isScreenSharing : false;

		voiceDebug('handleSessionChange channel switch', {
			wasInCall,
			preservedMicMuted,
			preservedCameraOff,
			preservedScreenSharing,
			previousKey: activeSessionKey,
			nextKey
		});

		if (wasInCall) {
			// Use preserveMediaState option to prevent hangUp from resetting mic/camera state
			await hangUp({ preserveMediaState: true });
		}

		// Apply the preserved or new media state
		isMicMuted = preservedMicMuted;
		isCameraOff = preservedCameraOff;
		// Note: Screen sharing is not preserved across channel switches as it requires new stream

		activeSessionKey = nextKey;
		await joinChannel();
	}

	function applyTrackStates() {
		const audioTracks = localStream?.getAudioTracks() ?? [];
		const videoTracks = localStream?.getVideoTracks() ?? [];
		
		// Apply enabled state to tracks
		let trackStateChanged = false;
		audioTracks.forEach((track) => {
			const shouldBeEnabled = !isMicMuted;
			if (track.enabled !== shouldBeEnabled) {
				track.enabled = shouldBeEnabled;
				trackStateChanged = true;
				voiceDebug('Audio track enabled state changed', { 
					enabled: shouldBeEnabled, 
					trackId: track.id 
				});
			}
		});
		videoTracks.forEach((track) => {
			const shouldBeEnabled = !isCameraOff;
			if (track.enabled !== shouldBeEnabled) {
				track.enabled = shouldBeEnabled;
				trackStateChanged = true;
				voiceDebug('Video track enabled state changed', { 
					enabled: shouldBeEnabled, 
					trackId: track.id 
				});
			}
		});
		
		// Increment version to trigger button state updates
		if (trackStateChanged) {
			trackStateVersion += 1;
		}

		const previousAudioDir = audioTransceiverRef?.direction;
		const previousVideoDir = videoTransceiverRef?.direction;

		const desiredAudioDir: RTCRtpTransceiverDirection = audioTracks.length
			? 'sendrecv'
			: 'recvonly';
		setTransceiverDirection(audioTransceiverRef, desiredAudioDir, 'audio');

		const shouldSendVideo = videoTracks.length || isScreenSharing;
		const desiredVideoDir: RTCRtpTransceiverDirection = shouldSendVideo ? 'sendrecv' : 'recvonly';
		setTransceiverDirection(videoTransceiverRef, desiredVideoDir, 'video', {
			hasVideoTracks: videoTracks.length,
			isCameraOff,
			isScreenSharing
		});

		// Check if transceiver direction changed (needs renegotiation)
		const audioDirChanged = previousAudioDir && audioTransceiverRef?.direction !== previousAudioDir;
		const videoDirChanged = previousVideoDir && videoTransceiverRef?.direction !== previousVideoDir;

		voiceDebug('applyTrackStates', {
			audioTrackCount: audioTracks.length,
			videoTrackCount: videoTracks.length,
			micMuted: isMicMuted,
			cameraOff: isCameraOff,
			screenSharing: isScreenSharing,
			audioDirection: audioTransceiverRef?.direction,
			videoDirection: videoTransceiverRef?.direction,
			audioDirChanged,
			videoDirChanged
		});

		// If direction changed, we may need renegotiation
		if ((audioDirChanged || videoDirChanged) && isJoined && pc && callRef) {
			voiceDebug('Transceiver direction changed, scheduling renegotiation');
			scheduleRenegotiation('transceiver-direction-change', { requireOfferer: true });
		}

		capturePeerDiagnostics(pc, 'apply-track-states');
	}

	function requestRenegotiation(options: { requireOfferer?: boolean; reason?: string } = {}) {
		if (!pc || !callRef) {
			voiceDebug('requestRenegotiation ignored (missing pc or call)', options);
			return;
		}
		voiceDebug('requestRenegotiation invoked', {
			reason: options.reason ?? null,
			requireOfferer: !!options.requireOfferer,
			isOfferer,
			signalingState: pc.signalingState,
			negotiationInFlight: !!negotiationInFlight
		});

		if (options.reason) {
			pendingRenegotiationReasons.push(options.reason);
			voiceDebug('requestRenegotiation reason queued', {
				reason: options.reason,
				queueLength: pendingRenegotiationReasons.length
			});
		}

		if (options.requireOfferer && !isOfferer) {
			if (pc.signalingState !== 'stable') {
				renegotiationNeedsPromotion = true;
			} else {
				voiceDebug('Promoting to offerer for renegotiation', options);
				isOfferer = true;
				setActiveOfferRevision(
					Math.max(lastOfferRevision, lastAnswerRevision),
					'renegotiation-promote'
				);
				attachOffererIceHandlers(pc);
			}
		}

		if (pc.signalingState !== 'stable' || negotiationInFlight) {
			renegotiationAwaitingStable = true;
			voiceDebug('requestRenegotiation queued until stable/available', {
				state: pc.signalingState,
				negotiationInFlight: !!negotiationInFlight,
				reasons: pendingRenegotiationReasons
			});
			return;
		}

		if (renegotiationTimer) {
			voiceDebug('requestRenegotiation debounced', { reasons: pendingRenegotiationReasons });
			return;
		}

		renegotiationTimer = setTimeout(() => {
			renegotiationTimer = null;
			flushRenegotiationQueue();
		}, RENEGOTIATION_DEBOUNCE_MS);
	}

	async function performRenegotiation(reasons: string[]) {
		if (!pc || !callRef) {
			voiceDebug('performRenegotiation skipped (missing pc or call)', { reasons });
			return;
		}
		if (!isOfferer) {
			voiceDebug('performRenegotiation skipped (not offerer)', { reasons });
			return;
		}
		if (negotiationInFlight) {
			voiceDebug('performRenegotiation skipped (already in flight)', { reasons });
			return;
		}
		if (pc.signalingState !== 'stable') {
			voiceDebug('performRenegotiation delayed (signaling state)', {
				state: pc.signalingState,
				reasons
			});
			renegotiationAwaitingStable = true;
			return;
		}

		voiceDebug('performRenegotiation start', { reasons });
		
		// Ensure our tracks are synced before renegotiating
		syncLocalTracksToPeer();
		
		negotiationInFlight = renegotiateOffer()
			.catch((err) => {
				console.warn('Renegotiation failed', err);
				voiceDebug('Renegotiation failed', err);
			})
			.finally(() => {
				negotiationInFlight = null;
				// After renegotiation completes, refresh remote streams
				// Use multiple delays to handle timing variations
				const refreshAllAudio = () => {
					remoteStreams.forEach((_, streamId) => {
						refreshRemoteMediaElements(streamId);
					});
					// Also refresh by participant UID
					participants.forEach(p => {
						if (p.uid !== currentUserId) {
							refreshAudioForParticipant(p.uid);
						}
					});
				};
				setTimeout(refreshAllAudio, 500);
				setTimeout(refreshAllAudio, 1500);
			});
		await negotiationInFlight;
	}

	function processParticipantRenegotiationRequests(snapshot: ParticipantState[]) {
		if (!isOfferer) {
			if (processedRenegotiationSignals.size) {
				processedRenegotiationSignals.clear();
			}
			return;
		}
		const activeIds = new Set(snapshot.map((participant) => participant.uid));
		for (const uid of Array.from(processedRenegotiationSignals.keys())) {
			if (!activeIds.has(uid)) {
				processedRenegotiationSignals.delete(uid);
			}
		}

		const currentUid = get(user)?.uid ?? null;
		snapshot.forEach((participant) => {
			if ((participant.status ?? 'active') !== 'active') return;
			if (!participant.renegotiationRequestId) return;
			if (participant.uid === currentUid) return;
			const lastProcessed = processedRenegotiationSignals.get(participant.uid);
			if (lastProcessed === participant.renegotiationRequestId) return;
			processedRenegotiationSignals.set(participant.uid, participant.renegotiationRequestId);
			const reason = participant.renegotiationRequestReason ?? 'peer-request';
			voiceDebug('Processing peer renegotiation request', {
				from: participant.uid,
				requestId: participant.renegotiationRequestId,
				reason
			});
			requestRenegotiation({ requireOfferer: true, reason: `peer:${reason}` });
		});
	}

	async function signalOffererRenegotiation(reason: string) {
		if (!participantDocRef) {
			voiceDebug('signalOffererRenegotiation skipped (missing participant doc)', { reason });
			return;
		}
		const current = get(user);
		if (!current?.uid) {
			voiceDebug('signalOffererRenegotiation skipped (no authenticated user)', { reason });
			return;
		}
		const requestId = `${current.uid}-${Date.now().toString(36)}-${Math.random()
			.toString(36)
			.slice(2, 8)}`;
		lastRenegotiationSignalId = requestId;
		try {
			voiceDebug('Requesting renegotiation from offerer', { requestId, reason });
			await setDoc(
				participantDocRef,
				{
					renegotiationRequestId: requestId,
					renegotiationRequestReason: reason,
					renegotiationRequestedAt: serverTimestamp()
				},
				{ merge: true }
			);
		} catch (err) {
			console.warn('Failed to signal renegotiation to offerer', err);
			voiceDebug('Failed to signal renegotiation to offerer', err);
			return;
		}
		if (renegotiationSignalClearTimer) {
			clearTimeout(renegotiationSignalClearTimer);
		}
		renegotiationSignalClearTimer = setTimeout(() => {
			if (!participantDocRef || lastRenegotiationSignalId !== requestId) return;
			renegotiationSignalClearTimer = null;
			lastRenegotiationSignalId = null;
			voiceDebug('Clearing renegotiation request flag', { requestId });
			setDoc(
				participantDocRef,
				{
					renegotiationRequestId: null,
					renegotiationRequestReason: null,
					renegotiationResolvedAt: serverTimestamp()
				},
				{ merge: true }
			).catch((err) => {
				voiceDebug('Failed to clear renegotiation request flag', err);
			});
		}, 2000);
	}

	function scheduleRenegotiation(reason: string, options: { requireOfferer?: boolean } = {}) {
		const requireOfferer = options.requireOfferer ?? false;
		const shouldSignalCurrentOfferer = requireOfferer && !isOfferer;
		const payload = { ...options, reason };
		requestRenegotiation(payload);
		if (shouldSignalCurrentOfferer && !isOfferer) {
			voiceDebug('scheduleRenegotiation signaling current offerer', { reason });
			void signalOffererRenegotiation(reason);
		}
	}

	function isPermissionError(err: unknown): boolean {
		return typeof err === 'object' && err !== null && (err as any).code === 'permission-denied';
	}

	function resetDescriptionListeners(options: { clearCache?: boolean } = {}) {
		const { clearCache = true } = options;
		offerDescriptionUnsub?.();
		answerDescriptionUnsub?.();
		offerDescriptionUnsub = null;
		answerDescriptionUnsub = null;
		if (clearCache) {
			latestOfferDescription = null;
			latestAnswerDescription = null;
		}
	}

	function disableDescriptionStorage(reason?: unknown) {
		if (!descriptionStorageEnabled) return;
		descriptionStorageEnabled = false;
		if (reason !== undefined) {
			voiceDebug('Disabling description subcollection usage; falling back to inline SDP.', reason);
		} else {
			voiceDebug('Disabling description subcollection usage; falling back to inline SDP.');
		}
		resetDescriptionListeners({ clearCache: false });
		offerDescriptionRef = null;
		answerDescriptionRef = null;
	}

	function detachCandidateSubscriptions() {
		if (offerCandidatesUnsub || answerCandidatesUnsub) {
			voiceDebug('Detaching candidate subscriptions');
		}
		offerCandidatesUnsub?.();
		answerCandidatesUnsub?.();
		offerCandidatesUnsub = null;
		answerCandidatesUnsub = null;
	}

	function clearPendingRemoteCandidates() {
		pendingRemoteIceCandidates = [];
		pendingRemoteCandidateKeys.clear();
	}

	function applyRemoteIceCandidate(
		connection: RTCPeerConnection | null,
		candidateData: RTCIceCandidateInit & { candidate?: string | null; revision?: number },
		role: 'offerer' | 'answerer',
		options: { fallback?: boolean; fromQueue?: boolean } = {}
	) {
		const { fallback = false, fromQueue = false } = options;
		const candidateRevision = candidateRevisionValue(candidateData);
		if (candidateRevision <= 0 || candidateRevision !== lastOfferRevision) {
			voiceDebug('Dropping remote ICE candidate (revision mismatch)', {
				role,
				candidateRevision,
				activeRevision: lastOfferRevision,
				fallback,
				fromQueue
			});
			return;
		}
		
		// Validate connection state
		if (!connection) {
			voiceDebug('applyRemoteIceCandidate skipped (no connection)', { role });
			return;
		}
		if (connection.signalingState === 'closed') {
			voiceDebug('applyRemoteIceCandidate skipped (connection closed)', { role });
			return;
		}
		
		// Skip empty candidates (end-of-candidates signal)
		if (!candidateData.candidate || candidateData.candidate.trim() === '') {
			voiceDebug('Received end-of-candidates signal', { role });
			return;
		}
		
		const key = `${candidateRevision}:${remoteCandidateKey(candidateData)}`;
		if (remoteCandidateKeys.has(key)) {
			// Only log occasionally to reduce noise
			if (appliedCandidateCount < 20) {
				voiceDebug('Skipping duplicate remote ICE candidate', {
					role,
					source: fallback ? 'fallback' : 'primary'
				});
			}
			return;
		}
		if (!fromQueue && pendingRemoteCandidateKeys.has(key)) {
			return;
		}
		const info = describeIceCandidate(candidateData.candidate);
		if (!fromQueue) {
			logRemoteCandidate(role, info, { fallback });
		}
		
		// Check if we need to queue the candidate
		if (!connection.remoteDescription) {
			pendingRemoteCandidateKeys.add(key);
			pendingRemoteIceCandidates.push({
				candidate: candidateData,
				role,
				fallback,
				revision: candidateRevision
			});
			voiceDebug('Queued remote ICE candidate (awaiting remote description)', {
				role,
				queueLength: pendingRemoteIceCandidates.length,
				...info,
				fallback
			});
			return;
		}
		
		// Also check signaling state - some browsers need offer/answer exchange complete
		if (connection.signalingState !== 'stable' && connection.signalingState !== 'have-local-offer' && connection.signalingState !== 'have-remote-offer') {
			pendingRemoteCandidateKeys.add(key);
			pendingRemoteIceCandidates.push({
				candidate: candidateData,
				role,
				fallback,
				revision: candidateRevision
			});
			voiceDebug('Queued remote ICE candidate (signaling not ready)', {
				role,
				signalingState: connection.signalingState,
				queueLength: pendingRemoteIceCandidates.length,
				...info,
				fallback
			});
			return;
		}
		
		pendingRemoteCandidateKeys.delete(key);
		remoteCandidateKeys.add(key);
		const candidate = new RTCIceCandidate(candidateData);
		connection
			.addIceCandidate(candidate)
			.then(() => {
				appliedCandidateCount += 1;
			})
			.catch((err) => {
				console.warn('Failed to add remote ICE candidate', err);
				voiceDebug('Failed to add remote ICE candidate', {
					role,
					error: err instanceof Error ? err.message : String(err),
					signalingState: connection.signalingState,
					hasRemoteDescription: !!connection.remoteDescription,
					...info
				});
				
				// Re-queue if it's a state error and we might be able to apply later
				if (
					err instanceof DOMException &&
					(err.name === 'InvalidStateError' || err.name === 'OperationError')
				) {
					// Remove from applied set since it failed
					remoteCandidateKeys.delete(key);
					
					// Only re-queue if not already pending
					if (!pendingRemoteCandidateKeys.has(key)) {
						pendingRemoteCandidateKeys.add(key);
						pendingRemoteIceCandidates.push({
							candidate: candidateData,
							role,
							fallback,
							revision: candidateRevision
						});
						voiceDebug('Re-queued failed ICE candidate for retry', { role });
					}
				}
			});
	}

	function flushPendingRemoteIceCandidates(connection: RTCPeerConnection | null = pc) {
		if (!connection) {
			voiceDebug('flushPendingRemoteIceCandidates skipped (no connection)');
			return;
		}
		if (!connection.remoteDescription) {
			voiceDebug('flushPendingRemoteIceCandidates skipped (no remote description)');
			return;
		}
		if (!pendingRemoteIceCandidates.length) return;
		
		const queueLength = pendingRemoteIceCandidates.length;
		voiceDebug('Flushing pending ICE candidates', {
			count: queueLength,
			signalingState: connection.signalingState
		});
		
		const queued = [...pendingRemoteIceCandidates];
		pendingRemoteIceCandidates = [];
		
		// Process candidates in order with small delay between to avoid overwhelming
		queued.forEach((entry, index) => {
			if (entry.revision !== lastOfferRevision) {
				voiceDebug('Dropping queued ICE candidate (revision mismatch)', {
					role: entry.role,
					candidateRevision: entry.revision,
					activeRevision: lastOfferRevision
				});
				return;
			}
			// Small staggered delay to prevent race conditions
			setTimeout(() => {
				applyRemoteIceCandidate(connection, entry.candidate, entry.role, {
					fallback: entry.fallback,
					fromQueue: true
				});
			}, index * 10); // 10ms between each candidate
		});
	}

	function attachOffererIceHandlers(connection: RTCPeerConnection) {
		if (!offerCandidatesRef) {
			voiceDebug('attachOffererIceHandlers skipped (missing offerCandidatesRef)');
			return;
		}
		voiceDebug('attachOffererIceHandlers', {
			hasAnswerCandidatesRef: !!answerCandidatesRef,
			hasOfferCandidatesRef: !!offerCandidatesRef
		});
		localCandidatesRef = offerCandidatesRef;
		connection.onicecandidate = (event) => {
			if (!event.candidate) {
				voiceDebug('ICE candidate gathering complete', { role: 'offerer' });
				capturePeerDiagnostics(connection, 'ice-gatherer-offerer');
				return;
			}
			if (localCandidatesRef) {
				const candidateRevision = lastOfferRevision;
				if (candidateRevision <= 0) {
					voiceDebug('Skipping ICE candidate publish (no active revision)', {
						role: 'offerer'
					});
					return;
				}
				const info = describeIceCandidate(event.candidate.candidate);
				voiceDebug('Publishing ICE candidate', { role: 'offerer', ...info });
				publishedCandidateCount += 1;
				addDoc(localCandidatesRef, {
					...event.candidate.toJSON(),
					revision: candidateRevision
				}).catch((err) => {
					console.warn('Failed to save ICE candidate', err);
				});
			}
		};

		detachCandidateSubscriptions();

		if (answerCandidatesRef) {
			answerCandidatesUnsub = onSnapshot(answerCandidatesRef, (snapshot) => {
				snapshot.docChanges().forEach((change) => {
					if (change.type === 'added' && !change.doc.metadata.hasPendingWrites) {
						const docId = change.doc.id;
						if (consumedAnswerCandidateIds.has(docId)) {
							return;
						}
						consumedAnswerCandidateIds.add(docId);
						const candidateData = change.doc.data() as RTCIceCandidateInit & {
							candidate?: string | null;
							revision?: number;
						};
						const candidateRevision = candidateRevisionValue(candidateData);
						if (candidateRevision <= 0 || candidateRevision !== lastOfferRevision) {
							voiceDebug('Dropping answer ICE candidate (revision mismatch)', {
								docId,
								candidateRevision,
								activeRevision: lastOfferRevision
							});
							return;
						}
						applyRemoteIceCandidate(connection, candidateData, 'offerer');
					}
				});
			});
		}

		// Fallback listener if the remote peer continues to write to offerCandidates.
		offerCandidatesUnsub = onSnapshot(offerCandidatesRef, (snapshot) => {
			snapshot.docChanges().forEach((change) => {
				if (change.type === 'added' && !change.doc.metadata.hasPendingWrites) {
					const docId = change.doc.id;
					if (consumedAnswerCandidateIds.has(docId)) {
						return;
					}
					consumedAnswerCandidateIds.add(docId);
					const candidateData = change.doc.data() as RTCIceCandidateInit & {
						candidate?: string | null;
						revision?: number;
					};
					const candidateRevision = candidateRevisionValue(candidateData);
					if (candidateRevision <= 0 || candidateRevision !== lastOfferRevision) {
						voiceDebug('Dropping fallback ICE candidate (revision mismatch)', {
							docId,
							candidateRevision,
							activeRevision: lastOfferRevision
						});
						return;
					}
					applyRemoteIceCandidate(connection, candidateData, 'offerer', { fallback: true });
				}
			});
		});
	}

	function attachAnswererIceHandlers(connection: RTCPeerConnection) {
		if (!answerCandidatesRef) {
			voiceDebug('attachAnswererIceHandlers skipped (missing answerCandidatesRef)');
			return;
		}
		voiceDebug('attachAnswererIceHandlers', {
			hasAnswerCandidatesRef: !!answerCandidatesRef,
			hasOfferCandidatesRef: !!offerCandidatesRef
		});
		localCandidatesRef = answerCandidatesRef;
		connection.onicecandidate = (event) => {
			if (!event.candidate) {
				voiceDebug('ICE candidate gathering complete', { role: 'answerer' });
				capturePeerDiagnostics(connection, 'ice-gatherer-answerer');
				return;
			}
			if (localCandidatesRef) {
				const candidateRevision = lastOfferRevision;
				if (candidateRevision <= 0) {
					voiceDebug('Skipping ICE candidate publish (no active revision)', {
						role: 'answerer'
					});
					return;
				}
				const info = describeIceCandidate(event.candidate.candidate);
				voiceDebug('Publishing ICE candidate', { role: 'answerer', ...info });
				publishedCandidateCount += 1;
				addDoc(localCandidatesRef, {
					...event.candidate.toJSON(),
					revision: candidateRevision
				}).catch((err) => {
					console.warn('Failed to save ICE candidate', err);
				});
			}
		};

		detachCandidateSubscriptions();

		if (offerCandidatesRef) {
			offerCandidatesUnsub = onSnapshot(offerCandidatesRef, (snapshot) => {
				snapshot.docChanges().forEach((change) => {
					if (change.type === 'added' && !change.doc.metadata.hasPendingWrites) {
						const docId = change.doc.id;
						if (consumedOfferCandidateIds.has(docId)) {
							return;
						}
						consumedOfferCandidateIds.add(docId);
						const candidateData = change.doc.data() as RTCIceCandidateInit & {
							candidate?: string | null;
							revision?: number;
						};
						const candidateRevision = candidateRevisionValue(candidateData);
						if (candidateRevision <= 0 || candidateRevision !== lastOfferRevision) {
							voiceDebug('Dropping offer ICE candidate (revision mismatch)', {
								docId,
								candidateRevision,
								activeRevision: lastOfferRevision
							});
							return;
						}
						applyRemoteIceCandidate(connection, candidateData, 'answerer');
					}
				});
			});
		}
	}

	function attachDescriptionListeners() {
		resetDescriptionListeners();
		if (!descriptionStorageEnabled) return;
		if (!offerDescriptionRef || !answerDescriptionRef) return;
		offerDescriptionUnsub = onSnapshot(
			offerDescriptionRef,
			(snap) => {
				if (!snap.exists()) {
					latestOfferDescription = null;
					return;
				}
				const data = snap.data() as any;
				const revision = data.revision ?? 0;
				const sdp = data.sdp ?? '';
				const type = (data.type ?? 'offer') as RTCSdpType;
				latestOfferDescription = { revision, sdp, type };
				voiceDebug('offer description updated', { revision, type, length: sdp?.length ?? 0 });
			},
			(err) => {
				console.warn('Failed to watch offer description', err);
				voiceDebug('Failed to watch offer description', err);
				if (isPermissionError(err)) {
					disableDescriptionStorage(err);
				}
			}
		);

		answerDescriptionUnsub = onSnapshot(
			answerDescriptionRef,
			(snap) => {
				if (!snap.exists()) {
					latestAnswerDescription = null;
					return;
				}
				const data = snap.data() as any;
				const revision = data.revision ?? 0;
				const sdp = data.sdp ?? '';
				const type = (data.type ?? 'answer') as RTCSdpType;
				latestAnswerDescription = { revision, sdp, type };
				voiceDebug('answer description updated', { revision, type, length: sdp?.length ?? 0 });
			},
			(err) => {
				console.warn('Failed to watch answer description', err);
				voiceDebug('Failed to watch answer description', err);
				if (isPermissionError(err)) {
					disableDescriptionStorage(err);
				}
			}
		);
	}

	async function ensureOfferDescription(
		revision: number,
		fallback: RTCSessionDescriptionInit | null = null
	): Promise<RTCSessionDescriptionInit | null> {
		if (!offerDescriptionRef) {
			if (fallback?.sdp) {
				const type = fallback.type ?? 'offer';
				latestOfferDescription = {
					revision,
					type,
					sdp: fallback.sdp
				};
				return { type, sdp: fallback.sdp };
			}
			return null;
		}
		if (latestOfferDescription && latestOfferDescription.revision === revision) {
			return {
				type: latestOfferDescription.type,
				sdp: latestOfferDescription.sdp
			};
		}
		let snap;
		try {
			snap = await getDoc(offerDescriptionRef);
		} catch (err) {
			console.warn('Failed to fetch offer description doc', err);
			voiceDebug('Failed to fetch offer description doc', err);
			if (isPermissionError(err)) {
				disableDescriptionStorage(err);
			}
			if (fallback?.sdp) {
				const type = fallback.type ?? 'offer';
				latestOfferDescription = { revision, type, sdp: fallback.sdp };
				return { type, sdp: fallback.sdp };
			}
			return null;
		}
		if (!snap.exists()) {
			if (fallback?.sdp) {
				const type = fallback.type ?? 'offer';
				latestOfferDescription = { revision, type, sdp: fallback.sdp };
				return { type, sdp: fallback.sdp };
			}
			return null;
		}
		const data = snap.data() as any;
		const type = (data.type ?? 'offer') as RTCSdpType;
		const sdp = data.sdp ?? '';
		const actualRevision = data.revision ?? 0;
		if (actualRevision !== revision) {
			voiceDebug('Offer description revision mismatch', {
				expected: revision,
				actual: actualRevision
			});
			if (fallback?.sdp) {
				latestOfferDescription = { revision, type: fallback.type ?? 'offer', sdp: fallback.sdp };
				return { type: fallback.type ?? 'offer', sdp: fallback.sdp };
			}
			return null;
		}
		latestOfferDescription = { revision: actualRevision, type, sdp };
		return { type, sdp };
	}

	async function ensureAnswerDescription(
		revision: number,
		fallback: RTCSessionDescriptionInit | null = null
	): Promise<RTCSessionDescriptionInit | null> {
		if (!answerDescriptionRef) {
			if (fallback?.sdp) {
				const type = fallback.type ?? 'answer';
				latestAnswerDescription = {
					revision,
					type,
					sdp: fallback.sdp
				};
				return { type, sdp: fallback.sdp };
			}
			return null;
		}
		if (latestAnswerDescription && latestAnswerDescription.revision === revision) {
			return {
				type: latestAnswerDescription.type,
				sdp: latestAnswerDescription.sdp
			};
		}
		let snap;
		try {
			snap = await getDoc(answerDescriptionRef);
		} catch (err) {
			console.warn('Failed to fetch answer description doc', err);
			voiceDebug('Failed to fetch answer description doc', err);
			if (isPermissionError(err)) {
				disableDescriptionStorage(err);
			}
			if (fallback?.sdp) {
				const type = fallback.type ?? 'answer';
				latestAnswerDescription = { revision, type, sdp: fallback.sdp };
				return { type, sdp: fallback.sdp };
			}
			return null;
		}
		if (!snap.exists()) {
			if (fallback?.sdp) {
				const type = fallback.type ?? 'answer';
				latestAnswerDescription = { revision, type, sdp: fallback.sdp };
				return { type, sdp: fallback.sdp };
			}
			return null;
		}
		const data = snap.data() as any;
		const type = (data.type ?? 'answer') as RTCSdpType;
		const sdp = data.sdp ?? '';
		const actualRevision = data.revision ?? 0;
		if (actualRevision !== revision) {
			voiceDebug('Answer description revision mismatch', {
				expected: revision,
				actual: actualRevision
			});
			if (fallback?.sdp) {
				latestAnswerDescription = {
					revision,
					type: fallback.type ?? 'answer',
					sdp: fallback.sdp
				};
				return { type: fallback.type ?? 'answer', sdp: fallback.sdp };
			}
			return null;
		}
		latestAnswerDescription = { revision: actualRevision, type, sdp };
		return { type, sdp };
	}

	function syncLocalTracksToPeer() {
		const connection = pc;
		if (!connection) {
			voiceDebug('syncLocalTracksToPeer skipped (no connection)');
			return;
		}
		if (connection.signalingState === 'closed') {
			voiceDebug('syncLocalTracksToPeer skipped (connection closed)');
			return;
		}
		
		const stream = localStream;
		const audioTrack = stream?.getAudioTracks()[0] ?? null;
		const videoTrack = stream?.getVideoTracks()[0] ?? null;

		voiceDebug('syncLocalTracksToPeer', {
			hasStream: !!stream,
			streamId: stream?.id ?? null,
			hasAudioTrack: !!audioTrack,
			hasVideoTrack: !!videoTrack,
			audioSenderTrack: audioSender?.track?.id ?? null,
			videoSenderTrack: videoSender?.track?.id ?? null
		});

		const updateSender = async (
			sender: RTCRtpSender | null,
			track: MediaStreamTrack | null,
			kind: 'audio' | 'video'
		): Promise<RTCRtpSender | null> => {
			if (sender) {
				// Check if track actually needs updating
				if (sender.track === track) {
					voiceDebug(`${kind} track already on sender`, { trackId: track?.id ?? null });
					return sender;
				}
				
				voiceDebug(`Replacing ${kind} track on sender`, { 
					hasTrack: !!track,
					trackId: track?.id ?? null,
					previousTrackId: sender.track?.id ?? null 
				});
				
				try {
					await sender.replaceTrack(track);
					if (stream) {
						sender.setStreams?.(stream);
					} else {
						sender.setStreams?.();
					}
					voiceDebug(`${kind} track replaced successfully`);
				} catch (err) {
					console.warn(`Failed to sync ${kind} track`, err);
					voiceDebug(`Failed to sync ${kind} track`, { 
						error: err instanceof Error ? err.message : String(err) 
					});
				}
				return sender;
			}
			
			if (track && stream) {
				voiceDebug(`Adding ${kind} track to connection`, { 
					streamId: stream.id,
					trackId: track.id 
				});
				try {
					const next = connection.addTrack(track, stream);
					next.setStreams?.(stream);
					return next;
				} catch (err) {
					console.warn(`Failed to add ${kind} track`, err);
					voiceDebug(`Failed to add ${kind} track`, {
						error: err instanceof Error ? err.message : String(err)
					});
				}
			}
			return sender;
		};

		// Update tracks asynchronously but don't block
		(async () => {
			audioSender = await updateSender(audioSender, audioTrack, 'audio');
			videoSender = await updateSender(videoSender, videoTrack, 'video');
			capturePeerDiagnostics(connection, 'sync-local-tracks');
			
			// Update presence after sync to ensure streamId is published
			if (isJoined && localStream) {
				updateParticipantPresence().catch(() => {});
			}
		})();
	}

	function videoConstraintsFromPrefs(prefs: UserVoicePreferences) {
		const quality = prefs.videoQuality ?? '720p';
		const map: Record<UserVoicePreferences['videoQuality'], { width: number; height: number }> = {
			'1080p': { width: 1920, height: 1080 },
			'720p': { width: 1280, height: 720 },
			'480p': { width: 854, height: 480 }
		};
		const target = map[quality];
		return {
			width: { ideal: target.width },
			height: { ideal: target.height }
		};
	}

	async function acquireTrack(
		kind: 'audio' | 'video',
		prefs: UserVoicePreferences = currentPrefs
	): Promise<boolean> {
		const constraints: MediaStreamConstraints =
			kind === 'audio'
				? {
						audio: {
							deviceId: prefs.inputDeviceId ? { exact: prefs.inputDeviceId } : undefined,
							echoCancellation: prefs.echoCancellation,
							noiseSuppression: prefs.noiseSuppression,
							autoGainControl: prefs.autoGain
						},
						video: false
					}
				: {
						audio: false,
						video: {
							deviceId: prefs.cameraDeviceId ? { exact: prefs.cameraDeviceId } : undefined,
							...videoConstraintsFromPrefs(prefs)
						}
					};

		try {
			const stream = await navigator.mediaDevices.getUserMedia(constraints);
			if (!localStream) {
				localStream = new MediaStream();
			}

			const existingTracks =
				kind === 'audio' ? localStream.getAudioTracks() : localStream.getVideoTracks();

			existingTracks.forEach((track) => {
				track.stop();
				localStream!.removeTrack(track);
			});

			stream.getTracks().forEach((track) => {
				localStream!.addTrack(track);
			});

			if (localVideoEl) {
				localVideoEl.srcObject = localStream;
				localVideoEl.play?.().catch(() => {});
			}

			applyTrackStates();
			syncLocalTracksToPeer();
			voiceDebug('acquireTrack success', {
				kind,
				streamId: localStream?.id ?? null,
				tracks: localStream
					? localStream.getTracks().map((track) => ({
							id: track.id,
							kind: track.kind,
							state: track.readyState,
							enabled: track.enabled,
							label: track.label
						}))
					: []
			});
			errorMessage = '';
			return true;
		} catch (err) {
			console.warn(`Failed to acquire ${kind} track`, err);
			voiceDebug('acquireTrack failed', { kind, error: err instanceof Error ? err.message : err });
			const msg =
				err instanceof Error
					? err.message
					: `Unable to access ${kind === 'audio' ? 'microphone' : 'camera'}.`;
			errorMessage = msg;
			return false;
		}
	}

	async function prepareInitialLocalTracks(reason: string) {
		const hasAudio = !!localStream?.getAudioTracks().length;
		const hasVideo = !!localStream?.getVideoTracks().length;
		const shouldAcquireAudio = !isMicMuted && !hasAudio;
		const shouldAcquireVideo = !isCameraOff && !hasVideo;
		voiceDebug('Preparing initial local tracks', {
			reason,
			shouldAcquireAudio,
			shouldAcquireVideo,
			hasAudio,
			hasVideo,
			isMicMuted,
			isCameraOff
		});

		if (shouldAcquireAudio) {
			const audioOk = await acquireTrack('audio');
			if (!audioOk) {
				isMicMuted = true;
				voiceDebug('Initial audio acquisition failed, setting muted', { reason });
			}
		}

		if (shouldAcquireVideo) {
			const videoOk = await acquireTrack('video');
			if (!videoOk) {
				isCameraOff = true;
				voiceDebug('Initial video acquisition failed, setting camera off', { reason });
			}
		}
	}

	function removeLocalTrack(kind: 'audio' | 'video') {
		if (!localStream) return;
		const tracks = kind === 'audio' ? localStream.getAudioTracks() : localStream.getVideoTracks();
		tracks.forEach((track) => {
			track.stop();
			localStream!.removeTrack(track);
		});
		const hasRemainingTracks = localStream.getTracks().length > 0;
		if (!hasRemainingTracks) {
			if (localVideoEl) {
				localVideoEl.pause?.();
				localVideoEl.srcObject = null;
			}
			localStream = null;
		}
		syncLocalTracksToPeer();
	}

	/**
	 * Debounced ICE restart to prevent multiple simultaneous restart attempts.
	 * Includes cooldown period and proper state tracking.
	 */
	function requestIceRestart(reason: string) {
		if (!pc || pc.signalingState === 'closed') {
			voiceDebug('ICE restart skipped (no connection or closed)', { reason });
			return;
		}

		const now = Date.now();
		const timeSinceLastRestart = now - lastIceRestartTime;
		const timeSinceLastSuccess = now - lastSuccessfulConnectionTime;

		// If we recently had a successful connection, be more conservative
		if (lastSuccessfulConnectionTime > 0 && timeSinceLastSuccess < ICE_RESTART_COOLDOWN_MS) {
			voiceDebug('ICE restart deferred (in cooldown after success)', {
				reason,
				timeSinceLastSuccess,
				cooldown: ICE_RESTART_COOLDOWN_MS
			});
			return;
		}

		// Debounce rapid restart requests
		if (timeSinceLastRestart < ICE_RESTART_DEBOUNCE_MS) {
			if (!iceRestartPending) {
				iceRestartPending = true;
				voiceDebug('ICE restart debounced', {
					reason,
					timeSinceLastRestart,
					debounceMs: ICE_RESTART_DEBOUNCE_MS
				});
				if (iceRestartTimer) clearTimeout(iceRestartTimer);
				iceRestartTimer = setTimeout(() => {
					iceRestartTimer = null;
					iceRestartPending = false;
					executeIceRestart(reason);
				}, ICE_RESTART_DEBOUNCE_MS - timeSinceLastRestart);
			}
			return;
		}

		// Clear any pending debounced restart
		if (iceRestartTimer) {
			clearTimeout(iceRestartTimer);
			iceRestartTimer = null;
		}
		iceRestartPending = false;
		executeIceRestart(reason);
	}

	function executeIceRestart(reason: string) {
		if (!pc || pc.signalingState === 'closed') {
			voiceDebug('ICE restart execution skipped (connection unavailable)', { reason });
			return;
		}

		lastIceRestartTime = Date.now();
		voiceDebug('Executing ICE restart', {
			reason,
			connectionState: pc.connectionState,
			iceConnectionState: pc.iceConnectionState,
			signalingState: pc.signalingState
		});

		try {
			pc.restartIce();
			// After ICE restart, we should trigger renegotiation as offerer
			if (isOfferer) {
				scheduleRenegotiation('ice-restart', { requireOfferer: true });
			}
		} catch (err) {
			console.warn('ICE restart failed:', err);
			voiceDebug('ICE restart execution failed', {
				reason,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	function clearIceRestartTimer() {
		if (iceRestartTimer) {
			clearTimeout(iceRestartTimer);
			iceRestartTimer = null;
		}
		iceRestartPending = false;
	}

	/**
	 * Start periodic connection health checks to proactively detect degraded connections
	 */
	function startConnectionHealthCheck() {
		stopConnectionHealthCheck();
		if (!browser) return;

		connectionHealthCheckInterval = setInterval(async () => {
			if (!pc || pc.connectionState === 'closed') {
				stopConnectionHealthCheck();
				return;
			}

			// Skip health check if we're in connecting/reconnecting states
			if (isConnecting || isRestartingCall) return;

			try {
				const stats = await pc.getStats();
				let hasActiveConnection = false;
				let currentRtt: number | null = null;
				let packetLossRate: number | null = null;

				stats.forEach((report) => {
					if (report.type === 'candidate-pair' && report.state === 'succeeded') {
						hasActiveConnection = true;
						if (typeof report.currentRoundTripTime === 'number') {
							currentRtt = report.currentRoundTripTime * 1000; // Convert to ms
						}
					}
					if (report.type === 'inbound-rtp' && report.kind === 'audio') {
						const packetsLost = report.packetsLost || 0;
						const packetsReceived = report.packetsReceived || 0;
						const totalPackets = packetsLost + packetsReceived;
						if (totalPackets > 0) {
							packetLossRate = (packetsLost / totalPackets) * 100;
						}
					}
				});

				// Check for connection health issues
				if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected') {
					consecutiveHealthCheckFailures = 0;
					lastSuccessfulConnectionTime = Date.now();

					// Log significant RTT or packet loss
					if (currentRtt !== null && currentRtt > 500) {
						voiceDebug('High latency detected', { rtt: currentRtt });
					}
					if (packetLossRate !== null && packetLossRate > 5) {
						voiceDebug('High packet loss detected', { packetLossRate });
					}
				} else if (!hasActiveConnection && isJoined) {
					consecutiveHealthCheckFailures++;
					voiceDebug('Connection health check: no active candidate pair', {
						failures: consecutiveHealthCheckFailures,
						connectionState: pc.connectionState,
						iceConnectionState: pc.iceConnectionState
					});

					if (consecutiveHealthCheckFailures >= MAX_HEALTH_CHECK_FAILURES) {
						voiceDebug('Connection health check: triggering ICE restart after repeated failures');
						requestIceRestart('health-check-failure');
						consecutiveHealthCheckFailures = 0;
					}
				}
			} catch (err) {
				voiceDebug('Connection health check failed', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		}, CONNECTION_HEALTH_CHECK_INTERVAL_MS);
	}

	function stopConnectionHealthCheck() {
		if (connectionHealthCheckInterval) {
			clearInterval(connectionHealthCheckInterval);
			connectionHealthCheckInterval = null;
		}
		consecutiveHealthCheckFailures = 0;
	}

	function createPeerConnection() {
		if (pc) return pc;
		const config = buildRtcConfiguration();
		const connection = new RTCPeerConnection(config);
		pc = connection;
		clearPendingRemoteCandidates();
		resetPeerDiagnostics();
		updatePeerConnectionStateSnapshot(connection);
		const maskedServers = (config.iceServers ?? []).map((server) => ({
			urls: server.urls,
			username: server.username ? '***' : undefined,
			credential: server.credential ? '***' : undefined
		}));
		voiceDebug('createPeerConnection', {
			iceServers: maskedServers,
			forceRelayIceTransport: forceRelayIceTransport && hasTurnServers,
			hasTurnServers,
			usingFallbackTurnServers
		});

		const audioTransceiver = connection.addTransceiver('audio', { direction: 'sendrecv' });
		const videoTransceiver = connection.addTransceiver('video', { direction: 'sendrecv' });
		audioTransceiverRef = audioTransceiver;
		videoTransceiverRef = videoTransceiver;
		audioSender = audioTransceiver.sender;
		videoSender = videoTransceiver.sender;
		syncLocalTracksToPeer();
		applyTrackStates();

		connection.onsignalingstatechange = () => {
			updatePeerConnectionStateSnapshot(pc);
			const state = pc?.signalingState ?? 'closed';
			voiceDebug('signalingstatechange', {
				state,
				iceConnectionState: pc?.iceConnectionState ?? null,
				iceGatheringState: pc?.iceGatheringState ?? null
			});
			if (pc?.remoteDescription) {
				flushPendingRemoteIceCandidates(pc);
			}
			if (state === 'stable' && renegotiationAwaitingStable) {
				renegotiationAwaitingStable = false;
				const requireOfferer = renegotiationNeedsPromotion && !isOfferer;
				renegotiationNeedsPromotion = false;
				voiceDebug('signaling state stable - flushing pending renegotiation', {
					reasons: pendingRenegotiationReasons,
					requireOfferer
				});
				scheduleRenegotiation('signaling-stable', { requireOfferer });
			}
		};

		connection.onnegotiationneeded = () => {
			voiceDebug('negotiationneeded event', {
				isOfferer,
				hasCallRef: !!callRef,
				negotiationInFlight: !!negotiationInFlight
			});
			if (!callRef) {
				voiceDebug('negotiationneeded ignored (no active callRef)');
				return;
			}
			scheduleRenegotiation('negotiationneeded', { requireOfferer: true });
		};

		connection.ontrack = (event) => {
			const track = event.track;
			const [stream] = event.streams ?? [];
			const incoming = stream ?? new MediaStream();

			voiceDebug('Received remote track', {
				mid: event.transceiver?.mid ?? 'unknown',
				kind: track.kind,
				id: track.id,
				muted: track.muted,
				enabled: track.enabled,
				readyState: track.readyState,
				streamId: incoming.id,
				hasStream: !!stream
			});

			if (!stream) {
				incoming.addTrack(track);
			}

			// Force enable the track - remote tracks may come in disabled
			if (!track.enabled) {
				voiceDebug('Enabling disabled remote track', { kind: track.kind, id: track.id });
				track.enabled = true;
			}

			const syncRemoteStream = (reason: string) => {
				updateRemoteStreams((draft) => {
					const current = draft.get(incoming.id);
					if (current && current !== incoming) {
						if (!current.getTracks().some((existing) => existing.id === track.id)) {
							current.addTrack(track);
						}
						draft.set(incoming.id, current);
					} else {
						draft.set(incoming.id, incoming);
					}
				}, `track-${reason}`);
				
				// After updating remote streams, trigger UI refresh for audio/video elements
				refreshRemoteMediaElements(incoming.id);
				
				voiceDebug('Remote stream synced', {
					streamId: incoming.id,
					reason,
					trackId: track.id,
					trackState: track.readyState,
					muted: track.muted,
					enabled: track.enabled,
					audioTracks: incoming.getAudioTracks().length,
					videoTracks: incoming.getVideoTracks().length
				});
			};

			syncRemoteStream('ontrack');

			track.onunmute = () => {
				voiceDebug('Remote track unmuted', {
					id: track.id,
					kind: track.kind,
					streamId: incoming.id,
					enabled: track.enabled
				});
				// Ensure track is enabled when unmuted
				if (!track.enabled) {
					track.enabled = true;
				}
				syncRemoteStream('track-unmuted');
			};

			track.onmute = () => {
				voiceDebug('Remote track muted', {
					id: track.id,
					kind: track.kind,
					streamId: incoming.id
				});
			};

			track.onended = () => {
				voiceDebug('Remote track ended', {
					id: track.id,
					kind: track.kind,
					streamId: incoming.id
				});
				updateRemoteStreams((draft) => {
					const current = draft.get(incoming.id);
					if (!current) return;
					current.removeTrack(track);
					if (current.getTracks().length === 0) {
						draft.delete(incoming.id);
					} else {
						draft.set(incoming.id, current);
					}
				}, 'track-ended');
			};
		};

		connection.onconnectionstatechange = () => {
			if (!pc) return;
			updatePeerConnectionStateSnapshot(pc);
			voiceDebug('connectionstatechange', {
				state: pc.connectionState,
				iceConnectionState: pc.iceConnectionState,
				iceGatheringState: pc.iceGatheringState,
				signalingState: pc.signalingState
			});
			switch (pc.connectionState) {
				case 'connecting':
					statusMessage = 'Connecting...';
					break;
				case 'connected':
					statusMessage = 'Connected.';
					clearReconnectTimer();
					clearIceRestartTimer();
					consecutiveIceErrors = 0;
					lastIceErrorTimestamp = 0;
					connectionFailureCount = 0;
					lastSuccessfulConnectionTime = Date.now();
					consecutiveHealthCheckFailures = 0;
					// Start health monitoring once connected
					startConnectionHealthCheck();
					scheduleMediaRecovery('connected');
					
					// Re-verify track states and refresh media after connection established
					setTimeout(() => {
						applyTrackStates();
						syncLocalTracksToPeer();
						// Update presence to ensure remote peers have our streamId
						updateParticipantPresence().catch(() => {});
						// Refresh all remote media elements to ensure playback
						remoteStreams.forEach((stream, streamId) => {
							refreshRemoteMediaElements(streamId);
						});
						voiceDebug('Post-connection media refresh completed');
					}, 500);
					break;
				case 'disconnected':
					statusMessage = 'Connection interrupted. Reconnecting...';
					// Use debounced ICE restart instead of direct call
					requestIceRestart('connection-disconnected');
					if (maybeActivateFallbackTurnFromConnection('connection-disconnected')) {
						break;
					}
					// Only schedule reconnect if ICE restart doesn't recover in time
					// The scheduleReconnect will be a fallback with longer delay
					scheduleReconnect('Rejoining call...', false);
					break;
				case 'failed':
					statusMessage = 'Connection failed. Rejoining...';
					if (maybeActivateFallbackTurnFromConnection('connection-failed')) {
						break;
					}
					// For failed state, be more aggressive with reconnect
					scheduleReconnect('Rejoining call...', true);
					break;
				case 'closed':
					statusMessage = '';
					stopConnectionHealthCheck();
					break;
			}
		};

		connection.oniceconnectionstatechange = () => {
			if (!pc) return;
			updatePeerConnectionStateSnapshot(pc);
			voiceDebug('iceconnectionstatechange', {
				state: pc.iceConnectionState,
				connectionState: pc.connectionState,
				gatheringState: pc.iceGatheringState
			});
			if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
				clearReconnectTimer();
				clearIceRestartTimer();
				consecutiveIceErrors = 0;
				lastIceErrorTimestamp = 0;
				lastSuccessfulConnectionTime = Date.now();
				consecutiveHealthCheckFailures = 0;
			} else if (pc.iceConnectionState === 'failed') {
				// For ICE failure, use debounced restart
				requestIceRestart('ice-connection-failed');
			} else if (pc.iceConnectionState === 'disconnected') {
				// For disconnected, wait briefly then request restart if still disconnected
				setTimeout(() => {
					if (pc?.iceConnectionState === 'disconnected') {
						requestIceRestart('ice-connection-disconnected-timeout');
					}
				}, 1500);
			}
		};

		connection.onicegatheringstatechange = () => {
			updatePeerConnectionStateSnapshot(pc);
			voiceDebug('icegatheringstatechange', pc?.iceGatheringState ?? 'closed');
		};

		const handleIceCandidateError = (event: RTCPeerConnectionIceErrorEvent) => {
			const details: Record<string, unknown> = {
				errorCode: event.errorCode,
				errorText: event.errorText,
				url: event.url ?? null,
				forceRelayIceTransport,
				hasTurnServers,
				usingFallbackTurnServers
			};
			if ('hostCandidate' in event) {
				details.hostCandidate = (event as any).hostCandidate ?? null;
			}
			if ('address' in event) {
				details.address = (event as any).address ?? null;
			}
			if ('port' in event) {
				details.port = (event as any).port ?? null;
			}
			voiceDebug('icecandidateerror', details);

			const now = Date.now();
			if (now - lastIceErrorTimestamp > 7000) {
				consecutiveIceErrors = 0;
			}
			consecutiveIceErrors += 1;
			lastIceErrorTimestamp = now;

			const reconnectWithMessage = (message: string) => {
				capturePeerDiagnostics(connection, 'icecandidateerror');
				scheduleReconnect(message, true);
				consecutiveIceErrors = 0;
				lastIceErrorTimestamp = 0;
			};

			if (event.errorCode === 701) {
				if (
					consecutiveIceErrors >= 2 &&
					tryActivateFallbackTurn('stun-host-error', { consecutiveIceErrors })
				) {
					reconnectWithMessage('Reconnecting with fallback relay...');
					return;
				}
				if (hasTurnServers && !forceRelayIceTransport && consecutiveIceErrors >= 3) {
					forceRelayIceTransport = true;
					voiceDebug('Switching ICE transport policy to relay-only', {
						consecutiveIceErrors,
						usingFallbackTurnServers
					});
					reconnectWithMessage('Rejoining voice via relay...');
					return;
				}
			}

			capturePeerDiagnostics(connection, 'icecandidateerror');
		};
		connection.addEventListener('icecandidateerror', handleIceCandidateError);

		return connection;
	}

	function canUseFallbackTurn(): boolean {
		return allowTurnFallback && !hasTurnServers && !fallbackTurnActivated;
	}

	function activateFallbackTurn(reason: string, context: Record<string, unknown> = {}): void {
		fallbackTurnActivated = true;
		fallbackTurnActivationReason = reason;
		connectionFailureCount = 0;
		lastTurnConfigSignature = null;
		voiceDebug('Activating fallback TURN relay', {
			provider: 'openrelay.metered.ca',
			reason,
			allowTurnFallback,
			...context
		});
	}

	function tryActivateFallbackTurn(reason: string, context: Record<string, unknown> = {}): boolean {
		if (!canUseFallbackTurn()) return false;
		activateFallbackTurn(reason, context);
		return true;
	}

	function maybeActivateFallbackTurnFromConnection(reason: string): boolean {
		if (!canUseFallbackTurn()) return false;
		connectionFailureCount += 1;
		voiceDebug('Connection failure recorded', { reason, connectionFailureCount });
		if (connectionFailureCount < 2) {
			return false;
		}
		activateFallbackTurn(reason, { connectionFailureCount });
		scheduleReconnect('Rejoining with fallback relay...', true);
		return true;
	}

	async function renegotiateOffer() {
		if (!pc || !callRef || !isOfferer) {
			voiceDebug('renegotiateOffer skipped', { hasPc: !!pc, hasCallRef: !!callRef, isOfferer });
			return;
		}
		const connection = pc;
		if (connection.signalingState !== 'stable') {
			voiceDebug('renegotiateOffer skipped (signaling not stable)', connection.signalingState);
			return;
		}
		const currentUser = get(user);
		const previousRevision = lastOfferRevision;
		try {
			applyTrackStates();
			const revision = previousRevision + 1;
			voiceDebug('Creating renegotiation offer', { revision, previousRevision });
			setActiveOfferRevision(revision, 'renegotiate-offer');
			attachOffererIceHandlers(connection);
			const offerDescription = await connection.createOffer();
			await connection.setLocalDescription(offerDescription);
			if (descriptionStorageEnabled && offerDescriptionRef) {
				try {
					await setDoc(
						offerDescriptionRef,
						{
							type: offerDescription.type,
							revision,
							sdp: offerDescription.sdp,
							length: offerDescription.sdp?.length ?? 0,
							updatedAt: serverTimestamp(),
							updatedBy: currentUser?.uid ?? null
						},
						{ merge: true }
					);
				} catch (err) {
					console.warn('Failed to persist offer description doc', err);
					voiceDebug('Failed to persist offer description doc', err);
					if (isPermissionError(err)) {
						disableDescriptionStorage(err);
					}
				}
			}
			latestOfferDescription = {
				revision,
				type: offerDescription.type,
				sdp: offerDescription.sdp ?? ''
			};
			const offerPayload: Record<string, unknown> = {
				type: offerDescription.type,
				revision,
				length: offerDescription.sdp?.length ?? 0,
				updatedAt: serverTimestamp(),
				updatedBy: currentUser?.uid ?? null
			};
			if (offerDescription.sdp) {
				offerPayload.sdp = offerDescription.sdp;
			}
			const batch = writeBatch(getDb());
			batch.set(
				callRef,
				{
					offer: offerPayload,
					answer: deleteField(),
					answeredAt: deleteField(),
					answeredBy: deleteField()
				},
				{ merge: true }
			);
			lastAnswerRevision = 0;
			batch.set(
				doc(callRef, 'revisions', String(revision)),
				{
					revision,
					updatedAt: serverTimestamp(),
					updatedBy: currentUser?.uid ?? null
				},
				{ merge: true }
			);
			if (answerDescriptionRef) {
				batch.delete(answerDescriptionRef);
				latestAnswerDescription = null;
			}
			const legacyDeletes = await queueLegacyCandidateDeletes(batch, callRef);
			const revisionDeletes = await queueRevisionCandidateDeletes(batch, callRef, previousRevision);
			await batch.commit();
			voiceDebug('Renegotiation offer published', {
				revision,
				legacyDeletes,
				revisionDeletes
			});
		} catch (err) {
			console.warn('Failed to renegotiate offer', err);
			voiceDebug('Renegotiation offer failed', err);
			statusMessage = 'Trouble updating the call. Try rejoining if issues continue.';
		}
	}

	function subscribeParticipants() {
		participantsUnsub?.();
		if (!participantsCollectionRef) {
			participants = [];
			lastParticipantsSnapshot = null;
			return;
		}
		participantsUnsub = onSnapshot(
			participantsCollectionRef,
			(snapshot) => {
				const mapped = snapshot.docs
					.map((d) => {
						const data = d.data() as any;
						const status = (data.status ?? 'active') as 'active' | 'left' | 'removed';
						return {
							uid: data.uid ?? d.id,
							displayName: data.displayName ?? 'Member',
							photoURL: resolveProfilePhotoURL(data),
							authPhotoURL: pickString(data.authPhotoURL) ?? null,
							hasAudio: data.hasAudio ?? false,
							hasVideo: data.hasVideo ?? false,
							screenSharing: data.screenSharing ?? data.isScreenSharing ?? false,
							status,
							joinedAt: data.joinedAt ?? null,
							updatedAt: data.updatedAt ?? null,
							streamId: data.streamId ?? null,
							kickedBy: data.kickedBy ?? null,
							removedAt: data.removedAt ?? data.leftAt ?? null,
							renegotiationRequestId: data.renegotiationRequestId ?? null,
							renegotiationRequestReason: data.renegotiationRequestReason ?? null,
							renegotiationRequestedAt: data.renegotiationRequestedAt ?? null,
							renegotiationResolvedAt: data.renegotiationResolvedAt ?? null
						} as ParticipantState;
					})
					.sort((a, b) => {
						const aTime = a.joinedAt?.toMillis?.() ?? 0;
						const bTime = b.joinedAt?.toMillis?.() ?? 0;
						return aTime - bTime;
					});

				processParticipantRenegotiationRequests(mapped);

				const current = get(user);
				const currentUid = current?.uid ?? null;
				const selfEntry = currentUid ? mapped.find((p) => p.uid === currentUid) : null;
				const snapshotSummary = mapped.map((p) => ({
					uid: p.uid,
					status: p.status ?? 'active',
					hasAudio: p.hasAudio,
					hasVideo: p.hasVideo,
					streamId: p.streamId ?? null,
					screenSharing: p.screenSharing ?? false
				}));
				if (selfEntry && selfEntry.status && selfEntry.status !== 'active' && isJoined) {
					voiceDebug('Self participant status changed', {
						status: selfEntry.status,
						joined: isJoined,
						reason: 'subscribeParticipants'
					});
					if (selfEntry.status === 'removed') {
						statusMessage = '';
						errorMessage = 'You were removed from this voice channel by a moderator.';
					} else if (!errorMessage) {
						statusMessage = 'You have left the call.';
					}
					voiceSession.leave();
				}

				if (lastParticipantsSnapshot && participantsEqual(mapped, lastParticipantsSnapshot)) {
					voiceDebug('Participant snapshot unchanged', {
						total: snapshotSummary.length,
						active: snapshotSummary.filter((p) => (p.status ?? 'active') === 'active').length,
						summary: snapshotSummary
					});
					return;
				}
				voiceDebug('Participant snapshot updated', {
					total: snapshotSummary.length,
					active: snapshotSummary.filter((p) => (p.status ?? 'active') === 'active').length,
					summary: snapshotSummary
				});
				
				// Detect new participants who joined (for audio setup)
				const previousActiveUids = new Set(lastParticipantsSnapshot?.filter(p => (p.status ?? 'active') === 'active').map(p => p.uid) ?? []);
				const newActiveParticipants = mapped.filter(p => 
					(p.status ?? 'active') === 'active' && 
					!previousActiveUids.has(p.uid) &&
					p.uid !== currentUid
				);
				
				if (newActiveParticipants.length > 0) {
					voiceDebug('New participants joined', { 
						uids: newActiveParticipants.map(p => p.uid),
						streamIds: newActiveParticipants.map(p => p.streamId ?? null)
					});
					
					// Refresh remote media elements for new participants after delays
					const refreshParticipants = () => {
						newActiveParticipants.forEach(p => {
							if (p.streamId) {
								refreshRemoteMediaElements(p.streamId);
							}
							refreshAudioForParticipant(p.uid);
						});
					};
					
					setTimeout(() => {
						refreshParticipants();
						syncLocalTracksToPeer();
					}, 2000);
					
					setTimeout(refreshParticipants, 3000);
					setTimeout(refreshParticipants, 5000);
					scheduleMediaRecovery('participant-joined');
				}
				
				// Detect participants who left (for cleanup)
				const nextActiveUids = new Set(mapped.filter(p => (p.status ?? 'active') === 'active').map(p => p.uid));
				const departedUids = Array.from(previousActiveUids).filter(uid => !nextActiveUids.has(uid));
				
				if (departedUids.length > 0) {
					voiceDebug('Participants left', { uids: departedUids });
					// Cleanup audio playback and streams for departed participants
					departedUids.forEach(uid => {
						destroyAudioPlayback(uid);
						participantControls.delete(uid);
					});
					
					// When a participant leaves, if we're the offerer, we need to create a fresh offer
					// so that when they (or anyone else) rejoins, they can properly answer it.
					// This ensures the signaling state is ready for new answerers.
					if (isOfferer && isJoined && pc && pc.signalingState === 'stable') {
						voiceDebug('Participant left while we are offerer - creating fresh offer for future joiners');
						scheduleRenegotiation('participant-left-refresh-offer', { requireOfferer: true });
					}
				}
				
				lastParticipantsSnapshot = mapped;
				participants = mapped.filter((p) => (p.status ?? 'active') === 'active');
				voiceDebug('Active participant list refreshed', {
					activeCount: participants.length,
					uids: participants.map((p) => p.uid),
					media: participants.map((p) => ({
						uid: p.uid,
						hasAudio: p.hasAudio,
						hasVideo: p.hasVideo,
						streamId: p.streamId ?? null,
						screenSharing: p.screenSharing ?? false
					}))
				});
			},
			(err) => {
				console.warn('Failed to subscribe to participants', err);
				voiceDebug('Participant subscription error', err instanceof Error ? err.message : err);
				participants = [];
				lastParticipantsSnapshot = null;
			}
		);
	}

	function cleanupMyProfileSubscription() {
		myProfileUnsub?.();
		myProfileUnsub = null;
		myProfile = null;
	}

	function subscribeToMyProfile(database: ReturnType<typeof getDb>, uid: string) {
		cleanupMyProfileSubscription();
		myProfileUnsub = onSnapshot(doc(database, 'profiles', uid), (snap) => {
			myProfile = snap.exists() ? ((snap.data() as any) ?? {}) : null;
		});
	}

	function computeSelfIdentity() {
		const current = get(user);
		const profile = myProfile ?? {};
		const displayName =
			pickString(profile?.displayName) ??
			pickString(profile?.name) ??
			pickString(current?.displayName) ??
			pickString(current?.email) ??
			'Member';
		const authFallback = pickString(profile?.authPhotoURL) ?? pickString(current?.photoURL) ?? null;
		const resolvedPhoto = resolveProfilePhotoURL(profile, authFallback);
		return {
			displayName,
			photoURL: resolvedPhoto,
			authPhotoURL: authFallback
		};
	}

	async function updateParticipantPresence(
		extra: Partial<ParticipantState> = {},
		identity?: ReturnType<typeof computeSelfIdentity>
	) {
		if (!participantDocRef) return;
		const current = get(user);
		if (!current?.uid) return;
		emitVoiceActivity('presence-update');

		const info = identity ?? computeSelfIdentity();

		const payload = {
			uid: current.uid,
			displayName: info.displayName,
			photoURL: info.photoURL ?? null,
			authPhotoURL: info.authPhotoURL ?? null,
			hasAudio: hasAudioTrack && !isMicMuted,
			hasVideo: hasVideoTrack && (!isCameraOff || isScreenSharing),
			screenSharing: isScreenSharing,
			streamId: localStream?.id ?? null,
			status: 'active' as const,
			updatedAt: serverTimestamp(),
			...extra
		};

		const comparable: Record<string, unknown> = { ...payload };
		delete comparable.updatedAt;

		if (!extra.joinedAt) {
			if (lastPresencePayload && shallowEqual(lastPresencePayload, comparable)) {
				return;
			}
			lastPresencePayload = comparable;
		}

		const performWrite = async () => {
			try {
				voiceDebug('updateParticipantPresence write', payload);
				await setDoc(participantDocRef!, payload, { merge: true });
			} catch (err) {
				console.warn('Failed to update presence', err);
				voiceDebug('updateParticipantPresence failed', err);
				if (!extra.joinedAt) {
					errorMessage = err instanceof Error ? err.message : 'Unable to update your voice status.';
				}
			}
		};

		if (extra.joinedAt) {
			lastPresencePayload = comparable;
			await performWrite();
			return;
		}

		if (presenceDebounce) {
			clearTimeout(presenceDebounce);
		}

		presenceDebounce = setTimeout(() => {
			presenceDebounce = null;
			performWrite().catch((err) => {
				console.warn(err);
				voiceDebug('updateParticipantPresence debounced write failed', err);
			});
		}, 250);
	}

	type PurgeOptions = {
		includeDescriptions?: boolean;
		includeLegacyCandidates?: boolean;
		includeRevisionCandidates?: boolean;
	};

	async function purgeCallArtifacts(
		targetRef: DocumentReference | null = callRef,
		options: PurgeOptions = {}
	) {
		if (!targetRef) return;
		const {
			includeDescriptions = true,
			includeLegacyCandidates = true,
			includeRevisionCandidates = true
		} = options;
		voiceDebug('purgeCallArtifacts start', {
			includeDescriptions,
			includeLegacyCandidates,
			includeRevisionCandidates
		});
		let legacyOfferCount = 0;
		let legacyAnswerCount = 0;
		let revisionOfferCount = 0;
		let revisionAnswerCount = 0;
		let revisionDocs = 0;
		let descriptionCount = 0;
		if (includeLegacyCandidates) {
			const offerSnap = await getDocs(collection(targetRef, 'offerCandidates'));
			legacyOfferCount = offerSnap.size;
			for (const snap of offerSnap.docs) {
				await deleteDoc(snap.ref);
			}
			const answerSnap = await getDocs(collection(targetRef, 'answerCandidates'));
			legacyAnswerCount = answerSnap.size;
			for (const snap of answerSnap.docs) {
				await deleteDoc(snap.ref);
			}
		}
		if (includeRevisionCandidates) {
			const revisionsSnap = await getDocs(collection(targetRef, 'revisions'));
			revisionDocs = revisionsSnap.size;
			for (const revisionDoc of revisionsSnap.docs) {
				const offerSnap = await getDocs(collection(revisionDoc.ref, 'offerCandidates'));
				revisionOfferCount += offerSnap.size;
				for (const snap of offerSnap.docs) {
					await deleteDoc(snap.ref);
				}
				const answerSnap = await getDocs(collection(revisionDoc.ref, 'answerCandidates'));
				revisionAnswerCount += answerSnap.size;
				for (const snap of answerSnap.docs) {
					await deleteDoc(snap.ref);
				}
				await deleteDoc(revisionDoc.ref).catch(() => {});
			}
		}
		if (includeDescriptions) {
			try {
				const descriptionSnap = await getDocs(collection(targetRef, 'descriptions'));
				descriptionCount = descriptionSnap.size;
				for (const snap of descriptionSnap.docs) {
					await deleteDoc(snap.ref);
				}
			} catch (err) {
				if (!isPermissionError(err)) {
					console.warn('Failed to purge call descriptions', err);
					voiceDebug('Failed to purge call descriptions', err);
				}
			}
		}
		voiceDebug('purgeCallArtifacts complete', {
			legacyOfferCount,
			legacyAnswerCount,
			revisionOfferCount,
			revisionAnswerCount,
			revisionDocs,
			descriptionCount
		});
	}

	async function queueLegacyCandidateDeletes(
		batch: ReturnType<typeof writeBatch>,
		targetRef: DocumentReference
	) {
		const [offerSnap, answerSnap] = await Promise.all([
			getDocs(collection(targetRef, 'offerCandidates')),
			getDocs(collection(targetRef, 'answerCandidates'))
		]);
		offerSnap.docs.forEach((snap) => batch.delete(snap.ref));
		answerSnap.docs.forEach((snap) => batch.delete(snap.ref));
		return { offerCount: offerSnap.size, answerCount: answerSnap.size };
	}

	async function queueRevisionCandidateDeletes(
		batch: ReturnType<typeof writeBatch>,
		targetRef: DocumentReference,
		revision: number
	) {
		if (revision <= 0) {
			return { offerCount: 0, answerCount: 0 };
		}
		const revisionRef = doc(targetRef, 'revisions', String(revision));
		const [offerSnap, answerSnap] = await Promise.all([
			getDocs(collection(revisionRef, 'offerCandidates')),
			getDocs(collection(revisionRef, 'answerCandidates'))
		]);
		offerSnap.docs.forEach((snap) => batch.delete(snap.ref));
		answerSnap.docs.forEach((snap) => batch.delete(snap.ref));
		if (!offerSnap.empty || !answerSnap.empty) {
			batch.delete(revisionRef);
		}
		return { offerCount: offerSnap.size, answerCount: answerSnap.size };
	}

	async function publishAnswerForRevision(
		docRef: DocumentReference,
		answerData: Record<string, unknown>,
		revision: number,
		currentUid: string | null
	) {
		try {
			await runTransaction(getDb(), async (transaction) => {
				const snap = await transaction.get(docRef);
				if (!snap.exists()) {
					throw new Error('offer-missing');
				}
				const data = snap.data() as any;
				const currentRevision = data?.offer?.revision ?? 0;
				if (currentRevision !== revision) {
					throw new Error('offer-revision-mismatch');
				}
				transaction.update(docRef, {
					answer: answerData,
					answeredAt: serverTimestamp(),
					answeredBy: currentUid
				});
			});
			return { published: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message === 'offer-revision-mismatch' || message === 'offer-missing') {
				const latestSnap = await getDoc(docRef);
				const latestRevision = latestSnap.data()?.offer?.revision ?? 0;
				voiceDebug('Answer write blocked due to revision mismatch', {
					expectedRevision: revision,
					latestRevision
				});
				return { published: false, latestRevision };
			}
			throw err;
		}
	}

	async function hasActiveParticipants(targetRef: DocumentReference): Promise<boolean> {
		try {
			const snapshot = await getDocs(collection(targetRef, 'participants'));
			for (const snap of snapshot.docs) {
				const data = snap.data() as any;
				const status = (data?.status ?? 'active') as string;
				if (status !== 'left' && status !== 'removed') {
					return true;
				}
			}
		} catch (err) {
			voiceDebug('hasActiveParticipants failed', err);
		}
		return false;
	}

	async function startAsOfferer(
		connection: RTCPeerConnection,
		docRef: DocumentReference,
		currentUser: { uid?: string | null } | null,
		existingData: any | null
	) {
		const currentUid = currentUser?.uid ?? null;
		isOfferer = true;
		processedRenegotiationSignals.clear();
		const previousOfferRevision = existingData?.offer?.revision ?? 0;
		lastAnswerRevision = existingData?.answer?.revision ?? 0;
		voiceDebug('Joining voice channel as offerer', {
			lastOfferRevision: previousOfferRevision,
			lastAnswerRevision
		});
		const activeParticipants = await hasActiveParticipants(docRef);
		if (activeParticipants) {
			voiceDebug('Skipping purgeCallArtifacts (active participants present)');
		} else {
			await purgeCallArtifacts(docRef, { includeDescriptions: false });
		}
		const offerRevision = previousOfferRevision + 1;
		setActiveOfferRevision(offerRevision, 'start-offerer');
		attachOffererIceHandlers(connection);

		syncLocalTracksToPeer();
		applyTrackStates();

		const offerDescription = await connection.createOffer();
		await connection.setLocalDescription(offerDescription);

		if (descriptionStorageEnabled && offerDescriptionRef) {
			try {
				await setDoc(
					offerDescriptionRef,
					{
						type: offerDescription.type,
						revision: offerRevision,
						sdp: offerDescription.sdp,
						length: offerDescription.sdp?.length ?? 0,
						updatedAt: serverTimestamp(),
						updatedBy: currentUid
					},
					{ merge: true }
				);
			} catch (err) {
				console.warn('Failed to persist offer description doc', err);
				voiceDebug('Failed to persist offer description doc', err);
				if (isPermissionError(err)) {
					disableDescriptionStorage(err);
				}
			}
		}
		latestOfferDescription = {
			revision: offerRevision,
			type: offerDescription.type,
			sdp: offerDescription.sdp ?? ''
		};
		const offerData: Record<string, unknown> = {
			type: offerDescription.type,
			revision: offerRevision,
			length: offerDescription.sdp?.length ?? 0,
			updatedAt: serverTimestamp(),
			updatedBy: currentUid
		};
		if (offerDescription.sdp) {
			offerData.sdp = offerDescription.sdp;
		}
		const batch = writeBatch(getDb());
		batch.set(
			docRef,
			{
				offer: offerData,
				answer: deleteField(),
				answeredAt: deleteField(),
				answeredBy: deleteField(),
				createdAt: existingData?.createdAt ?? serverTimestamp(),
				createdBy: existingData?.createdBy ?? currentUid
			},
			{ merge: true }
		);
		lastAnswerRevision = 0;
		batch.set(
			doc(docRef, 'revisions', String(offerRevision)),
			{
				revision: offerRevision,
				updatedAt: serverTimestamp(),
				updatedBy: currentUid
			},
			{ merge: true }
		);
		if (answerDescriptionRef) {
			batch.delete(answerDescriptionRef);
			latestAnswerDescription = null;
		}
		const legacyDeletes = await queueLegacyCandidateDeletes(batch, docRef);
		const revisionDeletes = await queueRevisionCandidateDeletes(batch, docRef, previousOfferRevision);
		await batch.commit();
		voiceDebug('Published initial offer', {
			offerRevision,
			length: offerDescription.sdp?.length ?? 0,
			legacyDeletes,
			revisionDeletes
		});
	}

	async function joinChannel() {
		console.log('[JOIN] joinChannel start', { serverId, channelId, isJoined, isConnecting });
		voiceDebug('joinChannel start', { serverId, channelId, isJoined, isConnecting });
		if (!serverId || !channelId) {
			console.log('[JOIN] No serverId or channelId');
			errorMessage = 'Select a voice channel to start a call.';
			return;
		}
		if (isJoined || isConnecting) {
			console.log('[JOIN] Already joined or connecting');
			return;
		}

		const current = get(user);
		if (!current?.uid) {
			console.log('[JOIN] No user');
			errorMessage = 'Sign in to join voice.';
			return;
		}

		console.log('[JOIN] Starting connection...');
		isConnecting = true;
		errorMessage = '';
		statusMessage = 'Setting up call...';

		const database = getDb();
		let joinRole: 'offerer' | 'answerer' | null = null;
		let promoteToOfferer = false;

		try {
			await ensureMediaPermissions();
			await prepareInitialLocalTracks('join');
			const connection = createPeerConnection();
			if (!connection) throw new Error('Failed to create peer connection.');

			const docRef = doc(
				database,
				'servers',
				serverId,
				'channels',
				channelId,
				'calls',
				CALL_DOC_ID
			);
			callRef = docRef;

			setCandidateRefsForRevision(0, 'join-init');
			localCandidatesRef = null;
			participantsCollectionRef = collection(docRef, 'participants');
			subscribeParticipants();
			callDescriptionsRef = collection(docRef, 'descriptions');
			offerDescriptionRef = doc(callDescriptionsRef, 'offer');
			answerDescriptionRef = doc(callDescriptionsRef, 'answer');
			descriptionStorageEnabled = true;
			resetCandidateState('join-init');
			remoteIceLogCountOfferer = 0;
			remoteIceLogCountAnswerer = 0;

			participantDocRef = doc(participantsCollectionRef, current.uid);
			lastPresenceSignature = null;

			let existing = await getDoc(docRef);
			let existingData = existing.exists() ? (existing.data() as any) : null;
			if (existingData) {
				const offerLength = existingData?.offer?.length ?? existingData?.offer?.sdp?.length ?? 0;
				const answerLength = existingData?.answer?.length ?? existingData?.answer?.sdp?.length ?? 0;
				if (
					offerLength > CALL_DOC_SDP_RESET_THRESHOLD ||
					answerLength > CALL_DOC_SDP_RESET_THRESHOLD
				) {
					voiceDebug('Existing call doc exceeded size threshold, resetting', {
						offerLength,
						answerLength
					});
					try {
						await purgeCallArtifacts();
						await deleteDoc(docRef);
					} catch (err) {
						console.warn('Failed to reset oversized call doc', err);
						voiceDebug('Failed to reset oversized call doc', err);
					}
					existing = await getDoc(docRef);
					existingData = existing.exists() ? (existing.data() as any) : null;
				}
			}

			attachDescriptionListeners();

			if (!existing.exists() || !existingData?.offer) {
				promoteToOfferer = true;
			} else {
				isOfferer = false;
				processedRenegotiationSignals.clear();
				const initialOfferRevision = existingData?.offer?.revision ?? 1;
				
				const offerUpdatedBy = existingData?.offer?.updatedBy ?? null;
				const answerUpdatedBy = existingData?.answer?.updatedBy ?? null;
				
				// If the existing answer was authored by us (from a previous session),
				// we need to ignore it and create a fresh answer. This handles the rejoin case
				// where user left and is rejoining - they shouldn't use their own old answer.
				const answerIsSelfAuthored = answerUpdatedBy && answerUpdatedBy === current.uid;
				if (answerIsSelfAuthored) {
					voiceDebug('Existing answer was authored by self (rejoin case); will create fresh answer', {
						answerUpdatedBy,
						existingAnswerRevision: existingData?.answer?.revision ?? 0
					});
					lastAnswerRevision = 0;
				} else {
					lastAnswerRevision = existingData?.answer?.revision ?? 0;
				}
				
				setActiveOfferRevision(initialOfferRevision, 'join-answerer');
				voiceDebug('Joining voice channel as answerer', {
					lastOfferRevision,
					lastAnswerRevision
				});
				attachAnswererIceHandlers(connection);

				const selfAuthored =
					offerUpdatedBy &&
					offerUpdatedBy === current.uid &&
					(!existingData?.answer || answerUpdatedBy === current.uid);

				if (selfAuthored) {
					voiceDebug('Existing offer authored by self; resetting call before joining as answerer', {
						offerUpdatedBy,
						answerUpdatedBy
					});
					try {
						await purgeCallArtifacts();
						await deleteDoc(docRef);
					} catch (err) {
						console.warn('Failed to reset self-authored offer', err);
						voiceDebug('Failed to reset self-authored offer', err);
					}
					promoteToOfferer = true;
				}
				
				if (!promoteToOfferer) {
					let attemptData = existingData;
					let answered = false;
					let attempt = 0;
					const maxAttempts = 2;
					while (!answered && attempt < maxAttempts) {
						const offerRevision = attemptData?.offer?.revision ?? 0;
						if (!offerRevision) {
							voiceDebug('Missing offer revision while joining as answerer', { attempt });
							promoteToOfferer = true;
							break;
						}
						setActiveOfferRevision(offerRevision, `join-answerer-attempt-${attempt + 1}`);
						attachAnswererIceHandlers(connection);
						const attemptFallbackOffer =
							typeof attemptData.offer?.sdp === 'string'
								? ({
										type: attemptData.offer.type ?? 'offer',
										sdp: attemptData.offer.sdp
									} as RTCSessionDescriptionInit)
								: null;
						const offerDescription = await ensureOfferDescription(
							offerRevision,
							attemptFallbackOffer
						);
						if (!offerDescription?.sdp) {
							voiceDebug('Offer description missing; promoting to offerer role.');
							try {
								await purgeCallArtifacts();
								await deleteDoc(docRef);
							} catch (err) {
								console.warn('Failed to reset call while taking over as offerer', err);
								voiceDebug('Failed to reset call while taking over as offerer', err);
							}
							promoteToOfferer = true;
							break;
						}
						await connection.setRemoteDescription(new RTCSessionDescription(offerDescription));
						flushPendingRemoteIceCandidates(connection);
						voiceDebug('Applied existing offer', {
							revision: offerRevision,
							length: offerDescription.sdp?.length ?? 0
						});

						syncLocalTracksToPeer();
						applyTrackStates();

						const answerDescription = await connection.createAnswer();
						await connection.setLocalDescription(answerDescription);

						const answerRevision = offerRevision;
						const answerData: Record<string, unknown> = {
							type: answerDescription.type,
							revision: answerRevision,
							length: answerDescription.sdp?.length ?? 0,
							updatedAt: serverTimestamp(),
							updatedBy: current.uid
						};
						if (answerDescription.sdp) {
							answerData.sdp = answerDescription.sdp;
						}
						const publishResult = await publishAnswerForRevision(
							docRef,
							answerData,
							answerRevision,
							current.uid
						);
						if (!publishResult.published) {
							const latestSnap = await getDoc(docRef);
							attemptData = latestSnap.exists() ? ((latestSnap.data() as any) ?? null) : null;
							const latestRevision = attemptData?.offer?.revision ?? 0;
							voiceDebug('Restarting answerer join with latest offer revision', {
								expectedRevision: offerRevision,
								latestRevision,
								attempt
							});
							attempt += 1;
							continue;
						}

						if (descriptionStorageEnabled && answerDescriptionRef) {
							try {
								await setDoc(
									answerDescriptionRef,
									{
										type: answerDescription.type,
										revision: answerRevision,
										sdp: answerDescription.sdp,
										length: answerDescription.sdp?.length ?? 0,
										updatedAt: serverTimestamp(),
										updatedBy: current.uid
									},
									{ merge: true }
								);
							} catch (err) {
								console.warn('Failed to persist initial answer description doc', err);
								voiceDebug('Failed to persist initial answer description doc', err);
								if (isPermissionError(err)) {
									disableDescriptionStorage(err);
								}
							}
						}

						latestAnswerDescription = {
							revision: answerRevision,
							type: answerDescription.type,
							sdp: answerDescription.sdp ?? ''
						};
						lastAnswerRevision = answerRevision;
						voiceDebug('Published initial answer', { answerRevision });
						joinRole = 'answerer';
						answered = true;
					}
					if (!answered && !promoteToOfferer) {
						voiceDebug('Answerer join attempts exhausted; promoting to offerer');
						promoteToOfferer = true;
					}
				}
			}
			
			if (promoteToOfferer) {
				await startAsOfferer(connection, docRef, current, existingData);
				joinRole = 'offerer';
			}

			if (!joinRole) {
				joinRole = isOfferer ? 'offerer' : 'answerer';
			}

			console.log('[JOIN] Updating participant presence...');
			await updateParticipantPresence({ joinedAt: serverTimestamp(), status: 'active' as const });
			console.log('[JOIN] Setting isJoined = true');
			isJoined = true;
			scheduleMediaRecovery('join-complete');
			console.log('[JOIN] isJoined is now:', isJoined);
			startCallTimer();
			emitVoiceActivity('joined');
			playSound('call-join');
			startInactivityHeartbeat();
			console.log('[JOIN] joinChannel complete', { joinRole, isOfferer });
			voiceDebug('joinChannel ready', { joinRole, isOfferer });

			// Start thumbnail publishing if camera is on
			if (!isCameraOff) {
				startThumbnailPublishing();
			}
			callUnsub = onSnapshot(docRef, (snapshot) => {
				sessionQueue = sessionQueue

					.then(async () => {
						const data = snapshot.data();

						callSnapshotDebug = data ? toDisplayString(data) : '';

						if (!data) {
							statusMessage = 'Call ended.';

							await hangUp({ cleanupDoc: false }).catch(() => {});

							return;
						}

						const currentUserData = get(user);

						const currentUidValue = currentUserData?.uid ?? null;

						const offer = data.offer;

						if (offer) {
							const revision = offer.revision ?? 1;

							const updatedBy = offer.updatedBy ?? data.createdBy ?? null;

							if (
								revision > lastOfferRevision &&
								(!currentUidValue || updatedBy !== currentUidValue)
							) {
								voiceDebug('Remote published updated offer while we were offerer', {
									revision,
									updatedBy
								});

								const fallbackDescription =
									typeof offer.sdp === 'string'
										? ({ type: offer.type ?? 'offer', sdp: offer.sdp } as RTCSessionDescriptionInit)
										: null;

								const description = await ensureOfferDescription(revision, fallbackDescription);

								if (!description?.sdp) {
									voiceDebug('Missing remote offer description during fallback', { revision });

									return;
								}

								setActiveOfferRevision(revision, 'remote-offer');
								isOfferer = false;
								processedRenegotiationSignals.clear();
								attachAnswererIceHandlers(connection);

								sessionQueue = sessionQueue

									.then(async () => {
										if (!pc) return;

										try {
											// Sync our tracks before processing the offer
											syncLocalTracksToPeer();
											applyTrackStates();
											
											await pc.setRemoteDescription(new RTCSessionDescription(description));
											flushPendingRemoteIceCandidates(pc);

											voiceDebug('Remote offer applied (offerer fallback)', { revision });

											const answerDescription = await pc.createAnswer();

											await pc.setLocalDescription(answerDescription);

											const answerRevision = revision;
											const answerUpdate: Record<string, unknown> = {
												type: answerDescription.type,

												revision: answerRevision,

												length: answerDescription.sdp?.length ?? 0,

												updatedAt: serverTimestamp(),

												updatedBy: currentUidValue
											};

											if (answerDescription.sdp) {
												answerUpdate.sdp = answerDescription.sdp;
											}

											const publishResult = await publishAnswerForRevision(
												callRef!,
												answerUpdate,
												answerRevision,
												currentUidValue
											);
											if (!publishResult.published) {
												voiceDebug('Fallback answer blocked due to revision mismatch', {
													revision: answerRevision,
													latestRevision: publishResult.latestRevision ?? null
												});
												return;
											}

											if (descriptionStorageEnabled && answerDescriptionRef) {
												try {
													await setDoc(
														answerDescriptionRef,

														{
															type: answerDescription.type,

															revision: answerRevision,

															sdp: answerDescription.sdp,

															length: answerDescription.sdp?.length ?? 0,

															updatedAt: serverTimestamp(),

															updatedBy: currentUidValue
														},

														{ merge: true }
													);
												} catch (err) {
													console.warn('Failed to persist fallback answer description doc', err);

													voiceDebug('Failed to persist fallback answer description doc', err);

													if (isPermissionError(err)) {
														disableDescriptionStorage(err);
													}
												}
											}

											latestAnswerDescription = {
												revision: answerRevision,

												type: answerDescription.type,

												sdp: answerDescription.sdp ?? ''
											};

											lastAnswerRevision = answerRevision;

											voiceDebug('Published fallback answer', { revision: answerRevision });
											
											// After answering a new offer, refresh audio for all remote participants
											// since the media may have changed
											setTimeout(() => {
												participants.forEach(p => {
													if (p.uid !== currentUidValue) {
														refreshAudioForParticipant(p.uid);
													}
												});
											}, 500);
											setTimeout(() => {
												participants.forEach(p => {
													if (p.uid !== currentUidValue) {
														refreshAudioForParticipant(p.uid);
													}
												});
											}, 2000);
										} catch (err) {
											console.warn('Failed to process remote offer while offerer', err);

											voiceDebug('Failed to process remote offer while offerer', err);
										}
									})

									.catch((err) => {
										console.warn('Failed to queue fallback answer', err);

										voiceDebug('Failed to queue fallback answer', err);
									});

								return;
							}
						}

						const answer = data.answer;

						if (answer) {
							const revision = answer.revision ?? 1;

							if (revision !== lastOfferRevision) {
								voiceDebug('Ignoring remote answer (revision mismatch)', {
									revision,
									activeRevision: lastOfferRevision
								});
								return;
							}
							const hasRemoteDescription = !!connection.currentRemoteDescription;
							if (revision <= lastAnswerRevision && hasRemoteDescription) {
								return;
							}
							if (revision <= lastAnswerRevision && !hasRemoteDescription) {
								voiceDebug('Re-applying remote answer (missing remote description)', {
									revision,
									lastAnswerRevision
								});
							}
							{
								const fallbackAnswer =
									typeof answer.sdp === 'string'
										? ({
												type: answer.type ?? 'answer',
												sdp: answer.sdp
											} as RTCSessionDescriptionInit)
										: null;

								const description = await ensureAnswerDescription(revision, fallbackAnswer);

								if (!description?.sdp) {
									voiceDebug('Remote answer description missing', { revision });

									return;
								}

								voiceDebug('Applying remote answer', {
									revision,
									length: description.sdp?.length ?? 0
								});

								if (connection.signalingState !== 'have-local-offer') {
									voiceDebug('Remote answer received but signaling not in have-local-offer state', {
										revision,
										signalingState: connection.signalingState
									});
									
									// If we're in stable state and receive a new answer, it means a participant
									// rejoined and sent an answer to our OLD offer. We need to renegotiate.
									if (connection.signalingState === 'stable') {
										voiceDebug('Triggering renegotiation to establish fresh connection with rejoining participant');
										scheduleRenegotiation('answer-received-in-stable-state', { requireOfferer: true });
									}
									return;
								}

								connection

									.setRemoteDescription(new RTCSessionDescription(description))

									.then(() => {
										lastAnswerRevision = revision;

										voiceDebug('Remote answer applied', { revision });

										flushPendingRemoteIceCandidates(connection);
										
										// After applying remote answer, schedule audio refresh
										// to ensure audio playback is set up for all participants
										setTimeout(() => {
											participants.forEach(p => {
												if (p.uid !== currentUidValue) {
													refreshAudioForParticipant(p.uid);
												}
											});
										}, 500);
										setTimeout(() => {
											participants.forEach(p => {
												if (p.uid !== currentUidValue) {
													refreshAudioForParticipant(p.uid);
												}
											});
										}, 2000);
									})

									.catch((err) => {
										console.warn('Failed to set remote description', err);

										voiceDebug('Failed to set remote description', err);
										
										// If applying the answer failed, it might be due to mismatched offer/answer
										// (e.g., from a rejoining participant). Trigger renegotiation to recover.
										voiceDebug('Triggering renegotiation after failed answer application');
										scheduleRenegotiation('answer-application-failed', { requireOfferer: true });
									});
							}
						}
					})

					.catch((err) => {
						console.warn('Failed to queue offer snapshot handler', err);

						voiceDebug('Failed to queue offer snapshot handler', err);
					});
			});
		} catch (err) {
			const code = (err as any)?.code ?? 'unknown';
			const path =
				serverId && channelId
					? `servers/${serverId}/channels/${channelId}/calls/${CALL_DOC_ID}`
					: 'unknown';
			console.error('Failed to join voice call', { err, code, path });
			voiceDebug('Failed to join voice call', { err, code, path });
			errorMessage =
				err instanceof Error
					? `${err.message} (code: ${code}, path: ${path})`
					: `Unable to join the call. (code: ${code}, path: ${path})`;
			await hangUp({ cleanupDoc: false, resetError: false });
		} finally {
			isConnecting = false;
		}
	}

	async function hangUp(
		options: { cleanupDoc?: boolean; resetError?: boolean; preserveMediaState?: boolean } = {}
	) {
		voiceDebug('hangUp start', options);
		reconnectAttemptCount = 0;
		connectionFailureCount = 0;
		consecutiveHealthCheckFailures = 0;
		lastSuccessfulConnectionTime = 0;
		const { cleanupDoc = true, resetError = true, preserveMediaState = false } = options;
		const wasJoined = isJoined;

		if (wasJoined) {
			playSound('call-leave');
		}

		clearReconnectTimer();
		clearIceRestartTimer();
		resetMediaRecovery('hangup');
		stopConnectionHealthCheck();
		clearInactivityTimer();
		stopInactivityHeartbeat();
		stopCallTimer();
		stopThumbnailPublishing();
		lastPresencePayload = null;
		lastParticipantsSnapshot = null;
		if (presenceDebounce) {
			clearTimeout(presenceDebounce);
			presenceDebounce = null;
		}

		const participantRef = participantDocRef;
		participantDocRef = null;
		lastPresenceSignature = null;
		cleanupMyProfileSubscription();

		callUnsub?.();
		detachCandidateSubscriptions();
		participantsUnsub?.();
		offerDescriptionUnsub?.();
		answerDescriptionUnsub?.();
		clearPendingRemoteCandidates();

		callUnsub = null;
		participantsUnsub = null;
		offerDescriptionUnsub = null;
		answerDescriptionUnsub = null;
		isOfferer = false;
		processedRenegotiationSignals.clear();
		if (renegotiationSignalClearTimer) {
			clearTimeout(renegotiationSignalClearTimer);
			renegotiationSignalClearTimer = null;
		}
		lastRenegotiationSignalId = null;
		consumedOfferCandidateIds.clear();
		consumedAnswerCandidateIds.clear();
		remoteIceLogCountOfferer = 0;
		remoteIceLogCountAnswerer = 0;
		lastOfferRevision = 0;
		lastAnswerRevision = 0;
		negotiationInFlight = null;
		renegotiationAwaitingStable = false;
		renegotiationNeedsPromotion = false;
		pendingRenegotiationReasons = [];
		if (renegotiationTimer) {
			clearTimeout(renegotiationTimer);
			renegotiationTimer = null;
		}

		if (screenStream) {
			screenStream.getTracks().forEach((track) => {
				track.onended = null;
				track.stop();
			});
		}
		screenStream = null;
		isScreenSharing = false;
		isScreenSharePending = false;
		shouldRestoreCameraOnShareEnd = false;

		const current = get(user);
		const currentUid = current?.uid ?? null;

		if (participantRef) {
			let removed = false;
			try {
				await deleteDoc(participantRef);
				removed = true;
			} catch (err) {
				if ((err as any)?.code !== 'permission-denied') {
					console.warn('Failed to remove participant entry', err);
				}
			}
			if (!removed) {
				try {
					await setDoc(
						participantRef,
						{
							status: 'left',
							hasAudio: false,
							hasVideo: false,
							leftAt: serverTimestamp(),
							updatedAt: serverTimestamp()
						},
						{ merge: true }
					);
				} catch (err) {
					if ((err as any)?.code !== 'permission-denied') {
						console.warn('Failed to mark participant as left', err);
					}
				}
			}
		}

		if (pc) {
			pc.onicecandidate = null;
			pc.ontrack = null;
			pc.onconnectionstatechange = null;
			pc.oniceconnectionstatechange = null;
			audioSender?.replaceTrack(null).catch(() => {});
			videoSender?.replaceTrack(null).catch(() => {});
			pc.close();
			pc = null;
		}
		resetPeerDiagnostics();

		audioSender = null;
		videoSender = null;
		audioTransceiverRef = null;
		videoTransceiverRef = null;

		removeLocalTrack('audio');
		removeLocalTrack('video');
		localStream = null;

		updateRemoteStreams((draft) => draft.clear(), 'hangup-clear');
		remoteConnected = false;
		audioRefs.forEach((node) => {
			node.pause?.();
			node.srcObject = null;
		});
		videoRefs.forEach((node) => {
			node.pause?.();
			node.srcObject = null;
		});
		audioPlayback.forEach((_, uid) => destroyAudioPlayback(uid));
		audioPlayback = new Map();
		audioRefs = new Map();
		videoRefs = new Map();
		if (localVideoEl) {
			localVideoEl.pause?.();
			localVideoEl.srcObject = null;
		}
		audioNeedsUnlock = false;
		resetAudioMonitoring();

		const cleanupRef = callRef;
		const participantsRef = participantsCollectionRef;
		callRef = null;
		offerCandidatesRef = null;
		answerCandidatesRef = null;
		activeCandidateRevision = 0;
		localCandidatesRef = null;
		participantsCollectionRef = null;
		callDescriptionsRef = null;
		offerDescriptionRef = null;
		answerDescriptionRef = null;
		latestOfferDescription = null;
		latestAnswerDescription = null;
		fallbackTurnActivated = false;
		fallbackTurnActivationReason = null;
		hasTurnServers = false;
		usingFallbackTurnServers = false;
		forceRelayIceTransport = false;
		lastTurnConfigSignature = null;
		buildIceServers();

		if (participantsRef && currentUid) {
			participants = participants.filter((p) => p.uid !== currentUid);
		} else {
			participants = [];
		}

		if (cleanupDoc && cleanupRef) {
			try {
				const remaining = await getDocs(collection(cleanupRef, 'participants'));
				if (remaining.empty) {
					await purgeCallArtifacts(cleanupRef);
					await deleteDoc(cleanupRef);
				}
			} catch (err) {
				if ((err as any)?.code !== 'permission-denied') {
					console.warn('Failed to cleanup call doc', err);
				}
			}
		}

		if (resetError) {
			errorMessage = '';
		}
		statusMessage = '';
		isJoined = false;
		isConnecting = false;
		// Only reset media state if not preserving it (e.g., during channel switch)
		if (!preserveMediaState) {
			isMicMuted = true;
			isCameraOff = true;
		}
		callSnapshotDebug = '';
	}

	async function toggleMic() {
		if (isMicToggling) return; // Prevent concurrent toggles
		isMicToggling = true;
		try {
			voiceDebug('toggleMic invoked', { isMicMuted, hasAudioTrack });
			const enabling = isMicMuted;
			if (enabling) {
				const previous = isMicMuted;
				isMicMuted = false;

				if (!hasAudioTrack) {
					const ok = await acquireTrack('audio');
					if (!ok) {
						isMicMuted = previous;
						// Don't return early - let finally release the lock
						return;
					}
				} else {
					localStream?.getAudioTracks().forEach((track) => (track.enabled = true));
					syncLocalTracksToPeer();
				}

				applyTrackStates();
				statusMessage = 'Microphone on.';
			} else {
				removeLocalTrack('audio');
				isMicMuted = true;
				applyTrackStates();
				statusMessage = 'Microphone muted.';
			}
			// Force button state update
			trackStateVersion += 1;
			await updateParticipantPresence();
			scheduleRenegotiation(enabling ? 'mic-unmuted' : 'mic-muted', { requireOfferer: true });
			const currentUid = $user?.uid ?? null;
			if (currentUid) {
				const nextAudio = hasAudioTrack && !isMicMuted;
				participants = participants.map((p) =>
					p.uid === currentUid ? { ...p, hasAudio: nextAudio, status: 'active' } : p
				);
			}
		} finally {
			isMicToggling = false;
		}
	}

	async function toggleCamera() {
		if (isCameraToggling || isScreenSharePending) return; // Prevent concurrent toggles
		isCameraToggling = true;
		try {
			voiceDebug('toggleCamera invoked', { isCameraOff, isScreenSharing });

			if (isScreenSharing) {
				await stopScreenShare();
				// Don't return early - let finally run to release the lock
			} else {
				const enabling = isCameraOff;
				if (enabling) {
					const previous = isCameraOff;
					isCameraOff = false;

					if (!hasVideoTrack) {
						const ok = await acquireTrack('video');
						if (!ok) {
							isCameraOff = previous;
							return;
						}
					} else {
						localStream?.getVideoTracks().forEach((track) => (track.enabled = true));
						syncLocalTracksToPeer();
					}

					applyTrackStates();
					statusMessage = 'Camera on.';
					// Start publishing thumbnails when camera turns on
					startThumbnailPublishing();
				} else {
					removeLocalTrack('video');
					isCameraOff = true;
					isScreenSharing = false;
					shouldRestoreCameraOnShareEnd = false;
					applyTrackStates();
					statusMessage = 'Camera off.';
					// Stop publishing thumbnails when camera turns off
					stopThumbnailPublishing();
				}

				// Force button state update
				trackStateVersion += 1;
				await updateParticipantPresence();
				scheduleRenegotiation(enabling ? 'camera-on' : 'camera-off', { requireOfferer: true });
				const currentUid = $user?.uid ?? null;
				if (currentUid) {
					const nextVideo = hasVideoTrack && (!isCameraOff || isScreenSharing);
					participants = participants.map((p) =>
						p.uid === currentUid
							? { ...p, hasVideo: nextVideo, screenSharing: isScreenSharing, status: 'active' }
							: p
					);
				}
			}
		} finally {
			isCameraToggling = false;
		}
	}

	async function startScreenShare() {
		if (isScreenSharing || isScreenSharePending) return;
		if (!browser || typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
			errorMessage = 'Screen sharing is not supported in this browser.';
			return;
		}
		if (!isJoined) {
			errorMessage = 'Join the call before sharing your screen.';
			return;
		}

		isScreenSharePending = true;
		const hadCamera = hasVideoTrack && !isCameraOff && !isScreenSharing;

		try {
			const displayStream = await navigator.mediaDevices.getDisplayMedia({
				video: {
					frameRate: { ideal: 30, max: 60 },
					width: { ideal: 1920 },
					height: { ideal: 1080 }
				},
				audio: false
			});

			const [track] = displayStream.getVideoTracks();
			if (!track) {
				throw new Error('No screen track returned.');
			}

			shouldRestoreCameraOnShareEnd = hadCamera;

			if (!localStream) {
				localStream = new MediaStream();
			}

			localStream.getVideoTracks().forEach((existing) => {
				existing.stop();
				localStream!.removeTrack(existing);
			});

			localStream.addTrack(track);
			screenStream = displayStream;
			isScreenSharing = true;
			isCameraOff = false;

			track.onended = () => {
				stopScreenShare({ restoreCamera: shouldRestoreCameraOnShareEnd }).catch(() => {});
			};

			applyTrackStates();
			syncLocalTracksToPeer();
			statusMessage = 'Sharing your screen.';
			errorMessage = '';

			const currentUid = $user?.uid ?? null;
			if (currentUid) {
				participants = participants.map((p) =>
					p.uid === currentUid ? { ...p, hasVideo: true, screenSharing: true, status: 'active' } : p
				);
			}

			await updateParticipantPresence();
			scheduleRenegotiation('screen-share-started', { requireOfferer: true });
		} catch (err) {
			console.warn('Failed to start screen share', err);
			errorMessage = err instanceof Error ? err.message : 'Unable to start screen sharing.';
			isScreenSharing = false;
			screenStream = null;
			shouldRestoreCameraOnShareEnd = false;
		} finally {
			isScreenSharePending = false;
		}
	}

	async function stopScreenShare(options: { restoreCamera?: boolean } = {}) {
		const restoreCamera = options.restoreCamera ?? shouldRestoreCameraOnShareEnd;

		if (screenStream) {
			screenStream.getTracks().forEach((track) => {
				track.onended = null;
				track.stop();
			});
		}

		if (localStream) {
			const screenTracks = localStream.getVideoTracks();
			screenTracks.forEach((track) => {
				localStream!.removeTrack(track);
			});
		}

		screenStream = null;
		isScreenSharing = false;
		shouldRestoreCameraOnShareEnd = false;

		syncLocalTracksToPeer();

		if (restoreCamera) {
			const ok = await acquireTrack('video');
			isCameraOff = !ok;
		} else if (!localStream?.getVideoTracks().length) {
			isCameraOff = true;
		}

		applyTrackStates();

		const currentUid = $user?.uid ?? null;
		if (currentUid) {
			const nextVideo = hasVideoTrack && (!isCameraOff || isScreenSharing);
			participants = participants.map((p) =>
				p.uid === currentUid
					? { ...p, hasVideo: nextVideo, screenSharing: false, status: 'active' }
					: p
			);
		}

		await updateParticipantPresence();
		scheduleRenegotiation(
			restoreCamera ? 'screen-share-stopped-restore-camera' : 'screen-share-stopped',
			{ requireOfferer: true }
		);
		statusMessage = restoreCamera ? 'Returned to camera.' : 'Screen share stopped.';
	}

	async function toggleScreenShare() {
		voiceDebug('toggleScreenShare invoked', { isScreenSharing });
		if (isScreenSharing) {
			await stopScreenShare();
		} else {
			await startScreenShare();
		}
	}

	function togglePlaybackMute() {
		isPlaybackMuted = !isPlaybackMuted;
		audioRefs.forEach((_, uid) => applyParticipantControls(uid));
	}

	function toggleDeafenSelf() {
		const next = !isPlaybackMuted;
		isPlaybackMuted = next;
		if (next) {
			isMicMuted = true;
		}
		audioRefs.forEach((_, uid) => applyParticipantControls(uid));
		showControlsBar();
	}

	function toggleGridMode() {
		gridMode = gridMode === 'equal' ? 'focus' : 'equal';
		persistUiPrefs({ gridMode, showSelfInGrid });
	}

	function toggleShowSelf() {
		showSelfInGrid = !showSelfInGrid;
		persistUiPrefs({ gridMode, showSelfInGrid });
		showControlsBar();
	}

	function openVolumeMenu(event: MouseEvent, uid: string) {
		event.preventDefault();
		menuOpenFor = null;
		const controls = getParticipantControls(uid);
		setParticipantVolume(uid, controls.volume);
		volumeMenu = { uid, x: event.clientX, y: event.clientY };
	}

	function closeVolumeMenu() {
		volumeMenu = null;
	}

	function applyPreferenceChanges(prev: UserVoicePreferences, next: UserVoicePreferences) {
		if (prev.outputDeviceId !== next.outputDeviceId) {
			applyOutputDeviceAll();
		}
		const audioChanged =
			prev.inputDeviceId !== next.inputDeviceId ||
			prev.echoCancellation !== next.echoCancellation ||
			prev.noiseSuppression !== next.noiseSuppression ||
			prev.autoGain !== next.autoGain;
		if (audioChanged && !isMicMuted && isJoined) {
			acquireTrack('audio', next).catch(() => {});
		}
		const videoChanged =
			prev.cameraDeviceId !== next.cameraDeviceId || prev.videoQuality !== next.videoQuality;
		if (videoChanged && !isCameraOff && isJoined) {
			acquireTrack('video', next).catch(() => {});
		}
	}

	const VOICE_TAB_KEY = 'hconnect:settings:voiceTab';
	function setVoiceSettingsTab(tab: 'voice' | 'video') {
		if (typeof localStorage !== 'undefined') {
			try {
				localStorage.setItem(VOICE_TAB_KEY, tab);
			} catch {
				/* ignore */
			}
		}
	}
	function openVoiceSettingsPanel(tab: 'voice' | 'video' = 'voice') {
		setVoiceSettingsTab(tab);
		openSettings({ section: 'voice' as any });
		moreMenuOpen = false;
	}

	function openSelfPreview() {
		showSelfInGrid = false;
		persistUiPrefs({ gridMode, showSelfInGrid });
		showControlsBar();
	}

	function toggleSideChatPanel() {
		dispatch('toggleSideChat');
		showControlsBar();
	}

	function toggleSideMembersPanel() {
		dispatch('toggleSideMembers');
		showControlsBar();
	}

	async function copyErrorMessage() {
		if (!errorMessage || copyErrorInFlight) return;
		copyErrorInFlight = true;
		try {
			await navigator.clipboard?.writeText(errorMessage);
		} catch (err) {
			console.warn('Failed to copy error message', err);
		} finally {
			copyErrorInFlight = false;
		}
	}

	function togglePopout() {
		popoutMode = !popoutMode;
		showControlsBar();
		scheduleControlsHide();
	}

	async function toggleFullscreen() {
		if (!browser) return;
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
			} else if (callShellEl?.requestFullscreen) {
				await callShellEl.requestFullscreen();
			}
		} catch (err) {
			console.warn('Failed to toggle fullscreen', err);
		}
	}

	async function refreshDevices() {
		voiceDebug('refreshDevices invoked', { hasAudioTrack, hasVideoTrack, isMicMuted, isCameraOff });
		const tasks: Promise<boolean>[] = [];
		if (hasAudioTrack && !isMicMuted) tasks.push(acquireTrack('audio'));
		if (hasVideoTrack && !isCameraOff) tasks.push(acquireTrack('video'));

		if (!tasks.length) {
			statusMessage = 'No devices active to refresh.';
			return;
		}

		const results = await Promise.all(tasks);
		if (results.some((r) => r === false)) {
			statusMessage = 'Some devices could not be refreshed.';
		} else {
			statusMessage = 'Devices refreshed.';
		}
		await updateParticipantPresence();
		scheduleRenegotiation('refresh-devices', { requireOfferer: true });
		const currentUid = $user?.uid ?? null;
		if (currentUid) {
			const nextAudio = hasAudioTrack && !isMicMuted;
			const nextVideo = hasVideoTrack && !isCameraOff;
			participants = participants.map((p) =>
				p.uid === currentUid
					? {
							...p,
							hasAudio: nextAudio,
							hasVideo: nextVideo,
							screenSharing: isScreenSharing,
							status: 'active'
						}
					: p
			);
		}
	}
	function handleJoinClick() {
		if (isConnecting || isJoined) return;
		if (!serverId || !channelId) return;
		sessionQueue = sessionQueue.then(() => joinChannel());
	}

	function handleLeave() {
		voiceSession.leave();
	}

	function handleMinimize() {
		voiceSession.setVisible(false);
	}

	run(() => {
		setVoiceClientControls({
			toggleMute: () => toggleMic(),
			toggleDeafen: () => togglePlaybackMute(),
			toggleVideo: () => toggleCamera(),
			toggleScreenShare: () => toggleScreenShare(),
			leave: () => handleLeave(),
			showCall: () => voiceSession.setVisible(true),
			openSettings: () => openVoiceSettingsPanel()
		});
	});

	function clearReconnectTimer() {
		if (reconnectTimer) {
			voiceDebug('clearReconnectTimer');
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
	}

	async function performFullReconnect(options: { purgeDoc?: boolean } = {}) {
		const { purgeDoc = false } = options;
		if (isConnecting) {
			voiceDebug('performFullReconnect skipped (already connecting)', { purgeDoc });
			return;
		}
		voiceDebug('performFullReconnect start', {
			isJoined,
			hasPc: !!pc,
			connectionState: pc?.connectionState ?? null,
			iceState: pc?.iceConnectionState ?? null,
			purgeDoc,
			forceRelayIceTransport,
			fallbackTurnActivated,
			usingFallbackTurnServers
		});
		const shouldEnableMic = !isMicMuted;
		const shouldEnableCamera = !isCameraOff && !isScreenSharing;
		const shouldShareScreen = isScreenSharing;
		const targetRef = purgeDoc ? callRef : null;

		statusMessage = purgeDoc ? 'Restarting call...' : 'Rejoining call...';
		await hangUp({ cleanupDoc: !purgeDoc, resetError: false });

		if (purgeDoc && targetRef) {
			try {
				await purgeCallArtifacts(targetRef);
				await deleteDoc(targetRef);
				voiceDebug('performFullReconnect purged call document', { path: targetRef.path });
			} catch (err) {
				console.warn('Failed to purge call document during reconnect', err);
				voiceDebug('Failed to purge call document during reconnect', err);
			}
		}

		await joinChannel();
		if (!isJoined) {
			voiceDebug('performFullReconnect join failed', {
				purgeDoc,
				connectionState: pc?.connectionState ?? null,
				signalingState: pc?.signalingState ?? null
			});
			return;
		}
		clearReconnectTimer();
		reconnectAttemptCount = 0;
		statusMessage = 'Connected.';
		voiceDebug('performFullReconnect completed', {
			isJoined,
			connectionState: pc?.connectionState ?? null,
			iceState: pc?.iceConnectionState ?? null,
			purgeDoc,
			forceRelayIceTransport,
			fallbackTurnActivated,
			usingFallbackTurnServers
		});

		if (shouldEnableMic && isMicMuted) {
			await toggleMic();
		}

		if (shouldShareScreen && !isScreenSharing) {
			await toggleScreenShare();
		} else if (shouldEnableCamera && isCameraOff && !isScreenSharing) {
			await toggleCamera();
		}
	}

	function handleDebugPanelRefresh() {
		updatePeerConnectionStateSnapshot(pc);
		capturePeerDiagnostics(pc, 'manual-refresh');
		voiceDebug('Manual diagnostics snapshot requested');
	}

	async function handleDebugPanelCopy(
		includeLogs = 40,
		includeEvents = 80,
		source: string = 'panel-header'
	) {
		if (copyInFlight) return;
		copyInFlight = true;
		const startedAt = now();
		statusMessage = 'Preparing debug bundle…';
		voiceDebug('Debug copy requested', { includeLogs, includeEvents, source });
		appendVoiceDebugEvent('video-call', 'handleDebugPanelCopy invoked', {
			includeLogs,
			includeEvents,
			source
		});

		try {
			const result = await copyVoiceDebugBundle({ includeLogs, includeEvents });
			const totalDurationMs = Math.round(now() - startedAt);
			voiceDebug('Debug copy completed', {
				source,
				outcome: result.status,
				includeLogs: result.includeLogs,
				includeEvents: result.includeEvents,
				bundleLength: result.length,
				lineCount: result.lineCount,
				logCountCaptured: result.logCountCaptured,
				durationMs: result.durationMs,
				totalDurationMs,
				statusMessage
			});
			appendVoiceDebugEvent('video-call', 'handleDebugPanelCopy resolved', {
				source,
				outcome: result.status,
				includeLogs: result.includeLogs,
				includeEvents: result.includeEvents,
				bundleLength: result.length,
				lineCount: result.lineCount,
				logCountCaptured: result.logCountCaptured,
				durationMs: result.durationMs,
				totalDurationMs
			});
		} catch (err) {
			const totalDurationMs = Math.round(now() - startedAt);
			voiceDebug('Debug copy encountered error', { source, err, totalDurationMs });
			appendVoiceDebugEvent('video-call', 'handleDebugPanelCopy error', {
				source,
				error: err instanceof Error ? err.message : String(err),
				totalDurationMs
			});
			statusMessage = 'Failed to copy debug info. Check console output.';
		} finally {
			copyInFlight = false;
		}
	}

	function handleResetIceStrategy() {
		const wasForced = forceRelayIceTransport || fallbackTurnActivated || usingFallbackTurnServers;
		forceRelayIceTransport = false;
		fallbackTurnActivated = false;
		usingFallbackTurnServers = false;
		fallbackTurnActivationReason = null;
		consecutiveIceErrors = 0;
		lastIceErrorTimestamp = 0;
		connectionFailureCount = 0;
		lastTurnConfigSignature = null;
		voiceDebug('ICE strategy manually reset', { wasForced, allowTurnFallback });
		if (isJoined) {
			scheduleReconnect('Rejoining with default ICE...', true);
		}
	}

	function handleForceRestart() {
		if (isRestartingCall || isConnecting) return;
		if (!serverId || !channelId) return;
		isRestartingCall = true;
		statusMessage = 'Restarting call...';
		voiceDebug('Manual call restart requested', {
			callPath: callRef?.path ?? null,
			purgeDoc: true
		});
		sessionQueue = sessionQueue
			.then(() => performFullReconnect({ purgeDoc: true }))
			.catch((err) => {
				console.warn('Failed to restart call manually', err);
				voiceDebug('Failed to restart call manually', err);
				errorMessage =
					err instanceof Error ? err.message : 'Unable to restart the call. Please try again.';
			})
			.finally(() => {
				isRestartingCall = false;
			});
	}

	function scheduleReconnect(message: string, force = false) {
		// Don't schedule reconnect if connection has recovered
		if (pc && (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected')) {
			voiceDebug('scheduleReconnect skipped (connection recovered)', {
				connectionState: pc.connectionState,
				iceConnectionState: pc.iceConnectionState
			});
			clearReconnectTimer();
			return;
		}

		// Don't schedule if already reconnecting/restarting
		if (isRestartingCall || isConnecting) {
			voiceDebug('scheduleReconnect skipped (already in progress)', {
				isRestartingCall,
				isConnecting
			});
			return;
		}

		statusMessage = message;
		voiceDebug('scheduleReconnect', {
			message,
			force,
			existingTimer: !!reconnectTimer,
			reconnectAttemptCount,
			connectionState: pc?.connectionState ?? null,
			iceState: pc?.iceConnectionState ?? null,
			signalingState: pc?.signalingState ?? null
		});
		
		// If there's already a pending timer and this is not a forced reconnect, skip
		if (reconnectTimer && !force) return;
		
		clearReconnectTimer();
		
		// Calculate delay with exponential backoff
		const baseDelay = force ? 1500 : RECONNECT_DELAY_MS;
		const backoffMultiplier = Math.min(Math.pow(1.5, reconnectAttemptCount), 4); // Cap at 4x
		const delay = Math.min(baseDelay * backoffMultiplier, 15000); // Cap at 15 seconds
		
		voiceDebug('scheduleReconnect delay calculated', {
			baseDelay,
			backoffMultiplier,
			finalDelay: delay,
			attempt: reconnectAttemptCount
		});
		
		reconnectTimer = setTimeout(
			() => {
				reconnectTimer = null;
				
				// Final check before reconnecting - connection may have recovered
				if (pc && (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected')) {
					voiceDebug('Reconnect cancelled (connection recovered during wait)');
					reconnectAttemptCount = 0;
					statusMessage = 'Connected.';
					return;
				}
				
				reconnectAttemptCount += 1;
				const shouldPurge = force || reconnectAttemptCount >= 3;
				voiceDebug('performFullReconnect queued', {
					attempt: reconnectAttemptCount,
					force,
					purgeDoc: shouldPurge
				});
				sessionQueue = sessionQueue
					.then(() => performFullReconnect({ purgeDoc: shouldPurge }))
					.catch((err) => {
						console.warn('Failed to reconnect to voice call', err);
						voiceDebug('Reconnect failed', {
							attempt: reconnectAttemptCount,
							error: err instanceof Error ? err.message : String(err)
						});
						// Schedule another attempt if we haven't exceeded max attempts
						if (reconnectAttemptCount < 5) {
							scheduleReconnect('Retrying connection...', false);
						} else {
							errorMessage = 'Unable to reconnect. Please try again manually.';
							statusMessage = 'Connection failed.';
						}
					});
			},
			delay
		);
	}

	function controlClasses(
		options: { active?: boolean; danger?: boolean; disabled?: boolean } = {}
	) {
		const { active = false, danger = false, disabled = false } = options;
		const classes = ['call-control-button'];
		if (active) classes.push('call-control-button--active');
		if (danger) classes.push('call-control-button--danger');
		if (disabled) classes.push('call-control-button--disabled');
		return classes.join(' ');
	}

	function showControlsBar() {
		controlsVisible = true;
		if (controlHideTimer) {
			clearTimeout(controlHideTimer);
			controlHideTimer = null;
		}
	}

	function scheduleControlsHide(immediate = false) {
		// In embedded mode, don't auto-hide controls
		if (isEmbedded) return;
		if (compactMatch) return;
		if (controlHideTimer) {
			clearTimeout(controlHideTimer);
		}
		const delay = immediate ? 450 : CONTROL_HIDE_DELAY_MS;
		controlHideTimer = setTimeout(() => {
			controlsVisible = false;
			controlHideTimer = null;
		}, delay);
	}

	function handleStagePointerMove() {
		showControlsBar();
		scheduleControlsHide();
	}

	function handleStageLeave() {
		scheduleControlsHide();
	}

	function formatDuration(ms: number): string {
		const totalSeconds = Math.max(0, Math.floor(ms / 1000));
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		const base = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
		return hours > 0 ? `${hours}:${base}` : base;
	}

	function updateCallDuration() {
		if (!callStartedAt) {
			callDuration = '00:00';
			return;
		}
		const elapsed = Date.now() - callStartedAt;
		callDuration = formatDuration(elapsed);
	}

	function startCallTimer() {
		stopCallTimer();
		callStartedAt = Date.now();
		updateCallDuration();
		callTimer = setInterval(updateCallDuration, 1000);
	}

	function stopCallTimer() {
		if (callTimer) {
			clearInterval(callTimer);
			callTimer = null;
		}
		callStartedAt = null;
		callDuration = '00:00';
	}

	// Thumbnail capture and publishing for lobby preview
	async function captureThumbnail(): Promise<string | null> {
		const videoElement = localVideoEl;
		if (!videoElement || isCameraOff) return null;

		const videoWidth = videoElement.videoWidth;
		const videoHeight = videoElement.videoHeight;
		if (!videoWidth || !videoHeight) return null;

		// Calculate scaled dimensions
		const scale = Math.min(THUMBNAIL_MAX_SIZE / videoWidth, THUMBNAIL_MAX_SIZE / videoHeight);
		const width = Math.floor(videoWidth * scale);
		const height = Math.floor(videoHeight * scale);

		try {
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (!ctx) return null;

			ctx.drawImage(videoElement, 0, 0, width, height);
			return canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY);
		} catch (err) {
			console.warn('[VideoChat] Failed to capture thumbnail:', err);
			return null;
		}
	}

	async function publishThumbnail() {
		if (!isJoined || !callRef || isCameraOff) {
			// Clear thumbnail if camera is off
			if (callRef && isCameraOff) {
				try {
					const database = getDb();
					const thumbnailRef = doc(
						database,
						callRef.path,
						'thumbnails',
						get(user)?.uid ?? 'unknown'
					);
					await deleteDoc(thumbnailRef);
				} catch (err) {
					// Ignore - thumbnail may not exist
				}
			}
			return;
		}

		const thumbnail = await captureThumbnail();
		if (!thumbnail) return;

		try {
			const database = getDb();
			const currentUser = get(user);
			if (!currentUser?.uid || !callRef) return;

			const thumbnailRef = doc(database, callRef.path, 'thumbnails', currentUser.uid);
			await setDoc(
				thumbnailRef,
				{
					imageData: thumbnail,
					updatedAt: serverTimestamp()
				},
				{ merge: true }
			);
		} catch (err) {
			console.warn('[VideoChat] Failed to publish thumbnail:', err);
		}
	}

	function startThumbnailPublishing() {
		stopThumbnailPublishing();
		// Publish immediately, then on interval
		publishThumbnail();
		thumbnailInterval = setInterval(publishThumbnail, THUMBNAIL_INTERVAL_MS);
	}

	function stopThumbnailPublishing() {
		if (thumbnailInterval) {
			clearInterval(thumbnailInterval);
			thumbnailInterval = null;
		}
		// Clean up thumbnail document when stopping
		if (callRef) {
			const currentUser = get(user);
			if (currentUser?.uid) {
				const database = getDb();
				const thumbnailRef = doc(database, callRef.path, 'thumbnails', currentUser.uid);
				deleteDoc(thumbnailRef).catch(() => {
					/* ignore */
				});
			}
		}
	}

	function handleFullscreenChange() {
		if (typeof document === 'undefined') return;
		if (!document.fullscreenElement) {
			fullscreenUid = null;
		}
	}

	onMount(() => {
		if (typeof document !== 'undefined') {
			document.addEventListener('fullscreenchange', handleFullscreenChange);
			return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
		}
	});

	function toggleTileFullscreen(uid: string) {
		if (typeof document === 'undefined') return;
		const target = tileRefs.get(uid);
		if (!target) return;
		if (document.fullscreenElement && fullscreenUid === uid) {
			document.exitFullscreen?.();
			return;
		}
		target.requestFullscreen?.().then(() => {
			fullscreenUid = uid;
		});
	}

	function openMiniPlayer(tile: ParticipantTile) {
		miniPlayer = { uid: tile.uid, name: tile.displayName, stream: tile.stream };
	}

	function closeMiniPlayer() {
		miniPlayer = null;
		if (miniVideoEl) {
			miniVideoEl.srcObject = null;
		}
	}

	function handleChatResizeStart(event: PointerEvent) {
		if (!(sidePanelOpen && sidePanelTab === 'chat')) return;
		chatResizeActive = true;
		chatResizeStartX = event.clientX;
		chatResizeStartWidth = sideChatWidth;
		window.addEventListener('pointermove', handleChatResizeMove);
		window.addEventListener('pointerup', handleChatResizeEnd);
		event.preventDefault();
	}

	function handleChatResizeMove(event: PointerEvent) {
		if (!chatResizeActive) return;
		const delta = chatResizeStartX - event.clientX;
		sideChatWidth = clampChatWidth(chatResizeStartWidth + delta);
	}

	function handleChatResizeEnd() {
		if (!chatResizeActive) return;
		chatResizeActive = false;
		window.removeEventListener('pointermove', handleChatResizeMove);
		window.removeEventListener('pointerup', handleChatResizeEnd);
	}

	function sendChatMessage() {
		const text = chatDraft.trim();
		if (!text) return;
		chatMessages = [
			{ id: crypto.randomUUID?.() ?? String(Date.now()), text, ts: Date.now(), author: 'You' },
			...chatMessages
		];
		chatDraft = '';
	}
	let hasAudioTrack = $derived(!!(localStream && localStream.getAudioTracks().length));
	let hasVideoTrack = $derived(!!(localStream && localStream.getVideoTracks().length));
	
	// Check actual track enabled state for accurate button display
	// This prevents UI from being out of sync with actual media state
	// trackStateVersion is included to force re-evaluation when tracks change
	let actualMicEnabled = $derived.by(() => {
		// Reference trackStateVersion to trigger reactivity
		void trackStateVersion;
		if (!localStream) return false;
		const audioTrack = localStream.getAudioTracks()[0];
		return audioTrack?.enabled === true && audioTrack?.readyState === 'live';
	});
	let actualCameraEnabled = $derived.by(() => {
		// Reference trackStateVersion to trigger reactivity
		void trackStateVersion;
		if (!localStream || isScreenSharing) return false;
		const videoTrack = localStream.getVideoTracks()[0];
		return videoTrack?.enabled === true && videoTrack?.readyState === 'live';
	});
	
	// Combined state: use actual track state when available, fall back to UI state
	let isMicActive = $derived(hasAudioTrack ? actualMicEnabled : !isMicMuted);
	let isCameraActive = $derived(hasVideoTrack && !isScreenSharing ? actualCameraEnabled : !isCameraOff);
	
	let micButtonLabel = $derived(isMicActive ? 'Mute mic' : 'Enable mic');
	let cameraButtonLabel = $derived(isCameraActive ? 'Stop video' : 'Start video');
	let screenShareButtonLabel = $derived(isScreenSharing ? 'Stop sharing' : 'Share screen');
	let isEmbedded = $derived(layout === 'embedded');
	run(() => {
		isCompact = isEmbedded && compactMatch;
	});
	let participantCount = $derived(participants.length);
	run(() => {
		const snapshot = {
			connected: isJoined,
			muted: isMicMuted,
			deafened: isPlaybackMuted,
			videoEnabled: !isCameraOff && !isScreenSharing,
			screenSharing: isScreenSharing,
			channelName: sessionChannelName || null,
			serverName: sessionServerName || null,
			participantCount
		};
		// Avoid reading voiceClientState while writing to it (prevents recursive reactive warnings)
		untrack(() => updateVoiceClientState(snapshot));
	});
	let quickStatsItems = $derived(
		(() => {
			const callDocPath = callRef?.path ?? 'none';
			const compactCallDoc = compactIdentifier(callDocPath);
			const logsCaptured = voiceLogs.length;
			return [
				{ key: 'signaling', label: 'Signaling', value: toDisplayLabel(signalingState) },
				{ key: 'connection', label: 'Connection', value: toDisplayLabel(connectionState) },
				{ key: 'ice-connection', label: 'ICE Conn', value: toDisplayLabel(iceConnectionState) },
				{ key: 'ice-gathering', label: 'ICE Gather', value: toDisplayLabel(iceGatheringState) },
				{ key: 'local-ice', label: 'Local ICE', value: String(publishedCandidateCount) },
				{ key: 'remote-ice', label: 'Remote ICE', value: String(appliedCandidateCount) },
				{ key: 'ice-policy', label: 'ICE Policy', value: describeIcePolicyStatus() },
				{ key: 'turn', label: 'TURN', value: describeTurnStatus() },
				{
					key: 'role',
					label: 'Role',
					value: isJoined ? (isOfferer ? 'offerer' : 'answerer') : 'idle'
				},
				{
					key: 'call-doc',
					label: 'Call Doc',
					value: compactCallDoc.display,
					tooltip: compactCallDoc.tooltip
				},
				{ key: 'errors', label: 'Errors', value: String(voiceErrorCount) },
				{ key: 'warnings', label: 'Warnings', value: String(voiceWarnCount) },
				{
					key: 'logs',
					label: 'Logs cached',
					value: `${Math.min(logsCaptured, 250)}/${logsCaptured}`,
					tooltip: `${logsCaptured} total voice logs cached (showing up to 250)`
				}
			] as QuickStatItem[];
		})()
	);
	let quickStatsSummary = $derived(
		[
			`Sig:${abbreviate(signalingState)}`,
			`Conn:${abbreviate(connectionState)}`,
			`ICE:${abbreviate(iceConnectionState)}`,
			`Role:${abbreviate(isJoined ? (isOfferer ? 'offerer' : 'answerer') : 'idle')}`,
			`Err:${voiceErrorCount}`,
			`Warn:${voiceWarnCount}`
		].join(' • ')
	);
	let quickStatsSummaryTooltip = $derived(
		[
			...quickStatsItems.map((item) => `${item.label}: ${item.tooltip ?? item.value}`),
			statusMessage ? `Status: ${statusMessage}` : null,
			errorMessage ? `Error: ${errorMessage}` : null
		]
			.filter(Boolean)
			.join('\n')
	);
	run(() => {
		if (browser) {
			setVoiceDebugSection('call.session', {
				serverId,
				channelId,
				sessionVisible,
				sessionChannelName,
				sessionServerName,
				isJoined,
				isConnecting,
				isOfferer,
				activeSessionKey
			});
		}
	});
	run(() => {
		if (browser) {
			setVoiceDebugSection('call.participants', {
				count: participants.length,
				summary: summarizeParticipantsForDebug(participants)
			});
		}
	});
	run(() => {
		if (browser) {
			const remoteSummary = summarizeRemoteStreamsForDebug(remoteStreams);
			setVoiceDebugSection('call.remoteStreams', {
				count: remoteSummary.length,
				streams: remoteSummary
			});
		}
	});
	run(() => {
		if (browser) {
			setVoiceDebugSection('call.localStream', {
				stream: summarizeLocalStreamForDebug(localStream),
				hasAudioTrack,
				hasVideoTrack,
				micMuted: isMicMuted,
				cameraOff: isCameraOff,
				screenSharing: isScreenSharing
			});
		}
	});
	run(() => {
		if (browser) {
			setVoiceDebugSection('call.status', {
				statusMessage: statusMessage || null,
				errorMessage: errorMessage || null,
				voiceErrorCount,
				voiceWarnCount,
				pcState: {
					signaling: pc?.signalingState ?? null,
					connection: pc?.connectionState ?? null,
					iceConnection: pc?.iceConnectionState ?? null,
					iceGathering: pc?.iceGatheringState ?? null
				}
			});
		}
	});
	let currentUserId = $derived($user?.uid ?? null);
	let selfParticipant = $derived(participants.find((p) => p.uid === currentUserId) ?? null);
	let localHasAudio = $derived(selfParticipant?.hasAudio ?? (hasAudioTrack && !isMicMuted));
	let localHasVideo = $derived(selfParticipant?.hasVideo ?? (hasVideoTrack && !isCameraOff));
	run(() => {
		participantMedia = (() => {
			const usedStreamIds = new Set<string>();
			
			// Start with participants from Firestore
			let sourceParticipants = [...participants];
			
			// If joined but self not yet in participants list, add synthetic self entry
			// This ensures we show the user immediately after joining before Firestore confirms
			if (isJoined && currentUserId && !sourceParticipants.some(p => p.uid === currentUserId)) {
				sourceParticipants.push({
					uid: currentUserId,
					displayName: 'You',
					photoURL: null,
					authPhotoURL: null,
					hasAudio: hasAudioTrack && !isMicMuted,
					hasVideo: hasVideoTrack && !isCameraOff,
					screenSharing: isScreenSharing,
					status: 'active',
					joinedAt: null,
					updatedAt: null,
					streamId: localStream?.id ?? null,
					kickedBy: null,
					removedAt: null,
					renegotiationRequestId: null,
					renegotiationRequestReason: null,
					renegotiationRequestedAt: null,
					renegotiationResolvedAt: null
				});
			}
			
			const tiles: ParticipantMedia[] = sourceParticipants.map((p) => {
				const streamId = p.streamId ?? null;
				let stream: MediaStream | null = null;
				if (p.uid === currentUserId) {
					stream = localStream;
				} else if (streamId && remoteStreams.has(streamId)) {
					stream = remoteStreams.get(streamId) ?? null;
				}
				if (stream && streamId) {
					usedStreamIds.add(streamId);
				}
				return {
					uid: p.uid,
					isSelf: p.uid === currentUserId,
					streamId,
					stream,
					hasAudio: p.hasAudio,
					hasVideo: p.hasVideo
				};
			});

			if (tiles.some((tile) => !tile.isSelf && !tile.stream) && remoteStreams.size) {
				const availableStreams = Array.from(remoteStreams.entries());
				for (const tile of tiles) {
					if (tile.isSelf || tile.stream || (!tile.hasAudio && !tile.hasVideo)) continue;
					const preferVideo = tile.hasVideo;
					const matchesVideo = (stream: MediaStream) => streamHasLiveVideo(stream);
					const matchesAudio = (stream: MediaStream) =>
						stream.getAudioTracks().some((track) => track.readyState !== 'ended');

					let fallbackEntry =
						availableStreams.find(([id, stream]) => {
							if (usedStreamIds.has(id)) return false;
							return preferVideo ? matchesVideo(stream) : matchesAudio(stream);
						}) ?? null;

					if (!fallbackEntry && preferVideo) {
						fallbackEntry =
							availableStreams.find(([id, stream]) => {
								if (usedStreamIds.has(id)) return false;
								return matchesAudio(stream);
							}) ?? null;
					}

					if (!fallbackEntry) continue;
					const [fallbackId, fallbackStream] = fallbackEntry;
					tile.streamId = tile.streamId ?? fallbackId;
					tile.stream = fallbackStream;
					usedStreamIds.add(fallbackId);
				}

				for (const tile of tiles) {
					if (tile.isSelf || tile.stream) continue;
					const fallbackEntry = availableStreams.find(([id]) => !usedStreamIds.has(id)) ?? null;
					if (!fallbackEntry) break;
					const [fallbackId, fallbackStream] = fallbackEntry;
					tile.streamId = tile.streamId ?? fallbackId;
					tile.stream = fallbackStream;
					usedStreamIds.add(fallbackId);
				}
			}

			return tiles;
		})();
	});
	let selfIdentity = $derived(computeSelfIdentity());
	run(() => {
		participantTiles = participantMedia.map((media) => {
			const base = participants.find((p) => p.uid === media.uid);
			const moderation = participantModeration.get(media.uid);
			const forcedMute = !!(moderation?.serverMuted || moderation?.serverDeafened);
			const controls = media.isSelf
				? { volume: 1, muted: false }
				: { volume: DEFAULT_VOLUME, muted: false, ...(participantControls.get(media.uid) ?? {}) };
			const streamAudioActive = media.stream
				? media.stream.getAudioTracks().some((track) => track.readyState !== 'ended')
				: false;
			const streamVideoActive = streamHasLiveVideo(media.stream);
			const resolvedHasAudio = media.isSelf
				? localHasAudio || streamAudioActive
				: (media.hasAudio || streamAudioActive) && !forcedMute;
			const resolvedHasVideo = media.isSelf
				? localHasVideo || streamVideoActive
				: media.hasVideo || streamVideoActive;
			const decoratedControls = media.isSelf
				? controls
				: { ...controls, muted: controls.muted || forcedMute };
			const basePhotoURL = base?.photoURL ?? null;
			const selfPhotoURL = selfIdentity?.photoURL ?? selfIdentity?.authPhotoURL ?? null;
			return {
				...media,
				hasAudio: resolvedHasAudio,
				hasVideo: resolvedHasVideo,
				displayName: media.isSelf ? 'You' : (base?.displayName ?? 'Member'),
				photoURL: media.isSelf ? (selfPhotoURL ?? basePhotoURL) : basePhotoURL,
				controls: decoratedControls,
				screenSharing: base?.screenSharing ?? false,
				isSpeaking: speakingParticipants.has(media.uid)
			};
		});
	});
	let displayTiles = $derived(
		showSelfInGrid ? participantTiles : participantTiles.filter((tile) => !tile.isSelf)
	);
	let selfTile: ParticipantTile | null = $derived(
		participantTiles.find((tile) => tile.isSelf) ?? null
	);
	let focusedTile: ParticipantTile | null = $derived(
		(() => {
			if (gridMode !== 'focus') return null;
			const screenSharer = displayTiles.find((tile) => tile.screenSharing);
			if (screenSharer) return screenSharer;
			if (lastActiveSpeaker) {
				const remembered = displayTiles.find((tile) => tile.uid === lastActiveSpeaker);
				if (remembered) return remembered;
			}
			const active = displayTiles.find((tile) => tile.isSpeaking && !tile.screenSharing);
			return active ?? displayTiles[0] ?? null;
		})()
	);
	let secondaryTiles = $derived(
		focusedTile ? displayTiles.filter((tile) => tile.uid !== focusedTile.uid) : displayTiles
	);
	let gridColumns = $derived(resolveGridColumns(displayTiles.length));
	let gridTiles = $derived(
		gridMode === 'focus' && focusedTile ? [focusedTile, ...secondaryTiles] : displayTiles
	);
	// Always render the call grid even when nobody is sending video so tile sizing stays consistent.
	let mediaMode: 'voice' | 'video' = $derived(gridTiles.length ? 'video' : 'voice');
	let tileRefs = new Map<string, HTMLElement>();
	let fullscreenUid = $state<string | null>(null);
	let miniPlayer = $state<{ uid: string; name: string; stream: MediaStream | null } | null>(null);
	let miniVideoEl = $state<HTMLVideoElement | null>(null);
	run(() => {
		if (miniVideoEl && miniPlayer?.stream) {
			miniVideoEl.srcObject = miniPlayer.stream;
			miniVideoEl.play?.().catch(() => {});
		} else if (miniVideoEl) {
			miniVideoEl.srcObject = null;
		}
	});
	const clampValue = (value: number, min: number, max: number) =>
		Math.min(Math.max(value, min), max);
	const clampChatWidth = (value: number) => clampValue(value, 260, 640);
	run(() => {
		remoteConnected = participantMedia.some((tile) => !tile.isSelf && !!tile.stream);
	});
	// Ensure audio playback whenever remote streams or participant media changes
	run(() => {
		if (!isJoined) return;
		participantMedia.forEach((tile) => {
			if (tile.isSelf || !tile.stream) return;
			
			// Ensure Web Audio API playback is active
			const controls = participantControls.get(tile.uid);
			const moderation = participantModeration.get(tile.uid);
			const shouldMute = !!(controls?.muted || isPlaybackMuted || moderation?.serverMuted || moderation?.serverDeafened);
			const volume = controls?.volume ?? DEFAULT_VOLUME;
			ensureAudioPlayback(tile.uid, tile.stream, shouldMute, shouldMute ? 0 : volume);
			
			// Also try to play the audio element
			const audio = audioRefs.get(tile.uid);
			if (audio && audio.srcObject && audio.paused) {
				audio.play?.().catch(() => {});
			}
		});

		const attachedStreamIds = new Set(
			participantMedia
				.filter((tile) => !tile.isSelf && tile.stream)
				.map((tile) => tile.stream!.id)
		);
		const orphanPrefix = 'stream:';
		audioPlayback.forEach((_, uid) => {
			if (!uid.startsWith(orphanPrefix)) return;
			const streamId = uid.slice(orphanPrefix.length);
			if (!remoteStreams.has(streamId) || attachedStreamIds.has(streamId)) {
				destroyAudioPlayback(uid);
			}
		});
		remoteStreams.forEach((stream, streamId) => {
			if (attachedStreamIds.has(streamId)) return;
			const hasAudio = stream
				.getAudioTracks()
				.some((track) => track.readyState !== 'ended');
			if (!hasAudio) return;
			const shouldMute = isPlaybackMuted;
			const volume = DEFAULT_VOLUME;
			ensureAudioPlayback(orphanAudioUid(streamId), stream, shouldMute, shouldMute ? 0 : volume);
		});
	});
	// Cleanup audio playback and moderation when participants leave
	run(() => {
		const activeUids = new Set(participantMedia.map((tile) => tile.uid));
		
		// Cleanup audio playback for participants who left
		audioPlayback.forEach((_, uid) => {
			if (!activeUids.has(uid)) {
				voiceDebug('Cleaning up audio playback for departed participant', { uid });
				destroyAudioPlayback(uid);
			}
		});
		
		// Cleanup participant controls for departed participants
		participantControls.forEach((_, uid) => {
			if (!activeUids.has(uid)) {
				participantControls.delete(uid);
			}
		});
		
		// Cleanup moderation state
		const previousModeration = getParticipantModerationCache();
		let changed = false;
		let nextModeration = previousModeration;
		previousModeration.forEach((_, uid) => {
			if (!activeUids.has(uid)) {
				if (nextModeration === previousModeration) {
					nextModeration = new Map(previousModeration);
				}
				nextModeration.delete(uid);
				changed = true;
			}
		});
		if (changed) {
			setParticipantModerationMap(nextModeration);
		}
	});
	run(() => {
		localVideoEl && localStream && (localVideoEl.srcObject = localStream);
		if (selfPreviewEl && localStream) {
			selfPreviewEl.srcObject = localStream;
		}
	});
	run(() => {
		if (isJoined && !compactMatch && layout !== 'embedded') {
			showControlsBar();
			scheduleControlsHide();
		} else {
			controlsVisible = true;
			if (controlHideTimer) {
				clearTimeout(controlHideTimer);
				controlHideTimer = null;
			}
		}
	});
	run(() => {
		const seenUids = new Set<string>();
		participantMedia.forEach((tile) => {
			seenUids.add(tile.uid);
			if (!tile.isSelf) {
				ensureParticipantControls(tile.uid);
				applyParticipantControls(tile.uid);
			}
			attachStreamToRefs(tile.uid, tile.stream);
			monitorStreamAudio(tile.uid, tile.stream);
		});
		for (const uid of Array.from(audioMonitors.keys())) {
			if (!seenUids.has(uid)) {
				stopAudioMonitor(uid);
			}
		}
	});
	run(() => {
		if (serverId && serverId !== watchedServerId) {
			watchedServerId = serverId;
			watchServerMeta(serverId);
		} else if (!serverId && watchedServerId) {
			watchedServerId = null;
			serverOwnerId = null;
			serverMetaUnsub?.();
			serverMetaUnsub = null;
		}
	});
	run(() => {
		const key = serverId && currentUserId ? `${serverId}:${currentUserId}` : null;
		if (key !== watchedMemberKey) {
			memberUnsub?.();
			watchedMemberKey = key;
			if (serverId && currentUserId) {
				watchMemberDoc(serverId, currentUserId);
			} else {
				myPerms = null;
			}
		}
	});
	// Track previous heartbeat state to avoid repeatedly starting/stopping
	let lastHeartbeatActive = false;
	run(() => {
		// Keep heartbeat/timers aligned with join state changes.
		const shouldBeActive = !!(isJoined && serverId && channelId);
		if (shouldBeActive === lastHeartbeatActive) return;
		lastHeartbeatActive = shouldBeActive;
		if (shouldBeActive) {
			scheduleInactivityTimeout('state-change');
			// Note: startInactivityHeartbeat is called by scheduleInactivityTimeout
		} else {
			clearInactivityTimer();
			stopInactivityHeartbeat();
		}
	});
	run(() => {
		canKickMembers =
			!!currentUserId &&
			(!!(serverOwnerId && serverOwnerId === currentUserId) ||
				!!myPerms?.manageServer ||
				!!myPerms?.kickMembers);
	});
	run(() => {
		debugParticipants = lastParticipantsSnapshot ?? participants;
	});
	run(() => {
		if (participantDocRef && isJoined) {
			const identity = computeSelfIdentity();
			const signature = [
				hasAudioTrack && !isMicMuted,
				hasVideoTrack && (!isCameraOff || isScreenSharing),
				identity.displayName ?? '',
				identity.photoURL ?? '',
				identity.authPhotoURL ?? '',
				isScreenSharing ? '1' : '0'
			].join('|');
			const prevSignature = untrack(() => lastPresenceSignature);
			if (signature !== prevSignature) {
				lastPresenceSignature = signature;
				updateParticipantPresence({}, identity).catch((err) =>
					console.warn('Failed to sync presence', err)
				);
			}
		}
	});
</script>

<div
	class="voice-root"
	class:voice-root--embedded={isEmbedded}
	class:voice-root--compact={isCompact}
	class:voice-root--minimal={stageOnly}
>
	<div
		class="call-shell"
		class:call-shell--embedded={isEmbedded}
		class:call-shell--popout={popoutMode}
		class:call-shell--minimal={stageOnly}
		bind:this={callShellEl}
	>
		{#if !stageOnly}
			{#if !isCompact}
				<header class="call-header">
					<div class="call-header__info">
						<div class="call-header__icon">
							<i class="bx bx-hash"></i>
						</div>
						<div>
							<div class="call-header__title">#{sessionChannelName || 'Voice channel'}</div>
							{#if sessionServerName}
								<div class="call-header__subtitle">{sessionServerName}</div>
							{/if}
						</div>
					</div>
					<div class="call-header__actions">
						<div class="call-header__count">
							<i class="bx bx-user-voice"></i>
							<span>{participantCount}</span>
						</div>
						<div class="call-status">
							<span class={`call-status__dot ${remoteConnected ? 'call-status__dot--online' : ''}`}>
								{#if remoteConnected}
									<span class="call-status__pulse"></span>
								{/if}
							</span>
							<span class="call-status__label"
								>{remoteConnected ? 'Voice connected' : 'Connecting'}</span
							>
						</div>
						<div
							class="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-tertiary)]"
						>
							{callDuration}
						</div>
						{#if showChatToggle}
							<button
								type="button"
								class={`call-header__chat ${sidePanelOpen && sidePanelTab === 'chat' ? 'call-header__chat--active' : ''}`}
								onclick={toggleSideChatPanel}
								aria-pressed={sidePanelOpen && sidePanelTab === 'chat'}
								aria-label="Open call chat"
							>
								<i class="bx bx-message-dots"></i>
								<span>Call chat</span>
							</button>
						{/if}
						{#if debugLoggingEnabled}
							<button
								type="button"
								class={`call-header__debug ${debugPanelVisible ? 'call-header__debug--active' : ''} ${hasDebugAlerts ? 'call-header__debug--alert' : ''}`}
								onclick={() => toggleDebugPanel()}
								aria-pressed={debugPanelVisible}
								aria-label={hasDebugAlerts
									? 'Open debug panel (issues detected)'
									: 'Open debug panel'}
							>
								<i class="bx bx-bug"></i>
								<span class="call-header__debug-label">Debug</span>
								{#if voiceErrorCount > 0}
									<span
										class="call-header__debug-count"
										aria-label={`Detected ${voiceErrorCount} error${voiceErrorCount === 1 ? '' : 's'}`}
									>
										{voiceErrorCount}
									</span>
								{:else if voiceWarnCount > 0}
									<span class="call-header__debug-count call-header__debug-count--warn"
										>{voiceWarnCount}</span
									>
								{/if}
								{#if hasDebugAlerts}
									<span class="call-header__debug-pulse" aria-hidden="true"></span>
								{/if}
							</button>
						{/if}
						<button
							type="button"
							class="call-header__minimize"
							onclick={handleMinimize}
							aria-label="Hide call"
						>
							<i class="bx bx-minus"></i>
							<span class="call-header__minimize-label">Hide</span>
						</button>
					</div>
				</header>
			{:else}
				<div class="compact-call-header">
					<div class="compact-call-header__title">
						<i class="bx bx-hash"></i>
						<span>#{sessionChannelName || 'Voice channel'}</span>
					</div>
					<div class="compact-call-header__meta">
						<span class={`compact-call-header__status ${remoteConnected ? 'is-online' : ''}`}>
							{remoteConnected ? 'Connected' : 'Connecting'}
						</span>
						<span class="compact-call-header__count">
							<i class="bx bx-user-voice"></i>
							{participantCount}
						</span>
					</div>
				</div>
			{/if}
		{/if}
		{#if popoutMode}
			<div class="call-popout-placeholder">
				<div class="call-popout-placeholder__body">
					<div>
						<p class="call-popout-placeholder__title">Call popped out</p>
						<p class="call-popout-placeholder__subtitle">
							Keep this tab open. Click return to bring the call back.
						</p>
					</div>
					<button type="button" class="call-popout-placeholder__action" onclick={togglePopout}>
						Return call here
					</button>
				</div>
			</div>
		{/if}
		<section
			class="call-stage"
			class:call-stage--embedded={isEmbedded}
			role="group"
			aria-label="Call stage"
			onpointermove={handleStagePointerMove}
			onmouseenter={handleStagePointerMove}
			onpointerleave={handleStageLeave}
			bind:this={callStageEl}
		>
			{#if isJoined && gridTiles.length}
				<MediaStageAny
					mode={mediaMode}
					tiles={gridTiles}
					{gridColumns}
					focusedTileId={gridMode === 'focus' && focusedTile ? focusedTile.uid : null}
					gridMode={gridMode === 'focus' ? 'focus' : 'grid'}
					showSelf={showSelfInGrid}
					muteActive={isMicActive}
					videoActive={isCameraActive}
					shareActive={isScreenSharing}
					shareDisabled={isScreenSharePending || isCameraToggling}
					moreOpen={moreMenuOpen}
					onToggleMute={toggleMic}
					onToggleVideo={toggleCamera}
					onToggleShare={() => toggleScreenShare()}
					onOpenMore={() => {
						moreMenuOpen = !moreMenuOpen;
						showControlsBar();
					}}
					onToggleGrid={toggleGridMode}
					onToggleSelf={toggleShowSelf}
					onOpenSettings={() => openVoiceSettingsPanel()}
					controlsVisibleOverride={isEmbedded ? true : controlsVisible}
					hideControls={true}
				>
					<div
						slot="video"
						class={`call-grid ${gridMode === 'focus' && focusedTile ? 'call-grid--focus' : ''} ${gridTiles.length === 1 ? 'call-grid--single' : ''} ${gridTiles.length === 2 ? 'call-grid--duo' : ''}`}
					>
						{#each gridTiles as tile (tile.uid)}
							<article
								class={`call-tile ${tile.isSelf ? 'call-tile--self' : ''} ${tile.screenSharing ? 'call-tile--sharing' : ''} ${tile.isSpeaking ? 'call-tile--speaking' : ''} ${gridMode === 'focus' && focusedTile && tile.uid === focusedTile.uid ? 'call-tile--focus-main' : ''}`}
								data-voice-menu
								ontouchstart={() => handleLongPressStart(tile.uid)}
								ontouchend={() => handleLongPressEnd(tile.uid)}
								ontouchcancel={() => handleLongPressEnd(tile.uid)}
								oncontextmenu={(event) => openVolumeMenu(event, tile.uid)}
							>
								<div class="call-tile__media">
									<video
										use:videoSink={tile.uid}
										autoplay
										playsinline
										muted={tile.isSelf}
										class:call-tile__video-visible={streamHasLiveVideo(tile.stream)}
									></video>
									{#if !streamHasLiveVideo(tile.stream)}
										<div class="call-avatar">
											<div class="call-avatar__image">
												<Avatar src={tile.photoURL} name={tile.displayName} size="xl" isSelf={tile.isSelf} class="w-full h-full" />
											</div>
										</div>
									{/if}
									{#if !tile.isSelf}
										<audio use:audioSink={tile.uid} autoplay playsinline class="hidden"></audio>
									{/if}
								</div>
								<div class="call-tile__footer">
									<div class="call-tile__footer-name">
										<span class="call-tile__footer-text" title={tile.displayName}>
											{tile.isSelf ? 'You' : tile.displayName}
										</span>
										{#if tile.isSelf}
											<span class="call-tile__footer-pill">YOU</span>
										{/if}
										{#if tile.screenSharing}
											<span class="call-tile__footer-pill call-tile__footer-pill--share">LIVE</span>
										{/if}
									</div>
									<div class="call-tile__footer-icons">
										<i class={`bx ${tile.hasAudio ? 'bx-microphone' : 'bx-microphone-off is-off'}`}
										></i>
										<i class={`bx ${tile.hasVideo ? 'bx-video' : 'bx-video-off is-off'}`}></i>
									</div>
								</div>
								<button
									type="button"
									class={`call-tile__menu-button ${tile.isSelf ? 'call-tile__menu-button--self' : ''}`}
									onclick={stopPropagation(() => openMenu(tile.uid))}
									data-voice-menu
									aria-label={`Voice options for ${tile.isSelf ? 'you' : tile.displayName}`}
								>
									<i class="bx bx-dots-vertical-rounded"></i>
								</button>

								{#if menuOpenFor === tile.uid}
									<div class="call-tile__menu-panel" data-voice-menu>
										<div class="call-menu__header">
											<span>{tile.isSelf ? 'You' : tile.displayName}</span>
											<button type="button" onclick={closeMenu} aria-label="Close participant menu">
												<i class="bx bx-x"></i>
											</button>
										</div>
										{#if tile.isSelf}
											<button type="button" class="call-menu__action" onclick={toggleMic} disabled={isMicToggling}>
												<div>
													<span>{isMicActive ? 'Mute mic' : 'Unmute mic'}</span>
													<small>Control your microphone</small>
												</div>
												<i class={`bx ${isMicActive ? 'bx-microphone' : 'bx-microphone-off'}`}></i>
											</button>
											<button type="button" class="call-menu__action" onclick={toggleDeafenSelf}>
												<div>
													<span>{isPlaybackMuted ? 'Undeafen' : 'Deafen'}</span>
													<small>Mute incoming audio and your mic</small>
												</div>
												<i class={`bx ${isPlaybackMuted ? 'bx-volume-full' : 'bx-volume-mute'}`}
												></i>
											</button>
											<button type="button" class="call-menu__action" onclick={toggleCamera} disabled={isCameraToggling}>
												<div>
													<span>{isCameraActive ? 'Turn camera off' : 'Turn camera on'}</span>
													<small>Control your video</small>
												</div>
												<i class={`bx ${isCameraActive ? 'bx-video' : 'bx-video-off'}`}></i>
											</button>
											<button type="button" class="call-menu__action" onclick={openSelfPreview}>
												<div>
													<span>Preview camera</span>
													<small>Open a floating self view</small>
												</div>
												<i class="bx bx-user-circle"></i>
											</button>
											<button
												type="button"
												class="call-menu__action"
												onclick={() => openVoiceSettingsPanel('voice')}
											>
												<div>
													<span>Change input device</span>
													<small>Jump to Voice settings</small>
												</div>
												<i class="bx bx-slider-alt"></i>
											</button>
											<button
												type="button"
												class="call-menu__action"
												onclick={() => openVoiceSettingsPanel('video')}
											>
												<div>
													<span>Change camera</span>
													<small>Jump to Video settings</small>
												</div>
												<i class="bx bx-slider"></i>
											</button>
										{:else}
											<div class="call-menu__section">
												<div class="call-menu__label">
													<span>Volume</span>
													<span>{Math.round(tile.controls.volume * 100)}%</span>
												</div>
												<input
													class="call-menu__slider"
													type="range"
													min="0"
													max="200"
													step="5"
													value={Math.round(tile.controls.volume * 100)}
													oninput={(event) => {
														const target = event.currentTarget as HTMLInputElement;
														setParticipantVolume(tile.uid, Number(target.value) / 100);
													}}
												/>
											</div>
											<button
												type="button"
												class="call-menu__action"
												onclick={() => toggleParticipantMute(tile.uid)}
											>
												<div>
													<span>{tile.controls.muted ? 'Unmute for me' : 'Mute for me'}</span>
													<small>Local mute for your ears</small>
												</div>
												<i class={`bx ${tile.controls.muted ? 'bx-volume-full' : 'bx-volume-mute'}`}
												></i>
											</button>
											<button type="button" class="call-menu__action">
												<div>
													<span>View profile</span>
													<small>Open user card (soon)</small>
												</div>
												<i class="bx bx-id-card"></i>
											</button>
											{#if canKickMembers}
												<button
													type="button"
													class="call-menu__action"
													onclick={() => toggleServerMute(tile.uid)}
												>
													<div>
														<span
															>{moderationState(tile.uid).serverMuted
																? 'Undo server mute'
																: 'Server mute'}</span
														>
														<small>Silence this user in the call</small>
													</div>
													<i
														class={`bx ${moderationState(tile.uid).serverMuted ? 'bx-toggle-right' : 'bx-toggle-left'}`}
													></i>
												</button>
												<button
													type="button"
													class="call-menu__action"
													onclick={() => toggleServerDeafen(tile.uid)}
												>
													<div>
														<span
															>{moderationState(tile.uid).serverDeafened
																? 'Undo server deafen'
																: 'Server deafen'}</span
														>
														<small>Mute and deafen for moderation</small>
													</div>
													<i
														class={`bx ${moderationState(tile.uid).serverDeafened ? 'bx-toggle-right' : 'bx-toggle-left'}`}
													></i>
												</button>
												<button type="button" class="call-menu__action">
													<div>
														<span>Manage roles</span>
														<small>Open roles (soon)</small>
													</div>
													<i class="bx bx-shield-quarter"></i>
												</button>
												<button
													type="button"
													class="call-menu__action call-menu__action--danger"
													onclick={() => {
														const target = participants.find((p) => p.uid === tile.uid);
														if (target) kickParticipant(target);
														closeMenu();
													}}
												>
													<span>Disconnect from voice</span>
													<i class="bx bx-user-x"></i>
												</button>
											{/if}
											<div class="call-menu__note">
												<span class="call-menu__label">Roles</span>
												<span class="call-menu__roles">Member - Permissions synced</span>
											</div>
										{/if}
									</div>
								{/if}
							</article>
						{/each}
					</div>
				</MediaStageAny>
				<div class="call-stage__actions">
					<button
						type="button"
						class="call-stage__icon-button"
						aria-label="Open channel messages"
						onclick={() => dispatch('openChannelChat')}
					>
						<i class="bx bx-message-dots"></i>
					</button>
				</div>
			{:else if isJoined}
				<!-- Joined but no tiles yet - show loading state -->
				{@const selfPhotoUrl = resolveProfilePhotoURL($userProfile ?? $user)}
				<div class="call-empty" aria-label="Call loading">
					<div class="call-empty__tile">
						<div class="call-empty__avatar">
							<Avatar src={selfPhotoUrl} user={$userProfile ?? $user} name="Your avatar" size="2xl" isSelf={true} class="w-full h-full" />
						</div>
						<div class="call-empty__label">
							{sessionChannelName || 'Voice channel'}
						</div>
						<div class="call-empty__hint">Connected — loading call...</div>
					</div>
				</div>
			{:else}
				{@const selfPhotoUrl = resolveProfilePhotoURL($userProfile ?? $user)}
				<div class="call-empty" aria-label="Call preview">
					<div class="call-empty__tile">
						<div class="call-empty__avatar">
							<Avatar src={selfPhotoUrl} user={$userProfile ?? $user} name="Your avatar" size="2xl" isSelf={true} class="w-full h-full" />
						</div>
						<div class="call-empty__label">
							{sessionChannelName || 'Voice channel'}
						</div>
						<div class="call-empty__hint">Preview ready — join to start</div>
					</div>
				</div>
			{/if}
		</section>

		{#if !showSelfInGrid && selfTile && localStream}
			<div class="self-preview">
				<div class="self-preview__header">
					<span>Self preview</span>
					<span class="self-preview__pill">Hidden from grid</span>
				</div>
				<video playsinline autoplay muted bind:this={selfPreviewEl}></video>
			</div>
		{/if}

		{#if showChrome}
			<footer
				class="call-controls"
				class:call-controls--embedded={isEmbedded}
				class:call-controls--visible={isEmbedded || controlsVisible}
				style:padding-bottom="calc(env(safe-area-inset-bottom, 0px) + var(--mobile-dock-height, 0px) + 1.4rem)"
				onpointerenter={showControlsBar}
				onpointerleave={() => scheduleControlsHide()}
				onfocusin={showControlsBar}
			>
				{#if !isJoined}
					<div class="call-controls__row call-controls__row--join">
						<button
							class="call-button call-button--primary"
							onclick={handleJoinClick}
							disabled={isConnecting || !serverId || !channelId}
						>
							<i class="bx bx-phone"></i>
							{isConnecting ? 'Connecting...' : 'Join Voice'}
						</button>
					</div>
				{:else}
					<div class="call-controls__row call-controls__row--connected">
						<div class="call-controls__status">
							{#if audioNeedsUnlock}
								<div class="call-audio-unlock">
									<button
										class="call-button call-button--primary"
										type="button"
										onclick={unlockAudioPlayback}
									>
										<i class="bx bx-volume-full"></i>
										Enable audio
									</button>
									<span class="call-status-message">Your browser blocked auto-play.</span>
								</div>
							{:else}
								<span class="call-status-message" aria-hidden="true"></span>
							{/if}
						</div>
						<div class="call-controls__group call-controls__group--main">
							<div class="call-controls__item">
								<button
									class={controlClasses({ active: isMicActive, disabled: isMicToggling })}
									onclick={toggleMic}
									aria-label={micButtonLabel}
									disabled={isMicToggling}
								>
									<i class={`bx ${isMicActive ? 'bx-microphone' : 'bx-microphone-off'}`}></i>
								</button>
								<span>{isMicActive ? 'Mute' : 'Muted'}</span>
							</div>
							<div class="call-controls__item">
								<button
									class={controlClasses({ active: isPlaybackMuted })}
									onclick={toggleDeafenSelf}
									aria-label={isPlaybackMuted ? 'Undeafen' : 'Deafen'}
								>
									<i class={`bx ${isPlaybackMuted ? 'bx-volume-mute' : 'bx-headphone'}`}></i>
								</button>
								<span>{isPlaybackMuted ? 'Deafened' : 'Deafen'}</span>
							</div>
							<div class="call-controls__item">
								<button
									class={controlClasses({ active: isCameraActive, disabled: isCameraToggling })}
									onclick={toggleCamera}
									aria-label={cameraButtonLabel}
									disabled={isCameraToggling}
								>
									<i class={`bx ${isCameraActive ? 'bx-video' : 'bx-video-off'}`}></i>
								</button>
								<span>{isCameraActive ? 'Camera' : 'Camera off'}</span>
							</div>
							{#if !compactMatch}
								<div class="call-controls__item">
									<button
										class={controlClasses({
											active: isScreenSharing,
											disabled: isScreenSharePending
										})}
										onclick={toggleScreenShare}
										aria-label={screenShareButtonLabel}
										disabled={isScreenSharePending}
									>
										<i class="bx bx-desktop"></i>
									</button>
									<span>{isScreenSharing ? 'Stop share' : 'Share'}</span>
								</div>
							{/if}
							<div class="call-controls__item call-controls__item--more">
								<button
									class={controlClasses()}
									onclick={() => {
										moreMenuOpen = !moreMenuOpen;
										showControlsBar();
									}}
									aria-haspopup="true"
									aria-expanded={moreMenuOpen}
									aria-label="More call options"
									data-voice-menu
								>
									<i class="bx bx-dots-horizontal-rounded"></i>
								</button>
								<span>More</span>
								{#if moreMenuOpen}
									<div class="call-more-menu" data-voice-menu>
										<button type="button" onclick={toggleGridMode}>
											<i class={`bx ${gridMode === 'focus' ? 'bx-grid-alt' : 'bx-grid-horizontal'}`}
											></i>
											<span>{gridMode === 'focus' ? 'Grid view' : 'Focus view'}</span>
										</button>
										<button type="button" onclick={toggleShowSelf}>
											<i class={`bx ${showSelfInGrid ? 'bx-hide' : 'bx-show'}`}></i>
											<span>{showSelfInGrid ? 'Hide self' : 'Show self'}</span>
										</button>
										<button type="button" onclick={() => openVoiceSettingsPanel()}>
											<i class="bx bx-cog"></i>
											<span>Settings</span>
										</button>
									</div>
								{/if}
							</div>
							{#if compactMatch}
								<div
									class="call-controls__item call-controls__item--leave call-controls__item--leave-inline"
								>
									<button
										class={controlClasses({ danger: true })}
										onclick={handleLeave}
										aria-label="Leave call"
									>
										<i class="bx bx-phone-off"></i>
									</button>
									<span>Leave</span>
								</div>
							{/if}
						</div>
						{#if !compactMatch}
							<div class="call-controls__group call-controls__group--exit">
								<div class="call-controls__item call-controls__item--leave">
									<button
										class={controlClasses({ danger: true })}
										onclick={handleLeave}
										aria-label="Leave call"
									>
										<i class="bx bx-phone-off"></i>
									</button>
									<span>Leave</span>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</footer>
		{/if}
	</div>

	{#if debugLoggingEnabled}
		<div
			class={`call-debug-drawer ${debugPanelVisible ? 'call-debug-drawer--open' : ''}`}
			class:call-debug-drawer--custom={!!debugPanelPosition}
			class:call-debug-drawer--dragging={isDebugPanelDragging}
			bind:this={debugPanelDrawerEl}
			role="dialog"
			aria-modal="false"
			aria-label="Call diagnostics"
			style:left={debugPanelPosition ? `${debugPanelPosition.x}px` : undefined}
			style:top={debugPanelPosition ? `${debugPanelPosition.y}px` : undefined}
		>
			<section class="call-debug-panel">
				<header
					class="call-debug-panel__header"
					class:call-debug-panel__header--dragging={isDebugPanelDragging}
					onpointerdown={handleDebugPanelPointerDown}
				>
					<div class="call-debug-panel__heading">
						<i class="bx bx-bug"></i>
						<span>Call diagnostics</span>
					</div>
					<div class="call-debug-panel__header-actions">
						<button
							type="button"
							class="call-debug-panel__copy"
							onclick={() => handleDebugPanelCopy(150, 220, 'panel-header')}
							disabled={copyInFlight}
						>
							<i class={`bx ${copyInFlight ? 'bx-loader bx-spin' : 'bx-clipboard'}`}></i>
							<span>{copyInFlight ? 'Copying…' : 'Copy'}</span>
						</button>
						<button
							type="button"
							class="call-debug-panel__refresh"
							onclick={handleDebugPanelRefresh}
						>
							<i class="bx bx-refresh"></i>
							<span>Refresh</span>
						</button>
						<button
							type="button"
							class="call-debug-panel__close"
							onclick={() => toggleDebugPanel(false)}
							aria-label="Close debug panel"
						>
							<i class="bx bx-x"></i>
						</button>
					</div>
				</header>
				<div class="call-debug-panel__scroll">
					<div class="call-debug-panel__grid">
						<div class="call-debug-panel__section call-debug-panel__section--stats">
							<div class="quick-stats__heading">
								<h2 class="call-debug-panel__title">Quick Stats</h2>
								<div class="quick-stats__actions">
									<div class="quick-stats__summary" title={quickStatsSummaryTooltip}>
										{quickStatsSummary}
									</div>
									<button
										type="button"
										class="quick-stats__toggle"
										onclick={() => toggleQuickStats()}
										aria-expanded={quickStatsExpanded}
										title={quickStatsExpanded ? 'Hide detailed stats' : 'Show detailed stats'}
									>
										<i class={`bx ${quickStatsExpanded ? 'bx-chevron-up' : 'bx-chevron-down'}`}></i>
										<span>{quickStatsExpanded ? 'Hide details' : 'Show details'}</span>
									</button>
									<button
										type="button"
										class="quick-stats__copy"
										onclick={() => handleDebugPanelCopy(150, 220, 'quick-stats')}
										title="Copy expanded diagnostics bundle"
										disabled={copyInFlight}
									>
										<i class={`bx ${copyInFlight ? 'bx-loader bx-spin' : 'bx-clipboard'}`}></i>
										<span>{copyInFlight ? 'Copying…' : 'Copy logs'}</span>
									</button>
								</div>
							</div>
							{#if quickStatsExpanded}
								<div class="quick-stats__grid">
									{#each quickStatsItems as stat (stat.key)}
										<div class="quick-stats__item">
											<span class="quick-stats__key">{stat.label}</span>
											<span class="quick-stats__value" title={stat.tooltip ?? stat.value}
												>{stat.value}</span
											>
										</div>
									{/each}
								</div>
							{/if}
						</div>
						<div class="call-debug-panel__section call-debug-panel__section--participants">
							<h2 class="call-debug-panel__title">Participants</h2>
							{#if debugParticipants.length}
								<ul class="call-debug-participants">
									{#each debugParticipants as participant (participant.uid)}
										<li>
											<div class="call-debug-participant__header">
												<span class="call-debug-participant__name">{participant.displayName}</span>
												<span
													class={`call-debug-participant__status call-debug-participant__status--${participant.status ?? 'active'}`}
												>
													{participant.status ?? 'active'}
												</span>
											</div>
											<div class="call-debug-participant__meta">
												<code>{participant.uid}</code>
												{#if participant.uid === currentUserId}
													<span class="call-debug-participant__badge">you</span>
												{/if}
											</div>
											<div class="call-debug-participant__tags">
												<span class={`tag ${participant.hasAudio ? '' : 'tag--off'}`}>
													<i
														class={`bx ${participant.hasAudio ? 'bx-microphone' : 'bx-microphone-off'}`}
													></i>
													Audio
												</span>
												<span class={`tag ${participant.hasVideo ? '' : 'tag--off'}`}>
													<i class={`bx ${participant.hasVideo ? 'bx-video' : 'bx-video-off'}`}></i>
													Video
												</span>
												<span class={`tag ${participant.screenSharing ? 'tag--active' : ''}`}>
													<i class="bx bx-desktop"></i>
													Share
												</span>
											</div>
											<div class="call-debug-participant__meta">
												<span>Stream</span>
												<code>{participant.streamId ?? 'none'}</code>
											</div>
											{#if participant.renegotiationRequestId}
												<div class="call-debug-participant__meta">
													<span>Renegotiation</span>
													<code>{participant.renegotiationRequestId}</code>
												</div>
											{/if}
										</li>
									{/each}
								</ul>
							{:else}
								<p class="call-debug-empty">No participants detected.</p>
							{/if}
						</div>
						<div class="call-debug-panel__section call-debug-panel__section--logs">
							<h2 class="call-debug-panel__title">Recent Logs</h2>
							{#if voiceLogs.length}
								<ul class="call-debug-logs">
									{#each voiceLogs.slice(0, 10) as entry (entry.id)}
										<li class={`call-debug-log call-debug-log--${entry.severity}`}>
											<div class="call-debug-log__row">
												<span class="time">{entry.timestamp}</span>
												<span class="call-debug-log__pill">{entry.severity}</span>
											</div>
											<span class="msg">{entry.message}</span>
											{#if entry.details}
												<pre>{entry.details}</pre>
											{/if}
										</li>
									{/each}
								</ul>
							{:else}
								<p class="call-debug-empty">No events yet.</p>
							{/if}
						</div>
						<div class="call-debug-panel__section call-debug-panel__section--doc">
							<h2 class="call-debug-panel__title">Call Document</h2>
							<pre>{callSnapshotDebug || 'Awaiting call document...'}</pre>
						</div>
						<div class="call-debug-panel__section call-debug-panel__section--peer">
							<h2 class="call-debug-panel__title">Peer Diagnostics</h2>
							<div class="peer-diag">
								<div class="peer-diag__column">
									<h3>Transceivers</h3>
									{#if peerDiagnostics.transceivers.length}
										<ul class="peer-diag__list">
											{#each peerDiagnostics.transceivers as trx, index (trx.mid ?? `trx-${index}`)}
												<li>
													<span class="peer-diag__headline">
														MID {trx.mid ?? '(pending)'} - {trx.currentDirection ?? 'unknown'}
														{#if trx.preferredDirection && trx.preferredDirection !== trx.currentDirection}
															<span class="peer-diag__badge">to {trx.preferredDirection}</span>
														{/if}
														{#if trx.isStopped}
															<span class="peer-diag__badge peer-diag__badge--warn">stopped</span>
														{/if}
													</span>
													<span class="peer-diag__label">Sender</span>
													<span class="peer-diag__value"
														>{formatTrackDiagnostics(trx.senderTrack)}</span
													>
													<span class="peer-diag__label">Receiver</span>
													<span class="peer-diag__value"
														>{formatTrackDiagnostics(trx.receiverTrack)}</span
													>
												</li>
											{/each}
										</ul>
									{:else}
										<p class="call-debug-empty">No transceivers.</p>
									{/if}
								</div>
								<div class="peer-diag__column">
									<h3>Senders</h3>
									{#if peerDiagnostics.senders.length}
										<ul class="peer-diag__list">
											{#each peerDiagnostics.senders as sender, index (`sender-${index}`)}
												<li>
													<span class="peer-diag__label">Track</span>
													<span class="peer-diag__value"
														>{formatTrackDiagnostics(sender.track)}</span
													>
													<span class="peer-diag__label">Streams</span>
													<span class="peer-diag__value">
														{sender.streams.length ? sender.streams.join(', ') : 'none'}
													</span>
													<span class="peer-diag__label">Transport</span>
													<span class="peer-diag__value">{sender.transportState ?? 'unknown'}</span>
												</li>
											{/each}
										</ul>
									{:else}
										<p class="call-debug-empty">No RTP senders.</p>
									{/if}
								</div>
								<div class="peer-diag__column">
									<h3>Remote Streams</h3>
									{#if peerDiagnostics.remoteStreams.length}
										<ul class="peer-diag__list">
											{#each peerDiagnostics.remoteStreams as stream (stream.id)}
												<li>
													<span class="peer-diag__headline">#{stream.id}</span>
													<span class="peer-diag__label">Audio</span>
													<span class="peer-diag__value">
														{stream.audioTracks.length
															? stream.audioTracks
																	.map((track) => formatTrackDiagnostics(track))
																	.join(' | ')
															: 'none'}
													</span>
													<span class="peer-diag__label">Video</span>
													<span class="peer-diag__value">
														{stream.videoTracks.length
															? stream.videoTracks
																	.map((track) => formatTrackDiagnostics(track))
																	.join(' | ')
															: 'none'}
													</span>
												</li>
											{/each}
										</ul>
									{:else}
										<p class="call-debug-empty">No remote streams attached.</p>
									{/if}
								</div>
							</div>
						</div>
						<div class="call-debug-panel__section call-debug-panel__section--tools">
							<h2 class="call-debug-panel__title">Debug Tools</h2>
							<div class="call-debug-actions">
								<button
									type="button"
									class="call-debug-action"
									onclick={() => handleDebugPanelCopy(160, 240, 'tools-section')}
									disabled={copyInFlight}
								>
									<i class={`bx ${copyInFlight ? 'bx-loader bx-spin' : 'bx-copy'}`}></i>
									<span>{copyInFlight ? 'Copying…' : 'Copy debug info'}</span>
								</button>
								<button type="button" class="call-debug-action" onclick={handleDebugPanelRefresh}>
									<i class="bx bx-refresh"></i>
									<span>Refresh diagnostics</span>
								</button>
								<button
									type="button"
									class="call-debug-action"
									onclick={handleResetIceStrategy}
									disabled={!forceRelayIceTransport &&
										!fallbackTurnActivated &&
										!usingFallbackTurnServers}
								>
									<i class="bx bx-undo"></i>
									<span>Reset ICE strategy</span>
								</button>
								<button
									type="button"
									class="call-debug-action"
									onclick={handleForceRestart}
									disabled={isRestartingCall || isConnecting}
								>
									<i class={`bx ${isRestartingCall ? 'bx-loader-alt bx-spin' : 'bx-reset'}`}></i>
									<span>{isRestartingCall ? 'Restarting call...' : 'Restart call'}</span>
								</button>
							</div>
						</div>
					</div>
				</div>
			</section>
		</div>
	{/if}

	{#if errorMessage}
		<div class="call-error">
			<div class="call-error__text">{errorMessage}</div>
			<button
				type="button"
				class="call-error__copy"
				onclick={copyErrorMessage}
				disabled={copyErrorInFlight}
			>
				<i class={`bx ${copyErrorInFlight ? 'bx-loader bx-spin' : 'bx-copy'}`}></i>
				<span>{copyErrorInFlight ? 'Copying…' : 'Copy error'}</span>
			</button>
		</div>
	{/if}

	{#if volumeMenu}
		<div
			class="volume-menu-backdrop"
			role="presentation"
			tabindex="-1"
			onclick={closeVolumeMenu}
			onkeydown={(event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					closeVolumeMenu();
				}
			}}
		></div>
		<div
			class="volume-menu"
			style={`left:${volumeMenu.x}px; top:${volumeMenu.y}px`}
			role="dialog"
			aria-label="Volume"
		>
			<div class="volume-menu__row">
				<span>Volume</span>
				<span>{Math.round((getParticipantControls(volumeMenu.uid).volume ?? 1) * 100)}%</span>
			</div>
			<input
				type="range"
				min="0"
				max="200"
				step="5"
				value={Math.round((getParticipantControls(volumeMenu.uid).volume ?? 1) * 100)}
				oninput={(event) => {
					if (!volumeMenu) return;
					const value = Number(event.currentTarget.value);
					setParticipantVolume(volumeMenu.uid, value / 100);
				}}
			/>
		</div>
	{/if}
</div>

<style>
	.voice-root {
		--voice-root-padding: clamp(0.5rem, 1.4vw, 1rem);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-height: 100%;
		padding: var(--voice-root-padding);
		color: var(--text-100);
	}

	.voice-root--minimal {
		padding: clamp(1.25rem, 3vw, 2.25rem);
		min-height: 100vh;
		background: #202225;
		width: 100%;
		display: flex;
		flex-direction: column;
	}

	.voice-root--compact {
		padding-bottom: calc(var(--voice-root-padding) + var(--mobile-dock-height, 0px));
	}

	.voice-root--compact .call-shell {
		padding: 0.5rem;
		gap: 0.5rem;
		flex: 1;
	}

	.voice-root--compact .call-stage {
		padding: 0.3rem;
		border: none;
		background: transparent;
		height: clamp(200px, 55vh, 360px);
		overflow: hidden;
		justify-content: center;
		align-items: center;
	}

	.voice-root--compact .call-stage--embedded {
		min-height: auto;
		max-height: none;
		border: none;
		background: transparent;
		padding: 0;
		flex: 1;
	}

	.voice-root--compact .call-grid {
		grid-template-columns: 1fr;
		gap: 0.3rem;
		justify-items: center;
		width: 100%;
		max-width: min(480px, 100%);
	}

	.voice-root--compact .call-tile {
		width: 360px;
		height: 202px;
		min-height: auto;
	}

	.voice-root--compact .call-controls {
		position: relative;
		left: 0;
		bottom: 0;
		transform: none;
		opacity: 1;
		pointer-events: auto;
		padding: 0.45rem;
		margin-top: auto;
		width: 100%;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 45%, transparent);
		box-shadow: none;
	}

	.voice-root--compact .call-controls__item span {
		display: none;
	}

	.voice-root--compact .call-controls__group--main {
		gap: 0.45rem;
		width: 100%;
		justify-content: space-between;
	}

	.voice-root--compact .call-header,
	.voice-root--compact .call-debug-banner {
		display: none !important;
	}

	.compact-call-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: color-mix(in srgb, var(--color-panel) 82%, transparent);
		border-radius: 0.85rem;
		padding: 0.45rem 0.75rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		color: var(--text-80);
		font-size: 0.75rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.compact-call-header__title {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-weight: 600;
	}

	.compact-call-header__title i {
		font-size: 1rem;
		color: var(--color-accent);
	}

	.compact-call-header__meta {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.68rem;
		color: var(--text-60);
	}

	.compact-call-header__status.is-online {
		color: var(--color-accent);
	}

	.compact-call-header__count {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.voice-root--embedded {
		min-height: auto;
		padding: clamp(0.55rem, 1.4vw, 0.9rem);
		gap: clamp(0.7rem, 1.2vw, 1rem);
		width: 100%;
	}

	.call-shell {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
		gap: 0.6rem;
		border-radius: 0.75rem;
		background: color-mix(in srgb, var(--color-panel-muted) 70%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
		box-shadow: 0 4px 12px rgba(5, 8, 18, 0.18);
		padding: clamp(0.65rem, 1.6vw, 0.95rem);
		min-height: auto;
		overflow: visible;
	}

	.call-shell--embedded {
		flex: none;
		min-height: auto;
		box-shadow: 0 3px 10px rgba(8, 12, 24, 0.18);
		background: color-mix(in srgb, var(--color-panel) 78%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		overflow: visible;
	}

	.call-shell--minimal {
		padding: 0;
		background: #202225;
		border: none;
		box-shadow: none;
		width: 100%;
		min-height: 100vh;
		display: flex;
	}

	.call-shell--popout {
		position: fixed;
		inset: clamp(0.75rem, 2vw, 1.2rem);
		z-index: 60;
		max-width: min(1200px, calc(100vw - 1.5rem));
		max-height: calc(100vh - 1.5rem);
		overflow: hidden;
	}

	.call-header {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: space-between;
		align-items: center;
		padding-bottom: 0.25rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
	}

	.call-header__info {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-width: 0;
	}

	.call-header__icon {
		width: 2.1rem;
		height: 2.1rem;
		border-radius: 0.55rem;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--color-panel) 65%, transparent);
		color: var(--text-80);
		font-size: 1.1rem;
	}

	@media (max-width: 640px) {
		.call-header__icon {
			width: 2.5rem;
			height: 2.5rem;
			font-size: 1.1rem;
		}

		.voice-root--embedded {
			padding: 0.58rem;
		}

		.call-shell--embedded {
			padding: 0.55rem;
			gap: 0.55rem;
		}

		.call-stage--embedded {
			min-height: clamp(160px, 46vh, 360px);
			max-height: clamp(200px, 50vh, 400px);
			padding: 0.5rem;
		}

		.call-controls--embedded {
			padding: 0.55rem;
		}

		.call-debug-banner {
			display: none;
		}
	}

	.call-header__title {
		font-size: clamp(0.92rem, 1.9vw, 1rem);
		font-weight: 600;
		color: var(--text-100);
		max-width: 22ch;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.call-header__subtitle {
		font-size: 0.68rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-55);
	}

	.call-header__actions {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}

	.call-header__count {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.32rem 0.6rem;
		border-radius: 0.6rem;
		background: color-mix(in srgb, var(--color-panel) 50%, transparent);
		color: var(--text-80);
		font-size: 0.82rem;
	}

	.call-status {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--text-55);
	}

	.call-header__chat {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.38rem 0.65rem;
		border-radius: 0.65rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 65%, transparent);
		color: var(--text-80);
		font-weight: 600;
		font-size: 0.82rem;
		transition:
			background 150ms ease,
			border-color 150ms ease,
			color 150ms ease;
	}

	.call-header__chat:hover {
		background: color-mix(in srgb, var(--color-panel) 75%, transparent);
		color: var(--text-90);
	}

	.call-header__chat--active {
		border-color: color-mix(in srgb, var(--color-accent) 65%, transparent);
		background: color-mix(in srgb, var(--color-accent) 25%, transparent);
		color: color-mix(in srgb, var(--color-accent) 95%, white);
	}

	.call-status__dot {
		position: relative;
		display: inline-flex;
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 999px;
		background: var(--text-30);
	}

	.call-status__dot--online {
		background: color-mix(in srgb, var(--color-accent) 85%, transparent);
	}

	.call-status__pulse {
		position: absolute;
		inset: -0.3rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 35%, transparent);
		animation: pulse 1.6s infinite;
	}

	@keyframes pulse {
		0% {
			transform: scale(0.6);
			opacity: 0.6;
		}
		100% {
			transform: scale(1.4);
			opacity: 0;
		}
	}

	.call-header__debug {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.75rem;
		border-radius: 0.65rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 75%, transparent);
		background: color-mix(in srgb, var(--color-panel) 40%, transparent);
		color: var(--text-70);
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		transition:
			border-color 180ms ease,
			background 180ms ease,
			color 180ms ease;
	}

	.call-header__debug i {
		font-size: 1rem;
	}

	.call-header__debug:hover,
	.call-header__debug:focus-visible {
		background: color-mix(in srgb, var(--color-panel) 55%, transparent);
		color: var(--text-90);
		border-color: color-mix(in srgb, var(--color-border-strong) 65%, transparent);
	}

	.call-header__debug:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 40%, transparent);
	}

	.call-header__debug--active {
		background: color-mix(in srgb, var(--color-accent) 32%, transparent);
		color: var(--text-95);
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
	}

	.call-header__debug--alert {
		border-color: color-mix(in srgb, var(--color-warning, #facc15) 55%, transparent);
	}

	.call-header__debug-label {
		display: none;
	}

	@media (min-width: 720px) {
		.call-header__debug-label {
			display: inline;
		}
	}

	.call-header__debug-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.25rem;
		height: 1.25rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-danger) 35%, transparent);
		color: var(--text-95);
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0 0.35rem;
	}

	.call-header__debug-count--warn {
		background: color-mix(in srgb, var(--color-warning, #facc15) 35%, transparent);
		color: rgba(40, 32, 0, 0.85);
	}

	.call-header__debug-pulse {
		position: absolute;
		inset: -0.35rem -0.35rem auto auto;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-danger) 60%, transparent);
		animation: debugPulse 1.6s infinite;
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-danger) 20%, transparent);
	}

	@keyframes debugPulse {
		0% {
			transform: scale(0.8);
			opacity: 0.9;
		}
		100% {
			transform: scale(2.1);
			opacity: 0;
		}
	}

	.call-header__minimize {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.45rem 0.85rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-panel) 40%, transparent);
		color: var(--text-60);
		font-size: 0.8rem;
		transition:
			background 150ms ease,
			color 150ms ease;
	}

	.call-header__minimize i {
		font-size: 1rem;
	}

	.call-header__minimize:hover {
		background: color-mix(in srgb, var(--color-panel) 60%, transparent);
		color: var(--text-80);
	}

	.call-header__minimize:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 45%, transparent);
	}

	.call-header__minimize-label {
		display: none;
	}

	@media (min-width: 640px) {
		.call-header__minimize-label {
			display: inline;
		}
	}

	.call-stage {
		flex: 1;
		min-height: 0;
		display: flex;
		position: relative;
		overflow: hidden;
		background: #1e1f22;
		border-radius: 8px;
		padding: 8px;
		padding-bottom: 16px;
		justify-content: center;
		align-items: center;
	}

	.call-shell:not(.call-shell--embedded) .call-stage {
		min-height: clamp(280px, 50vh, 600px);
		padding-bottom: 16px;
	}

	.call-stage--embedded {
		flex: none;
		min-height: clamp(220px, 42vh, 480px);
		max-height: clamp(280px, 52vh, 560px);
		border-radius: 8px;
		padding: 8px;
		background: #1e1f22;
	}

	.call-shell--minimal .call-stage {
		background: #1e1f22;
		border: none;
		padding: 16px;
		min-height: calc(100vh - 2rem);
		width: 100%;
		align-items: center;
		justify-content: center;
		border-radius: 0;
	}

	/* ========================================================================== */
	/* Discord-style Video Grid                                                    */
	/* ========================================================================== */

	.call-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		width: 100%;
		max-width: 100%;
		margin: 0 auto;
		padding: 8px;
		align-items: center;
		justify-content: center;
		align-content: center;
	}

	.call-grid--single {
		max-width: 800px;
		justify-content: center;
	}

	/* Responsive grid gaps */
	@media (min-width: 640px) {
		.call-grid {
			gap: 8px;
			padding: 8px;
		}
	}

	@media (min-width: 1024px) {
		.call-grid {
			gap: 8px;
			padding: 12px;
		}
	}

	.call-shell--minimal .call-grid {
		justify-content: center;
		gap: 8px;
		width: 100%;
		max-width: 100%;
		margin: 0 auto;
		padding: 8px;
	}

	.call-stage__overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.call-stage__actions {
		position: absolute;
		top: 0.35rem;
		right: 0.35rem;
		display: inline-flex;
		gap: 0.25rem;
		pointer-events: none;
		opacity: 0;
		transform: translateY(-6px);
		transition:
			opacity 160ms ease,
			transform 160ms ease;
	}

	.call-stage:hover .call-stage__actions,
	.call-stage:focus-within .call-stage__actions {
		opacity: 1;
		transform: translateY(0);
		pointer-events: auto;
	}

	.call-stage--embedded .call-stage__actions {
		opacity: 1;
		pointer-events: auto;
		transform: none;
	}

	.call-stage__icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		padding: 0.35rem;
		width: 38px;
		height: 38px;
		background: color-mix(in srgb, var(--color-panel) 78%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		color: var(--text-85);
		font-size: 1.05rem;
		transition:
			transform 120ms ease,
			background 160ms ease,
			border-color 160ms ease;
	}

	.call-stage__icon-button--active {
		background: color-mix(in srgb, var(--color-accent) 30%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
		color: color-mix(in srgb, var(--color-accent) 95%, white);
	}

	.call-stage__icon-button:hover,
	.call-stage__icon-button:focus-visible {
		transform: translateY(-1px);
		background: color-mix(in srgb, var(--color-panel) 80%, transparent);
		border-color: color-mix(in srgb, var(--color-border-strong) 70%, transparent);
	}

	.call-popout-placeholder {
		border: 2px dashed #3f4147;
		border-radius: 8px;
		padding: 16px;
		background: #2b2d31;
		color: #b5bac1;
	}

	.call-popout-placeholder__body {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}

	.call-popout-placeholder__title {
		font-weight: 600;
		color: #f2f3f5;
		margin: 0 0 4px;
	}

	.call-popout-placeholder__subtitle {
		margin: 0;
		font-size: 13px;
	}

	.call-popout-placeholder__action {
		border-radius: 4px;
		padding: 10px 16px;
		background: #5865f2;
		border: none;
		color: white;
		font-weight: 500;
		cursor: pointer;
		transition: background 150ms ease;
	}

	.call-popout-placeholder__action:hover {
		background: #4752c4;
	}

	.self-preview {
		border-radius: 8px;
		padding: 8px;
		background: #2b2d31;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.self-preview__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 13px;
		color: #b5bac1;
	}

	.self-preview__pill {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-radius: 4px;
		background: #1e1f22;
		font-size: 11px;
		color: #6d6f78;
	}

	.self-preview video {
		width: 100%;
		border-radius: 8px;
		background: #1e1f22;
	}

	.call-grid--focus {
		flex-direction: column;
		align-items: stretch;
		gap: 8px;
	}

	.call-tile--focus-main {
		width: 100%;
		max-width: 100%;
		min-height: clamp(260px, 56vh, 640px);
		flex: none;
	}

	.call-grid--focus .call-tile:not(.call-tile--focus-main) {
		width: 180px;
		height: 180px;
		flex: none;
	}
	.call-debug-banner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
		padding: 0.65rem 0.85rem;
		border-radius: 0.75rem;
		background: color-mix(in srgb, var(--color-warning, #facc15) 12%, transparent);
		color: var(--text-90);
		font-size: 0.85rem;
		border: 1px solid color-mix(in srgb, var(--color-warning, #facc15) 30%, transparent);
		align-self: flex-start;
		max-width: min(100%, 420px);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
	}

	.call-debug-banner i {
		font-size: 1rem;
	}

	.call-debug-banner button {
		margin-left: auto;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		border: none;
		background: transparent;
		color: inherit;
		padding: 0.25rem 0.5rem;
		border-radius: 0.5rem;
		cursor: pointer;
	}

	.call-debug-banner button:hover,
	.call-debug-banner button:focus-visible {
		background: color-mix(in srgb, var(--color-warning, #facc15) 25%, transparent);
	}

	.call-debug-drawer {
		position: fixed;
		right: clamp(1rem, 3vw, 2rem);
		bottom: clamp(1rem, 3vw, 2rem);
		width: min(clamp(320px, 34vw, 520px), calc(100vw - 2rem));
		transform: translateY(calc(100% + 2rem));
		opacity: 0;
		pointer-events: none;
		transition:
			transform 200ms ease,
			opacity 200ms ease;
		z-index: 30;
	}

	.call-debug-drawer--open {
		transform: translateY(0);
		opacity: 1;
		pointer-events: auto;
	}

	.call-debug-drawer--custom {
		right: auto;
		bottom: auto;
		transform: translate3d(0, 0, 0);
	}

	.call-debug-drawer--dragging {
		transition: none !important;
	}

	.call-debug-panel {
		display: flex;
		flex-direction: column;
		max-height: clamp(340px, 70vh, 660px);
		background: rgba(10, 12, 20, 0.92);
		backdrop-filter: blur(14px);
		border-radius: 1rem;
		border: 1px solid rgba(255, 255, 255, 0.12);
		box-shadow:
			0 18px 48px rgba(0, 0, 0, 0.45),
			0 0 0 1px rgba(255, 255, 255, 0.04) inset;
		padding: 0.9rem 1rem 1.05rem;
		color: rgba(239, 243, 255, 0.95);
	}

	@media (max-width: 720px) {
		.call-debug-drawer {
			left: clamp(0.75rem, 3vw, 1.25rem);
			right: clamp(0.75rem, 3vw, 1.25rem);
			width: auto;
		}

		.call-debug-panel {
			max-height: clamp(300px, 68vh, 560px);
			padding: 0.85rem 0.9rem 1rem;
		}
	}

	@media (max-width: 540px) {
		.call-debug-drawer {
			right: clamp(0.65rem, 4vw, 1rem);
			left: clamp(0.65rem, 4vw, 1rem);
			bottom: clamp(0.65rem, 4vw, 1rem);
			width: auto;
		}

		.call-debug-panel {
			border-radius: 0.85rem;
		}
	}

	.call-debug-panel__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		cursor: grab;
		user-select: none;
		touch-action: none;
	}

	.call-debug-panel__header--dragging {
		cursor: grabbing;
	}

	.call-debug-panel__heading {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.95rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: rgba(255, 255, 255, 0.75);
	}

	.call-debug-panel__heading i {
		font-size: 1.1rem;
	}

	.call-debug-panel__header-actions {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.call-debug-panel__header-actions button {
		cursor: pointer;
	}

	.call-debug-panel__copy,
	.call-debug-panel__refresh {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.7rem;
		border-radius: var(--radius-pill);
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.05);
		color: rgba(255, 255, 255, 0.85);
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		transition:
			background 150ms ease,
			border-color 150ms ease;
	}

	.call-debug-panel__copy {
		background: color-mix(in srgb, var(--color-accent) 22%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 38%, transparent);
		color: color-mix(in srgb, var(--color-accent) 85%, white);
	}

	.call-debug-panel__refresh i {
		font-size: 1rem;
	}

	.call-debug-panel__copy i {
		font-size: 1rem;
	}

	.call-debug-panel__copy:hover,
	.call-debug-panel__copy:focus-visible {
		background: color-mix(in srgb, var(--color-accent) 35%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
	}

	.call-debug-panel__copy:disabled,
	.quick-stats__copy:disabled,
	.call-debug-action:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.call-debug-panel__refresh:hover,
	.call-debug-panel__refresh:focus-visible {
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.28);
	}

	.call-debug-panel__copy:focus-visible,
	.call-debug-panel__refresh:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 45%, transparent);
	}

	.call-debug-panel__close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.04);
		color: rgba(255, 255, 255, 0.85);
		transition:
			background 150ms ease,
			color 150ms ease,
			border-color 150ms ease;
	}

	.call-debug-panel__close i {
		font-size: 1.1rem;
	}

	.call-debug-panel__close:hover,
	.call-debug-panel__close:focus-visible {
		background: rgba(255, 255, 255, 0.16);
		border-color: rgba(255, 255, 255, 0.24);
		color: rgba(15, 18, 30, 0.9);
	}

	.call-debug-panel__close:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 45%, transparent);
	}

	.call-debug-panel__scroll {
		overflow-y: auto;
		margin-top: 0.9rem;
		padding-right: 0.2rem;
		max-height: calc(100% - 3.2rem);
	}

	.call-debug-panel__grid {
		display: grid;
		gap: 0.85rem;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		grid-auto-rows: minmax(0, 1fr);
		align-items: stretch;
	}

	@media (max-width: 900px) {
		.call-debug-panel__grid {
			grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		}
	}

	@media (max-width: 620px) {
		.call-debug-panel__grid {
			grid-template-columns: 1fr;
		}
	}

	.call-debug-panel__section {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-height: 0;
	}

	.call-debug-panel__title {
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(255, 255, 255, 0.7);
		margin: 0;
	}

	.call-debug-panel__section--stats {
		align-self: flex-start;
		gap: 0.7rem;
		width: min(100%, 310px);
	}

	@media (min-width: 960px) {
		.call-debug-panel__section--stats {
			width: min(280px, 34vw);
		}
	}

	.quick-stats__heading {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.quick-stats__actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.quick-stats__summary {
		flex: 1 1 auto;
		min-width: 0;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: rgba(255, 255, 255, 0.58);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.quick-stats__toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.65rem;
		border-radius: 0.65rem;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.06);
		color: rgba(255, 255, 255, 0.78);
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		transition:
			background 150ms ease,
			border-color 150ms ease;
	}

	.quick-stats__toggle:hover,
	.quick-stats__toggle:focus-visible {
		background: rgba(255, 255, 255, 0.14);
		border-color: rgba(255, 255, 255, 0.28);
	}

	.quick-stats__toggle:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 30%, transparent);
	}

	.quick-stats__toggle i {
		font-size: 0.9rem;
	}

	.quick-stats__copy {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.4rem 0.8rem;
		border-radius: 0.75rem;
		border: 1px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		color: color-mix(in srgb, var(--color-accent) 85%, white);
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		transition:
			background 150ms ease,
			border-color 150ms ease;
	}

	.quick-stats__copy i {
		font-size: 1rem;
	}

	.quick-stats__copy:hover,
	.quick-stats__copy:focus-visible {
		background: color-mix(in srgb, var(--color-accent) 32%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 48%, transparent);
	}

	.quick-stats__copy:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 45%, transparent);
	}

	.quick-stats__grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 0.5rem;
	}

	.quick-stats__item {
		display: flex;
		flex-direction: column;
		gap: 0.18rem;
		padding: 0.5rem 0.55rem;
		border-radius: 0.6rem;
		border: 1px solid rgba(255, 255, 255, 0.06);
		background: rgba(15, 18, 30, 0.45);
		min-width: 0;
	}

	.quick-stats__key {
		font-size: 0.63rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(255, 255, 255, 0.58);
	}

	.quick-stats__value {
		font-family:
			'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
			'Courier New', monospace;
		font-size: 0.76rem;
		color: rgba(255, 255, 255, 0.92);
		word-break: break-word;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@media (max-width: 620px) {
		.quick-stats__grid {
			grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		}
	}

	@media (max-width: 540px) {
		.quick-stats__actions {
			gap: 0.3rem;
		}

		.quick-stats__summary {
			order: 1;
			width: 100%;
		}

		.quick-stats__toggle {
			order: 2;
		}

		.quick-stats__copy {
			order: 3;
			width: 100%;
			justify-content: center;
		}
	}

	@media (max-width: 480px) {
		.quick-stats__grid {
			grid-template-columns: 1fr;
		}
	}

	.call-debug-panel__section--participants {
		gap: 0.75rem;
	}

	.call-debug-participants {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-height: 240px;
		overflow-y: auto;
	}

	.call-debug-participants li {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 0.75rem;
		padding: 0.7rem 0.75rem;
		border: 1px solid rgba(255, 255, 255, 0.08);
	}

	.call-debug-participant__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.call-debug-participant__name {
		font-size: 0.85rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.92);
	}

	.call-debug-participant__status {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		background: rgba(255, 255, 255, 0.09);
		color: rgba(255, 255, 255, 0.75);
	}

	.call-debug-participant__status--active {
		background: color-mix(in srgb, var(--color-success, #16a34a) 35%, transparent);
		color: rgba(15, 35, 25, 0.9);
	}

	.call-debug-participant__status--removed,
	.call-debug-participant__status--left {
		background: color-mix(in srgb, var(--color-danger) 35%, transparent);
		color: rgba(55, 5, 5, 0.9);
	}

	.call-debug-participant__meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.4rem;
		font-size: 0.7rem;
		color: rgba(255, 255, 255, 0.6);
	}

	.call-debug-participant__meta code {
		font-family:
			'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
			'Courier New', monospace;
		background: rgba(0, 0, 0, 0.35);
		border-radius: 0.45rem;
		padding: 0.15rem 0.45rem;
		color: rgba(255, 255, 255, 0.8);
	}

	.call-debug-participant__badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.15rem 0.45rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 35%, transparent);
		color: rgba(15, 24, 32, 0.92);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.6rem;
		font-weight: 600;
	}

	.call-debug-participant__tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		font-size: 0.7rem;
		background: rgba(255, 255, 255, 0.08);
		color: rgba(255, 255, 255, 0.75);
	}

	.tag i {
		font-size: 0.9rem;
	}

	.tag--off {
		background: rgba(255, 71, 71, 0.15);
		color: rgba(255, 215, 215, 0.85);
	}

	.tag--active {
		background: color-mix(in srgb, var(--color-accent) 35%, transparent);
		color: rgba(12, 22, 38, 0.85);
	}

	.call-debug-logs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-height: 220px;
		overflow-y: auto;
	}

	.call-debug-log {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 0.75rem;
		padding: 0.75rem;
		border-left: 4px solid rgba(255, 255, 255, 0.12);
	}

	.call-debug-log--error {
		border-left-color: color-mix(in srgb, var(--color-danger) 65%, transparent);
		background: rgba(255, 48, 48, 0.12);
	}

	.call-debug-log--warn {
		border-left-color: color-mix(in srgb, var(--color-warning, #facc15) 65%, transparent);
		background: rgba(255, 210, 92, 0.12);
	}

	.call-debug-log__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: rgba(255, 255, 255, 0.55);
	}

	.call-debug-log__pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		padding: 0.25rem 0.5rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.12);
		color: rgba(255, 255, 255, 0.72);
		font-weight: 600;
	}

	.call-debug-log--error .call-debug-log__pill {
		background: color-mix(in srgb, var(--color-danger) 45%, transparent);
		color: rgba(255, 245, 245, 0.92);
	}

	.call-debug-log--warn .call-debug-log__pill {
		background: color-mix(in srgb, var(--color-warning, #facc15) 45%, transparent);
		color: rgba(45, 32, 0, 0.85);
	}

	.call-debug-logs .time {
		font-size: 0.7rem;
	}

	.call-debug-logs .msg {
		font-weight: 600;
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.9);
	}

	.call-debug-logs pre {
		margin: 0;
		max-height: 140px;
		overflow: auto;
		font-size: 0.75rem;
		line-height: 1.35;
		background: rgba(0, 0, 0, 0.35);
		border-radius: 0.5rem;
		padding: 0.5rem 0.6rem;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.call-debug-empty {
		margin: 0;
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.6);
	}

	.call-debug-panel__section--doc pre {
		margin: 0;
		padding: 0.6rem 0.75rem;
		background: rgba(0, 0, 0, 0.35);
		border-radius: 0.75rem;
		border: 1px solid rgba(255, 255, 255, 0.08);
		max-height: 180px;
		overflow: auto;
		font-size: 0.72rem;
		line-height: 1.35;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.call-debug-panel__section--peer {
		gap: 0.75rem;
	}

	.peer-diag {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	}

	.peer-diag__column {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.peer-diag__column h3 {
		margin: 0;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(255, 255, 255, 0.65);
	}

	.peer-diag__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.peer-diag__list li {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.6rem 0.7rem;
		border-radius: 0.65rem;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(0, 0, 0, 0.3);
	}

	.peer-diag__headline {
		font-weight: 600;
		font-size: 0.78rem;
		color: rgba(255, 255, 255, 0.92);
	}

	.peer-diag__label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(255, 255, 255, 0.45);
	}

	.peer-diag__value {
		font-size: 0.76rem;
		color: rgba(255, 255, 255, 0.85);
		word-break: break-word;
	}

	.peer-diag__badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-left: 0.4rem;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.12);
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.65rem;
		letter-spacing: 0.05em;
	}

	.peer-diag__badge--warn {
		background: color-mix(in srgb, var(--color-warning, #facc15) 35%, transparent);
		color: rgba(35, 23, 0, 0.9);
	}

	.call-debug-panel__section--tools {
		gap: 0.75rem;
	}

	.call-debug-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.call-debug-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.55rem 0.8rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-panel) 35%, transparent);
		color: var(--text-80);
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		transition:
			background 150ms ease,
			color 150ms ease,
			border-color 150ms ease;
		width: 100%;
	}

	.call-debug-action i {
		font-size: 1rem;
	}

	.call-debug-action:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.call-debug-action:not(:disabled):hover,
	.call-debug-action:not(:disabled):focus-visible {
		background: color-mix(in srgb, var(--color-panel) 55%, transparent);
		border-color: color-mix(
			in srgb,
			var(--color-border-strong, rgba(255, 255, 255, 0.35)) 65%,
			transparent
		);
		color: var(--text-100);
	}

	@media (min-width: 1200px) {
		.call-grid {
			gap: 8px;
		}
	}

	@media (min-width: 1600px) {
		.call-grid {
			gap: 10px;
		}
	}

	/* ========================================================================== */
	/* Discord-style Video Tile                                                    */
	/* ========================================================================== */

	.call-tile {
		position: relative;
		width: 360px;
		height: 202px;
		border-radius: 8px;
		overflow: hidden;
		background: #2b2d31;
		display: flex;
		flex-direction: column;
		transition: box-shadow 200ms ease;
		box-shadow: none;
		outline: none;
		flex-shrink: 0;
	}

	@supports (aspect-ratio: 16 / 9) {
		.call-tile {
			min-height: 0;
		}
	}

	.call-tile--self {
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	.call-tile--sharing {
		box-shadow: 0 0 0 2px #23a559;
	}

	.call-shell--minimal .call-tile {
		width: 360px;
		height: 202px;
		border-radius: 8px;
	}

	/* Double size when alone in call - desktop */
	.call-grid--single .call-tile {
		width: 720px;
		height: 404px;
	}

	/* Larger tiles when only 2 people in call (1.5x) */
	.call-grid--duo .call-tile {
		width: 540px;
		height: 303px;
	}

	/* Discord green speaking glow */
	.call-tile--speaking {
		box-shadow:
			0 0 0 2px #23a559,
			0 0 16px rgba(35, 165, 89, 0.4);
	}

	.call-tile:focus-visible {
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	.call-tile--speaking:focus-visible {
		box-shadow:
			0 0 0 2px #23a559,
			0 0 16px rgba(35, 165, 89, 0.4);
	}

	.call-tile:focus-visible .call-tile__menu-button {
		opacity: 1;
	}

	.call-tile:hover {
		background: #32353b;
	}

	.call-tile__media {
		position: relative;
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #2b2d31;
		overflow: hidden;
		min-height: 0;
	}

	.call-tile__media video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		background: #1e1f22;
		opacity: 0;
		transition: opacity 200ms ease;
	}

	.call-tile__media video.call-tile__video-visible {
		opacity: 1;
	}

	.call-avatar,
	.call-voice-row {
		position: relative;
		z-index: 1;
	}

	/* Discord-style centered avatar for voice-only */
	.call-avatar {
		margin: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		color: #b5bac1;
		padding: 8px;
	}

	.call-avatar--video {
		position: absolute;
		top: 8px;
		left: 8px;
		gap: 4px;
		opacity: 0.95;
		scale: 0.75;
		z-index: 2;
	}

	/* Discord-style avatar circle */
	.call-avatar__image {
		width: 80px;
		height: 80px;
		border-radius: 50%;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-strong) 100%);
		font-size: 2rem;
		font-weight: 600;
		color: white;
	}

	.call-avatar__image img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.call-avatar__hint {
		text-transform: uppercase;
		font-size: 10px;
		letter-spacing: 0.1em;
		color: #6d6f78;
	}

	.call-voice-row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 0;
		justify-content: center;
	}

	.call-voice-row .call-avatar {
		margin: 0;
		padding: 0;
	}

	.call-voice-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		align-items: center;
	}

	.call-voice-name {
		font-weight: 500;
		color: #f2f3f5;
		max-width: 18ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
	}

	.call-voice-icons {
		display: flex;
		align-items: center;
		gap: 4px;
		color: #b5bac1;
		font-size: 14px;
	}

	.call-voice-icons .is-off {
		color: #f23f43;
	}

	.call-tile__icons {
		display: flex;
		align-items: center;
		gap: 4px;
		color: #b5bac1;
		font-size: 14px;
	}

	.call-tile__icons .is-off {
		color: #f23f43;
	}

	/* Discord-style tile footer with username */
	.call-tile__footer {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 8px 12px;
		background: linear-gradient(
			to top,
			rgba(0, 0, 0, 0.8) 0%,
			rgba(0, 0, 0, 0.4) 60%,
			transparent 100%
		);
		transition: background 150ms ease;
	}

	.call-tile__footer-name {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 500;
		color: #f2f3f5;
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.call-tile__footer-text {
		font-weight: 500;
		color: #f2f3f5;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* "You" badge */
	.call-tile__footer-pill {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2px 6px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.02em;
		border-radius: 4px;
		color: #f2f3f5;
		background: rgba(255, 255, 255, 0.1);
		text-transform: uppercase;
	}

	/* Screen share badge - Discord green */
	.call-tile__footer-pill--share {
		background: #23a559;
		color: white;
	}

	/* Status icons in footer */
	.call-tile__footer-icons {
		display: flex;
		align-items: center;
		gap: 6px;
		color: #b5bac1;
		font-size: 14px;
	}

	.call-tile__footer-icons .is-off {
		color: #f23f43;
	}

	.call-tile:hover .call-tile__footer {
		background: linear-gradient(
			to top,
			rgba(0, 0, 0, 0.85) 0%,
			rgba(0, 0, 0, 0.5) 60%,
			transparent 100%
		);
	}

	.call-tile:hover .call-tile__footer-icons {
		color: #f2f3f5;
	}

	/* Menu button on tile */
	.call-tile__menu-button {
		position: absolute;
		right: 8px;
		bottom: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 4px;
		border: none;
		background: rgba(0, 0, 0, 0.6);
		color: #b5bac1;
		font-size: 18px;
		cursor: pointer;
		opacity: 0;
		transform: translateY(4px);
		pointer-events: none;
		transition:
			opacity 100ms ease,
			transform 100ms ease,
			background 100ms ease,
			color 100ms ease;
	}

	.call-tile:hover .call-tile__menu-button,
	.call-tile__menu-button:focus-visible {
		opacity: 1;
		transform: translateY(0);
		pointer-events: auto;
	}

	.call-tile__menu-button:hover {
		background: rgba(0, 0, 0, 0.8);
		color: #f2f3f5;
	}

	.call-tile__menu-button:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	/* Discord-style participant menu */
	.call-tile__menu-panel {
		position: absolute;
		right: 8px;
		bottom: 56px;
		width: min(280px, 90%);
		border-radius: 8px;
		padding: 12px;
		background: #111214;
		border: none;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
		z-index: 30;
		color: #f2f3f5;
	}

	.call-menu__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 14px;
		font-weight: 600;
		color: #f2f3f5;
		margin-bottom: 8px;
	}

	.call-menu__header button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 4px;
		background: transparent;
		color: #b5bac1;
		border: none;
		cursor: pointer;
	}

	.call-menu__header button:hover {
		background: #2b2d31;
		color: #f2f3f5;
	}

	.call-menu__section {
		margin-top: 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.volume-menu-backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
	}

	.volume-menu {
		position: fixed;
		z-index: 81;
		transform: translate(-50%, -50%);
		width: 220px;
		padding: 12px;
		border-radius: 8px;
		background: #111214;
		border: none;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
		color: #f2f3f5;
	}

	.volume-menu__row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 13px;
		margin-bottom: 6px;
	}

	.volume-menu input[type='range'] {
		width: 100%;
		accent-color: #5865f2;
	}

	.call-menu__note {
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid #2b2d31;
		display: flex;
		justify-content: space-between;
		gap: 8px;
		align-items: center;
	}

	.call-menu__label {
		display: flex;
		justify-content: space-between;
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #6d6f78;
	}

	.call-menu__slider {
		width: 100%;
		accent-color: #5865f2;
	}

	/* Discord-style action buttons in menu */
	.call-menu__action {
		margin-top: 4px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		border-radius: 4px;
		padding: 8px 10px;
		background: transparent;
		color: #b5bac1;
		font-size: 13px;
		border: none;
		cursor: pointer;
		transition:
			background 100ms ease,
			color 100ms ease;
	}

	.call-menu__action i {
		font-size: 16px;
	}

	.call-menu__action:hover {
		background: #4752c4;
		color: #ffffff;
	}

	.call-menu__roles {
		color: #6d6f78;
		font-weight: 500;
		font-size: 12px;
	}

	.call-menu__action--danger {
		color: #f23f43;
	}

	.call-menu__action--danger:hover {
		background: #f23f43;
		color: #ffffff;
	}

	.call-more-menu {
		position: absolute;
		bottom: calc(100% + 8px);
		right: 0;
		min-width: 180px;
		display: flex;
		flex-direction: column;
		padding: 6px;
		border-radius: 4px;
		background: #111214;
		border: none;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
		z-index: 24;
	}

	.call-more-menu button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border-radius: 3px;
		background: transparent;
		border: none;
		color: #b5bac1;
		font-size: 14px;
		text-align: left;
		cursor: pointer;
		transition:
			background 100ms ease,
			color 100ms ease;
	}

	.call-more-menu button i {
		font-size: 16px;
		opacity: 0.8;
	}

	.call-more-menu button:hover,
	.call-more-menu button:focus-visible {
		background: #4752c4;
		color: #ffffff;
	}

	.call-more-menu button:hover i,
	.call-more-menu button:focus-visible i {
		opacity: 1;
	}

	/* ========================================================================== */
	/* Discord-style Empty State / Join Preview                                    */
	/* ========================================================================== */

	.call-empty {
		margin: auto;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		width: 100%;
		text-align: center;
	}

	.call-empty__tile {
		width: min(400px, 90%);
		aspect-ratio: 16 / 9;
		border-radius: 8px;
		background: #2b2d31;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		text-align: center;
		padding: 24px;
	}

	.call-empty__avatar {
		width: 80px;
		height: 80px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-strong) 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	.call-empty__avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.call-empty__avatar i {
		font-size: 2rem;
		color: white;
	}

	.call-empty__label {
		color: #f2f3f5;
		font-weight: 600;
		font-size: 16px;
	}

	.call-empty__hint {
		color: #6d6f78;
		font-size: 13px;
	}

	/* ========================================================================== */
	/* Discord-style Control Bar                                                   */
	/* ========================================================================== */

	.call-controls {
		position: absolute;
		left: 50%;
		bottom: 20px;
		display: flex;
		align-items: center;
		gap: 8px;
		width: auto;
		max-width: calc(100% - 24px);
		border-radius: 8px;
		background: #1e1f22;
		padding: 8px;
		opacity: 0;
		transform: translate(-50%, 12px);
		pointer-events: none;
		transition:
			opacity 150ms ease,
			transform 150ms ease;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		z-index: 6;
	}

	.call-controls--visible {
		opacity: 1;
		transform: translate(-50%, 0);
		pointer-events: auto;
	}

	.call-controls--embedded {
		position: relative;
		inset: auto;
		left: 0;
		bottom: 0;
		width: 100%;
		transform: none;
		opacity: 1;
		pointer-events: auto;
		border-radius: 8px;
		background: #1e1f22;
		box-shadow: none;
		margin-top: 8px;
	}

	.call-controls__row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 4px;
	}

	.call-controls__row--join {
		justify-content: center;
		text-align: center;
	}

	/* Join button */
	.call-button {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 20px;
		border-radius: 4px;
		border: none;
		background: #23a559;
		color: white;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: background 150ms ease;
	}

	.call-button:hover {
		background: #1a7d41;
	}

	.call-button--primary {
		background: #23a559;
		color: white;
	}

	.call-button--primary:hover {
		background: #1a7d41;
	}

	.call-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.call-status-message {
		font-size: 12px;
		color: #6d6f78;
	}

	.call-controls__status {
		display: none;
	}

	.call-audio-unlock {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		flex-wrap: wrap;
	}

	.call-controls__group {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-wrap: wrap;
	}

	.call-controls__group--main {
		flex: 1 1 auto;
		display: flex;
		flex-wrap: nowrap;
		justify-content: center;
		gap: 4px;
		align-items: center;
	}

	.call-controls__group--exit {
		gap: 4px;
		align-items: center;
		padding-left: 0;
		margin-left: 0;
		border-left: none;
	}

	.call-controls__item {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: #6d6f78;
	}

	.call-controls__item span {
		display: none;
	}

	.call-controls__item--more {
		position: relative;
	}

	.call-controls__item--leave span {
		color: #f23f43;
	}

	.voice-root--compact .call-controls__item--leave-inline {
		flex: 0 0 auto;
	}

	/* Discord-style circular control buttons */
	.call-control-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		border: none;
		background: #2b2d31;
		color: #b5bac1;
		font-size: 20px;
		cursor: pointer;
		transition:
			background 150ms ease,
			color 150ms ease;
	}

	.call-control-button:hover {
		background: #404249;
		color: #f2f3f5;
	}

	/* Active state (e.g., mic on) */
	.call-control-button--active {
		background: #23a559;
		color: white;
	}

	.call-control-button--active:hover {
		background: #1a7d41;
	}

	/* Danger state (leave call) */
	.call-control-button--danger {
		background: #f23f43;
		color: white;
	}

	.call-control-button--danger:hover {
		background: #d12d30;
	}

	.call-control-button--disabled,
	.call-control-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		background: #2b2d31;
		color: #6d6f78;
	}

	.call-error {
		border-radius: 8px;
		background: rgba(242, 63, 67, 0.15);
		padding: 12px 16px;
		color: #f23f43;
		font-size: 13px;
		display: flex;
		align-items: flex-start;
		gap: 8px;
		flex-wrap: wrap;
	}

	.call-error__text {
		flex: 1 1 auto;
		user-select: text;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.call-error__copy {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 10px;
		border-radius: 4px;
		border: none;
		background: #2b2d31;
		color: #b5bac1;
		font-size: 12px;
		cursor: pointer;
	}

	.call-error__copy:hover {
		background: #404249;
		color: #f2f3f5;
	}

	.call-error__copy:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.voice-root--compact .call-controls__group--main,
	.voice-root--compact .call-controls__group--exit {
		width: 100%;
		justify-content: space-between;
		gap: 8px;
		flex-wrap: nowrap;
	}

	.voice-root--compact .call-controls__group--main .call-controls__item,
	.voice-root--compact .call-controls__group--exit .call-controls__item {
		flex: 1 1 auto;
	}

	.voice-root--compact .call-control-button {
		width: clamp(42px, 16vw, 52px);
		height: clamp(42px, 16vw, 52px);
	}

	.call-controls__item--messages {
		display: flex;
	}

	@media (max-width: 768px) {
		.call-controls__item--messages {
			display: none;
		}
	}

	/* ========================================================================== */
	/* Mobile Responsive Styles                                                    */
	/* ========================================================================== */

	@media (max-width: 768px) {
		.voice-root {
			padding: 4px;
		}

		.call-shell {
			padding: 8px;
		}

		.call-stage {
			padding: 4px;
		}

		.call-grid {
			gap: 6px;
		}

		.call-tile {
			width: 320px;
			height: 180px;
			border-radius: 6px;
		}

		/* Double size when alone - tablet */
		.call-grid--single .call-tile {
			width: 560px;
			height: 315px;
		}

		/* Larger tiles for duo - tablet */
		.call-grid--duo .call-tile {
			width: 440px;
			height: 247px;
		}

		.call-controls__row--connected {
			flex-direction: column;
			gap: 8px;
		}

		.call-controls__group--main,
		.call-controls__group--exit {
			order: 2;
			justify-content: space-between;
			gap: 6px;
		}

		.call-controls__group--main .call-controls__item,
		.call-controls__group--exit .call-controls__item {
			flex: 1 1 auto;
		}

		.call-controls__status {
			order: 1;
			text-align: center;
		}

		.call-controls {
			bottom: 12px;
			padding: 6px;
			gap: 6px;
		}

		.call-avatar__image {
			width: 56px;
			height: 56px;
			font-size: 1.25rem;
		}

		.call-control-button {
			width: 42px;
			height: 42px;
			font-size: 18px;
		}
	}

	@media (max-width: 480px) {
		.call-grid {
			gap: 4px;
		}

		.call-tile {
			width: 280px;
			height: 158px;
			border-radius: 6px;
		}

		/* Double size when alone - mobile */
		.call-grid--single .call-tile {
			width: 100%;
			max-width: 480px;
			height: auto;
			aspect-ratio: 16 / 9;
		}

		/* Larger tiles for duo - mobile */
		.call-grid--duo .call-tile {
			width: 100%;
			max-width: 380px;
			height: auto;
			aspect-ratio: 16 / 9;
		}

		.call-tile__footer {
			padding: 6px 8px;
		}

		.call-tile__footer-name {
			font-size: 11px;
		}

		.call-controls__group--main {
			gap: 4px;
		}

		.call-controls__item {
			gap: 2px;
		}

		.call-controls__item span {
			font-size: 9px;
		}

		.call-avatar__image {
			width: 48px;
			height: 48px;
			font-size: 1rem;
		}

		.call-empty__tile {
			aspect-ratio: 1;
		}

		.call-control-button {
			width: 38px;
			height: 38px;
			font-size: 16px;
		}
	}
</style>
