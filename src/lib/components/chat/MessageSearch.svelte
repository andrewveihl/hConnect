<script lang="ts">
	import { createEventDispatcher, tick, onDestroy } from 'svelte';

	const dispatch = createEventDispatcher<{
		close: void;
		navigate: { messageId: string; index: number };
		loadMore: void;
	}>();

	interface Props {
		messages?: any[];
		profiles?: Record<string, { displayName?: string; name?: string }>;
		visible?: boolean;
		isLoading?: boolean;
		hasMoreMessages?: boolean;
	}

	let {
		messages = [],
		profiles = {},
		visible = false,
		isLoading = false,
		hasMoreMessages = false
	}: Props = $props();

	let searchInput = $state<HTMLInputElement | null>(null);
	let searchQuery = $state('');
	let selectedIndex = $state(0);
	let isTyping = $state(false);
	let autoLoadTimer: ReturnType<typeof setTimeout> | null = null;
	let typingTimer: ReturnType<typeof setTimeout> | null = null;
	
	// Find all messages that match the search query with relevance scoring
	const matchingMessages = $derived.by(() => {
		if (!searchQuery.trim()) return [];
		const query = searchQuery.toLowerCase().trim();
		const matches: { messageId: string; index: number; text: string; senderId: string; timestamp: any; score: number }[] = [];
		
		for (let i = 0; i < messages.length; i++) {
			const m = messages[i];
			const text = (m?.text ?? m?.content ?? '');
			const lowerText = text.toLowerCase();
			
			if (lowerText.includes(query)) {
				// Score based on how well it matches
				let score = 0;
				if (lowerText.startsWith(query)) score += 3;
				if (lowerText.includes(' ' + query)) score += 2; // Word boundary
				score += query.length / text.length; // Prefer shorter messages with the match
				
				matches.push({ 
					messageId: m.id, 
					index: i, 
					text: text,
					senderId: m.senderId ?? m.userId ?? m.uid ?? '',
					timestamp: m.createdAt ?? m.timestamp,
					score
				});
			}
		}
		
		// Sort by score (highest first), then by recency
		return matches.sort((a, b) => b.score - a.score || b.index - a.index);
	});

	// Top 5 results for display
	const topResults = $derived(matchingMessages.slice(0, 5));
	const totalMatches = $derived(matchingMessages.length);
	
	// Track the previous message count to detect when new messages are loaded
	let previousMessageCount = $state(0);

	// Reset selected index when search query changes
	$effect(() => {
		searchQuery;
		selectedIndex = 0;
	});

	// Focus input when search becomes visible
	$effect(() => {
		if (visible) {
			tick().then(() => {
				searchInput?.focus();
			});
			// Reset previous count when opening search
			previousMessageCount = messages.length;
		} else {
			searchQuery = '';
			selectedIndex = 0;
			isTyping = false;
			if (autoLoadTimer) clearTimeout(autoLoadTimer);
			if (typingTimer) clearTimeout(typingTimer);
		}
	});
	
	// Continuously load older messages while searching
	// This effect runs when:
	// 1. User is not typing (finished typing)
	// 2. There's a search query
	// 3. There are more messages to load
	// 4. Not currently loading
	$effect(() => {
		// Only proceed if we have a search query and user stopped typing
		if (!visible || !searchQuery.trim() || isTyping || isLoading || !hasMoreMessages) {
			return;
		}
		
		// Check if new messages were loaded (message count increased)
		const currentCount = messages.length;
		if (currentCount !== previousMessageCount) {
			previousMessageCount = currentCount;
		}
		
		// Schedule next load with a delay to avoid hammering the server
		if (autoLoadTimer) clearTimeout(autoLoadTimer);
		autoLoadTimer = setTimeout(() => {
			if (visible && searchQuery.trim() && !isTyping && !isLoading && hasMoreMessages) {
				dispatch('loadMore');
			}
		}, 800); // Load next batch after 800ms
	});

	// Cleanup timers on destroy
	onDestroy(() => {
		if (autoLoadTimer) clearTimeout(autoLoadTimer);
		if (typingTimer) clearTimeout(typingTimer);
	});

	// Handle search input - search recent messages immediately, then auto-load older after typing stops
	function handleSearchInput() {
		// Clear existing timers
		if (typingTimer) clearTimeout(typingTimer);
		if (autoLoadTimer) clearTimeout(autoLoadTimer);
		
		if (searchQuery.trim()) {
			isTyping = true;
			
			// Set typing to false after user stops typing
			typingTimer = setTimeout(() => {
				isTyping = false;
				// The $effect above will handle starting the auto-load
			}, 400); // Wait 400ms after last keystroke
		} else {
			isTyping = false;
		}
	}

	function getDisplayName(senderId: string): string {
		const profile = profiles[senderId];
		return profile?.displayName ?? profile?.name ?? 'Unknown';
	}

	function formatTimestamp(timestamp: any): string {
		if (!timestamp) return '';
		
		// Handle Firestore Timestamp, Date, or string
		let date: Date;
		if (timestamp?.toDate && typeof timestamp.toDate === 'function') {
			date = timestamp.toDate();
		} else if (timestamp?.seconds) {
			// Firestore timestamp object
			date = new Date(timestamp.seconds * 1000);
		} else if (timestamp instanceof Date) {
			date = timestamp;
		} else if (typeof timestamp === 'number') {
			date = new Date(timestamp);
		} else if (typeof timestamp === 'string') {
			date = new Date(timestamp);
		} else {
			return '';
		}
		
		// Validate date
		if (isNaN(date.getTime())) return '';
		
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
		const diffDays = Math.floor((today.getTime() - messageDay.getTime()) / (1000 * 60 * 60 * 24));
		
		if (diffDays === 0) {
			// Today - show time
			return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
		} else if (diffDays === 1) {
			// Yesterday
			return 'Yesterday ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
		} else if (diffDays < 7) {
			// Within last week - show day name and time
			return date.toLocaleDateString([], { weekday: 'short' }) + ' ' + 
				date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
		} else if (date.getFullYear() === now.getFullYear()) {
			// Same year - show month and day
			return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
		} else {
			// Different year - show full date
			return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
		}
	}

	function highlightMatch(text: string): string {
		if (!searchQuery.trim()) return text;
		const query = searchQuery.trim();
		const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
		return text.replace(regex, '<mark>$1</mark>');
	}

	function truncateText(text: string, maxLength: number = 80): string {
		if (text.length <= maxLength) return text;
		const query = searchQuery.toLowerCase().trim();
		const lowerText = text.toLowerCase();
		const matchIndex = lowerText.indexOf(query);
		
		if (matchIndex === -1) return text.slice(0, maxLength) + '...';
		
		// Center the match in the truncated text
		const start = Math.max(0, matchIndex - 20);
		const end = Math.min(text.length, matchIndex + query.length + 40);
		
		let result = text.slice(start, end);
		if (start > 0) result = '...' + result;
		if (end < text.length) result = result + '...';
		
		return result;
	}

	function handleInputKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			closeSearch();
			return;
		}
		
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (topResults.length > 0) {
				selectedIndex = (selectedIndex + 1) % topResults.length;
			}
			return;
		}
		
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (topResults.length > 0) {
				selectedIndex = (selectedIndex - 1 + topResults.length) % topResults.length;
			}
			return;
		}
		
		if (event.key === 'Enter') {
			event.preventDefault();
			if (topResults.length > 0) {
				navigateToResult(topResults[selectedIndex]);
			}
		}
	}

	function closeSearch() {
		searchQuery = '';
		selectedIndex = 0;
		dispatch('close');
	}

	function navigateToResult(result: typeof topResults[0]) {
		// Dispatch navigate first, then close after a short delay to allow navigation to process
		dispatch('navigate', { messageId: result.messageId, index: result.index });
		// Use setTimeout to ensure the navigate event is processed before closing
		setTimeout(() => {
			searchQuery = '';
			selectedIndex = 0;
			dispatch('close');
		}, 50);
	}

	export function getSearchQuery() {
		return searchQuery.trim();
	}

	export function getMatchingMessageIds() {
		return new Set(matchingMessages.map(m => m.messageId));
	}
