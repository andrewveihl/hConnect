<script lang="ts">
  import { onDestroy } from 'svelte';
  import { page } from '$app/stores';
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

  // Comes from +page.ts
  export let data: { serverId: string | null };

  // 🔑 Normalize once and use this everywhere below
  $: serverId =
    data?.serverId ??
    $page.params.serverID ??   // if your folder is [serverID]
    $page.params.serverId ??   // if your folder is [serverId]
    null;

  type Channel = { id: string; name?: string; type?: 'text' | 'voice'; position?: number };

  let channels: Channel[] = [];
  let activeChannel: Channel | null = null;
  let messages: any[] = [];
  let profiles: Record<string, any> = {};
  let showCreate = false;

  // Live listeners
  let channelsUnsub: (() => void) | null = null;
  let messagesUnsub: (() => void) | null = null;

  function clearChannelsUnsub() {
    if (channelsUnsub) { channelsUnsub(); channelsUnsub = null; }
  }
  function clearMessagesUnsub() {
    if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }
  }

  function selectChannelObject(id: string): Channel {
    const found = channels.find((c) => c.id === id);
    return found ?? { id, name: id, type: 'text' };
  }

  function subscribeMessages(currServerId: string, channelId: string) {
    const database = db();
    const q = query(
      collection(database, 'servers', currServerId, 'channels', channelId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    clearMessagesUnsub();
    messagesUnsub = onSnapshot(q, (snap) => {
      messages = snap.docs.map((d) => {
        const raw: any = d.data();
        const uid = raw.uid ?? raw.authorId ?? 'unknown';
        const text = raw.text ?? raw.content ?? '';
        return { id: d.id, ...raw, uid, text };
      });

      // Load lightweight profiles used by MessageList
      const database = db();
      const uids = Array.from(new Set(messages.map((m) => m.uid).filter(Boolean)));
      uids.forEach((uid) => {
        onSnapshot(doc(database, 'profiles', uid), (s) => {
          profiles[uid] = s.data();
        });
      });
    });
  }

  function pickChannel(id: string) {
    if (!serverId) return;
    activeChannel = selectChannelObject(id);
    messages = [];
    subscribeMessages(serverId, id);
  }

  // 🔁 Re-subscribe to channels whenever the server changes
  $: if (serverId) {
    const database = db();
    const q = query(collection(database, 'servers', serverId, 'channels'), orderBy('position'));

    clearChannelsUnsub();
    channelsUnsub = onSnapshot(q, (snap) => {
      channels = snap.docs.map((d) => {
        const x: any = d.data();
        return { id: d.id, ...x, type: x.type ?? 'text' } as Channel;
      });

      // Keep/repair active channel selection
      if (!activeChannel && channels.length) {
        pickChannel(channels[0].id);
      } else if (activeChannel) {
        const updated = channels.find((c) => c.id === activeChannel!.id);
        if (updated) {
          activeChannel = updated;
        } else if (channels.length) {
          // Previously active channel was removed — fall back to first
          pickChannel(channels[0].id);
        } else {
          // No channels
          activeChannel = null;
          clearMessagesUnsub();
          messages = [];
        }
      }
    });
  } else {
    // No server selected — clean slate
    clearChannelsUnsub();
    clearMessagesUnsub();
    channels = [];
    activeChannel = null;
    messages = [];
    profiles = {};
  }

  onDestroy(() => {
    clearChannelsUnsub();
    clearMessagesUnsub();
  });

  async function handleSend(text: string) {
    if (!serverId) {
      console.error('[handleSend] missing serverId');
      alert('Missing server id.');
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

<div class="h-dvh overflow-hidden grid" style="grid-template-columns: 72px 256px 1fr 288px; grid-template-rows: 48px 1fr auto;">
  <div class="row-span-3">
    <!-- LeftPane expects the active server id -->
    <LeftPane activeServerId={serverId} onCreateServer={() => (showCreate = true)} />
  </div>

  <div class="col-start-2 col-end-5">
    <ChannelHeader channel={activeChannel} />
  </div>

  <div class="col-start-2 row-start-2 row-end-4">
    {#if serverId}
      <ServerSidebar
        serverId={serverId}
        activeChannelId={activeChannel?.id ?? null}
        onPickChannel={(id) => pickChannel(id)}
      />
    {:else}
      <div class="p-4 text-white/70">Select a server from the left to view channels.</div>
    {/if}
  </div>

  <main class="bg-[#313338] col-start-3 row-start-2 row-end-3 overflow-hidden">
    {#if serverId && activeChannel}
      <div class="h-full flex flex-col">
        <div class="flex-1 overflow-hidden p-4">
          <MessageList {messages} users={profiles} />
        </div>

        <div class="shrink-0 border-t border-black/40 bg-[#2b2d31] p-3">
          <ChatInput
            placeholder={`Message #${activeChannel?.name ?? ''}`}
            onSend={handleSend}
          />
        </div>
      </div>
    {:else}
      <div class="h-full grid place-items-center text-white/60">
        {#if !serverId}
          <div>Pick a server to start chatting.</div>
        {:else}
          <div>Pick a channel to start chatting.</div>
        {/if}
      </div>
    {/if}
  </main>

  <div class="col-start-4 row-start-2 row-end-4">
    {#if serverId}
      <MembersPane {serverId} />
    {:else}
      <div class="p-4 text-white/70">No server selected.</div>
    {/if}
  </div>
</div>

<NewServerModal bind:open={showCreate} onClose={() => (showCreate = false)} />
