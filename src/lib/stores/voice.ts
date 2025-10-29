import { writable } from 'svelte/store';

export type VoiceSession = {
  serverId: string;
  channelId: string;
  channelName: string;
  serverName?: string | null;
  visible: boolean;
};

function createVoiceStore() {
  const { subscribe, set, update } = writable<VoiceSession | null>(null);

  return {
    subscribe,
    join(serverId: string, channelId: string, channelName: string, serverName?: string | null) {
      set({ serverId, channelId, channelName, serverName, visible: true });
    },
    leave() {
      set(null);
    },
    setVisible(visible: boolean) {
      update((session) => (session ? { ...session, visible } : session));
    },
    setServerName(serverId: string, serverName: string | null) {
      update((session) => {
        if (!session || session.serverId !== serverId) return session;
        return { ...session, serverName };
      });
    }
  };
}

export const voiceSession = createVoiceStore();
