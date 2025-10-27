<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { user } from '$lib/stores/user';
  import { getDb } from '$lib/firebase';
  import { sendServerInvite } from '$lib/db/invites';

  import {
    collection, doc, getDoc, onSnapshot, getDocs,
    query, orderBy, setDoc, updateDoc, deleteDoc,
    limit, addDoc, serverTimestamp, arrayUnion, arrayRemove
  } from 'firebase/firestore';

const ICON_MAX_BYTES = 8 * 1024 * 1024;
const FIRESTORE_IMAGE_LIMIT = 900 * 1024;
const ICON_MAX_DIMENSION = 512;

// routing
  let serverId: string | null = null;

  // access
  let allowed = false;
  let isOwner = false;
  let isAdmin = false;

  // server meta
  let serverName = '';
  let serverIcon = '';
  let serverIconInput: HTMLInputElement | null = null;
  let serverIconError: string | null = null;

  // tabs
  type Tab = 'overview' | 'members' | 'channels' | 'roles' | 'danger';
  let tab: Tab = 'members'; // land on Members where Invite lives
  const tabItems: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: 'Members' },
    { id: 'channels', label: 'Channels' },
    { id: 'roles', label: 'Roles' },
    { id: 'danger', label: 'Danger Zone' }
  ];

  // live lists
  let members: Array<{ uid: string; displayName?: string; photoURL?: string; role?: string; roleIds?: string[] }> = [];
  let bans: Array<{ uid: string; reason?: string; bannedAt?: any }> = [];
  let channels: Array<{ id: string; name: string; type: 'text' | 'voice'; position?: number; allowedRoleIds?: string[] }> = [];
