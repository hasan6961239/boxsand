/* ============================================================
   bench-x3.js — طرابلس بعشرين ألف كتاب: السرعة محلياً وعبر الإنترنت (قرار 0025)
   ------------------------------------------------------------
   البرنامج الحقيقي (تطبيق طرابلس) تحت mono، وشاشات 3.x في Chromium، وبيانات
   المولّد (tools/gen، ملف tripoli): 20 ألف كتاب وألفا صنف قرطاسية ومخزنان.
   ثلاث حالات للبيانات:
     day1  يوم التسليم: الكتب كلها، بلا فواتير
     6m    بعد ستة أشهر بيع (100 فاتورة في اليوم)
     1y    بعد سنة بلا أرشفة
   محلياً: كل حالة مرتين — 3.x على store.json كما كان (old)، ثم بعد «هذا جهاز
   المحل» على القاعدة (new): فتح البرنامج، كل صفحة، البحث مع كل حرف، بيعة حتى
   «محفوظ»، تعديل سعر، كتاب جديد، والذاكرة.
   الإنترنت (--net): خادم الربط (fake-cloud.js، cloud/worker.js نفسه) خلف وسيط
   يبطئ الاتصال كما في ليبيا: «جيد» (10 ميغابت نزولاً و3 صعوداً، 80 ms) و«ضعيف»
   (1 ميغابت و256 كيلوبت، 250 ms). طرابلس تُربط وترفع نسختها، ومصراتة ترى كتبها
   وتبحث فيها، وبيعة تصل، ولابتوب ينضم، وكم يأخذ الـ Worker من وقت الحساب.

     node tools/bench/bench-x3.js                         الحالات الثلاث محلياً
     node tools/bench/bench-x3.js --scen day1 --net       يوم التسليم، والإنترنت
     node tools/bench/bench-x3.js --only net              الإنترنت وحده
     node tools/bench/bench-x3.js --books 65000           بعدد كتب آخر (محلياً)
     ... --md out.md --json out.json
   يحتاج: mono-mcs وxvfb-run وplaywright-core وChromium.
   ============================================================ */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const { chromium } = require('playwright-core');
const E = require('../engine');
const C = require('../fake-cloud');
const { generate } = require('../gen/generate');

const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const KEY = 'bench-x3-key';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : -1;

function args() {
  const a = process.argv.slice(2), o = { scen: ['day1', '6m', '1y'], net: false, only: '', md: '', json: '', keep: false, books: 20000 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--scen') o.scen = a[++i].split(',');
    else if (a[i] === '--net') o.net = true;
    else if (a[i] === '--only') { o.only = a[++i]; if (o.only === 'net') o.net = true; }
    else if (a[i] === '--md') o.md = a[++i];
    else if (a[i] === '--json') o.json = a[++i];
    else if (a[i] === '--keep') o.keep = true;
    else if (a[i] === '--books') o.books = parseInt(a[++i], 10);
    else throw new Error('خيار غير معروف: ' + a[i]);
  }
  return o;
}

/* ---------- البيانات ---------- */

function stores(tmp, books) {
  const g = path.join(tmp, 'gen-tripoli');
  generate({ profile: 'tripoli', books: books, stationery: 2000, years: 1, store3: 1, out: g });
  const full = JSON.parse(fs.readFileSync(path.join(g, 'store3.json'), 'utf8'));
  full.branch = { id: 'tripoli', name: 'دار الحكمة — طرابلس', city: 'طرابلس', phone: '', label: '', no: 2 };
  full.meta.shopName = 'دار الحكمة — طرابلس';
  const clone = o => JSON.parse(JSON.stringify(o));
  const half = clone(full);
  half.invoices = half.invoices.filter(v => v.date >= '2026-04-26');
  half.payments = (half.payments || []).filter(p => (p.date || '') >= '2026-04-26');
  const day1 = clone(full);
  day1.invoices = []; day1.payments = []; day1.counters.invoice = 0;
  day1.customers = day1.customers.slice(0, 50).map(c => Object.assign(c, { balance: 0 }));
  for (const it of day1.books.concat(day1.stationery)) { delete it.lastSold; delete it.soldTotal; }
  const gm = path.join(tmp, 'gen-misrata');
  generate({ profile: 'misrata', store3: 1, out: gm });
  const mis = JSON.parse(fs.readFileSync(path.join(gm, 'store3.json'), 'utf8'));
  mis.branch = { id: 'misrata', name: 'دار الحكمة', city: 'مصراتة', phone: '', label: '', no: 1 };
  mis.meta.shopName = 'دار الحكمة';
  return { day1, '6m': half, '1y': full, misrata: mis };
}

