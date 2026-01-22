<script lang="ts">
	/**
	 * Avatar - A consistent, reusable avatar component
	 *
	 * Features:
	 * - Unified avatar resolution using resolveProfilePhotoURL
	 * - Google/auth photo fallback support
	 * - Graceful error handling with multiple fallback layers
	 * - Consistent styling across the app
	 * - Optional presence indicator
	 * - Accessible by default
	 */
	import { resolveProfilePhotoURL, getDefaultAvatarUrl, isDefaultAvatarUrl } from '$lib/utils/profile';
	import {
		markAvatarUrlFailed,
		shouldLogAvatarFailure,
		shouldSkipAvatarUrl
	} from '$lib/utils/avatarFailureCache';
	import type { PresenceState } from '$lib/presence/state';

	type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

	interface Props {
		/** The user/profile object containing photo URLs - accepts any object */
		user?: unknown;
		/** Direct photo URL (overrides user object resolution) */
		src?: string | null;
		/** Display name for alt text and fallback initial */
		name?: string | null;
		/** Size variant */
		size?: AvatarSize;
		/** Whether to show presence indicator */
		showPresence?: boolean;
		/** Presence state for indicator */
		presence?: PresenceState;
		/** Custom CSS class */
		class?: string;
		/** Alt text override */
		alt?: string;
		/** Whether this represents the current user */
		isSelf?: boolean;
		/** Custom fallback icon class (defaults to bx-user) */
		fallbackIcon?: string;
		/** Whether to use Google photo as primary fallback */
		preferGooglePhoto?: boolean;
	}

	let {
		user = null,
		src = null,
		name = null,
		size = 'md',
		showPresence = false,
		presence = 'offline',
		class: className = '',
		alt = '',
		isSelf = false,
		fallbackIcon = 'bx-user',
		preferGooglePhoto = true
	}: Props = $props();

	// Safely cast user to a record for property access
	const userRecord = $derived(
		user && typeof user === 'object' ? (user as Record<string, unknown>) : null
	);

	// Helper to safely get string values from user object
	function getString(obj: Record<string, unknown> | null | undefined, key: string): string | null {
		if (!obj) return null;
		const val = obj[key];
		if (typeof val === 'string' && val.trim()) return val.trim();
		return null;
	}

	// Check if this is a Firebase Storage URL that requires auth token but doesn't have one
	function isUnauthenticatedFirebaseUrl(url: string): boolean {
		// Firebase Storage URLs need auth token to work
		if (
			(url.includes('storage.googleapis.com/') ||
				url.includes('firebasestorage.googleapis.com/') ||
				url.includes('firebasestorage.app/')) &&
			!url.includes('token=')
		) {
			return true;
		}
		return false;
	}

	// Check if URL is a Google profile photo URL
	function isGooglePhotoUrl(url: string): boolean {
		return url.includes('googleusercontent.com') || 
		       url.includes('lh3.google.com') ||
		       url.includes('lh4.google.com');
	}

	const DEFAULT_GOOGLE_AVATAR_REF = '/google-default-avatar.png';
	let defaultGoogleHash: string | null = null;
	let defaultGoogleHashPromise: Promise<string | null> | null = null;
	
	// Cache computed hashes per URL to avoid expensive canvas operations
	const hashCache = new Map<string, string | null>();

	function computeImageHash(img: HTMLImageElement): string | null {
		// Check cache first
		const cacheKey = img.src;
		if (hashCache.has(cacheKey)) {
			return hashCache.get(cacheKey)!;
		}
		
		if (typeof document === 'undefined') return null;
		try {
			const size = 8;
			const canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			const ctx = canvas.getContext('2d', { willReadFrequently: true });
			if (!ctx) return null;
			ctx.drawImage(img, 0, 0, size, size);
			const data = ctx.getImageData(0, 0, size, size).data;
			let sum = 0;
			const values: number[] = [];
			for (let i = 0; i < data.length; i += 4) {
				const r = data[i] ?? 0;
				const g = data[i + 1] ?? 0;
				const b = data[i + 2] ?? 0;
				const value = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
				values.push(value);
				sum += value;
			}
			const avg = sum / values.length;
			let bits = '';
			for (const value of values) {
				bits += value >= avg ? '1' : '0';
			}
			
			// Cache the result
			hashCache.set(cacheKey, bits);
			// Limit cache size
			if (hashCache.size > 100) {
				const firstKey = hashCache.keys().next().value;
				if (firstKey) hashCache.delete(firstKey);
			}
			
			return bits;
		} catch {
			hashCache.set(cacheKey, null);
			return null;
		}
	}

	async function getDefaultGoogleAvatarHash(): Promise<string | null> {
		if (defaultGoogleHash !== null) return defaultGoogleHash;
		if (!defaultGoogleHashPromise) {
			defaultGoogleHashPromise = new Promise((resolve) => {
				if (typeof document === 'undefined') {
					resolve(null);
					return;
				}
				const img = new Image();
				// Don't set crossOrigin - local reference image doesn't need it
				img.onload = () => resolve(computeImageHash(img));
				img.onerror = () => resolve(null);
				img.src = DEFAULT_GOOGLE_AVATAR_REF;
			});
		}
		defaultGoogleHash = await defaultGoogleHashPromise;
		return defaultGoogleHash;
	}

	async function isDefaultGoogleAvatar(img: HTMLImageElement): Promise<boolean> {
		const refHash = await getDefaultGoogleAvatarHash();
		if (!refHash) return false;
		const currentHash = computeImageHash(img);
		if (!currentHash) return false;
		return currentHash === refHash;
	}

	// Try to fix Google profile photo URLs that might not load
	function fixGooglePhotoUrl(url: string): string {
		if (!isGooglePhotoUrl(url)) return url;
		
		// Some Google URLs with -/ALV- pattern don't work, try removing size params
		// Original: https://lh3.googleusercontent.com/a-/ALV-...=s96-c
		// Try: https://lh3.googleusercontent.com/a-/ALV-...=s400
		if (url.includes('=s96-c')) {
			return url.replace('=s96-c', '=s400');
		}
		if (url.includes('=s96')) {
			return url.replace('=s96', '=s400');
		}
		
		return url;
	}

	// Helper to check if URL is valid and likely to work
	function isValidUrl(url: string | null | undefined): boolean {
		if (!url) return false;
		const lower = url.toLowerCase();
		if (['undefined', 'null', 'none', 'false', '0'].includes(lower)) return false;
		if (isDefaultAvatarUrl(url)) return false; // Skip default avatar URLs
		if (url.startsWith('blob:') && url.includes('undefined')) return false;
		if (!url.startsWith('http') && !url.startsWith('/') && !url.startsWith('data:')) return false;
		
		// Google photo URLs - try them (even long ones), error handler will catch failures
		if (isGooglePhotoUrl(url)) return true;
		
		// Skip Firebase Storage URLs without auth token
		if (isUnauthenticatedFirebaseUrl(url)) return false;
		
		return true;
	}

	// Build list of fallback URLs to try - order matters!
	const fallbackUrls = $derived.by(() => {
		const urls: string[] = [];
		const seen = new Set<string>();

		const addUrl = (url: string | null | undefined) => {
			if (url && isValidUrl(url) && !seen.has(url) && !shouldSkipAvatarUrl(url)) {
				seen.add(url);
				urls.push(url);
			}
		};

		// 1. Direct src prop takes highest priority
		addUrl(src);

		// 2. Resolved profile photo (keeps priority order consistent)
		if (userRecord) {
			const resolved = resolveProfilePhotoURL(userRecord, null, { preferGooglePhoto });
			addUrl(resolved);
		}

		// 3. Custom uploaded avatar (user explicitly set)
		addUrl(getString(userRecord, 'avatar'));
		addUrl(getString(userRecord, 'avatarUrl'));
		addUrl(getString(userRecord, 'avatarURL'));
		addUrl(getString(userRecord, 'customPhotoURL'));
		addUrl(getString(userRecord, 'customPhotoUrl'));

		// 4. Live auth provider photo (Google, etc.) - prefer over cached
		addUrl(getString(userRecord, 'authPhotoURL'));

		// 5. Generic photo fields (often same as auth)
		addUrl(getString(userRecord, 'photoURL'));
		addUrl(getString(userRecord, 'photoUrl'));
		addUrl(getString(userRecord, 'photo'));
		addUrl(getString(userRecord, 'picture'));
		addUrl(getString(userRecord, 'image'));

		// 6. Cached Firebase Storage URL (fallback if live fails)
		addUrl(getString(userRecord, 'cachedPhotoURL'));

		// 7. Final fallback: app logo
		addUrl(getDefaultAvatarUrl());

		return urls;
	});

	// Current URL to display
	let fallbackIndex = $state(0);
	let imgError = $state(false);

	const currentSrc = $derived.by(() => {
		if (imgError || fallbackIndex >= fallbackUrls.length) return null;
		const url = fallbackUrls[fallbackIndex] ?? null;
		// Try to fix Google URLs that might not load
		return url ? fixGooglePhotoUrl(url) : null;
	});

	// Check if current source is a Google photo (for CORS handling)
	const isCurrentSrcGooglePhoto = $derived(
		currentSrc ? isGooglePhotoUrl(currentSrc) : false
	);

	// Get display name for alt text and initials
	const displayName = $derived.by(() => {
		if (name) return name;
		const dn = getString(userRecord, 'displayName');
		if (dn) return dn;
		const n = getString(userRecord, 'name');
		if (n) return n;
		const email = getString(userRecord, 'email');
		if (email) return email.split('@')[0];
		return '';
	});

	// Generate initial from name
	const initial = $derived(displayName?.trim().charAt(0).toUpperCase() || '?');

	// Alt text
	const altText = $derived(alt || (displayName ? `${displayName}'s avatar` : 'Avatar'));

	const fallbackUrlsKey = $derived.by(() => JSON.stringify(fallbackUrls));
	let lastFallbackKey: string | null = $state(null);

	// Reset only when the actual fallback URL set changes to avoid flicker on unrelated updates.
	$effect(() => {
		const key = fallbackUrlsKey;
		if (key !== lastFallbackKey) {
			lastFallbackKey = key;
			imgError = false;
			fallbackIndex = 0;
		}
	});

	// Size classes mapping
	const sizeClasses: Record<AvatarSize, string> = {
		xs: 'w-6 h-6 text-xs',
		sm: 'w-8 h-8 text-sm',
		md: 'w-10 h-10 text-base',
		lg: 'w-12 h-12 text-lg',
		xl: 'w-16 h-16 text-xl',
		'2xl': 'w-20 h-20 text-2xl'
	};

	// Presence dot size classes - match members bar styling
	const presenceSizeClasses: Record<AvatarSize, string> = {
		xs: 'presence-dot--xs',
		sm: 'presence-dot--sm',
		md: 'presence-dot--md',
		lg: 'presence-dot--lg',
		xl: 'presence-dot--xl',
		'2xl': 'presence-dot--2xl'
	};

	// Presence state to class mapping
	const presenceClasses: Record<PresenceState, string> = {
		online: 'presence-dot--online',
		busy: 'presence-dot--busy',
		idle: 'presence-dot--idle',
		offline: 'presence-dot--offline'
	};

	function handleImageError(event: Event) {
		const img = event.target as HTMLImageElement;
		const failedUrl = img?.currentSrc || img?.src || '';
		if (failedUrl) {
			markAvatarUrlFailed(failedUrl);
		}
		// Only log in development to reduce console noise in production
		// Avatar failures are expected (expired tokens, deleted files, etc.)
		if (import.meta.env.DEV && shouldLogAvatarFailure(failedUrl)) {
			console.debug('[Avatar] Image failed to load:', {
				src: img?.src,
				name: displayName
			});
		}
		
		// Try next fallback URL
		const nextIndex = fallbackIndex + 1;
		if (nextIndex < fallbackUrls.length) {
			fallbackIndex = nextIndex;
			return;
		}

		// All fallbacks exhausted, show placeholder
		imgError = true;
	}
	
	async function handleImageLoad(event: Event) {
		const img = event.target as HTMLImageElement;
		const loadedSrc = img?.currentSrc || img?.src || '';

		if (loadedSrc && isGooglePhotoUrl(loadedSrc)) {
			const activeSrc = loadedSrc;
			const activeIndex = fallbackIndex;
			const isDefault = await isDefaultGoogleAvatar(img);
			if (isDefault && currentSrc === activeSrc && fallbackIndex === activeIndex) {
				const nextIndex = fallbackIndex + 1;
				if (nextIndex < fallbackUrls.length) {
					fallbackIndex = nextIndex;
					return;
				}
				imgError = true;
				return;
			}
		}

		console.log('[Avatar] Image loaded successfully:', {
			src: img?.src?.substring(0, 80) + '...',
			naturalWidth: img?.naturalWidth,
			naturalHeight: img?.naturalHeight,
			name: displayName
		});
	}
