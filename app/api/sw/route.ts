export async function GET() {
  const swCode = `
// INCREMENT THIS VERSION TO FORCE UPDATE ON PHONES
const CACHE_NAME = 'signal-monitor-v3-mobile-fix';
const urlsToCache = ['/', '/globals.css', '/manifest.json'];

// 1. INSTALL: Force aggressive takeover
self.addEventListener('install', (event) => {
  self.skipWaiting(); // KICK OUT THE OLD WORKER IMMEDIATELY
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

// 2. ACTIVATE: Delete all old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim(); // Take control of all clients immediately
});

// 3. FETCH: Network First (Always try to get fresh code)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  // API calls: Network only
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // If network works, update cache and return
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // If offline, serve cache
        return caches.match(event.request);
      })
  );
});
`;

  return new Response(swCode, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate', // DO NOT CACHE THE WORKER FILE
      'Service-Worker-Allowed': '/',
    },
  });
}