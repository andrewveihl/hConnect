<script lang="ts">
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { profile, ChannelsState, CategoriesState, MembersState, RolesState, mobile } from '$lib/data'
	import { ServerSettings, MembersPane } from '$lib/components'

	let { children } = $props()

	let showServerSettings = $state(false)

	const isMobile = $derived(mobile.isMobile)

	// Whether a channel is currently selected
	const hasChannel = $derived(!!page.params.channel_id)

	const server = $derived(profile.servers?.find((server) => server.id === page.params.server_id))
	const channels = $derived(new ChannelsState(page.params.server_id!))
	const categories = $derived(new CategoriesState(page.params.server_id!))

	// Members & roles for the members pane (mobile three-panel swipe)
	const members = $derived(new MembersState(page.params.server_id!))
	const roles = $derived(new RolesState(page.params.server_id!))

	// ── Mobile three-panel slide state ──
	// panelX > 0 → revealing channels (swipe right)
	// panelX < 0 → revealing members (swipe left)
	// panelX = 0 → chat fully visible
	let panelX = $state(0)
	let panelAnimating = $state(false)
	let panelVisible = $state(false)
	let chatPanelEl: HTMLDivElement | undefined = $state(undefined)
	let membersPanelEl: HTMLDivElement | undefined = $state(undefined)

	// Track which direction was locked so we know what to dismiss
	let swipeDirection: 'left' | 'right' | null = $state(null)

	// When a channel is selected, slide the panel in. When deselected, it was already slid away.
	$effect(() => {
		if (!isMobile) return
		if (hasChannel) {
			// Slide in from right
			panelX = window.innerWidth
			panelVisible = true
			swipeDirection = null
			// Force a reflow so the initial position is applied before animating
			chatPanelEl?.getBoundingClientRect()
			requestAnimationFrame(() => {
				panelAnimating = true
				panelX = 0
			})
		} else {
			panelVisible = false
			panelAnimating = false
			panelX = 0
			swipeDirection = null
		}
	})

	// ── Touch handling for the chat overlay ──
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
		swipeDirection = null
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
				if (touchHorizontal) {
					swipeDirection = dx > 0 ? 'right' : 'left'
				}
			}
			return
		}

		if (!touchHorizontal) return

		e.preventDefault()

		touchSamples.push({ x: touch.clientX, t: Date.now() })
		if (touchSamples.length > 5) touchSamples.shift()

		if (swipeDirection === 'right') {
			// Revealing channels — only allow positive offset
			panelX = Math.max(0, dx)
		} else if (swipeDirection === 'left') {
			// Revealing members — only allow negative offset, clamped to -screenWidth
			panelX = Math.max(-window.innerWidth, Math.min(0, dx))
		}
	}

	function onPanelTouchEnd() {
		if (!touchActive) return
		touchActive = false

		if (!touchHorizontal) {
			panelX = 0
			return
		}

		const absDx = Math.abs(panelX)
		const progress = absDx / window.innerWidth
		let velocity = 0
		if (touchSamples.length >= 2) {
			const first = touchSamples[0]
			const last = touchSamples[touchSamples.length - 1]
			const dt = last.t - first.t
			if (dt > 0) velocity = Math.abs(last.x - first.x) / dt
		}

		const shouldTrigger = progress > DISMISS_FRAC || velocity > VEL_THRESH

		if (swipeDirection === 'right' && panelX > 0 && shouldTrigger) {
			// Animate off to the right, then navigate back to channels
			panelAnimating = true
			panelX = window.innerWidth
			setTimeout(() => {
				goto(`/servers/${page.params.server_id}`)
			}, 280)
		} else if (swipeDirection === 'left' && panelX < 0 && shouldTrigger) {
			// Slide fully left to reveal members
			panelAnimating = true
			panelX = -window.innerWidth
		} else {
			// Spring back to center
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

	// Close members when animation finishes at center
	function onTransitionEnd() {
		panelAnimating = false
	}

	// Allow closing members by swiping right on the members pane itself,
	// or by tapping the back button — spring chat panel back to center
	function closeMembersPanel() {
		panelAnimating = true
		panelX = 0
	}

	// ── Touch handling for the members pane (swipe right → back to chat) ──
	let mTouchStartX = 0
	let mTouchStartY = 0
	let mTouchActive = false
	let mTouchLocked = false
	let mTouchHorizontal = false
	let mTouchSamples: { x: number; t: number }[] = []

	function onMembersTouchStart(e: TouchEvent) {
		const touch = e.touches[0]
		mTouchStartX = touch.clientX
		mTouchStartY = touch.clientY
		mTouchActive = true
		mTouchLocked = false
		mTouchHorizontal = false
		mTouchSamples = [{ x: touch.clientX, t: Date.now() }]
		panelAnimating = false
	}

	function onMembersTouchMove(e: TouchEvent) {
		if (!mTouchActive) return
		const touch = e.touches[0]
		const dx = touch.clientX - mTouchStartX
		const dy = touch.clientY - mTouchStartY

		if (!mTouchLocked) {
			if (Math.abs(dx) > LOCK_DIST || Math.abs(dy) > LOCK_DIST) {
				mTouchLocked = true
				mTouchHorizontal = Math.abs(dx) > Math.abs(dy)
			}
			return
		}

		if (!mTouchHorizontal) return
		// Only allow swiping right (closing members)
		if (dx < 0) return

		e.preventDefault()

		mTouchSamples.push({ x: touch.clientX, t: Date.now() })
		if (mTouchSamples.length > 5) mTouchSamples.shift()

		// panelX starts at -innerWidth (members fully visible), dx is positive → moving toward 0
		panelX = Math.min(0, -window.innerWidth + dx)
	}

	function onMembersTouchEnd() {
		if (!mTouchActive) return
		mTouchActive = false

		if (!mTouchHorizontal) return

		// How far we've come back from fully-open members
		const distFromFull = panelX + window.innerWidth  // 0 = still at members, innerWidth = back to chat
		const progress = distFromFull / window.innerWidth
		let velocity = 0
		if (mTouchSamples.length >= 2) {
			const first = mTouchSamples[0]
			const last = mTouchSamples[mTouchSamples.length - 1]
			const dt = last.t - first.t
			if (dt > 0) velocity = Math.abs(last.x - first.x) / dt
		}

		if (progress > DISMISS_FRAC || velocity > VEL_THRESH) {
			// Spring back to chat
			panelAnimating = true
			panelX = 0
		} else {
			// Stay on members
			panelAnimating = true
			panelX = -window.innerWidth
		}
	}

	function onMembersTouchCancel() {
		if (!mTouchActive) return
		mTouchActive = false
		panelAnimating = true
		panelX = -window.innerWidth
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

	// Attach non-passive listeners to the members pane
	$effect(() => {
		const el = membersPanelEl
		if (!el || !isMobile) return
		el.addEventListener('touchstart', onMembersTouchStart, { passive: true })
		el.addEventListener('touchmove', onMembersTouchMove, { passive: false })
		el.addEventListener('touchend', onMembersTouchEnd, { passive: true })
		el.addEventListener('touchcancel', onMembersTouchCancel, { passive: true })
		return () => {
			el.removeEventListener('touchstart', onMembersTouchStart)
			el.removeEventListener('touchmove', onMembersTouchMove)
			el.removeEventListener('touchend', onMembersTouchEnd)
			el.removeEventListener('touchcancel', onMembersTouchCancel)
		}
	})

	// Group channels by category
	const groupedChannels = $derived.by(() => {
		const allChannels = channels.current ?? []
		const allCategories = categories.current ?? []

		const groups: { category: any | null; channels: any[] }[] = []
		const categoryMap = new Map<string, any[]>()

		// Init map with null key for uncategorized
		categoryMap.set('__uncategorized__', [])
		for (const cat of allCategories) {
			categoryMap.set(cat.id, [])
		}

		// Distribute channels into categories
		for (const ch of allChannels) {
			const key = ch.categoryId ?? '__uncategorized__'
			if (categoryMap.has(key)) {
				categoryMap.get(key)!.push(ch)
			} else {
				categoryMap.get('__uncategorized__')!.push(ch)
			}
		}

		// Uncategorized first
		const uncategorized = categoryMap.get('__uncategorized__') ?? []
		if (uncategorized.length > 0) {
			groups.push({ category: null, channels: uncategorized })
		}

		// Then each category in order
		for (const cat of allCategories) {
			groups.push({ category: cat, channels: categoryMap.get(cat.id) ?? [] })
		}

		return groups
	})

	// Track collapsed state per category — persist to localStorage
	const storageKey = $derived(`collapsed-categories:${page.params.server_id}`)

	function loadCollapsed(): Set<string> {
		try {
			const stored = localStorage.getItem(storageKey)
			return stored ? new Set(JSON.parse(stored)) : new Set()
		} catch {
			return new Set()
		}
	}

	let collapsedCategories = $state<Set<string>>(loadCollapsed())

	// Reload from storage when server changes
	$effect(() => {
		void storageKey
		collapsedCategories = loadCollapsed()
	})

	function toggleCategory(categoryId: string) {
		const next = new Set(collapsedCategories)
		if (next.has(categoryId)) {
			next.delete(categoryId)
		} else {
			next.add(categoryId)
		}
		collapsedCategories = next
		try {
			localStorage.setItem(storageKey, JSON.stringify([...next]))
		} catch {}
	}
</script>

<!-- Channel Sidebar Content (shared snippet) -->
{#snippet channelSidebar()}
	<!-- Server Header with icon -->
	<div class="flex items-center gap-3 border-b border-(--border-default) px-4"
		style={isMobile ? 'padding-top: var(--sat, 0px); height: calc(3.5rem + var(--sat, 0px));' : 'height: 3.5rem;'}
	>
		<button
			class="flex flex-1 cursor-pointer items-center gap-3 hover:opacity-80"
			onclick={() => (showServerSettings = true)}
		>
			{#if server?.icon}
				<img
					class="h-8 w-8 flex-shrink-0 rounded-full object-cover"
					src={server.icon}
					alt={server.name}
				/>
			{:else}
				<div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-(--accent)">
					<span class="text-xs font-bold text-(--text-on-accent)">{server?.name?.slice(0, 2).toUpperCase()}</span>
				</div>
			{/if}
		</button>
	</div>

	<!-- "Channels" label -->
	<div class="px-4 pt-3 pb-1 text-xs font-bold tracking-wider text-(--text-primary) uppercase">
		Channels
	</div>

	<!-- Content Scrollable -->
	<div class="hide-scrollbar flex-1 overflow-y-auto pb-3" style="touch-action: pan-y;">
		{#each groupedChannels as group}
			<!-- Category Header (if has category) -->
			{#if group.category}
				<button
					class="mt-3 flex w-full items-center gap-0.5 px-2 py-1 text-xs font-semibold tracking-wider text-(--channel-section-text) uppercase hover:text-(--text-primary)"
					onclick={() => toggleCategory(group.category.id)}
				>
					<svg
						class="h-3 w-3 transition-transform duration-150 {collapsedCategories.has(group.category.id) ? '-rotate-90' : ''}"
						fill="currentColor"
						viewBox="0 0 20 20"
					>
						<path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
					</svg>
					<span>{group.category.name}</span>
				</button>
			{/if}

			<!-- Channel List -->
			{#if !group.category || !collapsedCategories.has(group.category.id)}
				<ul class="space-y-0.5 px-2">
					{#each group.channels as channel (channel.id)}
						<li>
							<a
								class="flex items-center gap-1 select-none rounded px-2 py-1.5 {channel.id === page.params.channel_id
									? 'bg-(--channel-active) text-(--channel-text-active) font-semibold'
									: 'hover:bg-(--border-subtle)'}"
								href="/servers/{page.params.server_id}/{channel.id}"
								draggable="false"
							>
								<span class="relative inline-block">
									<span>#</span>
									{#if channel.isPrivate}
										<svg class="absolute -right-0.5 bottom-1 h-[8px] w-[8px] text-teal-400 drop-shadow-[0_0_1px_rgba(0,0,0,0.8)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
											<rect x="5" y="11" width="14" height="11" rx="2" />
											<path d="M8 11V7a4 4 0 1 1 8 0v4" />
										</svg>
									{/if}
								</span>
								<span class="truncate">{channel.name}</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		{/each}
	</div>
{/snippet}

{#if isMobile}
	<!-- MOBILE: channel sidebar is ALWAYS rendered; chat slides over it as an overlay card -->
	<div class="relative flex flex-1 min-w-0 min-h-0 overflow-hidden">
		<!-- Background: channel sidebar (always visible) -->
		<div class="absolute inset-0 flex flex-col bg-(--surface-channel-sidebar) text-(--channel-text)"
			style="padding-bottom: calc(var(--dock-height) + var(--sab, 0px));">
			{@render channelSidebar()}
		</div>

		<!-- Foreground: chat overlay (slides in/out, fixed covers entire viewport incl. rail & dock) -->
		{#if panelVisible}
			<!-- Chat panel -->
			<div
				bind:this={chatPanelEl}
				class="fixed inset-0 z-50 flex flex-col"
				style="transform: translate3d({panelX}px, 0, 0); {panelAnimating ? 'transition: transform 280ms cubic-bezier(0.2, 0.8, 0.4, 1);' : ''} will-change: transform;"
				ontransitionend={onTransitionEnd}
			>
				{@render children()}
			</div>

			<!-- Members pane: positioned one viewport-width to the right of the chat panel, higher z so it appears above when swiping left -->
			<div
				bind:this={membersPanelEl}
				class="fixed inset-0 z-[51] flex flex-col pointer-events-none"
				style="transform: translate3d({panelX + window.innerWidth}px, 0, 0); {panelAnimating ? 'transition: transform 280ms cubic-bezier(0.2, 0.8, 0.4, 1);' : ''} will-change: transform;"
			>
				<div class="flex-1 pointer-events-auto">
					<MembersPane
						members={members.current}
						roles={roles.current}
						onclose={closeMembersPanel}
					/>
				</div>
			</div>
		{/if}
	</div>
{:else}
	<!-- DESKTOP: inline channel sidebar + children side by side -->
	<div
		class="flex w-64 flex-shrink-0 flex-col border-r border-l border-(--border-subtle) bg-(--surface-channel-sidebar) text-(--channel-text)"
	>
		{@render channelSidebar()}
	</div>
	{@render children()}
{/if}

{#if showServerSettings}
	<ServerSettings {server} onclose={() => (showServerSettings = false)} />
{/if}
