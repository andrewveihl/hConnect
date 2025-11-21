<script lang="ts">
  import LeftPane from '$lib/components/app/LeftPane.svelte';
  import { channelUnreadCount, dmUnreadCount } from '$lib/stores/notifications';
  import {
    activityEntries,
    activityReady,
    activityUnreadCount,
    markActivityEntry,
    type ActivityEntry
  } from '$lib/stores/activityFeed';
  import type { NotificationItem } from '$lib/stores/notifications';
  import { enablePushForUser } from '$lib/notify/push';
  import { handleDeepLinkPayload, type DeepLinkPayload } from '$lib/notify/deepLink';
  import { user } from '$lib/stores/user';

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

  const describeEntry = (item: NotificationItem): string => {
    if (item.kind === 'dm') return 'Direct message';
    if (item.reason === 'mention' || item.isMention) return '@ mention';
    if (item.reason === 'thread') return 'Thread reply';
    return 'Channel update';
  };

  const describeReason = (item: NotificationItem): string => {
    const unread = item.unread ?? 0;
    if (item.kind === 'dm') {
      return unread === 1 ? 'New direct message' : `${formatCount(unread)} unread DMs`;
    }
    if (item.reason === 'mention' || item.isMention) {
      return 'You were mentioned';
    }
    if (item.reason === 'thread') {
      return 'Thread replies waiting';
    }
    if ((item.highCount ?? 0) > 0) {
      return `${formatCount(item.highCount ?? 0)} priority pings`;
    }
    if ((item.lowCount ?? 0) > 0) {
      return `${formatCount(item.lowCount ?? 0)} new messages`;
    }
    return 'Fresh activity';
  };

  type LocationDescriptor = { primary: string; secondary: string | null };

  const describeLocation = (entry: ActivityEntry): LocationDescriptor => {
    const { serverName, channelName, threadName, dmId } = entry.context;
    if (dmId) {
      const primary = serverName ?? 'Direct message';
      const detail =
        threadName ??
        channelName ??
        (entry.title && entry.title !== primary ? entry.title : null);
      return { primary, secondary: detail ?? null };
    }
    if (serverName && channelName) {
      const secondary = `#${channelName}${threadName ? ` > ${threadName}` : ''}`;
      return { primary: serverName, secondary };
    }
    if (serverName) {
      return { primary: serverName, secondary: threadName ? `> ${threadName}` : null };
    }
    if (channelName) {
      return {
        primary: `#${channelName}`,
        secondary: threadName ? `> ${threadName}` : null
      };
    }
    return { primary: entry.title || 'Activity', secondary: null };
  };

  const timelineTimestamp = (entry: ActivityEntry, item: NotificationItem): number | null =>
    item.lastActivity ?? entry.createdAt ?? entry.messageInfo.createdAt ?? null;

  const entryToNotification = (entry: ActivityEntry): NotificationItem => {
    const kind = entry.context.dmId
      ? 'dm'
      : entry.context.threadId
          ? 'thread'
          : 'channel';
    const priority: 'high' | 'low' =
      entry.mentionType === 'dm' || entry.mentionType === 'direct' ? 'high' : 'low';
    const contextLabel =
      entry.context.serverName && entry.context.channelName
        ? `${entry.context.serverName} / #${entry.context.channelName}`
        : entry.context.serverName ??
          (entry.context.channelName ? `#${entry.context.channelName}` : 'Activity');
    const reason = kind === 'dm' ? null : ('mention' as NotificationItem['reason']);
    return {
      id: entry.id,
      kind,
      priority,
      serverId: entry.context.serverId ?? undefined,
      channelId: entry.context.channelId ?? undefined,
      threadId: entry.context.threadId ?? undefined,
      title: entry.title,
      context: contextLabel,
      preview: entry.body,
      unread: entry.status.unread ? 1 : 0,
      highCount: entry.status.unread ? 1 : 0,
      lowCount: 0,
      lastActivity: entry.messageInfo.createdAt ?? entry.createdAt ?? Date.now(),
      href: entry.deepLink,
      isMention: kind !== 'dm',
      reason
    };
  };

  type FeedRecord = { entry: ActivityEntry; item: NotificationItem };

  const unreadFeed = $derived.by(
    (): FeedRecord[] =>
      $activityEntries
        .filter((entry) => entry.status.unread)
        .map((entry) => ({ entry, item: entryToNotification(entry) }))
  );

  let pendingReadIds = $state<Set<string>>(new Set<string>());
  let clearState = $state<'idle' | 'running'>('idle');
  let clearMessage: string | null = $state(null);

  const visibleFeed = $derived.by((): FeedRecord[] =>
    unreadFeed.filter(({ entry }) => !pendingReadIds.has(entry.id))
  );

  type ActivityGroup = {
    key: string;
    entries: ActivityEntry[];
    items: NotificationItem[];
    latest: FeedRecord;
    location: LocationDescriptor;
    unreadTotal: number;
    reasonSummary: string;
    count: number;
    contextLabel: string;
    kind: NotificationItem['kind'];
  };

  type ActivityGroupBuilder = {
    key: string;
    entries: ActivityEntry[];
    items: NotificationItem[];
    latest: FeedRecord;
    location: LocationDescriptor;
    unreadTotal: number;
    reasonSet: Set<string>;
    contextLabel: string;
    kind: NotificationItem['kind'];
  };

  const buildGroupKey = (entry: ActivityEntry): string => {
    if (entry.context.dmId) return `dm:${entry.context.dmId}`;
    const server = entry.context.serverId ?? entry.context.serverName ?? 'serverless';
    const channel =
      entry.context.channelId ??
      entry.context.channelName ??
      entry.context.threadId ??
      entry.id;
    return `channel:${server}:${channel}`;
  };

  const groupedFeed = $derived.by((): ActivityGroup[] => {
    const map = new Map<string, ActivityGroupBuilder>();
    for (const record of visibleFeed) {
      const key = buildGroupKey(record.entry);
      const location = describeLocation(record.entry);
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          entries: [],
          items: [],
          latest: record,
          location,
          unreadTotal: 0,
          contextLabel: record.item.context ?? location.primary,
          kind: record.item.kind,
          reasonSet: new Set()
        };
        map.set(key, group);
      }
      group.entries.push(record.entry);
      group.items.push(record.item);
      group.unreadTotal += Math.max(1, record.item.unread ?? 0);
      group.reasonSet.add(describeReason(record.item));
      if ((record.item.lastActivity ?? 0) > (group.latest.item.lastActivity ?? 0)) {
        group.latest = record;
        group.location = location;
        group.contextLabel = record.item.context ?? location.primary;
        group.kind = record.item.kind;
      }
    }

    return Array.from(map.values())
      .map((group) => {
        const reasons = Array.from(group.reasonSet).slice(0, 2);
        return {
          key: group.key,
          entries: group.entries,
          items: group.items,
          latest: group.latest,
          location: group.location,
          unreadTotal: group.unreadTotal,
          reasonSummary: reasons.join(' | ') || describeReason(group.latest.item),
          count: group.entries.length,
          contextLabel: group.contextLabel,
          kind: group.kind
        };
      })
      .sort((a, b) => {
        const aTime = a.latest.item.lastActivity ?? 0;
        const bTime = b.latest.item.lastActivity ?? 0;
        return bTime - aTime;
      });
  });

  const shouldShowBulkClear = $derived(groupedFeed.length > 3);

  const payloadFromEntry = (entry: ActivityEntry): DeepLinkPayload => ({
    activityId: entry.id,
    serverId: entry.context.serverId ?? undefined,
    channelId: entry.context.channelId ?? undefined,
    threadId: entry.context.threadId ?? undefined,
    dmId: entry.context.dmId ?? undefined,
    messageId: entry.messageInfo.messageId ?? undefined,
    origin: 'activity',
    targetUrl: entry.deepLink
  });

  const detectPermission = (): 'default' | 'denied' | 'granted' | 'unsupported' => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  };

  let pushPermission = $state<'default' | 'denied' | 'granted' | 'unsupported'>(detectPermission());
  let pushRequestState = $state<'idle' | 'loading' | 'success' | 'error'>('idle');
  let pushError: string | null = $state(null);

  const shouldShowPushPrompt = $derived(
    pushPermission !== 'unsupported' && pushPermission !== 'granted'
  );

  async function requestPushEnable() {
    if (!$user?.uid) {
      pushRequestState = 'error';
      pushError = 'Sign in to enable push notifications.';
      return;
    }
    pushRequestState = 'loading';
    pushError = null;
    const token = await enablePushForUser($user.uid, { prompt: true });
    pushPermission = detectPermission();
    if (token) {
      pushRequestState = 'success';
    } else {
      pushRequestState = 'error';
      pushError =
        pushPermission === 'denied'
          ? 'Notifications are blocked in your browser settings.'
          : 'Could not enable push notifications on this device.';
    }
  }

  function addPending(ids: string[]) {
    if (!ids.length) return;
    const next = new Set(pendingReadIds);
    ids.forEach((id) => next.add(id));
    pendingReadIds = next;
  }

  function removePending(ids: string[]) {
    if (!ids.length) return;
    const next = new Set(pendingReadIds);
    let changed = false;
    ids.forEach((id) => {
      if (next.delete(id)) changed = true;
    });
    if (changed) {
      pendingReadIds = next;
    }
  }

  async function markEntriesRead(entries: ActivityEntry[], clickedEntryId?: string) {
    const ids = entries.map((entry) => entry.id).filter(Boolean);
    if (!ids.length) return;
    addPending(ids);
    const results = await Promise.allSettled(
      ids.map((id) =>
        markActivityEntry(id, {
          unread: false,
          ...(clickedEntryId === id ? { clicked: true } : {})
        })
      )
    );
    const failedIds: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        failedIds.push(ids[index]);
      }
    });
    if (failedIds.length) {
      removePending(failedIds);
      console.error('Failed to dismiss activity entries', failedIds);
    }
  }

  function openActivityGroup(group: ActivityGroup) {
    const targetEntry = group.latest.entry;
    void markEntriesRead(group.entries, targetEntry.id);
    void handleDeepLinkPayload(payloadFromEntry(targetEntry));
  }

  function clearGroup(group: ActivityGroup) {
    void markEntriesRead(group.entries);
  }

  function handleCardKey(event: KeyboardEvent, callback: () => void) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      callback();
    }
  }

  async function clearActivityFeed() {
    if (!unreadFeed.length || clearState === 'running') return;
    clearState = 'running';
    clearMessage = null;
    const ids = unreadFeed.map(({ entry }) => entry.id);
    addPending(ids);
    const results = await Promise.allSettled(
      ids.map((id) => markActivityEntry(id, { unread: false }))
    );
    const failedIds: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        failedIds.push(ids[index]);
      }
    });
    if (failedIds.length) {
      removePending(failedIds);
      clearMessage = 'Some alerts could not be cleared. Try again.';
    }
    clearState = 'idle';
  }
