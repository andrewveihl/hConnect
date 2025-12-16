<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { watchChannelMessages, getUser } from '$lib/firestore';
	import { currentServerId, currentChannelId, messages } from '$lib/stores/index';
	import type { Message, User } from '$lib/types';

	let messagesContainer: HTMLDivElement;
	let unsubscribe: (() => void) | null = null;
	let userCache: Record<string, User | null> = {};

	async function loadUser(userId: string): Promise<User | null> {
		if (userCache[userId]) return userCache[userId];
		const user = await getUser(userId);
		userCache[userId] = user;
		return user;
	}

	function groupMessagesByDate(msgs: Message[]): { date: string; messages: Message[] }[] {
		const groups: Record<string, Message[]> = {};

		msgs.forEach((msg) => {
			const date = new Date(msg.createdAt).toLocaleDateString('en-US', {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			});
			if (!groups[date]) groups[date] = [];
			groups[date].push(msg);
		});

		return Object.entries(groups).map(([date, messages]) => ({ date, messages }));
	}

	function formatTime(timestamp: number): string {
		return new Date(timestamp).toLocaleTimeString('en-US', {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	onMount(() => {
		return () => {
			unsubscribe?.();
		};
	});

	function watchMessages() {
		if ($currentServerId && $currentChannelId) {
			unsubscribe?.();
			unsubscribe = watchChannelMessages($currentServerId, $currentChannelId, (data) => {
				messages.set(data);
			});
		}
	}

	$effect(() => {
		watchMessages();
	});

	function scrollToBottom() {
		if (messagesContainer) {
			tick().then(() => {
				messagesContainer.scrollTop = messagesContainer.scrollHeight;
			});
		}
	}

	$effect(() => {
		scrollToBottom();
	});

	function getGroupedMessages() {
		return groupMessagesByDate($messages);
	}

	$effect(() => {
		getGroupedMessages();
	});
</script>

<!-- Messages Container -->
<div bind:this={messagesContainer} class="flex-1 overflow-y-auto bg-gray-900 px-4 py-4">
	{#if $messages.length === 0}
		<div class="h-full flex items-center justify-center">
			<div class="text-center">
				<i class="bx bx-comment-dots text-6xl text-gray-700 mb-4"></i>
				<p class="text-gray-400">No messages yet. Start the conversation!</p>
			</div>
		</div>
	{:else}
		{#each getGroupedMessages() as group (group.date)}
			<!-- Date Separator -->
			<div class="flex items-center gap-3 my-6">
				<div class="flex-1 h-px bg-gray-700"></div>
				<span class="text-xs text-gray-500 px-2">{group.date}</span>
				<div class="flex-1 h-px bg-gray-700"></div>
			</div>

			<!-- Messages for this date -->
			{#each group.messages as message (message.id)}
				{#await loadUser(message.userId) then user}
					<div class="mb-4 hover:bg-gray-800 rounded-lg px-2 py-1 transition-colors group">
						<div class="flex gap-3">
							<!-- Avatar -->
							<div
								class="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-blue-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
							>
								{user?.displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
							</div>

							<!-- Message Content -->
							<div class="flex-1 min-w-0">
								<div class="flex items-baseline gap-2">
									<span class="font-semibold text-white text-sm">
										{user?.displayName || user?.email || 'Unknown User'}
									</span>
									<span class="text-xs text-gray-500">
										{formatTime(message.createdAt)}
									</span>
									{#if message.edited}
										<span class="text-xs text-gray-600">(edited)</span>
									{/if}
								</div>
								<p class="text-gray-200 text-sm break-words">{message.content}</p>
							</div>

							<!-- Actions (hover) -->
							<div
								class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
							>
								<button
									class="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
									title="React"
								>
									<i class="bx bx-smile text-lg"></i>
								</button>
								<button
									class="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
									title="More"
								>
									<i class="bx bx-dots-vertical text-lg"></i>
								</button>
							</div>
						</div>
					</div>
				{/await}
			{/each}
		{/each}
	{/if}
</div>
