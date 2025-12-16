<script lang="ts">
	import { run } from 'svelte/legacy';

	import { onDestroy, onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { getDb } from '$lib/firebase';
	import { voiceSession } from '$lib/stores/voice';
	import type { VoiceSession } from '$lib/stores/voice';
	import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
	import {
		appendVoiceDebugEvent,
		removeVoiceDebugSection,
		setVoiceDebugSection
	} from '$lib/utils/voiceDebugContext';
	import { resolveProfilePhotoURL } from '$lib/utils/profile';
	import { voiceClientState, invokeVoiceClientControl } from '$lib/stores/voiceClient';

	interface Props {
		serverId?: string | null;
		session?: VoiceSession | null;
		draggable?: boolean;
	}

	let { serverId = null, session = null, draggable = false }: Props = $props();

	const CALL_DOC_ID = 'live';
	const STORAGE_KEY = 'hconnect:voice-mini-panel:position';

	type VoiceParticipant = {
		uid: string;
		displayName?: string;
		photoURL?: string | null;
		hasAudio?: boolean;
		hasVideo?: boolean;
		status?: 'active' | 'left';
	};

	let participants: VoiceParticipant[] = $state([]);
	let unsub: Unsubscribe | null = null;

	// Drag state
	let isDragging = $state(false);
	let dragStartX = 0;
	let dragStartY = 0;
	let panelStartX = 0;
	let panelStartY = 0;
	let positionX = $state(0);
	let positionY = $state(0);
	let panelEl = $state<HTMLElement | null>(null);
	let pointerId: number | null = null;

	const callState = $derived($voiceClientState);

	run(() => {
		untrack(() => unsub)?.();
		participants = [];
		if (!session?.serverId || !session?.channelId) {
			unsub = null;
		} else {
			const db = getDb();
			const callDoc = doc(
				db,
				'servers',
				session.serverId,
				'channels',
				session.channelId,
				'calls',
				CALL_DOC_ID
			);
			const ref = collection(callDoc, 'participants');
			unsub = onSnapshot(ref, (snap) => {
				const list: VoiceParticipant[] = snap.docs
					.map((d) => {
						const data = d.data() as any;
						return {
							uid: data.uid ?? d.id,
							displayName: data.displayName ?? 'Member',
							photoURL: resolveProfilePhotoURL(data),
							hasAudio: data.hasAudio ?? true,
							hasVideo: data.hasVideo ?? false,
							status: (data.status ?? 'active') as 'active' | 'left'
						};
					})
					.filter((p) => p.status !== 'left');
				participants = list;
				if (browser) {
					appendVoiceDebugEvent('mini-panel', 'participants snapshot', {
						serverId: session?.serverId ?? null,
						channelId: session?.channelId ?? null,
						count: list.length,
						participants: list.slice(0, 6).map((p) => ({
							uid: p.uid,
							hasAudio: p.hasAudio ?? true,
							hasVideo: p.hasVideo ?? false
						}))
					});
				}
			});
		}
	});

	onDestroy(() => {
		unsub?.();
		unsub = null;
		removeVoiceDebugSection('miniPanel.snapshot');
		if (browser) {
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('pointerup', handlePointerUp);
		}
	});

	onMount(() => {
		if (browser && draggable) {
			loadSavedPosition();
		}
	});

	function loadSavedPosition() {
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved) {
				const { x, y } = JSON.parse(saved);
				positionX = x;
				positionY = y;
			}
		} catch {
			// ignore
		}
	}

	function savePosition() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: positionX, y: positionY }));
		} catch {
			// ignore
		}
	}

	function handleDragStart(event: PointerEvent) {
		if (!draggable) return;
		event.preventDefault();
		isDragging = true;
		pointerId = event.pointerId;
		dragStartX = event.clientX;
		dragStartY = event.clientY;
		panelStartX = positionX;
		panelStartY = positionY;
		(event.target as HTMLElement)?.setPointerCapture?.(event.pointerId);
		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!isDragging || event.pointerId !== pointerId) return;
		const dx = event.clientX - dragStartX;
		const dy = event.clientY - dragStartY;
		positionX = panelStartX + dx;
		positionY = panelStartY + dy;
	}

	function handlePointerUp(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		isDragging = false;
		pointerId = null;
		window.removeEventListener('pointermove', handlePointerMove);
		window.removeEventListener('pointerup', handlePointerUp);
		if (draggable) {
			savePosition();
		}
	}

	function leaveCall() {
		voiceSession.leave();
	}

	function openVoice() {
		voiceSession.setVisible(true);
	}

	function initials(name?: string) {
		if (!name) return '?';
		return name.trim().charAt(0).toUpperCase() || '?';
	}

	function toggleMute() {
		invokeVoiceClientControl('toggleMute');
	}

	function toggleDeafen() {
		invokeVoiceClientControl('toggleDeafen');
	}

	function toggleVideo() {
		invokeVoiceClientControl('toggleVideo');
	}

	let connectedElsewhere = $derived(!!session && !!serverId && session.serverId !== serverId);
	run(() => {
		if (browser) {
			setVoiceDebugSection('miniPanel.snapshot', {
				serverId: session?.serverId ?? null,
				channelId: session?.channelId ?? null,
				channelName: session?.channelName ?? null,
				participantCount: participants.length,
				connectedElsewhere,
				participants: participants.slice(0, 8).map((p) => ({
					uid: p.uid,
					hasAudio: p.hasAudio ?? true,
					hasVideo: p.hasVideo ?? false
				}))
			});
		}
	});
</script>

