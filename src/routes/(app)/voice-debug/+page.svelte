<!-- Mobile Voice Debug Page - Full-screen voice debugging -->
<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount, onDestroy } from 'svelte';
	import { user } from '$lib/stores/user';
	import { voiceSession } from '$lib/stores/voice';
	import { voiceStore } from '$lib/stores/voiceStore';
	import { isVoiceDebugAssignee, voiceDebugConfigStore } from '$lib/admin/voiceDebug';
	import {
		copyVoiceDebugAggregate,
		clearVoiceDebugEvents,
		getVoiceDebugContext,
		type VoiceDebugEvent
	} from '$lib/utils/voiceDebugContext';
	import { copyTextToClipboard } from '$lib/utils/clipboard';

	type QuickVoiceStats = {
		rttMs: number | null;
		jitterMs: number | null;
		inboundLossPct: number | null;
		outboundLossPct: number | null;
		inboundAudioBytes: number | null;
		outboundAudioBytes: number | null;
		availableOutKbps: number | null;
		availableInKbps: number | null;
		candidate: {
			id: string | null;
			state: string | null;
			nominated: boolean | null;
			rttMs: number | null;
			protocol: string | null;
		} | null;
	};

	const voiceDebug = voiceDebugConfigStore();
	const session = voiceSession;
	const participantCount = voiceStore.participantCount;
	const statusMessage = voiceStore.statusMessage;
	const participants = voiceStore.activeParticipants;
	const isConnected = voiceStore.isConnected;
	const isConnecting = voiceStore.isConnecting;

	let refreshTimer: ReturnType<typeof setInterval> | null = null;
	let quickStats = $state<QuickVoiceStats>({
		rttMs: null,
		jitterMs: null,
		inboundLossPct: null,
		outboundLossPct: null,
		inboundAudioBytes: null,
		outboundAudioBytes: null,
		availableOutKbps: null,
		availableInKbps: null,
		candidate: null
	});
	let recentEvents = $state<string[]>([]);
	let snapshotUpdatedAt = $state<string | null>(null);
	let copyState = $state<'idle' | 'copying' | 'copied' | 'error'>('idle');
	let recentPresence = $state<Array<{ type: 'join' | 'leave'; uid: string; name: string; ts: number }>>([]);
	let prevParticipantIds = new Set<string>();
	let lastParticipantNames = new Map<string, string>();

	const isAllowed = $derived(isVoiceDebugAssignee($voiceDebug, $user?.email ?? null));

	type CandidatePairSummary = {
		id?: string;
		state?: string;
		nominated?: boolean;
		currentRoundTripTime?: number;
		transport?: string;
		protocol?: string;
		availableOutgoingBitrate?: number;
		availableIncomingBitrate?: number;
	};

	function deriveQuickStats(statsSection: any): QuickVoiceStats {
		const initial: QuickVoiceStats = {
			rttMs: null,
			jitterMs: null,
			inboundLossPct: null,
			outboundLossPct: null,
			inboundAudioBytes: null,
			outboundAudioBytes: null,
			availableOutKbps: null,
			availableInKbps: null,
			candidate: null
		};
		if (!statsSection) return initial;

		const inboundAudio = Array.isArray(statsSection.inboundAudio) ? statsSection.inboundAudio : [];
		const outboundAudio = Array.isArray(statsSection.outboundAudio) ? statsSection.outboundAudio : [];
		const candidatePairs: CandidatePairSummary[] = Array.isArray(statsSection.candidatePairs)
			? statsSection.candidatePairs
			: [];

		const inbound = inboundAudio[0];
		const outbound = outboundAudio[0];
		if (inbound) {
			const packets = Number(inbound.packetsReceived ?? 0);
			const lost = Number(inbound.packetsLost ?? 0);
			if (packets + lost > 0) {
				initial.inboundLossPct = (lost / (packets + lost)) * 100;
			}
			if (typeof inbound.jitter === 'number') {
				initial.jitterMs = inbound.jitter * 1000;
			}
			initial.inboundAudioBytes = Number(inbound.bytesReceived ?? null);
		}
		if (outbound) {
			const sent = Number(outbound.packetsSent ?? 0);
			const lost = Number(outbound.packetsLost ?? 0);
			if (sent + lost > 0) {
				initial.outboundLossPct = (lost / (sent + lost)) * 100;
			}
			if (typeof outbound.roundTripTime === 'number') {
				initial.rttMs = outbound.roundTripTime * 1000;
			}
			initial.outboundAudioBytes = Number(outbound.bytesSent ?? null);
		}

		const nominated = candidatePairs.find((c) => c.nominated);
		if (nominated) {
			initial.candidate = {
				id: nominated.id ?? null,
				state: nominated.state ?? null,
				nominated: true,
				rttMs: typeof nominated.currentRoundTripTime === 'number' ? nominated.currentRoundTripTime * 1000 : null,
				protocol: nominated.protocol ?? nominated.transport ?? null
			};
			if (typeof nominated.availableOutgoingBitrate === 'number') {
				initial.availableOutKbps = Math.round(nominated.availableOutgoingBitrate / 1000);
			}
			if (typeof nominated.availableIncomingBitrate === 'number') {
				initial.availableInKbps = Math.round(nominated.availableIncomingBitrate / 1000);
			}
		}

		return initial;
	}

	function formatEventLine(event: VoiceDebugEvent): string {
		const payload = event.details ? ` | ${JSON.stringify(event.details).slice(0, 160)}` : '';
		return `[${event.timestamp}] ${event.source}: ${event.message}${payload}`;
	}

	function refreshDebugData() {
		const ctx = getVoiceDebugContext();
		if (!ctx) return;
		quickStats = deriveQuickStats((ctx.sections as any)?.['call.stats']);
		recentEvents = ctx.events.slice(-5).map(formatEventLine);
		snapshotUpdatedAt = new Date().toLocaleTimeString();
	}

	function startDebugPolling() {
		if (refreshTimer) return;
		refreshDebugData();
		refreshTimer = setInterval(refreshDebugData, 2000);
	}

	function stopDebugPolling() {
		if (refreshTimer) {
			clearInterval(refreshTimer);
			refreshTimer = null;
		}
	}

	async function copyQuickSummary() {
		const lines: string[] = [];
		lines.push(`Voice Debug Quick Stats - ${new Date().toLocaleString()}`);
		lines.push(`Status: ${$isConnected ? 'Connected' : $isConnecting ? 'Connecting' : 'Idle'}`);
		lines.push(`Channel: ${$session?.channelName ?? '—'} on ${$session?.serverName ?? '—'}`);
		lines.push(`Participants: ${$participantCount ?? 0}`);
		lines.push(`RTT: ${quickStats.rttMs !== null ? `${quickStats.rttMs.toFixed(0)} ms` : '—'}`);
		lines.push(`Jitter: ${quickStats.jitterMs !== null ? `${quickStats.jitterMs.toFixed(1)} ms` : '—'}`);
		lines.push(`Packet loss in/out: ${quickStats.inboundLossPct?.toFixed(2) ?? '—'}% / ${quickStats.outboundLossPct?.toFixed(2) ?? '—'}%`);
		if (quickStats.candidate) {
			lines.push(`ICE state: ${quickStats.candidate.state ?? 'n/a'}, nominated: ${quickStats.candidate.nominated ? 'yes' : 'no'}`);
		}
		await copyTextToClipboard(lines.join('\n'));
		copyState = 'copied';
		setTimeout(() => (copyState = 'idle'), 2000);
	}

	async function copyFullBundle() {
		copyState = 'copying';
		try {
			const success = await copyVoiceDebugAggregate();
			copyState = success ? 'copied' : 'error';
		} catch {
			copyState = 'error';
		}
		setTimeout(() => (copyState = 'idle'), 2000);
	}

	function clearDebugLogs() {
		clearVoiceDebugEvents();
		recentEvents = [];
		recentPresence = [];
	}

	function goBack() {
		history.back();
	}

	onMount(() => {
		if (!browser) return;
		startDebugPolling();
	});

	onDestroy(() => {
		stopDebugPolling();
	});
