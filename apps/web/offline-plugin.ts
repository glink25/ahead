import type { Plugin } from 'vite'
/** Cache build assets only. Language resources are cached after they are used. */
export function offlinePlugin(): Plugin {
  return {
    name: 'ahead-offline',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const languageAssets: Record<string, string[]> = {}
        for (const [file, output] of Object.entries(bundle)) {
          if (output.type !== 'asset') continue
          const sourceNames = [...output.names, ...output.originalFileNames]
          for (const id of sourceNames) {
            const match = id.match(/(?:^|\/)locales\/([^/]+)\/([^/]+)\.json(?:\?url)?$/)
            if (!match) continue
            const language = match[1]!
            languageAssets[language] = [...new Set([
              ...(languageAssets[language] ?? []), '/' + file,
              '/reset-locales/' + language + '.js',
            ])]
          }
        }
        const lazyAssets = Object.values(languageAssets).flat()
        const assets = [
          '/', '/icon.svg', '/manifest.webmanifest', '/reset.html', '/reset.js',
          ...Object.keys(bundle).filter((p) => p.startsWith('assets/') && !lazyAssets.includes('/' + p)).map((p) => '/' + p),
        ]
        const version = 'ahead-shell-' + Date.now()
        this.emitFile({
          type: 'asset', fileName: 'sw.js', source: `
const CACHE = ${JSON.stringify(version)};
const ASSETS = ${JSON.stringify(assets)};
const LANGUAGES = ${JSON.stringify(languageAssets)};
const LAZY_ASSETS = Object.values(LANGUAGES).flat();
async function cachedAsset(path) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(path);
  if (hit) return hit;
  const response = await fetch(path);
  if (response.ok) await cache.put(path, response.clone());
  return response;
}
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('ahead-shell-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_TRANSLATION') return;
  const path = event.data.path;
  if (typeof path === 'string' && LAZY_ASSETS.includes(path)) event.waitUntil(cachedAsset(path).catch(() => {}));
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || /^\\/(api|auth)(\\/|$)/.test(url.pathname)) return;
  if (url.pathname === '/reset.html') {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then(cache => cache.match('/reset.html'))));
  } else if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then(cache => cache.match('/'))));
  } else if (!url.search && (ASSETS.includes(url.pathname) || LAZY_ASSETS.includes(url.pathname))) {
    event.respondWith(cachedAsset(url.pathname));
  }
});`,
        })
      },
    },
  }
}