{#if session}
	<div
		bind:this={panelEl}
		class="voice-mini-panel rounded-xl border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel)]/95 shadow-lg backdrop-blur"
		class:dragging={isDragging}
		class:is-draggable={draggable}
		style={draggable ? `transform: translate(${positionX}px, ${positionY}px)` : ''}
	>
		<!-- Drag handle -->
		{#if draggable}
			<div
				class="drag-handle flex items-center justify-center py-1 cursor-grab active:cursor-grabbing"
				onpointerdown={handleDragStart}
			>
				<div class="w-8 h-1 rounded-full bg-[color:var(--color-border-subtle)]"></div>
			</div>
		{/if}

		<div class="px-2.5 pb-2.5" class:pt-2={!draggable}>
			<div class="flex items-center gap-2">
				<!-- Status indicator + channel info -->
				<div
					class="relative grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-[color:var(--color-panel-muted)]"
				>
					<i class="bx bx-headphone text-sm text-[color:var(--color-text-primary)]"></i>
					<span
						class="absolute -right-0.5 -bottom-0.5 inline-flex h-2.5 w-2.5 items-center justify-center rounded-full bg-[color:var(--color-panel)] shadow-inner"
					>
						<span
							class={`h-1.5 w-1.5 rounded-full ${callState.connected ? 'bg-emerald-400' : 'bg-amber-400'}`}
						></span>
					</span>
				</div>

				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-1.5">
						<span class="truncate text-xs font-semibold text-[color:var(--color-text-primary)]"
							>#{session.channelName}</span
						>
						{#if connectedElsewhere}
							<span
								class="rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-200"
								>other</span
							>
						{/if}
					</div>
					<div
						class="flex items-center gap-1.5 text-[10px] text-[color:var(--color-text-tertiary)]"
					>
						<span class="inline-flex items-center gap-1">
							<span
								class={`h-1.5 w-1.5 rounded-full ${callState.connected ? 'bg-emerald-400' : 'bg-amber-400'}`}
							></span>
							<span>{callState.connected ? 'Connected' : 'Reconnecting'}</span>
						</span>
						<span>•</span>
						<span>{participants.length} {participants.length === 1 ? 'member' : 'members'}</span>
					</div>
				</div>

				<!-- Action buttons -->
				<div class="flex items-center gap-0.5">
					<button
						class={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--color-text-primary)] transition hover:bg-[color:var(--color-panel-muted)] ${callState.muted ? 'text-rose-400' : ''}`}
						type="button"
						title={callState.muted ? 'Unmute' : 'Mute'}
						aria-pressed={!callState.muted}
						onclick={toggleMute}
					>
						<i class={`bx ${callState.muted ? 'bx-microphone-off' : 'bx-microphone'} text-sm`}></i>
					</button>
					<button
						class={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--color-text-primary)] transition hover:bg-[color:var(--color-panel-muted)] ${!callState.videoEnabled ? 'text-rose-400' : ''}`}
						type="button"
						title={callState.videoEnabled ? 'Turn camera off' : 'Turn camera on'}
						aria-pressed={callState.videoEnabled}
						onclick={toggleVideo}
					>
						<i class={`bx ${callState.videoEnabled ? 'bx-video' : 'bx-video-off'} text-sm`}></i>
					</button>
					<button
						class={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--color-text-primary)] transition hover:bg-[color:var(--color-panel-muted)] ${callState.deafened ? 'text-rose-400' : ''}`}
						type="button"
						title={callState.deafened ? 'Undeafen' : 'Deafen'}
						aria-pressed={!callState.deafened}
						onclick={toggleDeafen}
					>
						<i class={`bx ${callState.deafened ? 'bx-volume-mute' : 'bx-volume-full'} text-sm`}></i>
					</button>
					<button
						class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--color-text-primary)] transition hover:bg-[color:var(--color-panel-muted)]"
						type="button"
						title="Return to call"
						aria-label="Return to call"
						onclick={openVoice}
					>
						<i class="bx bx-window-open text-sm"></i>
					</button>
					<button
						class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--color-danger,#ef4444)] transition hover:bg-[color:var(--color-danger,#ef4444)]/15"
						type="button"
						title="Leave call"
						aria-label="Leave call"
						onclick={leaveCall}
					>
						<i class="bx bx-phone-off text-sm"></i>
					</button>
				</div>
			</div>

			<!-- Participant avatars (compact) -->
			{#if participants.length}
				<div class="mt-2 flex items-center gap-1">
					{#each participants.slice(0, 4) as p (p.uid)}
						<div
							class="relative h-6 w-6 overflow-hidden rounded-full border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)]"
						>
							{#if p.photoURL}
								<img
									src={p.photoURL}
									alt={p.displayName}
									class="h-full w-full object-cover"
									loading="lazy"
								/>
							{:else}
								<div
									class="grid h-full w-full place-items-center text-[9px] font-semibold text-[color:var(--color-text-primary)]"
								>
									{initials(p.displayName)}
								</div>
							{/if}
							{#if p.hasAudio === false}
								<i
									class="bx bx-microphone-off absolute -right-0.5 -bottom-0.5 rounded-full bg-[color:var(--color-panel)] text-[8px] text-rose-300"
								></i>
							{/if}
						</div>
					{/each}
					{#if participants.length > 4}
						<div
							class="h-6 px-1.5 inline-flex items-center justify-center rounded-full bg-[color:var(--color-panel-muted)] text-[9px] font-medium text-[color:var(--color-text-secondary)]"
						>
							+{participants.length - 4}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.voice-mini-panel {
		min-width: 260px;
		max-width: 320px;
		user-select: none;
	}
	.voice-mini-panel.is-draggable {
		will-change: transform;
	}
	.voice-mini-panel.dragging {
		opacity: 0.95;
	}
	.drag-handle {
		touch-action: none;
	}
</style>
