<script lang="ts">
	import { fade, fly } from 'svelte/transition';

	export type AnnouncementDisplay = {
		id: string;
		title: string;
		message: string;
		type: 'info' | 'warning' | 'success' | 'error';
		category: 'update' | 'feature' | 'maintenance' | 'security' | 'general';
		version: string | null;
		dismissible: boolean;
	};

	interface Props {
		announcement: AnnouncementDisplay | null;
		onDismiss?: () => void;
	}

	let { announcement, onDismiss = () => {} }: Props = $props();

	const typeConfig = {
		info: {
			icon: 'bx-info-circle',
			color: 'sky',
			gradient: 'from-sky-500 to-blue-500'
		},
		warning: {
			icon: 'bx-error',
			color: 'amber',
			gradient: 'from-amber-500 to-orange-500'
		},
		success: {
			icon: 'bx-check-circle',
			color: 'emerald',
			gradient: 'from-emerald-500 to-teal-500'
		},
		error: {
			icon: 'bx-x-circle',
			color: 'rose',
			gradient: 'from-rose-500 to-pink-500'
		}
	};

	const categoryLabels: Record<string, string> = {
		update: "What's New",
		feature: 'New Feature',
		maintenance: 'Maintenance Notice',
		security: 'Security Update',
		general: 'Announcement'
	};

	const config = $derived(announcement ? typeConfig[announcement.type] : typeConfig.info);
	const categoryLabel = $derived(
		announcement ? categoryLabels[announcement.category] ?? 'Announcement' : 'Announcement'
	);

	const handleBackdropClick = (e: MouseEvent) => {
		if (announcement?.dismissible && e.target === e.currentTarget) {
			onDismiss();
		}
	};

	const handleKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Escape' && announcement?.dismissible) {
			onDismiss();
		}
	};

	// Parse message for basic markdown-like formatting
	const formatMessage = (text: string): string => {
		return text
			.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.*?)\*/g, '<em>$1</em>')
			.replace(/^- (.+)$/gm, '<li>$1</li>')
			.replace(/(<li>.*<\/li>)/gs, '<ul class="announcement-list">$1</ul>')
			.replace(/\n\n/g, '</p><p>')
			.replace(/\n/g, '<br>');
	};

	const formattedMessage = $derived(announcement ? formatMessage(announcement.message) : '');
</script>

<svelte:window on:keydown={handleKeydown} />

{#if announcement}
	<div
		class="announcement-overlay"
		role="presentation"
		transition:fade={{ duration: 200 }}
		onclick={handleBackdropClick}
		onkeydown={() => {}}
	>
		<div class="announcement-backdrop" aria-hidden="true"></div>
		<div
			class="announcement-card"
			role="dialog"
			aria-modal="true"
			aria-labelledby="announcement-title"
			aria-describedby="announcement-body"
			transition:fly={{ y: 20, duration: 300 }}
		>
			<!-- Header with icon -->
			<div class="announcement-header">
				<div class="announcement-icon bg-gradient-to-br {config.gradient}">
					<i class="bx {config.icon} text-2xl text-white"></i>
				</div>
				<div class="announcement-header-text">
					<span class="announcement-eyebrow">{categoryLabel}</span>
					{#if announcement.version}
						<span class="announcement-version">v{announcement.version}</span>
					{/if}
				</div>
				{#if announcement.dismissible}
					<button
						class="announcement-close"
						type="button"
						aria-label="Dismiss announcement"
						onclick={onDismiss}
					>
						<i class="bx bx-x"></i>
					</button>
				{/if}
			</div>

			<!-- Title -->
			<h2 id="announcement-title" class="announcement-title">{announcement.title}</h2>

			<!-- Message body -->
			<div id="announcement-body" class="announcement-body">
				<p>{@html formattedMessage}</p>
			</div>

			<!-- Actions -->
			<div class="announcement-actions">
				<button
					type="button"
					class="announcement-primary bg-gradient-to-r {config.gradient}"
					onclick={onDismiss}
				>
					{announcement.dismissible ? 'Got it!' : 'Continue'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.announcement-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem;
	}

	.announcement-backdrop {
		position: absolute;
		inset: 0;
		background: rgba(2, 6, 23, 0.7);
		backdrop-filter: blur(8px);
	}

	.announcement-card {
		position: relative;
		width: min(420px, 100%);
		max-height: calc(100vh - 4rem);
		border-radius: 1.25rem;
		background: var(--surface-panel, #1e1f22);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle, #3f3f46) 55%, transparent);
		box-shadow:
			0 20px 40px rgba(0, 0, 0, 0.35),
			0 0 0 1px rgba(255, 255, 255, 0.05) inset;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		overflow-y: auto;
	}

	.announcement-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.announcement-icon {
		width: 3rem;
		height: 3rem;
		border-radius: 0.875rem;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	.announcement-header-text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		flex: 1;
		min-width: 0;
	}

	.announcement-eyebrow {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-50, #94a3b8);
	}

	.announcement-version {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--accent-primary, #14b8a6);
	}

	.announcement-close {
		position: absolute;
		top: 1rem;
		right: 1rem;
		border: none;
		background: color-mix(in srgb, var(--color-text-primary, #fff) 8%, transparent);
		color: var(--text-50, #94a3b8);
		font-size: 1.25rem;
		cursor: pointer;
		border-radius: 0.5rem;
		width: 2rem;
		height: 2rem;
		display: grid;
		place-items: center;
		transition: all 0.15s ease;
	}

	.announcement-close:hover {
		background: color-mix(in srgb, var(--color-text-primary, #fff) 15%, transparent);
		color: var(--color-text-primary, #fff);
	}

	.announcement-title {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text-primary, #fff);
		line-height: 1.3;
		margin: 0;
	}

	.announcement-body {
		font-size: 0.9rem;
		line-height: 1.6;
		color: var(--text-70, #cbd5e1);
	}

	.announcement-body :global(p) {
		margin: 0;
	}

	.announcement-body :global(strong) {
		color: var(--color-text-primary, #fff);
		font-weight: 600;
	}

	.announcement-body :global(.announcement-list) {
		margin: 0.75rem 0;
		padding-left: 1.25rem;
		list-style: none;
	}

	.announcement-body :global(.announcement-list li) {
		position: relative;
		margin-bottom: 0.5rem;
		padding-left: 0.5rem;
	}

	.announcement-body :global(.announcement-list li::before) {
		content: '•';
		position: absolute;
		left: -1rem;
		color: var(--accent-primary, #14b8a6);
		font-weight: bold;
	}

	.announcement-actions {
		display: flex;
		gap: 0.75rem;
		padding-top: 0.5rem;
	}

	.announcement-primary {
		flex: 1;
		padding: 0.75rem 1.5rem;
		border: none;
		border-radius: 0.75rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: white;
		cursor: pointer;
		transition: all 0.2s ease;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
	}

	.announcement-primary:hover {
		transform: translateY(-1px);
		box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
	}

	.announcement-primary:active {
		transform: translateY(0);
	}

	@media (max-width: 480px) {
		.announcement-card {
			padding: 1.25rem;
			border-radius: 1rem;
		}

		.announcement-title {
			font-size: 1.125rem;
		}
	}
</style>
