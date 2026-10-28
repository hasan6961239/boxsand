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
      ولمزامنة 4.0 (قرار 0023): Storage & Databases ← D1 ← Create، سمّها
      maktaba_sync، ثم في الـ Worker: Settings ← Bindings ← Add ← D1 database
        Variable name: DB
        D1 database:   maktaba_sync
      (الجداول يُنشئها الـ Worker وحده عند أول ربط.)
      ثم Add ← Secret (أو Environment Variable)
        Variable name: SHOP_SECRET
        Value: اختر كلمة سر طويلة، مثلاً:  Maktaba#Nour!2026$Libya
      ثم Deploy مرة أخرى.

   6. انسخ عنوان الـ Worker (شكله: https://maktaba-sync.<اسمك>.workers.dev)
      وضعه مع نفس كلمة السر في كل جهاز:
      - 4.0: الإعدادات ← الربط بين الأجهزة والفروع ← «هذا جهاز المحل» على
        جهاز محل كل فرع، و«جهاز ثانٍ لفرع مربوط» على الأجهزة الأخرى.
      - 3.x: المخزون ← إعداد الربط، ورمز فرع مختلف لكل فرع.

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
    // فرع محدد: قراءة واحدة فقط؛ وإن لم يوجد لا نمسح كل الفروع (حتى لا تُستنزف القراءات)
    try { snap = JSON.parse(await env.SHOP.get("branch:" + want) || "null"); } catch { }
  } else {
    const listed = await env.SHOP.list({ prefix: "branch:" });
    for (const k of listed.keys) {
      try {
        const s = JSON.parse(await env.SHOP.get(k.name) || "null");
        if (s && s.kind !== "phone") { snap = s; break; }
      } catch { }
    }
  }
  if (!snap || snap.kind === "phone") {
    const miss = new Response(JSON.stringify({ ok: false, error: "لا توجد بيانات" }), {
      status: 404, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=120", ...CORS },
    });
    if (ctx) ctx.waitUntil(cache.put(cacheKey, miss.clone()));
    return miss;
  }

  const books = (snap.items || [])
    .filter(it => it && it.t === "book" && Number(it.q) > 0 && it.n)
    .map(it => [String(it.n).slice(0, 300), String(it.a || "").slice(0, 200),
                String(it.b || it.k || "").slice(0, 40), String(it.c || "").slice(0, 300)]);
  const res = new Response(JSON.stringify({ ok: true, at: snap.at || snap.serverAt || "", books }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300",
               "X-Content-Type-Options": "nosniff", ...CORS },
  });
  if (ctx) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/* ============================================================
   مزامنة 4.0 (قرار 0023) على قاعدة D1 باسم DB
   ------------------------------------------------------------
   - جهاز المحل (الأساسي) يرفع سجل تغييراته قطعاً متتالية، ونسخة كاملة
     من قاعدته عند الربط وكل يوم. الجهاز الثاني يبدأ من النسخة ثم يطبّق
     القطع بعدها بالترتيب، فتصير قاعدته مثل قاعدة المحل.
   - ما يفعله الجهاز الثاني (إضافة كتاب، بيعة...) يصل هنا أمراً، وجهاز
     المحل ينفّذه بقواعده نفسها ثم يرجع للثاني مع السجل: لا رقم فاتورة
     مكرر ولا كتاب مرتين.
   - كل فرع يرفع قائمة كتبه (الكمية والسعر والمكان) ليراها الفرع الآخر.
   الخادم لا يفهم البيانات ولا يفكّها: نصوص مضغوطة يحفظها ويعيدها كما
   هي، فيبقى كل طلب في حدود 10 ميلي ثانية المجانية.
   ============================================================ */

