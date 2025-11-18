<script lang="ts">
  import type { Snippet } from 'svelte';

  type Header = {
    label: string;
    align?: 'left' | 'center' | 'right';
  };

  interface Props {
    headers: Header[];
    children?: Snippet;
  }

  let { headers = [], children }: Props = $props();
</script>

<div
  class="w-full overflow-hidden rounded-3xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)]"
  style="background: color-mix(in srgb, var(--surface-panel) 97%, transparent);"
>
  <div class="overflow-x-auto">
    <table class="min-w-full divide-y divide-[color:color-mix(in_srgb,var(--color-text-primary)6%,transparent)] text-left text-sm text-[color:var(--color-text-secondary,#94a3b8)]">
      <thead class="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--text-60,#6b7280)]">
        <tr>
          {#each headers as header}
            <th class="px-4 py-3" class:text-right={header.align === 'right'} class:text-center={header.align === 'center'}>
              {header.label}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody class="divide-y divide-[color:color-mix(in_srgb,var(--color-text-primary)6%,transparent)] text-sm text-[color:var(--color-text-primary,#111827)]">
        {@render children?.()}
      </tbody>
    </table>
  </div>
</div>
