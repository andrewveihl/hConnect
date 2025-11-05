<script lang="ts">
  import { page } from '$app/stores';
  import { notificationCount, dmUnreadCount } from '$lib/stores/notifications';

  type Link = {
    href: string;
    label: string;
    icon: string;
    isActive: (path: string) => boolean;
  };

  const links: Link[] = [
    {
      href: '/dms',
      label: 'DMs',
      icon: 'bx-message-dots',
      isActive: (path) => path === '/dms' || (path.startsWith('/dms/') && !path.startsWith('/dms/notes'))
    },
    {
      href: '/dms/notes',
      label: 'Notes',
      icon: 'bx-notepad',
      isActive: (path) => path.startsWith('/dms/notes')
    },
    {
      href: '/',
      label: 'Activity',
      icon: 'bx-bell',
      isActive: (path) => path === '/'
    }
  ];

  $: currentPath = $page?.url?.pathname ?? '/';

  const formatBadge = (value: number): string => {
    if (!Number.isFinite(value)) return '';
    if (value > 99) return '99+';
    return value.toString();
  };
</script>

<nav class="mobile-dock md:hidden" aria-label="Primary">
  <div class="mobile-dock__inner">
    {#each links as link}
      {@const active = link.isActive(currentPath)}
      {@const badge =
        link.href === '/dms'
          ? $dmUnreadCount
          : link.href === '/'
            ? $notificationCount
            : 0}
      <a
        href={link.href}
        class={`mobile-dock__item ${active ? 'is-active' : ''}`}
        class:mobile-dock__item--alert={!active && badge > 0}
        aria-label={link.label}
        aria-current={active ? 'page' : undefined}
      >
        <i class={`bx ${link.icon} mobile-dock__icon`} aria-hidden="true"></i>
        <span class="mobile-dock__label">{link.label}</span>
        {#if badge > 0}
          <span class="mobile-dock__badge">{formatBadge(badge)}</span>
        {/if}
      </a>
    {/each}
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
  }

  .mobile-dock__inner {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
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
    font-size: 1.375rem;
    line-height: 1;
  }

  .mobile-dock__label {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
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
</style>
