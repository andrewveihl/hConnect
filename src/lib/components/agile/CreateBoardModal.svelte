<script lang="ts">
	import { createBoard } from '$lib/firestore/agile';
	import { user } from '$lib/stores/user';
	import { goto } from '$app/navigation';

	interface Props {
		open: boolean;
		onClose: () => void;
		workspaceId?: string;
	}

	let { open = false, onClose, workspaceId }: Props = $props();

	// Form state
	let name = $state('');
	let description = $state('');
	let iconEmoji = $state('📋');
	let creating = $state(false);
	let error = $state('');

	// Emoji picker
	const commonEmojis = ['📋', '🚀', '⚡', '🎯', '💡', '🔥', '⭐', '🏆', '📊', '🛠️', '🎨', '💻'];
	let showEmojiPicker = $state(false);

	async function handleCreate() {
		if (!name.trim()) {
			error = 'Please enter a board name';
			return;
		}

		const uid = $user?.uid;
		if (!uid) {
			error = 'You must be logged in to create a board';
			return;
		}

		creating = true;
		error = '';

		try {
			const boardId = await createBoard({
				name: name.trim(),
				description: description.trim(),
				ownerId: uid,
				iconEmoji,
				workspaceId
			});

			// Navigate to the new board
			onClose();
			goto(`/agile/board/${boardId}`);
		} catch (e) {
			console.error('Failed to create board:', e);
			error = e instanceof Error ? e.message : 'Failed to create board';
		} finally {
			creating = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}

	function resetForm() {
		name = '';
		description = '';
		iconEmoji = '📋';
		error = '';
	}

	$effect(() => {
		if (!open) {
			resetForm();
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="modal-backdrop" onclick={onClose} role="presentation">
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
			<header class="modal-header">
				<h2 id="modal-title">Create New Board</h2>
				<button type="button" class="close-btn" onclick={onClose} aria-label="Close">
					<i class="bx bx-x"></i>
				</button>
			</header>

			<form class="modal-body" onsubmit={(e) => { e.preventDefault(); handleCreate(); }}>
				<!-- Icon & Name Row -->
				<div class="icon-name-row">
					<div class="emoji-picker-wrapper">
						<button 
							type="button" 
							class="emoji-btn" 
							onclick={() => showEmojiPicker = !showEmojiPicker}
							aria-label="Choose icon"
						>
							{iconEmoji}
						</button>
						{#if showEmojiPicker}
							<div class="emoji-dropdown">
								{#each commonEmojis as emoji}
									<button 
										type="button" 
										class="emoji-option"
										onclick={() => { iconEmoji = emoji; showEmojiPicker = false; }}
									>
										{emoji}
									</button>
								{/each}
							</div>
						{/if}
					</div>

					<input
						type="text"
						bind:value={name}
						placeholder="Board name"
						class="name-input"
						maxlength={50}
						disabled={creating}
					/>
				</div>

				<!-- Description -->
				<div class="form-group">
					<label for="description">Description (optional)</label>
					<textarea
						id="description"
						bind:value={description}
						placeholder="What is this board for?"
						rows="3"
						maxlength={300}
						disabled={creating}
					></textarea>
				</div>

				<!-- Tips for Beginners -->
				<div class="tips-section">
					<div class="tip-icon">💡</div>
					<div class="tip-content">
						<strong>New to Agile?</strong>
						<p>A board helps you organize tasks. Create columns like "To Do", "In Progress", and "Done" to track your work.</p>
					</div>
				</div>

				{#if error}
					<p class="error-message">{error}</p>
				{/if}

				<div class="modal-actions">
					<button type="button" class="btn-secondary" onclick={onClose} disabled={creating}>
						Cancel
					</button>
					<button type="submit" class="btn-primary" disabled={creating || !name.trim()}>
						{#if creating}
							<i class="bx bx-loader-alt bx-spin"></i>
							Creating...
						{:else}
							<i class="bx bx-plus"></i>
							Create Board
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
	}

	.modal {
		background: var(--color-panel);
		border-radius: 0.75rem;
		width: 100%;
		max-width: 28rem;
		max-height: 90vh;
		overflow: auto;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
		border: 1px solid var(--text-08);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--text-08);
	}

	.modal-header h2 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: var(--text-60);
		font-size: 1.5rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.close-btn:hover {
		background: var(--text-08);
		color: var(--color-text-primary);
	}

	.modal-body {
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.icon-name-row {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
	}

	.emoji-picker-wrapper {
		position: relative;
	}

	.emoji-btn {
		width: 3rem;
		height: 3rem;
		border-radius: 0.5rem;
		border: 1px solid var(--text-16);
		background: var(--color-panel-muted);
		font-size: 1.5rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.emoji-btn:hover {
		border-color: var(--color-accent);
		background: var(--color-accent-muted);
	}

	.emoji-dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		margin-top: 0.5rem;
		padding: 0.5rem;
		background: var(--color-panel);
		border: 1px solid var(--text-16);
		border-radius: 0.5rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 0.25rem;
		z-index: 10;
	}

	.emoji-option {
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		font-size: 1.125rem;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.emoji-option:hover {
		background: var(--text-08);
	}

	.name-input {
		flex: 1;
		padding: 0.75rem 1rem;
		border: 1px solid var(--text-16);
		border-radius: 0.5rem;
		background: var(--color-panel-muted);
		color: var(--color-text-primary);
		font-size: 1rem;
		outline: none;
		transition: border-color 0.15s ease;
	}

	.name-input::placeholder {
		color: var(--text-40);
	}

	.name-input:focus {
		border-color: var(--color-accent);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.form-group label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-60);
	}

	.form-group textarea {
		padding: 0.75rem 1rem;
		border: 1px solid var(--text-16);
		border-radius: 0.5rem;
		background: var(--color-panel-muted);
		color: var(--color-text-primary);
		font-size: 0.9375rem;
		resize: none;
		outline: none;
		transition: border-color 0.15s ease;
		font-family: inherit;
	}

	.form-group textarea::placeholder {
		color: var(--text-40);
	}

	.form-group textarea:focus {
		border-color: var(--color-accent);
	}

	.tips-section {
		display: flex;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		background: var(--color-accent-muted);
		border-radius: 0.5rem;
		border: 1px solid var(--color-accent-subtle);
	}

	.tip-icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	.tip-content {
		font-size: 0.8125rem;
		color: var(--text-80);
	}

	.tip-content strong {
		display: block;
		color: var(--color-text-primary);
		margin-bottom: 0.25rem;
	}

	.tip-content p {
		margin: 0;
		line-height: 1.4;
	}

	.error-message {
		padding: 0.625rem 0.875rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.2);
		border-radius: 0.375rem;
		color: #ef4444;
		font-size: 0.875rem;
		margin: 0;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--text-08);
		margin-top: 0.5rem;
	}

	.btn-secondary,
	.btn-primary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		border: none;
	}

	.btn-secondary {
		background: var(--button-ghost-bg);
		color: var(--color-text-primary);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--text-16);
	}

	.btn-primary {
		background: var(--color-accent);
		color: white;
	}

	.btn-primary:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.btn-primary:disabled,
	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
