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
  const userRecord = $derived(user && typeof user === 'object' ? user as Record<string, unknown> : null);

  // Debug: log what we receive
  $effect(() => {
    const authPhoto = userRecord?.['authPhotoURL'];
    const photoURL = userRecord?.['photoURL'];
    const cached = userRecord?.['cachedPhotoURL'];
    const custom = userRecord?.['customPhotoURL'];
    const displayNameVal = userRecord?.['displayName'] || name;
    console.log('[Avatar] Data for:', displayNameVal, { src, authPhoto, photoURL, cached, custom, fallbackUrls: fallbackUrls.length, currentSrc });
  });

  // Helper to safely get string values from user object
  function getString(obj: Record<string, unknown> | null | undefined, key: string): string | null {
    if (!obj) return null;
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
    return null;
  }

  // Resolve the photo URL from all possible sources
  const resolvedSrc = $derived.by(() => {
    // Direct src takes priority
    if (src) return src;
    
    // If we have a user object, resolve from it
    if (userRecord) {
      // When preferGooglePhoto is true, check authPhotoURL first before other sources
      if (preferGooglePhoto && getString(userRecord, 'authPhotoURL')) {
        const authPhoto = getString(userRecord, 'authPhotoURL');
        if (authPhoto && !['undefined', 'null', 'none', 'false', '0'].includes(authPhoto.toLowerCase())) {
          // Only use auth photo if no custom/cached photo exists
          const hasCustom = getString(userRecord, 'customPhotoURL');
          const hasCached = getString(userRecord, 'cachedPhotoURL');
          if (!hasCustom && !hasCached) {
            // Use the full resolution logic but it will pick up authPhotoURL
          }
        }
      }
      return resolveProfilePhotoURL(userRecord);
    }
    
    return null;
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
  const initial = $derived(
    displayName?.trim().charAt(0).toUpperCase() || '?'
  );

  // Alt text
  const altText = $derived(
    alt || (displayName ? `${displayName}'s avatar` : 'Avatar')
  );

  // Track fallback attempts
  let imgError = $state(false);
  let fallbackIndex = $state(0);

  // Build list of fallback URLs to try
  const fallbackUrls = $derived.by(() => {
    const urls: string[] = [];
    
    // Primary source
    if (resolvedSrc) urls.push(resolvedSrc);
    
    // Try authPhotoURL (Google photo from auth provider)
    const authPhoto = getString(userRecord, 'authPhotoURL');
    if (authPhoto && !urls.includes(authPhoto)) urls.push(authPhoto);
    
    // Try photoURL if different
    const photoUrl = getString(userRecord, 'photoURL');
    if (photoUrl && !urls.includes(photoUrl)) urls.push(photoUrl);
    
    // Try cachedPhotoURL if different
    const cachedUrl = getString(userRecord, 'cachedPhotoURL');
    if (cachedUrl && !urls.includes(cachedUrl)) urls.push(cachedUrl);
    
    // Try photo/picture fields (some providers use these)
    const photo = getString(userRecord, 'photo');
    if (photo && !urls.includes(photo)) urls.push(photo);
    
    const picture = getString(userRecord, 'picture');
    if (picture && !urls.includes(picture)) urls.push(picture);
    
    return urls;
  });

  // Current URL to display
  const currentSrc = $derived.by(() => {
    if (imgError || fallbackIndex >= fallbackUrls.length) return null;
    return fallbackUrls[fallbackIndex] ?? null;
  });

  // Size classes mapping
  const sizeClasses: Record<AvatarSize, string> = {
    'xs': 'w-6 h-6 text-xs',
    'sm': 'w-8 h-8 text-sm',
    'md': 'w-10 h-10 text-base',
    'lg': 'w-12 h-12 text-lg',
    'xl': 'w-16 h-16 text-xl',
    '2xl': 'w-20 h-20 text-2xl'
  };

  // Presence dot size classes
  const presenceSizeClasses: Record<AvatarSize, string> = {
    'xs': 'w-2 h-2',
    'sm': 'w-2.5 h-2.5',
    'md': 'w-3 h-3',
    'lg': 'w-3.5 h-3.5',
    'xl': 'w-4 h-4',
    '2xl': 'w-5 h-5'
  };

  // Presence state to class mapping
  const presenceClasses: Record<PresenceState, string> = {
    online: 'presence-dot--online',
    busy: 'presence-dot--busy',
    idle: 'presence-dot--idle',
    offline: 'presence-dot--offline'
  };

  function handleImageError(event: Event) {
    // Try next fallback URL
    const nextIndex = fallbackIndex + 1;
    if (nextIndex < fallbackUrls.length) {
      fallbackIndex = nextIndex;
      return;
    }
    
    // All fallbacks exhausted, show placeholder
    imgError = true;
  }

  // Reset error state when src or user changes
  $effect(() => {
    resolvedSrc;
    userRecord;
    imgError = false;
    fallbackIndex = 0;
  });
</script>

<div 
  class="avatar-wrapper relative inline-flex items-center justify-center flex-shrink-0 rounded-full overflow-hidden {sizeClasses[size]} {className}"
  class:avatar--self={isSelf}
>
  <div class="avatar-inner w-full h-full rounded-full overflow-hidden bg-[color:var(--color-panel-muted,#23272a)] border border-[color:var(--color-border-subtle,rgba(255,255,255,0.1))]">
    {#if currentSrc && !imgError}
      {#key currentSrc}
        <img
          src={currentSrc}
          alt={altText}
          class="w-full h-full object-cover"
          loading="lazy"
          draggable="false"
          onerror={handleImageError}
        />
      {/key}
    {:else}
      <!-- Fallback: show initial or icon -->
      <div class="w-full h-full flex items-center justify-center text-[color:var(--text-70,rgba(255,255,255,0.7))]">
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
      class="presence-dot absolute bottom-0 right-0 {presenceSizeClasses[size]} {presenceClasses[presence]}"
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
    border-radius: 50%;
    border: 2px solid var(--color-panel, #1e1f22);
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
