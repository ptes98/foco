const cachePrefix = 'foco:' + new URL(self.registration.scope).pathname + ':';
const cacheName = cachePrefix + 'v2';
const files = [
  './', './index.html', './style.css', './app.js', './tareas.json', './tarjetas.json',
  './manifest.webmanifest', './apple-touch-icon.png', './icon-192.png', './icon-512.png',
].map((file) => new URL(file, self.registration.scope).href);
const cachedFiles = new Set(files);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    // Copias frescas: no se aprovecha la caché HTTP de GitHub Pages al instalar una versión nueva.
    await cache.addAll(files.map((file) => new Request(file, { cache: 'reload' })));
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
  url.hash = '';
  if (cachedFiles.has(url.href)) {
    event.respondWith(cacheFirst(event, url.href));
  }
});

// Responde al momento con lo guardado y actualiza en segundo plano. Con mala cobertura no se espera a la red.
async function cacheFirst(event, key) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key);
  const update = fetch(event.request).then(async (response) => {
    if (response.ok) {
      try {
        await cache.put(key, response.clone());
      } catch {
        // Una caché llena no debe interrumpir la visita.
      }
    }
    return response;
  });
  if (cached) {
    event.waitUntil(update.catch(() => {}));
    return cached;
  }
  try {
    return await update;
  } catch {
    return Response.error();
  }
}
