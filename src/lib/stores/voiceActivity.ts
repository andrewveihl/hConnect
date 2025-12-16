import { writable } from 'svelte/store';

export type VoiceActivityPing = {
	serverId: string;
	channelId: string;
	at: number;
	reason?: string;
};

function createVoiceActivityStore() {
	const { subscribe, set } = writable<VoiceActivityPing | null>(null);

	return {
		subscribe,
		ping(
			serverId: string | null | undefined,
			channelId: string | null | undefined,
			reason?: string
		) {
			if (!serverId || !channelId) return;
			set({ serverId, channelId, at: Date.now(), reason });
		}
	};
}

export const voiceActivity = createVoiceActivityStore();
