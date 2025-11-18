<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import AdminToasts from './AdminToasts.svelte';
  import type { AdminNavItem } from '$lib/admin/types';
  import { ADMIN_NAV_ITEMS } from '$lib/admin/types';
  import LeftPane from '$lib/components/app/LeftPane.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    title?: string;
    description?: string;
    currentPath?: string;
    userEmail?: string | null;
    navItems?: AdminNavItem[];
    children?: Snippet;
    toolbar?: Snippet;
  }

  let {
    title = 'Admin',
    description = 'Super Admin controls',
    currentPath = '',
    userEmail = '',
    navItems = ADMIN_NAV_ITEMS,
    children,
    toolbar
  }: Props = $props();

  let mobileNavOpen = $state(false);

  const resolvedPath = $derived(currentPath || $page?.url?.pathname || '/admin');
  const hasToolbar = $derived(Boolean(toolbar));

  const isActive = (href: string) => {
    if (href === '/admin') {
      return resolvedPath === '/admin';
    }
    return resolvedPath === href || resolvedPath.startsWith(`${href}/`);
  };

  const handleNavigate = (href: string) => {
    mobileNavOpen = false;
    goto(href);
  };

  const goBackToApp = () => goto('/');
</script>

<div class="flex h-screen overflow-hidden" style="background: var(--surface-root); color: var(--color-text-primary);">
  <div class="hidden md:flex md:shrink-0">
    <LeftPane activeServerId={null} padForDock={false} showBottomActions={true} />
  </div>
  <aside
    class="hidden h-full w-64 flex-col overflow-y-auto text-[color:var(--color-text-primary,#f8fafc)] shadow-2xl md:flex"
    style="background: color-mix(in srgb, var(--surface-panel) 92%, transparent);"
  >
    <div class="px-6 py-5">
      <p class="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--text-50,#94a3b8)]">hConnect</p>
      <p class="text-xl font-semibold text-[color:var(--color-text-primary,#f8fafc)]">Super Admin</p>
      {#if userEmail}
        <p class="mt-1 truncate text-sm text-[color:var(--text-70,#cbd5f5)]">{userEmail}</p>
      {/if}
    </div>
    <nav class="flex-1 space-y-1 px-3 pb-6">
      {#each navItems as item}
        <button
          type="button"
          class="w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)12%,transparent)]"
          class:admin-nav__item-active={isActive(item.href)}
          class:admin-nav__item-muted={!isActive(item.href)}
          onclick={() => handleNavigate(item.href)}
        >
          {item.label}
        </button>
      {/each}
    </nav>
  </aside>

  <div class="flex flex-1 flex-col h-full overflow-hidden">
    <header class="sticky top-0 z-40 flex shrink-0 items-center justify-between border-b border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)80%,transparent)] px-4 py-4 shadow-sm backdrop-blur md:hidden">
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-full border border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] bg-[color-mix(in_srgb,var(--surface-panel)75%,transparent)] px-3 py-1.5 text-xs font-semibold text-[color:var(--color-text-primary,#0f172a)] shadow-sm transition hover:bg-[color-mix(in_srgb,var(--surface-panel)80%,transparent)]"
          aria-label="Back to hConnect"
          onclick={goBackToApp}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6 4.5 12m0 0 6 6m-6-6H21" />
          </svg>
          Back
        </button>
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--text-60,#6b7280)]">Super Admin</p>
          <h1 class="text-lg font-semibold text-[color:var(--color-text-primary,#0f172a)]">{title}</h1>
        </div>
      </div>
      <button
        type="button"
        class="rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)18%,transparent)] p-2 text-[color:var(--color-text-primary,#0f172a)]"
        aria-label="Open admin navigation"
        onclick={() => (mobileNavOpen = true)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-6 w-6">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6h16.5M3.75 12h16.5M3.75 18h16.5" />
        </svg>
      </button>
    </header>
    <main class="flex-1 overflow-y-auto min-h-0">
      <section class="admin-shell__body w-full max-w-screen-2xl px-4 sm:px-6 lg:px-8 mx-auto">
        {#if hasToolbar}
          <div class="flex items-center justify-end gap-2">
            {@render toolbar?.()}
          </div>
        {/if}
        {@render children?.()}
      </section>
    </main>
  </div>
</div>

{#if mobileNavOpen}
  <div class="fixed inset-0 z-50 flex md:hidden">
    <div class="h-full w-72 p-6 text-[color:var(--color-text-primary,#f8fafc)] shadow-2xl" style="background: color-mix(in srgb, var(--surface-panel) 94%, transparent);">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-xs uppercase tracking-[0.2em] text-[color:var(--text-50,#94a3b8)]">Super Admin</p>
          <p class="text-lg font-semibold text-[color:var(--color-text-primary,#f8fafc)]">hConnect</p>
        </div>
        <button
          type="button"
          class="rounded-full border border-[color:color-mix(in_srgb,var(--color-text-primary)20%,transparent)] p-2 text-[color:var(--color-text-primary,#f8fafc)]"
          aria-label="Close admin navigation"
          onclick={() => (mobileNavOpen = false)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-5 w-5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6m0 12L6 6" />
          </svg>
        </button>
      </div>
      <nav class="mt-6 space-y-1">
        {#each navItems as item}
          <button
            type="button"
            class="w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)] transition hover:bg-[color-mix(in_srgb,var(--color-text-primary)12%,transparent)]"
            class:admin-nav__item-active={isActive(item.href)}
            class:admin-nav__item-muted={!isActive(item.href)}
            onclick={() => handleNavigate(item.href)}
          >
            {item.label}
          </button>
        {/each}
      </nav>
    </div>
    <button
      type="button"
      class="flex-1"
      style="background: color-mix(in srgb, var(--surface-root) 50%, transparent);"
      aria-label="Dismiss admin navigation"
      onclick={() => (mobileNavOpen = false)}
    ></button>
  </div>
{/if}

<AdminToasts />

<style>
  :global(.admin-nav__item-active) {
    background: color-mix(in srgb, var(--color-text-primary) 14%, transparent);
    color: var(--color-text-primary);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text-primary) 18%, transparent);
  }

  :global(.admin-nav__item-muted) {
    color: color-mix(in srgb, var(--color-text-primary) 70%, transparent);
  }

  :global(.admin-page) {
    width: 100%;
    max-width: min(100%, 80rem);
    height: 100%;
    min-height: 0;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: clamp(1.25rem, 3vw, 2rem);
  }

  :global(.admin-page.admin-page--split) {
    grid-template-columns: minmax(0, 1fr);
  }

  @media (min-width: 768px) {
    :global(.admin-page:not(.admin-page--split)) {
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    }
  }

  @media (min-width: 1024px) {
    :global(.admin-page.admin-page--split) {
      grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
      gap: 1.75rem;
    }

    :global(.admin-page.admin-page--stack) {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto auto;
    }
  }

  @media (min-width: 768px) {
    :global(.admin-page.admin-page--stack) {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .admin-shell__body {
    width: 100%;
    max-width: min(100%, 80rem);
    height: 100%;
    min-height: 0;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: clamp(1.5rem, 4vw, 3rem);
    padding-top: clamp(0.75rem, 2vw, 2.5rem);
    padding-bottom: clamp(2rem, 6vh, 4rem);
  }

  @media (max-width: 640px) {
    .admin-shell__body {
      height: auto;
      min-height: auto;
      padding-top: 1.25rem;
      padding-bottom: 3.5rem;
      gap: 1.25rem;
    }
  }

  :global(.admin-pill) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    font-weight: 600;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.3rem 0.95rem;
  }
</style>
