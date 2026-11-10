/* ============================================================
   simulate.js — محاكاة كاملة: فرعان، عدة أجهزة وهواتف، ويوم عمل بأعطاله
   ------------------------------------------------------------
   كل شيء حقيقي إلا الإنترنت: المحرك نفسه (تحت mono) لأربعة أجهزة —
   طرابلس: جهاز المحل (61 ألف كتاب) وجهاز ثانٍ؛ مصراتة: جهاز المحل
   ولابتوب — وشاشاتها في متصفحات، وثلاثة هواتف (تطبيق site/)، وخادم
   ربط واحد (fake-cloud: cloud/worker.js نفسه).

   اليوم: كل جهاز وكل هاتف يبيع ويرجّع ويعدّل ويضيف بضاعة بأزرار الشاشة
   نفسها، وطلب تحويل بين الفرعين، وفي وسطه:
     • الإنترنت ينقطع عن الجميع ثم يعود      • جهاز ثانٍ ينطفئ (كهرباء) ثم يعود
     • جهاز المحل ينطفئ بعد بيعة ثم يعود      • خادم الربط يردّ بأخطاء متقطعة
     • آخر نسخة من كتاب تُباع من جهازين في اللحظة نفسها
   وفي آخره يُتحقق:
     • لا بيعة ضاعت ولا تكرّرت، ولا رقم فاتورة مكرّر
     • كمية كل صنف = ما كانت − المباع + المرتجع + المضاف (لكل الأصناف)
     • جهازا كل فرع متطابقان، وكل فرع يرى كتب الآخر بكمياتها الأخيرة
     • كل بيع الهواتف سُجّل وعاد رقمه، بلا أخطاء في أي شاشة ولا في سجل أي جهاز

     node tools/simulate.js          BOOKS=61000 ROUNDS=26 SEED=7 QI_SHOTS=مجلد
   ============================================================ */
'use strict';
process.env.QIRTASIYA_SYNC_MS = '3000';
process.env.QIRTASIYA_SYNC_FAST_MS = '1000';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { chromium, devices } = require('playwright-core');
const E = require('./engine');
const C = require('./fake-cloud');
const { generate } = require('./gen/generate');

const ROOT = path.join(__dirname, '..'), SITE = path.join(ROOT, 'site');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const KEY = 'sim-key', BOOKS = parseInt(process.env.BOOKS || '61000', 10), ROUNDS = parseInt(process.env.ROUNDS || '26', 10);
const SHOTS = process.env.QI_SHOTS || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let seed = parseInt(process.env.SEED || '7', 10);
function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
const pick = a => a[Math.floor(rnd() * a.length)];
const T0 = Date.now();
const log = s => console.log('[' + String(((Date.now() - T0) / 1000).toFixed(0)).padStart(4) + 'ث] ' + s);
let pass = 0, fail = 0;
const notes = [];
function ok(c, name, d) {
  if (c) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (d === undefined ? '' : ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 700))); }
  return !!c;
}

