<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { ThemeColors, CustomTheme, CustomizationConfig } from '$lib/admin/customization';
	import {
		BASE_THEME_COLORS,
		getThemeColors,
		getAllThemes,
		createCustomTheme,
		deleteCustomTheme
	} from '$lib/admin/customization';
	import type { User } from 'firebase/auth';

	interface Props {
		config: CustomizationConfig;
		selectedThemeId: string;
		user: User | null;
		onSave: (themeId: string, overrides: Partial<ThemeColors>) => Promise<void>;
		onReset: (themeId: string) => Promise<void>;
		onSelectTheme: (themeId: string) => void;
	}

	let { config, selectedThemeId, user, onSave, onReset, onSelectTheme }: Props = $props();

	const dispatch = createEventDispatcher<{ preview: Partial<ThemeColors> }>();

	let saving = $state(false);
	let showCreateModal = $state(false);
	let newThemeName = $state('');
	let creating = $state(false);

	// Get available themes
	const availableThemes = $derived(getAllThemes(config));
	const isBuiltIn = $derived(['dark', 'light', 'midnight'].includes(selectedThemeId));

	// Get base colors for the selected theme
	const baseColors = $derived(getThemeColors(selectedThemeId, config));

	// Editable color values
	let colors = $state<ThemeColors>({ ...BASE_THEME_COLORS.dark });

	// Sync colors when theme changes
	$effect(() => {
		if (baseColors && Object.keys(baseColors).length > 0) {
			colors = { ...baseColors };
		}
	});

	// Core colors to edit
	const coreColors: { key: keyof ThemeColors; label: string; icon: string }[] = [
		{ key: 'colorAccent', label: 'Accent', icon: 'bx-star' },
		{ key: 'colorAppBg', label: 'Background', icon: 'bx-square' },
		{ key: 'colorSidebar', label: 'Sidebar', icon: 'bx-layout' },
		{ key: 'colorPanel', label: 'Panels', icon: 'bx-window' },
		{ key: 'colorTextPrimary', label: 'Text', icon: 'bx-font' },
		{ key: 'colorDanger', label: 'Danger', icon: 'bx-error' }
	];

	// Get only the changed values for saving
	const changedOverrides = $derived(() => {
		const changes: Partial<ThemeColors> = {};
		for (const key of Object.keys(colors) as (keyof ThemeColors)[]) {
			if (colors[key] !== baseColors[key]) {
				changes[key] = colors[key];
			}
		}
		return changes;
	});

	const hasChanges = $derived(Object.keys(changedOverrides()).length > 0);

	function handleColorChange(key: keyof ThemeColors, value: string) {
		colors[key] = value;
		// Auto-update derived colors
		if (key === 'colorAccent') {
			colors.colorAccentStrong = value;
			colors.colorAccentSoft = value + '24';
		}
		dispatch('preview', changedOverrides());
	}

	function resetAll() {
		colors = { ...baseColors };
		dispatch('preview', {});
	}

	async function handleSave() {
		saving = true;
		try {
			await onSave(selectedThemeId, changedOverrides());
		} finally {
			saving = false;
		}
	}

	async function handleReset() {
		saving = true;
		try {
			await onReset(selectedThemeId);
			resetAll();
		} finally {
			saving = false;
		}
	}

	async function handleCreateTheme() {
		if (!newThemeName.trim() || !user) return;
		creating = true;
		try {
			const id = await createCustomTheme(newThemeName.trim(), colors, user);
			newThemeName = '';
			showCreateModal = false;
			onSelectTheme(id);
		} finally {
			creating = false;
		}
	}

	async function handleDeleteTheme() {
		if (isBuiltIn || !user) return;
		saving = true;
		try {
			await deleteCustomTheme(selectedThemeId, user);
			onSelectTheme('dark'); // Switch to dark after deletion
		} finally {
			saving = false;
		}
	}

	// Sync with prop/selection changes
	$effect(() => {
		colors = { ...baseColors };
	});
</script>

