<script lang="ts">
  import { currentChannel, showMembersPane, sidebarOpen } from '$lib/stores/index';
</script>

<!-- Channel Header -->
<div class="h-16 bg-gray-800 border-b border-gray-700 px-4 flex items-center justify-between">
  <!-- Left: Channel Info -->
  <div class="flex items-center gap-3 flex-1 min-w-0">
    <button
      onclick={() => sidebarOpen.set(!$sidebarOpen)}
      class="md:hidden p-2 hover:bg-gray-700 rounded-lg transition-colors"
      title="Toggle channel sidebar"
    >
      <i class="bx bx-menu text-xl text-gray-300"></i>
    </button>

    {#if $currentChannel}
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <i class="bx bx-hash text-xl text-gray-400 flex-shrink-0"></i>
          <h1 class="text-lg font-bold text-white truncate">{$currentChannel.name}</h1>
        </div>
        {#if $currentChannel.topic}
          <p class="text-xs text-gray-400 truncate">{$currentChannel.topic}</p>
        {/if}
      </div>
    {:else}
      <div class="text-gray-400">Select a channel</div>
    {/if}
  </div>

  <!-- Right: Actions -->
  <div class="flex items-center gap-2">
    <button
      class="p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-300 hover:text-white"
      title="Search in channel"
    >
      <i class="bx bx-search text-xl"></i>
    </button>

    <button
      onclick={() => showMembersPane.set(!$showMembersPane)}
      class="p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-300 hover:text-white"
      title="Toggle members pane"
    >
      <i class="bx bx-group text-xl"></i>
    </button>

    <button
      class="p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-300 hover:text-white"
      title="Channel settings"
    >
      <i class="bx bx-cog text-xl"></i>
    </button>
  </div>
</div>
