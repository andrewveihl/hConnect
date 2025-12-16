import { writable } from 'svelte/store';
import {
  defaultServerSettingsSection,
  type ServerSettingsSectionId
} from '$lib/servers/settingsSections';

type ServerSettingsSource = 'route' | 'trigger';
type FeatureModal = 'ticketAi' | null;

type ServerSettingsUIState = {
  open: boolean;
  serverId: string | null;
  activeSection: ServerSettingsSectionId;
  source: ServerSettingsSource;
  returnTo: string | null;
  featureModal: FeatureModal;
};

const initialState: ServerSettingsUIState = {
  open: false,
  serverId: null,
  activeSection: defaultServerSettingsSection,
  source: 'trigger',
  returnTo: null,
  featureModal: null
};

export const serverSettingsUI = writable<ServerSettingsUIState>({ ...initialState });

export function openServerSettings(options: {
  serverId?: string | null;
  section?: ServerSettingsSectionId | null;
  source?: ServerSettingsSource;
  returnTo?: string | null;
  featureModal?: FeatureModal;
} = {}) {
  const { serverId = null, section = null, source = 'trigger', returnTo = null, featureModal = null } = options;
  serverSettingsUI.set({
    open: true,
    serverId,
    activeSection: section ?? defaultServerSettingsSection,
    source,
    returnTo,
    featureModal
  });
}

export function closeServerSettings() {
  serverSettingsUI.set({ ...initialState });
}

export function clearFeatureModal() {
  serverSettingsUI.update((state) => ({
    ...state,
    featureModal: null
  }));
}

export function setServerSettingsSection(section: ServerSettingsSectionId) {
  serverSettingsUI.update((state) => ({
    ...state,
    activeSection: section
  }));
}