/* ---------- جهاز: البرنامج في مجلده ---------- */

function device(tmp, name, exeDir) {
  const d = { name, dir: path.join(tmp, name), home: path.join(tmp, name + '-home'), proc: null, port: 0 };
  fs.mkdirSync(path.join(d.dir, 'data'), { recursive: true });
  fs.mkdirSync(d.home, { recursive: true });
  for (const f of ['Qirtasiya.exe', 'Qirtasiya.exe.config']) fs.copyFileSync(path.join(exeDir, f), path.join(d.dir, f));
  d.data = f => path.join(d.dir, 'data', f || '');
  d.write = o => fs.writeFileSync(d.data('store.json'), JSON.stringify(o));
  d.start = async () => {
    const t = Date.now();
    d.proc = E.startEngine(d.dir, d.home);
    d.port = await E.waitPort(d.dir);
    return Date.now() - t;
  };
  d.stop = async () => { if (d.proc) E.stopEngine(d.proc); d.proc = null; await sleep(600); };
  d.url = () => 'http://127.0.0.1:' + d.port + '/';
  d.raw = (p, body, h) => E.call(d.port, p, body, h);
  d.owner = async () => (await d.raw('/api/claim', { force: true })).body.token;
  d.release = async ow => { try { await d.raw('/api/release?t=' + ow, {}); } catch (e) { } };
  d.link = async (body) => {
    const ow = await d.owner();
    const t = Date.now();
    const r = await d.raw('/api/link', body, { 'X-Owner': ow });
    const ms = Date.now() - t;
    await d.release(ow);
    if (!r.body || !r.body.ok) throw new Error(name + ' /api/link ' + JSON.stringify(r.body));
    return { ms, data: r.body.data };
  };
  d.load = async () => {
    const t = Date.now();
    const r = await fetch(d.url() + 'api/load', { headers: { 'X-Qirtasiya': '1', Origin: 'http://127.0.0.1:' + d.port } });
    const text = await r.text();
    return { ms: Date.now() - t, text, rev: r.headers.get('X-X3-Rev') || '' };
  };
  d.save = async (body, rev, ow) => {
    const t = Date.now();
    const r = await fetch(d.url() + 'api/save', { method: 'POST', body, headers: { 'X-Qirtasiya': '1', Origin: 'http://127.0.0.1:' + d.port,
      'Content-Type': 'application/json', 'X-Owner': ow, 'X-X3-Rev': rev || '' } });
    return { ms: Date.now() - t, j: await r.json() };
  };
  /* ذاكرة البرنامج (mono) */
  d.rss = () => {
    for (const pid of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
      try {
        const cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8');
        if (!cmd.startsWith('mono') || !cmd.includes('Qirtasiya.exe') || fs.readlinkSync('/proc/' + pid + '/cwd') !== d.dir) continue;
        return Math.round(+fs.readFileSync('/proc/' + pid + '/status', 'utf8').match(/VmRSS:\s+(\d+)/)[1] / 1024);
      } catch (e) { }
    }
    return -1;
  };
  /* مدة الحفظ في البرنامج نفسه (QIRTASIYA_X3_TIMING) */
  d.serverSaves = () => {
    try {
      return fs.readFileSync(d.data('log.txt'), 'utf8').split('\n').filter(l => l.includes('حفظ 3.x'))
        .map(l => +((l.match(/مرآة (\d+) ms/) || [])[1] || -1)).filter(x => x >= 0);
    } catch (e) { return []; }
  };
  d.sync = async () => {
    const ow = await d.owner();
    const t = Date.now();
    const r = await d.raw('/api/link', { action: 'now' }, { 'X-Owner': ow });
    const ms = Date.now() - t;
    await d.release(ow);
    return { ms, data: r.body && r.body.data, ok: !!(r.body && r.body.ok) };
  };
  return d;
}

