<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '$lib/db';
  import { collection, doc, onSnapshot } from 'firebase/firestore';

  export let serverId: string;

  let memberIds: string[] = [];
  let profiles: Record<string, any> = {};
  let unsubMembers: () => void;
  const profileUnsubs: Record<string, () => void> = {};

  onMount(() => {
    const database = db();
    unsubMembers = onSnapshot(collection(database, 'servers', serverId, 'members'), (snap) => {
      const ids = snap.docs.map(d => d.id);

      for (const uid in profileUnsubs) if (!ids.includes(uid)) { profileUnsubs[uid](); delete profileUnsubs[uid]; delete profiles[uid]; }
      ids.forEach(uid => {
        if (!profileUnsubs[uid]) profileUnsubs[uid] = onSnapshot(doc(database, 'profiles', uid), (ps) => { profiles[uid] = ps.data(); });
      });

      memberIds = ids.sort((a,b) => (profiles[a]?.displayName ?? profiles[a]?.email ?? a).localeCompare(profiles[b]?.displayName ?? profiles[b]?.email ?? b));
    });
    return () => { unsubMembers && unsubMembers(); for (const k in profileUnsubs) profileUnsubs[k](); };
  });

  const label = (uid: string) => profiles[uid]?.displayName ?? profiles[uid]?.email ?? uid;
</script>

<!-- FULL HEIGHT -->
<aside class="h-dvh w-72 bg-[#2b2d31] border-l border-black/40 text-white flex flex-col">
  <div class="h-12 px-3 flex items-center border-b border-black/40 text-xs uppercase tracking-wide text-white/60">
    Members — {memberIds.length}
  </div>
  <div class="p-3 space-y-2 overflow-y-auto">
    {#each memberIds as uid}
      <div class="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/10">
        <div class="w-8 h-8 rounded-full overflow-hidden bg-[#3f4248] grid place-items-center">
          {#if profiles[uid]?.photoURL}
            <img src={profiles[uid].photoURL} alt="" class="w-full h-full object-cover" />
          {:else}
            <i class="bx bx-user text-white/70"></i>
          {/if}
        </div>
        <div class="text-sm truncate">{label(uid)}</div>
      </div>
    {/each}
    {#if !memberIds.length}
      <div class="text-xs text-white/50 px-2">No members yet.</div>
    {/if}
  </div>
</aside>
