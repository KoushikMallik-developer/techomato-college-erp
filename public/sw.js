// Keeps the app shell available offline. Data always comes from Firebase (a different origin, never cached here).
const CACHE = 'colleges-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add('/index.html')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Pages: the network first (so a new deploy shows up), the saved shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((res) => {
        // Only a good page becomes the offline page, never a host error page.
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/index.html', copy)); }
        return res;
      }).catch(() => caches.match('/index.html')),
    );
    return;
  }
  // Built files have a hash in their name, so a saved copy never goes stale.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          // Files of old deploys are never asked for again, so keep only the newest 60.
          caches.open(CACHE).then(async (c) => {
            await c.put(request, copy);
            const keys = await c.keys();
            await Promise.all(keys.filter((k) => k.url.includes('/assets/')).slice(0, -60).map((k) => c.delete(k)));
          });
        }
        return res;
      })),
    );
  }
});
