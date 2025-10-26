<script lang="ts">
  import { page } from '$app/stores';
  import LeftPane from '$lib/components/LeftPane.svelte';

  // Tiny helpers for active tab highlighting
  $: pathname = $page?.url?.pathname ?? '/';
  const isActive = (p: string) => pathname === p;
  const tabClasses = (p: string) =>
    `flex flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors ${
      isActive(p) ? 'text-[#9aa4ff]' : 'text-white/70 hover:text-white'
    }`;
</script>

<!-- Always-on server rail + simple, calm home -->
<div class="grid grid-cols-[72px_1fr] min-h-dvh text-white bg-[rgb(3,7,18)]">
  <aside class="bg-[#1e1f22] border-r border-white/10 overflow-y-auto">
    <LeftPane activeServerId={null} />
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
<nav class="md:hidden fixed inset-x-0 bottom-0 z-30 pointer-events-none" aria-label="Primary">
      <div class="px-3 pb-3" style="padding-bottom: calc(env(safe-area-inset-bottom) + 8px)">
        <div class="mx-auto max-w-md rounded-2xl bg-[#1f2430]/95 border border-white/10 shadow-xl backdrop-blur pointer-events-auto">
          <div class="grid grid-cols-4">
            <a href="/dms" class={tabClasses('/dms')} aria-current={isActive('/dms') ? 'page' : undefined}>
              <i class="bx bx-message-dots text-[22px]"></i>
              <span class="text-[11px] leading-none">DMs</span>
            </a>
            <a href="/notes" class={tabClasses('/notes')} aria-current={isActive('/notes') ? 'page' : undefined}>
              <i class="bx bx-notepad text-[22px]"></i>
              <span class="text-[11px] leading-none">Notes</span>
            </a>
            <a href="/friends" class={tabClasses('/friends')} aria-current={isActive('/friends') ? 'page' : undefined}>
              <i class="bx bx-user text-[22px]"></i>
              <span class="text-[11px] leading-none">Friends</span>
            </a>
            <a href="/notifications" class={tabClasses('/notifications')} aria-current={isActive('/notifications') ? 'page' : undefined}>
              <div class="relative">
                <i class="bx bx-bell text-[22px]"></i>
                {#if false}
                  <span class="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-[#1f2430]"></span>
                {/if}
              </div>
              <span class="text-[11px] leading-none">Alerts</span>
            </a>
          </div>
        </div>
      </div>
    </nav>
  </main>
</div>
