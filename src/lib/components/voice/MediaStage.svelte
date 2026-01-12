<script lang="ts">
	import Avatar from '$lib/components/app/Avatar.svelte';

	export type MediaStageMode = 'video' | 'voice';

	export type MediaTile = {
		uid: string;
		displayName: string;
		photoURL: string | null;
		hasVideo: boolean;
		hasAudio: boolean;
		controls: { muted: boolean; volume: number };
		stream: MediaStream | null;
		isSelf: boolean;
		screenSharing: boolean;
		isSpeaking: boolean;
	};

	export type MediaStageProps = {
		mode?: MediaStageMode;
		tiles?: MediaTile[];
		gridColumns?: number;
		focusedTileId?: string | null;
		gridMode?: 'grid' | 'focus';
		showSelf?: boolean;
		muteActive?: boolean;
		videoActive?: boolean;
		shareActive?: boolean;
		shareDisabled?: boolean;
		moreOpen?: boolean;
		onToggleMute?: (() => void) | null;
		onToggleVideo?: (() => void) | null;
		onToggleShare?: (() => void) | null;
		onOpenMore?: (() => void) | null;
		onToggleGrid?: (() => void) | null;
		onToggleSelf?: (() => void) | null;
		onOpenSettings?: (() => void) | null;
		controlsVisibleOverride?: boolean | null;
		hideControls?: boolean;
	};

	export type Props = MediaStageProps;

	let {
		mode = 'voice',
		tiles = [],
		gridColumns = 1,
		focusedTileId = null,
		gridMode = 'grid',
		showSelf = true,
		muteActive = false,
		videoActive = false,
		shareActive = false,
		shareDisabled = false,
		moreOpen = false,
		onToggleMute = null,
		onToggleVideo = null,
		onToggleShare = null,
		onOpenMore = null,
		onToggleGrid = null,
		onToggleSelf = null,
		onOpenSettings = null,
		controlsVisibleOverride = null,
		hideControls = false
	}: MediaStageProps = $props();

	let hoverEnabled = true;
	let hovering = false;
	let internalMute = muteActive;
	let internalVideo = videoActive;
	let internalShare = shareActive;
	let internalMore = moreOpen;

	$effect(() => {
		internalMute = muteActive;
		internalVideo = videoActive;
		internalShare = shareActive;
		internalMore = moreOpen;
	});

	const resolvedMute = $derived(onToggleMute ? muteActive : internalMute);
	const resolvedVideo = $derived(onToggleVideo ? videoActive : internalVideo);
	const resolvedShare = $derived(onToggleShare ? shareActive : internalShare);
	const resolvedMore = $derived(onOpenMore ? moreOpen : internalMore);

	function handleToggleMute() {
		if (onToggleMute) return onToggleMute();
		internalMute = !internalMute;
	}

	function handleToggleVideo() {
		if (onToggleVideo) return onToggleVideo();
		internalVideo = !internalVideo;
	}

	function handleToggleShare() {
		if (shareDisabled) return;
		if (onToggleShare) return onToggleShare();
		internalShare = !internalShare;
	}

	function handleToggleMore() {
		if (onOpenMore) return onOpenMore();
		internalMore = !internalMore;
	}

	function handleToggleGrid() {
		onToggleGrid?.();
	}

	function handleToggleSelf() {
		onToggleSelf?.();
	}

	function handleOpenSettings() {
		onOpenSettings?.();
		internalMore = false;
	}

	const initial = (value: string | null | undefined) => {
		if (!value) return '?';
		const trimmed = value.trim();
		if (!trimmed) return '?';
		return trimmed.slice(0, 1).toUpperCase();
	};

	function handlePointerEnter() {
		if (!hoverEnabled) return;
		hovering = true;
	}

	function handlePointerLeave() {
		if (!hoverEnabled) return;
		hovering = false;
	}

	function handlePointerEnterArea() {
		hovering = true;
	}

	function handlePointerLeaveArea() {
		if (!hoverEnabled) return;
		hovering = false;
	}

	$effect(() => {
		if (typeof window === 'undefined') return;
		try {
			const media = window.matchMedia('(pointer: coarse)');
			const update = () => {
				hoverEnabled = !media.matches;
				if (!hoverEnabled) {
					hovering = true;
				}
			};
			media.addEventListener('change', update);
			update();
			return () => media.removeEventListener('change', update);
		} catch {
			hoverEnabled = true;
		}
	});

	const controlVisible = $derived(
		controlsVisibleOverride !== null && controlsVisibleOverride !== undefined
			? controlsVisibleOverride
			: hovering || !hoverEnabled
	);
	const isSolo = $derived(tiles.length === 1);
</script>

<div
	class={`media-stage media-stage--${mode} ${mode === 'voice' && isSolo ? 'media-stage--voice-solo' : ''}`}
	onpointerenter={handlePointerEnter}
	onpointerleave={handlePointerLeave}
