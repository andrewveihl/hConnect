<script lang="ts">
	let selected = $state('dark')

	const themes = [
		{
			id: 'light',
			label: 'Light',
			bg: '#ffffff',
			sidebar: '#f2f3f5',
			text: '#060607'
		},
		{
			id: 'dark',
			label: 'Dark',
			bg: '#313338',
			sidebar: '#2b2d31',
			text: '#dbdee1'
		},
		{
			id: 'midnight',
			label: 'Midnight',
			bg: '#0e0e10',
			sidebar: '#0a0a0c',
			text: '#a8a9ad'
		}
	] as const
</script>

<div>
	<h3 class="mb-1 text-xs font-bold tracking-wider text-white/40 uppercase">Theme</h3>
	<p class="mb-4 text-sm text-white/50">Choose how hConnect looks to you.</p>

	<div class="flex gap-4">
		{#each themes as theme}
			<button
				class="group flex flex-col items-center gap-2"
				onclick={() => selected = theme.id}
			>
				<!-- Preview card -->
				<div
					class="relative h-24 w-32 overflow-hidden rounded-lg border-2 transition-all {selected === theme.id ? 'border-[#5865f2] shadow-lg shadow-[#5865f2]/20' : 'border-white/10 hover:border-white/20'}"
					style="background-color: {theme.bg}"
				>
					<!-- Fake sidebar -->
					<div class="absolute top-0 left-0 h-full w-8" style="background-color: {theme.sidebar}"></div>
					<!-- Fake content lines -->
					<div class="absolute top-3 left-11 right-2 flex flex-col gap-1.5">
						<div class="h-1.5 w-3/4 rounded-full opacity-40" style="background-color: {theme.text}"></div>
						<div class="h-1.5 w-full rounded-full opacity-25" style="background-color: {theme.text}"></div>
						<div class="h-1.5 w-1/2 rounded-full opacity-25" style="background-color: {theme.text}"></div>
						<div class="h-1.5 w-5/6 rounded-full opacity-20" style="background-color: {theme.text}"></div>
					</div>
					<!-- Checkmark -->
					{#if selected === theme.id}
						<div class="absolute right-1.5 bottom-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#5865f2]">
							<svg class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
						</div>
					{/if}
				</div>
				<!-- Label -->
				<span class="text-sm font-medium {selected === theme.id ? 'text-white' : 'text-white/50'}">{theme.label}</span>
			</button>
		{/each}
	</div>
</div>
