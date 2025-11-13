<script lang="ts">
  import { onMount } from 'svelte';
  import DMsSidebar from '$lib/components/dms/DMsSidebar.svelte';
  import LeftPane from '$lib/components/app/LeftPane.svelte';

  let showThreads = $state(false);

  const SWIPE_THRESHOLD = 64;
  const SWIPE_RATIO = 0.28;

  let tracking = false;
  let startX = 0;
  let startY = 0;
  let swipeMode: 'open' | 'close' | null = null;
  let swipeWidth = $state(1);
  let swipeDelta = $state(0);
  let swipeActive = $state(false);

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

  function setupGestures() {
    if (typeof window === 'undefined') return () => {};

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') showThreads = false;
    };

    const resetSwipe = () => {
      tracking = false;
      swipeMode = null;
      swipeActive = false;
      swipeDelta = 0;
    };

    const canHandle = () => typeof window !== 'undefined' && window.innerWidth < 768;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !canHandle()) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      swipeWidth = Math.max(window.innerWidth, 1);
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
          showThreads = swipeMode === 'open';
        }
      }
      resetSwipe();
    };

    const mdMq = window.matchMedia('(min-width: 768px)');
    const onMedia = () => {
      if (mdMq.matches) showThreads = false;
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    mdMq.addEventListener('change', onMedia);
    onMedia();

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      mdMq.removeEventListener('change', onMedia);
    };
  }

  onMount(() => {
    if (typeof window !== 'undefined') {
      try {
        if (sessionStorage.getItem('dm-show-list') === '1') {
          showThreads = true;
          sessionStorage.removeItem('dm-show-list');
        }
      } catch {
        // ignore storage errors
      }
    }
    const cleanup = setupGestures();
    return cleanup;
  });
</script>

<div class="flex flex-1 overflow-hidden panel-muted mobile-full-bleed">
  <div class="hidden md:flex md:w-80 flex-col border-r border-subtle">
    <DMsSidebar activeThreadId={null} />
  </div>

  <div class="flex flex-1 flex-col panel">
    <header class="channel-header">
      <div class="channel-header__left">
        {#if !showThreads}
          <button
            class="channel-header__toggle md:hidden"
            type="button"
            aria-label="Open conversations"
            onclick={() => (showThreads = true)}
          >
            <i class="bx bx-chevron-left text-xl"></i>
          </button>
        {/if}
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
    class="mobile-panel md:hidden fixed inset-0 z-40 flex flex-col transition-transform duration-300 will-change-transform"
    class:mobile-panel--dragging={swipeActive}
    style:transform={panelTransform}
    style:pointer-events={showThreads ? 'auto' : 'none'}
    aria-label="Conversations"
  >
    <div class="mobile-panel__body">
      <div class="mobile-panel__servers">
        <LeftPane activeServerId={null} padForDock={false} showBottomActions={false} />
      </div>
      <div class="mobile-panel__list">
        <div class="mobile-panel__header md:hidden">
          <button class="mobile-panel__close -ml-2" aria-label="Close" type="button" onclick={() => (showThreads = false)}>
            <i class="bx bx-chevron-left text-2xl"></i>
          </button>
          <div class="mobile-panel__title">Conversations</div>
        </div>
        <div class="flex-1 overflow-y-auto">
          <DMsSidebar
            activeThreadId={null}
            on:select={() => (showThreads = false)}
            on:delete={() => (showThreads = false)}
          />
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(.mobile-full-bleed) {
    width: 100%;
  }

  @media (max-width: 767px) {
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

  :global(.mobile-panel__servers) {
    width: 84px;
    flex: 0 0 84px;
    display: flex;
    justify-content: center;
    background: color-mix(in srgb, var(--color-panel-muted) 85%, transparent);
    border-right: none;
    overflow-y: auto;
  }

  :global(.mobile-panel__servers .app-rail) {
    position: relative;
    inset: auto;
    width: 72px;
    height: 100%;
    min-height: 0;
    padding-top: 0.5rem;
    border-radius: 0;
    box-shadow: none;
    border-right: none !important;
    background: transparent;
  }

  :global(.mobile-panel__list) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
</style>
