// Service worker: offline app shell, push notifications, update flow.
// __VERSION__ and __ASSETS__ are filled in by scripts/build.mjs.

const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;
const CACHE = `masroufi-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })));
    // first install takes over at once; later versions wait for the user to tap "حدّث"
    if (!(await self.clients.matchAll()).length) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('masroufi-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cached = await caches.match('./index.html', { ignoreSearch: true });
      if (cached) return cached;
      try {
        return await fetch(req);
      } catch {
        return new Response('offline', { status: 503 });
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: url.pathname.endsWith('.woff2') });
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const c = await caches.open(CACHE);
      c.put(req, res.clone());
    }
    return res;
  })());
});

/* ------------------------------------------------------------ push */

self.addEventListener('push', (e) => {
  let p = {};
  try {
    p = e.data ? e.data.json() : {};
  } catch {
    p = { title: 'مصروفي', body: e.data ? e.data.text() : '' };
  }
  const title = p.title || 'مصروفي';
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: p.body || '',
      tag: p.tag,
      icon: 'assets/icons/icon-192.png',
      badge: 'assets/icons/badge-72.png',
      dir: 'rtl',
      lang: 'ar',
      data: { url: p.url || '#/' },
    }),
    typeof p.badge === 'number' && self.navigator.setAppBadge
      ? (p.badge > 0 ? self.navigator.setAppBadge(p.badge) : self.navigator.clearAppBadge()).catch(() => {})
      : Promise.resolve(),
  ]));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.url) || '#/';
  const target = new URL('./' + (hash.startsWith('#') ? hash : '#' + hash.replace(/^.*#/, '')), self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        w.postMessage({ type: 'navigate', url: hash });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const old = e.oldSubscription;
    const key = old && old.options && old.options.applicationServerKey;
    if (!key) return;
    const sub = e.newSubscription || (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), replaces: old && old.endpoint }),
    }).catch(() => {});
  })());
});