/* ---------- القياس في الشاشة ---------- */

async function openPage(browser, d, errs) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage();
  await pg.addInitScript(() => {
    const f0 = window.fetch;
    window.__saveEnd = []; window.__inflight = 0;
    window.fetch = function (u) {
      if (String(u).indexOf('/api/save') < 0) return f0.apply(this, arguments);
      window.__inflight++;
      return f0.apply(this, arguments).finally(() => { window.__inflight--; window.__saveEnd.push(performance.now()); });
    };
  });
  pg.on('pageerror', e => errs.push(d.name + ': ' + e.message));
  const t0 = Date.now();
  await pg.goto(d.url() + '#/dash', { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => window.App && App.S && App.S.books && App.S.books.length > 0 &&
    document.querySelector('#view') && document.querySelector('#view').children.length, null, { timeout: 600000 });
  const boot = Date.now() - t0;
  await sleep(1500);
  return { ctx, pg, boot };
}

async function measureUi(browser, d, errs) {
  const { ctx, pg, boot } = await openPage(browser, d, errs);
  const r = await pg.evaluate(async () => {
    const out = {};
    const t = f => { const a = performance.now(); f(); return Math.round(performance.now() - a); };
    const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const idle = async () => { for (let i = 0; i < 1200 && window.__inflight; i++) await new Promise(r => setTimeout(r, 25)); };
    const saved = async (n0) => { for (let i = 0; i < 2400 && window.__saveEnd.length <= n0; i++) await new Promise(r => setTimeout(r, 10)); };
    for (const k of ['dash', 'pos', 'purchases', 'alerts', 'stale', 'invoices', 'stock', 'reports', 'settings']) {
      history.replaceState(null, '', '#/' + k);
      try { out['page_' + k] = t(() => App.route()); } catch (e) { out['page_' + k] = -1; }
    }
    /* البحث في نقطة البيع مع كل حرف، كما يكتب البائع */
    const word = 'الفيزياء الاساسية', ks = [];
    for (let i = 1; i <= word.length; i++) ks.push(t(() => Inv.searchItems(word.slice(0, i), 8)));
    out.search_median = med(ks); out.search_max = Math.max.apply(null, ks);
    history.replaceState(null, '', '#/purchases'); App.route();
    out.books_table = t(() => Inv.gset('mode', 'view'));
    out.books_filter = t(() => Inv.setF('q', 'القانون'));
    Inv.setF('q', '');
    let s;
    out.stringify = t(() => { s = JSON.stringify(App.S); });
    out.store_mb = +(new Blob([s]).size / 1e6).toFixed(1);
    /* حفظ بلا تغيير، ثلاث مرات */
    const saves = [];
    for (let i = 0; i < 3; i++) {
      await idle();
      const n0 = window.__saveEnd.length, t0 = performance.now();
      App.saveNow();
      await saved(n0);
      saves.push(Math.round(window.__saveEnd[n0] - t0));
    }
    out.save = med(saves);
    /* تعديل سعر كتاب حتى «محفوظ» */
    await idle();
    let n0 = window.__saveEnd.length, t1 = performance.now();
    const it = App.S.books[100];
    it.price = Math.round((+it.price + 1) * 100) / 100;
    App.save();
    await saved(n0);
    out.edit = Math.round(window.__saveEnd[n0] - t1);
    /* كتاب جديد حتى «محفوظ» */
    await idle();
    n0 = window.__saveEnd.length; t1 = performance.now();
    App.S.books.unshift({ id: App.uid(), code: App.nextCode('book'), title: 'كتاب جديد للقياس', author: 'مؤلف', barcode: '',
      price: 20, cost: 12, qty: 3, min: 1, lib: 'A', shelf: '1', created: App.nowStamp() });
    App.save();
    await saved(n0);
    out.add = Math.round(window.__saveEnd[n0] - t1);
    /* إعادة التحميل وحدها (حين يغيّر الجهاز الآخر شيئاً): التحميل والتحليل والرسم */
    await idle();
    t1 = performance.now();
    const txt = await (await App.api('/api/load')).text();
    out.reload_fetch = Math.round(performance.now() - t1);
    out.reload_parse = t(() => JSON.parse(txt));
    out.reload_render = t(() => App.rerender());
    out.heap_mb = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1;
    return out;
  });
  /* بيعة كاملة من نقطة البيع: الشاشة (finish ثم الرسم) ثم الحفظ حتى «محفوظ» */
  await pg.evaluate(() => { location.hash = '#/pos'; App.route(); });
  await sleep(500);
  const code = await pg.evaluate(() => App.S.books[7].code);
  await pg.fill('#scan', code); await sleep(300); await pg.keyboard.press('Enter'); await sleep(400);
  await pg.click('button:has-text("إتمام البيع")'); await sleep(600);
  const sale = await pg.evaluate(async () => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('نقداً'));
    const n0 = window.__saveEnd.length, t0 = performance.now();
    btn.click();
    const ui = Math.round(performance.now() - t0);
    for (let i = 0; i < 2400 && window.__saveEnd.length <= n0; i++) await new Promise(r => setTimeout(r, 10));
    return { ui, total: Math.round(window.__saveEnd[n0] - t0) };
  });
  await ctx.close();
  return Object.assign({ boot, sale_ui: sale.ui, sale_total: sale.total }, r);
}

