<script lang="ts">
  import { run } from 'svelte/legacy';

  import { onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { user } from '$lib/stores/user';
  import { subscribeUserServers } from '$lib/firestore/servers';
  import NewServerModal from '$lib/components/servers/NewServerModal.svelte';
  import VoiceRailItem from '$lib/components/voice/VoiceRailItem.svelte';
  import logoMarkUrl from '$lib/assets/Logo_transparent.png';
  import { dmUnreadCount, notifications } from '$lib/stores/notifications';
  import type { NotificationItem } from '$lib/stores/notifications';

  interface Props {
    activeServerId?: string | null;
    onCreateServer?: (() => void) | null;
    padForDock?: boolean;
    showBottomActions?: boolean;
  }

  let {
    activeServerId = null,
    onCreateServer = null,
    padForDock = true,
    showBottomActions = true
  }: Props = $props();

  let servers: { id: string; name: string; icon?: string | null }[] = $state([]);
  let unsub: (() => void) | undefined = $state();
  let localCreateOpen = $state(false);

  run(() => {
    if ($user) {
      unsub?.();
      unsub = subscribeUserServers($user.uid, (rows) => {
        servers = rows ?? [];
      });
    }
  });

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

  let currentPath = $derived($page?.url?.pathname ?? '/');
  let dmsActive = $derived(currentPath === '/dms' || currentPath.startsWith('/dms/'));
  let activeDmThreadId =
    $derived(currentPath.startsWith('/dms/') && currentPath.length > 5
      ? currentPath.slice(5).split('/')[0] || null
      : null);

  let unreadDMs: NotificationItem[] = $state([]);
  run(() => {
    unreadDMs = ($notifications ?? []).filter((item) => item?.kind === 'dm' && item.unread > 0);
  });
</script>

<aside
  class="app-rail h-dvh w-[72px] sticky top-0 left-0 z-30 flex flex-col items-center select-none"
  style:padding-bottom={padForDock
    ? 'calc(env(safe-area-inset-bottom, 0px) + var(--mobile-dock-height, 0px) + 12px)'
    : '0.85rem'}
  aria-label="Server list"
>
  <div class="h-4 shrink-0"></div>

  <a href="/" class="rail-logo" aria-label="Activity">
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
        onclick={handleCreateClick}
        aria-label="Create server"
        title="Create server"
      >
        <i class="bx bx-plus text-2xl leading-none"></i>
      </button>
    </div>
  </div>

  {#if showBottomActions}
    <div
      class="rail-bottom w-full flex flex-col items-center gap-3 p-3 mt-auto"
      style:padding-bottom={padForDock
        ? '1rem'
        : 'calc(env(safe-area-inset-bottom, 0px) + var(--mobile-dock-height, 0px) + 0.25rem)'}
    >
      {#if unreadDMs.length}
        <div class="flex flex-col items-center gap-2 w-full" aria-label="Unread direct messages">
          {#each unreadDMs as dm (dm.id)}
            <a
              href={dm.href}
              class={`rail-button relative ${activeDmThreadId === dm.threadId ? 'rail-button--active' : ''}`}
              class:rail-button--alert={activeDmThreadId !== dm.threadId}
              aria-label={dm.title}
              title={dm.title}
              aria-current={activeDmThreadId === dm.threadId ? 'page' : undefined}
            >
              {#if dm.photoURL}
                <img
                  src={dm.photoURL}
                  alt={dm.title}
                  class="rail-button__image"
                  draggable="false"
                />
              {:else}
                <i class="bx bx-user text-xl leading-none"></i>
              {/if}
              <span class="rail-badge">{formatBadge(dm.unread)}</span>
            </a>
          {/each}
        </div>
      {/if}

      <div class="w-full flex flex-col items-center gap-2 pt-1">
        <VoiceRailItem />

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
      </div>

      <a
        href="/settings"
        class="rail-button rail-button--profile overflow-hidden mt-1"
        aria-label="Profile"
        title="Profile"
      >
        {#if $user?.photoURL}
          <img src={$user.photoURL} alt="Me" class="rail-button__image" draggable="false" />
        {:else}
          <i class="bx bx-user text-xl leading-none"></i>
        {/if}
      </a>
    </div>
  {/if}
</aside>

<NewServerModal bind:open={localCreateOpen} onClose={() => (localCreateOpen = false)} />

<style>
  @media (max-width: 767px) {
    :global(.app-rail .rail-bottom) {
      display: none;
    }
  }
</style>
