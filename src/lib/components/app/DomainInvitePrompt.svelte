<script lang="ts">
	import type { ServerInvite } from '$lib/firestore/invites';

	interface Props {
		invite: ServerInvite | null;
		busy?: boolean;
		error?: string | null;
		onAccept?: () => void;
		onDecline?: () => void;
		onDismiss?: () => void;
	}

	let {
		invite,
		busy = false,
		error = null,
		onAccept = () => {},
		onDecline = () => {},
		onDismiss = () => {}
	}: Props = $props();

	const serverName = $derived(invite?.serverName ?? invite?.serverId ?? 'New server');
	const landingChannel = $derived(
		invite?.channelName ? `You'll land in #${invite.channelName}` : null
	);

	const initialFor = (value: ServerInvite | null) => {
		const source = value?.serverName ?? value?.serverId ?? '';
		const trimmed = source.trim();
		return trimmed ? trimmed[0]!.toUpperCase() : '#';
	};
</script>

{#if invite}
	<div class="domain-invite-overlay" role="presentation">
		<div class="domain-invite-backdrop" aria-hidden="true"></div>
		<div
			class="domain-invite-card"
			role="dialog"
			aria-modal="true"
			aria-labelledby="domain-invite-title"
			aria-describedby="domain-invite-copy"
		>
			<button
				class="domain-invite-close"
				type="button"
				aria-label="Dismiss invite"
				onclick={onDismiss}
			>
				×
			</button>
			<div class="domain-invite-body">
				<div class="domain-invite-icon" aria-hidden="true">
					{#if invite.serverIcon}
						<img src={invite.serverIcon} alt="" />
					{:else}
						<span>{initialFor(invite)}</span>
					{/if}
				</div>
				<div class="domain-invite-text">
					<p class="domain-invite-eyebrow">Domain invite</p>
					<h2 id="domain-invite-title">{serverName}</h2>
					{#if landingChannel}
						<p class="domain-invite-channel">{landingChannel}</p>
					{/if}
					<p id="domain-invite-copy" class="domain-invite-copy">
						You already have access. Join to jump right in.
					</p>
				</div>
			</div>
			{#if error}
				<p class="domain-invite-error">{error}</p>
			{/if}
			<div class="domain-invite-actions">
				<button type="button" class="domain-invite-primary" disabled={busy} onclick={onAccept}>
					{busy ? 'Joining…' : 'Join server'}
				</button>
				<button type="button" class="domain-invite-secondary" disabled={busy} onclick={onDismiss}>
					Later
				</button>
				<button type="button" class="domain-invite-decline" disabled={busy} onclick={onDecline}>
					Decline invite
				</button>
			</div>
			<p class="domain-invite-hint">You can reopen this from Settings → Invites anytime.</p>
		</div>
	</div>
{/if}

<style>
	.domain-invite-overlay {
		position: fixed;
		inset: 0;
		z-index: 70;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem;
		pointer-events: none;
	}

	.domain-invite-backdrop {
		position: absolute;
		inset: 0;
		background: rgba(2, 6, 23, 0.55);
		backdrop-filter: blur(4px);
	}

	.domain-invite-card {
		position: relative;
		width: min(320px, 100%);
		border-radius: 0.9rem;
		background: color-mix(in srgb, var(--surface-panel) 98%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 55%, transparent);
		box-shadow: 0 12px 28px rgba(5, 9, 16, 0.25);
		padding: 1.1rem;
		display: grid;
		gap: 0.75rem;
		pointer-events: auto;
	}

	.domain-invite-close {
		position: absolute;
		top: 0.35rem;
		right: 0.35rem;
		border: none;
		background: transparent;
		color: var(--text-50);
		font-size: 1.1rem;
		cursor: pointer;
		border-radius: 999px;
		width: 1.7rem;
		height: 1.7rem;
		display: grid;
		place-items: center;
	}

	.domain-invite-body {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.domain-invite-icon {
		width: 3rem;
		height: 3rem;
		border-radius: 0.8rem;
		overflow: hidden;
		background: color-mix(in srgb, var(--color-border-subtle) 30%, transparent);
		display: grid;
		place-items: center;
		font-size: 1.3rem;
		font-weight: 600;
		color: var(--text-80);
		flex-shrink: 0;
	}

	.domain-invite-text {
		display: grid;
		gap: 0.2rem;
	}

	.domain-invite-icon img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.domain-invite-eyebrow {
		margin: 0;
		font-size: 0.68rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--text-60);
	}

	.domain-invite-card h2 {
		margin: 0;
		font-size: 1.1rem;
		line-height: 1.05;
		margin-bottom: 0.1rem;
	}

	.domain-invite-copy {
		margin: 0;
		color: var(--text-70);
		line-height: 1.3;
		font-size: 0.85rem;
	}

	.domain-invite-channel {
		margin: 0;
		font-size: 0.78rem;
		color: var(--text-55);
	}

	.domain-invite-error {
		margin: 0;
		padding: 0.4rem 0.6rem;
		border-radius: 0.65rem;
		background: color-mix(in srgb, var(--color-danger, #dc2626) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-danger, #dc2626) 35%, transparent);
		color: color-mix(in srgb, var(--color-danger, #dc2626) 92%, white);
		font-size: 0.78rem;
	}

	.domain-invite-actions {
		display: grid;
		gap: 0.35rem;
	}

	.domain-invite-primary,
	.domain-invite-secondary {
		border-radius: 0.75rem;
		padding: 0.55rem 0.9rem;
		font-weight: 600;
		font-size: 0.9rem;
		border: none;
		cursor: pointer;
	}

	.domain-invite-primary {
		background: linear-gradient(
			120deg,
			color-mix(in srgb, var(--color-accent) 72%, transparent),
			color-mix(in srgb, var(--color-highlight, #22d3ee) 65%, transparent)
		);
		color: #041014;
	}

	.domain-invite-secondary {
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
		color: var(--text-80);
	}

	.domain-invite-primary:disabled,
	.domain-invite-secondary:disabled,
	.domain-invite-decline:disabled,
	.domain-invite-close:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.domain-invite-decline {
		border: none;
		background: transparent;
		color: var(--text-60);
		text-decoration: underline;
		font-size: 0.8rem;
		padding: 0;
		cursor: pointer;
		justify-self: center;
	}

	.domain-invite-hint {
		margin: 0;
		font-size: 0.72rem;
		color: var(--text-50);
		text-align: center;
	}

	@media (max-width: 640px) {
		.domain-invite-card {
			border-radius: 1.1rem;
		}
	}
</style>
