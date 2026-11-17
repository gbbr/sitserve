// sitserve's service worker. It lets the installed app open without a connection: page files come
// from the network while online, so a deploy shows on the next load, and from the cache offline.
// Searches, photos and Cloudflare's own paths (such as the Access login) always use the network.
const CACHE = 'sitserve-v1';
// Every file the page loads at startup, cached on install so the first visit can open offline.
const SHELL = ['/', '/app.js', '/places.js', '/shared/courses.js', '/assets/wheel/dhamma-wheel.svg'];
const NETWORK_ONLY = ['/api/', '/photo/', '/cdn-cgi/'];

addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => skipWaiting()));
});

addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => clients.claim()));
});

addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || NETWORK_ONLY.some(path => url.pathname.startsWith(path))) return;
  event.respondWith(fetch(request).then(response => {
    // Only complete same-origin responses are kept. Redirects, such as Access sending an expired
    // session to its login page, pass through uncached.
    if (response.ok && response.type === 'basic' && !response.redirected) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
    }
    return response;
  }, async error => {
    const options = { ignoreSearch: true, ignoreVary: true };
    const cached = await caches.match(request, options) || (request.mode === 'navigate' && await caches.match('/', options));
    if (cached) return cached;
    throw error;
  }));
});
