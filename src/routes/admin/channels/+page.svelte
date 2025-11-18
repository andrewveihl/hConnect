<script lang="ts">
  import type { PageData } from './$types';
  import AdminCard from '$lib/admin/components/AdminCard.svelte';
  import AdminTable from '$lib/admin/components/AdminTable.svelte';
  import ConfirmDialog from '$lib/admin/components/ConfirmDialog.svelte';
  import { ensureFirebaseReady, getDb } from '$lib/firebase';
  import { collection, doc, getDocs, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
  import { logAdminAction } from '$lib/admin/logs';
  import { softDeleteDocument } from '$lib/admin/archive';
  import { showAdminToast } from '$lib/admin/stores/toast';

  type ChannelPreset = 'normal' | 'readOnly' | 'locked';

  type ChannelRow = {
    id: string;
    name: string;
    type: string;
    position: number;
    isPrivate: boolean;
    createdAt?: Date | null;
    adminPreset?: ChannelPreset;
  };

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  const initialServerId = data.initialServerId ?? data.servers[0]?.id ?? '';
  let selectedServerId = $state(initialServerId);
  let serverSearch = $state('');
  let channels: ChannelRow[] = $state([]);
  let loading = $state(false);
  let presetBusy = $state(false);
  let pendingArchive: ChannelRow | null = $state(null);

  const selectedServer = $derived(data.servers.find((server) => server.id === selectedServerId) ?? null);
  const visibleServers = $derived(
    data.servers.filter((server) =>
      server.name.toLowerCase().includes(serverSearch.toLowerCase() || '')
    )
  );

let lastLoadedServer: string | null = null;
$effect(() => {
  if (!selectedServerId || selectedServerId === lastLoadedServer) return;
  lastLoadedServer = selectedServerId;
  void loadChannels(selectedServerId);
});

  async function loadChannels(serverId: string) {
    if (!serverId) {
      channels = [];
      return;
    }
    loading = true;
    try {
      await ensureFirebaseReady();
      const db = getDb();
      const snap = await getDocs(
        query(collection(db, 'servers', serverId, 'channels'), orderBy('position'))
      );
      channels = snap.docs.map((docSnap) => {
        const payload = docSnap.data() as Record<string, any>;
        return {
          id: docSnap.id,
          name: payload.name ?? 'Channel',
          type: payload.type ?? 'text',
          position: payload.position ?? 0,
          isPrivate: payload.isPrivate ?? false,
          adminPreset: (payload.adminPreset as ChannelPreset | undefined) ?? 'normal',
          createdAt: payload.createdAt?.toDate?.() ?? null
        };
      });
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Unable to load channels.' });
    } finally {
      loading = false;
    }
  }

  const applyPreset = async (channel: ChannelRow, preset: ChannelPreset) => {
    if (!selectedServerId) return;
    presetBusy = true;
    try {
      await ensureFirebaseReady();
      const db = getDb();
      await updateDoc(doc(db, 'servers', selectedServerId, 'channels', channel.id), {
        adminPreset: preset,
        updatedAt: serverTimestamp()
      });
      channels = channels.map((row) => (row.id === channel.id ? { ...row, adminPreset: preset } : row));
      await logAdminAction({
        type: 'permissions',
        level: 'info',
        message: `Channel preset set to ${preset}`,
        data: {
          action: 'channel:preset',
          preset,
          serverId: selectedServerId,
          channelId: channel.id
        },
        serverId: selectedServerId,
        channelId: channel.id,
        userId: data.user.uid
      });
      showAdminToast({ type: 'success', message: 'Preset updated.' });
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Failed to update channel.' });
    } finally {
      presetBusy = false;
    }
  };

  const archiveChannel = async () => {
    const target = pendingArchive;
    if (!target || !selectedServerId) return;
    loading = true;
    try {
      await softDeleteDocument(
        {
          tab: 'channels',
          docPath: `servers/${selectedServerId}/channels/${target.id}`,
          reason: 'Manual admin archive'
        },
        data.user
      );
      channels = channels.filter((row) => row.id !== target.id);
      showAdminToast({ type: 'warning', message: 'Channel archived.' });
      pendingArchive = null;
    } catch (err) {
      console.error(err);
      showAdminToast({ type: 'error', message: (err as Error)?.message ?? 'Unable to archive.' });
    } finally {
      loading = false;
    }
  };
</script>

<section class="admin-page admin-page--single">
  <AdminCard title="Channel controls" description="Update presets or archive channels." padded={false}>
    <div class="border-b border-[color:color-mix(in_srgb,var(--color-text-primary)8%,transparent)]">
      <div class="flex flex-col gap-4 px-6 py-4">
        <div class="flex flex-wrap items-center gap-2 text-xs text-[color:var(--text-60,#6b7280)]">
          <a
            href="/admin/servers"
            class="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 px-4 py-1.5 text-[11px] font-semibold text-white shadow hover:opacity-90"
          >
          <span aria-hidden="true">&larr;</span>
          Back to servers
        </a>
        <span class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">
          {selectedServer ? `Managing ${selectedServer.name}` : 'Pick a server to load channels.'}
        </span>
        </div>
      </div>
      <div class="flex flex-col gap-3 md:flex-row md:items-center">
        <input
          type="search"
          placeholder="Search servers"
          class="w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-4 py-2 text-sm text-[color:var(--color-text-primary,#0f172a)] placeholder:text-[color:var(--text-50,#94a3b8)] focus:border-[color:var(--color-text-primary,#0f172a)] md:flex-1"
          bind:value={serverSearch}
        />
        <select
          class="w-full rounded-2xl border border-[color:color-mix(in_srgb,var(--color-text-primary)15%,transparent)] bg-transparent px-4 py-2 text-sm text-[color:var(--color-text-primary,#0f172a)] focus:border-[color:var(--color-text-primary,#0f172a)] md:flex-1"
          bind:value={selectedServerId}
        >
          {#each visibleServers as server}
            <option value={server.id}>{server.name}</option>
          {/each}
        </select>
      </div>
      <div class="text-xs text-[color:var(--text-60,#6b7280)]">
        {#if loading}
          <span>Loading channels…</span>
        {:else if !visibleServers.length}
          <span>No servers match “{serverSearch}”.</span>
        {:else}
          <span>{visibleServers.length} server{visibleServers.length === 1 ? '' : 's'} ready to manage.</span>
        {/if}
      </div>
    </div>
    <div class="p-6">
      {#if !selectedServerId}
        <p class="text-sm text-[color:var(--text-60,#6b7280)]">Select a server to view channels.</p>
      {:else}
        <AdminTable headers={[{ label: 'Channel' }, { label: 'Type' }, { label: 'Preset' }, { label: 'Created' }, { label: 'Actions' }]}>
          {#if channels.length === 0}
          <tr>
            <td class="px-4 py-5 text-sm text-[color:var(--text-60,#6b7280)]" colspan="5">
              {loading ? 'Loading…' : 'No channels found'}
            </td>
          </tr>
        {:else}
          {#each channels as channel}
            <tr class="hover:bg-[color-mix(in_srgb,var(--surface-panel)92%,transparent)]">
              <td class="px-4 py-4">
                <p class="font-semibold text-[color:var(--color-text-primary,#0f172a)]">{channel.name}</p>
                <p class="text-xs text-[color:var(--text-60,#6b7280)]">{channel.id}</p>
              </td>
              <td class="px-4 py-4 text-sm text-[color:var(--text-60,#6b7280)]">{channel.type}</td>
              <td class="px-4 py-4 text-sm">
                <div class="flex flex-wrap gap-2">
                  {#each (['normal', 'readOnly', 'locked'] as ChannelPreset[]) as preset}
                    <button
                      type="button"
                      class="preset-chip"
                      class:preset-chip--active={channel.adminPreset === preset}
                      onclick={() => applyPreset(channel, preset)}
                      disabled={presetBusy}
                    >
                      {preset}
                    </button>
                  {/each}
                </div>
              </td>
              <td class="px-4 py-4 text-sm text-[color:var(--text-60,#6b7280)]">
                {channel.createdAt ? channel.createdAt.toLocaleString() : '--'}
              </td>
              <td class="px-4 py-4 text-right">
                <button
                  type="button"
                  class="rounded-full border border-[color:color-mix(in_srgb,#f59e0b_40%,transparent)] px-3 py-1 text-xs font-semibold text-[color-mix(in_srgb,#b45309_90%,white)]"
                  onclick={() => (pendingArchive = channel)}
                >
                  Archive
                </button>
              </td>
            </tr>
          {/each}
        {/if}
      </AdminTable>
    {/if}
    </div>
  </AdminCard>
</section>

<ConfirmDialog
  open={Boolean(pendingArchive)}
  title="Archive channel"
  body={`Channel ${pendingArchive?.name ?? ''} will be archived.`}
  confirmLabel="Archive"
  tone="default"
  busy={loading}
  on:confirm={archiveChannel}
  on:cancel={() => (pendingArchive = null)}
/>

<style>
  .preset-chip {
    border-radius: 9999px;
    padding: 0.25rem 0.9rem;
    font-size: 0.75rem;
    font-weight: 600;
    background: color-mix(in srgb, var(--surface-panel) 88%, transparent);
    color: color-mix(in srgb, var(--color-text-primary) 65%, transparent);
    transition: all 0.2s ease;
  }

  .preset-chip--active {
    background: linear-gradient(120deg, #0d9488, #06b6d4);
    color: white;
    box-shadow: 0 12px 24px rgba(6, 182, 212, 0.2);
  }
</style>














