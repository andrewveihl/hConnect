<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { PinnedMessage } from '$lib/firestore/messages';

	interface Props {
		channelName?: string;
		visible?: boolean;
		pinned?: PinnedMessage[];
		canManagePins?: boolean;
	}

let { channelName = 'Channel', visible = false, pinned = [], canManagePins = false }: Props = $props();

const dispatch = createEventDispatcher<{
	close: void;
	openPinned: { messageId: string; linkUrl?: string | null };
	unpin: { messageId: string };
	pinLink: { title: string; url: string; description?: string | null };
}>();

let linkTitle = $state('');
let linkUrl = $state('');
let linkDescription = $state('');

	function submitLink() {
		if (!linkUrl.trim()) return;
		dispatch('pinLink', { title: linkTitle.trim() || linkUrl.trim(), url: linkUrl.trim(), description: linkDescription.trim() || null });
		linkTitle = '';
		linkUrl = '';
		linkDescription = '';
	}

	const keyHandler = (event: KeyboardEvent) => {
		if (event.key === 'Escape') dispatch('close');
	};
</script>

{#if visible}
	<div class="channel-settings__backdrop" role="presentation" on:click={() => dispatch('close')} on:keydown={keyHandler} tabindex="-1">
		<div
			class="channel-settings__panel"
			role="dialog"
			aria-modal="true"
			aria-label={`${channelName} settings`}
			tabindex="-1"
			on:click|stopPropagation
		>
			<header class="channel-settings__header">
				<div>
					<div class="channel-settings__eyebrow">Channel</div>
					<h2>#{channelName}</h2>
				</div>
				<button class="channel-settings__close" type="button" on:click={() => dispatch('close')} aria-label="Close channel settings">
					<i class="bx bx-x"></i>
				</button>
			</header>

			<section class="channel-settings__section">
				<div class="section__head">
					<div>
						<h3>Pinned shortcuts</h3>
						<p>Surface Meet links, docs, or any URL for the whole channel.</p>
					</div>
				</div>
				{#if canManagePins}
					<form class="pin-form" on:submit|preventDefault={submitLink}>
						<label>
							<span>Title</span>
							<input type="text" placeholder="Team standup" bind:value={linkTitle} />
						</label>
						<label>
							<span>URL</span>
							<input type="url" placeholder="https://meet.google.com/..." bind:value={linkUrl} required />
						</label>
						<label>
							<span>Notes (optional)</span>
							<textarea rows="2" placeholder="Who uses this link or when" bind:value={linkDescription}></textarea>
						</label>
						<div class="pin-form__actions">
							<button type="button" class="ghost" on:click={() => dispatch('close')}>Cancel</button>
							<button type="submit" class="primary" disabled={!linkUrl.trim()}>Save link</button>
						</div>
					</form>
				{:else}
					<p class="muted">Only channel managers can add links.</p>
				{/if}
				<div class="pin-list">
					{#if pinned.length === 0}
						<div class="empty">No pins yet.</div>
					{:else}
						{#each pinned as pin (pin.id)}
							<div class="pin-row">
								<div class="pin-row__meta">
									<div class="pin-row__title">{pin.title}</div>
									{#if pin.preview && !(pin.linkKind ?? '').toLowerCase().includes('meet')}
										<div class="pin-row__desc">{pin.preview}</div>
									{/if}
								</div>
								<div class="pin-row__actions">
									<button type="button" class="ghost" on:click={() => dispatch('openPinned', { messageId: pin.messageId, linkUrl: pin.linkUrl })}>
										Open
									</button>
									{#if canManagePins}
										<button type="button" class="ghost danger" on:click={() => dispatch('unpin', { messageId: pin.messageId })}>
											Unpin
										</button>
									{/if}
								</div>
							</div>
						{/each}
					{/if}
				</div>
			</section>
		</div>
	</div>
{/if}

<style>
	.channel-settings__backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		padding: 1rem;
		z-index: 80;
	}

	.channel-settings__panel {
		width: min(720px, 100%);
		max-height: 90vh;
		background: var(--color-panel);
		border: 1px solid var(--color-border-subtle);
		border-radius: 1rem;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		overflow: hidden;
	}

	.channel-settings__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.channel-settings__header h2 {
		margin: 0;
		font-size: 1.35rem;
	}

	.channel-settings__eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-size: 0.75rem;
		color: var(--text-60);
	}

	.channel-settings__close {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 0.85rem;
		border: 1px solid var(--color-border-subtle);
		background: transparent;
		color: var(--text-70);
		display: grid;
		place-items: center;
		font-size: 1.4rem;
	}

	.channel-settings__section {
		background: color-mix(in srgb, var(--color-panel-muted) 50%, transparent);
		border: 1px solid var(--color-border-subtle);
		border-radius: 1rem;
		padding: 1rem;
		flex: 1;
		min-height: 0;
		overflow: auto;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.section__head h3 {
		margin: 0;
	}

	.section__head p {
		margin: 0.15rem 0 0;
		color: var(--text-70);
	}

	.pin-form {
		display: grid;
		gap: 0.6rem;
	}

	label {
		display: grid;
		gap: 0.25rem;
		font-weight: 600;
		color: var(--text-80);
	}

	input,
	textarea {
		width: 100%;
		border-radius: 0.65rem;
		border: 1px solid var(--color-border-subtle);
		background: var(--color-panel);
		color: var(--color-text-primary);
		padding: 0.65rem 0.75rem;
	}

	textarea {
		resize: vertical;
	}

	.pin-form__actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	button.primary {
		background: var(--color-accent);
		color: var(--color-contrast-on-accent, #0b1224);
		border: none;
		border-radius: 0.6rem;
		padding: 0.6rem 1rem;
		font-weight: 700;
	}

	button.ghost {
		background: transparent;
		border: 1px solid var(--color-border-subtle);
		color: var(--text-80);
		border-radius: 0.6rem;
		padding: 0.55rem 0.9rem;
	}

	button.danger {
		color: var(--color-danger, #e35b5b);
		border-color: color-mix(in srgb, var(--color-danger, #e35b5b) 40%, var(--color-border-subtle));
	}

	.pin-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.pin-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.5rem;
		align-items: center;
		padding: 0.65rem 0.75rem;
		border-radius: 0.75rem;
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-panel) 70%, transparent);
	}

	.pin-row__title {
		font-weight: 700;
	}

	.pin-row__link {
		color: var(--color-accent);
		text-decoration: none;
		font-size: 0.95rem;
	}

	.pin-row__link:hover,
	.pin-row__link:focus-visible {
		text-decoration: underline;
	}

	.pin-row__desc {
		color: var(--text-70);
		font-size: 0.9rem;
	}

	.pin-row__actions {
		display: flex;
		gap: 0.35rem;
	}

	.empty {
		padding: 0.5rem;
		color: var(--text-70);
	}

	.muted {
		color: var(--text-70);
	}
</style>
