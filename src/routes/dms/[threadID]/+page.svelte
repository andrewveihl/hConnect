<script lang="ts">
  import { user } from '$lib/stores/user';
  import { db } from '$lib/db';
  import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
  import { openDmThread } from '$lib/db/dms';
  import { goto } from '$app/navigation';
  import LeftPane from '$lib/components/LeftPane.svelte';

  let email = '';
  let threads: any[] = [];
  $: me = $user;

  function watchThreads() {
    if (!me) return;
    const database = db();

    // preferred (needs index)
    const q1 = query(
      collection(database, 'dms'),
      where('participants', 'array-contains', me.uid),
      orderBy('lastMessageAt', 'desc')
    );

    // fallback (no orderBy — no index needed)
    const q2 = query(
      collection(database, 'dms'),
      where('participants', 'array-contains', me.uid)
    );

    // try preferred; on index error, switch to fallback
    const stop = onSnapshot(
      q1,
      (snap) => { threads = snap.docs.map(d => ({ id: d.id, ...d.data() })); },
      (_err) => {
        // index not ready -> use fallback
        onSnapshot(q2, (snap2) => {
          // no guaranteed order; sort client-side by lastMessageAt desc
          threads = snap2.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a,b) => (b.lastMessageAt?.seconds ?? 0) - (a.lastMessageAt?.seconds ?? 0));
        });
      }
    );

    return stop;
  }

  $: {
    // re-watch when user changes
    const stop = watchThreads();
    return () => stop && stop();
  }

  async function addByEmail() {
    // ...your existing code...
  }
</script>
