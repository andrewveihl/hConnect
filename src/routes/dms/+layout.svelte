<script lang="ts">
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { dms, mobile } from '$lib/data'
	import type { DMRailEntry } from '$lib/data'

	let { children } = $props()

	const isMobile = $derived(mobile.isMobile)
	const hasThread = $derived(!!page.params.thread_id)

	// ── Mobile chat-panel slide state (mirrors server layout pattern) ──
	let panelX = $state(0)
	let panelAnimating = $state(false)
	let panelVisible = $state(false)
	let chatPanelEl: HTMLDivElement | undefined = $state(undefined)

	$effect(() => {
		if (!isMobile) return
		if (hasThread) {
			panelX = window.innerWidth
			panelVisible = true
			chatPanelEl?.getBoundingClientRect()
			requestAnimationFrame(() => {
				panelAnimating = true
				panelX = 0
			})
		} else {
			panelVisible = false
			panelAnimating = false
			panelX = 0
		}
	})

	// ── Touch handling for the DM chat overlay ──
	const LOCK_DIST = 10
	const DISMISS_FRAC = 0.30
	const VEL_THRESH = 0.5
	const EDGE_ZONE = 15

	let touchStartX = 0
	let touchStartY = 0
	let touchActive = false
	let touchLocked = false
	let touchHorizontal = false
	let touchSamples: { x: number; t: number }[] = []

	function onPanelTouchStart(e: TouchEvent) {
		const touch = e.touches[0]
		if (touch.clientX < EDGE_ZONE || touch.clientX > window.innerWidth - EDGE_ZONE) return
		touchStartX = touch.clientX
		touchStartY = touch.clientY
		touchActive = true
		touchLocked = false
		touchHorizontal = false
		touchSamples = [{ x: touch.clientX, t: Date.now() }]
		panelAnimating = false
	}

	function onPanelTouchMove(e: TouchEvent) {
		if (!touchActive) return
		const touch = e.touches[0]
		const dx = touch.clientX - touchStartX
		const dy = touch.clientY - touchStartY

		if (!touchLocked) {
			if (Math.abs(dx) > LOCK_DIST || Math.abs(dy) > LOCK_DIST) {
				touchLocked = true
				touchHorizontal = Math.abs(dx) > Math.abs(dy)
			}
			return
		}

		if (!touchHorizontal) return
		if (dx < 0) return // only allow swiping right

		e.preventDefault()

		touchSamples.push({ x: touch.clientX, t: Date.now() })
		if (touchSamples.length > 5) touchSamples.shift()

		panelX = dx
	}

	function onPanelTouchEnd() {
		if (!touchActive) return
		touchActive = false

		if (!touchHorizontal) {
			panelX = 0
			return
		}

		const progress = panelX / window.innerWidth
		let velocity = 0
		if (touchSamples.length >= 2) {
			const first = touchSamples[0]
			const last = touchSamples[touchSamples.length - 1]
			const dt = last.t - first.t
			if (dt > 0) velocity = Math.abs(last.x - first.x) / dt
		}

		if (progress > DISMISS_FRAC || velocity > VEL_THRESH) {
			panelAnimating = true
			panelX = window.innerWidth
			setTimeout(() => {
				goto('/dms')
			}, 280)
		} else {
			panelAnimating = true
			panelX = 0
		}
	}

	function onPanelTouchCancel() {
		if (!touchActive) return
		touchActive = false
		panelAnimating = true
		panelX = 0
	}

	// Attach non-passive listeners to the chat panel
	$effect(() => {
		const el = chatPanelEl
		if (!el || !isMobile) return
		el.addEventListener('touchstart', onPanelTouchStart, { passive: true })
		el.addEventListener('touchmove', onPanelTouchMove, { passive: false })
		el.addEventListener('touchend', onPanelTouchEnd, { passive: true })
		el.addEventListener('touchcancel', onPanelTouchCancel, { passive: true })
		return () => {
			el.removeEventListener('touchstart', onPanelTouchStart)
			el.removeEventListener('touchmove', onPanelTouchMove)
			el.removeEventListener('touchend', onPanelTouchEnd)
			el.removeEventListener('touchcancel', onPanelTouchCancel)
		}
	})

	/* ── Search & filter state ── */
	let searchQuery = $state('')
	let activeTab: 'all' | 'groups' | 'users' = $state('all')

	/* ── Filter & search the DM list ── */
	const filteredDMs = $derived.by(() => {
		let list = dms.all ?? []
		// Tab filter
		if (activeTab === 'groups') list = list.filter((d) => d.isGroup)
		else if (activeTab === 'users') list = list.filter((d) => !d.isGroup)
		// Search filter
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase()
			list = list.filter((d) => {
				const other = dms.getOtherParticipant(d)
				return other?.displayName?.toLowerCase().includes(q)
			})
		}
		return list
	})

	/* ── Relative timestamp helper ── */
	function relativeTime(updatedAt: any): string {
		if (!updatedAt) return ''
		const ms = updatedAt?.toMillis?.() ?? (updatedAt?.seconds ? updatedAt.seconds * 1000 : 0)
		if (!ms) return ''
		const diff = Date.now() - ms
		const mins = Math.floor(diff / 60_000)
		if (mins < 1) return 'now'
		if (mins < 60) return `${mins}m`
		const hours = Math.floor(mins / 60)
		if (hours < 24) return `${hours}h`
		const date = new Date(ms)
		const now = new Date()
		if (date.getFullYear() === now.getFullYear()) {
			return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
		}
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
	}

	/* ── Truncate last message preview ── */
	function previewText(entry: DMRailEntry): string {
		const msg = entry.lastMessage
		if (!msg) return 'No messages yet'
		return msg.length > 35 ? msg.slice(0, 35) + '…' : msg
	}
