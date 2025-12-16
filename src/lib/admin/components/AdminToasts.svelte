<script lang="ts">
	import { adminToasts, dismissAdminToast } from '$lib/admin/stores/toast';
</script>

{#if $adminToasts.length}
	<div class="fixed inset-x-0 top-4 z-50 flex flex-col items-center space-y-2 px-4">
		{#each $adminToasts as toast (toast.id)}
			<div
				class="flex w-full max-w-xl items-start gap-3 rounded-2xl border bg-slate-900/95 px-4 py-3 text-white shadow-2xl backdrop-blur transition"
				class:border-emerald-400={toast.type === 'success'}
				class:border-rose-400={toast.type === 'error'}
				class:border-sky-400={toast.type === 'info' || !toast.type}
			>
				<div class="flex-1 text-sm leading-tight">
					<p class="font-semibold capitalize text-white/90">{toast.type ?? 'info'}</p>
					<p class="text-white/80">{toast.message}</p>
				</div>
				<button
					type="button"
					class="rounded-full p-1 text-white/70 hover:bg-white/10"
					aria-label="Dismiss"
					onclick={() => dismissAdminToast(toast.id)}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke-width="1.5"
						stroke="currentColor"
						class="h-5 w-5"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6m0 12L6 6" />
					</svg>
				</button>
			</div>
		{/each}
	</div>
{/if}
