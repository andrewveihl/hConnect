<script lang="ts">
  import { afterUpdate, createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  export type ChatMessage =
    | { id: string; uid?: string; createdAt?: any; displayName?: string; text: string; type?: 'text' }
    | { id: string; uid?: string; createdAt?: any; displayName?: string; url: string; type: 'gif' }
    | { id: string; uid?: string; createdAt?: any; displayName?: string; file: { name: string; size?: number; url: string; contentType?: string }; type: 'file' }
    | { id: string; uid?: string; createdAt?: any; displayName?: string; poll: { question: string; options: string[]; votes?: Record<number, number> }; type: 'poll' }
    | { id: string; uid?: string; createdAt?: any; displayName?: string; form: { title: string; questions: string[] }; type: 'form' };

  export let messages: ChatMessage[] = [];
  export let users: Record<string, any> = {};
  export let currentUserId: string | null = null;

  let scroller: HTMLDivElement;

  function formatTime(ts: any) {
    try {
      const value =
        typeof ts === 'number' ? new Date(ts) :
        ts?.toDate ? ts.toDate() :
        ts instanceof Date ? ts : null;
      return value ? value.toLocaleString() : '';
    } catch {
      return '';
    }
  }

  function nameFor(m: any) {
    const uid = m.uid ?? 'unknown';
    return m.displayName || users[uid]?.displayName || users[uid]?.name || uid;
  }

  function avatarUrlFor(m: any) {
    const uid = m.uid ?? 'unknown';
    return users[uid]?.photoURL || users[uid]?.avatarUrl || null;
  }

  function isMine(m: any) {
    if (!currentUserId) return false;
    const uid = m?.uid ?? m?.authorId ?? m?.userId ?? null;
    return uid === currentUserId;
  }

  function initialsFor(name: string) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || name[0]?.toUpperCase() || '?';
  }

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

  let lastLen = 0;
  afterUpdate(() => {
    if (messages.length !== lastLen) {
      lastLen = messages.length;
      scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    }
  });

  function totalVotes(votes?: Record<number, number>) {
    if (!votes) return 0;
    return Object.values(votes).reduce((a, b) => a + (b ?? 0), 0);
  }

  function pct(votes: Record<number, number> | undefined, idx: number) {
    const total = totalVotes(votes);
    if (!total) return 0;
    const n = votes?.[idx] ?? 0;
    return Math.round((n / total) * 100);
  }

  let formDrafts: Record<string, string[]> = {};

  $: {
    for (const m of messages) {
      if (m && (m as any).type === 'form' && (m as any).form?.questions) {
        const len = (m as any).form.questions.length;
        if (!formDrafts[m.id] || formDrafts[m.id].length !== len) {
          formDrafts[m.id] = Array(len).fill('');
        }
      }
    }
  }

  function submitForm(m: any) {
    const answers = (formDrafts[m.id] ?? []).map((a: string) => a.trim());
    dispatch('submitForm', { messageId: m.id, form: m.form, answers });
    formDrafts[m.id] = Array(m.form.questions.length).fill('');
  }

  const formInputId = (mId: string, idx: number) => `form-${mId}-${idx}`;
</script>

<style>
  .bar {
    height: 6px;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }

  .bar > i {
    display: block;
    height: 100%;
    background: currentColor;
    opacity: 0.7;
  }
</style>

