<script lang="ts">
	import { mobile } from '$lib/data'

	let {
		placeholder = 'Message',
		onsend,
	}: { placeholder?: string; onsend?: (text: string) => void } = $props()

	let textareaEl: HTMLTextAreaElement | undefined = $state()
	const isMobile = $derived(mobile.isMobile)

	function autoResize() {
		if (!textareaEl) return
		textareaEl.style.height = 'auto'
		// Clamp max height: on mobile use min(32vh, 14rem) ≈ 224px
		const maxH = isMobile ? Math.min(window.innerHeight * 0.32, 224) : 200
		textareaEl.style.height = Math.min(textareaEl.scrollHeight, maxH) + 'px'
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

	let hasText = $state(false)
	function onInput() {
		autoResize()
		hasText = !!(textareaEl?.value?.trim())
	}
</script>

<div class="flex items-end gap-0 rounded-lg bg-(--surface-input) ring-1 ring-(--border-subtle) {isMobile ? 'rounded-2xl' : ''}">
	<!-- Attach button -->
	<button
		class="flex flex-shrink-0 items-center justify-center rounded-l-lg text-(--text-muted) transition-colors hover:text-(--text-primary) {isMobile ? 'h-11 w-11 rounded-l-2xl' : 'h-11 w-11'}"
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
		oninput={onInput}
		onkeydown={handleKeydown}
		class="min-h-[44px] flex-1 resize-none bg-transparent text-base leading-6 text-(--text-primary) placeholder:text-(--text-muted) focus:outline-none {isMobile ? 'max-h-[min(32vh,14rem)] py-3 px-1' : 'max-h-[300px] py-2.5'}"
	></textarea>

	<!-- Right-side icons -->
	<div class="flex flex-shrink-0 items-center gap-0.5 px-1.5 {isMobile ? 'pb-1.5' : ''}">
		{#if !isMobile}
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
		{/if}

		<!-- Mobile send button (circular) -->
		{#if isMobile}
			<button
				class="flex h-9 w-9 items-center justify-center rounded-full transition-colors {hasText
					? 'bg-(--send-bg) text-(--text-on-accent) hover:bg-(--send-hover)'
					: 'bg-(--surface-hover) text-(--text-muted)'}"
				aria-label="Send"
				onclick={submit}
				disabled={!hasText}
			>
				<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
				</svg>
			</button>
		{/if}
	</div>
</div>
