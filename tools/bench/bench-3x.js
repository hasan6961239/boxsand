/* ============================================================
   bench-3x.js — قياس منظومة 3.x على المحرك الحقيقي (المرحلة 0)
   ------------------------------------------------------------
   خط الأساس الذي نقارن به الأساس الجديد: نفس البيانات المولّدة
   (tools/gen) بأحجام مختلفة، على المحرك الحقيقي تحت mono، والواجهة
   الحقيقية في Chromium.

   الترخيص ونسخة التجربة: tools/engine.js.

   يحتاج: mono-mcs وxvfb-run وplaywright-core وChromium.
   الاستعمال:
     node tools/bench/bench-3x.js                        (1500 و20000 و100000)
     node tools/bench/bench-3x.js --sizes 1500,20000 --json out.json --md out.md
   ============================================================ */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright-core');
const E = require('../engine');
const { generate } = require('../gen/generate');

const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = E.sleep;

function args() {
  const a = process.argv.slice(2), o = { sizes: [1500, 20000, 100000], json: '', md: '' };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--sizes') o.sizes = a[++i].split(',').map(Number);
    else if (a[i] === '--json') o.json = a[++i];
    else if (a[i] === '--md') o.md = a[++i];
    else if (a[i] === '--keep') o.keep = true;
    else throw new Error('خيار غير معروف: ' + a[i]);
  }
  return o;
}

async function api(port, p, body) { return (await E.call(port, p, body)).body; }

/* ---------- القياس في الواجهة ---------- */
async function measure(browser, port) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage();
  /* نعدّ طلبات الحفظ ومددها: saveNow في 3.x يرجع فوراً إن كان حفظ سابق
     ما زال جارياً، فقياس وقت saveNow وحده يكذب مع البيانات الكبيرة */
  await pg.addInitScript(() => {
    const f0 = window.fetch;
    window.__saves = []; window.__inflight = 0;
    window.fetch = function (u) {
      if (String(u).indexOf('/api/save') < 0) return f0.apply(this, arguments);
      window.__inflight++;
      const t = performance.now();
      return f0.apply(this, arguments).finally(() => { window.__inflight--; window.__saves.push(Math.round(performance.now() - t)); });
    };
  });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  const t0 = Date.now();
  await pg.goto('http://127.0.0.1:' + port + '/#/dash', { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => window.App && App.S && App.S.books && App.S.books.length > 0 &&
    document.querySelector('#view') && document.querySelector('#view').children.length, null, { timeout: 600000 });
  const boot = Date.now() - t0;
  await sleep(1500);
  const r = await pg.evaluate(async () => {
    const out = {};
    const t = f => { const a = performance.now(); f(); return Math.round(performance.now() - a); };
    const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
    for (const k of ['dash', 'pos', 'purchases', 'alerts', 'stale', 'invoices', 'stock']) {
      history.replaceState(null, '', '#/' + k);
      try { out['page_' + k] = t(() => App.route()); } catch (e) { out['page_' + k] = -1; }
    }
    /* البحث في نقطة البيع مع كل حرف، كما يكتب البائع */
    const word = 'الفيزياء الاساسية', ks = [];
    for (let i = 1; i <= word.length; i++) ks.push(t(() => Inv.searchItems(word.slice(0, i), 8)));
    out.search_key_median = med(ks); out.search_key_max = Math.max.apply(null, ks);
    /* جدول الكتب: صفحة «إدخال بضاعة» في وضع «عرض وتعديل» */
    history.replaceState(null, '', '#/purchases'); App.route();
    out.page_books_table = t(() => Inv.gset('mode', 'view'));
    out.books_filter = t(() => Inv.setF('q', 'القانون'));
    Inv.setF('q', '');
    let s;
    out.stringify = t(() => { s = JSON.stringify(App.S); });
    out.store_mb = +(s.length * 1.0 / 1e6).toFixed(1);   // تقريبي (حروف) — الحجم الفعلي على القرص يُقاس من الملف
    const idle = async () => { for (let i = 0; i < 1200 && window.__inflight; i++) await new Promise(r => setTimeout(r, 100)); };
    const saves = [];
    for (let i = 0; i < 3; i++) {
      await idle();
      const n = window.__saves.length;
      App.saveNow();
      for (let k = 0; k < 2400 && window.__saves.length === n; k++) await new Promise(r => setTimeout(r, 50));
      saves.push(window.__saves[n]);
    }
    out.save_request = med(saves);                       // الإرسال + كتابة المحرك على القرص
    out.save_total = out.save_request + out.stringify;   // ما ينتظره البائع فعلاً
    let snap = '';
    try { snap = JSON.stringify(Stock.snapshot()); } catch (e) { }
    out.snapshot_mb = +(new Blob([snap]).size / 1e6).toFixed(2);
    out.heap_mb = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1;
    return out;
  });
  await ctx.close();
  return Object.assign({ boot }, r, { errors: errs.length });
}

