<script lang="ts">
	import type { PageData } from './$types';
	import AdminCard from '$lib/admin/components/AdminCard.svelte';
	import AdminTable from '$lib/admin/components/AdminTable.svelte';
	import ConfirmDialog from '$lib/admin/components/ConfirmDialog.svelte';
	import type { ArchiveEntry } from '$lib/admin/archive';
	import { deleteArchiveEntry, fetchArchiveEntries, restoreArchiveEntry } from '$lib/admin/archive';
	import type { ArchiveTab } from '$lib/admin/types';
	import { showAdminToast } from '$lib/admin/stores/toast';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	let activeTab: ArchiveTab = $state('servers');
	let filters: Record<ArchiveTab, { search: string }> = $state({
		servers: { search: '' },
		channels: { search: '' },
		messages: { search: '' },
		dms: { search: '' },
		attachments: { search: '' }
	});
	let archiveData: Record<ArchiveTab, ArchiveEntry[]> = $state(data.initialArchive);
	let loading = $state(false);
	let confirmAction: {
		tab: ArchiveTab;
		id: string;
		mode: 'restore' | 'delete';
		label: string;
	} | null = $state(null);

	const filteredEntries = $derived(
		(archiveData[activeTab] ?? []).filter((entry) => {
			const search = filters[activeTab].search.toLowerCase();
			if (!search) return true;
			const source =
				`${entry.entityId ?? ''} ${entry.reason ?? ''} ${entry.originalPath ?? ''}`.toLowerCase();
			return source.includes(search);
		})
	);

	const refreshTab = async () => {
		loading = true;
		try {
			archiveData = {
				...archiveData,
				[activeTab]: await fetchArchiveEntries(activeTab)
			};
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Unable to load archive.'
			});
		} finally {
			loading = false;
		}
	};

	const handleConfirm = async () => {
		if (!confirmAction) return;
		loading = true;
		try {
			if (confirmAction.mode === 'restore') {
				await restoreArchiveEntry(confirmAction.tab, confirmAction.id, data.user);
				showAdminToast({ type: 'success', message: 'Entry restored.' });
			} else {
				await deleteArchiveEntry(confirmAction.tab, confirmAction.id, data.user);
				showAdminToast({ type: 'warning', message: 'Entry permanently deleted.' });
			}
			confirmAction = null;
			await refreshTab();
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Action failed.' });
		} finally {
			loading = false;
		}
	};
</script>

