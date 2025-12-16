<script lang="ts">
	import { createChannel } from '$lib/firestore';
	import { showCreateChannelModal, currentServerId, channels } from '$lib/stores/index';

	let channelName = $state('');
	let channelType = $state<'text' | 'voice'>('text');
	let category = $state('');
	let loading = $state(false);
	let error = $state('');

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		if (!channelName.trim()) {
			error = 'Channel name is required';
			return;
		}

		if (!$currentServerId) {
			error = 'No server selected';
			return;
		}

		loading = true;
		try {
			const newChannel = await createChannel(
				$currentServerId,
				channelName,
				channelType,
				category || undefined
			);
			channels.update((c) => [...c, newChannel]);
			showCreateChannelModal.set(false);
			channelName = '';
			channelType = 'text';
			category = '';
		} catch (err: any) {
			error = err.message || 'Failed to create channel';
		} finally {
			loading = false;
		}
	}

	function closeModal() {
		showCreateChannelModal.set(false);
		channelName = '';
		channelType = 'text';
		category = '';
		error = '';
	}
</script>

{#if $showCreateChannelModal}
	<!-- Modal Backdrop -->
	<div
		class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
		role="button"
		tabindex="0"
		onclick={closeModal}
		onkeydown={(e) => e.key === 'Escape' && closeModal()}
	>
		<!-- Modal -->
		<div
			class="bg-gray-800 rounded-xl shadow-2xl p-6 w-full max-w-md border border-gray-700"
			role="dialog"
			aria-modal="true"
			aria-labelledby="modal-title"
			tabindex="0"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<h2 id="modal-title" class="text-2xl font-bold text-white mb-4">Create Channel</h2>

			<form onsubmit={handleSubmit} class="space-y-4">
				<div>
					<label for="channelName" class="block text-sm font-medium text-gray-300 mb-2">
						Channel Name *
					</label>
					<input
						type="text"
						id="channelName"
						bind:value={channelName}
						placeholder="general"
						required
						class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
					/>
				</div>

				<div>
					<label for="channelType" class="block text-sm font-medium text-gray-300 mb-2">
						Type
					</label>
					<select
						id="channelType"
						bind:value={channelType}
						class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
					>
						<option value="text">Text</option>
						<option value="voice">Voice</option>
					</select>
				</div>

				<div>
					<label for="category" class="block text-sm font-medium text-gray-300 mb-2">
						Category (optional)
					</label>
					<input
						type="text"
						id="category"
						bind:value={category}
						placeholder="e.g., General, Off-topic"
						class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
					/>
				</div>

				{#if error}
					<div class="p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-300 text-sm">
						{error}
					</div>
				{/if}

				<div class="flex gap-3 mt-6">
					<button
						type="button"
						onclick={closeModal}
						class="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={loading}
						class="flex-1 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-600 text-white font-medium rounded-lg transition-colors"
					>
						{loading ? 'Creating...' : 'Create'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