type Role = { id: string; name: string; color?: string | null; position?: number; permissions?: Record<string, boolean> };
  let roles: Role[] = [];
  let assignableRoles: Role[] = [];
  let newRoleName = '';
  let newRoleColor = '#5865f2';

  // profiles (people who have logged in)
  type Profile = {
    uid: string;
    displayName?: string;
    nameLower?: string;
    email?: string;
    photoURL?: string;
  };
  let allProfiles: Profile[] = [];  // weÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ll filter this as you type
  let pendingInvitesByUid: Record<string, boolean> = {};
  let inviteLoading: Record<string, boolean> = {};
  let inviteError: string | null = null;

  function ownerFrom(data: any) {
    return data?.owner ?? data?.ownerId ?? data?.createdBy ?? null;
  }

  async function gate() {
    const db = getDb();
    const snap = await getDoc(doc(db, 'servers', serverId!));
    if (!snap.exists()) return goto('/');

    const data = snap.data() as any;
    serverName = data?.name ?? 'Server';
    serverIcon = data?.icon ?? null;
    const owner = ownerFrom(data);

    isOwner = !!($user?.uid && owner && $user.uid === owner);

    // admin if role is 'admin' in members or owner
    if (!isOwner && $user?.uid) {
      const memberSnap = await getDoc(doc(db, 'servers', serverId!, 'members', $user.uid));
      const role = memberSnap.exists() ? (memberSnap.data() as any).role : null;
      isAdmin = role === 'admin';
    } else {
      isAdmin = true; // owner is admin+
    }

    allowed = isOwner || isAdmin;
    if (!allowed) goto(`/servers/${serverId}`);
  }

  function goBack() {
    if (history.length > 1) history.back();
    else goto(serverId ? `/servers/${serverId}` : '/');
  }

  function watchMembers() {
    const db = getDb();
    return onSnapshot(collection(db, 'servers', serverId!, 'members'), (snap) => {
      members = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
    });
  }

  function watchBans() {
    const db = getDb();
    return onSnapshot(collection(db, 'servers', serverId!, 'bans'), (snap) => {
      bans = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
    });
  }

  function watchChannels() {
    const db = getDb();
    const qRef = query(collection(db, 'servers', serverId!, 'channels'), orderBy('position'));
    return onSnapshot(qRef, (snap) => {
      channels = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    });
  }

  function watchRoles() {
    const db = getDb();
    return onSnapshot(collection(db, 'servers', serverId!, 'roles'), (snap) => {
      roles = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Role));
    });
  }

  $: assignableRoles = roles.filter((role) => {
    const lower = (role.name ?? '').toLowerCase();
    return lower !== 'everyone' && lower !== 'admin';
  });
  $: canManageChannels = isOwner || isAdmin;

  // NEW: watch first N profiles ordered by nameLower (users who have logged in)
  function watchProfiles() {
    const db = getDb();
    const qRef = query(collection(db, 'profiles'), orderBy('nameLower'), limit(200));
    return onSnapshot(qRef, (snap) => {
      allProfiles = snap.docs.map((d) => {
        const p = d.data() as any;
        return {
          uid: d.id,
          displayName: p.displayName ?? p.name ?? '',
          nameLower: p.nameLower ?? (p.displayName || '').toLowerCase(),
          email: p.email ?? '',
          photoURL: p.photoURL ?? ''
        } as Profile;
      });
    });
  }

  onMount(() => {
    let cancelled = false;
    let offMembers: (() => void) | null = null;
    let offBans: (() => void) | null = null;
    let offChannels: (() => void) | null = null;
    let offProfiles: (() => void) | null = null;
    let offRoles: (() => void) | null = null;

    (async () => {
      serverId = $page.params.serverID || ($page.params as any).serverId || null;
      if (!serverId) {
        goto('/');
        return;
      }

      await gate();
      if (cancelled) return;

      offMembers = watchMembers();
      offBans = watchBans();
      offChannels = watchChannels();
      offProfiles = watchProfiles();
      offRoles = watchRoles();
    })();

    return () => {
      cancelled = true;
      offMembers?.();
      offBans?.();
      offChannels?.();
      offProfiles?.();
      offRoles?.();
      pendingInvitesByUid = {};
    };
  });

  // ----- actions: Overview -----
  async function saveOverview() {
    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', serverId!), {
        name: serverName,
        icon: serverIcon && serverIcon.trim().length ? serverIcon : null
      });
      alert('Saved.');
    } catch (e) {
      console.error(e);
      alert('Failed to save.');
    }
  }

  function dataUrlBytes(dataUrl: string): number {
    const base64 = dataUrl.split(',')[1] ?? '';
    return Math.ceil((base64.length * 3) / 4);
  }

  async function compressServerImage(file: File): Promise<string> {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = objectUrl;
      });

      const scale = Math.min(1, ICON_MAX_DIMENSION / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(img.width * scale));
      canvas.height = Math.max(1, Math.floor(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      let quality = 0.92;
      let result = canvas.toDataURL('image/webp', quality);
      while (dataUrlBytes(result) > FIRESTORE_IMAGE_LIMIT && quality > 0.4) {
        quality -= 0.1;
        result = canvas.toDataURL('image/webp', quality);
      }
      if (dataUrlBytes(result) > FIRESTORE_IMAGE_LIMIT) {
        throw new Error('Image is still too large after compression.');
      }
      return result;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function triggerServerIconUpload() {
    serverIconInput?.click();
  }

  async function onServerIconSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      serverIconError = 'Please choose an image file.';
      input.value = '';
      return;
    }
    if (file.size > ICON_MAX_BYTES) {
      serverIconError = 'Image must be smaller than 8 MB.';
      input.value = '';
      return;
    }
    try {
      const processed = await compressServerImage(file);
      serverIcon = processed;
      serverIconError = null;
    } catch (error: any) {
      serverIconError = error?.message ?? 'Could not process the selected file.';
    }
    input.value = '';
  }

  // ----- actions: Members / Roles -----
  async function setRole(uid: string, role: 'admin' | 'member') {
    if (!isOwner && role === 'admin' && !isAdmin) return;
    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', serverId!, 'members', uid), { role });
    } catch (e) {
      console.error(e);
      alert('Failed to update role.');
    }
  }

  async function kick(uid: string) {
    if (!isAdmin) return;
    if (!confirm('Kick this user? They can rejoin with an invite.')) return;
    const db = getDb();
    try {
      await deleteDoc(doc(db, 'servers', serverId!, 'members', uid));
    } catch (e) {
      console.error(e);
      alert('Failed to kick user.');
    }
  }

  async function ban(uid: string) {
    if (!isAdmin) return;
    const reason = prompt('Reason for ban? (optional)') || '';
    if (!confirm('Ban this user? They will be removed and prevented from rejoining.')) return;
    const db = getDb();
    try {
      await setDoc(doc(db, 'servers', serverId!, 'bans', uid), {
        reason,
        bannedAt: Date.now(),
        by: $user?.uid ?? null
      });
      await deleteDoc(doc(db, 'servers', serverId!, 'members', uid));
    } catch (e) {
      console.error(e);
      alert('Failed to ban user.');
    }
  }

  async function unban(uid: string) {
    if (!isAdmin) return;
    const db = getDb();
    try {
      await deleteDoc(doc(db, 'servers', serverId!, 'bans', uid));
    } catch (e) {
      console.error(e);
      alert('Failed to unban user.');
    }
  }

  async function createRole() {
    if (!isAdmin) return;
    const name = newRoleName.trim();
    if (!name) return;
    const db = getDb();
    try {
      await addDoc(collection(db, 'servers', serverId!, 'roles'), {
        name,
        color: newRoleColor || null,
        createdAt: serverTimestamp()
      });
      newRoleName = '';
      newRoleColor = '#5865f2';
    } catch (e) {
      console.error(e);
      alert('Failed to create role.');
    }
  }

  async function deleteRole(roleId: string, roleName: string) {
    if (!isOwner) return;
    const canonical = roleName.trim().toLowerCase();
    if (canonical === 'everyone' || canonical === 'admin') {
      alert('Built-in roles cannot be deleted.');
      return;
    }
    if (!confirm(`Delete role "${roleName}"? This will remove it from members and channels.`)) return;

    const db = getDb();
    try {
      await deleteDoc(doc(db, 'servers', serverId!, 'roles', roleId));

      const membersSnap = await getDocs(collection(db, 'servers', serverId!, 'members'));
      await Promise.all(
        membersSnap.docs.map((m) => {
          const data = m.data() as any;
          if (Array.isArray(data.roleIds) && data.roleIds.includes(roleId)) {
            return updateDoc(m.ref, { roleIds: arrayRemove(roleId) });
          }
          return Promise.resolve();
        })
      );

      const channelsSnap = await getDocs(collection(db, 'servers', serverId!, 'channels'));
      await Promise.all(
        channelsSnap.docs.map((c) => {
          const data = c.data() as any;
          if (Array.isArray(data.allowedRoleIds) && data.allowedRoleIds.includes(roleId)) {
            return updateDoc(c.ref, { allowedRoleIds: arrayRemove(roleId) });
          }
          return Promise.resolve();
        })
      );
    } catch (e) {
      console.error(e);
      alert('Failed to delete role.');
    }
  }

  async function toggleMemberRole(uid: string, roleId: string, enabled: boolean) {
    if (!isAdmin) return;
    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', serverId!, 'members', uid), {
        roleIds: enabled ? arrayUnion(roleId) : arrayRemove(roleId)
      });
    } catch (e) {
      console.error(e);
      alert('Failed to update member roles.');
    }
  }

  async function toggleChannelRole(channelId: string, roleId: string, enabled: boolean) {
    if (!isAdmin) return;
    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', serverId!, 'channels', channelId), {
        allowedRoleIds: enabled ? arrayUnion(roleId) : arrayRemove(roleId)
      });
    } catch (e) {
      console.error(e);
      alert('Failed to update channel access.');
    }
  }

  async function toggleRolePermission(roleId: string, key: 'reorderChannels', enabled: boolean) {
    if (!isAdmin) return;
    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', serverId!, 'roles', roleId), {
        [`permissions.${String(key)}`]: enabled
      });
    } catch (e) {
      console.error(e);
      alert('Failed to update role permissions.');
    }
  }

  // ----- actions: Channels -----
  async function renameChannel(id: string, oldName: string) {
    if (!isAdmin) return;
    const name = prompt('Rename channel to:', oldName);
    if (!name || name.trim() === oldName) return;
    const db = getDb();
    try {
      await updateDoc(doc(db, 'servers', serverId!, 'channels', id), { name: name.trim() });
    } catch (e) {
      console.error(e);
      alert('Failed to rename channel.');
    }
  }

  async function deleteChannel(id: string, name: string) {
    if (!isAdmin) return;
    if (!confirm(`Delete channel ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“#${name}ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â? This cannot be undone.`)) return;
    const db = getDb();
    try {
      await deleteDoc(doc(db, 'servers', serverId!, 'channels', id));
    } catch (e) {
      console.error(e);
      alert('Failed to delete channel.');
    }
  }

  // ----- actions: Danger Zone (owner only) -----
  async function deleteServer() {
    if (!isOwner) return;
    if (!confirm('Delete this server and all its data? This cannot be undone.')) return;

    const db = getDb();
    try {
      const colls = ['channels', 'members', 'bans'];
      for (const c of colls) {
        const snap = await getDocs(collection(db, 'servers', serverId!, c));
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      }
      await deleteDoc(doc(db, 'servers', serverId!));
      alert('Server deleted.');
      goto('/'); // go home
    } catch (e) {
      console.error(e);
      alert('Failed to delete server. (Consider a Cloud Function for large deletes.)');
    }
  }

  // ===== INLINE INVITE (filter in-memory; no dialogs) =====
  let search = '';
  $: q = (search || '').trim().toLowerCase();

  // Derived: filter and exclude users already in this server (optional)
  $: memberSet = new Set(members.map(m => m.uid));
  $: filtered = allProfiles
    .filter(p => {
      // donÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢t show people already in the server
      if (memberSet.has(p.uid)) return false;
      if (!q) return true;
      const n = (p.nameLower || '').toLowerCase();
      const d = (p.displayName || '').toLowerCase();
      const e = (p.email || '').toLowerCase();
      const u = (p.uid || '').toLowerCase();
      return n.includes(q) || d.includes(q) || e.includes(q) || u.includes(q);
    })
    .slice(0, 50); // keep list tidy

  $: if (members.length && Object.keys(pendingInvitesByUid).length) {
    const memberIds = new Set(members.map((m) => m.uid));
    const next = { ...pendingInvitesByUid };
    let changed = false;
    for (const uid of memberIds) {
      if (next[uid]) {
        delete next[uid];
        changed = true;
      }
    }
    if (changed) pendingInvitesByUid = next;
  }

  // invite to first text channel (keeps your current accept flow)
  async function inviteUser(toUid: string) {
    if (!(isOwner || isAdmin)) return;
    if (!isOwner) { // matches your current security rules
      alert('Per current security rules, only channel owners can send invites.');
      return;
    }
    const fallback = channels.find((c) => c.type === 'text') ?? channels[0];
    if (!fallback) { alert('Create a channel first.'); return; }

    if (pendingInvitesByUid[toUid]) {
      console.debug('[ServerSettings] inviteUser skipped; pending invite already exists', {
        toUid,
        invite: pendingInvitesByUid[toUid]
      });
      return;
    }

    const fromUid = $user?.uid;
    if (!fromUid) {
      inviteError = 'You must be signed in to send invites.';
      return;
    }

    inviteError = null;
    inviteLoading = { ...inviteLoading, [toUid]: true };
    try {
      const res = await sendServerInvite({
        toUid,
        fromUid,
        serverId: serverId!,
        serverName: serverName || serverId!,
        serverIcon,
        channelId: fallback.id,
        channelName: fallback.name || 'general'
      });
      if (!res.ok) {
        inviteError = `Failed to invite ${toUid}: ${res.error ?? 'Unknown error'}`;
        console.debug('[ServerSettings] sendServerInvite failed', { toUid, res });
        if (pendingInvitesByUid[toUid]) {
          const { [toUid]: _, ...rest } = pendingInvitesByUid;
          pendingInvitesByUid = rest;
        }
      } else {
        pendingInvitesByUid = { ...pendingInvitesByUid, [toUid]: true };
        if (res.alreadyExisted) {
          inviteError = `User already has a pending invite.`;
          console.debug('[ServerSettings] sendServerInvite already existed', { toUid, res });
        } else {
          console.debug('[ServerSettings] sendServerInvite ok', { toUid, res });
        }
      }
      (window as any)?.navigator?.vibrate?.(10);
    } catch (e) {
      console.error('[ServerSettings] inviteUser error', e);
      inviteError = (e as Error)?.message ?? 'Failed to send invite.';
    }
    inviteLoading = { ...inviteLoading, [toUid]: false };
  }
