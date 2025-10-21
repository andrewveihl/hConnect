<script lang="ts">
  import { afterUpdate } from 'svelte';

  // messages: you’re already enriching each with `displayName`
  export let messages: Array<{
    id: string;
    uid?: string;
    text?: string;
    content?: string;
    createdAt?: any;
    displayName?: string;
  }> = [];

  // users: keyed by uid, e.g. { [uid]: { displayName, name, photoURL, ... } }
  export let users: Record<string, any> = {};

  let scroller: HTMLDivElement;

  function formatTime(ts: any) {
    try {
      const d =
        typeof ts === 'number' ? new Date(ts) :
        ts?.toDate ? ts.toDate() :
        ts instanceof Date ? ts : null;
      return d ? d.toLocaleString() : '';
    } catch {
      return '';
    }
  }

  function body(m: any) {
    return m.text ?? m.content ?? '';
  }

  function nameFor(m: any) {
    const uid = m.uid ?? 'unknown';
    return (
      m.displayName ||
      users[uid]?.displayName ||
      users[uid]?.name ||
      uid
    );
  }

  function avatarUrlFor(m: any) {
    const uid = m.uid ?? 'unknown';
    return users[uid]?.photoURL || users[uid]?.avatarUrl || null;
  }

  function initialsFor(name: string) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map(p => p[0]?.toUpperCase() ?? '').join('') || name[0]?.toUpperCase() || '?';
  }

  // Auto-scroll to bottom on updates
  let lastLen = 0;
  afterUpdate(() => {
    // only scroll when new messages arrive (prevents fighting user scrolling)
    if (messages.length !== lastLen) {
      lastLen = messages.length;
      scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    }
  });

  // Simple "same author within N minutes" grouper (optional styling hook)
  const SAME_BLOCK_MINUTES = 5;
  function sameBlock(prev: any, curr: any) {
    if (!prev || !curr) return false;
    if (prev.uid !== curr.uid) return false;
    try {
      const p = prev.createdAt?.toDate ? prev.createdAt.toDate() : new Date(prev.createdAt);
      const c = curr.createdAt?.toDate ? curr.createdAt.toDate() : new Date(curr.createdAt);
      return Math.abs(+c - +p) <= SAME_BLOCK_MINUTES * 60 * 1000;
    } catch {
      return false;
    }
  }
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
    {#each messages as m, i (m.id)}
      {#if i > 0 && sameBlock(messages[i-1], m)}
        <!-- compact row (same author/time block) -->
        <div class="pl-12">
          <div class="mt-1 whitespace-pre-wrap leading-relaxed text-white/90 break-words">
            {body(m)}
          </div>
        </div>
      {:else}
        <!-- new author block -->
        <div class="flex items-start gap-3">
          <!-- Avatar -->
          {#if avatarUrlFor(m)}
            <img
              src={avatarUrlFor(m)}
              alt={nameFor(m)}
              class="shrink-0 w-10 h-10 rounded-full object-cover border border-white/10"
              loading="lazy"
            />
          {:else}
            <div class="shrink-0 w-10 h-10 rounded-full bg-white/10 grid place-items-center border border-white/10">
              <span class="text-sm text-white/80">{initialsFor(nameFor(m))}</span>
            </div>
          {/if}

          <!-- Message bubble -->
          <div class="min-w-0">
            <div class="flex flex-wrap items-baseline gap-x-2">
              <span class="font-semibold text-white">{nameFor(m)}</span>
              <span class="text-xs text-white/50">{formatTime(m.createdAt)}</span>
            </div>
            <div class="mt-1 whitespace-pre-wrap leading-relaxed text-white/90 break-words">
              {body(m)}
            </div>
          </div>
        </div>
      {/if}
    {/each}
  {/if}
</div>
