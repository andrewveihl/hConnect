<script lang="ts">
  import { user } from '$lib/stores/user';
  import { db } from '$lib/db';
  import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
  import LeftPane from '$lib/components/LeftPane.svelte';
  import { signOutUser } from '$lib/firebase';  // ✅ NEW

  let displayName = '';
  let photoURL = '';

  $: if ($user) load();

  async function load() {
    const database = db();
    const ref = doc(database, 'profiles', $user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        displayName: $user.displayName ?? 'New User',
        email: $user.email, photoURL: $user.photoURL ?? null,
        createdAt: serverTimestamp(), lastActiveAt: serverTimestamp()
      });
    }
    const data = (await getDoc(ref)).data()!;
    displayName = data.displayName ?? '';
    photoURL = data.photoURL ?? '';
  }

  async function save() {
    const database = db();
    await updateDoc(doc(database, 'profiles', $user.uid), { displayName, photoURL });
    alert('Saved.');
  }
</script>

<div class="grid grid-cols-[72px_1fr] min-h-dvh text-white">
  <LeftPane activeServerId={null} />
  <div class="bg-[#313338] p-6">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-semibold">User Settings</h1>
      <!-- ✅ NEW -->
      <button class="btn btn-ghost" on:click={signOutUser}>
        <i class="bx bx-log-out mr-1"></i> Sign out
      </button>
    </div>

    <div class="surface p-4 max-w-xl space-y-3">
      <label class="block">
        <div class="mb-1 text-sm text-white/70">Display name</div>
        <input class="input" bind:value={displayName} />
      </label>
      <label class="block">
        <div class="mb-1 text-sm text-white/70">Avatar URL</div>
        <input class="input" bind:value={photoURL} />
      </label>
      <button class="btn btn-primary" on:click={save}>Save</button>
    </div>
  </div>
</div>
