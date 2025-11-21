<script lang="ts">
  import type { PageData } from './$types';
  import { browser } from '$app/environment';
  import AdminCard from '$lib/admin/components/AdminCard.svelte';
  import { FEATURE_FLAGS, type FeatureFlagKey, type FeatureFlagMeta } from '$lib/admin/types';
  import { featureFlagsStore, updateFeatureFlag } from '$lib/admin/featureFlags';
  import { showAdminToast } from '$lib/admin/stores/toast';
  import type { ServerInvite } from '$lib/firestore/invites';
  import DomainInvitePrompt from '$lib/components/app/DomainInvitePrompt.svelte';
  import { triggerTestPush } from '$lib/notify/testPush';
  import { setTheme, resetThemeToSystem, type ThemeMode } from '$lib/stores/theme';
  import { LAST_LOCATION_STORAGE_KEY, RESUME_DM_SCROLL_KEY } from '$lib/constants/navigation';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  const remoteFlags = featureFlagsStore();
  const flags = $derived({ ...data.featureFlags, ...$remoteFlags });
  let pending: Record<FeatureFlagKey, boolean> = $state({} as Record<FeatureFlagKey, boolean>);
  const DOMAIN_INVITE_STORAGE_KEY = 'domainAutoInviteDismissals';
  const LAST_SERVER_KEY = 'hconnect:last-server';
  const LAST_SERVER_CHANNEL_KEY = 'hconnect:last-server-channel';
  const VOICE_DEBUG_KEYS = [
    'hconnect:voice:debug-panel-open',
    'hconnect:voice:debug',
    'hconnect:voice:debug.quickstats'
  ];
  let previewInvite: ServerInvite | null = $state(null);
  let testPushLoading = $state(false);
  type FeatureSectionConfig = {
    id: string;
    title: string;
    description: string;
    keys: FeatureFlagKey[];
    accent?: 'ai' | 'ops';
  };
  type FeatureSection = {
    id: string;
    title: string;
    description: string;
    flags: FeatureFlagMeta[];
    accent?: 'ai' | 'ops';
  };
  const sectionDefinitions: FeatureSectionConfig[] = [
    {
      id: 'core',
      title: 'Core Platform',
      description: 'Enable baseline access to servers, channels, and invites.',
      keys: ['enableServers', 'enableChannels', 'enableServerCreation', 'enableInviteLinks', 'enableDMs', 'enablePresence']
    },
    {
      id: 'engagement',
      title: 'Engagement & Media',
      description: 'Control media, reactions, and delivery polish across the app.',
      keys: [
        'enableReactions',
        'enableFileUploads',
        'enableVoice',
        'enableVideo',
        'enableNotifications',
        'enableTypingIndicators',
        'enableReadReceipts'
      ]
    },
    {
      id: 'messages',
      title: 'Message Controls',
      description: 'Set edit and delete abilities to match your compliance posture.',
      keys: ['enableMessageEditing', 'enableMessageDeleting']
    },
    {
      id: 'ai',
      title: 'AI Assist Surfaces',
      description: 'Individually disable the AI experiences in chat.',
      keys: ['enableAIFeatures', 'enableAISuggestedReplies', 'enableAIPredictions', 'enableAISummaries'],
      accent: 'ai'
    },
    {
      id: 'ops',
      title: 'Ops & QA',
      description: 'Safety, lockdown, and debugging switches.',
      keys: ['readOnlyMode', 'showNotificationDebugTools'],
      accent: 'ops'
    }
  ];
  const flagMetaMap = new Map<FeatureFlagKey, FeatureFlagMeta>(FEATURE_FLAGS.map((flag) => [flag.key, flag]));
  const trackedKeys = new Set<FeatureFlagKey>();
  const sectionBlocks: FeatureSection[] = sectionDefinitions
    .map((section) => {
      section.keys.forEach((key) => trackedKeys.add(key));
      return {
        id: section.id,
        title: section.title,
        description: section.description,
        accent: section.accent,
        flags: section.keys
          .map((key) => flagMetaMap.get(key))
          .filter((flag): flag is FeatureFlagMeta => Boolean(flag))
      };
    })
    .filter((section) => section.flags.length);
  const leftoverFlags = FEATURE_FLAGS.filter((flag) => !trackedKeys.has(flag.key));
  const featureSections: FeatureSection[] =
    leftoverFlags.length > 0
      ? [
          ...sectionBlocks,
          {
            id: 'misc',
            title: 'Additional toggles',
            description: 'Flags that still need a dedicated home.',
            flags: leftoverFlags
          }
        ]
      : sectionBlocks;

  const toggleFlag = async (key: FeatureFlagKey) => {
    const nextValue = !flags[key];
    pending = { ...pending, [key]: true };
    try {
      await updateFeatureFlag(key, nextValue, data.user);
      showAdminToast({
        type: 'success',
        message: `${FEATURE_FLAGS.find((item) => item.key === key)?.label ?? key} set to ${
          nextValue ? 'enabled' : 'disabled'
        }.`
      });
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Unable to update flag.' });
    } finally {
      pending = { ...pending, [key]: false };
    }
  };

  const handleResetDomainPrompt = () => {
    if (!browser) {
      showAdminToast({ type: 'info', message: 'Open an in-browser admin session to reset the prompt here.' });
      return;
    }
    try {
      localStorage.removeItem(DOMAIN_INVITE_STORAGE_KEY);
      showAdminToast({ type: 'success', message: 'Domain invite prompt reset for this device.' });
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: 'Unable to reset local storage.' });
    }
  };

  const openSplashDemo = () => {
    if (!browser) {
      showAdminToast({ type: 'info', message: 'Splash preview is available in browser sessions only.' });
      return;
    }
    window.open('/splash', '_blank', 'noopener');
  };

  const buildSampleInvite = (): ServerInvite => ({
    id: '__domain_preview__',
    toUid: data?.user?.uid ?? 'tester',
    fromUid: 'auto',
    fromDisplayName: 'Auto Invite',
    serverId: 'preview-server',
    serverName: 'QA Review Workspace',
    serverIcon: 'https://avatars.githubusercontent.com/u/9919?v=4',
    channelId: 'launch-updates',
    channelName: 'launch-updates',
    type: 'domain-auto',
    status: 'pending',
    createdAt: {
      toMillis: () => Date.now()
    } as any
  });

  const triggerDomainPromptPreview = () => {
    if (!browser) {
      showAdminToast({ type: 'info', message: 'Open this page in the browser to test the invite prompt.' });
      return;
    }
    previewInvite = buildSampleInvite();
    showAdminToast({ type: 'success', message: 'Sample invite prompt displayed.' });
    window.dispatchEvent(
      new CustomEvent('domain-invite-test', {
        detail: previewInvite
      })
    );
  };

  const closePreviewInvite = () => {
    previewInvite = null;
  };

  const handlePreviewAccept = () => {
    showAdminToast({ type: 'success', message: 'Sample invite accepted.' });
    closePreviewInvite();
  };

  const handlePreviewDecline = () => {
    showAdminToast({ type: 'info', message: 'Sample invite declined.' });
    closePreviewInvite();
  };

  const handleSendTestPush = async () => {
    if (!browser) {
      showAdminToast({ type: 'info', message: 'Push testing requires a browser session.' });
      return;
    }
    testPushLoading = true;
    try {
      const result = await triggerTestPush();
      if (result.ok) {
        const count = result.tokens ?? 0;
        const suffix = count === 1 ? 'device' : 'devices';
        showAdminToast({
          type: 'success',
          message: count > 0 ? `Test push sent to ${count} ${suffix}.` : 'Test push sent.'
        });
      } else {
        const reason =
          result.reason === 'missing_device'
            ? 'Open hConnect on this device and enable notifications first.'
            : 'Callable reported a failure.';
        showAdminToast({ type: 'warning', message: reason });
      }
    } catch (error) {
      console.error('triggerTestPush failed', error);
      showAdminToast({
        type: 'error',
        message: 'Unable to send test push notification.'
      });
    } finally {
      testPushLoading = false;
    }
  };

  const previewTheme = (mode: ThemeMode, label: string) => {
    if (!browser) {
      showAdminToast({ type: 'info', message: 'Open this page in the browser to preview themes.' });
      return;
    }
    setTheme(mode, { persist: false });
    showAdminToast({ type: 'success', message: `${label} theme preview applied for this session.` });
  };

  const handleResetThemePreference = () => {
    if (!browser) {
      showAdminToast({ type: 'info', message: 'Open this page in the browser to reset theme preferences.' });
      return;
    }
    resetThemeToSystem();
    showAdminToast({ type: 'success', message: 'Theme preference reset to match the system default.' });
  };

  const resetNavigationMemory = () => {
    if (!browser) {
      showAdminToast({ type: 'info', message: 'Navigation cache reset is available in-browser only.' });
      return;
    }
    try {
      localStorage.removeItem(LAST_SERVER_KEY);
      localStorage.removeItem(LAST_SERVER_CHANNEL_KEY);
      localStorage.removeItem(LAST_LOCATION_STORAGE_KEY);
      localStorage.removeItem(RESUME_DM_SCROLL_KEY);
      showAdminToast({ type: 'success', message: 'Server shortcuts and scroll memory cleared.' });
    } catch (error) {
      console.error('resetNavigationMemory failed', error);
      showAdminToast({ type: 'error', message: 'Unable to reset navigation cache.' });
    }
  };

  const resetVoiceDebugState = () => {
    if (!browser) {
      showAdminToast({ type: 'info', message: 'Voice debug reset is available in-browser only.' });
      return;
    }
    try {
      VOICE_DEBUG_KEYS.forEach((key) => localStorage.removeItem(key));
      showAdminToast({ type: 'success', message: 'Voice debug toggles cleared for this device.' });
    } catch (error) {
      console.error('resetVoiceDebugState failed', error);
      showAdminToast({ type: 'error', message: 'Unable to clear voice debug state.' });
    }
  };
