import { writable } from 'svelte/store';

export type VoiceSession = {
  serverId: string;
  channelId: string;
  channelName: string;
  visible: boolean;
};

function createVoiceStore() {
  const { subscribe, set, update } = writable<VoiceSession | null>(null);

  return {
    subscribe,
    join(serverId: string, channelId: string, channelName: string) {
      set({ serverId, channelId, channelName, visible: true });
    },
    leave() {
      set(null);
    },
    setVisible(visible: boolean) {
      update((session) => (session ? { ...session, visible } : session));
    }
  };
}

export const voiceSession = createVoiceStore();
