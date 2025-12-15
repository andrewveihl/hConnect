<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { adminNav, mobileNavOpen } from '$lib/admin/stores/adminNav';
  import { ADMIN_NAV_ITEMS, type AdminNavItem } from '$lib/admin/types';
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  interface Props {
    userEmail?: string | null;
  }

  let { userEmail = null }: Props = $props();

  const currentPath = $derived($page?.url?.pathname ?? '/admin');
  
  // Quick access nav items for bottom bar
  const quickNavItems = $derived(
    ADMIN_NAV_ITEMS.filter(item => 
      ['overview', 'servers', 'users', 'features', 'logs'].includes(item.id)
    ).slice(0, 5)
  );

  const isActive = (href: string) => {
    if (href === '/admin') {
      return currentPath === '/admin';
    }
    return currentPath === href || currentPath.startsWith(`${href}/`);
  };

  const handleNavigate = (href: string) => {
    adminNav.closeNav();
    goto(href);
  };

  const goBackToApp = () => {
    adminNav.closeNav();
    goto('/');
  };
</script>

<!-- Mobile Bottom Nav Bar -->
<nav 
  class="fixed inset-x-0 bottom-0 z-40 md:hidden"
  style="padding-bottom: env(safe-area-inset-bottom, 0px);"
>
  <div 
    class="flex items-center justify-around border-t border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] px-2 py-2"
    style="background: color-mix(in srgb, var(--surface-panel) 95%, transparent); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);"
  >
    {#each quickNavItems as item}
      <button
        type="button"
        class="flex flex-col items-center gap-1 rounded-xl px-3 py-2 transition-all duration-200"
        class:text-[color:var(--accent-primary,#14b8a6)]={isActive(item.href)}
        class:text-[color:var(--text-60,#6b7280)]={!isActive(item.href)}
        class:scale-105={isActive(item.href)}
        onclick={() => handleNavigate(item.href)}
      >
        <i 
          class="bx {item.icon} text-xl transition-transform duration-200"
          class:scale-110={isActive(item.href)}
        ></i>
        <span class="text-[10px] font-medium">{item.label}</span>
      </button>
    {/each}
    
    <!-- More button to open full nav -->
    <button
      type="button"
      class="flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-[color:var(--text-60,#6b7280)] transition-all duration-200"
      onclick={() => adminNav.openNav()}
    >
      <i class="bx bx-menu text-xl"></i>
      <span class="text-[10px] font-medium">More</span>
    </button>
  </div>
</nav>

<!-- Full Nav Drawer (slide up from bottom on mobile) -->
{#if $mobileNavOpen}
  <div class="fixed inset-0 z-50 flex flex-col justify-end md:hidden">
    <!-- Backdrop -->
    <button
      type="button"
      class="absolute inset-0 bg-black/50 backdrop-blur-sm"
      transition:fade={{ duration: 200 }}
      aria-label="Close navigation"
      onclick={() => adminNav.closeNav()}
    ></button>
    
    <!-- Drawer -->
    <div 
      class="relative flex max-h-[85vh] flex-col overflow-hidden rounded-t-3xl"
      style="background: var(--surface-panel); padding-bottom: env(safe-area-inset-bottom, 0px);"
      transition:fly={{ y: 400, duration: 300, easing: cubicOut }}
    >
      <!-- Handle bar -->
      <div class="flex justify-center py-3">
        <div class="h-1 w-10 rounded-full bg-[color:var(--text-30,#cbd5e1)]"></div>
      </div>
      
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-5 pb-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--text-50,#94a3b8)]">
            Super Admin
          </p>
          <p class="text-lg font-bold text-[color:var(--color-text-primary)]">hConnect</p>
          {#if userEmail}
            <p class="mt-0.5 truncate text-xs text-[color:var(--text-60,#6b7280)]">{userEmail}</p>
          {/if}
        </div>
        <button
          type="button"
          class="rounded-full p-2 text-[color:var(--text-60,#6b7280)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)]"
          aria-label="Close navigation"
          onclick={() => adminNav.closeNav()}
        >
          <i class="bx bx-x text-2xl"></i>
        </button>
      </div>
      
      <!-- Nav Items -->
      <nav class="flex-1 overflow-y-auto px-4 py-4" style="-webkit-overflow-scrolling: touch;">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {#each ADMIN_NAV_ITEMS as item}
            <button
              type="button"
              class="flex flex-col items-center gap-2 rounded-2xl border p-4 text-center transition-all duration-200"
              class:border-[color:var(--accent-primary,#14b8a6)]={isActive(item.href)}
              class:bg-[color-mix(in_srgb,var(--accent-primary,#14b8a6)12%,transparent)]={isActive(item.href)}
              class:border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)]={!isActive(item.href)}
              class:hover:bg-[color-mix(in_srgb,var(--color-text-primary)6%,transparent)]={!isActive(item.href)}
              onclick={() => handleNavigate(item.href)}
            >
              <div 
                class="flex h-10 w-10 items-center justify-center rounded-xl transition-colors"
                class:bg-[color:var(--accent-primary,#14b8a6)]={isActive(item.href)}
                class:text-white={isActive(item.href)}
                class:bg-[color-mix(in_srgb,var(--color-text-primary)8%,transparent)]={!isActive(item.href)}
                class:text-[color:var(--text-70,#475569)]={!isActive(item.href)}
              >
                <i class="bx {item.icon} text-xl"></i>
              </div>
              <div>
                <p 
                  class="text-sm font-semibold"
                  class:text-[color:var(--accent-primary,#14b8a6)]={isActive(item.href)}
                  class:text-[color:var(--color-text-primary)]={!isActive(item.href)}
                >
                  {item.label}
                </p>
                {#if item.badge}
                  <span 
                    class="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                    class:bg-emerald-500={item.badge === 'new'}
                    class:bg-blue-500={item.badge === 'beta'}
                    class:text-white={true}
                  >
                    {item.badge}
                  </span>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      </nav>
      
      <!-- Footer Actions -->
      <div class="flex items-center justify-between border-t border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)] px-5 py-4">
        <button
          type="button"
          class="flex items-center gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-4 py-2 text-sm font-medium text-[color:var(--color-text-primary)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)6%,transparent)]"
          onclick={goBackToApp}
        >
          <i class="bx bx-arrow-back"></i>
          Back to App
        </button>
        
        <button
          type="button"
          class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
          onclick={() => goto('/admin/super-admins')}
        >
          <i class="bx bx-shield-quarter"></i>
          Super Admins
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(.bx) {
    line-height: 1;
  }
</style>
