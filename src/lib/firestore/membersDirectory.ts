import { getDb } from '$lib/firebase';
import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { resolveProfilePhotoURL } from '$lib/utils/profile';

export type MentionDirectoryEntry = {
  uid: string;
  label: string;
  handle: string;
  avatar: string | null;
  search: string;
  aliases: string[];
  kind?: 'member' | 'role';
  color?: string | null;
  roleId?: string | null;
};

type GenericRecord = Record<string, unknown>;

function canonical(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function labelFor(member: GenericRecord | undefined, profile: GenericRecord | undefined): string {
  const sources = [
    member?.nickname,
    member?.displayName,
    member?.name,
    profile?.displayName,
    profile?.name,
    profile?.email,
    member?.email
  ];
  for (const candidate of sources) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length) return trimmed;
    }
  }
  return 'Member';
}

function buildHandle(label: string, uid: string): string {
  const base = canonical(label) || 'member';
  const suffix = uid.slice(-4).toLowerCase();
  return `${base}${suffix}`;
}

function buildAliases(entry: {
  label: string;
  handle: string;
  member?: GenericRecord;
  profile?: GenericRecord;
}) {
  const set = new Set<string>();
  const add = (value: unknown) => {
    const canon = canonical(value);
    if (canon) set.add(canon);
  };

  add(entry.label);
  add(entry.handle);
  const parts = entry.label.split(/\s+/).filter(Boolean);
  parts.forEach(add);
  add(parts.join(''));

  if (entry.member) {
    add(entry.member.nickname);
    add(entry.member.displayName);
    add(entry.member.name);
    add(entry.member.email ? String(entry.member.email).split('@')[0] : null);
  }
  if (entry.profile) {
    add(entry.profile.displayName);
    add(entry.profile.name);
    add(entry.profile.email ? String(entry.profile.email).split('@')[0] : null);
  }

  return Array.from(set);
}

export function subscribeServerDirectory(
  serverId: string,
  cb: (entries: MentionDirectoryEntry[]) => void
): Unsubscribe {
  const db = getDb();
  const membersRef = collection(db, 'servers', serverId, 'members');

  const members = new Map<string, GenericRecord>();
  const profiles = new Map<string, GenericRecord>();
  const profileStops = new Map<string, Unsubscribe>();

  const emit = () => {
    const list: MentionDirectoryEntry[] = [];
    members.forEach((member, uid) => {
      const profile = profiles.get(uid);
      const label = labelFor(member, profile);
      const handle = buildHandle(label, uid);
      const rawMemberPhoto = member?.photoURL;
      const memberPhoto = typeof rawMemberPhoto === 'string' ? rawMemberPhoto : undefined;
      const avatar = resolveProfilePhotoURL(profile, memberPhoto);
      const aliases = buildAliases({ label, handle, member, profile });
      const searchParts = [label, handle, member?.email, profile?.email]
        .map((part) => (typeof part === 'string' ? part : ''))
        .filter(Boolean);
      list.push({
        uid,
        label,
        handle,
        avatar,
        search: searchParts.join(' ').toLowerCase(),
        aliases,
        kind: 'member',
        color: null,
        roleId: null
      });
    });
    list.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    cb(list);
  };

  function ensureProfile(uid: string) {
    if (profileStops.has(uid)) return;
    const ref = doc(db, 'profiles', uid);
    const stop = onSnapshot(
      ref,
      (snap) => {
        profiles.set(uid, (snap.data() ?? {}) as GenericRecord);
        emit();
      },
      () => {
        profiles.delete(uid);
        emit();
      }
    );
    profileStops.set(uid, stop);
  }

  const stopMembers = onSnapshot(
    membersRef,
    (snap) => {
      const seen = new Set<string>();
      snap.forEach((docSnap) => {
        const uid = docSnap.id;
        seen.add(uid);
        members.set(uid, { uid, ...(docSnap.data() as GenericRecord) });
        ensureProfile(uid);
      });
      members.forEach((_, uid) => {
        if (!seen.has(uid)) {
          members.delete(uid);
          profiles.delete(uid);
          profileStops.get(uid)?.();
          profileStops.delete(uid);
        }
      });
      emit();
    },
    () => {
      members.clear();
      profiles.clear();
      profileStops.forEach((stop) => stop());
      profileStops.clear();
      emit();
    }
  );

  return () => {
    stopMembers();
    profileStops.forEach((stop) => stop());
    profileStops.clear();
    members.clear();
    profiles.clear();
  };
}
