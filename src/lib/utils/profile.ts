import { customizationConfigStore } from '$lib/admin/customization';

export const DEFAULT_AVATAR_URL = '/default-avatar.svg';

export function pickString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length ? trimmed : undefined;
}

const DEFAULT_AVATAR_LOWER = DEFAULT_AVATAR_URL.toLowerCase();
const DEFAULT_AVATAR_SUFFIX = '/default-avatar.svg';
let defaultAvatarOverride: string | null = null;

function isDefaultAvatarStatic(value: string): boolean {
	const lowered = value.toLowerCase();
	return lowered === DEFAULT_AVATAR_LOWER || lowered.endsWith(DEFAULT_AVATAR_SUFFIX);
}

if (typeof window !== 'undefined') {
	const store = customizationConfigStore();
	store.subscribe((config) => {
		const candidate = pickString(config?.defaultAvatarUrl);
		defaultAvatarOverride = candidate && !isDefaultAvatarStatic(candidate) ? candidate : null;
	});
}

export function getDefaultAvatarUrl(): string {
	return defaultAvatarOverride ?? DEFAULT_AVATAR_URL;
}

export function isDefaultAvatarUrl(value: unknown): boolean {
	const str = pickString(value);
	if (!str) return false;
	if (isDefaultAvatarStatic(str)) return true;
	return defaultAvatarOverride ? str.toLowerCase() === defaultAvatarOverride.toLowerCase() : false;
}

const DEFAULT_PHOTO_SOURCE_ORDER = [
	'avatar',
	'customPhotoURL',
	'authPhotoURL',
	'photoURL',
	'cachedPhotoURL'
] as const;

type PhotoSourceKey = (typeof DEFAULT_PHOTO_SOURCE_ORDER)[number];

function cleanUrl(value: unknown): string | null {
	const str = pickString(value);
	if (!str) return null;
	const lowered = str.toLowerCase();
	if (['undefined', 'null', 'none', 'false', '0', '?'].includes(lowered)) return null;
	if (isDefaultAvatarUrl(str)) return null;
	// Filter out the old incorrect default avatar URL (user-specific cached photo used incorrectly as default)
	if (lowered.includes('avatars_7h7gd9dzbcxt9fbg17czyopamln2_google-photo')) {
		return null;
	}
	// Filter out placeholder/invalid URLs
	if (str.startsWith('blob:') && str.includes('undefined')) return null;
	
	// Filter out Firebase Storage URLs without auth token (cached format that doesn't work)
	if (
		(str.includes('storage.googleapis.com/') ||
			str.includes('firebasestorage.googleapis.com/') ||
			str.includes('firebasestorage.app/')) &&
		!str.includes('token=')
	) {
		return null;
	}
	
	return str;
}

/**
 * Check if a URL looks like a valid Google profile photo URL
 */
export function isGooglePhotoUrl(url: string | null | undefined): boolean {
	if (!url) return false;
	return (
		url.includes('googleusercontent.com') ||
		url.includes('lh3.google.com') ||
		url.includes('lh4.google.com') ||
		url.includes('lh5.google.com') ||
		url.includes('lh6.google.com')
	);
}

/**
 * Resolves the best available profile photo URL from various possible fields.
 *
 * Priority order:
 * 1. Custom uploaded avatar (avatar, avatarUrl, avatarURL)
 * 2. Custom photo URL (customPhotoURL)
 * 3. Auth provider photo (authPhotoURL, photo, picture) - live Google/OAuth photos
 * 4. Generic stored photo (photoURL, photoUrl, photoUri, image)
 * 5. Cached Firebase Storage URL (cachedPhotoURL) - fallback if live fails
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
	const custom = cleanUrl(record?.customPhotoURL) ?? cleanUrl(record?.customPhotoUrl);

	// Auth provider photo (Google, etc.) - prefer live over cached
	const provider =
		cleanUrl(record?.authPhotoURL) ?? cleanUrl(record?.photo) ?? cleanUrl(record?.picture);

	// Generic stored photo
	const stored =
		cleanUrl(record?.photoURL) ??
		cleanUrl(record?.photoUrl) ??
		cleanUrl(record?.photoUri) ??
		cleanUrl(record?.image);

	// Cached Firebase Storage URL as fallback (if live URLs fail)
	const cached = cleanUrl(record?.cachedPhotoURL);

	// Back-compat: treat stored photo as a custom override if it isn't auth or cached.
	const storedOverrides =
		Boolean(stored) &&
		!custom &&
		(!provider || stored !== provider) &&
		(!cached || stored !== cached);
	const activeSource =
		typeof record?.activePhotoSource === 'string' ? record.activePhotoSource : null;
	if (activeSource) {
		const sources: Record<PhotoSourceKey, string | null> = {
			avatar,
			customPhotoURL: custom,
			authPhotoURL: provider,
			photoURL: stored,
			cachedPhotoURL: cached
		};
		const activeValue = sources[activeSource as PhotoSourceKey] ?? null;
		if (activeValue) return activeValue;
	}

	const order: PhotoSourceKey[] = Array.isArray(record?.photoSourceOrder)
		? (record.photoSourceOrder as unknown[]).filter((key: unknown): key is PhotoSourceKey =>
				DEFAULT_PHOTO_SOURCE_ORDER.includes(key as PhotoSourceKey)
			)
		: [];

	if (order.length > 0) {
		const sources: Record<PhotoSourceKey, string | null> = {
			avatar,
			customPhotoURL: custom,
			authPhotoURL: provider,
			photoURL: stored,
			cachedPhotoURL: cached
		};
		const fullOrder = [
			...order,
			...DEFAULT_PHOTO_SOURCE_ORDER.filter((key) => !order.includes(key))
		];
		for (const key of fullOrder) {
			const value = sources[key];
			if (value) return value;
		}
	} else {
		if (avatar) return avatar;
		if (custom) return custom;
		if (storedOverrides) return stored;
	}

	// If preferGooglePhoto is set and we have a Google URL in auth, prioritize it
	if (preferGooglePhoto && provider && isGooglePhotoUrl(provider)) {
		return provider;
	}

	// Standard resolution: provider first, then stored
	if (provider) return provider;
	if (stored) return stored;

	if (cached) return cached;

	const cleanedFallback = cleanUrl(fallback);
	if (cleanedFallback) return cleanedFallback;

	return getDefaultAvatarUrl();
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
	const avatar =
		cleanUrl(record?.avatar) ?? cleanUrl(record?.avatarUrl) ?? cleanUrl(record?.avatarURL);
	const custom = cleanUrl(record?.customPhotoURL) ?? cleanUrl(record?.customPhotoUrl);
	const cached = cleanUrl(record?.cachedPhotoURL);
	if (avatar || custom || cached) return true;

	const provider =
		cleanUrl(record?.authPhotoURL) ?? cleanUrl(record?.photo) ?? cleanUrl(record?.picture);
	const stored =
		cleanUrl(record?.photoURL) ??
		cleanUrl(record?.photoUrl) ??
		cleanUrl(record?.photoUri) ??
		cleanUrl(record?.image);
	const storedOverrides =
		Boolean(stored) && (!provider || stored !== provider) && (!cached || stored !== cached);
	return storedOverrides;
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
