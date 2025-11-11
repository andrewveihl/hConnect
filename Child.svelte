<script lang="ts">
  let { children }: { children?: import('svelte').Snippet } = $props();
</script>

<p>{children ? 'child' : 'none'}</p>
{@render children?.()}