</script>

<svelte:head>
	<title>Voice Debug | hConnect</title>
</svelte:head>

{#if !isAllowed}
	<div class="voice-debug-page">
		<header class="voice-debug-page__header">
			<button type="button" class="voice-debug-page__back-btn" onclick={goBack} aria-label="Go back">
				<i class="bx bx-arrow-back"></i>
			</button>
			<h1 class="voice-debug-page__title">Voice Debug</h1>
		</header>
		<div class="voice-debug-page__unauthorized">
			<i class="bx bx-lock-alt"></i>
			<span>Access Denied</span>
			<p>You are not authorized to view voice debug information.</p>
		</div>
	</div>
{:else}
	<div class="voice-debug-page">
		<header class="voice-debug-page__header">
			<button type="button" class="voice-debug-page__back-btn" onclick={goBack} aria-label="Go back">
				<i class="bx bx-arrow-back"></i>
			</button>
			<h1 class="voice-debug-page__title">Voice Debug</h1>
		</header>

		<div class="voice-debug-page__content">
			<!-- Session Info -->
			<section class="voice-debug-page__section">
				<div class="voice-debug-page__session-info">
					<p class="voice-debug-page__eyebrow">Voice Session</p>
					<p class="voice-debug-page__channel">{$session?.channelName ?? 'No active call'}</p>
					<p class="voice-debug-page__server">{$session?.serverName ?? 'Join a voice channel to see stats'}</p>
				</div>
			</section>

			<!-- Quick Stats -->
			<section class="voice-debug-page__section">
				<h2 class="voice-debug-page__section-title">Connection Stats</h2>
				<div class="voice-debug-page__stats-grid">
					<div class="stat-card">
						<span class="stat-card__label">Status</span>
						<span class="stat-card__value">
							{$isConnected ? 'Connected' : $isConnecting ? 'Connecting...' : 'Idle'}
						</span>
						{#if $statusMessage}
							<span class="stat-card__hint">{$statusMessage}</span>
						{/if}
					</div>
					<div class="stat-card">
						<span class="stat-card__label">Participants</span>
						<span class="stat-card__value">{$participantCount ?? 0}</span>
					</div>
					<div class="stat-card">
						<span class="stat-card__label">RTT</span>
						<span class="stat-card__value">
							{quickStats.rttMs !== null ? `${quickStats.rttMs.toFixed(0)} ms` : '—'}
						</span>
						<span class="stat-card__hint">
							Jitter: {quickStats.jitterMs !== null ? `${quickStats.jitterMs.toFixed(1)} ms` : 'n/a'}
						</span>
					</div>
					<div class="stat-card">
						<span class="stat-card__label">Packet Loss</span>
						<span class="stat-card__value">
							{quickStats.inboundLossPct !== null ? `${quickStats.inboundLossPct.toFixed(2)}%` : '—'}
							/
							{quickStats.outboundLossPct !== null ? `${quickStats.outboundLossPct.toFixed(2)}%` : '—'}
						</span>
						<span class="stat-card__hint">In / Out</span>
					</div>
					<div class="stat-card">
						<span class="stat-card__label">Bandwidth</span>
						<span class="stat-card__value">
							{quickStats.availableOutKbps !== null ? `${quickStats.availableOutKbps}` : '—'}
							/
							{quickStats.availableInKbps !== null ? `${quickStats.availableInKbps}` : '—'}
						</span>
						<span class="stat-card__hint">Out / In (kbps)</span>
					</div>
				</div>
			</section>

			<!-- ICE Candidate -->
			<section class="voice-debug-page__section">
				<h2 class="voice-debug-page__section-title">ICE Candidate</h2>
				{#if quickStats.candidate}
					<div class="voice-debug-page__info-list">
						<div class="info-row">
							<span class="info-row__label">State</span>
							<span class="info-row__value">{quickStats.candidate.state ?? 'n/a'}</span>
						</div>
						<div class="info-row">
							<span class="info-row__label">Nominated</span>
							<span class="info-row__value">{quickStats.candidate.nominated ? 'Yes' : 'No'}</span>
						</div>
						<div class="info-row">
							<span class="info-row__label">RTT</span>
							<span class="info-row__value">
								{quickStats.candidate.rttMs !== null ? `${quickStats.candidate.rttMs.toFixed(1)} ms` : 'n/a'}
							</span>
						</div>
						<div class="info-row">
							<span class="info-row__label">Protocol</span>
							<span class="info-row__value">{quickStats.candidate.protocol ?? 'n/a'}</span>
						</div>
						<div class="info-row">
							<span class="info-row__label">ID</span>
							<span class="info-row__value info-row__value--mono">{quickStats.candidate.id ?? 'unknown'}</span>
						</div>
					</div>
				{:else}
					<p class="voice-debug-page__empty-hint">No candidate pair yet.</p>
				{/if}
			</section>

			<!-- Recent Events -->
			<section class="voice-debug-page__section">
				<h2 class="voice-debug-page__section-title">Recent Events</h2>
				{#if recentEvents.length}
					<div class="voice-debug-page__events">
						{#each recentEvents as eventLine, idx (eventLine + idx)}
							<div class="event-line">{eventLine}</div>
						{/each}
					</div>
				{:else}
					<p class="voice-debug-page__empty-hint">Waiting for voice activity.</p>
				{/if}
			</section>

			<!-- Presence -->
			<section class="voice-debug-page__section">
				<h2 class="voice-debug-page__section-title">Presence</h2>
				{#if recentPresence.length}
					<div class="voice-debug-page__presence-list">
						{#each recentPresence as evt, idx (`${evt.uid}-${idx}`)}
							<div class="presence-item">
								<span class="presence-item__badge presence-item__badge--{evt.type}">
									{evt.type === 'join' ? 'Join' : 'Leave'}
								</span>
								<span class="presence-item__name">{evt.name}</span>
								<span class="presence-item__time">{new Date(evt.ts).toLocaleTimeString()}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="voice-debug-page__empty-hint">No recent joins or leaves yet.</p>
				{/if}
			</section>
		</div>

		<!-- Footer Actions -->
		<footer class="voice-debug-page__footer">
			<div class="voice-debug-page__snapshot-info">
				{snapshotUpdatedAt ? `Updated ${snapshotUpdatedAt}` : 'Collecting data...'}
			</div>
			<div class="voice-debug-page__actions">
				<button type="button" class="voice-debug-page__btn" onclick={clearDebugLogs}>
					<i class="bx bx-eraser"></i>
					Clear
				</button>
				<button type="button" class="voice-debug-page__btn" onclick={copyQuickSummary} disabled={copyState === 'copying'}>
					{#if copyState === 'copied'}
						<i class="bx bx-check"></i>
					{:else}
						<i class="bx bx-copy-alt"></i>
					{/if}
					Quick
				</button>
				<button type="button" class="voice-debug-page__btn voice-debug-page__btn--primary" onclick={copyFullBundle} disabled={copyState === 'copying'}>
					{#if copyState === 'copying'}
						<i class="bx bx-loader-alt bx-spin"></i>
					{:else}
						<i class="bx bx-export"></i>
					{/if}
					Full Bundle
				</button>
			</div>
		</footer>
	</div>
{/if}

<style>
	.voice-debug-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		max-height: 100dvh;
		background: var(--color-bg-primary);
		overflow: hidden;
	}

	.voice-debug-page__header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.voice-debug-page__back-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 50%;
		background: transparent;
		border: none;
		color: var(--color-text-primary);
		cursor: pointer;
	}

	.voice-debug-page__back-btn:hover {
		background: var(--color-bg-hover);
	}

	.voice-debug-page__back-btn i {
		font-size: 1.5rem;
	}

	.voice-debug-page__title {
		flex: 1;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.voice-debug-page__content {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		padding-bottom: 1rem;
	}

	.voice-debug-page__unauthorized {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3rem 1rem;
		color: var(--color-text-tertiary);
		text-align: center;
		flex: 1;
	}

	.voice-debug-page__unauthorized i {
		font-size: 3rem;
		opacity: 0.5;
	}

	.voice-debug-page__unauthorized p {
		font-size: 0.875rem;
		margin: 0;
	}

	/* Section */
	.voice-debug-page__section {
		padding: 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.voice-debug-page__section-title {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--color-text-tertiary);
		margin: 0 0 0.75rem;
		letter-spacing: 0.05em;
	}

	/* Session Info */
	.voice-debug-page__session-info {
		padding: 0.5rem 0;
	}

	.voice-debug-page__eyebrow {
		font-size: 0.75rem;
		color: var(--color-accent);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 0.25rem;
	}

	.voice-debug-page__channel {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.voice-debug-page__server {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		margin: 0.25rem 0 0;
	}

	/* Stats Grid */
	.voice-debug-page__stats-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}

	.stat-card {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.75rem;
		background: var(--color-bg-secondary);
		border-radius: 0.5rem;
		border: 1px solid var(--color-border);
	}

	.stat-card__label {
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
	}

	.stat-card__value {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.stat-card__hint {
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
	}

	/* Info List */
	.voice-debug-page__info-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.info-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--color-border);
	}

	.info-row:last-child {
		border-bottom: none;
	}

	.info-row__label {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.info-row__value {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.info-row__value--mono {
		font-family: monospace;
		font-size: 0.75rem;
		max-width: 60%;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Events */
	.voice-debug-page__events {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.event-line {
		font-size: 0.75rem;
		font-family: monospace;
		color: var(--color-text-secondary);
		padding: 0.375rem 0.5rem;
		background: var(--color-bg-secondary);
		border-radius: 0.25rem;
		white-space: nowrap;
		overflow-x: auto;
	}

	/* Presence */
	.voice-debug-page__presence-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.presence-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.presence-item__badge {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
	}

	.presence-item__badge--join {
		background: color-mix(in srgb, var(--color-success) 20%, transparent);
		color: var(--color-success);
	}

	.presence-item__badge--leave {
		background: color-mix(in srgb, var(--color-danger) 20%, transparent);
		color: var(--color-danger);
	}

	.presence-item__name {
		flex: 1;
		font-size: 0.875rem;
		color: var(--color-text-primary);
	}

	.presence-item__time {
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
	}

	.voice-debug-page__empty-hint {
		font-size: 0.875rem;
		color: var(--color-text-tertiary);
		text-align: center;
		padding: 1rem;
		margin: 0;
	}

	/* Footer */
	.voice-debug-page__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background: var(--color-bg-secondary);
		border-top: 1px solid var(--color-border);
		flex-shrink: 0;
		padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0));
	}

	.voice-debug-page__snapshot-info {
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
	}

	.voice-debug-page__actions {
		display: flex;
		gap: 0.5rem;
	}

	.voice-debug-page__btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
		font-size: 0.875rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.voice-debug-page__btn:hover {
		background: var(--color-bg-hover);
	}

	.voice-debug-page__btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.voice-debug-page__btn--primary {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: white;
	}

	.voice-debug-page__btn--primary:hover {
		opacity: 0.9;
	}
</style>
