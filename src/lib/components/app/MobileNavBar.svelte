<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { dmUnreadCount } from '$lib/stores/notifications';
  import { activityUnreadCount } from '$lib/stores/activityFeed';
  import { user } from '$lib/stores/user';
  import { subscribeUserServers } from '$lib/firestore/servers';
  import { featureFlags } from '$lib/stores/featureFlags';
  import { closeSettings, openSettings, setSettingsSection, settingsUI } from '$lib/stores/settingsUI';
  import { defaultSettingsSection } from '$lib/settings/sections';
  import { resolveProfilePhotoURL } from '$lib/utils/profile';

  type LinkKey = 'activity' | 'dms';

  type Link = {
    key: LinkKey;
    href: string;
    label: string;
    icon: string;
    isActive: (path: string | null | undefined) => boolean;
  };

  type ServerShortcut = {
    id: string;
    name?: string | null;
    icon?: string | null;
  };

  const LAST_SERVER_KEY = 'hconnect:last-server';
  const LAST_SERVER_CHANNEL_KEY = 'hconnect:last-server-channel';
  type ChannelMemory = Record<string, string>;

  const navLinks: Link[] = [
    {
      key: 'dms',
      href: '/dms',
      label: 'DMs',
      icon: 'bx-message-dots',
      isActive: (path) => {
        const current = path ?? '';
        return current === '/dms' || current.startsWith('/dms/');
      }
    },
    {
      key: 'activity',
      href: '/',
      label: 'Activity',
      icon: 'bx-bell',
      isActive: (path) => (path ?? '') === '/'
    }
  ];

  let currentPath = $derived($page?.url?.pathname ?? '/');
  let lastServerShortcut: ServerShortcut | null = $state(null);
  let serverRows: ServerShortcut[] = $state([]);
  let stopServers: (() => void) | null = $state(null);
  let stopUser: (() => void) | null = null;
  let serverChannelMemory: ChannelMemory = $state({});
  const shortcut = $derived(lastServerShortcut as ServerShortcut | null);
  const serverActive = $derived(
    shortcut ? currentPath?.startsWith(`/servers/${shortcut.id}`) ?? false : false
  );
  const serverHref = $derived.by(() => {
    if (!shortcut) return '/servers';
    const lastChannel = serverChannelMemory?.[shortcut.id];
    if (lastChannel) {
      return `/servers/${shortcut.id}?channel=${encodeURIComponent(lastChannel)}`;
    }
    return `/servers/${shortcut.id}`;
  });
  const featureFlagStore = featureFlags;
  const enableDMs = $derived(Boolean($featureFlagStore.enableDMs));
  const isSettingsOpen = $derived($settingsUI.open);
  const settingsActive = $derived(isSettingsOpen || (currentPath?.startsWith('/settings') ?? false));
  const dockSuppressed = $derived(settingsActive);

  onMount(() => {
    loadStoredLastServer();
    loadStoredChannelMemory();
    stopUser = user.subscribe((value) => {
      stopServers?.();
      serverRows = [];
      if (value?.uid) {
        stopServers = subscribeUserServers(value.uid, (rows) => {
          serverRows = rows ?? [];
          syncLastServerDetails();
        });
      } else {
        clearLastServerShortcut();
        clearServerChannelMemory();
      }
    });

    return () => {
      stopServers?.();
      stopUser?.();
    };
  });

  function loadStoredLastServer() {
    if (!browser) return;
    try {
      const raw = localStorage.getItem(LAST_SERVER_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ServerShortcut | null;
      if (parsed?.id) {
        lastServerShortcut = parsed;
      }
    } catch {
      // ignore storage read errors
    }
  }

  function persistLastServer(info: ServerShortcut | null) {
    if (!browser) return;
    try {
      if (!info) {
        localStorage.removeItem(LAST_SERVER_KEY);
        return;
      }
      localStorage.setItem(
        LAST_SERVER_KEY,
        JSON.stringify({
          id: info.id,
          name: info.name ?? null,
          icon: info.icon ?? null
        })
      );
    } catch {
      // ignore storage errors
    }
  }

  function setLastServerShortcut(info: ServerShortcut) {
    if (!info?.id) return;
    const normalized: ServerShortcut = {
      id: info.id,
      name: info.name ?? lastServerShortcut?.name ?? null,
      icon: info.icon ?? lastServerShortcut?.icon ?? null
    };
    if (
      lastServerShortcut &&
      lastServerShortcut.id === normalized.id &&
      lastServerShortcut.name === normalized.name &&
      lastServerShortcut.icon === normalized.icon
    ) {
      return;
    }
    lastServerShortcut = normalized;
    persistLastServer(normalized);
  }

  function clearLastServerShortcut() {
    if (!lastServerShortcut) return;
    lastServerShortcut = null;
    persistLastServer(null);
  }

  function syncLastServerDetails() {
    if (!serverRows.length) return;
    if (lastServerShortcut) {
      const match = serverRows.find((row) => row.id === lastServerShortcut?.id);
      if (match) {
        setLastServerShortcut(match);
        return;
      }
    }
    setLastServerShortcut(serverRows[0]);
  }

  $effect(() => {
    if (!browser) return;
    const match = /^\/servers\/([^/]+)/.exec(currentPath ?? '');
    if (!match) return;
    const serverId = match[1];
    const matchRow = serverRows.find((row) => row.id === serverId);
    setLastServerShortcut(matchRow ?? { id: serverId });
  });

  $effect(() => {
    if (!browser) return;
    const match = /^\/servers\/([^/]+)/.exec(currentPath ?? '');
    if (!match) return;
    const channelId = $page?.url?.searchParams?.get('channel') ?? null;
    if (channelId) {
      rememberServerChannel(match[1], channelId);
    }
  });


  const formatBadge = (value: number): string => {
    if (!Number.isFinite(value)) return '';
    if (value > 99) return '99+';
    return value.toString();
  };

  function handleNav(event: MouseEvent, link: Link) {
    event.preventDefault();
    closeSettings();
    if (typeof window !== 'undefined' && link.href === '/dms') {
      try {
        sessionStorage.setItem('dm-show-list', '1');
      } catch {
        // ignore
      }
    }
    goto(link.href);
  }

  function openMobileSettings(event: MouseEvent) {
    event.preventDefault();
    setSettingsSection(defaultSettingsSection);
    openSettings({ source: 'trigger' });
  }

  function handleAvatarError(event: Event) {
    const target = event.currentTarget as HTMLImageElement | null;
    if (!target) return;
    target.onerror = null;
    target.src = '/default-avatar.svg';
  }

  function loadStoredChannelMemory() {
    if (!browser) return;
    try {
      const raw = localStorage.getItem(LAST_SERVER_CHANNEL_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      const next: ChannelMemory = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && value.trim()) {
          next[key] = value;
        }
      }
      serverChannelMemory = next;
    } catch {
      // ignore storage errors
    }
  }

  function persistChannelMemory(map: ChannelMemory) {
    if (!browser) return;
    try {
      const keys = Object.keys(map);
      if (!keys.length) {
        localStorage.removeItem(LAST_SERVER_CHANNEL_KEY);
      } else {
        localStorage.setItem(LAST_SERVER_CHANNEL_KEY, JSON.stringify(map));
      }
    } catch {
      // ignore storage errors
    }
  }

  function rememberServerChannel(serverId: string, channelId: string | null | undefined) {
    if (!serverId || !channelId) return;
    const existing = serverChannelMemory[serverId];
    if (existing === channelId) return;
    const next = { ...serverChannelMemory, [serverId]: channelId };
    serverChannelMemory = next;
    persistChannelMemory(next);
  }

  function clearServerChannelMemory() {
    if (!Object.keys(serverChannelMemory).length) return;
    serverChannelMemory = {};
    persistChannelMemory({});
  }
