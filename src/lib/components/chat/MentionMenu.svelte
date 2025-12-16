<script lang="ts">
	import { preventDefault } from 'svelte/legacy';
	import Avatar from '$lib/components/app/Avatar.svelte';

	export type MentionCandidate = {
		uid: string;
		label: string;
		handle: string;
		avatar: string | null;
		search: string;
		aliases: string[];
		kind?: 'member' | 'role' | 'special';
		color?: string | null;
	};

	export type MentionRecord = {
		uid: string;
		handle: string;
		label: string;
		color?: string | null;
		kind?: 'member' | 'role' | 'special';
	};

	interface Props {
		active?: boolean;
		options?: MentionCandidate[];
		selectedIndex?: number;
		position?: { left: string; bottom: string; maxHeight: string };
		specialMentionIds?: { EVERYONE: string; HERE: string };
		onSelect?: (option: MentionCandidate) => void;
		onHover?: (index: number) => void;
	}

	let {
		active = false,
		options = [],
		selectedIndex = 0,
		position = { left: '0px', bottom: '5rem', maxHeight: '16rem' },
		specialMentionIds = { EVERYONE: '', HERE: '' },
		onSelect = () => {},
		onHover = () => {}
	}: Props = $props();
</script>

{#if active && options.length > 0}
	<div
		class="mention-menu"
		role="listbox"
		style:left={position.left}
		style:bottom={position.bottom}
		style:max-height={position.maxHeight}
	>
		<div class="mention-menu__header">Tag someone or a role</div>
		<div class="mention-menu__list">
			{#each options as option, idx}
				<button
					type="button"
					class={`mention-menu__item ${option.kind === 'role' ? 'mention-menu__item--role' : ''} ${option.kind === 'special' ? 'mention-menu__item--special' : ''} ${idx === selectedIndex ? 'is-active' : ''}`}
					role="option"
					aria-selected={idx === selectedIndex}
					onmousedown={preventDefault(() => onSelect(option))}
					onmouseenter={() => onHover(idx)}
				>
					<span
						class={`mention-menu__avatar ${option.kind === 'role' ? 'mention-menu__avatar--role' : ''} ${option.kind === 'special' ? 'mention-menu__avatar--special' : ''}`}
					>
						{#if option.kind === 'role'}
							<span
								class="mention-menu__role-swatch"
								style={`background:${option.color ?? 'var(--color-accent)'}`}
							></span>
						{:else if option.kind === 'special'}
							<span class="mention-menu__avatar-special">@</span>
						{:else}
							<Avatar src={option.avatar} name={option.label} size="sm" class="w-full h-full" />
						{/if}
					</span>
					<span class="mention-menu__meta">
						<span class="mention-menu__label">
							{option.label}
							{#if option.kind === 'role'}
								<span
									class="mention-menu__pill"
									style={`color:${option.color ?? 'var(--color-accent)'}`}
								>
									Role
								</span>
							{:else if option.kind === 'special'}
								<span class="mention-menu__pill mention-menu__pill--special">Broadcast</span>
							{/if}
						</span>
						{#if option.kind === 'special'}
							<span class="mention-menu__hint">
								{option.uid === specialMentionIds.EVERYONE
									? 'Alerts everyone and adds them to the thread.'
									: 'Alerts everyone without enrolling them in the thread.'}
							</span>
						{/if}
					</span>
				</button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.mention-menu {
		position: fixed;
		z-index: 999998;
		width: min(22rem, calc(100vw - 1rem));
		max-height: calc(100vh - 5rem);
		max-height: calc(100dvh - 5rem);
		border-radius: var(--radius-lg);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		background: color-mix(in srgb, var(--color-panel) 95%, transparent);
		box-shadow: var(--shadow-elevated);
		overflow: hidden;
		backdrop-filter: blur(18px);
		display: flex;
		flex-direction: column;
	}

	.mention-menu__header {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-55);
		padding: 0.45rem 0.85rem 0.35rem;
		flex-shrink: 0;
	}

	.mention-menu__list {
		display: grid;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.mention-menu__item {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.55rem 0.85rem;
		background: transparent;
		border: 0;
		text-align: left;
		transition:
			background 140ms ease,
			color 140ms ease;
		color: inherit;
		cursor: pointer;
	}

	.mention-menu__item.is-active,
	.mention-menu__item:hover {
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-text-primary);
	}

	.mention-menu__avatar {
		width: 2rem;
		height: 2rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-panel-muted) 65%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
		overflow: hidden;
		display: grid;
		place-items: center;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.mention-menu__avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.mention-menu__avatar--role {
		padding: 0.2rem;
	}

	.mention-menu__avatar--special {
		background: linear-gradient(140deg, rgba(56, 189, 248, 0.18), rgba(249, 115, 22, 0.28));
		border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
	}

	.mention-menu__avatar-special {
		font-size: 1.05rem;
		font-weight: 700;
		color: color-mix(in srgb, var(--color-accent) 90%, #fff);
	}

	.mention-menu__role-swatch {
		width: 100%;
		height: 100%;
		border-radius: inherit;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
	}

	.mention-menu__item--special {
		background: color-mix(in srgb, var(--color-accent) 6%, transparent);
	}

	.mention-menu__meta {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.mention-menu__label {
		font-size: 0.85rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.mention-menu__pill {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		margin-left: 0.35rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
	}

	.mention-menu__pill--special {
		color: #fff;
		background: color-mix(in srgb, var(--color-accent) 35%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 70%, transparent);
	}

	.mention-menu__hint {
		font-size: 0.7rem;
		color: var(--text-60);
		line-height: 1.2;
	}
</style>
