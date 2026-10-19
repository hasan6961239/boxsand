/* ============================================================
   sw.js — يفتح التطبيق بلا إنترنت (الآيفون والمتصفح)
   ------------------------------------------------------------
   يحفظ ملفات الواجهة نفسها فقط، لا بيانات المحل: آخر لقطة في
   localStorage كما كانت، وطلبات خادم الربط تمرّ مباشرة بلا لمس.
     • الصفحة والسكربتات: من الشبكة أولاً فيصل كل تحديث فوراً، وإن
       انقطعت أو تأخّرت أكثر من 3 ثوانٍ فالنسخة المحفوظة.
     • قارئ الباركود (vendor/): رقم نسخته في اسمه، فيُحفظ مرة واحدة.
   ============================================================ */
var CACHE = "maktaba-app-1";
var CORE = [
  "./", "app.css", "app.js", "phone.js", "scan.js", "config.js", "manifest.json",
  "icon.svg", "icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable.png",
  "vendor/zxing-reader-3.1.4.js", "vendor/zxing_reader-3.1.4.wasm"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(CORE.map(function (u) { return new Request(u, { cache: "reload" }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) {
      return k.indexOf("maktaba-app-") === 0 && k !== CACHE;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var r = e.request;
  if (r.method !== "GET") return;
  var u = new URL(r.url), nav = r.mode === "navigate";
  if (u.origin !== self.location.origin) return;          // خادم الربط وغيره: مباشرة
  // ملفات الواجهة وحدها؛ أي طلب بيانات يمرّ كما هو ولا يُحفظ أبداً
  if (!nav && !/\.(?:html|css|js|json|png|svg|ico|wasm)$/.test(u.pathname)) return;
  if (u.pathname.indexOf("/vendor/") >= 0) { e.respondWith(cacheFirst(r)); return; }
  e.respondWith(netFirst(r, nav));
});

function put(r, res) {
  caches.open(CACHE).then(function (c) { return c.put(r, res); }).catch(function () { });
}

function cacheFirst(r) {
  return caches.match(r).then(function (hit) {
    return hit || fetch(r).then(function (res) {
      if (res && res.ok) put(r, res.clone());
      return res;
    });
  });
}

function netFirst(r, nav) {
  function saved() {
    return caches.match(r, { ignoreSearch: true }).then(function (hit) {
      return hit || (nav ? caches.match("./") : null);
    });
  }
  return new Promise(function (resolve) {
    var done = false;
    function give(res) { if (!done && res) { done = true; resolve(res); } }
    var slow = setTimeout(function () { saved().then(give); }, 3000);
    fetch(r).then(function (res) {
      clearTimeout(slow);
      if (res && res.ok) { put(r, res.clone()); give(res); return; }
      saved().then(function (hit) { give(hit || res); });
    }).catch(function () {
      clearTimeout(slow);
      saved().then(function (hit) { give(hit || Response.error()); });
    });
  });
}
