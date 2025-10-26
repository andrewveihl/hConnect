<script lang="ts">
  import { onDestroy } from 'svelte';
  import { user } from '$lib/stores/user';
  import { subscribeUserServers } from '$lib/db/servers';
  import NewServerModal from '$lib/components/NewServerModal.svelte';
  import VoiceRailItem from '$lib/components/VoiceRailItem.svelte';

  export let activeServerId: string | null = null;
  export let onCreateServer: (() => void) | null = null;

  let servers: { id: string; name: string; icon?: string | null }[] = [];
  let unsub: (() => void) | undefined;
  let localCreateOpen = false;

  $: if ($user) {
    unsub?.();
    unsub = subscribeUserServers($user.uid, (rows) => { servers = rows ?? []; });
  }
  onDestroy(() => unsub?.());

  const handleCreateClick = () => {
    if (onCreateServer) onCreateServer();
    else localCreateOpen = true;
  };
</script>

<!-- Always-visible 72px rail. Sticky + z-index so it never falls behind content -->
<aside
  class="h-dvh w-[72px] sticky top-0 left-0 z-30 bg-[#1e1f22] border-r border-black/40 text-white
         select-none flex flex-col items-center"
  style="padding-bottom: calc(env(safe-area-inset-bottom) + 12px);"
  aria-label="Server list"
>
  <div class="h-3 shrink-0"></div>

  <!-- Home / DMs -->
  <a
    href="/dms"
    class="my-1 w-12 h-12 grid place-items-center rounded-3xl bg-[#313338]
           hover:rounded-xl hover:bg-[#5865f2] transition-all
           focus:outline-none focus:ring-2 focus:ring-[#5865f2]/60"
    aria-label="Home / DMs" title="Home / DMs"
  >
    <i class="bx bx-message-dots text-xl leading-none"></i>
  </a>

  <div class="h-px w-8 bg-white/10 my-2"></div>

  <!-- Server list (scrolls) -->
  <div class="flex-1 w-full overflow-y-auto">
    <div class="flex flex-col items-center pb-4">
      {#each servers as s (s.id)}
        <a
          href={`/servers/${s.id}`}
          class={`my-1 w-12 h-12 grid place-items-center transition-all
                  rounded-3xl focus:outline-none focus:ring-2 focus:ring-[#5865f2]/60
                  ${activeServerId === s.id
                    ? 'bg-[#5865f2] hover:bg-[#5865f2]'
                    : 'bg-[#313338] hover:bg-[#5865f2] hover:rounded-xl'}`}
          aria-label={s.name} title={s.name} aria-current={activeServerId === s.id ? 'page' : undefined}
        >
          {#if s.icon}
            <!-- No black corners: fill & round the image itself -->
            <img src={s.icon} alt={s.name}
                 class="block w-12 h-12 object-cover rounded-3xl pointer-events-none"
                 draggable="false" />
          {:else}
            <span class="text-sm font-semibold select-none">{s.name.slice(0, 2).toUpperCase()}</span>
          {/if}
        </a>
      {/each}

      <!-- Create -->
      <button
        type="button"
        class="my-1 w-12 h-12 grid place-items-center rounded-3xl bg-[#313338]
               hover:rounded-xl hover:bg-emerald-600 transition-all
               focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
        on:click={handleCreateClick}
        aria-label="Create server" title="Create server"
      >
        <i class="bx bx-plus text-2xl leading-none"></i>
      </button>
    </div>
  </div>

  <!-- Bottom cluster -->
  <div class="w-full grid place-items-center gap-2 p-2">
    <!-- Desktop: voice connected indicator -->
    <VoiceRailItem />
    <a
      href="/settings"
      class="w-12 h-12 grid place-items-center overflow-hidden rounded-2xl bg-[#313338]
             focus:outline-none focus:ring-2 focus:ring-white/30"
      aria-label="Profile" title="Profile"
    >
      {#if $user?.photoURL}
        <img src={$user.photoURL} alt="Me" class="block w-full h-full object-cover" draggable="false" />
      {:else}
        <i class="bx bx-user text-xl leading-none"></i>
      {/if}
    </a>

    <a
      href="/settings"
      class="w-8 h-8 grid place-items-center rounded-xl bg-[#313338] hover:bg-[#3a3c43] transition
             focus:outline-none focus:ring-2 focus:ring-white/30"
      aria-label="Settings" title="Settings"
    >
      <i class="bx bx-cog text-[16px] leading-none"></i>
    </a>
  </div>
</aside>

<NewServerModal bind:open={localCreateOpen} onClose={() => (localCreateOpen = false)} />
