<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { user } from '$lib/stores/user';
  import { db } from '$lib/db';
  import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

  // NEW: minimal Firestore + invites helpers
  import { collection, onSnapshot, orderBy, query, type Unsubscribe } from 'firebase/firestore';
  import { acceptInvite, declineInvite } from '$lib/db/invites';

  import LeftPane from '$lib/components/LeftPane.svelte';
  import SignOutButton from '$lib/components/SignOutButton.svelte';

  let displayName = '';
  let photoURL = '';
  let loading = true;
  let loadedUid: string | null = null;

  // NEW: local state for invites
  type InviteRow = { id: string; path: string; data: any };
  let invites: InviteRow[] = [];
  let unsubInvites: Unsubscribe | undefined;

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

  // NEW: attach invites listener for current user
  function bindInvites(uid: string) {
    unsubInvites?.();
    const database = db();
    const qy = query(
      collection(database, 'users', uid, 'invites'),
      orderBy('createdAt', 'desc')
    );
    unsubInvites = onSnapshot(qy, (snap) => {
      invites = snap.docs.map((d) => ({
        id: d.id,
        path: `users/${uid}/invites/${d.id}`,
        data: d.data()
      }));
    });
  }

  // run once mounted, then react to $user changes
  onMount(async () => {
    loading = true;
    if ($user?.uid) {
      await loadProfile($user.uid);
      bindInvites($user.uid); // NEW
    }
    loading = false;
  });

  // If user was undefined at mount, load when it appears (first time only)
  $: if ($user?.uid && !loadedUid) {
    loading = true;
    loadProfile($user.uid)
      .then(() => bindInvites($user!.uid)) // NEW
      .finally(() => (loading = false));
  }

  onDestroy(() => {
    unsubInvites?.();
  });

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

  // NEW: simple handlers
  async function onAccept(inv: InviteRow) {
    if (!$user?.uid) return;
    await acceptInvite({ invitePath: inv.path, toUid: $user.uid });
  }
  async function onDecline(inv: InviteRow) {
    await declineInvite({ invitePath: inv.path });
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

        <!-- NEW: Invitations panel (non-invasive) -->
        <div class="mt-6 border-t border-white/10 pt-4 space-y-3">
          <h2 class="text-lg font-semibold">Invitations</h2>

          {#if invites.length === 0}
            <p class="text-white/60 text-sm">No invites right now.</p>
          {:else}
            <div class="space-y-3">
              {#each invites as r}
                <div class="rounded-lg bg-white/5 border border-white/10 p-3 flex items-center justify-between">
                  <div class="min-w-0">
                    <div class="text-sm">
                      {#if r.data.type === 'channel'}
                        <span class="font-medium">Channel:</span>
                        <span class="text-white/90">{r.data.channelName}</span>
                        <span class="text-white/60"> · </span>
                        <span class="font-medium">Server:</span>
                        <span class="text-white/90">{r.data.serverName}</span>
                      {:else}
                        <span class="text-white/90">Invite</span>
                      {/if}
                    </div>
                    <div class="text-xs text-white/60 mt-0.5">
                      From: {r.data.invitedBy} · Status: <span class="capitalize">{r.data.status}</span>
                    </div>
                  </div>

                  {#if r.data.status === 'pending'}
                    <div class="flex gap-2 shrink-0 pl-3">
                      <button class="btn btn-ghost" on:click={() => onDecline(r)}>Decline</button>
                      <button class="btn btn-primary" on:click={() => onAccept(r)}>Accept</button>
                    </div>
                  {:else}
                    <span class="text-xs text-white/60 capitalize pl-3 shrink-0">{r.data.status}</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
        <!-- /Invitations -->
      </div>
    {/if}
  </div>
</div>
