<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
import { dmUnreadCount } from '$lib/stores/notifications';
import { activityUnreadCount } from '$lib/stores/activityFeed';
import { user } from '$lib/stores/user';
import { mobileDockSuppressed } from '$lib/stores/ui';
import { subscribeUserServers } from '$lib/firestore/servers';
import { superAdminEmailsStore } from '$lib/admin/superAdmin';
import { featureFlags } from '$lib/stores/featureFlags';

  type Link = {
    href: string;
    label: string;
    icon: string;
    isActive: (path: string) => boolean;
  };

  type ServerShortcut = {
    id: string;
    name?: string | null;
    icon?: string | null;
  };

  const LAST_SERVER_KEY = 'hconnect:last-server';
  const LAST_SERVER_CHANNEL_KEY = 'hconnect:last-server-channel';
  type ChannelMemory = Record<string, string>;

  const links: Link[] = [
    {
      href: '/dms',
      label: 'DMs',
      icon: 'bx-message-dots',
      isActive: (path) => path === '/dms' || (path.startsWith('/dms/') && !path.startsWith('/dms/notes'))
    },
    {
      href: '/',
      label: 'Activity',
      icon: 'bx-bell',
      isActive: (path) => path === '/'
    },
    {
      href: '/dms/notes',
      label: 'Notes',
      icon: 'bx-notepad',
      isActive: (path) => path.startsWith('/dms/notes')
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
const superAdminEmails = superAdminEmailsStore();
const featureFlagStore = featureFlags;
const enableDMs = $derived(Boolean($featureFlagStore.enableDMs));
const showAdminLink = $derived(
  (() => {
    const email = $user?.email ? $user.email.toLowerCase() : null;
    if (!email) return false;
    return Array.isArray($superAdminEmails) ? $superAdminEmails.includes(email) : false;
  })()
);

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
    if (typeof window !== 'undefined' && link.href === '/dms') {
      try {
        sessionStorage.setItem('dm-show-list', '1');
      } catch {
        // ignore
      }
    }
    goto(link.href);
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
  class:mobile-dock--hidden={$mobileDockSuppressed}
  aria-label="Primary"
  aria-hidden={$mobileDockSuppressed ? 'true' : undefined}
>
  <div class="mobile-dock__inner">
    <a
      href={serverHref}
      onclick={(event) => {
        event.preventDefault();
        goto(serverHref);
      }}
      class={`mobile-dock__item mobile-dock__item--server ${serverActive ? 'is-active' : ''} ${shortcut ? '' : 'is-placeholder'}`}
      aria-label={shortcut?.name ?? 'Servers'}
      aria-current={serverActive ? 'page' : undefined}
    >
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
    </a>

    {#each links as link}
      {#if link.href !== '/dms' || enableDMs}
        {@const active = link.isActive(currentPath)}
        {@const badge =
          link.href === '/dms'
            ? $dmUnreadCount
            : link.href === '/'
              ? $activityUnreadCount
              : 0}
        <a
          href={link.href}
          onclick={(event) => handleNav(event, link)}
          class={`mobile-dock__item ${active ? 'is-active' : ''}`}
          class:mobile-dock__item--alert={!active && badge > 0}
          class:mobile-dock__item--notes={link.href === '/dms/notes'}
          aria-label={link.label}
          aria-current={active ? 'page' : undefined}
        >
          <i class={`bx ${link.icon} mobile-dock__icon`} aria-hidden="true"></i>
          {#if badge > 0}
            <span class="mobile-dock__badge">{formatBadge(badge)}</span>
          {/if}
        </a>
      {/if}
    {/each}
    {#if showAdminLink}
      <a
        href="/admin"
        onclick={(event) => {
          event.preventDefault();
          goto('/admin');
        }}
        class={`mobile-dock__item mobile-dock__item--admin ${currentPath.startsWith('/admin') ? 'is-active' : ''}`}
        aria-label="Admin"
        aria-current={currentPath.startsWith('/admin') ? 'page' : undefined}
      >
        <i class="bx bx-shield-quarter mobile-dock__icon" aria-hidden="true"></i>
      </a>
    {/if}
    <a
      href="/settings"
      onclick={(event) => {
        event.preventDefault();
        goto('/settings');
      }}
      class={`mobile-dock__item mobile-dock__item--profile ${currentPath.startsWith('/settings') ? 'is-active' : ''}`}
      aria-label="Profile"
      aria-current={currentPath.startsWith('/settings') ? 'page' : undefined}
    >
      {#if $user?.photoURL}
        <img src={$user.photoURL} alt="Me" class="mobile-dock__avatar" />
      {:else}
        <i class="bx bx-user mobile-dock__icon" aria-hidden="true"></i>
      {/if}
    </a>
  </div>
</nav>

<style>
  .mobile-dock {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 55;
    padding: 0.45rem 1rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
    border-top: 1px solid var(--color-border-subtle);
    box-shadow: 0 -12px 32px rgba(4, 8, 14, 0.45);
    backdrop-filter: blur(16px);
    transform: translateY(0);
    transition: transform 280ms cubic-bezier(0.2, 0.8, 0.25, 1), opacity 200ms ease;
    will-change: transform, opacity;
  }

  .mobile-dock__inner {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .mobile-dock__item {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
    gap: 0.3rem;
    padding: 0.35rem 0.5rem;
    border-radius: var(--radius-md);
    color: var(--text-60);
    font-size: 0.75rem;
    text-decoration: none;
    transition: color 0.18s ease, background 0.18s ease, transform 0.18s ease;
  }

  .mobile-dock__item:hover {
    color: var(--text-90);
    background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
  }

  .mobile-dock__item.is-active {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 35%, transparent);
  }

  .mobile-dock__icon {
    font-size: 1.55rem;
    line-height: 1;
  }

  .mobile-dock__item--admin {
    background: linear-gradient(135deg, rgba(56, 189, 248, 0.95), rgba(14, 165, 233, 0.9));
    color: white;
    border: 1px solid rgba(14, 165, 233, 0.45);
    box-shadow: 0 12px 24px rgba(14, 165, 233, 0.35);
  }

  .mobile-dock__item--admin .mobile-dock__icon {
    color: white;
  }

  .mobile-dock__badge {
    position: absolute;
    top: -0.2rem;
    right: -0.05rem;
    min-width: 1.2rem;
    height: 1.2rem;
    padding: 0 0.35rem;
    border-radius: 999px;
    background: var(--color-alert, #f87171);
    color: white;
    font-size: 0.65rem;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 10px rgba(249, 127, 127, 0.45);
  }

  .mobile-dock__item--alert {
    color: var(--color-accent);
  }

  .mobile-dock__item--profile {
    padding-inline: 0.4rem;
  }

  .mobile-dock__item--notes .mobile-dock__icon {
    color: var(--color-accent);
  }

  .mobile-dock__item--profile .mobile-dock__icon {
    color: var(--color-accent);
  }

  .mobile-dock__item--profile .mobile-dock__label {
    color: var(--color-accent);
  }

  .mobile-dock__avatar {
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    object-fit: cover;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 45%, transparent);
  }

  .mobile-dock__item--server {
    padding-inline: 0.4rem;
  }

  .mobile-dock__server-icon {
    width: 2rem;
    height: 2rem;
    border-radius: 0.85rem;
    object-fit: cover;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.18);
  }

  .mobile-dock__server-fallback,
  .mobile-dock__server-placeholder {
    width: 2rem;
    height: 2rem;
    border-radius: 0.85rem;
    background: color-mix(in srgb, var(--color-accent) 25%, transparent);
    color: var(--color-accent);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
  }

  .mobile-dock__server-placeholder {
    background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
    color: var(--text-40);
  }

  .mobile-dock--hidden {
    transform: translateY(calc(100% + env(safe-area-inset-bottom, 0px)));
    opacity: 0;
    pointer-events: none;
  }
</style>
