<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';

	import ServerSettingsPanel from '$lib/components/servers/ServerSettingsPanel.svelte';
	import {
		mapServerSectionToPanel,
		serverSettingsSections,
		type ServerSettingsSection,
		type ServerSettingsSectionId
	} from '$lib/servers/settingsSections';

	interface Props {
		open: boolean;
		activeSection: ServerSettingsSectionId;
		serverId?: string | null;
		featureModal?: 'ticketAi' | null;
	}

	let { open, activeSection, serverId = null, featureModal = null }: Props = $props();
	const dispatch = createEventDispatcher<{ close: void; section: ServerSettingsSectionId }>();

	let search = $state('');

	// Icon mapping for server sections
	const sectionIcons: Record<ServerSettingsSectionId, string> = {
		profile: 'bx-server',
		insights: 'bx-bar-chart-alt-2',
		channels: 'bx-hash',
		engagement: 'bx-message-square-dots',
		members: 'bx-group',
		roles: 'bx-shield',
		invites: 'bx-link',
		access: 'bx-lock-alt',
		integrations: 'bx-plug',
		'audit-log': 'bx-history',
		bans: 'bx-block',
		welcome: 'bx-door-open',
		danger: 'bx-error'
	};

	const filteredSections = $derived.by<ServerSettingsSection[]>(() => {
		const term = search.trim().toLowerCase();
		if (!term) return serverSettingsSections;
		return serverSettingsSections.filter((section) => {
			const haystack =
				`${section.label} ${section.group} ${section.keywords?.join(' ') ?? ''}`.toLowerCase();
			return haystack.includes(term);
		});
	});

	const groupedSections = $derived.by<Array<{ label: string; items: ServerSettingsSection[] }>>(
		() => {
			const groups: Record<string, ServerSettingsSection[]> = {};
			filteredSections.forEach((section) => {
				if (!groups[section.group]) {
					groups[section.group] = [];
				}
				groups[section.group] = [...groups[section.group], section];
			});
			return Object.entries(groups).map(([label, items]) => ({ label, items }));
		}
	);

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

	function pickSection(id: ServerSettingsSectionId) {
		activeSection = id;
		dispatch('section', id);
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="server-settings-backdrop"
		onclick={handleOverlayClick}
		onkeydown={handleOverlayKeydown}
		tabindex="-1"
		role="presentation"
		transition:fade={{ duration: 150 }}
	>
		<div
			class="server-settings-modal"
			role="dialog"
			aria-modal="true"
			aria-label="Server settings"
			tabindex="0"
			transition:fly={{ y: 20, duration: 200 }}
		>
			<!-- Header -->
			<header class="server-settings-modal__header">
				<div class="server-settings-modal__header-content">
					<div class="server-settings-modal__icon">
						<i class="bx bx-server" aria-hidden="true"></i>
					</div>
					<div>
						<h2 class="server-settings-modal__title">Server Settings</h2>
						<p class="server-settings-modal__subtitle">Configure your server preferences</p>
					</div>
				</div>
				<button
					type="button"
					class="server-settings-modal__close"
					aria-label="Close settings"
					onclick={requestClose}
				>
					<i class="bx bx-x" aria-hidden="true"></i>
				</button>
			</header>

			<div class="server-settings-modal__body">
				<!-- Sidebar -->
				<aside class="server-settings-modal__sidebar">
					<div class="server-settings-modal__search">
						<i class="bx bx-search server-settings-modal__search-icon" aria-hidden="true"></i>
						<input
							type="search"
							placeholder="Search settings..."
							class="server-settings-modal__search-input"
							bind:value={search}
						/>
						{#if search}
							<button
								type="button"
								class="server-settings-modal__search-clear"
								onclick={() => (search = '')}
								aria-label="Clear search"
							>
								<i class="bx bx-x" aria-hidden="true"></i>
							</button>
						{/if}
					</div>

					<nav class="server-settings-modal__nav">
						{#each groupedSections as group}
							<div class="server-settings-modal__nav-group">
								<p class="server-settings-modal__nav-label">{group.label}</p>
								{#each group.items as section (section.id)}
									<button
										type="button"
										class="server-settings-modal__nav-item"
										class:active={section.id === activeSection}
										class:danger={section.id === 'danger'}
										onclick={() => pickSection(section.id)}
									>
										<i
											class="bx {sectionIcons[section.id] ??
												'bx-cog'} server-settings-modal__nav-icon"
											aria-hidden="true"
										></i>
										<span class="server-settings-modal__nav-text">{section.label}</span>
										{#if section.id === activeSection}
											<span class="server-settings-modal__nav-indicator" aria-hidden="true"></span>
										{/if}
									</button>
								{/each}
							</div>
						{/each}
					</nav>

					<!-- Quick actions -->
					<div class="server-settings-modal__sidebar-footer">
						<button
							type="button"
							class="server-settings-modal__quick-action"
							onclick={requestClose}
						>
							<i class="bx bx-arrow-back" aria-hidden="true"></i>
							<span>Back to server</span>
						</button>
					</div>
				</aside>

				<!-- Content -->
				<section class="server-settings-modal__content">
					<ServerSettingsPanel
						{serverId}
						section={mapServerSectionToPanel(activeSection)}
						{featureModal}
						bare
					/>
				</section>
			</div>
		</div>
	</div>
{/if}

<style>
	.server-settings-backdrop {
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

	.server-settings-modal {
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
	.server-settings-modal__header {
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

	.server-settings-modal__header-content {
		display: flex;
		align-items: center;
		gap: 0.875rem;
	}

	.server-settings-modal__icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		background: linear-gradient(
			135deg,
			var(--color-accent),
			color-mix(in srgb, var(--color-accent) 70%, #8b5cf6)
		);
		border-radius: 0.625rem;
		color: white;
		font-size: 1.25rem;
		box-shadow: 0 4px 12px rgba(51, 200, 191, 0.3);
	}

	.server-settings-modal__title {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.server-settings-modal__subtitle {
		font-size: 0.75rem;
		color: var(--text-70);
		margin: 0.125rem 0 0;
	}

	.server-settings-modal__close {
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

	.server-settings-modal__close:hover {
		background: var(--color-panel-muted);
		color: var(--color-text-primary);
	}

	.server-settings-modal__close:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	/* Body */
	.server-settings-modal__body {
		display: flex;
		flex: 1;
		overflow: hidden;
	}

	/* Sidebar */
	.server-settings-modal__sidebar {
		display: flex;
		flex-direction: column;
		width: 15rem;
		flex-shrink: 0;
		background: color-mix(in srgb, var(--color-panel) 50%, var(--surface-root));
		border-right: 1px solid var(--color-border-subtle);
	}

	.server-settings-modal__search {
		position: relative;
		margin: 0.75rem;
	}

	.server-settings-modal__search-icon {
		position: absolute;
		left: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-70);
		font-size: 1rem;
		pointer-events: none;
	}

	.server-settings-modal__search-input {
		width: 100%;
		padding: 0.5rem 2rem 0.5rem 2.25rem;
		background: var(--color-panel-muted);
		border: 1px solid var(--color-border-subtle);
		border-radius: 0.5rem;
		color: var(--color-text-primary);
		font-size: 0.8125rem;
		transition: all 0.15s ease;
	}

	.server-settings-modal__search-input::placeholder {
		color: var(--color-text-tertiary);
	}

	.server-settings-modal__search-input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	.server-settings-modal__search-clear {
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

	.server-settings-modal__search-clear:hover {
		background: var(--color-panel);
		color: var(--color-text-primary);
	}

	/* Navigation */
	.server-settings-modal__nav {
		flex: 1;
		overflow-y: auto;
		padding: 0.25rem 0.5rem 1rem;
	}

	.server-settings-modal__nav-group {
		margin-top: 1rem;
	}

	.server-settings-modal__nav-group:first-child {
		margin-top: 0;
	}

	.server-settings-modal__nav-label {
		padding: 0 0.75rem;
		margin-bottom: 0.375rem;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-70);
	}

	.server-settings-modal__nav-item {
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

	.server-settings-modal__nav-item:hover {
		background: var(--color-panel-muted);
		color: var(--color-text-primary);
	}

	.server-settings-modal__nav-item.active {
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
	}

	.server-settings-modal__nav-item.danger {
		color: #f87171;
	}

	.server-settings-modal__nav-item.danger:hover {
		background: rgba(248, 113, 113, 0.1);
		color: #fca5a5;
	}

	.server-settings-modal__nav-item.danger.active {
		background: rgba(248, 113, 113, 0.15);
		color: #fca5a5;
	}

	.server-settings-modal__nav-icon {
		font-size: 1.125rem;
		flex-shrink: 0;
	}

	.server-settings-modal__nav-text {
		flex: 1;
	}

	.server-settings-modal__nav-indicator {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		background: var(--color-accent);
		box-shadow: 0 0 8px var(--color-accent);
	}

	.server-settings-modal__nav-item.danger .server-settings-modal__nav-indicator {
		background: #f87171;
		box-shadow: 0 0 8px #f87171;
	}

	/* Sidebar footer */
	.server-settings-modal__sidebar-footer {
		padding: 0.75rem;
		border-top: 1px solid var(--color-border-subtle);
	}

	.server-settings-modal__quick-action {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--text-70);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.server-settings-modal__quick-action:hover {
		background: var(--color-panel-muted);
		color: var(--color-text-primary);
	}

	/* Content */
	.server-settings-modal__content {
		flex: 1;
		overflow-y: auto;
		padding: 1.5rem;
		background: var(--surface-root);
	}

	/* Scrollbar styling */
	.server-settings-modal__nav::-webkit-scrollbar,
	.server-settings-modal__content::-webkit-scrollbar {
		width: 6px;
	}

	.server-settings-modal__nav::-webkit-scrollbar-track,
	.server-settings-modal__content::-webkit-scrollbar-track {
		background: transparent;
	}

	.server-settings-modal__nav::-webkit-scrollbar-thumb,
	.server-settings-modal__content::-webkit-scrollbar-thumb {
		background: var(--color-border-subtle);
		border-radius: 3px;
	}

	.server-settings-modal__nav::-webkit-scrollbar-thumb:hover,
	.server-settings-modal__content::-webkit-scrollbar-thumb:hover {
		background: var(--text-70);
	}

	/* Responsive */
	@media (max-width: 768px) {
		.server-settings-modal__sidebar {
			width: 12rem;
		}
	}
</style>
