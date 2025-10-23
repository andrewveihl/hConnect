<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { db } from '$lib/db';
  import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';

  export let serverId: string;

  let memberUids: string[] = [];
  let profiles: Record<string, any> = {};
  let unsubMembers: Unsubscribe | undefined;
  const profileUnsubs: Record<string, Unsubscribe> = {};

  // Mobile full-screen panel
  let mobileOpen = false;
  const EDGE_ZONE_PX = 24;    // right-edge zone to start opening swipe
  const SWIPE_THRESHOLD = 50; // px to trigger open/close
  let touchStartX = 0;
  let touchStartY = 0;
  let isTracking = false;

  const label = (uid: string) =>
    profiles[uid]?.displayName ?? profiles[uid]?.name ?? profiles[uid]?.email ?? uid;

  function getUidFromMemberDoc(d: any) {
    const data = (d?.data?.() ?? {}) as any;
    return data.uid ?? data.userId ?? data.memberUid ?? d.id;
  }

  onMount(() => {
    if (!serverId) return;
    const database = db();

    // --- members + profiles listeners (your logic, unchanged) ---
    unsubMembers = onSnapshot(collection(database, 'servers', serverId, 'members'), (snap) => {
      const uids = snap.docs.map(getUidFromMemberDoc);

      // clean removed
      for (const uid in profileUnsubs) {
        if (!uids.includes(uid)) {
          profileUnsubs[uid]?.();
          delete profileUnsubs[uid];
          const { [uid]: _drop, ...rest } = profiles;
          profiles = rest;
        }
      }

      // attach new
      uids.forEach((uid) => {
        if (!profileUnsubs[uid]) {
          profileUnsubs[uid] = onSnapshot(doc(database, 'profiles', uid), (ps) => {
            profiles = { ...profiles, [uid]: ps.data() ?? {} };
            memberUids = [...memberUids].sort((a, b) =>
              label(a).localeCompare(label(b), undefined, { sensitivity: 'base' })
            );
          });
        }
      });

      // initial sort
      memberUids = uids.sort((a, b) =>
        label(a).localeCompare(label(b), undefined, { sensitivity: 'base' })
      );
    });

    // --- gestures / keyboard ---
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileOpen) mobileOpen = false;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      touchStartX = t.clientX;
      touchStartY = t.clientY;

      const nearRightEdge = (window.innerWidth - touchStartX) <= EDGE_ZONE_PX;
      if ((!mobileOpen && nearRightEdge) || mobileOpen) {
        isTracking = true;
      } else {
        isTracking = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isTracking || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;

      // ignore mostly-vertical moves
      if (Math.abs(dy) > Math.abs(dx) * 1.25) return;

      // open: swipe LEFT from right edge
      if (!mobileOpen && dx <= -SWIPE_THRESHOLD) {
        mobileOpen = true;
        isTracking = false;
      }
      // close: swipe RIGHT anywhere when open
      if (mobileOpen && dx >= SWIPE_THRESHOLD) {
        mobileOpen = false;
        isTracking = false;
      }
    };

    const onTouchEnd = () => (isTracking = false);

    window.addEventListener('keydown', onKey);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      unsubMembers && unsubMembers();
      for (const k in profileUnsubs) profileUnsubs[k]();

      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  });

  onDestroy(() => {
    unsubMembers && unsubMembers();
    for (const k in profileUnsubs) profileUnsubs[k]();
  });
</script>

<!-- DESKTOP: unchanged right rail -->
<aside
  class="md:hidden fixed inset-0 z-50 ..."
  aria-label="Members"
>
  <div class="h-12 px-3 flex items-center border-b border-black/40 text-xs uppercase tracking-wide text-white/60">
    Members — {memberUids.length}
  </div>

  <div class="p-3 space-y-2 overflow-y-auto">
    {#each memberUids as uid}
      <div class="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/10">
        <div class="w-8 h-8 rounded-full overflow-hidden bg-[#3f4248] grid place-items-center">
          {#if profiles[uid]?.photoURL}
            <img src={profiles[uid].photoURL} alt="" class="w-full h-full object-cover" />
          {:else}
            <i class="bx bx-user text-white/70"></i>
          {/if}
        </div>
        <div class="text-sm truncate">{label(uid)}</div>
      </div>
    {/each}

    {#if !memberUids.length}
      <div class="text-xs text-white/50 px-2">No members yet.</div>
    {/if}
  </div>
</aside>

<!-- MOBILE: full-screen panel (covers entire app) -->
<aside
  class="md:hidden fixed inset-0 z-50 bg-[#2b2d31] text-white flex flex-col transition-transform duration-300 will-change-transform"
  style:transform={mobileOpen ? 'translateX(0)' : 'translateX(100%)'}

  aria-label="Members"
>
  <!-- Header with back arrow (top-left) -->
  <div class="h-12 px-2 flex items-center gap-2 border-b border-black/40">
    <button
      class="p-2 rounded-md hover:bg-white/10 active:bg-white/15"
      aria-label="Back to conversation"
      on:click={() => (mobileOpen = false)}
    >
      <i class="bx bx-chevron-left text-2xl"></i>
    </button>
    <div class="text-xs uppercase tracking-wide text-white/60">
      Members — {memberUids.length}
    </div>
  </div>

  <!-- List -->
  <div class="p-3 space-y-2 overflow-y-auto">
    {#each memberUids as uid}
      <div class="flex items-center gap-3 px-2 py-2 rounded hover:bg-white/10 active:bg-white/15">
        <div class="w-9 h-9 rounded-full overflow-hidden bg-[#3f4248] grid place-items-center shrink-0">
          {#if profiles[uid]?.photoURL}
            <img src={profiles[uid].photoURL} alt="" class="w-full h-full object-cover" />
          {:else}
            <i class="bx bx-user text-white/70"></i>
          {/if}
        </div>
        <div class="text-sm truncate">{label(uid)}</div>
      </div>
    {/each}

    {#if !memberUids.length}
      <div class="text-xs text-white/50 px-2">No members yet.</div>
    {/if}
  </div>
</aside>
