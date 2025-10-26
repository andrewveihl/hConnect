<script lang="ts">
  import NotesBoard from '$lib/components/NotesBoard.svelte';
  import LeftPane from '$lib/components/LeftPane.svelte';
  import { user } from '$lib/stores/user';
</script>

<div class="flex h-dvh bg-[#0b111b] text-white overflow-hidden">
  <LeftPane activeServerId={null} />

  <div class="flex-1 overflow-auto bg-[#1e1f24]">
    <header class="h-14 px-4 flex items-center justify-between border-b border-black/40 bg-[#1e1f24]">
      <div class="flex items-center gap-2">
        <i class="bx bx-notepad text-xl"></i>
        <div class="text-base font-semibold">My Notes</div>
      </div>
    </header>

    <main class="min-h-[calc(100dvh-3.5rem)] bg-[#2b2d31]">
      {#if $user?.uid}
        <NotesBoard />
      {:else}
        <div class="h-full grid place-items-center text-white/70 p-6">
          <div class="text-center max-w-md">
            <div class="text-xl font-semibold mb-2">Sign in to use Notes</div>
            <div>Notes are saved privately to your account.</div>
          </div>
        </div>
      {/if}
    </main>
  </div>
</div>

