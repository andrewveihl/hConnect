import { writable } from 'svelte/store';
import {
  defaultServerSettingsSection,
  type ServerSettingsSectionId
} from '$lib/servers/settingsSections';

type ServerSettingsSource = 'route' | 'trigger';

type ServerSettingsUIState = {
  open: boolean;
  serverId: string | null;
  activeSection: ServerSettingsSectionId;
  source: ServerSettingsSource;
  returnTo: string | null;
};

const initialState: ServerSettingsUIState = {
  open: false,
  serverId: null,
  activeSection: defaultServerSettingsSection,
  source: 'trigger',
  returnTo: null
};

export const serverSettingsUI = writable<ServerSettingsUIState>({ ...initialState });

export function openServerSettings(options: {
  serverId?: string | null;
  section?: ServerSettingsSectionId | null;
  source?: ServerSettingsSource;
  returnTo?: string | null;
} = {}) {
  const { serverId = null, section = null, source = 'trigger', returnTo = null } = options;
  serverSettingsUI.set({
    open: true,
    serverId,
    activeSection: section ?? defaultServerSettingsSection,
    source,
    returnTo
  });
}

export function closeServerSettings() {
  serverSettingsUI.set({ ...initialState });
}

export function setServerSettingsSection(section: ServerSettingsSectionId) {
  serverSettingsUI.update((state) => ({
    ...state,
    activeSection: section
  }));
}
