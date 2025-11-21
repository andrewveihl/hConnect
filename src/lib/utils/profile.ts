const DEFAULT_AVATAR_URL = '/default-avatar.svg';

export function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export function resolveProfilePhotoURL(record: any, fallback?: string | null): string | null {
  const avatar = pickString(record?.avatar) ?? pickString(record?.avatarUrl) ?? pickString(record?.avatarURL);
  if (avatar) return avatar;

  const custom = pickString(record?.customPhotoURL);
  if (custom) return custom;

  const provider = pickString(record?.authPhotoURL);
  if (provider) return provider;

  const stored = pickString(record?.photoURL) ?? pickString(record?.photoUrl);
  if (stored) return stored;

  return pickString(fallback) ?? DEFAULT_AVATAR_URL;
}
