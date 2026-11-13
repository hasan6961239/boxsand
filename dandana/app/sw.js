// App-shell cache. Media lives in IndexedDB, never here; API/YouTube/radio
// requests always go to the network.
const VERSION = 'dandana-v1.1.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/util.js', 'js/icons.js', 'js/db.js', 'js/library.js', 'js/tags.js', 'js/zip.js',
  'js/art.js', 'js/importer.js', 'js/api.js', 'js/player.js', 'js/radio.js', 'js/lyrics.js',
  'js/taste.js', 'js/ui.js', 'js/nowplaying.js', 'js/views.js', 'js/reels.js',
  'js/cobalt.js', 'js/ytapi.js', 'js/themes.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.includes('/api/') || url.pathname.endsWith('instances.json')) return;
  if (req.headers.get('range')) return;
  // Stale-while-revalidate for the shell; navigations fall back to index.html offline.
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const key = req.mode === 'navigate' ? 'index.html' : req;
      const hit = await cache.match(key, { ignoreSearch: true });
      const net = fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') cache.put(key, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});
