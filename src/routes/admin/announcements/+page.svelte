<script lang="ts">
	import type { PageData } from './$types';
	import type { Announcement, AnnouncementCategory } from './+page';
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
	import { requestAnnouncementGeneration } from '$lib/api/ai';
	import { onMount } from 'svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	let announcements = $state<Announcement[]>([...data.announcements]);
	let selectedAnnouncement: Announcement | null = $state(null);
	let isCreating = $state(false);
	let saving = $state(false);
	let deleteConfirm: Announcement | null = $state(null);

	// AI Generation state
	let aiGenerating = $state(false);
	let featureInput = $state('');
	let featuresList = $state<string[]>([]);

	// GitHub branches state
	type GitHubBranch = {
		name: string;
		commit: { sha: string; url: string };
		protected: boolean;
		lastCommitDate?: number;
	};
	let githubBranches = $state<GitHubBranch[]>([]);
	let loadingBranches = $state(false);
	let selectedBranch = $state<string>('');
	let branchCommits = $state<Array<{ sha: string; message: string; date: string; timestamp: number }>>([]);
	let loadingCommits = $state(false);

	// Custom dropdown states
	let categoryDropdownOpen = $state(false);
	let typeDropdownOpen = $state(false);
	let audienceDropdownOpen = $state(false);
	let branchDropdownOpen = $state(false);

	const mobileViewport = $derived($isMobileViewport);

	// Form state
	let form = $state({
		title: '',
		message: '',
		type: 'info' as Announcement['type'],
		active: true,
		dismissible: true,
		targetAudience: 'all' as Announcement['targetAudience'],
		expiresAt: '',
		scheduledAt: '',
		category: 'general' as AnnouncementCategory,
		version: ''
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
			expiresAt: '',
			scheduledAt: '',
			category: 'general',
			version: ''
		};
		featuresList = [];
		featureInput = '';
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
				expiresAt: announcement.expiresAt ? announcement.expiresAt.toISOString().slice(0, 16) : '',
				scheduledAt: announcement.scheduledAt ? announcement.scheduledAt.toISOString().slice(0, 16) : '',
				category: announcement.category ?? 'general',
				version: announcement.version ?? ''
			};
			featuresList = [...(announcement.features ?? [])];
			featureInput = '';

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
				scheduledAt: form.scheduledAt ? new Date(form.scheduledAt) : null,
				category: form.category,
				version: form.version.trim() || null,
				features: featuresList,
				updatedAt: serverTimestamp()
			};

			if (isCreating) {
				const docRef = await addDoc(collection(db, 'announcements'), {
					...payload,
					createdAt: serverTimestamp(),
					createdBy: data.user?.uid ?? null,
					aiGenerated: false
				});

				const newAnnouncement: Announcement = {
					id: docRef.id,
					...payload,
					createdAt: new Date(),
					updatedAt: new Date(),
					createdBy: data.user?.uid ?? null,
					expiresAt: form.expiresAt ? new Date(form.expiresAt) : null,
					scheduledAt: form.scheduledAt ? new Date(form.scheduledAt) : null,
					aiGenerated: false
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
								scheduledAt: form.scheduledAt ? new Date(form.scheduledAt) : null,
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
		info: { icon: 'bx-info-circle', bg: 'rgba(14, 165, 233, 0.15)', text: '#38bdf8', label: 'Info', description: 'General information' },
		warning: { icon: 'bx-error', bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', label: 'Warning', description: 'Important notice' },
		success: { icon: 'bx-check-circle', bg: 'rgba(16, 185, 129, 0.15)', text: '#34d399', label: 'Success', description: 'Good news' },
		error: { icon: 'bx-x-circle', bg: 'rgba(244, 63, 94, 0.15)', text: '#fb7185', label: 'Critical', description: 'Urgent alert' }
	};

	const categoryConfig: Record<AnnouncementCategory, { label: string; icon: string; description: string; bg: string; text: string }> = {
		update: { label: 'App Update', icon: 'bx-revision', description: 'New version released', bg: 'rgba(20, 184, 166, 0.15)', text: '#2dd4bf' },
		feature: { label: 'New Feature', icon: 'bx-star', description: 'Exciting new capability', bg: 'rgba(139, 92, 246, 0.15)', text: '#a78bfa' },
		maintenance: { label: 'Maintenance', icon: 'bx-wrench', description: 'Scheduled downtime', bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24' },
		security: { label: 'Security', icon: 'bx-shield', description: 'Security patch or notice', bg: 'rgba(244, 63, 94, 0.15)', text: '#fb7185' },
		general: { label: 'General', icon: 'bx-bell', description: 'General announcement', bg: 'rgba(14, 165, 233, 0.15)', text: '#38bdf8' }
	};

	const audienceConfig = {
		all: { label: 'All Users', icon: 'bx-globe', description: 'Everyone sees this', bg: 'rgba(139, 92, 246, 0.15)', text: '#a78bfa' },
		admins: { label: 'Admins Only', icon: 'bx-shield-quarter', description: 'Server admins only', bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24' },
		users: { label: 'Regular Users', icon: 'bx-user', description: 'Non-admin users', bg: 'rgba(14, 165, 233, 0.15)', text: '#38bdf8' }
	};

	// GitHub API - Fetch branches
	const GITHUB_REPO = 'andrewveihl/hConnect';
	let githubRateLimited = $state(false);
	
	const fetchGitHubBranches = async () => {
		loadingBranches = true;
		githubRateLimited = false;
		try {
			// Fetch branches (this is a lightweight call)
			const branchesRes = await fetch(
				`https://api.github.com/repos/${GITHUB_REPO}/branches?per_page=100`
			);
			
			// Check for rate limiting
			if (branchesRes.status === 403 || branchesRes.status === 429) {
				const resetHeader = branchesRes.headers.get('X-RateLimit-Reset');
				const resetTime = resetHeader ? new Date(parseInt(resetHeader) * 1000).toLocaleTimeString() : 'soon';
				console.warn(`GitHub API rate limited. Resets at ${resetTime}`);
				githubRateLimited = true;
				showAdminToast({ type: 'warning', message: `GitHub rate limited. Try again at ${resetTime}` });
				return;
			}
			
			if (!branchesRes.ok) {
				throw new Error(`Failed to fetch branches: ${branchesRes.status}`);
			}
			const branches: GitHubBranch[] = await branchesRes.json();
			console.log('Branches from GitHub:', branches.map(b => b.name));
			
			// Fetch recent commits from the repo (single API call, gets recent activity)
			const commitsRes = await fetch(
				`https://api.github.com/repos/${GITHUB_REPO}/commits?per_page=100`
			);
			
			let commitDates: Map<string, number> = new Map();
			if (commitsRes.ok) {
				const commits = await commitsRes.json();
				// Map commit SHAs to their dates
				for (const commit of commits) {
					commitDates.set(commit.sha, new Date(commit.commit.committer.date).getTime());
				}
			}
			
			// Match branches to commit dates
			const branchesWithDates = branches.map(branch => ({
				...branch,
				lastCommitDate: commitDates.get(branch.commit.sha) || 0
			}));
			
			// Sort: branches with known dates first (by date), then others alphabetically
			githubBranches = branchesWithDates.sort((a, b) => {
				// Both have dates - sort by most recent
				if (a.lastCommitDate && b.lastCommitDate) {
					return b.lastCommitDate - a.lastCommitDate;
				}
				// One has date, one doesn't - dated one comes first
				if (a.lastCommitDate && !b.lastCommitDate) return -1;
				if (!a.lastCommitDate && b.lastCommitDate) return 1;
				// Neither has date - sort alphabetically, but put 'main' first
				if (a.name === 'main') return -1;
				if (b.name === 'main') return 1;
				return a.name.localeCompare(b.name);
			});
			
			console.log('Branches sorted:', githubBranches.slice(0, 10).map(b => ({ 
				name: b.name, 
				date: b.lastCommitDate ? new Date(b.lastCommitDate).toLocaleString() : 'unknown'
			})));
		} catch (err) {
			console.error('Failed to fetch GitHub branches:', err);
			showAdminToast({ type: 'error', message: 'Failed to load GitHub branches' });
		} finally {
			loadingBranches = false;
		}
	};

	const fetchBranchCommits = async (branch: string) => {
		if (!branch) {
			branchCommits = [];
			return;
		}
		loadingCommits = true;
		try {
			const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits?sha=${branch}&per_page=10`);
			if (!response.ok) throw new Error('Failed to fetch commits');
			const data = await response.json();
			branchCommits = data.map((c: any) => ({
				sha: c.sha.slice(0, 7),
				message: c.commit.message.split('\n')[0].slice(0, 80),
				date: new Date(c.commit.author.date).toLocaleDateString(),
				timestamp: new Date(c.commit.author.date).getTime()
			}));
		} catch (err) {
			console.error('Failed to fetch commits:', err);
			branchCommits = [];
		} finally {
			loadingCommits = false;
		}
	};

	const selectBranch = (branch: string) => {
		selectedBranch = branch;
		branchDropdownOpen = false;
		fetchBranchCommits(branch);
	};

	const addCommitsAsFeatures = () => {
		const newFeatures = branchCommits
			.map(c => c.message)
			.filter(msg => !featuresList.includes(msg));
		if (newFeatures.length > 0) {
			featuresList = [...featuresList, ...newFeatures];
			showAdminToast({ type: 'success', message: `Added ${newFeatures.length} commit messages as features` });
		} else {
			showAdminToast({ type: 'info', message: 'All commits already added' });
		}
	};

	// Close dropdowns when clicking outside
	const handleClickOutside = (e: MouseEvent) => {
		const target = e.target as HTMLElement;
		if (!target.closest('.custom-dropdown')) {
			categoryDropdownOpen = false;
			typeDropdownOpen = false;
			audienceDropdownOpen = false;
			branchDropdownOpen = false;
		}
	};

	onMount(() => {
		fetchGitHubBranches();
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	});

	// Feature list management
	const addFeature = () => {
		const trimmed = featureInput.trim();
		if (trimmed && !featuresList.includes(trimmed)) {
			featuresList = [...featuresList, trimmed];
			featureInput = '';
		}
	};

	const removeFeature = (index: number) => {
		featuresList = featuresList.filter((_, i) => i !== index);
	};

	const handleFeatureKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			addFeature();
		}
	};

	// AI Generation
	const generateWithAI = async () => {
		if (featuresList.length === 0) {
			showAdminToast({ type: 'error', message: 'Add at least one feature/change to generate content.' });
			return;
		}

		aiGenerating = true;
		try {
			const result = await requestAnnouncementGeneration({
				category: form.category,
				version: form.version || null,
				features: featuresList,
				tone: 'friendly',
				appName: 'hConnect'
			});

			if (result.title) {
				form.title = result.title;
			}
			if (result.message) {
				form.message = result.message;
			}

			showAdminToast({ type: 'success', message: 'AI generated announcement content!' });
		} catch (err) {
			console.error('AI generation failed:', err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Failed to generate content with AI.'
			});
		} finally {
			aiGenerating = false;
		}
	};

	// Check if announcement is scheduled for the future
	const isScheduledFuture = $derived(
		form.scheduledAt ? new Date(form.scheduledAt) > new Date() : false
	);
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
											class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
											style="background-color: {config.bg}"
										>
											<i class="bx {config.icon} text-lg" style="color: {config.text}"></i>
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
						class="space-y-5"
						onsubmit={(e) => {
							e.preventDefault();
							handleSave();
						}}
					>
						<!-- AI Generation Section -->
						<div class="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-purple-500/5 p-5">
							<div class="mb-4 flex items-center gap-3">
								<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 shadow-lg shadow-violet-500/20">
									<i class="bx bx-bot text-xl text-white"></i>
								</div>
								<div>
									<p class="text-sm font-semibold text-[color:var(--color-text-primary)]">AI-Powered Announcement Builder</p>
									<p class="text-xs text-[color:var(--text-60,#6b7280)]">Pull from GitHub or add features manually, then let AI craft your message</p>
								</div>
							</div>

							<!-- GitHub Branch Selection -->
							<div class="mb-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
								<div class="mb-3 flex items-center justify-between">
									<div class="flex items-center gap-2">
										<i class="bx bxl-github text-lg text-sky-400"></i>
										<span class="text-xs font-semibold uppercase tracking-wider text-sky-400">Import from GitHub</span>
									</div>
									<button
										type="button"
										class="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-sky-400 transition hover:bg-sky-500/20"
										onclick={(e) => { e.stopPropagation(); fetchGitHubBranches(); }}
										disabled={loadingBranches}
										aria-label="Refresh branches"
									>
										<i class="bx bx-refresh {loadingBranches ? 'animate-spin' : ''}"></i>
										Refresh
									</button>
								</div>
								
								{#if githubRateLimited}
									<div class="mb-3 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
										<i class="bx bx-error-circle"></i>
										<span>GitHub API rate limited. Wait a few minutes and click Refresh.</span>
									</div>
								{/if}
								
								<!-- Branch Dropdown -->
								<div class="custom-dropdown relative mb-3">
									<button
										type="button"
										class="flex w-full items-center justify-between rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-panel)80%,transparent)] px-4 py-3 text-left transition hover:border-sky-500/50"
										onclick={(e) => { e.stopPropagation(); branchDropdownOpen = !branchDropdownOpen; }}
									>
										<div class="flex items-center gap-3">
											<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/20">
												<i class="bx bx-git-branch text-sky-400"></i>
											</div>
											<div>
												<p class="text-sm font-medium text-[color:var(--color-text-primary)]">
													{selectedBranch || 'Select a branch'}
												</p>
												<p class="text-xs text-[color:var(--text-50,#94a3b8)]">
													{selectedBranch ? 'Pull recent commits' : 'Choose branch to import commits from'}
												</p>
											</div>
										</div>
										<i class="bx bx-chevron-down text-xl text-[color:var(--text-50,#94a3b8)] transition-transform {branchDropdownOpen ? 'rotate-180' : ''}"></i>
									</button>
									
									{#if branchDropdownOpen}
										<div class="absolute left-0 right-0 top-full z-50 mt-2 max-h-64 overflow-y-auto rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)20%,transparent)] bg-[color:var(--bg-base,#1a1a2e)] shadow-2xl">
											{#if loadingBranches}
												<div class="flex items-center justify-center py-8">
													<i class="bx bx-loader-alt animate-spin text-2xl text-sky-400"></i>
												</div>
											{:else if githubRateLimited}
												<div class="px-4 py-8 text-center">
													<i class="bx bx-error-circle text-2xl text-amber-400"></i>
													<p class="mt-2 text-sm text-amber-400">Rate limited</p>
													<p class="text-xs text-[color:var(--text-50,#94a3b8)]">Try again in a few minutes</p>
												</div>
											{:else if githubBranches.length === 0}
												<div class="px-4 py-8 text-center text-sm text-[color:var(--text-50,#94a3b8)]">
													No branches found
												</div>
											{:else}
												{#each githubBranches as branch}
													<button
														type="button"
														class="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-sky-500/10 {selectedBranch === branch.name ? 'bg-sky-500/10' : ''}"
														onclick={() => selectBranch(branch.name)}
													>
														<i class="bx bx-git-branch text-sky-400"></i>
														<div class="flex-1 min-w-0">
															<p class="text-sm font-medium text-[color:var(--color-text-primary)] truncate">{branch.name}</p>
															<p class="text-xs text-[color:var(--text-50,#94a3b8)]">
																{branch.lastCommitDate ? new Date(branch.lastCommitDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : branch.commit.sha.slice(0, 7)}
															</p>
														</div>
														{#if branch.protected}
															<span class="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400">protected</span>
														{/if}
														{#if selectedBranch === branch.name}
															<i class="bx bx-check text-sky-400"></i>
														{/if}
													</button>
												{/each}
											{/if}
										</div>
									{/if}
								</div>

								<!-- Branch Commits -->
								{#if selectedBranch}
									<div class="rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-panel)50%,transparent)]">
										<div class="flex items-center justify-between border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-3 py-2">
											<span class="text-xs font-medium text-[color:var(--text-60,#6b7280)]">Recent commits on {selectedBranch}</span>
											<button
												type="button"
												class="flex items-center gap-1 rounded-lg bg-sky-500/20 px-2.5 py-1 text-xs font-medium text-sky-400 transition hover:bg-sky-500/30"
												onclick={addCommitsAsFeatures}
												disabled={loadingCommits || branchCommits.length === 0}
											>
												<i class="bx bx-import"></i>
												Add as Features
											</button>
										</div>
										{#if loadingCommits}
											<div class="flex items-center justify-center py-6">
												<i class="bx bx-loader-alt animate-spin text-lg text-sky-400"></i>
											</div>
										{:else if branchCommits.length === 0}
											<div class="px-3 py-6 text-center text-xs text-[color:var(--text-50,#94a3b8)]">No commits found</div>
										{:else}
											<div class="max-h-40 overflow-y-auto">
												{#each branchCommits as commit}
													<div class="flex items-start gap-2 border-b border-[color:color-mix(in_srgb,var(--color-text-primary)5%,transparent)] px-3 py-2 last:border-b-0">
														<code class="shrink-0 rounded bg-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] px-1.5 py-0.5 text-xs text-sky-400">{commit.sha}</code>
														<p class="flex-1 text-xs text-[color:var(--color-text-primary)]">{commit.message}</p>
														<span class="shrink-0 text-xs text-[color:var(--text-50,#94a3b8)]">{commit.date}</span>
													</div>
												{/each}
											</div>
										{/if}
									</div>
								{/if}
							</div>

							<!-- Category Dropdown (Modern) -->
							<div class="mb-4 grid gap-3 sm:grid-cols-2">
								<div class="custom-dropdown relative">
									<span class="mb-1.5 block text-xs font-medium text-[color:var(--text-60,#6b7280)]">
										Category
									</span>
									{#if true}
										{@const currentCat = categoryConfig[form.category]}
										<button
											type="button"
											class="flex w-full items-center justify-between rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-panel)80%,transparent)] px-3 py-2.5 text-left transition hover:border-violet-500/50"
											onclick={(e) => { e.stopPropagation(); categoryDropdownOpen = !categoryDropdownOpen; }}
										>
											<div class="flex items-center gap-2.5">
												<div class="flex h-7 w-7 items-center justify-center rounded-lg" style="background-color: {currentCat.bg}">
													<i class="bx {currentCat.icon}" style="color: {currentCat.text}"></i>
												</div>
												<div>
													<p class="text-sm font-medium text-[color:var(--color-text-primary)]">{currentCat.label}</p>
												</div>
											</div>
											<i class="bx bx-chevron-down text-lg text-[color:var(--text-50,#94a3b8)] transition-transform {categoryDropdownOpen ? 'rotate-180' : ''}"></i>
										</button>
									{/if}
									
									{#if categoryDropdownOpen}
										<div class="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)20%,transparent)] bg-[color:var(--bg-base,#1a1a2e)] shadow-2xl">
											{#each Object.entries(categoryConfig) as [value, config]}
												<button
													type="button"
													class="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-violet-500/10 {form.category === value ? 'bg-violet-500/10' : ''}"
													onclick={() => { form.category = value as AnnouncementCategory; categoryDropdownOpen = false; }}
												>
													<div class="flex h-8 w-8 items-center justify-center rounded-lg" style="background-color: {config.bg}">
														<i class="bx {config.icon}" style="color: {config.text}"></i>
													</div>
													<div class="flex-1">
														<p class="text-sm font-medium text-[color:var(--color-text-primary)]">{config.label}</p>
														<p class="text-xs text-[color:var(--text-50,#94a3b8)]">{config.description}</p>
													</div>
													{#if form.category === value}
														<i class="bx bx-check text-violet-400"></i>
													{/if}
												</button>
											{/each}
										</div>
									{/if}
								</div>
								
								<div>
									<label for="announcement-version" class="mb-1.5 block text-xs font-medium text-[color:var(--text-60,#6b7280)]">
										Version (optional)
									</label>
									<input
										id="announcement-version"
										type="text"
										class="w-full rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-panel)80%,transparent)] px-4 py-2.5 text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-violet-500 focus:outline-none"
										placeholder="e.g., 2.1.0"
										bind:value={form.version}
									/>
								</div>
							</div>

							<!-- Features Input -->
							<div class="mb-4">
								<label for="feature-input" class="mb-1.5 block text-xs font-medium text-[color:var(--text-60,#6b7280)]">
									Features / Changes
								</label>
								<div class="flex gap-2">
									<input
										id="feature-input"
										type="text"
										class="flex-1 rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-panel)80%,transparent)] px-4 py-2.5 text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-violet-500 focus:outline-none"
										placeholder="Type a feature and press Enter..."
										bind:value={featureInput}
										onkeydown={handleFeatureKeydown}
									/>
									<button
										type="button"
										class="shrink-0 rounded-xl bg-violet-500/20 px-4 py-2.5 text-sm font-medium text-violet-400 transition hover:bg-violet-500/30"
										onclick={addFeature}
										aria-label="Add feature"
									>
										<i class="bx bx-plus text-lg"></i>
									</button>
								</div>
							</div>

							<!-- Features List -->
							{#if featuresList.length > 0}
								<div class="mb-4">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-medium text-[color:var(--text-60,#6b7280)]">{featuresList.length} feature{featuresList.length !== 1 ? 's' : ''} added</span>
										<button
											type="button"
											class="text-xs text-rose-400 hover:text-rose-300"
											onclick={() => { featuresList = []; }}
										>
											Clear all
										</button>
									</div>
									<div class="flex flex-wrap gap-2">
										{#each featuresList as feature, index}
											<span class="group inline-flex items-center gap-1.5 rounded-full bg-violet-500/20 px-3 py-1.5 text-xs font-medium text-violet-300 transition hover:bg-violet-500/30">
												<i class="bx bx-check-circle text-violet-400"></i>
												{feature}
												<button
													type="button"
													class="ml-0.5 rounded-full p-0.5 text-violet-400 opacity-60 transition hover:bg-violet-500/30 hover:opacity-100"
													onclick={() => removeFeature(index)}
													aria-label="Remove feature"
												>
													<i class="bx bx-x"></i>
												</button>
											</span>
										{/each}
									</div>
								</div>
							{:else}
								<div class="mb-4 flex items-center justify-center rounded-xl border-2 border-dashed border-violet-500/20 py-6">
									<div class="text-center">
										<i class="bx bx-list-plus text-3xl text-violet-500/40"></i>
										<p class="mt-1 text-xs text-[color:var(--text-50,#94a3b8)]">Add features manually or import from GitHub</p>
									</div>
								</div>
							{/if}

							<!-- Generate Button -->
							<button
								type="button"
								class="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:shadow-violet-500/40 disabled:opacity-50 disabled:shadow-none"
								disabled={aiGenerating || featuresList.length === 0}
								onclick={generateWithAI}
							>
								{#if aiGenerating}
									<i class="bx bx-loader-alt animate-spin text-lg"></i>
									Generating announcement...
								{:else}
									<i class="bx bx-magic-wand text-lg"></i>
									Generate with AI
								{/if}
							</button>
						</div>

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
								class="min-h-[120px] w-full resize-none rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-4 py-2.5 text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-[color:var(--accent-primary,#14b8a6)] focus:outline-none"
								placeholder="Announcement content... Use **bold** and *italic* for formatting, and - for bullet points."
								bind:value={form.message}
							></textarea>
							<p class="mt-1 text-xs text-[color:var(--text-50,#94a3b8)]">
								Supports **bold**, *italic*, and - bullet points
							</p>
						</div>

						<div class="grid gap-4 sm:grid-cols-2">
							<!-- Type Dropdown (Modern) -->
							<div class="custom-dropdown relative">
								<span class="mb-1.5 block text-sm font-medium text-[color:var(--color-text-primary)]">
									Type
								</span>
								{#if true}
									{@const currentType = typeConfig[form.type]}
									<button
										type="button"
										class="flex w-full items-center justify-between rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-panel)80%,transparent)] px-4 py-2.5 text-left transition hover:border-[color:var(--accent-primary,#14b8a6)]"
										onclick={(e) => { e.stopPropagation(); typeDropdownOpen = !typeDropdownOpen; }}
									>
										<div class="flex items-center gap-3">
											<div class="flex h-8 w-8 items-center justify-center rounded-lg" style="background-color: {currentType.bg}">
												<i class="bx {currentType.icon}" style="color: {currentType.text}"></i>
											</div>
											<div>
												<p class="text-sm font-medium text-[color:var(--color-text-primary)]">{currentType.label}</p>
												<p class="text-xs text-[color:var(--text-50,#94a3b8)]">{currentType.description}</p>
											</div>
										</div>
										<i class="bx bx-chevron-down text-lg text-[color:var(--text-50,#94a3b8)] transition-transform {typeDropdownOpen ? 'rotate-180' : ''}"></i>
									</button>
								{/if}

								{#if typeDropdownOpen}
									<div class="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)20%,transparent)] bg-[color:var(--bg-base,#1a1a2e)] shadow-2xl">
										{#each Object.entries(typeConfig) as [value, config]}
											<button
												type="button"
												class="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[color:color-mix(in_srgb,var(--accent-primary,#14b8a6)10%,transparent)] {form.type === value ? 'bg-[color:color-mix(in_srgb,var(--accent-primary,#14b8a6)10%,transparent)]' : ''}"
												onclick={() => { form.type = value as Announcement['type']; typeDropdownOpen = false; }}
											>
												<div class="flex h-8 w-8 items-center justify-center rounded-lg" style="background-color: {config.bg}">
													<i class="bx {config.icon}" style="color: {config.text}"></i>
												</div>
												<div class="flex-1">
													<p class="text-sm font-medium text-[color:var(--color-text-primary)]">{config.label}</p>
													<p class="text-xs text-[color:var(--text-50,#94a3b8)]">{config.description}</p>
												</div>
												{#if form.type === value}
													<i class="bx bx-check" style="color: var(--accent-primary, #14b8a6)"></i>
												{/if}
											</button>
										{/each}
									</div>
								{/if}
							</div>

							<!-- Audience Dropdown (Modern) -->
							<div class="custom-dropdown relative">
								<span class="mb-1.5 block text-sm font-medium text-[color:var(--color-text-primary)]">
									Audience
								</span>
								{#if true}
									{@const currentAudience = audienceConfig[form.targetAudience]}
									<button
										type="button"
										class="flex w-full items-center justify-between rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-panel)80%,transparent)] px-4 py-2.5 text-left transition hover:border-[color:var(--accent-primary,#14b8a6)]"
										onclick={(e) => { e.stopPropagation(); audienceDropdownOpen = !audienceDropdownOpen; }}
									>
										<div class="flex items-center gap-3">
											<div class="flex h-8 w-8 items-center justify-center rounded-lg" style="background-color: {currentAudience.bg}">
												<i class="bx {currentAudience.icon}" style="color: {currentAudience.text}"></i>
											</div>
											<div>
												<p class="text-sm font-medium text-[color:var(--color-text-primary)]">{currentAudience.label}</p>
												<p class="text-xs text-[color:var(--text-50,#94a3b8)]">{currentAudience.description}</p>
											</div>
										</div>
										<i class="bx bx-chevron-down text-lg text-[color:var(--text-50,#94a3b8)] transition-transform {audienceDropdownOpen ? 'rotate-180' : ''}"></i>
									</button>
								{/if}

								{#if audienceDropdownOpen}
									<div class="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)20%,transparent)] bg-[color:var(--bg-base,#1a1a2e)] shadow-2xl">
										{#each Object.entries(audienceConfig) as [value, config]}
											<button
												type="button"
												class="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[color:color-mix(in_srgb,var(--accent-primary,#14b8a6)10%,transparent)] {form.targetAudience === value ? 'bg-[color:color-mix(in_srgb,var(--accent-primary,#14b8a6)10%,transparent)]' : ''}"
												onclick={() => { form.targetAudience = value as Announcement['targetAudience']; audienceDropdownOpen = false; }}
											>
												<div class="flex h-8 w-8 items-center justify-center rounded-lg" style="background-color: {config.bg}">
													<i class="bx {config.icon}" style="color: {config.text}"></i>
												</div>
												<div class="flex-1">
													<p class="text-sm font-medium text-[color:var(--color-text-primary)]">{config.label}</p>
													<p class="text-xs text-[color:var(--text-50,#94a3b8)]">{config.description}</p>
												</div>
												{#if form.targetAudience === value}
													<i class="bx bx-check" style="color: var(--accent-primary, #14b8a6)"></i>
												{/if}
											</button>
										{/each}
									</div>
								{/if}
							</div>
						</div>

						<!-- Scheduling Section -->
						<div class="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
							<div class="mb-3 flex items-center gap-2">
								<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-500">
									<i class="bx bx-calendar text-white"></i>
								</div>
								<div>
									<p class="text-sm font-semibold text-[color:var(--color-text-primary)]">Scheduling</p>
									<p class="text-xs text-[color:var(--text-60,#6b7280)]">Control when the announcement appears</p>
								</div>
							</div>

							<div class="grid gap-4 sm:grid-cols-2">
								<!-- Scheduled At -->
								<div>
									<label
										for="announcement-scheduled"
										class="mb-1.5 block text-xs font-medium text-[color:var(--text-60,#6b7280)]"
									>
										Show Starting At
									</label>
									<input
										id="announcement-scheduled"
										type="datetime-local"
										class="w-full rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:border-amber-500 focus:outline-none"
										bind:value={form.scheduledAt}
									/>
								</div>

								<!-- Expires At -->
								<div>
									<label
										for="announcement-expires"
										class="mb-1.5 block text-xs font-medium text-[color:var(--text-60,#6b7280)]"
									>
										Expires At
									</label>
									<input
										id="announcement-expires"
										type="datetime-local"
										class="w-full rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:border-amber-500 focus:outline-none"
										bind:value={form.expiresAt}
									/>
								</div>
							</div>

							{#if isScheduledFuture}
								<div class="mt-3 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2">
									<i class="bx bx-time-five text-amber-400"></i>
									<span class="text-xs text-amber-300">
										This announcement is scheduled to appear in the future.
									</span>
								</div>
							{/if}
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
