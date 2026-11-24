// Network first, so a new version reaches every phone on its next launch;
// the cached copy is used only when offline (or the network is very slow).
// Media lives in IndexedDB, never here. API/relay/radio requests always go
// straight to the network.
const VERSION = 'dandana-v1.3.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/version.js', 'js/util.js', 'js/icons.js', 'js/db.js', 'js/library.js', 'js/tags.js', 'js/zip.js',
  'js/art.js', 'js/importer.js', 'js/api.js', 'js/player.js', 'js/radio.js', 'js/lyrics.js',
  'js/taste.js', 'js/ui.js', 'js/nowplaying.js', 'js/views.js', 'js/reels.js',
  'js/cobalt.js', 'js/ytapi.js', 'js/themes.js', 'js/ailyrics.js', 'js/sponsor.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

const BYPASS = /\/(api|relay|ashell)\/|instances\.json$|version\.json$/;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || BYPASS.test(url.pathname) || req.headers.get('range')) return;
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  const key = req.mode === 'navigate' ? 'index.html' : req;
  try {
    const res = await Promise.race([
      fetch(req, { cache: 'no-cache' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4500)),
    ]);
    if (res.ok && res.type === 'basic') cache.put(key, res.clone());
    return res;
  } catch {
    const hit = await cache.match(key, { ignoreSearch: true });
    return hit || Response.error();
  }
}
