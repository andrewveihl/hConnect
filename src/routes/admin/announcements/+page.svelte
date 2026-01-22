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
		getCountFromServer,
		getDocs,
		limit,
		orderBy,
		query,
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
	let announcements = $state<Announcement[]>([]);
	let selectedAnnouncement: Announcement | null = $state(null);
	let isCreating = $state(false);
	let saving = $state(false);
	let deleteConfirm: Announcement | null = $state(null);
	let actionBusy = $state(false);
	let actionType = $state<'send' | 'retract' | null>(null);
	let viewsOpen = $state(false);
	let viewsLoading = $state(false);
	let viewsError = $state<string | null>(null);
	let viewsCountError = $state<string | null>(null);
	let viewsAnnouncementTitle = $state('');
	let viewsCount = $state<number | null>(null);
	let views = $state<
		Array<{
			uid: string;
			displayName: string | null;
			email: string | null;
			photoURL: string | null;
			seenAt: Date | null;
		}>
	>([]);
	const VIEW_PAGE_LIMIT = 200;
	let lastViewsCountId: string | null = null;
	let viewsRequestId = 0;

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
	type BranchCommit = { sha: string; message: string; date: string; timestamp: number; branch: string };
	let githubBranches = $state<GitHubBranch[]>([]);
	let loadingBranches = $state(false);
	let selectedBranches = $state<string[]>([]); // Multi-select branches
	let baseBranch = $state<string>('main'); // For comparing branches
	let branchCommits = $state<BranchCommit[]>([]);
	let loadingCommits = $state(false);
	let branchSearch = $state(''); // Search/filter branches

	// Custom dropdown states
	let categoryDropdownOpen = $state(false);
	let typeDropdownOpen = $state(false);
	let audienceDropdownOpen = $state(false);
	let branchDropdownOpen = $state(false);
	let baseBranchDropdownOpen = $state(false);
	
	// Filtered branches based on search
	const filteredBranches = $derived(
		githubBranches
			.filter(b => b.name !== baseBranch && b.name.toLowerCase().includes(branchSearch.toLowerCase()))
			.sort((a, b) => {
				// Put main/master first, then alphabetically
				if (a.name === 'main' || a.name === 'master') return -1;
				if (b.name === 'main' || b.name === 'master') return 1;
				return a.name.localeCompare(b.name);
			})
	);

	$effect(() => {
		announcements = [...data.announcements];
	});

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
		viewsOpen = false;
		viewsError = null;
		viewsCountError = null;
		views = [];
		viewsAnnouncementTitle = '';
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
		viewsOpen = false;
		viewsError = null;
		viewsCountError = null;
		views = [];
		viewsAnnouncementTitle = '';
		viewsCount = null;
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

	const formatDateInput = (date: Date | null) =>
		date ? date.toISOString().slice(0, 16) : '';

	const formatDateTime = (date: Date | null) => {
		if (!date) return '--';
		return date.toLocaleString();
	};

	const loadViewsCount = async (announcementId: string) => {
		viewsCountError = null;
		try {
			await ensureFirebaseReady();
			const db = getDb();
			const viewsRef = collection(db, 'announcements', announcementId, 'views');
			const countSnap = await getCountFromServer(viewsRef);
			viewsCount = countSnap.data().count ?? 0;
		} catch (err) {
			console.error(err);
			viewsCountError = (err as Error)?.message ?? 'Failed to load views count.';
		}
	};

	const openViews = async () => {
		const target = selectedAnnouncement;
		if (!target) return;
		viewsOpen = true;
		viewsLoading = true;
		viewsError = null;
		viewsAnnouncementTitle = target.title;
		const requestId = ++viewsRequestId;

		try {
			await ensureFirebaseReady();
			const db = getDb();
			const viewsRef = collection(db, 'announcements', target.id, 'views');
			const listQuery = query(viewsRef, orderBy('seenAt', 'desc'), limit(VIEW_PAGE_LIMIT));

			const [countSnap, listSnap] = await Promise.all([
				getCountFromServer(viewsRef),
				getDocs(listQuery)
			]);

			if (requestId !== viewsRequestId) return;

			viewsCount = countSnap.data().count ?? 0;
			views = listSnap.docs.map((docSnap) => {
				const data = docSnap.data();
				return {
					uid: data.uid ?? docSnap.id,
					displayName: data.displayName ?? null,
					email: data.email ?? null,
					photoURL: data.photoURL ?? null,
					seenAt: data.seenAt?.toDate?.() ?? null
				};
			});
		} catch (err) {
			console.error(err);
			if (requestId !== viewsRequestId) return;
			viewsError = (err as Error)?.message ?? 'Failed to load viewers.';
		} finally {
			if (requestId === viewsRequestId) {
				viewsLoading = false;
			}
		}
	};

	const closeViews = () => {
		viewsOpen = false;
	};

	const handleViewsBackdrop = (event: MouseEvent) => {
		if (event.target === event.currentTarget) {
			closeViews();
		}
	};

	const applyAnnouncementUpdate = (announcementId: string, updates: Partial<Announcement>) => {
		announcements = announcements.map((announcement) =>
			announcement.id === announcementId ? { ...announcement, ...updates } : announcement
		);

		if (selectedAnnouncement?.id === announcementId) {
			selectedAnnouncement = { ...selectedAnnouncement, ...updates };

			if (typeof updates.active === 'boolean') {
				form.active = updates.active;
			}
			if ('scheduledAt' in updates) {
				form.scheduledAt = formatDateInput(updates.scheduledAt ?? null);
			}
			if ('expiresAt' in updates) {
				form.expiresAt = formatDateInput(updates.expiresAt ?? null);
			}
			if (updates.targetAudience) {
				form.targetAudience = updates.targetAudience;
			}
		}
	};

	const sendNow = async () => {
		const target = selectedAnnouncement;
		if (!target) return;

		actionBusy = true;
		actionType = 'send';
		try {
			await ensureFirebaseReady();
			const db = getDb();
			const now = new Date();

			await updateDoc(doc(db, 'announcements', target.id), {
				active: true,
				scheduledAt: now,
				updatedAt: serverTimestamp()
			});

			applyAnnouncementUpdate(target.id, {
				active: true,
				scheduledAt: now,
				updatedAt: new Date()
			});

			showAdminToast({ type: 'success', message: 'Announcement sent now.' });
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Failed to send announcement now.'
			});
		} finally {
			actionBusy = false;
			actionType = null;
		}
	};

	const retractAnnouncement = async () => {
		const target = selectedAnnouncement;
		if (!target) return;

		actionBusy = true;
		actionType = 'retract';
		try {
			await ensureFirebaseReady();
			const db = getDb();

			await updateDoc(doc(db, 'announcements', target.id), {
				active: false,
				updatedAt: serverTimestamp()
			});

			applyAnnouncementUpdate(target.id, {
				active: false,
				updatedAt: new Date()
			});

			showAdminToast({ type: 'success', message: 'Announcement retracted.' });
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Failed to retract announcement.'
			});
		} finally {
			actionBusy = false;
			actionType = null;
		}
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
	let rateLimitReset = $state<string | null>(null);
	
	const checkRateLimit = (response: Response): boolean => {
		if (response.status === 403 || response.status === 429) {
			const resetHeader = response.headers.get('X-RateLimit-Reset');
			rateLimitReset = resetHeader ? new Date(parseInt(resetHeader) * 1000).toLocaleTimeString() : 'soon';
			console.warn(`GitHub API rate limited. Resets at ${rateLimitReset}`);
			githubRateLimited = true;
			return true;
		}
		return false;
	};
	
	const fetchGitHubBranches = async () => {
		loadingBranches = true;
		githubRateLimited = false;
		rateLimitReset = null;
		try {
			// Fetch branches - sorted by most recently updated using the commits endpoint
			// We'll just get the 5 most recently pushed branches to avoid rate limits
			const branchesRes = await fetch(
				`https://api.github.com/repos/${GITHUB_REPO}/branches?per_page=100`
			);
			
			if (checkRateLimit(branchesRes)) {
				showAdminToast({ type: 'warning', message: `GitHub rate limited. Try again at ${rateLimitReset}` });
				return;
			}
			
			if (!branchesRes.ok) {
				throw new Error(`Failed to fetch branches: ${branchesRes.status}`);
			}
			const branches: GitHubBranch[] = await branchesRes.json();
			console.log('Branches from GitHub:', branches.length);
			
			// Don't fetch individual commit dates to avoid rate limits
			// Just store branches with their SHA - users can search/filter
			githubBranches = branches.map(b => ({ ...b, lastCommitDate: 0 }));
			console.log('Branches loaded:', githubBranches.length);
		} catch (err) {
			console.error('Failed to fetch GitHub branches:', err);
			showAdminToast({ type: 'error', message: 'Failed to load GitHub branches' });
		} finally {
			loadingBranches = false;
		}
	};

	const fetchBranchCommits = async (branches: string[]) => {
		if (branches.length === 0) {
			branchCommits = [];
			return;
		}
		loadingCommits = true;
		branchCommits = [];
		
		try {
			const allCommits: BranchCommit[] = [];
			
			// Fetch commits for each selected branch compared to base
			for (const branch of branches) {
				if (branch === baseBranch) continue;
				
				const response = await fetch(
					`https://api.github.com/repos/${GITHUB_REPO}/compare/${baseBranch}...${branch}`
				);
				
				if (checkRateLimit(response)) {
					showAdminToast({ type: 'warning', message: `GitHub rate limited. Try again at ${rateLimitReset}` });
					break;
				}
				
				if (!response.ok) {
					console.error(`Compare API error for ${branch}:`, response.status);
					continue;
				}
				
				const data = await response.json();
				console.log(`Compare ${baseBranch}...${branch}:`, { ahead: data.ahead_by, commits: data.commits?.length });
				
				// Add commits with branch source
				const branchCommitsData = (data.commits || []).map((c: any) => ({
					sha: c.sha.slice(0, 7),
					message: c.commit.message.split('\n')[0].slice(0, 120),
					date: new Date(c.commit.author.date).toLocaleDateString(),
					timestamp: new Date(c.commit.author.date).getTime(),
					branch
				}));
				
				allCommits.push(...branchCommitsData);
			}
			
			// Sort all commits by date (newest first) and deduplicate by SHA
			const seenShas = new Set<string>();
			branchCommits = allCommits
				.sort((a, b) => b.timestamp - a.timestamp)
				.filter(c => {
					if (seenShas.has(c.sha)) return false;
					seenShas.add(c.sha);
					return true;
				});
				
			console.log('Total unique commits:', branchCommits.length);
		} catch (err) {
			console.error('Failed to fetch commits:', err);
			branchCommits = [];
			showAdminToast({ type: 'error', message: 'Failed to load commits. Check console for details.' });
		} finally {
			loadingCommits = false;
		}
	};

	const toggleBranchSelection = (branch: string) => {
		if (selectedBranches.includes(branch)) {
			selectedBranches = selectedBranches.filter(b => b !== branch);
		} else {
			selectedBranches = [...selectedBranches, branch];
		}
	};
	
	const loadSelectedBranchCommits = () => {
		if (selectedBranches.length > 0) {
			fetchBranchCommits(selectedBranches);
		}
	};

	const selectBaseBranch = (branch: string) => {
		baseBranch = branch;
		baseBranchDropdownOpen = false;
		// Clear commits when base changes - user needs to reload
		if (selectedBranches.length > 0) {
			fetchBranchCommits(selectedBranches);
		}
	};

	const clearBranchSelection = () => {
		selectedBranches = [];
		branchCommits = [];
	};

	const addCommitsAsFeatures = () => {
		// Filter out merge commits and clean up messages
		const cleanedCommits = branchCommits
			.map(c => c.message)
			.filter(msg => {
				const lower = msg.toLowerCase();
				// Filter out merge commits and common non-feature commits
				return !lower.startsWith('merge ') && 
				       !lower.startsWith('merged ') &&
				       !lower.includes('merge branch') &&
				       !lower.includes('merge pull request') &&
				       msg.length > 3;
			})
			.map(msg => {
				// Clean up common prefixes like "fix:", "feat:", etc.
				return msg.replace(/^(fix|feat|chore|docs|style|refactor|perf|test):\s*/i, '').trim();
			});
		
		const newFeatures = cleanedCommits.filter(msg => !featuresList.includes(msg));
		
		if (newFeatures.length > 0) {
			featuresList = [...featuresList, ...newFeatures];
			showAdminToast({ type: 'success', message: `Added ${newFeatures.length} commit messages as features` });
		} else {
			showAdminToast({ type: 'info', message: 'All commits already added' });
		}
	};

	const addSingleCommit = (message: string) => {
		// Clean the message
		const cleaned = message.replace(/^(fix|feat|chore|docs|style|refactor|perf|test):\s*/i, '').trim();
		if (cleaned && !featuresList.includes(cleaned)) {
			featuresList = [...featuresList, cleaned];
			showAdminToast({ type: 'success', message: 'Added commit as feature' });
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
			baseBranchDropdownOpen = false;
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
	const canSendNow = $derived(
		!isCreating && Boolean(selectedAnnouncement) && (isScheduledFuture || !form.active)
	);
	const canRetract = $derived(!isCreating && Boolean(selectedAnnouncement) && form.active);

	$effect(() => {
		const id = selectedAnnouncement?.id ?? null;
		if (id === lastViewsCountId) return;
		lastViewsCountId = id;
		viewsCount = null;
		viewsCountError = null;
		if (!id) return;
		loadViewsCount(id);
	});
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

								<!-- Base Branch Selection -->
								<div class="mb-3 custom-dropdown relative">
									<span class="mb-1.5 block text-xs text-[color:var(--text-50,#94a3b8)]">Compare against (base branch)</span>
									<button
										type="button"
										class="flex w-full items-center justify-between rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-panel)80%,transparent)] px-3 py-2 text-left text-sm transition hover:border-sky-500/50"
										onclick={(e) => { e.stopPropagation(); baseBranchDropdownOpen = !baseBranchDropdownOpen; }}
									>
										<div class="flex items-center gap-2">
											<i class="bx bx-git-branch text-sky-400"></i>
											<span class="text-[color:var(--color-text-primary)]">{baseBranch || 'main'}</span>
										</div>
										<i class="bx bx-chevron-down text-[color:var(--text-50,#94a3b8)] transition-transform {baseBranchDropdownOpen ? 'rotate-180' : ''}"></i>
									</button>
									{#if baseBranchDropdownOpen}
										<div class="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)20%,transparent)] bg-[color:var(--bg-base,#1a1a2e)] shadow-xl">
											{#each githubBranches.filter(b => !selectedBranches.includes(b.name)) as branch}
												<button
													type="button"
													class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-sky-500/10 {baseBranch === branch.name ? 'bg-sky-500/10' : ''}"
													onclick={() => selectBaseBranch(branch.name)}
												>
													<span class="truncate text-[color:var(--color-text-primary)]">{branch.name}</span>
													{#if baseBranch === branch.name}
														<i class="bx bx-check ml-auto text-sky-400"></i>
													{/if}
												</button>
											{/each}
										</div>
									{/if}
								</div>

								<!-- Multi-Branch Selection -->
								<div class="mb-3">
									<div class="mb-1.5 flex items-center justify-between">
										<span class="text-xs text-[color:var(--text-50,#94a3b8)]">Select branches with features to include</span>
										{#if selectedBranches.length > 0}
											<button
												type="button"
												class="text-xs text-rose-400 hover:text-rose-300"
												onclick={clearBranchSelection}
											>
												Clear ({selectedBranches.length})
											</button>
										{/if}
									</div>
									
									<!-- Search input -->
									<div class="relative mb-2">
										<i class="bx bx-search absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-50,#94a3b8)]"></i>
										<input
											type="text"
											placeholder="Search branches..."
											class="w-full rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-panel)80%,transparent)] py-2 pl-9 pr-3 text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-sky-500 focus:outline-none"
											bind:value={branchSearch}
										/>
									</div>
									
									<!-- Selected branches badges -->
									{#if selectedBranches.length > 0}
										<div class="mb-2 flex flex-wrap gap-1.5">
											{#each selectedBranches as branch}
												<span class="inline-flex items-center gap-1 rounded-full bg-sky-500/20 px-2 py-1 text-xs font-medium text-sky-300">
													<i class="bx bx-git-branch text-xs"></i>
													{branch}
													<button
														type="button"
														class="ml-0.5 rounded-full p-0.5 text-sky-400 hover:bg-sky-500/30"
														onclick={() => toggleBranchSelection(branch)}
														aria-label="Remove branch"
													>
														<i class="bx bx-x text-xs"></i>
													</button>
												</span>
											{/each}
										</div>
									{/if}
									
									<!-- Branch list with checkboxes -->
									<div class="max-h-40 overflow-y-auto rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-panel)50%,transparent)]">
										{#if loadingBranches}
											<div class="flex items-center justify-center py-6">
												<i class="bx bx-loader-alt animate-spin text-lg text-sky-400"></i>
											</div>
										{:else if githubRateLimited}
											<div class="px-3 py-6 text-center">
												<i class="bx bx-error-circle text-xl text-amber-400"></i>
												<p class="mt-1 text-xs text-amber-400">Rate limited</p>
											</div>
										{:else if filteredBranches.length === 0}
											<div class="px-3 py-6 text-center text-xs text-[color:var(--text-50,#94a3b8)]">
												{branchSearch ? 'No branches match your search' : 'No branches found'}
											</div>
										{:else}
											{#each filteredBranches as branch}
												<label class="flex cursor-pointer items-center gap-3 border-b border-[color:color-mix(in_srgb,var(--color-text-primary)5%,transparent)] px-3 py-2 transition last:border-b-0 hover:bg-sky-500/10 {selectedBranches.includes(branch.name) ? 'bg-sky-500/10' : ''}">
													<input
														type="checkbox"
														checked={selectedBranches.includes(branch.name)}
														onchange={() => toggleBranchSelection(branch.name)}
														class="h-4 w-4 rounded border-slate-600 bg-slate-800 text-sky-500 focus:ring-sky-500/50"
													/>
													<div class="min-w-0 flex-1">
														<p class="truncate text-sm font-medium text-[color:var(--color-text-primary)]">{branch.name}</p>
														<p class="text-xs text-[color:var(--text-50,#94a3b8)]">{branch.commit.sha.slice(0, 7)}</p>
													</div>
													{#if branch.protected}
														<span class="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400">protected</span>
													{/if}
												</label>
											{/each}
										{/if}
									</div>
								</div>
								
								<!-- Load Commits Button -->
								{#if selectedBranches.length > 0}
									<button
										type="button"
										class="mb-3 flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500/20 px-4 py-2.5 text-sm font-medium text-sky-400 transition hover:bg-sky-500/30"
										onclick={loadSelectedBranchCommits}
										disabled={loadingCommits}
									>
										{#if loadingCommits}
											<i class="bx bx-loader-alt animate-spin"></i>
											Loading commits...
										{:else}
											<i class="bx bx-git-compare"></i>
											Load commits from {selectedBranches.length} branch{selectedBranches.length !== 1 ? 'es' : ''}
										{/if}
									</button>
								{/if}

								<!-- Branch Commits -->
								{#if branchCommits.length > 0 || loadingCommits}
									<div class="rounded-lg border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-panel)50%,transparent)]">
										<div class="flex items-center justify-between border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-3 py-2">
											<span class="text-xs font-medium text-[color:var(--text-60,#6b7280)]">
												{branchCommits.length} commit{branchCommits.length !== 1 ? 's' : ''} ahead of {baseBranch}
											</span>
											<button
												type="button"
												class="flex items-center gap-1 rounded-lg bg-sky-500/20 px-2.5 py-1 text-xs font-medium text-sky-400 transition hover:bg-sky-500/30"
												onclick={addCommitsAsFeatures}
												disabled={loadingCommits || branchCommits.length === 0}
											>
												<i class="bx bx-import"></i>
												Add All
											</button>
										</div>
										{#if loadingCommits}
											<div class="flex items-center justify-center py-6">
												<i class="bx bx-loader-alt animate-spin text-lg text-sky-400"></i>
											</div>
										{:else if githubRateLimited}
											<div class="px-3 py-6 text-center">
												<i class="bx bx-error-circle text-xl text-amber-400"></i>
												<p class="mt-1 text-xs text-amber-400">GitHub API rate limited</p>
												<p class="text-xs text-[color:var(--text-50,#94a3b8)]">Try again at {rateLimitReset}</p>
											</div>
										{:else if branchCommits.length === 0}
											<div class="px-3 py-6 text-center text-xs text-[color:var(--text-50,#94a3b8)]">
												No new commits found (branches may be up to date with {baseBranch})
											</div>
										{:else}
											<div class="max-h-56 overflow-y-auto">
												{#each branchCommits as commit}
													<div class="group flex items-start gap-2 border-b border-[color:color-mix(in_srgb,var(--color-text-primary)5%,transparent)] px-3 py-2 last:border-b-0 hover:bg-sky-500/5">
														<code class="shrink-0 rounded bg-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] px-1.5 py-0.5 text-xs text-sky-400">{commit.sha}</code>
														<div class="min-w-0 flex-1">
															<p class="text-xs text-[color:var(--color-text-primary)]">{commit.message}</p>
															<p class="text-xs text-[color:var(--text-50,#94a3b8)]">
																{commit.branch} • {commit.date}
															</p>
														</div>
														<button
															type="button"
															class="shrink-0 rounded p-1 text-sky-400 opacity-0 transition group-hover:opacity-100 hover:bg-sky-500/20"
															onclick={() => addSingleCommit(commit.message)}
															title="Add this commit as a feature"
														>
															<i class="bx bx-plus text-sm"></i>
														</button>
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

						{#if !isCreating && selectedAnnouncement}
							<!-- Views Summary -->
							<div class="rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-panel)85%,transparent)] p-4">
								<div class="flex flex-wrap items-center justify-between gap-3">
									<div>
										<p class="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-50,#94a3b8)]">
											Seen by
										</p>
										<p class="text-lg font-semibold text-[color:var(--color-text-primary)]">
											{viewsCount ?? '--'} user{viewsCount === 1 ? '' : 's'}
										</p>
										{#if viewsCountError}
											<p class="text-xs text-rose-400">{viewsCountError}</p>
										{/if}
									</div>
									<button
										type="button"
										class="flex items-center gap-2 rounded-xl border border-violet-500/30 px-4 py-2.5 text-sm font-medium text-violet-300 transition hover:bg-violet-500/10 disabled:opacity-50"
										onclick={openViews}
										disabled={viewsLoading}
									>
										<i class="bx bx-user-detail"></i>
										View users
									</button>
								</div>
							</div>
						{/if}

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
								disabled={saving || actionBusy}
							>
								{#if saving}
									<i class="bx bx-loader-alt animate-spin"></i>
								{:else}
									<i class="bx bx-save"></i>
								{/if}
								{isCreating ? 'Create' : 'Save Changes'}
							</button>

							{#if canSendNow}
								<button
									type="button"
									class="flex items-center gap-2 rounded-xl border border-emerald-500/30 px-4 py-2.5 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/10 disabled:opacity-50"
									onclick={sendNow}
									disabled={actionBusy || saving}
								>
									{#if actionBusy && actionType === 'send'}
										<i class="bx bx-loader-alt animate-spin"></i>
										Sending...
									{:else}
										<i class="bx bx-bolt-circle"></i>
										Send Now
									{/if}
								</button>
							{/if}

							{#if canRetract}
								<button
									type="button"
									class="flex items-center gap-2 rounded-xl border border-amber-500/30 px-4 py-2.5 text-sm font-medium text-amber-400 transition hover:bg-amber-500/10 disabled:opacity-50"
									onclick={retractAnnouncement}
									disabled={actionBusy || saving}
								>
									{#if actionBusy && actionType === 'retract'}
										<i class="bx bx-loader-alt animate-spin"></i>
										Retracting...
									{:else}
										<i class="bx bx-undo"></i>
										Retract
									{/if}
								</button>
							{/if}

							{#if !isCreating && selectedAnnouncement}
								<button
									type="button"
									class="flex items-center gap-2 rounded-xl border border-rose-500/30 px-4 py-2.5 text-sm font-medium text-rose-500 transition hover:bg-rose-500/10"
									onclick={() => (deleteConfirm = selectedAnnouncement)}
									disabled={actionBusy || saving}
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
								disabled={actionBusy || saving}
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

{#if viewsOpen}
	<div
		class="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
		role="presentation"
		onclick={handleViewsBackdrop}
	>
		<div
			class="w-full max-w-xl rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-[color:var(--bg-base,#0f172a)] p-5 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-label="Announcement viewers"
		>
			<div class="flex items-start justify-between gap-4">
				<div>
					<p class="text-sm font-semibold text-[color:var(--color-text-primary)]">
						Announcement viewers
					</p>
					<p class="text-xs text-[color:var(--text-60,#6b7280)]">
						{viewsAnnouncementTitle || 'Announcement'}
					</p>
				</div>
				<button
					type="button"
					class="flex h-9 w-9 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] text-[color:var(--text-60,#6b7280)] transition hover:bg-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)]"
					onclick={closeViews}
					aria-label="Close"
				>
					<i class="bx bx-x text-lg"></i>
				</button>
			</div>

			<div class="mt-4">
				{#if viewsLoading}
					<div class="flex items-center gap-2 text-sm text-[color:var(--text-60,#6b7280)]">
						<i class="bx bx-loader-alt animate-spin"></i>
						Loading viewers...
					</div>
				{:else if viewsError}
					<p class="text-sm text-rose-400">{viewsError}</p>
				{:else if views.length === 0}
					<p class="text-sm text-[color:var(--text-60,#6b7280)]">No views yet.</p>
				{:else}
					<div class="max-h-[360px] space-y-2 overflow-y-auto pr-1">
						{#each views as view (view.uid)}
							<div class="flex items-center justify-between gap-3 rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-panel)90%,transparent)] px-3 py-2.5">
								<div class="min-w-0">
									<p class="truncate text-sm font-semibold text-[color:var(--color-text-primary)]">
										{view.displayName ?? view.email ?? view.uid}
									</p>
									<p class="truncate text-xs text-[color:var(--text-60,#6b7280)]">
										{view.email ?? view.uid}
									</p>
								</div>
								<span class="shrink-0 text-xs text-[color:var(--text-60,#6b7280)]">
									{formatDateTime(view.seenAt)}
								</span>
							</div>
						{/each}
					</div>
					{#if viewsCount !== null && viewsCount > views.length}
						<p class="mt-3 text-xs text-[color:var(--text-60,#6b7280)]">
							Showing {views.length} of {viewsCount} viewers.
						</p>
					{/if}
				{/if}
			</div>
		</div>
	</div>
{/if}

<ConfirmDialog
	open={Boolean(deleteConfirm)}
	title="Delete Announcement"
	body="Are you sure you want to permanently delete this announcement? This action cannot be undone."
	confirmLabel="Delete"
	on:confirm={handleDelete}
	on:cancel={() => (deleteConfirm = null)}
/>
