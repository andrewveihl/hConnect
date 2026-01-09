<script lang="ts">
	import { onMount } from 'svelte';
	import { channelUnreadCount, dmUnreadCount } from '$lib/stores/notifications';
	import {
		activityEntries,
		activityReady,
		activityUnreadCount,
		markActivityEntry,
		type ActivityEntry
	} from '$lib/stores/activityFeed';
	import type { NotificationItem } from '$lib/stores/notifications';
	import { enablePushForUser, isIOSPushSupported, getPushSupportMessage } from '$lib/notify/push';
	import { handleDeepLinkPayload, type DeepLinkPayload } from '$lib/notify/deepLink';
	import { user } from '$lib/stores/user';
	import { mobileDockSuppressed } from '$lib/stores/ui';

	// Reset mobile dock suppression when entering Activity page
	// This ensures the dock is visible even if a previous page left it suppressed
	onMount(() => {
		mobileDockSuppressed.reset();
	});

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
				threadName ?? channelName ?? (entry.title && entry.title !== primary ? entry.title : null);
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
		const kind = entry.context.dmId ? 'dm' : entry.context.threadId ? 'thread' : 'channel';
		const priority: 'high' | 'low' =
			entry.mentionType === 'dm' || entry.mentionType === 'direct' ? 'high' : 'low';
		const contextLabel =
			entry.context.serverName && entry.context.channelName
				? `${entry.context.serverName} / #${entry.context.channelName}`
				: (entry.context.serverName ??
					(entry.context.channelName ? `#${entry.context.channelName}` : 'Activity'));
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

	const unreadFeed = $derived.by((): FeedRecord[] =>
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
			entry.context.channelId ?? entry.context.channelName ?? entry.context.threadId ?? entry.id;
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
		
		// Check if iOS push is supported - show helpful message if not
		if (!isIOSPushSupported()) {
			const supportInfo = getPushSupportMessage();
			pushRequestState = 'error';
			pushError = supportInfo.message;
			return;
		}
		
		pushRequestState = 'loading';
		pushError = null;
		
		// Track progress for debugging
		let lastStep = 'starting';
		const debugLog: string[] = [];
		const debug = (event: { step: string; message?: string; error?: string }) => {
			lastStep = event.step;
			debugLog.push(`${event.step}: ${event.message || event.error || 'ok'}`);
			console.info('[push-enable]', event.step, event.message || event.error || '');
		};
		
		try {
			// Add timeout to prevent hanging forever on mobile
			const timeoutPromise = new Promise<null>((resolve) => {
				setTimeout(() => {
					console.warn('[push-enable] Timeout reached at step:', lastStep);
					resolve(null);
				}, 20000);
			});
			const enablePromise = enablePushForUser($user.uid, { prompt: true, debug });
			const token = await Promise.race([enablePromise, timeoutPromise]);
			
			pushPermission = detectPermission();
			if (token) {
				pushRequestState = 'success';
				console.info('[push-enable] Success! Token received');
			} else {
				pushRequestState = 'error';
				console.warn('[push-enable] Failed at step:', lastStep, 'Debug log:', debugLog);
				if (pushPermission === 'denied') {
					pushError = 'Notifications are blocked in your browser settings.';
				} else if (lastStep.includes('fail.permission_denied')) {
					pushError = 'Notifications blocked. Go to Settings → Safari → Advanced → Website Data, delete this site, then re-add to Home Screen.';
				} else if (lastStep.includes('fail.permission_not_granted')) {
					pushError = 'You must tap Allow when prompted. Close app completely and try again.';
				} else if (lastStep.includes('fail.prompt_skipped')) {
					pushError = 'Not detected as iOS PWA. Delete app, clear Safari data, re-add to Home Screen.';
				} else if (lastStep.includes('fail.sw_missing')) {
					pushError = 'Service worker failed. Close app completely, wait 10 seconds, then reopen.';
				} else if (lastStep.includes('permission.request')) {
					pushError = 'Permission prompt failed. Close this app completely, then reopen and try again.';
				} else if (lastStep.includes('safari.subscription')) {
					pushError = 'Safari push subscription failed. Try closing and reopening the app.';
				} else if (lastStep.includes('sw.register')) {
					pushError = 'Service worker registration failed. Try refreshing.';
				} else if (lastStep.includes('timeout') || lastStep === 'starting') {
					pushError = 'Request timed out. Check your internet connection and try again.';
				} else if (lastStep.includes('device.persist')) {
					pushError = 'Push setup incomplete. Try closing the app completely and reopening.';
				} else {
					pushError = `Push setup failed (${lastStep}). Try refreshing.`;
				}
			}
		} catch (err) {
			console.error('[push-enable] Exception:', err, 'Last step:', lastStep);
			pushRequestState = 'error';
			pushError = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
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

<div class="activity-shell">
	<div class="activity-surface" role="main">
		<header class="activity-header">
			<div class="activity-header__copy">
				<span class="activity-eyebrow">Inbox</span>
				<div class="activity-title-row">
					<h1>Activity</h1>
					{#if $activityUnreadCount}
						<span class="activity-chip">{formatCount($activityUnreadCount)} new</span>
					{/if}
				</div>
				<p class="activity-description">
					Mentions, replies, and direct messages across your servers.
				</p>
				<div class="activity-header__stats" aria-label="Unread counts">
					<span>Activity {formatCount($activityUnreadCount)}</span>
					<span>Channels {formatCount($channelUnreadCount)}</span>
					<span>DMs {formatCount($dmUnreadCount)}</span>
				</div>
			</div>
			<div class="activity-header__actions">
				{#if groupedFeed.length}
					<button
						type="button"
						class="clear-feed-btn"
						disabled={clearState === 'running'}
						onclick={clearActivityFeed}
					>
						{clearState === 'running'
							? 'Clearing...'
							: shouldShowBulkClear
								? 'Mark everything read'
								: 'Mark all read'}
					</button>
				{/if}

				{#if shouldShowPushPrompt}
					<button
						type="button"
						class="enable-push-btn"
						disabled={pushRequestState === 'loading'}
						onclick={requestPushEnable}
					>
						{pushRequestState === 'loading'
							? 'Enabling...'
							: pushRequestState === 'success'
								? 'Push ready'
								: 'Enable push alerts'}
					</button>
					{#if pushError}
						<p class="push-inline-error">{pushError}</p>
					{:else if pushRequestState === 'success'}
						<p class="push-inline-success">Notifications will be delivered on this device.</p>
					{/if}
				{:else if pushRequestState === 'success'}
					<p class="push-inline-success">Push alerts are enabled on this browser.</p>
				{/if}
			</div>
		</header>

		<main class="activity-main" aria-busy={!$activityReady}>
			<div class="activity-mobile-hero">
				<div class="activity-mobile-hero__copy">
					<span class="activity-eyebrow">Inbox</span>
					<div class="activity-title-row">
						<h2>Activity</h2>
						{#if $activityUnreadCount}
							<span class="activity-chip">{formatCount($activityUnreadCount)} new</span>
						{/if}
					</div>
					<p class="activity-description">Mentions, replies, and DMs across your org.</p>
					<div class="activity-header__stats">
						<span>Activity {formatCount($activityUnreadCount)}</span>
						<span>Channels {formatCount($channelUnreadCount)}</span>
						<span>DMs {formatCount($dmUnreadCount)}</span>
					</div>
				</div>
				{#if groupedFeed.length}
					<div class="activity-toolbar">
						<span class="activity-toolbar__label">
							{formatCount(groupedFeed.length)}
							{groupedFeed.length === 1 ? 'group' : 'groups'}
						</span>
						<button
							type="button"
							class="clear-feed-btn"
							disabled={clearState === 'running'}
							onclick={clearActivityFeed}
						>
							{clearState === 'running' ? 'Clearing...' : 'Mark all read'}
						</button>
					</div>
				{/if}
			</div>

			{#if shouldShowPushPrompt && pushRequestState !== 'success'}
				<div class="activity-banner" role="status">
					<div class="activity-banner__copy">
						<strong>Enable push alerts</strong>
						<p>Mirror desktop mentions on this device.</p>
						{#if pushError}
							<span class="push-inline-error">{pushError}</span>
						{/if}
					</div>
					<button
						type="button"
						class="enable-push-btn enable-push-btn--inline"
						disabled={pushRequestState === 'loading'}
						onclick={requestPushEnable}
					>
						{pushRequestState === 'loading' ? 'Enabling...' : 'Enable'}
					</button>
				</div>
			{:else if pushRequestState === 'success' && !shouldShowPushPrompt}
				<p class="push-inline-success push-inline-success--mobile">
					Push alerts enabled for this device.
				</p>
			{/if}

			{#if clearMessage}
				<p class="activity-error">{clearMessage}</p>
			{/if}

			{#if !$activityReady}
				<div class="activity-placeholder">
					<div class="spinner" aria-hidden="true"></div>
					<p>Syncing your servers&hellip;</p>
				</div>
			{:else}
				<ul class="activity-feed" aria-live="polite">
					{#each groupedFeed as group (group.key)}
						{@const { entry, item } = group.latest}
						{@const timestamp = timelineTimestamp(entry, item)}
						{@const location = group.location}
						<li>
							<article class={`activity-item activity-item--${group.kind}`}>
								<div class="activity-item__content">
									<button
										type="button"
										class="activity-item__hit"
										aria-label={`${group.reasonSummary} in ${location.primary}`}
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
													{group.count}
													{group.count === 1 ? 'notification' : 'notifications'}
												</span>
												<span class="activity-item__count">+{formatCount(group.unreadTotal)}</span>
											</div>
										</div>
									</button>
									<button
										type="button"
										class="activity-item__dismiss"
										aria-label="Mark this thread as read"
										onclick={(event) => {
											event.stopPropagation();
											clearGroup(group);
										}}
									>
										Mark read
									</button>
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
	.activity-shell {
		display: flex;
		height: 100dvh;
		max-height: 100dvh;
		align-items: stretch;
		background: var(--surface-root, var(--color-panel));
		color: var(--text-100);
		overflow: hidden;
	}

	.activity-surface {
		flex: 1;
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: transparent;
		color: var(--text-100);
		overflow: hidden;
	}

	.activity-header {
		padding: clamp(1.2rem, 4vw, 2.4rem);
		border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		display: flex;
		flex-wrap: wrap;
		gap: clamp(1rem, 3vw, 2rem);
		align-items: flex-start;
		background: var(--color-panel);
		flex-shrink: 0;
		z-index: 5;
	}

	.activity-header__copy {
		display: grid;
		gap: 0.4rem;
		min-width: 0;
	}

	.activity-title-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.activity-chip {
		padding: 0.2rem 0.65rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 600;
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		color: var(--color-accent);
	}

	.activity-eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.16em;
		font-size: 0.75rem;
		color: var(--text-60);
	}

	.activity-description {
		margin-top: 0.15rem;
		color: var(--text-70);
		font-size: 0.95rem;
	}

	.activity-header__stats {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-top: 0.35rem;
		font-size: 0.85rem;
		color: var(--text-70);
	}

	.activity-header__stats span {
		padding: 0.25rem 0.9rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-panel-muted) 40%, transparent);
		border: none;
	}

	.activity-header__actions {
		margin-left: auto;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		align-items: flex-end;
		min-width: 12rem;
	}

	.clear-feed-btn {
		border-radius: 999px;
		padding: 0.55rem 1.3rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		background: color-mix(in srgb, var(--surface-panel) 75%, transparent);
		font-weight: 600;
		color: var(--text-100);
		transition:
			border-color 120ms ease,
			background 120ms ease,
			color 120ms ease;
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
		transition:
			border-color 120ms ease,
			background 120ms ease,
			color 120ms ease;
	}

	.enable-push-btn:hover {
		border-color: color-mix(in srgb, var(--color-accent) 70%, transparent);
		background: color-mix(in srgb, var(--color-accent) 26%, transparent);
		color: var(--text-100);
	}

	.enable-push-btn--inline {
		padding: 0.5rem 1rem;
		white-space: nowrap;
	}

	.push-inline-error {
		font-size: 0.85rem;
		color: var(--color-danger, #ff6b6b);
		text-align: right;
	}

	.push-inline-success {
		font-size: 0.85rem;
		color: var(--color-success, #22c55e);
		text-align: right;
	}

	.push-inline-success--mobile {
		text-align: left;
	}

	.activity-main {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		padding: clamp(1rem, 3vw, 1.6rem);
		padding-bottom: calc(
			4rem + var(--mobile-dock-height, 0px) + env(safe-area-inset-bottom, 0px)
		);
		display: flex;
		flex-direction: column;
		gap: 1rem;
		background: transparent;
	}

	.activity-mobile-hero {
		display: none;
		gap: 0.6rem;
		background: var(--color-panel);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		border-radius: 1rem;
		padding: 0.9rem 1rem;
	}

	.activity-mobile-hero__copy {
		display: grid;
		gap: 0.35rem;
		min-width: 0;
	}

	.activity-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.35rem;
		flex-wrap: wrap;
	}

	.activity-toolbar__label {
		font-size: 0.9rem;
		color: var(--text-70);
	}

	.activity-banner {
		display: none;
		align-items: center;
		justify-content: space-between;
		gap: 0.9rem;
		padding: 0.75rem 0.9rem;
		border-radius: 0.95rem;
		border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}

	.activity-banner__copy {
		display: grid;
		gap: 0.2rem;
		color: var(--text-90);
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

	.activity-item {
		position: relative;
		width: 100%;
		border-radius: 1rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 40%, transparent);
		background: color-mix(in srgb, var(--color-panel) 55%, transparent);
		padding: 0.95rem 1.1rem;
		display: block;
		text-align: left;
		color: inherit;
		transition:
			transform 120ms ease,
			border-color 120ms ease,
			background 120ms ease;
		overflow: hidden;
		max-width: 100%;
	}

	.activity-item__content {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.65rem;
		align-items: start;
		min-width: 0;
		overflow: hidden;
	}

	.activity-item__hit {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.85rem;
		text-align: left;
		color: inherit;
		background: transparent;
		border: none;
		padding: 0;
		width: 100%;
		cursor: pointer;
		min-width: 0;
		overflow: hidden;
	}

	.activity-item:hover {
		transform: translateY(-1px);
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
		background: color-mix(in srgb, var(--color-panel) 70%, transparent);
	}

	.activity-item__hit:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--color-accent) 60%, transparent);
		outline-offset: 4px;
		border-radius: 0.85rem;
	}

	.activity-item__icon {
		width: 2.8rem;
		height: 2.8rem;
		border-radius: 0.9rem;
		background: color-mix(in srgb, var(--color-panel) 60%, transparent);
		display: grid;
		place-items: center;
		font-weight: 600;
		color: var(--text-80);
		font-size: 0.78rem;
		text-transform: uppercase;
	}

	.activity-item--dm .activity-item__icon {
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
	}

	.activity-item--thread .activity-item__icon {
		background: color-mix(in srgb, var(--color-highlight, #7cf) 20%, transparent);
		color: color-mix(in srgb, var(--color-highlight, #7cf) 60%, var(--text-100));
	}

	.activity-item--channel .activity-item__icon {
		background: color-mix(in srgb, var(--color-panel-muted) 45%, transparent);
		color: var(--text-80);
	}

	.activity-item__body {
		display: grid;
		gap: 0.45rem;
		min-width: 0;
		overflow: hidden;
	}

	.activity-item__header {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: flex-start;
		min-width: 0;
	}

	.activity-item__origin {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
		overflow: hidden;
		max-width: 100%;
	}

	.activity-item__badge {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.16em;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-panel-muted) 45%, transparent);
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
		align-self: start;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
		background: color-mix(in srgb, var(--color-panel-muted) 20%, transparent);
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text-70);
		cursor: pointer;
		padding: 0.4rem 0.75rem;
		border-radius: 999px;
		transition:
			color 120ms ease,
			background 120ms ease,
			border-color 120ms ease;
		white-space: nowrap;
	}

	.activity-item__dismiss:hover,
	.activity-item__dismiss:focus-visible {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
		outline: none;
	}

	.activity-item__location {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
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
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.activity-item__body p {
		margin: 0;
		color: var(--text-80);
		line-height: 1.35;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
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
		gap: 0.4rem;
		font-size: 0.78rem;
		color: var(--text-60);
		align-items: center;
		min-width: 0;
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
		.activity-shell {
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			flex-direction: column;
			overflow: hidden;
			z-index: 1;
		}

		.activity-surface {
			flex: 1;
			overflow: hidden;
			min-height: 0;
			display: flex;
			flex-direction: column;
		}

		.activity-header {
			display: none;
		}

		.activity-main {
			flex: 1;
			overflow-y: auto;
			overflow-x: hidden;
			-webkit-overflow-scrolling: touch;
			overscroll-behavior-y: contain;
			padding: calc(0.85rem + env(safe-area-inset-top, 0px)) 0.7rem
				calc(4rem + env(safe-area-inset-bottom, 0px) + var(--mobile-dock-height, 80px));
			gap: 0.85rem;
			min-height: 0;
		}

		.activity-mobile-hero {
			display: grid;
		}

		.activity-banner {
			display: flex;
		}
	}

	@media (max-width: 520px) {
		.activity-item {
			padding: 0.75rem 0.85rem;
			border-radius: 0.85rem;
		}

		.activity-item__content {
			grid-template-columns: 1fr;
			gap: 0.5rem;
		}

		.activity-item__hit {
			grid-template-columns: auto 1fr;
			gap: 0.6rem;
		}

		.activity-item__icon {
			width: 2.2rem;
			height: 2.2rem;
			font-size: 0.7rem;
			border-radius: 0.7rem;
		}

		.activity-item__header {
			flex-direction: column;
			gap: 0.35rem;
		}

		.activity-item__origin {
			gap: 0.35rem;
		}

		.activity-item__badge {
			font-size: 0.65rem;
			padding: 0.15rem 0.45rem;
		}

		.activity-item__bundle {
			font-size: 0.68rem;
			padding: 0.15rem 0.45rem;
		}

		.activity-item__location strong {
			font-size: 0.85rem;
		}

		.activity-item__location span {
			font-size: 0.75rem;
		}

		.activity-item__body h3 {
			font-size: 0.92rem;
		}

		.activity-item__body p {
			font-size: 0.85rem;
		}

		.activity-item__meta {
			font-size: 0.72rem;
			gap: 0.35rem;
		}

		.activity-item__dismiss {
			width: 100%;
			text-align: center;
			padding: 0.5rem 0.65rem;
			font-size: 0.75rem;
		}

		.activity-item__stack {
			font-size: 0.78rem;
			padding-left: 0.9rem;
		}

		.activity-mobile-hero {
			padding: 0.75rem 0.85rem;
		}

		.activity-title-row h2 {
			font-size: 1.1rem;
		}

		.activity-chip {
			font-size: 0.72rem;
			padding: 0.15rem 0.55rem;
		}

		.activity-header__stats {
			font-size: 0.78rem;
		}

		.activity-header__stats span {
			padding: 0.2rem 0.7rem;
		}

		.activity-toolbar {
			flex-direction: column;
			align-items: stretch;
		}

		.activity-toolbar__label {
			text-align: center;
		}

		.clear-feed-btn {
			width: 100%;
			padding: 0.5rem 1rem;
			font-size: 0.85rem;
		}

		.activity-description {
			font-size: 0.85rem;
		}

		.activity-banner {
			flex-direction: column;
			gap: 0.6rem;
			text-align: center;
			padding: 0.65rem 0.8rem;
		}

		.activity-banner__copy {
			text-align: center;
		}

		.enable-push-btn--inline {
			width: 100%;
		}
	}

	@media (max-width: 380px) {
		.activity-main {
			padding: calc(0.65rem + env(safe-area-inset-top, 0px)) 0.5rem
				calc(4rem + env(safe-area-inset-bottom, 0px) + var(--mobile-dock-height, 80px));
		}

		.activity-item {
			padding: 0.65rem 0.7rem;
		}

		.activity-item__icon {
			width: 2rem;
			height: 2rem;
		}

		.activity-mobile-hero {
			padding: 0.65rem 0.7rem;
		}
	}
</style>