async function local(browser, tmp, exeT, data, scen, errs) {
  const rows = {};
  for (const mode of ['old', 'new']) {
    const d = device(tmp, 'L-' + scen + '-' + mode, exeT);
    d.write(data[scen]);
    const disk = +(fs.statSync(d.data('store.json')).size / 1e6).toFixed(1);
    let cloud = null;
    try {
      const start = await d.start();
      const row = { scen, mode, disk_mb: disk, start };
      if (mode === 'new') {
        cloud = await C.start({ secret: KEY });
        const l = await d.link({ action: 'main', url: cloud.url, key: KEY, name: 'محل طرابلس' });
        row.link = l.ms;
        await sleep(1000);
      }
      row.load = (await d.load()).ms;
      Object.assign(row, await measureUi(browser, d, errs));
      const ss = d.serverSaves();
      row.server_save = med(ss);
      row.rss_mb = d.rss();
      if (mode === 'new') row.db_mb = +(fs.statSync(d.data('qirtasiya.db')).size / 1e6).toFixed(1);
      rows[mode] = row;
      console.log(JSON.stringify(row));
    } finally {
      await d.stop();
      if (cloud) await cloud.close();
    }
  }
  return rows;
}

/* ---------- الإنترنت: وسيط يبطئ الاتصال ---------- */

function shape(src, dst, bps, delay, count) {
  let busy = 0, pending = 0, ended = false;
  src.on('data', chunk => {
    count(chunk.length);
    const now = Date.now();
    busy = Math.max(now, busy) + chunk.length * 8 / bps * 1000;
    pending++;
    setTimeout(() => {
      pending--;
      if (!dst.destroyed) dst.write(chunk);
      if (ended && pending === 0) dst.end();
    }, busy + delay - now);
  });
  src.on('end', () => { ended = true; if (pending === 0) setTimeout(() => dst.end(), delay); });
}

