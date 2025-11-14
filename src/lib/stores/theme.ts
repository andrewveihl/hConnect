import { browser } from '$app/environment';
import { writable, type Writable } from 'svelte/store';

export type ThemeMode = 'dark' | 'midnight' | 'light' | 'holiday';
type HolidayThemeId =
  | 'holiday-newyear'
  | 'holiday-valentine'
  | 'holiday-stpatricks'
  | 'holiday-patriotic'
  | 'holiday-halloween'
  | 'holiday-thanksgiving'
  | 'holiday-winterfest'
  | 'holiday-evergreen';

type HolidayDefinition = {
  id: HolidayThemeId;
  start: { month: number; day: number };
  end: { month: number; day: number };
  tone: 'light' | 'dark';
};

const HOLIDAY_SCHEDULE: HolidayDefinition[] = [
  { id: 'holiday-newyear', start: { month: 0, day: 1 }, end: { month: 0, day: 14 }, tone: 'dark' },
  { id: 'holiday-valentine', start: { month: 1, day: 1 }, end: { month: 1, day: 18 }, tone: 'light' },
  { id: 'holiday-stpatricks', start: { month: 2, day: 1 }, end: { month: 2, day: 20 }, tone: 'light' },
  { id: 'holiday-patriotic', start: { month: 5, day: 15 }, end: { month: 6, day: 10 }, tone: 'light' },
  { id: 'holiday-halloween', start: { month: 9, day: 1 }, end: { month: 9, day: 31 }, tone: 'dark' },
  { id: 'holiday-thanksgiving', start: { month: 10, day: 1 }, end: { month: 10, day: 24 }, tone: 'dark' },
  { id: 'holiday-winterfest', start: { month: 10, day: 25 }, end: { month: 11, day: 31 }, tone: 'dark' }
];

const DEFAULT_HOLIDAY_THEME: HolidayDefinition = {
  id: 'holiday-evergreen',
  start: { month: 0, day: 1 },
  end: { month: 11, day: 31 },
  tone: 'dark'
};

const HOLIDAY_TONE: Record<HolidayThemeId, 'light' | 'dark'> = [...HOLIDAY_SCHEDULE, DEFAULT_HOLIDAY_THEME].reduce(
  (map, def) => {
    map[def.id] = def.tone;
    return map;
  },
  {} as Record<HolidayThemeId, 'light' | 'dark'>
);

const STORAGE_KEY = 'hconnect:theme';
const MIN_HOLIDAY_REFRESH_MS = 1000 * 60 * 15; // Guard against rapid re-scheduling.

let hasExplicitPreference = false;
let holidayTimeout: number | null = null;
let currentBrowserTheme: ThemeMode | null = null;

function resolveInitialTheme(): ThemeMode {
  if (!browser) return 'dark';
  let stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'seasonal') {
    stored = 'holiday';
    window.localStorage.setItem(STORAGE_KEY, 'holiday');
  }
  if (stored === 'dark' || stored === 'light' || stored === 'midnight' || stored === 'holiday') {
    hasExplicitPreference = true;
    return stored as ThemeMode;
  }
  hasExplicitPreference = false;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

const initialTheme = resolveInitialTheme();

const themeStore: Writable<ThemeMode> = writable(initialTheme);

function dateFromParts(year: number, month: number, day: number, endOfDay = false) {
  return new Date(year, month, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
}

function isDateInHolidayRange(date: Date, def: HolidayDefinition): boolean {
  const year = date.getFullYear();
  let start = dateFromParts(year, def.start.month, def.start.day);
  let end = dateFromParts(year, def.end.month, def.end.day, true);
  if (end.getTime() < start.getTime()) {
    if (date >= start) {
      end = dateFromParts(year + 1, def.end.month, def.end.day, true);
    } else {
      start = dateFromParts(year - 1, def.start.month, def.start.day);
    }
  }
  return date >= start && date <= end;
}

function getHolidayThemeId(date = new Date()): HolidayThemeId {
  const match = HOLIDAY_SCHEDULE.find((def) => isDateInHolidayRange(date, def));
  return match?.id ?? DEFAULT_HOLIDAY_THEME.id;
}

function resolveColorScheme(theme: ThemeMode | HolidayThemeId): 'light' | 'dark' {
  if (theme === 'light') return 'light';
  if (theme === 'dark' || theme === 'midnight') return 'dark';
  if (typeof theme === 'string' && theme.startsWith('holiday-')) {
    return HOLIDAY_TONE[theme as HolidayThemeId] ?? 'dark';
  }
  return 'dark';
}

function applyTheme(mode: ThemeMode, persist: boolean) {
  if (!browser) return;
  const resolvedTheme = mode === 'holiday' ? getHolidayThemeId() : mode;
  const tone = resolveColorScheme(resolvedTheme);
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themeTone = tone;
  document.documentElement.style.colorScheme = tone;
  if (persist) {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

function refreshHolidayTheme() {
  if (!browser) return;
  if (currentBrowserTheme !== 'holiday') return;
  applyTheme('holiday', hasExplicitPreference);
}

function msUntilNextDateChange(date = new Date()): number {
  const next = new Date(date);
  next.setHours(24, 0, 5, 0); // A few seconds after midnight local time.
  return Math.max(1000, next.getTime() - date.getTime());
}

function scheduleNextHolidayRefresh() {
  if (!browser) return;
  if (holidayTimeout) {
    window.clearTimeout(holidayTimeout);
    holidayTimeout = null;
  }
  const delay = Math.max(MIN_HOLIDAY_REFRESH_MS, msUntilNextDateChange());
  holidayTimeout = window.setTimeout(() => {
    refreshHolidayTheme();
    scheduleNextHolidayRefresh();
  }, delay);
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    refreshHolidayTheme();
    scheduleNextHolidayRefresh();
  }
}

function startHolidayRefresh() {
  if (!browser) return;
  if (holidayTimeout) return;
  scheduleNextHolidayRefresh();
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

function stopHolidayRefresh() {
  if (!browser) return;
  if (holidayTimeout) {
    window.clearTimeout(holidayTimeout);
    holidayTimeout = null;
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange);
}

if (browser) {
  currentBrowserTheme = initialTheme;
  // Set immediately so the first paint matches.
  applyTheme(initialTheme, hasExplicitPreference);
  if (initialTheme === 'holiday') {
    startHolidayRefresh();
  }

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
    currentBrowserTheme = mode;
    applyTheme(mode, hasExplicitPreference);
    if (mode === 'holiday') {
      startHolidayRefresh();
    } else {
      stopHolidayRefresh();
    }
  });
}

export const theme = {
  subscribe: themeStore.subscribe
};

export function setTheme(mode: ThemeMode, options: { persist?: boolean } = {}) {
  if (mode !== 'dark' && mode !== 'light' && mode !== 'midnight' && mode !== 'holiday') return;
  const persist = options.persist ?? true;
  hasExplicitPreference = persist;
  themeStore.set(mode);
}

export function syncThemeFromProfile(mode: ThemeMode | 'seasonal' | null | undefined) {
  if (mode === 'seasonal') {
    setTheme('holiday', { persist: true });
    return;
  }
  if (mode === 'dark' || mode === 'light' || mode === 'midnight' || mode === 'holiday') {
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
