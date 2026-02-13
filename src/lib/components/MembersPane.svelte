<script lang="ts">
	import type { Member } from '$lib/data/members.svelte'
	import type { Role } from '$lib/data/roles.svelte'

	interface Props {
		members?: Member[]
		roles?: Role[]
		onclose: () => void
	}

	let { members, roles, onclose }: Props = $props()

	const MAX_BADGES = 3

	const sortedMembers = $derived(
		(members ?? []).slice().sort((a, b) =>
			(a.displayName ?? a.name ?? '').localeCompare(b.displayName ?? b.name ?? '')
		)
	)

	const totalCount = $derived(members?.length ?? 0)

	// Build role lookup map
	const roleMap = $derived.by(() => {
		const map = new Map<string, Role>()
		for (const r of roles ?? []) map.set(r.id, r)
		return map
	})

	function memberName(m: Member): string {
		return m.nickname ?? m.displayName ?? m.name ?? m.email ?? 'Unknown'
	}

	function memberInitial(m: Member): string {
		return memberName(m).charAt(0).toUpperCase()
	}

	function memberRoles(m: Member): Role[] {
		return (m.roleIds ?? [])
			.map((id) => roleMap.get(id))
			.filter((r): r is Role => !!r && r.showInMemberList !== false && !r.isEveryoneRole)
	}

	function fade(img: HTMLImageElement) {
		img.onload = () => (img.style.opacity = '1')
		img.onerror = () => {
			img.style.display = 'none'
			const fallback = img.nextElementSibling as HTMLElement | null
			if (fallback) fallback.style.display = 'flex'
		}
	}
</script>

<aside class="flex h-full w-60 flex-shrink-0 flex-col border-l border-(--border-subtle) bg-(--surface-channel-sidebar)">
	<!-- Header -->
	<div class="flex h-14 flex-shrink-0 items-center gap-3 border-b border-(--border-default) px-4">
		<span class="text-sm font-semibold text-(--text-primary)">Members</span>
		<span class="ml-auto text-sm text-(--text-muted)">{totalCount}</span>
	</div>

	<!-- Member List -->
	<div class="hide-scrollbar flex-1 overflow-y-auto px-2 py-2">
		{#if !members}
			<div class="px-2 py-6 text-center text-sm text-(--text-muted)">Loading…</div>
		{:else if members.length === 0}
			<div class="px-2 py-6 text-center text-sm text-(--text-muted)">No members</div>
		{:else}
			<!-- Status group header — all online for now -->
			<div class="mb-1 mt-1 flex items-center gap-2 px-2 text-xs text-(--text-muted)">
				<span class="text-(--text-muted)">—</span>
				<span>{totalCount} ONLINE</span>
			</div>

			{#each sortedMembers as member (member.id)}
				{@const mRoles = memberRoles(member)}
				<button
					class="flex w-full items-start gap-2.5 rounded px-2 py-1.5 text-left hover:bg-(--surface-hover)"
					title={memberName(member)}
				>
					<!-- Avatar with status dot -->
					<div class="relative flex-shrink-0">
						{#if member.photoURL}
							<img
								class="h-8 w-8 rounded-full object-cover opacity-0 transition-opacity duration-300"
								src={member.photoURL}
								alt=""
								use:fade
							/>
							<div class="flex h-8 w-8 items-center justify-center rounded-full bg-(--accent)" style="display:none">
								<span class="text-xs font-bold text-(--text-on-accent)">{memberInitial(member)}</span>
							</div>
						{:else}
							<div class="flex h-8 w-8 items-center justify-center rounded-full bg-(--accent)">
								<span class="text-xs font-bold text-(--text-on-accent)">{memberInitial(member)}</span>
							</div>
						{/if}
						<!-- Online dot -->
						<span class="absolute -bottom-0.5 -right-0.5 box-content h-2 w-2 rounded-full border-2 border-(--surface-channel-sidebar) bg-green-500"></span>
					</div>

					<!-- Name + role badges -->
					<div class="min-w-0 flex-1">
						<span class="block truncate text-sm font-medium text-(--text-primary)">{memberName(member)}</span>
						{#if mRoles.length > 0}
							<div class="mt-0.5 flex flex-wrap items-center gap-1">
								{#each mRoles.slice(0, MAX_BADGES) as role (role.id)}
									<span
										class="inline-flex items-center rounded-sm px-1.5 py-px text-[10px] font-semibold leading-tight text-white"
										style:background={role.color ?? 'var(--accent)'}
									>
										{role.name}
									</span>
								{/each}
								{#if mRoles.length > MAX_BADGES}
									<span class="text-[10px] font-semibold text-(--text-muted)">
										+{mRoles.length - MAX_BADGES}
									</span>
								{/if}
							</div>
						{/if}
					</div>
				</button>
			{/each}
		{/if}
	</div>
</aside>

<style>
	.hide-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	.hide-scrollbar::-webkit-scrollbar {
		display: none;
	}
</style>