function throttle(target, prof) {
  const st = { up: 0, down: 0 };
  const srv = net.createServer(c => {
    const s = net.connect(target, '127.0.0.1');
    const kill = () => { c.destroy(); s.destroy(); };
    c.on('error', kill); s.on('error', kill);
    shape(c, s, prof.up, prof.rtt / 2, n => { st.up += n; });
    shape(s, c, prof.down, prof.rtt / 2, n => { st.down += n; });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({
    url: 'http://127.0.0.1:' + srv.address().port, st, close: () => new Promise(q => srv.close(q))
  })));
}

const PROFILES = {
  good: { label: 'جيد (10 ميغابت نزولاً، 3 صعوداً، 80 ms)', rtt: 80, down: 10e6, up: 3e6 },
  weak: { label: 'ضعيف (1 ميغابت نزولاً، 256 كيلوبت صعوداً، 250 ms)', rtt: 250, down: 1e6, up: 256e3 }
};

async function measured(tp, f) {
  const u0 = tp.st.up, d0 = tp.st.down, t = Date.now();
  const r = await f();
  return { ms: Date.now() - t, up_kb: Math.round((tp.st.up - u0) / 1000), down_kb: Math.round((tp.st.down - d0) / 1000), r };
}

async function internet(browser, tmp, exeT, exeM, data, profName, errs) {
  const prof = PROFILES[profName];
  const cloud = await C.start({ secret: KEY, timing: true });
  const tp = await throttle(cloud.port, prof);
  const out = { profile: profName, label: prof.label };
  const T = device(tmp, 'N-' + profName + '-tripoli', exeT);
  const M = device(tmp, 'N-' + profName + '-misrata', exeM);
  const L = device(tmp, 'N-' + profName + '-laptop', exeT);
  try {
    const t = JSON.parse(JSON.stringify(data.day1));
    t.sync = { url: tp.url, key: KEY, auto: false, everyMin: 10 };
    T.write(t);
    await T.start();
    let m = await measured(tp, () => T.link({ action: 'main', url: tp.url, key: KEY, name: 'كمبيوتر طرابلس' }));
    out.link = m;
    m = await measured(tp, () => T.sync());
    out.first_sync = m;
    out.first_sync_error = m.r.data && m.r.data.error;

    const ms = JSON.parse(JSON.stringify(data.misrata));
    ms.sync = { url: tp.url, key: KEY, auto: false, everyMin: 10 };
    M.write(ms);
    await M.start();
    await M.link({ action: 'main', url: tp.url, key: KEY, name: 'كمبيوتر مصراتة' });
    m = await measured(tp, () => M.sync());
    out.misrata_first_sync = m;
    out.misrata_first_sync_error = m.r.data && m.r.data.error;

    /* مصراتة تبحث في كتب طرابلس («المخزون والفروع») */
    {
      const { ctx, pg } = await openPage(browser, M, errs);
      const r = await pg.evaluate(async () => {
        const t0 = performance.now();
        const res = await (await App.api('/api/x3/remotes')).json();
        const fetchMs = Math.round(performance.now() - t0);
        const n = (res.branches || []).reduce((s, b) => s + (b.items || []).length, 0);
        location.hash = '#/stock'; App.route();
        await new Promise(r => setTimeout(r, 1500));
        const word = 'حكايات الصحابة', ks = [];
        for (let i = 1; i <= word.length; i++) {
          const a = performance.now();
          Stock.setFind(word.slice(0, i));
          ks.push(Math.round(performance.now() - a));
        }
        const hits = (document.getElementById('findResults') || {}).textContent || '';
        return { fetchMs, items: n, keys: ks, found: /طرابلس/.test(hits) };
      });
      out.misrata_find = r;
      await ctx.close();
    }

    /* بيعة في طرابلس تصل الخادم، ومصراتة ترى الكمية الجديدة */
    {
      const ow = await T.owner();
      const l = await T.load();
      const s = JSON.parse(l.text);
      s.books[0].qty -= 1;
      s.counters.invoice++;
      s.invoices.unshift({ id: 'netsale1', no: s.counters.invoice, kind: 'sale', date: '2026-11-02', at: '2026-11-02 10:00',
        items: [{ type: 'book', id: s.books[0].id, name: s.books[0].title, qty: 1, price: s.books[0].price, cost: s.books[0].cost }],
        subtotal: s.books[0].price, discount: 0, total: s.books[0].price, profit: 1, method: 'cash', customerId: '', paid: s.books[0].price, due: 0 });
      await T.save(JSON.stringify(s), l.rev, ow);
      await T.release(ow);
      out.sale_sync = await measured(tp, () => T.sync());
      out.misrata_after_sale = await measured(tp, () => M.sync());
      out.idle_sync_tripoli = await measured(tp, () => T.sync());
      out.idle_sync_misrata = await measured(tp, () => M.sync());
      const n0 = cloud.log.length;
      await T.sync(); await M.sync();
      out.requests_per_idle_tick = Math.round((cloud.log.length - n0) / 2);
    }

    /* لابتوب ينضم جهازاً ثانياً لطرابلس، ويبيع */
    {
      await L.start();
      m = await measured(tp, () => L.link({ action: 'second', url: tp.url, key: KEY, branch: 'tripoli', name: 'لابتوب', replace: true }));
      out.laptop_join = m;
      const ow = await L.owner();
      const l = await L.load();
      const s = JSON.parse(l.text);
      s.books[1].qty -= 1;
      s.counters.invoice++;
      s.invoices.unshift({ id: 'lapsale1', no: s.counters.invoice, kind: 'sale', date: '2026-11-02', at: '2026-11-02 10:05',
        items: [{ type: 'book', id: s.books[1].id, qty: 1, price: s.books[1].price }], total: s.books[1].price });
      const sv = await L.save(JSON.stringify(s), l.rev, ow);
      await L.release(ow);
      out.laptop_save = sv.ms;
      const a = await measured(tp, () => L.sync());
      const b = await measured(tp, () => T.sync());
      const c = await measured(tp, () => L.sync());
      out.laptop_sale_roundtrip = { ms: a.ms + b.ms + c.ms, parts: [a.ms, b.ms, c.ms], up_kb: a.up_kb + b.up_kb + c.up_kb, down_kb: a.down_kb + b.down_kb + c.down_kb };
      const tl = await T.load();
      out.laptop_sale_arrived = JSON.parse(tl.text).invoices.some(v => v.id === 'lapsale1');
    }

    /* لقطة 3.x للتلفون وموقع المكتبة من شاشات طرابلس */
    {
      const { ctx, pg } = await openPage(browser, T, errs);
      const u0 = tp.st.up, d0 = tp.st.down;
      const t0 = Date.now();
      await pg.evaluate(() => Stock.sync(true));
      await sleep(500);
      out.kv_snapshot = { ms: Date.now() - t0, up_kb: Math.round((tp.st.up - u0) / 1000), down_kb: Math.round((tp.st.down - d0) / 1000) };
      await ctx.close();
    }

    /* وقت الحساب في الـ Worker لكل نوع طلب (الخطة المجانية: 10 ms) */
    const by = {};
    for (const x of cloud.timing) {
      const k = x.method + ' ' + x.path;
      const b = by[k] || (by[k] = { n: 0, cpu: [], in: 0 });
      b.n++; b.cpu.push(x.cpu); b.in = Math.max(b.in, x.in);
    }
    out.worker = Object.keys(by).sort().map(k => ({ req: k, n: by[k].n, cpu_med: +med(by[k].cpu).toFixed(1),
      cpu_max: +Math.max.apply(null, by[k].cpu).toFixed(1), max_in_kb: Math.round(by[k].in / 1000) }));
    out.d1_rows = { reads: cloud.env.DB.stats.reads, writes: cloud.env.DB.stats.writes };
  } finally {
    await T.stop(); await M.stop(); await L.stop();
    await tp.close(); await cloud.close();
  }
  console.log(JSON.stringify(out));
  return out;
}

