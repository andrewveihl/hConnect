<script lang="ts">
  import { onMount } from 'svelte';
  import { watchMemberships, getUser } from '$lib/firestore';
  import { currentServerId, channelMembers } from '$lib/stores/index';
  import type { User } from '$lib/types';
  import { resolveProfilePhotoURL } from '$lib/utils/profile';

  let unsubscribe: (() => void) | null = null;
  let memberUsers = $state<(User & { role: string; status: string })[]>([]);

  onMount(() => {
    return () => {
      unsubscribe?.();
    };
  });

  async function loadMembers() {
    if ($currentServerId) {
      unsubscribe?.();
      unsubscribe = watchMemberships($currentServerId, async (memberships) => {
        const users = await Promise.all(
          memberships.map(async (m) => {
            const user = await getUser(m.userId);
            return {
              ...user,
              role: m.role,
              status: Math.random() > 0.5 ? 'online' : 'offline'
            } as User & { role: string; status: string };
          })
        );
        memberUsers = users.filter((u) => u !== null);
        channelMembers.set(memberUsers);
      });
    }
  }

  $effect(() => {
    loadMembers();
  });

  const getOnlineUsers = () => memberUsers.filter((u) => u.status === 'online');
  const getOfflineUsers = () => memberUsers.filter((u) => u.status === 'offline');

  function getRoleBadgeColor(role: string): string {
    switch (role) {
      case 'owner':
        return 'bg-red-500/20 text-red-300';
      case 'admin':
        return 'bg-yellow-500/20 text-yellow-300';
      default:
        return 'bg-gray-600/20 text-gray-300';
    }
  }
</script>

<!-- Right Pane - Members List -->
<div class="hidden lg:flex lg:flex-col w-64 bg-gray-800 border-l border-gray-700 flex-shrink-0 overflow-hidden">
  <!-- Header -->
  <div class="px-4 py-4 border-b border-gray-700">
    <h3 class="text-lg font-bold text-white">Members ({memberUsers.length})</h3>
  </div>

  <!-- Members List -->
  <div class="flex-1 overflow-y-auto">
    <!-- Online Section -->
    {#if getOnlineUsers().length > 0}
      <div class="px-4 py-3">
        <h4 class="text-xs font-semibold text-gray-400 uppercase mb-2">
          Online — {getOnlineUsers().length}
        </h4>
        <div class="space-y-2">
          {#each getOnlineUsers() as member (member.id)}
            <div
              class="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-700 transition-colors cursor-pointer group"
            >
              <div class="relative flex-shrink-0">
                <img
                  src={resolveProfilePhotoURL(member)}
                  alt={member.displayName || member.email || 'User'}
                  class="w-8 h-8 rounded-full object-cover bg-gray-700 border border-gray-600"
                />
                <div
                  class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-800"
                ></div>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-white truncate">
                  {member.displayName || member.email}
                </p>
                <span class={`text-xs px-2 py-0.5 rounded-full ${getRoleBadgeColor(member.role)}`}>
                  {member.role}
                </span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Divider -->
    {#if getOnlineUsers().length > 0 && getOfflineUsers().length > 0}
      <div class="border-t border-gray-700"></div>
    {/if}

    <!-- Offline Section -->
    {#if getOfflineUsers().length > 0}
      <div class="px-4 py-3">
        <h4 class="text-xs font-semibold text-gray-400 uppercase mb-2">
          Offline — {getOfflineUsers().length}
        </h4>
        <div class="space-y-2">
          {#each getOfflineUsers() as member (member.id)}
            <div
              class="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-700 transition-colors cursor-pointer group opacity-60"
            >
              <div class="relative flex-shrink-0">
                <img
                  src={resolveProfilePhotoURL(member)}
                  alt={member.displayName || member.email || 'User'}
                  class="w-8 h-8 rounded-full object-cover bg-gray-700 border border-gray-600 opacity-60"
                />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-300 truncate">
                  {member.displayName || member.email}
                </p>
                <span class={`text-xs px-2 py-0.5 rounded-full ${getRoleBadgeColor(member.role)}`}>
                  {member.role}
                </span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if memberUsers.length === 0}
      <div class="p-4 text-center text-gray-400">
        <p class="text-sm">No members found</p>
      </div>
    {/if}
  </div>
</div>
