<script lang="ts">
	import type { PageData } from './$types';
	import AdminCard from '$lib/admin/components/AdminCard.svelte';
	import AdminTable from '$lib/admin/components/AdminTable.svelte';
	import ConfirmDialog from '$lib/admin/components/ConfirmDialog.svelte';
	import { softDeleteDocument, hardDeleteDocument } from '$lib/admin/archive';
	import { showAdminToast } from '$lib/admin/stores/toast';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	let search = $state('');
	let authorId = $state(data.initialFilters?.authorId ?? '');
	let serverId = $state(data.initialFilters?.serverId ?? '');
	let dmId = $state(data.initialFilters?.dmId ?? '');
	let pendingAction: {
		messageId: string;
		path: string;
		mode: 'archive' | 'delete';
		preview: string;
	} | null = $state(null);
	let busy = $state(false);

	const filteredMessages = $derived(
		data.messages.filter((message) => {
			if (search && !message.text?.toLowerCase().includes(search.toLowerCase())) return false;
			if (authorId && message.authorId !== authorId) return false;
			if (serverId && message.serverId !== serverId) return false;
			if (dmId && message.dmId !== dmId) return false;
			return true;
		})
	);

	const confirmAction = async () => {
		const action = pendingAction;
		if (!action) return;
		busy = true;
		try {
			if (action.mode === 'archive') {
				await softDeleteDocument(
					{ tab: 'messages', docPath: action.path, reason: 'Manual admin archive' },
					data.user
				);
				showAdminToast({ type: 'warning', message: 'Message archived.' });
			} else {
				await hardDeleteDocument(action.path, data.user, {
					reason: 'Manual admin delete',
					scope: 'messages'
				});
				showAdminToast({ type: 'error', message: 'Message deleted.' });
			}
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Action failed.' });
		} finally {
			busy = false;
			pendingAction = null;
		}
	};
</script>

<section class="mx-auto max-w-6xl px-4">
	<AdminCard title="Messages" description="Global view across channels and DMs." padded={false}>
		<div class="grid gap-4 border-b border-slate-100 px-6 py-4 md:grid-cols-5">
			<input
				type="search"
				placeholder="Search text"
				class="rounded-2xl border border-slate-200 px-4 py-2 text-sm"
				bind:value={search}
			/>
			<input
				type="text"
				placeholder="Author UID"
				class="rounded-2xl border border-slate-200 px-4 py-2 text-sm"
				bind:value={authorId}
			/>
			<input
				type="text"
				placeholder="Server ID"
				class="rounded-2xl border border-slate-200 px-4 py-2 text-sm"
				bind:value={serverId}
			/>
			<input
				type="text"
				placeholder="DM ID"
				class="rounded-2xl border border-slate-200 px-4 py-2 text-sm"
				bind:value={dmId}
			/>
		</div>
		<div class="p-6">
			<AdminTable
				headers={[
					{ label: 'Preview' },
					{ label: 'Author' },
					{ label: 'Location' },
					{ label: 'Created' },
					{ label: 'Actions' }
				]}
			>
				{#if filteredMessages.length === 0}
					<tr>
						<td class="px-4 py-5 text-sm text-slate-500" colspan="5">No messages match.</td>
					</tr>
				{:else}
					{#each filteredMessages as message}
						<tr class="hover:bg-slate-50/80">
							<td class="px-4 py-4 text-sm text-slate-900">
								<p class="font-semibold">{message.text || `[${message.type}]`}</p>
								<p class="text-xs text-slate-500 truncate">{message.id}</p>
							</td>
							<td class="px-4 py-4 text-sm text-slate-500">{message.authorId ?? '—'}</td>
							<td class="px-4 py-4 text-sm text-slate-500">
								{#if message.serverId}
									Server {message.serverId} / Channel {message.channelId ?? '—'}
								{:else if message.dmId}
									DM {message.dmId}
								{:else}
									{message.path}
								{/if}
							</td>
							<td class="px-4 py-4 text-sm text-slate-500">
								{message.createdAt ? message.createdAt.toLocaleString() : '—'}
							</td>
							<td class="px-4 py-4 text-right space-x-2">
								<button
									type="button"
									class="rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-600"
									onclick={() =>
										(pendingAction = {
											messageId: message.id,
											path: message.path,
											mode: 'archive',
											preview: message.text ?? message.id
										})}
								>
									Archive
								</button>
								<button
									type="button"
									class="rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600"
									onclick={() =>
										(pendingAction = {
											messageId: message.id,
											path: message.path,
											mode: 'delete',
											preview: message.text ?? message.id
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
	</AdminCard>
</section>

<ConfirmDialog
	open={Boolean(pendingAction)}
	title={pendingAction?.mode === 'archive' ? 'Archive message' : 'Delete message'}
	body={pendingAction?.mode === 'archive'
		? `Message "${pendingAction?.preview ?? ''}" will be moved to archive.`
		: `Message "${pendingAction?.preview ?? ''}" will be permanently deleted.`}
	confirmLabel={pendingAction?.mode === 'archive' ? 'Archive' : 'Delete'}
	tone={pendingAction?.mode === 'archive' ? 'default' : 'danger'}
	{busy}
	on:confirm={confirmAction}
	on:cancel={() => (pendingAction = null)}
/>
