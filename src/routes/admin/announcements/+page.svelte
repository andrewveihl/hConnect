<script lang="ts">
	import type { PageData } from './$types';
	import type { Announcement } from './+page';
	import AdminCard from '$lib/admin/components/AdminCard.svelte';
	import ConfirmDialog from '$lib/admin/components/ConfirmDialog.svelte';
	import { showAdminToast } from '$lib/admin/stores/toast';
	import { adminNav } from '$lib/admin/stores/adminNav';
	import { ensureFirebaseReady, getDb } from '$lib/firebase';
	import {
		addDoc,
		collection,
		deleteDoc,
		doc,
		serverTimestamp,
		updateDoc
	} from 'firebase/firestore';
	import { isMobileViewport } from '$lib/stores/viewport';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	let announcements = $state<Announcement[]>([...data.announcements]);
	let selectedAnnouncement: Announcement | null = $state(null);
	let isCreating = $state(false);
	let saving = $state(false);
	let deleteConfirm: Announcement | null = $state(null);

	const mobileViewport = $derived($isMobileViewport);

	// Form state
	let form = $state({
		title: '',
		message: '',
		type: 'info' as Announcement['type'],
		active: true,
		dismissible: true,
		targetAudience: 'all' as Announcement['targetAudience'],
		expiresAt: ''
	});

	const activeAnnouncements = $derived(announcements.filter((a) => a.active));
	const inactiveAnnouncements = $derived(announcements.filter((a) => !a.active));

	const resetForm = () => {
		form = {
			title: '',
			message: '',
			type: 'info',
			active: true,
			dismissible: true,
			targetAudience: 'all',
			expiresAt: ''
		};
	};

	const selectAnnouncement = (announcement: Announcement | null) => {
		selectedAnnouncement = announcement;
		isCreating = false;

		if (announcement) {
			form = {
				title: announcement.title,
				message: announcement.message,
				type: announcement.type,
				active: announcement.active,
				dismissible: announcement.dismissible,
				targetAudience: announcement.targetAudience,
				expiresAt: announcement.expiresAt ? announcement.expiresAt.toISOString().slice(0, 16) : ''
			};

			if (mobileViewport) {
				adminNav.showDetail(announcement.id);
			}
		}
	};

	const startCreate = () => {
		selectedAnnouncement = null;
		isCreating = true;
		resetForm();

		if (mobileViewport) {
			adminNav.showDetail();
		}
	};

	const handleSave = async () => {
		if (!form.title.trim() || !form.message.trim()) {
			showAdminToast({ type: 'error', message: 'Title and message are required.' });
			return;
		}

		saving = true;
		try {
			await ensureFirebaseReady();
			const db = getDb();

			const payload = {
				title: form.title.trim(),
				message: form.message.trim(),
				type: form.type,
				active: form.active,
				dismissible: form.dismissible,
				targetAudience: form.targetAudience,
				expiresAt: form.expiresAt ? new Date(form.expiresAt) : null,
				updatedAt: serverTimestamp()
			};

			if (isCreating) {
				const docRef = await addDoc(collection(db, 'announcements'), {
					...payload,
					createdAt: serverTimestamp(),
					createdBy: data.user?.uid ?? null
				});

				const newAnnouncement: Announcement = {
					id: docRef.id,
					...payload,
					createdAt: new Date(),
					updatedAt: new Date(),
					createdBy: data.user?.uid ?? null,
					expiresAt: form.expiresAt ? new Date(form.expiresAt) : null
				};

				announcements = [newAnnouncement, ...announcements];
				selectedAnnouncement = newAnnouncement;
				isCreating = false;
				showAdminToast({ type: 'success', message: 'Announcement created.' });
			} else if (selectedAnnouncement) {
				await updateDoc(doc(db, 'announcements', selectedAnnouncement.id), payload);

				announcements = announcements.map((a) =>
					a.id === selectedAnnouncement!.id
						? {
								...a,
								...payload,
								expiresAt: form.expiresAt ? new Date(form.expiresAt) : null,
								updatedAt: new Date()
							}
						: a
				);
				selectedAnnouncement = announcements.find((a) => a.id === selectedAnnouncement!.id) ?? null;
				showAdminToast({ type: 'success', message: 'Announcement updated.' });
			}
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Failed to save announcement.'
			});
		} finally {
			saving = false;
		}
	};

	const handleDelete = async () => {
		const confirmTarget = deleteConfirm;
		if (!confirmTarget) return;

		saving = true;
		try {
			await ensureFirebaseReady();
			const db = getDb();
			await deleteDoc(doc(db, 'announcements', confirmTarget.id));

			announcements = announcements.filter((a) => a.id !== confirmTarget.id);
			if (selectedAnnouncement?.id === confirmTarget.id) {
				selectedAnnouncement = null;
				isCreating = false;
				if (mobileViewport) {
					adminNav.showContent();
				}
			}

			showAdminToast({ type: 'success', message: 'Announcement deleted.' });
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Failed to delete announcement.'
			});
		} finally {
			saving = false;
			deleteConfirm = null;
		}
	};

	const toggleActive = async (announcement: Announcement) => {
		try {
			await ensureFirebaseReady();
			const db = getDb();
			await updateDoc(doc(db, 'announcements', announcement.id), {
				active: !announcement.active,
				updatedAt: serverTimestamp()
			});

			announcements = announcements.map((a) =>
				a.id === announcement.id ? { ...a, active: !a.active } : a
			);

			if (selectedAnnouncement?.id === announcement.id) {
				selectedAnnouncement = { ...selectedAnnouncement, active: !selectedAnnouncement.active };
				form.active = selectedAnnouncement.active;
			}

			showAdminToast({
				type: 'success',
				message: `Announcement ${!announcement.active ? 'activated' : 'deactivated'}.`
			});
		} catch (err) {
			console.error(err);
			showAdminToast({ type: 'error', message: 'Failed to update announcement.' });
		}
	};

	const formatDate = (date: Date | null) => {
		if (!date) return '--';
		return date.toLocaleDateString();
	};

	const typeConfig = {
		info: { icon: 'bx-info-circle', color: 'sky' },
		warning: { icon: 'bx-error', color: 'amber' },
		success: { icon: 'bx-check-circle', color: 'emerald' },
		error: { icon: 'bx-x-circle', color: 'rose' }
	};
