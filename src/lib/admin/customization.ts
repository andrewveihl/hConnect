/**
 * Admin Customization Store
 * Manages theme overrides and splash screen customization stored in Firestore
 */
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { writable, type Writable } from 'svelte/store';
import { getDb, ensureFirebaseReady, getStorageInstance } from '$lib/firebase';
import type { User } from 'firebase/auth';
import { DEFAULT_SOUND_SOURCES, type SoundSources } from '$lib/utils/sounds';

export interface ThemeColors {
	colorAccent: string;
	colorAccentStrong: string;
	colorAccentSoft: string;
	colorAppBg: string;
	colorSidebar: string;
	colorPanel: string;
	colorTextPrimary: string;
	colorTextSecondary: string;
	colorDanger: string;
	colorWarning: string;
}

export interface CustomTheme {
	id: string;
	name: string;
	colors: ThemeColors;
	createdAt: Date;
	createdBy: string;
}

export interface SplashConfig {
	gifUrl: string;
	gifDuration: number; // milliseconds
	// Per-theme background colors
	themeBackgrounds: {
		dark: string;
		light: string;
		midnight: string;
		[key: string]: string;
	};
	enabled: boolean;
}

export interface CachedSplashGif {
	id: string;
	name: string;
	url: string;
	uploadedAt: Date;
	uploadedBy: string;
}

export interface CustomizationConfig {
	// Theme overrides per mode
	themeOverrides: {
		dark?: Partial<ThemeColors>;
		light?: Partial<ThemeColors>;
		midnight?: Partial<ThemeColors>;
		[key: string]: Partial<ThemeColors> | undefined;
	};
	// Custom themes created by admins
	customThemes: CustomTheme[];
	// Splash screen config
	splash: SplashConfig;
	// Cached splash GIFs
	splashGifs: CachedSplashGif[];
	// Global sound overrides
	sounds: SoundSources;
	// Last updated
	updatedAt?: Date;
	updatedBy?: string;
}

const DEFAULT_SPLASH: SplashConfig = {
	gifUrl: '/HS_splash_reveal.gif',
	gifDuration: 2600,
	themeBackgrounds: {
		dark: '#0e1317',
		light: '#f3f6f8',
		midnight: '#070a0d'
	},
	enabled: true
};

const DEFAULT_CONFIG: CustomizationConfig = {
	themeOverrides: {},
	customThemes: [],
	splash: DEFAULT_SPLASH,
	splashGifs: [],
	sounds: DEFAULT_SOUND_SOURCES
};

// Base theme colors for reference/reset
export const BASE_THEME_COLORS: Record<'dark' | 'light' | 'midnight', ThemeColors> = {
	dark: {
		colorAccent: '#33c8bf',
		colorAccentStrong: '#28b9b0',
		colorAccentSoft: 'rgba(51, 200, 191, 0.18)',
		colorAppBg: '#404549',
		colorSidebar: '#363a40',
		colorPanel: '#444950',
		colorTextPrimary: '#f2f5f6',
		colorTextSecondary: 'rgba(242, 245, 246, 0.75)',
		colorDanger: '#df5f5f',
		colorWarning: '#f1b45a'
	},
	light: {
		colorAccent: '#0b7f78',
		colorAccentStrong: '#096f69',
		colorAccentSoft: 'rgba(11, 127, 120, 0.16)',
		colorAppBg: '#f5f8fa',
		colorSidebar: '#ffffff',
		colorPanel: '#ffffff',
		colorTextPrimary: '#0f1419',
		colorTextSecondary: '#3d4d5c',
		colorDanger: '#c9363a',
		colorWarning: '#c87f1a'
	},
	midnight: {
		colorAccent: '#14e5c9',
		colorAccentStrong: '#09c8b0',
		colorAccentSoft: 'rgba(20, 229, 201, 0.2)',
		colorAppBg: '#000000',
		colorSidebar: '#010101',
		colorPanel: '#020202',
		colorTextPrimary: '#ebfffe',
		colorTextSecondary: 'rgba(235, 255, 254, 0.82)',
		colorDanger: '#ff6f7b',
		colorWarning: '#f5be5c'
	}
};

const db = () => getDb();
const customizationRef = () => doc(db(), 'appConfig', 'customization');

let customizationStore: Writable<CustomizationConfig | null> | null = null;
let unsubscribe: (() => void) | null = null;

export function customizationConfigStore(): Writable<CustomizationConfig | null> {
	if (customizationStore) return customizationStore;

	customizationStore = writable<CustomizationConfig | null>(null);

	if (typeof window !== 'undefined') {
		ensureFirebaseReady().then(() => {
			unsubscribe = onSnapshot(customizationRef(), (snap) => {
				if (snap.exists()) {
					const data = snap.data() as CustomizationConfig;
					customizationStore?.set({
						...DEFAULT_CONFIG,
						...data,
						splash: { ...DEFAULT_SPLASH, ...data.splash },
						customThemes: data.customThemes ?? [],
						splashGifs: data.splashGifs ?? [],
						sounds: { ...DEFAULT_SOUND_SOURCES, ...(data.sounds ?? {}) }
					});
				} else {
					customizationStore?.set(DEFAULT_CONFIG);
				}
			});
		});
	}

	return customizationStore;
}