</script>

{#if visible}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="search-overlay" onclick={closeSearch}>
		<div class="search-modal" onclick={(e) => e.stopPropagation()}>
			<!-- Search header -->
			<div class="search-header">
				<div class="search-input-container">
					<i class="bx bx-search search-icon"></i>
					<input
						bind:this={searchInput}
						bind:value={searchQuery}
						onkeydown={handleInputKeydown}
						oninput={handleSearchInput}
						type="text"
						class="search-input"
						placeholder="Search in conversation..."
						spellcheck="false"
						autocomplete="off"
					/>
					{#if isTyping || isLoading}
						<div class="search-spinner"></div>
					{:else if searchQuery.trim()}
						<button class="search-clear" onclick={() => (searchQuery = '')} title="Clear">
							<i class="bx bx-x"></i>
						</button>
					{/if}
				</div>
				<button class="search-close" onclick={closeSearch} title="Close (Esc)">
					<i class="bx bx-x"></i>
				</button>
			</div>

			<!-- Loading bar -->
			{#if isLoading}
				<div class="search-loading-bar">
					<div class="search-loading-bar__progress"></div>
				</div>
			{/if}

			<!-- Results area -->
			<div class="search-results">
				{#if !searchQuery.trim()}
					<div class="search-empty">
						<i class="bx bx-search-alt-2"></i>
						<span>Type to search messages</span>
						<span class="search-hint">Use ↑↓ to navigate, Enter to select</span>
					</div>
				{:else if topResults.length === 0 && !isLoading && !isTyping}
					<div class="search-empty">
						<i class="bx bx-message-x"></i>
						<span>No messages found in {messages.length} messages</span>
						{#if hasMoreMessages}
							<span class="search-hint">Searching older messages automatically...</span>
						{:else}
							<span class="search-hint">Try different keywords</span>
						{/if}
					</div>
				{:else if topResults.length === 0 && (isLoading || isTyping)}
					<div class="search-empty">
						<div class="search-spinner search-spinner--large"></div>
						<span>{isLoading ? `Searching ${messages.length} messages...` : 'Searching...'}</span>
					</div>
				{:else}
					<div class="results-header">
						<span class="results-count">
							{totalMatches} result{totalMatches !== 1 ? 's' : ''} in {messages.length} messages
							{#if isLoading}
								<span class="results-loading-hint">• loading more...</span>
							{:else if hasMoreMessages}
								<span class="results-loading-hint">• searching older messages</span>
							{/if}
						</span>
						{#if totalMatches > 5}
							<span class="results-showing">Showing top 5</span>
						{/if}
					</div>
					<div class="results-list">
						{#each topResults as result, i}
							<button
								class="result-item"
								class:result-item--selected={i === selectedIndex}
								onclick={() => navigateToResult(result)}
								onmouseenter={() => (selectedIndex = i)}
							>
								<div class="result-header">
									<span class="result-sender">{getDisplayName(result.senderId)}</span>
									<span class="result-time">{formatTimestamp(result.timestamp)}</span>
								</div>
								<div class="result-text">
									{@html highlightMatch(truncateText(result.text))}
								</div>
							</button>
						{/each}
					</div>
					
					<!-- Loading indicator at the bottom -->
					{#if isLoading && searchQuery.trim()}
						<div class="results-footer">
							<div class="search-load-more search-load-more--loading">
								<div class="search-spinner"></div>
								Loading older messages...
							</div>
						</div>
					{:else if hasMoreMessages && searchQuery.trim() && !isTyping}
						<div class="results-footer">
							<div class="search-load-more search-load-more--hint">
								<i class="bx bx-history"></i>
								Searching older messages...
							</div>
						</div>
					{:else if !hasMoreMessages && searchQuery.trim()}
						<div class="results-footer">
							<span class="results-complete">All messages searched</span>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.search-overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding-top: 10vh;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		animation: overlayFadeIn 150ms ease-out;
	}

	@keyframes overlayFadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.search-modal {
		width: 100%;
		max-width: 480px;
		margin: 0 1rem;
		background: var(--color-panel, #1a1d1e);
		border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1));
		border-radius: 1rem;
		box-shadow: 
			0 24px 48px rgba(0, 0, 0, 0.4),
			0 0 0 1px rgba(255, 255, 255, 0.05),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
		overflow: hidden;
		animation: modalSlideIn 200ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes modalSlideIn {
		from {
			opacity: 0;
			transform: translateY(-16px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.search-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
		border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08));
		background: rgba(255, 255, 255, 0.02);
	}

	.search-input-container {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.625rem;
		background: var(--color-panel-muted, rgba(255, 255, 255, 0.06));
		border: 1px solid transparent;
		border-radius: 0.625rem;
		padding: 0.625rem 0.875rem;
		transition: border-color 150ms ease, background 150ms ease;
	}

	.search-input-container:focus-within {
		border-color: var(--color-accent, #3b82f6);
		background: rgba(255, 255, 255, 0.08);
	}

	.search-icon {
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.4));
		font-size: 1.125rem;
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--color-text-primary, #fff);
		font-size: 0.9375rem;
		font-weight: 450;
		min-width: 0;
	}

	.search-input::placeholder {
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.4));
	}

	.search-clear,
	.search-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.5rem;
		background: transparent;
		border: none;
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.5));
		cursor: pointer;
		transition: background 150ms ease, color 150ms ease;
		flex-shrink: 0;
	}

	.search-clear:hover,
	.search-close:hover {
		background: rgba(255, 255, 255, 0.1);
		color: var(--color-text-primary, #fff);
	}

	.search-clear i,
	.search-close i {
		font-size: 1.25rem;
	}

	.search-results {
		max-height: 360px;
		overflow-y: auto;
	}

	.search-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 2.5rem 1rem;
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.4));
	}

	.search-empty i {
		font-size: 2rem;
		opacity: 0.6;
	}

	.search-empty span {
		font-size: 0.875rem;
	}

	.search-hint {
		font-size: 0.75rem !important;
		opacity: 0.7;
	}

	.results-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.625rem 1rem;
		border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.06));
	}

	.results-count {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
		text-transform: uppercase;
		letter-spacing: 0.03em;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.results-loading-hint {
		font-weight: 400;
		text-transform: none;
		color: var(--color-accent, #3b82f6);
		font-size: 0.6875rem;
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

	.results-showing {
		font-size: 0.6875rem;
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.4));
	}

	.results-list {
		padding: 0.375rem;
	}

	.result-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		width: 100%;
		padding: 0.75rem;
		background: transparent;
		border: none;
		border-radius: 0.625rem;
		text-align: left;
		cursor: pointer;
		transition: background 100ms ease;
	}

	.result-item:hover,
	.result-item--selected {
		background: rgba(255, 255, 255, 0.06);
	}

	.result-item--selected {
		background: var(--color-accent-alpha, rgba(59, 130, 246, 0.15));
	}

	.result-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.result-sender {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-primary, #fff);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.result-time {
		font-size: 0.6875rem;
		color: var(--color-text-tertiary, rgba(255, 255, 255, 0.4));
		flex-shrink: 0;
	}

	.result-text {
		font-size: 0.8125rem;
		color: var(--color-text-secondary, rgba(255, 255, 255, 0.7));
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.result-text :global(mark) {
		background: var(--color-accent, #3b82f6);
		color: #fff;
		padding: 0.0625rem 0.125rem;
		border-radius: 0.1875rem;
		font-weight: 500;
	}

	/* Loading spinner */
	.search-spinner {
		width: 1rem;
		height: 1rem;
		border: 2px solid rgba(255, 255, 255, 0.2);
		border-top-color: var(--color-accent, #3b82f6);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		flex-shrink: 0;
	}

	.search-spinner--large {
		width: 1.5rem;
		height: 1.5rem;
		border-width: 2.5px;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Loading bar */
	.search-loading-bar {
		height: 2px;
		background: rgba(255, 255, 255, 0.1);
		overflow: hidden;
	}

	.search-loading-bar__progress {
		height: 100%;
		width: 30%;
		background: var(--color-accent, #3b82f6);
		animation: loadingBar 1s ease-in-out infinite;
	}

	@keyframes loadingBar {
		0% { transform: translateX(-100%); }
		50% { transform: translateX(200%); }
		100% { transform: translateX(400%); }
	}

	/* Load more indicator */
	.search-load-more {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.75rem 1rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px dashed rgba(255, 255, 255, 0.15);
		border-radius: 0.5rem;
		color: var(--color-text-secondary, rgba(255, 255, 255, 0.6));
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.search-load-more--loading {
		border-color: var(--color-accent, #3b82f6);
		color: var(--color-text-primary, #fff);
	}

	.search-load-more--hint {
		animation: pulse 2s ease-in-out infinite;
	}

	.search-load-more i {
		font-size: 1rem;
	}

	/* Results complete indicator */
	.results-complete {
		display: block;
		text-align: center;
		color: var(--color-text-secondary, rgba(255, 255, 255, 0.5));
		font-size: 0.75rem;
		font-style: italic;
	}

	/* Results footer */
	.results-footer {
		padding: 0.5rem 0.5rem 0.5rem;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}

	/* Mobile adjustments */
	@media (max-width: 640px) {
		.search-overlay {
			padding-top: 5vh;
		}

		.search-modal {
			margin: 0 0.5rem;
			max-height: 80vh;
		}

		.search-input {
			font-size: 1rem;
		}

		.search-results {
			max-height: 50vh;
		}
	}
</style>
