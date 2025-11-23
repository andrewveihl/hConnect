<script lang="ts">
  import { run } from 'svelte/legacy';

  import { onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { createChannel } from '$lib/firestore/channels';
  import { getDb } from '$lib/firebase';
  import { collection, onSnapshot, orderBy, query, type Unsubscribe } from 'firebase/firestore';

  interface Props {
    open?: boolean;
    serverId: string | undefined;
    onClose?: () => void;
    onCreated?: (id: string) => void;
  }

  let {
    open = $bindable(false),
    serverId,
    onClose = () => {},
    onCreated = () => {}
  }: Props = $props();

  // fallback to route param if prop not passed
  let serverIdFinal =
    $derived(serverId ??
    $page.params.serverID ??
    ($page.params as any).serverId ??
    ($page.params as any).id);

  type Role = { id: string; name?: string };

  let chName = $state('');
  let chType: 'text' | 'voice' = $state('text');
  let chPrivate = $state(false);
  let busy = $state(false);
  let errorMsg = $state('');
  let selectedRoleIds: string[] = $state([]);
  let roleOptions: Role[] = $state([]);
  let roleStop: Unsubscribe | null = $state(null);
  let roleWatcherServerId: string | null = $state(null);

  function reset() {
    chName = '';
    chType = 'text';
    chPrivate = false;
    busy = false;
    errorMsg = '';
    selectedRoleIds = [];
  }
  function close() { reset(); onClose(); }

  async function submit() {
    if (!serverIdFinal) { errorMsg = 'Server not ready yet. Try again in a moment.'; return; }
    busy = true; errorMsg = '';
    const trimmed = chName.trim();
    const name = trimmed || (chType === 'text' ? 'New Text Channel' : 'New Voice Channel');

    try {
      const id = await createChannel(
        serverIdFinal,
        name,
        chType,
        chPrivate,
        chPrivate ? selectedRoleIds : []
      );
      onCreated(id);
      close();
    } catch (e: any) {
      errorMsg = e?.message ?? 'Failed to create channel';
    } finally {
      busy = false;
    }
  }

  run(() => {
    const nextId = browser ? serverIdFinal ?? null : null;
    if (roleWatcherServerId === nextId) {
      // no change
    } else {
      roleWatcherServerId = nextId;
      roleStop?.();
      roleStop = null;
      roleOptions = [];
      if (browser && nextId) {
        const db = getDb();
        const q = query(collection(db, 'servers', nextId, 'roles'), orderBy('position'));
        roleStop = onSnapshot(q, (snap) => {
          roleOptions = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }));
        });
      }
    }
  });

  run(() => {
    const available = new Set(roleOptions.map((role) => role.id));
    if (selectedRoleIds.some((id) => !available.has(id))) {
      selectedRoleIds = selectedRoleIds.filter((id) => available.has(id));
    }
  });

  run(() => {
    if ((!browser || !chPrivate) && selectedRoleIds.length) {
      selectedRoleIds = [];
    }
  });

  function toggleRole(roleId: string, enabled: boolean) {
    selectedRoleIds = enabled
      ? Array.from(new Set([...selectedRoleIds, roleId]))
      : selectedRoleIds.filter((id) => id !== roleId);
  }

  onDestroy(() => {
    roleStop?.();
    roleStop = null;
  });
</script>

{#if open}
  <div class="fixed inset-0 z-[999]">
    <!-- Backdrop -->
    <button
      type="button"
      class="absolute inset-0 w-full h-full bg-black/60"
      aria-label="Close dialog"
      onclick={close}
    ></button>

    <div class="absolute inset-0 grid place-items-center p-4">
      <div
        class="relative z-10 bg-[#2b2d31] text-white  shadow-xl w-full max-w-md p-6"
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
                <input id="ctype-text" type="radio" name="ctype" checked={chType === 'text'} onchange={() => (chType = 'text')} />
                <label for="ctype-text">Text</label>
              </div>
              <div class="flex items-center gap-2">
                <input id="ctype-voice" type="radio" name="ctype" checked={chType === 'voice'} onchange={() => (chType = 'voice')} />
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

          {#if chPrivate}
            <div class="channel-modal-roles">
              {#if roleOptions.length === 0}
                <p class="text-xs text-white/45">
                  No custom roles yet. Create a role in server settings to limit who can access this channel.
                </p>
              {:else}
                <p class="text-xs text-white/60">Allow these roles to view the channel:</p>
                <div class="channel-modal-roles__grid">
                  {#each roleOptions as role}
                    <label class="channel-modal-role">
                      <input
                        type="checkbox"
                        checked={selectedRoleIds.includes(role.id)}
                        onchange={(event) =>
                          toggleRole(role.id, (event.currentTarget as HTMLInputElement).checked)}
                      />
                    <span>{role.name || 'Role'}</span>
                  </label>
                {/each}
              </div>
              {#if !selectedRoleIds.length}
                <p class="text-[11px] text-white/45">
                  No roles selected yet. Until you add at least one role, only admins can view this private channel.
                </p>
              {/if}
            {/if}
          </div>
        {/if}

          {#if errorMsg}
            <div class="text-sm text-red-400">{errorMsg}</div>
          {/if}

          <div class="flex gap-2 pt-2">
            <button type="button" class="btn btn-ghost flex-1" onclick={close}>Cancel</button>
            <button
              type="button"
              class="btn btn-primary flex-1"
              onclick={submit}
              aria-label="Create channel"
              disabled={busy}
            >
              {busy ? 'Creatingâ€¦' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .channel-modal-roles {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.25rem 0;
  }

  .channel-modal-roles__grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .channel-modal-role {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 999px;
    padding: 0.25rem 0.75rem;
    font-size: 0.8rem;
    background: rgba(255, 255, 255, 0.04);
  }

  .channel-modal-role input {
    accent-color: var(--color-accent, #33c8bf);
  }
</style>

