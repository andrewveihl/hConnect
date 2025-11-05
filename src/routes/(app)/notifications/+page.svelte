<script lang="ts">
  import LeftPane from '$lib/components/app/LeftPane.svelte';
  import {
    notifications,
    notificationsReady,
    notificationCount,
    channelUnreadCount,
    dmUnreadCount
  } from '$lib/stores/notifications';
  import { goto } from '$app/navigation';

  const formatCount = (value: number): string => {
    if (!Number.isFinite(value)) return '0';
    if (value > 99) return '99+';
    return value.toString();
  };

  const relativeFormatter =
    typeof Intl !== 'undefined'
      ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
      : null;

  const formatRelativeTime = (timestamp: number | null): string => {
    if (!timestamp) return '';
    const diffMs = timestamp - Date.now();
    const diffSec = Math.round(diffMs / 1000);
    if (!relativeFormatter) {
      return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    const absSec = Math.abs(diffSec);
    if (absSec < 60) return relativeFormatter.format(Math.round(diffSec), 'second');
    const diffMin = Math.round(diffSec / 60);
    const absMin = Math.abs(diffMin);
    if (absMin < 60) return relativeFormatter.format(diffMin, 'minute');
    const diffHour = Math.round(diffMin / 60);
    const absHour = Math.abs(diffHour);
    if (absHour < 24) return relativeFormatter.format(diffHour, 'hour');
    const diffDay = Math.round(diffHour / 24);
    const absDay = Math.abs(diffDay);
    if (absDay < 7) return relativeFormatter.format(diffDay, 'day');
    const diffWeek = Math.round(diffDay / 7);
    const absWeek = Math.abs(diffWeek);
    if (absWeek < 4) return relativeFormatter.format(diffWeek, 'week');
    const diffMonth = Math.round(diffDay / 30);
    const absMonth = Math.abs(diffMonth);
    if (absMonth < 12) return relativeFormatter.format(diffMonth, 'month');
    const diffYear = Math.round(diffDay / 365);
    return relativeFormatter.format(diffYear, 'year');
  };

  const goTo = (href: string) => {
    goto(href, { keepfocus: true, noScroll: true });
  };
</script>

<div class="flex h-dvh app-bg text-primary overflow-hidden">
  <LeftPane activeServerId={null} />

  <div class="flex flex-1 flex-col overflow-hidden panel-muted">
    <header class="notifications-header">
      <div class="notifications-header__main">
        <h1>Notifications</h1>
        <p class="text-soft">
          {#if $notificationCount === 0}
            You're all caught up. We'll keep new activity here.
          {:else}
            {formatCount($notificationCount)} unread &middot; {formatCount($channelUnreadCount)} in channels &middot; {formatCount($dmUnreadCount)} in DMs
          {/if}
        </p>
      </div>
    </header>

    <main class="notifications-main">
      {#if !$notificationsReady}
        <div class="notifications-placeholder">
          <div class="spinner"></div>
          <p>Loading latest alerts&hellip;</p>
        </div>
      {:else if !$notifications.length}
        <div class="notifications-empty">
          <i class="bx bx-bell-off text-4xl text-soft"></i>
          <h2>No new notifications</h2>
          <p>When channels or direct messages get busy, they’ll appear here so you can jump in quickly.</p>
          <a class="btn btn-primary mt-4" href="/dms">
            Jump to messages
          </a>
        </div>
      {:else}
        <ul class="notifications-list">
          {#each $notifications as item (item.id)}
            <li>
              <button
                type="button"
                class="notification-card"
                on:click={() => goTo(item.href)}
                aria-label={`Open ${item.kind === 'dm' ? 'direct message' : 'channel'} ${item.title}`}
              >
                <div
                  class={`notification-card__icon ${item.kind === 'dm' ? 'notification-card__icon--dm' : 'notification-card__icon--channel'}`}
                >
                  {#if item.photoURL}
                    <img src={item.photoURL} alt="" loading="lazy" />
                  {:else if item.kind === 'dm'}
                    <i class="bx bx-message-dots" aria-hidden="true"></i>
                  {:else}
                    <i class="bx bx-hash" aria-hidden="true"></i>
                  {/if}
                </div>

                <div class="notification-card__body">
                  <div class="notification-card__title-row">
                    <span class="notification-card__title">{item.title}</span>
                    {#if item.isMention}
                      <span class="notification-card__pill">Mention</span>
                    {/if}
                    <span class="notification-card__count">{formatCount(item.unread)}</span>
                  </div>
                  <div class="notification-card__meta">
                    <span class="notification-card__context">
                      {item.kind === 'dm' ? 'Direct message' : item.context}
                    </span>
                    {#if item.lastActivity}
                      <span class="notification-card__time">{formatRelativeTime(item.lastActivity)}</span>
                    {/if}
                  </div>
                  {#if item.preview}
                    <p class="notification-card__preview" title={item.preview}>
                      {item.preview}
                    </p>
                  {/if}
                </div>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </main>
  </div>
</div>

<style>
  .notifications-header {
    padding: 1.5rem clamp(1rem, 2vw + 0.5rem, 2.5rem);
    border-bottom: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel-muted) 82%, transparent);
  }

  .notifications-header__main {
    display: grid;
    gap: 0.4rem;
  }

  .notifications-header__main h1 {
    font-size: clamp(1.4rem, 2vw + 1rem, 1.8rem);
    font-weight: 600;
  }

  .notifications-main {
    flex: 1;
    overflow-y: auto;
    padding: clamp(1rem, 2vw + 0.75rem, 2rem);
  }

  .notifications-placeholder,
  .notifications-empty {
    min-height: calc(100% - 2rem);
    display: grid;
    place-items: center;
    text-align: center;
    gap: 0.65rem;
    color: var(--text-70);
  }

  .notifications-empty h2 {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-90);
  }

  .notifications-empty p {
    max-width: 32rem;
    margin: 0 auto;
    color: var(--text-60);
    line-height: 1.5;
  }

  .notifications-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.85rem;
  }

  .notification-card {
    width: 100%;
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-panel) 86%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.85rem;
    padding: 0.9rem 1.1rem;
    text-align: left;
    align-items: center;
    transition: transform 160ms ease, border 160ms ease, background 160ms ease, box-shadow 160ms ease;
  }

  .notification-card:hover {
    transform: translateY(-1px);
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    box-shadow: 0 18px 34px rgba(20, 48, 68, 0.3);
  }

  .notification-card__icon {
    width: 3rem;
    height: 3rem;
    border-radius: var(--radius-pill);
    display: grid;
    place-items: center;
    font-size: 1.3rem;
    color: var(--color-text-primary);
    overflow: hidden;
  }

  .notification-card__icon--channel {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-accent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 28%, transparent);
  }

  .notification-card__icon--dm {
    background: color-mix(in srgb, var(--color-alert, #f87171) 18%, transparent);
    color: var(--color-alert, #f87171);
    border: 1px solid color-mix(in srgb, var(--color-alert, #f87171) 35%, transparent);
  }

  .notification-card__icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .notification-card__body {
    display: grid;
    gap: 0.45rem;
    min-width: 0;
  }

  .notification-card__title-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .notification-card__title {
    font-weight: 600;
    font-size: 1rem;
    color: var(--text-90);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .notification-card__pill {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 0.1rem 0.55rem;
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
    color: var(--color-accent);
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .notification-card__count {
    min-width: 2rem;
    height: 1.5rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent) 22%, transparent);
    color: var(--color-accent);
    font-size: 0.78rem;
    font-weight: 600;
    display: grid;
    place-items: center;
    padding: 0 0.5rem;
  }

  .notification-card__meta {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.78rem;
    color: var(--text-60);
    flex-wrap: wrap;
  }

  .notification-card__meta::after {
    content: '';
  }

  .notification-card__preview {
    font-size: 0.88rem;
    color: var(--text-80);
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .spinner {
    width: 1.8rem;
    height: 1.8rem;
    border-radius: 50%;
    border: 0.22rem solid color-mix(in srgb, var(--color-panel) 40%, transparent);
    border-top-color: var(--color-accent);
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 768px) {
    .notifications-header {
      padding-inline: 1.1rem;
      padding-top: 1.1rem;
      padding-bottom: 1rem;
    }

    .notifications-main {
      padding-inline: 1.1rem;
    }

    .notification-card {
      grid-template-columns: 1fr;
      gap: 0.75rem;
    }

    .notification-card__icon {
      width: 2.75rem;
      height: 2.75rem;
    }
  }
</style>
