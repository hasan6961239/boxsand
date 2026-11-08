/* ============================================================
   fake-cloud.js — خادم الربط على هذا الجهاز للاختبار (قرار 0023)
   ------------------------------------------------------------
   يشغّل cloud/worker.js نفسه، كما يُلصق في Cloudflare، تحت Node:
   - D1 (env.DB): بديل صغير على node:sqlite بنفس الواجهة
     (prepare/bind/first/all/run/batch).
   - KV (env.SHOP): خريطة في الذاكرة.
   فما يُختبر هنا هو الكود الذي يرفعه صاحب المحل، لا نسخة عنه.

     node tools/fake-cloud.js [المنفذ] [كلمة السر]
   أو من اختبار: require('./fake-cloud').start({ secret })

   timing: مدة كل طلب، ومنها ما قضاه في D1. الباقي حساب الـ Worker نفسه، وهو ما
   يحدّه Cloudflare في الخطة المجانية (10 ميلي ثانية لكل طلب)؛ D1 انتظار لا يُحسب.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { AsyncLocalStorage } = require('async_hooks');
const { DatabaseSync } = require('node:sqlite');

/* وقت D1 للطلب الجاري (timing) */
const d1Time = new AsyncLocalStorage();
function d1Run(f) {
  const t = process.hrtime.bigint();
  try { return f(); }
  finally {
    const st = d1Time.getStore();
    if (st) st.d1 += Number(process.hrtime.bigint() - t) / 1e6;
  }
}

const ROOT = path.join(__dirname, '..');

/* ---------- D1 ---------- */

function d1(file) {
  const db = new DatabaseSync(file || ':memory:');
  const stats = { reads: 0, writes: 0 };
  function stmt(sql, args) {
    const s = {
      bind(...a) { return stmt(sql, a); },
      async first(col) {
        stats.reads++;
        const r = d1Run(() => db.prepare(sql).get(...args));
        if (r === undefined) return null;
        return col ? r[col] : Object.assign({}, r);
      },
      async all() {
        stats.reads++;
        return { success: true, results: d1Run(() => db.prepare(sql).all(...args)).map(r => Object.assign({}, r)) };
      },
      async run() {
        stats.writes++;
        const r = d1Run(() => db.prepare(sql).run(...args));
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
      _exec() {
        if (/^\s*(SELECT|WITH)/i.test(sql)) return { success: true, results: db.prepare(sql).all(...args) };
        stats.writes++;
        const r = db.prepare(sql).run(...args);
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      }
    };
    return s;
  }
  return {
    stats,
    raw: db,
    prepare(sql) { return stmt(sql, []); },
    /* كما في D1: الكل في معاملة واحدة، أو لا شيء */
    async batch(list) {
      return d1Run(() => {
        db.exec('BEGIN');
        try {
          const out = list.map(s => s._exec());
          db.exec('COMMIT');
          return out;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      });
    }
  };
}

/* ---------- KV ---------- */

function kv() {
  const m = new Map();
  /* العدّادات كحدود الخطة المجانية: ألف list وألف كتابة ومئة ألف قراءة في اليوم */
  const stats = { list: 0, get: 0, put: 0 };
  return {
    map: m, stats,
    async get(k) { stats.get++; return m.has(k) ? m.get(k) : null; },
    async put(k, v) { stats.put++; m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
    async list(o) {
      stats.list++;
      const p = (o && o.prefix) || '';
      return { keys: [...m.keys()].filter(k => k.startsWith(p)).map(name => ({ name })) };
    }
  };
}

/* ---------- الخادم ---------- */

async function loadWorker() {
  const src = fs.readFileSync(path.join(ROOT, 'cloud', 'worker.js'), 'utf8');
  /* worker.js وحدة ES (export default). من نص الملف نفسه، بلا نسخة.
     كل خادم بنسخة وحدة خاصة به (كـisolate جديد): العنوان نفسه يعيد الوحدة
     المحفوظة، فيبقى v2Ready صحيحاً من الخادم الأول وقاعدة الثاني بلا جداول */
  loadWorker.n = (loadWorker.n || 0) + 1;
  const mod = await import('data:text/javascript,' + encodeURIComponent(src + '\n// ' + loadWorker.n));
  return mod.default;
}

if (!globalThis.caches) {
  globalThis.caches = { default: { async match() { return undefined; }, async put() { } } };
}

/* opts: { port, secret, noD1, dbFile, fail(req) → رمز حالة لإفشال طلب عمداً، أو ‎-1 لقطع الاتصال } */
async function start(opts) {
  opts = opts || {};
  const worker = await loadWorker();
  const env = { SHOP_SECRET: opts.secret || 'test-secret', SHOP: kv() };
  if (!opts.noD1) env.DB = d1(opts.dbFile);
  const log = [];
  const timing = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      try {
        const body = Buffer.concat(chunks);
        const url = 'http://127.0.0.1' + req.url;
        log.push(req.method + ' ' + req.url.split('?')[0] + ' ' + body.length);
        const forced = opts.fail ? opts.fail(req, body) : 0;
        /* ‎-1: بلا إنترنت — الاتصال ينقطع بلا رد */
        if (forced === -1) { req.socket.destroy(); return; }
        if (forced) { res.writeHead(forced, { 'Content-Type': 'text/plain' }); res.end('forced'); return; }
        const headers = {};
        for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(',') : v;
        const tm = { d1: 0 };
        const t0 = process.hrtime.bigint();
        const r = await d1Time.run(tm, () => worker.fetch(new Request(url, {
          method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body
        }), env, { waitUntil() { } }));
        const out = Buffer.from(await r.arrayBuffer());
        if (opts.timing) {
          const ms = Number(process.hrtime.bigint() - t0) / 1e6;
          timing.push({ method: req.method, path: req.url.split('?')[0], ms, d1: tm.d1, cpu: ms - tm.d1, in: body.length, out: out.length, status: r.status });
        }
        const h = {};
        r.headers.forEach((v, k) => { h[k] = v; });
        res.writeHead(r.status, h);
        res.end(out);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e && e.stack || e) }));
      }
    });
  });
  await new Promise(r => server.listen(opts.port || 0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port, env, log, timing,
    url: 'http://127.0.0.1:' + port,
    close: () => new Promise(r => server.close(r))
  };
}

module.exports = { start, d1, kv };

if (require.main === module) {
  start({ port: +process.argv[2] || 0, secret: process.argv[3] || 'test-secret' }).then(c => {
    console.log(c.port);
  });
}
