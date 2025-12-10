import { writable } from 'svelte/store';
import { appendVoiceDebugEvent } from '$lib/utils/voiceDebugContext';

export type VoiceSession = {
  serverId: string;
  channelId: string;
  channelName: string;
  serverName?: string | null;
  visible: boolean;
  joinMuted?: boolean;
  joinVideoOff?: boolean;
};

function createVoiceStore() {
  const { subscribe, set, update } = writable<VoiceSession | null>(null);

  return {
    subscribe,
    join(
      serverId: string,
      channelId: string,
      channelName: string,
      serverName?: string | null,
      options: { muted?: boolean; videoOff?: boolean } = {}
    ) {
      set({
        serverId,
        channelId,
        channelName,
        serverName,
        visible: true,
        joinMuted: options.muted ?? false,
        joinVideoOff: options.videoOff ?? false
      });
      appendVoiceDebugEvent('voice-store', 'join', {
        serverId,
        channelId,
        channelName,
        serverName: serverName ?? null,
        joinMuted: options.muted ?? false,
        joinVideoOff: options.videoOff ?? false
      });
    },
    leave() {
      set(null);
      appendVoiceDebugEvent('voice-store', 'leave', {});
    },
    setVisible(visible: boolean) {
      update((session) => {
        if (!session) return session;
        appendVoiceDebugEvent('voice-store', 'setVisible', {
          serverId: session.serverId,
          channelId: session.channelId,
          visible
        });
        return { ...session, visible };
      });
    },
    setServerName(serverId: string, serverName: string | null) {
      update((session) => {
        if (!session || session.serverId !== serverId) return session;
        appendVoiceDebugEvent('voice-store', 'setServerName', {
          serverId,
          serverName
        });
        return { ...session, serverName };
      });
    }
  };
}

export const voiceSession = createVoiceStore();
