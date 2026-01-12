<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { onMount, tick } from 'svelte';
	import TestPushFab from './TestPushFab.svelte';

	type Position = { x: number; y: number };

	const STORAGE_KEY = 'hconnect:floatingActions:position';
	const MIN_MARGIN = 8;
	const HOLD_DELAY_MS = 220;

	let dockEl: HTMLDivElement | null = null;
	let position = $state<Position>({ x: 0, y: 0 });
	let customPosition = $state(false);
	let ready = $state(!browser);
	let dragging = $state(false);
	let pointerId: number | null = null;
	let dragOffset: Position = { x: 0, y: 0 };
	let holdTimer: number | null = null;
	let defaultFrame: number | null = null;
	let dockResizeObserver: ResizeObserver | null = null;
	let chatInputObserver: ResizeObserver | null = null;
	let observedChatInput: Element | null = null;
	let unsubscribePage: (() => void) | null = null;
	let isMobile = $state(false);

	function updateIsMobile() {
		if (!browser) return;
		isMobile = window.matchMedia('(max-width: 767px)').matches;
	}

	function loadSavedPosition(): Position | null {
		if (!browser) return null;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as Position;
			if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
				return parsed;
			}
		} catch {
			// ignore malformed storage
		}
		return null;
	}

	function persistPosition(value: Position) {
		if (!browser) return;
		customPosition = true;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	}

	function clampToViewport(value: Position): Position {
		if (!browser || !dockEl) return value;
		const rect = dockEl.getBoundingClientRect();
		const maxX = Math.max(MIN_MARGIN, window.innerWidth - rect.width - MIN_MARGIN);
		const maxY = Math.max(MIN_MARGIN, window.innerHeight - rect.height - MIN_MARGIN);
		return {
			x: Math.min(Math.max(value.x, MIN_MARGIN), maxX),
			y: Math.min(Math.max(value.y, MIN_MARGIN), maxY)
		};
	}

	function syncChatObserver(target: Element | null) {
		if (!browser) return;
		if (!chatInputObserver) {
			chatInputObserver = new ResizeObserver(() => {
				if (!customPosition) scheduleDefaultPosition();
			});
		}
		if (observedChatInput === target) return;
		chatInputObserver.disconnect();
		observedChatInput = null;
		if (target) {
			chatInputObserver.observe(target);
			observedChatInput = target;
		}
	}

	function scheduleDefaultPosition() {
		if (!browser || customPosition) {
			ready = ready || customPosition;
			return;
		}
		if (defaultFrame) cancelAnimationFrame(defaultFrame);
		defaultFrame = requestAnimationFrame(() => {
			defaultFrame = null;
			updateDefaultPosition();
		});
	}

	async function updateDefaultPosition() {
		if (!browser || !dockEl) {
			ready = true;
			return;
		}
		await tick();

		const dockRect = dockEl.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		// First time: center the dock for discoverability
		// Subsequent times (after user moves it): use the saved position
		const x = Math.round((viewportWidth - dockRect.width) / 2);
		const y = Math.round((viewportHeight - dockRect.height) / 2);
		position = clampToViewport({ x, y });
		ready = true;
	}

	function clearHoldTimer() {
		if (holdTimer) {
			clearTimeout(holdTimer);
			holdTimer = null;
		}
	}

	function handlePointerDown(event: PointerEvent) {
		if (!dockEl) return;
		event.stopPropagation();
		const type = (event.pointerType || 'mouse').toLowerCase();
		const target = event.target as HTMLElement | null;
		const startedOnSuperAdmin = target?.closest('.super-admin-fab') != null;
		const allowDrag =
			(isMobile &&
				(type === 'touch' ||
					type === 'pen' ||
					type === '' ||
					type === 'unknown' ||
					type === 'mouse')) ||
			(!isMobile && startedOnSuperAdmin && type === 'mouse');
		if (!allowDrag) return;
		pointerId = event.pointerId;
		dragOffset = {
			x: event.clientX - position.x,
			y: event.clientY - position.y
		};
		clearHoldTimer();
		holdTimer = window.setTimeout(() => {
			if (pointerId === null) return;
			dragging = true;
			dockEl?.setPointerCapture(pointerId);
		}, HOLD_DELAY_MS);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!dragging || event.pointerId !== pointerId) return;
		event.stopPropagation();
		event.preventDefault();
		position = clampToViewport({
			x: event.clientX - dragOffset.x,
			y: event.clientY - dragOffset.y
		});
	}

	function handlePointerUp(event: PointerEvent) {
		if (pointerId !== event.pointerId) return;
		event.stopPropagation();
		const wasDragging = dragging;
		if (dragging && pointerId != null) {
			event.preventDefault();
			dockEl?.releasePointerCapture(pointerId);
			persistPosition(position);
		}
		dragging = false;
		pointerId = null;
		clearHoldTimer();
		if (!wasDragging && !customPosition && !ready) {
			scheduleDefaultPosition();
		}
	}

	function stopTouchPropagation(event: TouchEvent) {
		event.stopPropagation();
	}

	onMount(() => {
		if (!browser) {
			ready = true;
			return;
		}

		updateIsMobile();

		const saved = loadSavedPosition();
		if (saved) {
			position = clampToViewport(saved);
			customPosition = true;
			ready = true;
		} else {
			scheduleDefaultPosition();
		}

		const handleResize = () => {
			updateIsMobile();
			if (!customPosition) scheduleDefaultPosition();
		};

		window.addEventListener('resize', handleResize);
		unsubscribePage = page.subscribe(() => {
			if (!customPosition) scheduleDefaultPosition();
		});

		dockResizeObserver = new ResizeObserver(() => {
			if (!customPosition) scheduleDefaultPosition();
		});
		if (dockEl) dockResizeObserver.observe(dockEl);

		return () => {
			window.removeEventListener('resize', handleResize);
			unsubscribePage?.();
			dockResizeObserver?.disconnect();
			chatInputObserver?.disconnect();
			if (defaultFrame) cancelAnimationFrame(defaultFrame);
		};
	});
</script>

<div
	class="floating-action-dock"
	bind:this={dockEl}
	data-ready={ready}
	data-dragging={dragging}
	style={`transform: translate3d(${position.x}px, ${position.y}px, 0);`}
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerUp}
	ontouchstart={stopTouchPropagation}
	ontouchmove={stopTouchPropagation}
	ontouchend={stopTouchPropagation}
	ontouchcancel={stopTouchPropagation}
>
	<TestPushFab />
</div>

<style>
	.floating-action-dock {
		position: fixed;
		left: 0;
		top: 0;
		z-index: 65;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--floating-fab-gap, 0.75rem);
		width: max-content;
		pointer-events: auto;
		--floating-fab-size: 3.1rem;
		transition: transform 120ms ease;
		touch-action: none;
	}

	.floating-action-dock[data-ready='false'] {
		opacity: 0;
		pointer-events: none;
	}

	.floating-action-dock[data-dragging='true'] {
		cursor: grabbing;
		touch-action: none;
	}

	@media (hover: hover) {
		.floating-action-dock {
			cursor: grab;
		}
	}
</style>
