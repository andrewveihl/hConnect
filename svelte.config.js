// svelte.config.js
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
	compilerOptions: {
		runes: true
	},
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			fallback: 'index.html',
			pages: 'build',
			assets: 'build',
			precompress: false
		}),
		prerender: { entries: [] }
	},
	vitePlugin: {
		inspector: true
	}
};

export default config;