const V2_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS v2_branch(branch TEXT PRIMARY KEY, main TEXT NOT NULL DEFAULT '', chain TEXT NOT NULL DEFAULT '', " +
    "snap INTEGER NOT NULL DEFAULT -1, snap_ver INTEGER NOT NULL DEFAULT 0, snap_parts INTEGER NOT NULL DEFAULT 0, snap_at INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS v2_device(branch TEXT NOT NULL, device TEXT NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', " +
    "seen INTEGER NOT NULL, PRIMARY KEY(branch, device))",
  "CREATE TABLE IF NOT EXISTS v2_part(branch TEXT NOT NULL, kind TEXT NOT NULL, ver TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, " +
    "PRIMARY KEY(branch, kind, ver, part))",
  "CREATE TABLE IF NOT EXISTS v2_log(branch TEXT NOT NULL, chain TEXT NOT NULL, seq_from INTEGER NOT NULL, seq_to INTEGER NOT NULL, " +
    "ver INTEGER NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(branch, chain, seq_from))",
  "CREATE TABLE IF NOT EXISTS v2_cmd(id INTEGER PRIMARY KEY AUTOINCREMENT, branch TEXT NOT NULL, device TEXT NOT NULL, n INTEGER NOT NULL, " +
    "at INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(branch, device, n))",
  "CREATE TABLE IF NOT EXISTS v2_catalog(branch TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', " +
    "n INTEGER NOT NULL DEFAULT 0, ver TEXT NOT NULL, parts INTEGER NOT NULL, at INTEGER NOT NULL)",
];
const V2_MAX_BODY = 1900000;          // صف D1 حدّه 2 ميغا: القطعة الواحدة أقل منه
const V2_MAIN_STALE = 7 * 86400000;   // جهاز محل لم يظهر أسبوعاً يمكن أن يحلّ غيره محله
const V2_KEEP_LOGS = 7 * 86400000;    // قطع السجل قبل آخر نسخة تبقى أسبوعاً للأجهزة المتأخرة

let v2Ready = false;
async function v2Init(db) {
  if (v2Ready) return;
  await db.batch(V2_SCHEMA.map(s => db.prepare(s)));
  v2Ready = true;
}

function v2Text(text, headers) {
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", ...(headers || {}), ...CORS } });
}

function v2Int(q, k, def) {
  const v = q.get(k);
  if (v === null || v === "") {
    if (def !== undefined) return def;
    throw new Error("الحقل " + k + " ناقص");
  }
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error("الحقل " + k + " ليس رقماً صحيحاً");
  return n;
}

function v2Id(q, k, re) {
  const v = String(q.get(k) || "").trim().toLowerCase();
  if (!re.test(v)) throw new Error("الحقل " + k + " غير صالح");
  return v;
}
const RE_BRANCH = /^[a-z0-9._-]{1,40}$/;
const RE_TOKEN = /^[a-z0-9]{8,40}$/;

async function v2Branch(db, branch) {
  return await db.prepare("SELECT * FROM v2_branch WHERE branch = ?").bind(branch).first();
}

async function v2IsMain(db, branch, device) {
  const b = await v2Branch(db, branch);
  return !!b && b.main === device;
}

/* آخر رقم في سجل سلسلة الفرع الحالية، أو رقم نسختها إن لم يبقَ فيه شيء. النسخة
   اليومية قد تُؤخذ وجهاز المحل لم يرفع آخر ما قبلها بعد: السجل يكمل من حيث وقف،
   ولا تُحسب النسخة نهايته */
async function v2LogTo(db, b) {
  if (!b || !b.chain) return -1;
  const r = await db.prepare("SELECT MAX(seq_to) AS t FROM v2_log WHERE branch = ? AND chain = ?").bind(b.branch, b.chain).first();
  return r && r.t !== null ? r.t : b.snap;
}

async function v2Body(request) {
  const text = await request.text();
  if (text.length > V2_MAX_BODY) throw Object.assign(new Error("القطعة أكبر من حدّ الخادم"), { status: 413 });
  return text;
}

