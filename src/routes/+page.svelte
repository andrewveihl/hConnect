<script lang="ts">
	import { goto } from '$app/navigation'
	import { profile } from '$lib/data'

	$effect(() => {
		const servers = profile.servers
		if (servers === undefined) return
		if (servers.length > 0) {
			goto(`/servers/${servers[0].id}`, { replaceState: true })
		} else {
			goto('/dms', { replaceState: true })
		}
	})
</script>

<div class="flex flex-1 items-center justify-center bg-(--surface-base)">
	<div class="h-8 w-8 animate-spin rounded-full border-2 border-(--accent) border-t-transparent"></div>
</div>
