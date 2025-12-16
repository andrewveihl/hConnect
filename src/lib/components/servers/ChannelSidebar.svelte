<script lang="ts">
	interface Props {
		serverName?: string;
	}

	let { serverName = 'Select a server' }: Props = $props();
</script>

<aside
	class="h-full w-64 shrink-0 bg-slate-950/70 backdrop-blur-xl border-r border-white/10 flex flex-col"
>
	<div class="flex items-center justify-between px-3 py-3 border-b border-white/10">
		<h2 class="text-white/90 font-semibold truncate">{serverName}</h2>
	</div>
	<div class="p-3 text-white/60 text-sm">No channels yet. (We’ll wire channels next.)</div>
</aside>
