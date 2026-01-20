<script lang="ts">
	import { goto } from '$app/navigation';
</script>

<div class="flex flex-col items-center justify-center gap-6 py-12">
	<div class="text-center">
		<h1 class="text-2xl font-bold text-[color:var(--color-text-primary)] sm:text-3xl">
			TBDF
		</h1>
		<p class="mt-1 text-[color:var(--text-60,#6b7280)]">
			To Be Determined Features
		</p>
	</div>

	<button
		type="button"
		class="group relative overflow-hidden rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-6 text-left transition-all duration-200 hover:scale-[1.02] hover:shadow-lg"
		style="background: color-mix(in srgb, var(--surface-panel) 95%, transparent);"
		onclick={() => goto('/agile')}
	>
		<div
			class="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 opacity-10 transition-transform duration-300 group-hover:scale-150"
		></div>
		<div class="relative flex items-center gap-4">
			<div
				class="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600"
			>
				<i class="bx bx-task text-3xl text-white"></i>
			</div>
			<div>
				<h3 class="text-lg font-semibold text-[color:var(--color-text-primary)]">Agile Board</h3>
				<p class="text-sm text-[color:var(--text-60,#6b7280)]">Manage sprints, backlog & Kanban board</p>
			</div>
			<i class="bx bx-chevron-right ml-4 text-2xl text-[color:var(--text-50,#94a3b8)]"></i>
		</div>
	</button>
</div>
