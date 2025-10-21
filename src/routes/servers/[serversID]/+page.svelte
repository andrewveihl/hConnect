<script lang="ts">
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/user';

  import LeftPane from '$lib/components/LeftPane.svelte';
  import ServerSidebar from '$lib/components/ServerSidebar.svelte';
  import ChannelHeader from '$lib/components/ChannelHeader.svelte';
  import MembersPane from '$lib/components/MembersPane.svelte';
  import MessageList from '$lib/components/MessageList.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import NewServerModal from '$lib/components/NewServerModal.svelte';

  import { db } from '$lib/db';
  import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
  import { sendChannelMessage } from '$lib/db/messages';

  // ✅ Comes from +page.ts (guaranteed now)
  export let data: { serverId: string };
  const serverId = data.serverId;

  type Channel = { id: string; name?: string; type?: 'text' | 'voice'; position?: number };

  let channels: Channel[] = [];
  let activeChannel: Channel | null = null;
  let messages: any[] = [];
  let profiles: Record<string, any> = {};
  let showCreate = false;

  let channelsSub: () => void;
  let messagesSub: () => void;

  function selectChannelObject(id: string): Channel {
    const found = channels.find((c) => c.id === id);
    return found ?? { id, name: id, type: 'text' };
  }

  function pickChannel(id: string) {
    const database = db();
    activeChannel = selectChannelObject(id);

    messages = [];
    messagesSub && messagesSub();

    const q = query(
      collection(database, 'servers', serverId, 'channels', id, 'messages'),
      orderBy('createdAt', 'asc')
    );

    messagesSub = onSnapshot(q, (snap) => {
      messages = snap.docs.map((d) => {
        const raw: any = d.data();
        const uid = raw.uid ?? raw.authorId ?? 'unknown';
        const text = raw.text ?? raw.content ?? '';
        return { id: d.id, ...raw, uid, text };
      });

      const uids = Array.from(new Set(messages.map((m) => m.uid).filter(Boolean)));
      uids.forEach((uid) => {
        onSnapshot(doc(database, 'profiles', uid), (s) => {
          profiles[uid] = s.data();
        });
      });
    });
  }

  onMount(() => {
    const database = db();
    const q = query(collection(database, 'servers', serverId, 'channels'), orderBy('position'));

    channelsSub = onSnapshot(q, (snap) => {
      channels = snap.docs.map((d) => {
        const x: any = d.data();
        return { id: d.id, ...x, type: x.type ?? 'text' } as Channel;
      });

      if (!activeChannel && channels.length) {
        pickChannel(channels[0].id);
      } else if (activeChannel) {
        const updated = channels.find((c) => c.id === activeChannel!.id);
        if (updated) activeChannel = updated;
      }
    });

    return () => {
      channelsSub && channelsSub();
      messagesSub && messagesSub();
    };
  });

  async function handleSend(text: string) {
    if (!serverId) {
      console.error('[handleSend] missing serverId');
      alert('Missing server id (route load).');
      return;
    }

    if (!activeChannel?.id) {
      console.error('[handleSend] missing activeChannel.id');
      alert('Pick a channel first.');
      return;
    }

    if (!$user) {
      console.error('[handleSend] missing user');
      alert('Sign in to send messages.');
      return;
    }

    try {
      const id = await sendChannelMessage(serverId, activeChannel.id, $user.uid, text);
      console.debug('[handleSend] sent', { id, serverId, channelId: activeChannel.id });
    } catch (err) {
      console.error('[handleSend] failed', err);
      alert(`Failed to send message: ${err}`);
    }
  }
</script>

<div class="min-h-dvh grid" style="grid-template-columns: 72px 256px 1fr 288px; grid-template-rows: 48px 1fr auto;">
  <div class="row-span-3">
    <LeftPane {serverId} onCreateServer={() => (showCreate = true)} />
  </div>

  <div class="col-start-2 col-end-5">
    <ChannelHeader channel={activeChannel} />
  </div>

  <div class="col-start-2 row-start-2 row-end-4">
    <ServerSidebar
      serverId={serverId}
      activeChannelId={activeChannel?.id ?? null}
      onPickChannel={(id) => pickChannel(id)}
    />
  </div>

  <main class="bg-[#313338] col-start-3 row-start-2 row-end-3 overflow-hidden">
    <div class="h-full flex flex-col">
      <div class="flex-1 overflow-y-auto p-4">
        <MessageList {messages} users={profiles} />
      </div>

      <div class="border-t border-black/40 bg-[#2b2d31] p-3">
        <ChatInput
          placeholder={`Message #${activeChannel?.name ?? ''}`}
          onSend={handleSend}
        />
      </div>
    </div>
  </main>

  <div class="col-start-4 row-start-2 row-end-4">
    <MembersPane serverId={serverId} />
  </div>
</div>

<NewServerModal bind:open={showCreate} onClose={() => (showCreate = false)} />
