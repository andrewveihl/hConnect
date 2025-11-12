<script lang="ts">
  type ThreadMember = {
    uid: string;
    displayName?: string;
    photoURL?: string | null;
  };

  interface Props {
    members?: ThreadMember[];
    threadName?: string | null;
  }

  let { members = [], threadName = null }: Props = $props();

  const displayLabel = (value?: string | null, fallback?: string) =>
    value?.trim()?.length ? value : fallback ?? 'Member';

  const initialsFor = (value?: string | null) => {
    const label = displayLabel(value);
    const parts = label.split(/\s+/).filter(Boolean);
    if (!parts.length) return label.charAt(0).toUpperCase() || '?';
    return parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || label.charAt(0).toUpperCase() || '?';
  };
</script>

<div class="thread-members-pane">
  <header class="thread-members-pane__header">
    <div>
      <p class="thread-members-pane__eyebrow">Thread members</p>
      <h3 class="thread-members-pane__title">{threadName || 'Thread'}</h3>
    </div>
    <span class="thread-members-pane__count">
      {members.length} {members.length === 1 ? 'member' : 'members'}
    </span>
  </header>

  {#if members.length}
    <ul class="thread-members-pane__list">
      {#each members as member (member.uid)}
        <li class="thread-member-row">
          <div class="thread-member-row__avatar" aria-hidden="true">
            {#if member.photoURL}
              <img src={member.photoURL} alt={displayLabel(member.displayName, member.uid)} loading="lazy" />
            {:else}
              <span>{initialsFor(member.displayName ?? member.uid)}</span>
            {/if}
          </div>
          <div class="thread-member-row__body">
            <span class="thread-member-row__name">{displayLabel(member.displayName, member.uid)}</span>
            <span class="thread-member-row__sub">Participant</span>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="thread-members-pane__empty">
      Only you are in this thread so far.
    </div>
  {/if}
</div>

<style>
  .thread-members-pane {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: color-mix(in srgb, var(--color-panel-muted) 92%, transparent);
    border-left: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    padding: 1.25rem 1.25rem 1.5rem;
    overflow-y: auto;
  }

  .thread-members-pane__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .thread-members-pane__eyebrow {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--text-60);
    margin: 0 0 0.2rem;
  }

  .thread-members-pane__title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  .thread-members-pane__count {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-65);
  }

  .thread-members-pane__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .thread-member-row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.45rem 0.35rem;
    border-radius: 0.85rem;
    border: 1px solid transparent;
    background: color-mix(in srgb, var(--color-panel) 85%, transparent);
  }

  .thread-member-row__avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--color-panel-muted) 75%, transparent);
    display: grid;
    place-items: center;
    font-weight: 600;
    color: var(--text-60);
    overflow: hidden;
  }

  .thread-member-row__avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thread-member-row__body {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .thread-member-row__name {
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .thread-member-row__sub {
    font-size: 0.78rem;
    color: var(--text-60);
  }

  .thread-members-pane__empty {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    border-radius: 0.85rem;
    border: 1px dashed color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    color: var(--text-60);
    font-size: 0.85rem;
  }
</style>
