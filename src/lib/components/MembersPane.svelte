<script lang="ts">
  import { onDestroy } from 'svelte';
  import { db } from '$lib/db';
  import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';

  export let serverId: string;
  export let showHeader = true;

  let memberUids: string[] = [];
  let profiles: Record<string, any> = {};

  let membersUnsub: Unsubscribe | null = null;
  const profileUnsubs: Record<string, Unsubscribe> = {};
  let currentServer: string | null = null;

  const label = (uid: string) =>
    profiles[uid]?.displayName ?? profiles[uid]?.name ?? profiles[uid]?.email ?? uid;

  function getUidFromMemberDoc(d: any) {
    const data = (d?.data?.() ?? {}) as any;
    return data.uid ?? data.userId ?? data.memberUid ?? d.id;
  }

  function cleanupProfiles() {
    for (const key in profileUnsubs) {
      profileUnsubs[key]?.();
      delete profileUnsubs[key];
    }
    profiles = {};
    memberUids = [];
  }

  function subscribeMembers(server: string) {
    if (currentServer === server) return;
    currentServer = server;

    membersUnsub?.();
    cleanupProfiles();

    const database = db();
    membersUnsub = onSnapshot(collection(database, 'servers', server, 'members'), (snap) => {
      const uids = snap.docs.map(getUidFromMemberDoc);

      for (const uid in profileUnsubs) {
        if (!uids.includes(uid)) {
          profileUnsubs[uid]?.();
          delete profileUnsubs[uid];
          const { [uid]: _drop, ...rest } = profiles;
          profiles = rest;
        }
      }

      uids.forEach((uid) => {
        if (!profileUnsubs[uid]) {
          profileUnsubs[uid] = onSnapshot(doc(database, 'profiles', uid), (ps) => {
            profiles = { ...profiles, [uid]: ps.data() ?? {} };
            memberUids = [...uids].sort((a, b) =>
              label(a).localeCompare(label(b), undefined, { sensitivity: 'base' })
            );
          });
        }
      });

      memberUids = [...uids].sort((a, b) =>
        label(a).localeCompare(label(b), undefined, { sensitivity: 'base' })
      );
    });
  }

  $: if (serverId) {
    subscribeMembers(serverId);
  } else {
    membersUnsub?.();
    membersUnsub = null;
    cleanupProfiles();
    currentServer = null;
  }

  onDestroy(() => {
    membersUnsub?.();
    cleanupProfiles();
  });
</script>

<div class="flex flex-col h-full bg-[#1e1f24] text-white">
  {#if showHeader}
    <div class="px-3 py-3 border-b border-black/40 text-xs uppercase tracking-wide text-white/60">
      Members — {memberUids.length}
    </div>
  {/if}
  <div class="flex-1 overflow-y-auto p-3 space-y-2">
    {#if memberUids.length}
      {#each memberUids as uid}
        <div class="flex items-center gap-3 px-2 py-2 rounded hover:bg-white/10">
          <div class="w-9 h-9 rounded-full overflow-hidden bg-[#3f4248] grid place-items-center shrink-0">
            {#if profiles[uid]?.photoURL}
              <img src={profiles[uid].photoURL} alt="" class="w-full h-full object-cover" />
            {:else}
              <i class="bx bx-user text-white/70"></i>
            {/if}
          </div>
          <div class="text-sm truncate">{label(uid)}</div>
        </div>
      {/each}
    {:else}
      <div class="text-xs text-white/50 px-2">No members yet.</div>
    {/if}
  </div>
</div>