export async function loadCustomizationConfig(): Promise<CustomizationConfig> {
	await ensureFirebaseReady();
	const snap = await getDoc(customizationRef());
	if (snap.exists()) {
		const data = snap.data() as CustomizationConfig;
		return {
			...DEFAULT_CONFIG,
			...data,
			splash: { ...DEFAULT_SPLASH, ...data.splash },
			customThemes: data.customThemes ?? [],
			splashGifs: data.splashGifs ?? [],
			sounds: { ...DEFAULT_SOUND_SOURCES, ...(data.sounds ?? {}) }
		};
	}
	return DEFAULT_CONFIG;
}

export async function saveCustomizationConfig(
	config: Partial<CustomizationConfig>,
	user: User | null
): Promise<void> {
	if (!user) throw new Error('Must be authenticated');
	await ensureFirebaseReady();

	const payload = {
		...config,
		updatedAt: new Date(),
		updatedBy: user.email ?? user.uid
	};

	await setDoc(customizationRef(), payload, { merge: true });
}

export async function saveThemeOverrides(
	themeId: string,
	overrides: Partial<ThemeColors>,
	user: User | null
): Promise<void> {
	if (!user) throw new Error('Must be authenticated');
	await ensureFirebaseReady();

	const current = await loadCustomizationConfig();
	const newOverrides = {
		...current.themeOverrides,
		[themeId]: overrides
	};

	await saveCustomizationConfig({ themeOverrides: newOverrides }, user);
}

export async function saveSplashConfig(
	splash: Partial<SplashConfig>,
	user: User | null
): Promise<void> {
	if (!user) throw new Error('Must be authenticated');
	await ensureFirebaseReady();

	const current = await loadCustomizationConfig();
	const newSplash = {
		...current.splash,
		...splash
	};

	await saveCustomizationConfig({ splash: newSplash }, user);
}

export async function resetThemeToDefault(themeId: string, user: User | null): Promise<void> {
	if (!user) throw new Error('Must be authenticated');
	await ensureFirebaseReady();

	const current = await loadCustomizationConfig();
	const newOverrides = { ...current.themeOverrides };
	delete newOverrides[themeId];

	await saveCustomizationConfig({ themeOverrides: newOverrides }, user);
}

export async function resetSplashToDefault(user: User | null): Promise<void> {
	if (!user) throw new Error('Must be authenticated');
	await ensureFirebaseReady();

	await saveCustomizationConfig({ splash: DEFAULT_SPLASH }, user);
}

// === Sounds (notification / call tones) ===

export type SoundKind = 'notification' | 'callJoin' | 'callLeave' | 'messageSend';

const SOUND_STORAGE_PREFIX: Record<SoundKind, string> = {
	notification: 'notification',
	callJoin: 'call-join',
	callLeave: 'call-leave',
	messageSend: 'message-send'
};

export async function saveSoundConfig(
	sounds: Partial<SoundSources>,
	user: User | null
): Promise<void> {
	if (!user) throw new Error('Must be authenticated');
	await ensureFirebaseReady();
	const current = await loadCustomizationConfig();
	const merged = { ...DEFAULT_SOUND_SOURCES, ...(current.sounds ?? {}), ...sounds };
	await saveCustomizationConfig({ sounds: merged }, user);
}

export async function resetSoundConfig(user: User | null): Promise<void> {
	await saveSoundConfig(DEFAULT_SOUND_SOURCES, user);
}

export async function uploadSoundFile(
	kind: SoundKind,
	file: File,
	user: User | null
): Promise<string> {
	if (!user) throw new Error('Must be authenticated');
	await ensureFirebaseReady();
	const storage = getStorageInstance();
	const ext = (file.name.split('.').pop() || 'wav').toLowerCase();
	const safeKind = SOUND_STORAGE_PREFIX[kind] ?? kind;
	const id = `${safeKind}-${Date.now()}`;
	const storageRef = ref(storage, `admin/sounds/${id}.${ext}`);
	await uploadBytes(storageRef, file, { contentType: file.type || 'audio/wav' });
	return getDownloadURL(storageRef);
}

/**
 * Apply theme overrides to the document as CSS custom properties
 * Call this on app load and when config changes
 */
export function applyThemeOverrides(
	config: CustomizationConfig | null,
	currentTheme: 'dark' | 'light' | 'midnight'
): void {
	if (typeof document === 'undefined') return;

	const root = document.documentElement;
	const overrides = config?.themeOverrides?.[currentTheme];

	// CSS variable name mapping
	const varMap: Record<keyof ThemeColors, string> = {
		colorAccent: '--color-accent',
		colorAccentStrong: '--color-accent-strong',
		colorAccentSoft: '--color-accent-soft',
		colorAppBg: '--color-app-bg',
		colorSidebar: '--color-sidebar',
		colorPanel: '--color-panel',
		colorTextPrimary: '--color-text-primary',
		colorTextSecondary: '--color-text-secondary',
		colorDanger: '--color-danger',
		colorWarning: '--color-warning'
	};

	// First, remove any existing admin overrides
	Object.values(varMap).forEach((cssVar) => {
		root.style.removeProperty(`${cssVar}-admin`);
	});

	// Then apply new overrides if present
	if (overrides) {
		Object.entries(overrides).forEach(([key, value]) => {
			const cssVar = varMap[key as keyof ThemeColors];
			if (cssVar && value) {
				// Set as admin override that takes precedence
				root.style.setProperty(cssVar, value);
			}
		});
	}
}

