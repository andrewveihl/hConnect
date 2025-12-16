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
	import { resolveProfilePhotoURL } from '$lib/utils/profile';
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
		// storage.googleapis.com URLs need auth token to work
		if (url.includes('storage.googleapis.com/') && !url.includes('token=')) {
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
		if (lower === '/default-avatar.svg') return false; // Skip default avatar URL
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
			if (url && isValidUrl(url) && !seen.has(url)) {
				seen.add(url);
				urls.push(url);
			}
		};

		// 1. Direct src prop takes highest priority
		addUrl(src);

		// 2. Custom uploaded avatar (user explicitly set)
		addUrl(getString(userRecord, 'avatar'));
		addUrl(getString(userRecord, 'avatarUrl'));
		addUrl(getString(userRecord, 'avatarURL'));
		addUrl(getString(userRecord, 'customPhotoURL'));

		// 3. Live auth provider photo (Google, etc.) - prefer over cached
		addUrl(getString(userRecord, 'authPhotoURL'));

		// 4. Generic photo fields (often same as auth)
		addUrl(getString(userRecord, 'photoURL'));
		addUrl(getString(userRecord, 'photoUrl'));
		addUrl(getString(userRecord, 'photo'));
		addUrl(getString(userRecord, 'picture'));
		addUrl(getString(userRecord, 'image'));

		// 5. Cached Firebase Storage URL (fallback if live fails)
		addUrl(getString(userRecord, 'cachedPhotoURL'));

		// 6. Try resolveProfilePhotoURL as final attempt
		if (userRecord && urls.length === 0) {
			const resolved = resolveProfilePhotoURL(userRecord, null, { preferGooglePhoto });
			addUrl(resolved);
		}

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

	// Reset error state when props change
	$effect(() => {
		// Track dependencies
		src;
		user;
		// Reset state
		imgError = false;
		fallbackIndex = 0;
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
		console.warn('[Avatar] Image failed to load:', {
			src: img?.src,
			fullUrl: img?.currentSrc,
			naturalWidth: img?.naturalWidth,
			naturalHeight: img?.naturalHeight,
			complete: img?.complete,
			fallbackIndex,
			totalFallbacks: fallbackUrls.length,
			name: displayName
		});
		
		// Try next fallback URL
		const nextIndex = fallbackIndex + 1;
		if (nextIndex < fallbackUrls.length) {
			fallbackIndex = nextIndex;
			return;
		}

		// All fallbacks exhausted, show placeholder
		imgError = true;
	}
	
	function handleImageLoad(event: Event) {
		const img = event.target as HTMLImageElement;
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
				<img
					src={currentSrc}
					alt={altText}
					class="w-full h-full object-cover"
					draggable="false"
					referrerpolicy="no-referrer"
					onerror={handleImageError}
					onload={handleImageLoad}
				/>
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
		border: 3px solid var(--color-panel, #1e1f22);
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
		background-color: #23a55a;
	}

	.presence-dot--busy {
		background-color: #f23f43;
	}

	.presence-dot--idle {
		background-color: #f0b232;
	}

	.presence-dot--offline {
		background-color: #80848e;
	}
</style>
