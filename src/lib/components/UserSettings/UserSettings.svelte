<script lang="ts">
	import { user } from '$lib/data'
	import AccountTab from './tabs/AccountTab.svelte'
	import ProfilesTab from './tabs/ProfilesTab.svelte'
	import PrivacyTab from './tabs/PrivacyTab.svelte'
	import NotificationsTab from './tabs/NotificationsTab.svelte'
	import AppearanceTab from './tabs/AppearanceTab.svelte'
	import VoiceVideoTab from './tabs/VoiceVideoTab.svelte'

	let { onclose }: { onclose: () => void } = $props()

	let activeTab = $state('account')

	const tabs = [
		{ id: 'account', label: 'My Account' },
		{ id: 'profiles', label: 'Profiles' },
		{ id: 'privacy', label: 'Privacy & Safety' },
		{ id: 'devices', label: 'Devices' },
		{ id: 'notifications', label: 'Notifications' },
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'accessibility', label: 'Accessibility' },
		{ id: 'voice', label: 'Voice & Video' },
		{ id: 'keybinds', label: 'Keybinds' },
		{ id: 'language', label: 'Language' },
	] as const
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onclick={onclose} onkeydown={(e) => e.key === 'Escape' && onclose()}>
	<!-- Modal box -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="flex h-[70vh] w-[750px] max-w-[90vw] overflow-hidden rounded-xl bg-[#313338] shadow-2xl" onclick={(e) => e.stopPropagation()}>
		<!-- Sidebar -->
		<div class="flex w-48 shrink-0 flex-col bg-[#2b2d31] p-3">
			<h3 class="mb-1 px-2.5 text-xs font-bold tracking-wider text-white/40 uppercase">User Settings</h3>
			<nav class="flex flex-col gap-0.5 overflow-y-auto">
				{#each tabs as tab}
					<button
						class="rounded px-2.5 py-1.5 text-left text-sm transition-colors {activeTab === tab.id ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/80'}"
						onclick={() => activeTab = tab.id}
					>
						{tab.label}
					</button>
				{/each}

				<div class="my-2 h-px bg-white/10"></div>

				<button
					class="rounded px-2.5 py-1.5 text-left text-sm text-red-400 transition-colors hover:bg-white/5 hover:text-red-300"
					onclick={() => { user.signout(); onclose() }}
				>
					Log Out
				</button>
			</nav>
		</div>

		<!-- Content area -->
		<div class="relative flex flex-1 flex-col overflow-y-auto p-6">
			<!-- Close button -->
			<button
				class="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white"
				onclick={onclose}
				title="Close (Esc)"
			>
				<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>

			<!-- Tab content placeholder -->
			<h2 class="mb-5 text-lg font-bold text-white">{tabs.find(t => t.id === activeTab)?.label}</h2>

			{#if activeTab === 'account'}
				<AccountTab />
			{:else if activeTab === 'profiles'}
				<ProfilesTab />
			{:else if activeTab === 'privacy'}
				<PrivacyTab />
			{:else if activeTab === 'notifications'}
				<NotificationsTab />
			{:else if activeTab === 'appearance'}
				<AppearanceTab />
			{:else if activeTab === 'voice'}
				<VoiceVideoTab />
			{:else}
				<p class="text-sm text-white/40">Coming soon.</p>
			{/if}
		</div>
	</div>
</div>
