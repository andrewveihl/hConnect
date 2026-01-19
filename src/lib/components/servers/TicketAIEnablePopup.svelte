<svelte:options runes={false} />

<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import {
		fetchTicketAiSettings,
		saveTicketAiSettings,
		normalizeSettings
	} from '$lib/firestore/ticketAi';

	export let open = false;
	export let serverId: string;
	export let currentUserId: string | null = null;

	const dispatch = createEventDispatcher<{
		close: void;
		configure: { tab: 'analytics' | 'setup' };
		toggle: { enabled: boolean };
	}>();

	let enabled = false;
	let loading = true;
	let saving = false;
	let error: string | null = null;

	$: if (open && serverId) {
		loadSettings();
	}

	async function loadSettings() {
		loading = true;
		error = null;
		try {
			const settings = await fetchTicketAiSettings(serverId);
			enabled = settings.enabled;
		} catch (e) {
			console.error('[TicketAIEnablePopup] Failed to load settings', e);
			error = 'Failed to load settings';
		} finally {
			loading = false;
		}
	}

	async function handleToggle() {
		saving = true;
		error = null;
		try {
			const newEnabled = !enabled;
			await saveTicketAiSettings(serverId, { enabled: newEnabled }, currentUserId);
			enabled = newEnabled;
			dispatch('toggle', { enabled: newEnabled });
		} catch (e) {
			console.error('[TicketAIEnablePopup] Failed to save settings', e);
			error = 'Failed to update settings';
		} finally {
			saving = false;
		}
	}

	function close() {
		dispatch('close');
	}

	function openConfig(tab: 'analytics' | 'setup' = 'analytics') {
		dispatch('configure', { tab });
	}
</script>

