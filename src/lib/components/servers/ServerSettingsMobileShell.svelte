<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { slide } from 'svelte/transition';

	import ServerSettingsPanel from '$lib/components/servers/ServerSettingsPanel.svelte';
	import {
		mapServerSectionToPanel,
		serverSettingsSections,
		type ServerSettingsSection,
		type ServerSettingsSectionId
	} from '$lib/servers/settingsSections';

	interface Props {
		open: boolean;
		activeSection: ServerSettingsSectionId;
		serverId?: string | null;
		startInSection?: boolean;
		featureModal?: 'ticketAi' | null;
	}

	let {
		open,
		activeSection,
		serverId = null,
		startInSection = false,
		featureModal = null
	}: Props = $props();
	const dispatch = createEventDispatcher<{ close: void; section: ServerSettingsSectionId }>();

	const tabs: string[] = $derived(
		Array.from(new Set(serverSettingsSections.map((section) => section.group)))
	);
	let activeTab = $state('Server');
	let search = $state('');
	let detailSection: ServerSettingsSectionId | null = $state(startInSection ? activeSection : null);
	let seededSection = $state(false);

	const EDGE_ZONE = 120;
	const SWIPE = 48;
	const SWIPE_RATIO = 0.25;
	let swipeTracking = $state(false);
	let swipeStartX = 0;
	let swipeStartY = 0;
	let swipeDelta = $state(0);
	let swipeWidth = 1;
	let swipeMode: 'close' | 'back' | 'tab' | null = $state(null);
	let tabSwipeEligible = false;

	const resetSwipe = () => {
		swipeTracking = false;
		swipeMode = null;
		swipeDelta = 0;
		tabSwipeEligible = false;
	};

	$effect(() => {
		const firstTab = tabs[0] ?? 'Server';
		if (!tabs.includes(activeTab)) {
			activeTab = firstTab;
		}
	});

	const filteredSections = $derived.by<ServerSettingsSection[]>(() => {
		const term = search.trim().toLowerCase();
		if (!term) return serverSettingsSections;
		return serverSettingsSections.filter((section) => {
			const haystack =
				`${section.label} ${section.group} ${section.keywords?.join(' ') ?? ''}`.toLowerCase();
			return haystack.includes(term);
		});
	});

	const groupedSections = $derived.by<Array<{ group: string; items: ServerSettingsSection[] }>>(
		() =>
			tabs.map((group) => ({
				group,
				items: filteredSections.filter((section: ServerSettingsSection) => section.group === group)
			}))
	);

	$effect(() => {
		if (!open) {
			detailSection = null;
			seededSection = false;
			return;
		}
		if (startInSection && !seededSection) {
			detailSection = activeSection;
			const match = serverSettingsSections.find((section) => section.id === activeSection);
			if (match?.group) {
				activeTab = match.group;
			}
			seededSection = true;
		}
	});

	function requestClose() {
		dispatch('close');
	}

	function openSection(id: ServerSettingsSectionId) {
		activeSection = id;
		detailSection = id;
		dispatch('section', id);
	}

	function goBack() {
		if (detailSection) {
			detailSection = null;
			return;
		}
		requestClose();
	}

	let touchStartX = 0;
	let touchCurrentX = 0;
	let touchActive = false;
	const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

	function handleTouchStart(event: TouchEvent) {
		if (!event.touches.length) return;
		const touch = event.touches[0];
		touchStartX = touch.clientX;
		touchCurrentX = touch.clientX;
		touchActive = detailSection ? true : touchStartX <= EDGE_ZONE;
		swipeTracking = true;
		swipeStartX = touch.clientX;
		swipeStartY = touch.clientY;
		swipeWidth = Math.max(typeof window !== 'undefined' ? window.innerWidth : 1, 1);
		swipeMode = null;
		swipeDelta = 0;
		tabSwipeEligible = !detailSection;
	}

	function handleTouchMove(event: TouchEvent) {
		if (!touchActive || !event.touches.length) return;
		touchCurrentX = event.touches[0].clientX;
		if (!swipeTracking) return;
		const dx = event.touches[0].clientX - swipeStartX;
		const dy = event.touches[0].clientY - swipeStartY;
		if (Math.abs(dy) > Math.abs(dx) * 1.35) {
			resetSwipe();
			return;
		}
		if (!swipeMode) {
			if (detailSection && dx > 0) {
				swipeMode = 'back';
			} else if (!detailSection && swipeStartX <= EDGE_ZONE && dx > 0) {
				swipeMode = 'close';
			} else if (tabSwipeEligible && Math.abs(dx) > 12) {
				swipeMode = 'tab';
			}
		}
		if (!swipeMode) return;
		swipeDelta = dx;
	}

	function handleTouchEnd() {
		if (!touchActive) return;
		touchActive = false;
		if (swipeMode && swipeWidth > 0) {
			const traveled = Math.max(0, Math.abs(swipeDelta));
			const ratio = traveled / swipeWidth;
			if (swipeMode === 'tab' && traveled >= SWIPE * 0.5) {
				const currentIndex = Math.max(
					0,
					tabs.findIndex((tab) => tab === activeTab)
				);
				if (swipeDelta < 0 && currentIndex < tabs.length - 1) {
					activeTab = tabs[currentIndex + 1];
				} else if (swipeDelta > 0 && currentIndex > 0) {
					activeTab = tabs[currentIndex - 1];
				}
			} else if (traveled >= SWIPE || ratio >= SWIPE_RATIO) {
				if (swipeMode === 'back' && detailSection) {
					detailSection = null;
				} else if (swipeMode === 'close' && !detailSection) {
					requestClose();
				}
			}
		}
		resetSwipe();
	}

	const currentTabSections = $derived.by<ServerSettingsSection[]>(
		() =>
			groupedSections.find((group) => group.group === activeTab)?.items ??
			groupedSections[0]?.items ??
			[]
	);
	const swipeTransform = $derived.by(() => {
		if (swipeMode !== 'close' || !swipeTracking) return 'translate3d(0px,0,0)';
		const offset = clamp(Math.max(0, swipeDelta), 0, swipeWidth || 1);
		return `translate3d(${offset}px,0,0)`;
	});
	const detailTransform = $derived.by(() => {
		if (!detailSection || swipeMode !== 'back' || !swipeTracking) return 'translate3d(0px,0,0)';
		const offset = clamp(Math.max(0, swipeDelta), 0, swipeWidth || 1);
		return `translate3d(${offset}px,0,0)`;
	});
	const tabTransform = $derived.by(() => {
		if (swipeMode !== 'tab' || !swipeTracking) return 'translate3d(0px,0,0)';
		const offset = clamp(swipeDelta, -140, 140);
		return `translate3d(${offset}px,0,0)`;
	});