</script>

<svelte:head>
  <title>Server Settings</title>
</svelte:head>

{#if allowed}
  <div class="settings-shell">
    <div class="settings-container">

      <!-- header -->
      <div class="settings-header">
        <button
          type="button"
          class="settings-back"
          aria-label="Go back"
          title="Back"
          on:click={goBack}
        >
          <i class="bx bx-left-arrow-alt text-xl leading-none"></i>
        </button>

        <div class="settings-heading">
          <h1>Server Settings</h1>
          <p>Manage roles, members, channels, and dangerous actions.</p>
        </div>
      </div>

      <!-- tabs -->
      <div class="settings-tabbar" role="tablist" aria-label="Server settings sections">
        {#each tabItems as item}
          <button
            type="button"
            role="tab"
            class="settings-tab"
            class:is-active={tab === item.id}
            aria-selected={tab === item.id}
            on:click={() => (tab = item.id)}
          >
            {item.label}
          </button>
        {/each}
      </div>

      <!-- overview -->
      {#if tab === 'overview'}
        <div class="settings-stack">
          <div class="settings-card">
            <div>
              <div class="settings-card__title">Server profile</div>
              <div class="settings-card__subtitle">Update the basics everyone sees in the sidebar.</div>
            </div>
            <div class="settings-grid settings-grid--two">
              <div>
                <label class="settings-label" for="server-name">Server name</label>
                <input
                  id="server-name"
                  class="input"
                  bind:value={serverName}
                  aria-label="Server name"
                />
              </div>
              <div>
                <label class="settings-label" for="server-icon-url">Server icon (URL or upload)</label>
                <div class="flex flex-col gap-2">
                  <input
                    id="server-icon-url"
                    class="input"
                    type="url"
                    bind:value={serverIcon}
                    placeholder="https://example.com/icon.png"
                    inputmode="url"
                    aria-label="Server icon URL"
                  />
                  <div class="flex flex-wrap gap-2">
                    <button type="button" class="btn btn-ghost btn-sm" on:click={triggerServerIconUpload}>
                      Upload image
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      on:click={() => {
                        serverIcon = '';
                        serverIconError = null;
                      }}
                      disabled={!serverIcon}
                    >
                      Clear icon
                    </button>
                  </div>
                  <input
                    class="hidden"
                    type="file"
                    accept="image/*"
                    bind:this={serverIconInput}
                    on:change={onServerIconSelected}
                  />
                  {#if serverIconError}
                    <p class="text-xs text-red-300">{serverIconError}</p>
                  {/if}
                  {#if serverIcon}
                    <div class="mt-1 flex items-center gap-3">
                      <img src={serverIcon} alt="Server icon preview" class="h-14 w-14 rounded-full border border-subtle object-cover" />
                      <span class="text-xs text-soft">Tap save to apply changes.</span>
                    </div>
                  {:else}
                    <p class="text-xs text-soft">Supported formats: JPG, PNG, GIF up to 8&nbsp;MB. Larger images are compressed automatically.</p>
                  {/if}
                </div>
              </div>
            </div>
            <div class="settings-actions">
              <button type="button" class="btn btn-primary h-10 px-5" on:click={saveOverview}>Save changes</button>
            </div>
          </div>
        </div>
      {/if}
      <!-- members -->
      {#if tab === 'members'}
        <div class="settings-card settings-invite">
          <div class="settings-invite__row">
            <div class="settings-invite__icon">
              <i class="bx bx-user-plus text-xl" aria-hidden="true"></i>
            </div>
            <input
              class="input input--compact settings-invite__input"
              placeholder="Invite people by name, email, or UIDÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦"
              bind:value={search}
            />
          </div>

          <div class="settings-invite__results">
            {#if !q}
              <div class="settings-invite__empty">Type to filter users who have logged in.</div>
            {:else if filtered.length === 0}
              <div class="settings-invite__empty">No users match ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ{search}ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â.</div>
            {:else}
              {#each filtered as r (r.uid)}
                <div class="settings-invite__results-row">
                  <img
                    src={r.photoURL || ''}
                    alt=""
                    class="settings-invite__avatar"
                    on:error={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                  />
                  <div class="flex-1 min-w-0">
                    <div class="truncate">{r.displayName || r.email || r.uid}</div>
                    {#if r.email}<div class="text-xs text-soft truncate">{r.email}</div>{/if}
                  </div>
                  {#if isOwner || isAdmin}
                    <button
                      class="btn btn-primary btn-sm"
                      disabled={!isOwner || pendingInvitesByUid[r.uid] || inviteLoading[r.uid]}
                      on:click={() => inviteUser(r.uid)}
                    >
                      {#if pendingInvitesByUid[r.uid]}
                        Sent
                      {:else if inviteLoading[r.uid]}
                        SendingÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦
                      {:else}
                        Invite
                      {/if}
                    </button>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>

          {#if inviteError}
            <div class="settings-alert settings-alert--error">{inviteError}</div>
          {/if}

          {#if (isOwner || isAdmin) && !isOwner}
            <div class="settings-caption">Only the channel owner can send invites under current rules.</div>
          {/if}
        </div>

        <!-- current members list -->
        <div class="settings-card space-y-3">
          {#if members.length === 0}
            <div class="text-white/60">No members yet.</div>
          {/if}
          {#each members as m (m.uid)}
            <div class="p-2 rounded hover:bg-white/10 space-y-2">
              <div class="settings-member-row">
                <img src={m.photoURL || ''} alt="" class="h-9 w-9 rounded-full bg-white/10"
                     on:error={(e)=>((e.target as HTMLImageElement).style.display='none')} />
                <div class="flex-1 min-w-0">
                  <div class="truncate">{m.displayName || m.uid}</div>
                  <div class="text-xs text-white/50">{m.role || 'member'}</div>
                </div>

                {#if isOwner || isAdmin}
                  <div class="settings-member-row__actions">
                    <button class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                      disabled={!isOwner && m.role === 'admin'}
                      on:click={() => setRole(m.uid, 'member')}>Member</button>
                    <button class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                      on:click={() => setRole(m.uid, 'admin')}>Admin</button>
                  </div>
                {/if}

                {#if isOwner || isAdmin}
                  <div class="settings-member-row__moderation">
                    <button class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                      on:click={() => kick(m.uid)}>Kick</button>
                    <button class="px-2 py-1 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60"
                      on:click={() => ban(m.uid)}>Ban</button>
                  </div>
                {/if}
              </div>

              {#if assignableRoles.length > 0}
                <div class="pl-12 flex flex-wrap gap-2 text-[12px] text-white/70">
                  {#each assignableRoles as role}
                    <label class="settings-chip">
                      <input
                        type="checkbox"
                        checked={Array.isArray(m.roleIds) && m.roleIds.includes(role.id)}
                        disabled={!isAdmin}
                        on:change={(e) => toggleMemberRole(m.uid, role.id, (e.currentTarget as HTMLInputElement).checked)}
                      />
                      <span>{role.name}</span>
                    </label>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>

        <div class="settings-card settings-card--muted mt-6 space-y-2">
          <div class="text-sm text-white/70 mb-2">Bans</div>
          {#if bans.length === 0}
            <div class="text-white/60">No banned users.</div>
          {/if}
          {#each bans as b (b.uid)}
            <div class="flex items-center justify-between p-2 rounded hover:bg-white/10">
              <div>
                <div class="font-medium">{b.uid}</div>
                {#if b.reason}<div class="text-xs text-white/60">Reason: {b.reason}</div>{/if}
              </div>
              {#if isOwner || isAdmin}
                <button class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                  on:click={() => unban(b.uid)}>Unban</button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <!-- channels -->
      {#if tab === 'channels'}
        <div class="settings-card space-y-3">
          {#if channels.length === 0}
            <div class="text-white/60">No channels yet.</div>
          {/if}
          {#each channels as c (c.id)}
            <div class="flex flex-col gap-2 p-2 rounded hover:bg-white/10">
              <div class="settings-channel-row">
                <div class="w-6 text-center">
                  {#if c.type === 'text'}<i class="bx bx-hash" aria-hidden="true"></i>{:else}<i class="bx bx-headphone" aria-hidden="true"></i>{/if}
                </div>
                <div class="flex-1 truncate">{c.name}</div>
                {#if isOwner || isAdmin}
                  <div class="settings-channel-row__actions">
                    <button class="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/15"
                      on:click={() => renameChannel(c.id, c.name)}>Rename</button>
                    <button class="px-2 py-1 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60"
                      on:click={() => deleteChannel(c.id, c.name)}>Delete</button>
                  </div>
                {/if}
              </div>
              {#if roles.length > 0}
                <div class="pl-6 pr-3 pb-2 text-[12px] text-white/60 flex flex-wrap items-center gap-2">
                  <span class="opacity-70">Allowed roles:</span>
                  <div class="flex flex-wrap gap-2">
                    {#each roles as role}
                      <label class="settings-chip">
                        <input
                          type="checkbox"
                          checked={Array.isArray(c.allowedRoleIds) && c.allowedRoleIds.includes(role.id)}
                          disabled={!canManageChannels}
                          on:change={(e) => toggleChannelRole(c.id, role.id, (e.currentTarget as HTMLInputElement).checked)}
                        />
                        <span>{role.name}</span>
                      </label>
                    {/each}
                  </div>
                  {#if !c.allowedRoleIds || c.allowedRoleIds.length === 0}
                    <span class="text-white/40">Everyone</span>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if tab === 'roles'}
        <div class="settings-card space-y-4">
          <form class="flex flex-col sm:flex-row gap-2 sm:items-center" on:submit|preventDefault={createRole}>
            <input
              class="flex-1 rounded bg-white/10 px-3 py-2"
              placeholder="Role name (e.g. Moderator)"
              bind:value={newRoleName}
            />
            <input
              class="h-10 w-20 rounded bg-white/10 border border-white/10"
              type="color"
              bind:value={newRoleColor}
              title="Role color"
            />
            <button
              type="submit"
              class="px-4 py-2 rounded bg-[#5865f2] hover:bg-[#4955d4] disabled:opacity-60"
              disabled={!newRoleName.trim() || !isAdmin}
            >
              Create
            </button>
          </form>

          {#if roles.length === 0}
            <div class="text-white/60 text-sm">No custom roles yet. Use the form above to add one.</div>
          {:else}
            <div class="space-y-2">
              {#each roles as role}
                <div class="settings-role-row">
                  <div class="settings-role-row__meta">
                    <span
                      class="inline-block w-3 h-3 rounded-full ring-2 ring-white/20"
                      style={`background:${role.color || '#33c8bf'}`}
                    ></span>
                    <div class="min-w-0">
                      <div class="font-medium truncate">{role.name}</div>
                      {#if role.color}
                        <div class="text-xs text-white/50">{role.color}</div>
                      {/if}
                    </div>
                  </div>
                  <div class="settings-role-row__actions">
                    <label class="flex items-center gap-2 text-xs text-white/70 select-none">
                      <input
                        type="checkbox"
                        checked={!!role.permissions?.reorderChannels}
                        disabled={!isAdmin}
                        on:change={(e) => toggleRolePermission(role.id, 'reorderChannels', (e.currentTarget as HTMLInputElement).checked)}
                      />
                      <span>Can reorder channels</span>
                    </label>
                    <button
                      class="px-3 py-1 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60 disabled:opacity-50"
                      on:click={() => deleteRole(role.id, role.name)}
                      disabled={!isOwner}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- danger -->
      {#if tab === 'danger'}
        <div class="settings-card settings-card--danger">
          <div>
            <div class="settings-card__title text-red-200">Danger Zone</div>
            <p class="settings-card__subtitle text-red-200/80">
              Deleting the server will remove channels, members, and bans. This cannot be undone.
            </p>
          </div>
          <div class="settings-actions justify-start">
            <button
              class="btn btn-sm"
              disabled={!isOwner}
              on:click={deleteServer}
            >
              Delete Server
            </button>
            {#if !isOwner}
              <span class="settings-caption text-red-200/85">Only the owner can delete the server.</span>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .settings-shell {
    min-height: 100dvh;
    background: var(--color-app-bg);
    color: var(--color-text-primary);
    padding-bottom: max(env(safe-area-inset-bottom), 4rem);
  }

  .settings-container {
    width: min(100%, 960px);
    margin: 0 auto;
    padding: clamp(1.25rem, 4vw, 2.5rem) clamp(1rem, 6vw, 3rem);
    display: flex;
    flex-direction: column;
    gap: clamp(1rem, 2.5vw, 1.75rem);
  }

  .settings-header {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: flex-start;
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-panel) 94%, transparent);
    border: 1px solid var(--color-border-subtle);
    box-shadow: var(--shadow-elevated);
    padding: clamp(1.25rem, 2.8vw, 1.75rem);
  }

  @media (min-width: 640px) {
    .settings-header {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
  }

  .settings-back {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 78%, transparent);
    color: var(--color-text-primary);
    display: grid;
    place-items: center;
    transition: background 150ms ease, border 150ms ease, transform 150ms ease;
  }

  .settings-back:hover {
    background: color-mix(in srgb, var(--color-panel) 86%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
    transform: translateY(-1px);
  }

  .settings-heading h1 {
    margin: 0;
    font-size: clamp(1.6rem, 3vw, 2.2rem);
    font-weight: 600;
  }

  .settings-heading p {
    margin: 0.3rem 0 0;
    font-size: 0.95rem;
    color: var(--text-60);
    max-width: 40ch;
  }

  .settings-tabbar {
    display: flex;
    gap: 0.45rem;
    overflow-x: auto;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--color-panel) 84%, transparent);
    border: 1px solid var(--color-border-subtle);
    padding: 0.3rem;
    scroll-snap-type: x proximity;
    -webkit-overflow-scrolling: touch;
  }

  .settings-tabbar::-webkit-scrollbar {
    display: none;
  }

  .settings-tabbar {
    scrollbar-width: none;
  }

  .settings-tab {
    border: 1px solid transparent;
    border-radius: var(--radius-pill);
    padding: 0.45rem 1.1rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-70);
    background: transparent;
    transition: background 150ms ease, color 150ms ease, border 150ms ease, box-shadow 150ms ease;
    white-space: nowrap;
    scroll-snap-align: start;
  }

  .settings-tab:is(:hover, :focus-visible) {
    background: color-mix(in srgb, var(--color-panel) 92%, transparent);
    color: var(--color-text-primary);
  }

  .settings-tab.is-active {
    background: var(--color-accent-soft);
    color: var(--color-accent-strong);
    border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
    box-shadow: 0 12px 24px rgba(51, 200, 191, 0.22);
  }

  .settings-stack {
    display: flex;
    flex-direction: column;
    gap: clamp(1rem, 2vw, 1.5rem);
  }

  .settings-card {
    background: color-mix(in srgb, var(--color-panel) 95%, transparent);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-elevated);
    padding: clamp(1.1rem, 2.4vw, 1.6rem);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .settings-card--muted {
    background: color-mix(in srgb, var(--color-panel-muted) 92%, transparent);
  }

  .settings-card--danger {
    background: color-mix(in srgb, var(--color-danger) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-danger) 45%, transparent);
    box-shadow: 0 18px 30px rgba(223, 95, 95, 0.25);
  }

  .settings-card__title {
    font-size: 0.95rem;
    font-weight: 600;
  }

  .settings-card__subtitle {
    font-size: 0.85rem;
    color: var(--text-60);
    margin-top: 0.2rem;
  }

  .settings-grid {
    display: grid;
    gap: clamp(1rem, 2vw, 1.5rem);
  }

  .settings-grid--two {
    grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
  }

  .settings-label {
    display: block;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-70);
    margin-bottom: 0.35rem;
  }

  .settings-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .settings-actions.justify-start {
    justify-content: flex-start;
  }

  .settings-invite {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .settings-invite__row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .settings-invite__icon {
    width: 2.6rem;
    height: 2.6rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 78%, transparent);
    color: var(--color-accent-strong);
    display: grid;
    place-items: center;
  }

  .settings-invite__input {
    flex: 1;
    min-width: 220px;
  }

  .settings-invite__results {
    max-height: 18rem;
    overflow-y: auto;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-panel) 90%, transparent);
  }

  .settings-invite__results::-webkit-scrollbar {
    width: 6px;
  }

  .settings-invite__results::-webkit-scrollbar-track {
    background: transparent;
  }

  .settings-invite__results::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
    border-radius: 9999px;
  }

  .settings-invite__results-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.85rem;
    transition: background 150ms ease;
  }

  .settings-invite__results-row:hover {
    background: color-mix(in srgb, var(--color-panel) 85%, transparent);
  }

  .settings-invite__avatar {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--radius-pill);
    object-fit: cover;
    background: color-mix(in srgb, var(--color-panel-muted) 80%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 75%, transparent);
  }

  .settings-invite__empty {
    padding: 0.75rem 0.85rem;
    font-size: 0.85rem;
    color: var(--text-60);
  }

  .settings-alert {
    border-radius: var(--radius-md);
    padding: 0.65rem 0.85rem;
    font-size: 0.8rem;
  }

  .settings-alert--error {
    background: color-mix(in srgb, var(--color-danger) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-danger) 45%, transparent);
    color: color-mix(in srgb, var(--color-danger) 75%, white);
  }

  .settings-caption {
    font-size: 0.72rem;
    color: var(--text-60);
  }

  .settings-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 85%, transparent);
    background: color-mix(in srgb, var(--color-panel) 88%, transparent);
    padding: 0.45rem 0.8rem;
    font-size: 0.75rem;
    color: var(--text-70);
  }

  .btn-sm {
    padding: 0.45rem 0.85rem;
    font-size: 0.8rem;
    border-radius: var(--radius-pill);
    line-height: 1;
    min-height: 0;
  }

  .settings-card--danger .btn-sm {
    background: var(--color-danger);
    border-color: color-mix(in srgb, var(--color-danger) 60%, transparent);
    color: var(--color-text-inverse);
  }

  .settings-card--danger .btn-sm:hover {
    background: color-mix(in srgb, var(--color-danger) 85%, transparent);
    color: var(--color-text-inverse);
  }

  .settings-member-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .settings-member-row__actions,
  .settings-member-row__moderation {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .settings-channel-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .settings-channel-row__actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .settings-role-row {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-panel) 90%, transparent);
    padding: 0.85rem clamp(0.85rem, 2vw, 1rem);
  }

  .settings-role-row__meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .settings-role-row__actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  @media (max-width: 560px) {
    .settings-container {
      padding: 1.25rem clamp(0.85rem, 6vw, 1.4rem);
    }

    .settings-header {
      padding: 1.1rem;
      border-radius: var(--radius-md);
    }

    .settings-heading h1 {
      font-size: 1.45rem;
    }

    .settings-heading p {
      font-size: 0.85rem;
    }

    .settings-tab {
      padding: 0.4rem 0.85rem;
      font-size: 0.82rem;
    }

    .settings-card {
      padding: 1.05rem;
      border-radius: var(--radius-md);
    }

    .settings-invite__row {
      align-items: stretch;
    }

    .settings-invite__input {
      min-width: 100%;
    }

    .settings-member-row {
      align-items: flex-start;
      gap: 0.9rem;
    }

    .settings-member-row__actions,
    .settings-member-row__moderation,
    .settings-channel-row__actions {
      width: 100%;
      justify-content: flex-start;
    }

    .settings-channel-row {
      align-items: flex-start;
      gap: 0.9rem;
    }

    .settings-role-row {
      border-radius: var(--radius-md);
    }

    .settings-actions {
      justify-content: center;
    }
  }
</style>














