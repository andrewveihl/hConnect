<script lang="ts">
  import { afterUpdate } from 'svelte';

  export let messages: { id: string; uid?: string; text?: string; content?: string; createdAt?: any }[] = [];
  export let users: Record<string, any> = {};

  let scroller: HTMLDivElement;

  function fmt(ts: any) {
    try {
      if (ts?.toDate) return ts.toDate().toLocaleString();
      if (typeof ts === 'number') return new Date(ts).toLocaleString();
    } catch {}
    return '';
  }

  const body = (m: any) => (m.text ?? m.content ?? '');

  afterUpdate(() => {
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
  });
</script>

<div bind:this={scroller} class="h-full overflow-auto px-4 py-3 space-y-2">
  {#if messages.length === 0}
    <div class="h-full grid place-items-center">
      <div class="text-center text-white/60">
        <div class="text-2xl mb-2">💬</div>
        <div class="text-lg font-medium mb-1">No messages yet</div>
        <div class="text-sm">Be the first to say something below.</div>
      </div>
    </div>
  {:else}
    {#each messages as m (m.id)}
      <div class="flex items-start gap-3">
        <div class="shrink-0 w-9 h-9 rounded-full bg-white/10 grid place-items-center">
          <span class="text-sm">
            {#if users[m.uid]?.displayName}
              {users[m.uid].displayName.slice(0,1).toUpperCase()}
            {:else}
              {(m.uid ?? '?').slice(0,1).toUpperCase()}
            {/if}
          </span>
        </div>

        <div class="min-w-0">
          <div class="flex items-baseline gap-2">
            <span class="font-medium">
              {#if users[m.uid]?.displayName}{users[m.uid].displayName}{:else}{m.uid}{/if}
            </span>
            <span class="text-xs text-white/50">{fmt(m.createdAt)}</span>
          </div>
          <div class="mt-1 whitespace-pre-wrap leading-relaxed">
            {body(m)}
          </div>
        </div>
      </div>
    {/each}
  {/if}
</div>
