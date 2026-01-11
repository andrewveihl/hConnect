<script lang="ts">
	import type { PageData } from './$types';
	import { browser } from '$app/environment';
	import ThemeEditor from '$lib/admin/components/ThemeEditor.svelte';
	import SplashEditor from '$lib/admin/components/SplashEditor.svelte';
	import SoundEditor from '$lib/admin/components/SoundEditor.svelte';
	import { showAdminToast } from '$lib/admin/stores/toast';
	import {
		customizationConfigStore,
		loadCustomizationConfig,
		saveThemeOverrides,
		saveSplashConfig,
		saveDefaultAvatarUrl,
		uploadDefaultAvatarImage,
		resetThemeToDefault,
		resetDefaultAvatarUrl,
		resetSplashToDefault,
		applyThemeOverrides,
		createCustomTheme,
		deleteCustomTheme,
		getAllThemes,
		type ThemeColors,
		type CustomizationConfig
	} from '$lib/admin/customization';
	import { DEFAULT_AVATAR_URL } from '$lib/utils/profile';
	import { isMobileViewport } from '$lib/stores/viewport';
	import { onMount } from 'svelte';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	// Mobile tab navigation
	type TabId = 'themes' | 'splash' | 'sounds' | 'avatar';
	let activeTab = $state<TabId>('themes');

	// Theme editor state
	let selectedThemeId = $state<string>('dark');
	let customization = $state<CustomizationConfig | null>(null);
	let loadError = $state<string | null>(null);
	const customizationStore = customizationConfigStore();
	let defaultAvatarInput = $state('');
	let savingDefaultAvatar = $state(false);
	let defaultAvatarError = $state<string | null>(null);
	let avatarFileInput: HTMLInputElement | null = $state(null);
	let uploadingAvatar = $state(false);

	// Load customization on mount
	onMount(async () => {
		try {
			// Add timeout to prevent infinite loading
			const timeoutPromise = new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Loading timeout')), 10000)
			);
			customization = await Promise.race([loadCustomizationConfig(), timeoutPromise]);
		} catch (err) {
			console.error('Failed to load customization:', err);
			loadError = (err as Error)?.message ?? 'Failed to load settings';
		}
	});

	// Sync store to local state
	$effect(() => {
		if ($customizationStore) {
			customization = $customizationStore;
		}
	});
	$effect(() => {
		if (customization) {
			defaultAvatarInput = customization.defaultAvatarUrl ?? '';
			defaultAvatarError = null;
		}
	});

	const openSplashDemo = () => {
		if (!browser) {
			showAdminToast({ type: 'info', message: 'Splash demo is only available in-browser.' });
			return;
		}
		window.open('/splash', '_blank', 'noopener');
	};

	// Theme editor handlers
	async function handleSaveTheme(themeId: string, overrides: Partial<ThemeColors>) {
		try {
			await saveThemeOverrides(themeId, overrides, data.user);
			showAdminToast({ type: 'success', message: `Theme "${themeId}" deployed!` });
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Failed to save theme.'
			});
			throw err;
		}
	}

	async function handleResetTheme(themeId: string) {
		try {
			await resetThemeToDefault(themeId, data.user);
			showAdminToast({ type: 'success', message: `Theme "${themeId}" reset to defaults.` });
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Failed to reset theme.'
			});
			throw err;
		}
	}

	function handleSelectTheme(themeId: string) {
		selectedThemeId = themeId;
	}

	// Splash editor handlers
	async function handleSaveSplash(config: Parameters<typeof saveSplashConfig>[0]) {
		try {
			await saveSplashConfig(config, data.user);
			showAdminToast({ type: 'success', message: 'Splash screen deployed!' });
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Failed to save splash settings.'
			});
			throw err;
		}
	}

	async function handleResetSplash() {
		try {
			await resetSplashToDefault(data.user);
			showAdminToast({ type: 'success', message: 'Splash screen reset to defaults.' });
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Failed to reset splash.'
			});
			throw err;
		}
	}

	function handleGifUploaded() {
		showAdminToast({ type: 'success', message: 'GIF uploaded to library!' });
	}

	function handleGifDeleted() {
		showAdminToast({ type: 'success', message: 'GIF removed from library.' });
	}

	const isValidDefaultAvatarUrl = (value: string) => {
		const trimmed = value.trim();
		if (!trimmed) return true;
		return (
			trimmed.startsWith('https://') ||
			trimmed.startsWith('http://') ||
			trimmed.startsWith('/') ||
			trimmed.startsWith('data:')
		);
	};

	const defaultAvatarPreview = $derived.by(() => {
		const trimmed = defaultAvatarInput.trim();
		if (trimmed) return trimmed;
		return customization?.defaultAvatarUrl ?? DEFAULT_AVATAR_URL;
	});

	async function handleSaveDefaultAvatar() {
		const trimmed = defaultAvatarInput.trim();
		if (!isValidDefaultAvatarUrl(trimmed)) {
			defaultAvatarError = 'Enter a valid URL (https://, /path, or data:).';
			showAdminToast({ type: 'error', message: defaultAvatarError });
			return;
		}
		defaultAvatarError = null;
		savingDefaultAvatar = true;
		try {
			await saveDefaultAvatarUrl(trimmed || null, data.user);
			showAdminToast({ type: 'success', message: 'Default avatar updated.' });
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Failed to update default avatar.'
			});
		} finally {
			savingDefaultAvatar = false;
		}
	}

	async function handleResetDefaultAvatar() {
		savingDefaultAvatar = true;
		try {
			await resetDefaultAvatarUrl(data.user);
			showAdminToast({ type: 'success', message: 'Default avatar reset.' });
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Failed to reset default avatar.'
			});
		} finally {
			savingDefaultAvatar = false;
		}
	}

	function triggerAvatarUpload() {
		avatarFileInput?.click();
	}

	async function handleAvatarFileChange(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		// Validate file type
		if (!file.type.startsWith('image/')) {
			showAdminToast({ type: 'error', message: 'Please select an image file.' });
			return;
		}

		// Validate file size (max 2MB)
		if (file.size > 2 * 1024 * 1024) {
			showAdminToast({ type: 'error', message: 'Image must be under 2MB.' });
			return;
		}

		uploadingAvatar = true;
		try {
			const url = await uploadDefaultAvatarImage(file, data.user);
			defaultAvatarInput = url;
			showAdminToast({ type: 'success', message: 'Avatar uploaded and saved!' });
		} catch (err) {
			console.error(err);
			showAdminToast({
				type: 'error',
				message: (err as Error)?.message ?? 'Failed to upload avatar.'
			});
		} finally {
			uploadingAvatar = false;
			// Reset the input so the same file can be selected again
			if (input) input.value = '';
		}
	}

	const tabs: { id: TabId; label: string; icon: string }[] = [
		{ id: 'themes', label: 'Themes', icon: 'bx-palette' },
		{ id: 'splash', label: 'Splash', icon: 'bx-image' },
		{ id: 'sounds', label: 'Sounds', icon: 'bx-volume-full' },
		{ id: 'avatar', label: 'Avatar', icon: 'bx-user-circle' }
	];