(async () => {
  const o = args();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench3x-'));
  const key = E.testKey();
  const engDir = path.join(tmp, 'engine');
  fs.mkdirSync(path.join(engDir, 'data'), { recursive: true });
  E.buildEngine(engDir, key.modulus);
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--enable-precise-memory-info'] });
  const rows = [];
  try {
    for (const size of o.sizes) {
      const prof = size <= 3000 ? 'misrata' : 'tripoli';
      const gdir = path.join(tmp, 'gen-' + size);
      const stat = Math.round(size / 10);
      generate({ profile: prof, books: size, stationery: stat, years: 1, store3: 1, out: gdir });
      fs.rmSync(path.join(engDir, 'data'), { recursive: true, force: true });
      fs.mkdirSync(path.join(engDir, 'data'));
      fs.copyFileSync(path.join(gdir, 'store3.json'), path.join(engDir, 'data', 'store.json'));
      const diskMb = +(fs.statSync(path.join(engDir, 'data', 'store.json')).size / 1e6).toFixed(1);
      const xdg = path.join(tmp, 'xdg-' + size);
      fs.mkdirSync(xdg, { recursive: true });
      const eng = E.startEngine(engDir, xdg);
      try {
        const port = await E.waitPort(engDir);
        await E.activate(port, key.privateKey);
        const m = await measure(browser, port);
        const row = Object.assign({ books: size, stationery: stat, disk_mb: diskMb }, m);
        rows.push(row);
        console.log(JSON.stringify(row));
      } finally { E.stopEngine(eng); await sleep(500); }
    }
  } finally {
    await browser.close();
    if (!o.keep) fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (o.json) fs.writeFileSync(o.json, JSON.stringify(rows, null, 1));
  if (o.md) fs.writeFileSync(o.md, markdown(rows));
})().catch(e => { console.error(e); process.exit(1); });

function markdown(rows) {
  const cpu = os.cpus()[0] ? os.cpus()[0].model : '?';
  const s = ms => ms < 0 ? '—' : (ms / 1000).toFixed(2) + ' ث';
  const lines = [
    '| | ' + rows.map(r => r.books.toLocaleString('en') + ' كتاب').join(' | ') + ' |',
    '|---|' + rows.map(() => '---').join('|') + '|',
    ['ملف البيانات على القرص', r => r.disk_mb + ' ميغا'],
    ['فتح البرنامج حتى تظهر اللوحة', r => s(r.boot)],
    ['حفظ بعد أي بيعة أو تعديل (كاملاً)', r => s(r.save_total)],
    ['  منه: الإرسال والكتابة على القرص', r => s(r.save_request)],
    ['تجميد الشاشة وقت تحويل البيانات لنص', r => s(r.stringify)],
    ['البحث في البيع مع كل حرف (الوسيط)', r => s(r.search_key_median)],
    ['البحث في البيع مع كل حرف (الأسوأ)', r => s(r.search_key_max)],
    ['فلترة جدول الكتب', r => s(r.books_filter)],
    ['فتح صفحة التنبيهات', r => s(r.page_alerts)],
    ['فتح جدول الكتب', r => s(r.page_books_table)],
    ['فتح صفحة الراكد', r => s(r.page_stale)],
    ['ذاكرة الواجهة', r => r.heap_mb + ' ميغا'],
    ['لقطة الربط كل 10 دقائق', r => r.snapshot_mb + ' ميغا']
  ].map(x => Array.isArray(x) ? '| ' + x[0] + ' | ' + rows.map(x[1]).join(' | ') + ' |' : x);
  return lines.join('\n') + '\n\nالجهاز: ' + cpu + ' · ' + os.cpus().length + ' أنوية · ' +
    Math.round(os.totalmem() / 1e9) + ' غيغا ذاكرة. البيانات من tools/gen (سنة فواتير).\n';
}
