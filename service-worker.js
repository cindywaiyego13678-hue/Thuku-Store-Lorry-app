// ============================================================
// Service Worker: makes the app shell load with zero internet
// after the first visit. Supabase calls always go to the network.
//
// STRATEGY CHANGE (v2): pages and app JS now use NETWORK-FIRST
// instead of cache-first. The old cache-first approach could
// serve a stale page/script immediately after a deploy (e.g.
// right after a login redirect) and only catch up on the NEXT
// reload, once the background fetch had finished updating the
// cache. Network-first fixes that: it always tries the network
// first and only falls back to the cache when offline. Rarely-
// changing static assets (icons, manifest) stay cache-first,
// since serving those instantly is safe and desirable.
// ============================================================
const CACHE_NAME = 'thuku-store-lorry-shell-v2';

const APP_SHELL = [
  './',
  'index.html',
  'store.html',
  'lorry.html',
  'css/style.css',
  'js/supabase-config.js',
  'js/offline-cache.js',
  'js/lorry-offline-sync.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

// Static assets it's safe to serve instantly from cache and
// refresh quietly in the background — these change rarely.
const CACHE_FIRST_PATTERNS = [
  /\/icons\//,
  /manifest\.json$/
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Supabase API calls — always go live
  if (url.hostname.includes('supabase.co')) return;

  const isCacheFirstAsset = CACHE_FIRST_PATTERNS.some((pattern) => pattern.test(url.pathname));

  if (isCacheFirstAsset) {
    // Cache-first, refresh in background (stale-while-revalidate) —
    // fine here since these assets rarely change.
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Network-first for everything else — pages (navigations) and
  // app JS/CSS. Always tries to get the latest version; only
  // falls back to whatever's cached if the network request fails
  // (i.e. actually offline).
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
