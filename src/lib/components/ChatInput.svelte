<script lang="ts">
	let { placeholder = 'Message' }: { placeholder?: string } = $props()
</script>

<div
	class="overflow-hidden rounded-lg border-2 border-(--border-input) transition-colors focus-within:border-(--border-input-focus)"
>
	<div class="flex gap-2 border-b border-(--border-subtle) bg-(--surface-toolbar) px-3 py-2 text-(--text-muted)">
		<button class="size-6 hover:text-(--text-primary)"><b>B</b></button>
		<button class="size-6 hover:text-(--text-primary)"><i>I</i></button>
		<button class="size-6 hover:text-(--text-primary)"><s>S</s></button>
		<div class="h-4 self-center border-l border-(--border-subtle)"></div>
		<button class="font-mono hover:text-(--text-primary)">&lt;/&gt;</button>
	</div>
	<textarea
		{placeholder}
		class="min-h-[80px] w-full resize-none bg-(--surface-input) p-3 text-(--text-primary) placeholder:text-(--text-muted) focus:outline-none"
	></textarea>
	<div class="flex items-center justify-between bg-(--surface-input) px-3 py-2">
		<div class="flex space-x-3 text-(--text-muted)">
			<button class="hover:text-(--text-secondary)" aria-label="Add">
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg
				>
			</button>
			<button class="hover:text-(--text-secondary)" aria-label="Emoji">
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					></path></svg
				>
			</button>
		</div>
		<button
			class="rounded bg-(--send-bg) px-3 py-1 font-bold text-(--text-on-accent) transition-colors hover:bg-(--send-hover)"
			aria-label="Post"
		>
			<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"
				><path
					d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"
				></path></svg
			>
		</button>
	</div>
</div>
