const cachePrefix = 'foco:' + new URL(self.registration.scope).pathname + ':';
const cacheName = cachePrefix + 'v1';
const files = [
  './', './index.html', './style.css', './app.js', './tareas.json',
  './manifest.webmanifest', './apple-touch-icon.png', './icon-192.png', './icon-512.png',
].map((file) => new URL(file, self.registration.scope).href);
const cachedFiles = new Set(files);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(files);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const obsolete = (await caches.keys()).filter((key) => key.startsWith(cachePrefix) && key !== cacheName);
    await Promise.all(obsolete.map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  url.search = '';
  if (cachedFiles.has(url.href)) {
    event.respondWith(networkFirst(event.request, url.href));
  }
});

async function networkFirst(request, key) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      try {
        const cache = await caches.open(cacheName);
        await cache.put(key, response.clone());
      } catch {
        // A full or unavailable cache should not interrupt an online visit.
      }
    }
    return response;
  } catch {
    const cache = await caches.open(cacheName);
    return (await cache.match(key)) || Response.error();
  }
}
