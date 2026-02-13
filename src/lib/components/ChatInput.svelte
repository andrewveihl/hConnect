<script lang="ts">
	let {
		placeholder = 'Message',
		onsend,
	}: { placeholder?: string; onsend?: (text: string) => void } = $props()

	let textareaEl: HTMLTextAreaElement | undefined = $state()

	function autoResize() {
		if (!textareaEl) return
		textareaEl.style.height = 'auto'
		textareaEl.style.height = Math.min(textareaEl.scrollHeight, 200) + 'px'
	}

	function submit() {
		if (!textareaEl) return
		const text = textareaEl.value.trim()
		if (!text) return
		onsend?.(text)
		textareaEl.value = ''
		textareaEl.style.height = 'auto'
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			submit()
		}
	}
</script>

<div class="flex items-center gap-0 rounded-lg bg-(--surface-input) ring-1 ring-(--border-subtle)">
	<!-- Attach button -->
	<button
		class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-l-lg text-(--text-muted) transition-colors hover:text-(--text-primary)"
		aria-label="Attach file"
	>
		<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
		</svg>
	</button>

	<!-- Input area -->
	<textarea
		bind:this={textareaEl}
		{placeholder}
		rows="1"
		oninput={autoResize}
		onkeydown={handleKeydown}
		class="max-h-[300px] min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-base leading-6 text-(--text-primary) placeholder:text-(--text-muted) focus:outline-none"
	></textarea>

	<!-- Right-side icons -->
	<div class="flex flex-shrink-0 items-center gap-0.5 px-1.5">

		<!-- GIF -->
		<button
			class="flex h-8 w-8 items-center justify-center rounded text-(--text-muted) transition-colors hover:text-(--text-primary)"
			aria-label="GIF"
		>
			<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none">
				<rect x="2" y="5" width="20" height="14" rx="3" stroke="currentColor" stroke-width="1.5" />
				<text x="12" y="16" text-anchor="middle" font-size="8" font-weight="bold" fill="currentColor">GIF</text>
			</svg>
		</button>

		<!-- Emoji -->
		<button
			class="flex h-8 w-8 items-center justify-center rounded text-(--text-muted) transition-colors hover:text-(--text-primary)"
			aria-label="Emoji"
		>
			<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
				<circle cx="12" cy="12" r="10" />
				<path stroke-linecap="round" d="M8 14s1.5 2 4 2 4-2 4-2" />
				<circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
				<circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
			</svg>
		</button>

		<!-- Apps -->
		<button
			class="flex h-8 w-8 items-center justify-center rounded text-(--text-muted) transition-colors hover:text-(--text-primary)"
			aria-label="Apps"
		>
			<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
				<rect x="3" y="3" width="7" height="7" rx="1.5" />
				<rect x="14" y="3" width="7" height="7" rx="1.5" />
				<rect x="3" y="14" width="7" height="7" rx="1.5" />
				<rect x="14" y="14" width="7" height="7" rx="1.5" />
			</svg>
		</button>
	</div>
</div>
