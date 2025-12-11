const DEFAULT_AVATAR_URL = '/default-avatar.svg';

function cleanUrl(value: unknown): string | null {
  const str = pickString(value);
  if (!str) return null;
  const lowered = str.toLowerCase();
  if (['undefined', 'null', 'none', 'false', '0'].includes(lowered)) return null;
  return str;
}

export function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export function resolveProfilePhotoURL(record: any, fallback?: string | null): string | null {
  const avatar =
    cleanUrl(record?.avatar) ?? cleanUrl(record?.avatarUrl) ?? cleanUrl(record?.avatarURL);
  if (avatar) return avatar;

  const custom = cleanUrl(record?.customPhotoURL);
  if (custom) return custom;

  const provider = cleanUrl(record?.authPhotoURL) ?? cleanUrl(record?.photo) ?? cleanUrl(record?.picture);
  if (provider) return provider;

  const stored =
    cleanUrl(record?.photoURL) ?? cleanUrl(record?.photoUrl) ?? cleanUrl(record?.photoUri) ?? cleanUrl(record?.image);
  if (stored) return stored;

  const cleanedFallback = cleanUrl(fallback);
  if (cleanedFallback) return cleanedFallback;

  return DEFAULT_AVATAR_URL;
}