async function v2(request, env, op, q) {
  const db = env.DB;
  await v2Init(db);
  const now = Date.now();
  const branch = v2Id(q, "branch", RE_BRANCH);

  /* كل جهاز يسلّم كل دقيقة: يُسجَّل، ويعرف آخر ما عند الخادم */
  if (op === "hello" && request.method === "GET") {
    const device = v2Id(q, "device", RE_TOKEN);
    const role = q.get("role") === "main" ? "main" : "second";
    const name = String(q.get("name") || "").slice(0, 60);
    await db.prepare("INSERT INTO v2_device(branch, device, role, name, seen) VALUES(?, ?, ?, ?, ?) " +
      "ON CONFLICT(branch, device) DO UPDATE SET role = excluded.role, name = excluded.name, seen = excluded.seen")
      .bind(branch, device, role, name, now).run();
    let b = await v2Branch(db, branch);
    if (!b) {
      await db.prepare("INSERT OR IGNORE INTO v2_branch(branch) VALUES(?)").bind(branch).run();
      b = await v2Branch(db, branch);
    }
    if (role === "main" && b.main !== device) {
      const cur = b.main ? await db.prepare("SELECT name, seen FROM v2_device WHERE branch = ? AND device = ?").bind(branch, b.main).first() : null;
      if (cur && now - cur.seen < V2_MAIN_STALE && q.get("force") !== "1") {
        return json({ ok: false, code: "main-taken", error: "جهاز آخر مسجّل جهازَ المحل لهذا الفرع",
                      main: { device: b.main, name: cur.name, seen: cur.seen } }, 409);
      }
      await db.prepare("UPDATE v2_branch SET main = ? WHERE branch = ?").bind(device, branch).run();
      b = await v2Branch(db, branch);
    }
    const main = b.main ? await db.prepare("SELECT device, name, seen FROM v2_device WHERE branch = ? AND device = ?").bind(branch, b.main).first() : null;
    const cmd = await db.prepare("SELECT MAX(id) AS m FROM v2_cmd WHERE branch = ?").bind(branch).first();
    const cat = await db.prepare("SELECT MAX(at) AS m FROM v2_catalog WHERE branch <> ?").bind(branch).first();
    return json({
      ok: true, now, main: main || null, chain: b.chain,
      snap: b.snap >= 0 && b.chain ? { id: b.snap, ver: b.snap_ver, parts: b.snap_parts, at: b.snap_at } : null,
      logTo: await v2LogTo(db, b), cmdMax: cmd && cmd.m !== null ? cmd.m : 0, catalogsAt: cat && cat.m !== null ? cat.m : 0,
    });
  }

  /* نسخة كاملة من قاعدة المحل، قطعة قطعة. اكتمالها يجعلها بداية السلسلة */
  if (op === "snap" && request.method === "POST") {
    const device = v2Id(q, "device", RE_TOKEN), chain = v2Id(q, "chain", RE_TOKEN);
    const id = v2Int(q, "id"), ver = v2Int(q, "ver"), part = v2Int(q, "part"), parts = v2Int(q, "parts");
    if (parts < 1 || parts > 500 || part < 0 || part >= parts) throw new Error("رقم القطعة غير صالح");
    if (!(await v2IsMain(db, branch, device))) return json({ ok: false, code: "not-main", error: "هذا الجهاز ليس جهاز المحل" }, 409);
    const key = chain + ":" + id;
    await db.prepare("INSERT OR REPLACE INTO v2_part(branch, kind, ver, part, data) VALUES(?, 'snap', ?, ?, ?)")
      .bind(branch, key, part, await v2Body(request)).run();
    const have = await db.prepare("SELECT COUNT(*) AS n FROM v2_part WHERE branch = ? AND kind = 'snap' AND ver = ?").bind(branch, key).first();
    if (have.n < parts) return json({ ok: true, complete: false });
    await db.batch([
      db.prepare("UPDATE v2_branch SET chain = ?, snap = ?, snap_ver = ?, snap_parts = ?, snap_at = ? WHERE branch = ?")
        .bind(chain, id, ver, parts, now, branch),
      db.prepare("DELETE FROM v2_part WHERE branch = ? AND kind = 'snap' AND ver <> ?").bind(branch, key),
      db.prepare("DELETE FROM v2_log WHERE branch = ? AND chain <> ?").bind(branch, chain),
      db.prepare("DELETE FROM v2_log WHERE branch = ? AND chain = ? AND seq_to <= ? AND at < ?").bind(branch, chain, id, now - V2_KEEP_LOGS),
    ]);
    return json({ ok: true, complete: true });
  }

  if (op === "snap-part" && request.method === "GET") {
    const chain = v2Id(q, "chain", RE_TOKEN), id = v2Int(q, "id"), part = v2Int(q, "part");
    const r = await db.prepare("SELECT data FROM v2_part WHERE branch = ? AND kind = 'snap' AND ver = ? AND part = ?")
      .bind(branch, chain + ":" + id, part).first();
    if (!r) return json({ ok: false, code: "gone", error: "النسخة تغيّرت، يُعاد التحميل" }, 410);
    return v2Text(r.data);
  }

  /* قطعة من سجل التغييرات: متتالية بلا فجوة، ومن جهاز المحل وحده */
  if (op === "log" && request.method === "POST") {
    const device = v2Id(q, "device", RE_TOKEN), chain = v2Id(q, "chain", RE_TOKEN);
    const from = v2Int(q, "from"), to = v2Int(q, "to"), ver = v2Int(q, "ver");
    if (to < from) throw new Error("قطعة فارغة");
    const b = await v2Branch(db, branch);
    if (!b || b.main !== device) return json({ ok: false, code: "not-main", error: "هذا الجهاز ليس جهاز المحل" }, 409);
    if (b.chain !== chain) return json({ ok: false, code: "chain", error: "السلسلة تغيّرت" }, 409);
    const last = await v2LogTo(db, b);
    if (to <= last) return json({ ok: true, dup: true, last });
    if (from !== last + 1) return json({ ok: false, code: "gap", error: "فجوة في السجل", last }, 409);
    await db.prepare("INSERT INTO v2_log(branch, chain, seq_from, seq_to, ver, at, data) VALUES(?, ?, ?, ?, ?, ?, ?)")
      .bind(branch, chain, from, to, ver, now, await v2Body(request)).run();
    return json({ ok: true, last: to });
  }

  /* القطعة التي فيها الرقم بعد after. 204 = لا جديد، 410 = قُصّت (يُعاد من النسخة) */
  if (op === "log" && request.method === "GET") {
    const chain = v2Id(q, "chain", RE_TOKEN), after = v2Int(q, "after");
    const b = await v2Branch(db, branch);
    if (!b || b.chain !== chain) return json({ ok: false, code: "chain", error: "السلسلة تغيّرت، يُعاد التحميل من النسخة" }, 409);
    const r = await db.prepare("SELECT seq_from, seq_to, ver, data FROM v2_log WHERE branch = ? AND chain = ? AND seq_from <= ? AND seq_to >= ? LIMIT 1")
      .bind(branch, chain, after + 1, after + 1).first();
    if (r) return v2Text(r.data, { "X-From": String(r.seq_from), "X-To": String(r.seq_to), "X-Ver": String(r.ver) });
    if (after >= await v2LogTo(db, b)) return new Response(null, { status: 204, headers: CORS });
    return json({ ok: false, code: "gone", error: "قطع السجل القديمة حُذفت، يُعاد التحميل من النسخة" }, 410);
  }

  /* أمر من جهاز ثانٍ: مرة واحدة ولو أُرسل مرتين */
  if (op === "cmd" && request.method === "POST") {
    const device = v2Id(q, "device", RE_TOKEN), n = v2Int(q, "n");
    const known = await db.prepare("SELECT 1 AS k FROM v2_device WHERE branch = ? AND device = ?").bind(branch, device).first();
    if (!known) return json({ ok: false, code: "unknown-device", error: "جهاز غير مسجّل" }, 409);
    const data = await v2Body(request);
    if (data.length > 200000) throw Object.assign(new Error("الأمر أكبر من المسموح"), { status: 413 });
    await db.prepare("INSERT OR IGNORE INTO v2_cmd(branch, device, n, at, data) VALUES(?, ?, ?, ?, ?)").bind(branch, device, n, now, data).run();
    const r = await db.prepare("SELECT id FROM v2_cmd WHERE branch = ? AND device = ? AND n = ?").bind(branch, device, n).first();
    return json({ ok: true, id: r.id });
  }

  if (op === "cmds" && request.method === "GET") {
    const after = v2Int(q, "after", 0), limit = Math.min(Math.max(v2Int(q, "limit", 50), 1), 200);
    const r = await db.prepare("SELECT id, device, n, at, data FROM v2_cmd WHERE branch = ? AND id > ? ORDER BY id LIMIT ?").bind(branch, after, limit).all();
    return json({ ok: true, cmds: r.results || [] });
  }

  /* قائمة كتب الفرع للفروع الأخرى، قطعة قطعة. اكتمالها يحلّ محل السابقة */
  if (op === "catalog" && request.method === "POST") {
    const device = v2Id(q, "device", RE_TOKEN), ver = v2Id(q, "ver", RE_TOKEN);
    const part = v2Int(q, "part"), parts = v2Int(q, "parts"), n = v2Int(q, "n", 0);
    if (parts < 1 || parts > 100 || part < 0 || part >= parts) throw new Error("رقم القطعة غير صالح");
    if (!(await v2IsMain(db, branch, device))) return json({ ok: false, code: "not-main", error: "هذا الجهاز ليس جهاز المحل" }, 409);
    await db.prepare("INSERT OR REPLACE INTO v2_part(branch, kind, ver, part, data) VALUES(?, 'cat', ?, ?, ?)")
      .bind(branch, ver, part, await v2Body(request)).run();
    const have = await db.prepare("SELECT COUNT(*) AS c FROM v2_part WHERE branch = ? AND kind = 'cat' AND ver = ?").bind(branch, ver).first();
    if (have.c < parts) return json({ ok: true, complete: false });
    await db.batch([
      db.prepare("INSERT INTO v2_catalog(branch, name, city, n, ver, parts, at) VALUES(?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(branch) DO UPDATE SET name = excluded.name, city = excluded.city, n = excluded.n, ver = excluded.ver, parts = excluded.parts, at = excluded.at")
        .bind(branch, String(q.get("name") || "").slice(0, 80), String(q.get("city") || "").slice(0, 40), n, ver, parts, now),
      db.prepare("DELETE FROM v2_part WHERE branch = ? AND kind = 'cat' AND ver <> ?").bind(branch, ver),
    ]);
    return json({ ok: true, complete: true });
  }

  if (op === "catalogs" && request.method === "GET") {
    const r = await db.prepare("SELECT branch, name, city, n, ver, parts, at FROM v2_catalog ORDER BY branch").all();
    return json({ ok: true, catalogs: r.results || [] });
  }

  if (op === "catalog-part" && request.method === "GET") {
    const ver = v2Id(q, "ver", RE_TOKEN), part = v2Int(q, "part");
    const r = await db.prepare("SELECT data FROM v2_part WHERE branch = ? AND kind = 'cat' AND ver = ? AND part = ?").bind(branch, ver, part).first();
    if (!r) return json({ ok: false, code: "gone", error: "القائمة تغيّرت" }, 410);
    return v2Text(r.data);
  }

  return json({ ok: false, error: "المسار غير معروف" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (!env.SHOP_SECRET) return json({ ok: false, error: "SHOP_SECRET غير مضبوط" }, 500);

    const url = new URL(request.url);
    const v2At = url.pathname.indexOf("/v2/");
    if (v2At >= 0) {
      const key = request.headers.get("X-Shop-Key") || "";
      if (!safeEqual(key, env.SHOP_SECRET)) return json({ ok: false, error: "unauthorized" }, 401);
      if (!env.DB) return json({ ok: false, code: "no-d1", error: "قاعدة D1 باسم DB غير مربوطة بالـ Worker — راجع الخطوة 5" }, 501);
      try { return await v2(request, env, url.pathname.slice(v2At + 4).replace(/\/+$/, ""), url.searchParams); }
      catch (e) { return json({ ok: false, error: String(e && e.message || e) }, e && e.status || 400); }
    }

    if (!env.SHOP) return json({ ok: false, error: "ربط KV باسم SHOP غير موجود" }, 500);

    if (url.pathname.replace(/\/+$/, "").endsWith("/catalog") && request.method === "GET") {
      return catalog(request, env, ctx);
    }

    const key = request.headers.get("X-Shop-Key") || "";
    if (!safeEqual(key, env.SHOP_SECRET)) return json({ ok: false, error: "unauthorized" }, 401);

    const path = url.pathname.replace(/\/+$/, "");

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
