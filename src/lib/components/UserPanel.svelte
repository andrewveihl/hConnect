<script lang="ts">
	import { user } from '$lib/data'
	import { UserSettings } from './UserSettings'

	const currentUser = $derived(user.current)
	const displayName = $derived(currentUser?.displayName ?? 'User')
	const photoURL = $derived(currentUser?.photoURL)

	let isOpen = $state(true)
	let showSettings = $state(false)

	// Swipe-to-close: track pointer on the panel
	let startX = 0
	let tracking = false
	let didSwipe = false

	function onPointerDown(e: PointerEvent) {
		if ((e.target as HTMLElement).closest('button')) return
		startX = e.clientX
		tracking = true
		didSwipe = false
		;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
	}

	function onPointerMove(e: PointerEvent) {
		if (!tracking) return
		if (e.clientX - startX < -40) {
			isOpen = false
			tracking = false
			didSwipe = true
		}
	}

	function onPointerUp() {
		tracking = false
	}

	// Swipe-to-open: track pointer on collapsed avatar
	let startXOpen = 0
	let trackingOpen = false
	let didSwipeOpen = false

	function onAvatarPointerDown(e: PointerEvent) {
		if ((e.target as HTMLElement).closest('button')) return
		startXOpen = e.clientX
		trackingOpen = true
		didSwipeOpen = false
		;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
	}

	function onAvatarPointerMove(e: PointerEvent) {
		if (!trackingOpen) return
		if (e.clientX - startXOpen > 30) {
			isOpen = true
			trackingOpen = false
			didSwipeOpen = true
		}
	}

	function onAvatarPointerUp() {
		// If no swipe happened and panel is closed, it was a click → open settings
		if (!didSwipeOpen && !isOpen) {
			showSettings = true
		}
		trackingOpen = false
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex items-center rounded-xl transition-all duration-300 ease-in-out select-none {isOpen
		? 'border border-(--panel-border) bg-(--surface-panel) py-1.5 pr-2 pl-1.5 shadow-xl'
		: 'border border-transparent bg-transparent p-0 shadow-none'}"
	onpointerdown={isOpen ? onPointerDown : onAvatarPointerDown}
	onpointermove={isOpen ? onPointerMove : onAvatarPointerMove}
	onpointerup={isOpen ? onPointerUp : onAvatarPointerUp}
>
	<!-- Avatar with status indicator -->
	<div class="relative shrink-0">
		{#if photoURL}
			<img
				src={photoURL}
				alt={displayName}
				class="h-12 w-12 rounded-full object-cover"
				referrerpolicy="no-referrer"
				draggable="false"
			/>
		{:else}
			<div
				class="flex h-12 w-12 items-center justify-center rounded-full bg-(--accent) text-sm font-semibold text-(--text-on-accent)"
			>
				{displayName.charAt(0).toUpperCase()}
			</div>
		{/if}
		<span
			class="absolute -right-0.5 -bottom-0.5 block h-3.5 w-3.5 rounded-full border-[3px] border-(--status-dot-border) bg-(--status-online)"
		></span>
	</div>

	<!-- Expandable content -->
	<div
		class="overflow-hidden transition-all duration-300 ease-in-out {isOpen
			? 'ml-2 max-w-xs opacity-100'
			: 'max-w-0 opacity-0'}"
	>
		<div class="flex items-center gap-2 whitespace-nowrap">
			<!-- Name & status -->
			<div class="min-w-0">
				<p class="truncate text-sm leading-tight font-semibold text-(--user-panel-text)">{displayName}</p>
				<p class="truncate text-xs leading-tight text-(--user-panel-subtext)">Online</p>
			</div>

			<!-- Action icons -->
			<div class="flex shrink-0 items-center">
				<!-- Mute -->
				<div class="flex items-center">
					<button
						class="flex h-8 w-8 items-center justify-center rounded-l text-(--user-panel-icon) transition-colors hover:bg-(--user-panel-icon-hover-bg) hover:text-(--user-panel-text)"
						title="Mute"
					>
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19 10v1a7 7 0 01-14 0v-1m7 4v4m-4 0h8m-4-16a3 3 0 00-3 3v4a3 3 0 006 0V7a3 3 0 00-3-3z"
							/>
						</svg>
					</button>
					<button
						class="flex h-8 w-4 items-center justify-center rounded-r text-(--user-panel-icon) transition-colors hover:bg-(--user-panel-icon-hover-bg) hover:text-(--user-panel-text)"
						title="Mute Options"
					>
						<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
						</svg>
					</button>
				</div>

				<!-- Deafen -->
				<div class="flex items-center">
					<button
						class="flex h-8 w-8 items-center justify-center rounded-l text-(--user-panel-icon) transition-colors hover:bg-(--user-panel-icon-hover-bg) hover:text-(--user-panel-text)"
						title="Deafen"
					>
						<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
							<path
								d="M12 1a9 9 0 00-9 9v5a4 4 0 004 4h1a1 1 0 001-1v-6a1 1 0 00-1-1H6v-1a6 6 0 1112 0v1h-2a1 1 0 00-1 1v6a1 1 0 001 1h1a4 4 0 004-4v-5a9 9 0 00-9-9z"
							/>
						</svg>
					</button>
					<button
						class="flex h-8 w-4 items-center justify-center rounded-r text-(--user-panel-icon) transition-colors hover:bg-(--user-panel-icon-hover-bg) hover:text-(--user-panel-text)"
						title="Deafen Options"
					>
						<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
						</svg>
					</button>
				</div>

				<!-- Settings -->
				<button
					class="flex h-8 w-8 items-center justify-center rounded text-(--user-panel-icon) transition-colors hover:bg-(--user-panel-icon-hover-bg) hover:text-(--user-panel-text)"
					title="User Settings"
					onclick={() => (showSettings = true)}
				>
					<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z"
						/>
						<circle cx="12" cy="12" r="3" />
					</svg>
				</button>
			</div>
		</div>
	</div>
</div>

{#if showSettings}
	<UserSettings onclose={() => (showSettings = false)} />
{/if}
