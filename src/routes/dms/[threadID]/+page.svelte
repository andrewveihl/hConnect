<script lang="ts">
  export const ssr = false

  import { user } from '$lib/stores/user'
  import { db } from '$lib/db'
  import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore'
  import { openDmThread } from '$lib/db/dms'
  import { goto } from '$app/navigation'
  import LeftPane from '$lib/components/LeftPane.svelte'

  let email = ''
  let threads: any[] = []
  $: me = $user

  function watchThreads(uid?: string) {
    if (!uid) return

    const database = db()

    const q1 = query(
      collection(database, 'dms'),
      where('participants', 'array-contains', uid),
      orderBy('lastMessageAt', 'desc')
    )

    const q2 = query(
      collection(database, 'dms'),
      where('participants', 'array-contains', uid)
    )

    let fallbackStop: (() => void) | undefined

    const stopPrimary = onSnapshot(
      q1,
      snap => {
        threads = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      },
      _err => {
        fallbackStop = onSnapshot(q2, snap2 => {
          threads = snap2.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort(
              (a, b) =>
                (b.lastMessageAt?.seconds ?? 0) - (a.lastMessageAt?.seconds ?? 0)
            )
        })
      }
    )

    return () => {
      stopPrimary()
      fallbackStop?.()
    }
  }

  $effect(() => {
    const stop = watchThreads(me?.uid)
    return () => stop?.()
  })

  async function addByEmail() {
    // ...your existing code...
  }
</script>
