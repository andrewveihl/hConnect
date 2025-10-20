<script lang="ts">
  import { user } from '$lib/stores/user';
  import { getFirebase } from '$lib/firebase';
  import { signOut } from 'firebase/auth';

  import LeftPane from '$lib/components/LeftPane.svelte';
  import ServerSidebar from '$lib/components/ServerSidebar.svelte';
  import ChannelHeader from '$lib/components/ChannelHeader.svelte';
  import MembersPane from '$lib/components/MembersPane.svelte';
  import MessageList from '$lib/components/MessageList.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';

  import { subscribeMemberServers, createServer, createChannel, inviteByEmail } from '$lib/data/servers';
  import { sendChannelMessage, subscribeChannelMessages } from '$lib/data/chat';
  import { ensureDmThread, sendDm, subscribeDmMessages, ensureProfile } from '$lib/data/dms';
  import { collection, onSnapshot, query, orderBy, type Unsubscribe } from 'firebase/firestore';
  import { getDb } from '$lib/firebase';

  const { auth } = getFirebase();

  let servers: { id:string; name:string; emoji?:string|null }[] = [];
  let activeServerId: string | null = null;
  let activeChannelId: string | null = 'general';
  let serverChannels: { id: string; name: string }[] = [];
  let messages: { id: string; authorUid: string; text: string; createdAt?: any }[] = [];

  let inDM = false;
  let people: { uid: string; name: string|null; email: string|null }[] = [];
  let dmThreadId: string | null = null;
  let dmMessages: any[] = [];

  let showMembers = true;

  let unsubServers: Unsubscribe | null = null;
  let unsubChannels: Unsubscribe | null = null;
  let unsubMsgs: Unsubscribe | null = null;
  let unsubDmMsgs: Unsubscribe | null = null;
  let unsubPeople: Unsubscribe | null = null;

  $: if ($user) {
    ensureProfile($user.uid, { name: $user.displayName, photoURL: $user.photoURL, email: $user.email });
    unsubServers?.(); unsubServers = subscribeMemberServers($user.uid, (rows) => { servers = rows; });
    const db = getDb();
    unsubPeople?.();
    unsubPeople = onSnapshot(query(collection(db, 'profiles'), orderBy('name')), (snap) => {
      people = snap.docs.filter(d => d.id !== $user?.uid).map(d => ({ uid: d.id, ...(d.data() as any) }));
    });
  }

  function pickServer(id: string) {
    inDM = false; activeServerId = id; activeChannelId = 'general';
    const db = getDb();
    unsubChannels?.();
    unsubChannels = onSnapshot(collection(db, 'servers', id, 'channels'), (snap) => {
      serverChannels = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    });
    subChannelMsgs();
  }
  function subChannelMsgs() {
    unsubMsgs?.();
    if (activeServerId && activeChannelId) {
      unsubMsgs = subscribeChannelMessages(activeServerId, activeChannelId, (rows) => messages = rows);
    }
  }
  async function onSendChannel(text: string) {
    if (!$user || !activeServerId || !activeChannelId) return;
    await sendChannelMessage(activeServerId, activeChannelId, $user.uid, text);
  }
  async function newServer() {
    if (!$user) return;
    const id = await createServer($user.uid, { name: `Server ${Math.floor(Math.random()*999)}`, emoji: '💬' });
    pickServer(id);
  }
  async function newChannel() {
    if (!$user || !activeServerId) return;
    const name = prompt('Channel name?'); if (!name) return;
    const id = await createChannel(activeServerId, $user.uid, name);
    activeChannelId = id; subChannelMsgs();
  }
  async function invite() {
    if (!$user || !activeServerId) return;
    const email = prompt('Invite email?'); if (!email) return;
    await inviteByEmail(activeServerId, $user.uid, email.toLowerCase());
    alert('Invite recorded (email send TBD).');
  }
  function openDMs() {
    inDM = true; activeServerId = null; activeChannelId = null; messages = []; serverChannels = [];
  }
  async function startDM(otherUid: string) {
    if (!$user) return;
    inDM = true; dmThreadId = await ensureDmThread($user.uid, otherUid);
    unsubDmMsgs?.(); unsubDmMsgs = subscribeDmMessages(dmThreadId, (rows) => dmMessages = rows);
  }
  async function onSendDM(text: string) {
    if (!$user || !dmThreadId) return;
    await sendDm(dmThreadId, $user.uid, text);
  }
