<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		servers,
		currentServerId,
		showCreateServerModal,
		sidebarOpen,
		authUser
	} from '$lib/stores/index';
	import { signOut } from '$lib/firestore';
	import { resolveProfilePhotoURL } from '$lib/utils/profile';

	let hoveredServerId = $state<string | null>(null);

	async function handleLogout() {
		await signOut();
		goto('/auth/login');
	}

	function handleCreateServer() {
		showCreateServerModal.set(true);
	}

	function selectServer(id: string) {
		currentServerId.set(id);
		sidebarOpen.set(false);
	}
</script>

<!-- Left Sidebar - Server List -->
<div class="flex flex-col h-full w-16 bg-gray-900 border-r border-gray-800 py-2 gap-2">
	<!-- Avatar / User Profile -->
	{#if $authUser}
		<div class="px-2 py-2">
			<img
				src={resolveProfilePhotoURL($authUser)}
				alt="Me"
				class="w-12 h-12 rounded-full object-cover bg-gray-700 border border-gray-600 cursor-pointer hover:shadow-lg transition-shadow"
				title={$authUser.displayName || $authUser.email}
			/>
		</div>
	{/if}

	<!-- Server List -->
	<div class="flex-1 flex flex-col gap-2 overflow-y-auto px-2">
		{#each $servers as server (server.id)}
			<button
				onclick={() => selectServer(server.id)}
				onmouseenter={() => (hoveredServerId = server.id)}
				onmouseleave={() => (hoveredServerId = null)}
				class={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-sm transition-all ${
					$currentServerId === server.id
						? 'bg-teal-500 text-white'
						: 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
				}`}
				title={server.name}
			>
				{server.icon || server.name.substring(0, 1).toUpperCase()}
			</button>
		{/each}
	</div>

	<!-- Create Server Button -->
	<div class="px-2">
		<button
			onclick={handleCreateServer}
			class="w-12 h-12 rounded-xl flex items-center justify-center bg-gray-700 hover:bg-teal-500 text-gray-300 hover:text-white transition-all"
			title="Create Server"
		>
			<i class="bx bx-plus text-2xl"></i>
		</button>
	</div>

	<!-- Divider -->
	<div class="border-t border-gray-700"></div>

	<!-- Settings & Logout -->
	<div class="px-2 flex flex-col gap-2">
		<button
			class="w-12 h-12 rounded-xl flex items-center justify-center bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-all"
			title="Settings"
		>
			<i class="bx bx-cog text-2xl"></i>
		</button>
		<button
			onclick={handleLogout}
			class="w-12 h-12 rounded-xl flex items-center justify-center bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white transition-all"
			title="Logout"
		>
			<i class="bx bx-log-out text-2xl"></i>
		</button>
	</div>
</div>