</script>

<section class="appearance-page">
	<!-- Mobile tabs -->
	{#if $isMobileViewport}
		<div class="mobile-tabs">
			{#each tabs as tab (tab.id)}
				<button
					class="tab-btn"
					class:active={activeTab === tab.id}
					onclick={() => (activeTab = tab.id)}
				>
					<i class="bx {tab.icon}"></i>
					<span>{tab.label}</span>
				</button>
			{/each}
		</div>
	{/if}

	<div class="content-grid">
		<!-- Theme Editor Panel -->
		{#if !$isMobileViewport || activeTab === 'themes'}
			<div class="panel themes-panel">
				<div class="panel-header">
					<div class="header-icon purple">
						<i class="bx bx-palette"></i>
					</div>
					<div class="header-text">
						<h2>Theme Customization</h2>
						<p>Create and edit themes, preview before deploying</p>
					</div>
				</div>

				{#if customization}
					<ThemeEditor
						config={customization}
						{selectedThemeId}
						user={data.user}
						onSave={handleSaveTheme}
						onReset={handleResetTheme}
						onSelectTheme={handleSelectTheme}
					/>
				{:else if loadError}
					<div class="error-state">
						<i class="bx bx-error-circle"></i>
						<p>{loadError}</p>
						<button class="retry-btn" onclick={() => location.reload()}>
							<i class="bx bx-refresh"></i>
							Retry
						</button>
					</div>
				{:else}
					<div class="loading-state">
						<i class="bx bx-loader-alt bx-spin"></i>
						<p>Loading theme settings...</p>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Splash Editor Panel -->
		{#if !$isMobileViewport || activeTab === 'splash'}
			<div class="panel splash-panel">
				<div class="panel-header">
					<div class="header-icon orange">
						<i class="bx bx-image"></i>
					</div>
					<div class="header-text">
						<h2>Splash Screen</h2>
						<p>Customize app launch animation</p>
					</div>
					<button class="preview-demo-btn" onclick={openSplashDemo}>
						<i class="bx bx-play-circle"></i>
						Preview Demo
					</button>
				</div>

				{#if customization}
					<SplashEditor
						config={customization.splash}
						cachedGifs={customization.splashGifs ?? []}
						customThemes={customization.customThemes ?? []}
						user={data.user}
						onSave={handleSaveSplash}
						onReset={handleResetSplash}
						onGifUploaded={handleGifUploaded}
						onGifDeleted={handleGifDeleted}
					/>
				{:else if loadError}
					<div class="error-state">
						<i class="bx bx-error-circle"></i>
						<p>{loadError}</p>
					</div>
				{:else}
					<div class="loading-state">
						<i class="bx bx-loader-alt bx-spin"></i>
						<p>Loading splash settings...</p>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Sound Editor Panel -->
		{#if !$isMobileViewport || activeTab === 'sounds'}
			<div class="panel sounds-panel">
				<div class="panel-header">
					<div class="header-icon teal">
						<i class="bx bx-volume-full"></i>
					</div>
					<div class="header-text">
						<h2>Sound Effects</h2>
						<p>Upload and apply global notification and call sounds</p>
					</div>
				</div>

				{#if customization}
					<SoundEditor sounds={customization.sounds} user={data.user} />
				{:else if loadError}
					<div class="error-state">
						<i class="bx bx-error-circle"></i>
						<p>{loadError}</p>
					</div>
				{:else}
					<div class="loading-state">
						<i class="bx bx-loader-alt bx-spin"></i>
						<p>Loading sound settings...</p>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Default Avatar Panel -->
		{#if !$isMobileViewport || activeTab === 'avatar'}
			<div class="panel avatar-panel">
				<div class="panel-header">
					<div class="header-icon teal">
						<i class="bx bx-user-circle"></i>
					</div>
					<div class="header-text">
						<h2>Default Avatar</h2>
						<p>Set the fallback avatar shown when users have no photo.</p>
					</div>
				</div>

				{#if customization}
					<div class="default-avatar-body">
						<div class="default-avatar-preview">
							{#if uploadingAvatar}
								<div class="avatar-uploading">
									<i class="bx bx-loader-alt bx-spin"></i>
								</div>
							{:else}
								<img
									src={defaultAvatarPreview}
									alt="Default avatar preview"
									loading="lazy"
									referrerpolicy="no-referrer"
								/>
							{/if}
							<button
								type="button"
								class="avatar-upload-overlay"
								onclick={triggerAvatarUpload}
								disabled={uploadingAvatar || savingDefaultAvatar}
								title="Upload image"
							>
								<i class="bx bx-upload"></i>
							</button>
							<input
								type="file"
								accept="image/*"
								class="hidden-file-input"
								bind:this={avatarFileInput}
								onchange={handleAvatarFileChange}
							/>
						</div>
						<div class="default-avatar-fields">
							<div class="default-avatar-upload-hint">
								<i class="bx bx-info-circle"></i>
								<span>Click the avatar to upload an image, or enter a URL below.</span>
							</div>
							<label class="default-avatar-label" for="default-avatar-url">
								Default avatar URL
							</label>
							<input
								id="default-avatar-url"
								class="default-avatar-input"
								type="text"
								placeholder="https://..."
								bind:value={defaultAvatarInput}
							/>
							{#if defaultAvatarError}
								<p class="default-avatar-error">{defaultAvatarError}</p>
							{:else}
								<p class="default-avatar-help">
									Leave blank to use the built-in default.
								</p>
							{/if}
							<div class="default-avatar-actions">
								<button
									class="upload-btn"
									onclick={triggerAvatarUpload}
									disabled={uploadingAvatar || savingDefaultAvatar}
								>
									<i class="bx bx-upload"></i>
									{uploadingAvatar ? 'Uploading...' : 'Upload Image'}
								</button>
								<button
									class="primary-btn"
									onclick={handleSaveDefaultAvatar}
									disabled={savingDefaultAvatar || uploadingAvatar}
								>
									{savingDefaultAvatar ? 'Saving...' : 'Save URL'}
								</button>
								<button
									class="secondary-btn"
									onclick={handleResetDefaultAvatar}
									disabled={savingDefaultAvatar || uploadingAvatar}
								>
									Reset
								</button>
							</div>
						</div>
					</div>
				{:else if loadError}
					<div class="error-state">
						<i class="bx bx-error-circle"></i>
						<p>{loadError}</p>
					</div>
				{:else}
					<div class="loading-state">
						<i class="bx bx-loader-alt bx-spin"></i>
						<p>Loading avatar settings...</p>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</section>

<style>
	.appearance-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		height: 100%;
		padding: 1rem;
		overflow-y: auto;
	}

	/* Mobile tabs */
	.mobile-tabs {
		display: flex;
		gap: 0.25rem;
		padding: 0.25rem;
		background: var(--surface-panel);
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		flex-shrink: 0;
	}

	.tab-btn {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
		padding: 0.75rem 1rem;
		border: none;
		border-radius: 10px;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.tab-btn i {
		font-size: 1.25rem;
	}

	.tab-btn.active {
		background: color-mix(in srgb, var(--accent-primary, var(--color-accent)) 15%, transparent);
		color: var(--accent-primary, var(--color-accent));
	}

	/* Content grid */
	.content-grid {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		flex: 1;
		min-height: 0;
	}

	/* Panel base */
	.panel {
		background: var(--surface-panel);
		border-radius: 14px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.panel-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
	}

	.header-icon {
		width: 2.75rem;
		height: 2.75rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 12px;
		background: linear-gradient(
			135deg,
			var(--accent-primary, var(--color-accent)),
			color-mix(in srgb, var(--accent-primary, var(--color-accent)) 70%, #10b981)
		);
		flex-shrink: 0;
	}

	.header-icon i {
		font-size: 1.375rem;
		color: white;
	}

	.header-icon.purple {
		background: linear-gradient(135deg, #8b5cf6, #a855f7);
	}

	.header-icon.orange {
		background: linear-gradient(135deg, #f59e0b, #f97316);
	}

	.header-icon.teal {
		background: linear-gradient(135deg, #2dd4bf, #14b8a6);
	}

	.header-text {
		flex: 1;
	}

	.header-text h2 {
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.header-text p {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		margin: 0.125rem 0 0;
	}

	.preview-demo-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.875rem;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		flex-shrink: 0;
	}

	.preview-demo-btn:hover {
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
		color: var(--color-text-primary);
	}

	.preview-demo-btn i {
		font-size: 1rem;
	}

	/* Loading state */
	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3rem;
		color: var(--color-text-secondary);
	}

	.loading-state i {
		font-size: 1.75rem;
		opacity: 0.5;
	}

	.loading-state p {
		margin: 0;
		font-size: 0.875rem;
	}

	/* Error state */
	.error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3rem;
		color: #ef4444;
	}

	.error-state i {
		font-size: 2rem;
	}

	.error-state p {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.retry-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.retry-btn:hover {
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
		color: var(--color-text-primary);
	}

	.default-avatar-body {
		display: flex;
		gap: 1.25rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.default-avatar-preview {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		overflow: hidden;
		background: var(--color-panel, #2a2e33);
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.default-avatar-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.default-avatar-fields {
		flex: 1;
		min-width: 220px;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.default-avatar-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.default-avatar-input {
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		background: var(--color-panel, #23272a);
		padding: 0.65rem 0.75rem;
		color: var(--color-text-primary);
		font-size: 0.85rem;
	}

	.default-avatar-input::placeholder {
		color: var(--color-text-secondary);
	}

	.default-avatar-help {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.default-avatar-error {
		font-size: 0.75rem;
		color: var(--color-danger, #df5f5f);
	}

	.default-avatar-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.primary-btn,
	.secondary-btn {
		border-radius: 10px;
		padding: 0.5rem 0.9rem;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		border: none;
		transition: all 0.2s ease;
	}

	.primary-btn {
		background: var(--accent-primary, #14b8a6);
		color: #0b0f14;
	}

	.primary-btn:hover {
		filter: brightness(1.05);
	}

	.secondary-btn {
		background: color-mix(in srgb, var(--color-text-primary) 12%, transparent);
		color: var(--color-text-primary);
	}

	.secondary-btn:hover {
		background: color-mix(in srgb, var(--color-text-primary) 18%, transparent);
	}

	.primary-btn:disabled,
	.secondary-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.upload-btn {
		border-radius: 10px;
		padding: 0.5rem 0.9rem;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid var(--accent-primary, #14b8a6);
		background: transparent;
		color: var(--accent-primary, #14b8a6);
		transition: all 0.2s ease;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.upload-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--accent-primary, #14b8a6) 15%, transparent);
	}

	.upload-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.default-avatar-preview {
		position: relative;
	}

	.avatar-upload-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.5);
		border-radius: 50%;
		opacity: 0;
		transition: opacity 0.2s ease;
		cursor: pointer;
		border: none;
		color: #fff;
		font-size: 1.5rem;
	}

	.default-avatar-preview:hover .avatar-upload-overlay {
		opacity: 1;
	}

	.avatar-upload-overlay:disabled {
		cursor: not-allowed;
	}

	.hidden-file-input {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
	}

	.avatar-uploading {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--accent-primary, #14b8a6);
		font-size: 1.5rem;
	}

	.default-avatar-upload-hint {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		background: color-mix(in srgb, var(--accent-primary, #14b8a6) 10%, transparent);
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		margin-bottom: 0.25rem;
	}

	.default-avatar-upload-hint i {
		color: var(--accent-primary, #14b8a6);
	}

	/* Desktop layout */
	@media (min-width: 768px) {
		.appearance-page {
			padding: 1.5rem;
		}

		.content-grid {
			display: flex;
			flex-direction: column;
			gap: 1.5rem;
			max-width: 900px;
			margin: 0 auto;
		}

		.themes-panel,
		.splash-panel,
		.sounds-panel,
		.avatar-panel {
			width: 100%;
		}
	}
</style>