</script>

<nav
  class="mobile-dock md:hidden"
  aria-label="Primary"
>
  <div class="mobile-dock__inner">
    <a
      href={serverHref}
      onclick={(event) => {
        event.preventDefault();
        closeSettings();
        goto(serverHref);
      }}
      class={`mobile-dock__item mobile-dock__item--server ${serverActive && !dockSuppressed ? 'is-active' : ''} ${shortcut ? '' : 'is-placeholder'}`}
      aria-label={shortcut?.name ?? 'Servers'}
      aria-current={serverActive && !dockSuppressed ? 'page' : undefined}
      title="Servers"
    >
      <span class="mobile-dock__icon-wrapper">
        {#if shortcut?.icon}
          <img
            src={shortcut.icon}
            alt={shortcut.name ?? 'Server icon'}
            class="mobile-dock__server-icon"
            loading="lazy"
          />
        {:else if shortcut?.name}
          <span class="mobile-dock__server-fallback">
            {shortcut.name.slice(0, 1)}
          </span>
        {:else}
          <span class="mobile-dock__server-placeholder">
            <i class="bx bx-hash" aria-hidden="true"></i>
          </span>
        {/if}
      </span>
    </a>

    {#each navLinks as link (link.key)}
      {#if link.key !== 'dms' || enableDMs}
        {@const active = dockSuppressed ? false : link.isActive(currentPath)}
        {@const badge =
          link.key === 'dms'
            ? $dmUnreadCount
            : link.key === 'activity'
              ? $activityUnreadCount
              : 0}
        <a
          href={link.href}
          onclick={(event) => handleNav(event, link)}
          class={`mobile-dock__item ${active ? 'is-active' : ''}`}
          class:mobile-dock__item--alert={!active && badge > 0}
          class:mobile-dock__item--dms={link.key === 'dms'}
          class:mobile-dock__item--activity={link.key === 'activity'}
          aria-label={link.label}
          aria-current={active ? 'page' : undefined}
          title={link.label}
        >
          <span class="mobile-dock__icon-wrapper">
            <i class={`bx ${link.icon} mobile-dock__icon`} aria-hidden="true"></i>
            {#if badge > 0}
              <span class="mobile-dock__badge">{formatBadge(badge)}</span>
            {/if}
          </span>
        </a>
      {/if}
    {/each}

    <a
      href="/settings"
      onclick={openMobileSettings}
      class={`mobile-dock__item mobile-dock__item--profile ${settingsActive ? 'is-active' : ''}`}
      aria-label="Profile"
      aria-current={settingsActive ? 'page' : undefined}
      title="Profile"
    >
      <span class="mobile-dock__icon-wrapper mobile-dock__icon-wrapper--profile">
        <img
          src={resolveProfilePhotoURL($user)}
          alt="Me"
          class="mobile-dock__avatar"
          onerror={handleAvatarError}
        />
      </span>
    </a>
  </div>
</nav>

<style>
  .mobile-dock {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 99999;
    width: 100%;
    box-sizing: border-box;
    background: #40444e !important; /* Match provided image color */
    border-top: none;
    padding: 0 0.5rem;
    padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 0.65rem); /* Nudge nav content further upward */
    height: var(--mobile-dock-height, calc(3rem + env(safe-area-inset-bottom, 0px)));
    /* Ensure no transparency */
    /* Add a pseudo-element to guarantee flush color under home indicator */
  }

  .mobile-dock::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: env(safe-area-inset-bottom, 0px);
    background: #40444e;
    pointer-events: none;
    z-index: 1;
  }


  .mobile-dock__inner {
    display: flex;
    flex-direction: row;
    justify-content: space-around;
    align-items: center;
    height: calc(
      var(--mobile-dock-height, calc(3rem + env(safe-area-inset-bottom, 0px))) - env(safe-area-inset-bottom, 0px)
    - 0.65rem);
    width: 100%;
    max-width: 500px;
    margin: 0 auto;
    gap: 0;
  }

  .mobile-dock__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 0;
    border: none;
    background: transparent;
    color: #80848e; /* Discord's inactive tab color */
    text-decoration: none;
    transition: none;
    flex: 1;
    -webkit-tap-highlight-color: transparent;
    outline: none;
  }

  .mobile-dock__item:hover {
    color: #80848e; /* No hover change - look like icons */
  }

  .mobile-dock__item.is-active {
    color: #ffffff; /* Discord's active color - white */
  }

  .mobile-dock__item.is-active .mobile-dock__label,
  .mobile-dock__item.is-active .mobile-dock__icon {
    color: #ffffff;
  }

  .mobile-dock__icon-wrapper {
    position: relative;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0;
    background: transparent;
    border: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 0;
  }

  .mobile-dock__icon-wrapper--profile {
    padding: 0;
  }

  .mobile-dock__icon {
    font-size: 1.5rem;
    line-height: 1;
  }

  .mobile-dock__label {
    color: inherit;
    font-size: 0.625rem;
    line-height: 1.1;
    pointer-events: none;
    font-weight: 500;
    white-space: nowrap;
  }

  .mobile-dock__badge {
    position: absolute;
    top: -0.2rem;
    right: -0.35rem;
    min-width: 0.9rem;
    height: 0.9rem;
    padding: 0 0.2rem;
    border-radius: 999px;
    background: #ed4245; /* Discord's red notification color */
    color: white;
    font-size: 0.55rem;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 2px solid #1e1f22; /* Match dock background */
  }

  .mobile-dock__item--alert {
    color: #80848e;
  }

  .mobile-dock__server-icon,
  .mobile-dock__avatar {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    object-fit: cover;
  }

  .mobile-dock__server-fallback,
  .mobile-dock__server-placeholder {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background: #5865f2; /* Discord blurple */
    color: #ffffff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 0.7rem;
  }

  .mobile-dock__server-placeholder {
    background: #1e1f22;
    color: #80848e;
  }

  .mobile-dock__item--profile .mobile-dock__icon,
  .mobile-dock__item--notes .mobile-dock__icon,
  .mobile-dock__item--dms .mobile-dock__icon,
  .mobile-dock__item--activity .mobile-dock__icon {
    color: inherit;
  }

  .mobile-dock__item--profile .mobile-dock__label {
    color: inherit;
  }

  .mobile-dock__item--profile.is-active .mobile-dock__icon-wrapper {
    border: none;
  }

.mobile-dock__item--profile.is-active .mobile-dock__avatar {
  box-shadow: none; /* No ring - just plain icon */
}

.mobile-dock--hidden {
  transform: translateY(100%);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

/* Keep nav + children matching the dock background to prevent artifacts */
.mobile-dock *,
.mobile-dock__icon-wrapper {
  background-color: #40444e !important;
  box-shadow: none !important;
}
</style>
