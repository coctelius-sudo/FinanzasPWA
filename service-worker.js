// service-worker.js - simple cache-first PWA service worker
const CACHE_VERSION = 'finanzas-v1.0.1'; // increment this when deploying new version
const CACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css?v=1.0.1',
  '/app.js?v=1.0.1',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(CACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => {
        if (key !== CACHE_VERSION) return caches.delete(key);
      }))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', evt => {
  // only handle GET
  if (evt.request.method !== 'GET') return;
  evt.respondWith(
    caches.match(evt.request).then(cacheRes => {
      return cacheRes || fetch(evt.request).then(fetchRes => {
        return caches.open(CACHE_VERSION).then(cache => {
          // put copy in cache for offline use (ignore opaque cross-origin requests)
          if (evt.request.url.startsWith(self.location.origin)) {
            cache.put(evt.request, fetchRes.clone());
          }
          return fetchRes;
        });
      }).catch(() => {
        // fallback to offline page if you add one; currently return nothing
      });
    })
  );
});
