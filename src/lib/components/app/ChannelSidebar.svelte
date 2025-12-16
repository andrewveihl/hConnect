<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { getServerChannels, watchServerChannels } from '$lib/firestore';
	import {
		currentServerId,
		currentChannelId,
		channels,
		showCreateChannelModal,
		currentServer
	} from '$lib/stores/index';

	let unsubscribe: (() => void) | null = null;

	onMount(() => {
		return () => {
			unsubscribe?.();
		};
	});

	function watchChannels() {
		if ($currentServerId) {
			unsubscribe?.();
			unsubscribe = watchServerChannels($currentServerId, (data) => {
				channels.set(data);
			});
		}
	}

	$effect(() => {
		watchChannels();
	});

	function selectChannel(id: string) {
		currentChannelId.set(id);
	}

	function handleCreateChannel() {
		showCreateChannelModal.set(true);
	}
</script>

<!-- Left Pane - Channel List -->
<div
	class="hidden md:flex md:flex-col w-64 flex-shrink-0 overflow-hidden"
	style="background: var(--color-sidebar); border-right: 1px solid var(--color-border-subtle);"
>
	<!-- Header -->
	<div class="px-4 py-4" style="border-bottom: 1px solid var(--color-border-subtle);">
		<h2 class="text-xl font-bold truncate" style="color: var(--color-text-primary);">
			{$currentServer?.name || 'Select Server'}
		</h2>
		{#if $currentServer?.description}
			<p class="text-xs mt-1 truncate" style="color: var(--color-text-tertiary);">{$currentServer.description}</p>
		{/if}
	</div>

	<!-- Search -->
	<div class="px-4 py-3" style="border-bottom: 1px solid var(--color-border-subtle);">
		<input
			type="text"
			placeholder="Search channels..."
			class="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
			style="background: var(--input-bg); border: 1px solid var(--input-border); color: var(--color-text-primary); --tw-ring-color: var(--color-accent);"
		/>
	</div>

	<!-- Channels -->
	<div class="flex-1 overflow-y-auto px-2 py-3">
		{#each $channels as channel (channel.id)}
			<button
				onclick={() => selectChannel(channel.id)}
				class="w-full text-left px-3 py-2 rounded-lg mb-1 flex items-center gap-2 transition-colors channel-item"
				class:active={$currentChannelId === channel.id}
			>
				<i class={`bx text-lg ${channel.type === 'voice' ? 'bx-microphone' : 'bx-hash'}`}></i>
				<span class="truncate text-sm font-medium">{channel.name}</span>
			</button>
		{/each}
	</div>

	<!-- Create Channel Button -->
	<div class="px-2 py-3" style="border-top: 1px solid var(--color-border-subtle);">
		<button
			onclick={handleCreateChannel}
			class="w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 create-channel-btn"
		>
			<i class="bx bx-plus"></i>
			New Channel
		</button>
	</div>
</div>

<style>
	.channel-item {
		color: var(--color-text-secondary);
	}
	.channel-item:hover {
		background: var(--button-ghost-hover);
		color: var(--color-text-primary);
	}
	.channel-item.active {
		background: var(--color-accent-soft);
		color: var(--color-accent);
	}
	.create-channel-btn {
		background: var(--button-ghost-bg);
		color: var(--color-text-secondary);
	}
	.create-channel-btn:hover {
		background: var(--color-accent);
		color: var(--button-primary-text);
	}
	input::placeholder {
		color: var(--input-placeholder);
	}
</style>
