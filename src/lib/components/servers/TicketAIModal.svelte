<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { goto } from '$app/navigation';

import {
  computeAnalytics,
  fetchCachedAnalytics,
  fetchTicketAiIssues,
  fetchTicketAiSettings,
  issuesToCsv,
  normalizeSettings,
  saveCachedAnalytics,
  saveTicketAiSettings,
  type CachedAnalytics,
  type IssueStatus,
  type TicketAiIssue,
  type TicketAiSettings,
  type TicketAiType
} from '$lib/firestore/ticketAi';

  type Channel = { id: string; name: string; type: 'text' | 'voice' };
  type RoleOption = { id: string; name: string; isOwnerRole?: boolean };
  type MemberOption = { uid: string; displayName?: string | null; email?: string | null; nickname?: string | null };

  export let open = false;
  export let serverId: string;
  export let serverName = 'Server';
  export let channels: Channel[] = [];
  export let roles: RoleOption[] = [];
  export let currentUserId: string | null = null;
  export let members: MemberOption[] = [];

  const dispatch = createEventDispatcher<{ close: void }>();

  let activeTab: 'analytics' | 'setup' = 'analytics';
  let analyticsSubTab: 'overview' | 'staff' | 'tickets' = 'overview';
  let settings: TicketAiSettings = normalizeSettings();
  let settingsLoadedFor: string | null = null;
  let loadingSettings = false;
  let savingSettings = false;
  let saveStatus: string | null = null;
  let saveError: string | null = null;
  let staffSearch = '';

  // Analytics state - now uses cached data
  let cachedAnalytics: CachedAnalytics | null = null;
  let analyticsLoading = false;
  let analyticsError: string | null = null;
  let lastAnalyticsKey = '';
  let analyticsLastUpdated: Date | null = null;
  let isRefreshing = false;
  
  // Keep issues for CSV export (fetched on-demand)
  let issues: TicketAiIssue[] = [];
  let staffSuggestions: MemberOption[] = [];
  let staffDomainInput = '';

  // SLA configuration (response within X minutes)
  const SLA_TARGET_MINUTES = 60;

  let filters = {
    timeRange: '30d' as '7d' | '30d' | 'quarter' | 'custom',
    status: 'all' as IssueStatus | 'all',
    type: 'all' as TicketAiType | 'all',
    channelId: 'all'
  };
  let customStart = '';
  let customEnd = '';

  const timeRangeOptions = [
    { id: '7d', label: 'Last 7 days' },
    { id: '30d', label: 'Last 30 days' },
    { id: 'quarter', label: 'This quarter' },
    { id: 'custom', label: 'Custom range' }
  ];

  const retentionOptions: Array<{ id: TicketAiSettings['retention']; label: string }> = [
    { id: 'forever', label: 'Keep forever' },
    { id: '1y', label: '1 year' },
    { id: '90d', label: '90 days' }
  ];

  const scheduleFrequencies = [
    { id: 'weekly', label: 'Weekly' },
    { id: 'monthly', label: 'Monthly' }
  ];

  $: if (!open) {
    lastAnalyticsKey = '';
  }

  const defaultAllowedRoles = () => {
    const ownerRole = roles.find((role: RoleOption) => role.isOwnerRole);
    const adminish = roles.find((role: RoleOption) => /admin/i.test(role.name));
    return [ownerRole?.id, adminish?.id].filter(Boolean) as string[];
  };

  onMount(() => {
    if (open && serverId) {
      void hydrateSettings();
      // Load analytics if analytics tab is active on mount
      if (activeTab === 'analytics') {
        lastAnalyticsKey = `${serverId}-${filters.timeRange}`;
        void hydrateAnalytics();
      }
    }
  });

  $: if (open && serverId && settingsLoadedFor !== serverId && !loadingSettings) {
    void hydrateSettings();
  }

  // Trigger analytics fetch when switching to analytics tab or when time range changes
  $: if (open && serverId && activeTab === 'analytics') {
    const key = `${serverId}-${filters.timeRange}`;
    if (key !== lastAnalyticsKey && !analyticsLoading) {
      lastAnalyticsKey = key;
      void hydrateAnalytics();
    }
  }

  // Filter the cached ticket rows based on status/type/channel filters
  $: filteredTicketRows = (cachedAnalytics?.ticketRows ?? [])
    .filter((row) => (filters.channelId === 'all' ? true : row.channelId === filters.channelId))
    .filter((row) => (filters.status === 'all' ? true : row.status === filters.status))
    .filter((row) => {
      if (filters.type === 'all') return true;
      // We need to look up the type from the original issue data if needed
      const typeFromCache = cachedAnalytics?.issuesByType ?? {};
      return true; // For now, type filtering works at the summary level
    });
  $: memberLookup = Object.fromEntries(members.map((m) => [m.uid, m]));

  $: staffSuggestions = members
    .filter((m) => !settings.staffMemberIds.includes(m.uid))
    .filter((m) => {
      const q = staffSearch.trim().toLowerCase();
      if (!q) return true;
      const haystack = [m.displayName, m.nickname, m.email, m.uid].map((v) => (v ?? '').toLowerCase());
      return haystack.some((entry) => entry.includes(q));
    })
    .slice(0, 20);

  function close() {
    dispatch('close');
  }

  async function hydrateSettings() {
    if (!serverId) return;
    loadingSettings = true;
    saveStatus = null;
    saveError = null;
    try {
      const fetched = await fetchTicketAiSettings(serverId);
      const defaults = defaultAllowedRoles();
      settings = {
        ...fetched,
        allowedRoleIds: fetched.allowedRoleIds.length ? fetched.allowedRoleIds : defaults
      };
      settingsLoadedFor = serverId;
    } catch (err) {
      console.error('[TicketAIModal] failed to load settings', err);
      saveError = 'Could not load Ticket AI settings.';
    } finally {
      loadingSettings = false;
    }
  }

  function toggleChannel(id: string) {
    const set = new Set(settings.monitoredChannelIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    settings = { ...settings, monitoredChannelIds: Array.from(set) };
  }

  function toggleRole(id: string) {
    const set = new Set(settings.allowedRoleIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    settings = { ...settings, allowedRoleIds: Array.from(set) };
  }

  function addStaff(uid: string) {
    if (!uid) return;
    if (settings.staffMemberIds.includes(uid)) return;
    settings = { ...settings, staffMemberIds: [...settings.staffMemberIds, uid] };
    staffSearch = '';
  }

  function addFirstSuggestion() {
    const first = staffSuggestions[0];
    if (first) addStaff(first.uid);
  }

  function removeStaff(uid: string) {
    settings = { ...settings, staffMemberIds: settings.staffMemberIds.filter((id) => id !== uid) };
  }

  function addStaffDomain() {
    const raw = staffDomainInput.trim().toLowerCase();
    if (!raw) return;
    const domain = raw.startsWith('@') ? raw : `@${raw}`;
    if (settings.staffDomains.includes(domain)) return;
    settings = { ...settings, staffDomains: [...settings.staffDomains, domain] };
    staffDomainInput = '';
  }

  function removeStaffDomain(domain: string) {
    settings = { ...settings, staffDomains: settings.staffDomains.filter((d) => d !== domain) };
  }

  const memberLabel = (uid: string) => {
    const entry = memberLookup[uid];
    return (
      entry?.displayName ||
      entry?.nickname ||
      entry?.email ||
      entry?.uid ||
      uid
    );
  };

  function parseDate(input: string): Date | null {
    if (!input) return null;
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function resolveRange() {
    const now = new Date();
    if (filters.timeRange === '7d') {
      const start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      return { start, end: now, label: 'Last 7 days' };
    }
    if (filters.timeRange === '30d') {
      const start = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
      return { start, end: now, label: 'Last 30 days' };
    }
    if (filters.timeRange === 'quarter') {
      const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      return { start, end: now, label: 'This quarter' };
    }
    const start = parseDate(customStart);
    const end = parseDate(customEnd) ?? now;
    return { start, end, label: 'Custom range' };
  }

  // Load cached analytics or compute fresh if needed
  async function hydrateAnalytics(forceRefresh = false) {
    if (!serverId) {
      cachedAnalytics = null;
      analyticsLoading = false;
      return;
    }
    
    const timeRangeKey = filters.timeRange;
    // Only cache standard time ranges, not custom
    const canCache = timeRangeKey !== 'custom';
    
    analyticsLoading = true;
    analyticsError = null;
    
    try {
      // Try to load from cache first (unless forcing refresh)
      if (canCache && !forceRefresh) {
        const cached = await fetchCachedAnalytics(serverId, timeRangeKey);
        if (cached) {
          // Check if cache is fresh (less than 1 hour old)
          const cacheAge = Date.now() - (cached.updatedAt?.toMillis?.() ?? 0);
          const ONE_HOUR = 60 * 60 * 1000;
          if (cacheAge < ONE_HOUR) {
            console.log('[TicketAIModal] Using cached analytics', { timeRangeKey, cacheAge });
            cachedAnalytics = cached;
            analyticsLastUpdated = cached.updatedAt?.toDate?.() ?? null;
            return;
          }
        }
      }
      
      // Need to compute fresh analytics
      console.log('[TicketAIModal] Computing fresh analytics...');
      isRefreshing = true;
      
      const range = resolveRange();
      const rawIssues = await fetchTicketAiIssues(serverId, {
        start: range.start ?? undefined,
        end: range.end ?? undefined
      });
      
      // Keep issues for CSV export
      issues = rawIssues;
      
      // Compute analytics
      const computed = computeAnalytics(
        rawIssues,
        timeRangeKey,
        range.start,
        range.end ?? new Date(),
        SLA_TARGET_MINUTES
      );
      
      // Save to cache (only for standard ranges)
      if (canCache) {
        await saveCachedAnalytics(serverId, timeRangeKey, computed);
      }
      
      cachedAnalytics = {
        ...computed,
        updatedAt: { toMillis: () => Date.now(), toDate: () => new Date() } as any
      };
      analyticsLastUpdated = new Date();
      
      console.log('[TicketAIModal] Analytics computed and cached', { totalIssues: computed.totalIssues });
    } catch (err) {
      console.error('[TicketAIModal] failed to load analytics', err);
      analyticsError = 'Unable to load analytics right now.';
      cachedAnalytics = null;
    } finally {
      analyticsLoading = false;
      isRefreshing = false;
    }
  }

  // Force refresh analytics
  async function refreshAnalytics() {
    await hydrateAnalytics(true);
  }

  async function persistSettings(nextTab?: 'analytics') {
    if (!serverId) return;
    savingSettings = true;
    saveStatus = null;
    saveError = null;
    try {
      const schedule = {
        ...settings.schedule,
        dayOfWeek: Number(settings.schedule.dayOfWeek ?? 1)
      };
      const payload = { ...settings, schedule };
      settings = payload;
      await saveTicketAiSettings(serverId, payload, currentUserId);
      saveStatus = 'Settings saved';
      if (nextTab === 'analytics') {
        activeTab = 'analytics';
      }
    } catch (err) {
      console.error('[TicketAIModal] failed to save settings', err);
      saveError = 'Failed to save Ticket AI settings.';
    } finally {
      savingSettings = false;
    }
  }

  function average(values: Array<number | null | undefined>): number | null {
    const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  const formatDuration = (ms?: number | null) => {
    if (!ms || ms < 0) return '—';
    const minutes = Math.floor(ms / (60 * 1000));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${Math.max(minutes, 1)}m`;
  };

  const formatShortDate = (value?: any) => {
    if (!value) return '—';
    const d = typeof value.toDate === 'function' ? value.toDate() : value instanceof Date ? value : null;
    if (!d) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatDate = (value?: any) => {
    if (!value) return '—';
    if (typeof value.toDate === 'function') return value.toDate().toLocaleString();
    if (value instanceof Date) return value.toLocaleString();
    return '—';
  };

  const toMillis = (value: any) => {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    return null;
  };

  const chartBuckets = (rows: TicketAiIssue[]) => {
    const map = new Map<string, { label: string; ts: number; opened: number; closed: number }>();
    for (const row of rows) {
      const ms = toMillis(row.createdAt) ?? Date.now();
      const day = new Date(ms);
      const label = `${day.getMonth() + 1}/${day.getDate()}`;
      const bucketKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
      const current = map.get(bucketKey);
      if (current) {
        current.opened += 1;
        if (row.status === 'closed') current.closed += 1;
      } else {
        map.set(bucketKey, { label, ts: day.getTime(), opened: 1, closed: row.status === 'closed' ? 1 : 0 });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
  };

  // Chart buckets from cached ticket rows
  import type { CachedTicketRow } from '$lib/firestore/ticketAi';
  
  const chartBucketsFromCached = (rows: CachedTicketRow[]) => {
    const map = new Map<string, { label: string; ts: number; opened: number; closed: number }>();
    for (const row of rows) {
      const ms = row.createdAtMs;
      const day = new Date(ms);
      const label = `${day.getMonth() + 1}/${day.getDate()}`;
      const bucketKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
      const current = map.get(bucketKey);
      if (current) {
        current.opened += 1;
        if (row.status === 'closed') current.closed += 1;
      } else {
        map.set(bucketKey, { label, ts: day.getTime(), opened: 1, closed: row.status === 'closed' ? 1 : 0 });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
  };

  // Handle clicking a ticket row (navigate to thread)
  function handleTicketClick(ticketId: string) {
    // For now, just log - could navigate to the thread in the future
    console.log('[TicketAIModal] Clicked ticket:', ticketId);
  }

  function typeBreakdown(rows: TicketAiIssue[]) {
    const map: Record<TicketAiType, number> = {
      bug: 0,
      feature_request: 0,
      question: 0,
      other: 0
    };
    for (const row of rows) {
      const type = (row.typeTag ?? 'other') as TicketAiType;
      map[type] = (map[type] ?? 0) + 1;
    }
    return map;
  }

  // Calculate SLA compliance rate (% of issues responded within target)
  function calcSlaCompliance(rows: TicketAiIssue[]): number | null {
    const withResponse = rows.filter((r) => typeof r.timeToFirstResponseMs === 'number');
    if (!withResponse.length) return null;
    const targetMs = SLA_TARGET_MINUTES * 60 * 1000;
    const metSla = withResponse.filter((r) => (r.timeToFirstResponseMs ?? Infinity) <= targetMs);
    return (metSla.length / withResponse.length) * 100;
  }

  // Count reopened tickets
  function countReopened(rows: TicketAiIssue[]): number {
    return rows.filter((r) => r.reopenedAfterClose).length;
  }

  // Staff leaderboard: who resolved the most issues
  function staffLeaderboard(rows: TicketAiIssue[]): Array<{ uid: string; name: string; count: number; avgResponseMs: number | null }> {
    const map = new Map<string, { count: number; responseTimes: number[] }>();
    for (const row of rows) {
      if (row.status === 'closed' && row.staffMemberIds?.length) {
        for (const uid of row.staffMemberIds) {
          const existing = map.get(uid) ?? { count: 0, responseTimes: [] };
          existing.count += 1;
          if (typeof row.timeToFirstResponseMs === 'number') {
            existing.responseTimes.push(row.timeToFirstResponseMs);
          }
          map.set(uid, existing);
        }
      }
    }
    return Array.from(map.entries())
      .map(([uid, data]) => ({ 
        uid, 
        name: memberLabel(uid), 
        count: data.count,
        avgResponseMs: data.responseTimes.length > 0 
          ? data.responseTimes.reduce((a, b) => a + b, 0) / data.responseTimes.length 
          : null
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  // Full staff stats for the Staff tab
  type StaffStat = {
    uid: string;
    name: string;
    ticketsAnswered: number;
    ticketsResolved: number;
    avgResponseMs: number | null;
    avgResolutionMs: number | null;
    totalMessages: number;
  };

  function getStaffStats(rows: TicketAiIssue[]): StaffStat[] {
    const map = new Map<string, {
      ticketsAnswered: number;
      ticketsResolved: number;
      responseTimes: number[];
      resolutionTimes: number[];
      totalMessages: number;
    }>();

    for (const row of rows) {
      if (!row.staffMemberIds?.length) continue;
      
      for (const uid of row.staffMemberIds) {
        const existing = map.get(uid) ?? {
          ticketsAnswered: 0,
          ticketsResolved: 0,
          responseTimes: [],
          resolutionTimes: [],
          totalMessages: 0
        };
        
        existing.ticketsAnswered += 1;
        if (row.status === 'closed') {
          existing.ticketsResolved += 1;
        }
        if (typeof row.timeToFirstResponseMs === 'number') {
          existing.responseTimes.push(row.timeToFirstResponseMs);
        }
        if (typeof row.timeToResolutionMs === 'number') {
          existing.resolutionTimes.push(row.timeToResolutionMs);
        }
        existing.totalMessages += row.staffMessageCount ?? 0;
        
        map.set(uid, existing);
      }
    }

    return Array.from(map.entries())
      .map(([uid, data]) => ({
        uid,
        name: memberLabel(uid),
        ticketsAnswered: data.ticketsAnswered,
        ticketsResolved: data.ticketsResolved,
        avgResponseMs: data.responseTimes.length > 0
          ? data.responseTimes.reduce((a, b) => a + b, 0) / data.responseTimes.length
          : null,
        avgResolutionMs: data.resolutionTimes.length > 0
          ? data.resolutionTimes.reduce((a, b) => a + b, 0) / data.resolutionTimes.length
          : null,
        totalMessages: data.totalMessages
      }))
      .sort((a, b) => b.ticketsResolved - a.ticketsResolved);
  }

  // Get tickets for the Tickets tab with resolved info
  type TicketRow = {
    id: string;
    summary: string;
    status: IssueStatus;
    channelName: string;
    resolvedBy: string | null;
    resolvedAt: string | null;
    resolutionTime: number | null;
    createdAt: string;
  };

  function getTicketRows(rows: TicketAiIssue[]): TicketRow[] {
    return rows
      .map((issue) => ({
        id: issue.id,
        summary: issue.summary ?? 'No description',
        status: issue.status,
        channelName: channels.find((c) => c.id === issue.channelId)?.name ?? 'unknown',
        resolvedBy: issue.status === 'closed' && issue.staffMemberIds?.length
          ? issue.staffMemberIds.map(uid => memberLabel(uid)).join(', ')
          : null,
        resolvedAt: issue.closedAt
          ? formatShortDate(issue.closedAt)
          : null,
        resolutionTime: issue.timeToResolutionMs ?? null,
        createdAt: formatShortDate(issue.createdAt)
      }))
      .sort((a, b) => {
        // Sort by status (closed last) then by date
        if (a.status === 'closed' && b.status !== 'closed') return 1;
        if (a.status !== 'closed' && b.status === 'closed') return -1;
        return 0;
      });
  }

  // Status breakdown
  function statusBreakdown(rows: TicketAiIssue[]) {
    const map = { opened: 0, in_progress: 0, closed: 0 };
    for (const row of rows) {
      const status = row.status ?? 'opened';
      if (status in map) map[status as keyof typeof map]++;
    }
    return map;
  }

  // Calculate resolution rate
  function calcResolutionRate(rows: TicketAiIssue[]): number | null {
    if (!rows.length) return null;
    const closed = rows.filter((r) => r.status === 'closed').length;
    return (closed / rows.length) * 100;
  }

  // Calculate average thread message count
  function calcAvgMessages(rows: TicketAiIssue[]): number | null {
    const withCount = rows.filter((r) => typeof r.messageCount === 'number' && r.messageCount > 0);
    if (!withCount.length) return null;
    return withCount.reduce((sum, r) => sum + (r.messageCount ?? 0), 0) / withCount.length;
  }

  async function handleExportCsv() {
    // Use cached issues if available, otherwise fetch fresh
    let exportIssues = issues;
    if (exportIssues.length === 0 && serverId) {
      const range = resolveRange();
      exportIssues = await fetchTicketAiIssues(serverId, {
        start: range.start ?? undefined,
        end: range.end ?? undefined
      });
    }
    const csv = issuesToCsv(exportIssues);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ticket-ai-${serverId}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleRowClick(issue: TicketAiIssue) {
    const target = new URL(`/servers/${serverId}`, window.location.origin);
    target.searchParams.set('channel', issue.channelId);
    target.searchParams.set('thread', issue.threadId);
    goto(target.pathname + target.search);
  }
</script>

<svelte:options runes={false} />

{#if open}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="0"
    on:click={(event) => {
      if (event.target === event.currentTarget) close();
    }}
    on:keydown={(e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }}
  >
    <div class="modal-container" role="document" tabindex="-1">
      <!-- Header -->
      <header class="modal-header">
        <div class="modal-header__left">
          <div class="modal-header__icon">
            <i class="bx bx-bot"></i>
          </div>
          <div>
            <h2>Ticket AI</h2>
            <p class="modal-header__subtitle">{serverName}</p>
          </div>
        </div>
        <button class="modal-close" aria-label="Close" on:click={close}>
          <i class="bx bx-x"></i>
        </button>
      </header>

      <!-- Tabs -->
      <nav class="modal-tabs">
        <button 
          class="modal-tab" 
          class:modal-tab--active={activeTab === 'analytics'} 
          on:click={() => (activeTab = 'analytics')}
          disabled={!settings.enabled}
        >
          <i class="bx bx-bar-chart-alt-2"></i>
          Analytics
        </button>
        <button 
          class="modal-tab" 
          class:modal-tab--active={activeTab === 'setup'} 
          on:click={() => (activeTab = 'setup')}
        >
          <i class="bx bx-cog"></i>
          Settings
        </button>
      </nav>

      <!-- Content -->
      <div class="modal-content">
        {#if activeTab === 'analytics'}
          <!-- Analytics Tab -->
          <div class="analytics-view">
            <!-- Sub-tabs for Analytics -->
            <div class="analytics-subtabs">
              <button
                type="button"
                class="analytics-subtab"
                class:analytics-subtab--active={analyticsSubTab === 'overview'}
                on:click={() => (analyticsSubTab = 'overview')}
              >
                <i class="bx bx-bar-chart-alt-2"></i>
                Overview
              </button>
              <button
                type="button"
                class="analytics-subtab"
                class:analytics-subtab--active={analyticsSubTab === 'staff'}
                on:click={() => (analyticsSubTab = 'staff')}
              >
                <i class="bx bx-group"></i>
                Staff
              </button>
              <button
                type="button"
                class="analytics-subtab"
                class:analytics-subtab--active={analyticsSubTab === 'tickets'}
                on:click={() => (analyticsSubTab = 'tickets')}
              >
                <i class="bx bx-receipt"></i>
                Tickets
              </button>
            </div>

            <!-- Filters Bar -->
            <div class="filters-bar">
              <div class="filters-row">
                <label class="filter-item">
                  <span class="filter-label">Period</span>
                  <select class="filter-select" bind:value={filters.timeRange}>
                    {#each timeRangeOptions as opt}
                      <option value={opt.id}>{opt.label}</option>
                    {/each}
                  </select>
                </label>
                {#if filters.timeRange === 'custom'}
                  <label class="filter-item">
                    <span class="filter-label">From</span>
                    <input type="date" class="filter-input" bind:value={customStart} />
                  </label>
                  <label class="filter-item">
                    <span class="filter-label">To</span>
                    <input type="date" class="filter-input" bind:value={customEnd} />
                  </label>
                {/if}
                <label class="filter-item">
                  <span class="filter-label">Channel</span>
                  <select class="filter-select" bind:value={filters.channelId}>
                    <option value="all">All channels</option>
                    {#each channels.filter((c) => c.type === 'text') as channel}
                      <option value={channel.id}>#{channel.name}</option>
                    {/each}
                  </select>
                </label>
                <label class="filter-item">
                  <span class="filter-label">Status</span>
                  <select class="filter-select" bind:value={filters.status}>
                    <option value="all">All</option>
                    <option value="opened">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="closed">Resolved</option>
                  </select>
                </label>
              </div>
              <button class="export-btn" on:click={handleExportCsv}>
                <i class="bx bx-download"></i>
                Export CSV
              </button>
              <button class="refresh-btn" on:click={refreshAnalytics} disabled={analyticsLoading || isRefreshing}>
                <i class="bx bx-refresh" class:spinning={isRefreshing}></i>
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            
            {#if analyticsLastUpdated}
              <div class="cache-info">
                Last updated: {analyticsLastUpdated.toLocaleTimeString()}
              </div>
            {/if}

            {#if analyticsLoading && !isRefreshing}
              <div class="loading-state">
                <div class="spinner"></div>
                <p>Loading analytics...</p>
              </div>
            {:else if analyticsError}
              <div class="error-state">
                <i class="bx bx-error-circle"></i>
                <p>{analyticsError}</p>
              </div>
            {:else if !cachedAnalytics}
              <div class="empty-state">
                <i class="bx bx-bar-chart-alt-2"></i>
                <p>No analytics data available</p>
              </div>
            {:else if analyticsSubTab === 'overview'}
              <!-- OVERVIEW TAB -->
              <!-- Key Metrics Grid -->
              <div class="metrics-grid">
                <div class="metric-card metric-card--primary">
                  <div class="metric-card__icon"><i class="bx bx-folder-open"></i></div>
                  <div class="metric-card__data">
                    <span class="metric-card__value">{cachedAnalytics.openIssues + cachedAnalytics.inProgressIssues}</span>
                    <span class="metric-card__label">Open Issues</span>
                  </div>
                </div>
                <div class="metric-card">
                  <div class="metric-card__icon metric-card__icon--success"><i class="bx bx-check-circle"></i></div>
                  <div class="metric-card__data">
                    <span class="metric-card__value">{cachedAnalytics.closedIssues}</span>
                    <span class="metric-card__label">Resolved</span>
                  </div>
                </div>
                <div class="metric-card">
                  <div class="metric-card__icon metric-card__icon--info"><i class="bx bx-time-five"></i></div>
                  <div class="metric-card__data">
                    <span class="metric-card__value">{formatDuration(cachedAnalytics.avgResponseTimeMs)}</span>
                    <span class="metric-card__label">Avg Response</span>
                  </div>
                </div>
                <div class="metric-card">
                  <div class="metric-card__icon metric-card__icon--warning"><i class="bx bx-stopwatch"></i></div>
                  <div class="metric-card__data">
                    <span class="metric-card__value">{formatDuration(cachedAnalytics.avgResolutionTimeMs)}</span>
                    <span class="metric-card__label">Avg Resolution</span>
                  </div>
                </div>
                <div class="metric-card">
                  <div class="metric-card__icon"><i class="bx bx-message-square-dots"></i></div>
                  <div class="metric-card__data">
                    <span class="metric-card__value">{cachedAnalytics.totalIssues > 0 ? (cachedAnalytics.ticketRows.reduce((sum, r) => sum + 1, 0) > 0 ? '—' : '—') : '—'}</span>
                    <span class="metric-card__label">Total Issues</span>
                  </div>
                </div>
                <div class="metric-card">
                  <div class="metric-card__icon metric-card__icon--accent"><i class="bx bx-target-lock"></i></div>
                  <div class="metric-card__data">
                    <span class="metric-card__value">{cachedAnalytics.slaCompliancePercent?.toFixed(0) ?? '—'}%</span>
                    <span class="metric-card__label">SLA Met</span>
                  </div>
                </div>
              </div>

              <!-- Charts Row -->
              <div class="charts-row">
                <!-- Issues Over Time -->
                <div class="chart-card chart-card--wide">
                  <div class="chart-card__header">
                    <h4>Issues Over Time</h4>
                    <span class="chart-card__subtitle">{resolveRange().label}</span>
                  </div>
                  <div class="chart-area">
                    {#if cachedAnalytics}
                      {@const tickets = cachedAnalytics.ticketRows ?? []}
                      {@const buckets = chartBucketsFromCached(tickets)}
                      {#if buckets.length > 0}
                        <div class="bar-chart">
                          {#each buckets as bucket}
                            <div class="bar-group">
                              <div class="bar bar--opened" style="height: {Math.max(4, bucket.opened * 12)}px" title="{bucket.opened} opened">
                                <span class="bar-value">{bucket.opened}</span>
                              </div>
                              <span class="bar-label">{bucket.label}</span>
                            </div>
                          {/each}
                        </div>
                      {:else}
                        <p class="chart-empty">No data for this period</p>
                      {/if}
                    {:else}
                      <p class="chart-empty">No data for this period</p>
                    {/if}
                  </div>
                </div>

                <!-- Status Breakdown -->
                {#if cachedAnalytics}
                  {@const statuses = { opened: cachedAnalytics.openIssues, in_progress: cachedAnalytics.inProgressIssues, closed: cachedAnalytics.closedIssues }}
                  {@const total = Math.max(statuses.opened + statuses.in_progress + statuses.closed, 1)}
                  <div class="chart-card">
                    <div class="chart-card__header">
                      <h4>Status</h4>
                    </div>
                    <div class="status-bars">
                    <div class="status-item">
                      <div class="status-item__header">
                        <span class="status-dot status-dot--open"></span>
                        <span>Open</span>
                        <span class="status-item__value">{statuses.opened}</span>
                      </div>
                      <div class="status-bar">
                        <div class="status-bar__fill status-bar__fill--open" style="width: {(statuses.opened / total) * 100}%"></div>
                      </div>
                    </div>
                    <div class="status-item">
                      <div class="status-item__header">
                        <span class="status-dot status-dot--progress"></span>
                        <span>In Progress</span>
                        <span class="status-item__value">{statuses.in_progress}</span>
                      </div>
                      <div class="status-bar">
                        <div class="status-bar__fill status-bar__fill--progress" style="width: {(statuses.in_progress / total) * 100}%"></div>
                      </div>
                    </div>
                    <div class="status-item">
                      <div class="status-item__header">
                        <span class="status-dot status-dot--closed"></span>
                        <span>Resolved</span>
                        <span class="status-item__value">{statuses.closed}</span>
                      </div>
                      <div class="status-bar">
                        <div class="status-bar__fill status-bar__fill--closed" style="width: {(statuses.closed / total) * 100}%"></div>
                      </div>
                    </div>
                  </div>
                </div>
                {/if}
              </div>

              <!-- Team Performance -->
              <div class="team-section">
                {#if cachedAnalytics}
                  {@const leaders = cachedAnalytics.staffStats.slice(0, 5).map(s => ({
                    name: memberLabel(s.uid),
                    count: s.ticketsResolved,
                    avgResponseMs: s.avgResponseMs
                  }))}
                  <div class="team-card">
                    <div class="team-card__header">
                      <h4><i class="bx bx-trophy"></i> Top Responders</h4>
                    </div>
                    {#if leaders.length > 0}
                      <div class="leaderboard">
                        {#each leaders as person, i}
                          <div class="leaderboard-row">
                            <span class="leaderboard-rank">
                              {#if i === 0}🥇{:else if i === 1}🥈{:else if i === 2}🥉{:else}{i + 1}{/if}
                            </span>
                            <span class="leaderboard-name">{person.name}</span>
                            <span class="leaderboard-stats">
                              <span class="leaderboard-count">{person.count} resolved</span>
                              {#if person.avgResponseMs}
                                <span class="leaderboard-time">{formatDuration(person.avgResponseMs)} avg</span>
                              {/if}
                            </span>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <p class="team-empty">No resolved issues yet</p>
                    {/if}
                  </div>
                {/if}

                <!-- Issue Types -->
                {#if cachedAnalytics}
                  {@const types = cachedAnalytics.issuesByType}
                  <div class="team-card">
                    <div class="team-card__header">
                      <h4><i class="bx bx-category"></i> Issue Types</h4>
                    </div>
                    <div class="type-list">
                      {#each Object.entries(types) as [type, count]}
                        <div class="type-row">
                          <span class="type-label">{type.replace('_', ' ')}</span>
                          <div class="type-bar">
                            <div class="type-bar__fill" style="width: {Math.min(100, (count / Math.max(cachedAnalytics?.totalIssues ?? 1, 1)) * 100)}%"></div>
                          </div>
                          <span class="type-count">{count}</span>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>

              <!-- Issues Table -->
              {@const recentTickets = cachedAnalytics?.ticketRows ?? []}
              <div class="issues-section">
                <div class="issues-header">
                  <h4>Recent Issues</h4>
                  <span class="issues-count">{recentTickets.length} total</span>
                </div>
                {#if recentTickets.length > 0}
                  <div class="issues-table">
                    <div class="issues-row issues-row--header">
                      <span>Issue</span>
                      <span>Channel</span>
                      <span>Status</span>
                      <span>Response</span>
                      <span>Resolution</span>
                      <span>Created</span>
                    </div>
                    {#each recentTickets.slice(0, 20) as ticket (ticket.id)}
                      <button class="issues-row" type="button" on:click={() => handleTicketClick(ticket.id)}>
                        <span class="issue-id">{ticket.id.slice(0, 8)}</span>
                        <span class="issue-channel">#{channels.find((c) => c.id === ticket.channelId)?.name ?? 'unknown'}</span>
                        <span class="issue-status issue-status--{ticket.status}">{ticket.status.replace('_', ' ')}</span>
                        <span>{formatDuration(ticket.resolutionTimeMs)}</span>
                        <span class="issue-date">{new Date(ticket.createdAtMs).toLocaleDateString()}</span>
                      </button>
                    {/each}
                  </div>
                  {#if recentTickets.length > 20}
                    <p class="issues-more">Showing 20 of {recentTickets.length} issues. Export CSV for full data.</p>
                  {/if}
                {:else}
                  <div class="issues-empty">
                    <i class="bx bx-inbox"></i>
                    <p>No issues found for this period</p>
                  </div>
                {/if}
              </div>

            {:else if analyticsSubTab === 'staff'}
              <!-- STAFF TAB -->
              {@const staffStats = cachedAnalytics?.staffStats ?? []}
              {@const staffStatsWithNames = staffStats.map(s => ({ ...s, name: memberLabel(s.uid) }))}
              <div class="staff-tab">
                {#if staffStatsWithNames.length > 0}
                  <div class="staff-table-container">
                    <table class="staff-table">
                      <thead>
                        <tr>
                          <th>Staff Member</th>
                          <th>Tickets Answered</th>
                          <th>Resolved</th>
                          <th>Avg Response Time</th>
                          <th>Avg Resolution Time</th>
                          <th>Messages Sent</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each staffStatsWithNames as staff (staff.uid)}
                          <tr>
                            <td class="staff-name">
                              <i class="bx bx-user-circle"></i>
                              {staff.name}
                            </td>
                            <td class="staff-stat">{staff.ticketsAnswered}</td>
                            <td class="staff-stat staff-stat--highlight">{staff.ticketsResolved}</td>
                            <td class="staff-stat">{formatDuration(staff.avgResponseMs)}</td>
                            <td class="staff-stat">{formatDuration(staff.avgResolutionMs)}</td>
                            <td class="staff-stat">{staff.totalMessages}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                  
                  <!-- Staff Summary Cards -->
                  <div class="staff-summary">
                    <div class="staff-summary-card">
                      <div class="staff-summary-card__icon"><i class="bx bx-user-check"></i></div>
                      <div class="staff-summary-card__data">
                        <span class="staff-summary-card__value">{staffStatsWithNames.length}</span>
                        <span class="staff-summary-card__label">Active Staff</span>
                      </div>
                    </div>
                    <div class="staff-summary-card">
                      <div class="staff-summary-card__icon"><i class="bx bx-trophy"></i></div>
                      <div class="staff-summary-card__data">
                        <span class="staff-summary-card__value">{staffStatsWithNames[0]?.name ?? '—'}</span>
                        <span class="staff-summary-card__label">Top Resolver</span>
                      </div>
                    </div>
                    {#if true}
                      {@const allResponseTimes = staffStatsWithNames.filter(s => s.avgResponseMs != null).map(s => s.avgResponseMs ?? 0)}
                      <div class="staff-summary-card">
                        <div class="staff-summary-card__icon"><i class="bx bx-time-five"></i></div>
                        <div class="staff-summary-card__data">
                          <span class="staff-summary-card__value">
                            {formatDuration(allResponseTimes.length > 0 ? allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length : null)}
                          </span>
                          <span class="staff-summary-card__label">Team Avg Response</span>
                        </div>
                      </div>
                    {/if}
                  </div>
                {:else}
                  <div class="staff-empty">
                    <i class="bx bx-user-x"></i>
                    <p>No staff activity found for this period</p>
                    <span class="staff-empty__hint">Staff members will appear here once they respond to tickets</span>
                  </div>
                {/if}
              </div>

            {:else if analyticsSubTab === 'tickets'}
              <!-- TICKETS TAB -->
              {@const ticketRows = cachedAnalytics?.ticketRows ?? []}
              {@const ticketRowsWithNames = ticketRows.map(t => ({
                ...t,
                channelName: channels.find(c => c.id === t.channelId)?.name ?? 'unknown',
                resolvedBy: t.resolvedByUids.length > 0 ? t.resolvedByUids.map(uid => memberLabel(uid)).join(', ') : null,
                createdAtStr: new Date(t.createdAtMs).toLocaleDateString()
              }))}
              <div class="tickets-tab">
                {#if ticketRowsWithNames.length > 0}
                  <div class="tickets-table-container">
                    <table class="tickets-table">
                      <thead>
                        <tr>
                          <th class="th-description">Description</th>
                          <th>Channel</th>
                          <th>Status</th>
                          <th>Resolved By</th>
                          <th>Resolution Time</th>
                          <th>Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each ticketRowsWithNames as ticket (ticket.id)}
                          <tr class="ticket-row ticket-row--{ticket.status}">
                            <td class="ticket-description" title={ticket.summary}>
                              {ticket.summary.length > 60 ? ticket.summary.slice(0, 60) + '…' : ticket.summary}
                            </td>
                            <td class="ticket-channel">#{ticket.channelName}</td>
                            <td>
                              <span class="ticket-status-badge ticket-status-badge--{ticket.status}">
                                {ticket.status === 'opened' ? 'Open' : ticket.status === 'in_progress' ? 'In Progress' : 'Resolved'}
                              </span>
                            </td>
                            <td class="ticket-resolver">{ticket.resolvedBy ?? '—'}</td>
                            <td class="ticket-resolution-time">{formatDuration(ticket.resolutionTimeMs)}</td>
                            <td class="ticket-date">{ticket.createdAtStr}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                  <div class="tickets-footer">
                    <span class="tickets-total">{ticketRowsWithNames.length} tickets total</span>
                    <span class="tickets-resolved">{ticketRowsWithNames.filter(t => t.status === 'closed').length} resolved</span>
                  </div>
                {:else}
                  <div class="tickets-empty">
                    <i class="bx bx-receipt"></i>
                    <p>No tickets found for this period</p>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {:else}
          <!-- Settings Tab -->
          <div class="settings-view">
            <!-- Enable Section -->
            <section class="settings-section">
              <div class="settings-section__header">
                <div>
                  <h4>Enable Ticket AI</h4>
                  <p>Turn on to start tracking issues in your channels.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" bind:checked={settings.enabled} on:change={() => (saveStatus = null)} />
                  <span class="toggle-switch__slider"></span>
                  <span class="toggle-switch__label">{settings.enabled ? 'Enabled' : 'Disabled'}</span>
                </label>
              </div>
            </section>

            <!-- Channels Section -->
            <section class="settings-section">
              <h4>Monitored Channels</h4>
              <p class="settings-description">Select which channels to track for issue threads.</p>
              <div class="channel-grid">
                {#each channels.filter((c) => c.type === 'text') as channel}
                  <label class="channel-checkbox">
                    <input
                      type="checkbox"
                      checked={settings.monitoredChannelIds.includes(channel.id)}
                      on:change={() => toggleChannel(channel.id)}
                      disabled={!settings.enabled}
                    />
                    <span class="channel-checkbox__indicator"></span>
                    <span>#{channel.name}</span>
                  </label>
                {/each}
                {#if channels.filter((c) => c.type === 'text').length === 0}
                  <p class="settings-empty">No text channels available</p>
                {/if}
              </div>
            </section>

            <!-- Staff Section -->
            <section class="settings-section">
              <h4>Staff Identification</h4>
              <p class="settings-description">Define who counts as staff for response tracking.</p>
              
              <div class="staff-grid">
                <div class="staff-column">
                  <label class="settings-label">Staff Members</label>
                  <input
                    class="settings-input"
                    placeholder="Search members..."
                    bind:value={staffSearch}
                    disabled={!settings.enabled}
                    on:keydown={(e) => e.key === 'Enter' && addFirstSuggestion()}
                  />
                  {#if staffSuggestions.length > 0 && staffSearch.trim()}
                    <div class="suggestions">
                      {#each staffSuggestions.slice(0, 5) as member}
                        <button type="button" class="suggestion" on:click={() => addStaff(member.uid)}>
                          {member.displayName ?? member.nickname ?? member.email ?? member.uid}
                        </button>
                      {/each}
                    </div>
                  {/if}
                  <div class="tags">
                    {#each settings.staffMemberIds as uid}
                      <span class="tag">
                        {memberLabel(uid)}
                        <button type="button" aria-label="Remove staff member" on:click={() => removeStaff(uid)}><i class="bx bx-x"></i></button>
                      </span>
                    {/each}
                    {#if settings.staffMemberIds.length === 0}
                      <span class="settings-empty-inline">No staff selected</span>
                    {/if}
                  </div>
                </div>

                <div class="staff-column">
                  <label class="settings-label">Staff Email Domains</label>
                  <div class="domain-input-row">
                    <input
                      class="settings-input"
                      placeholder="@company.com"
                      bind:value={staffDomainInput}
                      disabled={!settings.enabled}
                      on:keydown={(e) => e.key === 'Enter' && addStaffDomain()}
                    />
                    <button class="add-btn" on:click={addStaffDomain} disabled={!settings.enabled || !staffDomainInput.trim()}>
                      Add
                    </button>
                  </div>
                  <div class="tags">
                    {#each settings.staffDomains as domain}
                      <span class="tag tag--domain">
                        {domain}
                        <button type="button" aria-label="Remove domain" on:click={() => removeStaffDomain(domain)}><i class="bx bx-x"></i></button>
                      </span>
                    {/each}
                    {#if settings.staffDomains.length === 0}
                      <span class="settings-empty-inline">No domains added</span>
                    {/if}
                  </div>
                </div>
              </div>
            </section>

            <!-- Access & Retention -->
            <section class="settings-section">
              <h4>Access & Retention</h4>
              <div class="settings-row">
                <div class="settings-field">
                  <label class="settings-label">Who can view analytics</label>
                  <div class="role-checkboxes">
                    {#each roles as role}
                      <label class="role-checkbox">
                        <input
                          type="checkbox"
                          checked={settings.allowedRoleIds.includes(role.id)}
                          on:change={() => toggleRole(role.id)}
                        />
                        <span>{role.name}</span>
                      </label>
                    {/each}
                  </div>
                </div>
                <div class="settings-field">
                  <label class="settings-label">Data Retention</label>
                  <select class="settings-select" bind:value={settings.retention} disabled={!settings.enabled}>
                    {#each retentionOptions as opt}
                      <option value={opt.id}>{opt.label}</option>
                    {/each}
                  </select>
                </div>
              </div>
            </section>

            <!-- Scheduled Reports -->
            <section class="settings-section">
              <div class="settings-section__header">
                <div>
                  <h4>Scheduled Reports</h4>
                  <p>Automatically post analytics summaries to a channel.</p>
                </div>
                <label class="toggle-switch">
                  <input 
                    type="checkbox" 
                    bind:checked={settings.schedule.enabled} 
                    disabled={!settings.enabled}
                    on:change={() => (saveStatus = null)} 
                  />
                  <span class="toggle-switch__slider"></span>
                </label>
              </div>
              {#if settings.schedule.enabled}
                <div class="schedule-grid">
                  <div class="settings-field">
                    <label class="settings-label">Frequency</label>
                    <select class="settings-select" bind:value={settings.schedule.frequency} disabled={!settings.enabled}>
                      {#each scheduleFrequencies as opt}
                        <option value={opt.id}>{opt.label}</option>
                      {/each}
                    </select>
                  </div>
                  <div class="settings-field">
                    <label class="settings-label">Day</label>
                    <select class="settings-select" bind:value={settings.schedule.dayOfWeek} disabled={!settings.enabled}>
                      <option value={1}>Monday</option>
                      <option value={2}>Tuesday</option>
                      <option value={3}>Wednesday</option>
                      <option value={4}>Thursday</option>
                      <option value={5}>Friday</option>
                    </select>
                  </div>
                  <div class="settings-field">
                    <label class="settings-label">Time (UTC)</label>
                    <input type="time" class="settings-input" bind:value={settings.schedule.timeUtc} disabled={!settings.enabled} />
                  </div>
                  <div class="settings-field">
                    <label class="settings-label">Post to Channel</label>
                    <select class="settings-select" bind:value={settings.schedule.targetChannelId} disabled={!settings.enabled}>
                      <option value="">Select channel</option>
                      {#each channels.filter((c) => c.type === 'text') as channel}
                        <option value={channel.id}>#{channel.name}</option>
                      {/each}
                    </select>
                  </div>
                </div>
              {/if}
            </section>

            <!-- Save Status -->
            {#if saveStatus}
              <div class="save-status save-status--success">{saveStatus}</div>
            {/if}
            {#if saveError}
              <div class="save-status save-status--error">{saveError}</div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <footer class="modal-footer">
        <button class="btn-ghost" on:click={close}>Close</button>
        {#if activeTab === 'setup'}
          <button class="btn-primary" on:click={() => persistSettings()} disabled={savingSettings}>
            {savingSettings ? 'Saving...' : 'Save Settings'}
          </button>
        {/if}
      </footer>
    </div>
  </div>
{/if}

<style>
  /* Modal Base - matches ServerSettingsModal theme */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    padding: 1rem;
  }

  .modal-container {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 64rem;
    height: min(700px, calc(100vh - 3rem));
    background: var(--color-panel);
    border: 1px solid var(--color-border-subtle);
    border-radius: 1rem;
    box-shadow: 
      0 0 0 1px rgba(255, 255, 255, 0.05),
      0 25px 50px -12px rgba(0, 0, 0, 0.5),
      0 0 100px -20px rgba(51, 200, 191, 0.15);
    overflow: hidden;
  }

  /* Header - matches ServerSettingsModal gradient header */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--color-accent) 8%, var(--color-panel)),
      var(--color-panel)
    );
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .modal-header__left {
    display: flex;
    align-items: center;
    gap: 0.875rem;
  }

  .modal-header__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    background: linear-gradient(135deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 70%, #8b5cf6));
    border-radius: 0.625rem;
    color: white;
    font-size: 1.25rem;
    box-shadow: 0 4px 12px rgba(51, 200, 191, 0.3);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .modal-header__subtitle {
    margin: 0.125rem 0 0;
    font-size: 0.75rem;
    color: var(--text-70);
  }

  .modal-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border: none;
    border-radius: 0.5rem;
    background: transparent;
    color: var(--text-70);
    font-size: 1.5rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .modal-close:hover {
    background: var(--color-panel-muted);
    color: var(--color-text-primary);
  }

  .modal-close:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  /* Tabs */
  .modal-tabs {
    display: flex;
    gap: 4px;
    padding: 0 1.25rem;
    border-bottom: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 50%, var(--surface-root));
  }

  .modal-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0.875rem 1.125rem;
    border: none;
    background: none;
    color: var(--text-70);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    position: relative;
    transition: color 0.15s ease;
  }

  .modal-tab:hover:not(:disabled) {
    color: var(--color-text-primary);
  }

  .modal-tab--active {
    color: var(--color-accent);
  }

  .modal-tab--active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--color-accent);
    border-radius: 2px 2px 0 0;
  }

  .modal-tab:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .modal-tab i {
    font-size: 1rem;
  }

  /* Content */
  .modal-content {
    flex: 1;
    overflow-y: auto;
    padding: clamp(1rem, 2.5vw, 1.5rem);
    background: var(--color-panel);
  }

  /* Footer */
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 50%, var(--surface-root));
  }

  .btn-ghost {
    padding: 0.625rem 1.125rem;
    border: 1px solid var(--color-border-subtle);
    background: transparent;
    border-radius: 0.5rem;
    color: var(--text-70);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-ghost:hover {
    background: var(--color-panel-muted);
    color: var(--color-text-primary);
  }

  .btn-primary {
    padding: 0.625rem 1.25rem;
    border: none;
    border-radius: 0.5rem;
    background: linear-gradient(135deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 70%, #8b5cf6));
    color: white;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    box-shadow: 0 2px 8px rgba(51, 200, 191, 0.2);
  }

  .btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 16px rgba(51, 200, 191, 0.3);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Analytics View */
  .analytics-view {
    display: flex;
    flex-direction: column;
    gap: clamp(1rem, 2vw, 1.5rem);
  }

  /* Analytics Sub-tabs */
  .analytics-subtabs {
    display: flex;
    gap: 4px;
    padding: 4px;
    background: var(--color-panel-muted);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg, 0.75rem);
  }

  .analytics-subtab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0.625rem 1rem;
    border: none;
    background: transparent;
    border-radius: var(--radius-md, 0.5rem);
    color: var(--text-70);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .analytics-subtab:hover {
    color: var(--color-text-primary);
    background: var(--color-panel);
  }

  .analytics-subtab--active {
    background: var(--color-panel);
    color: var(--color-accent);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .analytics-subtab i {
    font-size: 1rem;
  }

  .filters-bar {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    padding: clamp(0.875rem, 2vw, 1.125rem);
    background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg, 0.75rem);
  }

  .filters-row {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .filter-item {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .filter-label {
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-60);
    font-weight: 600;
  }

  .filter-select,
  .filter-input {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md, 0.5rem);
    background: var(--color-panel);
    color: var(--color-text-primary);
    font-size: 0.8125rem;
    min-width: 8.5rem;
    transition: all 0.15s ease;
  }

  .filter-select:focus,
  .filter-input:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 15%, transparent);
  }

  .export-btn,
  .refresh-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.875rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md, 0.5rem);
    background: var(--color-panel);
    color: var(--text-70);
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .export-btn:hover,
  .refresh-btn:hover {
    background: var(--color-panel-muted);
    color: var(--color-text-primary);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .refresh-btn .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .cache-info {
    font-size: 0.6875rem;
    color: var(--text-60);
    padding: 0.25rem 0;
  }

  /* Metrics Grid - card style matches settings-card */
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.75rem;
  }

  .metric-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: clamp(0.875rem, 2vw, 1.125rem);
    border-radius: var(--radius-lg, 0.75rem);
    background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
    border: 1px solid var(--color-border-subtle);
    transition: all 0.15s ease;
  }

  .metric-card:hover {
    border-color: color-mix(in srgb, var(--color-accent) 30%, var(--color-border-subtle));
  }

  .metric-card--primary {
    background: linear-gradient(135deg, color-mix(in srgb, #f97316 12%, var(--color-panel-muted)) 0%, color-mix(in srgb, #f97316 5%, var(--color-panel-muted)) 100%);
    border-color: color-mix(in srgb, #f97316 25%, var(--color-border-subtle));
  }

  .metric-card__icon {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--radius-md, 0.5rem);
    background: var(--color-panel);
    display: grid;
    place-items: center;
    font-size: 1rem;
    color: var(--text-70);
  }

  .metric-card__icon--success { color: #4ade80; background: color-mix(in srgb, #4ade80 12%, var(--color-panel)); }
  .metric-card__icon--info { color: #38bdf8; background: color-mix(in srgb, #38bdf8 12%, var(--color-panel)); }
  .metric-card__icon--warning { color: #fbbf24; background: color-mix(in srgb, #fbbf24 12%, var(--color-panel)); }
  .metric-card__icon--accent { color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, var(--color-panel)); }

  .metric-card__data {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .metric-card__value {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  .metric-card__label {
    font-size: 0.625rem;
    color: var(--text-60);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    font-weight: 500;
  }

  /* Charts - card style matches settings-card */
  .charts-row {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 0.75rem;
  }

  @media (max-width: 768px) {
    .charts-row {
      grid-template-columns: 1fr;
    }
  }

  .chart-card {
    padding: clamp(0.875rem, 2vw, 1.125rem);
    border-radius: var(--radius-lg, 0.75rem);
    background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
    border: 1px solid var(--color-border-subtle);
  }

  .chart-card--wide {
    grid-column: span 1;
  }

  .chart-card__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .chart-card__header h4 {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .chart-card__subtitle {
    font-size: 0.6875rem;
    color: var(--text-60);
  }

  .chart-area {
    min-height: 110px;
  }

  .bar-chart {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    height: 110px;
    padding-bottom: 1.25rem;
  }

  .bar-group {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    min-width: 1.5rem;
  }

  .bar {
    width: 100%;
    max-width: 2rem;
    background: linear-gradient(180deg, var(--color-accent) 0%, color-mix(in srgb, var(--color-accent) 40%, transparent) 100%);
    border-radius: 4px 4px 2px 2px;
    display: flex;
    justify-content: center;
    padding-top: 4px;
    transition: height 0.3s ease;
  }

  .bar--opened {
    background: linear-gradient(180deg, #f97316 0%, color-mix(in srgb, #f97316 40%, transparent) 100%);
  }

  .bar-value {
    font-size: 0.6rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .bar-label {
    font-size: 0.6rem;
    color: var(--text-60);
    white-space: nowrap;
  }

  .chart-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-60);
    font-size: 0.8125rem;
  }

  /* Status Bars */
  .status-bars {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  .status-item {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .status-item__header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: var(--text-70);
  }

  .status-item__value {
    margin-left: auto;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-dot--open { background: #f97316; }
  .status-dot--progress { background: #fbbf24; }
  .status-dot--closed { background: #4ade80; }

  .status-bar {
    height: 6px;
    background: var(--color-panel-muted);
    border-radius: 3px;
    overflow: hidden;
  }

  .status-bar__fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .status-bar__fill--open { background: #f97316; }
  .status-bar__fill--progress { background: #fbbf24; }
  .status-bar__fill--closed { background: #4ade80; }

  /* Team Section */
  .team-section {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 0.75rem;
  }

  .team-card {
    padding: clamp(0.875rem, 2vw, 1.125rem);
    border-radius: var(--radius-lg, 0.75rem);
    background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
    border: 1px solid var(--color-border-subtle);
  }

  .team-card__header {
    margin-bottom: 0.875rem;
  }

  .team-card__header h4 {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text-primary);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .team-card__header i {
    color: var(--color-accent);
  }

  .leaderboard {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .leaderboard-row {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0.625rem;
    border-radius: var(--radius-md, 0.5rem);
    background: var(--color-panel-muted);
  }

  .leaderboard-rank {
    font-size: 1rem;
    width: 1.75rem;
    text-align: center;
  }

  .leaderboard-name {
    flex: 1;
    font-size: 0.8125rem;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .leaderboard-stats {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .leaderboard-count {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--color-accent);
  }

  .leaderboard-time {
    font-size: 0.625rem;
    color: var(--text-60);
  }

  .team-empty {
    color: var(--text-60);
    font-size: 0.8125rem;
    text-align: center;
    padding: 1.25rem;
  }

  /* Type List */
  .type-list {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .type-row {
    display: grid;
    grid-template-columns: 6rem 1fr 2.5rem;
    align-items: center;
    gap: 0.625rem;
  }

  .type-label {
    font-size: 0.75rem;
    color: var(--text-70);
    text-transform: capitalize;
  }

  .type-bar {
    height: 6px;
    background: var(--color-panel-muted);
    border-radius: 3px;
    overflow: hidden;
  }

  .type-bar__fill {
    height: 100%;
    background: var(--color-accent);
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .type-count {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-primary);
    text-align: right;
  }

  /* Issues Section */
  .issues-section {
    border-radius: var(--radius-lg, 0.75rem);
    background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
    border: 1px solid var(--color-border-subtle);
    overflow: hidden;
  }

  .issues-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: clamp(0.875rem, 2vw, 1.125rem);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .issues-header h4 {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .issues-count {
    font-size: 0.6875rem;
    color: var(--text-60);
  }

  .issues-table {
    overflow-x: auto;
  }

  .issues-row {
    display: grid;
    grid-template-columns: 80px 1fr 100px 90px 90px 70px 90px;
    gap: 0.75rem;
    padding: 0.75rem 1.125rem;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
    font-size: 0.75rem;
    color: var(--text-70);
    text-align: left;
    background: transparent;
    border-left: none;
    border-right: none;
    border-top: none;
    width: 100%;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .issues-row:hover:not(.issues-row--header) {
    background: var(--color-panel-muted);
  }

  .issues-row--header {
    background: color-mix(in srgb, var(--color-panel) 50%, var(--surface-root));
    font-weight: 600;
    color: var(--text-60);
    text-transform: uppercase;
    font-size: 0.625rem;
    letter-spacing: 0.03em;
    cursor: default;
  }

  .issue-id {
    font-family: 'JetBrains Mono', monospace;
    color: var(--text-60);
  }

  .issue-channel {
    color: var(--color-accent);
  }

  .issue-status {
    font-weight: 600;
    text-transform: capitalize;
  }

  .issue-status--opened { color: #f97316; }
  .issue-status--in_progress { color: #fbbf24; }
  .issue-status--closed { color: #4ade80; }

  .issue-date {
    color: var(--text-60);
  }

  .issues-more {
    padding: 0.75rem 1.125rem;
    font-size: 0.6875rem;
    color: var(--text-60);
    text-align: center;
  }

  .issues-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 2.5rem;
    color: var(--text-60);
  }

  .issues-empty i {
    font-size: 2rem;
    opacity: 0.5;
  }

  /* Loading & Error States */
  .loading-state,
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 3.75rem 1.25rem;
    color: var(--text-60);
  }

  .spinner {
    width: 2rem;
    height: 2rem;
    border: 3px solid var(--color-panel-muted);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-state i {
    font-size: 2rem;
    color: #f87171;
  }

  /* Settings View - matches ServerSettingsPanel */
  .settings-view {
    display: flex;
    flex-direction: column;
    gap: clamp(1rem, 2vw, 1.5rem);
  }

  .settings-section {
    padding: clamp(1.1rem, 2.4vw, 1.6rem);
    border-radius: var(--radius-lg, 0.75rem);
    background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
    border: 1px solid var(--color-border-subtle);
  }

  .settings-section h4 {
    margin: 0 0 0.25rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .settings-section p {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-60);
  }

  .settings-section__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .settings-description {
    margin-bottom: 0.875rem !important;
  }

  /* Toggle Switch */
  .toggle-switch {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    cursor: pointer;
  }

  .toggle-switch input {
    display: none;
  }

  .toggle-switch__slider {
    width: 2.75rem;
    height: 1.5rem;
    background: var(--color-panel-muted);
    border: 1px solid var(--color-border-subtle);
    border-radius: 0.75rem;
    position: relative;
    transition: all 0.2s ease;
  }

  .toggle-switch__slider::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 1.125rem;
    height: 1.125rem;
    background: var(--color-text-primary);
    border-radius: 50%;
    transition: transform 0.2s ease;
  }

  .toggle-switch input:checked + .toggle-switch__slider {
    background: var(--color-accent);
  }

  .toggle-switch input:checked + .toggle-switch__slider::after {
    transform: translateX(20px);
  }

  .toggle-switch__label {
    font-size: 0.8125rem;
    color: var(--text-70);
  }

  /* Channel Grid */
  .channel-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.625rem;
  }

  .channel-checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-md, 0.5rem);
    background: var(--color-panel);
    border: 1px solid var(--color-border-subtle);
    cursor: pointer;
    transition: all 0.15s ease;
    font-size: 0.8125rem;
    color: var(--text-70);
  }

  .channel-checkbox:hover {
    background: var(--color-panel-muted);
    border-color: color-mix(in srgb, var(--color-accent) 30%, var(--color-border-subtle));
  }

  .channel-checkbox input {
    accent-color: var(--color-accent);
  }

  .channel-checkbox input:checked + .channel-checkbox__indicator + span {
    color: var(--color-text-primary);
  }

  /* Staff Grid */
  .staff-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1.25rem;
    margin-top: 0.875rem;
  }

  .staff-column {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .settings-label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-60);
  }

  .settings-input,
  .settings-select {
    width: 100%;
    padding: 0.625rem 0.75rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md, 0.5rem);
    background: var(--color-panel);
    color: var(--color-text-primary);
    font-size: 0.8125rem;
    transition: all 0.15s ease;
  }

  .settings-input:focus,
  .settings-select:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 15%, transparent);
  }

  .settings-input:disabled,
  .settings-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .domain-input-row {
    display: flex;
    gap: 0.5rem;
  }

  .add-btn {
    padding: 0.625rem 1rem;
    border: none;
    border-radius: var(--radius-md, 0.5rem);
    background: var(--color-panel-muted);
    color: var(--color-text-primary);
    font-size: 0.8125rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .add-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-accent) 15%, var(--color-panel-muted));
  }

  .add-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .suggestions {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem;
    border-radius: var(--radius-md, 0.5rem);
    background: var(--surface-root);
    border: 1px solid var(--color-border-subtle);
  }

  .suggestion {
    padding: 0.5rem 0.625rem;
    border: none;
    border-radius: var(--radius-sm, 0.375rem);
    background: transparent;
    color: var(--text-80);
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .suggestion:hover {
    background: var(--color-panel-muted);
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    min-height: 2rem;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.625rem;
    border-radius: 1.25rem;
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-accent);
    font-size: 0.75rem;
  }

  .tag button {
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
    opacity: 0.7;
    transition: opacity 0.15s ease;
  }

  .tag button:hover {
    opacity: 1;
  }

  .tag--domain {
    background: color-mix(in srgb, #38bdf8 12%, transparent);
    color: #38bdf8;
  }

  .settings-empty,
  .settings-empty-inline {
    color: var(--text-60);
    font-size: 0.8125rem;
  }

  /* Settings Row */
  .settings-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12.5rem, 1fr));
    gap: 1.25rem;
    margin-top: 0.875rem;
  }

  .settings-field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .role-checkboxes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .role-checkbox {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.625rem;
    border-radius: var(--radius-sm, 0.375rem);
    background: var(--color-panel);
    border: 1px solid var(--color-border-subtle);
    font-size: 0.75rem;
    color: var(--text-70);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .role-checkbox:hover {
    background: var(--color-panel-muted);
    border-color: color-mix(in srgb, var(--color-accent) 30%, var(--color-border-subtle));
  }

  .role-checkbox input {
    accent-color: var(--color-accent);
  }

  /* Schedule Grid */
  .schedule-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.875rem;
    margin-top: 0.875rem;
  }

  /* Save Status */
  .save-status {
    padding: 0.75rem 1rem;
    border-radius: var(--radius-md, 0.5rem);
    font-size: 0.8125rem;
    text-align: center;
  }

  .save-status--success {
    background: color-mix(in srgb, #4ade80 10%, transparent);
    border: 1px solid color-mix(in srgb, #4ade80 20%, transparent);
    color: #4ade80;
  }

  .save-status--error {
    background: color-mix(in srgb, #f87171 10%, transparent);
    border: 1px solid color-mix(in srgb, #f87171 20%, transparent);
    color: #f87171;
  }

  /* Staff Tab Styles */
  .staff-tab {
    display: flex;
    flex-direction: column;
    gap: clamp(1rem, 2vw, 1.5rem);
  }

  .staff-table-container {
    overflow-x: auto;
    border-radius: var(--radius-lg, 0.75rem);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 50%, var(--surface-root));
  }

  .staff-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .staff-table th {
    padding: 0.875rem 1rem;
    text-align: left;
    font-weight: 600;
    color: var(--text-60);
    background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
    border-bottom: 1px solid var(--color-border-subtle);
    white-space: nowrap;
  }

  .staff-table td {
    padding: 0.875rem 1rem;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
    color: var(--text-90);
  }

  .staff-table tbody tr:hover {
    background: var(--color-panel-muted);
  }

  .staff-table tbody tr:last-child td {
    border-bottom: none;
  }

  .staff-name {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    font-weight: 500;
  }

  .staff-name i {
    font-size: 1.25rem;
    color: var(--color-accent);
  }

  .staff-stat {
    font-variant-numeric: tabular-nums;
  }

  .staff-stat--highlight {
    color: #4ade80;
    font-weight: 600;
  }

  .staff-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12.5rem, 1fr));
    gap: 1rem;
  }

  .staff-summary-card {
    display: flex;
    align-items: center;
    gap: 0.875rem;
    padding: clamp(0.875rem, 2vw, 1.125rem);
    background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg, 0.75rem);
  }

  .staff-summary-card__icon {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: var(--radius-md, 0.5rem);
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    display: grid;
    place-items: center;
    font-size: 1.25rem;
    color: var(--color-accent);
  }

  .staff-summary-card__data {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .staff-summary-card__value {
    font-size: 1.0625rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .staff-summary-card__label {
    font-size: 0.6875rem;
    color: var(--text-60);
  }

  .staff-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3.75rem 1.25rem;
    text-align: center;
    color: var(--text-60);
  }

  .staff-empty i {
    font-size: 3rem;
    margin-bottom: 1rem;
    opacity: 0.5;
  }

  .staff-empty p {
    font-size: 1rem;
    margin: 0 0 0.5rem;
    color: var(--text-70);
  }

  .staff-empty__hint {
    font-size: 0.8125rem;
    color: var(--text-60);
  }

  /* Tickets Tab Styles */
  .tickets-tab {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .tickets-table-container {
    overflow-x: auto;
    border-radius: var(--radius-lg, 0.75rem);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 50%, var(--surface-root));
  }

  .tickets-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .tickets-table th {
    padding: 0.875rem 1rem;
    text-align: left;
    font-weight: 600;
    color: var(--text-60);
    background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
    border-bottom: 1px solid var(--color-border-subtle);
    white-space: nowrap;
  }

  .tickets-table .th-description {
    min-width: 15.625rem;
  }

  .tickets-table td {
    padding: 0.875rem 1rem;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
    color: var(--text-80);
    vertical-align: middle;
  }

  .tickets-table tbody tr:hover {
    background: var(--color-panel-muted);
  }

  .tickets-table tbody tr:last-child td {
    border-bottom: none;
  }

  .ticket-row--closed {
    opacity: 0.7;
  }

  .ticket-description {
    max-width: 18.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-90);
  }

  .ticket-channel {
    color: var(--color-accent);
    font-weight: 500;
  }

  .ticket-status-badge {
    display: inline-block;
    padding: 0.25rem 0.625rem;
    border-radius: 1.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .ticket-status-badge--opened {
    background: color-mix(in srgb, #fbbf24 15%, transparent);
    color: #fbbf24;
  }

  .ticket-status-badge--in_progress {
    background: color-mix(in srgb, #3b82f6 15%, transparent);
    color: #3b82f6;
  }

  .ticket-status-badge--closed {
    background: color-mix(in srgb, #4ade80 15%, transparent);
    color: #4ade80;
  }

  .ticket-resolver {
    font-weight: 500;
  }

  .ticket-resolution-time,
  .ticket-date {
    font-variant-numeric: tabular-nums;
    color: var(--text-60);
  }

  .tickets-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md, 0.5rem);
    font-size: 0.8125rem;
    color: var(--text-60);
  }

  .tickets-resolved {
    color: #4ade80;
    font-weight: 500;
  }

  .tickets-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3.75rem 1.25rem;
    text-align: center;
    color: var(--text-60);
  }

  .tickets-empty i {
    font-size: 3rem;
    margin-bottom: 1rem;
    opacity: 0.5;
  }

  .tickets-empty p {
    font-size: 1rem;
    margin: 0;
    color: var(--text-70);
  }
</style>

