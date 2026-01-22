export async function GET() {
  const swCode = `
// UPDATE VERSION TO FORCE RELOAD
const CACHE_NAME = 'signal-monitor-v2-dev'; 
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/globals.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

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
  self.clients.claim();
});

// DEV STRATEGY: NETWORK FIRST (Always try to get fresh code)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Update cache with fresh copy if successful
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache ONLY if offline/network fails
        return caches.match(event.request);
      })
  );
});
`;

  return new Response(swCode, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate', // Disable HTTP caching
      'Service-Worker-Allowed': '/',
    },
  });
}