<div bind:this={scroller} class="h-full overflow-auto px-3 sm:px-4 py-4 space-y-3">
  {#if messages.length === 0}
    <div class="h-full grid place-items-center">
      <div class="text-center text-white/60 space-y-1">
        <div class="text-2xl font-semibold">Nothing yet</div>
        <div class="text-lg font-medium">No messages yet</div>
        <div class="text-sm">Be the first to say something below.</div>
      </div>
    </div>
  {:else}
    {#each messages as m, i (m.id)}
      {@const mine = isMine(m)}
      {@const continued = i > 0 && sameBlock(messages[i - 1], m)}
      <div class={`flex w-full ${mine ? 'justify-end' : 'justify-start'}`}>
        <div class={`flex w-full max-w-3xl items-end gap-3 ${mine ? 'flex-row-reverse text-right' : ''} ${continued ? 'pt-1' : 'pt-2'}`}>
          {#if continued}
            <div class="w-10"></div>
          {:else}
            <div class={`shrink-0 w-10 h-10 rounded-full border border-white/10 bg-white/10 overflow-hidden grid place-items-center ${mine ? 'ml-1' : ''}`}>
              {#if avatarUrlFor(m)}
                <img src={avatarUrlFor(m)} alt={nameFor(m)} class="w-full h-full object-cover" loading="lazy" />
              {:else}
                <span class="text-sm text-white/80">{initialsFor(nameFor(m))}</span>
              {/if}
            </div>
          {/if}

          <div class={`min-w-0 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
            {#if !continued}
              <div class={`flex flex-wrap items-baseline gap-x-2 ${mine ? 'justify-end text-right' : ''}`}>
                <span class={`font-semibold ${mine ? 'text-[#d9ddff]' : 'text-white'}`}>{mine ? 'You' : nameFor(m)}</span>
                <span class="text-xs text-white/50">{formatTime((m as any).createdAt)}</span>
              </div>
            {/if}

            <div class="mt-1 space-y-1 max-w-full">
              {#if !m.type || m.type === 'text'}
                <div class={`inline-block rounded-2xl px-3 py-2 whitespace-pre-wrap leading-relaxed break-words shadow-sm ${mine ? 'bg-[#5865f2] text-white' : 'bg-white/5 text-white/90'}`}>
                  {(m as any).text ?? (m as any).content ?? ''}
                </div>
              {:else if m.type === 'gif' && (m as any).url}
                <img class={`max-w-[min(320px,100%)] rounded-lg border border-white/10 ${mine ? 'ml-auto' : ''}`} src={(m as any).url} alt="GIF" />
              {:else if m.type === 'file' && (m as any).file}
                <a
                  class={`inline-flex items-center gap-2 underline hover:no-underline text-sm ${mine ? 'justify-end ml-auto' : ''}`}
                  href={(m as any).file.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>[file]</span>
                  <span>{(m as any).file.name}</span>
                  {#if (m as any).file.size}
                    <span class="text-white/60">({Math.round(((m as any).file.size || 0) / 1024)} KB)</span>
                  {/if}
                </a>
              {:else if m.type === 'poll' && (m as any).poll}
                {#await Promise.resolve((m as any).poll) then poll}
                  <div class={`rounded-lg border border-white/10 p-3 bg-white/5 max-w-md ${mine ? 'ml-auto text-left' : ''}`}>
                    <div class="font-medium mb-2">Poll: {poll.question}</div>
                    {#each poll.options as opt, idx}
                      <div class="rounded-md border border-white/10 p-2 bg-white/5 mb-2">
                        <div class="flex items-center justify-between gap-2">
                          <div>{opt}</div>
                          <div class="text-sm text-white/60">{pct(poll.votes, idx)}%</div>
                        </div>
                        <div class="bar mt-2" style="color:#5865f2"><i style="width: {pct(poll.votes, idx)}%"></i></div>
                        <div class="mt-2 text-right">
                          <button class="rounded-md px-2 py-1 hover:bg-white/10" on:click={() => dispatch('vote', { messageId: m.id, optionIndex: idx })}>Vote</button>
                        </div>
                      </div>
                    {/each}
                    <div class="text-xs text-white/60 mt-1">{totalVotes(poll.votes)} vote{totalVotes(poll.votes) === 1 ? '' : 's'}</div>
                  </div>
                {/await}
              {:else if m.type === 'form' && (m as any).form}
                <div class={`rounded-lg border border-white/10 p-3 bg-white/5 max-w-md ${mine ? 'ml-auto text-left' : ''}`}>
                  <div class="font-medium mb-2">Form: {(m as any).form.title}</div>
                  {#each (m as any).form.questions as q, qi}
                    {#key `${m.id}-${qi}`}
                      <label class="block text-sm mb-1" for={formInputId(m.id, qi)}>{qi + 1}. {q}</label>
                      <input id={formInputId(m.id, qi)} class="input w-full mb-3" bind:value={formDrafts[m.id][qi]} />
                    {/key}
                  {/each}
                  <div class="flex justify-end">
                    <button class="rounded-md px-3 py-2 bg-[#5865f2] hover:bg-[#4752c4]" on:click={() => submitForm(m)}>Submit</button>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        </div>
      </div>
    {/each}
  {/if}
</div>