>
	{#if mode === 'video'}
		<!-- svelte-ignore slot_element_deprecated -->
		<slot name="video" />
	{:else}
		<div
			class={`voice-grid ${isSolo ? 'voice-grid--solo' : ''}`}
			style={`--voice-cols:${Math.min(4, Math.max(1, tiles.length))}`}
			onpointerenter={handlePointerEnterArea}
			onpointerleave={handlePointerLeaveArea}
		>
			{#each tiles as tile (tile.uid)}
				<article class={`voice-card ${tile.isSpeaking ? 'is-speaking' : ''}`}>
					<div class="voice-card__avatar" aria-hidden="true">
						<Avatar src={tile.photoURL} name={tile.displayName} size="xl" isSelf={tile.isSelf} class="w-full h-full" />
						<span class="voice-card__halo"></span>
					</div>
					<div class="voice-card__body">
						<div class="voice-card__name">
							{tile.displayName}
							{#if tile.isSelf}<span class="voice-card__pill">You</span>{/if}
						</div>
					</div>
				</article>
			{/each}
		</div>
	{/if}
	{#if !hideControls}
		<div
			class={`stage-controls ${controlVisible ? 'is-visible' : ''}`}
			onpointerenter={handlePointerEnterArea}
			onpointerleave={handlePointerLeaveArea}
		>
			<button
				type="button"
				class={`stage-control ${resolvedMute ? 'is-active' : ''}`}
				onclick={handleToggleMute}
				aria-label={resolvedMute ? 'Unmute microphone' : 'Mute microphone'}
			>
				<i class={`bx ${resolvedMute ? 'bx-microphone' : 'bx-microphone-off'}`}></i>
				<span>{resolvedMute ? 'Unmute' : 'Mute'}</span>
			</button>
			<button
				type="button"
				class={`stage-control ${resolvedVideo ? 'is-active' : ''}`}
				onclick={handleToggleVideo}
				aria-label={resolvedVideo ? 'Turn camera off' : 'Turn camera on'}
			>
				<i class={`bx ${resolvedVideo ? 'bx-video' : 'bx-video-off'}`}></i>
				<span>{resolvedVideo ? 'Camera on' : 'Camera off'}</span>
			</button>
			<button
				type="button"
				class={`stage-control ${resolvedShare ? 'is-active' : ''} ${shareDisabled ? 'is-disabled' : ''}`}
				onclick={handleToggleShare}
				aria-label={resolvedShare ? 'Stop sharing screen' : 'Share screen'}
			>
				<i class="bx bx-desktop"></i>
				<span>{resolvedShare ? 'Stop' : 'Share'}</span>
			</button>
			<div class="stage-control stage-control--more">
				<button
					type="button"
					class={`stage-control ${resolvedMore ? 'is-active' : ''}`}
					onclick={handleToggleMore}
					aria-expanded={resolvedMore}
				>
					<i class="bx bx-dots-horizontal-rounded"></i>
					<span>More</span>
				</button>
				{#if resolvedMore}
					<div class="stage-more-menu">
						<button type="button" onclick={handleToggleGrid}>Toggle grid</button>
						<button type="button" onclick={handleToggleSelf}
							>{showSelf ? 'Hide self view' : 'Show self view'}</button
						>
						<button type="button" onclick={handleOpenSettings}>Voice & Video settings</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	/* ========================================================================== */
	/* Discord-style Voice Channel UI                                              */
	/* ========================================================================== */

	.media-stage {
		position: relative;
		display: flex;
		flex: 1;
		min-height: 0;
		width: 100%;
	}

	.media-stage--voice {
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: #1e1f22;
	}

	.media-stage--voice-solo {
		padding: 1.5rem;
	}

	/* Discord-style grid - wraps users in compact tiles */
	.voice-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		width: 100%;
		max-width: 1200px;
		justify-content: center;
		align-items: center;
		align-content: center;
		margin: 0 auto;
		padding: 8px;
	}

	.voice-grid--solo {
		max-width: 400px;
	}

	/* Discord-style voice card - 16:9 rectangular */
	.voice-card {
		position: relative;
		width: 360px;
		height: 202px;
		border-radius: 8px;
		background: #2b2d31;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		overflow: hidden;
		transition:
			background 150ms ease,
			box-shadow 200ms ease;
		cursor: pointer;
	}

	.voice-grid--solo .voice-card {
		width: 280px;
		height: 280px;
		border-radius: 12px;
	}

	.voice-card:hover {
		background: #32353b;
	}

	/* Speaking state - Discord green glow ring */
	.voice-card.is-speaking {
		box-shadow:
			0 0 0 2px #23a559,
			0 0 12px rgba(35, 165, 89, 0.4);
	}

	/* Avatar container with speaking ring */
	.voice-card__avatar {
		position: relative;
		width: 80px;
		height: 80px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-strong) 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: visible;
		flex-shrink: 0;
	}

	.voice-grid--solo .voice-card__avatar {
		width: 120px;
		height: 120px;
	}

	.voice-card__avatar img {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		object-fit: cover;
	}

	.voice-card__avatar span {
		font-weight: 600;
		color: white;
		font-size: 2rem;
		text-transform: uppercase;
	}

	.voice-grid--solo .voice-card__avatar span {
		font-size: 3rem;
	}

	/* Speaking halo ring animation */
	.voice-card__halo {
		position: absolute;
		inset: -4px;
		border: 3px solid #23a559;
		border-radius: 50%;
		opacity: 0;
		transition: opacity 150ms ease;
		animation: none;
	}

	.voice-card.is-speaking .voice-card__halo {
		opacity: 1;
		animation: voice-pulse 1.5s ease-in-out infinite;
	}

	@keyframes voice-pulse {
		0%,
		100% {
			transform: scale(1);
			opacity: 1;
		}
		50% {
			transform: scale(1.05);
			opacity: 0.7;
		}
	}

	/* User info below avatar */
	.voice-card__body {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		min-width: 0;
		max-width: calc(100% - 16px);
	}

	.voice-card__name {
		font-weight: 500;
		color: #f2f3f5;
		font-size: 13px;
		display: flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.voice-grid--solo .voice-card__name {
		font-size: 15px;
	}

	/* "You" pill badge */
	.voice-card__pill {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		padding: 2px 6px;
		border-radius: 4px;
		background: var(--color-accent);
		color: var(--color-text-inverse);
		flex-shrink: 0;
	}

	/* Status icons row (mic/video indicators) */
	.voice-card__icons {
		display: flex;
		align-items: center;
		gap: 4px;
		color: #b5bac1;
		font-size: 14px;
	}

	.voice-card__icons .is-muted {
		color: #f23f43;
	}

	/* ========================================================================== */
	/* Stage Controls Bar - Discord style                                          */
	/* ========================================================================== */

	.stage-controls {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		bottom: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 8px;
		border-radius: 8px;
		background: #1e1f22;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		opacity: 0;
		pointer-events: none;
		transition: opacity 150ms ease;
		z-index: 5;
	}

	.stage-controls.is-visible {
		opacity: 1;
		pointer-events: auto;
	}

	/* Control button - Discord circular style */
	.stage-control {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		border: none;
		background: #2b2d31;
		color: #b5bac1;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition:
			background 150ms ease,
			color 150ms ease;
	}

	.stage-control:hover {
		background: #404249;
		color: #f2f3f5;
	}

	.stage-control.is-active {
		background: #23a559;
		color: white;
	}

	.stage-control.is-active:hover {
		background: #1a7d41;
	}

	.stage-control.is-disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.stage-control i {
		font-size: 20px;
	}

	.stage-control span {
		display: none;
	}

	.stage-control--more {
		position: relative;
	}

	/* Dropdown menu */
	.stage-more-menu {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		min-width: 180px;
		padding: 6px;
		border-radius: 4px;
		background: #111214;
		border: none;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
		display: flex;
		flex-direction: column;
	}

	.stage-more-menu button {
		width: 100%;
		padding: 8px 10px;
		border-radius: 3px;
		border: none;
		background: transparent;
		color: #b5bac1;
		font-size: 14px;
		text-align: left;
		cursor: pointer;
		transition:
			background 100ms ease,
			color 100ms ease;
	}

	.stage-more-menu button:hover {
		background: #4752c4;
		color: #ffffff;
	}

	/* ========================================================================== */
	/* Responsive Breakpoints                                                      */
	/* ========================================================================== */

	@media (max-width: 768px) {
		.voice-grid {
			gap: 6px;
			padding: 6px;
		}

		.voice-card {
			width: 160px;
			height: 160px;
		}

		.voice-card__avatar {
			width: 60px;
			height: 60px;
		}

		.voice-card__avatar span {
			font-size: 1.5rem;
		}

		.voice-card__name {
			font-size: 12px;
		}

		.stage-controls {
			gap: 6px;
			padding: 6px;
		}

		.stage-control {
			width: 42px;
			height: 42px;
		}

		.stage-control i {
			font-size: 18px;
		}

		.voice-grid--solo .voice-card {
			width: 220px;
			height: 220px;
		}
	}

	@media (max-width: 480px) {
		.voice-card {
			width: 220px;
			height: 124px;
		}

		.voice-card__avatar {
			width: 48px;
			height: 48px;
		}

		.voice-card__avatar span {
			font-size: 1.25rem;
		}

		.voice-card__name {
			font-size: 11px;
		}

		.stage-control {
			width: 38px;
			height: 38px;
		}

		.stage-control i {
			font-size: 16px;
		}
	}
</style>
