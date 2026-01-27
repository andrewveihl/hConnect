<script lang="ts">
	import { formatTypingText, type TypingUser } from '$lib/stores/typing';

	interface Props {
		users?: TypingUser[];
		maxNames?: number;
	}

	let { users = [], maxNames = 3 }: Props = $props();

	const typingText = $derived(formatTypingText(users, maxNames));
	const showIndicator = $derived(users.length > 0);

	$effect(() => {
		console.log('[TypingIndicator] Component state:', { users, showIndicator: showIndicator });
	});
</script>

{#if showIndicator}
	<div class="typing-indicator" role="status" aria-live="polite">
		<div class="typing-indicator__dots" aria-hidden="true">
			<span class="typing-indicator__dot"></span>
			<span class="typing-indicator__dot"></span>
			<span class="typing-indicator__dot"></span>
		</div>
		<span class="typing-indicator__text">{typingText}</span>
	</div>
{/if}

<style>
	.typing-indicator {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.5));
		min-height: 1.5rem;
		user-select: none;
	}

	.typing-indicator__dots {
		display: flex;
		align-items: center;
		gap: 0.1875rem;
	}

	.typing-indicator__dot {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		background: var(--color-text-tertiary, rgba(255, 255, 255, 0.5));
		animation: typing-bounce 1.4s ease-in-out infinite;
	}

	.typing-indicator__dot:nth-child(1) {
		animation-delay: 0s;
	}

	.typing-indicator__dot:nth-child(2) {
		animation-delay: 0.2s;
	}

	.typing-indicator__dot:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes typing-bounce {
		0%,
		60%,
		100% {
			transform: translateY(0);
			opacity: 0.4;
		}
		30% {
			transform: translateY(-0.25rem);
			opacity: 1;
		}
	}

	.typing-indicator__text {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
