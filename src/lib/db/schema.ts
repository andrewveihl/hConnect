export type PermissionKey =
  | 'manageServer' | 'manageRoles' | 'manageChannels' | 'kickMembers' | 'banMembers'
  | 'viewChannels' | 'sendMessages' | 'manageMessages' | 'connectVoice' | 'speakVoice';

export type Role = {
  id: string;
  name: string;
  color?: string | null;
  position: number;
  permissions: Record<PermissionKey, boolean>;
};
