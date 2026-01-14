<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		target?: string | HTMLElement;
		children?: import('svelte').Snippet;
	}

	let { target = 'body', children }: Props = $props();
	
	let portalEl: HTMLDivElement;
	let targetEl: HTMLElement | null = null;

	onMount(() => {
		if (typeof target === 'string') {
			targetEl = document.querySelector(target);
		} else {
			targetEl = target;
		}
		
		if (targetEl && portalEl) {
			targetEl.appendChild(portalEl);
		}

		return () => {
			if (portalEl && portalEl.parentNode) {
				portalEl.parentNode.removeChild(portalEl);
			}
		};
	});
</script>

<div bind:this={portalEl} class="portal-content" style="display: contents;">
	{#if children}{@render children()}{/if}
</div>
