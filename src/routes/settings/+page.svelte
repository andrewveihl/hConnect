<script lang="ts">
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/user';
  import { db } from '$lib/db';
  import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
  import { enablePushForUser, requestNotificationPermission } from '$lib/notify/push';

  import LeftPane from '$lib/components/LeftPane.svelte';
  import SignOutButton from '$lib/components/SignOutButton.svelte';
  import InvitePanel from '$lib/components/InvitePanel.svelte';

  export let serverId: string | null = null;

  let displayName = '';
  let photoURL = '';
  let loading = true;
  let loadedUid: string | null = null;

  // Notification prefs
  type NotifPrefs = {
    desktopEnabled: boolean;
    pushEnabled: boolean;
    dms: boolean;
    mentions: boolean;
    allMessages: boolean;
  };
  let notif: NotifPrefs = {
    desktopEnabled: false,
    pushEnabled: false,
    dms: true,
    mentions: true,
    allMessages: false
  };

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

    const settings = (data.settings ?? {}) as any;
    const prefs = (settings.notificationPrefs ?? {}) as any;
    notif = {
      desktopEnabled: !!prefs.desktopEnabled,
      pushEnabled: !!prefs.pushEnabled,
      dms: prefs.dms ?? true,
      mentions: prefs.mentions ?? true,
      allMessages: !!prefs.allMessages
    };
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
      lastActiveAt: serverTimestamp(),
      'settings.notificationPrefs': notif
    });
    alert('Saved.');
  }

  function useGooglePhoto() {
    if ($user?.photoURL) photoURL = $user.photoURL;
  }

  async function enableDesktopNotifications() {
    const granted = await requestNotificationPermission();
    if (!granted) {
      alert('Notifications are blocked by the browser. Enable them in site settings.');
      return;
    }
    notif.desktopEnabled = true;
  }

  async function enablePush() {
    if (!$user?.uid) return;
    const token = await enablePushForUser($user.uid);
    if (!token) {
      alert('Could not enable push on this device.');
      return;
    }
    notif.pushEnabled = true;
    await save();
    alert('Push notifications enabled on this device.');
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
      
      <!-- Notifications -->
      <div class="surface p-4 max-w-xl mt-6 space-y-3">
        <h2 class="text-lg font-semibold">Notifications</h2>
        <div class="text-white/70 text-sm">Configure how and when you are notified.</div>

        <div class="flex items-center justify-between py-2">
          <div>
            <div class="font-medium">Desktop notifications</div>
            <div class="text-xs text-white/60">Show native notifications when new messages arrive.</div>
          </div>
          <div class="flex items-center gap-2">
            <label class="inline-flex items-center gap-2 select-none">
              <input type="checkbox" bind:checked={notif.desktopEnabled} />
              <span>Enabled</span>
            </label>
            <button class="btn btn-ghost" on:click={enableDesktopNotifications}>Grant permission</button>
          </div>
        </div>

        <div class="flex items-center justify-between py-2">
          <div>
            <div class="font-medium">Push notifications</div>
            <div class="text-xs text-white/60">Deliver notifications when the app is closed (requires enabling per device).</div>
          </div>
          <div class="flex items-center gap-2">
            <label class="inline-flex items-center gap-2 select-none">
              <input type="checkbox" bind:checked={notif.pushEnabled} />
              <span>Enabled</span>
            </label>
            <button class="btn btn-ghost" on:click={enablePush}>Enable on this device</button>
          </div>
        </div>

        <div class="h-px w-full bg-white/10 my-1"></div>

        <label class="flex items-center justify-between py-1 select-none">
          <span>Direct messages</span>
          <input type="checkbox" bind:checked={notif.dms} />
        </label>
        <label class="flex items-center justify-between py-1 select-none">
          <span>@ Mentions</span>
          <input type="checkbox" bind:checked={notif.mentions} />
        </label>
        <label class="flex items-center justify-between py-1 select-none">
          <span>All messages (noise heavy)</span>
          <input type="checkbox" bind:checked={notif.allMessages} />
        </label>

        <div class="text-xs text-white/60">
          Tip: Per-server and per-channel mutes can be added next. Tell us which scopes you want first.
        </div>
        
        <div class="pt-2">
          <button class="btn btn-primary" on:click={save}>Save notification settings</button>
        </div>
      </div>
    {/if}
    <InvitePanel {serverId} />
  </div>
</div>