</script>

<div class="flex h-dvh app-bg text-primary overflow-hidden mobile-full-bleed">
  <div class="hidden md:flex md:shrink-0">
    <LeftPane activeServerId={null} />
  </div>

  <div class="activity-surface">
    <header class="activity-header">
      <div class="activity-header__text">
        <p class="activity-eyebrow">Inbox</p>
        <h1>Activity</h1>
        <p class="activity-description">
          {#if $activityUnreadCount === 0}
            You're caught up on mentions and DMs.
          {:else}
            {formatCount($activityUnreadCount)} unread waiting for you.
          {/if}
        </p>
        <div class="activity-header__stats" role="status">
          <span>{formatCount($channelUnreadCount)} channels</span>
          <span>{formatCount($dmUnreadCount)} DMs</span>
        </div>
      </div>
      {#if shouldShowPushPrompt}
        <div class="activity-header__actions">
          <button
            type="button"
            class="enable-push-btn"
            onclick={requestPushEnable}
            aria-busy={pushRequestState === 'loading'}
          >
            {pushRequestState === 'loading' ? 'Enabling...' : 'Enable push'}
          </button>
          {#if pushError}
            <p class="push-inline-error" role="status">{pushError}</p>
          {/if}
        </div>
      {/if}
    </header>

    <main class="activity-main">
      {#if !$activityReady}
        <div class="activity-placeholder">
          <div class="spinner" aria-hidden="true"></div>
          <p>Syncing your servers&hellip;</p>
        </div>
      {:else if !groupedFeed.length}
        <div class="activity-empty">
          <i class="bx bx-inbox"></i>
          <h2>Nothing needs your attention</h2>
          <p>Mentions, reactions, and DMs will show up here the moment they ship.</p>
          <div class="activity-empty__actions">
            <a class="btn btn-primary" href="/dms">Jump to DMs</a>
            <a class="btn btn-secondary" href="/servers">Browse servers</a>
          </div>
        </div>
      {:else}
        {#if clearMessage}
          <p class="activity-error">{clearMessage}</p>
        {/if}
        {#if shouldShowBulkClear}
          <div class="bulk-clear">
            <button
              type="button"
              class="clear-feed-btn"
              onclick={clearActivityFeed}
              disabled={clearState === 'running'}
              aria-busy={clearState === 'running'}
            >
              {clearState === 'running' ? 'Clearing...' : 'Clear all'}
            </button>
          </div>
        {/if}
        <ul class="activity-feed" aria-live="polite">
          {#each groupedFeed as group (group.key)}
            {@const { entry, item } = group.latest}
            {@const timestamp = timelineTimestamp(entry, item)}
            {@const location = group.location}
            <li>
              <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
              <article
                class={`activity-item activity-item--${group.kind}`}
                role="button"
                tabindex="0"
                onclick={() => openActivityGroup(group)}
                onkeydown={(event) => handleCardKey(event, () => openActivityGroup(group))}
              >
                <div class="activity-item__icon" aria-hidden="true">
                  {#if group.kind === 'dm'}
                    <span>DM</span>
                  {:else if group.kind === 'thread'}
                    <span>@</span>
                  {:else}
                    <span>#</span>
                  {/if}
                </div>
                <div class="activity-item__body">
                  <div class="activity-item__header">
                    <div class="activity-item__origin">
                      <span class="activity-item__badge">{describeEntry(item)}</span>
                      <div class="activity-item__location">
                        <strong>{location.primary}</strong>
                        {#if location.secondary}
                          <span>{location.secondary}</span>
                        {/if}
                      </div>
                      {#if group.count > 1}
                        <span class="activity-item__bundle">{group.count} updates</span>
                      {/if}
                      <button
                        type="button"
                        class="activity-item__dismiss"
                        aria-label={`Clear ${group.count} notifications`}
                        onclick={(event) => {
                          event.stopPropagation();
                          clearGroup(group);
                        }}
                      >
                        Clear
                      </button>
                    </div>
                    <time datetime={timestamp ? new Date(timestamp).toISOString() : undefined}>
                      {formatRelativeTime(timestamp) || 'just now'}
                    </time>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.preview}</p>
                  {#if group.items.length > 1}
                    <ul class="activity-item__stack">
                      {#each group.items.slice(0, 3) as child}
                        <li>{child.title}</li>
                      {/each}
                      {#if group.items.length > 3}
                        <li>+{group.items.length - 3} more...</li>
                      {/if}
                    </ul>
                  {/if}
                  <div class="activity-item__meta">
                    <span class="activity-item__reason">{group.reasonSummary}</span>
                    <span class="activity-item__volume">
                      {group.count} {group.count === 1 ? 'notification' : 'notifications'}
                    </span>
                    <span class="activity-item__count">+{formatCount(group.unreadTotal)}</span>
                  </div>
                </div>
              </article>
            </li>
          {/each}
        </ul>
      {/if}
    </main>
  </div>
</div>

<style>
  .activity-surface {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--surface-root);
    color: var(--text-100);
    overflow: hidden;
  }

  .activity-header {
    padding: clamp(1.2rem, 4vw, 2.6rem);
    border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    display: flex;
    flex-wrap: wrap;
    gap: clamp(1rem, 3vw, 2.5rem);
    align-items: flex-start;
    background: color-mix(in srgb, var(--surface-root) 85%, transparent);
  }

  .activity-header__text h1 {
    font-size: clamp(1.7rem, 4vw, 2.4rem);
    line-height: 1.05;
    margin: 0;
  }

  .activity-eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.75rem;
    color: var(--text-60);
  }

  .activity-description {
    margin-top: 0.35rem;
    color: var(--text-70);
    font-size: 0.95rem;
  }

  .activity-header__stats {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 0.8rem;
    font-size: 0.85rem;
    color: var(--text-70);
  }

  .activity-header__stats span {
    padding: 0.25rem 0.9rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-panel-muted) 60%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
  }

  .activity-header__actions {
    margin-left: auto;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: flex-end;
  }

  .clear-feed-btn {
    border-radius: 999px;
    padding: 0.55rem 1.3rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    background: color-mix(in srgb, var(--surface-panel) 75%, transparent);
    font-weight: 600;
    color: var(--text-100);
    transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
  }

  .clear-feed-btn:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
    color: var(--color-accent);
  }

  .clear-feed-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .enable-push-btn {
    border-radius: 999px;
    padding: 0.55rem 1.3rem;
    border: 1px solid color-mix(in srgb, var(--color-accent) 55%, transparent);
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    font-weight: 600;
    color: var(--color-accent);
    transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
  }

  .enable-push-btn:hover {
    border-color: color-mix(in srgb, var(--color-accent) 70%, transparent);
    background: color-mix(in srgb, var(--color-accent) 26%, transparent);
    color: var(--text-100);
  }

  .push-inline-error {
    font-size: 0.85rem;
    color: var(--color-danger, #ff6b6b);
    text-align: right;
  }

  .activity-main {
    flex: 1;
    overflow-y: auto;
    padding: clamp(1.2rem, 4vw, 2.4rem);
    display: flex;
    flex-direction: column;
    gap: clamp(1rem, 3vw, 1.6rem);
  }

  .activity-placeholder,
  .activity-empty {
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

  .activity-feed {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .bulk-clear {
    display: flex;
    justify-content: flex-end;
  }

  .bulk-clear .clear-feed-btn {
    background: color-mix(in srgb, var(--color-panel) 80%, transparent);
  }

  .activity-item {
    width: 100%;
    border-radius: 1rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
    background: color-mix(in srgb, var(--surface-root) 92%, transparent);
    padding: 0.95rem 1.1rem;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.85rem;
    text-align: left;
    color: inherit;
    transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
    cursor: pointer;
  }

  .activity-item:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
    background: color-mix(in srgb, var(--surface-panel) 84%, transparent);
  }

  .activity-item:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--color-accent) 60%, transparent);
    outline-offset: 3px;
  }

  .activity-item__icon {
    width: 2.8rem;
    height: 2.8rem;
    border-radius: 0.9rem;
    background: color-mix(in srgb, var(--color-panel) 75%, transparent);
    display: grid;
    place-items: center;
    font-weight: 600;
    color: var(--text-80);
    font-size: 0.78rem;
    text-transform: uppercase;
  }

  .activity-item--dm .activity-item__icon {
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    color: var(--color-accent);
  }

  .activity-item--thread .activity-item__icon {
    background: color-mix(in srgb, var(--color-highlight, #7cf) 25%, transparent);
    color: color-mix(in srgb, var(--color-highlight, #7cf) 60%, var(--text-100));
  }

  .activity-item--channel .activity-item__icon {
    background: color-mix(in srgb, var(--color-panel-muted) 55%, transparent);
    color: var(--text-80);
  }

  .activity-item__body {
    display: grid;
    gap: 0.45rem;
  }

  .activity-item__header {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .activity-item__origin {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }

  .activity-item__badge {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-panel-muted) 60%, transparent);
    color: var(--text-70);
  }

  .activity-item__bundle {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    color: var(--color-accent);
  }

  .activity-item__dismiss {
    margin-left: auto;
    border: none;
    background: transparent;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-60);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    cursor: pointer;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    transition: color 120ms ease, background 120ms ease;
  }

  .activity-item__dismiss:hover,
  .activity-item__dismiss:focus-visible {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    outline: none;
  }

  .activity-item__location {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .activity-item__location strong {
    font-size: 0.92rem;
    color: var(--text-90);
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }

  .activity-item__location span {
    font-size: 0.8rem;
    color: var(--text-60);
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }

  .activity-item__header time {
    font-size: 0.82rem;
    color: var(--text-60);
  }

  .activity-item__body h3 {
    margin: 0;
    font-size: 1rem;
    line-height: 1.2;
  }

  .activity-item__body p {
    margin: 0;
    color: var(--text-80);
    line-height: 1.35;
  }

  .activity-item__stack {
    margin: 0.2rem 0 0;
    padding-left: 1.1rem;
    color: var(--text-70);
    font-size: 0.82rem;
    list-style: disc;
  }

  .activity-item__stack li {
    margin-left: 0.4rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .activity-item__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    font-size: 0.8rem;
    color: var(--text-60);
    align-items: center;
  }

  .activity-item__reason {
    color: var(--text-60);
  }

  .activity-item__volume {
    color: var(--text-70);
    font-weight: 500;
  }

  .activity-item__count {
    margin-left: auto;
    font-weight: 600;
    color: var(--color-accent);
  }

  .activity-error {
    color: var(--color-danger, #ff6b6b);
    font-size: 0.9rem;
  }

  .spinner {
    width: 1.6rem;
    height: 1.6rem;
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
    .activity-header {
      flex-direction: column;
    }

    .activity-header__actions {
      width: 100%;
      align-items: flex-start;
    }

    .push-inline-error {
      text-align: left;
    }
  }

  @media (max-width: 768px) {
    .activity-header {
      display: none;
    }

    .activity-main {
      padding: 1.2rem;
    }

    .bulk-clear {
      justify-content: flex-start;
    }
  }

  @media (max-width: 520px) {
    .activity-item {
      grid-template-columns: auto 1fr;
      padding: 0.85rem 0.95rem;
    }

    .activity-item__icon {
      width: 2.3rem;
      height: 2.3rem;
    }

    .activity-item__header {
      flex-direction: column;
    }
  }
</style>
