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

  export let data: { serverId: string };
  const activeServerId = data.serverId;

  let activeChannel: any = null;
  let channelsSub: () => void;
  let messagesSub: () => void;

  let messages: any[] = [];
  let profiles: Record<string, any> = {};
  let showCreate = false;

  function pickChannel(id: string) {
    const database = db();
    messages = [];
    messagesSub && messagesSub();
    const q = query(collection(database, 'servers', data.serverId, 'channels', id, 'messages'), orderBy('createdAt', 'asc'));
    messagesSub = onSnapshot(q, (snap) => {
      messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      [...new Set(messages.map(m => m.authorId))].forEach(uid => {
        onSnapshot(doc(database, 'profiles', uid), s => { profiles[uid] = s.data(); });
      });
    });
  }

  onMount(() => {
    const database = db();
    const q = query(collection(database, 'servers', data.serverId, 'channels'), orderBy('position'));
    channelsSub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => d.data());
      if (!activeChannel && list.length) { activeChannel = list[0]; pickChannel(activeChannel.id); }
      else if (activeChannel) { activeChannel = list.find(c => c.id === activeChannel.id) ?? list[0]; }
    });
    return () => { channelsSub && channelsSub(); messagesSub && messagesSub(); };
  });

  async function handleSend(text: string) {
    if (!$user || !activeChannel) return;
    await sendChannelMessage(data.serverId, activeChannel.id, $user.uid, text);
  }
</script>

<!-- Discord widths: rail 72 | side 256 | chat flex | members 288 -->
<div class="min-h-dvh grid" style="grid-template-columns: 72px 256px 1fr 288px; grid-template-rows: 48px 1fr auto;">
  <!-- Left rail -->
  <div class="row-span-3"><LeftPane {activeServerId} onCreateServer={() => (showCreate = true)} /></div>

  <!-- Header -->
  <div class="col-start-2 col-end-5">
    <ChannelHeader channel={activeChannel} />
  </div>

  <!-- Sidebar -->
  <div class="col-start-2 row-start-2 row-end-4">
    <ServerSidebar serverId={data.serverId} activeChannelId={activeChannel?.id} onPickChannel={(id) => { activeChannel = { ...(activeChannel||{}), id }; pickChannel(id); }} />
  </div>

  <!-- Chat -->
  <main class="bg-[#313338] col-start-3 row-start-2 row-end-3 overflow-hidden">
    <div class="h-full flex flex-col">
      <div class="flex-1 overflow-y-auto p-4">
        <MessageList {messages} users={profiles} />
      </div>
      {#if activeChannel && activeChannel.type === 'text'}
        <ChatInput placeholder={`Message #${activeChannel.name ?? ''}`} onSend={handleSend} />
      {/if}
    </div>
  </main>

  <!-- Members -->
  <div class="col-start-4 row-start-2 row-end-4">
    <MembersPane serverId={data.serverId} />
  </div>
</div>

<NewServerModal bind:open={showCreate} onClose={() => (showCreate = false)} />
