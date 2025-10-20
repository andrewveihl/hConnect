<script lang="ts">
  import { page } from '$app/stores';
  import LeftPane from '$lib/components/LeftPane.svelte';
  import NewServerModal from '$lib/components/NewServerModal.svelte';

  let showCreate = false;
  $: showCreate = $page?.url?.searchParams?.get('createServer') === '1' || showCreate;

  function closeModal() {
    showCreate = false;
    const url = new URL(window.location.href);
    url.searchParams.delete('createServer');
    history.replaceState({}, '', url.toString());
  }
</script>

<div class="grid grid-cols-[72px_1fr] min-h-dvh text-white">
  <LeftPane activeServerId={null} onCreateServer={() => (showCreate = true)} />
  <div class="bg-[#313338] flex items-center justify-center">
    <div class="text-center space-y-5">
      <div class="text-3xl font-semibold">Welcome to hConnect</div>
      <p class="text-white/70">Pick a server on the left, open DMs, or create a brand new server.</p>
      <div class="flex items-center justify-center gap-3">
        <a href="/dms" class="btn btn-ghost"><i class="bx bx-message-dots mr-1"></i> Open DMs</a>
        <button class="btn btn-primary" on:click={() => (showCreate = true)}><i class="bx bx-plus mr-1"></i> Create a server</button>
      </div>
    </div>
  </div>
</div>

<NewServerModal bind:open={showCreate} onClose={closeModal} />
