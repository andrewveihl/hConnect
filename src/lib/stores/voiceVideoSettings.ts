import {
	defaultVoicePreferences,
	loadVoicePreferences,
	saveVoicePreferences,
	voicePreferences,
	type VoicePreferences
} from '$lib/stores/voicePreferences';

export type VoiceVideoSettings = VoicePreferences;

export const defaultVoiceVideoSettings: VoiceVideoSettings = defaultVoicePreferences;

export function loadVoiceVideoSettings(): VoiceVideoSettings {
	return loadVoicePreferences();
}

export function saveVoiceVideoSettings(settings: VoiceVideoSettings) {
	return saveVoicePreferences(settings);
}

export const voiceVideoSettings = voicePreferences;
