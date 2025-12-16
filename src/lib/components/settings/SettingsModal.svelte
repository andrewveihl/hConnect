<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';

	import SettingsPanel from '$lib/components/settings/SettingsPanel.svelte';
	import {
		settingsSections,
		type SettingsSection,
		type SettingsSectionId
	} from '$lib/settings/sections';

	interface Props {
		open: boolean;
		activeSection: SettingsSectionId;
		serverId?: string | null;
	}

	let { open, activeSection, serverId = null }: Props = $props();
	const dispatch = createEventDispatcher<{ close: void; section: SettingsSectionId }>();

	let search = $state('');

	// Icon mapping for sections
	const sectionIcons: Record<SettingsSectionId, string> = {
		account: 'bx-user-circle',
		notifications: 'bx-bell',
		voice: 'bx-microphone',
		appearance: 'bx-palette',
		ai: 'bx-bot',
		invites: 'bx-link'
	};

	const filteredSections = $derived.by<SettingsSection[]>(() => {
		const term = search.trim().toLowerCase();
		if (!term) return settingsSections;
		return settingsSections.filter((section) => {
			const haystack =
				`${section.label} ${section.group} ${section.keywords?.join(' ') ?? ''}`.toLowerCase();
			return haystack.includes(term);
		});
	});

	const groupedSections = $derived.by<Array<{ label: string; items: SettingsSection[] }>>(() => {
		const groups: Record<string, SettingsSection[]> = {};
		filteredSections.forEach((section: SettingsSection) => {
			if (!groups[section.group]) {
				groups[section.group] = [];
			}
			groups[section.group] = [...groups[section.group], section];
		});
		return Object.entries(groups).map(([label, items]) => ({ label, items }));
	});

	function requestClose() {
		dispatch('close');
	}

	function handleOverlayClick(event: MouseEvent) {
		if (event.currentTarget === event.target) {
			requestClose();
		}
	}

	function handleOverlayKeydown(event: KeyboardEvent) {
		// Don't close if user is typing in an input/textarea
		const target = event.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
			return;
		}
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			requestClose();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			requestClose();
		}
	}

	function pickSection(section: SettingsSection) {
		activeSection = section.id;
		dispatch('section', section.id);
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="settings-modal-backdrop"
		tabindex="-1"
		aria-hidden="true"
		onclick={handleOverlayClick}
		onkeydown={handleOverlayKeydown}
		transition:fade={{ duration: 150 }}
	>
		<div
			class="settings-modal"
			role="dialog"
			aria-modal="true"
			aria-label="User settings"
			tabindex="0"
			transition:fly={{ y: 20, duration: 200 }}
		>
			<!-- Header -->
			<header class="settings-modal__header">
				<div class="settings-modal__header-content">
					<div class="settings-modal__icon">
						<i class="bx bx-cog" aria-hidden="true"></i>
					</div>
					<div>
						<h2 class="settings-modal__title">Settings</h2>
						<p class="settings-modal__subtitle">Manage your account and preferences</p>
					</div>
				</div>
				<button
					type="button"
					class="settings-modal__close"
					aria-label="Close settings"
					onclick={requestClose}
				>
					<i class="bx bx-x" aria-hidden="true"></i>
				</button>
			</header>

			<div class="settings-modal__body">
				<!-- Sidebar -->
				<aside class="settings-modal__sidebar">
					<div class="settings-modal__search">
						<i class="bx bx-search settings-modal__search-icon" aria-hidden="true"></i>
						<input
							type="search"
							placeholder="Search settings..."
							class="settings-modal__search-input"
							bind:value={search}
						/>
						{#if search}
							<button
								type="button"
								class="settings-modal__search-clear"
								onclick={() => (search = '')}
								aria-label="Clear search"
							>
								<i class="bx bx-x" aria-hidden="true"></i>
							</button>
						{/if}
					</div>

					<nav class="settings-modal__nav">
						{#each groupedSections as group}
							<div class="settings-modal__nav-group">
								<p class="settings-modal__nav-label">{group.label}</p>
								{#each group.items as section (section.id)}
									<button
										type="button"
										class="settings-modal__nav-item"
										class:active={section.id === activeSection}
										onclick={() => pickSection(section)}
									>
										<i
											class="bx {sectionIcons[section.id] ?? 'bx-cog'} settings-modal__nav-icon"
											aria-hidden="true"
										></i>
										<span class="settings-modal__nav-text">{section.label}</span>
										{#if section.id === activeSection}
											<span class="settings-modal__nav-indicator" aria-hidden="true"></span>
										{/if}
									</button>
								{/each}
							</div>
						{/each}
					</nav>

					<!-- Footer info in sidebar -->
					<div class="settings-modal__sidebar-footer">
						<p class="settings-modal__version">hConnect v1.0</p>
					</div>
				</aside>

				<!-- Content -->
				<section class="settings-modal__content">
					<SettingsPanel {serverId} {activeSection} />
				</section>
			</div>
		</div>
	</div>
{/if}

<style>
	.settings-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(4px);
		padding: 5vh 1.5rem 1.5rem;
	}

	.settings-modal {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 64rem;
		height: min(650px, calc(100vh - 6vh - 1.5rem));
		background: var(--color-panel);
		border: 1px solid var(--color-border-subtle);
		border-radius: 1rem;
		box-shadow:
			0 0 0 1px rgba(255, 255, 255, 0.05),
			0 25px 50px -12px rgba(0, 0, 0, 0.5),
			0 0 100px -20px rgba(51, 200, 191, 0.15);
		overflow: hidden;
	}

	/* Header */
	.settings-modal__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		background: linear-gradient(
			to bottom,
			color-mix(in srgb, var(--color-accent) 8%, var(--color-panel)),
			var(--color-panel)
		);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.settings-modal__header-content {
		display: flex;
		align-items: center;
		gap: 0.875rem;
	}

	.settings-modal__icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		background: linear-gradient(
			135deg,
			var(--color-accent),
			color-mix(in srgb, var(--color-accent) 70%, #6366f1)
		);
		border-radius: 0.625rem;
		color: white;
		font-size: 1.25rem;
		box-shadow: 0 4px 12px rgba(51, 200, 191, 0.3);
	}

	.settings-modal__title {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.settings-modal__subtitle {
		font-size: 0.75rem;
		color: var(--text-70);
		margin: 0.125rem 0 0;
	}

	.settings-modal__close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--text-70);
		font-size: 1.5rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.settings-modal__close:hover {
		background: var(--color-panel-muted);
		color: var(--color-text-primary);
	}

	.settings-modal__close:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	/* Body */
	.settings-modal__body {
		display: flex;
		flex: 1;
		overflow: hidden;
	}

	/* Sidebar */
	.settings-modal__sidebar {
		display: flex;
		flex-direction: column;
		width: 15rem;
		flex-shrink: 0;
		background: color-mix(in srgb, var(--color-panel) 50%, var(--surface-root));
		border-right: 1px solid var(--color-border-subtle);
	}

	.settings-modal__search {
		position: relative;
		margin: 0.75rem;
	}

	.settings-modal__search-icon {
		position: absolute;
		left: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-70);
		font-size: 1rem;
		pointer-events: none;
	}

	.settings-modal__search-input {
		width: 100%;
		padding: 0.5rem 2rem 0.5rem 2.25rem;
		background: var(--color-panel-muted);
		border: 1px solid var(--color-border-subtle);
		border-radius: 0.5rem;
		color: var(--color-text-primary);
		font-size: 0.8125rem;
		transition: all 0.15s ease;
	}

	.settings-modal__search-input::placeholder {
		color: var(--color-text-tertiary);
	}

	.settings-modal__search-input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	.settings-modal__search-clear {
		position: absolute;
		right: 0.375rem;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: var(--text-70);
		font-size: 1rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.settings-modal__search-clear:hover {
		background: var(--color-panel);
		color: var(--color-text-primary);
	}

	/* Navigation */
	.settings-modal__nav {
		flex: 1;
		overflow-y: auto;
		padding: 0.25rem 0.5rem 1rem;
	}

	.settings-modal__nav-group {
		margin-top: 1rem;
	}

	.settings-modal__nav-group:first-child {
		margin-top: 0;
	}

	.settings-modal__nav-label {
		padding: 0 0.75rem;
		margin-bottom: 0.375rem;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-70);
	}

	.settings-modal__nav-item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
		transition: all 0.15s ease;
		position: relative;
	}

	.settings-modal__nav-item:hover {
		background: var(--color-panel-muted);
		color: var(--color-text-primary);
	}

	.settings-modal__nav-item.active {
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
	}

	.settings-modal__nav-icon {
		font-size: 1.125rem;
		flex-shrink: 0;
	}

	.settings-modal__nav-text {
		flex: 1;
	}

	.settings-modal__nav-indicator {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		background: var(--color-accent);
		box-shadow: 0 0 8px var(--color-accent);
	}

	/* Sidebar footer */
	.settings-modal__sidebar-footer {
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--color-border-subtle);
	}

	.settings-modal__version {
		font-size: 0.6875rem;
		color: var(--text-70);
		opacity: 0.7;
		margin: 0;
	}

	/* Content */
	.settings-modal__content {
		flex: 1;
		overflow-y: auto;
		padding: 1.5rem;
		background: var(--surface-root);
	}

	/* Scrollbar styling */
	.settings-modal__nav::-webkit-scrollbar,
	.settings-modal__content::-webkit-scrollbar {
		width: 6px;
	}

	.settings-modal__nav::-webkit-scrollbar-track,
	.settings-modal__content::-webkit-scrollbar-track {
		background: transparent;
	}

	.settings-modal__nav::-webkit-scrollbar-thumb,
	.settings-modal__content::-webkit-scrollbar-thumb {
		background: var(--color-border-subtle);
		border-radius: 3px;
	}

	.settings-modal__nav::-webkit-scrollbar-thumb:hover,
	.settings-modal__content::-webkit-scrollbar-thumb:hover {
		background: var(--text-70);
	}

	/* Responsive */
	@media (max-width: 768px) {
		.settings-modal__sidebar {
			width: 12rem;
		}
	}
</style>
