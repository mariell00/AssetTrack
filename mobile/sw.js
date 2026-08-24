// sw.js — Service Worker. Caches the PWA shell for offline use and serves
// cached assets when the phone has no Wi-Fi connection to the desktop host.
const CACHE_NAME = 'assettrack-mobile-v1';
const APP_SHELL = [
  './index.html',
  './styles/mobile-retro.css',
  './src/app.js',
  './src/core/api-client.js',
  './src/core/indexed-db.js',
  './src/features/auth/services.js',
  './src/features/auth/ui-login.js',
  './src/features/nfc-reader/services.js',
  './src/features/nfc-reader/ui-scanner.js',
  './src/features/asset-scan/services.js',
  './src/features/asset-scan/ui-scan.js',
  './src/features/sync/services.js',
  './src/features/sync/ui-sync.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for API calls (so live data wins when Wi-Fi is up),
// cache-first for the app shell (so the app still opens when offline).
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ ok: false, offline: true }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