<div class="theme-editor">
	<!-- Theme Selector -->
	<div class="theme-selector">
		<div class="selector-header">
			<span class="selector-label">Select Theme</span>
			<button class="create-btn" onclick={() => (showCreateModal = true)}>
				<i class="bx bx-plus"></i>
				New Theme
			</button>
		</div>
		<div class="theme-list">
			{#each availableThemes as theme (theme.id)}
				<button
					class="theme-option"
					class:active={selectedThemeId === theme.id}
					onclick={() => onSelectTheme(theme.id)}
				>
					<span
						class="theme-swatch"
						data-theme={theme.id}
						style="
            background: {theme.isCustom
							? (config.customThemes?.find((t) => t.id === theme.id)?.colors.colorAppBg ??
								'#1b2228')
							: (BASE_THEME_COLORS[theme.id as keyof typeof BASE_THEME_COLORS]?.colorAppBg ??
								'#1b2228')};
          "
					></span>
					<span class="theme-name">{theme.name}</span>
					{#if theme.isCustom}
						<span class="custom-badge">Custom</span>
					{/if}
				</button>
			{/each}
		</div>
	</div>

	<!-- Live Preview Panel -->
	<div
		class="preview-panel"
		style="
    --preview-bg: {colors.colorAppBg};
    --preview-sidebar: {colors.colorSidebar};
    --preview-panel: {colors.colorPanel};
    --preview-accent: {colors.colorAccent};
    --preview-text: {colors.colorTextPrimary};
    --preview-danger: {colors.colorDanger};
  "
	>
		<div class="preview-label">
			<i class="bx bx-show"></i>
			Live Preview
		</div>
		<div class="preview-app">
			<div class="preview-sidebar">
				<div class="preview-logo">
					<div class="logo-circle" style="background: var(--preview-accent)"></div>
				</div>
				<div class="preview-nav">
					<div class="nav-item active" style="background: var(--preview-accent)"></div>
					<div class="nav-item"></div>
					<div class="nav-item"></div>
					<div class="nav-item"></div>
				</div>
			</div>
			<div class="preview-main">
				<div class="preview-header">
					<div class="header-title" style="background: var(--preview-text); opacity: 0.9"></div>
					<div class="header-actions">
						<div class="action-btn-preview" style="background: var(--preview-accent)"></div>
					</div>
				</div>
				<div class="preview-content">
					<div class="preview-card">
						<div class="card-line long" style="background: var(--preview-text); opacity: 0.8"></div>
						<div
							class="card-line short"
							style="background: var(--preview-text); opacity: 0.5"
						></div>
					</div>
					<div class="preview-card">
						<div class="card-line long" style="background: var(--preview-text); opacity: 0.8"></div>
						<div
							class="card-line medium"
							style="background: var(--preview-text); opacity: 0.5"
						></div>
					</div>
					<div class="preview-buttons">
						<div class="btn primary" style="background: var(--preview-accent)"></div>
						<div class="btn danger" style="background: var(--preview-danger)"></div>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Color Controls -->
	<div class="color-controls">
		{#each coreColors as field (field.key)}
			{@const colorValue = colors[field.key] ?? '#3fd4cb'}
			<label class="color-control">
				<div class="control-info">
					<i class="bx {field.icon}"></i>
					<span>{field.label}</span>
				</div>
				<div class="control-input">
					<input
						type="color"
						value={colorValue.startsWith('rgba') || colorValue.startsWith('color-mix')
							? '#3fd4cb'
							: colorValue}
						onchange={(e) => handleColorChange(field.key, e.currentTarget.value)}
					/>
					<span class="color-value">{colorValue.slice(0, 7)}</span>
				</div>
			</label>
		{/each}
	</div>

	<!-- Actions -->
	<div class="editor-actions">
		{#if !isBuiltIn}
			<button class="btn-delete" onclick={handleDeleteTheme} disabled={saving}>
				<i class="bx bx-trash"></i>
				Delete
			</button>
		{/if}
		<button class="btn-reset" onclick={handleReset} disabled={saving || !hasChanges}>
			<i class="bx bx-reset"></i>
			Reset
		</button>
		<button class="btn-save" onclick={handleSave} disabled={saving || !hasChanges}>
			{#if saving}
				<i class="bx bx-loader-alt bx-spin"></i>
			{:else}
				<i class="bx bx-check"></i>
			{/if}
			Deploy
		</button>
	</div>
</div>

<!-- Create Theme Modal -->
{#if showCreateModal}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => (showCreateModal = false)} role="presentation">
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="modal-content"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="modal-header">
				<h3>Create New Theme</h3>
				<button
					class="close-btn"
					onclick={() => (showCreateModal = false)}
					aria-label="Close dialog"
				>
					<i class="bx bx-x"></i>
				</button>
			</div>
			<div class="modal-body">
				<label class="form-field">
					<span>Theme Name</span>
					<input
						type="text"
						bind:value={newThemeName}
						placeholder="My Custom Theme"
						class="text-input"
					/>
				</label>
				<p class="help-text">
					The new theme will be created using the current color settings as a starting point.
				</p>
			</div>
			<div class="modal-actions">
				<button class="btn-cancel" onclick={() => (showCreateModal = false)}> Cancel </button>
				<button
					class="btn-create"
					onclick={handleCreateTheme}
					disabled={!newThemeName.trim() || creating}
				>
					{#if creating}
						<i class="bx bx-loader-alt bx-spin"></i>
					{:else}
						<i class="bx bx-plus"></i>
					{/if}
					Create Theme
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.theme-editor {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* Theme Selector */
	.theme-selector {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.selector-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.selector-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--color-text-secondary);
	}

	.create-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.625rem;
		border-radius: 6px;
		border: 1px dashed
			color-mix(in srgb, var(--accent-primary, var(--color-accent)) 50%, transparent);
		background: transparent;
		color: var(--accent-primary, var(--color-accent));
		font-size: 0.6875rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.create-btn:hover {
		background: color-mix(in srgb, var(--accent-primary, var(--color-accent)) 10%, transparent);
		border-style: solid;
	}

	.theme-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.theme-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 0.8125rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.theme-option:hover {
		border-color: color-mix(in srgb, var(--color-text-primary) 25%, transparent);
	}

	.theme-option.active {
		border-color: var(--accent-primary, var(--color-accent));
		background: color-mix(in srgb, var(--accent-primary, var(--color-accent)) 10%, transparent);
		color: var(--color-text-primary);
	}

	.theme-swatch {
		width: 1rem;
		height: 1rem;
		border-radius: 4px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 20%, transparent);
	}

	.theme-name {
		font-weight: 500;
	}

	.custom-badge {
		font-size: 0.5625rem;
		padding: 0.125rem 0.375rem;
		border-radius: 9999px;
		background: color-mix(in srgb, var(--accent-primary, var(--color-accent)) 20%, transparent);
		color: var(--accent-primary, var(--color-accent));
		text-transform: uppercase;
		letter-spacing: 0.5px;
		font-weight: 700;
	}

	/* Live Preview */
	.preview-panel {
		position: relative;
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
	}

	.preview-label {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		background: rgba(0, 0, 0, 0.6);
		border-radius: 6px;
		font-size: 0.625rem;
		font-weight: 600;
		color: white;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		z-index: 10;
	}

	.preview-label i {
		font-size: 0.75rem;
	}

	.preview-app {
		display: flex;
		height: 220px;
		background: var(--preview-bg);
	}

	.preview-sidebar {
		width: 56px;
		background: var(--preview-sidebar);
		padding: 0.75rem 0.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		border-right: 1px solid rgba(255, 255, 255, 0.1);
	}

	.preview-logo {
		padding: 0.25rem;
	}

	.logo-circle {
		width: 32px;
		height: 32px;
		border-radius: 10px;
	}

	.preview-nav {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.nav-item {
		width: 36px;
		height: 36px;
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.1);
	}

	.nav-item.active {
		opacity: 0.9;
	}

	.preview-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		background: var(--preview-panel);
	}

	.preview-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}

	.header-title {
		width: 120px;
		height: 14px;
		border-radius: 4px;
	}

	.header-actions {
		display: flex;
		gap: 0.5rem;
	}

	.action-btn-preview {
		width: 70px;
		height: 28px;
		border-radius: 6px;
	}

	.preview-content {
		flex: 1;
		padding: 1rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.preview-card {
		padding: 0.875rem;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.card-line {
		height: 10px;
		border-radius: 5px;
	}

	.card-line.long {
		width: 85%;
	}

	.card-line.medium {
		width: 60%;
	}

	.card-line.short {
		width: 45%;
	}

	.preview-buttons {
		display: flex;
		gap: 0.625rem;
		margin-top: auto;
	}

	.btn {
		height: 28px;
		border-radius: 6px;
		flex: 1;
	}

	/* Color Controls */
	.color-controls {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
	}

	.color-control {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.625rem 0.75rem;
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
		border-radius: 10px;
		cursor: pointer;
		transition: background 0.2s;
	}

	.color-control:hover {
		background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
	}

	.control-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.control-info i {
		font-size: 1rem;
		color: var(--color-text-secondary);
	}

	.control-input {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.control-input input[type='color'] {
		width: 28px;
		height: 28px;
		padding: 0;
		border: 2px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		border-radius: 6px;
		cursor: pointer;
		overflow: hidden;
	}

	.control-input input[type='color']::-webkit-color-swatch-wrapper {
		padding: 0;
	}

	.control-input input[type='color']::-webkit-color-swatch {
		border: none;
		border-radius: 4px;
	}

	.color-value {
		font-size: 0.6875rem;
		font-family: monospace;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		min-width: 52px;
	}

	/* Actions */
	.editor-actions {
		display: flex;
		gap: 0.5rem;
	}

	.btn-delete,
	.btn-reset,
	.btn-save {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-radius: 10px;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-delete {
		border: 1px solid color-mix(in srgb, #ef4444 40%, transparent);
		background: transparent;
		color: #ef4444;
	}

	.btn-delete:hover:not(:disabled) {
		background: color-mix(in srgb, #ef4444 10%, transparent);
	}

	.btn-reset {
		flex: 1;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		background: transparent;
		color: var(--color-text-secondary);
	}

	.btn-reset:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
		color: var(--color-text-primary);
	}

	.btn-save {
		flex: 1;
		border: none;
		background: linear-gradient(
			135deg,
			var(--accent-primary, var(--color-accent)),
			color-mix(in srgb, var(--accent-primary, var(--color-accent)) 80%, #10b981)
		);
		color: white;
	}

	.btn-save:hover:not(:disabled) {
		opacity: 0.9;
	}

	.btn-delete:disabled,
	.btn-reset:disabled,
	.btn-save:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Modal */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
	}

	.modal-content {
		background: var(--surface-panel, var(--color-panel));
		border-radius: 16px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		width: 100%;
		max-width: 400px;
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
	}

	.modal-header h3 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.close-btn {
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all 0.2s;
	}

	.close-btn:hover {
		background: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
		color: var(--color-text-primary);
	}

	.close-btn i {
		font-size: 1.25rem;
	}

	.modal-body {
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.form-field span {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.text-input {
		padding: 0.625rem 0.875rem;
		border-radius: 8px;
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
		color: var(--color-text-primary);
		font-size: 0.875rem;
	}

	.text-input:focus {
		outline: none;
		border-color: var(--accent-primary, var(--color-accent));
	}

	.help-text {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin: 0;
		line-height: 1.5;
	}

	.modal-actions {
		display: flex;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border-top: 1px solid color-mix(in srgb, var(--color-text-primary) 10%, transparent);
	}

	.btn-cancel,
	.btn-create {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.625rem 1rem;
		border-radius: 8px;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-cancel {
		border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
		background: transparent;
		color: var(--color-text-secondary);
	}

	.btn-cancel:hover {
		background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
	}

	.btn-create {
		border: none;
		background: linear-gradient(
			135deg,
			var(--accent-primary, var(--color-accent)),
			color-mix(in srgb, var(--accent-primary, var(--color-accent)) 80%, #10b981)
		);
		color: white;
	}

	.btn-create:hover:not(:disabled) {
		opacity: 0.9;
	}

	.btn-create:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 640px) {
		.color-controls {
			grid-template-columns: repeat(2, 1fr);
		}

		.preview-app {
			height: 180px;
		}

		.preview-sidebar {
			width: 48px;
		}

		.logo-circle {
			width: 28px;
			height: 28px;
		}

		.nav-item {
			width: 32px;
			height: 32px;
		}

		.theme-list {
			flex-direction: column;
		}

		.theme-option {
			width: 100%;
		}
	}
</style>
