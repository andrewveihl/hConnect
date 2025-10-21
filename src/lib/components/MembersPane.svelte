<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '$lib/db';
  import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';

  export let serverId: string;

  let memberUids: string[] = [];
  let profiles: Record<string, any> = {};
  let unsubMembers: Unsubscribe | undefined;
  const profileUnsubs: Record<string, Unsubscribe> = {};

  // Prefer displayName -> name -> email -> uid
  const label = (uid: string) =>
    profiles[uid]?.displayName ?? profiles[uid]?.name ?? profiles[uid]?.email ?? uid;

  // Extract the real UID from a member doc
  function getUidFromMemberDoc(d: any) {
    const data = (d?.data?.() ?? {}) as any;
    return data.uid ?? data.userId ?? data.memberUid ?? d.id;
  }

  onMount(() => {
    if (!serverId) return;

    const database = db();

    unsubMembers = onSnapshot(collection(database, 'servers', serverId, 'members'), (snap) => {
      const uids = snap.docs.map(getUidFromMemberDoc);

      // Unsubscribe profiles no longer present (and reassign profiles to trigger reactivity)
      for (const uid in profileUnsubs) {
        if (!uids.includes(uid)) {
          profileUnsubs[uid]?.();
          delete profileUnsubs[uid];
          const { [uid]: _drop, ...rest } = profiles;
          profiles = rest;
        }
      }

      // Ensure a single profile listener per UID
      uids.forEach((uid) => {
        if (!profileUnsubs[uid]) {
          profileUnsubs[uid] = onSnapshot(doc(database, 'profiles', uid), (ps) => {
            const data = ps.data() ?? {};
            profiles = { ...profiles, [uid]: data }; // reassign -> DOM updates

            // Resort when names arrive
            memberUids = [...memberUids].sort((a, b) =>
              label(a).localeCompare(label(b), undefined, { sensitivity: 'base' })
            );
          });
        }
      });

      // Initial list + sort with current knowledge
      memberUids = uids.sort((a, b) =>
        label(a).localeCompare(label(b), undefined, { sensitivity: 'base' })
      );
    });

    return () => {
      unsubMembers && unsubMembers();
      for (const k in profileUnsubs) profileUnsubs[k]();
    };
  });
</script>

<!-- FULL HEIGHT -->
<aside class="h-dvh w-72 bg-[#2b2d31] border-l border-black/40 text-white flex flex-col">
  <div class="h-12 px-3 flex items-center border-b border-black/40 text-xs uppercase tracking-wide text-white/60">
    Members — {memberUids.length}
  </div>
  <div class="p-3 space-y-2 overflow-y-auto">
    {#each memberUids as uid}
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
    {#if !memberUids.length}
      <div class="text-xs text-white/50 px-2">No members yet.</div>
    {/if}
  </div>
</aside>
