<script lang="ts">
  import { page } from '$app/stores';
  import { createChannel } from '$lib/db/channels';

  export let open = false;
  export let serverId: string | undefined;
  export let onClose: () => void = () => {};
  export let onCreated: (id: string) => void = () => {};

  // fallback to route param if prop not passed
  $: serverIdFinal =
    serverId ??
    $page.params.serverId ??
    ($page.params as any).serversID ??
    ($page.params as any).id;

  let chName = '';
  let chType: 'text' | 'voice' = 'text';
  let chPrivate = false;
  let busy = false;
  let errorMsg = '';

  function reset() {
    chName = '';
    chType = 'text';
    chPrivate = false;
    busy = false;
    errorMsg = '';
  }
  function close() { reset(); onClose(); }

  async function submit() {
    if (!serverIdFinal) { errorMsg = 'Server not ready yet. Try again in a moment.'; return; }
    busy = true; errorMsg = '';
    const name = (chName.trim() || (chType === 'text' ? 'new-text' : 'New Voice')).toLowerCase();

    try {
      const id = await createChannel(serverIdFinal, name, chType, chPrivate);
      onCreated(id);
      close();
    } catch (e: any) {
      errorMsg = e?.message ?? 'Failed to create channel';
    } finally {
      busy = false;
    }
  }
</script>

{#if open}
  <div class="fixed inset-0 z-[999]">
    <!-- Backdrop -->
    <button
      type="button"
      class="absolute inset-0 w-full h-full bg-black/60"
      aria-label="Close dialog"
      on:click={close}
    ></button>

    <div class="absolute inset-0 grid place-items-center p-4">
      <div
        class="relative z-10 bg-[#2b2d31] text-white rounded-2xl shadow-xl w-full max-w-md p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-channel-title"
      >
        <h2 id="create-channel-title" class="text-lg font-semibold mb-4">Create Channel</h2>

        <div class="space-y-4">
          <div>
            <label class="block text-sm mb-1" for="chName">Channel name</label>
            <input id="chName" class="input w-full" placeholder="e.g. general" bind:value={chName} />
          </div>

          <fieldset>
            <legend class="block text-sm mb-1">Type</legend>
            <div class="flex items-center gap-4 text-sm">
              <div class="flex items-center gap-2">
                <input id="ctype-text" type="radio" name="ctype" checked={chType === 'text'} on:change={() => (chType = 'text')} />
                <label for="ctype-text">Text</label>
              </div>
              <div class="flex items-center gap-2">
                <input id="ctype-voice" type="radio" name="ctype" checked={chType === 'voice'} on:change={() => (chType = 'voice')} />
                <label for="ctype-voice">Voice</label>
              </div>
            </div>
          </fieldset>

          <div>
            <div class="block text-sm mb-1">Visibility</div>
            <div class="flex items-center gap-2 text-sm">
              <input id="chPrivate" type="checkbox" bind:checked={chPrivate} />
              <label for="chPrivate">Private (invited roles/users only)</label>
            </div>
            <div class="text-xs text-white/50 mt-1">Saved as <code>isPrivate</code> on the channel.</div>
          </div>

          {#if errorMsg}
            <div class="text-sm text-red-400">{errorMsg}</div>
          {/if}

          <div class="flex gap-2 pt-2">
            <button type="button" class="btn btn-ghost flex-1" on:click={close}>Cancel</button>
            <button
              type="button"
              class="btn btn-primary flex-1"
              on:click={submit}
              aria-label="Create channel"
              disabled={busy}
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
