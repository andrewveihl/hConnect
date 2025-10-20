<script lang="ts">
  import { onDestroy } from 'svelte';
  import { user } from '$lib/stores/user';
  import { subscribeUserServers } from '$lib/db/servers';

  export let activeServerId: string | null = null;
  export let onCreateServer: (() => void) | null = null;

  let servers: { id: string; name: string; icon?: string|null }[] = [];
  let unsub: (() => void) | undefined;

  $: if ($user) { unsub?.(); unsub = subscribeUserServers($user.uid, (rows) => { servers = rows; }); }
  onDestroy(() => unsub?.());

  const handleCreateClick = () => { if (onCreateServer) onCreateServer(); };
</script>

<aside class="h-dvh w-[72px] bg-[#1e1f22] border-r border-black/40 text-white select-none flex flex-col items-center">
  <div class="h-3 shrink-0"></div>

  <!-- Home / DMs -->
  <a
    href="/dms"
    class="my-1 rounded-3xl w-12 h-12 bg-[#313338] hover:rounded-xl hover:bg-[#5865f2] transition-all grid place-items-center"
    aria-label="Home / DMs" role="button"
  >
    <i class="bx bx-message-dots text-xl"></i>
  </a>

  <div class="h-px w-8 bg-white/10 my-2"></div>

  <!-- Servers -->
  <div class="flex-1 w-full overflow-y-auto">
    <div class="flex flex-col items-center">
      {#each servers as s (s.id)}
        <a
          href={`/servers/${s.id}`}
          class={`my-1 rounded-3xl w-12 h-12 transition-all grid place-items-center hover:rounded-xl
            ${activeServerId === s.id ? '!bg-[#5865f2] hover:!bg-[#5865f2]' : 'bg-[#313338] hover:bg-[#5865f2]'}`}
          aria-label={s.name} role="button"
        >
          {#if s.icon}
            <img src={s.icon} alt={s.name} class="w-12 h-12 rounded-3xl pointer-events-none" />
          {:else}
            <span class="text-sm font-semibold">{s.name.slice(0,2).toUpperCase()}</span>
          {/if}
        </a>
      {/each}

      <!-- Create (opens local modal if provided by parent) -->
      <button
        class="my-1 rounded-3xl w-12 h-12 bg-[#313338] hover:rounded-xl hover:bg-emerald-600 transition-all grid place-items-center"
        on:click={handleCreateClick} aria-label="Create server"
      >
        <i class="bx bx-plus text-2xl"></i>
      </button>
    </div>
  </div>

  <!-- Bottom: Settings -->
  <div class="w-full grid place-items-center gap-2 p-2">
    <a href="/settings" class="rounded-2xl w-12 h-12 bg-[#313338] grid place-items-center overflow-hidden" title="Settings" role="button">
      {#if $user?.photoURL}
        <img src={$user.photoURL} alt="Me" class="w-full h-full object-cover" />
      {:else}
        <i class="bx bx-user text-xl"></i>
      {/if}
    </a>
    <div class="text-[10px] text-white/60 max-w-[60px] text-center truncate">Settings</div>
  </div>
</aside>
