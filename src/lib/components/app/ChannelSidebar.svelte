<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { getServerChannels, watchServerChannels } from '$lib/firestore';
  import {
    currentServerId,
    currentChannelId,
    channels,
    showCreateChannelModal,
    currentServer
  } from '$lib/stores/index';

  let unsubscribe: (() => void) | null = null;

  onMount(() => {
    return () => {
      unsubscribe?.();
    };
  });

  function watchChannels() {
    if ($currentServerId) {
      unsubscribe?.();
      unsubscribe = watchServerChannels($currentServerId, (data) => {
        channels.set(data);
      });
    }
  }

  $effect(() => {
    watchChannels();
  });

  function selectChannel(id: string) {
    currentChannelId.set(id);
  }

  function handleCreateChannel() {
    showCreateChannelModal.set(true);
  }
</script>

<!-- Left Pane - Channel List -->
<div
  class="hidden md:flex md:flex-col w-64 bg-gray-800 border-r border-gray-700 flex-shrink-0 overflow-hidden"
>
  <!-- Header -->
  <div class="px-4 py-4 border-b border-gray-700">
    <h2 class="text-xl font-bold text-white truncate">
      {$currentServer?.name || 'Select Server'}
    </h2>
    {#if $currentServer?.description}
      <p class="text-xs text-gray-400 mt-1 truncate">{$currentServer.description}</p>
    {/if}
  </div>

  <!-- Search -->
  <div class="px-4 py-3 border-b border-gray-700">
    <input
      type="text"
      placeholder="Search channels..."
      class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
    />
  </div>

  <!-- Channels -->
  <div class="flex-1 overflow-y-auto px-2 py-3">
    {#each $channels as channel (channel.id)}
      <button
        onclick={() => selectChannel(channel.id)}
        class={`w-full text-left px-3 py-2 rounded-lg mb-1 flex items-center gap-2 transition-colors ${
          $currentChannelId === channel.id
            ? 'bg-gray-700 text-white'
            : 'text-gray-300 hover:bg-gray-700 hover:text-white'
        }`}
      >
        <i class={`bx text-lg ${channel.type === 'voice' ? 'bx-microphone' : 'bx-hash'}`}></i>
        <span class="truncate text-sm font-medium">{channel.name}</span>
      </button>
    {/each}
  </div>

  <!-- Create Channel Button -->
  <div class="border-t border-gray-700 px-2 py-3">
    <button
      onclick={handleCreateChannel}
      class="w-full px-3 py-2 bg-gray-700 hover:bg-teal-600 text-gray-300 hover:text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
    >
      <i class="bx bx-plus"></i>
      New Channel
    </button>
  </div>
</div>
