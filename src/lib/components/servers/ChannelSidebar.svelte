<script lang="ts">
	interface Props {
		serverName?: string;
	}

	let { serverName = 'Select a server' }: Props = $props();
</script>

<aside
	class="h-full w-64 shrink-0 backdrop-blur-xl flex flex-col"
	style="background: var(--color-sidebar); border-right: 1px solid var(--color-border-subtle);"
>
	<div class="flex items-center justify-between px-3 py-3" style="border-bottom: 1px solid var(--color-border-subtle);">
		<h2 class="font-semibold truncate" style="color: var(--color-text-primary);">{serverName}</h2>
	</div>
	<div class="p-3 text-sm" style="color: var(--color-text-tertiary);">No channels yet. (We'll wire channels next.)</div>
</aside>
