/* ============================================================
   worker.js — صندوق بريد الفروع
   ------------------------------------------------------------
   يُرفع على Cloudflare Workers مجاناً. وظيفته الوحيدة:
   كل فرع يكتب ملفه هو فقط، ويقرأ ملفات الفروع الأخرى.
   لا توجد بيانات مشتركة يكتب فيها اثنان — فلا تعارض ولا تلف.

   لا يمر عبره أي شيء عن مبيعاتك أو زبائنك أو أرباحك:
   فقط أسماء الأصناف وكمياتها وأسعارها ومواقعها، وطلبات التحويل.

   /catalog هو المسار الوحيد بلا كلمة سر: يعطي موقع المكتبة أسماء الكتب
   المتوفرة ومؤلفيها وباركودها وتصنيفها فقط — بلا أسعار ولا كميات.
   ============================================================

   خطوات الرفع (مرة واحدة، من أي جهاز فيه إنترنت):

   1. سجّل في dash.cloudflare.com (مجاناً، بلا بطاقة).

   2. Storage & Databases ← KV ← Create a namespace
      سمّه: SHOP_DATA

   3. Compute (Workers) ← Create ← Start from Hello World ←
      سمّه مثلاً: maktaba-sync ← Deploy

   4. افتح الـ Worker ← Edit code ← امسح كل الموجود ←
      الصق هذا الملف كاملاً ← Deploy

   5. Settings ← Bindings ← Add ← KV Namespace
        Variable name: SHOP
        KV namespace:  SHOP_DATA
      ثم Add ← Secret (أو Environment Variable)
        Variable name: SHOP_SECRET
        Value: اختر كلمة سر طويلة، مثلاً:  Maktaba#Nour!2026$Libya
      ثم Deploy مرة أخرى.

   6. انسخ عنوان الـ Worker (شكله: https://maktaba-sync.<اسمك>.workers.dev)
      وضعه في كل فرع من: المخزون ← إعداد الربط
      مع نفس كلمة السر، ورمز فرع مختلف لكل واحد.

   مهم: إن كان workers.dev محجوباً عند مزوّد الإنترنت عندك،
   اربط نطاقاً خاصاً بك على نفس الـ Worker من Settings ← Domains
   وضع عنوان النطاق بدل عنوان workers.dev.
   ============================================================ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Shop-Key",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

// مقارنة لا تتأثر بتوقيت التنفيذ
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* قائمة الكتب العامة لموقع المكتبة: بلا مفتاح، ولا يخرج منها إلا
   العنوان والمؤلف والباركود والتصنيف للكتب المتوفرة — لا أسعار ولا كميات.
   تُحفظ 5 دقائق في ذاكرة Cloudflare فلا تُستهلك قراءات KV مع كل زائر. */
async function catalog(request, env, ctx) {
  const url = new URL(request.url);
  const want = (url.searchParams.get("branch") || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40);
  const cache = caches.default;
  const cacheKey = new Request(url.origin + "/catalog?branch=" + want);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let snap = null;
  if (want) {
    try { snap = JSON.parse(await env.SHOP.get("branch:" + want) || "null"); } catch { }
  }
  if (!snap) {
    const listed = await env.SHOP.list({ prefix: "branch:" });
    for (const k of listed.keys) {
      try {
        const s = JSON.parse(await env.SHOP.get(k.name) || "null");
        if (s && s.kind !== "phone") { snap = s; break; }
      } catch { }
    }
  }
  if (!snap || snap.kind === "phone") return json({ ok: false, error: "لا توجد بيانات" }, 404);

  const books = (snap.items || [])
    .filter(it => it && it.t === "book" && Number(it.q) > 0 && it.n)
    .map(it => [String(it.n).slice(0, 300), String(it.a || "").slice(0, 200),
                String(it.b || it.k || "").slice(0, 40), String(it.c || "").slice(0, 300)]);
  const res = new Response(JSON.stringify({ ok: true, at: snap.at || snap.serverAt || "", books }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", ...CORS },
  });
  if (ctx) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (!env.SHOP_SECRET) return json({ ok: false, error: "SHOP_SECRET غير مضبوط" }, 500);
    if (!env.SHOP) return json({ ok: false, error: "ربط KV باسم SHOP غير موجود" }, 500);

    if (new URL(request.url).pathname.replace(/\/+$/, "").endsWith("/catalog") && request.method === "GET") {
      return catalog(request, env, ctx);
    }

    const key = request.headers.get("X-Shop-Key") || "";
    if (!safeEqual(key, env.SHOP_SECRET)) return json({ ok: false, error: "unauthorized" }, 401);

    const path = new URL(request.url).pathname.replace(/\/+$/, "");

    // رفع لقطة فرع واحد
    if (path.endsWith("/put") && request.method === "POST") {
      let snap;
      try { snap = await request.json(); }
      catch { return json({ ok: false, error: "محتوى غير صالح" }, 400); }

      const id = snap && snap.branch && String(snap.branch.id || "").trim();
      if (!id || !/^[a-z0-9._-]{1,40}$/i.test(id)) {
        return json({ ok: false, error: "رمز فرع غير صالح" }, 400);
      }
      snap.serverAt = new Date().toISOString();
      await env.SHOP.put("branch:" + id.toLowerCase(), JSON.stringify(snap), {
        expirationTtl: 60 * 60 * 24 * 120,   // يُنظَّف تلقائياً بعد 120 يوماً بلا تحديث
      });
      return json({ ok: true });
    }

    // قراءة لقطات كل الفروع
    if (path.endsWith("/all") && request.method === "GET") {
      const listed = await env.SHOP.list({ prefix: "branch:" });
      const branches = [];
      for (const k of listed.keys) {
        const raw = await env.SHOP.get(k.name);
        if (!raw) continue;
        try { branches.push(JSON.parse(raw)); } catch { }
      }
      return json({ ok: true, branches });
    }

    return json({ ok: false, error: "المسار غير معروف" }, 404);
  },
};
