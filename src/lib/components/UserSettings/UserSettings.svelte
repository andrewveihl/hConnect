<script lang="ts">
	import { user } from '$lib/data'
	import Account from './tabs/Account.svelte'
	import Notifications from './tabs/Notifications.svelte'
	import Appearance from './tabs/Appearance.svelte'

	let { onclose }: { onclose: () => void } = $props()

	type Tabs = keyof typeof tabs
	const tabs = {
		account: { label: 'My Account', component: Account },
		profiles: { label: 'Profiles', component: null },
		privacy: { label: 'Privacy & Safety', component: null },
		devices: { label: 'Devices', component: null },
		notifications: { label: 'Notifications', component: Notifications },
		appearance: { label: 'Appearance', component: Appearance },
		accessibility: { label: 'Accessibility', component: null },
		voice: { label: 'Voice & Video', component: null },
		keybinds: { label: 'Keybinds', component: null },
		language: { label: 'Language', component: null },
	}

	let active = $state<Tabs>('account')
	let label = $derived(tabs[active].label)
	let Component = $derived(tabs[active].component)
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onclick={onclose} onkeydown={(e) => e.key === 'Escape' && onclose()}>
	<!-- Modal box -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="flex h-[70vh] w-[750px] max-w-[90vw] overflow-hidden rounded-xl border border-(--panel-border) bg-(--surface-base) shadow-2xl" onclick={(e) => e.stopPropagation()}>
		<!-- Sidebar -->
		<div class="flex w-48 shrink-0 flex-col bg-(--surface-sidebar) p-3">
			<h3 class="mb-1 px-2.5 text-xs font-bold tracking-wider text-(--text-muted) uppercase">User Settings</h3>
			<nav class="flex flex-col gap-0.5 overflow-y-auto">
				{#each Object.entries(tabs) as [id, tab]}
					<button
						class="rounded px-2.5 py-1.5 text-left text-sm transition-colors {active === id ? 'bg-(--surface-hover) text-(--text-primary)' : 'text-(--text-secondary) hover:bg-(--surface-hover) hover:text-(--text-primary)'}"
						onclick={() => active = id as Tabs}
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
			<h2 class="mb-5 text-lg font-bold text-(--text-primary)">{label}</h2>

			{#if Component}
				<Component />
			{:else}
				<p class="text-sm text-(--text-muted)">{label} Coming soon.</p>
			{/if}
		</div>
	</div>
</div>
