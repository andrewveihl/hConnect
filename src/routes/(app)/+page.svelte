<script lang="ts">
  import LeftPane from '$lib/components/app/LeftPane.svelte';
  import {
    notifications,
    notificationsReady,
    notificationCount,
    channelUnreadCount,
    dmUnreadCount
  } from '$lib/stores/notifications';
  import type { NotificationItem } from '$lib/stores/notifications';
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
    goto(href, { keepFocus: true, noScroll: true });
  };

  type SmartBucket = 'signal' | 'priority' | 'ambient';

  type SmartNotification = NotificationItem & {
    score: number;
    bucket: SmartBucket;
    aiReason: string;
  };

  type FeedFilter = 'all' | 'signals' | 'mentions' | 'dms';

  const filterOptions: { id: FeedFilter; label: string; description: string }[] = [
    { id: 'all', label: 'Everything', description: 'Chronological view' },
    { id: 'signals', label: 'Important', description: 'AI ranked' },
    { id: 'mentions', label: 'Mentions', description: 'Anyone @ you' },
    { id: 'dms', label: 'DMs', description: 'Direct conversations' }
  ];

  let activeFilter = $state<FeedFilter>('all');

  const computeRecencyBoost = (timestamp: number | null): number => {
    if (!timestamp) return 0;
    const minutes = Math.max(0, (Date.now() - timestamp) / 60000);
    if (minutes >= 240) return 0;
    if (minutes <= 2) return 20;
    return Math.max(0, 20 - minutes * 0.08);
  };

  const computeAiScore = (item: NotificationItem): number => {
    let score = item.priority === 'high' ? 55 : 28;
    const unread = item.unread ?? 0;
    const highCount = item.highCount ?? 0;
    const lowCount = item.lowCount ?? 0;

    if (item.kind === 'dm') score += 28;
    if (item.kind === 'thread') score += 12;
    if (item.reason === 'mention' || item.isMention) score += 20;
    if (item.reason === 'thread') score += 8;

    score += Math.min(15, Math.log2(unread + 1) * 6);
    score += Math.min(12, highCount * 4);
    if (lowCount > 0) {
      score += Math.min(10, Math.log(lowCount + 1) * 5);
    }

    score += computeRecencyBoost(item.lastActivity ?? null);
    return Math.max(0, Math.min(100, Math.round(score)));
  };

  const describeAiReason = (item: NotificationItem): string => {
    const unread = item.unread ?? 0;
    if (item.kind === 'dm') {
      return unread === 1 ? 'New DM' : `${formatCount(unread)} DMs`;
    }
    if (item.reason === 'mention' || item.isMention) {
      return 'Mention';
    }
    if (item.reason === 'thread') {
      return 'Thread replies';
    }
    if ((item.highCount ?? 0) > 0) {
      return `${formatCount(item.highCount ?? 0)} priority`;
    }
    if ((item.lowCount ?? 0) > 0) {
      return `${formatCount(item.lowCount ?? 0)} new msgs`;
    }
    return 'Fresh activity';
  };

  const decorateNotification = (item: NotificationItem): SmartNotification => {
    const score = computeAiScore(item);
    const bucket: SmartBucket = score >= 75 ? 'signal' : score >= 45 ? 'priority' : 'ambient';
    return {
      ...item,
      score,
      bucket,
      aiReason: describeAiReason(item)
    };
  };

  const smartFeed = $derived.by((): SmartNotification[] =>
    $notifications.map(decorateNotification)
  );

  const sortByRecency = (a: SmartNotification, b: SmartNotification) => {
    const aTime = a.lastActivity ?? 0;
    const bTime = b.lastActivity ?? 0;
    if (aTime === bTime) {
      if (a.score === b.score) return a.title.localeCompare(b.title);
      return b.score - a.score;
    }
    return bTime - aTime;
  };

  const smartHighlights = $derived.by((): SmartNotification[] => {
    const highlightPool = smartFeed.filter((item) => item.bucket !== 'ambient');
    highlightPool.sort((a, b) => {
      if (a.score === b.score) return sortByRecency(a, b);
      return b.score - a.score;
    });
    return highlightPool.slice(0, 4);
  });

  const filterMatchers: Record<FeedFilter, (item: SmartNotification) => boolean> = {
    all: () => true,
    signals: (item) => item.bucket === 'signal',
    mentions: (item) => item.reason === 'mention' || item.reason === 'thread',
    dms: (item) => item.kind === 'dm'
  };

  const bucketCopy: Record<SmartBucket, string> = {
    signal: 'Important',
    priority: 'Keep up',
    ambient: 'Background'
  };

  const filteredFeed = $derived.by((): SmartNotification[] => {
    const pool = smartFeed.filter((item) => filterMatchers[activeFilter](item));
    pool.sort((a, b) =>
      activeFilter === 'signals'
        ? b.score - a.score || sortByRecency(a, b)
        : sortByRecency(a, b)
    );
    return pool;
  });
