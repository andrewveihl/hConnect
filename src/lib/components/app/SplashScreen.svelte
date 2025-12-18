<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade } from 'svelte/transition';
	import { customizationConfigStore } from '$lib/admin/customization';
	import { theme } from '$lib/stores/theme';
	import { browser } from '$app/environment';

	interface Props {
		isAppReady?: boolean;
	}

	const DEFAULT_GIF_DURATION = 2600; // milliseconds for one loop of the splash GIF
	const DEFAULT_GIF_URL = '/HS_splash_reveal.gif';
	const DEFAULT_BACKGROUNDS: Record<string, string> = {
		dark: '#0e1317',
		light: '#f3f6f8',
		midnight: '#070a0d'
	};

	const dispatch = createEventDispatcher<{ complete: void }>();
	let { isAppReady = false }: Props = $props();
	let completionTimer: ReturnType<typeof setTimeout> | null = null;

	// Subscribe to global customization for splash settings
	const customization = customizationConfigStore();

	// Get current theme - check for custom theme ID first, then fall back to theme store
	// Map 'holiday' to 'dark' for built-in themes
	const currentTheme = $derived(() => {
		// Check localStorage for custom theme ID (stored as profile preference)
		if (browser) {
			try {
				const savedCustomThemeId = localStorage.getItem('hconnect:customThemeId');
				if (savedCustomThemeId && savedCustomThemeId.startsWith('custom-')) {
					return savedCustomThemeId;
				}
			} catch {
				// Ignore localStorage errors
			}
		}
		// Fall back to theme store value
		return $theme === 'holiday' ? 'dark' : $theme;
	});

	// Derive splash settings from config or use defaults
	const splashEnabled = $derived($customization?.splash?.enabled ?? true);
	const gifUrl = $derived($customization?.splash?.gifUrl || DEFAULT_GIF_URL);
	const gifDuration = $derived($customization?.splash?.gifDuration || DEFAULT_GIF_DURATION);
	
	// Get background color for current theme (supports custom themes via index signature)
	const backgroundColor = $derived(() => {
		const themeId = currentTheme();
		const themeBackgrounds = $customization?.splash?.themeBackgrounds;
		
		// First check if there's a saved background for this theme
		if (themeBackgrounds && themeBackgrounds[themeId]) {
			return themeBackgrounds[themeId];
		}
		
		// For custom themes without a saved background, try to get the theme's colorAppBg
		if (themeId.startsWith('custom-')) {
			const customTheme = $customization?.customThemes?.find(t => t.id === themeId);
			if (customTheme?.colors?.colorAppBg) {
				return customTheme.colors.colorAppBg;
			}
		}
		
		// Fall back to built-in theme defaults
		return DEFAULT_BACKGROUNDS[themeId] || DEFAULT_BACKGROUNDS.dark;
	});

	$effect(() => {
		if (!isAppReady) {
			if (completionTimer) {
				clearTimeout(completionTimer);
				completionTimer = null;
			}
			return;
		}

		// If splash is disabled, complete immediately
		if (!splashEnabled) {
			dispatch('complete');
			return;
		}

		completionTimer = setTimeout(() => {
			dispatch('complete');
		}, gifDuration);

		return () => {
			if (completionTimer) {
				clearTimeout(completionTimer);
				completionTimer = null;
			}
		};
	});
</script>

{#if !isAppReady && splashEnabled}
	<div
		class="splash-screen"
		style="background-color: {backgroundColor()};"
		transition:fade={{ duration: 120 }}
	>
		<img src={gifUrl} alt="Loading hConnect" class="splash-screen__gif" draggable="false" />
		<span class="splash-screen__sr-only" aria-live="polite">Loading</span>
	</div>
{/if}
