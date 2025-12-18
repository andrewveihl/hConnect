import { writable } from 'svelte/store';

/**
 * Store to track whether the splash screen is currently visible.
 * Used to hide other UI elements (like mobile nav) during splash.
 */
export const splashVisible = writable(false);
