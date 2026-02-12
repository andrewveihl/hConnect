<script lang="ts">
	import { user } from '$lib/data'

	const currentUser = $derived(user.current)
	const displayName = $derived(currentUser?.displayName ?? 'User')
	const photoURL = $derived(currentUser?.photoURL)
</script>

<div class="rounded-lg bg-[#232428] p-4">
	<div class="flex items-center gap-4">
		{#if photoURL}
			<img src={photoURL} alt={displayName} class="h-16 w-16 rounded-full object-cover" referrerpolicy="no-referrer" />
		{:else}
			<div class="flex h-16 w-16 items-center justify-center rounded-full bg-[#5865f2] text-xl font-bold text-white">
				{displayName.charAt(0).toUpperCase()}
			</div>
		{/if}
		<div>
			<p class="text-lg font-bold text-white">{displayName}</p>
			<p class="text-sm text-white/50">{currentUser?.email ?? ''}</p>
		</div>
	</div>
</div>
