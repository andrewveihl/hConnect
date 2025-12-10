<script lang="ts">
  interface Props {
    channel?: { id: string; type: 'text' | 'voice'; name: string } | null;
    thread?: { id: string; name?: string | null } | null;
    channelsVisible?: boolean;
    membersVisible?: boolean;
    showMessageShortcut?: boolean;
    onToggleChannels?: (() => void) | null;
    onToggleMembers?: (() => void) | null;
    onOpenMessages?: (() => void) | null;
    onExitThread?: (() => void) | null;
  }

  let {
    channel = null,
    thread = null,
    channelsVisible = false,
    membersVisible = false,
    showMessageShortcut = false,
    onToggleChannels = null,
    onToggleMembers = null,
    onOpenMessages = null,
    onExitThread = null
  }: Props = $props();

  let rootEl: HTMLElement | null = null;

  export function focusHeader() {
    rootEl?.focus();
  }
</script>

<header class="channel-header" bind:this={rootEl} tabindex="-1">
  <div class="channel-header__left">
    {#if !channelsVisible}
      <button
        class="channel-header__toggle md:hidden"
        type="button"
        aria-label="Show servers"
        onclick={() => onToggleChannels?.()}
      >
        <i class="bx bx-chevron-left text-xl"></i>
      </button>
    {/if}

    {#if channel}
      <div class="channel-header__title">
        <span class="channel-header__badge" aria-hidden="true">
          {#if channel.type === 'text'}
            <i class="bx bx-hash"></i>
          {:else}
            <i class="bx bx-headphone"></i>
          {/if}
        </span>
        <span class="truncate max-w-[160px] sm:max-w-none">{channel.name}</span>
        {#if thread}
          <i class="bx bx-chevron-right text-soft" aria-hidden="true"></i>
          <span class="channel-header__thread-name truncate">{thread.name || 'Thread'}</span>
        {/if}
      </div>
    {:else}
      <div class="channel-header__title">
        <span>Select a channel</span>
      </div>
    {/if}
  </div>

  <div class="channel-header__right">
    {#if thread}
      <button
        type="button"
        class="channel-header__thread-exit"
        onclick={() => onExitThread?.()}
      >
        <i class="bx bx-arrow-back" aria-hidden="true"></i>
        <span>Back to {channel?.name ?? 'channel'}</span>
      </button>
    {/if}
    {#if showMessageShortcut}
      <button
        class="channel-header__message"
        type="button"
        aria-label="Open channel messages"
        title="Open channel messages"
        onclick={() => onOpenMessages?.()}
      >
        <i class="bx bx-message-dots text-xl"></i>
      </button>
    {/if}
  </div>
</header>

<style>
  .channel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    height: 3rem;
    padding: 0 1.25rem;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .channel-header__left,
  .channel-header__right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .channel-header__title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .channel-header__thread-name {
    font-size: 0.9rem;
    color: var(--text-70);
    max-width: 160px;
  }

  .channel-header__thread-exit {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
    border-radius: 999px;
    background: transparent;
    color: var(--color-text-primary);
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.25rem 0.9rem;
  }

  .channel-header__thread-exit:hover,
  .channel-header__thread-exit:focus-visible {
    background: color-mix(in srgb, var(--color-border-subtle) 20%, transparent);
    outline: none;
  }

  .channel-header__message {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.85rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    background: color-mix(in srgb, var(--color-panel) 75%, transparent);
    color: var(--color-text-primary);
    display: grid;
    place-items: center;
    transition: background 150ms ease, border-color 150ms ease, transform 140ms ease;
  }

  .channel-header__message:hover,
  .channel-header__message:focus-visible {
    background: color-mix(in srgb, var(--color-panel) 85%, transparent);
    border-color: color-mix(in srgb, var(--color-border-subtle) 90%, transparent);
    outline: none;
  }

  .channel-header__message:active {
    transform: translateY(1px);
  }

  .channel-header__toggle {
    transition: background 150ms ease, border 150ms ease, color 150ms ease, transform 160ms ease;
    touch-action: manipulation;
  }

  .channel-header__toggle:active {
    transform: scale(0.92);
  }
</style>
