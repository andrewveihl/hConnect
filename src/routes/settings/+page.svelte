<script lang="ts">
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/user';
  import { db } from '$lib/db';
  import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

  import LeftPane from '$lib/components/LeftPane.svelte';
  import SignOutButton from '$lib/components/SignOutButton.svelte';
  import InvitePanel from '$lib/components/InvitePanel.svelte';

  export let serverId: string | null = null;

  let displayName = '';
  let photoURL = '';
  let loading = true;
  let loadedUid: string | null = null;

  async function loadProfile(uid: string) {
    const database = db();
    const ref = doc(database, 'profiles', uid);

    // bootstrap if missing
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        displayName: $user?.displayName ?? 'New User',
        email: $user?.email ?? null,
        photoURL: $user?.photoURL ?? null,
        createdAt: serverTimestamp(),
        lastActiveAt: serverTimestamp()
      });
    }

    const data = (await getDoc(ref)).data()!;
    displayName = data.displayName ?? '';
    photoURL = data.photoURL ?? '';
    loadedUid = uid;
  }

  // run once mounted, then react to $user changes
  onMount(async () => {
    loading = true;
    if ($user?.uid) {
      await loadProfile($user.uid);
    }
    loading = false;
  });

  // If user was undefined at mount, load when it appears (first time only)
  $: if ($user?.uid && !loadedUid) {
    loading = true;
    loadProfile($user.uid)
      .finally(() => (loading = false));
  }

  async function save() {
    if (!$user?.uid) return;
    const database = db();
    await updateDoc(doc(database, 'profiles', $user.uid), {
      displayName,
      photoURL,
      lastActiveAt: serverTimestamp()
    });
    alert('Saved.');
  }

  function useGooglePhoto() {
    if ($user?.photoURL) photoURL = $user.photoURL;
  }
</script>

<div class="grid grid-cols-[72px_1fr] min-h-dvh text-white">
  <!-- Left rail -->
  <LeftPane activeServerId={null} />

  <!-- Main -->
  <div class="bg-[#313338] p-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-semibold">User Settings</h1>
      <div class="flex items-center gap-2">
        <SignOutButton />
      </div>
    </div>

    {#if loading}
      <div class="surface p-4 max-w-xl space-y-3 text-white/70">Loading…</div>
    {:else}
      <!-- Body -->
      <div class="surface p-4 max-w-xl space-y-4">
        <div class="flex items-center gap-4">
          <img
            src={photoURL || ''}
            alt="Avatar preview"
            class="h-14 w-14 rounded-full bg-white/10 object-cover"
            on:error={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
          <button class="btn btn-ghost" on:click={useGooglePhoto} disabled={!$user?.photoURL}>
            Use Google photo
          </button>
        </div>

        <label class="block">
          <div class="mb-1 text-sm text-white/70">Display name</div>
          <input class="input w-full" bind:value={displayName} />
        </label>

        <label class="block">
          <div class="mb-1 text-sm text-white/70">Avatar URL</div>
          <input class="input w-full" bind:value={photoURL} placeholder="https://…" />
        </label>

        <button class="btn btn-primary" on:click={save}>Save</button>
      </div>
    {/if}
    <InvitePanel {serverId} />
  </div>
</div>
