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
	let settings = $state({
		logRetentionDays: 0,
		archiveRetentionDays: 0,
		requireDoubleConfirm: false,
		extraLogging: false
	});
	let saving = $state(false);

	$effect(() => {
		settings = { ...data.settings };
	});

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
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Unable to save settings.'
			});
		} finally {
			saving = false;
		}
	};
</script>

<section class="admin-page h-full w-full max-w-3xl">
	<div class="settings-panel">
		<div class="settings-panel__back">
			<a href="/admin/archive" class="settings-panel__back-link">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<path
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M15 18 9 12l6-6"
					/>
				</svg>
				Back to Archive
			</a>
		</div>
		<AdminCard title="Retention & Safety" description="Define retention windows and guardrails.">
			<div class="flex h-full flex-col">
				<div class="space-y-6 flex-1 overflow-y-auto pr-1">
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
					<label
						class="flex items-center gap-3 text-sm text-[color:var(--color-text-primary,#0f172a)]"
					>
						<input type="checkbox" bind:checked={settings.requireDoubleConfirm} />
						Require double confirmation for destructive actions
					</label>
					<label
						class="flex items-center gap-3 text-sm text-[color:var(--color-text-primary,#0f172a)]"
					>
						<input type="checkbox" bind:checked={settings.extraLogging} />
						Enable extra debug logging
					</label>
				</div>
				<button
					type="button"
					class="rounded-2xl bg-gradient-to-r from-teal-500 to-cyan-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
					onclick={save}
					disabled={saving}
				>
					{saving ? 'Saving...' : 'Save settings'}
				</button>
			</div>
		</AdminCard>
	</div>
</section>

<style>
	.settings-panel {
		min-height: 0;
	}

	.settings-panel__back {
		margin-bottom: 1rem;
	}

	.settings-panel__back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0.9rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 60%, transparent);
		color: var(--color-text-primary);
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
		background: color-mix(in srgb, var(--surface-panel) 82%, transparent);
		transition:
			border 160ms ease,
			color 160ms ease;
	}

	.settings-panel__back-link svg {
		width: 1.05rem;
		height: 1.05rem;
	}

	.settings-panel__back-link:hover {
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
		color: var(--color-accent);
	}

	.settings-panel :global(section) {
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.settings-panel :global(section > div:last-child) {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
</style>
