<script lang="ts">
  import { onMount } from 'svelte';
  import DMsSidebar from '$lib/components/dms/DMsSidebar.svelte';

  let showThreads = false;

  const LEFT_RAIL = 72;
  const EDGE_ZONE = 28;
  const SWIPE_THRESHOLD = 64;

  let tracking = false;
  let startX = 0;
  let startY = 0;

  function setupGestures() {
    if (typeof window === 'undefined') return () => {};

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') showThreads = false;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      const nearLeft = startX >= LEFT_RAIL && startX <= LEFT_RAIL + EDGE_ZONE;
      tracking = nearLeft || showThreads;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (Math.abs(dy) > Math.abs(dx) * 1.25) return;

      if (!showThreads && startX >= LEFT_RAIL && startX <= LEFT_RAIL + EDGE_ZONE && dx >= SWIPE_THRESHOLD) {
        showThreads = true;
        tracking = false;
      } else if (showThreads && dx <= -SWIPE_THRESHOLD) {
        showThreads = false;
        tracking = false;
      }
    };

    const onTouchEnd = () => (tracking = false);

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
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      showThreads = true;
    }
    const cleanup = setupGestures();
    return cleanup;
  });
</script>

<div class="flex flex-1 overflow-hidden panel-muted">
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
            on:click={() => (showThreads = true)}
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

<div
  class="mobile-panel md:hidden fixed inset-y-0 right-0 left-[72px] z-40 flex flex-col transition-transform duration-300 will-change-transform"
  style:transform={showThreads ? 'translateX(0)' : 'translateX(-100%)'}
  style:pointer-events={showThreads ? 'auto' : 'none'}
  aria-label="Conversations"
>
  <div class="mobile-panel__header md:hidden">
    <button class="mobile-panel__close -ml-2" aria-label="Close" type="button" on:click={() => (showThreads = false)}>
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
