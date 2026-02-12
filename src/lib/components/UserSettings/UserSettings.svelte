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
	<div class="flex h-[70vh] w-[750px] max-w-[90vw] overflow-hidden rounded-xl border border-(--panel-border) bg-(--surface-base) shadow-2xl" onclick={(e) => e.stopPropagation()}>
		<!-- Sidebar -->
		<div class="flex w-48 shrink-0 flex-col bg-(--surface-sidebar) p-3">
			<h3 class="mb-1 px-2.5 text-xs font-bold tracking-wider text-(--text-muted) uppercase">User Settings</h3>
			<nav class="flex flex-col gap-0.5 overflow-y-auto">
				{#each tabs as tab}
					<button
						class="rounded px-2.5 py-1.5 text-left text-sm transition-colors {activeTab === tab.id ? 'bg-(--surface-hover) text-(--text-primary)' : 'text-(--text-secondary) hover:bg-(--surface-hover) hover:text-(--text-primary)'}"
						onclick={() => activeTab = tab.id}
					>
						{tab.label}
					</button>
				{/each}

				<div class="my-2 h-px bg-(--border-subtle)"></div>

				<button
					class="rounded px-2.5 py-1.5 text-left text-sm text-(--danger) transition-colors hover:bg-(--surface-hover) hover:text-(--danger-hover)"
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
				class="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full text-(--text-muted) transition-colors hover:bg-(--surface-hover) hover:text-(--text-primary)"
				onclick={onclose}
				title="Close (Esc)"
			>
				<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>

			<!-- Tab content placeholder -->
			<h2 class="mb-5 text-lg font-bold text-(--text-primary)">{tabs.find(t => t.id === activeTab)?.label}</h2>

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
				<p class="text-sm text-(--text-muted)">Coming soon.</p>
			{/if}
		</div>
	</div>
</div>