</script>

<section class="admin-page h-full w-full">
  <div class="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)] lg:items-start">
    <div class="min-h-0">
      <AdminCard title="Feature Toggles" description="Flip platform capabilities instantly." padded={false}>
        <div class="flex h-full flex-col">
          <div class="flex-1 overflow-y-auto px-6 py-5">
            <div class="space-y-6 pb-2">
              {#each featureSections as section (section.id)}
                <section
                  class={`space-y-4 ${
                    section.accent
                      ? 'pt-4'
                      : 'border-t border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] pt-6 first:border-t-0 first:pt-0'
                  } ${
                    section.accent === 'ai'
                      ? 'rounded-3xl border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)96%,transparent)] px-6 pb-4'
                      : ''
                  } ${
                    section.accent === 'ops'
                      ? 'rounded-3xl bg-[color-mix(in_srgb,var(--surface-panel)92%,transparent)] px-5 pb-3'
                      : ''
                  }`}
                >
                  <div class="flex flex-col gap-1 text-[color:var(--color-text-primary,#0f172a)]">
                    {#if section.accent === 'ai'}
                      <span class="mb-1 inline-flex items-center rounded-full bg-gradient-to-r from-sky-400/30 to-emerald-400/30 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                        AI
                      </span>
                    {:else if section.accent === 'ops'}
                      <span class="mb-1 inline-flex items-center rounded-full bg-rose-400/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-800">
                        Ops
                      </span>
                    {/if}
                    <h3 class="text-[1.05rem] font-semibold tracking-tight">{section.title}</h3>
                    <p class="text-sm text-[color:color-mix(in_srgb,var(--text-70,#6b7280)85%,transparent)]">
                      {section.description}
                    </p>
                  </div>
                  <div class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
                    {#each section.flags as flag (flag.key)}
                      <label
                        class="flex min-h-[156px] flex-col justify-between rounded-3xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)94%,transparent)] p-5 shadow-sm transition hover:shadow-lg"
                        for={`flag-${flag.key}`}
                      >
                        <div>
                          <div class="flex items-start justify-between gap-4">
                            <div class="flex-1">
                              <p class="text-base font-semibold text-[color:var(--color-text-primary,#0f172a)]">{flag.label}</p>
                              <p class="text-sm text-[color:var(--text-60,#6b7280)]">{flag.description}</p>
                            </div>
                            <button
                              id={`flag-${flag.key}`}
                              type="button"
                              class="relative h-6 w-11 shrink-0 rounded-full transition"
                              class:bg-slate-200={!flags[flag.key]}
                              class:bg-emerald-500={flags[flag.key]}
                              aria-pressed={flags[flag.key]}
                              aria-label={`Toggle ${flag.label}`}
                              title={`Toggle ${flag.label}`}
                              onclick={() => toggleFlag(flag.key)}
                              disabled={pending[flag.key]}
                            >
                              <span
                                class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition"
                                class:translate-x-5={flags[flag.key]}
                              ></span>
                            </button>
                          </div>
                        </div>
                        <div class="mt-4 flex items-center justify-between">
                          <span
                            class="rounded-full px-3 py-1 text-xs font-semibold"
                            style:background={flags[flag.key] ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.08)'}
                            style:color={flags[flag.key] ? '#0f766e' : '#e2e8f0'}
                          >
                            {flags[flag.key] ? 'Enabled' : 'Disabled'}
                          </span>
                          {#if pending[flag.key]}
                            <span class="text-xs text-white/60">Updating...</span>
                          {/if}
                        </div>
                      </label>
                    {/each}
                  </div>
                </section>
              {/each}
            </div>
          </div>
        </div>
      </AdminCard>
    </div>

    <div class="min-h-0">
      <AdminCard title="Feature Testing" description="Quick shortcuts for QA routines.">
        <div class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
          <article class="space-y-3 rounded-[1.25rem] border border-[color:color-mix(in_srgb,var(--surface-panel)35%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)75%,transparent)] p-5">
            <div>
              <h4 class="text-base font-semibold text-[color:var(--color-text-primary,#0f172a)]">Domain auto-invite prompt</h4>
              <p class="text-sm text-[color:color-mix(in_srgb,var(--text-70,#475569)90%,transparent)]">
                Clears the local dismissal flag so the new domain invite modal reappears for pending invites.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="rounded-full bg-gradient-to-r from-emerald-400/80 to-cyan-300/80 px-4 py-2 text-sm font-semibold text-slate-900 shadow transition hover:opacity-90"
                onclick={handleResetDomainPrompt}
              >
                Reset prompt dismissal
              </button>
              <a
                class="rounded-full border border-[color:color-mix(in_srgb,var(--surface-panel)40%,transparent)] px-4 py-2 text-sm text-inherit no-underline transition hover:border-white/40"
                href="/settings#invites"
                target="_blank"
                rel="noreferrer"
              >
                Open invite inbox
              </a>
              <button
                type="button"
                class="rounded-full border border-dashed border-[color:color-mix(in_srgb,var(--surface-panel)40%,transparent)] px-4 py-2 text-sm font-semibold transition hover:border-[color:color-mix(in_srgb,var(--surface-panel)60%,transparent)]"
                onclick={triggerDomainPromptPreview}
              >
                Show sample invite
              </button>
            </div>
          </article>
          <article class="space-y-3 rounded-[1.25rem] border border-[color:color-mix(in_srgb,var(--surface-panel)35%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)75%,transparent)] p-5">
            <div>
              <h4 class="text-base font-semibold text-[color:var(--color-text-primary,#0f172a)]">Splash screen preview</h4>
              <p class="text-sm text-[color:color-mix(in_srgb,var(--text-70,#475569)90%,transparent)]">
                Opens the standalone splash page in a new tab so you can confirm animation and branding tweaks.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="rounded-full bg-gradient-to-r from-emerald-400/80 to-cyan-300/80 px-4 py-2 text-sm font-semibold text-slate-900 shadow transition hover:opacity-90"
                onclick={openSplashDemo}
              >
                Open splash demo
              </button>
            </div>
          </article>
          <article class="space-y-3 rounded-[1.25rem] border border-[color:color-mix(in_srgb,var(--surface-panel)35%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)75%,transparent)] p-5">
            <div>
              <h4 class="text-base font-semibold text-[color:var(--color-text-primary,#0f172a)]">Push delivery test</h4>
              <p class="text-sm text-[color:color-mix(in_srgb,var(--text-70,#475569)90%,transparent)]">
                Sends the callable <code>sendTestPush</code> request to this device to confirm push wiring.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="rounded-full bg-gradient-to-r from-amber-300/80 via-rose-300/80 to-pink-400/80 px-4 py-2 text-sm font-semibold text-slate-900 shadow transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                onclick={handleSendTestPush}
                disabled={testPushLoading}
              >
                {testPushLoading ? 'Sending…' : 'Send test push'}
              </button>
            </div>
          </article>
          <article class="space-y-3 rounded-[1.25rem] border border-[color:color-mix(in_srgb,var(--surface-panel)35%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)75%,transparent)] p-5">
            <div>
              <h4 class="text-base font-semibold text-[color:var(--color-text-primary,#0f172a)]">Theme labs</h4>
              <p class="text-sm text-[color:color-mix(in_srgb,var(--text-70,#475569)90%,transparent)]">
                Preview alternate themes instantly or reset back to the system default.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                onclick={() => previewTheme('holiday', 'Holiday')}
              >
                Preview Holiday
              </button>
              <button
                type="button"
                class="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                onclick={() => previewTheme('midnight', 'Midnight')}
              >
                Preview Midnight
              </button>
              <button
                type="button"
                class="rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-slate-900 shadow transition hover:bg-white"
                onclick={handleResetThemePreference}
              >
                Reset theme
              </button>
            </div>
          </article>
          <article class="space-y-3 rounded-[1.25rem] border border-[color:color-mix(in_srgb,var(--surface-panel)35%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)75%,transparent)] p-5">
            <div>
              <h4 class="text-base font-semibold text-[color:var(--color-text-primary,#0f172a)]">Navigation cache</h4>
              <p class="text-sm text-[color:color-mix(in_srgb,var(--text-70,#475569)90%,transparent)]">
                Clears remembered servers, channels, and DM scroll markers stored on this device.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="rounded-full border border-dashed border-white/30 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/70 hover:bg-white/5"
                onclick={resetNavigationMemory}
              >
                Reset navigation cache
              </button>
            </div>
          </article>
          <article class="space-y-3 rounded-[1.25rem] border border-[color:color-mix(in_srgb,var(--surface-panel)35%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)75%,transparent)] p-5">
            <div>
              <h4 class="text-base font-semibold text-[color:var(--color-text-primary,#0f172a)]">Voice debug state</h4>
              <p class="text-sm text-[color:color-mix(in_srgb,var(--text-70,#475569)90%,transparent)]">
                Clears the toggles that keep the voice debug panel or quick stats pinned open.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="rounded-full border border-dashed border-white/30 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/70 hover:bg-white/5"
                onclick={resetVoiceDebugState}
              >
                Reset voice debug
              </button>
            </div>
          </article>
        </div>
      </AdminCard>
    </div>
  </div>
</section>
<DomainInvitePrompt
  invite={previewInvite}
  busy={false}
  error={null}
  onAccept={handlePreviewAccept}
  onDecline={handlePreviewDecline}
  onDismiss={closePreviewInvite}
/>

