import { browser } from '$app/environment';
import { derived, readable } from 'svelte/store';

type ViewportState = {
  width: number;
  height: number;
};

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

export const viewport = readable<ViewportState>({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }, (set) => {
  if (!browser) return;
  const update = () => {
    set({
      width: window.innerWidth,
      height: window.innerHeight
    });
  };
  update();
  window.addEventListener('resize', update);
  return () => window.removeEventListener('resize', update);
});

export const isMobileViewport = derived(viewport, ($viewport) => $viewport.width < 768);