</script>

{#if open}
	<div
		class="server-settings-mobile-shell fixed inset-0 z-50 flex flex-col bg-[color:var(--surface-root)] text-[color:var(--color-text-primary)]"
		transition:slide={{ duration: 200 }}
	>
		<div
			class={`relative flex h-full flex-col overflow-hidden ${swipeTracking && swipeMode === 'close' ? '' : 'transition-transform duration-200 ease-out'}`}
			style:transform={swipeTransform}
			ontouchstart={handleTouchStart}
			ontouchmove={handleTouchMove}
			ontouchend={handleTouchEnd}
		>
			<div
				class={`flex h-full flex-col ${swipeMode === 'tab' && swipeTracking ? '' : 'transition-transform duration-200 ease-out'}`}
				style:transform={tabTransform}
			>
				<header
					class="flex h-14 items-center gap-2 border-b border-[color:var(--color-border-subtle)] bg-[color:var(--surface-root)] px-4"
				>
					<button
						type="button"
						class="flex h-9 w-9 items-center justify-center rounded-md text-[color:var(--text-70)] transition hover:bg-[color:var(--color-panel-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
						aria-label="Close settings"
						onclick={requestClose}
					>
						<i class="bx bx-chevron-left text-2xl" aria-hidden="true"></i>
					</button>
					<div class="flex-1">
						<p class="text-sm font-semibold text-[color:var(--color-text-primary)]">
							Server Settings
						</p>
					</div>
					<div
						class="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel-muted)] text-[color:var(--text-70)]"
					>
						<i class="bx bx-cog" aria-hidden="true"></i>
					</div>
				</header>

				<div
					class="border-b border-[color:var(--color-border-subtle)] bg-[color:var(--surface-root)] px-4 py-2"
				>
					<div class="flex gap-2 overflow-x-auto">
						{#each tabs as tab (tab)}
							<button
								type="button"
								class={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
									tab === activeTab
										? 'bg-[color:var(--color-panel-muted)] text-[color:var(--color-text-primary)]'
										: 'bg-[color:var(--color-panel)] text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-panel-muted)]'
								}`}
								onclick={() => (activeTab = tab)}
							>
								{tab}
							</button>
						{/each}
					</div>
				</div>

				<div class="flex-1 overflow-y-auto bg-[color:var(--surface-root)] px-4 pb-28">
					<div class="pt-3">
						<label
							class="flex items-center gap-2 rounded-md border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel)] px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus-within:border-[color:var(--color-accent)]"
						>
							<i class="bx bx-search text-[color:var(--color-text-tertiary)]" aria-hidden="true"
							></i>
							<input
								type="search"
								placeholder="Search settings"
								class="w-full bg-transparent text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--color-text-tertiary)] focus:outline-none"
								bind:value={search}
							/>
						</label>
					</div>

					<div class="mt-3 space-y-2">
						{#if currentTabSections.length}
							{#each currentTabSections as section (section.id)}
								<button
									type="button"
									class="flex w-full items-center justify-between rounded-xl border border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel)] px-4 py-3 text-left transition hover:bg-[color:var(--color-panel-muted)]"
									onclick={() => openSection(section.id)}
								>
									<div>
										<p class="text-sm font-semibold text-[color:var(--color-text-primary)]">
											{section.label}
										</p>
										<p class="text-xs text-[color:var(--text-70)]">{section.group}</p>
									</div>
									<i
										class="bx bx-chevron-right text-xl text-[color:var(--text-70)]"
										aria-hidden="true"
									></i>
								</button>
							{/each}
						{:else}
							<p class="text-sm text-[color:var(--text-70)]">No matching sections.</p>
						{/if}
					</div>
				</div>
			</div>

			{#if detailSection}
				<div
					class={`absolute inset-0 flex h-full flex-col bg-[color:var(--surface-root)] ${swipeTracking && swipeMode === 'back' ? '' : 'transition-transform duration-200 ease-out'}`}
					style:transform={detailTransform}
				>
					<header
						class="flex h-14 items-center gap-2 border-b border-[color:var(--color-border-subtle)] px-4"
					>
						<button
							type="button"
							class="flex h-9 w-9 items-center justify-center rounded-md text-[color:var(--text-70)] transition hover:bg-[color:var(--color-panel-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
							aria-label="Back to settings list"
							onclick={() => (detailSection = null)}
						>
							<i class="bx bx-chevron-left text-2xl" aria-hidden="true"></i>
						</button>
						<div class="flex-1">
							<p class="text-xs uppercase tracking-[0.15em] text-[color:var(--text-70)]">
								Settings
							</p>
							<p class="text-sm font-semibold text-[color:var(--color-text-primary)]">
								{serverSettingsSections.find((section) => section.id === detailSection)?.label ??
									'Section'}
							</p>
						</div>
					</header>
					<div class="flex-1 overflow-y-auto bg-[color:var(--surface-root)] p-4 pb-28">
						<ServerSettingsPanel
							{serverId}
							section={mapServerSectionToPanel(detailSection)}
							{featureModal}
							bare
						/>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.server-settings-mobile-shell {
		padding-top: env(safe-area-inset-top, 0px);
	}
</style>
