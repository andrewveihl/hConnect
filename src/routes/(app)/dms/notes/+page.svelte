<script lang="ts">
  import { onMount } from 'svelte';
  import DMsSidebar from '$lib/components/dms/DMsSidebar.svelte';
  import NotesBoard from '$lib/components/dms/NotesBoard.svelte';

  let showThreads = $state(false);

  const SWIPE_THRESHOLD = 48;
  const SWIPE_RATIO = 0.25;

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
        if (traveled >= SWIPE_THRESHOLD || ratio >= SWIPE_RATIO) {
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
    const cleanup = setupGestures();
    return cleanup;
  });
</script>

<div class="flex flex-1 overflow-hidden panel-muted">
  <div class="hidden md:flex md:w-80 flex-col border-r border-subtle">
    <DMsSidebar activeThreadId="__notes" />
  </div>

  <div class="flex flex-1 flex-col panel">
    <header class="channel-header">
      <div class="channel-header__left">
        {#if !showThreads}
          <button
            class="channel-header__toggle md:hidden"
            type="button"
            aria-label="Show conversations"
            onclick={() => (showThreads = true)}
          >
            <i class="bx bx-chevron-left text-xl"></i>
          </button>
        {/if}
        <div class="channel-header__title">
          <span class="channel-header__badge">
            <i class="bx bx-notepad" aria-hidden="true"></i>
          </span>
          <span>My Notes</span>
        </div>
      </div>
      <div class="hidden text-xs text-muted uppercase tracking-[0.28em] sm:block">
        Private to you
      </div>
    </header>

    <main class="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 notes-main">
      <div class="notes-board-container">
        <NotesBoard />
      </div>
    </main>
  </div>
</div>

<style>
  .notes-main {
    min-height: 0;
  }

  .notes-board-container {
    width: 100%;
    max-width: 960px;
    margin: 0 auto;
  }
</style>

<div
  class="mobile-panel md:hidden fixed inset-0 z-40 flex flex-col transition-transform duration-300 will-change-transform"
  class:mobile-panel--dragging={swipeActive}
  style:transform={panelTransform}
  style:pointer-events={showThreads ? 'auto' : 'none'}
  aria-label="Conversations"
>
  <div class="mobile-panel__header md:hidden">
    <button
      class="mobile-panel__close -ml-2"
      aria-label="Close"
      type="button"
      onclick={() => (showThreads = false)}
    >
      <i class="bx bx-chevron-left text-2xl"></i>
    </button>
    <div class="mobile-panel__title">Conversations</div>
  </div>
  <div class="flex-1 overflow-y-auto">
    <DMsSidebar
      activeThreadId="__notes"
      on:select={() => (showThreads = false)}
      on:delete={() => (showThreads = false)}
    />
  </div>
</div>