/* ---------- التقرير ---------- */

function markdown(res, books) {
  const s = ms => ms === undefined || ms < 0 ? '—' : ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1) + ' ث';
  const out = [];
  const cpu = os.cpus()[0] ? os.cpus()[0].model : '?';
  if (res.local.length) {
    out.push('### على الجهاز نفسه (طرابلس، ' + books.toLocaleString('en-US') + ' كتاب وألفا صنف قرطاسية)\n');
    const cols = [];
    for (const r of res.local) for (const m of ['old', 'new']) if (r[m]) cols.push(r[m]);
    const name = { day1: 'يوم التسليم', '6m': 'بعد 6 أشهر', '1y': 'بعد سنة' };
    out.push('| | ' + cols.map(c => name[c.scen] + ' — ' + (c.mode === 'old' ? '3.x القديم' : 'الجديد')).join(' | ') + ' |');
    out.push('|---|' + cols.map(() => '---').join('|') + '|');
    const rows = [
      ['ملف البيانات', c => c.disk_mb + ' ميغا'],
      ['«هذا جهاز المحل» (مرة واحدة)', c => c.mode === 'new' ? s(c.link) : '—'],
      ['فتح البرنامج حتى تظهر اللوحة', c => s(c.boot)],
      ['بيعة: الشاشة بعد «نقداً»', c => s(c.sale_ui)],
      ['بيعة: حتى «محفوظ»', c => s(c.sale_total)],
      ['تعديل سعر حتى «محفوظ»', c => s(c.edit)],
      ['كتاب جديد حتى «محفوظ»', c => s(c.add)],
      ['حفظ (وسيط)', c => s(c.save)],
      ['  منه في البرنامج', c => c.mode === 'new' ? s(c.server_save) : '—'],
      ['البحث في البيع مع كل حرف (وسيط / أسوأ)', c => s(c.search_median) + ' / ' + s(c.search_max)],
      ['فلترة جدول الكتب', c => s(c.books_filter)],
      ['فتح جدول الكتب', c => s(c.books_table)],
      ['صفحة التنبيهات / الراكد / الفواتير', c => s(c.page_alerts) + ' / ' + s(c.page_stale) + ' / ' + s(c.page_invoices)],
      ['إعادة التحميل حين يغيّر جهاز آخر شيئاً', c => c.mode === 'new' ? s(c.reload_fetch + c.reload_parse + c.reload_render) : '—'],
      ['ذاكرة الشاشة / البرنامج', c => c.heap_mb + ' / ' + c.rss_mb + ' ميغا'],
      ['القاعدة على القرص', c => c.db_mb ? c.db_mb + ' ميغا' : '—']
    ];
    for (const [k, f] of rows) out.push('| ' + k + ' | ' + cols.map(f).join(' | ') + ' |');
    out.push('');
  }
  for (const n of res.net) {
    out.push('### عبر الإنترنت: ' + n.label + '\n');
    const kb = x => x.up_kb + ' ك.ب صعوداً، ' + x.down_kb + ' نزولاً';
    out.push('| | المدة | البيانات |');
    out.push('|---|---|---|');
    const r = (k, x) => x && out.push('| ' + k + ' | ' + s(x.ms) + ' | ' + kb(x) + ' |');
    r('طرابلس: «هذا جهاز المحل»', n.link);
    r('طرابلس: أول مزامنة (النسخة الكاملة وقائمة الكتب)', n.first_sync);
    r('مصراتة: أول مزامنة (ومعها قائمة طرابلس)', n.misrata_first_sync);
    r('بيعة في طرابلس تصل الخادم (ومعها قائمة الكتب الجديدة)', n.sale_sync);
    r('مصراتة تأخذ كمية طرابلس الجديدة', n.misrata_after_sale);
    r('دقيقة بلا تغيير (طرابلس)', n.idle_sync_tripoli);
    r('دقيقة بلا تغيير (مصراتة)', n.idle_sync_misrata);
    r('لابتوب ينضم لطرابلس', n.laptop_join);
    r('بيعة من اللابتوب حتى تعود له من المحل (3 دورات)', n.laptop_sale_roundtrip);
    r('لقطة التلفون والموقع من شاشات طرابلس', n.kv_snapshot);
    out.push('');
    if (n.misrata_find) out.push('مصراتة تبحث في ' + n.misrata_find.items + ' صنف من طرابلس: تحميلها ' + s(n.misrata_find.fetchMs) +
      '، وكل حرف ' + s(med(n.misrata_find.keys)) + ' (الأسوأ ' + s(Math.max.apply(null, n.misrata_find.keys)) + ')' +
      (n.misrata_find.found ? '' : ' — لم تظهر نتائج طرابلس!') + '\n');
    out.push('طلبات كل دقيقة بلا تغيير (لكل جهاز): ' + n.requests_per_idle_tick + ' — أي نحو ' + (n.requests_per_idle_tick * 1440).toLocaleString('en') + ' في اليوم.\n');
    out.push('| طلب للخادم | عدده | حساب الـ Worker (وسيط / أقصى) | أكبر ما وصله |');
    out.push('|---|---|---|---|');
    for (const w of n.worker) out.push('| ' + w.req + ' | ' + w.n + ' | ' + w.cpu_med + ' / ' + w.cpu_max + ' ms | ' + w.max_in_kb + ' ك.ب |');
    out.push('');
  }
  out.push('الجهاز: ' + cpu + ' · ' + os.cpus().length + ' أنوية. البرنامج تحت mono على لينكس، والشاشة في Chromium (ويندوز وWebView2 أسرع عادة).');
  return out.join('\n') + '\n';
}