export function cleanupCustomizationStore(): void {
	if (unsubscribe) {
		unsubscribe();
		unsubscribe = null;
	}
	customizationStore = null;
}

// === Custom Themes Management ===

export async function createCustomTheme(
	name: string,
	colors: ThemeColors,
	user: User | null
): Promise<string> {
	if (!user) throw new Error('Must be authenticated');
	await ensureFirebaseReady();

	const current = await loadCustomizationConfig();
	const id = `custom-${Date.now()}`;

	const newTheme: CustomTheme = {
		id,
		name,
		colors,
		createdAt: new Date(),
		createdBy: user.email ?? user.uid
	};

	const customThemes = [...(current.customThemes ?? []), newTheme];

	await saveCustomizationConfig({ customThemes }, user);
	return id;
}

export async function updateCustomTheme(
	themeId: string,
	updates: Partial<Pick<CustomTheme, 'name' | 'colors'>>,
	user: User | null
): Promise<void> {
	if (!user) throw new Error('Must be authenticated');
	await ensureFirebaseReady();

	const current = await loadCustomizationConfig();
	const customThemes = (current.customThemes ?? []).map((t) =>
		t.id === themeId ? { ...t, ...updates } : t
	);

	await saveCustomizationConfig({ customThemes }, user);
}

export async function deleteCustomTheme(themeId: string, user: User | null): Promise<void> {
	if (!user) throw new Error('Must be authenticated');
	await ensureFirebaseReady();

	const current = await loadCustomizationConfig();
	const customThemes = (current.customThemes ?? []).filter((t) => t.id !== themeId);

	// Also remove any overrides for this theme
	const newOverrides = { ...current.themeOverrides };
	delete newOverrides[themeId];

	await saveCustomizationConfig({ customThemes, themeOverrides: newOverrides }, user);
}

// === Splash GIF Upload & Caching ===

export async function uploadSplashGif(file: File, user: User | null): Promise<CachedSplashGif> {
	if (!user) throw new Error('Must be authenticated');
	await ensureFirebaseReady();

	const storage = getStorageInstance();
	const id = `splash-${Date.now()}`;
	const ext = file.name.split('.').pop() || 'gif';
	const storageRef = ref(storage, `admin/splash/${id}.${ext}`);

	// Upload file
	await uploadBytes(storageRef, file);
	const url = await getDownloadURL(storageRef);

	// Save metadata
	const cachedGif: CachedSplashGif = {
		id,
		name: file.name,
		url,
		uploadedAt: new Date(),
		uploadedBy: user.email ?? user.uid
	};

	const current = await loadCustomizationConfig();
	const splashGifs = [...(current.splashGifs ?? []), cachedGif];

	await saveCustomizationConfig({ splashGifs }, user);
	return cachedGif;
}

export async function deleteSplashGif(gifId: string, user: User | null): Promise<void> {
	if (!user) throw new Error('Must be authenticated');
	await ensureFirebaseReady();

	const current = await loadCustomizationConfig();
	const splashGifs = (current.splashGifs ?? []).filter((g) => g.id !== gifId);

	// Note: We don't delete from storage here to avoid orphaned refs issues
	// Could add storage deletion if needed

	await saveCustomizationConfig({ splashGifs }, user);
}

/**
 * Get all available themes (built-in + custom)
 */
export function getAllThemes(
	config: CustomizationConfig | null
): { id: string; name: string; isCustom: boolean }[] {
	const builtIn = [
		{ id: 'dark', name: 'Dark', isCustom: false },
		{ id: 'light', name: 'Light', isCustom: false },
		{ id: 'midnight', name: 'Midnight', isCustom: false }
	];

	const custom = (config?.customThemes ?? []).map((t) => ({
		id: t.id,
		name: t.name,
		isCustom: true
	}));

	return [...builtIn, ...custom];
}

/**
 * Get colors for a theme (built-in base or custom)
 */
export function getThemeColors(themeId: string, config: CustomizationConfig | null): ThemeColors {
	// Check if it's a built-in theme
	if (themeId in BASE_THEME_COLORS) {
		const base = BASE_THEME_COLORS[themeId as keyof typeof BASE_THEME_COLORS];
		const overrides = config?.themeOverrides?.[themeId] ?? {};
		return { ...base, ...overrides };
	}

	// Check custom themes
	const customTheme = config?.customThemes?.find((t) => t.id === themeId);
	if (customTheme) {
		const overrides = config?.themeOverrides?.[themeId] ?? {};
		return { ...customTheme.colors, ...overrides };
	}

	// Fallback to dark theme
	return BASE_THEME_COLORS.dark;
}
