<script lang="ts">
	import favicon from '$lib/assets/ServerRailIcon/Healthspaceslogo.png'
	import { profile, dms } from '$lib/data'
	import { page } from '$app/state'

	let activeServerId = $derived(page.params?.server_id)
</script>

<ul class="flex w-[72px] shrink-0 flex-col items-center gap-2 border-r border-(--border-subtle) bg-(--rail-bg) py-3">
	<!-- App logo -->
	<li class="mb-1">
		<a
			href="/dms"
			class="flex h-12 w-12 items-center justify-center rounded-2xl border border-(--border-subtle) bg-(--rail-icon-bg) transition-all duration-200 hover:bg-(--rail-icon-hover)"
		>
			<img src={favicon} alt="Home" class="h-10 w-10" />
		</a>
	</li>
	<li class="mx-auto mb-1 h-px w-8 bg-(--rail-divider)"></li>

	<!-- Unread DM conversations-->
	{#each dms.channels as dm (dm.id)}
		{@const other = dms.getOtherParticipant(dm)}
		{#if other}
			<li class="relative">
				<a
					href="/dms/{dm.threadId}"
					class="group flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-(--rail-icon-bg) ring-[3px] transition-all duration-200 hover:bg-(--rail-icon-hover) {page.url?.pathname === '/dms/' + dm.threadId
						? 'ring-(--accent)'
						: 'ring-transparent'}"
					title={other.displayName}
				>
					{#if other.photoURL}
						<img
							class="h-full w-full object-cover transition-opacity duration-200 group-hover:opacity-80"
							src={other.photoURL}
							alt={other.displayName}
						/>
					{:else}
						<span class="text-sm font-semibold text-(--rail-text)">{other.displayName.slice(0, 2).toUpperCase()}</span>
					{/if}
				</a>
				{#if dm.unreadCount > 0}
					<span class="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
						{dm.unreadCount > 99 ? '99+' : dm.unreadCount}
					</span>
				{/if}
			</li>
		{/if}
	{/each}

	{#if dms.channels.length > 0}
		<li class="mx-auto mb-1 h-px w-8 bg-(--rail-divider)"></li>
	{/if}

	{#each profile.servers ?? [] as server (server.id)}
		<li class="relative">
			<a
				href="/servers/{server.id}"
				class="group flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-(--rail-icon-bg) ring-[3px] transition-all duration-200 hover:bg-(--rail-icon-hover) {activeServerId ===
				server.id
					? 'ring-(--accent)'
					: 'ring-transparent'}"
			>
				{#if server.icon}
					<img
						class="h-full w-full object-cover transition-opacity duration-200 group-hover:opacity-80"
						src={server.icon}
						alt={server.name}
					/>
				{:else}
					<span class="text-sm font-semibold text-(--rail-text)">{server.name.slice(0, 2).toUpperCase()}</span>
				{/if}
			</a>
		</li>
	{/each}
	<li>
		<button
			class="flex h-12 w-12 items-center justify-center rounded-full bg-(--rail-icon-bg) text-(--rail-add-text) transition-all duration-200 hover:bg-(--rail-icon-hover) hover:text-white"
			aria-label="Add Server"
		>
			<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
				><path d="M12 5v14m-7-7h14" /></svg
			>
		</button>
	</li>
</ul>
