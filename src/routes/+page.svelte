<script lang="ts">
  import { page } from '$app/stores';
  import LeftPane from '$lib/components/LeftPane.svelte';

  // Tiny helpers for active tab highlighting
  $: pathname = $page?.url?.pathname ?? '/';
  const isActive = (p: string) => pathname === p;
  const tabClasses = (p: string) =>
    `btn btn-ghost w-full ${isActive(p) ? 'ring-1 ring-white/20 bg-white/10' : ''}`;
</script>

<!-- Always-on server rail + simple, calm home -->
<div class="grid grid-cols-[72px_1fr] min-h-dvh text-white bg-[rgb(3,7,18)]">
  <aside class="bg-[#1e1f22] border-r border-white/10 overflow-y-auto">
    <LeftPane activeServerId={null} onCreateServer={() => { /* no create here */ }} />
  </aside>

  <main class="relative bg-[#313338]">
    <!-- Quiet, centered content -->
    <section class="min-h-dvh grid place-items-center px-6 pb-24 md:pb-10"
             style="padding-top: env(safe-area-inset-top); padding-bottom: calc(env(safe-area-inset-bottom) + 4rem)">
      <div class="w-full max-w-xl">
        <div class="rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm">
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Welcome back</h1>
          <p class="text-white/70 mt-2">
            Pick a server from the left, or jump into DMs and friends.
          </p>

          <div class="mt-6 grid gap-3 sm:grid-cols-2">
            <a href="/dms" class="btn btn-ghost justify-start w-full">
              <i class="bx bx-message-dots text-xl"></i>
              <span>Open DMs</span>
            </a>
            <a href="/friends" class="btn btn-ghost justify-start w-full">
              <i class="bx bx-user text-xl"></i>
              <span>Friends</span>
            </a>
          </div>
        </div>
      </div>
    </section>

    <!-- Mobile bottom nav: DMs • Friends • Notifications -->
<nav class="md:hidden fixed bottom-0 inset-x-0 z-20 border-t border-white/10 bg-[#1e1f22]/95 backdrop-blur"
     aria-label="Primary">
      <div class="grid grid-cols-3 px-3 py-2"
           style="padding-bottom: env(safe-area-inset-bottom)">
        <a href="/dms" class={tabClasses('/dms')} aria-current={isActive('/dms') ? 'page' : undefined}>
          <i class="bx bx-message-dots text-2xl"></i>
          <span class="sr-only">Direct Messages</span>
        </a>

        <a href="/friends" class={tabClasses('/friends')} aria-current={isActive('/friends') ? 'page' : undefined}>
          <i class="bx bx-user text-2xl"></i>
          <span class="sr-only">Friends</span>
        </a>

        <a href="/notifications" class={tabClasses('/notifications')} aria-current={isActive('/notifications') ? 'page' : undefined}>
          <i class="bx bx-bell text-2xl"></i>
          <span class="sr-only">Notifications</span>
          {#if false /* replace with unread > 0 */}
            <span class="absolute top-2 right-6 h-2 w-2 rounded-full bg-red-500"></span>
          {/if}
        </a>
      </div>
    </nav>
  </main>
</div>
