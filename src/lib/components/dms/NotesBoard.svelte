<script lang="ts">
  import { run } from 'svelte/legacy';

  import { onDestroy } from 'svelte';
  import { user } from '$lib/stores/user';
  import { subscribeNotes, addNote, updateNote, deleteNote, type NoteDoc } from '$lib/firestore/notes';

  let notes: NoteDoc[] = $state([]);
  let unsub: (() => void) | null = $state(null);

  run(() => {
    if ($user?.uid) {
      unsub?.();
      unsub = subscribeNotes($user.uid, (rows) => (notes = rows));
    }
  });
  onDestroy(() => unsub?.());

  // Composer state
  let composing = $state(false);
  let title = $state('');
  let content = $state('');
  let color: string | null = $state(null);
  let query = $state('');

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

  const toMillis = (value: any) => {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    return 0;
  };

  function matches(text: string | null | undefined, needle: string) {
    if (!needle) return true;
    if (!text) return false;
    return text.toLowerCase().includes(needle);
  }

  let normalizedQuery = $derived(query.trim().toLowerCase());
  let filteredNotes =
    $derived(normalizedQuery.length === 0
      ? notes
      : notes.filter(
          (note) =>
            matches(note.title, normalizedQuery) ||
            matches(note.content, normalizedQuery)
        ));
  let orderedNotes = $derived([...(filteredNotes ?? [])].sort((a, b) => {
    if (a.pinned === b.pinned) {
      return toMillis(b.updatedAt ?? b.createdAt) - toMillis(a.updatedAt ?? a.createdAt);
    }
    return a.pinned ? -1 : 1;
  }));

  let openNote: NoteDoc | null = $state(null);

  const openNoteDetail = (note: NoteDoc) => {
    openNote = note;
  };

  const closeNoteDetail = () => {
    openNote = null;
  };

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