<section class="admin-page h-full w-full">
	<div class="archive-panel">
		<AdminCard
			title="Archive"
			description="Soft deleted entities live here until restored or purged."
			padded={false}
		>
			<div class="flex flex-wrap gap-2 border-b border-slate-100 px-6 py-4">
				{#each Object.keys(filters) as tab}
					<button
						type="button"
						class="rounded-full px-4 py-2 text-sm font-semibold transition"
						class:bg-gradient-to-r={tab === activeTab}
						class:from-teal-500={tab === activeTab}
						class:to-cyan-500={tab === activeTab}
						class:text-white={tab === activeTab}
						class:bg-[color-mix(in_srgb,#14b8a6_10%,transparent)]={tab !== activeTab}
						class:text-[color:var(--color-text-primary,#0f172a)]={tab !== activeTab}
						class:border={tab !== activeTab}
						class:border-[color-mix(in_srgb,#14b8a6_40%,transparent)]={tab !== activeTab}
						onclick={() => (activeTab = tab as ArchiveTab)}
					>
						{(tab as string).charAt(0).toUpperCase() + (tab as string).slice(1)}
					</button>
				{/each}
			</div>
			<div class="flex h-full flex-col space-y-4 p-6 overflow-hidden">
				<div class="settings-callout">
					<div>
						<p class="settings-callout__title">Retention &amp; purge controls</p>
						<p class="settings-callout__subtitle">
							Adjust auto-expiration rules and safety settings before restoring or purging data.
						</p>
					</div>
					<a href="/admin/settings" class="settings-callout__action"> Open Settings </a>
				</div>
				<div class="flex flex-wrap items-center gap-3">
					<input
						type="search"
						placeholder="Search ID, path, or reason"
						class="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm md:w-72"
						bind:value={filters[activeTab].search}
					/>
					<button
						type="button"
						class="rounded-2xl bg-gradient-to-r from-teal-500 to-cyan-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
						onclick={refreshTab}
						disabled={loading}
					>
						{loading ? 'Loading…' : 'Refresh'}
					</button>
				</div>

				<div class="flex-1 overflow-y-auto">
					<AdminTable
						headers={[
							{ label: 'Entity' },
							{ label: 'Reason' },
							{ label: 'Deleted By' },
							{ label: 'Created' },
							{ label: 'Actions' }
						]}
					>
						{#if filteredEntries.length === 0}
							<tr>
								<td class="px-4 py-5 text-sm text-slate-500" colspan="5">Archive is empty.</td>
							</tr>
						{:else}
							{#each filteredEntries as entry}
								<tr class="hover:bg-slate-50/80">
									<td class="px-4 py-4 text-sm text-slate-900">
										<p class="font-semibold">{entry.entityId ?? entry.id}</p>
										{#if entry.originalPath}
											<p class="text-xs text-slate-500">{entry.originalPath}</p>
										{/if}
									</td>
									<td class="px-4 py-4 text-sm text-slate-500">{entry.reason ?? '—'}</td>
									<td class="px-4 py-4 text-sm text-slate-500"
										>{entry.deletedBy?.email ?? entry.deletedBy?.uid ?? '—'}</td
									>
									<td class="px-4 py-4 text-sm text-slate-500">
										{entry.createdAt ? entry.createdAt.toLocaleString() : '—'}
									</td>
									<td class="px-4 py-4 text-right space-x-2">
										<button
											type="button"
											class="rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 px-3 py-1 text-xs font-semibold text-white shadow hover:opacity-90"
											onclick={() =>
												(confirmAction = {
													tab: activeTab,
													id: entry.id,
													mode: 'restore',
													label: entry.entityId ?? entry.id
												})}
										>
											Restore
										</button>
										<button
											type="button"
											class="rounded-full border border-[color-mix(in_srgb,#14b8a6_40%,transparent)] px-3 py-1 text-xs font-semibold text-[color:var(--color-text-primary,#0f172a)] hover:bg-[color-mix(in_srgb,#14b8a6_10%,transparent)]"
											onclick={() =>
												(confirmAction = {
													tab: activeTab,
													id: entry.id,
													mode: 'delete',
													label: entry.entityId ?? entry.id
												})}
										>
											Delete
										</button>
									</td>
								</tr>
							{/each}
						{/if}
					</AdminTable>
				</div>
			</div>
		</AdminCard>
	</div>
</section>

<ConfirmDialog
	open={Boolean(confirmAction)}
	title={confirmAction?.mode === 'restore' ? 'Restore entry' : 'Delete permanently'}
	body={confirmAction?.mode === 'restore'
		? `Restore ${confirmAction?.label ?? ''} to the live collection?`
		: `This permanently removes ${confirmAction?.label ?? ''}. This cannot be undone.`}
	confirmLabel={confirmAction?.mode === 'restore' ? 'Restore' : 'Delete'}
	tone={confirmAction?.mode === 'restore' ? 'default' : 'danger'}
	busy={loading}
	on:confirm={handleConfirm}
	on:cancel={() => (confirmAction = null)}
/>

<style>
	.archive-panel {
		min-height: 0;
	}

	.archive-panel :global(section) {
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.archive-panel :global(section > div:last-child) {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.settings-callout {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.25rem;
		border-radius: 1rem;
		background: color-mix(in srgb, var(--surface-panel) 82%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--surface-highlight) 18%, transparent);
	}

	.settings-callout__title {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.settings-callout__subtitle {
		font-size: 0.85rem;
		color: var(--text-60);
	}

	.settings-callout__action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.55rem 1.15rem;
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: 600;
		background: linear-gradient(135deg, rgba(20, 184, 166, 0.95), rgba(6, 182, 212, 0.9));
		color: #fff;
		border: 1px solid rgba(236, 254, 255, 0.35);
		box-shadow: 0 10px 25px rgba(14, 165, 233, 0.2);
		text-decoration: none;
		transition:
			transform 160ms ease,
			box-shadow 160ms ease;
	}

	.settings-callout__action:hover {
		transform: translateY(-1px);
		box-shadow: 0 16px 30px rgba(14, 165, 233, 0.28);
	}
</style>
