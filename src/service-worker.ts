/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="../.svelte-kit/ambient.d.ts" />

import { build, files, prerendered, version as revision } from '$service-worker'
import { clientsClaim, setCacheNameDetails, skipWaiting } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { Route, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'

declare let self: ServiceWorkerGlobalScope

self.__WB_DISABLE_DEV_LOGS = true

setCacheNameDetails({
	prefix: 'hConnect',
	suffix: 'v1',
	precache: 'precache',
	runtime: 'runtime',
	googleAnalytics: 'ga',
})

skipWaiting()
clientsClaim()

const urls = ['/index.html', ...build, ...files, ...prerendered]
precacheAndRoute(urls.map((url) => ({ url, revision })))

cleanupOutdatedCaches()

const imageRoute = new Route(
	({ request }) => request.destination === 'image',
	new CacheFirst({
		cacheName: 'images',
		plugins: [
			new ExpirationPlugin({
				maxAgeSeconds: 60 * 60 * 24 * 30,
				maxEntries: 3200,
				purgeOnQuotaError: true,
			}),
		],
	}),
)

registerRoute(imageRoute)
