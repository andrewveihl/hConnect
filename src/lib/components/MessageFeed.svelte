<script lang="ts">
	import type { Snippet } from 'svelte'

	interface Props {
		messages?: any[]
		hero?: Snippet
		class?: string
	}

	let { messages, hero, class: className = '' }: Props = $props()

	const GROUP_THRESHOLD = 7 * 60 * 1000 // 7 minutes
	const IMAGE_RE = /\.(gif|png|jpe?g|webp|svg)(\?.*)?$/i

	interface ReplyReference {
		messageId: string
		authorName: string
		authorPhoto?: string | null
		text: string
	}

	interface Msg {
		id: string
		text: string
		url?: string
		file?: any
		type?: string
		timestamp: Date
		replyTo?: ReplyReference
	}

	interface MessageGroup {
		authorName: string
		authorPhoto: string | null
		firstTimestamp: Date
		messages: Msg[]
	}

	const grouped = $derived.by((): MessageGroup[] => {
		if (!messages) return []
		const groups: MessageGroup[] = []

		for (const msg of messages) {
			const ts = msg.createdAt?.toDate?.() ?? new Date()
			const authorName = msg.author?.displayName ?? 'Unknown'
			const authorPhoto = msg.author?.photoURL ?? null
			const entry: Msg = {
				id: msg.id,
				text: msg.text ?? msg.plainTextContent ?? '',
				url: msg.url,
				file: msg.file,
				type: msg.type,
				timestamp: ts,
				replyTo: msg.replyTo
					? {
							messageId: msg.replyTo.messageId,
							authorName: msg.replyTo.authorName ?? 'Unknown',
							authorPhoto: msg.replyTo.authorPhoto ?? null,
							text: msg.replyTo.text ?? ''
						}
					: undefined
			}

			const last = groups.at(-1)
			const timeDiff = last ? ts.getTime() - last.messages.at(-1)!.timestamp.getTime() : Infinity

			if (last && last.authorName === authorName && timeDiff < GROUP_THRESHOLD) {
				last.messages.push(entry)
			} else {
				groups.push({ authorName, authorPhoto, firstTimestamp: ts, messages: [entry] })
			}
		}

		return groups
	})

	// --- Formatting helpers ---

	function timeStr(date: Date): string {
		const h = date.getHours()
		return `${h % 12 || 12}:${date.getMinutes().toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
	}

	function formatTime(date: Date): string {
		const now = new Date()
		if (date.toDateString() === now.toDateString()) return `Today at ${timeStr(date)}`
		const yesterday = new Date(now)
		yesterday.setDate(yesterday.getDate() - 1)
		if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${timeStr(date)}`
		return `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}/${date.getFullYear()} ${timeStr(date)}`
	}

	function initial(name: string): string {
		return name.charAt(0).toUpperCase()
	}

	// --- Text parsing (mentions, links, inline images) ---

	type TextSegment =
		| { type: 'text'; value: string }
		| { type: 'mention'; value: string }
		| { type: 'link'; value: string }
		| { type: 'image'; value: string }

	function parseText(text: string | undefined | null): TextSegment[] {
		if (!text) return []
		const regex = /@[\w]+|https?:\/\/[^\s<>"']+/g
		const segments: TextSegment[] = []
		let lastIndex = 0
		let match: RegExpExecArray | null
		while ((match = regex.exec(text)) !== null) {
			if (match.index > lastIndex)
				segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
			const val = match[0]
			if (val.startsWith('@')) segments.push({ type: 'mention', value: val })
			else if (IMAGE_RE.test(val) || val.includes('tenor.com') || val.includes('giphy.com'))
				segments.push({ type: 'image', value: val })
			else segments.push({ type: 'link', value: val })
			lastIndex = regex.lastIndex
		}
		if (lastIndex < text.length) segments.push({ type: 'text', value: text.slice(lastIndex) })
		return segments
	}

	function isOnlyImage(segs: TextSegment[]): boolean {
		const meaningful = segs.filter((s) => !(s.type === 'text' && s.value.trim() === ''))
		return meaningful.length === 1 && meaningful[0].type === 'image'
	}

	// --- Avatar fade / error fallback ---

	function fade(img: HTMLImageElement) {
		img.onload = () => (img.style.opacity = '1')
		img.onerror = () => {
			img.style.display = 'none'
			const fallback = img.nextElementSibling as HTMLElement | null
			if (fallback) fallback.style.display = 'flex'
		}
	}

	// --- Scrolling ---

	let scrollContainer: HTMLElement | undefined = $state()
	let thumbHeight = $state(0)
	let thumbTop = $state(0)

	function updateThumb() {
		if (!scrollContainer) return
		const { scrollTop, scrollHeight, clientHeight } = scrollContainer
		if (scrollHeight <= clientHeight) { thumbHeight = 0; return }
		thumbHeight = (clientHeight / scrollHeight) * 100
		thumbTop = (scrollTop / scrollHeight) * 100
	}

	// Auto-scroll + recalc thumb when messages change
	$effect(() => {
		void messages
		if (!scrollContainer) return
		requestAnimationFrame(() => {
			scrollContainer!.scrollTop = scrollContainer!.scrollHeight
			updateThumb()
		})
	})

	// Recalc on resize
	$effect(() => {
		if (!scrollContainer) return
		const ro = new ResizeObserver(updateThumb)
		ro.observe(scrollContainer)
		return () => ro.disconnect()
	})

	function onThumbMouseDown(e: MouseEvent) {
		if (!scrollContainer) return
		e.preventDefault()
		const startY = e.clientY
		const startScrollTop = scrollContainer.scrollTop
		const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight
		const onMove = (ev: MouseEvent) => {
			const dy = ev.clientY - startY
			const delta = (dy / scrollContainer!.getBoundingClientRect().height) * scrollContainer!.scrollHeight
			scrollContainer!.scrollTop = Math.max(0, Math.min(maxScroll, startScrollTop + delta))
		}
		const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
		window.addEventListener('mousemove', onMove)
		window.addEventListener('mouseup', onUp)
	}

	function onTrackClick(e: MouseEvent) {
		if (!scrollContainer) return
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
		const ratio = (e.clientY - rect.top) / rect.height
		scrollContainer.scrollTop = ratio * (scrollContainer.scrollHeight - scrollContainer.clientHeight)
	}
</script>

<!-- Snippet for rendering reply reference (Discord-style) -->
{#snippet replyPreview(reply: ReplyReference)}
	<div class="reply-reference group/reply mb-0.5 flex items-center gap-2 text-xs">
		<!-- Curved connector line -->
		<div class="reply-connector"></div>
		<!-- Reply content -->
		<div class="flex min-w-0 flex-1 items-center gap-1.5">
			{#if reply.authorPhoto}
				<img
					class="h-4 w-4 rounded-full object-cover flex-shrink-0"
					src={reply.authorPhoto}
					alt={reply.authorName}
				/>
			{:else}
				<div class="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-(--accent)">
					<span class="text-[8px] font-bold text-(--text-on-accent)">{initial(reply.authorName)}</span>
				</div>
			{/if}
			<span class="font-medium text-(--text-primary) hover:underline cursor-pointer flex-shrink-0">{reply.authorName}</span>
			<span class="truncate text-(--text-muted) group-hover/reply:text-(--text-secondary) cursor-pointer">
				{reply.text || 'Click to see attachment'}
			</span>
		</div>
	</div>
{/snippet}

<!-- Shared snippet for rendering a single message's content (gif / file / rich text) -->
{#snippet msgContent(msg: Msg)}
	{#if msg.type === 'gif' && msg.url}
		<div class="mt-1">
			<img src={msg.url} alt="GIF" class="media-embed rounded-lg" loading="lazy" />
		</div>
	{:else if msg.type === 'file' && msg.file}
		{#if IMAGE_RE.test(msg.file.name ?? '') || msg.file.contentType?.startsWith('image/')}
			<div class="mt-1">
				<img src={msg.file.url ?? msg.file.downloadURL} alt={msg.file.name ?? 'Image'} class="media-embed rounded-lg" loading="lazy" />
			</div>
		{:else}
			<div class="mt-1 flex items-center gap-2 rounded-lg bg-(--surface-hover) px-3 py-2">
				<svg class="h-5 w-5 flex-shrink-0 text-(--text-muted)" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
				<span class="text-sm text-(--accent) hover:underline">{msg.file?.name ?? msg.text ?? 'File'}</span>
			</div>
		{/if}
	{:else}
		{#each [parseText(msg.text)] as segs}
			{#if !isOnlyImage(segs)}
				<p class="mt-0.5 text-sm leading-relaxed text-(--text-secondary) break-words">{#each segs as seg}{#if seg.type === 'mention'}<span class="mention">{seg.value}</span>{:else if seg.type === 'link'}<a href={seg.value} target="_blank" rel="noopener noreferrer" class="text-(--accent) hover:underline">{seg.value}</a>{:else if seg.type === 'image'}{:else}{seg.value}{/if}{/each}</p>
			{/if}
			{#each segs.filter((s) => s.type === 'image') as img}
				<div class="mt-1">
					<img src={img.value} alt="" class="media-embed rounded-lg" loading="lazy" />
				</div>
			{/each}
		{/each}
	{/if}
{/snippet}

<div class="relative flex-1 min-h-0 {className}">
	<main class="absolute inset-0 overflow-y-scroll" bind:this={scrollContainer} onscroll={updateThumb}>
		{#if !messages}
			<div class="flex h-full items-center justify-center text-(--text-muted)">Loading…</div>
		{:else if messages.length === 0}
			<div class="flex flex-col min-h-full">
				{#if hero}{@render hero()}{/if}
				<div class="flex flex-1 items-center justify-center text-(--text-muted)">
					<p class="text-sm">No messages yet. Start the conversation!</p>
				</div>
			</div>
		{:else}
			<div class="flex flex-col justify-end min-h-full">
				{#if hero}{@render hero()}{/if}
				{#each grouped as group, gi}
					<div class="group/msg mt-4 first:mt-0 px-4 py-0.5 hover:bg-(--surface-hover)/50">
						<!-- Reply reference for lead message -->
						{#if group.messages[0].replyTo}
							<div class="ml-14">
								{@render replyPreview(group.messages[0].replyTo)}
							</div>
						{/if}
						<!-- Lead message -->
						<div class="flex items-start gap-4">
							<div class="mt-0.5 w-10 flex-shrink-0">
								{#if group.authorPhoto}
									<img
										class="h-10 w-10 cursor-pointer rounded-full object-cover opacity-0 transition-opacity duration-300 hover:opacity-80"
										src={group.authorPhoto}
										alt={group.authorName}
										use:fade
									/>
								{:else}
									<div class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-(--accent)">
										<span class="text-sm font-bold text-(--text-on-accent)">{initial(group.authorName)}</span>
									</div>
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex items-baseline gap-2">
									<span class="cursor-pointer text-sm font-semibold text-(--text-primary) hover:underline">{group.authorName}</span>
									<span class="text-xs text-(--text-muted)">{formatTime(group.firstTimestamp)}</span>
								</div>
								{@render msgContent(group.messages[0])}
							</div>
						</div>

						<!-- Continuation messages -->
						{#each group.messages.slice(1) as msg (msg.id)}
							<!-- Reply reference for continuation message -->
							{#if msg.replyTo}
								<div class="ml-14">
									{@render replyPreview(msg.replyTo)}
								</div>
							{/if}
							<div class="flex items-start gap-4 py-0.5">
								<div class="w-10 flex-shrink-0"></div>
								<div class="min-w-0 flex-1">
									{@render msgContent(msg)}
								</div>
							</div>
						{/each}
					</div>

					<!-- Date separator -->
					{#if gi < grouped.length - 1}
						{@const nextTs = grouped[gi + 1].firstTimestamp}
						{#if group.firstTimestamp.toDateString() !== nextTs.toDateString()}
							<div class="mx-4 my-2 flex items-center gap-2">
								<div class="h-px flex-1 bg-(--border-subtle)"></div>
								<span class="text-xs font-semibold text-(--text-muted)">
									{nextTs.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
								</span>
								<div class="h-px flex-1 bg-(--border-subtle)"></div>
							</div>
						{/if}
					{/if}
				{/each}
				<div class="h-4"></div>
			</div>
		{/if}
	</main>

	{#if thumbHeight > 0 && thumbHeight < 100}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="scrollbar-track" onmousedown={onTrackClick}>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="scrollbar-thumb"
				style:height="{thumbHeight}%"
				style:top="{thumbTop}%"
				onmousedown={(e) => { e.stopPropagation(); onThumbMouseDown(e); }}
			></div>
		</div>
	{/if}
</div>

<style>
	main {
		scrollbar-width: none;
		user-select: none;
	}
	main, main :global(*:not(a):not(button):not(.cursor-pointer)) {
		cursor: default;
	}
	main::-webkit-scrollbar {
		display: none;
	}
	.scrollbar-track {
		position: absolute;
		top: 0;
		right: 0;
		width: 6px;
		height: 100%;
		z-index: 10;
	}
	.scrollbar-thumb {
		position: absolute;
		right: 0;
		width: 6px;
		border-radius: 3px;
		background: var(--border-subtle);
		transition: background 0.15s;
		cursor: default;
	}
	.scrollbar-thumb:hover,
	.scrollbar-thumb:active {
		background: var(--scrollbar-thumb);
	}
	.mention {
		color: var(--accent);
		background: rgba(13, 158, 148, 0.2);
		padding: 0 4px;
		border-radius: 4px;
		cursor: pointer;
		font-weight: 600;
	}
	.mention:hover {
		background: rgba(13, 158, 148, 0.35);
		color: var(--accent);
		text-decoration: underline;
	}
	.media-embed {
		max-width: 400px;
		max-height: 300px;
		object-fit: contain;
		border-radius: 8px;
	}
	/* Discord-style reply connector */
	.reply-reference {
		position: relative;
		padding-left: 36px;
	}
	.reply-connector {
		position: absolute;
		left: 20px;
		top: 50%;
		width: 33px;
		height: 13px;
		border-left: 2px solid var(--border-subtle);
		border-top: 2px solid var(--border-subtle);
		border-top-left-radius: 6px;
		pointer-events: none;
		z-index: 0;
	}
	.reply-reference > div:last-child {
		position: relative;
		z-index: 1;
	}
	.reply-reference:hover .reply-connector {
		border-color: var(--text-muted);
	}
</style>
