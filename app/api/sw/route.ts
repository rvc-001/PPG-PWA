export async function GET() {
  const swCode = `
// Increment this version to force all users to get the new update
const CACHE_NAME = 'signal-monitor-v2-production'; 
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/globals.css'
];

// Install: Cache core files
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Force activation immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache).catch((err) => {
        console.error('Cache addAll error:', err);
      });
    })
  );
});

// Activate: Delete old caches immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Clearing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim(); // Take control of all clients immediately
});

// Fetch: Network First strategy (Vital for frequent updates)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // If network works, return response and update cache
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // If offline, try cache
        return caches.match(event.request);
      })
  );
});
`;

  return new Response(swCode, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // CRITICAL: Tell browsers NEVER to cache the service worker file itself
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Service-Worker-Allowed': '/',
    },
  });
}