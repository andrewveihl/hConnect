<script lang="ts">
  interface Props {
    channel?: { id: string; type: 'text' | 'voice'; name: string } | null;
    channelsVisible?: boolean;
    membersVisible?: boolean;
    onToggleChannels?: (() => void) | null;
    onToggleMembers?: (() => void) | null;
  }

  let {
    channel = null,
    channelsVisible = false,
    membersVisible = false,
    onToggleChannels = null,
    onToggleMembers = null
  }: Props = $props();
</script>

<header class="channel-header">
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
      </div>
    {:else}
      <div class="channel-header__title">
        <span>Select a channel</span>
      </div>
    {/if}
  </div>

  <div class="channel-header__right">
    {#if !membersVisible}
      <button
        class="channel-header__toggle md:hidden"
        type="button"
        aria-label="Show members"
        onclick={() => onToggleMembers?.()}
      >
        <i class="bx bx-chevron-right text-xl"></i>
      </button>
    {/if}
  </div>
</header>
