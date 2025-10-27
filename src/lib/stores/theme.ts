import { browser } from '$app/environment';
import { writable, type Writable } from 'svelte/store';

export type ThemeMode = 'dark' | 'light';

const STORAGE_KEY = 'hconnect:theme';

let hasExplicitPreference = false;

function resolveInitialTheme(): ThemeMode {
  if (!browser) return 'dark';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') {
    hasExplicitPreference = true;
    return stored;
  }
  hasExplicitPreference = false;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

const initialTheme = resolveInitialTheme();

const themeStore: Writable<ThemeMode> = writable(initialTheme);

function applyTheme(mode: ThemeMode, persist: boolean) {
  if (!browser) return;
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
  if (persist) {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

if (browser) {
  // Set immediately so the first paint matches.
  applyTheme(initialTheme, hasExplicitPreference);

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handleMedia = (event: MediaQueryListEvent | MediaQueryList) => {
    if (hasExplicitPreference) return;
    const nextMode: ThemeMode = event.matches ? 'dark' : 'light';
    themeStore.set(nextMode);
  };

  if ('addEventListener' in media) {
    media.addEventListener('change', handleMedia);
  } else if ('addListener' in media) {
    (media as MediaQueryList).addListener(handleMedia as (this: MediaQueryList, ev: MediaQueryListEvent) => void);
  }

  themeStore.subscribe((mode) => {
    applyTheme(mode, hasExplicitPreference);
  });
}

export const theme = {
  subscribe: themeStore.subscribe
};

export function setTheme(mode: ThemeMode, options: { persist?: boolean } = {}) {
  if (mode !== 'dark' && mode !== 'light') return;
  const persist = options.persist ?? true;
  hasExplicitPreference = persist;
  themeStore.set(mode);
}

export function syncThemeFromProfile(mode: ThemeMode | null | undefined) {
  if (mode === 'dark' || mode === 'light') {
    setTheme(mode, { persist: true });
  }
}

export function resetThemeToSystem() {
  if (!browser) return;
  hasExplicitPreference = false;
  window.localStorage.removeItem(STORAGE_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  themeStore.set(prefersDark ? 'dark' : 'light');
}

export function getThemeSnapshot(): ThemeMode {
  let current = initialTheme;
  themeStore.subscribe((value) => (current = value))();
  return current;
}
