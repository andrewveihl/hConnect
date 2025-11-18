import type { MentionDirectoryEntry } from '$lib/firestore/membersDirectory';

export const SPECIAL_MENTION_IDS = {
  EVERYONE: 'special:mention:everyone',
  HERE: 'special:mention:here'
} as const;

export type SpecialMentionId = (typeof SPECIAL_MENTION_IDS)[keyof typeof SPECIAL_MENTION_IDS];

const SPECIAL_ID_SET = new Set<string>(Object.values(SPECIAL_MENTION_IDS));

export const SPECIAL_MENTIONS: MentionDirectoryEntry[] = [
  {
    uid: SPECIAL_MENTION_IDS.EVERYONE,
    label: 'everyone',
    handle: 'everyone',
    avatar: null,
    search: 'everyone all channel announcement',
    aliases: ['everyone', 'all', 'channel', 'announcement'],
    kind: 'special',
    color: '#fb923c',
    roleId: null
  },
  {
    uid: SPECIAL_MENTION_IDS.HERE,
    label: 'here',
    handle: 'here',
    avatar: null,
    search: 'here online active',
    aliases: ['here', 'online', 'active'],
    kind: 'special',
    color: '#38bdf8',
    roleId: null
  }
];

export const isSpecialMentionId = (uid: string | null | undefined): uid is SpecialMentionId => {
  if (typeof uid !== 'string') return false;
  return SPECIAL_ID_SET.has(uid);
};

export const isEveryoneMentionId = (uid: string | null | undefined) =>
  uid === SPECIAL_MENTION_IDS.EVERYONE;

export const isHereMentionId = (uid: string | null | undefined) =>
  uid === SPECIAL_MENTION_IDS.HERE;