const net = { down: false, flaky: 0 };
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
function site(cfg) {
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/config.js') { s.writeHead(200, { 'content-type': MIME['.js'] }); return s.end('window.MAKTABA_CONFIG = ' + JSON.stringify(cfg) + ';'); }
    const f = path.join(SITE, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1)));
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/' })));
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(process.env.SIM_TMP || os.tmpdir(), 'qsim-'));
  const cloud = await C.start({ secret: KEY, fail: () => net.down ? -1 : (net.flaky && Math.random() < net.flaky ? 503 : 0) });
  let browser = null;
  const sites = [], devs = [], phones = [];
  const allErrs = [];

  /* ---------- جهاز: المحرك في مجلده، وشاشته ---------- */
  function device(name, edition, branch, label) {
    const d = { name, edition, branch, label, dir: path.join(tmp, name), home: path.join(tmp, name + '-home'), proc: null, port: 0, page: null, up: false, who: '' };
    fs.mkdirSync(path.join(d.dir, 'data'), { recursive: true }); fs.mkdirSync(d.home, { recursive: true });
    d.start = async () => {
      /* مصراتة: كل حفظ يُقارن بما أرسلته الشاشة (X3CHECK في السجل إن اختلف). طرابلس بلا مقارنة: الملف 30 ميغا */
      if (edition === 'misrata') process.env.QIRTASIYA_X3_CHECK = '1'; else delete process.env.QIRTASIYA_X3_CHECK;
      d.proc = E.startEngine(d.dir, d.home); d.port = await E.waitPort(d.dir); d.up = true;
    };
    d.kill = async () => { if (d.page) { await d.page.close().catch(() => { }); d.page = null; } E.stopEngine(d.proc); d.proc = null; d.up = false; await sleep(700); };
    d.raw = (p, body, h) => E.call(d.port, p, body, h);
    d.link = async body => {
      const ow = (await d.raw('/api/claim', { force: true })).body.token;
      const r = await d.raw('/api/link', body, { 'X-Owner': ow });
      await d.raw('/api/release?t=' + ow, {});
      return r.body;
    };
    d.load = async () => {
      const r = await fetch('http://127.0.0.1:' + d.port + '/api/load', { headers: { 'X-Qirtasiya': '1', Origin: 'http://127.0.0.1:' + d.port } });
      return JSON.parse(await r.text());
    };
    d.status = async () => { const r = await d.raw('/api/link'); return r.body && r.body.data; };
    d.open = async () => {
      const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await p.addInitScript(() => { window.print = () => { window.__prints = (window.__prints || 0) + 1; }; });
      p.on('pageerror', e => allErrs.push(d.label + ' خطأ صفحة: ' + e.message));
      p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|favicon/.test(m.text())) allErrs.push(d.label + ' console: ' + m.text().slice(0, 200)); });
      p.on('dialog', x => x.accept().catch(() => { }));
      await p.goto('http://127.0.0.1:' + d.port + '/', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.App && App.S && App.S.books && window.Sales && window.Inv && window.Stock && App.S.meta && App.S.meta.setupDone, null, { timeout: 180000 });
      await sleep(1500);
      d.page = p;
      return p;
    };
    d.ev = (f, a) => d.page.evaluate(f, a);
    d.login = async (personName, pw) => {
      if (!(await d.page.$('.staff-lock'))) { await d.ev(() => window.Staff && Staff.on() && Staff.lock()); await sleep(300); }
      if (!(await d.page.$('.staff-lock'))) return false;
      const id = await d.ev(n => (App.S.staff.find(p => p.name === n) || {}).id, personName);
      await d.ev(i => Staff.pick(i), id); await sleep(200);
      await d.page.fill('#stPw', pw); await d.page.keyboard.press('Enter'); await sleep(800);
      d.who = personName;
      return !(await d.page.$('.staff-lock'));
    };
    devs.push(d);
    return d;
  }
  const flush = d => d.ev(() => App.flushSave().then(() => true, e => String(e && e.message)));
  const clearModals = d => d.ev(() => { const h = document.getElementById('modalHost'); if (h) h.innerHTML = ''; document.querySelectorAll('.done-pop,.celebrate').forEach(e => e.remove()); });
  const clickModal = async (d, txt) => { await d.page.click('#modalHost button:has-text("' + txt + '")', { timeout: 5000 }); await sleep(300); };

  /* ---------- العمليات بأزرار الشاشة ---------- */
  async function sale(d, lines, opt) {
    opt = opt || {};
    const t0 = Date.now();
    await d.ev(() => { if (location.hash !== '#/pos') { location.hash = '#/pos'; App.route(); } });
    /* الفاتورة الجديدة تُعرف بأصنافها لا بموضعها: فاتورة جهاز آخر قد تصل في اللحظة نفسها */
    await d.ev(({ lines, disc }) => {
      window.__before = new Set(App.S.invoices.map(v => v.id));
      for (const [t, id, q] of lines) { Sales.add(t, id); Sales.setQty(Sales.__cartLen() - 1, q); }
      if (disc) Sales.setDiscount(disc);
      Sales.complete();
    }, { lines, disc: opt.disc || 0 });
    await sleep(150);
    if (opt.method === 'credit') {
      await d.ev(() => Sales.pick('credit')); await sleep(200);
      await d.page.selectOption('#payCust', opt.cust);
      await d.page.fill('#payNow', String(opt.paid || 0));
      await d.ev(() => Sales.confirmCredit());
    } else await d.ev(m => Sales.pick(m), opt.method || 'cash');
    await sleep(250);
    const skip = await d.page.$('button:has-text("بدون طباعة")');
    if (skip) await skip.click().catch(() => { });
    const inv = await d.ev(lines => {
      const want = lines.map(l => l[1]).sort().join(',');
      const v = App.S.invoices.find(x => !window.__before.has(x.id) && x.kind !== 'return' && (x.items || []).map(l => l.id).sort().join(',') === want);
      return v ? { id: v.id, no: v.no, total: v.total, kind: v.kind, items: (v.items || []).map(l => ({ type: l.type, id: l.id, qty: l.qty })) } : null;
    }, lines);
    await clearModals(d);
    if (inv) inv.ms = Date.now() - t0;
    return inv;
  }
  async function refund(d, invId, qty) {
    await d.ev(() => { window.__before = new Set(App.S.invoices.map(v => v.id)); });
    await d.ev(id => Sales.startReturn(id), invId); await sleep(300);
    const ins = await d.page.$$('#modalHost .ret-q');
    if (!ins.length) { await clearModals(d); return null; }
    await ins[0].fill(String(qty));
    for (let i = 1; i < ins.length; i++) await ins[i].fill('0');
    await d.page.click('#modalHost button:has-text("تسجيل الإرجاع")'); await sleep(400);
    const inv = await d.ev(() => { const v = App.S.invoices.find(x => !window.__before.has(x.id) && x.kind === 'return'); return v ? { id: v.id, no: v.no, total: v.total, kind: v.kind, items: (v.items || []).map(l => ({ type: l.type, id: l.id, qty: l.qty })) } : null; });
    await clearModals(d);
    return inv;
  }
  async function addStock(d, id, n) {
    await d.ev(i => Inv.addStock('book', i), id); await sleep(250);
    await d.page.fill('#asAdd', String(n));
    await d.page.click('#modalHost .m-foot .btn.primary'); await sleep(300);
    await clearModals(d);
  }
  async function editPrice(d, id, price) {
    await d.ev(i => Inv.editBook(i), id); await sleep(300);
    await d.page.fill('#f_price', String(price));
    await clickModal(d, 'حفظ'); await sleep(200);
    await clearModals(d);
  }
  async function newBook(d, title, price, qty) {
    await d.ev(() => Inv.editBook()); await sleep(300);
    await d.page.fill('#f_title', title); await d.page.fill('#f_price', String(price)); await d.page.fill('#f_qty', String(qty));
    await clickModal(d, 'حفظ'); await sleep(300);
    const id = await d.ev(t => (App.S.books.find(b => b.title === t) || {}).id || '', title);
    await clearModals(d);
    return id;
  }

  /* ---------- هاتف ---------- */
  async function phone(branch, name, auth) {
    const st = await site({ url: '', key: '', branch, theme: branch === 'misrata' ? 'green' : 'blue', name: 'دار الحكمة', city: branch === 'misrata' ? 'مصراتة' : 'طرابلس' });
    sites.push(st);
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const p = await ctx.newPage();
    p.on('pageerror', e => allErrs.push(name + ' خطأ صفحة: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|favicon|blocked by CORS policy/.test(m.text())) allErrs.push(name + ' console: ' + m.text().slice(0, 200)); });
    const ph = { name, branch, page: p, ctx, orders: [] };
    await p.goto(st.url + '#u=' + encodeURIComponent(cloud.url) + '&k=' + encodeURIComponent(KEY));
    if (auth.pin) {
      await p.waitForSelector('#pw2', { timeout: 90000 });
      await p.fill('#pw', auth.pin); await p.fill('#pw2', auth.pin); await p.click('[data-a="pinSet"]');
    } else {
      await p.waitForSelector('.who .p', { timeout: 90000 });
      const id = await p.evaluate(n => (Core.people().find(x => x.n === n) || {}).id, auth.staff);
      await p.click('.who [data-v="' + id + '"]'); await p.fill('#pw', auth.pw); await p.click('[data-a="login"]');
    }
    await p.waitForSelector('.nav', { timeout: 30000 });
    await p.evaluate(() => { const s = document.getElementById('sheet'); s.hidden = true; s.innerHTML = ''; Core.S.phone.name = document.title; });
    await p.evaluate(n => { Core.S.phone.name = n; Core.save(); }, name);
    ph.sale = async codes => {
      await p.evaluate(cs => { UI.go('sell'); cs.forEach(c => UI.onScan(c)); }, codes);
      await sleep(250);
      if (!(await p.$('[data-a="checkout"]:not([disabled])'))) return null;
      await p.click('[data-a="checkout"]'); await p.waitForSelector('#donePop', { timeout: 5000 }); await p.click('[data-a="rcSkip"]');
      const o = await p.evaluate(() => { const x = Core.S.orders[0]; return { id: x.id, total: x.total, items: x.items }; });
      ph.orders.push(o);
      return o;
    };
    ph.refresh = () => p.evaluate(() => Core.refresh());
    phones.push(ph);
    return ph;
  }

  try {
    /* ============ البيانات ============ */
    log('يولّد بيانات الفرعين: طرابلس ' + BOOKS + ' كتاباً…');
    generate({ profile: 'tripoli', books: BOOKS, stationery: 2000, years: 1, store3: 1, out: path.join(tmp, 'gt') });
    generate({ profile: 'misrata', store3: 1, out: path.join(tmp, 'gm') });
    const tri = JSON.parse(fs.readFileSync(path.join(tmp, 'gt', 'store3.json'), 'utf8'));
    tri.invoices = []; tri.payments = []; tri.counters.invoice = 0;
    tri.customers = tri.customers.slice(0, 60).map(c => Object.assign(c, { balance: 0 }));
    for (const it of tri.books.concat(tri.stationery)) { delete it.lastSold; delete it.soldTotal; }
    tri.branch = { id: 'tripoli', name: 'دار الحكمة — طرابلس', city: 'طرابلس', phone: '', label: '', no: 2 };
    tri.meta.shopName = 'دار الحكمة — طرابلس';
    tri.sync = { url: cloud.url, key: KEY, site: '', auto: true, everyMin: 10 };
    const mis = JSON.parse(fs.readFileSync(path.join(tmp, 'gm', 'store3.json'), 'utf8'));
    mis.branch = { id: 'misrata', name: 'دار الحكمة — مصراتة', city: 'مصراتة', phone: '', label: '', no: 1 };
    mis.meta.shopName = 'دار الحكمة — مصراتة';
    mis.sync = { url: cloud.url, key: KEY, site: '', auto: true, everyMin: 10 };
    /* كتاب مشترك بين الفرعين (لطلب التحويل)، وكتاب بنسخة واحدة في طرابلس (لبيعه من جهازين معاً) */
    const SHARED = '9789990000017';
    tri.books[50].barcode = SHARED; tri.books[50].title = 'المرجع المشترك بين الفرعين'; tri.books[50].qty = 40; tri.books[50].store = 0; tri.books[50].price = 25;
    mis.books[20].barcode = SHARED; mis.books[20].title = 'المرجع المشترك بين الفرعين'; mis.books[20].qty = 2; mis.books[20].store = 0; mis.books[20].price = 25;
    const usable = s => { const c = {}; s.books.forEach(b => { if (b.barcode) c[b.barcode] = (c[b.barcode] || 0) + 1; }); return s.books.filter(b => b.barcode && c[b.barcode] === 1 && b.price > 0 && b.qty >= 6 && !(b.store > 0) && b.barcode !== SHARED); };
    const poolT = usable(tri).slice(0, 400), poolM = usable(mis).slice(0, 200);
    if (poolT.length < 30 || poolM.length < 20) throw new Error('كتب صالحة للمحاكاة قليلة: ' + poolT.length + ' / ' + poolM.length);
    const LAST = poolT.pop(); LAST.qty = 1;                      // آخر نسخة
    const KILLB = poolT.pop();                                   // بيعة قبل انطفاء جهاز المحل
    const init = { tripoli: new Map(), misrata: new Map() };
    tri.books.forEach(b => init.tripoli.set(b.id, b.qty));
    mis.books.forEach(b => init.misrata.set(b.id, b.qty));
    const bcT = new Map(tri.books.filter(b => b.barcode).map(b => [b.barcode, b.id])), bcM = new Map(mis.books.filter(b => b.barcode).map(b => [b.barcode, b.id]));
    const inv0 = { tripoli: tri.invoices.length, misrata: mis.invoices.length };
    const oldIds = { tripoli: new Set(tri.invoices.map(v => v.id)), misrata: new Set(mis.invoices.map(v => v.id)) }, newIds = { tripoli: new Set(), misrata: new Set() };
    /* الدفتر: ما يجب أن يتغيّر في كل صنف، وكل فاتورة سُجّلت */
    const delta = { tripoli: new Map(), misrata: new Map() }, made = { tripoli: [], misrata: [] };
    const bump = (br, id, n) => delta[br].set(id, (delta[br].get(id) || 0) + n);
    const book = (d, inv, src) => { if (inv) made[d.branch].push({ id: inv.id, no: inv.no, src: src || d.label }); };

    log('يبني تطبيقي طرابلس ومصراتة…');
    const TM = device('TM', 'tripoli', 'tripoli', 'طرابلس-المحل'), TS = device('TS', 'tripoli', 'tripoli', 'طرابلس-الثاني');
    const MM = device('MM', 'misrata', 'misrata', 'مصراتة-المحل'), MS = device('MS', 'misrata', 'misrata', 'مصراتة-اللابتوب');
    E.buildEngine(TM.dir, 'tripoli'); E.copyEngine(TM.dir, TS.dir);
    E.buildEngine(MM.dir, 'misrata'); E.copyEngine(MM.dir, MS.dir);
    fs.writeFileSync(path.join(TM.dir, 'data', 'store.json'), JSON.stringify(tri));
    fs.writeFileSync(path.join(MM.dir, 'data', 'store.json'), JSON.stringify(mis));
    const blank = b => ({ meta: { setupDone: true, shopName: b.meta.shopName, currency: 'د.ل', libraries: b.meta.libraries, shelves: b.meta.shelves }, branch: b.branch, sync: b.sync, books: [], stationery: [], customers: [], invoices: [], payments: [], counters: { invoice: 0, book: 0, stat: 0 } });
    fs.writeFileSync(path.join(TS.dir, 'data', 'store.json'), JSON.stringify(blank(tri)));
    fs.writeFileSync(path.join(MS.dir, 'data', 'store.json'), JSON.stringify(blank(mis)));

    console.log('\n== 1. الربط: أربعة أجهزة لفرعين على خادم واحد ==');
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    let t = Date.now();
    await TM.start();
    let r = await TM.link({ action: 'main', url: cloud.url, key: KEY, name: 'كاشير طرابلس' });
    ok(r && r.ok && r.data.role === 'main', 'طرابلس: جهاز المحل رُبط (' + ((Date.now() - t) / 1000).toFixed(1) + ' ث مع ' + BOOKS + ' كتاباً)', r);
    await MM.start();
    r = await MM.link({ action: 'main', url: cloud.url, key: KEY, name: 'محل مصراتة' });
    ok(r && r.ok && r.data.role === 'main', 'مصراتة: جهاز المحل رُبط', r);
    t = Date.now();
    await TS.start();
    r = await TS.link({ action: 'second', url: cloud.url, key: KEY, branch: 'tripoli', name: 'الدور الأول', replace: true });
    ok(r && r.ok && r.data.role === 'second', 'طرابلس: الجهاز الثاني أخذ نسخته (' + ((Date.now() - t) / 1000).toFixed(1) + ' ث)', r);
    await MS.start();
    r = await MS.link({ action: 'second', url: cloud.url, key: KEY, branch: 'misrata', name: 'لابتوب حسن', replace: true });
    ok(r && r.ok && r.data.role === 'second', 'مصراتة: اللابتوب أخذ نسخته', r);
    t = Date.now();
    await Promise.all([TM.open(), MM.open()]);
    await Promise.all([TS.open(), MS.open()]);
    log('الشاشات الأربع فُتحت في ' + ((Date.now() - t) / 1000).toFixed(1) + ' ث');
    ok((await TS.ev(() => App.S.books.length)) === tri.books.length && (await MS.ev(() => App.S.books.length)) === mis.books.length, 'الجهازان الثانيان فيهما كتب فرعيهما كلها');

    console.log('\n== 2. موظفو طرابلس: المدير والكاشير وأمين المخزن ==');
    await TM.ev(() => Staff.setup()); await sleep(300);
    await TM.page.fill('#f_name', 'المدير'); await TM.page.fill('#f_pw', '9876'); await TM.page.fill('#f_pw2', '9876');
    await clickModal(TM, 'فعّل'); await sleep(900); await clearModals(TM);
    for (const [n, role, pw] of [['سالم', 'r-cashier', '1111'], ['أمين', 'r-store', '2222']]) {
      await TM.ev(() => Staff.edit()); await sleep(300);
      await TM.page.fill('#f_name', n); await TM.page.selectOption('#f_role', role); await TM.page.fill('#f_pw', pw);
      await clickModal(TM, 'حفظ'); await sleep(600);
    }
    await flush(TM);
    ok(await TM.ev(() => App.S.staff.length === 3 && Staff.on()), 'ثلاثة موظفين على جهاز المحل');
    let got = false;
    for (let i = 0; i < 40 && !got; i++) { got = await TS.ev(() => window.Staff && Staff.on() && App.S.staff.length === 3); if (!got) await sleep(500); }
    ok(got, 'ووصلوا الجهاز الثاني وحدهم (الشاشة قُفلت تطلب الدخول)');
    ok(await TS.login('سالم', '1111'), 'الجهاز الثاني: سالم (كاشير) دخل بكلمة سره');
    ok(await TM.ev(() => !document.querySelector('.staff-lock')), 'جهاز المحل: المدير داخل');
    await TM.ev(() => Stock.sync(true)); await MM.ev(() => Stock.sync(true)); await sleep(2500);

    console.log('\n== 3. الهواتف الثلاثة ==');
    const P1 = await phone('tripoli', 'هاتف سالم', { staff: 'سالم', pw: '1111' });
    const P2 = await phone('tripoli', 'هاتف المدير', { staff: 'المدير', pw: '9876' });
    const P3 = await phone('misrata', 'هاتف مصراتة', { pin: '2468' });
    const pinfo = await Promise.all([P1, P2, P3].map(x => x.page.evaluate(() => Core.info())));
    ok(pinfo[0].n === tri.books.length + tri.stationery.length && pinfo[0].src === 'cat', 'هاتفا طرابلس: كتب الفرع كلها من قائمته (' + pinfo[0].n + ')', pinfo[0]);
    ok(pinfo[2].n === mis.books.length + mis.stationery.length && pinfo[2].src === 'snap', 'هاتف مصراتة: كتبها من لقطتها (' + pinfo[2].n + ')', pinfo[2]);

    /* ============ اليوم ============ */
    console.log('\n== 4. يوم العمل (' + ROUNDS + ' جولة) ==');
    const times = { 'طرابلس-المحل': [], 'طرابلس-الثاني': [], 'مصراتة-المحل': [], 'مصراتة-اللابتوب': [] };
    const sold = { tripoli: [], misrata: [] };            // فواتير بيع يمكن إرجاعها: {dev, inv}
    let nSales = 0, nPhone = 0, nReturns = 0, nOther = 0;
    const pool = d => d.branch === 'tripoli' ? poolT : poolM;
    async function randomSale(d) {
      const n = 1 + Math.floor(rnd() * 3), lines = [], used = {};
      for (let i = 0; i < n; i++) { const b = pick(pool(d)); if (used[b.id]) continue; used[b.id] = 1; lines.push(['book', b.id, 1 + Math.floor(rnd() * 2)]); }
      const m = rnd();
      const cust = await d.ev(() => (App.S.customers[0] || {}).id || '');
      const opt = m < 0.6 ? { method: 'cash' } : m < 0.85 || !cust ? { method: 'card' } : { method: 'credit', cust, paid: 0 };
      if (d.who !== 'سالم' && rnd() < 0.15) opt.disc = 1;
      const inv = await sale(d, lines, opt);
      if (!inv) { notes.push(d.label + ': بيعة لم تُسجَّل في الشاشة'); return; }
      book(d, inv); nSales++; times[d.label].push(inv.ms);
      sold[d.branch].push({ d, inv });
    }
    async function act(d) {
      if (!d.up || !d.page) return;
      const x = rnd();
      if (x < 0.72) return randomSale(d);
      if (x < 0.80 && d.who !== 'سالم' && sold[d.branch].length) {
        const s = sold[d.branch].splice(Math.floor(rnd() * sold[d.branch].length), 1)[0];
        const has = await d.ev(id => !!Sales.getInvoice(id), s.inv.id);
        if (!has) { sold[d.branch].push(s); return; }      // لم تصل هذا الجهاز بعد
        const inv = await refund(d, s.inv.id, 1);
        if (inv) { book(d, inv); nReturns++; }
        return;
      }
      if (x < 0.88 && d.who !== 'سالم') { const b = pick(pool(d)); await addStock(d, b.id, 5); bump(d.branch, b.id, 5); nOther++; return; }
      if (x < 0.94 && d.who !== 'سالم') { const b = pick(pool(d)); await editPrice(d, b.id, Math.round(b.price) + 1); nOther++; return; }
      return randomSale(d);
    }
    async function phoneAct(ph) {
      const p = ph.branch === 'tripoli' ? poolT : poolM;
      const b = pick(p);
      const o = await ph.sale([b.barcode]);
      if (o) nPhone++;
    }
    /* سؤال الدقيقة عن بيع الهاتف (في المحل كل دقيقة؛ هنا مع كل جولة) */
    const poll = async () => { for (const d of [TM, MM]) if (d.up && d.page && !net.down) await d.ev(() => Stock.sync(false, true)).catch(() => { }); };

    let killedSale = null;
    for (let round = 1; round <= ROUNDS; round++) {
      if (round === 6) { net.down = true; log('⚡ الإنترنت انقطع عن الجميع (والبيع مستمر)'); }
      if (round === 10) { net.down = false; log('✓ الإنترنت رجع'); }
      if (round === 12) { await flush(TS); await TS.kill(); log('⚡ جهاز طرابلس الثاني انطفأ (كهرباء)'); }
      if (round === 15) { await TS.start(); await TS.open(); await TS.login('سالم', '1111'); log('✓ جهاز طرابلس الثاني اشتغل من جديد'); }
      if (round === 17) {
        /* جهاز المحل ينطفئ بعد بيعة حُفظت للتو */
        killedSale = await sale(TM, [['book', KILLB.id, 1]], { method: 'cash' });
        const fl = await flush(TM);
        book(TM, killedSale);
        await TM.kill(); log('⚡ جهاز محل طرابلس انطفأ بعد بيعة (حُفظت: ' + fl + ')');
      }
      if (round === 19) { await TM.start(); await TM.open(); await TM.login('المدير', '9876'); log('✓ جهاز محل طرابلس اشتغل من جديد'); }
      if (round === 21) { net.flaky = 0.3; log('⚡ خادم الربط يردّ بأخطاء متقطعة (30%)'); }
      if (round === 23) { net.flaky = 0; log('✓ خادم الربط رجع سليماً'); }
      for (const d of [TM, TS, MM, MS]) { try { await act(d); } catch (e) { notes.push(d.label + ' جولة ' + round + ': ' + String(e.message).split('\n')[0]); await clearModals(d).catch(() => { }); } }
      if (round % 2 === 0) for (const ph of [P1, P2, P3]) { try { await phoneAct(ph); } catch (e) { notes.push(ph.name + ' جولة ' + round + ': ' + String(e.message).split('\n')[0]); } }
      await poll();
      await sleep(900);
      if (round % 5 === 0) log('جولة ' + round + ': ' + nSales + ' بيعة من الأجهزة، ' + nPhone + ' من الهواتف، ' + nReturns + ' إرجاع، ' + nOther + ' إضافة وتعديل');
    }

    console.log('\n== 5. آخر نسخة تُباع من جهازين في اللحظة نفسها ==');
    await sleep(4000);
    const both = await Promise.all([sale(TM, [['book', LAST.id, 1]], { method: 'cash' }), sale(TS, [['book', LAST.id, 1]], { method: 'cash' })]);
    both.forEach((inv, i) => book(i ? TS : TM, inv));
    ok(both[0] && both[1], 'الجهازان سجّلا البيعة (كل واحد يظن أنها آخر نسخة)', both.map(x => x && x.no));

    console.log('\n== 6. طلب تحويل بين الفرعين: مصراتة تطلب من طرابلس ==');
    await MM.link({ action: 'now' }).catch(() => { });
    await MM.ev(() => { location.hash = '#/stock'; App.route(); }); await sleep(600);
    await MM.ev(() => Stock.sync(true)); await sleep(2500);
    await MM.ev(() => Stock.open('branch', 'tripoli'));
    const hasTab = await MM.page.waitForSelector('#rbq', { timeout: 20000 }).then(() => true, () => false);
    ok(hasTab, 'مصراتة تفتح كتب طرابلس');
    if (hasTab) {
      await MM.page.fill('#rbq', 'المرجع المشترك بين الفرعين'); await sleep(700);
      await MM.page.click('#rbBody button:has-text("طلب تحويل")'); await sleep(400);
      await MM.page.fill('#f_qty', '5'); await clickModal(MM, 'إرسال الطلب'); await sleep(2500);
      await TM.ev(() => Stock.sync(true)); await sleep(2500);
      const req = await TM.ev(() => { const q = Stock.requests().find(x => x._status === 'pending' && x.to === App.S.branch.id); return q && { id: q.id, n: q.lines[0].n, qty: q.lines[0].qty }; });
      ok(req && req.qty === 5, 'الطلب وصل طرابلس (5 نسخ)', req);
      if (req) {
        await TM.ev(id => Stock.respond(id, 'shipped'), req.id); await sleep(300);
        await clickModal(TM, 'موافقة وشحن'); await sleep(2500);
        bump('tripoli', tri.books[50].id, -5);
        await MM.ev(() => Stock.sync(true)); await sleep(2500);
        const st = await MM.ev(id => (Stock.requests().find(x => x.id === id) || {})._status, req.id);
        ok(st === 'shipped', 'مصراتة ترى أن طرابلس شحنت', st);
        await MM.ev(id => Stock.confirmReceipt(id), req.id); await sleep(300);
        await clickModal(MM, 'تأكيد'); await sleep(1500);
        bump('misrata', mis.books[20].id, +5);
        await MM.ev(() => Stock.sync(true)); await TM.ev(() => Stock.sync(true)); await sleep(2500);
        ok(await TM.ev(id => (Stock.requests().find(x => x.id === id) || {})._status, req.id) === 'done', 'وطرابلس ترى أن مصراتة استلمت');
      }
    }

    /* ============ الهدوء ثم التحقق ============ */
    console.log('\n== 7. نهاية اليوم: كل شيء يصل، ثم التحقق ==');
    net.down = false; net.flaky = 0;
    for (const d of [TM, TS, MM, MS]) await flush(d).catch(() => { });
    for (let i = 0; i < 6; i++) { await poll(); await sleep(2500); for (const ph of phones) await ph.refresh().catch(() => { }); }
    const sections = s => ({
      books: s.books.map(b => [b.id, b.qty, b.price, b.title, b.store || 0]).sort((a, b) => a[0] < b[0] ? -1 : 1),
      invoices: s.invoices.map(v => [v.id, v.no, v.total, v.kind || 'sale']).sort((a, b) => a[0] < b[0] ? -1 : 1),
      customers: s.customers.map(c => [c.id, c.balance || 0]).sort((a, b) => a[0] < b[0] ? -1 : 1),
      counters: s.counters
    });
    let SM = {}, same = false;
    for (let i = 0; i < 60 && !same; i++) {
      SM = { TM: await TM.load(), TS: await TS.load(), MM: await MM.load(), MS: await MS.load() };
      same = JSON.stringify(sections(SM.TM)) === JSON.stringify(sections(SM.TS)) && JSON.stringify(sections(SM.MM)) === JSON.stringify(sections(SM.MS));
      if (!same) await sleep(2000);
    }
    const diff = (a, b) => { const A = sections(a), B = sections(b), out = {}; for (const k of Object.keys(A)) if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) { const m = new Map(B[k].map ? B[k].map(x => [x[0], JSON.stringify(x)]) : []); out[k] = A[k].filter ? A[k].filter(x => m.get(x[0]) !== JSON.stringify(x)).slice(0, 4) : [A[k], B[k]]; out[k + 'N'] = [A[k].length, B[k].length]; } return out; };
    ok(JSON.stringify(sections(SM.TM)) === JSON.stringify(sections(SM.TS)), 'طرابلس: الجهازان متطابقان (كتب وفواتير وزبائن وعدّادات)', diff(SM.TM, SM.TS));
    ok(JSON.stringify(sections(SM.MM)) === JSON.stringify(sections(SM.MS)), 'مصراتة: الجهازان متطابقان', diff(SM.MM, SM.MS));

    for (const [br, main, i0] of [['tripoli', SM.TM, inv0.tripoli], ['misrata', SM.MM, inv0.misrata]]) {
      const nm = br === 'tripoli' ? 'طرابلس' : 'مصراتة';
      main.invoices.forEach(v => { if (!oldIds[br].has(v.id)) newIds[br].add(v.id); });
      const ids = new Set(main.invoices.map(v => v.id));
      const lost = made[br].filter(m => !ids.has(m.id));
      ok(lost.length === 0, nm + ': لا بيعة ضاعت من ' + made[br].length + ' فاتورة سُجّلت على الأجهزة', lost.slice(0, 5));
      const phoneInv = main.invoices.filter(v => v.source === 'phone');
      const phOrders = phones.filter(p => p.branch === br).reduce((a, p) => a + p.orders.length, 0);
      ok(phoneInv.length === phOrders, nm + ': بيع الهواتف كله سُجّل مرة واحدة (' + phoneInv.length + ' من ' + phOrders + ')', { phoneInv: phoneInv.length, phOrders });
      ok(main.invoices.length - i0 === made[br].length + phoneInv.length, nm + ': عدد الفواتير الجديدة = ما سُجّل بالضبط (' + (main.invoices.length - i0) + ')', { new: main.invoices.length - i0, made: made[br].length, phone: phoneInv.length });
      const nos = main.invoices.map(v => v.no), dup = nos.filter((n, i) => nos.indexOf(n) !== i);
      ok(dup.length === 0, nm + ': لا رقم فاتورة مكرّر', dup.slice(0, 8));
      if (dup.length) {
        /* التشخيص: الفاتورتان كاملتين، ومن سجّلهما، وما في سجل جهاز المحل عن الحفظ */
        main.invoices.filter(v => dup.includes(v.no)).forEach(v => {
          const m = made[br].find(x => x.id === v.id);
          const c = Object.assign({}, v); c.items = (v.items || []).map(l => l.id + '×' + l.qty).join(' ');
          console.log('         مكرّر ' + v.no + ' ← ' + (m ? 'سجّلها ' + m.src + ' برقم ' + m.no : v.source === 'phone' ? 'من الهاتف' : 'غير معروفة') + ': ' + JSON.stringify(c).slice(0, 420));
        });
        const dev = br === 'tripoli' ? TM : MM;
        try {
          fs.readFileSync(path.join(dev.dir, 'data', 'log.txt'), 'utf8').split('\n')
            .filter(l => /نسخة لم تعد معروفة|X3CHECK|تذكّر|بالفرق لم يُفهم|أُخذ ملف|store\.json من خارج/.test(l)).slice(-15)
            .forEach(l => console.log('         سجل ' + dev.label + ': ' + l.slice(0, 220)));
        } catch (e) { }
      }
      /* كمية كل صنف: ما كانت − ما في فواتير اليوم كلها (بيعاً وإرجاعاً، من الأجهزة والهواتف) + المضاف والمحوَّل */
      const net = new Map();
      main.invoices.forEach(v => {
        if (!newIds[br].has(v.id)) return;
        (v.items || []).forEach(l => net.set(l.id, (net.get(l.id) || 0) + (v.kind === 'return' ? +l.qty : -l.qty)));
      });
      const bad = [];
      main.books.forEach(b => { if (!init[br].has(b.id)) return; const want = init[br].get(b.id) + (net.get(b.id) || 0) + (delta[br].get(b.id) || 0); if (b.qty !== want) bad.push([b.title.slice(0, 30), 'كانت ' + init[br].get(b.id), 'المتوقع ' + want, 'الموجود ' + b.qty]); });
      ok(bad.length === 0, nm + ': كمية كل كتاب من ' + main.books.length + ' = ما كانت − المباع + المرتجع + المضاف', bad.slice(0, 6));
    }
    const lastQ = SM.TM.books.find(b => b.id === LAST.id).qty;
    console.log('         (آخر نسخة بيعت من جهازين: الكمية صارت ' + lastQ + ' — بيعتان مسجّلتان، والسالب يدلّ على نسخة ناقصة)');
    if (lastQ < 0) {
      /* شاشة المحل تعرضها في «التنبيهات» ليُعدّ الرف وتُصحَّح */
      let shown = null;
      for (let i = 0; i < 20 && !shown; i++) {
        shown = await TM.ev(id => {
          location.hash = '#/alerts'; App.route();
          const v = document.getElementById('view');
          return /كمية بالسالب/.test(v.textContent) && v.querySelector('button[onclick*="' + id + '"]') ? v.textContent.match(/كمية بالسالب — \d+ صنف/)[0] : null;
        }, LAST.id).catch(() => null);
        if (!shown) await sleep(700);
      }
      ok(!!shown, 'التنبيهات في جهاز المحل تعرضها: «' + shown + '» وزر «صحّح»');
    }

    for (const ph of phones) {
      const o = await ph.page.evaluate(() => ({ pend: Core.pending(), bad: Core.S.orders.filter(x => x.status !== 'done').map(x => x.status + ':' + x.id), n: Core.S.orders.length }));
      ok(o.pend === 0 && o.bad.length === 0, ph.name + ': كل بيعه (' + o.n + ') عاد برقم فاتورته', o);
    }

    console.log('\n== 8. كل فرع يرى كتب الآخر بكمياتها الأخيرة ==');
    await TM.link({ action: 'now' }); await MM.link({ action: 'now' }); await sleep(1500);
    await TM.link({ action: 'now' }); await MM.link({ action: 'now' });
    const remM = (await MM.raw('/api/x3/remotes')).body, remT = (await TM.raw('/api/x3/remotes')).body;
    const triSeen = remM.branches.find(b => b.branch && b.branch.id === 'tripoli'), misSeen = remT.branches.find(b => b.branch && b.branch.id === 'misrata');
    const cmp = (seen, main) => {
      if (!seen) return ['لا يظهر'];
      const wh = new Map();
      (main.warehouses || []).forEach(w => (w.stock || []).forEach(x => { if (x.type === 'book') wh.set(x.itemId, (wh.get(x.itemId) || 0) + (+x.qty || 0)); }));
      const cnt = {}; main.books.forEach(b => { if (b.barcode) cnt[b.barcode] = (cnt[b.barcode] || 0) + 1; });
      const m = new Map(seen.items.filter(i => i.b).map(i => [i.b, i.q])), bad = [];
      main.books.forEach(b => { if (b.barcode && cnt[b.barcode] === 1 && m.has(b.barcode) && m.get(b.barcode) !== b.qty + (wh.get(b.id) || 0)) bad.push([b.barcode, b.qty, wh.get(b.id) || 0, m.get(b.barcode)]); });
      return bad;
    };
    const fin = { TM: await TM.load(), MM: await MM.load() };
    const cT = cmp(triSeen, fin.TM), cM = cmp(misSeen, fin.MM);
    ok(triSeen && triSeen.items.length === fin.TM.books.length + fin.TM.stationery.length && cT.length === 0, 'مصراتة ترى طرابلس: ' + (triSeen ? triSeen.items.length : 0) + ' صنفاً بكمياتها الأخيرة', cT.slice(0, 5));
    ok(misSeen && cM.length === 0, 'طرابلس ترى مصراتة بكمياتها الأخيرة', cM.slice(0, 5));

    console.log('\n== 9. حالة الربط والسجلات والشاشات ==');
    for (const d of [TM, TS, MM, MS]) {
      const st = await d.status();
      ok(st && !st.error && !st.catError && !st.catPubError && !(st.waiting > 0) && !(st.failed > 0), d.label + ': الربط سليم، لا شيء ينتظر ولا مرفوض', st && { error: st.error, cat: st.catError, pub: st.catPubError, waiting: st.waiting, failed: st.failed });
      const lg = fs.readFileSync(path.join(d.dir, 'data', 'log.txt'), 'utf8');
      const bad = lg.split('\n').filter(l => /X3CHECK|Exception|   at |خطأ غير متوقع/.test(l));
      ok(bad.length === 0, d.label + ': سجل البرنامج بلا أخطاء داخلية', bad.slice(0, 4));
    }
    ok(allErrs.length === 0, 'بلا أخطاء في أي شاشة (4 أجهزة و3 هواتف)', allErrs.slice(0, 8));
    if (notes.length) { console.log('\n  ملاحظات أثناء اليوم:'); notes.slice(0, 20).forEach(n => console.log('   - ' + n)); }
    ok(notes.length === 0, 'كل عملية في اليوم تمّت بلا تعثّر', notes.length + ' ملاحظة');

    console.log('\n== الأرقام ==');
    const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0, mx = a => a.length ? Math.max.apply(null, a) : 0;
    console.log('  بيع الأجهزة ' + nSales + '، بيع الهواتف ' + nPhone + '، إرجاع ' + nReturns + '، إضافة وتعديل ' + nOther);
    for (const k of Object.keys(times)) console.log('  ' + k + ': زمن البيعة في الشاشة متوسط ' + avg(times[k]) + ' ms، أقصى ' + mx(times[k]) + ' ms (' + times[k].length + ' بيعة)');
    const kvs = cloud.env.SHOP.stats, d1 = cloud.env.DB.stats;
    console.log('  خادم الربط: KV — list ' + kvs.list + '، قراءة ' + kvs.get + '، كتابة ' + kvs.put + ' · D1 — قراءة ' + d1.reads + '، كتابة ' + d1.writes);
    if (SHOTS) for (const d of [TM, TS, MM, MS]) { await d.ev(() => { location.hash = '#/dash'; App.route(); }); await sleep(600); await d.page.screenshot({ path: path.join(SHOTS, 'sim-' + d.name + '.png') }); }
  } catch (e) {
    fail++;
    console.log('  FAIL  ' + (e && e.stack || e));
    if (allErrs.length) console.log('  أخطاء الشاشات: ' + JSON.stringify(allErrs.slice(0, 6)));
  } finally {
    if (browser) await browser.close().catch(() => { });
    sites.forEach(s => s.srv.close());
    devs.forEach(d => E.stopEngine(d.proc));
    await cloud.close();
    if (!process.env.KEEP) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
    else console.log('المجلد: ' + tmp);
  }
  console.log('\n==================================================');
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('==================================================');
  process.exit(fail ? 1 : 0);
})();
