<!-- 3. MAIN CONTENT AREA -->
<div class="flex flex-1 flex-col bg-white">
	<!-- Chat Header -->
	<header class="flex h-14 flex-shrink-0 items-center justify-between border-b px-6">
		<div class="flex items-center space-x-2">
			<span class="text-lg font-bold"></span>
			<span class="text-gray-400">
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
					></path></svg
				>
			</span>
		</div>
		<div class="flex items-center space-x-4 text-gray-500">
			<button class="rounded p-1 hover:bg-gray-100">
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					></path></svg
				>
			</button>
			<div class="relative">
				<input
					type="text"
					placeholder="Search"
					class="w-48 rounded border px-2 py-1 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none"
				/>
			</div>
		</div>
	</header>

	<!-- Messages Area -->
	<main class="flex-1 space-y-6 overflow-y-auto p-6"></main>
</div>
