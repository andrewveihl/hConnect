<script lang="ts">
  import { createServer, getUserServers } from '$lib/firestore';
  import { showCreateServerModal, servers, currentServerId, authUser } from '$lib/stores/index';

  let serverName = $state('');
  let description = $state('');
  let loading = $state(false);
  let error = $state('');

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';
    if (!serverName.trim()) {
      error = 'Server name is required';
      return;
    }

    loading = true;
    try {
      const newServer = await createServer(serverName, description || undefined);
      servers.update((s) => [...s, newServer]);
      currentServerId.set(newServer.id);
      showCreateServerModal.set(false);
      serverName = '';
      description = '';
    } catch (err: any) {
      error = err.message || 'Failed to create server';
    } finally {
      loading = false;
    }
  }

  function closeModal() {
    showCreateServerModal.set(false);
    serverName = '';
    description = '';
    error = '';
  }
</script>

{#if $showCreateServerModal}
  <!-- Modal Backdrop -->
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="button"
    tabindex="0"
    onclick={closeModal}
    onkeydown={(e) => e.key === 'Escape' && closeModal()}
  >
    <!-- Modal -->
    <div
      class="bg-gray-800 rounded-xl shadow-2xl p-6 w-full max-w-md border border-gray-700"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabindex="0"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <h2 id="modal-title" class="text-2xl font-bold text-white mb-4">Create Server</h2>

      <form onsubmit={handleSubmit} class="space-y-4">
        <div>
          <label for="serverName" class="block text-sm font-medium text-gray-300 mb-2">
            Server Name *
          </label>
          <input
            type="text"
            id="serverName"
            bind:value={serverName}
            placeholder="My Community"
            required
            class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <div>
          <label for="description" class="block text-sm font-medium text-gray-300 mb-2">
            Description
          </label>
          <textarea
            id="description"
            bind:value={description}
            placeholder="Optional description..."
            rows="3"
            class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
          ></textarea>
        </div>

        {#if error}
          <div class="p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        {/if}

        <div class="flex gap-3 mt-6">
          <button
            type="button"
            onclick={closeModal}
            class="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            class="flex-1 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-600 text-white font-medium rounded-lg transition-colors"
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
