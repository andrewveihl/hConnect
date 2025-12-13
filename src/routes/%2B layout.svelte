<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { ensureFirebaseReady } from '$lib/firebase/index';
  import {
    authUser,
    authLoading,
    servers,
    currentServerId,
    channels,
    currentChannelId
  } from '$lib/stores/index';
  import { watchUserServers } from '$lib/firestore';
  import ServerSidebar from '$lib/components/app/ServerSidebar.svelte';
  import ChannelSidebar from '$lib/components/app/ChannelSidebar.svelte';
  import ChannelHeader from '$lib/components/app/ChannelHeader.svelte';
  import MessageList from '$lib/components/app/MessageList.svelte';
  import ChatInput from '$lib/components/app/ChatInput.svelte';
  import MembersPane from '$lib/components/app/MembersPane.svelte';
  import CreateServerModal from '$lib/components/modals/CreateServerModal.svelte';
  import CreateChannelModal from '$lib/components/modals/CreateChannelModal.svelte';

  let isInitializing = $state(true);
  let unsubscribeServers: (() => void) | null = null;

  onMount(async () => {
    try {
      await ensureFirebaseReady();

      // Wait for auth state to be set
      if (!$authUser && !$authLoading) {
        goto('/auth/login');
        return;
      }

      if ($authUser) {
        // Watch user's servers
        unsubscribeServers = watchUserServers($authUser.id, (data) => {
          servers.set(data);
          // Auto-select first server if none selected
          if (!$currentServerId && data.length > 0) {
            currentServerId.set(data[0].id);
          }
        });
      }
    } finally {
      isInitializing = false;
    }
  });

  $effect(() => {
    return () => {
      unsubscribeServers?.();
    };
  });

  $effect(() => {
    if (!$authLoading && !$authUser) {
      goto('/auth/login');
    }
  });
</script>

{#if $authLoading || isInitializing}
  <div class="h-screen w-screen flex items-center justify-center bg-gray-900">
    <div class="text-center">
      <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      <p class="mt-4 text-gray-400">Loading hConnect...</p>
    </div>
  </div>
{:else if $authUser}
  <!-- Main App Layout -->
  <div class="flex h-screen w-screen bg-gray-900 overflow-hidden">
    <!-- Server Sidebar -->
    <ServerSidebar />

    <!-- Channel Sidebar + Main Content -->
    <div class="flex flex-1 overflow-hidden">
      <ChannelSidebar />

      <!-- Main Chat Area -->
      <div class="flex flex-col flex-1 overflow-hidden">
        <ChannelHeader />
        <MessageList />
        <ChatInput />
      </div>

      <!-- Members Pane -->
      <MembersPane />
    </div>

    <!-- Modals -->
    <CreateServerModal />
    <CreateChannelModal />
  </div>
{:else}
  <div class="h-screen w-screen flex items-center justify-center bg-gray-900">
    <p class="text-gray-400">Redirecting to login...</p>
  </div>
{/if}
