<script lang="ts">
	import { page } from '$app/state'
	import { profile, ChannelsState, CategoriesState } from '$lib/data'
	import { ServerSettings } from '$lib/components'

	let { children } = $props()

	let showServerSettings = $state(false)

	const server = $derived(profile.servers?.find((server) => server.id === page.params.server_id))
	const channels = $derived(new ChannelsState(page.params.server_id!))
	const categories = $derived(new CategoriesState(page.params.server_id!))

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

<!-- 2. CHANNEL SIDEBAR -->
<div
	class="flex w-64 flex-shrink-0 flex-col border-r border-l border-(--border-subtle) bg-(--surface-channel-sidebar) text-(--channel-text)"
>
	<!-- Server Header -->
	<button
		class="flex h-14 w-full flex-shrink-0 cursor-pointer items-center gap-3 border-b border-(--border-default) px-4 hover:bg-(--surface-hover)"
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
		<h1 class="truncate text-sm font-bold leading-tight text-(--text-primary)">{server?.name}</h1>
	</button>

	<!-- Content Scrollable -->
	<div class="hide-scrollbar flex-1 overflow-y-auto py-3">
		<!-- Channels Label -->
		<div class="mb-1 px-4 text-xs font-semibold tracking-wider text-(--channel-section-text) uppercase">
			Channels
		</div>

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
								class="flex items-center gap-1 select-none rounded px-2 py-1 {channel.id === page.params.channel_id
									? 'bg-(--channel-active) text-(--channel-text-active)'
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
</div>

{@render children()}

{#if showServerSettings}
	<ServerSettings {server} onclose={() => (showServerSettings = false)} />
{/if}

<style>
	.hide-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	.hide-scrollbar::-webkit-scrollbar {
		display: none;
	}
</style>
