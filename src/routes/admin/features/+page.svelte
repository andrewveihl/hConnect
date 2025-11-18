<script lang="ts">
  import type { PageData } from './$types';
  import AdminCard from '$lib/admin/components/AdminCard.svelte';
  import { FEATURE_FLAGS, type FeatureFlagKey } from '$lib/admin/types';
  import { featureFlagsStore, updateFeatureFlag } from '$lib/admin/featureFlags';
  import { showAdminToast } from '$lib/admin/stores/toast';
  import { ensureFirebaseReady, getDb } from '$lib/firebase';
  import { doc, setDoc } from 'firebase/firestore';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  const remoteFlags = featureFlagsStore();
  const flags = $derived({ ...data.featureFlags, ...$remoteFlags });
  let pending: Record<FeatureFlagKey, boolean> = $state({} as Record<FeatureFlagKey, boolean>);
  let defaultTheme = $state(data.defaultTheme ?? 'dark');
  let themeSaving = $state(false);

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
</script>

<section class="admin-page space-y-6">
<AdminCard title="Feature Toggles" description="Flip platform capabilities instantly." padded={false}>
  <div class="grid max-h-[70vh] gap-4 overflow-y-auto p-6 md:grid-cols-2">
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
 </AdminCard>

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
</section>
