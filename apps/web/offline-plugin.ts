import type { Plugin } from 'vite'
/** Cache only build assets; business data and credentials remain in IndexedDB. */
export function offlinePlugin(): Plugin {
  return {
    name: 'ahead-offline',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const assets = [
          '/',
          '/icon.svg',
          '/manifest.webmanifest',
          '/reset.html',
          '/reset.js',
          ...Object.keys(bundle)
            .filter((p) => p.startsWith('assets/'))
            .map((p) => '/' + p),
        ]
        const version = 'ahead-shell-' + Date.now()
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: `
const CACHE = ${JSON.stringify(version)};
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('ahead-shell-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || /^\\/(api|auth)(\\/|$)/.test(url.pathname)) return;
  if (url.pathname === '/reset.html') {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then(cache => cache.match('/reset.html'))));
  } else if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then(cache => cache.match('/'))));
  } else if (ASSETS.includes(url.pathname) && !url.search) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(request)));
  }
});`,
        })
      },
    },
  }
}