</script>

<!-- DM Sidebar Content (shared snippet) -->
{#snippet dmSidebar()}
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-(--border-subtle) px-4 py-3"
		style={isMobile ? `padding-top: var(--sat, 0px);` : ''}>
		<h1 class="text-base font-semibold text-(--text-primary)">Messages</h1>
		<div class="flex items-center gap-1">
			<button
				class="flex h-7 w-7 items-center justify-center rounded text-(--text-muted) transition-colors hover:bg-(--surface-hover) hover:text-(--text-primary)"
				aria-label="New Message"
			>
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path d="M12 5v14m-7-7h14" />
				</svg>
			</button>
		</div>
	</div>

	<!-- Search -->
	<div class="px-3 pt-3 pb-2">
		<div class="relative">
			<svg
				class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--text-muted)"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
			</svg>
			<input
				type="text"
				placeholder="Search DMs"
				bind:value={searchQuery}
				class="w-full rounded-md border border-(--border-input) bg-(--surface-input) py-1.5 pl-8 pr-3 text-xs text-(--text-primary) placeholder:text-(--text-muted) focus:border-(--border-input-focus) focus:outline-none"
			/>
		</div>
	</div>

	<!-- Tabs: All / Groups / Users -->
	<div class="flex gap-1 border-b border-(--border-subtle) px-3 pb-2">
		{#each ['all', 'groups', 'users'] as tab (tab)}
			<button
				class="flex-1 rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors {activeTab ===
				tab
					? 'bg-(--accent)/15 text-(--accent)'
					: 'text-(--text-muted) hover:bg-(--surface-hover) hover:text-(--text-secondary)'}"
				onclick={() => (activeTab = tab as typeof activeTab)}
			>
				{tab}
			</button>
		{/each}
	</div>
	<!-- DM List -->
	<div class="hide-scrollbar flex-1 overflow-y-auto px-2 py-1" style="touch-action: pan-y;">
		{#if dms.all === undefined}
			<!-- Loading skeleton -->
			{#each { length: 6 } as _}
				<div class="flex animate-pulse items-center gap-3 rounded-md px-2 py-2.5">
					<div class="h-9 w-9 flex-shrink-0 rounded-full bg-(--surface-input)"></div>
					<div class="flex-1 space-y-1.5">
						<div class="h-3 w-24 rounded bg-(--surface-input)"></div>
						<div class="h-2.5 w-32 rounded bg-(--surface-input)"></div>
					</div>
				</div>
			{/each}
		{:else if filteredDMs.length === 0}
			<p class="px-3 py-6 text-center text-xs text-(--text-muted)">
				{searchQuery ? 'No results found' : 'No conversations yet'}
			</p>
		{:else}
			{#each filteredDMs as dm (dm.id)}
				{@const other = dms.getOtherParticipant(dm)}
				{#if other}
					<a
						href="/dms/{dm.threadId}"
						class="group flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors {dm.threadId ===
						page.params.thread_id
							? 'bg-(--channel-active) text-(--channel-text-active)'
							: 'hover:bg-(--channel-hover)'}"
					>
						<!-- Avatar with status dot -->
						<div class="relative flex-shrink-0">
							{#if other.photoURL}
								<img
									class="h-9 w-9 rounded-full object-cover"
									src={other.photoURL}
									alt={other.displayName}
									onerror={(e: Event) => {
										const img = e.currentTarget as HTMLImageElement
										img.style.display = 'none'
										const fb = img.nextElementSibling as HTMLElement
										if (fb) fb.style.display = 'flex'
									}}
								/>
								<div
									class="hidden h-9 w-9 items-center justify-center rounded-full bg-(--rail-icon-bg)"
								>
									<span class="text-xs font-semibold text-(--rail-text)"
										>{other.displayName.slice(0, 2).toUpperCase()}</span
									>
								</div>
							{:else}
								<div
									class="flex h-9 w-9 items-center justify-center rounded-full bg-(--rail-icon-bg)"
								>
									<span class="text-xs font-semibold text-(--rail-text)"
										>{other.displayName.slice(0, 2).toUpperCase()}</span
									>
								</div>
							{/if}
							<!-- Status dot -->
							<span
								class="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-(--surface-channel-sidebar) bg-(--status-online)"
							></span>
						</div>

						<!-- Name + last message -->
						<div class="min-w-0 flex-1">
							<div class="flex items-baseline justify-between gap-1">
								<span class="truncate text-sm font-medium text-(--text-primary)"
									>{other.displayName}</span
								>
								<span class="flex-shrink-0 text-[10px] text-(--text-muted)"
									>{relativeTime(dm.updatedAt)}</span
								>
							</div>
							<p class="truncate text-xs text-(--text-muted)">{previewText(dm)}</p>
						</div>
					</a>
				{/if}
			{/each}
		{/if}
	</div>
{/snippet}

<!-- MOBILE: DM sidebar always visible, thread slides over as overlay -->
{#if isMobile}
	<div class="relative flex flex-1 min-w-0 min-h-0 overflow-hidden">
		<!-- Background: DM sidebar (always visible) -->
		<div class="absolute inset-0 flex flex-col bg-(--surface-channel-sidebar) text-(--channel-text)"
			style="padding-bottom: calc(var(--dock-height) + var(--sab, 0px));">
			{@render dmSidebar()}
		</div>

		<!-- Foreground: DM thread overlay -->
		{#if panelVisible}
			<div
				bind:this={chatPanelEl}
				class="fixed inset-0 z-50 flex flex-col"
				style="transform: translate3d({panelX}px, 0, 0); {panelAnimating ? 'transition: transform 280ms cubic-bezier(0.2, 0.8, 0.4, 1);' : ''} will-change: transform;"
				ontransitionend={() => { panelAnimating = false }}
			>
				{@render children()}
			</div>
		{/if}
	</div>
{:else}
	<!-- DESKTOP: inline DM sidebar + children side by side -->
	<div
		class="flex w-64 flex-shrink-0 flex-col border-r border-l border-(--border-subtle) bg-(--surface-channel-sidebar) text-(--channel-text)"
	>
		{@render dmSidebar()}
	</div>
	{@render children()}
{/if}
