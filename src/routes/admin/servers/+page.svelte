<script lang="ts">
  import type { PageData } from './$types';
  import AdminCard from '$lib/admin/components/AdminCard.svelte';
  import ConfirmDialog from '$lib/admin/components/ConfirmDialog.svelte';
  import { hardDeleteDocument, softDeleteDocument } from '$lib/admin/archive';
  import { showAdminToast } from '$lib/admin/stores/toast';
  import { ensureFirebaseReady, getDb } from '$lib/firebase';
  import { doc, updateDoc } from 'firebase/firestore';
  import { goto } from '$app/navigation';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let servers = $state([...data.servers]);
  let search = $state('');
  let pendingAction: { serverId: string; mode: 'archive' | 'delete'; label: string } | null = $state(null);
  let busy = $state(false);
  let selectedServer: (typeof data.servers)[number] | null = $state(null);
  let settingsBusy = $state(false);
let settingsForm = $state({
  isPublic: false,
  defaultRoleId: '',
  systemChannelId: '',
  description: ''
});

  const filteredServers = $derived(
    servers.filter((server) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        server.name.toLowerCase().includes(q) ||
        server.id.toLowerCase().includes(q) ||
        server.ownerName.toLowerCase().includes(q)
      );
    })
  );

  $effect(() => {
    if (!selectedServer) return;
    settingsForm = {
      isPublic: Boolean(selectedServer.isPublic),
      defaultRoleId: selectedServer.defaultRoleId ?? '',
      systemChannelId: selectedServer.systemChannelId ?? '',
      description: selectedServer.description ?? ''
    };
  });

  const formatDate = (value: Date | null | undefined) => (value ? value.toLocaleString() : '--');

  const selectServer = (server: (typeof data.servers)[number]) => {
    selectedServer = server;
  };

  const queueServerAction = (mode: 'archive' | 'delete') => {
    if (!selectedServer) return;
    pendingAction = {
      serverId: selectedServer.id,
      mode,
      label: selectedServer.name
    };
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    const currentAction = pendingAction;
    busy = true;
    try {
      const path = `servers/${currentAction.serverId}`;
      if (currentAction.mode === 'archive') {
        await softDeleteDocument({ tab: 'servers', docPath: path, reason: 'Manual admin archive' }, data.user);
        showAdminToast({ type: 'warning', message: 'Server archived.' });
      } else {
        await hardDeleteDocument(path, data.user, { reason: 'Manual admin delete', scope: 'servers' });
        showAdminToast({ type: 'error', message: 'Server hard deleted.' });
      }
      servers = servers.filter((server) => server.id !== currentAction.serverId);
      if (selectedServer?.id === currentAction.serverId) {
        selectedServer = servers[0] ?? null;
      }
      pendingAction = null;
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Action failed.' });
    } finally {
      busy = false;
    }
  };

  const saveServerSettings = async () => {
    if (!selectedServer) return;
    settingsBusy = true;
    try {
      await ensureFirebaseReady();
      const db = getDb();
      const payload = {
        isPublic: settingsForm.isPublic,
        defaultRoleId: settingsForm.defaultRoleId || null,
        systemChannelId: settingsForm.systemChannelId || null,
        description: settingsForm.description || null
      };
      await updateDoc(doc(db, 'servers', selectedServer.id), payload);
      servers = servers.map((server) =>
        server.id === selectedServer?.id ? { ...server, ...payload } : server
      );
      selectedServer = servers.find((server) => server.id === selectedServer?.id) ?? selectedServer;
      showAdminToast({ type: 'success', message: 'Server settings updated.' });
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Unable to update server.' });
    } finally {
      settingsBusy = false;
    }
  };

  const goToChannels = () => {
    if (!selectedServer) return;
    goto(`/admin/channels?serverId=${selectedServer.id}`);
  };

  const goToMessages = () => {
    if (!selectedServer) return;
    goto(`/admin/messages?serverId=${selectedServer.id}`);
  };
</script>

