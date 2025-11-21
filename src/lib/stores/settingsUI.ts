import { writable } from 'svelte/store';
import { defaultSettingsSection, type SettingsSectionId } from '$lib/settings/sections';

type SettingsSource = 'route' | 'trigger';

type SettingsUIState = {
  open: boolean;
  activeSection: SettingsSectionId;
  source: SettingsSource;
  returnTo: string | null;
};

const initialState: SettingsUIState = {
  open: false,
  activeSection: defaultSettingsSection,
  source: 'trigger',
  returnTo: null
};

export const settingsUI = writable<SettingsUIState>({ ...initialState });

export function openSettings(options: { section?: SettingsSectionId | null; source?: SettingsSource; returnTo?: string | null } = {}) {
  const { section = null, source = 'trigger', returnTo = null } = options;
  settingsUI.set({
    open: true,
    activeSection: section ?? defaultSettingsSection,
    source,
    returnTo
  });
}

export function closeSettings() {
  settingsUI.set({ ...initialState });
}

export function setSettingsSection(section: SettingsSectionId) {
  settingsUI.update((state) => ({
    ...state,
    activeSection: section
  }));
}
