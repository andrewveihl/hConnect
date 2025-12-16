<script lang="ts">
	let scrollY = $state(0);
</script>

<svelte:window bind:scrollY />

<div class="min-h-screen bg-gray-900 text-gray-100">
	<!-- Navigation -->
	<nav class="bg-gray-800 border-b border-gray-700 sticky top-0 z-40">
		<div class="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
			<a href="/" class="text-2xl font-bold text-teal-400 hover:text-teal-300 transition-colors">
				hConnect
			</a>
			<a
				href="/"
				class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition-colors"
			>
				Back to Chat
			</a>
		</div>
	</nav>

	<!-- Hero Section with Dog Animation -->
	<section
		class="py-20 px-4 flex flex-col items-center justify-center"
		style="background: linear-gradient(135deg, #111827 0%, #1f2937 100%)"
	>
		<div class="max-w-2xl text-center">
			<h1
				class="text-5xl md:text-6xl font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-blue-500"
			>
				hConnect
			</h1>
			<p class="text-xl text-gray-400 mb-8">
				A Discord-style community chat platform for Healthspaces-Purple
			</p>

			<!-- Dog Animation -->
			<div class="my-16 flex justify-center">
				<div class="dog-container">
					<div class="dog">
						<div class="dog-body"></div>
						<div class="dog-head">
							<div class="dog-ear"></div>
							<div class="dog-ear"></div>
							<div class="dog-eye"></div>
							<div class="dog-eye"></div>
							<div class="dog-nose"></div>
							<div class="dog-tongue"></div>
						</div>
						<div class="dog-tail"></div>
						<div class="dog-leg"></div>
						<div class="dog-leg"></div>
						<div class="dog-leg"></div>
						<div class="dog-leg"></div>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- Black Background Section with Author Info -->
	<section class="bg-black py-20 px-4">
		<div class="max-w-4xl mx-auto">
			<h2 class="text-3xl font-bold mb-8 text-center">About This Project</h2>

			<div class="grid md:grid-cols-2 gap-8 mb-12">
				<!-- Features -->
				<div>
					<h3 class="text-2xl font-semibold text-teal-400 mb-4">Key Features</h3>
					<ul class="space-y-3 text-gray-300">
						<li class="flex items-start gap-3">
							<i class="bx bx-check text-teal-400 text-2xl flex-shrink-0 mt-1"></i>
							<span
								><strong>Real-time Messaging</strong> - Instant message delivery with Firestore</span
							>
						</li>
						<li class="flex items-start gap-3">
							<i class="bx bx-check text-teal-400 text-2xl flex-shrink-0 mt-1"></i>
							<span
								><strong>Multi-Server Architecture</strong> - Create and manage multiple communities</span
							>
						</li>
						<li class="flex items-start gap-3">
							<i class="bx bx-check text-teal-400 text-2xl flex-shrink-0 mt-1"></i>
							<span><strong>Role-Based Access</strong> - Owner, Admin, and Member roles</span>
						</li>
						<li class="flex items-start gap-3">
							<i class="bx bx-check text-teal-400 text-2xl flex-shrink-0 mt-1"></i>
							<span
								><strong>Responsive Design</strong> - Works seamlessly on mobile and desktop</span
							>
						</li>
						<li class="flex items-start gap-3">
							<i class="bx bx-check text-teal-400 text-2xl flex-shrink-0 mt-1"></i>
							<span><strong>Modern UI</strong> - Clean design with Tailwind CSS</span>
						</li>
					</ul>
				</div>

				<!-- Tech Stack -->
				<div>
					<h3 class="text-2xl font-semibold text-teal-400 mb-4">Tech Stack</h3>
					<div class="space-y-3">
						<div class="p-4 bg-gray-900 rounded-lg border border-gray-800">
							<h4 class="font-semibold text-white mb-2">Frontend</h4>
							<ul class="text-sm text-gray-400 space-y-1">
								<li>• SvelteKit 2.x</li>
								<li>• TypeScript 5.x</li>
								<li>• Tailwind CSS 3.x</li>
								<li>• Boxicons</li>
							</ul>
						</div>
						<div class="p-4 bg-gray-900 rounded-lg border border-gray-800">
							<h4 class="font-semibold text-white mb-2">Backend & Services</h4>
							<ul class="text-sm text-gray-400 space-y-1">
								<li>• Firebase Authentication</li>
								<li>• Cloud Firestore (Real-time DB)</li>
								<li>• Firebase Storage</li>
							</ul>
						</div>
					</div>
				</div>
			</div>

			<!-- Developer Section -->
			<div class="bg-gray-900 rounded-xl p-8 border border-gray-800">
				<h3 class="text-2xl font-semibold mb-6 text-teal-400">👨‍💻 Developer</h3>
				<div class="flex flex-col md:flex-row items-center gap-6">
					<div
						class="w-32 h-32 rounded-full bg-gradient-to-br from-teal-400 to-blue-500 flex items-center justify-center text-white text-4xl font-bold flex-shrink-0"
					>
						HC
					</div>
					<div class="flex-1">
						<h4 class="text-xl font-semibold text-white mb-2">hConnect Development Team</h4>
						<p class="text-gray-400 mb-4">
							Built with care for Healthspaces-Purple community. A modern, scalable chat platform
							designed for seamless real-time communication.
						</p>
						<div class="flex flex-wrap gap-2">
							<button
								onclick={() => {}}
								class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition-colors text-sm"
							>
								Learn More
							</button>
							<button
								onclick={() => {}}
								class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-700 transition-colors text-sm"
							>
								GitHub
							</button>
						</div>
					</div>
				</div>
			</div>

			<!-- Version Info -->
			<div class="mt-12 pt-8 border-t border-gray-800 text-center text-gray-500">
				<p class="text-sm">hConnect v1.0.0 • © 2025 Healthspaces-Purple</p>
				<p class="text-xs mt-2">Built with SvelteKit, Firebase, and Tailwind CSS</p>
			</div>
		</div>
	</section>
</div>
