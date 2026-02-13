<script lang="ts">
	let { server, onclose }: { server: any; onclose: () => void } = $props()

	type Tabs = keyof typeof tabs
	const tabs = {
		overview: { label: 'Overview' },
		roles: { label: 'Roles' },
		emoji: { label: 'Emoji' },
		stickers: { label: 'Stickers' },
		members: { label: 'Members' },
		invites: { label: 'Invites' },
		bans: { label: 'Bans' },
		integrations: { label: 'Integrations' },
		moderation: { label: 'Moderation' },
		auditLog: { label: 'Audit Log' },
	}

	let active = $state<Tabs>('overview')
	let label = $derived(tabs[active].label)
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
	onclick={onclose}
	onkeydown={(e) => e.key === 'Escape' && onclose()}
>
	<!-- Modal box -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="flex h-[70vh] w-[750px] max-w-[90vw] overflow-hidden rounded-xl border border-(--panel-border) bg-(--surface-base) shadow-2xl"
		onclick={(e) => e.stopPropagation()}
	>
		<!-- Sidebar -->
		<div class="flex w-48 shrink-0 flex-col bg-(--surface-sidebar) p-3">
			<!-- Server identity -->
			<div class="mb-3 flex items-center gap-2 px-2.5">
				{#if server?.icon}
					<img class="h-6 w-6 rounded-full object-cover" src={server.icon} alt={server.name} />
				{:else}
					<div class="flex h-6 w-6 items-center justify-center rounded-full bg-(--accent)">
						<span class="text-[10px] font-bold text-(--text-on-accent)"
							>{server?.name?.slice(0, 2).toUpperCase()}</span
						>
					</div>
				{/if}
				<span class="truncate text-sm font-semibold text-(--text-primary)">{server?.name}</span>
			</div>

			<h3 class="mb-1 px-2.5 text-xs font-bold tracking-wider text-(--text-muted) uppercase">
				Server Settings
			</h3>
			<nav class="flex flex-col gap-0.5 overflow-y-auto">
				{#each Object.entries(tabs) as [id, tab]}
					<button
						class="rounded px-2.5 py-1.5 text-left text-sm transition-colors {active === id
							? 'bg-(--surface-hover) text-(--text-primary)'
							: 'text-(--text-secondary) hover:bg-(--surface-hover) hover:text-(--text-primary)'}"
						onclick={() => (active = id as Tabs)}
					>
						{tab.label}
					</button>
				{/each}

				<div class="my-2 h-px bg-(--border-subtle)"></div>

				<button
					class="rounded px-2.5 py-1.5 text-left text-sm text-(--danger) transition-colors hover:bg-(--surface-hover) hover:text-(--danger-hover)"
				>
					Delete Server
				</button>
			</nav>
		</div>

		<!-- Content area -->
		<div class="relative flex flex-1 flex-col overflow-y-auto p-6">
			<!-- Close button -->
			<button
				class="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full text-(--text-muted) transition-colors hover:bg-(--surface-hover) hover:text-(--text-primary)"
				onclick={onclose}
				title="Close (Esc)"
			>
				<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>

			<!-- Tab heading -->
			<h2 class="mb-5 text-lg font-bold text-(--text-primary)">{label}</h2>

			<!-- Tab content -->
			{#if active === 'overview'}
				<div class="space-y-6">
					<!-- Server icon -->
					<div class="flex items-center gap-4">
						{#if server?.icon}
							<img class="h-20 w-20 rounded-full object-cover" src={server.icon} alt={server.name} />
						{:else}
							<div
								class="flex h-20 w-20 items-center justify-center rounded-full bg-(--accent)"
							>
								<span class="text-2xl font-bold text-(--text-on-accent)"
									>{server?.name?.slice(0, 2).toUpperCase()}</span
								>
							</div>
						{/if}
						<div>
							<p class="text-lg font-semibold text-(--text-primary)">{server?.name}</p>
							<p class="text-sm text-(--text-muted)">Server ID: {server?.id}</p>
						</div>
					</div>

					<!-- Server Name Field -->
					<div>
						<label class="mb-1 block text-xs font-semibold tracking-wider text-(--text-muted) uppercase" for="server-name"
							>Server Name</label
						>
						<input
							id="server-name"
							type="text"
							value={server?.name ?? ''}
							disabled
							class="w-full rounded-md border border-(--border-input) bg-(--surface-input) px-3 py-2 text-sm text-(--text-primary) opacity-60"
						/>
					</div>
				</div>
			{:else}
				<p class="text-sm text-(--text-muted)">{label} — Coming soon.</p>
			{/if}
		</div>
	</div>
</div>
