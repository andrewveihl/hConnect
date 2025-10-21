<script lang="ts">
  import { onDestroy } from 'svelte';
  import { user } from '$lib/stores/user';
  import { subscribeUserServers } from '$lib/db/servers';

  export let activeServerId: string | null = null;
  export let onCreateServer: (() => void) | null = null;

  let servers: { id: string; name: string; icon?: string | null }[] = [];
  let unsub: (() => void) | undefined;

  // Subscribe to the current user's servers; cleanly re-subscribe if $user changes.
  $: if ($user) {
    unsub?.();
    unsub = subscribeUserServers($user.uid, (rows) => {
      servers = rows;
    });
  }
  onDestroy(() => unsub?.());

  const handleCreateClick = () => {
    if (onCreateServer) onCreateServer();
  };
</script>

<aside class="h-dvh w-[72px] bg-[#1e1f22] border-r border-black/40 text-white select-none flex flex-col items-center">
  <div class="h-3 shrink-0"></div>

  <!-- Home / DMs -->
  <a
    href="/dms"
    class="my-1 rounded-3xl w-12 h-12 bg-[#313338] hover:rounded-xl hover:bg-[#5865f2] transition-all grid place-items-center focus:outline-none focus:ring-2 focus:ring-[#5865f2]/60"
    aria-label="Home / DMs"
    role="button"
  >
    <i class="bx bx-message-dots text-xl leading-none"></i>
  </a>

  <div class="h-px w-8 bg-white/10 my-2"></div>

  <!-- Servers -->
  <div class="flex-1 w-full overflow-y-auto">
    <div class="flex flex-col items-center">
      {#each servers as s (s.id)}
        <a
          href={`/servers/${s.id}`}
          class={`my-1 rounded-3xl w-12 h-12 transition-all grid place-items-center hover:rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5865f2]/60
            ${activeServerId === s.id
              ? '!bg-[#5865f2] hover:!bg-[#5865f2]'
              : 'bg-[#313338] hover:bg-[#5865f2]'}`}
          aria-label={s.name}
          role="button"
        >
          {#if s.icon}
            <img src={s.icon} alt={s.name} class="w-12 h-12 rounded-3xl pointer-events-none" />
          {:else}
            <span class="text-sm font-semibold select-none">{s.name.slice(0, 2).toUpperCase()}</span>
          {/if}
        </a>
      {/each}

      <!-- Create (opens local modal if provided by parent) -->
      <button
        class="my-1 rounded-3xl w-12 h-12 bg-[#313338] hover:rounded-xl hover:bg-emerald-600 transition-all grid place-items-center focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
        on:click={handleCreateClick}
        aria-label="Create server"
      >
        <i class="bx bx-plus text-2xl leading-none"></i>
      </button>
    </div>
  </div>

  <!-- Bottom: Profile (avatar) + small Settings gear (Discord-like) -->
  <div class="w-full grid place-items-center gap-2 p-2">
    <!-- Profile avatar (kept exactly as an actionable circle) -->
    <a
      href="/settings"
      class="rounded-2xl w-12 h-12 bg-[#313338] grid place-items-center overflow-hidden focus:outline-none focus:ring-2 focus:ring-white/30"
      title="Profile"
      aria-label="Profile"
      role="button"
    >
      {#if $user?.photoURL}
        <img src={$user.photoURL} alt="Me" class="w-full h-full object-cover" />
      {:else}
        <i class="bx bx-user text-xl leading-none"></i>
      {/if}
    </a>

    <!-- Small gear for Settings -->
    <a
      href="/settings"
      class="rounded-xl w-8 h-8 bg-[#313338] hover:bg-[#3a3c43] transition grid place-items-center focus:outline-none focus:ring-2 focus:ring-white/30"
      title="Settings"
      aria-label="Settings"
      role="button"
    >
      <!-- Actual small gear icon -->
      <i class="bx bx-cog text-[16px] leading-none align-middle"></i>
      <!-- If you prefer filled style: <i class="bx bxs-cog text-[16px] leading-none align-middle"></i> -->
    </a>
  </div>
</aside>
