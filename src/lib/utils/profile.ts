export const DEFAULT_AVATAR_URL = '/default-avatar.svg';

function cleanUrl(value: unknown): string | null {
  const str = pickString(value);
  if (!str) return null;
  const lowered = str.toLowerCase();
  if (['undefined', 'null', 'none', 'false', '0'].includes(lowered)) return null;
  // Filter out placeholder/invalid URLs
  if (str.startsWith('blob:') && str.includes('undefined')) return null;
  return str;
}

export function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

/**
 * Check if a URL looks like a valid Google profile photo URL
 */
export function isGooglePhotoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes('googleusercontent.com') || 
         url.includes('lh3.google.com') ||
         url.includes('lh4.google.com') ||
         url.includes('lh5.google.com') ||
         url.includes('lh6.google.com');
}

/**
 * Resolves the best available profile photo URL from various possible fields.
 * 
 * Priority order:
 * 1. Custom uploaded avatar (avatar, avatarUrl, avatarURL)
 * 2. Custom photo URL (customPhotoURL)
 * 3. Cached Firebase Storage URL (cachedPhotoURL)
 * 4. Auth provider photo (authPhotoURL, photo, picture) - includes Google photos
 * 5. Generic stored photo (photoURL, photoUrl, photoUri, image)
 * 6. Fallback parameter
 * 7. Default avatar
 * 
 * @param record - Object containing potential photo URL fields
 * @param fallback - Optional fallback URL if no photo is found in record
 * @param options - Optional configuration
 * @returns The resolved photo URL or default avatar
 */
export function resolveProfilePhotoURL(
  record: any, 
  fallback?: string | null,
  options?: { preferGooglePhoto?: boolean }
): string | null {
  const { preferGooglePhoto = false } = options ?? {};

  // Check for custom avatar first (user uploaded)
  const avatar =
    cleanUrl(record?.avatar) ?? cleanUrl(record?.avatarUrl) ?? cleanUrl(record?.avatarURL);
  if (avatar) return avatar;

  const custom = cleanUrl(record?.customPhotoURL);
  if (custom) return custom;

  // Prefer cached Firebase Storage URL over external provider URLs
  const cached = cleanUrl(record?.cachedPhotoURL);
  if (cached) return cached;

  // Auth provider photo (Google, etc.)
  const provider = cleanUrl(record?.authPhotoURL) ?? cleanUrl(record?.photo) ?? cleanUrl(record?.picture);
  
  // Generic stored photo
  const stored =
    cleanUrl(record?.photoURL) ?? cleanUrl(record?.photoUrl) ?? cleanUrl(record?.photoUri) ?? cleanUrl(record?.image);

  // If preferGooglePhoto is set and we have a Google URL in auth, prioritize it
  if (preferGooglePhoto && provider && isGooglePhotoUrl(provider)) {
    return provider;
  }

  // Standard resolution: provider first, then stored
  if (provider) return provider;
  if (stored) return stored;

  const cleanedFallback = cleanUrl(fallback);
  if (cleanedFallback) return cleanedFallback;

  return DEFAULT_AVATAR_URL;
}

/**
 * Get the Google/auth photo URL from a user record if available
 * This can be used to offer "Use Google Photo" functionality
 */
export function getAuthPhotoURL(record: any): string | null {
  return cleanUrl(record?.authPhotoURL) ?? cleanUrl(record?.photo) ?? cleanUrl(record?.picture);
}

/**
 * Check if a user has a custom (non-Google) avatar set
 */
export function hasCustomAvatar(record: any): boolean {
  const avatar = cleanUrl(record?.avatar) ?? cleanUrl(record?.avatarUrl) ?? cleanUrl(record?.avatarURL);
  const custom = cleanUrl(record?.customPhotoURL);
  const cached = cleanUrl(record?.cachedPhotoURL);
  return Boolean(avatar || custom || cached);
}

/**
 * Check if a profile needs its Google photo cached.
 * Returns the Google URL to cache, or null if caching not needed.
 */
export function needsPhotoCaching(record: any): string | null {
  // Already has a cached or custom photo - no need to cache
  if (hasCustomAvatar(record)) return null;
  
  // Check for Google photo URL in various fields
  const photoUrl = cleanUrl(record?.photoURL) ?? cleanUrl(record?.photoUrl);
  const authUrl = cleanUrl(record?.authPhotoURL);
  
  // If we have a Google-looking URL that isn't cached, return it
  const urlToCheck = authUrl || photoUrl;
  if (urlToCheck && isGooglePhotoUrl(urlToCheck)) {
    return urlToCheck;
  }
  
  return null;
}