(async () => {
  const o = args();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'benchx3-'));
  process.env.QIRTASIYA_X3_TIMING = '1';
  process.env.QIRTASIYA_SYNC_MS = '3600000';
  process.env.QIRTASIYA_SYNC_WAIT_MS = '3600000';
  const exeT = path.join(tmp, 'exe-tripoli'), exeM = path.join(tmp, 'exe-misrata');
  fs.mkdirSync(exeT); fs.mkdirSync(exeM);
  E.buildEngine(exeT, 'tripoli');
  if (o.net) E.buildEngine(exeM, 'misrata');
  console.log('يولّد البيانات...');
  const data = stores(tmp, o.books);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--enable-precise-memory-info'] });
  const errs = [];
  const res = { local: [], net: [] };
  try {
    if (o.only !== 'net') for (const sc of o.scen) res.local.push(await local(browser, tmp, exeT, data, sc, errs));
    if (o.net) for (const p of ['good', 'weak']) res.net.push(await internet(browser, tmp, exeT, exeM, data, p, errs));
  } finally {
    await browser.close();
    if (!o.keep) fs.rmSync(tmp, { recursive: true, force: true });
  }
  res.errors = errs;
  if (errs.length) console.log('أخطاء في الصفحات:\n' + errs.join('\n'));
  if (o.json) fs.writeFileSync(o.json, JSON.stringify(res, null, 1));
  const md = markdown(res, o.books);
  if (o.md) fs.writeFileSync(o.md, md);
  console.log('\n' + md);
})().catch(e => { console.error(e); process.exit(1); });