</script>

<div
	class="avatar-wrapper relative inline-flex items-center justify-center flex-shrink-0 rounded-full overflow-visible {sizeClasses[
		size
	]} {className}"
	class:avatar--self={isSelf}
>
	<div
		class="avatar-inner w-full h-full rounded-full overflow-hidden bg-[color:var(--color-panel-muted,#23272a)] border border-[color:var(--color-border-subtle,rgba(255,255,255,0.1))]"
	>
		{#if currentSrc && !imgError}
			{#key currentSrc}
				{#if isCurrentSrcGooglePhoto}
					<!-- Google photos don't support CORS, skip crossorigin attribute -->
					<img
						src={currentSrc}
						alt={altText}
						class="w-full h-full object-cover"
						draggable="false"
						referrerpolicy="no-referrer"
						loading="lazy"
						decoding="async"
						onerror={handleImageError}
						onload={handleImageLoad}
					/>
				{:else}
					<img
						src={currentSrc}
						alt={altText}
						class="w-full h-full object-cover"
						draggable="false"
						referrerpolicy="no-referrer"
						loading="lazy"
						decoding="async"
						onerror={handleImageError}
						onload={handleImageLoad}
					/>
				{/if}
			{/key}
		{:else}
			<!-- Fallback: show initial or icon -->
			<div
				class="w-full h-full flex items-center justify-center text-[color:var(--text-70,rgba(255,255,255,0.7))]"
			>
				{#if initial && initial !== '?'}
					<span class="font-medium">{initial}</span>
				{:else}
					<i class="bx {fallbackIcon}"></i>
				{/if}
			</div>
		{/if}
	</div>

	{#if showPresence}
		<span
			class="presence-dot {presenceSizeClasses[size]} {presenceClasses[presence]}"
			aria-label={presence}
		></span>
	{/if}
</div>

<style>
	.avatar-wrapper {
		--avatar-ring-color: transparent;
	}

	.avatar--self {
		--avatar-ring-color: var(--color-accent, #5865f2);
	}

	.avatar--self .avatar-inner {
		box-shadow: 0 0 0 2px var(--avatar-ring-color);
	}

	.presence-dot {
		position: absolute;
		bottom: -2px;
		right: -2px;
		border-radius: 50%;
		border: 3px solid var(--presence-dot-border, var(--color-panel, #1e1f22));
		z-index: 2;
	}

	/* Size variants for presence dot */
	.presence-dot--xs {
		width: 0.5rem;
		height: 0.5rem;
		border-width: 2px;
	}

	.presence-dot--sm {
		width: 0.75rem;
		height: 0.75rem;
		border-width: 2.5px;
	}

	.presence-dot--md {
		width: 0.875rem;
		height: 0.875rem;
		border-width: 3px;
	}

	.presence-dot--lg {
		width: 1rem;
		height: 1rem;
		border-width: 3px;
	}

	.presence-dot--xl {
		width: 1.125rem;
		height: 1.125rem;
		border-width: 3px;
	}

	.presence-dot--2xl {
		width: 1.25rem;
		height: 1.25rem;
		border-width: 3.5px;
	}

	.presence-dot--online {
		background: linear-gradient(135deg, #10b981 0%, #059669 100%);
		box-shadow: 0 0 8px rgba(16, 185, 129, 0.6),
			0 0 3px rgba(16, 185, 129, 0.4) inset;
	}

	.presence-dot--busy {
		background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
		box-shadow: 0 0 8px rgba(239, 68, 68, 0.6),
			0 0 3px rgba(239, 68, 68, 0.4) inset;
	}

	.presence-dot--idle {
		background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
		box-shadow: 0 0 8px rgba(245, 158, 11, 0.6),
			0 0 3px rgba(245, 158, 11, 0.4) inset;
	}

	.presence-dot--offline {
		background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);
		box-shadow: 0 0 6px rgba(107, 114, 128, 0.3);
	}
</style>
