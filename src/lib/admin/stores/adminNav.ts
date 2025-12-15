import { browser } from '$app/environment';
import { writable, derived, type Readable, type Writable } from 'svelte/store';

export type AdminPanelState = 'nav' | 'content' | 'detail';

interface AdminNavState {
  /** Current panel visible on mobile (nav sidebar, main content, or detail panel) */
  mobilePanel: AdminPanelState;
  /** Whether the mobile nav drawer is open */
  mobileNavOpen: boolean;
  /** Whether a detail panel is available */
  hasDetailPanel: boolean;
  /** ID of the selected item in a list view */
  selectedItemId: string | null;
  /** Search query for current page */
  searchQuery: string;
}

const DEFAULT_STATE: AdminNavState = {
  mobilePanel: 'content',
  mobileNavOpen: false,
  hasDetailPanel: false,
  selectedItemId: null,
  searchQuery: ''
};

function createAdminNavStore() {
  const store: Writable<AdminNavState> = writable(DEFAULT_STATE);

  return {
    subscribe: store.subscribe,
    
    /** Open mobile nav drawer */
    openNav: () => store.update(s => ({ ...s, mobileNavOpen: true, mobilePanel: 'nav' })),
    
    /** Close mobile nav drawer */
    closeNav: () => store.update(s => ({ ...s, mobileNavOpen: false, mobilePanel: 'content' })),
    
    /** Toggle mobile nav drawer */
    toggleNav: () => store.update(s => ({
      ...s, 
      mobileNavOpen: !s.mobileNavOpen,
      mobilePanel: s.mobileNavOpen ? 'content' : 'nav'
    })),

    /** Show content panel on mobile */
    showContent: () => store.update(s => ({ ...s, mobilePanel: 'content', mobileNavOpen: false })),

    /** Show detail panel on mobile */
    showDetail: (itemId?: string) => store.update(s => ({
      ...s,
      mobilePanel: 'detail',
      selectedItemId: itemId ?? s.selectedItemId,
      hasDetailPanel: true
    })),

    /** Enable detail panel availability */
    enableDetailPanel: () => store.update(s => ({ ...s, hasDetailPanel: true })),

    /** Disable detail panel */
    disableDetailPanel: () => store.update(s => ({ 
      ...s, 
      hasDetailPanel: false,
      mobilePanel: s.mobilePanel === 'detail' ? 'content' : s.mobilePanel
    })),

    /** Select an item (for master/detail views) */
    selectItem: (id: string | null) => store.update(s => ({ ...s, selectedItemId: id })),

    /** Set search query */
    setSearch: (query: string) => store.update(s => ({ ...s, searchQuery: query })),

    /** Clear search */
    clearSearch: () => store.update(s => ({ ...s, searchQuery: '' })),

    /** Handle swipe left - go to detail if available, otherwise close nav */
    swipeLeft: () => store.update(s => {
      if (s.mobilePanel === 'nav') {
        return { ...s, mobileNavOpen: false, mobilePanel: 'content' };
      }
      if (s.mobilePanel === 'content' && s.hasDetailPanel && s.selectedItemId) {
        return { ...s, mobilePanel: 'detail' };
      }
      return s;
    }),

    /** Handle swipe right - go back towards nav */
    swipeRight: () => store.update(s => {
      if (s.mobilePanel === 'detail') {
        return { ...s, mobilePanel: 'content' };
      }
      if (s.mobilePanel === 'content') {
        return { ...s, mobileNavOpen: true, mobilePanel: 'nav' };
      }
      return s;
    }),

    /** Reset state */
    reset: () => store.set(DEFAULT_STATE)
  };
}

export const adminNav = createAdminNavStore();

// Derived stores for convenience
export const mobilePanel: Readable<AdminPanelState> = derived(adminNav, $s => $s.mobilePanel);
export const mobileNavOpen: Readable<boolean> = derived(adminNav, $s => $s.mobileNavOpen);
export const hasDetailPanel: Readable<boolean> = derived(adminNav, $s => $s.hasDetailPanel);
export const selectedItemId: Readable<string | null> = derived(adminNav, $s => $s.selectedItemId);
export const adminSearchQuery: Readable<string> = derived(adminNav, $s => $s.searchQuery);