<section class="admin-page admin-page--split server-page">
  <div class="server-panel">
    <AdminCard title="Servers" description="Select a server to view details." padded={false}>
      <div class="server-card-body">
        <div class="border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)]">
          <div class="flex flex-col gap-3 px-6 py-4">
            <input
              type="search"
              placeholder="Search by name, owner, or ID"
              class="w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-4 py-2 text-sm text-[color:var(--color-text-primary,#0f172a)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-[color:var(--color-text-primary,#0f172a)]"
              bind:value={search}
            />
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--text-60,#6b7280)]">
              <p>{filteredServers.length} {filteredServers.length === 1 ? 'match' : 'matches'}</p>
              {#if search}
                <button
                  type="button"
                  class="rounded-full border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-3 py-1 text-[11px] font-semibold text-[color:var(--color-text-primary,#0f172a)]"
                  onclick={() => (search = '')}
                >
                  Clear search
                </button>
              {/if}
            </div>
          </div>
        </div>
        <div class="server-list">
          {#if filteredServers.length === 0}
            <p class="text-sm text-[color:var(--text-60,#6b7280)]">No servers match.</p>
          {:else}
            {#each filteredServers as server}
              <button
                type="button"
                class="flex w-full flex-col gap-1 rounded-2xl border px-4 py-3 text-left transition"
                class:border-[color:color-mix(in_srgb,var(--color-text-primary)30%,transparent)]={selectedServer?.id === server.id}
                class:border-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)]={selectedServer?.id !== server.id}
                class:bg-[color-mix(in_srgb,var(--surface-panel)85%,transparent)]={selectedServer?.id === server.id}
                onclick={() => selectServer(server)}
              >
                <div class="flex items-center justify-between gap-3">
                  <p class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">{server.name}</p>
                  <span
                    class="admin-pill text-[11px]"
                    style:background={server.status === 'active'
                      ? 'color-mix(in srgb, #14b8a6 18%, transparent)'
                      : 'color-mix(in srgb, #f59e0b 20%, transparent)'}
                    style:color={server.status === 'active'
                      ? 'color-mix(in srgb, #0f766e 90%, white)'
                      : 'color-mix(in srgb, #b45309 90%, white)'}
                  >
                    {server.status}
                  </span>
                </div>
                <p class="text-xs text-[color:var(--text-60,#6b7280)]">Owner: {server.ownerName}</p>
                <p class="text-xs text-[color:var(--text-60,#6b7280)]">Members: {server.memberCount ?? 0}</p>
                <p class="text-[11px] text-[color:var(--text-60,#6b7280)]">Created {formatDate(server.createdAt)}</p>
              </button>
            {/each}
          {/if}
        </div>
      </div>
    </AdminCard>
  </div>

  <div class="server-panel">
    <AdminCard title="Server detail" description="Adjust visibility, defaults, and jump into tools." padded={false}>
      {#if !selectedServer}
        <p class="p-6 text-sm text-[color:var(--text-60,#6b7280)]">Select a server from the left to view details.</p>
      {:else}
        <div class="server-detail space-y-5 p-6">
          <div class="rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-4">
            <p class="text-xs uppercase tracking-[0.3em] text-[color:var(--text-55,#6b7280)]">Server</p>
            <h2 class="text-2xl font-semibold text-[color:var(--color-text-primary,#0f172a)]">{selectedServer.name}</h2>
          <p class="text-sm text-[color:var(--text-60,#6b7280)]">ID: {selectedServer.id}</p>
          <div class="mt-3 grid gap-3 text-sm text-[color:var(--text-70,#475569)]">
            <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">Owner:</span> {selectedServer.ownerName}</p>
            <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">Members:</span> {selectedServer.memberCount ?? 0}</p>
            <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">Public:</span> {selectedServer.isPublic ? 'Yes' : 'No'}</p>
            <p><span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">Created:</span> {formatDate(selectedServer.createdAt)}</p>
          </div>
        </div>

        <div class="space-y-3 rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-4">
          <div class="flex items-center justify-between">
            <p class="text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)]">Public server</p>
            <label class="relative inline-flex h-6 w-11 items-center">
              <input type="checkbox" class="peer sr-only" bind:checked={settingsForm.isPublic} />
              <span class="absolute inset-0 rounded-full bg-[color:color-mix(in_srgb,var(--color-text-primary)12%,transparent)] transition peer-checked:bg-teal-500"></span>
              <span class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5"></span>
            </label>
          </div>
          <label class="text-xs font-semibold text-[color:var(--text-70,#475569)]">
            Default role ID
            <input
              type="text"
              class="mt-1 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-3 py-2 text-sm"
              bind:value={settingsForm.defaultRoleId}
              placeholder="role-id"
            />
          </label>
          <label class="text-xs font-semibold text-[color:var(--text-70,#475569)]">
            System channel ID
            <input
              type="text"
              class="mt-1 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-3 py-2 text-sm"
              bind:value={settingsForm.systemChannelId}
              placeholder="channel-id"
            />
          </label>
          <label class="text-xs font-semibold text-[color:var(--text-70,#475569)]">
            Description
            <textarea
              rows={3}
              class="mt-1 w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-3 py-2 text-sm"
              bind:value={settingsForm.description}
              placeholder="Optional description"
            ></textarea>
          </label>
          <div class="flex flex-wrap gap-3 pt-1">
            <button
              type="button"
              class="rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 px-5 py-2 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-50"
              onclick={saveServerSettings}
              disabled={settingsBusy}
            >
              {settingsBusy ? 'Saving…' : 'Save settings'}
            </button>
            <button
              type="button"
              class="rounded-full border border-amber-300/70 px-4 py-2 text-sm font-semibold text-amber-200"
              onclick={() => queueServerAction('archive')}
            >
              Archive
            </button>
            <button
              type="button"
              class="rounded-full border border-rose-400/70 px-4 py-2 text-sm font-semibold text-rose-100"
              onclick={() => queueServerAction('delete')}
            >
              Hard delete
            </button>
          </div>
        </div>

        <div class="rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)10%,transparent)] p-4">
          <p class="text-xs uppercase tracking-[0.3em] text-[color:var(--text-55,#6b7280)]">Admin tools</p>
          <p class="text-sm text-[color:var(--text-70,#475569)]">Jump into detailed moderation views for this server.</p>
          <div class="mt-4 flex flex-col gap-2">
            <button
              type="button"
              class="rounded-2xl bg-gradient-to-r from-teal-500 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
              onclick={goToChannels}
            >
              Manage channels
            </button>
            <button
              type="button"
              class="rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] px-4 py-2 text-sm font-semibold text-[color:var(--color-text-primary,#0f172a)] hover:bg-[color-mix(in_srgb,var(--surface-panel)90%,transparent)]"
              onclick={goToMessages}
            >
              Review messages
            </button>
          </div>
          <p class="mt-2 text-xs text-[color:var(--text-60,#6b7280)]">
            Review messages now lives directly under the channel tools so you always find it in the same flow.
          </p>
        </div>
        </div>
      {/if}
    </AdminCard>
  </div>
</section>

<ConfirmDialog
  open={Boolean(pendingAction)}
  title={pendingAction?.mode === 'archive' ? 'Archive server' : 'Hard delete server'}
  body={
    pendingAction?.mode === 'archive'
      ? `Server ${pendingAction?.label ?? ''} will be moved into the archive.`
      : `Server ${pendingAction?.label ?? ''} will be permanently deleted.`
  }
  confirmLabel={pendingAction?.mode === 'archive' ? 'Archive' : 'Delete'}
  tone={pendingAction?.mode === 'archive' ? 'default' : 'danger'}
  busy={busy}
  on:confirm={confirmAction}
  on:cancel={() => (pendingAction = null)}
/>

<style>
  .server-page {
    width: min(100%, 78rem);
    margin: 0 auto;
    gap: clamp(1rem, 3vw, 1.5rem);
  }

  .server-panel {
    min-height: 0;
  }

  .server-panel :global(section) {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .server-panel :global(section > div:last-child) {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .server-card-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .server-list {
    flex: 1;
    min-height: 0;
    max-height: min(70vh, 520px);
    overflow-y: auto;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .server-detail {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  @media (max-width: 900px) {
    .server-page {
      grid-template-columns: minmax(0, 1fr);
    }

    .server-panel {
      min-height: clamp(320px, 60vh, 520px);
    }
  }

  @media (max-width: 640px) {
    .server-list {
      max-height: clamp(280px, 50vh, 420px);
      padding: 1rem;
    }

    .server-detail {
      max-height: clamp(320px, 55vh, 480px);
    }
  }
</style>
