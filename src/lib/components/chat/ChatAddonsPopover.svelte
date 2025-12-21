<script lang="ts">
	export type RewriteMode =
		| 'rephrase'
		| 'shorten'
		| 'elaborate'
		| 'formal'
		| 'casual'
		| 'bulletize'
		| 'summarize';

	export type RewriteAction = {
		id: RewriteMode;
		label: string;
		icon: string;
		description: string;
	};

	export type PopoverPlacement = {
		left: string;
		bottom: string;
		top?: string;
		width: string;
		maxHeight: string;
	};

	interface Props {
		open?: boolean;
		platform?: 'desktop' | 'mobile';
		placement?: PopoverPlacement;
		aiAssistAllowed?: boolean;
		rewriteEligible?: boolean;
		rewriteLoading?: boolean;
		rewriteMode?: RewriteMode | null;
		rewriteActions?: RewriteAction[];
		popoverEl?: HTMLDivElement | null;
		onOpenGif?: () => void;
		onPickFiles?: () => void;
		onOpenPoll?: () => void;
		onOpenForm?: () => void;
		onRewriteAction?: (mode: RewriteMode) => void;
		onClose?: () => void;
	}

	let {
		open = false,
		platform = 'desktop',
		placement = {
			left: '0.75rem',
			bottom: '5rem',
			width: 'min(20rem, 90vw)',
			maxHeight: 'min(65vh, 26rem)'
		},
		aiAssistAllowed = false,
		rewriteEligible = false,
		rewriteLoading = false,
		rewriteMode = null,
		rewriteActions = [
			{
				id: 'rephrase',
				label: 'Rephrase',
				icon: 'bx-wand',
				description: 'Same meaning, fresher wording.'
			},
			{
				id: 'shorten',
				label: 'Shorten',
				icon: 'bx-cut',
				description: 'Trim it down to the essentials.'
			},
			{
				id: 'elaborate',
				label: 'Elaborate',
				icon: 'bx-expand',
				description: 'Add a bit more helpful detail.'
			},
			{
				id: 'formal',
				label: 'More formal',
				icon: 'bx-briefcase',
				description: 'Polish it for announcements.'
			},
			{
				id: 'casual',
				label: 'More casual',
				icon: 'bx-coffee',
				description: 'Relaxed tone for friends.'
			},
			{
				id: 'bulletize',
				label: 'Bulletize',
				icon: 'bx-list-ul',
				description: 'Break it into quick bullets.'
			},
			{
				id: 'summarize',
				label: 'Summarize',
				icon: 'bx-notepad',
				description: 'Recap the draft in a blurb.'
			}
		],
		popoverEl = $bindable(null),
		onOpenGif = () => {},
		onPickFiles = () => {},
		onOpenPoll = () => {},
		onOpenForm = () => {},
		onRewriteAction = () => {},
		onClose = () => {}
	}: Props = $props();

	let rewriteMenuOpen = $state(false);

	function handleGif() {
		onOpenGif();
		onClose();
	}

	function handleFiles() {
		onPickFiles();
		onClose();
	}

	function handlePoll() {
		onOpenPoll();
		onClose();
	}

	function handleForm() {
		onOpenForm();
		onClose();
	}

	function handleRewrite(mode: RewriteMode) {
		onRewriteAction(mode);
		rewriteMenuOpen = false;
	}
</script>

