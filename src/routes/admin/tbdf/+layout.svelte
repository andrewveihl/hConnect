<script lang="ts">
	// TBDF Layout - simple passthrough, inherits from parent admin layout
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

{@render children()}
