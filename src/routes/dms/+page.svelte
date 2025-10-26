<script lang="ts">
  import { onMount } from 'svelte';
  import DMsSidebar from '$lib/components/DMsSidebar.svelte';

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

<div class="flex flex-1 overflow-hidden bg-[#1e1f24]">
  <div class="hidden md:flex md:w-80 flex-col border-r border-black/40 bg-[#1e1f24]">
    <DMsSidebar activeThreadId={null} />
  </div>

  <div class="flex flex-1 flex-col bg-[#2b2d31]">
    <header class="h-14 px-3 sm:px-4 flex items-center gap-3 border-b border-black/40 bg-[#1e1f24]">
      <button
        class="md:hidden p-2 rounded-md hover:bg-white/10 active:bg-white/15 transition"
        aria-label="Open conversations"
        on:click={() => (showThreads = true)}
      >
        <i class="bx bx-menu text-2xl"></i>
      </button>
      <div>
        <div class="font-semibold leading-5">Direct Messages</div>
        <div class="text-xs text-white/60">Pick a friend to start chatting.</div>
      </div>
    </header>

    <main class="flex-1 bg-[#313338] flex items-center justify-center text-white/70 p-6">
      <div class="text-center max-w-md space-y-2">
        <h1 class="text-xl font-semibold">Select a conversation</h1>
        <p>Choose someone from your message list to begin chatting. Swipe right or tap the menu to open conversations on mobile.</p>
      </div>
    </main>
  </div>
</div>

<div
  class="md:hidden fixed inset-y-0 right-0 left-[72px] z-40 bg-[#1e1f24] flex flex-col transition-transform duration-300 will-change-transform"
  style:transform={showThreads ? 'translateX(0)' : 'translateX(-100%)'}
  style:pointer-events={showThreads ? 'auto' : 'none'}
  aria-label="Conversations"
>
  <div class="h-12 px-2 flex items-center gap-2 border-b border-black/40">
    <button class="p-2 -ml-2 rounded-md hover:bg-white/10 active:bg-white/15" aria-label="Close" on:click={() => (showThreads = false)}>
      <i class="bx bx-chevron-left text-2xl"></i>
    </button>
    <div class="text-xs uppercase tracking-wide text-white/60">Conversations</div>
  </div>
  <div class="flex-1 overflow-y-auto">
    <DMsSidebar
      activeThreadId={null}
      on:select={() => (showThreads = false)}
      on:delete={() => (showThreads = false)}
    />
  </div>
</div>
