<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import DMsSidebar from '$lib/components/dms/DMsSidebar.svelte';

  let showThreads = $state(false);
  let gestureSurface: HTMLDivElement | null = null;

  // Swipe distance in px before we toggle the drawer; bump if gestures feel too sensitive.
  const SWIPE_THRESHOLD = 72;
  // Allow toggling based on distance travelled relative to the viewport width.
  const SWIPE_RATIO = 0.24;
  // Ignore touches that begin within this many px of the screen edges to avoid system gestures.
  const EDGE_DEAD_ZONE = 18;
  // Keep drawer motion consistent with the rest of the shell.
  const PANEL_DURATION = 260;
  const PANEL_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
  let tracking = false;
  let startX = 0;
  let startY = 0;
  let swipeMode: 'open' | 'close' | null = null;
  let swipeWidth = $state(1);
  let swipeDelta = $state(0);
  let swipeActive = $state(false);

  const useMobileShell = () => typeof window !== 'undefined' && window.innerWidth < 768;
  let forceMobileList = $state(browser && useMobileShell());

  $effect(() => {
    if (forceMobileList) {
      showThreads = true;
    }
  });

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const panelTransform = $derived.by(() => {
    if (swipeActive && swipeMode && swipeWidth > 0) {
      const progress = clamp(swipeDelta / swipeWidth, -1, 1);
      if (swipeMode === 'open') {
        const offset = clamp(-100 + Math.max(progress, 0) * 100, -100, 0);
        return `translate3d(${offset}%, 0, 0)`;
      }
      const offset = clamp(progress * 100, -100, 0);
      return `translate3d(${offset}%, 0, 0)`;
    }
    return showThreads ? 'translate3d(0, 0, 0)' : 'translate3d(-100%, 0, 0)';
  });

  // Toggle the drawer when we're not forcing the list to stay visible on mobile.
  const syncThreadsVisibility = (next: boolean) => {
    if (forceMobileList) {
      if (!showThreads) {
        showThreads = true;
      }
      return;
    }
    if (showThreads === next) return;
    showThreads = next;
  };

  function setupGestures(target: HTMLDivElement | null) {
    if (typeof window === 'undefined' || !target) return () => {};

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') syncThreadsVisibility(false);
    };

    const resetSwipe = () => {
      tracking = false;
      swipeMode = null;
      swipeActive = false;
      swipeDelta = 0;
    };

    const canHandle = () => useMobileShell();

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !canHandle()) return;
      const t = e.touches[0];
      const surfaceWidth = target.clientWidth || window.innerWidth;
      const nearEdge = t.clientX <= EDGE_DEAD_ZONE || t.clientX >= surfaceWidth - EDGE_DEAD_ZONE;
      if (nearEdge) {
        tracking = false;
        return;
      }
      startX = t.clientX;
      startY = t.clientY;
      swipeWidth = Math.max(surfaceWidth, 1);
      swipeDelta = 0;
      swipeActive = false;
      tracking = true;
      swipeMode = showThreads ? 'close' : null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || e.touches.length !== 1) return;
      if (!canHandle()) {
        resetSwipe();
        return;
      }
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!swipeActive) {
        if (Math.abs(dy) > Math.abs(dx) * 1.25) {
          resetSwipe();
          return;
        }
        if (!swipeMode) {
          if (!showThreads && dx > 0) {
            swipeMode = 'open';
          } else if (showThreads && dx < 0) {
            swipeMode = 'close';
          } else {
            return;
          }
        }
        swipeActive = true;
      }

      swipeDelta = dx;
    };

    const onTouchEnd = () => {
      if (swipeMode && swipeWidth > 0) {
        const traveled = swipeMode === 'close' ? Math.max(0, -swipeDelta) : Math.max(0, swipeDelta);
        const ratio = traveled / swipeWidth;
        const shouldToggle = traveled >= SWIPE_THRESHOLD || ratio >= SWIPE_RATIO;
        if (shouldToggle) {
          syncThreadsVisibility(swipeMode === 'open');
        }
      }
      resetSwipe();
    };

    const mdMq = window.matchMedia('(min-width: 768px)');
    const onMedia = () => {
      const isMobile = !mdMq.matches;
      forceMobileList = isMobile;
      if (isMobile) {
        showThreads = true;
      } else {
        showThreads = false;
      }
    };

    window.addEventListener('keydown', onKey);
    target.addEventListener('touchstart', onTouchStart, { passive: true });
    target.addEventListener('touchmove', onTouchMove, { passive: true });
    target.addEventListener('touchend', onTouchEnd, { passive: true });
    mdMq.addEventListener('change', onMedia);
    onMedia();

    return () => {
      window.removeEventListener('keydown', onKey);
      target.removeEventListener('touchstart', onTouchStart);
      target.removeEventListener('touchmove', onTouchMove);
      target.removeEventListener('touchend', onTouchEnd);
      mdMq.removeEventListener('change', onMedia);
    };
  }

  onMount(() => {
    if (typeof window !== 'undefined') {
      try {
        if (sessionStorage.getItem('dm-show-list') === '1') {
          syncThreadsVisibility(true);
          sessionStorage.removeItem('dm-show-list');
        }
      } catch {
        // ignore storage errors
      }
    }
    const cleanupGestures = setupGestures(gestureSurface);
    return () => {
      cleanupGestures?.();
    };
  });

  function handleThreadSelect() {
    syncThreadsVisibility(false);
  }
