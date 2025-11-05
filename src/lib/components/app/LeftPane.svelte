<script lang="ts">
  import { onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { user } from '$lib/stores/user';
  import { subscribeUserServers } from '$lib/firestore/servers';
  import NewServerModal from '$lib/components/servers/NewServerModal.svelte';
  import VoiceRailItem from '$lib/components/voice/VoiceRailItem.svelte';
  import logoMarkUrl from '$lib/assets/Logo_transparent.png';
  import { notificationCount, dmUnreadCount } from '$lib/stores/notifications';

  export let activeServerId: string | null = null;
  export let onCreateServer: (() => void) | null = null;

  let servers: { id: string; name: string; icon?: string | null }[] = [];
  let unsub: (() => void) | undefined;
  let localCreateOpen = false;

  $: if ($user) {
    unsub?.();
    unsub = subscribeUserServers($user.uid, (rows) => {
      servers = rows ?? [];
    });
  }

  onDestroy(() => unsub?.());

  const handleCreateClick = () => {
    if (onCreateServer) onCreateServer();
    else localCreateOpen = true;
  };

  const formatBadge = (value: number): string => {
    if (!Number.isFinite(value)) return '';
    if (value > 99) return '99+';
    return value.toString();
  };

  $: currentPath = $page?.url?.pathname ?? '/';
  $: notificationsActive = currentPath.startsWith('/notifications');
  $: dmsActive = currentPath === '/dms' || currentPath.startsWith('/dms/');
</script>

<aside
  class="app-rail h-dvh w-[72px] sticky top-0 left-0 z-30 flex flex-col items-center select-none"
  style="padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--mobile-dock-height, 0px) + 12px);"
  aria-label="Server list"
>
  <div class="h-4 shrink-0"></div>

  <a href="/" class="rail-logo" aria-label="hConnect home">
    <img src={logoMarkUrl} alt="hConnect" class="rail-logo__image" />
  </a>

  <div class="rail-divider"></div>

  <div class="flex-1 w-full overflow-y-auto">
    <div class="rail-server-stack pb-4">
      {#each servers as s (s.id)}
        <a
          href={`/servers/${s.id}`}
          class={`rail-button ${activeServerId === s.id ? 'rail-button--active' : ''}`}
          aria-label={s.name}
          title={s.name}
          aria-current={activeServerId === s.id ? 'page' : undefined}
        >
          {#if s.icon}
            <img
              src={s.icon}
              alt={s.name}
              class="rail-button__image"
              draggable="false"
            />
          {:else}
            <span class="rail-button__fallback">{s.name.slice(0, 2).toUpperCase()}</span>
          {/if}
        </a>
      {/each}

      <button
        type="button"
        class="rail-button rail-button--create"
        on:click={handleCreateClick}
        aria-label="Create server"
        title="Create server"
      >
        <i class="bx bx-plus text-2xl leading-none"></i>
      </button>
    </div>
  </div>

  <div class="w-full grid place-items-center gap-2 p-2">
    <a
      href="/notifications"
      class="rail-button rail-button--primary relative"
      class:rail-button--active={notificationsActive}
      class:rail-button--alert={$notificationCount > 0 && !notificationsActive}
      aria-label="Notifications"
      title="Notifications"
    >
      <i class="bx bx-bell text-xl leading-none"></i>
      {#if $notificationCount}
        <span class="rail-badge">{formatBadge($notificationCount)}</span>
      {/if}
    </a>

    <a
      href="/dms"
      class="rail-button rail-button--primary relative"
      class:rail-button--active={dmsActive}
      class:rail-button--alert={$dmUnreadCount > 0 && !dmsActive}
      aria-label="Home / DMs"
      title="Home / DMs"
    >
      <i class="bx bx-message-dots text-xl leading-none"></i>
      {#if $dmUnreadCount}
        <span class="rail-badge">{formatBadge($dmUnreadCount)}</span>
      {/if}
    </a>

    <VoiceRailItem />

    <a
      href="/settings"
      class="rail-button rail-button--profile overflow-hidden"
      aria-label="Profile"
      title="Profile"
    >
      {#if $user?.photoURL}
        <img src={$user.photoURL} alt="Me" class="rail-button__image" draggable="false" />
      {:else}
        <i class="bx bx-user text-xl leading-none"></i>
      {/if}
    </a>

    <a
      href="/settings"
      class="rail-button rail-button--compact"
      aria-label="Settings"
      title="Settings"
    >
      <i class="bx bx-cog text-lg leading-none"></i>
    </a>
  </div>
</aside>

<NewServerModal bind:open={localCreateOpen} onClose={() => (localCreateOpen = false)} />