</script>

<div class="flex h-dvh app-bg text-primary overflow-hidden mobile-full-bleed">
  <div class="hidden md:flex md:shrink-0">
    <LeftPane activeServerId={null} />
  </div>

  <div class="activity-surface">
    <header class="activity-hero">
      <div class="activity-hero__heading">
        <p class="activity-hero__eyebrow">Smart signals</p>
        <h1>Activity</h1>
        <div class="activity-hero__metrics">
          {#if $notificationCount === 0}
            <span>You're all caught up.</span>
          {:else}
            <span>{formatCount($notificationCount)} alerts</span>
            <span>{formatCount($channelUnreadCount)} channels</span>
            <span>{formatCount($dmUnreadCount)} DMs</span>
          {/if}
        </div>
      </div>
    </header>

    <main class="activity-main">
      {#if !$notificationsReady}
        <div class="activity-placeholder">
          <div class="spinner"></div>
          <p>Syncing your servers&hellip;</p>
        </div>
      {:else if !smartFeed.length}
        <div class="activity-empty">
          <i class="bx bx-party"></i>
          <h2>Nothing demanding attention</h2>
          <p>We’ll pin fresh messages here the moment they land.</p>
          <div class="activity-empty__actions">
            <a class="btn btn-primary" href="/dms">Jump to DMs</a>
            <a class="btn btn-secondary" href="/servers">Browse servers</a>
          </div>
        </div>
      {:else}
        <section class="smart-section">
          <div class="smart-section__header">
            <div>
              <p class="smart-section__eyebrow">AI highlights</p>
              <h2>Signals</h2>
            </div>
            <span class="smart-section__badge">Live</span>
          </div>

          {#if smartHighlights.length}
            <div class="smart-grid">
              {#each smartHighlights as item (item.id)}
                <button
                  type="button"
                  class={`smart-card smart-card--${item.bucket}`}
                  onclick={() => goTo(item.href)}
                >
                  <div class="smart-card__badge">
                    {bucketCopy[item.bucket]} &middot; {item.score}%
                  </div>
                  <div class="smart-card__title">
                    <span>{item.context ?? 'Activity'}</span>
                    <h3>{item.title}</h3>
                  </div>
                  <p class="smart-card__preview">{item.preview}</p>
                  <div class="smart-card__meta">
                    <span>{item.aiReason}</span>
                    <span>{formatRelativeTime(item.lastActivity ?? null) || 'moments ago'}</span>
                  </div>
                </button>
              {/each}
            </div>
          {:else}
            <div class="smart-section__empty">
              <i class="bx bx-bot"></i>
              <p>No AI signals right now.</p>
            </div>
          {/if}
        </section>

        <section class="feed-section">
          <div class="feed-section__header">
            <div>
              <p class="feed-section__eyebrow">Live feed</p>
              <h2>All activity</h2>
            </div>
            <div class="feed-filters" role="tablist" aria-label="Activity filters">
              {#each filterOptions as option}
                <button
                  type="button"
                  class={`feed-filter ${activeFilter === option.id ? 'is-active' : ''}`}
                  role="tab"
                  aria-selected={activeFilter === option.id}
                  onclick={() => (activeFilter = option.id)}
                >
                  <span>{option.label}</span>
                </button>
              {/each}
            </div>
          </div>

          {#if filteredFeed.length}
            <ul class="feed-list">
              {#each filteredFeed as item (item.id)}
                <li>
                  <button
                    type="button"
                    class={`feed-card feed-card--${item.bucket}`}
                    onclick={() => goTo(item.href)}
                    aria-label={`Open ${item.title}`}
                  >
                    <div class="feed-card__avatar">
                      {#if item.photoURL}
                        <img src={item.photoURL} alt="" loading="lazy" />
                      {:else if item.kind === 'dm'}
                        <span class="feed-card__avatar-initial">DM</span>
                      {:else}
                        <span class="feed-card__avatar-initial">#</span>
                      {/if}
                    </div>
                    <div class="feed-card__body">
                      <div class="feed-card__top">
                        <div class="feed-card__title-group">
                          <span class="feed-card__context">{item.context ?? 'Activity'}</span>
                          <h3>{item.title}</h3>
                        </div>
                        <span class="feed-card__time">
                          {formatRelativeTime(item.lastActivity ?? null) || 'moments ago'}
                        </span>
                      </div>
                      <p class="feed-card__preview">{item.preview}</p>
                      <div class="feed-card__meta">
                        <span class="feed-card__badge">{bucketCopy[item.bucket]}</span>
                        <span class="feed-card__reason">{item.aiReason}</span>
                        <span class="feed-card__count">+{formatCount(item.unread)}</span>
                      </div>
                    </div>
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <div class="feed-empty">
              <i class="bx bx-coffee"></i>
              <p>Nothing here yet.</p>
            </div>
          {/if}
        </section>
      {/if}
    </main>
  </div>
</div>

<style>
  .activity-surface {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface-root);
    color: var(--text-100);
  }

  .activity-hero {
    display: flex;
    justify-content: space-between;
    gap: clamp(1rem, 2vw, 2rem);
    padding-inline: clamp(1rem, 4vw, 2.4rem);
    padding-top: calc(env(safe-area-inset-top) + clamp(1rem, 3vw, 1.9rem));
    padding-bottom: clamp(1rem, 3vw, 1.6rem);
    border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    background: color-mix(in srgb, var(--surface-root) 70%, var(--color-panel));
    box-shadow: 0 18px 38px rgba(6, 10, 18, 0.32);
  }

  .activity-hero__heading {
    display: grid;
    gap: 0.4rem;
    max-width: 640px;
  }

  .activity-hero__heading h1 {
    font-size: clamp(1.6rem, 4vw, 2.3rem);
    line-height: 1.05;
    font-weight: 600;
  }

  .activity-hero__eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 0.75rem;
    color: var(--text-60);
  }

  .activity-hero__metrics {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 0.4rem;
    font-size: 0.9rem;
    color: var(--text-70);
  }

  .activity-hero__metrics span {
    padding: 0.25rem 0.9rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-panel-muted) 60%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
  }

  .activity-main {
    flex: 1;
    overflow-y: auto;
    --activity-pad-inline: clamp(1rem, 4vw, 2.2rem);
    --activity-pad-top: clamp(1rem, 4vw, 2.2rem);
    --activity-pad-bottom: clamp(2rem, 5vw, 2.6rem);
    padding-top: var(--activity-pad-top);
    padding-inline: var(--activity-pad-inline);
    padding-bottom: calc(
      var(--activity-pad-bottom) + var(--mobile-dock-height, 0px) + env(safe-area-inset-bottom, 0px)
    );
    display: flex;
    flex-direction: column;
    gap: clamp(1.2rem, 2vw, 2rem);
  }

  .activity-placeholder,
  .activity-empty,
  .feed-empty {
    align-self: center;
    text-align: center;
    display: grid;
    place-items: center;
    gap: 1rem;
    color: var(--text-70);
    padding: 3rem 1.5rem;
  }

  .activity-empty__actions {
    display: flex;
    gap: 0.8rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .smart-section,
  .feed-section {
    background: color-mix(in srgb, var(--color-panel) 85%, transparent);
    border-radius: 1.5rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
    padding: clamp(1.2rem, 3vw, 1.9rem);
    box-shadow: 0 20px 40px rgba(6, 10, 18, 0.28);
  }

  .smart-section__header,
  .feed-section__header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .smart-section__eyebrow,
  .feed-section__eyebrow {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--text-60);
  }

  .smart-section__badge {
    align-self: flex-start;
    padding: 0.35rem 0.8rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-accent) 60%, transparent);
    color: var(--color-accent);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
  }

  .smart-grid {
    margin-top: 1.3rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
  }

  .smart-card {
    border-radius: 1.1rem;
    padding: 1.1rem 1.2rem;
    text-align: left;
    display: grid;
    gap: 0.65rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
    background: linear-gradient(
      145deg,
      color-mix(in srgb, var(--surface-root) 90%, transparent),
      color-mix(in srgb, var(--color-panel) 80%, transparent)
    );
    transition: transform 150ms ease, border-color 150ms ease;
  }

  .smart-card:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
  }

  .smart-card__badge {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-60);
  }

  .smart-card__title span {
    font-size: 0.78rem;
    color: var(--text-60);
  }

  .smart-card__title h3 {
    font-size: 1.1rem;
    margin-top: 0.15rem;
  }

  .smart-card__preview {
    color: var(--text-80);
    line-height: 1.4;
    max-height: 3.2rem;
    overflow: hidden;
  }

  .smart-card__meta {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: var(--text-60);
    gap: 0.6rem;
  }

  .smart-card--signal {
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
    background: linear-gradient(
      145deg,
      color-mix(in srgb, var(--color-accent) 14%, transparent),
      color-mix(in srgb, var(--surface-root) 92%, transparent)
    );
  }

  .smart-card--priority {
    border-color: color-mix(in srgb, var(--color-highlight, #4f7) 30%, transparent);
  }

  .smart-card--ambient {
    opacity: 0.9;
  }

  .smart-section__empty,
  .feed-empty {
    border-radius: 1rem;
    padding: 1.2rem;
    background: color-mix(in srgb, var(--surface-root) 80%, transparent);
    border: 1px dashed color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
  }

  .feed-filters {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .feed-filter {
    border-radius: 0.9rem;
    padding: 0.55rem 0.9rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    background: color-mix(in srgb, var(--surface-root) 80%, transparent);
    min-width: 120px;
    text-align: left;
    transition: border-color 120ms ease, background 120ms ease;
  }

  .feed-filter span {
    display: block;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .feed-filter.is-active {
    border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }

  .feed-list {
    list-style: none;
    margin: 1.5rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .feed-card {
    width: 100%;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    border-radius: 1.2rem;
    padding: 0.95rem 1.15rem;
    display: flex;
    gap: 0.9rem;
    background: color-mix(in srgb, var(--surface-root) 88%, transparent);
    text-align: left;
    transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
  }

  .feed-card:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
    background: color-mix(in srgb, var(--color-panel) 80%, transparent);
  }

  .feed-card__avatar {
    width: 3rem;
    height: 3rem;
    border-radius: 0.95rem;
    overflow: hidden;
    background: color-mix(in srgb, var(--color-panel) 70%, transparent);
    display: grid;
    place-items: center;
    font-weight: 600;
    color: var(--text-80);
    flex-shrink: 0;
  }

  .feed-card__avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .feed-card__avatar-initial {
    font-size: 0.8rem;
    letter-spacing: 0.08em;
  }

  .feed-card__body {
    flex: 1;
    display: grid;
    gap: 0.45rem;
  }

  .feed-card__top {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  .feed-card__title-group span {
    font-size: 0.78rem;
    color: var(--text-60);
  }

  .feed-card__title-group h3 {
    font-size: 1rem;
    margin-top: 0.1rem;
  }

  .feed-card__time {
    font-size: 0.82rem;
    color: var(--text-60);
  }

  .feed-card__preview {
    color: var(--text-80);
    line-height: 1.35;
  }

  .feed-card__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    font-size: 0.8rem;
    color: var(--text-60);
  }

  .feed-card__badge {
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-weight: 600;
  }

  .feed-card__reason {
    color: var(--text-60);
  }

  .feed-card__count {
    margin-left: auto;
    font-weight: 600;
    color: var(--color-accent);
  }

  .feed-card--signal {
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
  }

  .feed-card--priority {
    border-color: color-mix(in srgb, var(--color-highlight, #4f7) 30%, transparent);
  }

  .spinner {
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 999px;
    border: 0.2rem solid color-mix(in srgb, var(--color-panel) 40%, transparent);
    border-top-color: var(--color-accent);
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 1024px) {
    .activity-hero {
      flex-direction: column;
    }

    .activity-hero__chips {
      width: 100%;
    }

    .smart-grid {
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    }
  }

  @media (max-width: 768px) {
    .activity-main {
      --activity-pad-inline: 1.2rem;
      --activity-pad-top: 1.2rem;
      --activity-pad-bottom: 1.6rem;
    }

    .smart-section,
    .feed-section {
      border-radius: 1rem;
    }

    .feed-filters {
      width: 100%;
    }

    .feed-card {
      flex-direction: column;
    }

    .feed-card__avatar {
      width: 2.5rem;
      height: 2.5rem;
    }
  }

  @media (max-width: 520px) {
    .activity-main {
      --activity-pad-inline: 1rem;
      --activity-pad-top: 1rem;
      --activity-pad-bottom: 1.4rem;
    }

    .feed-filter {
      flex: 1 1 calc(50% - 0.5rem);
    }

    .activity-empty__actions {
      flex-direction: column;
    }
  }
</style>


