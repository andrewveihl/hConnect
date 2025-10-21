// svelte.config.js
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      // create a SPA fallback so client routing works on Hosting
      fallback: 'index.html',
      pages: 'build',
      assets: 'build',
      precompress: false
    }),
    prerender: {
      // leave empty to avoid trying to prerender dynamic routes
      entries: []
    }
  }
};

export default config;
