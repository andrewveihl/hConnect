<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title?: string;
    description?: string;
    padded?: boolean;
    children?: Snippet;
  }

  let { title = '', description = '', padded = true, children }: Props = $props();
  const hasHeader = $derived(Boolean(title || description));
</script>

<section
  class="rounded-3xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] text-[color:var(--color-text-primary,#f4f6f8)] shadow-[0_20px_45px_rgba(5,10,20,0.25)] transition hover:shadow-[0_28px_55px_rgba(5,10,20,0.35)]"
  style="background: color-mix(in srgb, var(--surface-panel) 95%, transparent);"
>
  {#if hasHeader}
    <header class="flex flex-col gap-1 border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {#if title}
          <h3 class="text-base font-semibold tracking-tight text-[color:var(--color-text-primary,#111827)]">{title}</h3>
        {/if}
        {#if description}
          <p class="text-sm text-[color:var(--color-text-secondary,#6b7280)]">{description}</p>
        {/if}
      </div>
    </header>
  {/if}
  <div class={padded ? 'px-6 py-5' : 'px-0 py-0'}>
    {@render children?.()}
  </div>
</section>