<div class="notes-board">
  <div class="notes-toolbar">
    <label class="notes-search" aria-label="Search notes">
      <i class="bx bx-search"></i>
      <input
        type="search"
        placeholder="Search notes"
        bind:value={query}
      />
    </label>
    <button
      class="notes-new-button"
      type="button"
      onclick={() => (composing = !composing)}
      aria-expanded={composing}
    >
      <i class="bx bx-plus"></i>
      <span>{composing ? 'Close composer' : 'New note'}</span>
    </button>
  </div>

  {#if composing}
    <div class={`note-composer ${colorClass(color)}`}>
      <input
        class="note-title"
        placeholder="Title"
        bind:value={title}
      />
      <textarea
        class="note-body"
        rows="3"
        placeholder="Take a note..."
        bind:value={content}
      ></textarea>
      <div class="note-composer__footer">
        <div class="note-colors">
          <button class="color-swatch color-yellow" type="button" aria-label="Set note color to yellow" onclick={() => (color = 'yellow')}></button>
          <button class="color-swatch color-green" type="button" aria-label="Set note color to green" onclick={() => (color = 'green')}></button>
          <button class="color-swatch color-blue" type="button" aria-label="Set note color to blue" onclick={() => (color = 'blue')}></button>
          <button class="color-swatch color-pink" type="button" aria-label="Set note color to pink" onclick={() => (color = 'pink')}></button>
          <button class="color-swatch color-purple" type="button" aria-label="Set note color to purple" onclick={() => (color = 'purple')}></button>
          <button class="color-swatch color-default" type="button" aria-label="Reset note color" onclick={() => (color = null)}></button>
        </div>
        <div class="note-composer__actions">
          <button class="btn btn-ghost" type="button" onclick={resetComposer}>Cancel</button>
          <button class="btn btn-primary" type="button" onclick={saveNote}>Save note</button>
        </div>
      </div>
    </div>
  {/if}

  {#if orderedNotes.length}
    <div class="notes-grid">
      {#each orderedNotes as n (n.id)}
        <button
          type="button"
          class={`note-card note-card--preview ${colorClass(n.color)}`}
          aria-label={`Open note ${n.title || 'untitled'}`}
          onclick={() => openNoteDetail(n)}
        >
          <div class="note-card__header">
            <div class="note-card__title">
              {#if n.title}
                <span>{n.title}</span>
              {:else}
                <span class="note-card__placeholder">Untitled</span>
              {/if}
            </div>
            {#if n.pinned}
              <i class="bx bxs-bookmark note-card__pin" aria-hidden="true"></i>
            {/if}
          </div>
          {#if n.content}
            <div class="note-card__body note-card__body--preview">
              <p>{n.content}</p>
            </div>
          {/if}
        </button>
      {/each}
    </div>
  {:else}
    <div class="notes-empty">
      <i class="bx bx-note"></i>
      {#if normalizedQuery}
        <p>No notes match “{query.trim()}”. Try a different search.</p>
      {:else}
        <p>You haven't created any notes yet. Tap “New note” to get started.</p>
      {/if}
    </div>
  {/if}

  {#if openNote}
    {@const detail = openNote}
    <div
      class="note-detail-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="View note"
      tabindex="0"
      onkeydown={(event) => {
        if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          closeNoteDetail();
        }
      }}
      onclick={(event) => {
        if (event.target !== event.currentTarget) return;
        closeNoteDetail();
      }}
    >
      <div class={`note-detail ${colorClass(detail.color)}`}>
        <div class="note-detail__header">
          <div>
            <h3>{detail.title || 'Untitled note'}</h3>
            <p class="note-detail__timestamp">
              {#if detail.updatedAt}
                Updated {new Date(toMillis(detail.updatedAt)).toLocaleString()}
              {:else if detail.createdAt}
                Created {new Date(toMillis(detail.createdAt)).toLocaleString()}
              {/if}
            </p>
          </div>
          <button class="note-icon-button" type="button" aria-label="Close" onclick={closeNoteDetail}>
            <i class="bx bx-x"></i>
          </button>
        </div>
          <div class="note-detail__body">
          {#if detail.content}
            <p>{detail.content}</p>
          {:else}
            <p class="note-card__placeholder">No content yet.</p>
          {/if}
        </div>
        <div class="note-detail__footer">
          <div class="note-colors">
            <button class="color-swatch color-yellow" type="button" aria-label="Set note color to yellow" onclick={() => changeColor(detail, 'yellow')}></button>
            <button class="color-swatch color-green" type="button" aria-label="Set note color to green" onclick={() => changeColor(detail, 'green')}></button>
            <button class="color-swatch color-blue" type="button" aria-label="Set note color to blue" onclick={() => changeColor(detail, 'blue')}></button>
            <button class="color-swatch color-pink" type="button" aria-label="Set note color to pink" onclick={() => changeColor(detail, 'pink')}></button>
            <button class="color-swatch color-purple" type="button" aria-label="Set note color to purple" onclick={() => changeColor(detail, 'purple')}></button>
            <button class="color-swatch color-default" type="button" aria-label="Reset note color" onclick={() => changeColor(detail, null)}></button>
          </div>
          <div class="note-detail__actions">
            <button class="note-icon-button" type="button" aria-label={detail.pinned ? 'Unpin note' : 'Pin note'} onclick={() => togglePin(detail)}>
              <i class={`bx ${detail.pinned ? 'bxs-bookmark' : 'bx-bookmark'}`}></i>
            </button>
            <button class="note-icon-button note-icon-button--danger" type="button" aria-label="Delete note" onclick={() => { remove(detail); closeNoteDetail(); }}>
              <i class="bx bx-trash"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .notes-board {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .notes-toolbar {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: center;
  }

  .notes-search {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 0.9rem;
    border-radius: var(--radius-md);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    background: color-mix(in srgb, var(--color-panel-muted) 85%, transparent);
    color: var(--text-70);
  }

  .notes-search input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    color: var(--text-90);
    font-size: 0.95rem;
    outline: none;
  }

  .notes-new-button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.65rem 1rem;
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
    color: var(--color-accent);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .notes-new-button:hover {
    background: color-mix(in srgb, var(--color-accent) 30%, transparent);
  }

  .note-composer {
    border-radius: var(--radius-lg);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    background: color-mix(in srgb, var(--color-panel) 90%, transparent);
    padding: 1rem;
    box-shadow: 0 12px 32px rgba(5, 10, 20, 0.35);
  }

  .note-title {
    width: 100%;
    background: transparent;
    border: none;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-95);
    outline: none;
  }

  .note-body {
    width: 100%;
    margin-top: 0.5rem;
    background: transparent;
    border: none;
    color: var(--text-80);
    resize: vertical;
    outline: none;
  }

  .note-composer__footer {
    margin-top: 0.75rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
  }

  .note-colors {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .color-swatch {
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 999px;
    border: 1px solid transparent;
  }

  .color-yellow { background: rgba(250, 204, 21, 0.75); }
  .color-green { background: rgba(52, 211, 153, 0.75); }
  .color-blue { background: rgba(96, 165, 250, 0.7); }
  .color-pink { background: rgba(244, 114, 182, 0.8); }
  .color-purple { background: rgba(196, 181, 253, 0.8); }
  .color-default {
    background: transparent;
    border-color: rgba(255, 255, 255, 0.25);
  }

  .note-composer__actions {
    margin-left: auto;
    display: inline-flex;
    gap: 0.5rem;
  }

  .notes-grid {
    display: grid;
    gap: 0.9rem;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }

  .note-card {
    border-radius: var(--radius-lg);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
    padding: 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    min-height: 140px;
    cursor: pointer;
    transition: transform 120ms ease, border 120ms ease;
    text-align: left;
  }

  .note-card:focus-visible,
  .note-card:hover {
    border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
    transform: translateY(-2px);
  }

  .note-card__header {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    justify-content: space-between;
  }

  .note-card__title span {
    font-weight: 600;
    color: var(--text-95);
  }

  .note-card__placeholder {
    color: var(--text-60);
    font-style: italic;
  }

  .note-card__body p {
    margin: 0;
    color: var(--text-80);
    white-space: pre-wrap;
  }

  .note-card__body--preview {
    max-height: 4.8rem;
    overflow: hidden;
    position: relative;
  }

  .note-card__body--preview::after {
    content: '';
    position: absolute;
    inset: auto 0 0 0;
    height: 1.5rem;
    background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--color-panel) 92%, transparent));
  }

  .note-card__footer {
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    justify-content: space-between;
  }

  .note-icon-button {
    width: 32px;
    height: 32px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-70);
  }

  .note-icon-button:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-95);
  }

  .note-icon-button--danger {
    color: #f87171;
  }

  .note-card__pin {
    color: var(--text-60);
    font-size: 1rem;
  }

  .notes-empty {
    border-radius: var(--radius-lg);
    border: 1px dashed color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    padding: 2rem;
    text-align: center;
    color: var(--text-70);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: center;
  }

  .notes-empty i {
    font-size: 2rem;
    color: var(--text-55);
  }

  .btn {
    border-radius: var(--radius-md);
    padding: 0.4rem 0.9rem;
    font-size: 0.9rem;
  }

  .btn-ghost {
    color: var(--text-80);
    background: transparent;
  }

  .btn-ghost:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .btn-primary {
    color: white;
    background: #5865f2;
  }

  .btn-primary:hover {
    background: #4752c4;
  }

  .note-detail-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(4, 7, 13, 0.75);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 1.25rem;
  }

  .note-detail {
    width: min(640px, 100%);
    max-height: 90vh;
    overflow: hidden;
    border-radius: var(--radius-lg);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
    background: color-mix(in srgb, var(--color-panel) 94%, transparent);
    padding: 1rem 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .note-detail__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .note-detail__header h3 {
    margin: 0;
    font-size: 1.15rem;
  }

  .note-detail__timestamp {
    margin: 0.1rem 0 0;
    font-size: 0.85rem;
    color: var(--text-60);
  }

  .note-detail__body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: 0.25rem;
  }

  .note-detail__body p {
    white-space: pre-wrap;
    margin: 0;
    color: var(--text-90);
  }

  .note-detail__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .note-detail__actions {
    display: inline-flex;
    gap: 0.5rem;
  }

  @media (max-width: 640px) {
    .notes-toolbar {
      flex-direction: column;
      align-items: stretch;
    }

    .notes-new-button {
      width: 100%;
      justify-content: center;
    }

    .note-composer__actions {
      width: 100%;
      justify-content: flex-end;
    }

    .note-detail-backdrop {
      padding: 0.75rem;
    }

    .note-detail {
      border-radius: var(--radius-lg);
      padding: 0.85rem;
    }
  }
</style>
