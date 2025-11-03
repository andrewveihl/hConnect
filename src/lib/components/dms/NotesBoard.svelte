<script lang="ts">
  import { onDestroy } from 'svelte';
  import { user } from '$lib/stores/user';
  import { subscribeNotes, addNote, updateNote, deleteNote, type NoteDoc } from '$lib/firestore/notes';

  let notes: NoteDoc[] = [];
  let unsub: (() => void) | null = null;

  $: if ($user?.uid) {
    unsub?.();
    unsub = subscribeNotes($user.uid, (rows) => (notes = rows));
  }
  onDestroy(() => unsub?.());

  // Composer state
  let composing = false;
  let title = '';
  let content = '';
  let color: string | null = null;

  function resetComposer() {
    composing = false;
    title = '';
    content = '';
    color = null;
  }

  async function saveNote() {
    try {
      if (!$user?.uid) { alert('Please sign in to save notes.'); return; }
      if (!title.trim() && !content.trim()) { composing = false; return; }
      await addNote($user.uid, { title: title.trim(), content: content.trim(), color, pinned: false });
      resetComposer();
    } catch (err) {
      console.error('Failed to save note', err);
      alert('Failed to save note. Please try again.');
    }
  }

  async function togglePin(n: NoteDoc) {
    if (!$user?.uid || !n.id) return;
    await updateNote($user.uid, n.id, { pinned: !n.pinned });
  }

  async function changeColor(n: NoteDoc, c: string | null) {
    if (!$user?.uid || !n.id) return;
    await updateNote($user.uid, n.id, { color: c });
  }

  async function remove(n: NoteDoc) {
    if (!$user?.uid || !n.id) return;
    const ok = confirm('Delete this note?');
    if (!ok) return;
    await deleteNote($user.uid, n.id);
  }

  function colorClass(c: string | null | undefined) {
    switch (c) {
      case 'yellow': return 'bg-yellow-300/20 border-yellow-300/20';
      case 'green': return 'bg-emerald-300/20 border-emerald-300/20';
      case 'blue': return 'bg-sky-300/20 border-sky-300/20';
      case 'pink': return 'bg-pink-300/20 border-pink-300/20';
      case 'purple': return 'bg-purple-300/20 border-purple-300/20';
      default: return 'bg-white/5 border-white/10';
    }
  }
</script>

<div class="p-4 sm:p-6 space-y-4">
  <!-- Composer -->
  <div class="max-w-2xl">
    {#if composing}
      <div class={`rounded-xl border ${colorClass(color)} p-3 shadow-sm`}>
        <input
          class="w-full bg-transparent text-white text-base font-medium outline-none placeholder:text-white/50"
          placeholder="Title"
          bind:value={title}
        />
        <textarea
          class="mt-2 w-full bg-transparent text-white/90 outline-none placeholder:text-white/50"
          rows="3"
          placeholder="Take a note..."
          bind:value={content}
        ></textarea>
        <div class="mt-3 flex items-center gap-2">
          <div class="flex items-center gap-1">
            <button class="h-6 w-6 rounded-full bg-yellow-300/70" type="button" title="Yellow" aria-label="Set note color to yellow" on:click={() => color = 'yellow'}></button>
            <button class="h-6 w-6 rounded-full bg-emerald-300/70" type="button" title="Green" aria-label="Set note color to green" on:click={() => color = 'green'}></button>
            <button class="h-6 w-6 rounded-full bg-sky-300/70" type="button" title="Blue" aria-label="Set note color to blue" on:click={() => color = 'blue'}></button>
            <button class="h-6 w-6 rounded-full bg-pink-300/70" type="button" title="Pink" aria-label="Set note color to pink" on:click={() => color = 'pink'}></button>
            <button class="h-6 w-6 rounded-full bg-purple-300/70" type="button" title="Purple" aria-label="Set note color to purple" on:click={() => color = 'purple'}></button>
            <button class="h-6 w-6 rounded-full bg-white/10 border border-white/20" type="button" title="Default" aria-label="Reset note color" on:click={() => color = null}></button>
          </div>
          <div class="ml-auto flex items-center gap-2">
            <button class="btn btn-ghost" on:click={resetComposer}>Cancel</button>
            <button class="btn btn-primary" on:click={saveNote}>Save</button>
          </div>
        </div>
      </div>
    {:else}
      <button
        class="w-full text-left rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white/70 hover:bg-white/10"
        on:click={() => (composing = true)}
      >
        Take a note...
      </button>
    {/if}
  </div>

  <!-- Notes grid -->
  <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
    {#each notes as n (n.id)}
      <div class={`rounded-xl border ${colorClass(n.color)} p-3 relative`}>
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            {#if n.title}
              <div class="font-semibold text-white truncate">{n.title}</div>
            {/if}
            {#if n.content}
              <div class="mt-1 text-white/90 whitespace-pre-wrap break-words">{n.content}</div>
            {/if}
          </div>
          <button class="p-1 rounded hover:bg-white/10" type="button" title={n.pinned ? 'Unpin' : 'Pin'} aria-label={n.pinned ? 'Unpin note' : 'Pin note'} on:click={() => togglePin(n)}>
            <i class={`bx ${n.pinned ? 'bx-pin' : 'bx-pin'}`}></i>
          </button>
        </div>
        <div class="mt-3 flex items-center gap-2">
          <div class="flex items-center gap-1">
            <button class="h-5 w-5 rounded-full bg-yellow-300/70" type="button" aria-label="Change note color to yellow" on:click={() => changeColor(n, 'yellow')}></button>
            <button class="h-5 w-5 rounded-full bg-emerald-300/70" type="button" aria-label="Change note color to green" on:click={() => changeColor(n, 'green')}></button>
            <button class="h-5 w-5 rounded-full bg-sky-300/70" type="button" aria-label="Change note color to blue" on:click={() => changeColor(n, 'blue')}></button>
            <button class="h-5 w-5 rounded-full bg-pink-300/70" type="button" aria-label="Change note color to pink" on:click={() => changeColor(n, 'pink')}></button>
            <button class="h-5 w-5 rounded-full bg-purple-300/70" type="button" aria-label="Change note color to purple" on:click={() => changeColor(n, 'purple')}></button>
            <button class="h-5 w-5 rounded-full bg-white/10 border border-white/20" type="button" aria-label="Reset note color" on:click={() => changeColor(n, null)}></button>
          </div>
          <button class="ml-auto p-1 rounded hover:bg-white/10 text-red-300" type="button" title="Delete" aria-label="Delete note" on:click={() => remove(n)}>
            <i class="bx bx-trash"></i>
          </button>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .btn {
    @apply rounded-md px-3 py-1.5 text-sm;
  }

  .btn-ghost {
    @apply text-white;
    background-color: transparent;
  }

  .btn-ghost:hover {
    background-color: rgb(255 255 255 / 0.1);
  }

  .btn-primary {
    @apply text-white;
    background-color: #5865f2;
  }

  .btn-primary:hover {
    background-color: #4752c4;
  }
</style>
