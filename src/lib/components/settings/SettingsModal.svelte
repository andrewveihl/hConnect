<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import SettingsPanel from '$lib/components/settings/SettingsPanel.svelte';
  import { settingsSections, type SettingsSection, type SettingsSectionId } from '$lib/settings/sections';

  interface Props {
    open: boolean;
    activeSection: SettingsSectionId;
    serverId?: string | null;
  }

  let { open, activeSection, serverId = null }: Props = $props();
  const dispatch = createEventDispatcher<{ close: void; section: SettingsSectionId }>();

  let search = $state('');

  const filteredSections = $derived.by<SettingsSection[]>(() => {
    const term = search.trim().toLowerCase();
    if (!term) return settingsSections;
    return settingsSections.filter((section) => {
      const haystack = `${section.label} ${section.group} ${section.keywords?.join(' ') ?? ''}`.toLowerCase();
      return haystack.includes(term);
    });
  });

  const groupedSections = $derived.by<Array<{ label: string; items: SettingsSection[] }>>(() => {
    const groups: Record<string, SettingsSection[]> = {};
    filteredSections.forEach((section: SettingsSection) => {
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

  function pickSection(id: SettingsSectionId) {
    activeSection = id;
    dispatch('section', id);
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    tabindex="-1"
    aria-hidden="true"
    onclick={handleOverlayClick}
    onkeydown={handleOverlayKeydown}
  >
    <div
      class="relative flex h-[calc(100vh-4rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-[color:var(--color-panel)] text-[color:var(--color-text-primary)] shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="User settings"
      tabindex="0"
    >
      <header class="flex items-center justify-between border-b border-[color:var(--color-border-subtle)] px-4 py-3">
        <div>
          <p class="text-xs uppercase tracking-[0.16em] text-[color:var(--text-70)]">User Settings</p>
          <h2 class="text-lg font-semibold text-[color:var(--color-text-primary)]">User Settings</h2>
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
          <div class="px-3 pb-2 pt-3">
            <label class="flex items-center gap-2 rounded-md bg-[color:var(--color-panel-muted)] px-3 py-1.5 text-sm text-[color:var(--color-text-primary)] ring-1 ring-[color:var(--color-border-subtle)] focus-within:ring-[color:var(--color-accent)]">
              <i class="bx bx-search text-[color:var(--text-70)]" aria-hidden="true"></i>
              <input
                type="search"
                placeholder="Search"
                class="w-full bg-transparent text-sm text-[color:var(--color-text-primary)] placeholder:text-[color:var(--color-text-tertiary)] focus:outline-none"
                bind:value={search}
              />
            </label>
          </div>

          <div class="flex-1 overflow-y-auto px-2 pb-4">
            {#each groupedSections as group}
              <div class="mt-3 space-y-1 first:mt-0">
                <p class="px-3 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-70)]">{group.label}</p>
                {#each group.items as section (section.id)}
                  <button
                    type="button"
                    class={`flex h-9 w-full items-center rounded-md px-4 text-left text-sm transition ${
                      section.id === activeSection
                        ? 'bg-[color:var(--color-panel-muted)] text-[color:var(--color-text-primary)]'
                        : 'text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-panel-muted)]'
                    }`}
                    onclick={() => pickSection(section.id)}
                  >
                    {section.label}
                  </button>
                {/each}
              </div>
            {/each}
          </div>
        </aside>

        <section class="flex-1 overflow-y-auto bg-[color:var(--surface-root)] p-6">
          <SettingsPanel {serverId} {activeSection} />
        </section>
      </div>
    </div>
  </div>
{/if}
