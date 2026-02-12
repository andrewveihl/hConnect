<script lang="ts">
	const themes = [
		{
			id: 'light',
			label: 'Light',
			bg: '#f5fafa',
			sidebar: '#e0efed',
			text: '#0f1a19',
			className: '',
		},
		{
			id: 'dark',
			label: 'Dark',
			bg: '#313338',
			sidebar: '#2b2d31',
			text: '#f2f3f5',
			className: 'dark',
		},
		{
			id: 'midnight',
			label: 'Midnight',
			bg: '#000000',
			sidebar: '#000000',
			text: '#e4eaea',
			className: 'midnight',
		},
	] as const

	let selected = $state(localStorage.getItem('hconnect-theme') || 'dark')

	function applyTheme(themeId: string) {
		selected = themeId
		const theme = themes.find((t) => t.id === themeId)
		if (!theme) return

		const root = document.documentElement
		// Remove all theme classes, then add the selected one
		root.classList.remove('dark', 'midnight')
		if (theme.className) {
			root.classList.add(theme.className)
		}
		localStorage.setItem('hconnect-theme', themeId)
	}
</script>

<div>
	<h3 class="mb-1 text-xs font-bold tracking-wider text-(--text-muted) uppercase">Theme</h3>
	<p class="mb-4 text-sm text-(--text-secondary)">Choose how hConnect looks to you.</p>

	<div class="flex gap-4">
		{#each themes as theme}
			<button class="group flex flex-col items-center gap-2" onclick={() => applyTheme(theme.id)}>
				<!-- Preview card -->
				<div
					class="relative h-24 w-32 overflow-hidden rounded-lg border-2 transition-all {selected === theme.id
						? 'border-(--accent) shadow-(--accent)/20 shadow-lg'
						: 'border-(--border-default) hover:border-(--text-muted)'}"
					style="background-color: {theme.bg}"
				>
					<!-- Fake sidebar -->
					<div class="absolute top-0 left-0 h-full w-8" style="background-color: {theme.sidebar}"></div>
					<!-- Fake content lines -->
					<div class="absolute top-3 right-2 left-11 flex flex-col gap-1.5">
						<div class="h-1.5 w-3/4 rounded-full opacity-40" style="background-color: {theme.text}"></div>
						<div class="h-1.5 w-full rounded-full opacity-25" style="background-color: {theme.text}"></div>
						<div class="h-1.5 w-1/2 rounded-full opacity-25" style="background-color: {theme.text}"></div>
						<div class="h-1.5 w-5/6 rounded-full opacity-20" style="background-color: {theme.text}"></div>
					</div>
					<!-- Checkmark -->
					{#if selected === theme.id}
						<div
							class="absolute right-1.5 bottom-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-(--accent)"
						>
							<svg class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
						</div>
					{/if}
				</div>
				<!-- Label -->
				<span class="text-sm font-medium {selected === theme.id ? 'text-(--text-primary)' : 'text-(--text-muted)'}"
					>{theme.label}</span
				>
			</button>
		{/each}
	</div>
</div>
