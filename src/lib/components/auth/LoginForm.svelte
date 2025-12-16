<script lang="ts">
	import { goto } from '$app/navigation';
	import * as auth from '$lib/firestore';
	import { authUser, authLoading } from '$lib/stores/index';

	let email = $state('');
	let password = $state('');
	let displayName = $state('');
	let error = $state('');
	let loading = $state(false);
	let isSignUp = $state(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		loading = true;

		try {
			if (isSignUp) {
				await auth.signUp(email, password, displayName);
			} else {
				await auth.signIn(email, password);
			}
			goto('/');
		} catch (err: any) {
			error = err.message || 'Authentication failed';
		} finally {
			loading = false;
		}
	}

	function toggleMode() {
		isSignUp = !isSignUp;
		error = '';
	}
</script>

<div
	class="login-container flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-black px-4"
>
	<div class="w-full max-w-md">
		<!-- Logo / Title -->
		<div class="text-center mb-8">
			<h1 class="text-4xl font-bold text-white mb-2">hConnect</h1>
			<p class="text-gray-400">Community Chat for Healthspaces-Purple</p>
		</div>

		<!-- Form Card -->
		<div class="bg-gray-800 rounded-xl shadow-2xl p-8 border border-gray-700">
			<h2 class="text-2xl font-bold text-white mb-6">
				{isSignUp ? 'Create Account' : 'Sign In'}
			</h2>

			<form onsubmit={handleSubmit} class="space-y-4">
				{#if isSignUp}
					<div>
						<label for="displayName" class="block text-sm font-medium text-gray-300 mb-2">
							Display Name
						</label>
						<input
							type="text"
							id="displayName"
							bind:value={displayName}
							placeholder="Your name"
							class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
						/>
					</div>
				{/if}

				<div>
					<label for="email" class="block text-sm font-medium text-gray-300 mb-2"> Email </label>
					<input
						type="email"
						id="email"
						bind:value={email}
						placeholder="you@example.com"
						required
						class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
					/>
				</div>

				<div>
					<label for="password" class="block text-sm font-medium text-gray-300 mb-2">
						Password
					</label>
					<input
						type="password"
						id="password"
						bind:value={password}
						placeholder="••••••••"
						required
						class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
					/>
				</div>

				{#if error}
					<div class="p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-300 text-sm">
						{error}
					</div>
				{/if}

				<button
					type="submit"
					disabled={loading}
					class="w-full mt-6 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-600 text-white font-medium rounded-lg transition-colors"
				>
					{loading ? 'Loading...' : isSignUp ? 'Sign Up' : 'Sign In'}
				</button>
			</form>

			<div class="mt-6 pt-6 border-t border-gray-700 text-center">
				<p class="text-gray-400 text-sm mb-3">
					{isSignUp ? 'Already have an account?' : "Don't have an account?"}
				</p>
				<button
					onclick={() => {
						toggleMode();
					}}
					class="text-teal-400 hover:text-teal-300 font-medium text-sm transition-colors"
				>
					{isSignUp ? 'Sign In' : 'Create Account'}
				</button>
			</div>
		</div>

		<!-- Footer -->
		<p class="text-center text-gray-500 text-xs mt-6">© 2025 hConnect for Healthspaces-Purple</p>
	</div>
</div>

<style>
	.login-container {
		flex: 1;
		display: flex;
		flex-direction: column;
		width: 100%;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		/* Use the parent's background, which handles safe area */
		background: transparent;
	}
</style>
