/* ============================================================
   worker.js — صندوق بريد الفروع
   ------------------------------------------------------------
   يُرفع على Cloudflare Workers مجاناً. وظيفته الوحيدة:
   كل فرع يكتب ملفه هو فقط، ويقرأ ملفات الفروع الأخرى.
   لا توجد بيانات مشتركة يكتب فيها اثنان — فلا تعارض ولا تلف.

   لا يمر عبره أي شيء عن مبيعاتك أو زبائنك أو أرباحك:
   فقط أسماء الأصناف وكمياتها وأسعارها ومواقعها، وطلبات التحويل.
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (!env.SHOP_SECRET) return json({ ok: false, error: "SHOP_SECRET غير مضبوط" }, 500);
    if (!env.SHOP) return json({ ok: false, error: "ربط KV باسم SHOP غير موجود" }, 500);

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
