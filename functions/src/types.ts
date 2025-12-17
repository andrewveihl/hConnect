import type { Timestamp } from 'firebase-admin/firestore';

export type MentionKind = 'member' | 'role' | 'special';

export type MentionType = 'direct' | 'role' | 'here' | 'everyone' | 'dm' | 'channel';

export type MentionEntry = {
  uid: string;
  handle?: string | null;
  label?: string | null;
  color?: string | null;
  kind?: MentionKind;
};

export type RawMessage = {
  uid?: string;
  authorId?: string;
  displayName?: string | null;
  author?: { displayName?: string | null; photoURL?: string | null };
  text?: string | null;
  content?: string | null;
  plainTextContent?: string | null;
  type?: string;
  mentions?: MentionEntry[];
  mentionsMap?: Record<string, MentionEntry>;
  createdAt?: Timestamp | FirebaseFirestore.Timestamp | null;
  preview?: string | null;
};

export type ServerDoc = {
  name?: string;
  icon?: string | null;
  defaultRoleId?: string | null;
  everyoneRoleId?: string | null;
};

export type ChannelDoc = {
  name?: string;
  type?: 'text' | 'voice';
  allowedRoleIds?: string[];
};

export type ThreadDoc = {
  name?: string;
};

export type DmDoc = {
  participants?: string[];
  participantUids?: string[];
  participantsMap?: Record<string, boolean | null | undefined>;
  key?: string | null;
  name?: string | null;
  title?: string | null;
  lastMessage?: string | null;
};

export type ServerMember = {
  uid: string;
  role?: string;
  roleIds?: string[];
  nickname?: string | null;
  muted?: boolean;
};

export type NotificationSettings = {
  globalMute: boolean;
  muteDMs: boolean;
  muteServerIds: string[];
  perChannelMute: Record<string, boolean>;
  perRoleMute: Record<string, boolean>;
  allowMentionPush: boolean;
  allowDMPreview: boolean;
  allowActivityBadges: boolean;
  allowThreadPush: boolean;
  allowRoleMentionPush: boolean;
  allowHereMentionPush: boolean;
  allowEveryoneMentionPush: boolean;
  allowChannelMessagePush: boolean;
  doNotDisturbUntil: number | null;
};

export type PresenceDoc = {
  state?: string | null;
  status?: string | null;
};

export type WebPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

export type DeviceDoc = {
  token?: string | null;
  permission?: string | null;
  enabled?: boolean;
  platform?: string | null;
  subscription?: WebPushSubscription | null;
};
