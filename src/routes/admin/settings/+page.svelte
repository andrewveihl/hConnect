<script lang="ts">
  import type { PageData } from './$types';
  import AdminCard from '$lib/admin/components/AdminCard.svelte';
  import { ensureFirebaseReady, getDb } from '$lib/firebase';
  import { doc, setDoc } from 'firebase/firestore';
  import { showAdminToast } from '$lib/admin/stores/toast';
  import { logAdminAction } from '$lib/admin/logs';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let settings = $state({ ...data.settings });
  let saving = $state(false);

  const save = async () => {
    saving = true;
    try {
      await ensureFirebaseReady();
      const db = getDb();
      const payload = {
        ...settings,
        logRetentionDays: Number(settings.logRetentionDays),
        archiveRetentionDays: Number(settings.archiveRetentionDays)
      };
      await setDoc(doc(db, 'appConfig', 'adminSettings'), payload, { merge: true });
      settings = payload;
      await logAdminAction({
        type: 'adminAction',
        level: 'info',
        message: 'Updated admin settings',
        data: {
          action: 'adminSettings:update',
          settings: payload
        },
        userId: data.user.uid
      });
      showAdminToast({ type: 'success', message: 'Settings saved.' });
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Unable to save settings.' });
    } finally {
      saving = false;
    }
  };
</script>

<section class="admin-page max-w-3xl">
<AdminCard title="Retention & Safety" description="Define retention windows and guardrails.">
  <div class="space-y-6">
    <label class="block text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)]">
      Log retention (days)
      <input
        type="number"
        min="1"
        class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm"
        bind:value={settings.logRetentionDays}
      />
    </label>
    <label class="block text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)]">
      Archive retention (days)
      <input
        type="number"
        min="30"
        class="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm"
        bind:value={settings.archiveRetentionDays}
      />
    </label>
    <label class="flex items-center gap-3 text-sm text-[color:var(--color-text-primary,#0f172a)]">
      <input type="checkbox" bind:checked={settings.requireDoubleConfirm} />
      Require double confirmation for destructive actions
    </label>
    <label class="flex items-center gap-3 text-sm text-[color:var(--color-text-primary,#0f172a)]">
      <input type="checkbox" bind:checked={settings.extraLogging} />
      Enable extra debug logging
    </label>
    <button
      type="button"
      class="rounded-2xl bg-gradient-to-r from-teal-500 to-cyan-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
      onclick={save}
      disabled={saving}
    >
      {saving ? 'Saving…' : 'Save settings'}
    </button>
  </div>
</AdminCard>
</section>