{#if open}
	<div
		class="popup-backdrop"
		role="dialog"
		aria-modal="true"
		tabindex="0"
		on:click={(e) => {
			if (e.target === e.currentTarget) close();
		}}
		on:keydown={(e) => {
			if (e.key === 'Escape') close();
		}}
	>
		<div class="popup-container" role="document">
			<!-- Header -->
			<div class="popup-header">
				<div class="popup-icon">
					<i class="bx bx-bot"></i>
				</div>
				<button class="popup-close" aria-label="Close" on:click={close}>
					<i class="bx bx-x"></i>
				</button>
			</div>

			<!-- Content -->
			<div class="popup-content">
				<h2>Issue Tracker</h2>
				<p class="popup-description">
					Track and analyze support issues in your channels. Get insights on response times,
					resolution rates, and team performance—all powered by AI.
				</p>

				{#if loading}
					<div class="popup-loading">
						<div class="spinner"></div>
						<span>Loading...</span>
					</div>
				{:else}
					<!-- Status Card -->
					<div class="status-card" class:status-card--enabled={enabled}>
						<div class="status-info">
							<div class="status-badge" class:status-badge--on={enabled}>
								<i class="bx {enabled ? 'bx-check-circle' : 'bx-circle'}"></i>
								<span>{enabled ? 'Active' : 'Inactive'}</span>
							</div>
							<p class="status-text">
								{#if enabled}
									Issue Tracker is monitoring your configured channels.
								{:else}
									Enable to start tracking issues and collecting analytics.
								{/if}
							</p>
						</div>
						<button
							class="toggle-btn"
							class:toggle-btn--off={enabled}
							on:click={handleToggle}
							disabled={saving}
						>
							{#if saving}
								<div class="spinner-small"></div>
							{:else}
								{enabled ? 'Disable' : 'Enable'}
							{/if}
						</button>
					</div>

					<!-- Features Preview -->
					<div class="features-grid">
						<div class="feature-item">
							<i class="bx bx-time-five"></i>
							<span>Response Time</span>
						</div>
						<div class="feature-item">
							<i class="bx bx-check-double"></i>
							<span>Resolution Rate</span>
						</div>
						<div class="feature-item">
							<i class="bx bx-message-square-dots"></i>
							<span>Thread Analytics</span>
						</div>
						<div class="feature-item">
							<i class="bx bx-trophy"></i>
							<span>Team Leaderboard</span>
						</div>
					</div>

					{#if error}
						<p class="popup-error">{error}</p>
					{/if}
				{/if}
			</div>

			<!-- Actions -->
			<div class="popup-actions">
				<button class="btn-secondary" on:click={close}>Close</button>
				<div class="popup-actions__primary">
					<button class="btn-analytics" on:click={() => openConfig('analytics')} disabled={loading}>
						<i class="bx bx-bar-chart-alt-2"></i>
						Analytics
					</button>
					<button class="btn-primary" on:click={() => openConfig('setup')} disabled={loading}>
						<i class="bx bx-cog"></i>
						Settings
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.popup-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(4px);
		padding: 1rem;
	}

	.popup-container {
		width: min(28rem, 100%);
		background: var(--color-panel);
		border: 1px solid var(--color-border-subtle);
		border-radius: 1rem;
		box-shadow:
			0 0 0 1px rgba(255, 255, 255, 0.05),
			0 25px 50px -12px rgba(0, 0, 0, 0.5),
			0 0 100px -20px rgba(51, 200, 191, 0.15);
		overflow: hidden;
	}

	.popup-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 1.25rem 0;
		background: linear-gradient(
			to bottom,
			color-mix(in srgb, var(--color-accent) 8%, var(--color-panel)),
			var(--color-panel)
		);
	}

	.popup-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 3rem;
		border-radius: 0.75rem;
		background: linear-gradient(
			135deg,
			var(--color-accent),
			color-mix(in srgb, var(--color-accent) 70%, #8b5cf6)
		);
		font-size: 1.5rem;
		color: white;
		box-shadow: 0 4px 12px rgba(51, 200, 191, 0.3);
	}

	.popup-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--text-70);
		cursor: pointer;
		font-size: 1.25rem;
		transition: all 0.15s ease;
	}

	.popup-close:hover {
		background: var(--color-panel-muted);
		color: var(--color-text-primary);
	}

	.popup-content {
		padding: 1.25rem;
	}

	.popup-content h2 {
		margin: 0 0 0.5rem;
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.popup-description {
		margin: 0 0 1.25rem;
		font-size: 0.8125rem;
		line-height: 1.6;
		color: var(--text-60);
	}

	.popup-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 2rem;
		color: var(--text-60);
	}

	.spinner {
		width: 1.5rem;
		height: 1.5rem;
		border: 2px solid var(--color-panel-muted);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.spinner-small {
		width: 1rem;
		height: 1rem;
		border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
		border-top-color: currentColor;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.status-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border-radius: var(--radius-lg, 0.75rem);
		background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
		border: 1px solid var(--color-border-subtle);
		margin-bottom: 1.25rem;
		transition: all 0.2s ease;
	}

	.status-card--enabled {
		background: color-mix(in srgb, #22c55e 8%, var(--color-panel-muted));
		border-color: color-mix(in srgb, #22c55e 20%, var(--color-border-subtle));
	}

	.status-info {
		flex: 1;
		min-width: 0;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.625rem;
		border-radius: 1.25rem;
		background: var(--color-panel-muted);
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--text-60);
		margin-bottom: 0.5rem;
	}

	.status-badge--on {
		background: color-mix(in srgb, #22c55e 15%, transparent);
		color: #4ade80;
	}

	.status-text {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-60);
		line-height: 1.4;
	}

	.toggle-btn {
		flex-shrink: 0;
		padding: 0.625rem 1.25rem;
		border: none;
		border-radius: var(--radius-md, 0.5rem);
		background: linear-gradient(
			135deg,
			var(--color-accent),
			color-mix(in srgb, var(--color-accent) 70%, #8b5cf6)
		);
		color: white;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
		min-width: 5.625rem;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 2px 8px rgba(51, 200, 191, 0.2);
	}

	.toggle-btn:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 16px rgba(51, 200, 191, 0.3);
	}

	.toggle-btn--off {
		background: var(--color-panel-muted);
		color: var(--text-80);
		box-shadow: none;
	}

	.toggle-btn--off:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-panel-muted) 80%, var(--color-panel));
		box-shadow: none;
	}

	.toggle-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.features-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.625rem;
	}

	.feature-item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.75rem 0.875rem;
		border-radius: var(--radius-md, 0.5rem);
		background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
		border: 1px solid var(--color-border-subtle);
		font-size: 0.75rem;
		color: var(--text-70);
		transition: all 0.15s ease;
	}

	.feature-item:hover {
		border-color: color-mix(in srgb, var(--color-accent) 30%, var(--color-border-subtle));
	}

	.feature-item i {
		font-size: 1.125rem;
		color: var(--color-accent);
		opacity: 0.8;
	}

	.popup-error {
		margin: 1rem 0 0;
		padding: 0.625rem 0.75rem;
		border-radius: var(--radius-md, 0.5rem);
		background: color-mix(in srgb, #ef4444 10%, transparent);
		border: 1px solid color-mix(in srgb, #ef4444 20%, transparent);
		color: #f87171;
		font-size: 0.75rem;
	}

	.popup-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.625rem;
		padding: 1rem 1.25rem;
		background: color-mix(in srgb, var(--color-panel) 50%, var(--surface-root));
		border-top: 1px solid var(--color-border-subtle);
	}

	.popup-actions__primary {
		display: flex;
		gap: 0.5rem;
	}

	.btn-secondary {
		padding: 0.625rem 1.125rem;
		border: 1px solid var(--color-border-subtle);
		background: transparent;
		border-radius: var(--radius-md, 0.5rem);
		color: var(--text-70);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-secondary:hover {
		background: var(--color-panel-muted);
		border-color: color-mix(in srgb, var(--color-accent) 20%, var(--color-border-subtle));
		color: var(--color-text-primary);
	}

	.btn-primary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1.125rem;
		border: none;
		border-radius: var(--radius-md, 0.5rem);
		background: var(--color-panel-muted);
		color: var(--color-text-primary);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-accent) 15%, var(--color-panel-muted));
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-primary i {
		font-size: 1rem;
	}

	.btn-analytics {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1.125rem;
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-md, 0.5rem);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		color: var(--color-accent);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-analytics:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
	}

	.btn-analytics:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-analytics i {
		font-size: 1rem;
	}
</style>
