<script lang="ts">
	import { user } from '$lib/data'
	import type { Snippet } from 'svelte'

	let { children }: { children: Snippet } = $props()
</script>

{#if user.current === undefined}
	<!-- show spinner -->
{/if}

{#if user.current === null}
	<div id="login-screen" class="flex h-full flex-col items-center justify-center bg-(--surface-base) px-4">
		<div class="mb-10 flex flex-col items-center">
			<h1 class="mb-3 text-4xl font-bold text-(--text-primary)">Sign in to hConnect</h1>
		</div>

		<div class="w-full max-w-[400px] space-y-4">
			<!-- Social Login Buttons -->
			<button
				class="flex w-full items-center justify-center space-x-3 rounded-md border-2 border-(--border-default) bg-(--surface-card) py-3 font-bold text-(--text-primary) transition-all hover:border-(--accent)"
				onclick={() => user.signin()}
			>
				<svg class="h-5 w-5" viewBox="0 0 24 24"
					><path
						fill="#4285F4"
						d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
					/><path
						fill="#34A853"
						d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
					/><path
						fill="#FBBC05"
						d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
					/><path
						fill="#EA4335"
						d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
					/></svg
				>
				<span>Sign in with Google</span>
			</button>
			<button
				class="flex w-full items-center justify-center space-x-3 rounded-md border-2 border-(--border-default) bg-(--surface-card) py-3 font-bold text-(--text-primary) transition-all hover:border-(--accent)"
			>
				<span>Sign in with Apple</span>
			</button>
		</div>
	</div>
{/if}

{#if user.current}
	{@render children()}
{/if}