{#if open}
	<div
		class="chat-input-popover"
		class:chat-input-popover--mobile={platform === 'mobile'}
		bind:this={popoverEl}
		role="menu"
		style:left={placement.left}
		style:bottom={placement.bottom ?? 'auto'}
		style:top={placement.top ?? 'auto'}
		style:width={placement.width}
		style:max-height={placement.maxHeight}
	>
		<div class="chat-input-popover__header">Add to message</div>
		<div class="chat-input-menu">
			<button class="chat-input-menu__item" role="menuitem" onclick={handleGif}>
				<span class="chat-input-menu__icon">
					<i class="bx bx-film" aria-hidden="true"></i>
				</span>
				<div class="chat-input-menu__content">
					<span class="chat-input-menu__title">Add GIF</span>
					<span class="chat-input-menu__subtitle">Share a fun animated moment.</span>
				</div>
			</button>
			<button class="chat-input-menu__item" role="menuitem" onclick={handleFiles}>
				<span class="chat-input-menu__icon">
					<i class="bx bx-paperclip" aria-hidden="true"></i>
				</span>
				<div class="chat-input-menu__content">
					<span class="chat-input-menu__title">Upload files</span>
					<span class="chat-input-menu__subtitle">Send documents, audio, or images.</span>
				</div>
			</button>
			<button class="chat-input-menu__item" role="menuitem" onclick={handlePoll}>
				<span class="chat-input-menu__icon">
					<i class="bx bx-pie-chart-alt" aria-hidden="true"></i>
				</span>
				<div class="chat-input-menu__content">
					<span class="chat-input-menu__title">Create poll</span>
					<span class="chat-input-menu__subtitle">Let everyone vote on an option.</span>
				</div>
			</button>
			<button class="chat-input-menu__item" role="menuitem" onclick={handleForm}>
				<span class="chat-input-menu__icon">
					<i class="bx bx-detail" aria-hidden="true"></i>
				</span>
				<div class="chat-input-menu__content">
					<span class="chat-input-menu__title">Create form</span>
					<span class="chat-input-menu__subtitle">Collect structured responses.</span>
				</div>
			</button>
			<div class="chat-input-menu__section">
				<button
					type="button"
					class="chat-input-menu__section-toggle"
					aria-expanded={rewriteMenuOpen}
					onclick={() => (rewriteMenuOpen = !rewriteMenuOpen)}
				>
					<span class="chat-input-menu__section-label">
						<span class="chat-input-menu__section-icon">
							<i class="bx bx-pencil" aria-hidden="true"></i>
						</span>
						<span class="chat-input-menu__section-title">Sound-check message</span>
					</span>
					<i
						class={`bx ${rewriteMenuOpen ? 'bx-chevron-up' : 'bx-chevron-down'}`}
						aria-hidden="true"
					></i>
				</button>
				{#if rewriteMenuOpen}
					{#if !aiAssistAllowed}
						<div class="chat-input-menu__section-hint">Sound check is unavailable right now.</div>
					{:else if !rewriteEligible}
						<div class="chat-input-menu__section-hint">
							Type a few more words to unlock rewrites.
						</div>
					{:else}
						<div class="chat-input-menu__section-hint">Pick a tone to polish your draft.</div>
					{/if}
					<div class="chat-input-menu__rewrite">
						{#each rewriteActions as action}
							{@const actionBusy = rewriteLoading && rewriteMode === action.id}
							<button
								type="button"
								role="menuitem"
								class="rewrite-menu__item chat-input-menu__rewrite-item"
								onclick={() => handleRewrite(action.id)}
								disabled={!rewriteEligible || actionBusy}
							>
								<span class="rewrite-menu__icon">
									<i class={`bx ${action.icon}`} aria-hidden="true"></i>
								</span>
								<span class="rewrite-menu__content">
									<span class="rewrite-menu__title">{action.label}</span>
									<span class="rewrite-menu__description">{action.description}</span>
								</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.chat-input-popover {
		position: fixed;
		width: 20rem;
		max-width: calc(100vw - 1rem);
		max-height: calc(100vh - 5rem);
		max-height: calc(100dvh - 5rem);
		overflow-y: auto;
		overscroll-behavior: contain;
		z-index: 999999;
		border-radius: 1.25rem;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		background: var(--color-panel);
		backdrop-filter: blur(24px);
		box-shadow:
			0 -10px 40px rgba(0, 0, 0, 0.5),
			0 0 0 1px rgba(255, 255, 255, 0.05) inset;
		padding: 0.85rem 0.75rem;
		color: var(--color-text-primary);
	}

	.chat-input-popover--mobile {
		width: 18rem;
		max-width: calc(100vw - 1rem);
		max-height: calc(100vh - 5rem);
		max-height: calc(100dvh - 5rem);
	}

	.chat-input-popover__header {
		font-size: 0.7rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--text-60);
		padding: 0 0.35rem 0.5rem;
	}

	.chat-input-menu {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.chat-input-menu__item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.65rem;
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		padding: 0.55rem 0.6rem;
		background: color-mix(in srgb, var(--color-panel) 88%, transparent);
		color: inherit;
		text-align: left;
		transition:
			transform 120ms ease,
			border 120ms ease,
			background 120ms ease;
	}

	.chat-input-menu__item:hover {
		background: color-mix(in srgb, var(--color-accent) 12%, var(--color-panel) 88%);
		border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	.chat-input-menu__item:active {
		transform: translateY(0);
	}

	.chat-input-menu__icon {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: var(--radius-md);
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		color: var(--color-accent);
		font-size: 1.15rem;
		transition: all 150ms ease;
	}

	.chat-input-menu__item:hover .chat-input-menu__icon {
		background: color-mix(in srgb, var(--color-accent) 28%, transparent);
		transform: scale(1.05);
	}

	.chat-input-menu__content {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.chat-input-menu__title {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--color-text-primary);
	}

	.chat-input-menu__subtitle {
		font-size: 0.72rem;
		color: var(--text-60);
	}

	.chat-input-menu__section {
		margin-top: 0.35rem;
		border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 45%, transparent);
		padding-top: 0.5rem;
	}

	.chat-input-menu__section-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.45rem 0.5rem;
		border-radius: var(--radius-md);
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		cursor: pointer;
		transition: background 140ms ease;
	}

	.chat-input-menu__section-toggle:hover {
		background: color-mix(in srgb, var(--color-panel-muted) 70%, transparent);
	}

	.chat-input-menu__section-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.chat-input-menu__section-icon {
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 0.5rem;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
		font-size: 0.9rem;
	}

	.chat-input-menu__section-title {
		font-weight: 600;
		font-size: 0.85rem;
	}

	.chat-input-menu__section-hint {
		font-size: 0.75rem;
		color: var(--text-55);
		padding: 0.35rem 0.5rem 0.5rem;
	}

	.chat-input-menu__rewrite {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0 0.25rem;
	}

	.rewrite-menu__item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		border-radius: 0.85rem;
		border: 1px solid transparent;
		background: transparent;
		padding: 0.45rem 0.55rem;
		text-align: left;
		transition:
			background 140ms ease,
			border 140ms ease;
	}

	.rewrite-menu__item:not(:disabled):hover,
	.rewrite-menu__item:not(:disabled):focus-visible {
		background: color-mix(in srgb, var(--color-panel-muted) 85%, transparent);
		border-color: color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		outline: none;
	}

	.rewrite-menu__item:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.rewrite-menu__icon {
		width: 2.4rem;
		height: 2.4rem;
		border-radius: 0.9rem;
		background: color-mix(in srgb, var(--color-panel-muted) 70%, transparent);
		display: grid;
		place-items: center;
		color: var(--color-accent);
	}

	.rewrite-menu__content {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		color: var(--color-text-primary);
	}

	.rewrite-menu__title {
		font-weight: 600;
		font-size: 0.9rem;
	}

	.rewrite-menu__description {
		font-size: 0.77rem;
		color: var(--text-60);
	}

	:global(:root[data-theme-tone='light']) .chat-input-popover {
		background: color-mix(in srgb, var(--color-panel) 98%, transparent);
		border-color: color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		box-shadow: 0 18px 32px rgba(25, 34, 42, 0.18);
	}

	:global(:root[data-theme-tone='light']) .chat-input-menu__item {
		background: color-mix(in srgb, var(--color-panel) 96%, transparent);
	}

	:global(:root[data-theme-tone='light']) .chat-input-menu__item:hover {
		background: color-mix(in srgb, var(--color-panel) 100%, transparent);
	}

	:global(:root[data-theme-tone='light']) .chat-input-menu__icon {
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
	}

	@media (max-width: 600px) {
		.rewrite-menu__item {
			gap: 0.45rem;
			padding: 0.35rem 0.4rem;
		}

		.rewrite-menu__icon {
			width: 1.9rem;
			height: 1.9rem;
		}
	}
</style>
