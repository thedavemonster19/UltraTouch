/* Offline cache for UltraTouch. Bump VERSION when shipping changes. */
const VERSION = 'ut-cfb0e81f76';
const FILES = ['./', 'index.html', 'css/style.css', 'js/core.js', 'js/swish.js', 'js/pairoff.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
/* network first for our files (so updates land), cache fallback offline; fonts cached as they load */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    /* revalidate with GitHub on every load for our own files, so a new release is never hidden behind
       the 10-minute HTTP cache; the cache below is only the offline fallback */
    fetch(e.request, e.request.url.startsWith(self.location.origin) ? { cache: 'no-cache' } : undefined)
      .then((res) => {
        if (res.ok && (e.request.url.startsWith(self.location.origin) || e.request.url.includes('fonts.g'))) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
