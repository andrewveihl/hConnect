<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import ServerSettingsPanel from '$lib/components/servers/ServerSettingsPanel.svelte';
  import {
    mapServerSectionToPanel,
    serverSettingsSections,
    type ServerSettingsSection,
    type ServerSettingsSectionId
  } from '$lib/servers/settingsSections';

  interface Props {
    open: boolean;
    activeSection: ServerSettingsSectionId;
    serverId?: string | null;
  }

  let { open, activeSection, serverId = null }: Props = $props();
  const dispatch = createEventDispatcher<{ close: void; section: ServerSettingsSectionId }>();

  let search = $state('');

  const filteredSections = $derived.by<ServerSettingsSection[]>(() => {
    const term = search.trim().toLowerCase();
    if (!term) return serverSettingsSections;
    return serverSettingsSections.filter((section) => {
      const haystack = `${section.label} ${section.group} ${section.keywords?.join(' ') ?? ''}`.toLowerCase();
      return haystack.includes(term);
    });
  });

  const groupedSections = $derived.by<Array<{ label: string; items: ServerSettingsSection[] }>>(() => {
    const groups: Record<string, ServerSettingsSection[]> = {};
    filteredSections.forEach((section) => {
      if (!groups[section.group]) {
        groups[section.group] = [];
      }
      groups[section.group] = [...groups[section.group], section];
    });
    return Object.entries(groups).map(([label, items]) => ({ label, items }));
  });

  function requestClose() {
    dispatch('close');
  }

  function handleOverlayClick(event: MouseEvent) {
    if (event.currentTarget === event.target) {
      requestClose();
    }
  }

  function handleOverlayKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      requestClose();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
    }
  }

  function pickSection(id: ServerSettingsSectionId) {
    activeSection = id;
    dispatch('section', id);
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    onclick={handleOverlayClick}
    onkeydown={handleOverlayKeydown}
    tabindex="-1"
    role="presentation"
  >
    <div
      class="relative flex h-[calc(100vh-4rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-[color:var(--color-panel)] text-[color:var(--color-text-primary)] shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Server settings"
      tabindex="0"
    >
      <header class="flex items-center justify-between border-b border-[color:var(--color-border-subtle)] px-5 py-4">
        <div>
          <p class="text-xs uppercase tracking-[0.16em] text-[color:var(--text-70)]">Server Settings</p>
          <h2 class="text-lg font-semibold text-[color:var(--color-text-primary)]">Server Settings</h2>
        </div>
        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-md text-[color:var(--text-70)] transition hover:bg-[color:var(--color-panel-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
          aria-label="Close settings"
          onclick={requestClose}
        >
          <i class="bx bx-x text-2xl leading-none" aria-hidden="true"></i>
        </button>
      </header>

      <div class="flex flex-1 overflow-hidden">
        <aside class="flex w-64 shrink-0 flex-col border-r border-[color:var(--color-border-subtle)] bg-[color:var(--color-panel)]">
          <div class="px-4 pb-3 pt-4">
            <label class="flex items-center gap-2 rounded-md bg-[color:var(--color-panel-muted)] px-3 py-2 text-sm text-[color:var(--color-text-primary)] ring-1 ring-[color:var(--color-border-subtle)] focus-within:ring-[color:var(--color-accent)]">
              <i class="bx bx-search text-[color:var(--color-text-tertiary)]" aria-hidden="true"></i>
              <input
                type="search"
                placeholder="Search settings"
                class="w-full bg-transparent text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--color-text-tertiary)] focus:outline-none"
                bind:value={search}
              />
            </label>
          </div>

          <div class="flex-1 overflow-y-auto px-2 pb-6">
            {#each groupedSections as group}
              <div class="py-2 first:pt-0">
                <p class="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-70)]">
                  {group.label}
                </p>
                <div class="mt-1 space-y-1">
                  {#each group.items as section (section.id)}
                    <button
                      type="button"
                      class={`flex h-9 w-full items-center justify-between rounded-md px-4 text-left text-sm transition ${
                        section.id === activeSection
                          ? 'bg-[color:var(--color-panel-muted)] text-[color:var(--color-text-primary)]'
                          : 'text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-panel-muted)]'
                      }`}
                      onclick={() => pickSection(section.id)}
                    >
                      <span class="truncate">{section.label}</span>
                      {#if section.id === activeSection}
                        <span class="h-1.5 w-1.5 rounded-full bg-[color:var(--color-accent)]" aria-hidden="true"></span>
                      {/if}
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </aside>

        <section class="flex-1 overflow-y-auto bg-[color:var(--surface-root)] p-6">
          <ServerSettingsPanel serverId={serverId} section={mapServerSectionToPanel(activeSection)} bare />
        </section>
      </div>
    </div>
  </div>
{/if}
