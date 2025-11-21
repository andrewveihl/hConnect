<script lang="ts">
  import type { PageData } from './$types';
  import { browser } from '$app/environment';
  import AdminCard from '$lib/admin/components/AdminCard.svelte';
  import { FEATURE_FLAGS, type FeatureFlagKey } from '$lib/admin/types';
  import { featureFlagsStore, updateFeatureFlag } from '$lib/admin/featureFlags';
  import { showAdminToast } from '$lib/admin/stores/toast';
  import { ensureFirebaseReady, getDb } from '$lib/firebase';
  import { doc, setDoc } from 'firebase/firestore';
  import type { ServerInvite } from '$lib/firestore/invites';
  import DomainInvitePrompt from '$lib/components/app/DomainInvitePrompt.svelte';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  const remoteFlags = featureFlagsStore();
  const flags = $derived({ ...data.featureFlags, ...$remoteFlags });
  let pending: Record<FeatureFlagKey, boolean> = $state({} as Record<FeatureFlagKey, boolean>);
  let defaultTheme = $state(data.defaultTheme ?? 'dark');
  let themeSaving = $state(false);
  const DOMAIN_INVITE_STORAGE_KEY = 'domainAutoInviteDismissals';
  let previewInvite: ServerInvite | null = $state(null);

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

  const saveDefaultTheme = async () => {
    themeSaving = true;
    try {
      await ensureFirebaseReady();
      const db = getDb();
      await setDoc(
        doc(db, 'appConfig', 'adminSettings'),
        { defaultTheme },
        { merge: true }
      );
      showAdminToast({ type: 'success', message: 'Default theme updated.' });
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Unable to update default theme.' });
    } finally {
      themeSaving = false;
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
</script>

<section class="admin-page h-full w-full">
  <div class="feature-panel">
    <AdminCard title="Feature Toggles" description="Flip platform capabilities instantly." padded={false}>
      <div class="flex h-full flex-col">
        <div class="flex-1 overflow-y-auto p-6">
          <div class="grid gap-4 md:grid-cols-2">
            {#each FEATURE_FLAGS as flag}
              <label
                class="flex flex-col justify-between rounded-3xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)94%,transparent)] p-5 shadow-sm transition hover:shadow-lg"
                for={`flag-${flag.key}`}
              >
                <div>
                  <div class="flex items-center justify-between gap-4">
                    <div>
                      <p class="text-base font-semibold text-[color:var(--color-text-primary,#0f172a)]">{flag.label}</p>
                      <p class="text-sm text-[color:var(--text-60,#6b7280)]">{flag.description}</p>
                    </div>
                    <button
                      id={`flag-${flag.key}`}
                      type="button"
                      class="relative h-6 w-11 rounded-full transition"
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
        </div>
      </div>
    </AdminCard>
  </div>

  <div class="feature-panel">
    <AdminCard title="Default Theme" description="Set the theme new users see on their first login.">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <label class="flex flex-col text-sm font-semibold text-[color:var(--text-70,#475569)]">
          Theme
          <select
            class="mt-2 rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-4 py-2 text-base text-[color:var(--color-text-primary,#0f172a)]"
            bind:value={defaultTheme}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <button
          type="button"
          class="rounded-2xl bg-gradient-to-r from-teal-500 to-cyan-500 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-50"
          disabled={themeSaving}
          onclick={saveDefaultTheme}
        >
          {themeSaving ? 'Saving…' : 'Save theme'}
        </button>
      </div>
    </AdminCard>
  </div>

  <div class="feature-panel">
    <AdminCard title="Feature Testing" description="Quick shortcuts for QA routines.">
      <div class="feature-test-grid">
        <article class="feature-test-card">
          <div>
            <h4>Domain auto-invite prompt</h4>
            <p class="feature-test-copy">
              Clears the local dismissal flag so the new domain invite modal reappears for pending invites.
            </p>
        </div>
        <div class="feature-test-actions">
          <button type="button" class="test-button" onclick={handleResetDomainPrompt}>
            Reset prompt dismissal
          </button>
          <a class="test-link" href="/settings#invites" target="_blank" rel="noreferrer">
            Open invite inbox
          </a>
          <button type="button" class="test-button test-button--ghost" onclick={triggerDomainPromptPreview}>
            Show sample invite
          </button>
        </div>
      </article>
        <article class="feature-test-card">
          <div>
            <h4>Splash screen preview</h4>
            <p class="feature-test-copy">
              Opens the standalone splash page in a new tab so you can confirm animation and branding tweaks.
            </p>
          </div>
          <div class="feature-test-actions">
            <button type="button" class="test-button" onclick={openSplashDemo}>Open splash demo</button>
          </div>
        </article>
      </div>
    </AdminCard>
  </div>
</section>

<style>
  .feature-panel {
    min-height: 0;
  }

  .feature-panel :global(section) {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .feature-panel :global(section > div:last-child) {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .feature-test-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1rem;
  }

  .feature-test-card {
    border-radius: 1.25rem;
    border: 1px solid color-mix(in srgb, var(--surface-panel) 35%, transparent);
    background: color-mix(in srgb, var(--surface-panel) 75%, transparent);
    padding: 1.25rem;
    display: grid;
    gap: 0.75rem;
  }

  .feature-test-card h4 {
    margin: 0 0 0.2rem;
    font-size: 1rem;
    font-weight: 600;
  }

  .feature-test-copy {
    margin: 0;
    color: color-mix(in srgb, var(--text-70,#475569) 90%, transparent);
    font-size: 0.9rem;
    line-height: 1.35;
  }

  .feature-test-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
  }

  .test-button {
    border: none;
    border-radius: 999px;
    padding: 0.5rem 1.2rem;
    font-weight: 600;
    font-size: 0.9rem;
    color: #041014;
    background: linear-gradient(
      130deg,
      color-mix(in srgb, var(--color-accent) 65%, transparent),
      color-mix(in srgb, var(--color-highlight,#22d3ee) 65%, transparent)
    );
    cursor: pointer;
  }

  .test-button--ghost {
    background: transparent;
    color: inherit;
    border: 1px dashed color-mix(in srgb, var(--surface-panel) 40%, transparent);
  }

  .test-link {
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--surface-panel) 40%, transparent);
    padding: 0.45rem 1.1rem;
    font-size: 0.9rem;
    color: inherit;
    text-decoration: none;
  }
</style>

<DomainInvitePrompt
  invite={previewInvite}
  busy={false}
  error={null}
  onAccept={handlePreviewAccept}
  onDecline={handlePreviewDecline}
  onDismiss={closePreviewInvite}
/>