</script>

<div class="admin-page">
	<div class="flex flex-col gap-4 lg:flex-row">
		<!-- List Panel -->
		<div class="flex-1 lg:max-w-md">
			<AdminCard
				title="Announcements"
				description="System-wide alerts and messages."
				padded={false}
			>
				<div class="flex flex-col">
					<!-- Create Button -->
					<div
						class="border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
					>
						<button
							type="button"
							class="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
							onclick={startCreate}
						>
							<i class="bx bx-plus"></i>
							Create Announcement
						</button>
					</div>

					<!-- Active Announcements -->
					<div class="p-4">
						<p
							class="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]"
						>
							Active ({activeAnnouncements.length})
						</p>
						{#if activeAnnouncements.length === 0}
							<p class="py-4 text-center text-sm text-[color:var(--text-60,#6b7280)]">
								No active announcements.
							</p>
						{:else}
							<div class="space-y-2">
								{#each activeAnnouncements as announcement}
									{@const config = typeConfig[announcement.type]}
									<div
										role="button"
										tabindex="0"
										class="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition"
										class:border-[color:var(--accent-primary,#14b8a6)]={selectedAnnouncement?.id ===
											announcement.id}
										class:bg-[color-mix(in_srgb,var(--accent-primary,#14b8a6)8%,transparent)]={selectedAnnouncement?.id ===
											announcement.id}
										class:border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)]={selectedAnnouncement?.id !==
											announcement.id}
										onclick={() => selectAnnouncement(announcement)}
										onkeydown={(event) => {
											if (event.key === 'Enter' || event.key === ' ') {
												event.preventDefault();
												selectAnnouncement(announcement);
											}
										}}
									>
										<div
											class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-{config.color}-500/20"
										>
											<i class="bx {config.icon} text-lg text-{config.color}-500"></i>
										</div>
										<div class="min-w-0 flex-1">
											<p class="truncate font-semibold text-[color:var(--color-text-primary)]">
												{announcement.title}
											</p>
											<p class="truncate text-xs text-[color:var(--text-60,#6b7280)]">
												{announcement.targetAudience}
											</p>
										</div>
										<button
											type="button"
											class="shrink-0 rounded-lg p-1.5 text-emerald-500 transition hover:bg-emerald-500/10"
											onclick={(e) => {
												e.stopPropagation();
												toggleActive(announcement);
											}}
											aria-label="Deactivate"
										>
											<i class="bx bx-toggle-right text-xl"></i>
										</button>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Inactive Announcements -->
					{#if inactiveAnnouncements.length > 0}
						<div
							class="border-t border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] p-4"
						>
							<p
								class="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]"
							>
								Inactive ({inactiveAnnouncements.length})
							</p>
							<div class="space-y-2">
								{#each inactiveAnnouncements as announcement}
									{@const config = typeConfig[announcement.type]}
									<div
										role="button"
										tabindex="0"
										class="flex w-full items-center gap-3 rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-3 text-left opacity-60 transition hover:opacity-100"
										class:border-[color:var(--accent-primary,#14b8a6)]={selectedAnnouncement?.id ===
											announcement.id}
										class:opacity-100={selectedAnnouncement?.id === announcement.id}
										onclick={() => selectAnnouncement(announcement)}
										onkeydown={(event) => {
											if (event.key === 'Enter' || event.key === ' ') {
												event.preventDefault();
												selectAnnouncement(announcement);
											}
										}}
									>
										<div
											class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-500/20"
										>
											<i class="bx {config.icon} text-lg text-slate-400"></i>
										</div>
										<div class="min-w-0 flex-1">
											<p class="truncate font-semibold text-[color:var(--color-text-primary)]">
												{announcement.title}
											</p>
											<p class="truncate text-xs text-[color:var(--text-60,#6b7280)]">
												{formatDate(announcement.createdAt)}
											</p>
										</div>
										<button
											type="button"
											class="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-500/10 hover:text-emerald-500"
											onclick={(e) => {
												e.stopPropagation();
												toggleActive(announcement);
											}}
											aria-label="Activate"
										>
											<i class="bx bx-toggle-left text-xl"></i>
										</button>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</AdminCard>
		</div>

		<!-- Detail/Edit Panel -->
		<div class="flex-1">
			{#if selectedAnnouncement || isCreating}
				<AdminCard
					title={isCreating ? 'New Announcement' : 'Edit Announcement'}
					description={isCreating
						? 'Create a new system announcement.'
						: 'Modify the selected announcement.'}
				>
					<form
						class="space-y-4"
						onsubmit={(e) => {
							e.preventDefault();
							handleSave();
						}}
					>
						<!-- Title -->
						<div>
							<label
								for="announcement-title"
								class="mb-1.5 block text-sm font-medium text-[color:var(--color-text-primary)]"
							>
								Title
							</label>
							<input
								id="announcement-title"
								type="text"
								class="w-full rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-4 py-2.5 text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-[color:var(--accent-primary,#14b8a6)] focus:outline-none"
								placeholder="Announcement title..."
								bind:value={form.title}
							/>
						</div>

						<!-- Message -->
						<div>
							<label
								for="announcement-message"
								class="mb-1.5 block text-sm font-medium text-[color:var(--color-text-primary)]"
							>
								Message
							</label>
							<textarea
								id="announcement-message"
								class="min-h-[100px] w-full resize-none rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-4 py-2.5 text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-[color:var(--accent-primary,#14b8a6)] focus:outline-none"
								placeholder="Announcement content..."
								bind:value={form.message}
							></textarea>
						</div>

						<div class="grid gap-4 sm:grid-cols-2">
							<!-- Type -->
							<div>
								<label
									for="announcement-type"
									class="mb-1.5 block text-sm font-medium text-[color:var(--color-text-primary)]"
								>
									Type
								</label>
								<select
									id="announcement-type"
									class="w-full rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-4 py-2.5 text-sm text-[color:var(--color-text-primary)] focus:border-[color:var(--accent-primary,#14b8a6)] focus:outline-none"
									bind:value={form.type}
								>
									<option value="info">Info</option>
									<option value="warning">Warning</option>
									<option value="success">Success</option>
									<option value="error">Error</option>
								</select>
							</div>

							<!-- Target Audience -->
							<div>
								<label
									for="announcement-audience"
									class="mb-1.5 block text-sm font-medium text-[color:var(--color-text-primary)]"
								>
									Audience
								</label>
								<select
									id="announcement-audience"
									class="w-full rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-4 py-2.5 text-sm text-[color:var(--color-text-primary)] focus:border-[color:var(--accent-primary,#14b8a6)] focus:outline-none"
									bind:value={form.targetAudience}
								>
									<option value="all">All Users</option>
									<option value="admins">Admins Only</option>
									<option value="users">Regular Users</option>
								</select>
							</div>
						</div>

						<!-- Expiration -->
						<div>
							<label
								for="announcement-expires"
								class="mb-1.5 block text-sm font-medium text-[color:var(--color-text-primary)]"
							>
								Expires At (optional)
							</label>
							<input
								id="announcement-expires"
								type="datetime-local"
								class="w-full rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-4 py-2.5 text-sm text-[color:var(--color-text-primary)] focus:border-[color:var(--accent-primary,#14b8a6)] focus:outline-none"
								bind:value={form.expiresAt}
							/>
						</div>

						<!-- Toggles -->
						<div class="flex flex-wrap gap-4">
							<label class="flex cursor-pointer items-center gap-2">
								<input type="checkbox" class="sr-only" bind:checked={form.active} />
								<div
									class="flex h-6 w-11 items-center rounded-full p-1 transition-colors"
									class:bg-emerald-500={form.active}
									class:bg-slate-300={!form.active}
								>
									<div
										class="h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
										class:translate-x-5={form.active}
									></div>
								</div>
								<span class="text-sm text-[color:var(--color-text-primary)]">Active</span>
							</label>

							<label class="flex cursor-pointer items-center gap-2">
								<input type="checkbox" class="sr-only" bind:checked={form.dismissible} />
								<div
									class="flex h-6 w-11 items-center rounded-full p-1 transition-colors"
									class:bg-emerald-500={form.dismissible}
									class:bg-slate-300={!form.dismissible}
								>
									<div
										class="h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
										class:translate-x-5={form.dismissible}
									></div>
								</div>
								<span class="text-sm text-[color:var(--color-text-primary)]">Dismissible</span>
							</label>
						</div>

						<!-- Actions -->
						<div class="flex flex-wrap items-center gap-3 pt-4">
							<button
								type="submit"
								class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-50"
								disabled={saving}
							>
								{#if saving}
									<i class="bx bx-loader-alt animate-spin"></i>
								{:else}
									<i class="bx bx-save"></i>
								{/if}
								{isCreating ? 'Create' : 'Save Changes'}
							</button>

							{#if !isCreating && selectedAnnouncement}
								<button
									type="button"
									class="flex items-center gap-2 rounded-xl border border-rose-500/30 px-4 py-2.5 text-sm font-medium text-rose-500 transition hover:bg-rose-500/10"
									onclick={() => (deleteConfirm = selectedAnnouncement)}
								>
									<i class="bx bx-trash"></i>
									Delete
								</button>
							{/if}

							<button
								type="button"
								class="flex items-center gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-4 py-2.5 text-sm font-medium text-[color:var(--color-text-primary)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)6%,transparent)]"
								onclick={() => {
									selectedAnnouncement = null;
									isCreating = false;
									resetForm();
									if (mobileViewport) adminNav.showContent();
								}}
							>
								Cancel
							</button>
						</div>
					</form>
				</AdminCard>
			{:else}
				<div
					class="flex h-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] p-8 text-center"
				>
					<div
						class="flex h-16 w-16 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)]"
					>
						<i class="bx bx-bell text-3xl text-[color:var(--text-50,#94a3b8)]"></i>
					</div>
					<p class="mt-4 font-semibold text-[color:var(--color-text-primary)]">
						No Announcement Selected
					</p>
					<p class="mt-1 text-sm text-[color:var(--text-60,#6b7280)]">
						Select an announcement to edit or create a new one.
					</p>
					<button
						type="button"
						class="mt-4 flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
						onclick={startCreate}
					>
						<i class="bx bx-plus"></i>
						Create Announcement
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>

<ConfirmDialog
	open={Boolean(deleteConfirm)}
	title="Delete Announcement"
	body="Are you sure you want to permanently delete this announcement? This action cannot be undone."
	confirmLabel="Delete"
	on:confirm={handleDelete}
	on:cancel={() => (deleteConfirm = null)}
/>
