<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { goto } from '$app/navigation';

import {
  fetchTicketAiIssues,
  fetchTicketAiSettings,
  issuesToCsv,
  normalizeSettings,
  saveTicketAiSettings,
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

  let activeTab: 'setup' | 'analytics' = 'setup';
  let settings: TicketAiSettings = normalizeSettings();
  let settingsLoadedFor: string | null = null;
  let loadingSettings = false;
  let savingSettings = false;
  let saveStatus: string | null = null;
  let saveError: string | null = null;
  let showAnalyticsBanner = false;
  let staffSearch = '';

  let issues: TicketAiIssue[] = [];
  let issuesLoading = false;
  let issuesError: string | null = null;
  let filteredIssues: TicketAiIssue[] = [];
  let insights: string[] = [];
  let focusedMetric: string | null = null;
  let drilldownEl: HTMLDivElement | null = null;
  let lastRangeKey = '';
  let staffSuggestions: MemberOption[] = [];
  let staffDomainInput = '';

  // SLA configuration (response within X minutes)
  const SLA_TARGET_MINUTES = 60;

  let filters = {
    timeRange: '30d',
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
    lastRangeKey = '';
  }

  const defaultAllowedRoles = () => {
    const ownerRole = roles.find((role: RoleOption) => role.isOwnerRole);
    const adminish = roles.find((role: RoleOption) => /admin/i.test(role.name));
    return [ownerRole?.id, adminish?.id].filter(Boolean) as string[];
  };

  onMount(() => {
    if (open) {
      void hydrateSettings();
    }
  });

  $: if (open && serverId && settingsLoadedFor !== serverId && !loadingSettings) {
    void hydrateSettings();
  }

  $: if (open && activeTab === 'analytics' && !issuesLoading) {
    const range = resolveRange();
    const key = `${serverId}-${range.start?.toISOString() ?? 'none'}-${range.end?.toISOString() ?? 'none'}`;
    if (key !== lastRangeKey) {
      lastRangeKey = key;
      void hydrateIssues(range);
    }
  }

  $: filteredIssues = issues
    .filter((issue) => (filters.channelId === 'all' ? true : issue.channelId === filters.channelId))
    .filter((issue) => (filters.status === 'all' ? true : issue.status === filters.status))
    .filter((issue) => (filters.type === 'all' ? true : (issue.typeTag ?? 'other') === filters.type));

  $: insights = buildInsights(filteredIssues);

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

  async function hydrateIssues(range = resolveRange()) {
    if (!serverId) return;
    issuesLoading = true;
    issuesError = null;
    try {
      const data = await fetchTicketAiIssues(serverId, {
        start: range.start ?? undefined,
        end: range.end ?? undefined
      });
      issues = data;
    } catch (err) {
      console.error('[TicketAIModal] failed to load issues', err);
      issuesError = 'Unable to load issue analytics right now.';
    } finally {
      issuesLoading = false;
    }
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
        showAnalyticsBanner = true;
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
    const map = new Map<string, { label: string; ts: number; value: number }>();
    for (const row of rows) {
      const ms = toMillis(row.createdAt) ?? Date.now();
      const day = new Date(ms);
      const label = `${day.getMonth() + 1}/${day.getDate()}`;
      const bucketKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
      const current = map.get(bucketKey);
      if (current) {
        current.value += 1;
      } else {
        map.set(bucketKey, { label, ts: day.getTime(), value: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
  };

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
  function staffLeaderboard(rows: TicketAiIssue[]): Array<{ uid: string; name: string; count: number }> {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.status === 'closed' && row.staffMemberIds?.length) {
        for (const uid of row.staffMemberIds) {
          map.set(uid, (map.get(uid) ?? 0) + 1);
        }
      }
    }
    return Array.from(map.entries())
      .map(([uid, count]) => ({ uid, name: memberLabel(uid), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
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

  function buildInsights(rows: TicketAiIssue[]): string[] {
    const list: string[] = [];
    const avgFirst = average(rows.map((r) => r.timeToFirstResponseMs ?? null));
    const avgResolution = average(rows.map((r) => r.timeToResolutionMs ?? null));
    const openCount = rows.filter((r) => r.status !== 'closed').length;
    const inProgressCount = rows.filter((r) => r.status === 'in_progress').length;
    const closedCount = rows.filter((r) => r.status === 'closed').length;
    const typeMap = typeBreakdown(rows);
    const busiestType = Object.entries(typeMap).sort((a, b) => b[1] - a[1])[0];
    const slaRate = calcSlaCompliance(rows);
    const reopenedCount = countReopened(rows);
    const leaderboard = staffLeaderboard(rows);

    // Response time insight
    if (avgFirst) {
      const minutes = avgFirst / (60 * 1000);
      if (minutes < 30) {
        list.push(`🚀 Excellent response time: ${formatDuration(avgFirst)} average.`);
      } else if (minutes < 60) {
        list.push(`✅ Good response time: ${formatDuration(avgFirst)} average.`);
      } else {
        list.push(`⚠️ Response time could improve: ${formatDuration(avgFirst)} average.`);
      }
    }

    // SLA compliance insight
    if (slaRate !== null) {
      if (slaRate >= 90) {
        list.push(`🎯 ${slaRate.toFixed(0)}% of issues responded within ${SLA_TARGET_MINUTES} min SLA.`);
      } else if (slaRate >= 70) {
        list.push(`📊 ${slaRate.toFixed(0)}% SLA compliance — room for improvement.`);
      } else {
        list.push(`🔴 ${slaRate.toFixed(0)}% SLA compliance — needs attention.`);
      }
    }

    // Resolution time insight
    if (avgResolution) {
      const hours = avgResolution / (60 * 60 * 1000);
      if (hours < 4) {
        list.push(`⚡ Fast resolution: averaging ${formatDuration(avgResolution)}.`);
      } else if (hours < 24) {
        list.push(`📈 Resolution time: ${formatDuration(avgResolution)} average.`);
      } else {
        list.push(`📉 Resolution taking ${formatDuration(avgResolution)} on average.`);
      }
    }

    // Open issues insight
    if (openCount > 0) {
      const pct = rows.length > 0 ? ((openCount / rows.length) * 100).toFixed(0) : 0;
      list.push(`📋 ${openCount} open issue${openCount > 1 ? 's' : ''} (${pct}% of total).`);
    }

    // Reopened insight
    if (reopenedCount > 0) {
      list.push(`🔄 ${reopenedCount} issue${reopenedCount > 1 ? 's' : ''} reopened after closure.`);
    }

    // Type insight
    if (busiestType && busiestType[1] > 0 && rows.length >= 5) {
      const pct = ((busiestType[1] / rows.length) * 100).toFixed(0);
      list.push(`📌 ${busiestType[0].replace('_', ' ')} issues are most common (${pct}%).`);
    }

    // Top performer insight
    if (leaderboard.length > 0 && leaderboard[0].count > 1) {
      list.push(`🏆 Top responder: ${leaderboard[0].name} (${leaderboard[0].count} resolved).`);
    }

    if (!list.length) list.push('📊 Not enough data yet — monitor a few channels to see trends.');
    return list;
  }

  function focusMetric(key: string) {
    focusedMetric = key;
    queueMicrotask(() => drilldownEl?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function handleExportCsv() {
    const csv = issuesToCsv(filteredIssues);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ticket-ai-${serverId}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleGeneratePdf() {
    const lines = [
      `Ticket AI report for ${serverName}`,
      `Range: ${resolveRange().label}`,
      `Open issues: ${filteredIssues.filter((i) => i.status !== 'closed').length}`,
      `Avg first response: ${formatDuration(
        average(filteredIssues.map((r) => r.timeToFirstResponseMs ?? null))
      )}`,
      `Avg resolution: ${formatDuration(
        average(filteredIssues.map((r) => r.timeToResolutionMs ?? null))
      )}`,
      '',
      'Top insights:',
      ...insights
    ];
    const blob = new Blob([lines.join('\n')], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ticket-ai-${serverId}-${Date.now()}.pdf`;
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
    class="ticket-ai-backdrop"
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
    <div class="ticket-ai-modal" role="document" tabindex="-1">
      <div class="ticket-ai-header">
        <div>
          <p class="eyebrow">Ticket AI</p>
          <h2>Issue analytics</h2>
          <p class="subtitle">
            Monitor issue threads in selected channels and track response quality without touching the chat UI.
          </p>
        </div>
        <button class="settings-chip-btn" aria-label="Close" on:click={close}>
          <i class="bx bx-x"></i>
        </button>
      </div>

      <div class="ticket-ai-tabs">
        <button class:active={activeTab === 'setup'} on:click={() => (activeTab = 'setup')}>Setup</button>
        <button
          class:active={activeTab === 'analytics'}
          on:click={() => (activeTab = 'analytics')}
          disabled={!settings.enabled}
        >
          Analytics
        </button>
      </div>

      {#if showAnalyticsBanner}
        <div class="ticket-ai-banner">Ticket AI is enabled. Analytics are ready for this server.</div>
      {/if}

      {#if activeTab === 'setup'}
        <div class="ticket-ai-body">
          <section class="ticket-ai-section">
            <div class="section-header">
              <div>
                <h3>Enable and access</h3>
                <p>Choose who can see analytics and manage exports.</p>
              </div>
              <label class="settings-switch">
                <input
                  type="checkbox"
                  bind:checked={settings.enabled}
                  on:change={() => (saveStatus = null)}
                />
                <span>{settings.enabled ? 'Enabled' : 'Disabled'}</span>
              </label>
            </div>
            {#if !settings.enabled}
              <p class="muted">Turn on Ticket AI to unlock monitoring and analytics.</p>
            {/if}
            <div class="grid two-col">
              <div>
                <p class="settings-label">Who can view issue analytics</p>
                <div class="pill-list">
                  {#each roles as role (role.id)}
                    <label class="pill">
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
              <div>
                <p class="settings-label">Retention</p>
                <select
                  class="input"
                  bind:value={settings.retention}
                  disabled={!settings.enabled}
                  on:change={() => (saveStatus = null)}
                >
                  {#each retentionOptions as option}
                    <option value={option.id}>{option.label}</option>
                  {/each}
                </select>
                <p class="settings-caption">
                  Controls how long summaries, timelines, and metrics are kept.
                </p>
              </div>
            </div>
          </section>

          <section class="ticket-ai-section">
            <div class="section-header">
              <div>
                <h3>Monitored channels</h3>
                <p>Issue threads in these channels feed Ticket AI metrics.</p>
              </div>
            </div>
            <div class="pill-list">
              {#each channels.filter((c: Channel) => c.type === 'text') as channel (channel.id)}
                <label class="pill">
                  <input
                    type="checkbox"
                    checked={settings.monitoredChannelIds.includes(channel.id)}
                    on:change={() => toggleChannel(channel.id)}
                  />
                  <span>#{channel.name}</span>
                </label>
              {/each}
              {#if channels.filter((c: Channel) => c.type === 'text').length === 0}
                <p class="muted">No text channels available.</p>
              {/if}
            </div>
          </section>

          <section class="ticket-ai-section">
            <div class="section-header">
              <div>
                <h3>Staff responders</h3>
                <p>Pick staff members or use email domains to identify responders.</p>
              </div>
            </div>
            
            <div class="staff-config-grid">
              <div class="staff-column">
                <p class="settings-label">Individual staff members</p>
                <div class="domain-input">
                  <input
                    class="input"
                    placeholder="Search by name or email"
                    bind:value={staffSearch}
                    disabled={!settings.enabled}
                    on:keydown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addFirstSuggestion();
                      }
                    }}
                  />
                </div>
                <div class="pill-list">
                  {#each staffSuggestions.slice(0, 8) as member (member.uid)}
                    <button type="button" class="pill pill--suggestion" on:click={() => addStaff(member.uid)}>
                      <span>{member.displayName ?? member.nickname ?? member.email ?? member.uid}</span>
                      <i class="bx bx-plus"></i>
                    </button>
                  {/each}
                </div>
                <div class="pill-list">
                  {#each settings.staffMemberIds as uid (uid)}
                    <span class="tag">
                      {memberLabel(uid)}
                      <button type="button" aria-label={`Remove ${memberLabel(uid)}`} on:click={() => removeStaff(uid)}>
                        <i class="bx bx-x"></i>
                      </button>
                    </span>
                  {/each}
                  {#if settings.staffMemberIds.length === 0}
                    <p class="muted">No staff selected.</p>
                  {/if}
                </div>
              </div>

              <div class="staff-column">
                <p class="settings-label">Staff email domains</p>
                <p class="settings-caption">Anyone with these email domains will be recognized as staff.</p>
                <div class="domain-input">
                  <input
                    class="input"
                    placeholder="e.g. @yourcompany.com"
                    bind:value={staffDomainInput}
                    disabled={!settings.enabled}
                    on:keydown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addStaffDomain();
                      }
                    }}
                  />
                  <button
                    type="button"
                    class="btn btn-sm btn-secondary"
                    disabled={!settings.enabled || !staffDomainInput.trim()}
                    on:click={addStaffDomain}
                  >
                    Add domain
                  </button>
                </div>
                <div class="pill-list">
                  {#each settings.staffDomains as domain (domain)}
                    <span class="tag tag--domain">
                      {domain}
                      <button type="button" aria-label={`Remove ${domain}`} on:click={() => removeStaffDomain(domain)}>
                        <i class="bx bx-x"></i>
                      </button>
                    </span>
                  {/each}
                  {#if settings.staffDomains.length === 0}
                    <p class="muted">No domains added.</p>
                  {/if}
                </div>
              </div>
            </div>
          </section>

          <section class="ticket-ai-section">
            <div class="section-header">
              <div>
                <h3>Retention and scheduled reports</h3>
                <p>Keep data fresh and send summary links automatically.</p>
              </div>
            </div>
            <div class="grid two-col">
              <div class="stack">
                <label class="settings-switch">
                  <input
                    type="checkbox"
                    bind:checked={settings.schedule.enabled}
                    disabled={!settings.enabled}
                    on:change={() => (saveStatus = null)}
                  />
                  <span>Enable scheduled reports</span>
                </label>
                <div class="grid two-col">
                  <div>
                    <p class="settings-label">Frequency</p>
                    <select
                      class="input"
                      bind:value={settings.schedule.frequency}
                      disabled={!settings.enabled || !settings.schedule.enabled}
                    >
                      {#each scheduleFrequencies as option}
                        <option value={option.id}>{option.label}</option>
                      {/each}
                    </select>
                  </div>
                  <div>
                    <p class="settings-label">Day</p>
                    <select
                      class="input"
                      bind:value={settings.schedule.dayOfWeek}
                      disabled={!settings.enabled || !settings.schedule.enabled}
                    >
                      <option value={1}>Monday</option>
                      <option value={2}>Tuesday</option>
                      <option value={3}>Wednesday</option>
                      <option value={4}>Thursday</option>
                      <option value={5}>Friday</option>
                      <option value={6}>Saturday</option>
                      <option value={0}>Sunday</option>
                    </select>
                  </div>
                </div>
              </div>
              <div class="grid two-col">
                <div>
                  <p class="settings-label">Time (UTC)</p>
                  <input
                    class="input"
                    type="time"
                    bind:value={settings.schedule.timeUtc}
                    disabled={!settings.enabled || !settings.schedule.enabled}
                  />
                </div>
                <div>
                  <p class="settings-label">Target channel</p>
                  <select
                    class="input"
                    bind:value={settings.schedule.targetChannelId}
                    disabled={!settings.enabled || !settings.schedule.enabled}
                  >
                    <option value={''}>Select a channel</option>
                    {#each channels.filter((c: Channel) => c.type === 'text') as channel (channel.id)}
                      <option value={channel.id}>#{channel.name}</option>
                    {/each}
                  </select>
                </div>
              </div>
            </div>
          </section>

          {#if saveStatus}
            <p class="settings-status settings-status--success">{saveStatus}</p>
          {/if}
          {#if saveError}
            <p class="settings-status settings-status--error">{saveError}</p>
          {/if}

          <div class="actions">
            <button class="btn btn-ghost" type="button" on:click={close}>Cancel</button>
            <div class="actions-right">
              <button class="btn btn-secondary" type="button" on:click={() => persistSettings()} disabled={savingSettings}>
                {savingSettings ? 'Saving…' : 'Save'}
              </button>
              <button
                class="btn btn-primary"
                type="button"
                on:click={() => persistSettings('analytics')}
                disabled={savingSettings || !settings.enabled}
              >
                {savingSettings ? 'Saving…' : 'Save and view analytics'}
              </button>
            </div>
          </div>
        </div>
      {:else}
        <div class="ticket-ai-body">
          <div class="filters">
            <div class="filter-row">
              <label>
                <span>Time range</span>
                <select bind:value={filters.timeRange}>
                  {#each timeRangeOptions as option}
                    <option value={option.id}>{option.label}</option>
                  {/each}
                </select>
              </label>
              {#if filters.timeRange === 'custom'}
                <label>
                  <span>Start</span>
                  <input type="date" bind:value={customStart} />
                </label>
                <label>
                  <span>End</span>
                  <input type="date" bind:value={customEnd} />
                </label>
              {/if}
              <label>
                <span>Channel</span>
                <select bind:value={filters.channelId}>
                  <option value="all">All monitored channels</option>
                  {#each channels.filter((c: Channel) => c.type === 'text') as channel (channel.id)}
                    <option value={channel.id}>#{channel.name}</option>
                  {/each}
                </select>
              </label>
              <label>
                <span>Status</span>
                <select bind:value={filters.status}>
                  <option value="all">All</option>
                  <option value="opened">Open</option>
                  <option value="closed">Closed</option>
                  <option value="in_progress">In progress</option>
                </select>
              </label>
              <label>
                <span>Type</span>
                <select bind:value={filters.type}>
                  <option value="all">All</option>
                  <option value="bug">Bug</option>
                  <option value="feature_request">Feature request</option>
                  <option value="question">Question</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>

            <div class="metrics">
              <button class="metric" type="button" on:click={() => focusMetric('open')}>
                <p>Open issues</p>
                <strong>{filteredIssues.filter((i) => i.status !== 'closed').length}</strong>
              </button>
              <button class="metric" type="button" on:click={() => focusMetric('first')}>
                <p>Avg first response</p>
                <strong>{formatDuration(average(filteredIssues.map((i) => i.timeToFirstResponseMs ?? null)))}</strong>
              </button>
              <button class="metric" type="button" on:click={() => focusMetric('resolution')}>
                <p>Avg resolution</p>
                <strong>{formatDuration(average(filteredIssues.map((i) => i.timeToResolutionMs ?? null)))}</strong>
              </button>
              <button class="metric" type="button" on:click={() => focusMetric('volume')}>
                <p>Total issues</p>
                <strong>{filteredIssues.length}</strong>
              </button>
              <button class="metric" type="button" on:click={() => focusMetric('sla')}>
                <p>SLA compliance</p>
                <strong>
                  {#if calcSlaCompliance(filteredIssues) !== null}
                    {calcSlaCompliance(filteredIssues)?.toFixed(0)}%
                  {:else}
                    —
                  {/if}
                </strong>
              </button>
              <button class="metric" type="button" on:click={() => focusMetric('messages')}>
                <p>Avg messages</p>
                <strong>
                  {#if filteredIssues.length === 0}
                    —
                  {:else}
                    {(filteredIssues.reduce((sum, issue) => sum + (issue.messageCount ?? 0), 0) / filteredIssues.length).toFixed(1)}
                  {/if}
                </strong>
              </button>
              <button class="metric" type="button" on:click={() => focusMetric('reopened')}>
                <p>Reopened</p>
                <strong>{countReopened(filteredIssues)}</strong>
              </button>
              <button class="metric" type="button" on:click={() => focusMetric('closed')}>
                <p>Closed</p>
                <strong>{filteredIssues.filter((i) => i.status === 'closed').length}</strong>
              </button>
            </div>
          </div>

          <div class="charts">
            <div class="chart-card">
              <div class="chart-head">
                <p>Issues over time</p>
              </div>
              {#if issuesLoading}
                <p class="muted">Loading…</p>
              {:else}
                <div class="bar-chart">
                  {#each chartBuckets(filteredIssues) as bucket (bucket.ts)}
                    <div class="bar" style={`height:${Math.min(100, bucket.value * 18)}px`} title={`${bucket.label}: ${bucket.value}`}>
                      <span>{bucket.value}</span>
                      <small>{bucket.label}</small>
                    </div>
                  {/each}
                  {#if chartBuckets(filteredIssues).length === 0}
                    <p class="muted">No data for this window.</p>
                  {/if}
                </div>
              {/if}
            </div>

            <div class="chart-card">
              <div class="chart-head">
                <p>Type breakdown</p>
              </div>
              {#if issuesLoading}
                <p class="muted">Loading…</p>
              {:else}
                <div class="type-breakdown">
                  {#each Object.entries(typeBreakdown(filteredIssues)) as [type, count] (type)}
                    <div class="type-row">
                      <span class="label">{type.replace('_', ' ')}</span>
                      <div class="bar-fill">
                        <div
                          class="bar-inner"
                          style={`width:${Math.min(100, (count / Math.max(filteredIssues.length, 1)) * 100)}%`}
                        ></div>
                      </div>
                      <span class="value">{count}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>

            <div class="chart-card">
              <div class="chart-head">
                <p>Status breakdown</p>
              </div>
              {#if issuesLoading}
                <p class="muted">Loading…</p>
              {:else}
                {@const statuses = statusBreakdown(filteredIssues)}
                <div class="type-breakdown">
                  <div class="type-row">
                    <span class="label status-opened">Open</span>
                    <div class="bar-fill">
                      <div
                        class="bar-inner bar-inner--open"
                        style={`width:${Math.min(100, (statuses.opened / Math.max(filteredIssues.length, 1)) * 100)}%`}
                      ></div>
                    </div>
                    <span class="value">{statuses.opened}</span>
                  </div>
                  <div class="type-row">
                    <span class="label status-in_progress">In progress</span>
                    <div class="bar-fill">
                      <div
                        class="bar-inner bar-inner--progress"
                        style={`width:${Math.min(100, (statuses.in_progress / Math.max(filteredIssues.length, 1)) * 100)}%`}
                      ></div>
                    </div>
                    <span class="value">{statuses.in_progress}</span>
                  </div>
                  <div class="type-row">
                    <span class="label status-closed">Closed</span>
                    <div class="bar-fill">
                      <div
                        class="bar-inner bar-inner--closed"
                        style={`width:${Math.min(100, (statuses.closed / Math.max(filteredIssues.length, 1)) * 100)}%`}
                      ></div>
                    </div>
                    <span class="value">{statuses.closed}</span>
                  </div>
                </div>
              {/if}
            </div>

            <div class="chart-card">
              <div class="chart-head">
                <p>Top responders</p>
              </div>
              {#if issuesLoading}
                <p class="muted">Loading…</p>
              {:else}
                {@const leaders = staffLeaderboard(filteredIssues)}
                {#if leaders.length === 0}
                  <p class="muted">No resolved issues yet.</p>
                {:else}
                  <div class="type-breakdown">
                    {#each leaders as person, i (person.uid)}
                      <div class="type-row">
                        <span class="label">
                          {#if i === 0}🥇{:else if i === 1}🥈{:else if i === 2}🥉{:else}{i + 1}.{/if}
                          {person.name}
                        </span>
                        <div class="bar-fill">
                          <div
                            class="bar-inner bar-inner--leader"
                            style={`width:${Math.min(100, (person.count / Math.max(leaders[0].count, 1)) * 100)}%`}
                          ></div>
                        </div>
                        <span class="value">{person.count}</span>
                      </div>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          </div>

          <div class="insights">
            <p class="eyebrow">AI insights</p>
            <div class="insight-list">
              {#each insights as line, idx}
                <p>{line}</p>
              {/each}
            </div>
          </div>

          <div class="drilldown" bind:this={drilldownEl}>
            <div class="drilldown-head">
              <div>
                <p class="eyebrow">Drilldown</p>
                {#if focusedMetric}
                  <p class="muted">Focused on {focusedMetric.replace('_', ' ')}</p>
                {:else}
                  <p class="muted">Click any metric to jump here.</p>
                {/if}
              </div>
              <div class="export-row">
                <button class="btn btn-ghost" type="button" on:click={handleExportCsv}>Export CSV</button>
                <button class="btn btn-secondary" type="button" on:click={handleGeneratePdf}>Generate PDF report</button>
              </div>
            </div>

            {#if issuesLoading}
              <p class="muted">Loading issues…</p>
            {:else if issuesError}
              <p class="settings-status settings-status--error">{issuesError}</p>
            {:else if filteredIssues.length === 0}
              <p class="muted">No issues match these filters yet.</p>
            {:else}
              <div class="issue-table">
                <div class="issue-row issue-row--head">
                  <span>ID</span>
                  <span>Channel</span>
                  <span>Status</span>
                  <span>Type</span>
                  <span>Created</span>
                  <span>First response</span>
                  <span>Resolution</span>
                  <span>Messages</span>
                </div>
                {#each filteredIssues as issue (issue.id)}
                  <button class="issue-row" type="button" on:click={() => handleRowClick(issue)}>
                    <span class="mono">{issue.threadId.slice(0, 6)}</span>
                    <span>#{channels.find((c: Channel) => c.id === issue.channelId)?.name ?? issue.channelId}</span>
                    <span class={`status status-${issue.status}`}>{issue.status.replace('_', ' ')}</span>
                    <span class="muted">{issue.typeTag ?? 'other'}</span>
                    <span>{formatDate(issue.createdAt)}</span>
                    <span>{formatDuration(issue.timeToFirstResponseMs ?? null)}</span>
                    <span>{formatDuration(issue.timeToResolutionMs ?? null)}</span>
                    <span>{issue.messageCount ?? 0}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .ticket-ai-backdrop {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: color-mix(in srgb, var(--color-app-overlay, rgba(0, 0, 0, 0.6)) 85%, transparent);
    display: grid;
    place-items: center;
    padding: 16px;
  }

  .ticket-ai-modal {
    width: min(980px, 100%);
    max-height: 92vh;
    background: var(--color-panel, #0f141c);
    color: var(--color-text-primary, #f8fafc);
    border-radius: var(--radius-lg, 16px);
    border: 1px solid var(--color-border-subtle, #1f2937);
    box-shadow: var(--shadow-elevated, 0 24px 80px rgba(0, 0, 0, 0.55));
    padding: clamp(18px, 2vw, 24px);
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow: hidden;
  }

  .ticket-ai-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .ticket-ai-header h2 {
    margin: 0;
    font-size: clamp(22px, 2.4vw, 26px);
  }

  .subtitle {
    margin: 6px 0 0;
    color: var(--text-70, rgba(255, 255, 255, 0.68));
  }

  .ticket-ai-tabs {
    display: inline-flex;
    gap: 6px;
    background: color-mix(in srgb, var(--color-panel-muted, #131a24) 70%, transparent);
    padding: 4px;
    border-radius: 12px;
    border: 1px solid var(--color-border-subtle, #1f2937);
    width: fit-content;
  }

  .ticket-ai-tabs button {
    border: none;
    background: transparent;
    color: var(--color-text-secondary, #cbd5e1);
    padding: 8px 12px;
    border-radius: 10px;
    cursor: pointer;
  }

  .ticket-ai-tabs button.active {
    background: color-mix(in srgb, var(--color-accent, #33c8bf) 18%, transparent);
    color: var(--color-text-primary, #fff);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }

  .ticket-ai-banner {
    background: color-mix(in srgb, var(--color-accent, #33c8bf) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent, #33c8bf) 40%, transparent);
    padding: 10px 12px;
    border-radius: 12px;
    color: var(--color-text-primary, #fff);
  }

  .ticket-ai-body {
    overflow: auto;
    padding-right: 6px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .ticket-ai-section {
    border: 1px solid var(--color-border-subtle, #1f2937);
    border-radius: 14px;
    padding: 14px;
    background: color-mix(in srgb, var(--color-panel-muted, #131a24) 60%, transparent);
    display: grid;
    gap: 10px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .grid.two-col {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }

  .stack {
    display: grid;
    gap: 10px;
  }

  .pill-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 12px;
    border: 1px solid var(--color-border-subtle, #1f2937);
    background: color-mix(in srgb, var(--color-panel) 88%, transparent);
    color: var(--color-text-primary);
  }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent, #33c8bf) 14%, transparent);
    color: var(--color-text-primary, #fff);
  }

  .tag button {
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .domain-input {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .muted {
    color: var(--text-70, rgba(255, 255, 255, 0.68));
    margin: 0;
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 6px 0;
  }

  .actions-right {
    display: flex;
    gap: 8px;
  }

  .filters {
    border: 1px solid var(--color-border-subtle, #1f2937);
    border-radius: 14px;
    padding: 12px;
    background: color-mix(in srgb, var(--color-panel-muted, #131a24) 60%, transparent);
    display: grid;
    gap: 10px;
  }

  .filter-row {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .filter-row label {
    display: grid;
    gap: 6px;
    font-size: 13px;
    color: var(--color-text-secondary, #cbd5e1);
  }

  .filter-row select,
  .filter-row input {
    width: 100%;
    padding: 8px;
    border-radius: 10px;
    border: 1px solid var(--color-border-subtle, #1f2937);
    background: var(--color-panel, #0f141c);
    color: var(--color-text-primary);
  }

  .metrics {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  }

  .metric {
    padding: 10px;
    border-radius: 12px;
    border: 1px solid var(--color-border-subtle, #1f2937);
    background: color-mix(in srgb, var(--color-panel) 85%, transparent);
    cursor: pointer;
    transition: transform 120ms ease, border-color 120ms ease;
  }

  .metric:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--color-accent, #33c8bf) 30%, transparent);
  }

  .metric p {
    margin: 0;
    color: var(--text-70, rgba(255, 255, 255, 0.7));
  }

  .metric strong {
    display: block;
    font-size: 20px;
    margin-top: 6px;
  }

  .charts {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  }

  .chart-card {
    border: 1px solid var(--color-border-subtle, #1f2937);
    border-radius: 14px;
    padding: 12px;
    background: color-mix(in srgb, var(--color-panel) 85%, transparent);
  }

  .chart-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .bar-chart {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    min-height: 120px;
  }

  .bar {
    flex: 1;
    min-width: 28px;
    background: linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 60%, transparent), color-mix(in srgb, var(--color-accent) 24%, transparent));
    border-radius: 10px 10px 6px 6px;
    position: relative;
    display: grid;
    place-items: center;
    padding: 6px 4px 10px;
  }

  .bar span {
    font-weight: 700;
  }

  .bar small {
    position: absolute;
    bottom: -18px;
    color: var(--text-70, rgba(255, 255, 255, 0.7));
  }

  .type-breakdown {
    display: grid;
    gap: 8px;
  }

  .type-row {
    display: grid;
    grid-template-columns: 140px 1fr auto;
    align-items: center;
    gap: 8px;
  }

  .bar-fill {
    width: 100%;
    height: 8px;
    background: color-mix(in srgb, var(--color-border-subtle, #1f2937) 40%, transparent);
    border-radius: 999px;
    overflow: hidden;
  }

  .bar-inner {
    height: 100%;
    background: color-mix(in srgb, var(--color-accent, #33c8bf) 60%, transparent);
  }

  .label {
    text-transform: capitalize;
  }

  .value {
    text-align: right;
    color: var(--color-text-secondary, #cbd5e1);
  }

  .insights {
    border: 1px solid var(--color-border-subtle, #1f2937);
    border-radius: 14px;
    padding: 12px;
    background: color-mix(in srgb, var(--color-panel) 85%, transparent);
  }

  .insight-list {
    display: grid;
    gap: 6px;
  }

  .drilldown {
    border: 1px solid var(--color-border-subtle, #1f2937);
    border-radius: 14px;
    padding: 12px;
    background: color-mix(in srgb, var(--color-panel-muted) 65%, transparent);
    display: grid;
    gap: 10px;
  }

  .drilldown-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .export-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .issue-table {
    display: grid;
    gap: 6px;
  }

  .issue-row {
    display: grid;
    grid-template-columns: 90px 1fr 120px 140px 170px 150px 150px 90px;
    gap: 6px;
    align-items: center;
    padding: 8px;
    border-radius: 10px;
    border: 1px solid var(--color-border-subtle, #1f2937);
    background: color-mix(in srgb, var(--color-panel) 80%, transparent);
    color: inherit;
    text-align: left;
  }

  .issue-row--head {
    background: color-mix(in srgb, var(--color-panel-muted) 65%, transparent);
    font-weight: 600;
  }

  .issue-row .status {
    text-transform: capitalize;
    font-weight: 600;
  }

  .status-opened,
  .status-open {
    color: #fbbf24;
  }

  .status-in_progress {
    color: #38bdf8;
  }

  .status-closed {
    color: #34d399;
  }

  .issue-row:hover {
    border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
  }

  .issue-row--head:hover {
    border-color: var(--color-border-subtle, #1f2937);
  }

  .mono {
    font-family: 'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace;
  }

  .eyebrow {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-size: 0.72rem;
    color: var(--text-70, rgba(255, 255, 255, 0.6));
  }

  .settings-label {
    font-size: 13px;
    color: var(--color-text-secondary, #cbd5e1);
  }

  .settings-switch {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .settings-switch input[type='checkbox'] {
    accent-color: var(--color-accent, #33c8bf);
    width: 18px;
    height: 18px;
  }

  .settings-caption {
    color: var(--text-70, rgba(255, 255, 255, 0.68));
    margin: 6px 0 0;
  }

  .btn {
    border: 1px solid transparent;
    border-radius: 10px;
    padding: 8px 14px;
    cursor: pointer;
    font-weight: 600;
  }

  .btn-primary {
    background: var(--color-accent, #33c8bf);
    color: #0b0f16;
  }

  .btn-secondary {
    background: color-mix(in srgb, var(--color-accent, #33c8bf) 20%, transparent);
    color: var(--color-text-primary);
    border-color: color-mix(in srgb, var(--color-accent, #33c8bf) 40%, transparent);
  }

  .btn-ghost {
    background: transparent;
    color: var(--color-text-primary);
    border-color: var(--color-border-subtle, #1f2937);
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .settings-chip-btn {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    border: 1px solid var(--color-border-subtle, #1f2937);
    background: color-mix(in srgb, var(--color-panel-muted) 80%, transparent);
    color: var(--color-text-primary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  /* Staff config grid */
  .staff-config-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  @media (max-width: 640px) {
    .staff-config-grid {
      grid-template-columns: 1fr;
    }
  }

  .staff-column {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .pill--suggestion {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .pill--suggestion i {
    font-size: 14px;
    opacity: 0.7;
  }

  .tag--domain {
    background: color-mix(in srgb, var(--color-accent, #33c8bf) 15%, transparent);
    border-color: color-mix(in srgb, var(--color-accent, #33c8bf) 35%, transparent);
  }

  .btn-sm {
    padding: 6px 10px;
    font-size: 12px;
  }

  /* Status colors */
  .status-opened,
  .status-open {
    color: #f97316;
  }

  .status-in_progress,
  .status-in-progress {
    color: #fbbf24;
  }

  .status-closed {
    color: #22c55e;
  }

  /* Bar inner variants */
  .bar-inner--open {
    background: linear-gradient(90deg, #f97316, #f97316cc);
  }

  .bar-inner--progress {
    background: linear-gradient(90deg, #fbbf24, #fbbf24cc);
  }

  .bar-inner--closed {
    background: linear-gradient(90deg, #22c55e, #22c55ecc);
  }

  .bar-inner--leader {
    background: linear-gradient(90deg, var(--color-accent, #33c8bf), var(--color-accent, #33c8bf)cc);
  }

  /* Metrics grid adjustment for more items */
  .metrics {
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }

  .metric p {
    font-size: 12px;
  }

  .metric strong {
    font-size: 18px;
  }
</style>
