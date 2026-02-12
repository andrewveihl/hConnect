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

	<!-- MAIN APP INTERFACE (Initially Hidden) -->
	<div id="app-interface" class="flex hidden h-full">
		<!-- 1. WORKSPACE BAR -->
		<div class="flex w-16 flex-shrink-0 flex-col items-center space-y-4 bg-[#3F0E40] py-4">
			<div
				class="workspace-icon flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg bg-white transition-all duration-200"
			>
				<span class="text-xl font-bold text-[#3F0E40]">W</span>
			</div>
			<div
				class="workspace-icon flex h-10 w-10 cursor-pointer items-center justify-center rounded-2xl bg-purple-700 transition-all duration-200"
			>
				<span class="font-bold text-white">D</span>
			</div>
			<div
				class="workspace-icon flex h-10 w-10 cursor-pointer items-center justify-center rounded-2xl bg-purple-700 transition-all duration-200"
			>
				<span class="font-bold text-white">M</span>
			</div>
			<div
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-2xl bg-white/20 transition-all duration-200 hover:bg-white/30"
			>
				<span class="text-2xl text-white">+</span>
			</div>
		</div>

		<!-- 2. CHANNEL SIDEBAR -->
		<div class="flex w-64 flex-shrink-0 flex-col border-l border-white/10 bg-[#3F0E40] text-purple-100">
			<div class="flex cursor-pointer items-center justify-between border-b border-white/10 p-4 hover:bg-black/10">
				<h1 class="truncate text-lg font-bold">My Workspace</h1>
				<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"
					><path
						d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
					></path></svg
				>
			</div>

			<div class="flex-1 overflow-y-auto py-4">
				<div class="mb-4 px-4">
					<div
						class="mb-2 flex items-center justify-between text-xs font-semibold tracking-wider text-white/60 uppercase"
					>
						<span>Channels</span>
						<span class="cursor-pointer text-lg">+</span>
					</div>
					<ul class="space-y-1">
						<li class="cursor-pointer rounded bg-[#1164A3] px-2 py-1 text-white"># general</li>
						<li class="cursor-pointer rounded px-2 py-1 hover:bg-white/10"># marketing</li>
						<li class="cursor-pointer rounded px-2 py-1 hover:bg-white/10"># design-critique</li>
						<li class="cursor-pointer rounded px-2 py-1 hover:bg-white/10"># engineering</li>
					</ul>
				</div>

				<div class="px-4">
					<div
						class="mb-2 flex items-center justify-between text-xs font-semibold tracking-wider text-white/60 uppercase"
					>
						<span>Direct Messages</span>
						<span class="cursor-pointer text-lg">+</span>
					</div>
					<ul class="space-y-1">
						<li class="flex cursor-pointer items-center rounded px-2 py-1 hover:bg-white/10">
							<span class="mr-2 h-2 w-2 rounded-full bg-green-500"></span>
							<span id="user-display">Jane Doe (you)</span>
						</li>
						<li class="flex cursor-pointer items-center rounded px-2 py-1 hover:bg-white/10">
							<span class="mr-2 h-2 w-2 rounded-full bg-green-500"></span>
							<span>John Smith</span>
						</li>
					</ul>
				</div>
				<div class="mt-8 px-4">
					<button class="text-xs text-white/40 underline hover:text-white">Sign Out</button>
				</div>
			</div>
		</div>

		<!-- 3. MAIN CONTENT AREA -->
		<div class="flex flex-1 flex-col bg-white">
			<header class="flex h-14 flex-shrink-0 items-center justify-between border-b px-6">
				<div class="flex items-center space-x-2">
					<span class="text-lg font-bold"># general</span>
				</div>
				<div class="flex items-center space-x-4 text-gray-500">
					<div class="relative">
						<input
							type="text"
							placeholder="Search"
							class="w-48 rounded border px-2 py-1 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none"
						/>
					</div>
				</div>
			</header>

			<main class="flex-1 space-y-6 overflow-y-auto p-6">
				<div class="group flex items-start">
					<div
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-blue-500 font-bold text-white"
					>
						JS
					</div>
					<div class="ml-3">
						<div class="flex items-baseline space-x-2">
							<span class="cursor-pointer font-bold hover:underline">John Smith</span>
							<span class="text-xs text-gray-400">10:15 AM</span>
						</div>
						<p class="text-gray-800">Hey everyone! Welcome to the new workspace.</p>
					</div>
				</div>
			</main>

			<footer class="p-6 pt-0">
				<div class="overflow-hidden rounded-lg border-2 border-gray-200 transition-colors focus-within:border-gray-400">
					<div class="flex space-x-4 border-b bg-gray-50 px-3 py-2 text-gray-500">
						<button class="hover:text-gray-800"><b>B</b></button>
						<button class="hover:text-gray-800"><i>I</i></button>
					</div>
					<textarea placeholder="Message #general" class="min-h-[80px] w-full resize-none p-3 focus:outline-none"
					></textarea>
				</div>
			</footer>
		</div>
	</div>
{/if}

{#if user.current}
	{@render children()}
{/if}