</script>

{#if !$user}
  <div class="min-h-dvh grid place-items-center">
    <div class="text-center">
      <h1 class="text-2xl font-semibold mb-2">You are not signed in.</h1>
      <a href="/sign-in" class="inline-block rounded-xl bg-white text-slate-900 px-4 py-2">Go to sign in</a>
    </div>
  </div>
{:else}
  <!-- Discord-like: rail (72) | channels (280) | chat (1fr) | members (260) -->
  <div class="h-dvh grid"
       style="grid-template-columns: 72px 280px 1fr {showMembers && !inDM ? '260px' : '0px'};">
    <!-- Server rail -->
    <div class="h-full bg-[#0b0f1a] border-r border-white/10">
      <LeftPane {servers} activeId={activeServerId} onCreateServer={newServer} onPickServer={pickServer} onOpenDMs={openDMs} />
    </div>

    <!-- Channels / DM list -->
    <aside class="h-full bg-[#0f1422] border-r border-white/10 flex flex-col min-w-0">
      {#if inDM}
        <div class="h-12 shrink-0 px-4 border-b border-white/10 flex items-center">
          <div class="font-semibold">Direct Messages</div>
        </div>
        <div class="flex-1 overflow-y-auto p-2">
          <div class="text-xs uppercase text-white/50 px-2 mb-1">People</div>
          {#each people as p}
            <button class="w-full text-left rounded-lg px-3 py-2 hover:bg-white/10" on:click={() => startDM(p.uid)}>
              {p.name || p.email || p.uid}
            </button>
          {/each}
          {#if !people.length}
            <div class="text-white/50 text-sm px-3 py-2">No other users yet.</div>
          {/if}
        </div>
      {:else if activeServerId}
        <ServerSidebar
          serverName={servers.find(s => s.id === activeServerId)?.name || 'Server'}
          channels={serverChannels}
          activeChannelId={activeChannelId}
          onPickChannel={(id) => { activeChannelId = id; subChannelMsgs(); }}
          onNewChannel={newChannel}
          onInvite={invite}
          onAdmin={() => alert('Promote/demote via Members UI (TODO).')}
        />
      {:else}
        <div class="h-12 px-4 border-b border-white/10 flex items-center">
          <div class="font-semibold">Home</div>
        </div>
        <div class="p-4 text-white/70 text-sm">Pick a server or create one.</div>
      {/if}
    </aside>

    <!-- Chat column -->
    <section class="h-full flex flex-col bg-[#0b0f1a] min-w-0">
      <ChannelHeader
        title={inDM ? (dmThreadId ? `DM: ${dmThreadId}` : 'Direct Messages') : (activeChannelId ? `#${activeChannelId}` : 'Welcome')}
        showMembersToggle={!inDM}
        bind:showMembers
      >
        <div class="hidden md:flex items-center gap-2 text-sm text-white/70">
          <span>{$user.email}</span>
          <button class="rounded-md bg-white/10 px-2 py-1 hover:bg-white/15" on:click={() => signOut(auth)}>Sign out</button>
        </div>
      </ChannelHeader>

      {#if inDM}
        <MessageList items={dmMessages} />
        <ChatInput placeholder="Message user…" onSend={onSendDM} />
      {:else if activeServerId}
        <MessageList items={messages} />
        <ChatInput placeholder={`Message #${activeChannelId}`} onSend={onSendChannel} />
      {:else}
        <div class="flex-1 grid place-items-center text-white/70">
          <div>Create or pick a server to start chatting.</div>
        </div>
      {/if}
    </section>

    <!-- Members (toggle) -->
    {#if showMembers && !inDM}
      <MembersPane />
    {/if}
  </div>
{/if}
