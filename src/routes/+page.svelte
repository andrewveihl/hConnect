<script lang="ts">
</script>

<!-- 2. CHANNEL SIDEBAR -->
<div class="flex w-64 flex-shrink-0 flex-col border-l border-r border-(--border-subtle) bg-(--surface-channel-sidebar) text-(--channel-text)">
	<!-- Header -->
	<div class="flex cursor-pointer items-center justify-between border-b border-(--border-subtle) p-4 hover:bg-(--surface-hover)">
		<h1 class="truncate text-lg font-bold text-(--text-primary)"></h1>
		<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"
			><path
				d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
			></path></svg
		>
	</div>

	<!-- Content Scrollable -->
	<div class="flex-1 overflow-y-auto py-4">
		<!-- Channels Section -->
		<div class="mb-4 px-4">
			<div class="mb-2 flex items-center justify-between text-xs font-semibold tracking-wider text-(--channel-section-text) uppercase">
				<span>Channels</span>
				<span class="cursor-pointer text-lg">+</span>
			</div>
			<ul class="space-y-1"></ul>
		</div>

		<!-- Direct Messages Section -->
		<div class="px-4">
			<div class="mb-2 flex items-center justify-between text-xs font-semibold tracking-wider text-(--channel-section-text) uppercase">
				<span>Direct Messages</span>
				<span class="cursor-pointer text-lg">+</span>
			</div>
			<ul class="space-y-1">
				<li class="flex cursor-pointer items-center rounded px-2 py-1 hover:bg-(--channel-hover)">
					<span class="mr-2 h-2 w-2 rounded-full bg-(--status-online)"></span>
					<span>Jane Doe (you)</span>
				</li>
				<li class="flex cursor-pointer items-center rounded px-2 py-1 hover:bg-(--channel-hover)">
					<span class="mr-2 h-2 w-2 rounded-full bg-(--status-online)"></span>
					<span>John Smith</span>
				</li>
				<li class="flex cursor-pointer items-center rounded px-2 py-1 hover:bg-(--channel-hover)">
					<span class="mr-2 h-2 w-2 rounded-full border border-(--text-muted)"></span>
					<span class="opacity-70">Alex Rivera</span>
				</li>
			</ul>
		</div>
	</div>
</div>