</script>

<div class="flex flex-1 overflow-hidden panel-muted mobile-full-bleed gesture-pad-x" bind:this={gestureSurface}>
  <div class="hidden md:flex md:w-80 flex-col border-r border-subtle">
    <DMsSidebar activeThreadId={null} on:select={handleThreadSelect} />
  </div>

  <div class="flex flex-1 flex-col panel dm-placeholder">
    <header class="channel-header">
      <div class="channel-header__left">
        <div class="channel-header__title">
          <span class="channel-header__badge">
            <i class="bx bx-message-dots" aria-hidden="true"></i>
          </span>
          <span>Direct Messages</span>
        </div>
      </div>
      <div class="hidden sm:block text-xs text-soft">
        Pick a friend to start chatting.
      </div>
    </header>

    <main class="flex-1 panel-muted flex items-center justify-center text-soft p-6">
      <div class="text-center max-w-md space-y-2">
        <h1 class="text-xl font-semibold text-primary">Select a conversation</h1>
        <p>Choose someone from your message list to begin chatting. Swipe right or tap the menu to open conversations on mobile.</p>
      </div>
    </main>
  </div>
</div>

{#if showThreads || swipeActive}
  <div
    class="mobile-panel md:hidden fixed inset-0 z-40 flex flex-col transition-transform will-change-transform touch-pan-y"
    class:mobile-panel--dragging={swipeActive}
    style:transform={panelTransform}
    style:transition-duration={`${PANEL_DURATION}ms`}
    style:transitionTimingFunction={PANEL_EASING}
    style:pointer-events={showThreads ? 'auto' : 'none'}
    aria-label="Conversations"
  >
      <div class="mobile-panel__body">
          <div class="mobile-panel__list">
          <div class="flex-1 overflow-y-auto touch-pan-y">
          <DMsSidebar
            activeThreadId={null}
            showPersonalSection={false}
            on:select={handleThreadSelect}
            on:delete={() => syncThreadsVisibility(false)}
          />
          </div>
        </div>
      </div>
    </div>
{/if}

<style>
  .channel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    height: 3rem;
    padding: 0 1.25rem;
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-panel);
  }

  /* Mobile: Extend header into safe area (iPhone 15 Dynamic Island) */
  @media (max-width: 767px) {
    .channel-header {
      height: calc(3rem + env(safe-area-inset-top, 0px));
      padding-top: env(safe-area-inset-top, 0px);
      padding-left: calc(0.75rem + env(safe-area-inset-left, 0px));
      padding-right: calc(0.75rem + env(safe-area-inset-right, 0px));
    }
  }

  .channel-header__left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .channel-header__title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .channel-header__badge {
    color: var(--text-60);
  }

  :global(.mobile-full-bleed) {
    width: 100%;
  }

  @media (max-width: 767px) {
    .dm-placeholder {
      display: none;
    }

    :global(.mobile-full-bleed),
    :global(.mobile-full-bleed .panel),
    :global(.mobile-full-bleed .panel-muted) {
      border-radius: 0 !important;
    }

    :global(.mobile-panel) {
      border-radius: 0;
    }
  }

  :global(.mobile-panel__body) {
    flex: 1;
    display: flex;
    min-height: 0;
    background: var(--color-panel);
    border-top: 1px solid var(--color-border-subtle);
  }

  :global(.mobile-panel__list) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
</style>
