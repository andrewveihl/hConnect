<script lang="ts">
  import { user } from '$lib/stores/user';
  import { db } from '$lib/db';
  import { collection, onSnapshot, orderBy, query, where, getDocs } from 'firebase/firestore';
  import { openDmThread } from '$lib/db/dms';
  import { goto } from '$app/navigation';
  import LeftPane from '$lib/components/LeftPane.svelte';

  let email = '';
  let threads: any[] = [];
  $: me = $user;

  $: if (me) {
    const database = db();
    const q = query(collection(database, 'dms'), where('participants', 'array-contains', me.uid), orderBy('lastMessageAt', 'desc'));
    onSnapshot(q, (snap) => { threads = snap.docs.map(d => ({ id: d.id, ...d.data() })); });
  }

  async function addByEmail() {
    if (!me || !email.trim()) return;
    const database = db();
    const q = query(collection(database, 'profiles'), where('email', '==', email.trim()));
    const r = await getDocs(q);
    if (r.empty) { alert('No user with that email'); return; }
    const otherId = r.docs[0].id;
    const id = await openDmThread(me.uid, otherId);
    goto(`/dms/${id}`);
  }
</script>

<!-- Rail + content, full height -->
<div class="grid h-dvh" style="grid-template-columns:72px 1fr;">
  <div class=""><LeftPane activeServerId={null} /></div>

  <div class="bg-[#313338] text-white flex flex-col">
    <header class="h-12 bg-[#313338] border-b border-black/40 px-4 flex items-center">
      <div class="text-base font-semibold">Friends / Direct Messages</div>
      <div class="ml-auto flex gap-2">
        <input class="input h-9 w-72" placeholder="Add friend by email" bind:value={email} />
        <button class="btn btn-primary h-9" on:click={addByEmail}><i class="bx bx-user-plus mr-1"></i>Add</button>
      </div>
    </header>

    <div class="p-4">
      <div class="surface p-4">
        <div class="text-sm font-semibold mb-2">Your conversations</div>
        <div class="grid gap-2">
          {#each threads as t}
            <a class="px-3 py-2 rounded hover:bg-white/10" href={`/dms/${t.id}`}>{t.id}</a>
          {/each}
          {#if !threads.length}
            <div class="text-white/60 text-sm">No DMs yet.</div>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>
